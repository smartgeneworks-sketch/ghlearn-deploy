/**
 * Deterministic SVG renderer for exact diagrams. The model only supplies a small JSON spec; it never writes SVG,
 * so output is safe (all text escaped, no scripts/links) and reproducible.
 */
export type DiagramSpec =
  | { kind: 'flow'; title: string; steps: string[] }
  | { kind: 'cycle'; title: string; steps: string[] }
  | { kind: 'labelled'; title: string; centre: string; labels: string[] }
  | { kind: 'tree'; title: string; root: string; children: { label: string; children?: string[] }[] }
  | { kind: 'table'; title: string; headers: string[]; rows: string[][] };
const esc = (s: unknown) => String(s ?? '').slice(0, 80).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const wrap = (s: string, n = 18) => { const w = String(s).split(/\s+/); const out: string[] = []; let l = ''; for (const x of w) { if ((l + ' ' + x).trim().length > n && l) { out.push(l); l = x; } else l = (l + ' ' + x).trim(); } if (l) out.push(l); return out.slice(0, 3); };
const box = (x: number, y: number, w: number, h: number, label: string, fill = '#ecfdf5') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="#047857" stroke-width="2"/>` +
  wrap(label).map((l, i, a) => `<text x="${x + w / 2}" y="${y + h / 2 + (i - (a.length - 1) / 2) * 16 + 5}" text-anchor="middle" font-size="14" fill="#064e3b">${esc(l)}</text>`).join('');
const arrow = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#334155" stroke-width="2" marker-end="url(#a)"/>`;
const frame = (w: number, h: number, title: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>` +
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
    default: return `unknown diagram kind "${d.kind}"`;
  }
}
export function renderDiagram(d: DiagramSpec): string {
  if (d.kind === 'flow') { const w = 170, g = 40, W = Math.max(400, d.steps.length * (w + g) + 20);
    return frame(W, 160, d.title, d.steps.map((s, i) => box(20 + i * (w + g), 55, w, 70, s) + (i < d.steps.length - 1 ? arrow(20 + i * (w + g) + w, 90, 20 + (i + 1) * (w + g) - 2, 90) : '')).join('')); }
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
  const cw = 160, rh = 36, W = d.headers.length * cw + 40, H = 70 + (d.rows.length + 1) * rh;
  const cell = (x: number, y: number, t: string, head = false) => `<rect x="${x}" y="${y}" width="${cw}" height="${rh}" fill="${head ? '#047857' : '#fff'}" stroke="#94a3b8"/><text x="${x + 8}" y="${y + 23}" font-size="13" fill="${head ? '#fff' : '#0f172a'}">${esc(t).slice(0, 22)}</text>`;
  return frame(W, H, d.title, d.headers.map((h, i) => cell(20 + i * cw, 45, h, true)).join('') + d.rows.map((r, j) => r.map((c, i) => cell(20 + i * cw, 45 + (j + 1) * rh, c)).join('')).join(''));
}
