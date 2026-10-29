/**
 * Code-drawn maths figures (accessible inline SVG) from small structured specs: angle, polygon, solid (+ net),
 * coordinate grid, number line and bar chart. The model never writes SVG; every label is escaped. Each kind has a
 * validator that also checks the measurements are consistent (angle sums, triangle inequality, Pythagoras, ranges).
 */
type P = [number, number];
const esc = (s: unknown) => String(s ?? '').slice(0, 60).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const f = (n: number) => Math.round(n * 10) / 10;
/** "5 cm" -> 5, "60°" -> 60, 7 -> 7, "x" -> null */
export const num = (v: unknown): number | null => { if (typeof v === 'number' && isFinite(v)) return v; const m = String(v ?? '').trim().match(/^(-?\d+(?:\.\d+)?)\s*(?:°|cm|mm|m|km|in|ft|units?|deg(?:rees)?)?$/i); return m ? Number(m[1]) : null; };
const lbl = (v: unknown, unit = '') => { if (v == null || v === '') return ''; const s = String(v).trim(); return num(s) != null && unit && !/[a-z°]/i.test(s) ? `${s}${unit}` : s; };
const INK = '#0f172a', LINE = '#047857', FILL = '#ecfdf5', ACC = '#b45309';
export const svgFrame = (w: number, h: number, title: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="${f(w)}" style="max-width:100%;height:auto" role="img" aria-label="${esc(title)}" font-family="sans-serif"><title>${esc(title)}</title>` +
  `<rect width="${f(w)}" height="${f(h)}" fill="#fff"/><text x="${f(w / 2)}" y="26" text-anchor="middle" font-size="17" font-weight="bold" fill="${INK}">${esc(title)}</text>${body}</svg>`;
const T = (x: number, y: number, s: unknown, o: { size?: number; anchor?: string; fill?: string; bold?: boolean } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${o.anchor ?? 'middle'}" dominant-baseline="middle" font-size="${o.size ?? 15}" fill="${o.fill ?? INK}"${o.bold ? ' font-weight="bold"' : ''}>${esc(s)}</text>`;
const L = (a: P, b: P, o: { dash?: boolean; color?: string; w?: number } = {}) => `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${o.color ?? LINE}" stroke-width="${o.w ?? 2.5}"${o.dash ? ' stroke-dasharray="6 5"' : ''} stroke-linecap="round"/>`;
const poly = (pts: P[], o: { fill?: string; dash?: boolean } = {}) => `<polygon points="${pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}" fill="${o.fill ?? FILL}" stroke="${LINE}" stroke-width="2.5" stroke-linejoin="round"${o.dash ? ' stroke-dasharray="6 5"' : ''}/>`;
const dot = (p: P, c = INK) => `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="4.5" fill="${c}"/>`;
const rad = (d: number) => (d * Math.PI) / 180;
/** Arc (math angles, counter-clockwise from +x; SVG y is down) */
const arc = (c: P, r: number, a1: number, a2: number, color = ACC) => { const p1: P = [c[0] + r * Math.cos(rad(a1)), c[1] - r * Math.sin(rad(a1))], p2: P = [c[0] + r * Math.cos(rad(a2)), c[1] - r * Math.sin(rad(a2))];
  return `<path d="M${f(p1[0])} ${f(p1[1])} A${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 0 ${f(p2[0])} ${f(p2[1])}" fill="none" stroke="${color}" stroke-width="2"/>`; };
const rightMark = (v: P, a: P, b: P, s = 14) => { const u = (p: P): P => { const dx = p[0] - v[0], dy = p[1] - v[1], n = Math.hypot(dx, dy) || 1; return [dx / n, dy / n]; }; const ua = u(a), ub = u(b);
  return `<path d="M${f(v[0] + ua[0] * s)} ${f(v[1] + ua[1] * s)} L${f(v[0] + (ua[0] + ub[0]) * s)} ${f(v[1] + (ua[1] + ub[1]) * s)} L${f(v[0] + ub[0] * s)} ${f(v[1] + ub[1] * s)}" fill="none" stroke="${ACC}" stroke-width="2"/>`; };
const strs = (v: any, min: number, max: number) => Array.isArray(v) && v.length >= min && v.length <= max && v.every((x) => typeof x === 'string' && x.trim());
const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

/* ---------------- angle ---------------- */
export function validateAngle(d: any): string | null {
  const deg = num(d.degrees); if (deg == null || deg <= 0 || deg > 360) return 'angle: degrees must be a number between 0 and 360';
  if (d.parts != null) { if (!Array.isArray(d.parts) || d.parts.length < 2 || d.parts.length > 4) return 'angle: parts must list 2-4 adjacent angles';
    const ns = d.parts.map((p: any) => num(p?.degrees)); const known = ns.filter((x: any) => x != null) as number[]; const sum = known.reduce((a, b) => a + b, 0);
    if (known.some((x) => x <= 0)) return 'angle: each part must be positive';
    if (known.length === ns.length && !near(sum, deg)) return `angle: parts add up to ${sum}°, not ${deg}°`;
    if (known.length < ns.length && sum >= deg) return `angle: known parts (${sum}°) leave nothing for the unknown part of ${deg}°`;
    if (ns.length - known.length > 1) return 'angle: at most one part may be unknown'; }
  return null;
}
function renderAngle(d: any) {
  const deg = num(d.degrees)!; const W = 560, H = deg > 180 ? 440 : 360, v: P = [deg > 90 ? 280 : 170, deg > 180 ? 220 : 290], R = deg > 180 ? 170 : 210;
  const ray = (a: number): P => [v[0] + R * Math.cos(rad(a)), v[1] - R * Math.sin(rad(a))];
  const [n1, n2] = Array.isArray(d.arms) ? d.arms : ['A', 'B']; let out = L(v, ray(0)) + L(v, ray(deg)) + dot(v);
  out += T(ray(0)[0] + 16, ray(0)[1], n1 ?? '', { bold: true }) + T(ray(deg)[0] + 14 * Math.cos(rad(deg)), ray(deg)[1] - 16 * Math.sin(rad(deg)), n2 ?? '', { bold: true }) + T(v[0] - 14, v[1] + 18, d.vertex ?? 'O', { bold: true });
  if (Array.isArray(d.parts)) { const ns = d.parts.map((p: any) => num(p?.degrees)); const miss = deg - ns.reduce((a: number, b: any) => a + (b ?? 0), 0); let a0 = 0;
    d.parts.forEach((p: any, i: number) => { const a = ns[i] ?? miss, r = 55 + i * 18, mid = a0 + a / 2; out += arc(v, r, a0, a0 + a, i % 2 ? '#7c3aed' : ACC);
      if (i > 0) out += L(v, ray(a0), { color: LINE }); out += T(v[0] + (r + 32) * Math.cos(rad(mid)), v[1] - (r + 32) * Math.sin(rad(mid)), p.label ?? `${a}°`, { size: 14, fill: i % 2 ? '#7c3aed' : ACC, bold: true }); a0 += a; });
  } else if (deg === 90) out += rightMark(v, ray(0), ray(90), 22) + T(v[0] + 56, v[1] - 56, d.label ?? '90°', { fill: ACC, bold: true });
  else { out += arc(v, 60, 0, deg); out += T(v[0] + 92 * Math.cos(rad(deg / 2)), v[1] - 92 * Math.sin(rad(deg / 2)), d.label ?? `${deg}°`, { fill: ACC, bold: true }); }
  return svgFrame(W, H, d.title ?? 'Angle', out);
}

/* ---------------- polygon ---------------- */
const SHAPES = ['triangle', 'rectangle', 'square', 'parallelogram', 'rhombus', 'trapezium', 'kite', 'regular', 'polygon'];
export function validatePolygon(d: any): string | null {
  if (!strs(d.vertices, 3, 8)) return 'polygon: vertices must be 3-8 labels'; const n = d.vertices.length;
  if (d.shape && !SHAPES.includes(d.shape)) return `polygon: unknown shape "${d.shape}"`;
  if (['rectangle', 'square', 'parallelogram', 'rhombus', 'trapezium', 'kite'].includes(d.shape) && n !== 4) return `polygon: a ${d.shape} has 4 vertices`;
  if (d.shape === 'triangle' && n !== 3) return 'polygon: a triangle has 3 vertices';
  if (d.sides != null && (!Array.isArray(d.sides) || d.sides.length > n)) return 'polygon: sides must have at most one label per side';
  if (d.angles != null && (!Array.isArray(d.angles) || d.angles.length > n)) return 'polygon: angles must have at most one label per vertex';
  const s = (d.sides ?? []).map(num), a = (d.angles ?? []).map(num);
  if (s.some((x: any) => x != null && x <= 0)) return 'polygon: side lengths must be positive';
  if (a.some((x: any) => x != null && (x <= 0 || x >= 360))) return 'polygon: angles must be between 0° and 360°';
  const total = (n - 2) * 180, known = a.filter((x: any) => x != null) as number[];
  if (known.length === n && !near(known.reduce((p, q) => p + q, 0), total)) return `polygon: interior angles add up to ${known.reduce((p, q) => p + q, 0)}°, but a ${n}-sided shape has ${total}°`;
  if (known.length && known.reduce((p, q) => p + q, 0) >= total + 0.5 && known.length < n) return `polygon: known angles already exceed ${total}°`;
  const ra: string[] = Array.isArray(d.rightAngles) ? d.rightAngles : [];
  for (const v of ra) { const i = d.vertices.indexOf(v); if (i < 0) return `polygon: right angle at unknown vertex ${v}`; if (a[i] != null && !near(a[i], 90)) return `polygon: ${v} is marked as a right angle but labelled ${a[i]}°`; }
  if (n === 3) { if (s.length === 3 && s.every((x: any) => x != null)) { const [p, q, r] = s as number[]; if (p + q <= r || p + r <= q || q + r <= p) return `triangle: sides ${p}, ${q}, ${r} break the triangle inequality`;
      if (ra.length === 1) { const i = d.vertices.indexOf(ra[0]); const hyp = s[(i + 1) % 3] as number, legs = [s[i], s[(i + 2) % 3]] as number[]; // side opposite vertex i is side (i+1)
        if (Math.abs(hyp * hyp - legs[0] ** 2 - legs[1] ** 2) > 0.02 * hyp * hyp) return `triangle: right angle at ${ra[0]} but ${legs[0]}² + ${legs[1]}² ≠ ${hyp}²`; } }
    if (ra.length > 1) return 'triangle: only one right angle is possible'; }
  if (['rectangle', 'square'].includes(d.shape) && known.some((x) => !near(x, 90))) return `polygon: every angle of a ${d.shape} is 90°`;
  if (['rectangle', 'parallelogram', 'square', 'rhombus'].includes(d.shape)) { for (const [i, j] of [[0, 2], [1, 3]]) if (s[i] != null && s[j] != null && !near(s[i], s[j], 1e-6)) return `polygon: opposite sides of a ${d.shape} must be equal (${s[i]} vs ${s[j]})`; }
  if (['square', 'rhombus', 'regular'].includes(d.shape)) { const ks = s.filter((x: any) => x != null); if (ks.some((x: number) => !near(x, ks[0], 1e-6))) return `polygon: all sides of a ${d.shape} must be equal`; }
  return null;
}
function polygonPoints(d: any): P[] {
  const n = d.vertices.length, s = (d.sides ?? []).map(num), a = (d.angles ?? []).map(num); const ra: string[] = d.rightAngles ?? [];
  if (n === 3) { // side i joins vertex i -> i+1; angle i at vertex i. Place A at origin, B on +x.
    let A0: number | null = a[0] ?? null, B0: number | null = a[1] ?? null; const C0 = a[2] ?? null;
    const ri = ra.length ? d.vertices.indexOf(ra[0]) : -1; if (ri === 0) A0 = 90; if (ri === 1) B0 = 90;
    if (s.length === 3 && s.every((x: any) => x != null)) { const [c, aa, b] = s as number[]; const x = (c * c + b * b - aa * aa) / (2 * c); return [[0, 0], [c, 0], [x, Math.sqrt(Math.max(0, b * b - x * x))]]; }
    if (ri === 2) { const leg1 = s[1] ?? 4, leg2 = s[2] ?? 3; return [[0, 0], [Math.hypot(leg1, leg2), 0], [leg2 * leg2 / Math.hypot(leg1, leg2), leg1 * leg2 / Math.hypot(leg1, leg2)]]; }
    if (A0 == null && B0 == null && C0 != null) A0 = (180 - C0) / 2; if (A0 == null) A0 = B0 != null && C0 != null ? 180 - B0 - C0 : 62; if (B0 == null) B0 = C0 != null ? 180 - A0 - C0 : Math.min(55, 170 - A0);
    const c = s[0] ?? 6, C = 180 - A0 - B0, b = (c * Math.sin(rad(B0))) / Math.sin(rad(C)); return [[0, 0], [c, 0], [b * Math.cos(rad(A0)), b * Math.sin(rad(A0))]]; }
  if (n === 4 && d.shape && d.shape !== 'regular' && d.shape !== 'polygon') { const w = s[0] ?? s[2] ?? 6, h0 = s[1] ?? s[3] ?? (d.shape === 'square' || d.shape === 'rhombus' ? w : 4); const ang = a[0] ?? (['parallelogram', 'rhombus'].includes(d.shape) ? 65 : 90);
    if (d.shape === 'rectangle' || d.shape === 'square') return [[0, 0], [w, 0], [w, d.shape === 'square' ? w : h0], [0, d.shape === 'square' ? w : h0]];
    if (d.shape === 'parallelogram' || d.shape === 'rhombus') { const side = d.shape === 'rhombus' ? w : h0; return [[0, 0], [w, 0], [w + side * Math.cos(rad(ang)), side * Math.sin(rad(ang))], [side * Math.cos(rad(ang)), side * Math.sin(rad(ang))]]; }
    if (d.shape === 'trapezium') { const top = s[2] ?? w * 0.6, h = num(d.height) ?? h0 * 0.85; return [[0, 0], [w, 0], [(w + top) / 2, h], [(w - top) / 2, h]]; }
    return [[0, 0], [w / 2, -h0 * 0.6], [w, 0], [w / 2, h0 * 1.2]]; } // kite
  return Array.from({ length: n }, (_, i) => [Math.cos(rad(-90 - 180 / n + (360 * i) / n)) * 5, -Math.sin(rad(-90 - 180 / n + (360 * i) / n)) * 5] as P);
}
function renderPolygon(d: any) {
  const raw = polygonPoints(d); const W = 560, H = 380, xs = raw.map((p) => p[0]), ys = raw.map((p) => p[1]);
  const sc = Math.min(400 / (Math.max(...xs) - Math.min(...xs) || 1), 250 / (Math.max(...ys) - Math.min(...ys) || 1));
  const pts: P[] = raw.map(([x, y]) => [(x - (Math.min(...xs) + Math.max(...xs)) / 2) * sc + W / 2, H / 2 + 25 - (y - (Math.min(...ys) + Math.max(...ys)) / 2) * sc]);
  const c: P = [pts.reduce((p, q) => p + q[0], 0) / pts.length, pts.reduce((p, q) => p + q[1], 0) / pts.length]; let out = poly(pts);
  const ra: string[] = d.rightAngles ?? [], n = pts.length;
  pts.forEach((p, i) => { const prev = pts[(i + n - 1) % n], next = pts[(i + 1) % n]; const v = d.vertices[i];
    const ox = p[0] - c[0], oy = p[1] - c[1], on = Math.hypot(ox, oy) || 1; out += T(p[0] + (ox / on) * 20, p[1] + (oy / on) * 20, v, { bold: true, size: 16 });
    if (ra.includes(v) || (['rectangle', 'square'].includes(d.shape))) out += rightMark(p, prev, next, 16);
    const al = d.angles?.[i]; if (al != null && al !== '' && !ra.includes(v)) { const a1 = Math.atan2(-(next[1] - p[1]), next[0] - p[0]) * 180 / Math.PI, a2 = Math.atan2(-(prev[1] - p[1]), prev[0] - p[0]) * 180 / Math.PI;
      let s1 = a1, s2 = a2; if (((s2 - s1) % 360 + 360) % 360 > 180) [s1, s2] = [a2, a1]; const e = s1 + (((s2 - s1) % 360 + 360) % 360); out += arc(p, 28, s1, e); const mid = rad((s1 + e) / 2);
      out += T(p[0] + 50 * Math.cos(mid), p[1] - 50 * Math.sin(mid), lbl(al, '°'), { size: 14, fill: ACC, bold: true }); } });
  (d.sides ?? []).forEach((s: any, i: number) => { if (s == null || s === '') return; const a = pts[i], b = pts[(i + 1) % n]; const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const nn = Math.hypot(nx, ny) || 1; nx /= nn; ny /= nn; if ((m[0] + nx - c[0]) ** 2 + (m[1] + ny - c[1]) ** 2 < (m[0] - c[0]) ** 2 + (m[1] - c[1]) ** 2) { nx = -nx; ny = -ny; }
    out += T(m[0] + nx * 20, m[1] + ny * 20, lbl(s, d.unit ? ` ${d.unit}` : ''), { size: 15, fill: '#1d4ed8', bold: true }); });
  return svgFrame(W, H, d.title ?? 'Shape', out);
}

/* ---------------- solids and nets ---------------- */
const SOLIDS = ['cube', 'cuboid', 'triangular_prism', 'cylinder', 'cone', 'square_pyramid'];
export function validateSolid(d: any): string | null {
  if (!SOLIDS.includes(d.shape)) return `solid: shape must be one of ${SOLIDS.join(', ')}`;
  const dm = d.dimensions ?? {}; if (typeof dm !== 'object') return 'solid: dimensions must be an object';
  for (const [k, v] of Object.entries(dm)) if (v != null && v !== '' && num(v) != null && num(v)! <= 0) return `solid: ${k} must be positive`;
  if (d.shape === 'cube') { const ks = ['length', 'width', 'height'].map((k) => num(dm[k])).filter((x) => x != null) as number[]; if (ks.some((x) => x !== ks[0])) return 'solid: every edge of a cube is equal'; }
  return null;
}
function renderSolid(d: any) {
  const dm = d.dimensions ?? {}, u = d.unit ? ` ${d.unit}` : ''; const g = (k: string, def: number) => num(dm[k]) ?? def; const lab = (k: string) => (dm[k] != null && dm[k] !== '' ? lbl(dm[k], u) : '');
  const showNet = d.net !== false; const W = showNet ? 760 : 420, H = 400; let out = '';
  const fit = (pts: P[], box: [number, number, number, number]) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); const s = Math.min((box[2] - 30) / (Math.max(...xs) - Math.min(...xs) || 1), (box[3] - 40) / (Math.max(...ys) - Math.min(...ys) || 1));
    const ox = box[0] + box[2] / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * s, oy = box[1] + box[3] / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * s; return (p: P): P => [ox + p[0] * s, oy + p[1] * s]; };
  const left: [number, number, number, number] = [60, 50, 340, 330], right: [number, number, number, number] = [420, 50, 330, 330];
  const sh = d.shape;
  if (sh === 'cube' || sh === 'cuboid') { const l = g('length', sh === 'cube' ? g('height', 4) : 6), w = sh === 'cube' ? l : g('width', 3), h = sh === 'cube' ? l : g('height', 4), dx = w * 0.55, dy = -w * 0.4;
    const F: P[] = [[0, 0], [l, 0], [l, -h], [0, -h]], B: P[] = F.map(([x, y]) => [x + dx, y + dy]); const t = fit([...F, ...B], left);
    out += poly([F[3], F[2], B[2], B[3]].map(t), { fill: '#d1fae5' }) + poly([F[1], B[1], B[2], F[2]].map(t), { fill: '#a7f3d0' }) + poly(F.map(t));
    out += L(t(F[0]), t(B[0]), { dash: true, w: 1.5 }) + L(t(B[0]), t(B[1]), { dash: true, w: 1.5 }) + L(t(B[0]), t(B[3]), { dash: true, w: 1.5 });
    const ll = sh === 'cube' ? lab('length') || lab('height') || lab('width') : lab('length'); out += T((t(F[0])[0] + t(F[1])[0]) / 2, t(F[0])[1] + 18, ll, { fill: '#1d4ed8', bold: true });
    out += T(t(F[0])[0] - 10, (t(F[0])[1] + t(F[3])[1]) / 2, sh === 'cube' ? '' : lab('height'), { fill: '#1d4ed8', bold: true, anchor: 'end' }) + T((t(F[1])[0] + t(B[1])[0]) / 2 + 12, (t(F[1])[1] + t(B[1])[1]) / 2 + 8, sh === 'cube' ? '' : lab('width'), { fill: '#1d4ed8', bold: true, anchor: 'start' });
    if (showNet) { const R = (x: number, y: number, a: number, b: number): P[] => [[x, y], [x + a, y], [x + a, y + b], [x, y + b]]; const faces = [R(0, w, w, h), R(w, w, l, h), R(w + l, w, w, h), R(2 * w + l, w, l, h), R(w, 0, l, w), R(w, w + h, l, w)];
      const t2 = fit(faces.flat(), right); out += faces.map((fc, i) => poly(fc.map(t2), { fill: i === 1 ? '#d1fae5' : FILL })).join(''); } }
  else if (sh === 'triangular_prism') { const b = g('base', 4), th = g('triangleHeight', g('height', 3)), len = g('length', 6), dx = len * 0.6, dy = -len * 0.35;
    const Tr: P[] = [[0, 0], [b, 0], [b / 2, -th]], Bk: P[] = Tr.map(([x, y]) => [x + dx, y + dy]); const t = fit([...Tr, ...Bk], left);
    out += poly([Tr[1], Bk[1], Bk[2], Tr[2]].map(t), { fill: '#a7f3d0' }) + poly(Tr.map(t)) + L(t(Tr[0]), t(Bk[0]), { dash: true, w: 1.5 }) + L(t(Bk[0]), t(Bk[1]), { dash: true, w: 1.5 }) + L(t(Bk[0]), t(Bk[2]), { dash: true, w: 1.5 });
    out += T((t(Tr[0])[0] + t(Tr[1])[0]) / 2, t(Tr[0])[1] + 18, lab('base'), { fill: '#1d4ed8', bold: true }) + T((t(Tr[1])[0] + t(Bk[1])[0]) / 2 + 12, (t(Tr[1])[1] + t(Bk[1])[1]) / 2 + 8, lab('length'), { fill: '#1d4ed8', bold: true, anchor: 'start' });
    out += L(t(Tr[2]), t([b / 2, 0]), { dash: true, color: ACC, w: 1.5 }) + T(t([b / 2, 0])[0] - 8, (t(Tr[2])[1] + t(Tr[0])[1]) / 2 + 10, lab('triangleHeight') || lab('height'), { fill: ACC, bold: true, anchor: 'end', size: 13 });
    if (showNet) { const sl = Math.hypot(b / 2, th); const rs: P[][] = [[[0, 0], [len, 0], [len, sl], [0, sl]], [[0, sl], [len, sl], [len, sl + b], [0, sl + b]], [[0, sl + b], [len, sl + b], [len, 2 * sl + b], [0, 2 * sl + b]]];
      const tri1: P[] = [[0, sl], [0, sl + b], [-th, sl + b / 2]], tri2: P[] = [[len, sl], [len, sl + b], [len + th, sl + b / 2]]; const t2 = fit([...rs.flat(), ...tri1, ...tri2], right);
      out += rs.map((r, i) => poly(r.map(t2), { fill: i === 1 ? '#d1fae5' : FILL })).join('') + poly(tri1.map(t2), { fill: '#fef3c7' }) + poly(tri2.map(t2), { fill: '#fef3c7' }); } }
  else if (sh === 'cylinder' || sh === 'cone') { const r = g('radius', 2), h = g('height', 5); const t = fit([[-r, 0], [r, 0], [r, -h], [-r, -h], [-r, r * 0.35], [r, -h - r * 0.35]], left); const c0 = t([0, 0]), ch = t([0, -h]), rx = t([r, 0])[0] - c0[0], ry = rx * 0.32;
    if (sh === 'cylinder') out += `<path d="M${f(c0[0] - rx)} ${f(ch[1])} L${f(c0[0] - rx)} ${f(c0[1])} A${f(rx)} ${f(ry)} 0 0 0 ${f(c0[0] + rx)} ${f(c0[1])} L${f(c0[0] + rx)} ${f(ch[1])}" fill="${FILL}" stroke="${LINE}" stroke-width="2.5"/><path d="M${f(c0[0] - rx)} ${f(c0[1])} A${f(rx)} ${f(ry)} 0 0 1 ${f(c0[0] + rx)} ${f(c0[1])}" fill="none" stroke="${LINE}" stroke-width="1.5" stroke-dasharray="6 5"/><ellipse cx="${f(ch[0])}" cy="${f(ch[1])}" rx="${f(rx)}" ry="${f(ry)}" fill="#d1fae5" stroke="${LINE}" stroke-width="2.5"/>` + L(ch, [ch[0] + rx, ch[1]], { color: ACC, w: 2 }) + T(ch[0] + rx / 2, ch[1] - 12, lab('radius'), { fill: ACC, bold: true });
    else out += `<path d="M${f(c0[0] - rx)} ${f(c0[1])} L${f(ch[0])} ${f(ch[1])} L${f(c0[0] + rx)} ${f(c0[1])} A${f(rx)} ${f(ry)} 0 0 1 ${f(c0[0] - rx)} ${f(c0[1])}" fill="${FILL}" stroke="${LINE}" stroke-width="2.5"/><path d="M${f(c0[0] - rx)} ${f(c0[1])} A${f(rx)} ${f(ry)} 0 0 1 ${f(c0[0] + rx)} ${f(c0[1])}" fill="none" stroke="${LINE}" stroke-width="1.5" stroke-dasharray="6 5"/>` + L(c0, [c0[0] + rx, c0[1]], { color: ACC, w: 2 }) + T(c0[0] + rx / 2, c0[1] + 16, lab('radius'), { fill: ACC, bold: true }) + L(c0, ch, { dash: true, color: ACC, w: 1.5 });
    out += T(c0[0] + (sh === 'cylinder' ? rx + 12 : 10), (c0[1] + ch[1]) / 2, lab('height'), { fill: '#1d4ed8', bold: true, anchor: 'start' });
    if (showNet && sh === 'cylinder') { const C = 2 * Math.PI * r; const rect: P[] = [[0, 0], [C, 0], [C, h], [0, h]]; const t2 = fit([...rect, [C / 2 - r, -2 * r], [C / 2 + r, h + 2 * r]], right); const s2 = t2([1, 0])[0] - t2([0, 0])[0];
      out += poly(rect.map(t2)) + `<circle cx="${f(t2([C / 2, -r])[0])}" cy="${f(t2([C / 2, -r])[1])}" r="${f(r * s2)}" fill="#d1fae5" stroke="${LINE}" stroke-width="2.5"/><circle cx="${f(t2([C / 2, h + r])[0])}" cy="${f(t2([C / 2, h + r])[1])}" r="${f(r * s2)}" fill="#d1fae5" stroke="${LINE}" stroke-width="2.5"/>` + T(t2([C / 2, h])[0], t2([C / 2, h])[1] - 14, 'length = 2πr', { size: 13, fill: '#1d4ed8' }); }
    if (showNet && sh === 'cone') { const sl = Math.hypot(r, h), sweep = (360 * r) / sl; const t2 = fit([[-sl, -sl], [sl, sl * 0.2], [0, sl + 2 * r]], right); const o = t2([0, 0]), s2 = t2([1, 0])[0] - o[0];
      const a1 = 270 - sweep / 2, a2 = 270 + sweep / 2; const p1: P = [o[0] + sl * s2 * Math.cos(rad(a1)), o[1] - sl * s2 * Math.sin(rad(a1))], p2: P = [o[0] + sl * s2 * Math.cos(rad(a2)), o[1] - sl * s2 * Math.sin(rad(a2))];
      out += `<path d="M${f(o[0])} ${f(o[1])} L${f(p1[0])} ${f(p1[1])} A${f(sl * s2)} ${f(sl * s2)} 0 ${sweep > 180 ? 1 : 0} 0 ${f(p2[0])} ${f(p2[1])} Z" fill="${FILL}" stroke="${LINE}" stroke-width="2.5"/><circle cx="${f(o[0])}" cy="${f(o[1] + (sl + r) * s2)}" r="${f(r * s2)}" fill="#d1fae5" stroke="${LINE}" stroke-width="2.5"/>`; } }
  else { const b = g('base', 4), h = g('height', 5), dx = b * 0.5, dy = -b * 0.35; const F: P[] = [[0, 0], [b, 0], [b + dx, dy], [dx, dy]], apex: P = [b / 2 + dx / 2, -h]; const t = fit([...F, apex], left);
    out += poly([F[0], F[1], apex].map(t)) + poly([F[1], F[2], apex].map(t), { fill: '#a7f3d0' }) + L(t(F[0]), t(F[3]), { dash: true, w: 1.5 }) + L(t(F[3]), t(F[2]), { dash: true, w: 1.5 }) + L(t(F[3]), t(apex), { dash: true, w: 1.5 });
    out += T((t(F[0])[0] + t(F[1])[0]) / 2, t(F[0])[1] + 18, lab('base'), { fill: '#1d4ed8', bold: true }) + L(t(apex), t([b / 2 + dx / 2, dy / 2]), { dash: true, color: ACC, w: 1.5 }) + T(t(apex)[0] + 8, (t(apex)[1] + t([0, dy / 2])[1]) / 2, lab('height'), { fill: ACC, bold: true, anchor: 'start' });
    if (showNet) { const sl = Math.hypot(h, b / 2); const sq: P[] = [[0, 0], [b, 0], [b, b], [0, b]]; const tris: P[][] = [[[0, 0], [b, 0], [b / 2, -sl]], [[b, 0], [b, b], [b + sl, b / 2]], [[b, b], [0, b], [b / 2, b + sl]], [[0, b], [0, 0], [-sl, b / 2]]];
      const t2 = fit([...sq, ...tris.flat()], right); out += poly(sq.map(t2), { fill: '#d1fae5' }) + tris.map((tr) => poly(tr.map(t2), { fill: '#fef3c7' })).join(''); } }
  if (showNet) out += T(210, H + 8, 'Solid', { size: 13, fill: '#475569' }) + T(585, H + 8, 'Net', { size: 13, fill: '#475569' }) + `<line x1="412" y1="60" x2="412" y2="${H - 30}" stroke="#e2e8f0" stroke-width="2"/>`;
  return svgFrame(W, showNet ? H + 20 : H, d.title ?? 'Solid', out);
}

