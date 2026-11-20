#!/usr/bin/env python3
"""Extract the SHS Mathematics curriculum hierarchy (year > strand > sub-strand > content standard / learning outcome > learning indicator)
from `pdftotext -layout` output, with the PDF page of each element. Text is copied verbatim (whitespace-joined); nothing is invented.
Usage: parse-maths-curriculum.py curriculum.pdf out.json [SUBJECT NAME, default MATHEMATICS]
The same NaCCA SHS table layout is used by other subjects (e.g. ENGLISH LANGUAGE), so the subject header/footer is a parameter."""
import json, re, subprocess, sys
pdf, out = sys.argv[1], sys.argv[2]
SUBJ = re.escape(sys.argv[3].upper()).replace(r'\ ', r'\s+') if len(sys.argv) > 3 else 'MATHEMATICS'
pages = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, check=True).stdout.decode('utf-8', 'replace').split('\f')

def restore_degrees(pages):
    """The curriculum typesets the degree sign as a superscript "0" (e.g. 30 followed by a 7pt superscript 0); pdftotext flattens
    that to "300". Using PyMuPDF span flags, find each <digits><superscript 0/o> on a page and rewrite exactly that many matching
    "<digits>0" tokens in the layout text, in reading order, as "<digits>°". Without PyMuPDF the text is left unchanged (warned)."""
    try:
        import pymupdf
    except ImportError:
        print('warning: PyMuPDF not installed; degree signs (superscript 0) are not restored', file=sys.stderr); return pages
    doc = pymupdf.open(pdf); fixed = 0
    for i in range(min(len(doc), len(pages))):
        want = []
        for b in doc[i].get_text('dict')['blocks']:
            for l in b.get('lines', []):
                sp = l['spans']
                for a, c in zip(sp, sp[1:]):
                    m = re.search(r'(\d+)$', a['text'])
                    if m and c['text'].strip() in ('0', 'o', '\u00ba') and c['flags'] & 1 and c['size'] < a['size']: want.append(m.group(1))
        for n in want:
            new, k = re.subn(r'(?<![\d.])' + n + r'0(?![\d])', n + '\u00b0', pages[i], count=1)
            if k: pages[i] = new; fixed += 1
    print(f'degree signs restored: {fixed}', file=sys.stderr); return pages
pages = restore_degrees(pages)
CODE = re.compile(r'\b([1-3])\.([1-9])\.([1-9])\.(CS|LO|LI|AS)\.(\d+)\b')
STRAND = re.compile(r'^\s*Strand\s+(\d)\.\s+(.+?)\s*$'); SUB = re.compile(r'^\s*Sub-Strand\s+(\d)\.\s+(.+?)\s*$')
GARBLED = re.compile(r'[\u03e0-\u03ff\u0100-\u017f\u0300-\u036f\u0200-\u024f]')
def column_text(lines, i, col, end, left):
    """Text under a code at column `col`. Left-column cells (CS/LO) are interleaved with blank rows, so short blank runs are skipped;
    an indicator statement continues past a blank row only while its sentence has not ended."""
    parts, blanks = [], 0
    for ln in lines[i + 1:i + 30]:
        cell = ln[max(0, col - 2):end] if end else ln[max(0, col - 2):]
        if CODE.search(cell) or re.search(r'^\s*(Examples?:|Example \d|Learning Outcomes|Content Standards|Subject\b)', cell): break
        if not cell.strip() or (left and len(cell) - len(cell.lstrip()) > 6):  # nothing in this column on this row
            blanks += 1
            if parts and ((not left and parts[-1].rstrip().endswith('.')) or blanks > 3): break
            continue
        if not left and blanks and parts and parts[-1].rstrip().endswith('.'): break
        seg = re.split(r'\s{2,}', cell.strip())[0] if left else cell.strip()  # left cells: drop a neighbouring column's words
        blanks = 0; parts.append(seg)
        if not left and parts[-1].endswith('.'): break
    t = ' '.join(parts)
    return re.sub(r'\s*(\d+\s*\|\s*' + SUBJ + r'|' + SUBJ + r'\s*\|\s*\d+).*$', '', t).strip()
from collections import Counter as _C
def lo_boundary(rows, col):
    """Where the neighbouring column really starts: the most common start of a second text block (after a 2+ space gap)."""
    starts = _C()
    for r in rows:
        if not r[col:col + 3].strip(): continue
        m = re.search(r'\S(\s{2,})\S', r[col:])
        if m and m.end() - 1 > 15: starts[col + m.end() - 1] += 1
    if not starts: return None
    common = [k for k, v in starts.items() if v >= 2]
    return (min(common) if common else min(starts)) - 1
