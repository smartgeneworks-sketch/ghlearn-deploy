/**
 * Code-drawn English Language figures (accessible inline SVG) from small structured specs: sentence structure
 * (parts of speech / subject-predicate), word map, timeline, story (plot) map, dialogue scene, speech-sound chart and
 * Venn comparison. Like the maths figures, the model only supplies JSON; every label is escaped and each kind has a
 * validator. Text shown on a figure is checked against the lesson and the learner manual in validateModule
 * (englishFigureText), so a figure never introduces sentences or dialogue that are not in the notes or the LM.
 */
import { svgFrame } from './figures.js';
type P = [number, number];
const esc = (s: unknown, n = 90) => String(s ?? '').slice(0, n).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const f = (n: number) => Math.round(n * 10) / 10;
const INK = '#0f172a', LINE = '#047857', FILL = '#ecfdf5', MUTED = '#475569';
const T = (x: number, y: number, s: unknown, o: { size?: number; anchor?: string; fill?: string; bold?: boolean; italic?: boolean } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${o.anchor ?? 'middle'}" dominant-baseline="middle" font-size="${o.size ?? 15}" fill="${o.fill ?? INK}"${o.bold ? ' font-weight="bold"' : ''}${o.italic ? ' font-style="italic"' : ''}>${esc(s)}</text>`;
const R = (x: number, y: number, w: number, h: number, fill = FILL, stroke = LINE, rx = 8) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
const L = (a: P, b: P, color = '#94a3b8', w = 2) => `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
const wrap = (s: string, n: number, max = 4) => { const out: string[] = []; let l = ''; for (const x of String(s).split(/\s+/)) { if ((l + ' ' + x).trim().length > n && l) { out.push(l); l = x; } else l = (l + ' ' + x).trim(); } if (l) out.push(l); return out.slice(0, max); };
const lines = (x: number, y: number, ls: string[], o: { size?: number; anchor?: string; fill?: string; bold?: boolean; italic?: boolean; gap?: number } = {}) => ls.map((l, i) => T(x, y + i * (o.gap ?? 18), l, o)).join('');
const str = (v: any, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const strs = (v: any, min: number, max: number, len = 200) => Array.isArray(v) && v.length >= min && v.length <= max && v.every((x) => str(x, len));
/** Lower-case words only, for comparing text regardless of punctuation and spacing. */
export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------------- sentence structure ---------------- */
export const ROLES: Record<string, string> = { subject: '#1d4ed8', predicate: '#047857', verb: '#b91c1c', auxiliary: '#dc2626', object: '#7c3aed', complement: '#a16207', adjunct: '#0e7490', appositive: '#be185d',
  noun: '#1d4ed8', pronoun: '#4338ca', adjective: '#a16207', adverb: '#0e7490', preposition: '#475569', conjunction: '#9333ea', determiner: '#0f766e', interjection: '#c2410c', article: '#0f766e' };
export function validateSentence(d: any): string | null {
  if (!str(d.sentence, 220)) return 'sentence: the sentence (up to 220 characters) is required';
  if (!Array.isArray(d.parts) || d.parts.length < 2 || d.parts.length > 12) return 'sentence: parts must list 2-12 consecutive parts';
  for (const p of d.parts) { if (!str(p?.text, 120)) return 'sentence: each part needs its text'; if (!ROLES[String(p.role ?? '').toLowerCase()]) return `sentence: unknown role "${p?.role}" (use ${Object.keys(ROLES).join(', ')})`; }
  if (norm(d.parts.map((p: any) => p.text).join(' ')) !== norm(d.sentence)) return 'sentence: the parts, read in order, must make up exactly the sentence';
  if (d.groups != null) { if (!Array.isArray(d.groups) || d.groups.length > 4) return 'sentence: at most 4 groups';
    let last = -1; for (const g of d.groups) { const a = g?.from, b = g?.to; if (!str(g?.label, 30) || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a || b >= d.parts.length || a <= last) return 'sentence: each group needs a label and a part range from..to (0-based, in order, not overlapping)'; last = b; } }
  return null;
}
function renderSentence(d: any) {
  const W = 680, pad = 20, gap = 10, cw = 8.6; const boxes: { x: number; y: number; w: number; p: any }[] = []; let x = pad, y = d.groups?.length ? 92 : 62;
  for (const p of d.parts) { const w = Math.max(96, String(p.text).slice(0, 60).length * cw + 22); if (x + w > W - pad && x > pad) { x = pad; y += 104; } boxes.push({ x, y, w: Math.min(w, W - 2 * pad), p }); x += w + gap; }
  let out = '';
  for (const g of d.groups ?? []) { const a = boxes[g.from], b = boxes[g.to]; if (a.y === b.y) { out += `<path d="M${f(a.x)} ${f(a.y - 8)} V${f(a.y - 16)} H${f(b.x + b.w)} V${f(b.y - 8)}" fill="none" stroke="${INK}" stroke-width="1.6"/>` + T((a.x + b.x + b.w) / 2, a.y - 28, g.label, { size: 14, bold: true }); }
    else out += T(a.x + 4, a.y - 20, `${g.label} →`, { size: 13, bold: true, anchor: 'start' }); }
  for (const { x: bx, y: by, w, p } of boxes) { const c = ROLES[String(p.role).toLowerCase()];
    out += R(bx, by, w, 40, '#fff', c) + T(bx + w / 2, by + 20, String(p.text).slice(0, 60), { size: 15 }) + L([bx + w / 2, by + 42], [bx + w / 2, by + 56], c) + `<rect x="${f(bx + w / 2 - Math.min(100, w) / 2)}" y="${f(by + 58)}" width="${f(Math.min(100, w))}" height="22" rx="11" fill="${c}"/>` + T(bx + w / 2, by + 69, String(p.role).toLowerCase(), { size: w < 90 ? 11 : 12, fill: '#fff', bold: true }); }
  return svgFrame(W, y + 110, d.title ?? 'Sentence structure', out);
}

/* ---------------- word map (graphic organiser) ---------------- */
export function validateWordmap(d: any): string | null {
  if (!str(d.word, 40)) return 'wordmap: the central word or idea is required';
  if (!Array.isArray(d.branches) || d.branches.length < 2 || d.branches.length > 6) return 'wordmap: 2-6 branches';
  for (const b of d.branches) if (!str(b?.label, 30) || !strs(b?.items, 1, 4, 60)) return 'wordmap: each branch needs a label and 1-4 short items';
  return null;
}
function renderWordmap(d: any) {
  const n = d.branches.length, cols = n <= 2 ? 2 : n <= 4 ? 2 : 3, W = cols === 3 ? 720 : 620, bw = (W - 40 - (cols - 1) * 16) / cols, rows = Math.ceil(n / cols);
  const top = 150, bh = 132; let out = R(W / 2 - 110, 46, 220, 56, '#d1fae5') + lines(W / 2, 74 - (wrap(d.word, 22, 2).length - 1) * 9, wrap(d.word, 22, 2), { bold: true, size: 17 });
  d.branches.forEach((b: any, i: number) => { const r = Math.floor(i / cols), c = i % cols, inRow = Math.min(cols, n - r * cols), x0 = (W - (inRow * bw + (inRow - 1) * 16)) / 2 + c * (bw + 16), y0 = top + r * (bh + 20);
    out += L([W / 2, 102], [x0 + bw / 2, y0], '#94a3b8', 1.6) + R(x0, y0, bw, bh, '#fff', LINE) + `<rect x="${f(x0)}" y="${f(y0)}" width="${f(bw)}" height="30" rx="8" fill="${LINE}"/>` + T(x0 + bw / 2, y0 + 15, b.label, { size: 14, bold: true, fill: '#fff' });
    let yy = y0 + 48; for (const it of b.items) { const ls = wrap(`• ${it}`, Math.floor(bw / 7.6), 2); out += lines(x0 + 10, yy, ls, { size: 13, anchor: 'start' }); yy += ls.length * 17 + 3; } });
  return svgFrame(W, top + rows * (bh + 20) + 10, d.title ?? 'Word map', out);
}

/* ---------------- timeline / sequence of events ---------------- */
export function validateTimeline(d: any): string | null {
  if (!Array.isArray(d.events) || d.events.length < 2 || d.events.length > 8) return 'timeline: 2-8 events';
  for (const e of d.events) if (!str(e?.label, 60) || (e.detail != null && !str(e.detail, 160))) return 'timeline: each event needs a label (detail optional, up to 160 characters)';
  return null;
}
function renderTimeline(d: any) {
  const W = 600, x = 70; let y = 60, out = '';
  const rows = d.events.map((e: any) => ({ e, ls: e.detail ? wrap(e.detail, 56, 3) : [] }));
  const ys = rows.map((r: any) => { const yy = y; y += 44 + r.ls.length * 18; return yy; });
  out += L([x, ys[0]], [x, ys[ys.length - 1]], LINE, 4);
  rows.forEach((r: any, i: number) => { const yy = ys[i]; out += `<circle cx="${x}" cy="${f(yy)}" r="14" fill="${LINE}"/>` + T(x, yy + 1, i + 1, { size: 13, bold: true, fill: '#fff' }) + T(x + 28, yy, r.e.label, { anchor: 'start', bold: true }) + lines(x + 28, yy + 22, r.ls, { anchor: 'start', size: 13, fill: MUTED }); });
  return svgFrame(W, y + 4, d.title ?? 'Timeline', out);
}

/* ---------------- story map (plot structure) ---------------- */
export const PLOT = ['exposition', 'rising action', 'climax', 'falling action', 'resolution'];
export function validatePlot(d: any): string | null {
  if (!Array.isArray(d.stages) || d.stages.length < 3 || d.stages.length > 5) return 'plot: 3-5 stages';
  let last = -1; for (const s of d.stages) { const k = PLOT.indexOf(String(s?.stage ?? '').toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim()); if (k < 0) return `plot: stage must be one of ${PLOT.join(', ')}`; if (k <= last) return 'plot: stages must be in story order, each once'; last = k; if (!str(s.text, 160)) return 'plot: each stage needs text (up to 160 characters)'; }
  return null;
}
function renderPlot(d: any) {
  const W = 720, H = 470; const base = 410, peak = 120; const xs = [70, 205, 360, 515, 650], ys = [base, base - 120, peak, base - 120, base];
  const st = d.stages.map((s: any) => ({ k: PLOT.indexOf(String(s.stage).toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim()), text: s.text }));
  let out = `<polyline points="${xs.map((x, i) => `${x},${ys[i]}`).join(' ')}" fill="none" stroke="#cbd5e1" stroke-width="4" stroke-linejoin="round"/>`;
  for (const s of st) { const x = xs[s.k], y = ys[s.k], ls = wrap(s.text, 19, 4), bh = 30 + ls.length * 16, by = s.k === 2 ? y - bh - 22 : y - bh - 26, bx = Math.min(W - 152, Math.max(8, x - 72));
    out += `<circle cx="${x}" cy="${y}" r="9" fill="${LINE}"/>` + R(bx, by, 144, bh, '#fff', LINE) + T(bx + 72, by + 15, PLOT[s.k].replace(/^./, (c) => c.toUpperCase()), { size: 13, bold: true, fill: LINE }) + lines(bx + 72, by + 34, ls, { size: 12, gap: 16 }); }
  return svgFrame(W, H, d.title ?? 'Story map', out);
}

/* ---------------- dialogue scene (labelled scene illustration) ---------------- */
export function validateDialogue(d: any): string | null {
  if (!str(d.setting, 80)) return 'dialogue: setting (where the conversation happens) is required';
  if (d.register != null && !['formal', 'informal'].includes(d.register)) return 'dialogue: register must be formal or informal';
  if (!Array.isArray(d.turns) || d.turns.length < 2 || d.turns.length > 6) return 'dialogue: 2-6 turns';
  for (const t of d.turns) if (!str(t?.speaker, 24) || !str(t?.line, 140)) return 'dialogue: each turn needs a speaker and a line (up to 140 characters)';
  const names = [...new Set(d.turns.map((t: any) => t.speaker))]; if (names.length < 2 || names.length > 3) return 'dialogue: 2-3 different speakers';
  return null;
}
const person = (x: number, y: number, c: string, name: string) => `<circle cx="${x}" cy="${y}" r="16" fill="#fde68a" stroke="${c}" stroke-width="2.5"/><path d="M${x - 22} ${y + 58} Q${x} ${y + 12} ${x + 22} ${y + 58} Z" fill="${c}"/>` + T(x, y + 74, name, { size: 13, bold: true, fill: c });
function renderDialogue(d: any) {
  const W = 640; const names = [...new Set<string>(d.turns.map((t: any) => t.speaker))]; const cols = ['#1d4ed8', '#b45309', '#7c3aed'];
  const px = names.length === 2 ? [70, W - 70] : [70, W - 70, 70]; let y = 92, out = T(W / 2, 54, `${d.setting}${d.register ? ` · ${d.register} register` : ''}`, { size: 13, fill: MUTED, italic: true });
  d.turns.forEach((t: any, i: number) => { const k = names.indexOf(t.speaker), left = px[k] < W / 2, ls = wrap(`“${t.line}”`, 46, 4), bh = 20 + ls.length * 18, bw = 400, bx = left ? 150 : W - 150 - bw;
    out += person(px[k], y + 10, cols[k], t.speaker) + R(bx, y, bw, bh, left ? '#eff6ff' : '#fffbeb', cols[k], 14) + `<path d="M${left ? bx : bx + bw} ${y + 16} L${left ? bx - 18 : bx + bw + 18} ${y + 22} L${left ? bx : bx + bw} ${y + 28}" fill="${left ? '#eff6ff' : '#fffbeb'}" stroke="${cols[k]}" stroke-width="2"/>` +
      lines(bx + 14, y + 20, ls, { anchor: 'start', size: 14 }); y += Math.max(bh, 92) + 14; });
  return svgFrame(W, y + 6, d.title ?? 'Conversation', out);
}

/* ---------------- speech-sound chart ---------------- */
export function validateSoundchart(d: any): string | null {
  if (!Array.isArray(d.sounds) || d.sounds.length < 1 || d.sounds.length > 12) return 'soundchart: 1-12 sounds';
  for (const s of d.sounds) { if (!str(s?.symbol, 8) || !/^\/?[^\s/]{1,6}\/?$/.test(s.symbol.trim())) return 'soundchart: each sound needs a phonetic symbol such as /ɪ/';
    if (!strs(s.examples, 1, 3, 24) || s.examples.some((w: string) => !/^[A-Za-z][A-Za-z' -]*$/.test(w.trim()))) return 'soundchart: each sound needs 1-3 example words (letters only)';
    if (s.label != null && !str(s.label, 30)) return 'soundchart: label up to 30 characters'; }
  return null;
}
function renderSoundchart(d: any) {
  const n = d.sounds.length, cols = Math.min(4, n), W = Math.max(420, cols * 160 + 40), cw = (W - 40 - (cols - 1) * 12) / cols, ch = 132; let out = '';
  d.sounds.forEach((s: any, i: number) => { const x = 20 + (i % cols) * (cw + 12), y = 52 + Math.floor(i / cols) * (ch + 12); const sym = `/${String(s.symbol).trim().replace(/^\/|\/$/g, '')}/`;
    out += R(x, y, cw, ch, '#fff', LINE) + T(x + cw / 2, y + 30, sym, { size: 26, bold: true, fill: LINE }) + (s.label ? T(x + cw / 2, y + 56, s.label, { size: 12, fill: MUTED }) : '') + lines(x + cw / 2, y + 80, s.examples.slice(0, 3), { size: 14, gap: 17 }); });
  return svgFrame(W, 52 + Math.ceil(n / cols) * (ch + 12) + 8, d.title ?? 'Speech sounds', out);
}

/* ---------------- Venn comparison ---------------- */
export function validateVenn(d: any): string | null {
  if (!str(d.left, 30) || !str(d.right, 30)) return 'venn: left and right labels are required';
  for (const k of ['leftItems', 'rightItems', 'both']) if (!(Array.isArray(d[k]) && d[k].length <= 5 && d[k].every((x: any) => str(x, 40)))) return `venn: ${k} must list 0-5 short items`;
  if (!d.leftItems.length && !d.rightItems.length && !d.both.length) return 'venn: at least one item';
  return null;
}
function renderVenn(d: any) {
  const W = 680, H = 400; let out = `<circle cx="250" cy="215" r="160" fill="#dbeafe" fill-opacity="0.7" stroke="#1d4ed8" stroke-width="2"/><circle cx="430" cy="215" r="160" fill="#fef3c7" fill-opacity="0.7" stroke="#b45309" stroke-width="2"/>`;
  out += T(190, 70, d.left, { bold: true, fill: '#1d4ed8' }) + T(490, 70, d.right, { bold: true, fill: '#b45309' }) + T(340, 70, 'Both', { bold: true, size: 13 });
  const col = (items: string[], x: number, n: number) => items.map((it, i) => lines(x, 140 + i * 46, wrap(it, n, 2), { size: 13, gap: 16 })).join('');
  out += col(d.leftItems, 180, 18) + col(d.both, 340, 12) + col(d.rightItems, 500, 18);
  return svgFrame(W, H, d.title ?? 'Comparison', out);
}

export const ENGLISH_FIGURES: Record<string, { validate: (d: any) => string | null; render: (d: any) => string }> = {
  sentence: { validate: validateSentence, render: renderSentence }, wordmap: { validate: validateWordmap, render: renderWordmap }, timeline: { validate: validateTimeline, render: renderTimeline },
  plot: { validate: validatePlot, render: renderPlot }, dialogue: { validate: validateDialogue, render: renderDialogue }, soundchart: { validate: validateSoundchart, render: renderSoundchart }, venn: { validate: validateVenn, render: renderVenn },
};
/** Text a figure presents as language data (example sentences, dialogue lines, example words), for grounding checks. */
export function englishFigureText(d: any): { sentences: string[]; words: string[] } {
  if (d?.kind === 'sentence') return { sentences: [d.sentence], words: [] };
  if (d?.kind === 'dialogue') return { sentences: (d.turns ?? []).map((t: any) => t.line), words: [] };
  if (d?.kind === 'soundchart') return { sentences: [], words: (d.sounds ?? []).flatMap((s: any) => s.examples ?? []) };
  return { sentences: [], words: [] };
}
/** Words worth a "listen" button: example words on a sound chart. */
export function figureSayables(d: any): string[] { return d?.kind === 'soundchart' ? (d.sounds ?? []).flatMap((s: any) => s.examples ?? []).slice(0, 36) : []; }
