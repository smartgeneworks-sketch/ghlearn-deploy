import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Sparkles, Activity } from 'lucide-react';
import { hasPermission, ROLE_LABELS, type Role } from '@ghlearn/shared';
import { api, post, patch, put, del, download } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { BarChart } from '../components/Charts';
import { ConfirmButton } from '../components/ConfirmDialog';
import { AdminPage } from './pages';
import { useUrlState } from './DataTable';
import { when, ErrorBox } from './common';

/* ---------- shared bits ---------- */
type Kind = 'measured' | 'estimate' | 'suggestion' | 'ai';
const KIND: Record<Kind, { label: string; cls: string; help: string }> = {
  measured: { label: 'Measured', cls: 'bg-emerald-100 text-emerald-900', help: 'Counted from recorded activity.' },
  estimate: { label: 'Estimate', cls: 'bg-amber-100 text-amber-900', help: 'Calculated with stated assumptions; not an exact figure.' },
  suggestion: { label: 'Rule-based suggestion', cls: 'bg-sky-100 text-sky-900', help: 'A stated rule applied to measured data. Not AI.' },
  ai: { label: 'AI recommendation', cls: 'bg-violet-100 text-violet-900', help: 'Written by AI from aggregated figures. Check before acting.' },
};
export const KindBadge = ({ kind }: { kind: Kind }) => <span title={KIND[kind].help} className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${KIND[kind].cls}`}>{KIND[kind].label}</span>;
const qs = (o: Record<string, unknown>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => [k, String(v)])).toString();
const fmt = (v: unknown, type?: string) => (v == null || v === '' ? '—' : type === 'percent' ? `${v} %` : type === 'date' ? String(v).slice(0, 10) : type === 'number' && typeof v === 'number' ? v.toLocaleString() : Array.isArray(v) ? v.join(', ') : String(v));
const Stat = ({ k, v, kind }: { k: string; v: ReactNode; kind?: Kind }) => <div className="rounded-lg border border-slate-200 p-3"><dt className="text-xs text-slate-600">{k}{kind && kind !== 'measured' && <> · <span className="font-semibold">{KIND[kind].label}</span></>}</dt><dd className="text-lg font-bold">{v == null || v === '' ? '—' : v}</dd></div>;
const ExportButtons = ({ onExport, busy }: { onExport: (f: 'csv' | 'xlsx') => void; busy?: boolean }) => <div className="flex gap-2">
  <Button variant="ghost" disabled={busy} onClick={() => onExport('csv')}><Download className="h-4 w-4" aria-hidden />CSV</Button>
  <Button variant="ghost" disabled={busy} onClick={() => onExport('xlsx')}><FileSpreadsheet className="h-4 w-4" aria-hidden />Excel</Button></div>;
interface Col { key: string; label: string; type?: string; render?: (r: any) => ReactNode }
/** Client-side searchable, sortable table for a report's rows (reports are already capped server-side). */
export function ReportTable({ caption, columns, rows, empty = 'No data for these filters.' }: { caption: string; columns: Col[]; rows: any[]; empty?: string }) {
  const [q, setQ] = useState(''); const [sort, setSort] = useState<{ k: string; d: 1 | -1 } | null>(null);
  const shown = useMemo(() => { const t = q.trim().toLowerCase();
    const f = t ? rows.filter((r) => columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(t))) : rows;
    return sort ? [...f].sort((a, b) => { const x = a[sort.k], y = b[sort.k]; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.d; }) : f; }, [q, rows, sort, columns]);
  if (!rows.length) return <p className="text-sm text-slate-600">{empty}</p>;
  return <div>{rows.length > 8 && <div className="mb-2 max-w-xs"><Input label={`Search ${caption.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} /></div>}
    <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={`${caption} (scrollable)`}><table className="w-full text-sm"><caption className="sr-only">{caption}</caption><thead><tr className="border-b text-left">{columns.map((c) => <th key={c.key} scope="col" className="px-2 py-1.5 font-semibold" aria-sort={sort?.k === c.key ? (sort.d === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="underline-offset-2 hover:underline" onClick={() => setSort({ k: c.key, d: sort?.k === c.key && sort.d === 1 ? -1 : 1 })}>{c.label}</button></th>)}</tr></thead>
      <tbody>{shown.slice(0, 200).map((r, i) => <tr key={i} className="border-b last:border-0">{columns.map((c) => <td key={c.key} className={`px-2 py-1.5 ${c.type === 'number' || c.type === 'percent' ? 'tabular-nums' : ''}`}>{c.render ? c.render(r) : fmt(r[c.key], c.type)}</td>)}</tr>)}</tbody></table></div>
    {shown.length > 200 && <p className="mt-1 text-xs text-slate-600">Showing 200 of {shown.length}. Export for all rows.</p>}</div>;
}

/* ---------- §16 Learning Analytics ---------- */
const FILTER_KEYS = ['schoolId', 'academicYearId', 'classId', 'levelId', 'programmeId', 'subjectId', 'topic', 'from', 'to', 'showSmallGroups'];
export function LearningAnalyticsPage() {
  const u = useUrlState(); const o = useQuery({ queryKey: ['analytics-filters'], queryFn: () => api<any>('/api/analytics/filters') });
  const f: Record<string, string> = Object.fromEntries(FILTER_KEYS.map((k) => [k, u.get(k)]));
  const params = qs({ ...f, to: f.to ? `${f.to}T23:59:59Z` : '', showSmallGroups: f.showSmallGroups === 'true' ? 'true' : '' });
  const q = useQuery({ queryKey: ['analytics-reports', params], queryFn: () => api<any>(`/api/analytics/reports?${params}`) });
  const [students, setStudents] = useState(false);
  const sq = useQuery({ queryKey: ['analytics-students', params], enabled: students, queryFn: () => api<any>(`/api/analytics/reports?${qs({ ...Object.fromEntries(new URLSearchParams(params)), reports: 'students_support' })}`) });
  const ai = useMutation({ mutationFn: () => post<any>('/api/analytics/recommendations', Object.fromEntries(new URLSearchParams(params))) });
  const [exportErr, setExportErr] = useState<string | null>(null);
  const exp = (key: string) => (format: 'csv' | 'xlsx') => { setExportErr(null); download(`/api/analytics/reports/${key}/export?${qs({ ...Object.fromEntries(new URLSearchParams(params)), format })}`, `${key}.${format}`).catch((e) => setExportErr(e.message)); };
  const set = (k: string) => (e: any) => u.set({ [k]: (e.target.type === 'checkbox' ? (e.target.checked ? 'true' : '') : e.target.value) || undefined, ...(k === 'schoolId' ? { classId: undefined } : {}) });
  const d = o.data; const scope = d?.scope;
  const classes = (d?.classes ?? []).filter((c: any) => !f.schoolId || c.schoolId === f.schoolId);
  return <AdminPage title="Learning Analytics" description={scope === 'school' ? 'Learning figures for your school. Groups smaller than 5 learners are hidden by default.' : scope === 'content' ? 'Content quality and AI figures. Learner data is not shown for content roles.' : 'Learning figures across the platform. Groups smaller than 5 learners are hidden by default.'}>
    <Card><form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Analytics filters" onSubmit={(e) => e.preventDefault()}>
      {scope === 'platform' && <Select label="School" value={f.schoolId} onChange={set('schoolId')}><option value="">All schools</option>{d.schools.map((s: any) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>}
      {scope !== 'content' && <Select label="Academic year" value={f.academicYearId} onChange={set('academicYearId')}><option value="">All years</option>{d?.academicYears?.map((y: any) => <option key={y._id} value={y._id}>{y.label}{y.current ? ' (current)' : ''}</option>)}</Select>}
      {scope !== 'content' && <Select label="Class" value={f.classId} onChange={set('classId')}><option value="">All classes</option>{classes.map((c: any) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select>}
      <Select label="Level" value={f.levelId} onChange={set('levelId')}><option value="">All levels</option>{d?.levels?.map((l: any) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select>
      <Select label="Learning Area" value={f.programmeId} onChange={set('programmeId')}><option value="">All Learning Areas</option>{d?.programmes?.map((p: any) => <option key={p._id} value={p._id}>{p.name}</option>)}</Select>
      <Select label="Subject" value={f.subjectId} onChange={set('subjectId')}><option value="">All subjects</option>{d?.subjects?.map((s: any) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
      <Input label="Topic" list="la-topics" value={f.topic} onChange={set('topic')} placeholder="Any topic" /><datalist id="la-topics">{d?.topics?.map((t: string) => <option key={t} value={t} />)}</datalist>
      <Input label="From" type="date" value={f.from} onChange={set('from')} /><Input label="To" type="date" value={f.to} onChange={set('to')} />
      {d?.canSeeStudents && <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={f.showSmallGroups === 'true'} onChange={set('showSmallGroups')} />Show groups under 5 learners</label>}
    </form>
      {q.data && <p className="mt-2 text-xs text-slate-600">Period {String(q.data.filters.from).slice(0, 10)} to {String(q.data.filters.to).slice(0, 10)} (default: last 30 days). Labels: {(['measured', 'estimate', 'suggestion', 'ai'] as Kind[]).map((k) => <span key={k} className="mr-2"><KindBadge kind={k} /> {KIND[k].help}</span>)}</p>}</Card>
    {exportErr && <Alert>{exportErr}</Alert>}
    {o.error ? <ErrorBox error={o.error} /> : q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : <>
      {scope !== 'content' && <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">AI recommendation <KindBadge kind="ai" /></h2>
        <p className="text-sm text-slate-600">Optional. Sends only the aggregated figures below (no names, small groups removed) to the AI and uses 1 AI request.</p></div>
        <Button variant="ghost" loading={ai.isPending} onClick={() => ai.mutate()}><Sparkles className="h-4 w-4" aria-hidden />Generate recommendation</Button></div>
        {ai.error && <Alert>{ai.error.message}</Alert>}
        {ai.data && (ai.data.text ? <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3"><p className="mb-1 text-xs font-semibold text-violet-900">{ai.data.label}</p><div className="whitespace-pre-wrap text-sm">{ai.data.text}</div></div> : <Alert tone="info">{ai.data.note}</Alert>)}</Card>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">{q.data.reports.map((r: any) => <ReportCard key={r.key} r={r} onExport={exp(r.key)} />)}</div>
      {d?.canSeeStudents && <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Students needing support <KindBadge kind="suggestion" /></h2>
        <p className="text-sm text-slate-600">Student-level data. Shown only to administrators of these learners, only on request; each view is recorded in the audit log.</p></div>
        {!students ? <Button variant="ghost" onClick={() => setStudents(true)}>Show students</Button> : <ExportButtons onExport={exp('students_support')} />}</div>
        {students && (sq.isLoading ? <Spinner /> : sq.error ? <ErrorBox error={sq.error} /> : (() => { const r = sq.data.reports[0]; return <div className="mt-3"><p className="mb-2 text-xs text-slate-600">{r.method}</p><ReportTable caption={r.title} columns={r.columns} rows={r.rows} empty="No learners match the rule for these filters." /></div>; })())}</Card>}
    </>}
  </AdminPage>;
}
function ReportCard({ r, onExport }: { r: any; onExport: (f: 'csv' | 'xlsx') => void }) {
  const chartRows = r.chart ? r.rows.filter((x: any) => typeof x[r.chart.valueKey] === 'number').slice(0, 12) : [];
  const pctChart = r.chart?.unit === '%';
  return <Card><div className="mb-2 flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">{r.title} <KindBadge kind={r.kind} /></h2><p className="text-sm text-slate-600">{r.description}</p></div><ExportButtons onExport={onExport} /></div>
    {r.summary?.length > 0 && <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{r.summary.map((s: any) => <Stat key={s.label} k={s.label} v={fmt(s.value)} kind={s.kind} />)}</dl>}
    {chartRows.length > 1 && <BarChart label={r.chart.label} neutral={!pctChart} suffix={pctChart ? '%' : ''} max={pctChart ? 100 : Math.max(1, ...chartRows.map((x: any) => x[r.chart.valueKey]))} data={chartRows.map((x: any) => ({ label: String(x[r.chart.labelKey] ?? ''), value: x[r.chart.valueKey] }))} />}
    <ReportTable caption={r.title} columns={r.columns} rows={r.rows} />
    {r.suppressedRows > 0 && <p className="mt-2 text-xs text-slate-700">{r.suppressedRows} row(s) have figures hidden because fewer than 5 learners are involved.</p>}
    <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">How this is calculated</summary><p className="mt-1">{r.method}</p></details></Card>;
}

/* ---------- §17 AI Usage and Costs ---------- */
const USAGE_COLS: Col[] = [{ key: 'requests', label: 'Requests', type: 'number' }, { key: 'ok', label: 'Succeeded', type: 'number' }, { key: 'failed', label: 'Failed', type: 'number' }, { key: 'refused', label: 'Refused by limits', type: 'number' },
  { key: 'inputTokens', label: 'Input tokens', type: 'number' }, { key: 'outputTokens', label: 'Output tokens', type: 'number' }, { key: 'estCostUsd', label: 'Estimated cost (USD)', render: (r) => `~$${Number(r.estCostUsd ?? 0).toFixed(4)}` }, { key: 'rateLimitHits', label: 'Rate-limit responses', type: 'number' }];
export function AiUsagePage() {
  const { user } = useAuth(); const roles = user!.roles as Role[]; const u = useUrlState();
  const canSettings = hasPermission(roles, 'platform:manage') || hasPermission(roles, 'system:health');
  const f = { from: u.get('from'), to: u.get('to'), schoolId: u.get('schoolId'), feature: u.get('feature'), status: u.get('status') };
  const params = qs({ ...f, to: f.to ? `${f.to}T23:59:59Z` : '' });
  const q = useQuery({ queryKey: ['ai-usage', params], queryFn: () => api<any>(`/api/admin/ai/usage?${params}`) });
  const st = useQuery({ queryKey: ['ai-settings'], enabled: canSettings, queryFn: () => api<any>('/api/admin/ai/settings') });
  const schools = useQuery({ queryKey: ['/api/config/schools'], enabled: roles.includes('super_admin') || roles.includes('system_operator'), queryFn: () => api<any>('/api/config/schools').then((r) => r.items) });
  const [err, setErr] = useState<string | null>(null);
  const exp = (report: string) => (format: 'csv' | 'xlsx') => { setErr(null); download(`/api/admin/ai/usage/export?${qs({ ...Object.fromEntries(new URLSearchParams(params)), report, format })}`, `ai-${report}.${format}`).catch((e) => setErr(e.message)); };
  const set = (k: string) => (e: any) => u.set({ [k]: e.target.value || undefined });
  const d = q.data;
  return <AdminPage title="AI Usage and Costs" description="Requests, tokens, failures and limits for every AI feature. Costs are estimates, not bills.">
    <Card><form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="AI usage filters" onSubmit={(e) => e.preventDefault()}>
      <Input label="From" type="date" value={f.from} onChange={set('from')} /><Input label="To" type="date" value={f.to} onChange={set('to')} />
      {(d?.scope === 'platform' || d?.scope === 'operations') && <Select label="School" value={f.schoolId} onChange={set('schoolId')}><option value="">All schools</option>{schools.data?.map((s: any) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>}
      <Select label="Feature" value={f.feature} onChange={set('feature')}><option value="">All features</option>{(st.data?.features ?? []).map((x: any) => <option key={x.key} value={x.key}>{x.label}</option>)}<option value="embeddings">Embeddings</option><option value="health_check">Health checks</option></Select>
      <Select label="Outcome" value={f.status} onChange={set('status')}><option value="">All</option><option value="ok">Succeeded</option><option value="failed">Failed</option><option value="refused">Refused by limits</option><option value="rate_limited">Rate limited</option></Select></form></Card>
    {err && <Alert>{err}</Alert>}
    {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : <>
      <Card><h2 className="mb-2 font-semibold">Totals <KindBadge kind="measured" /></h2><dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Stat k="Requests" v={d.totals.requests} /><Stat k="Succeeded" v={d.totals.ok} /><Stat k="Failed" v={d.totals.failed} /><Stat k="Refused by limits" v={d.totals.refused} />
        <Stat k="Input tokens" v={d.totals.inputTokens.toLocaleString()} /><Stat k="Output tokens" v={d.totals.outputTokens.toLocaleString()} /><Stat k="Estimated cost (USD)" kind="estimate" v={`~$${d.totals.estCostUsd.toFixed(4)}`} /><Stat k="Rate-limit responses" v={d.rateLimit.hits} /></dl>
        <p className="mt-2 text-xs text-slate-600">{d.labels.measured} {d.labels.refused}</p><p className="text-xs text-amber-900">{d.labels.cost}</p></Card>
      <Card><h2 className="mb-2 font-semibold">Budgets today ({d.budgets.day})</h2><dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {d.budgets.platform && <Stat k="Platform requests" v={`${d.budgets.platform.used} / ${d.budgets.platform.limit} (${d.budgets.platform.pct ?? 0} %)`} />}
        {d.budgets.school && <Stat k="School requests" v={`${d.budgets.school.used} / ${d.budgets.school.limit} (${d.budgets.school.pct ?? 0} %)`} />}
        <Stat k="Per-user daily limit" v={d.budgets.perUserDailyRequests} /><Stat k="Alert threshold" v={`${d.budgets.thresholdPct} %`} /></dl>
        {d.budgets.month && <><h3 className="mt-4 mb-2 text-sm font-semibold">This month ({d.budgets.month.month}) <KindBadge kind="estimate" /></h3><dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat k="Platform requests this month" v={`${d.budgets.month.requests.toLocaleString()} / ${d.budgets.month.requestBudget.toLocaleString()} (${d.budgets.month.pct ?? 0} %)`} />
          <Stat k="Estimated cost this month" kind="estimate" v={d.budgets.month.costBudgetUsd ? `~$${d.budgets.month.estCostUsd.toFixed(2)} / $${d.budgets.month.costBudgetUsd.toFixed(2)} (${d.budgets.month.costPct ?? 0} %)` : `~$${d.budgets.month.estCostUsd.toFixed(2)} (no cost cap)`} />
          <Stat k="Tokens this month" v={(d.budgets.month.inputTokens + d.budgets.month.outputTokens).toLocaleString()} /></dl>
          <div className="mt-2 h-2 rounded-full bg-slate-100" role="meter" aria-label="Monthly AI budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(d.budgets.month.pct ?? 0, d.budgets.month.costPct ?? 0))}>
            <div className={`h-2 rounded-full ${Math.max(d.budgets.month.pct ?? 0, d.budgets.month.costPct ?? 0) >= 100 ? 'bg-red-600' : Math.max(d.budgets.month.pct ?? 0, d.budgets.month.costPct ?? 0) >= d.budgets.thresholdPct ? 'bg-amber-500' : 'bg-emerald-600'}`} style={{ width: `${Math.min(100, Math.max(d.budgets.month.pct ?? 0, d.budgets.month.costPct ?? 0))}%` }} /></div>
          <p className="mt-1 text-xs text-slate-600">New AI requests are refused once either monthly cap is reached. The cost figure is the app’s estimate, not Google’s bill.</p></>}
        {d.budgets.alertsToday.length > 0 ? <Alert tone="info">Threshold alerts sent today: {d.budgets.alertsToday.map((a: any) => `${a.scope} ${a.level}`).join(', ')}</Alert> : <p className="mt-2 text-sm text-slate-600">No budget threshold reached today.</p>}</Card>
      {d.daily.length > 1 && <Card><div className="mb-2 flex justify-between"><h2 className="font-semibold">Requests per day</h2><ExportButtons onExport={exp('daily')} /></div><BarChart neutral suffix="" label="Requests per day" max={Math.max(1, ...d.daily.map((x: any) => x.requests))} data={d.daily.slice(-14).map((x: any) => ({ label: x.day, value: x.requests }))} /></Card>}
      <UsageTable title="By feature" report="byFeature" lead={[{ key: 'label', label: 'Feature' }]} rows={d.byFeature} onExport={exp('byFeature')} />
      <UsageTable title="By provider and model" report="byProvider" lead={[{ key: 'provider', label: 'Provider' }, { key: 'model', label: 'Model' }]} rows={d.byProvider} onExport={exp('byProvider')} />
      {d.bySchool && <UsageTable title="By school" report="bySchool" lead={[{ key: 'school', label: 'School' }]} rows={d.bySchool} onExport={exp('bySchool')} />}
      {d.byUser && <UsageTable title="By user" report="byUser" lead={[{ key: 'name', label: 'Name' }, { key: 'roles', label: 'Roles', render: (r) => r.roles.map((x: Role) => ROLE_LABELS[x] ?? x).join(', ') }]} rows={d.byUser} onExport={exp('byUser')} />}
      <Card><div className="mb-2 flex flex-wrap justify-between gap-2"><div><h2 className="font-semibold">Failed and refused requests</h2><p className="text-sm text-slate-600">Latest 25. Rate limited: {d.rateLimit.requestsAffected} request(s) received at least one rate-limit response; {d.rateLimit.finalRateLimited} failed because of it.</p></div><ExportButtons onExport={exp('failures')} /></div>
        <ReportTable caption="Failed and refused requests" rows={d.failures} empty="No failed or refused requests in this period." columns={[{ key: 'at', label: 'When', render: (r) => when(r.at) }, { key: 'feature', label: 'Feature' }, { key: 'provider', label: 'Provider' }, { key: 'status', label: 'Status', render: (r) => String(r.status).replace(/_/g, ' ') }, { key: 'httpStatus', label: 'HTTP' }, { key: 'retries', label: 'Retries', type: 'number' }, { key: 'error', label: 'Error', render: (r) => <span className="break-all">{r.error ?? '—'}</span> }]} /></Card>
    </>}
    {canSettings && (st.isLoading ? <Spinner /> : st.error ? <ErrorBox error={st.error} /> : <><HealthPanel providers={st.data.providers} /><AiProvidersPanel data={st.data} /><AiSettingsPanel data={st.data} schools={schools.data ?? []} /></>)}
  </AdminPage>;
}
const UsageTable = ({ title, lead, rows, onExport }: { title: string; report: string; lead: Col[]; rows: any[]; onExport: (f: 'csv' | 'xlsx') => void }) =>
  <Card><div className="mb-2 flex justify-between gap-2"><h2 className="font-semibold">{title}</h2><ExportButtons onExport={onExport} /></div><ReportTable caption={`AI usage ${title.toLowerCase()}`} columns={[...lead, ...USAGE_COLS]} rows={rows} empty="No AI requests in this period." /></Card>;

const CAP_LABEL: Record<string, string> = { llm: 'Language model (LLM)', embeddings: 'Embeddings', ocr: 'OCR', image: 'Illustration', vector_search: 'Vector search', object_storage: 'Object storage' };
const STATUS_CLS: Record<string, string> = { ok: 'bg-emerald-100 text-emerald-900', failed: 'bg-red-100 text-red-900', not_configured: 'bg-slate-100 text-slate-800' };
function HealthPanel({ providers }: { providers: any }) {
  const qc = useQueryClient(); const h = useQuery({ queryKey: ['ai-health'], queryFn: () => api<any>('/api/admin/ai/health') });
  const [caps, setCaps] = useState<string[]>(['embeddings', 'ocr', 'image', 'vector_search', 'object_storage']);
  const run = useMutation({ mutationFn: () => post<any>('/api/admin/ai/health', { capabilities: caps }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-health'] }) });
  const last = run.data ?? h.data?.items?.[0];
  return <Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Provider health</h2><p className="text-sm text-slate-600">Each check makes a real round trip to the provider. A check only shows OK when it succeeded. Configured: LLM {providers.llm?.provider ?? providers.llm ?? 'none'}, vector search {providers.vectorSearch}, storage {providers.objectStorage}.</p></div></div>
    <fieldset className="mt-3"><legend className="text-sm font-medium">Checks to run</legend><div className="mt-1 flex flex-wrap gap-4">{Object.entries(CAP_LABEL).map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={caps.includes(k)} onChange={(e) => setCaps(e.target.checked ? [...caps, k] : caps.filter((x) => x !== k))} />{l}{k === 'llm' && <span className="text-xs text-amber-900">(uses 1 AI request)</span>}</label>)}</div></fieldset>
    <div className="mt-3"><Button loading={run.isPending} disabled={!caps.length} onClick={() => run.mutate()}><Activity className="h-4 w-4" aria-hidden />Run health check</Button></div>
    {run.error && <Alert>{run.error.message}</Alert>}
    {last ? <div className="mt-3"><p className="text-xs text-slate-600">Last run {when(last.createdAt ?? new Date().toISOString())}{last.ranBy?.fullName ? ` by ${last.ranBy.fullName}` : ''}</p>
      <ul className="mt-1 divide-y text-sm">{last.results.map((r: any) => <li key={r.capability} className="flex flex-wrap items-baseline gap-2 py-1.5"><span className="w-44 font-medium">{CAP_LABEL[r.capability] ?? r.capability}</span>
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[r.status]}`}>{r.status === 'ok' ? 'OK' : r.status === 'failed' ? 'Failed' : 'Not configured'}</span>
        <span className="text-xs text-slate-600">{[r.provider, r.model].filter(Boolean).join(' · ')}{r.latencyMs != null ? ` · ${r.latencyMs} ms` : ''}</span><span className="basis-full break-all text-xs text-slate-700">{r.detail}</span></li>)}</ul></div>
      : <p className="mt-3 text-sm text-slate-600">No health check has been run yet.</p>}</Card>;
}
const NUMS: [string, string, string][] = [['platformDailyRequests', 'Platform requests per day', ''], ['platformDailyTokens', 'Platform tokens per day', ''], ['platformMonthlyRequests', 'Platform requests per month', 'Hard cap, resets on the 1st (UTC)'], ['platformMonthlyCostUsd', 'Monthly cost cap (USD, estimated)', 'Hard cap from the token rates below; 0 = none'], ['perUserDailyRequests', 'Requests per user per day', ''], ['schoolDailyRequests', 'Requests per school per day (default)', ''],
  ['maxInputChars', 'Maximum input size (characters)', ''], ['maxOutputTokens', 'Maximum output tokens per request', ''], ['maxRetries', 'Retries on provider errors', '0 to 5'], ['timeoutSec', 'Request timeout (seconds)', ''], ['alertThresholdPct', 'Alert at % of a budget', ''], ['costInputPerM', 'Cost estimate: USD per 1M input tokens', ''], ['costOutputPerM', 'Cost estimate: USD per 1M output tokens', '']];
/** §17 providers and model selection. Providers and keys live in the server environment (only set/unset is shown); the LLM model is chosen here. */
function AiProvidersPanel({ data }: { data: any }) {
  const qc = useQueryClient(); const edit = data.canEdit; const llm = data.providerConfig?.find((p: any) => p.capability === 'llm');
  const models = useQuery({ queryKey: ['ai-models'], enabled: !!llm?.provider, queryFn: () => api<any>('/api/admin/ai/models'), staleTime: 300_000 });
  const [model, setModel] = useState<string>(data.settings.llmModel ?? '');
  const save = useMutation({ mutationFn: () => patch<any>('/api/admin/ai/settings', { llmModel: model || null }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-settings'] }) });
  const SRC: Record<string, string> = { settings: 'chosen here', env: 'from environment', default: 'built-in default' };
  return <Card><h2 className="font-semibold">AI providers and models</h2>
    <p className="mb-3 text-sm text-slate-600">Providers and API keys are set in the server environment and never stored in the database. The text-generation model can be chosen here from the models the provider offers.</p>
    <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="AI providers"><table className="w-full min-w-[36rem] text-left text-sm"><caption className="sr-only">AI providers by capability</caption>
      <thead><tr className="border-b"><th scope="col" className="py-1">Capability</th><th scope="col">Provider</th><th scope="col">Model</th><th scope="col">Notes</th></tr></thead>
      <tbody>{(data.providerConfig ?? []).map((p: any) => <tr key={p.capability} className="border-b align-top last:border-0">
        <td className="py-1.5 font-medium">{p.label}</td><td>{p.provider ?? <span className="text-slate-600">Not configured (<code>{p.envVar}</code>)</span>}</td>
        <td>{p.model ? <><code>{p.model}</code>{p.modelSource && p.capability === 'llm' && <span className="block text-xs text-slate-600">{SRC[p.modelSource]}</span>}</> : '—'}</td>
        <td className="text-xs text-slate-700">{p.note ?? ''}</td></tr>)}</tbody></table></div>
    {llm?.modelEditable && <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      {models.isLoading ? <Spinner label="Loading models" /> : models.data && !models.data.available ? <Alert tone="info">The model list could not be read from the provider right now, so the model cannot be changed.</Alert>
        : <Select label="Text-generation model" disabled={!edit} value={model} onChange={(e) => setModel(e.target.value)} className="min-w-64">
          <option value="">Default ({models.data?.defaultModel ?? llm.model})</option>{(models.data?.models ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.label} ({m.id})</option>)}</Select>}
      {edit && models.data?.available && <Button type="submit" loading={save.isPending} disabled={(data.settings.llmModel ?? '') === model}>Save model</Button>}
      {save.isSuccess && <span role="status" className="text-sm text-emerald-800">Saved. New AI requests use this model; run a health check to confirm it works.</span>}
      {save.error && <Alert>{save.error.message}</Alert>}</form>}
  </Card>;
}
function AiSettingsPanel({ data, schools }: { data: any; schools: any[] }) {
  const qc = useQueryClient(); const s = data.settings; const edit = data.canEdit;
  const [v, setV] = useState<Record<string, any>>(() => ({ ...Object.fromEntries(NUMS.map(([k]) => [k, String(s[k])])), allowedFeatures: s.allowedFeatures, schoolBudgets: s.schoolBudgets.map((b: any) => ({ schoolId: b.schoolId, dailyRequests: String(b.dailyRequests) })) }));
  const save = useMutation({ mutationFn: () => {
    const body: any = {}; for (const [k] of NUMS) if (Number(v[k]) !== s[k]) body[k] = Number(v[k]);
    if (JSON.stringify([...v.allowedFeatures].sort()) !== JSON.stringify([...s.allowedFeatures].sort())) body.allowedFeatures = v.allowedFeatures;
    const sb = v.schoolBudgets.filter((b: any) => b.schoolId).map((b: any) => ({ schoolId: b.schoolId, dailyRequests: Number(b.dailyRequests) }));
    if (JSON.stringify(sb) !== JSON.stringify(s.schoolBudgets.map((b: any) => ({ schoolId: b.schoolId, dailyRequests: b.dailyRequests })))) body.schoolBudgets = sb;
    return patch<any>('/api/admin/ai/settings', body); }, onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-settings'] }) });
  return <Card><h2 className="font-semibold">AI limits and settings</h2><p className="mb-3 text-sm text-slate-600">Stored in the database and enforced by the server on every AI request. {edit ? 'Changes are recorded in the audit log.' : 'Read-only: only a Super Admin can change these.'}</p>
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{NUMS.map(([k, l, h]) => <Input key={k} label={l} hint={h || undefined} type="number" min={0} step={k.startsWith('cost') || k === 'platformMonthlyCostUsd' ? '0.01' : '1'} value={v[k]} disabled={!edit} onChange={(e) => setV({ ...v, [k]: e.target.value })} />)}</div>
      <fieldset><legend className="text-sm font-medium">Allowed AI features</legend><div className="mt-1 flex flex-wrap gap-4">{data.features.map((x: any) => <label key={x.key} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!edit} checked={v.allowedFeatures.includes(x.key)} onChange={(e) => setV({ ...v, allowedFeatures: e.target.checked ? [...v.allowedFeatures, x.key] : v.allowedFeatures.filter((y: string) => y !== x.key) })} />{x.label}</label>)}</div></fieldset>
      <fieldset><legend className="text-sm font-medium">School budgets (override the default per school)</legend>
        {v.schoolBudgets.length === 0 && <p className="text-sm text-slate-600">None: every school uses the default.</p>}
        {v.schoolBudgets.map((b: any, i: number) => <div key={i} className="mt-2 grid items-end gap-2 sm:grid-cols-[1fr_12rem_auto]">
          <Select label={`School ${i + 1}`} disabled={!edit} value={b.schoolId} onChange={(e) => setV({ ...v, schoolBudgets: v.schoolBudgets.map((x: any, j: number) => (j === i ? { ...x, schoolId: e.target.value } : x)) })}><option value="">Choose a school</option>{(schools.length ? schools : s.schoolBudgets.map((x: any) => ({ _id: x.schoolId, name: x.school }))).map((sc: any) => <option key={sc._id} value={sc._id}>{sc.name}</option>)}</Select>
          <Input label="Requests per day" type="number" min={0} disabled={!edit} value={b.dailyRequests} onChange={(e) => setV({ ...v, schoolBudgets: v.schoolBudgets.map((x: any, j: number) => (j === i ? { ...x, dailyRequests: e.target.value } : x)) })} />
          {edit && <Button variant="ghost" type="button" onClick={() => setV({ ...v, schoolBudgets: v.schoolBudgets.filter((_: any, j: number) => j !== i) })}>Remove</Button>}</div>)}
        {edit && <Button variant="ghost" type="button" className="mt-2" onClick={() => setV({ ...v, schoolBudgets: [...v.schoolBudgets, { schoolId: '', dailyRequests: String(s.schoolDailyRequests) }] })}>Add school budget</Button>}</fieldset>
      {edit && <div className="flex items-center gap-3"><Button type="submit" loading={save.isPending}>Save settings</Button>{save.isSuccess && <span role="status" className="text-sm text-emerald-800">Saved{save.data.changed?.length ? `: ${save.data.changed.join(', ')}` : ' (no changes)'}.</span>}</div>}
      {save.error && <Alert>{save.error.message}</Alert>}
    </form>
    <h3 className="mb-1 mt-5 text-sm font-semibold">Secrets</h3><p className="mb-2 text-xs text-slate-600">Values are never shown or sent to the browser; only whether each is set. They are set in the server environment.</p>
    <ul className="divide-y text-sm">{data.secrets.map((x: any) => <li key={x.name} className="flex flex-wrap gap-2 py-1"><code className="w-44">{x.name}</code><span className={`rounded px-2 py-0.5 text-xs font-semibold ${x.set ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-800'}`}>{x.set ? 'Set' : 'Not set'}</span><span className="text-xs text-slate-600">{x.purpose}</span></li>)}</ul></Card>;
}

/* ---------- §18 Notifications ---------- */
export function NotificationPreferences() {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api<any>('/api/notifications/preferences') });
  const save = useMutation({ mutationFn: (categories: any) => put('/api/notifications/preferences', { categories }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-prefs'] }) });
  if (q.isLoading) return <Spinner />; if (q.error) return <ErrorBox error={q.error} />;
  const toggle = (c: any, ch: 'inApp' | 'email') => save.mutate({ [c.key]: { inApp: ch === 'inApp' ? !c.inApp : c.inApp, email: ch === 'email' ? !c.email : c.email } });
  return <div><p className="mb-2 text-sm text-slate-600">{q.data.emailConfigured ? 'Email is available.' : 'Email is not configured on this server; notifications are in-app only.'} Security alerts always appear in the app.</p>
    <table className="w-full max-w-xl text-sm"><caption className="sr-only">Notification preferences</caption><thead><tr className="border-b text-left"><th scope="col" className="py-1">Category</th><th scope="col">In the app</th><th scope="col">Email</th></tr></thead>
      <tbody>{q.data.categories.map((c: any) => <tr key={c.key} className="border-b last:border-0"><td className="py-1.5">{c.label}</td>
        <td><input type="checkbox" aria-label={`${c.label} in the app`} checked={c.inApp} disabled={c.mandatoryInApp || save.isPending} onChange={() => toggle(c, 'inApp')} /></td>
        <td><input type="checkbox" aria-label={`${c.label} by email`} checked={c.email} disabled={!q.data.emailConfigured || save.isPending} onChange={() => toggle(c, 'email')} /></td></tr>)}</tbody></table>
    {save.error && <Alert>{save.error.message}</Alert>}</div>;
}
const ANN_STATUS: Record<string, string> = { draft: 'Draft', scheduled: 'Scheduled', published: 'Published', expired: 'Ended', withdrawn: 'Withdrawn' };
const isoLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export function NotificationsAdminPage() {
  const { user } = useAuth(); const roles = user!.roles as Role[]; const u = useUrlState({ tab: 'inbox' }); const tab = u.get('tab') || 'inbox';
  const manage = hasPermission(roles, 'users:manage'); const review = hasPermission(roles, 'content:review');
  const tabs = [['inbox', 'My notifications'], ['preferences', 'Preferences'], ...(manage ? [['announcements', 'Announcements']] : [])] as [string, string][];
  return <AdminPage title="Notifications" description="Your notifications and preferences, and announcements to users with delivery status.">
    <div role="tablist" aria-label="Notifications sections" className="flex gap-2 border-b">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600'}`} onClick={() => u.set({ tab: k === 'inbox' ? undefined : k })}>{l}</button>)}</div>
    {tab === 'inbox' && <Inbox />}{tab === 'preferences' && <Card><NotificationPreferences /></Card>}
    {tab === 'announcements' && manage && <Announcements isSuper={roles.includes('super_admin')} />}
    {review && tab === 'inbox' && <ReviewReminders />}
  </AdminPage>;
}
function ReviewReminders() {
  const m = useMutation({ mutationFn: () => post<any>('/api/announcements/review-reminders', {}) });
  return <Card><h2 className="font-semibold">Review reminders</h2><p className="text-sm text-slate-600">Sent automatically every day at 08:00 UTC for content waiting more than 24 hours. Send them now if needed.</p>
    <div className="mt-2 flex items-center gap-3"><Button variant="ghost" loading={m.isPending} onClick={() => m.mutate()}>Send review reminders now</Button>{m.data && <span role="status" className="text-sm">{m.data.notified} reminder(s) sent; waiting: {m.data.waiting.lessons} lesson(s), {m.data.waiting.questions} question(s), {m.data.waiting.games} game(s).</span>}</div>{m.error && <Alert>{m.error.message}</Alert>}</Card>;
}
function Inbox() {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['notifications', 'all'], queryFn: () => api<any>('/api/notifications?limit=100') });
  const read = useMutation({ mutationFn: (b: any) => post('/api/notifications/read', b), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  if (q.isLoading) return <Spinner />; if (q.error) return <ErrorBox error={q.error} />;
  return <div className="space-y-2"><div className="flex justify-end"><Button variant="ghost" disabled={!q.data.unread} onClick={() => read.mutate({ all: true })}>Mark all read</Button></div>
    {q.data.items.length ? <ul className="space-y-2">{q.data.items.map((n: any) => <li key={n._id}><Card className={n.readAt ? 'opacity-80' : 'border-brand-700'}>
      <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{!n.readAt && <span className="sr-only">Unread: </span>}{n.title}</p><span className="text-xs text-slate-600">{when(n.createdAt)}</span></div>
      {n.body && <p className="whitespace-pre-wrap text-sm">{n.body}</p>}<div className="mt-1 flex gap-3 text-sm">{n.link && <Link className="text-brand-700 underline" to={n.link} onClick={() => !n.readAt && read.mutate({ ids: [n._id] })}>Open</Link>}{!n.readAt && <button className="underline" onClick={() => read.mutate({ ids: [n._id] })}>Mark read</button>}</div></Card></li>)}</ul> : <Alert tone="info">No notifications.</Alert>}</div>;
}
function Announcements({ isSuper }: { isSuper: boolean }) {
  const qc = useQueryClient(); const [status, setStatus] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['announcements', status], queryFn: () => api<any>(`/api/announcements?${qs({ status, pageSize: 50 })}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['announcements'] });
  return <div className="space-y-4"><AnnouncementForm isSuper={isSuper} emailConfigured={!!q.data?.emailConfigured} onDone={refresh} />
    <Card><div className="mb-2 flex flex-wrap items-end justify-between gap-2"><h2 className="font-semibold">Announcements</h2><div className="w-48"><Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{Object.entries(ANN_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></div></div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : q.data.items.length === 0 ? <p className="text-sm text-slate-600">No announcements yet.</p> :
        <ul className="divide-y">{q.data.items.map((a: any) => <li key={a._id} className="py-2"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><p className="font-medium">{a.title}</p>
          <p className="text-xs text-slate-600">{a.scope === 'system' ? 'All schools' : a.schoolId?.name ?? 'School'} · {a.audience.roles.map((r: Role) => ROLE_LABELS[r] ?? r).join(', ')} · {when(a.publishAt ?? a.createdAt)} to {when(a.expiresAt)} · {ANN_STATUS[a.status] ?? a.status}{a.email ? ' · email requested' : ''}</p></div>
          <Button variant="ghost" onClick={() => setOpen(open === a._id ? null : a._id)} aria-expanded={open === a._id}>{open === a._id ? 'Close' : 'Details'}</Button></div>
          {open === a._id && <AnnouncementDetail id={a._id} onChange={refresh} />}</li>)}</ul>}</Card></div>;
}
function AnnouncementForm({ isSuper, emailConfigured, onDone }: { isSuper: boolean; emailConfigured: boolean; onDone: () => void }) {
  const { user } = useAuth(); const schools = useQuery({ queryKey: ['/api/config/schools'], enabled: isSuper, queryFn: () => api<any>('/api/config/schools').then((r) => r.items) });
  const empty = () => ({ scope: isSuper ? 'system' : 'school', schoolId: '', title: '', body: '', link: '', roles: ['student', 'teacher'] as string[], publishAt: '', expiresAt: isoLocal(new Date(Date.now() + 14 * 86400000)), email: false });
  const [f, setF] = useState(empty); const [preview, setPreview] = useState<number | null>(null);
  const roleOpts: Role[] = f.scope === 'system' ? (['student', 'teacher', 'counselor', 'parent', 'school_admin', 'curriculum_admin', 'curriculum_editor', 'content_reviewer', 'system_operator', 'super_admin'] as Role[]) : (['student', 'teacher', 'counselor', 'parent', 'school_admin'] as Role[]);
  const body = () => ({ scope: f.scope, ...(f.scope === 'school' && f.schoolId ? { schoolId: f.schoolId } : {}), title: f.title, body: f.body, ...(f.link ? { link: f.link } : {}), audience: { roles: f.roles.filter((r) => roleOpts.includes(r as Role)) },
    ...(f.publishAt ? { publishAt: new Date(f.publishAt).toISOString() } : {}), expiresAt: new Date(f.expiresAt).toISOString(), email: f.email });
  const pv = useMutation({ mutationFn: () => post<any>('/api/announcements/preview-audience', body()), onSuccess: (r) => setPreview(r.recipients) });
  const create = useMutation({ mutationFn: () => post<any>('/api/announcements', body()), onSuccess: () => { setF(empty()); setPreview(null); onDone(); } });
  const err = (create.error ?? pv.error) as any;
  return <Card><h2 className="font-semibold">New announcement</h2><p className="mb-3 text-sm text-slate-600">Saved as a draft; publish it from the list. Do not include learners' names, phone numbers or email addresses: such announcements are refused.</p>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      {isSuper ? <Select label="Scope" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}><option value="system">System (all schools)</option><option value="school">One school</option></Select> : <p className="text-sm sm:col-span-1"><span className="font-medium">Scope:</span> your school{user?.schoolId ? '' : ' (not linked)'}</p>}
      {isSuper && f.scope === 'school' && <Select label="School" value={f.schoolId} onChange={(e) => setF({ ...f, schoolId: e.target.value })}><option value="">Choose a school</option>{schools.data?.map((s: any) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>}
      <Input label="Title" value={f.title} maxLength={150} onChange={(e) => setF({ ...f, title: e.target.value })} className="sm:col-span-2" />
      <label className="block text-sm font-medium sm:col-span-2">Message<textarea className="mt-1 block w-full rounded-lg border border-slate-300 p-2" rows={4} maxLength={4000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
      <Input label="Link inside GH Learn (optional)" placeholder="/learn" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} />
      <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Audience</legend><div className="mt-1 flex flex-wrap gap-4">{roleOpts.map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.roles.includes(r)} onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, r] : f.roles.filter((x) => x !== r) })} />{ROLE_LABELS[r]}</label>)}</div></fieldset>
      <Input label="Publish from (blank = when published)" type="datetime-local" value={f.publishAt} onChange={(e) => setF({ ...f, publishAt: e.target.value })} />
      <Input label="Publish until" type="datetime-local" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.email} disabled={!emailConfigured} onChange={(e) => setF({ ...f, email: e.target.checked })} />Also send by email{!emailConfigured && ' (email is not configured on this server)'}</label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><Button type="submit" loading={create.isPending}>Save draft</Button><Button type="button" variant="ghost" loading={pv.isPending} onClick={() => pv.mutate()}>Count recipients</Button>{preview != null && <span role="status" className="text-sm">{preview} recipient(s)</span>}{create.isSuccess && <span role="status" className="text-sm text-emerald-800">Draft saved.</span>}</div>
      {err && <div className="sm:col-span-2"><Alert>{err.message}</Alert></div>}</form></Card>;
}
function AnnouncementDetail({ id, onChange }: { id: string; onChange: () => void }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['announcement', id], queryFn: () => api<any>(`/api/announcements/${id}`) });
  const r = useQuery({ queryKey: ['announcement-recipients', id], enabled: !!q.data && q.data.announcement.status !== 'draft', queryFn: () => api<any>(`/api/announcements/${id}/recipients?pageSize=50`) });
  const done = () => { qc.invalidateQueries({ queryKey: ['announcement', id] }); qc.invalidateQueries({ queryKey: ['announcement-recipients', id] }); onChange(); };
  const pub = useMutation({ mutationFn: () => post(`/api/announcements/${id}/publish`, {}), onSuccess: done });
  const wd = useMutation({ mutationFn: () => post(`/api/announcements/${id}/withdraw`, {}), onSuccess: done });
  const rm = useMutation({ mutationFn: () => del(`/api/announcements/${id}`), onSuccess: onChange });
  if (q.isLoading) return <Spinner />; if (q.error) return <ErrorBox error={q.error} />;
  const a = q.data.announcement; const dlv = a.delivery;
  return <div className="mt-2 space-y-3 rounded-lg bg-slate-50 p-3 text-sm"><p className="whitespace-pre-wrap">{a.body}</p>
    {dlv && <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat k="Recipients" v={dlv.recipients} /><Stat k="Delivered in app" v={dlv.inApp?.delivered ?? 0} /><Stat k="Read" v={dlv.read} /><Stat k="Email" v={Object.entries(dlv.email ?? {}).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', ') || '—'} /></dl>}
    <div className="flex flex-wrap gap-2">{a.status === 'draft' && <><Button loading={pub.isPending} onClick={() => pub.mutate()}>{a.publishAt && new Date(a.publishAt) > new Date() ? 'Schedule' : 'Publish now'}</Button>
      <ConfirmButton label="Delete draft" variant="danger" title="Delete this draft?" body={<p>The draft is removed. This is recorded in the audit log.</p>} onConfirm={() => rm.mutateAsync()} /></>}
      {['scheduled', 'published'].includes(a.status) && <ConfirmButton label="Withdraw" variant="danger" title="Withdraw this announcement?" body={<p>It disappears from every inbox. Delivery records are kept.</p>} onConfirm={() => wd.mutateAsync()} />}</div>
    {(pub.error || wd.error) && <Alert>{(pub.error ?? wd.error)!.message}</Alert>}
    {r.data && <ReportTable caption="Recipients and delivery" rows={r.data.items} empty="Delivery has not started yet." columns={[{ key: 'name', label: 'Recipient' }, { key: 'roles', label: 'Roles', render: (x) => (x.roles ?? []).map((y: Role) => ROLE_LABELS[y] ?? y).join(', ') }, { key: 'inApp', label: 'In app' }, { key: 'email', label: 'Email', render: (x) => String(x.email).replace(/_/g, ' ') }, { key: 'readAt', label: 'Read', render: (x) => (x.readAt ? when(x.readAt) : 'Not yet') }]} />}
    {r.data?.total > 50 && <p className="text-xs text-slate-600">Showing the first 50 of {r.data.total} recipients.</p>}</div>;
}