/* ---------------- coordinate grid ---------------- */
const range = (v: any) => Array.isArray(v) && v.length === 2 && v.every((x) => Number.isInteger(x)) && v[0] < v[1] && v[1] - v[0] <= 24;
export function validateCoordinate(d: any): string | null {
  if (!range(d.x) || !range(d.y)) return 'coordinate: x and y must be [min, max] integer ranges (span ≤ 24)';
  if (!Array.isArray(d.points) || d.points.length < 1 || d.points.length > 12) return 'coordinate: 1-12 points';
  for (const p of d.points) { if (typeof p?.x !== 'number' || typeof p?.y !== 'number') return 'coordinate: each point needs numeric x and y';
    if (p.x < d.x[0] || p.x > d.x[1] || p.y < d.y[0] || p.y > d.y[1]) return `coordinate: point ${p.label ?? ''}(${p.x}, ${p.y}) is outside the grid`; }
  const names = new Set(d.points.map((p: any) => p.label)); for (const s of d.segments ?? []) if (!Array.isArray(s) || s.length !== 2 || !names.has(s[0]) || !names.has(s[1])) return 'coordinate: segments must join two labelled points';
  return null;
}
function renderCoordinate(d: any) {
  const [x0, x1] = d.x, [y0, y1] = d.y; const cell = Math.min(440 / (x1 - x0), 380 / (y1 - y0), 44); const W = (x1 - x0) * cell + 90, H = (y1 - y0) * cell + 110;
  const P_ = (x: number, y: number): P => [50 + (x - x0) * cell, 60 + (y1 - y) * cell]; let out = '';
  for (let x = x0; x <= x1; x++) out += L(P_(x, y0), P_(x, y1), { color: '#e2e8f0', w: 1 }) + (x !== 0 ? T(P_(x, 0 >= y0 && 0 <= y1 ? 0 : y0)[0], P_(x, 0 >= y0 && 0 <= y1 ? 0 : y0)[1] + 14, x, { size: 11, fill: '#475569' }) : '');
  for (let y = y0; y <= y1; y++) out += L(P_(x0, y), P_(x1, y), { color: '#e2e8f0', w: 1 }) + (y !== 0 ? T(P_(0 >= x0 && 0 <= x1 ? 0 : x0, y)[0] - 10, P_(0, y)[1], y, { size: 11, fill: '#475569', anchor: 'end' }) : '');
  const ax = 0 >= y0 && 0 <= y1 ? 0 : y0, ay = 0 >= x0 && 0 <= x1 ? 0 : x0;
  out += L(P_(x0, ax), P_(x1, ax), { color: INK, w: 1.8 }) + L(P_(ay, y0), P_(ay, y1), { color: INK, w: 1.8 }) + T(P_(x1, ax)[0] + 14, P_(x1, ax)[1], 'x', { bold: true }) + T(P_(ay, y1)[0], P_(ay, y1)[1] - 12, 'y', { bold: true });
  if (ax === 0 && ay === 0) out += T(P_(0, 0)[0] - 9, P_(0, 0)[1] + 13, '0', { size: 11, fill: '#475569' });
  const byName = new Map(d.points.map((p: any) => [p.label, p]));
  if (d.polygon && d.points.length >= 3) out += poly(d.points.map((p: any) => P_(p.x, p.y)), { fill: 'rgba(16,185,129,0.15)' });
  for (const [a, b] of d.segments ?? []) { const p: any = byName.get(a), q: any = byName.get(b); out += L(P_(p.x, p.y), P_(q.x, q.y), { color: '#1d4ed8' }); }
  for (const p of d.points) { const c = P_(p.x, p.y); out += dot(c, '#be123c') + T(c[0] + 8, c[1] - 12, `${p.label ?? ''}(${p.x}, ${p.y})`, { size: 13, anchor: 'start', bold: true, fill: '#be123c' }); }
  return svgFrame(W, H, d.title ?? 'Coordinate grid', out);
}

