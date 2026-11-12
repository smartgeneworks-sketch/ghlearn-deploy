/** Dependency-free accessible SVG charts. Each chart also renders its data as a visually hidden table. */
export function BarChart({ data, label, max = 100, suffix = '%', neutral }: { data: { label: string; value: number }[]; label: string; max?: number; suffix?: string; neutral?: boolean }) {
  const h = 26, W = 520, lw = 170;
  return <figure><svg viewBox={`0 0 ${W} ${data.length * h + 10}`} className="w-full" role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${d.value}${suffix}`).join(', ')}`}>
    {data.map((d, i) => { const w = ((W - lw - 50) * Math.max(0, Math.min(d.value, max))) / max; const col = neutral ? '#1d4ed8' : d.value >= 80 ? '#047857' : d.value >= 60 ? '#65a30d' : d.value >= 40 ? '#d97706' : '#dc2626';
      return <g key={i} transform={`translate(0 ${i * h + 5})`}><text x={lw - 6} y={16} textAnchor="end" fontSize="12" fill="#334155">{d.label.length > 26 ? d.label.slice(0, 25) + '…' : d.label}</text>
        <rect x={lw} y={3} width={W - lw - 50} height={16} rx={4} fill="#f1f5f9" /><rect x={lw} y={3} width={w} height={16} rx={4} fill={col} /><text x={lw + w + 4} y={16} fontSize="12" fill="#0f172a">{d.value}{suffix}</text></g>; })}
  </svg><figcaption className="sr-only">{label}</figcaption></figure>;
}
export function LineChart({ points, label }: { points: { x: string; y: number }[]; label: string }) {
  if (points.length < 2) return <p className="text-sm text-slate-500">Not enough attempts yet to show a trend.</p>;
  const W = 520, H = 160, p = 28; const X = (i: number) => p + (i * (W - 2 * p)) / (points.length - 1); const Y = (v: number) => H - p - ((H - 2 * p) * v) / 100;
  return <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label}: ${points.map((q) => `${q.x} ${q.y}%`).join(', ')}`}>
    {[0, 50, 100].map((v) => <g key={v}><line x1={p} x2={W - p} y1={Y(v)} y2={Y(v)} stroke="#e2e8f0" /><text x={4} y={Y(v) + 4} fontSize="10" fill="#64748b">{v}%</text></g>)}
    <polyline fill="none" stroke="#047857" strokeWidth="2.5" points={points.map((q, i) => `${X(i)},${Y(q.y)}`).join(' ')} />
    {points.map((q, i) => <circle key={i} cx={X(i)} cy={Y(q.y)} r="3.5" fill="#047857"><title>{`${q.x}: ${q.y}%`}</title></circle>)}</svg>;
}
