/**
 * Code-drawn General Science figures (accessible inline SVG) from small structured specs: labelled structures
 * (animal cell, plant cell, flowering plant, apparatus, organ systems), circuit diagrams with standard symbols,
 * cycle diagrams (water cycle, life cycles), food chains and webs, process steps and experiment data (graph or table).
 * The model only supplies JSON; text is escaped and each kind has a validator. Known structures only accept parts that
 * really belong to them (no cell wall on an animal cell), circuits must have a source and meters connected correctly,
 * food-web arrows must point from food to feeder. Labels and data values are checked against the notes and the learner
 * manual in validateModule (scienceFigureText), so a figure never introduces terms or numbers that are not in the sources.
 */
import { svgFrame } from './figures.js';
type P = [number, number];
const esc = (s: unknown, n = 90) => String(s ?? '').slice(0, n).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const f = (n: number) => Math.round(n * 10) / 10;
const INK = '#0f172a', LINE = '#0369a1', FILL = '#f0f9ff', MUTED = '#475569', WIRE = '#1e293b';
const T = (x: number, y: number, s: unknown, o: { size?: number; anchor?: string; fill?: string; bold?: boolean; italic?: boolean } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${o.anchor ?? 'middle'}" dominant-baseline="middle" font-size="${o.size ?? 15}" fill="${o.fill ?? INK}"${o.bold ? ' font-weight="bold"' : ''}${o.italic ? ' font-style="italic"' : ''}>${esc(s)}</text>`;
const R = (x: number, y: number, w: number, h: number, fill = FILL, stroke = LINE, rx = 8) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
const L = (a: P, b: P, color = WIRE, w = 2) => `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
const ARROW_DEF = `<defs><marker id="sa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#334155"/></marker></defs>`;
const A = (a: P, b: P, color = '#334155') => `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${color}" stroke-width="2" marker-end="url(#sa)"/>`;
const wrap = (s: string, n: number, max = 4) => { const out: string[] = []; let l = ''; for (const x of String(s).split(/\s+/)) { if ((l + ' ' + x).trim().length > n && l) { out.push(l); l = x; } else l = (l + ' ' + x).trim(); } if (l) out.push(l); if (out.length <= max) return out; const k = out.slice(0, max); k[max - 1] = `${k[max - 1].replace(/[\s,;:.]+$/, '')}…`; return k; }; // never cut text silently
const lines = (x: number, y: number, ls: string[], o: { size?: number; anchor?: string; fill?: string; bold?: boolean; gap?: number } = {}) => ls.map((l, i) => T(x, y + i * (o.gap ?? 17), l, o)).join('');
const str = (v: any, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const num = (v: any) => typeof v === 'number' && Number.isFinite(v);
const key = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
const sing = (s: string) => s.replace(/\b(mitochondria)\b/g, 'mitochondrion').replace(/\b(\w+?)(s)\b/g, (m, a) => (a.length > 3 && !/ss$/.test(m) ? a : m));

/* ---------------- labelled structure ---------------- */
/** Parts that belong to each known structure, with where the leader line points on the drawing (x, y). */
export const STRUCTURES: Record<string, Record<string, P>> = {
  'animal cell': { 'cell membrane': [130, 160], cytoplasm: [190, 250], nucleus: [300, 210], nucleolus: [300, 212], mitochondrion: [220, 170], ribosome: [380, 260], vacuole: [380, 170], 'golgi body': [250, 280], 'endoplasmic reticulum': [350, 290] },
  'plant cell': { 'cell wall': [100, 120], 'cell membrane': [116, 140], cytoplasm: [150, 310], nucleus: [170, 170], nucleolus: [170, 172], vacuole: [300, 220], 'cell sap': [300, 240], chloroplast: [410, 140], mitochondrion: [420, 320], ribosome: [140, 260], tonoplast: [230, 160] },
  flower: { stigma: [300, 144], style: [300, 205], ovary: [316, 274], ovule: [306, 300], carpel: [300, 240], pistil: [300, 240], anther: [362, 188], filament: [346, 252], stamen: [354, 222], petal: [214, 205], sepal: [240, 318], receptacle: [288, 334], pedicel: [300, 385] },
  'flowering plant': { flower: [300, 82], petal: [286, 74], bud: [380, 150], leaf: [220, 190], stem: [300, 240], node: [300, 190], internode: [300, 215], fruit: [380, 120], 'tap root': [300, 360], 'lateral root': [262, 352], 'root hair': [340, 385], root: [300, 345], shoot: [300, 160] },
};
const STRUCT_ALIAS: Record<string, string> = { 'flower stalk': 'pedicel', stalk: 'pedicel', pistils: 'pistil', carpels: 'carpel', ovules: 'ovule', stamens: 'stamen', anthers: 'anther', filaments: 'filament', sepals: 'sepal', petals: 'petal', stigmas: 'stigma', 'plasma membrane': 'cell membrane', membrane: 'cell membrane', 'cell sap vacuole': 'vacuole', 'large vacuole': 'vacuole', 'central vacuole': 'vacuole', 'golgi apparatus': 'golgi body', 'golgi': 'golgi body', 'er': 'endoplasmic reticulum', 'leaves': 'leaf', 'roots': 'root', 'primary root': 'tap root', 'taproot': 'tap root', 'secondary root': 'lateral root', 'mitochondria': 'mitochondrion' };
export const partKey = (subject: string, name: string) => { const k = key(name); const a = STRUCT_ALIAS[k] ?? k; const parts = STRUCTURES[subject] ?? {}; return parts[a] ? a : parts[sing(a)] ? sing(a) : STRUCT_ALIAS[sing(a)] ?? null; };
/** Flower parts drawn on a "flowering plant" or "flower" figure use the half-flower drawing (sepal, petal, stamen, carpel and their parts). */
export function structureSubject(d: any): string { const s = key(d?.subject); if (s !== 'flowering plant' || !Array.isArray(d?.parts) || !d.parts.length) return s;
  return d.parts.every((p: any) => partKey('flowering plant', p?.name ?? '')) ? s : d.parts.every((p: any) => partKey('flower', p?.name ?? '')) ? 'flower' : s; }
export function validateStructure(d: any): string | null {
  const s = structureSubject(d); if (!str(d.subject, 40)) return 'structure: subject is required (animal cell, plant cell, flowering plant, apparatus, organ system or other)';
  if (!Array.isArray(d.parts) || d.parts.length < 2 || d.parts.length > 10) return 'structure: 2-10 labelled parts';
  for (const p of d.parts) if (!str(p?.name, 40) || (p.note != null && !str(p.note, 120))) return 'structure: each part needs a name (up to 40 characters; note optional, up to 120)';
  if (new Set(d.parts.map((p: any) => key(p.name))).size !== d.parts.length) return 'structure: each part is labelled once';
  if (STRUCTURES[s]) { const bad = d.parts.filter((p: any) => !partKey(s, p.name)).map((p: any) => p.name); if (bad.length) return `structure: ${bad.join(', ')} ${bad.length > 1 ? 'are not parts' : 'is not a part'} of a ${s} (use ${Object.keys(STRUCTURES[s]).join(', ')})`; }
  return null;
}
function structureDrawing(s: string): string {
  if (s === 'animal cell') return `<ellipse cx="260" cy="225" rx="140" ry="105" fill="#fef3c7" stroke="#b45309" stroke-width="3"/><circle cx="300" cy="210" r="34" fill="#ddd6fe" stroke="#6d28d9" stroke-width="2"/><circle cx="300" cy="212" r="10" fill="#6d28d9"/>` +
    `<ellipse cx="220" cy="170" rx="22" ry="10" fill="#fca5a5" stroke="#b91c1c"/><circle cx="380" cy="170" r="9" fill="#e0f2fe" stroke="#0369a1"/>` + [[380, 260], [360, 250], [200, 270]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#334155"/>`).join('') +
    `<path d="M230 280 q20 -8 40 0 M232 288 q18 -8 36 0" stroke="#a16207" fill="none" stroke-width="2"/><path d="M330 290 q10 -10 20 0 t20 0" stroke="#64748b" fill="none" stroke-width="2"/>`;
  if (s === 'plant cell') return `<rect x="90" y="110" width="340" height="230" rx="6" fill="#dcfce7" stroke="#15803d" stroke-width="6"/><rect x="108" y="128" width="304" height="194" rx="4" fill="#f0fdf4" stroke="#166534" stroke-width="2"/>` +
    `<rect x="230" y="160" width="150" height="130" rx="30" fill="#e0f2fe" stroke="#0369a1" stroke-width="2"/><circle cx="170" cy="170" r="26" fill="#ddd6fe" stroke="#6d28d9" stroke-width="2"/><circle cx="170" cy="172" r="8" fill="#6d28d9"/>` +
    [[410, 140], [396, 300], [130, 210]].map(([x, y]) => `<ellipse cx="${x - 14}" cy="${y}" rx="14" ry="8" fill="#22c55e" stroke="#15803d"/>`).join('') + `<ellipse cx="406" cy="320" rx="12" ry="6" fill="#fca5a5" stroke="#b91c1c"/><circle cx="140" cy="260" r="3" fill="#334155"/>`;
  if (s === 'flower') return `<line x1="300" y1="400" x2="300" y2="338" stroke="#15803d" stroke-width="7"/><ellipse cx="300" cy="334" rx="30" ry="10" fill="#86efac" stroke="#15803d" stroke-width="2"/>` +
    `<path d="M282 330 q-30 -2 -52 -16 q30 -6 54 10 Z M318 330 q30 -2 52 -16 q-30 -6 -54 10 Z" fill="#4ade80" stroke="#15803d" stroke-width="2"/>` +
    `<path d="M286 326 Q190 270 214 190 Q262 240 292 322 Z M314 326 Q410 270 386 190 Q338 240 308 322 Z" fill="#fbcfe8" stroke="#be185d" stroke-width="2"/>` +
    `<line x1="284" y1="326" x2="240" y2="196" stroke="#a16207" stroke-width="2.5"/><line x1="316" y1="326" x2="360" y2="196" stroke="#a16207" stroke-width="2.5"/><ellipse cx="238" cy="188" rx="7" ry="12" fill="#facc15" stroke="#a16207" stroke-width="2"/><ellipse cx="362" cy="188" rx="7" ry="12" fill="#facc15" stroke="#a16207" stroke-width="2"/>` +
    `<ellipse cx="300" cy="294" rx="22" ry="30" fill="#bbf7d0" stroke="#166534" stroke-width="2"/><circle cx="292" cy="284" r="4" fill="#fef9c3" stroke="#a16207"/><circle cx="306" cy="300" r="4" fill="#fef9c3" stroke="#a16207"/>` +
    `<line x1="300" y1="264" x2="300" y2="150" stroke="#166534" stroke-width="4"/><ellipse cx="300" cy="144" rx="13" ry="6" fill="#86efac" stroke="#166534" stroke-width="2"/>`;
  if (s === 'flowering plant') return `<line x1="300" y1="100" x2="300" y2="340" stroke="#15803d" stroke-width="7"/><path d="M300 190 q-60 -20 -90 0 q40 25 90 0 M300 230 q60 -20 90 0 q-40 25 -90 0" fill="#4ade80" stroke="#15803d" stroke-width="2"/>` +
    [0, 72, 144, 216, 288].map((a) => `<ellipse cx="${f(300 + 16 * Math.cos((a * Math.PI) / 180))}" cy="${f(84 + 16 * Math.sin((a * Math.PI) / 180))}" rx="12" ry="7" transform="rotate(${a} ${f(300 + 16 * Math.cos((a * Math.PI) / 180))} ${f(84 + 16 * Math.sin((a * Math.PI) / 180))})" fill="#f9a8d4" stroke="#be185d"/>`).join('') + `<circle cx="300" cy="84" r="8" fill="#facc15"/>` +
    `<path d="M300 150 l60 -20" stroke="#15803d" stroke-width="4"/><circle cx="380" cy="122" r="10" fill="#fb923c" stroke="#c2410c"/><ellipse cx="368" cy="148" rx="6" ry="10" fill="#86efac" stroke="#15803d"/>` +
    `<line x1="240" y1="340" x2="360" y2="340" stroke="#a16207" stroke-width="3" stroke-dasharray="6 4"/><path d="M300 340 v40 M300 352 l-40 20 M300 360 l38 22 M300 372 l-26 18" stroke="#92400e" stroke-width="3" fill="none"/>`;
  return '';
}
function renderStructure(d: any) {
  const s = structureSubject(d), known = !!STRUCTURES[s], W = 720;
  if (known) { const pts = d.parts.map((p: any) => ({ p, at: STRUCTURES[s][partKey(s, p.name)!] })); const byY = (a: any, b: any) => a.at[1] - b.at[1]; const left = pts.filter((q: any) => q.at[0] < 300).sort(byY), right = pts.filter((q: any) => q.at[0] >= 300).sort(byY); // labels in drawing order so leader lines do not cross
    const H = Math.max(460, 110 + Math.max(left.length, right.length) * 70); let out = `<g transform="translate(100 0)">${structureDrawing(s)}</g>`;
    const side = (arr: any[], x: number, anchor: string) => arr.forEach((q, i) => { const y = 70 + i * ((H - 160) / Math.max(1, arr.length - 1 || 1)); const tx = anchor === 'end' ? x - 4 : x + 4;
      out += L([q.at[0] + 100, q.at[1]], [x, y], '#475569', 1.4) + `<circle cx="${f(q.at[0] + 100)}" cy="${f(q.at[1])}" r="3" fill="#0f172a"/>` + (() => { const nm = wrap(q.p.name, 16, 2); /* long names (e.g. endoplasmic reticulum) wrap so they stay inside the 720px frame */ return lines(tx, y, nm, { anchor, bold: true, size: 14, gap: 16 }) + (q.p.note ? lines(tx, y + 16 * nm.length, wrap(q.p.note, 24, 4), { anchor, size: 11, fill: MUTED, gap: 13 }) : ''); })(); });
    side(left, 150, 'end'); side(right, 570, 'start');
    return svgFrame(W, H, d.title ?? `Parts of a ${s}`, out); }
  // Apparatus, organ systems and other structures: a schematic of labelled parts in order (no invented anatomy).
  const n = d.parts.length, cols = n > 5 ? 2 : 1, rows = Math.ceil(n / cols), cw = cols === 2 ? 320 : 520, x0 = (W - cols * cw - (cols - 1) * 20) / 2; let out = T(W / 2, 54, `${d.subject} (schematic: labelled parts)`, { size: 13, italic: true, fill: MUTED });
  d.parts.forEach((p: any, i: number) => { const c = cols === 2 ? Math.floor(i / rows) : 0, r = cols === 2 ? i % rows : i, x = x0 + c * (cw + 20), y = 74 + r * 66;
    out += R(x, y, cw, 56, '#fff', LINE) + `<circle cx="${f(x + 26)}" cy="${f(y + 26)}" r="14" fill="${LINE}"/>` + T(x + 26, y + 27, i + 1, { size: 13, bold: true, fill: '#fff' }) + T(x + 50, y + (p.note ? 17 : 26), p.name, { anchor: 'start', bold: true, size: 14 }) + (p.note ? lines(x + 50, y + 33, wrap(p.note, Math.floor((cw - 60) / 6.4), 2), { anchor: 'start', size: 11, fill: MUTED, gap: 13 }) : '');
    if (d.connected && r < rows - 1 && i < n - 1) out += A([x + 26, y + 56], [x + 26, y + 66]); });
  return svgFrame(W, 74 + rows * 66 + 10, d.title ?? d.subject, ARROW_DEF + out);
}

/* ---------------- circuit diagram (standard symbols) ---------------- */
export const COMPONENTS = ['cell', 'battery', 'lamp', 'switch_open', 'switch_closed', 'resistor', 'variable_resistor', 'ammeter', 'voltmeter', 'fuse', 'diode', 'led', 'motor', 'buzzer', 'bell', 'test_gap'];
const COMP_ALIAS: Record<string, string> = { bulb: 'lamp', 'light bulb': 'lamp', switch: 'switch_open', 'open switch': 'switch_open', 'closed switch': 'switch_closed', rheostat: 'variable_resistor', 'light emitting diode': 'led', 'dry cell': 'cell', 'battery of cells': 'battery', gap: 'test_gap', 'test gap': 'test_gap', 'open gap': 'test_gap', 'test material': 'test_gap', 'test terminals': 'test_gap' };
export const compType = (t: unknown) => { const k = String(t ?? '').toLowerCase().trim().replace(/-/g, ' '); const u = k.replace(/ /g, '_'); return COMPONENTS.includes(u) ? u : COMP_ALIAS[k] ?? null; };
export function validateCircuit(d: any): string | null {
  if (!Array.isArray(d.components) || d.components.length < 2 || d.components.length > 8) return 'circuit: 2-8 components in the series loop';
  for (const c of d.components) { if (!compType(c?.type)) return `circuit: unknown component "${c?.type}" (use ${COMPONENTS.join(', ')})`; if (c.label != null && !str(c.label, 24)) return 'circuit: component label up to 24 characters'; }
  if (!d.components.some((c: any) => ['cell', 'battery'].includes(compType(c.type)!))) return 'circuit: needs a cell or battery as the source';
  if (d.components.some((c: any) => compType(c.type) === 'voltmeter')) return 'circuit: a voltmeter is connected in parallel: list it under parallel with across (the component index), not in series';
  if (d.parallel != null) { if (!Array.isArray(d.parallel) || d.parallel.length > 3) return 'circuit: at most 3 parallel components';
    for (const p of d.parallel) { const t = compType(p?.type); if (!t || ['cell', 'battery', 'ammeter'].includes(t)) return 'circuit: parallel components must be voltmeters, lamps, resistors or similar (an ammeter goes in series)';
      if (!Number.isInteger(p.across) || p.across < 0 || p.across >= d.components.length) return 'circuit: each parallel component needs across: the 0-based index of a series component'; } }
  return null;
}
function symbol(t: string, x: number, y: number, vertical = false): string {
  // Drawn horizontally centred on (x, y), 60 wide; wires connect at x-30 and x+30.
  let s = '';
  const w = (a: number, b: number) => L([x + a, y], [x + b, y]);
  switch (t) {
    case 'cell': s = w(-30, -5) + L([x - 5, y - 16], [x - 5, y + 16], WIRE, 2) + L([x + 5, y - 8], [x + 5, y + 8], WIRE, 5) + w(5, 30); break;
    case 'battery': s = w(-30, -13) + L([x - 13, y - 16], [x - 13, y + 16]) + L([x - 5, y - 8], [x - 5, y + 8], WIRE, 5) + L([x + 5, y - 16], [x + 5, y + 16]) + L([x + 13, y - 8], [x + 13, y + 8], WIRE, 5) + w(13, 30); break;
    case 'lamp': s = w(-30, -12) + `<circle cx="${x}" cy="${y}" r="12" fill="#fff" stroke="${WIRE}" stroke-width="2"/>` + L([x - 8.5, y - 8.5], [x + 8.5, y + 8.5]) + L([x - 8.5, y + 8.5], [x + 8.5, y - 8.5]) + w(12, 30); break;
    case 'switch_open': s = w(-30, -14) + `<circle cx="${x - 14}" cy="${y}" r="3" fill="${WIRE}"/><circle cx="${x + 14}" cy="${y}" r="3" fill="${WIRE}"/>` + L([x - 14, y], [x + 12, y - 14]) + w(14, 30); break;
    case 'switch_closed': s = w(-30, -14) + `<circle cx="${x - 14}" cy="${y}" r="3" fill="${WIRE}"/><circle cx="${x + 14}" cy="${y}" r="3" fill="${WIRE}"/>` + L([x - 14, y], [x + 14, y - 2]) + w(14, 30); break;
    case 'resistor': s = w(-30, -18) + `<rect x="${x - 18}" y="${y - 8}" width="36" height="16" fill="#fff" stroke="${WIRE}" stroke-width="2"/>` + w(18, 30); break;
    case 'variable_resistor': s = symbol('resistor', x, y) + A([x - 18, y + 14], [x + 20, y - 16], WIRE); break;
    case 'fuse': s = w(-30, -18) + `<rect x="${x - 18}" y="${y - 7}" width="36" height="14" fill="#fff" stroke="${WIRE}" stroke-width="2"/>` + w(-18, 18); break;
    case 'ammeter': case 'voltmeter': case 'motor': s = w(-30, -13) + `<circle cx="${x}" cy="${y}" r="13" fill="#fff" stroke="${WIRE}" stroke-width="2"/>` + T(x, y + 1, t === 'ammeter' ? 'A' : t === 'voltmeter' ? 'V' : 'M', { size: 14, bold: true }) + w(13, 30); break;
    case 'diode': case 'led': s = w(-30, -9) + `<path d="M${x - 9} ${y - 10} L${x - 9} ${y + 10} L${x + 8} ${y} Z" fill="#fff" stroke="${WIRE}" stroke-width="2"/>` + L([x + 9, y - 10], [x + 9, y + 10]) + w(9, 30) + (t === 'led' ? `<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="${WIRE}" stroke-width="1.5"/>` + [[2, -18], [11, -14]].map(([dx, dy]) => { const sx = x + dx, sy = y + dy, ex = sx + 9, ey = sy - 9; return L([sx, sy], [ex, ey], WIRE, 1.5) + `<path d="M${f(ex)} ${f(ey)} l-5.5 1 l4.5 4.5 Z" fill="${WIRE}"/>`; }).join('') : ''); break;
    // Test gap: two terminals (clips) with an open space where the material being tested is placed.
    case 'test_gap': s = w(-30, -16) + w(16, 30) + [-1, 1].map((k) => `<rect x="${f(x + k * 16 - 4)}" y="${f(y - 5)}" width="8" height="10" fill="#fff" stroke="${WIRE}" stroke-width="2"/>`).join('') + L([x - 10, y], [x + 10, y], '#94a3b8', 1.5).replace('/>', ' stroke-dasharray="3 3"/>'); break;
    case 'buzzer': case 'bell': s = w(-30, -10) + L([x - 10, y], [x - 10, y - 8]) + L([x + 10, y], [x + 10, y - 8]) + w(10, 30) + `<path d="M${x - 14} ${y - 8} A14 14 0 0 1 ${x + 14} ${y - 8} Z" fill="#fff" stroke="${WIRE}" stroke-width="2"/>`; break;
  }
  return vertical ? `<g transform="rotate(90 ${f(x)} ${f(y)})">${s}</g>` : s;
}
/** Words that only name a standard component ("Battery", "LED bulb", "Switch"): not new terms for grounding. */
const CIRCUIT_WORDS = new Set(['cell', 'cells', 'battery', 'dry', 'lamp', 'bulb', 'light', 'switch', 'open', 'closed', 'resistor', 'variable', 'rheostat', 'ammeter', 'voltmeter', 'fuse', 'diode', 'led', 'motor', 'buzzer', 'bell', 'test', 'material', 'materials', 'gap', 'sample', 'the', 'a', 'an', 'electric']);
export const COMPONENT_NAMES: Record<string, string> = { cell: 'cell', battery: 'battery', lamp: 'lamp', switch_open: 'switch (open)', switch_closed: 'switch (closed)', resistor: 'resistor', variable_resistor: 'variable resistor', ammeter: 'ammeter', voltmeter: 'voltmeter', fuse: 'fuse', diode: 'diode', led: 'LED', motor: 'motor', buzzer: 'buzzer', bell: 'bell', test_gap: 'Test material' };
function renderCircuit(d: any) {
  const cs = d.components.map((c: any) => ({ t: compType(c.type)!, label: c.label })); const n = cs.length, top = Math.ceil(n / 2), bottom = n - top;
  const W = Math.max(480, Math.max(top, bottom) * 120 + 80), x0 = 40, x1 = W - 40, y0 = 120, y1 = 300; const par = d.parallel ?? [];
  let out = `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="${WIRE}" stroke-width="2"/>`; const pos: P[] = [];
  cs.forEach((c: any, i: number) => { const onTop = i < top, k = onTop ? i : i - top, cnt = onTop ? top : bottom, x = x0 + ((x1 - x0) * (k + 1)) / (cnt + 1), y = onTop ? y0 : y1; pos.push([x, y]);
    out += `<rect x="${f(x - 31)}" y="${f(y - 4)}" width="62" height="8" fill="#fff"/>` + symbol(c.t, x, y) + T(x, onTop ? y - 34 : y + 34, c.label ?? COMPONENT_NAMES[c.t], { size: 12, fill: MUTED }); });
  par.forEach((p: any, j: number) => { const [x, y] = pos[p.across], t = compType(p.type)!, up = y === y0, yy = up ? y - 70 - j * 10 : y + 70 + j * 10;
    out += `<circle cx="${f(x - 40)}" cy="${f(y)}" r="3" fill="${WIRE}"/><circle cx="${f(x + 40)}" cy="${f(y)}" r="3" fill="${WIRE}"/>` + `<path d="M${f(x - 40)} ${f(y)} V${f(yy)} H${f(x - 30)} M${f(x + 30)} ${f(yy)} H${f(x + 40)} V${f(y)}" fill="none" stroke="${WIRE}" stroke-width="2"/>` +
      symbol(t, x, yy) + T(x, up ? yy - 24 : yy + 26, p.label ?? `${COMPONENT_NAMES[t]} across ${cs[p.across].label ?? COMPONENT_NAMES[cs[p.across].t]}`, { size: 12, fill: MUTED }); });
  const H = y1 + (par.some((p: any) => pos[p.across][1] === y1) ? 130 : 60), shift = par.some((p: any) => pos[p.across][1] === y0) ? 40 : 0;
  return svgFrame(W, H + shift, d.title ?? 'Circuit diagram', ARROW_DEF + `<g transform="translate(0 ${shift})">${out}</g>`);
}

/* ---------------- cycle diagram (water cycle, life cycles) ---------------- */
export function validateCycle(d: any): string | null {
  if (!Array.isArray(d.stages) || d.stages.length < 3 || d.stages.length > 8) return 'cyclediagram: 3-8 stages';
  for (const s of d.stages) if (!str(s?.label, 40) || (s.detail != null && !str(s.detail, 90))) return 'cyclediagram: each stage needs a label (up to 40 characters; detail optional, up to 90)';
  if (d.processes != null && (!Array.isArray(d.processes) || d.processes.length !== d.stages.length || !d.processes.every((p: any) => p === '' || p == null || str(p, 40)))) return 'cyclediagram: processes lists one arrow label (up to 40 characters, or empty) per stage, for the arrow from that stage to the next';
  return null;
}
function renderCycle(d: any) {
  const n = d.stages.length, W = 760, H = 600, cx = 380, cy = 310, r = 210, bw = 172; let out = '';
  const pts: P[] = d.stages.map((_: any, i: number) => [cx + r * Math.sin((2 * Math.PI * i) / n), cy - r * Math.cos((2 * Math.PI * i) / n) * 0.92]);
  d.stages.forEach((_: any, i: number) => { const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, cut = Math.min(len / 2 - 8, 62);
    out += A([a[0] + ux * cut, a[1] + uy * cut], [b[0] - ux * cut, b[1] - uy * cut], LINE);
    const p = d.processes?.[i]; if (p) { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, ox = mx + (mx - cx) * 0.3, oy = my + (my - cy) * 0.3; const pl = wrap(p, 20, 2); out += `<g stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${lines(ox, oy - (pl.length - 1) * 7, pl, { size: 12, fill: '#0c4a6e', bold: true, gap: 14 })}</g>`; } });
  d.stages.forEach((s: any, i: number) => { const [x, y] = pts[i], ls = wrap(s.label, 18, 2), ds = s.detail ? wrap(s.detail, 26, 4) : [], h = 22 + ls.length * 16 + ds.length * 14;
    out += R(x - bw / 2, y - h / 2, bw, h, '#fff', LINE, 12) + lines(x, y - h / 2 + 18, ls, { size: 14, bold: true, gap: 16 }) + lines(x, y - h / 2 + 20 + ls.length * 16, ds, { size: 11, fill: MUTED, gap: 14 }); });
  return svgFrame(W, H, d.title ?? 'Cycle', ARROW_DEF + out);
}

/* ---------------- food chain / food web ---------------- */
export const TROPHIC = ['producer', 'primary consumer', 'secondary consumer', 'tertiary consumer', 'quaternary consumer'];
const lvl = (o: any) => { if (Number.isInteger(o?.level)) return o.level; const k = TROPHIC.indexOf(key(o?.role)); return k < 0 ? (key(o?.role) === 'decomposer' ? 0 : -1) : k + 1; };
export function validateFoodweb(d: any): string | null {
  if (!Array.isArray(d.organisms) || d.organisms.length < 2 || d.organisms.length > 12) return 'foodweb: 2-12 organisms';
  for (const o of d.organisms) { if (!str(o?.name, 30)) return 'foodweb: each organism needs a name'; const v = lvl(o); if (v < 0 || v > 5) return `foodweb: ${o.name}: role must be producer, primary/secondary/tertiary consumer or decomposer (or level 1-5)`; }
  const names = d.organisms.map((o: any) => key(o.name)); if (new Set(names).size !== names.length) return 'foodweb: organism names must be unique';
  if (!d.organisms.some((o: any) => lvl(o) === 1)) return 'foodweb: needs at least one producer (green plant or alga) at level 1';
  if (!Array.isArray(d.links) || d.links.length < 1 || d.links.length > 20) return 'foodweb: 1-20 links {from: food, to: feeder}';
  const by = (n: any) => d.organisms[names.indexOf(key(n))];
  for (const l of d.links) { const a = by(l?.from), b = by(l?.to); if (!a || !b) return `foodweb: link ${l?.from} → ${l?.to} names an organism that is not listed`;
    if (lvl(b) === 1) return `foodweb: ${b.name} is a producer and does not feed on ${a.name}`;
    if (lvl(b) !== 0 && lvl(a) !== 0 && lvl(b) <= lvl(a)) return `foodweb: arrows point from the food to the feeder (energy flow): ${a.name} → ${b.name} must go up a trophic level`;
    if (lvl(a) === 0) return `foodweb: ${a.name} is a decomposer; arrows go into decomposers, not out of them`; }
  for (const o of d.organisms) if (lvl(o) > 1 && !d.links.some((l: any) => key(l.to) === key(o.name))) return `foodweb: ${o.name} is a consumer but nothing feeds it`;
  return null;
}
function renderFoodweb(d: any) {
  const levels = [...new Set<number>(d.organisms.map(lvl).filter((v: number) => v > 0))].sort((a, b) => a - b), dec = d.organisms.filter((o: any) => lvl(o) === 0);
  const W = 720, rowH = 100, H = 70 + levels.length * rowH + (dec.length ? 70 : 0) + 20; const pos = new Map<string, P>(); let out = '';
  levels.forEach((v, r) => { const row = d.organisms.filter((o: any) => lvl(o) === v), y = H - 50 - (dec.length ? 70 : 0) - r * rowH;
    out += T(14, y, TROPHIC[v - 1].replace(/^./, (c) => c.toUpperCase()), { anchor: 'start', size: 11, fill: MUTED, italic: true });
    row.forEach((o: any, i: number) => pos.set(key(o.name), [160 + ((W - 200) * (i + 0.5)) / row.length, y])); });
  dec.forEach((o: any, i: number) => pos.set(key(o.name), [160 + ((W - 200) * (i + 0.5)) / dec.length, H - 40]));
  if (dec.length) out += T(14, H - 40, 'Decomposer', { anchor: 'start', size: 11, fill: MUTED, italic: true });
  for (const l of d.links) { const a = pos.get(key(l.from))!, b = pos.get(key(l.to))!, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    out += A([a[0] + (dx / len) * 26, a[1] + (dy / len) * 22], [b[0] - (dx / len) * 30, b[1] - (dy / len) * 24], '#15803d'); }
  for (const o of d.organisms) { const [x, y] = pos.get(key(o.name))!; const v = lvl(o); out += R(x - 62, y - 18, 124, 36, v === 1 ? '#dcfce7' : v === 0 ? '#f5f5f4' : '#fff', v === 1 ? '#15803d' : '#a16207', 18) + T(x, y + 1, o.name, { size: 13, bold: true }); }
  return svgFrame(W, H, d.title ?? (d.links.length === d.organisms.length - 1 ? 'Food chain' : 'Food web'), ARROW_DEF + out + T(W / 2, 48, 'Arrows show the direction of energy flow (from food to feeder)', { size: 12, fill: MUTED, italic: true }));
}

/* ---------------- process steps (e.g. photosynthesis, separation of mixtures) ---------------- */
export function validateProcess(d: any): string | null {
  if (!Array.isArray(d.steps) || d.steps.length < 2 || d.steps.length > 8) return 'process: 2-8 steps';
  for (const s of d.steps) if (!str(s?.label, 60) || (s.detail != null && !str(s.detail, 140))) return 'process: each step needs a label (up to 60 characters; detail optional, up to 140)';
  for (const k of ['inputs', 'outputs']) if (d[k] != null && !(Array.isArray(d[k]) && d[k].length <= 5 && d[k].every((x: any) => str(x, 60)))) return `process: ${k} lists up to 5 short items (up to 60 characters each)`;
  return null;
}
function renderProcess(d: any) {
  const W = 640, bw = 380, x = (W - bw) / 2; let y = 54, out = '';
  const io = (label: string, items: string[], fill: string, stroke: string) => { const ls = wrap(`${label}: ${items.join(', ')}`, 44, 5), h = 18 + ls.length * 17; const s = R(x, y, bw, h, fill, stroke) + lines(W / 2, y + 17, ls, { size: 13, bold: true }); y += h; return s; };
  if (d.inputs?.length) { out += io('In', d.inputs, '#fef3c7', '#b45309'); out += A([W / 2, y], [W / 2, y + 22]); y += 24; }
  d.steps.forEach((s: any, i: number) => { const ls = wrap(s.label, 38, 2), ds = s.detail ? wrap(s.detail, 50, 3) : [], h = 34 + (ls.length - 1) * 17 + ds.length * 16;
    out += R(x, y, bw, h, '#fff', LINE) + `<circle cx="${f(x)}" cy="${f(y + 17)}" r="13" fill="${LINE}"/>` + T(x, y + 18, i + 1, { size: 12, bold: true, fill: '#fff' }) + lines(W / 2, y + 18, ls, { size: 14, bold: true, gap: 17 }) + lines(W / 2, y + 36 + (ls.length - 1) * 17, ds, { size: 12, fill: MUTED, gap: 16 });
    y += h; if (i < d.steps.length - 1 || d.outputs?.length) { out += A([W / 2, y], [W / 2, y + 22]); y += 24; } });
  if (d.outputs?.length) out += io('Out', d.outputs, '#dcfce7', '#15803d');
  return svgFrame(W, y + 14, d.title ?? 'Process', ARROW_DEF + out);
}

/* ---------------- experiment data: graph ---------------- */
export function validateDatagraph(d: any): string | null {
  if (!['line', 'bar', 'scatter'].includes(d.type)) return 'datagraph: type must be line, bar or scatter';
  for (const k of ['x', 'y']) if (!d[k] || !str(d[k].label, 40) || (d[k].unit != null && typeof d[k].unit !== 'string')) return `datagraph: ${k} needs a label (and its unit, e.g. "°C", "s", "cm³")`;
  if (d.y.unit == null) return 'datagraph: y.unit is required (use "" only for counts)';
  if (!Array.isArray(d.points) || d.points.length < 2 || d.points.length > 20) return 'datagraph: 2-20 points';
  for (const p of d.points) { if (!num(p?.y)) return 'datagraph: every y value must be a number'; if (d.type === 'bar' ? !str(String(p.x ?? ''), 20) : !num(p?.x)) return d.type === 'bar' ? 'datagraph: bar categories (x) up to 20 characters' : 'datagraph: every x value must be a number'; }
  if (d.type === 'line') for (let i = 1; i < d.points.length; i++) if (d.points[i].x <= d.points[i - 1].x) return 'datagraph: line graph x values must increase';
  return null;
}
const nice = (lo: number, hi: number) => { if (lo === hi) { lo -= 1; hi += 1; } const span = hi - lo, step0 = Math.pow(10, Math.floor(Math.log10(span / 5))); const step = [1, 2, 5, 10].map((m) => m * step0).find((s) => span / s <= 6)!; return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step }; };
const ax = (a: any) => `${a.label}${a.unit ? ` (${a.unit})` : ''}`;
const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
function renderDatagraph(d: any) {
  const W = 640, H = 420, l = 80, r = 600, t = 60, b = 350; const ys = d.points.map((p: any) => p.y); const Y = nice(Math.min(0, ...ys), Math.max(...ys));
  const yv = (v: number) => b - ((v - Y.lo) / (Y.hi - Y.lo)) * (b - t); let out = '';
  for (let v = Y.lo; v <= Y.hi + 1e-9; v += Y.step) out += L([l, yv(v)], [r, yv(v)], '#e2e8f0', 1) + T(l - 8, yv(v), fmt(v), { anchor: 'end', size: 12 });
  out += L([l, t], [l, b], INK) + L([l, b], [r, b], INK);
  if (d.type === 'bar') { const n = d.points.length, bw = ((r - l) / n) * 0.6; d.points.forEach((p: any, i: number) => { const cx = l + ((r - l) * (i + 0.5)) / n; out += `<rect x="${f(cx - bw / 2)}" y="${f(yv(Math.max(0, p.y)))}" width="${f(bw)}" height="${f(Math.abs(yv(p.y) - yv(0)))}" fill="#7dd3fc" stroke="${LINE}"/>` + T(cx, b + 16, p.x, { size: 12 }) + T(cx, yv(p.y) - 10, fmt(p.y), { size: 11, fill: MUTED }); }); }
  else { const xs = d.points.map((p: any) => p.x); const X = nice(Math.min(...xs), Math.max(...xs)); const xv = (v: number) => l + ((v - X.lo) / (X.hi - X.lo)) * (r - l);
    for (let v = X.lo; v <= X.hi + 1e-9; v += X.step) out += L([xv(v), b], [xv(v), b + 5], INK, 1) + T(xv(v), b + 16, fmt(v), { size: 12 });
    if (d.type === 'line') out += `<polyline points="${d.points.map((p: any) => `${f(xv(p.x))},${f(yv(p.y))}`).join(' ')}" fill="none" stroke="${LINE}" stroke-width="2.5"/>`;
    out += d.points.map((p: any) => `<circle cx="${f(xv(p.x))}" cy="${f(yv(p.y))}" r="4.5" fill="#fff" stroke="${LINE}" stroke-width="2.5"/>`).join(''); }
  out += T((l + r) / 2, b + 44, ax(d.x), { size: 14, bold: true }) + `<text x="22" y="${f((t + b) / 2)}" text-anchor="middle" font-size="14" font-weight="bold" fill="${INK}" transform="rotate(-90 22 ${f((t + b) / 2)})">${esc(ax(d.y))}</text>`;
  return svgFrame(W, H, d.title ?? 'Results', out);
}

/* ---------------- experiment data: table ---------------- */
export function validateDatatable(d: any): string | null {
  if (!Array.isArray(d.columns) || d.columns.length < 2 || d.columns.length > 6) return 'datatable: 2-6 columns [{label, unit?}]';
  for (const c of d.columns) if (!str(c?.label, 30) || (c.unit != null && !str(c.unit, 12))) return 'datatable: each column needs a label (unit optional, e.g. "°C")';
  if (!Array.isArray(d.rows) || d.rows.length < 1 || d.rows.length > 12) return 'datatable: 1-12 rows';
  for (const r of d.rows) if (!Array.isArray(r) || r.length !== d.columns.length || !r.every((x: any) => num(x) || str(String(x ?? ''), 30))) return 'datatable: each row has one value per column';
  return null;
}
function renderDatatable(d: any) {
  const n = d.columns.length, cw = Math.min(170, 640 / n), W = Math.max(360, n * cw + 40), x0 = (W - n * cw) / 2, rh = 32; let y = 50, out = '';
  d.columns.forEach((c: any, i: number) => { out += `<rect x="${f(x0 + i * cw)}" y="${y}" width="${f(cw)}" height="${rh + 8}" fill="${LINE}" stroke="#fff"/>` + T(x0 + i * cw + cw / 2, y + (rh + 8) / 2, ax(c), { size: 13, bold: true, fill: '#fff' }); }); y += rh + 8;
  d.rows.forEach((r: any[], j: number) => { r.forEach((v, i) => { out += `<rect x="${f(x0 + i * cw)}" y="${y}" width="${f(cw)}" height="${rh}" fill="${j % 2 ? '#f8fafc' : '#fff'}" stroke="#cbd5e1"/>` + T(x0 + i * cw + cw / 2, y + rh / 2, String(v), { size: 13 }); }); y += rh; });
  return svgFrame(W, y + 14, d.title ?? 'Results table', out);
}

export const SCIENCE_FIGURES: Record<string, { validate: (d: any) => string | null; render: (d: any) => string }> = {
  structure: { validate: validateStructure, render: renderStructure }, circuit: { validate: validateCircuit, render: renderCircuit }, cyclediagram: { validate: validateCycle, render: renderCycle },
  foodweb: { validate: validateFoodweb, render: renderFoodweb }, process: { validate: validateProcess, render: renderProcess }, datagraph: { validate: validateDatagraph, render: renderDatagraph }, datatable: { validate: validateDatatable, render: renderDatatable },
};
/** Scientific terms and data values a figure shows, for grounding checks against the notes and the learner manual. */
export function scienceFigureText(d: any): { terms: string[]; numbers: number[]; phrases: string[] } {
  const k = d?.kind; const terms: string[] = []; const numbers: number[] = []; const phrases: string[] = [];
  if (k === 'structure') terms.push(...(d.parts ?? []).map((p: any) => p.name));
  if (k === 'cyclediagram') terms.push(...(d.stages ?? []).map((s: any) => s.label), ...(d.processes ?? []).filter(Boolean));
  if (k === 'foodweb') terms.push(...(d.organisms ?? []).map((o: any) => o.name));
  // Process step labels are short paraphrases of the LM's steps (checked as a warning); inputs and outputs of one or two words are substances (checked strictly); longer ones are descriptions of a result (checked as a warning).
  if (k === 'process') { phrases.push(...(d.steps ?? []).map((s: any) => s.label)); for (const x of [...(d.inputs ?? []), ...(d.outputs ?? [])]) (String(x).trim().split(/\s+/).length <= 2 ? terms : phrases).push(x); }
  if (k === 'circuit') terms.push(...[...(d.components ?? []), ...(d.parallel ?? [])].map((c: any) => c.label).filter((l: any) => typeof l === 'string' && !key(l).split(' ').every((w) => CIRCUIT_WORDS.has(w))));
  if (k === 'datagraph') { terms.push(d.x?.label, d.y?.label); for (const p of d.points ?? []) { if (num(p.y)) numbers.push(p.y); if (num(p.x)) numbers.push(p.x); else if (p.x != null) terms.push(String(p.x)); } }
  if (k === 'datatable') { terms.push(...(d.columns ?? []).map((c: any) => c.label)); for (const r of d.rows ?? []) for (const v of r ?? []) if (num(v) || /^-?\d+(\.\d+)?$/.test(String(v).trim())) numbers.push(Number(v)); else terms.push(String(v)); }
  const ok = (x: any) => typeof x === 'string' && x.trim();
  return { terms: terms.filter(ok), numbers, phrases: phrases.filter(ok) };
}
export function describeScience(d: any): string {
  const t = d?.title ? `${d.title}: ` : '';
  switch (d?.kind) {
    case 'structure': return `${t}labelled diagram of ${d.subject} showing ${(d.parts ?? []).map((p: any) => p.name).join(', ')}`;
    case 'circuit': return `${t}circuit with ${(d.components ?? []).map((c: any) => c.label ?? COMPONENT_NAMES[compType(c.type) ?? ''] ?? c.type).join(', ')} in series${(d.parallel ?? []).length ? `, and ${(d.parallel ?? []).map((p: any) => `${COMPONENT_NAMES[compType(p.type) ?? ''] ?? p.type} across ${d.components?.[p.across]?.label ?? COMPONENT_NAMES[compType(d.components?.[p.across]?.type) ?? ''] ?? ''}`).join(', ')}` : ''}`;
    case 'cyclediagram': return `${t}cycle: ${(d.stages ?? []).map((s: any, i: number) => `${s.label}${d.processes?.[i] ? ` (${d.processes[i]})` : ''}`).join(' → ')} → back to ${d.stages?.[0]?.label ?? ''}`;
    case 'foodweb': return `${t}${(d.links ?? []).map((l: any) => `${l.from} is eaten by ${l.to}`).join('; ')}`;
    case 'process': return `${t}${d.inputs?.length ? `inputs ${d.inputs.join(', ')}; ` : ''}steps ${(d.steps ?? []).map((s: any) => s.label).join(' → ')}${d.outputs?.length ? `; outputs ${d.outputs.join(', ')}` : ''}`;
    case 'datagraph': return `${t}${d.type} graph of ${ax(d.y ?? {})} against ${ax(d.x ?? {})}: ${(d.points ?? []).map((p: any) => `${p.x}, ${p.y}`).join('; ')}`;
    case 'datatable': return `${t}table with columns ${(d.columns ?? []).map(ax).join(', ')} and ${(d.rows ?? []).length} rows`;
  }
  return '';
}
