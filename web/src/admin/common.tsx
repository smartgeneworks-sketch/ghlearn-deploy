import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { api } from '../lib/api';
import { Alert, Button, Card } from '../components/ui';

export const useConfig = (k: string, opts: { archived?: 'include' | 'only'; enabled?: boolean } = {}) => useQuery({
  queryKey: ['/api/config/' + k, opts.archived ?? ''], enabled: opts.enabled ?? true,
  queryFn: () => api<{ items: any[] }>(`/api/config/${k}${opts.archived ? `?archived=${opts.archived}` : ''}`).then((r) => r.items) });
export const when = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');
export const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
export const Section = ({ title, actions, children, id }: { title: string; actions?: ReactNode; children: ReactNode; id?: string }) => {
  const hid = id ?? `s-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return <Card><section aria-labelledby={hid} className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id={hid} className="font-semibold">{title}</h2>{actions}</div>{children}</section></Card>;
};
export const Facts = ({ items }: { items: [string, ReactNode][] }) => <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">{items.map(([k, v]) => [<dt key={k + 't'} className="font-medium text-slate-700">{k}</dt>, <dd key={k + 'd'}>{v}</dd>])}</dl>;
const TONES: Record<string, string> = { active: 'bg-green-100 text-green-900', suspended: 'bg-amber-100 text-amber-900', archived: 'bg-slate-200 text-slate-800', pending: 'bg-blue-100 text-blue-900',
  preview: 'bg-blue-100 text-blue-900', committed: 'bg-green-100 text-green-900', rolled_back: 'bg-slate-200 text-slate-800', failed: 'bg-red-100 text-red-900', cancelled: 'bg-slate-200 text-slate-800', inactive: 'bg-amber-100 text-amber-900' };
export const Badge = ({ v, label }: { v: string; label?: string }) => <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${TONES[v] ?? 'bg-slate-100 text-slate-800'}`}>{label ?? v.replace(/_/g, ' ')}</span>;

/** A one-time secret (temporary password): shown once, copyable, with the delivery warning. Never persisted client-side. */
export function OneTimeSecret({ value, who, onDone }: { value: string; who: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return <div role="status" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
    <p><strong>Temporary password for {who}.</strong> It is shown only now. Email is not configured, so give it to the user in person or by another secure channel. They must change it when they first sign in.</p>
    <div className="flex flex-wrap items-center gap-2"><code aria-label="Temporary password" className="rounded bg-white px-2 py-1 font-mono text-base">{value}</code>
      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => navigator.clipboard?.writeText(value).then(() => setCopied(true))}><Copy className="h-3 w-3" aria-hidden />{copied ? 'Copied' : 'Copy'}</Button>
      <Button className="px-2 py-1 text-xs" onClick={onDone}>Done, hide it</Button></div></div>;
}
/** Client-side CSV download (cells are guarded against spreadsheet formula injection). */
export function downloadCsv(name: string, head: string[], rows: unknown[][]) {
  const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); const t = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const blob = new Blob([[head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const ErrorBox = ({ error }: { error: unknown }) => (error ? <Alert>{(error as Error).message}</Alert> : null);