/* ---------------- number line ---------------- */
export function validateNumberline(d: any): string | null {
  const a = num(d.min), b = num(d.max), st = num(d.step ?? 1); if (a == null || b == null || a >= b) return 'numberline: min must be less than max';
  if (st == null || st <= 0 || (b - a) / st > 24) return 'numberline: step must be positive with at most 24 intervals';
  for (const p of d.points ?? []) { const v = num(p?.value); if (v == null || v < a || v > b) return `numberline: point ${p?.label ?? p?.value} is off the line`; }
  for (const r of d.ranges ?? []) { const x = num(r?.from), y = num(r?.to); if (x == null || y == null || x >= y || x < a || y > b) return 'numberline: each range needs from < to within the line'; }
  return null;
}
function renderNumberline(d: any) {
  const a = num(d.min)!, b = num(d.max)!, st = num(d.step ?? 1)!; const W = 640, H = 200, X = (v: number) => 40 + ((v - a) / (b - a)) * (W - 80), Y = 120; let out = L([20, Y], [W - 20, Y], { color: INK, w: 2 });
  out += `<path d="M${W - 20} ${Y}l-10 -6v12z M20 ${Y}l10 -6v12z" fill="${INK}"/>`;
  for (let v = a, i = 0; v <= b + 1e-9 && i < 30; v += st, i++) out += L([X(v), Y - 8], [X(v), Y + 8], { color: INK, w: 1.5 }) + T(X(v), Y + 24, f(v), { size: 13 });
  for (const r of d.ranges ?? []) { const x = num(r.from)!, y = num(r.to)!; out += L([X(x), Y - 26], [X(y), Y - 26], { color: '#1d4ed8', w: 4 }) + [[x, r.fromOpen], [y, r.toOpen]].map(([v, o]) => `<circle cx="${f(X(v as number))}" cy="${Y - 26}" r="7" fill="${o ? '#fff' : '#1d4ed8'}" stroke="#1d4ed8" stroke-width="2.5"/>`).join(''); }
  for (const p of d.points ?? []) { const v = num(p.value)!; out += `<circle cx="${f(X(v))}" cy="${Y}" r="7" fill="${p.open ? '#fff' : '#be123c'}" stroke="#be123c" stroke-width="2.5"/>` + T(X(v), Y - 52, p.label ?? v, { size: 14, bold: true, fill: '#be123c' }); }
  return svgFrame(W, H, d.title ?? 'Number line', out);
}