els, seen, strands, subs = [], set(), {}, {}
hdr_lo = hdr_cs = -1
for pno, page in enumerate(pages, start=1):
    lines = page.split('\n')
    prev_lo, prev_cs = (hdr_lo, hdr_cs) if pno > 1 else (-1, -1)
    hdr_lo = next((ln.find('21st') for ln in lines if 'Learning Outcomes' in ln and '21st' in ln), -1)
    hdr_cs = next((ln.find('Learning Indicators') for ln in lines if 'Content Standards' in ln and 'Learning Indicators' in ln), -1)
    hdr_lo = hdr_lo if hdr_lo > 0 else prev_lo; hdr_cs = hdr_cs if hdr_cs > 0 else prev_cs  # continuation pages repeat no header
    for i, ln in enumerate(lines):
        for m in CODE.finditer(ln):
            y, s, ss, kind, n = m.groups()
            if kind == 'AS': continue
            col = m.start(); note = None
            if kind == 'LI':
                prev_as = [x for x in CODE.finditer(ln) if x.group(4) == 'AS' and x.start() < col]
                if prev_as:  # source anomaly: the PDF prints the LI code in the assessment column and the AS code in the indicator column
                    col = prev_as[0].start(); note = f'source prints {m.group(0)} in the assessment column (codes swapped on page {pno})'
            nxt = [x.start() for x in CODE.finditer(ln) if x.start() > col + 5]
            if nxt: end = nxt[0] - 1
            elif kind == 'LO': end = lo_boundary(lines[i + 1:i + 30], col) or (hdr_lo - 1 if hdr_lo > col else col + 38)
            elif kind == 'CS': end = hdr_cs - 1 if hdr_cs > col else col + 22
            else: end = None
            text = column_text(lines, i, col, end, kind in ('CS', 'LO'))
            if kind == 'LI':
                text = re.split(r'\s+(?=(?:Experiential Learning|Problem-based Learning|Group Work|Talk for Learning|Inquiry-based|Project-based|Think-Pair-Share)\b)', text)[0].strip()
                # Social Studies style: the indicator runs straight into a pedagogy heading ("Collaborative learning: ● ...", "Interactive map exploration: ...")
                text = re.split(r'\s+(?=[A-Z][A-Za-z&,\- ]{2,50}:\s*(?:\u25cf|[A-Z]))', text)[0].strip()
            if kind == 'LI' and len(text) < 8: continue
            els.append({'year': int(y), 'strand': int(s), 'subStrand': int(ss), 'kind': kind, 'n': int(n), 'code': m.group(0), 'page': pno,
                        'text': text, 'incomplete': not re.search(r'[.)\]]$', text), 'garbled': bool(GARBLED.search(text)), **({'sourceNote': note} if note else {})})
# Strand / sub-strand titles come from each sub-strand's header block ("Subject MATHEMATICS / Strand N. X / Sub-Strand N. Y";
# the value is on the label's line or the next one), attributed to the first coded element on or after that page.
def label_value(lines, j, label):
    rest = re.sub(r'^\s*' + label + r'\s*', '', lines[j]).strip()
    if not rest:
        rest = next((l.strip() for l in lines[j + 1:j + 3] if l.strip()), '')
    m = re.match(r'(\d)\.?\s+(.+)', rest)
    return (int(m.group(1)), re.sub(r'\s+', ' ', m.group(2)).strip()) if m else None
for pno, page in enumerate(pages, start=1):
    lines = page.split('\n')
    for j, ln in enumerate(lines):
        if re.match(r'^\s*Subject\s+' + SUBJ + r'\s*$', ln, re.I):
            st = next((label_value(lines, k, 'Strand') for k in range(j + 1, min(j + 4, len(lines))) if re.match(r'^\s*Strand\b', lines[k])), None)
            ss = next((label_value(lines, k, 'Sub-Strand') for k in range(j + 1, min(j + 6, len(lines))) if re.match(r'^\s*Sub-Strand\b', lines[k])), None)
            nx = next((e for e in els if e['page'] >= pno), None)
            if st and ss and nx and nx['strand'] == st[0] and nx['subStrand'] != ss[0] and (nx['year'], st[0], nx['subStrand']) not in subs:
                # source anomaly (e.g. English Y1 "Sub-Strand 3. SUMMARISING" whose codes are 1.2.2.*): the element codes win
                print(f'warning p.{pno}: header says sub-strand {ss[0]} "{ss[1]}" but its elements are coded {nx["code"]}; using the code', file=sys.stderr)
                ss = (nx['subStrand'], ss[1])
            if st and ss and nx and nx['strand'] == st[0] and nx['subStrand'] == ss[0]:
                strands.setdefault((nx['year'], st[0]), (st[1].title(), pno))
                subs.setdefault((nx['year'], st[0], ss[0]), (ss[1].title(), pno))
# Keep the first occurrence of each element (curriculum tables repeat codes on the outcome page and the indicator page);
# indicators restart numbering under each content standard, so their key includes the current CS.
res, cs_cur = [], {}
for e in els:
    k3 = (e['year'], e['strand'], e['subStrand'])
    if e['kind'] == 'CS': cs_cur[k3] = e['n']
    key = (e['kind'], e['code'], cs_cur.get(k3) if e['kind'] == 'LI' else None)
    if e['kind'] == 'LI':
        e['contentStandard'] = cs_cur.get(k3)
        firsts = [x for x in res if x['kind'] == 'LI' and (x['year'], x['strand'], x['subStrand']) == k3 and x.get('contentStandard') == e['contentStandard']]
        if not firsts and e['n'] != 1: e['sourceNote'] = (e.get('sourceNote', '') + f'; numbering under CS.{e["contentStandard"]} starts at LI.{e["n"]} in the source (no LI.1 printed)').lstrip('; ')
    if key in seen:
        if e['kind'] in ('CS', 'LO'): continue
        # an LI repeated with identical text under the same CS is a page-break repeat
        continue
    seen.add(key); res.append(e)
doc = {'source': pdf.rsplit('/', 1)[-1], 'pages': len(pages), 'strands': [{'year': k[0], 'strand': k[1], 'title': v[0], 'page': v[1]} for k, v in sorted(strands.items())],
       'subStrands': [{'year': k[0], 'strand': k[1], 'subStrand': k[2], 'title': v[0], 'page': v[1]} for k, v in sorted(subs.items())], 'elements': res}
json.dump(doc, open(out, 'w'), indent=1, ensure_ascii=False)
from collections import Counter
c = Counter((e['year'], e['kind']) for e in res); print({f'Y{y}{k}': v for (y, k), v in sorted(c.items())}, 'garbled', sum(e['garbled'] for e in res))
