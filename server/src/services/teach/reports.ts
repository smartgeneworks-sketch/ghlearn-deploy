import PDFDocument from 'pdfkit';

/** CSV cell escaping, including formula-injection guard (cells starting with = + - @ are prefixed with '). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : Array.isArray(v) ? v.join('; ') : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (header: string[], rows: unknown[][]) => '\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function classCsv(o: any) {
  return toCsv(['Student', 'Overall mastery %', 'Answers', 'Attempts', 'Recent avg %', 'Assignments completed', 'Overdue not submitted', 'Weak topics', 'Needs support', 'Reasons', 'Last active'],
    o.students.map((s: any) => [s.name, s.overall, s.answered, s.attempts, s.recentPct, s.completed, s.missed, s.weakTopics.map((w: any) => `${w.topic} (${w.pct}%)`), s.needsSupport ? 'yes' : 'no', s.reasons, s.lastActive]));
}
export function assignmentCsv(rows: any[]) {
  return toCsv(['Student', 'Status', 'Score', 'Max', 'Percent', 'Provisional', 'Submitted at', 'Revision topics'], rows.map((r) => [r.name, r.status, r.score, r.maxScore, r.pct, r.provisional ? 'yes' : 'no', r.submittedAt, r.revisionTopics]));
}

/** A4 class report PDF (built in memory; class reports are small). */
export function classPdf(o: any, meta: { subject?: string; school?: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Class report — ${o.class.name}`, Producer: 'GH Learn' } });
    const out: Buffer[] = []; doc.on('data', (b) => out.push(b)); doc.on('end', () => resolve(Buffer.concat(out))); doc.on('error', reject);
    const h = (t: string) => { doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor('#0f5132').text(t).moveDown(0.3).font('Helvetica').fontSize(10).fillColor('black'); };
    doc.font('Helvetica-Bold').fontSize(18).text(`Class report: ${o.class.name}`);
    doc.font('Helvetica').fontSize(10).fillColor('#444').text([meta.school, meta.subject, o.class.yearOfStudy ? `Year ${o.class.yearOfStudy}` : null, `Generated ${new Date().toUTCString()}`].filter(Boolean).join('  ·  ')).fillColor('black');
    h('Summary');
    doc.text(`Students: ${o.summary.students}    Average mastery: ${o.summary.avgMastery ?? '—'}%    Needing support: ${o.summary.needingSupport}    Attempts: ${o.summary.attempts}    Awaiting marking: ${o.summary.pendingReview}`);
    h('Students');
    for (const s of o.students) {
      doc.font('Helvetica-Bold').text(`${s.name}${s.needsSupport ? '  — needs support' : ''}`, { continued: false }).font('Helvetica')
        .text(`Mastery ${s.overall ?? '—'}% · ${s.attempts} attempts · recent ${s.recentPct ?? '—'}% · ${s.completed} assignments done${s.weakTopics.length ? ` · weak: ${s.weakTopics.map((w: any) => w.topic).join(', ')}` : ''}`);
      if (s.reasons.length) doc.fillColor('#842029').text(s.reasons.join('; ')).fillColor('black');
      doc.moveDown(0.25);
    }
    h('Performance by topic');
    if (!o.topics.length) doc.text('No topic data yet.');
    for (const t of o.topics) doc.text(`${t.topic}: ${t.avgPct}% average (${t.students} students, ${t.struggling} below 60%)`);
    h('Common misconceptions');
    if (!o.misconceptions.length) doc.text('None detected (needs at least 2 responses with 40%+ wrong).');
    for (const m of o.misconceptions) {
      doc.font('Helvetica-Bold').text(`${m.wrongPct}% wrong (${m.wrong}/${m.responses}) · ${m.topic}`).font('Helvetica').text(m.stem);
      if (m.commonWrongAnswers.length) doc.text(`Common wrong answers: ${m.commonWrongAnswers.map((a: any) => `"${a.answer}" ×${a.count}`).join(', ')}`);
      if (m.correctAnswer) doc.text(`Correct: ${m.correctAnswer}`); doc.moveDown(0.25);
    }
    h('Remedial recommendations');
    if (!o.remedial.length) doc.text('No topics below 60% yet.');
    for (const r of o.remedial) doc.text(`${r.topic} — ${r.students} student(s) (${r.names.join(', ')}). ${r.suggestion}.`);
    h('Assignments');
    for (const a of o.assignments) doc.text(`${a.title}: ${a.submitted}/${a.outOf} submitted${a.avgPct != null ? `, average ${a.avgPct}%` : ''}${a.closesAt ? `, due ${new Date(a.closesAt).toDateString()}` : ''}${a.pendingReview ? `, ${a.pendingReview} awaiting marking` : ''}`);
    doc.moveDown().fontSize(8).fillColor('#666').text(o.method);
    doc.end();
  });
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Minimal, safe markdown: escape first, then headings, bold, italics, lists, paragraphs. */
export function mdToHtml(md: string) {
  const lines = esc(md).split(/\r?\n/); const out: string[] = []; let list: string | null = null;
  const inline = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<em>$2</em>');
  for (const l of lines) {
    const m = l.match(/^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/); const tag = m ? (m[1] ? 'ul' : 'ol') : null;
    if (list && tag !== list) { out.push(`</${list}>`); list = null; }
    if (m) { if (!list) { out.push(`<${tag}>`); list = tag; } out.push(`<li>${inline(m[3])}</li>`); continue; }
    const hm = l.match(/^(#{1,4})\s+(.*)$/); if (hm) { out.push(`<h${hm[1].length + 2}>${inline(hm[2])}</h${hm[1].length + 2}>`); continue; }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  if (list) out.push(`</${list}>`); return out.join('\n');
}
/** Structured section data rendered generically; only server-rendered diagram SVG (key "svg") is embedded unescaped. */
function dataHtml(v: unknown, key = '', depth = 0): string {
  if (v == null || depth > 6) return '';
  if (key === 'svg' && typeof v === 'string' && v.startsWith('<svg')) return `<figure>${v}</figure>`;
  if (['spec', 'error', 'origin'].includes(key)) return '';
  if (typeof v !== 'object') return `<span>${esc(v)}</span>`;
  if (Array.isArray(v)) return v.length ? `<ul>${v.map((x) => `<li>${dataHtml(x, '', depth + 1)}</li>`).join('')}</ul>` : '';
  return `<dl>${Object.entries(v as any).map(([k, x]) => { const inner = dataHtml(x, k, depth + 1); return inner ? (k === 'svg' ? inner : `<dt>${esc(k.replace(/([A-Z])/g, ' $1'))}</dt><dd>${inner}</dd>`) : ''; }).join('')}</dl>`;
}
export function offlineHtml(subject: { name: string; code?: string }, c: { lessons: any[]; resources: any[] }) {
  const lessonHtml = (l: any) => `<article id="l-${l._id}"><h2>${esc(l.title)}</h2><p class="meta">${esc([l.strand, l.subStrand, l.topic].filter(Boolean).join(' › '))}</p>${(l.sections ?? []).map((s: any) =>
    `<section><h3>${esc(s.key)}. ${esc(s.title)}</h3>${s.sourceSupport && s.sourceSupport !== 'source' ? `<p class="badge">Includes general knowledge (${esc(s.sourceSupport)})</p>` : ''}${s.content ? mdToHtml(s.content) : ''}${s.data ? dataHtml(s.data) : ''}</section>`).join('')}</article>`;
  const resHtml = (r: any) => `<article id="r-${r._id}"><h2>${esc(r.title)}</h2><p class="meta">${esc(r.kind)} ${esc(r.topic ?? '')}</p>${typeof r.body === 'string' ? mdToHtml(r.body) : typeof r.body?.markdown === 'string' ? mdToHtml(r.body.markdown) : dataHtml(r.body)}</article>`;
  const all = [...c.lessons.map((l) => ({ id: `l-${l._id}`, t: l.title })), ...c.resources.map((r) => ({ id: `r-${r._id}`, t: r.title }))];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${esc(subject.name)} — offline pack</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:46rem;margin:auto;padding:1rem;color:#111}h2{border-top:2px solid #0f5132;padding-top:1rem;color:#0f5132}.meta{color:#555;font-size:.9em}.badge{background:#fff3cd;padding:.2rem .5rem;display:inline-block;font-size:.85em}figure svg{max-width:100%;height:auto}dt{font-weight:600;text-transform:capitalize}dd{margin:0 0 .4rem 1rem}@media print{h2{page-break-before:always}}</style></head>
<body><header><h1>${esc(subject.name)}${subject.code ? ` (${esc(subject.code)})` : ''}</h1><p>Approved, published materials downloaded ${esc(new Date().toUTCString())}. Works without internet. Check the platform for updates.</p>
<nav aria-label="Contents"><ol>${all.map((a) => `<li><a href="#${a.id}">${esc(a.t)}</a></li>`).join('')}</ol></nav></header><main>${c.lessons.map(lessonHtml).join('')}${c.resources.map(resHtml).join('')}${all.length ? '' : '<p>No published materials yet.</p>'}</main></body></html>`;
}