/* ---------------- bar chart ---------------- */
export function validateBar(d: any): string | null {
  if (!strs(d.categories, 1, 12)) return 'bar: 1-12 category labels';
  if (!Array.isArray(d.values) || d.values.length !== d.categories.length || d.values.some((v: any) => typeof v !== 'number' || !isFinite(v) || v < 0)) return 'bar: one non-negative number per category';
  return null;
}
function renderBar(d: any) {
  const n = d.categories.length, max = Math.max(...d.values, 1); const step = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : max / Math.pow(10, Math.floor(Math.log10(max))) > 2 ? 1 : 0.5);
  const top = Math.ceil(max / step) * step, W = Math.max(420, n * 70 + 110), H = 380, x0 = 70, y0 = 310, ph = 240, bw = ((W - x0 - 20) / n) * 0.62; let out = '';
  for (let v = 0; v <= top + 1e-9; v += step) { const y = y0 - (v / top) * ph; out += L([x0, y], [W - 20, y], { color: '#e2e8f0', w: 1 }) + T(x0 - 8, y, f(v), { size: 12, anchor: 'end', fill: '#475569' }); }
  d.values.forEach((v: number, i: number) => { const cx = x0 + ((i + 0.5) * (W - x0 - 20)) / n, h = (v / top) * ph; out += `<rect x="${f(cx - bw / 2)}" y="${f(y0 - h)}" width="${f(bw)}" height="${f(h)}" fill="${LINE}" rx="3"/>` + T(cx, y0 - h - 10, f(v), { size: 12, bold: true }) + T(cx, y0 + 16, String(d.categories[i]).slice(0, 12), { size: 12 }); });
  out += L([x0, y0], [W - 20, y0], { color: INK, w: 1.8 }) + L([x0, y0], [x0, y0 - ph - 10], { color: INK, w: 1.8 });
  if (d.xLabel) out += T((x0 + W) / 2, H - 22, d.xLabel, { size: 13, fill: '#334155' }); if (d.yLabel) out += `<text x="18" y="${y0 - ph / 2}" transform="rotate(-90 18 ${y0 - ph / 2})" text-anchor="middle" font-size="13" fill="#334155">${esc(d.yLabel)}</text>`;
  return svgFrame(W, H, d.title ?? 'Bar chart', out);
}

