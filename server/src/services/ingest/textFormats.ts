/** Text extraction for DOCX, TXT and CSV manuals. Output uses the same page records as PDFs (pageUnit says whether they are real pages or segments). */
import yauzl from 'yauzl';
import { parseCsv } from '../enrolmentImport.js';
import type { ExtractedPage } from './pdf.js';
export class FormatError extends Error {}
const SEGMENT = 3000;
const MAX_XML = 40 * 1024 * 1024;

/** Splits long text into ~3,000-character segments at paragraph or line boundaries. */
export function segment(text: string): string[] {
  const out: string[] = []; let cur = '';
  for (const para of text.split(/\n{2,}/)) {
    const p = para.trim(); if (!p) continue;
    if (cur && cur.length + p.length + 2 > SEGMENT) { out.push(cur); cur = ''; }
    if (p.length > SEGMENT) { for (let i = 0; i < p.length; i += SEGMENT) { if (cur) { out.push(cur); cur = ''; } out.push(p.slice(i, i + SEGMENT)); } continue; }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}
const pagesOf = (parts: { text: string; figures?: number }[]): ExtractedPage[] =>
  parts.map((p, i) => ({ page: i + 1, text: p.text, method: p.text.replace(/\s/g, '').length ? 'text' : 'empty', figures: p.figures ?? 0 }));

export function decodeUtf8(buf: Buffer): string {
  if (buf.subarray(0, 8192).includes(0)) throw new FormatError('The file contains binary data, not text');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, ''); } catch { throw new FormatError('The file is not valid UTF-8 text'); }
}
export function extractTxt(buf: Buffer): { pages: ExtractedPage[]; unit: 'page' | 'segment' } {
  const t = decodeUtf8(buf).replace(/\r\n?/g, '\n');
  if (t.includes('\f')) return { pages: pagesOf(t.split('\f').map((x) => ({ text: x.trim() }))), unit: 'page' };
  return { pages: pagesOf(segment(t).map((text) => ({ text }))), unit: 'segment' };
}
/** CSV: 50 rows per segment, each row as "header: value" pairs so the text stays meaningful when chunked. */
export function extractCsv(buf: Buffer): { pages: ExtractedPage[]; unit: 'segment'; rows: number } {
  const rows = parseCsv(decodeUtf8(buf)).filter((r) => r.some((c) => c.trim()));
  if (!rows.length) throw new FormatError('The CSV file is empty');
  const [head, ...body] = rows; const parts: { text: string }[] = [];
  for (let i = 0; i < Math.max(1, body.length); i += 50) parts.push({ text: body.slice(i, i + 50).map((r) => r.map((c, k) => `${head[k] || `Column ${k + 1}`}: ${c}`).join(' | ')).join('\n') || head.join(' | ') });
  return { pages: pagesOf(parts), unit: 'segment', rows: body.length };
}

const readZipEntry = (buf: Buffer, name: string): Promise<Buffer | null> => new Promise((ok, bad) => {
  yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
    if (err || !zip) return bad(new FormatError('The file is not a valid DOCX (zip) document'));
    let found = false;
    zip.on('entry', (e: any) => {
      if (e.fileName !== name) return zip.readEntry();
      found = true; if (e.uncompressedSize > MAX_XML) { zip.close(); return bad(new FormatError('The document text is too large to process')); }
      zip.openReadStream(e, (er, rs) => {
        if (er || !rs) return bad(new FormatError('The DOCX document could not be read'));
        const parts: Buffer[] = []; let n = 0;
        rs.on('data', (c: Buffer) => { n += c.length; if (n > MAX_XML) { rs.destroy(); bad(new FormatError('The document text is too large to process')); } else parts.push(c); });
        rs.on('end', () => { zip.close(); ok(Buffer.concat(parts)); }); rs.on('error', () => bad(new FormatError('The DOCX document could not be read')));
      });
    });
    zip.on('end', () => { if (!found) ok(null); }); zip.on('error', () => bad(new FormatError('The file is not a valid DOCX (zip) document')));
    zip.readEntry();
  });
});
const XML_ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENT[e] ?? m));
/** True when the zip holds a Word main document (used to validate uploads). */
export async function isDocx(buf: Buffer) { try { return !!(await readZipEntry(buf, 'word/document.xml')); } catch { return false; } }
/** DOCX: paragraphs from word/document.xml; Word's page breaks (explicit or last-rendered) split pages, otherwise segments. Drawings are counted as figures. */
export async function extractDocx(buf: Buffer): Promise<{ pages: ExtractedPage[]; unit: 'page' | 'segment' }> {
  const xml = (await readZipEntry(buf, 'word/document.xml'))?.toString('utf8');
  if (!xml) throw new FormatError('The file is not a Word document (word/document.xml is missing)');
  const tok = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*w:type="page"[^>]*\/>|<w:lastRenderedPageBreak\/>|<w:br\b[^>]*\/>|<w:cr\/>|<\/w:p>|<w:drawing\b|<w:pict\b/g;
  const pages: { text: string; figures: number }[] = []; let cur = ''; let figs = 0; let breaks = 0; let m: RegExpExecArray | null;
  const flush = () => { pages.push({ text: cur.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), figures: figs }); cur = ''; figs = 0; };
  while ((m = tok.exec(xml))) {
    const t = m[0];
    if (m[1] !== undefined) cur += unxml(m[1]);
    else if (t === '<w:tab/>') cur += '\t';
    else if (t.startsWith('<w:br') && t.includes('w:type="page"')) { breaks++; flush(); }
    else if (t === '<w:lastRenderedPageBreak/>') { if (cur.trim()) { breaks++; flush(); } }
    else if (t.startsWith('<w:br') || t === '<w:cr/>') cur += '\n';
    else if (t === '</w:p>') cur += '\n';
    else figs++;
  }
  flush();
  if (breaks) return { pages: pagesOf(pages.filter((p, i) => p.text || p.figures || i === 0)), unit: 'page' };
  // No page information: segment the text and spread figures by position is not possible, so they stay on the first segment that had them.
  const all = pages[0]; const segs = segment(all.text);
  return { pages: pagesOf((segs.length ? segs : ['']).map((text, i) => ({ text, figures: i === 0 ? all.figures : 0 }))), unit: 'segment' };
}
