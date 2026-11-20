import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui';

/** Overview charts (spec §5). Dependency-free, accessible: labelled figure, text summary, and a data table for every chart. */
export interface ChartData {
  key: string; title: string; type: 'line' | 'bar'; valueUnit: 'count' | 'usd' | 'percent';
  series?: { name: string; values: number[] }[]; items?: { label: string; value: number; n?: number; link?: string }[];
  note?: string; estimate?: boolean; link?: string;
}
const COLORS = ['#047857', '#1d4ed8', '#b45309', '#7c3aed'];
const DASH = ['', '6 4', '2 3', '10 3 2 3'];
export const fmt = (v: number, u: ChartData['valueUnit']) => (u === 'usd' ? `$${v.toFixed(v < 1 && v > 0 ? 4 : 2)}` : u === 'percent' ? `${v}%` : v.toLocaleString());
const label = (k: string, unit: string) => { const d = new Date(k + 'T00:00:00Z'); return unit === 'month' ? d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }); };
const niceMax = (m: number) => { if (m <= 0) return 1; const p = 10 ** Math.floor(Math.log10(m)); const n = m / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

export function ChartCard({ c, buckets, unit }: { c: ChartData; buckets: string[]; unit: string }) {
  const id = useId();
  return <Card className="min-w-0"><figure aria-labelledby={`${id}-t`} className="space-y-2">
    <div className="flex flex-wrap items-start justify-between gap-2"><h3 id={`${id}-t`} className="font-semibold">{c.title}{c.estimate && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">Estimate</span>}</h3>
      {c.link && <Link to={c.link} className="text-sm text-brand-700 underline">Open<span className="sr-only"> {c.title}</span></Link>}</div>
    {c.type === 'line' ? <Line c={c} buckets={buckets} unit={unit} /> : <Bars c={c} />}
    {c.note && <figcaption className="text-xs text-slate-600">{c.note}</figcaption>}
  </figure></Card>;
}

function Line({ c, buckets, unit }: { c: ChartData; buckets: string[]; unit: string }) {
  const series = c.series ?? []; const all = series.flatMap((s) => s.values);
  if (!all.some((v) => v > 0)) return <p className="py-6 text-center text-sm text-slate-600">No data in this period.</p>;
  const W = 560, H = 190, L = 44, R = 10, T = 10, Bm = 26; const max = niceMax(Math.max(...all));
  const X = (i: number) => L + (buckets.length < 2 ? (W - L - R) / 2 : (i * (W - L - R)) / (buckets.length - 1)); const Y = (v: number) => T + (H - T - Bm) * (1 - v / max);
  const ticks = [0, max / 2, max]; const xt = [...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])];
  const summary = series.map((s) => { const tot = s.values.reduce((a, b) => a + b, 0); const pk = Math.max(...s.values); return `${s.name}: total ${fmt(Math.round(tot * 10000) / 10000, c.valueUnit)}, peak ${fmt(pk, c.valueUnit)} on ${label(buckets[s.values.indexOf(pk)], unit)}`; }).join('; ');
  return <>
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${c.title}, ${label(buckets[0], unit)} to ${label(buckets[buckets.length - 1], unit)} by ${unit}. ${summary}.`}>
      {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#e2e8f0" /><text x={L - 6} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="#475569">{fmt(c.valueUnit === 'usd' ? v : Math.round(v), c.valueUnit)}</text></g>)}
      {xt.map((i) => <text key={i} x={X(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === buckets.length - 1 ? 'end' : 'middle'} fontSize="11" fill="#475569">{label(buckets[i], unit)}</text>)}
      {series.map((s, si) => <g key={s.name}><polyline fill="none" stroke={COLORS[si % 4]} strokeWidth="2.5" strokeDasharray={DASH[si % 4]} points={s.values.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} />
        {buckets.length <= 62 && s.values.map((v, i) => v > 0 && <circle key={i} cx={X(i)} cy={Y(v)} r="2.5" fill={COLORS[si % 4]} />)}</g>)}
    </svg>
    {series.length > 1 && <ul className="flex flex-wrap gap-3 text-xs" aria-label="Legend">{series.map((s, si) => <li key={s.name} className="flex items-center gap-1"><svg width="22" height="8" aria-hidden><line x1="0" x2="22" y1="4" y2="4" stroke={COLORS[si % 4]} strokeWidth="2.5" strokeDasharray={DASH[si % 4]} /></svg>{s.name}</li>)}</ul>}
    <details className="text-sm"><summary className="cursor-pointer text-brand-700 underline">Show data table<span className="sr-only">: {c.title}</span></summary>
      <div className="relative mt-2 max-h-64 overflow-auto" tabIndex={0} role="region" aria-label={`${c.title} data`}><table className="w-full text-left text-xs"><caption className="sr-only">{c.title} by {unit}</caption>
        <thead><tr><th scope="col" className="py-1 pr-2">{unit[0].toUpperCase() + unit.slice(1)} starting</th>{series.map((s) => <th key={s.name} scope="col" className="pr-2">{s.name}</th>)}</tr></thead>
        <tbody>{buckets.map((b, i) => <tr key={b} className="border-t"><th scope="row" className="py-0.5 pr-2 font-normal">{b}</th>{series.map((s) => <td key={s.name} className="pr-2">{fmt(s.values[i], c.valueUnit)}</td>)}</tr>)}</tbody></table></div></details>
  </>;
}

function Bars({ c }: { c: ChartData }) {
  const items = c.items ?? [];
  if (!items.length || !items.some((i) => i.value > 0)) return <p className="py-6 text-center text-sm text-slate-600">No data yet.</p>;
  const max = c.valueUnit === 'percent' ? 100 : Math.max(...items.map((i) => i.value));
  return <ul className="space-y-1.5 text-sm">{items.map((i) => <li key={i.label} className="grid grid-cols-[minmax(7rem,11rem)_1fr_auto] items-center gap-2">
    <span className="truncate" title={i.label}>{i.link ? <Link to={i.link} className="text-brand-700 underline">{i.label}</Link> : i.label}</span>
    <span className="h-3 rounded bg-slate-100" aria-hidden><span className="block h-3 rounded bg-brand-700" style={{ width: `${max ? Math.max(i.value ? 2 : 0, (100 * i.value) / max) : 0}%` }} /></span>
    <span className="whitespace-nowrap tabular-nums">{fmt(i.value, c.valueUnit)}{i.n != null && <span className="text-xs text-slate-600"> (n={i.n})</span>}</span></li>)}</ul>;
}
