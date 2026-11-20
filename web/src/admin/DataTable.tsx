import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { api } from '../lib/api';
import { Alert, Button, Spinner } from '../components/ui';

export interface Column<T> { key: string; header: string; sortable?: boolean; render?: (row: T) => ReactNode; className?: string }
export interface PageResult<T> { items: T[]; total: number; page: number; pageSize: number; pages: number }

/** URL-synced list state (spec §3C/§21): filters survive reload and can be deep-linked from the Overview. */
export function useUrlState(defaults: Record<string, string> = {}) {
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? defaults[k] ?? '';
  const set = (patch: Record<string, string | undefined>, resetPage = true) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k));
    if (resetPage && !('page' in patch)) n.delete('page');
    return n;
  }, { replace: true });
  return { get, set, params: sp };
}

/**
 * Server-paginated, sortable, searchable table. Accessible: <caption>, aria-sort on headers, sort buttons,
 * labelled search, live result count, keyboard-reachable pagination.
 */
export function DataTable<T extends { _id?: string }>({ path, columns, filterKeys = [], caption, searchLabel = 'Search', defaultSort, rowKey = (r: any) => r._id, expanded, toolbar, pageSizes = [25, 50, 100], select, refetchInterval }: {
  path: string; columns: Column<T>[]; filterKeys?: string[]; caption: string; searchLabel?: string | null; defaultSort?: string; rowKey?: (r: T) => string;
  expanded?: (row: T) => ReactNode | null; toolbar?: ReactNode; pageSizes?: number[]; select?: (r: any) => PageResult<T>; refetchInterval?: number;
}) {
  const u = useUrlState({ sort: defaultSort ?? '', pageSize: String(pageSizes[0]) });
  const [text, setText] = useState(u.get('q'));
  useEffect(() => { const t = setTimeout(() => { if (text !== u.get('q')) u.set({ q: text || undefined }); }, 300); return () => clearTimeout(t); }, [text]); // debounced
  const qs = new URLSearchParams();
  for (const k of ['q', 'page', 'pageSize', 'sort', ...filterKeys]) if (u.get(k)) qs.set(k, u.get(k));
  const url = `${path}${path.includes('?') ? '&' : '?'}${qs}`;
  const q = useQuery({ queryKey: [path, qs.toString()], queryFn: () => api<any>(url).then((r) => (select ? select(r) : r) as PageResult<T>), placeholderData: keepPreviousData, refetchInterval });
  const sort = u.get('sort');
  const toggle = (k: string) => u.set({ sort: sort === k ? `-${k}` : k });
  const page = q.data?.page ?? 1, pages = q.data?.pages ?? 1;
  return <div className="space-y-3">
    {(searchLabel || toolbar) && <div className="flex flex-wrap items-end gap-3">
      {searchLabel && <label className="block min-w-[14rem] flex-1 text-sm"><span className="mb-1 block font-medium text-slate-700">{searchLabel}</span>
        <span className="relative block"><Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-500" aria-hidden />
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 focus:border-brand-600" /></span></label>}
      {toolbar}
    </div>}
    <p className="text-sm text-slate-600" aria-live="polite">{q.isFetching && !q.data ? 'Loading…' : q.data ? `${q.data.total} result${q.data.total === 1 ? '' : 's'}` : ''}</p>
    {q.error ? <Alert>{q.error.message} <button className="underline" onClick={() => q.refetch()}>Try again</button></Alert> : !q.data ? <Spinner /> : <>
      <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white" tabIndex={0} role="region" aria-label={`${caption ?? 'Table'} (scrollable)`}>
        <table className="w-full text-left text-sm"><caption className="sr-only">{caption}</caption>
          <thead className="bg-slate-50"><tr>{columns.map((c) => {
            const dir = sort === c.key ? 'ascending' : sort === `-${c.key}` ? 'descending' : undefined;
            return <th key={c.key} scope="col" aria-sort={c.sortable ? dir ?? 'none' : undefined} className={`border-b px-3 py-2 font-semibold ${c.className ?? ''}`}>
              {c.sortable ? <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 hover:underline">{c.header}
                {dir === 'ascending' ? <ArrowUp className="h-3 w-3" aria-hidden /> : dir === 'descending' ? <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden />}</button> : c.header}</th>;
          })}</tr></thead>
          <tbody>{q.data.items.length === 0 ? <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-slate-600">No results match these filters.</td></tr>
            : q.data.items.map((r) => { const x = expanded?.(r); return [<tr key={rowKey(r)} className="border-b align-top last:border-0">{columns.map((c) => <td key={c.key} className={`px-3 py-2 ${c.className ?? ''}`}>{c.render ? c.render(r) : String((r as any)[c.key] ?? '')}</td>)}</tr>,
              x ? <tr key={rowKey(r) + ':x'}><td colSpan={columns.length}>{x}</td></tr> : null]; })}</tbody></table></div>
      <nav aria-label={`${caption} pages`} className="flex flex-wrap items-center gap-2 text-sm">
        <Button variant="ghost" className="px-3 py-1" disabled={page <= 1} onClick={() => u.set({ page: String(page - 1) }, false)}>Previous</Button>
        <span>Page {page} of {pages}</span>
        <Button variant="ghost" className="px-3 py-1" disabled={page >= pages} onClick={() => u.set({ page: String(page + 1) }, false)}>Next</Button>
        <label className="ml-auto flex items-center gap-2">Rows per page<select className="rounded border border-slate-300 px-2 py-1" value={u.get('pageSize')} onChange={(e) => u.set({ pageSize: e.target.value })}>{pageSizes.map((n) => <option key={n}>{n}</option>)}</select></label>
      </nav></>}
  </div>;
}