export const FIGURES: Record<string, { validate: (d: any) => string | null; render: (d: any) => string }> = {
  angle: { validate: validateAngle, render: renderAngle }, polygon: { validate: validatePolygon, render: renderPolygon }, solid: { validate: validateSolid, render: renderSolid },
  coordinate: { validate: validateCoordinate, render: renderCoordinate }, numberline: { validate: validateNumberline, render: renderNumberline }, bar: { validate: validateBar, render: renderBar },
};
/** Numbers shown on a figure (lengths, angles, dimensions, values) for cross-checking with worked examples. */
export function figureNumbers(d: any): number[] {
  const out: unknown[] = [];
  if (d.kind === 'angle') { out.push(d.label ?? d.degrees); for (const p of d.parts ?? []) out.push(p.label ?? p.degrees); }
  if (d.kind === 'polygon') out.push(...(d.sides ?? []), ...(d.angles ?? []));
  if (d.kind === 'solid') out.push(...Object.values(d.dimensions ?? {}));
  if (d.kind === 'numberline') out.push(...(d.points ?? []).map((p: any) => p.value));
  if (d.kind === 'bar') out.push(...(d.values ?? []));
  if (d.kind === 'coordinate') for (const p of d.points ?? []) out.push(p.x, p.y);
  return out.map(num).filter((x): x is number => x != null);
}
