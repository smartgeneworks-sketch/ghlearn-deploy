/**
 * Deterministic SVG renderer for exact diagrams. The model only supplies a small JSON spec; it never writes SVG,
 * so output is safe (all text escaped, no scripts/links) and reproducible.
 */
type BasicSpec =
  | { kind: 'flow'; title: string; steps: string[] }
  | { kind: 'cycle'; title: string; steps: string[] }
  | { kind: 'labelled'; title: string; centre: string; labels: string[] }
  | { kind: 'tree'; title: string; root: string; children: { label: string; children?: string[] }[] }
  | { kind: 'table'; title: string; headers: string[]; rows: string[][] }
;
export type DiagramSpec = BasicSpec | { kind: 'angle' | 'polygon' | 'solid' | 'coordinate' | 'numberline' | 'bar' | 'sentence' | 'wordmap' | 'timeline' | 'plot' | 'dialogue' | 'soundchart' | 'venn' | 'structure' | 'circuit' | 'cyclediagram' | 'foodweb' | 'process' | 'datagraph' | 'datatable' | 'history_timeline' | 'conceptmap' | 'causeeffect' | 'orgchart' | 'comparison' | 'locationtable' | 'scene'; title: string; [k: string]: any };
import { FIGURES as MATHS_FIGURES } from './figures.js';
import { ENGLISH_FIGURES } from './englishFigures.js';
import { SCIENCE_FIGURES } from './scienceFigures.js';
import { SOCIAL_FIGURES } from './socialFigures.js';
const FIGURES: Record<string, { validate: (d: any) => string | null; render: (d: any) => string }> = { ...MATHS_FIGURES, ...ENGLISH_FIGURES, ...SCIENCE_FIGURES, ...SOCIAL_FIGURES };
const esc = (s: unknown) => String(s ?? '').slice(0, 80).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const wrap = (s: string, n = 18, max = 3) => { const w = String(s).split(/\s+/); const out: string[] = []; let l = ''; for (const x of w) { if ((l + ' ' + x).trim().length > n && l) { out.push(l); l = x; } else l = (l + ' ' + x).trim(); } if (l) out.push(l); return out.slice(0, max); };
const box = (x: number, y: number, w: number, h: number, label: string, fill = '#ecfdf5') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="#047857" stroke-width="2"/>` +
  wrap(label).map((l, i, a) => `<text x="${x + w / 2}" y="${y + h / 2 + (i - (a.length - 1) / 2) * 16 + 5}" text-anchor="middle" font-size="14" fill="#064e3b">${esc(l)}</text>`).join('');
const arrow = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#334155" stroke-width="2" marker-end="url(#a)"/>`;
const frame = (w: number, h: number, title: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" style="max-width:100%;height:auto" role="img" aria-label="${esc(title)}" font-family="sans-serif"><title>${esc(title)}</title>` +
  `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#334155"/></marker></defs>` +
  `<rect width="${w}" height="${h}" fill="#fff"/><text x="${w / 2}" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="#0f172a">${esc(title)}</text>${body}</svg>`;

export function validateDiagram(d: any): string | null {
  if (!d || typeof d !== 'object') return 'diagram must be an object';
  const arr = (v: any, min: number, max: number) => Array.isArray(v) && v.length >= min && v.length <= max && v.every((x) => typeof x === 'string' && x.trim());
  switch (d.kind) {
    case 'flow': case 'cycle': return arr(d.steps, 2, 8) ? null : `${d.kind}: steps must be 2-8 strings`;
    case 'labelled': return typeof d.centre === 'string' && arr(d.labels, 2, 8) ? null : 'labelled: centre + 2-8 labels';
    case 'tree': return typeof d.root === 'string' && Array.isArray(d.children) && d.children.length >= 1 && d.children.length <= 8 && d.children.every((c: any) => typeof c?.label === 'string' && c.label.trim()) ? null : 'tree: root + 1-8 labelled children';
    case 'table': return arr(d.headers, 1, 6) && Array.isArray(d.rows) && d.rows.length <= 10 && d.rows.every((r: any) => Array.isArray(r) && r.length === d.headers.length) ? null : 'table: a row has more cells than there are headers';
    default: return FIGURES[d.kind] ? FIGURES[d.kind].validate(d) : `unknown diagram kind "${d.kind}"`;
  }
}
export function renderDiagram(spec: DiagramSpec): string { if (FIGURES[spec.kind]) return FIGURES[spec.kind].render(spec); const d = spec as BasicSpec;
  if (d.kind === 'flow') { // vertical, so it stays readable on a phone; full text wrapped (up to 4 lines per step)
    const W = 520, bw = 420, lines = d.steps.map((s) => wrap(s, 40, 4)); let y = 50, out = '';
    lines.forEach((ls, i) => { const h = 22 + ls.length * 19; out += `<rect x="${(W - bw) / 2}" y="${y}" width="${bw}" height="${h}" rx="10" fill="#ecfdf5" stroke="#047857" stroke-width="2"/>` +
      `<circle cx="${(W - bw) / 2}" cy="${y + h / 2}" r="14" fill="#047857"/><text x="${(W - bw) / 2}" y="${y + h / 2 + 5}" text-anchor="middle" font-size="13" font-weight="bold" fill="#fff">${i + 1}</text>` +
      ls.map((l, j) => `<text x="${(W - bw) / 2 + 26}" y="${y + 25 + j * 19}" font-size="15" fill="#064e3b">${esc(l)}</text>`).join('');
      y += h; if (i < lines.length - 1) { out += arrow(W / 2, y + 2, W / 2, y + 24); y += 28; } });
    return frame(W, y + 20, d.title, out); }
  if (d.kind === 'cycle') { const n = d.steps.length, R = 150, cx = 300, cy = 220, bw = 150, bh = 60;
    const pts = d.steps.map((_, i) => [cx + R * Math.sin((2 * Math.PI * i) / n), cy - R * Math.cos((2 * Math.PI * i) / n)]);
    return frame(600, 440, d.title, d.steps.map((s, i) => { const [x, y] = pts[i]; const [nx, ny] = pts[(i + 1) % n]; const k = 0.42;
      return arrow(x + (nx - x) * k, y + (ny - y) * k, x + (nx - x) * (1 - k), y + (ny - y) * (1 - k)) + box(x - bw / 2, y - bh / 2, bw, bh, s); }).join('')); }
  if (d.kind === 'labelled') { const n = d.labels.length, cx = 300, cy = 230;
    return frame(600, 460, d.title, d.labels.map((l, i) => { const a = (2 * Math.PI * i) / n; const x = cx + 210 * Math.sin(a), y = cy - 165 * Math.cos(a);
      return `<line x1="${cx + 70 * Math.sin(a)}" y1="${cy - 55 * Math.cos(a)}" x2="${x}" y2="${y}" stroke="#94a3b8" stroke-width="1.5"/>` + box(x - 70, y - 22, 140, 44, l, '#fefce8'); }).join('') +
      `<ellipse cx="${cx}" cy="${cy}" rx="80" ry="60" fill="#d1fae5" stroke="#047857" stroke-width="2"/>` + wrap(d.centre, 14).map((l, i) => `<text x="${cx}" y="${cy + 5 + i * 16}" text-anchor="middle" font-size="15" font-weight="bold">${esc(l)}</text>`).join('')); }
  if (d.kind === 'tree') { const W = Math.max(500, d.children.length * 170 + 40);
    return frame(W, 360, d.title, box(W / 2 - 90, 50, 180, 50, d.root, '#d1fae5') + d.children.map((c, i) => { const x = 20 + i * ((W - 40) / d.children.length) + 5, w = (W - 40) / d.children.length - 10;
      return arrow(W / 2, 100, x + w / 2, 148) + box(x, 150, w, 50, c.label) + (c.children ?? []).slice(0, 4).map((g, j) => `<text x="${x + w / 2}" y="${228 + j * 20}" text-anchor="middle" font-size="12" fill="#334155">• ${esc(g)}</text>`).join(''); }).join('')); }
  // Table: column widths follow content; text wraps (up to 4 lines) instead of being cut off.
  const n = d.headers.length, total = Math.min(860, Math.max(420, n * 170)); const len = d.headers.map((h, i) => Math.max(String(h).length, ...d.rows.map((r) => String(r[i] ?? '').length), 6));
  const sum = len.reduce((a, b) => a + b, 0); const cws = len.map((l) => Math.max(90, (l / sum) * total)); const W = cws.reduce((a, b) => a + b, 0) + 40;
  const chars = (w: number) => Math.max(8, Math.floor((w - 16) / 7.4)); let y = 45, out = '';
  for (const [j, r] of [d.headers, ...d.rows].entries()) { const cells = r.map((c, i) => wrap(String(c ?? ''), chars(cws[i]), 4)); const h = 14 + Math.max(1, ...cells.map((c) => c.length)) * 18; let x = 20;
    cells.forEach((ls, i) => { out += `<rect x="${x}" y="${y}" width="${cws[i]}" height="${h}" fill="${j === 0 ? '#047857' : j % 2 ? '#fff' : '#f8fafc'}" stroke="#94a3b8"/>` + ls.map((l, k) => `<text x="${x + 8}" y="${y + 21 + k * 18}" font-size="14" fill="${j === 0 ? '#fff' : '#0f172a'}"${j === 0 ? ' font-weight="bold"' : ''}>${esc(l)}</text>`).join(''); x += cws[i]; });
    y += h; }
  return frame(W, y + 20, d.title, out);}
