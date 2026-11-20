/**
 * Code-drawn Social Studies figures (accessible inline SVG) from small structured specs: dated timelines of historical
 * events, concept maps, cause-and-effect diagrams, organisational charts (e.g. arms of government), comparison tables,
 * location tables, and a labelled road-crossing scene (road safety). Cycles, process steps and Venn diagrams reuse the
 * science and English kinds. Maps are deliberately NOT drawn: a schematic map cannot be checked for accuracy here, so
 * places are shown in a labelled location table instead. Every label, date and number is checked against the notes and
 * the learner manual in validateModule (socialFigureText): figures never introduce facts, dates or statistics.
 */
import { svgFrame } from './figures.js';
type P = [number, number];
const esc = (s: unknown, n = 120) => String(s ?? '').slice(0, n).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const f = (n: number) => Math.round(n * 10) / 10;
const INK = '#0f172a', LINE = '#0f766e', FILL = '#f0fdfa', MUTED = '#475569', EDGE = '#334155';
const T = (x: number, y: number, s: unknown, o: { size?: number; anchor?: string; fill?: string; bold?: boolean } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${o.anchor ?? 'middle'}" dominant-baseline="middle" font-size="${o.size ?? 15}" fill="${o.fill ?? INK}"${o.bold ? ' font-weight="bold"' : ''}>${esc(s)}</text>`;
const R = (x: number, y: number, w: number, h: number, fill = FILL, stroke = LINE, rx = 8) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
const L = (a: P, b: P, color = EDGE, w = 2) => `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
const DEF = `<defs><marker id="ssa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${EDGE}"/></marker></defs>`;
const A = (a: P, b: P) => `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${EDGE}" stroke-width="2" marker-end="url(#ssa)"/>`;
/** Word wrap that never silently cuts text: a label longer than `max` lines ends with "…". */
const wrap = (s: string, n: number, max = 3) => { const out: string[] = []; let l = ''; for (const x of String(s).split(/\s+/)) { if ((l + ' ' + x).trim().length > n && l) { out.push(l); l = x; } else l = (l + ' ' + x).trim(); } if (l) out.push(l); if (out.length <= max) return out; const k = out.slice(0, max); k[max - 1] = `${k[max - 1].replace(/[\s,;:.]+$/, '')}…`; return k; };
const lines = (x: number, y: number, ls: string[], o: { size?: number; anchor?: string; fill?: string; bold?: boolean; gap?: number } = {}) => ls.map((l, i) => T(x, y + i * (o.gap ?? 17), l, o)).join('');
const str = (v: any, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const item = (v: any, n = 60, d = 160) => v && str(v.label, n) && (v.detail == null || v.detail === '' || str(v.detail, d));

/* ---------------- dated timeline ---------------- */
/** A year from a date label, for order checks: "1957", "6th March 1957", "c. 1500", "300 BC" (negative), "18th century" (1750). */
export function dateYear(s: unknown): number | null {
  const t = String(s ?? ''); const bc = /\bB\.?C\.?(E\.?)?\b/i.test(t);
  const c = t.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+century\b/i); if (c) { const y = (Number(c[1]) - 1) * 100 + 50; return bc ? -y : y; }
  const y = t.match(/\b(\d{3,4})s?\b/) ?? t.match(/\b(\d{1,4})\s*(?:BC|BCE|AD|CE)\b/i); if (!y) return null; return bc ? -Number(y[1]) : Number(y[1]);
}
export function validateHistoryTimeline(d: any): string | null {
  if (!Array.isArray(d.events) || d.events.length < 2 || d.events.length > 8) return 'history_timeline: 2-8 events, in order';
  for (const e of d.events) if (!item(e, 60, 160) || !str(e.date, 30)) return 'history_timeline: each event needs a date (as printed in the sources, up to 30 characters) and a label (detail optional)';
  const ys = d.events.map((e: any) => dateYear(e.date));
  for (let i = 1; i < ys.length; i++) if (ys[i] != null && ys[i - 1] != null && ys[i]! < ys[i - 1]!) return `history_timeline: events must be in date order ("${d.events[i].date}" comes before "${d.events[i - 1].date}")`;
  return null;
}
function renderHistoryTimeline(d: any) {
  const W = 720, x = 190; let y = 70, out = '';
  const rows = d.events.map((e: any) => ({ e, ls: e.detail ? wrap(e.detail, 54, 3) : [], ds: wrap(e.date, 18, 2), lb: wrap(e.label, 44, 2) }));
  const ys = rows.map((r: any) => { const yy = y; y += 30 + Math.max(r.ds.length * 17, r.lb.length * 19 + r.ls.length * 17) + 12; return yy; });
  out += L([x, ys[0] - 14], [x, ys[ys.length - 1] + 10], LINE, 4);
  rows.forEach((r: any, i: number) => { const yy = ys[i];
    out += `<circle cx="${x}" cy="${f(yy)}" r="9" fill="${LINE}" stroke="#fff" stroke-width="2"/>` + lines(x - 20, yy, r.ds, { anchor: 'end', bold: true, size: 14, fill: LINE }) +
      lines(x + 22, yy, r.lb, { anchor: 'start', bold: true, gap: 19 }) + lines(x + 22, yy + r.lb.length * 19 + 4, r.ls, { anchor: 'start', size: 13, fill: MUTED }); });
  return svgFrame(W, y + 6, d.title ?? 'Timeline', out);
}

/* ---------------- concept map ---------------- */
export function validateConceptmap(d: any): string | null {
  if (!str(d.centre, 50)) return 'conceptmap: centre (the main idea, up to 50 characters) is required';
  if (!Array.isArray(d.branches) || d.branches.length < 2 || d.branches.length > 8 || !d.branches.every((b: any) => item(b, 40, 110))) return 'conceptmap: 2-8 branches, each {label (up to 40 characters), detail? (up to 110)}';
  return null;
}
function renderConceptmap(d: any) {
  const W = 760, n = d.branches.length, H = n > 6 ? 600 : 540, cx = W / 2, cy = H / 2 + 14, rx = 262, ry = n > 6 ? 205 : 180, bw = 196;
  let out = '';
  const pos = d.branches.map((_: any, i: number) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as P; });
  pos.forEach((p: P) => { out += L([cx, cy], p, '#94a3b8', 2); });
  const cl = wrap(d.centre, 18, 3); out += `<ellipse cx="${cx}" cy="${f(cy)}" rx="96" ry="${f(26 + cl.length * 10)}" fill="${LINE}"/>` + lines(cx, cy - (cl.length - 1) * 9, cl, { bold: true, fill: '#fff', gap: 18 });
  d.branches.forEach((b: any, i: number) => { const [x, y] = pos[i]; const lb = wrap(b.label, 22, 2), dt = b.detail ? wrap(b.detail, 28, 3) : []; const h = 18 + lb.length * 18 + dt.length * 15;
    out += R(x - bw / 2, y - h / 2, bw, h) + lines(x, y - h / 2 + 18, lb, { bold: true, size: 14, gap: 18 }) + lines(x, y - h / 2 + 18 + lb.length * 18, dt, { size: 12, fill: MUTED, gap: 15 }); });
  return svgFrame(W, H + 10, d.title ?? 'Concept map', out);
}

/* ---------------- cause and effect ---------------- */
export function validateCauseeffect(d: any): string | null {
  if (!str(d.event, 60)) return 'causeeffect: event (the issue in the middle, up to 60 characters) is required';
  for (const k of ['causes', 'effects']) if (!Array.isArray(d[k]) || d[k].length < 1 || d[k].length > 5 || !d[k].every((c: any) => item(c, 50, 100))) return `causeeffect: ${k} must list 1-5 items, each {label (up to 50 characters), detail? (up to 100)}`;
  return null;
}
function renderCauseeffect(d: any) {
  const W = 860, bw = 230, rowH = (c: any) => 22 + wrap(c.label, 26, 2).length * 17 + (c.detail ? wrap(c.detail, 32, 3).length * 15 : 0);
  const col = (items: any[], x: number) => { let y = 0; return items.map((c) => { const h = rowH(c); const r = { c, x, y, h }; y += h + 14; return r; }); };
  const cs = col(d.causes, 20), es = col(d.effects, W - bw - 20); const H0 = Math.max(cs.reduce((a, r) => a + r.h + 14, 0), es.reduce((a, r) => a + r.h + 14, 0), 160);
  const top = 86, H = top + H0 + 20, mid = top + H0 / 2; let out = DEF;
  out += T(20 + bw / 2, 62, 'Causes', { bold: true, fill: '#b45309' }) + T(W - 20 - bw / 2, 62, 'Effects', { bold: true, fill: '#1d4ed8' });
  const ev = wrap(d.event, 18, 3), eh = 30 + ev.length * 19; out += R(W / 2 - 100, mid - eh / 2, 200, eh, LINE, LINE, 12) + lines(W / 2, mid - (ev.length - 1) * 9.5, ev, { bold: true, fill: '#fff', gap: 19 });
  const box = (r: any, fill: string, stroke: string) => { const y = top + r.y; const lb = wrap(r.c.label, 26, 2), dt = r.c.detail ? wrap(r.c.detail, 32, 3) : [];
    return R(r.x, y, bw, r.h, fill, stroke) + lines(r.x + bw / 2, y + 18, lb, { bold: true, size: 14 }) + lines(r.x + bw / 2, y + 18 + lb.length * 17, dt, { size: 12, fill: MUTED, gap: 15 }); };
  cs.forEach((r) => { out += box(r, '#fffbeb', '#b45309') + A([r.x + bw, top + r.y + r.h / 2], [W / 2 - 104, mid]); });
  es.forEach((r) => { out += box(r, '#eff6ff', '#1d4ed8') + A([W / 2 + 100, mid], [r.x - 4, top + r.y + r.h / 2]); });
  return svgFrame(W, H, d.title ?? 'Causes and effects', out);
}

/* ---------------- organisational chart ---------------- */
export function validateOrgchart(d: any): string | null {
  if (!item(d.root, 50, 100)) return 'orgchart: root {label (up to 50 characters), detail?} is required';
  if (!Array.isArray(d.children) || d.children.length < 2 || d.children.length > 5) return 'orgchart: 2-5 children under the root';
  for (const c of d.children) { if (!item(c, 40, 90)) return 'orgchart: each child needs a label (up to 40 characters; detail optional, up to 90)';
    if (c.children != null && (!Array.isArray(c.children) || c.children.length > 4 || !c.children.every((g: any) => item(g, 34, 0) || str(g, 34)))) return 'orgchart: up to 4 sub-units per child, each a label of up to 34 characters'; }
  return null;
}
function renderOrgchart(d: any) {
  const n = d.children.length, cw = 190, gap = 18, W = Math.max(640, n * (cw + gap) + 40), x0 = (W - (n * (cw + gap) - gap)) / 2;
  const rl = wrap(d.root.label, 28, 2), rd = d.root.detail ? wrap(d.root.detail, 40, 2) : []; const rh = 24 + rl.length * 19 + rd.length * 15;
  let out = R(W / 2 - 150, 56, 300, rh, LINE, LINE, 10) + lines(W / 2, 56 + 20, rl, { bold: true, fill: '#fff', gap: 19 }) + lines(W / 2, 56 + 20 + rl.length * 19, rd, { size: 12, fill: '#ecfeff', gap: 15 });
  const yb = 56 + rh, ybar = yb + 24, yc = ybar + 22;
  const ch = d.children.map((c: any) => { const lb = wrap(c.label, 22, 2), dt = c.detail ? wrap(c.detail, 26, 3) : []; return { c, lb, dt, h: 22 + lb.length * 18 + dt.length * 15 }; });
  const hmax = Math.max(...ch.map((c: any) => c.h)); const cx = (i: number) => x0 + i * (cw + gap) + cw / 2;
  out += L([W / 2, yb], [W / 2, ybar]) + L([cx(0), ybar], [cx(n - 1), ybar]);
  let ymax = yc + hmax;
  ch.forEach((c: any, i: number) => { const x = cx(i); out += L([x, ybar], [x, yc]) + R(x - cw / 2, yc, cw, hmax) + lines(x, yc + 19, c.lb, { bold: true, size: 14 }) + lines(x, yc + 19 + c.lb.length * 18, c.dt, { size: 12, fill: MUTED, gap: 15 });
    const subs = (c.c.children ?? []).map((g: any) => (typeof g === 'string' ? g : g.label)); let y = yc + hmax + 16;
    subs.forEach((s: string) => { const sl = wrap(s, 22, 2); const h = 12 + sl.length * 16; out += L([x, y - 16], [x, y]) + R(x - cw / 2 + 14, y, cw - 28, h, '#fff', '#94a3b8', 6) + lines(x, y + 14, sl, { size: 12, gap: 16 }); y += h + 16; });
    ymax = Math.max(ymax, y); });
  return svgFrame(W, ymax + 12, d.title ?? 'Organisational chart', out);
}

/* ---------------- comparison table and location table ---------------- */
export function validateComparison(d: any): string | null {
  if (!Array.isArray(d.columns) || d.columns.length < 2 || d.columns.length > 4 || !d.columns.every((c: any) => str(c, 36))) return 'comparison: 2-4 column headings (the things compared, up to 36 characters each)';
  if (!Array.isArray(d.rows) || d.rows.length < 1 || d.rows.length > 8) return 'comparison: 1-8 rows';
  for (const r of d.rows) if (!str(r?.aspect, 40) || !Array.isArray(r.values) || r.values.length !== d.columns.length || !r.values.every((v: any) => str(v, 90))) return 'comparison: each row is {aspect (up to 40 characters), values: one entry (up to 90 characters) per column}';
  return null;
}
function table(title: string, head: string[], rows: string[][], firstBold: boolean) {
  const W = 760, c0 = firstBold ? 160 : 0, cw = (W - 40 - c0) / (head.length - (firstBold ? 1 : 0)); const xs = head.map((_, i) => (firstBold ? (i === 0 ? 20 : 20 + c0 + (i - 1) * cw) : 20 + i * cw));
  const ws = head.map((_, i) => (firstBold && i === 0 ? c0 : cw)); const chars = (w: number) => Math.max(10, Math.floor(w / 7.4));
  let y = 52, out = '';
  const hl = head.map((h, i) => wrap(h, chars(ws[i]), 2)); const hh = 16 + Math.max(...hl.map((l) => l.length)) * 17;
  head.forEach((_, i) => { out += `<rect x="${f(xs[i])}" y="${y}" width="${f(ws[i])}" height="${hh}" fill="${LINE}" stroke="#fff"/>` + lines(xs[i] + ws[i] / 2, y + 16, hl[i], { bold: true, fill: '#fff', size: 14 }); }); y += hh;
  rows.forEach((r, j) => { const ls = r.map((v, i) => wrap(v, chars(ws[i]), 4)); const h = 14 + Math.max(...ls.map((l) => l.length)) * 16;
    r.forEach((_, i) => { out += `<rect x="${f(xs[i])}" y="${f(y)}" width="${f(ws[i])}" height="${f(h)}" fill="${j % 2 ? '#f8fafc' : '#fff'}" stroke="#cbd5e1"/>` + lines(xs[i] + ws[i] / 2, y + 15, ls[i], { size: 13, gap: 16, bold: firstBold && i === 0 }); }); y += h; });
  return svgFrame(W, y + 14, title, out);
}
function renderComparison(d: any) { return table(d.title ?? 'Comparison', [typeof d.aspectHeading === 'string' ? d.aspectHeading : '', ...d.columns], d.rows.map((r: any) => [r.aspect, ...r.values]), true); }
export function validateLocationtable(d: any): string | null {
  if (!Array.isArray(d.columns) || d.columns.length < 2 || d.columns.length > 4 || !d.columns.every((c: any) => str(c, 44))) return 'locationtable: 2-4 column headings (up to 44 characters), e.g. ["Feature", "Type", "Where it is"]';
  if (!Array.isArray(d.rows) || d.rows.length < 2 || d.rows.length > 10 || !d.rows.every((r: any) => Array.isArray(r) && r.length === d.columns.length && r.every((v: any) => str(v, 100)))) return 'locationtable: 2-10 rows, one entry (up to 100 characters) per column';
  return null;
}
function renderLocationtable(d: any) { return table(d.title ?? 'Places and features', d.columns, d.rows, false); }

/* ---------------- labelled scene: road crossing ---------------- */
/** Parts drawn on the road-crossing scene, with where the leader line points. Only these can be labelled. */
export const SCENES: Record<string, Record<string, P>> = {
  'road crossing': { 'zebra crossing': [330, 300], 'pedestrian crossing': [330, 300], 'traffic light': [522, 170], 'traffic lights': [522, 170], pedestrian: [256, 234], 'road sign': [150, 168], 'traffic sign': [150, 168],
    pavement: [120, 236], sidewalk: [120, 236], 'kerb': [200, 252], curb: [200, 252], 'centre line': [470, 312], 'road markings': [470, 312], vehicle: [600, 290], car: [600, 290], road: [470, 350], 'speed ramp': [210, 330], 'speed bump': [210, 330], 'stop line': [272, 270] },
};
const SCENE_ALIAS: Record<string, string> = { 'zebra crossings': 'zebra crossing', pedestrians: 'pedestrian', 'road signs': 'road sign', 'traffic signs': 'traffic sign', vehicles: 'vehicle', cars: 'car', 'center line': 'centre line', 'road marking': 'road markings', 'speed humps': 'speed bump', 'speed hump': 'speed bump', 'speed ramps': 'speed ramp', 'footpath': 'pavement', 'stop lines': 'stop line' };
const sk = (s: unknown) => { const k = String(s ?? '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim(); return SCENE_ALIAS[k] ?? k; };
export function validateScene(d: any): string | null {
  const s = sk(d.setting); if (!SCENES[s]) return `scene: setting must be one of ${Object.keys(SCENES).join(', ')} (other places are not drawn; use a process, concept map or table instead)`;
  if (!Array.isArray(d.parts) || d.parts.length < 2 || d.parts.length > 8) return 'scene: 2-8 labelled parts';
  const bad = d.parts.filter((p: any) => !str(p?.name, 30) || !SCENES[s][sk(p.name)]).map((p: any) => p?.name);
  if (bad.length) return `scene: ${bad.join(', ')} ${bad.length > 1 ? 'are' : 'is'} not drawn on the ${s} (use ${Object.keys(SCENES[s]).join(', ')})`;
  if (d.parts.some((p: any) => p.note != null && !str(p.note, 90))) return 'scene: notes up to 90 characters';
  return null;
}
function renderScene(d: any) {
  const W = 760, H = 420, s = sk(d.setting);
  let out = `<rect x="0" y="200" width="${W}" height="40" fill="#e5e7eb"/><rect x="0" y="240" width="${W}" height="4" fill="#9ca3af"/><rect x="0" y="244" width="${W}" height="140" fill="#4b5563"/>` +
    `<rect x="270" y="250" width="5" height="128" fill="#f9fafb"/>` + Array.from({ length: 7 }, (_, i) => `<rect x="${290 + i * 12}" y="250" width="7" height="128" fill="#f9fafb"/>`).join('') +
    Array.from({ length: 6 }, (_, i) => `<rect x="${400 + i * 60}" y="310" width="34" height="5" fill="#facc15"/>`).join('') + `<rect x="20" y="310" width="240" height="5" fill="#facc15"/>` +
    `<path d="M180 326 q30 -14 60 0 z" fill="#fbbf24" stroke="#92400e"/>` +
    `<line x1="150" y1="200" x2="150" y2="150" stroke="#475569" stroke-width="4"/><path d="M150 126 L172 164 L128 164 Z" fill="#fff" stroke="#dc2626" stroke-width="4"/><circle cx="150" cy="152" r="4" fill="#0f172a"/>` +
    `<line x1="540" y1="238" x2="540" y2="150" stroke="#475569" stroke-width="5"/><rect x="522" y="112" width="36" height="84" rx="6" fill="#1f2937"/>` + [['#ef4444', 128], ['#facc15', 154], ['#22c55e', 180]].map(([c, y]) => `<circle cx="540" cy="${y}" r="9" fill="${c}"/>`).join('') +
    `<circle cx="256" cy="186" r="9" fill="#92400e"/><line x1="256" y1="195" x2="256" y2="222" stroke="#0f172a" stroke-width="4"/><line x1="256" y1="203" x2="244" y2="214" stroke="#0f172a" stroke-width="3"/><line x1="256" y1="203" x2="268" y2="212" stroke="#0f172a" stroke-width="3"/><line x1="256" y1="222" x2="248" y2="238" stroke="#0f172a" stroke-width="3"/><line x1="256" y1="222" x2="264" y2="238" stroke="#0f172a" stroke-width="3"/>` +
    `<rect x="560" y="268" width="96" height="34" rx="8" fill="#2563eb"/><rect x="578" y="254" width="56" height="20" rx="6" fill="#93c5fd" stroke="#2563eb" stroke-width="2"/><circle cx="582" cy="304" r="9" fill="#111827"/><circle cx="636" cy="304" r="9" fill="#111827"/>`;
  // Labels above take the higher half of the anchors, labels below the lower half; each row runs left to right so leader lines do not cross.
  const parts = d.parts.map((p: any) => ({ p, at: SCENES[s][sk(p.name)] })).sort((a: any, b: any) => a.at[1] - b.at[1] || a.at[0] - b.at[0]);
  const byX = (a: any, b: any) => a.at[0] - b.at[0];
  const top = parts.slice(0, Math.ceil(parts.length / 2)).sort(byX), bottom = parts.slice(Math.ceil(parts.length / 2)).sort(byX);
  const place = (list: any[], y: number, up: boolean) => list.map((x: any, i: number) => { const lx = 70 + ((W - 140) * (i + 0.5)) / list.length; const nl = x.p.note ? wrap(x.p.note, 22, 2) : [];
    return L([lx, up ? y + 12 : y - 10], x.at, '#0f172a', 1.4) + `<circle cx="${x.at[0]}" cy="${x.at[1]}" r="3.5" fill="#0f172a"/>` + T(lx, up ? y - nl.length * 15 : y, x.p.name, { bold: true, size: 14 }) + lines(lx, up ? y - nl.length * 15 + 17 : y + 17, nl, { size: 12, fill: MUTED, gap: 15 }); }).join('');
  out += place(top, 74, true) + place(bottom, H - 4 + 0, false);
  return svgFrame(W, H + 40, d.title ?? 'Road crossing', out);
}

export const SOCIAL_FIGURES: Record<string, { validate: (d: any) => string | null; render: (d: any) => string }> = {
  history_timeline: { validate: validateHistoryTimeline, render: renderHistoryTimeline }, conceptmap: { validate: validateConceptmap, render: renderConceptmap },
  causeeffect: { validate: validateCauseeffect, render: renderCauseeffect }, orgchart: { validate: validateOrgchart, render: renderOrgchart },
  comparison: { validate: validateComparison, render: renderComparison }, locationtable: { validate: validateLocationtable, render: renderLocationtable }, scene: { validate: validateScene, render: renderScene },
};
/** Kinds from other subjects that also count as Social Studies figures. */
export const SOCIAL_SHARED = ['cyclediagram', 'process', 'venn', 'datatable'];
/**
 * Text a figure shows, for grounding: short labels (names, places, titles: up to 3 words) are checked strictly, longer
 * descriptions as a warning, and every number (years, amounts, statistics) strictly.
 */
export function socialFigureText(d: any): { terms: string[]; phrases: string[]; numbers: number[] } {
  const all: string[] = []; const k = d?.kind; const it = (x: any) => (typeof x === 'string' ? [x] : [x?.label, x?.detail]);
  if (k === 'history_timeline') for (const e of d.events ?? []) all.push(e.date, e.label, e.detail);
  if (k === 'conceptmap') { all.push(d.centre); for (const b of d.branches ?? []) all.push(...it(b)); }
  if (k === 'causeeffect') { all.push(d.event); for (const c of [...(d.causes ?? []), ...(d.effects ?? [])]) all.push(...it(c)); }
  if (k === 'orgchart') { all.push(...it(d.root)); for (const c of d.children ?? []) { all.push(...it(c)); for (const g of c.children ?? []) all.push(...it(g)); } }
  if (k === 'comparison') { all.push(...(d.columns ?? [])); for (const r of d.rows ?? []) all.push(r.aspect, ...(r.values ?? [])); }
  if (k === 'locationtable') { all.push(...(d.columns ?? [])); for (const r of d.rows ?? []) all.push(...(r ?? [])); }
  if (k === 'scene') for (const p of d.parts ?? []) all.push(p.note);
  if (k === 'venn') all.push(d.left, d.right, ...(d.leftItems ?? []), ...(d.rightItems ?? []), ...(d.both ?? []));
  const xs = all.filter((x) => typeof x === 'string' && x.trim()).map(String);
  const numbers = xs.flatMap((x) => (x.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ''))));
  return { terms: xs.filter((x) => x.trim().split(/\s+/).length <= 3), phrases: xs.filter((x) => x.trim().split(/\s+/).length > 3), numbers };
}
export function describeSocial(d: any): string {
  const t = d?.title ? `${d.title}: ` : ''; const lb = (x: any) => (typeof x === 'string' ? x : `${x.label}${x.detail ? ` (${x.detail})` : ''}`);
  switch (d?.kind) {
    case 'history_timeline': return `${t}timeline: ${(d.events ?? []).map((e: any) => `${e.date}, ${lb(e)}`).join('; ')}`;
    case 'conceptmap': return `${t}concept map with ${d.centre} in the centre, linked to ${(d.branches ?? []).map(lb).join('; ')}`;
    case 'causeeffect': return `${t}causes ${(d.causes ?? []).map(lb).join('; ')} lead to ${d.event}, with effects ${(d.effects ?? []).map(lb).join('; ')}`;
    case 'orgchart': return `${t}${lb(d.root)} at the top, divided into ${(d.children ?? []).map((c: any) => `${lb(c)}${c.children?.length ? `, which includes ${c.children.map(lb).join(', ')}` : ''}`).join('; ')}`;
    case 'comparison': return `${t}comparison of ${(d.columns ?? []).join(' and ')}: ${(d.rows ?? []).map((r: any) => `${r.aspect}: ${(r.values ?? []).map((v: string, i: number) => `${d.columns[i]}, ${v}`).join('; ')}`).join('. ')}`;
    case 'locationtable': return `${t}table with columns ${(d.columns ?? []).join(', ')}: ${(d.rows ?? []).map((r: string[]) => r.join(', ')).join('; ')}`;
    case 'scene': return `${t}drawing of a ${d.setting} labelled ${(d.parts ?? []).map((p: any) => `${p.name}${p.note ? ` (${p.note})` : ''}`).join(', ')}`;
  }
  return '';
}

/** Repairs common, meaning-preserving shape slips before validation (no content is added or changed):
 *  a comparison whose first column heading names the aspects (columns = values + 1), or rows given as plain arrays. */
export function normalizeSocial(spec: any): any {
  if (!spec || typeof spec !== 'object' || spec.kind !== 'comparison' || !Array.isArray(spec.columns) || !Array.isArray(spec.rows)) return spec;
  let rows = spec.rows.map((r: any) => (Array.isArray(r) && r.length >= 2 ? { aspect: r[0], values: r.slice(1) } : r));
  let s = { ...spec, rows };
  if (rows.length && rows.every((r: any) => Array.isArray(r?.values) && r.values.length === spec.columns.length - 1) && spec.columns.length >= 3) s = { ...s, aspectHeading: spec.columns[0], columns: spec.columns.slice(1) };
  return s;
}
