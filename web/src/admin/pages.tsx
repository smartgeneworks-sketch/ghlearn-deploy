import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download } from 'lucide-react';
import { changePasswordSchema, hasPermission, ROLE_LABELS } from '@ghlearn/shared';
import { LESSON_STATUS_LABEL, LESSON_STATUSES } from '../lib/lessonStatus';
import { api, post, del, download } from '../lib/api';
import { ConfirmButton } from '../components/ConfirmDialog';
import { useAuth } from '../lib/auth';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { DataTable, useUrlState } from './DataTable';
import { ChartCard, type ChartData } from './OverviewCharts';

/** Page header used by every admin screen (spec §3C: title, description, actions). */
export function AdminPage({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return <section className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">{title}</h1>{description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}</div>{actions}</div>{children}</section>;
}
const list = (k: string, enabled = true) => ({ queryKey: ['/api/config/' + k], enabled, queryFn: () => api<{ items: any[] }>('/api/config/' + k).then((r) => r.items) });
const when = (d?: string) => (d ? new Date(d).toLocaleString() : '');
const dateOnly = (d: unknown) => (d ? new Date(String(d)).toISOString().slice(0, 10) : '');

/** §5 Overview (v1): live, permission-filtered cards and activity. Charts follow in Phase 3. */
export function OverviewPage() {
  const { user } = useAuth(); const u = useUrlState();
  const isSuper = user!.roles.includes('super_admin');
  const f = { from: u.get('from'), to: u.get('to'), levelId: u.get('levelId'), subjectId: u.get('subjectId'), schoolId: u.get('schoolId') };
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const q = useQuery({ queryKey: ['admin-overview', qs], queryFn: () => api<any>(`/api/admin/overview${qs ? `?${qs}` : ''}`) });
  const charts = useQuery({ queryKey: ['admin-overview-charts', qs], queryFn: () => api<any>(`/api/admin/overview/charts${qs ? `?${qs}` : ''}`) });
  const levels = useQuery(list('levels')); const subjects = useQuery(list('subjects')); const schools = useQuery(list('schools', isSuper));
  const set = (k: string) => (e: any) => u.set({ [k]: e.target.value || undefined, ...(k === 'levelId' ? { subjectId: undefined } : {}) });
  const subj = (subjects.data ?? []).filter((s) => !f.levelId || s.levelId === f.levelId);
  return <AdminPage title="Overview" description={q.data?.scope === 'school' ? 'Live figures for your school.' : 'Live figures across the platform. Each card opens the matching management page.'}>
    <Card><form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => e.preventDefault()} aria-label="Overview filters">
      <Input label="From" type="date" value={f.from} onChange={set('from')} /><Input label="To" type="date" value={f.to} onChange={set('to')} />
      <Select label="Level" value={f.levelId} onChange={set('levelId')}><option value="">All levels</option>{levels.data?.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select>
      <Select label="Subject" value={f.subjectId} onChange={set('subjectId')}><option value="">All subjects</option>{subj.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
      {isSuper && <Select label="School" value={f.schoolId} onChange={set('schoolId')}><option value="">All schools</option>{schools.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>}
    </form>{q.data && <p className="mt-2 text-xs text-slate-600">Period: {dateOnly(q.data.filters.from)} to {dateOnly(q.data.filters.to)} (default: last 30 days). Cards for active users, failed jobs and AI requests and all trend charts use the period; other cards are current totals.</p>}</Card>
    {q.isLoading ? <Spinner /> : q.error ? <Alert>{q.error.message}</Alert> : <>
      {q.data.warnings.length > 0 && <section aria-labelledby="warn-h" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><h2 id="warn-h" className="mb-1 font-semibold">System warnings</h2>
        <ul className="space-y-1">{q.data.warnings.map((w: any) => <li key={w.text} className="flex min-w-0 items-start gap-2 [overflow-wrap:anywhere]"><AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${w.level === 'info' ? 'opacity-60' : ''}`} aria-hidden /><span><span className="sr-only">{w.level === 'info' ? 'Info: ' : 'Warning: '}</span>{w.text} {w.link && <Link to={w.link} className="font-medium underline">Review</Link>}</span></li>)}</ul></section>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Key figures">{q.data.cards.map((c: any) => {
        const body = <><p className="text-sm text-slate-600">{c.label}</p><p className="text-3xl font-bold text-slate-900">{c.value.toLocaleString()}</p>{c.hint && <p className="mt-1 text-xs text-slate-600">{c.hint}</p>}</>;
        return <li key={c.key}>{c.link ? <Link to={c.link} className="block h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-600 focus:border-brand-600">{body}</Link> : <div className="h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm">{body}</div>}</li>;
      })}</ul>
      <section aria-labelledby="charts-h" className="space-y-3"><h2 id="charts-h" className="text-lg font-semibold">Trends{charts.data && <span className="ml-2 text-sm font-normal text-slate-600">by {charts.data.unit}</span>}</h2>
        {charts.isLoading ? <Spinner label="Loading charts" /> : charts.error ? <Alert>{charts.error.message}</Alert> : !charts.data.charts.length ? <Alert tone="info">No charts for your role.</Alert>
          : <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">{charts.data.charts.map((c: ChartData) => <ChartCard key={c.key} c={c} buckets={charts.data.buckets} unit={charts.data.unit} />)}</div>}</section>
      <section aria-labelledby="act-h" className="space-y-3"><h2 id="act-h" className="text-lg font-semibold">Recent activity</h2><div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {q.data.activity.manuals && <Activity title="Recent learner manuals" more={{ to: q.data.links.manuals, label: 'All manuals' }} items={q.data.activity.manuals.map((d: any) => ({ id: d._id, to: `/admin/documents/${d._id}`, title: d.title, meta: `${d.processingStatus} · ${when(d.createdAt)}` }))} />}
        {q.data.activity.generated && <Activity title="Recently generated content" more={{ to: q.data.links.generated, label: 'All lessons' }} items={q.data.activity.generated.map((g: any) => ({ id: g._id, to: g.kind === 'lesson' ? `/admin/lessons/${g._id}` : `/admin/questions?q=${encodeURIComponent(g.topic ?? '')}`, title: g.title, meta: `${g.kind} · ${g.status} · ${when(g.createdAt)}` }))} />}
        {q.data.activity.approvals && <Activity title="Pending approvals" more={{ to: q.data.links.approvals, label: 'Open review queue' }} items={q.data.activity.approvals.map((l: any) => ({ id: l._id, to: l.kind === 'lesson' ? `/admin/lessons/${l._id}` : `/admin/questions?status=in_review&q=${encodeURIComponent(l.topic ?? '')}`, title: l.title, meta: `${l.kind} · waiting since ${when(l.updatedAt)}` }))} />}
        {q.data.activity.failedJobs && <Activity title="Failed jobs" more={q.data.links.failedJobs ? { to: q.data.links.failedJobs, label: hasPermission(user!.roles, 'system:health') ? 'System status' : 'Failed documents' } : undefined} items={q.data.activity.failedJobs.map((j: any) => ({ id: j._id, to: j.documentId && hasPermission(user!.roles, 'documents:map') ? `/admin/documents/${j.documentId}` : undefined, title: `${j.type} (${j.status}, ${j.attempts} attempts)`, meta: `${when(j.updatedAt)}${j.error ? ` · ${j.error}` : ''}` }))} />}
        {q.data.activity.audit && <Activity title="Recent admin actions" more={{ to: q.data.links.audit, label: 'Audit logs' }} items={q.data.activity.audit.map((a: any) => ({ id: a._id, to: a.requestId ? `/admin/audit?requestId=${encodeURIComponent(a.requestId)}` : undefined, title: `${a.action}${a.outcome && a.outcome !== 'success' ? ` (${a.outcome})` : ''}`, meta: `${a.actorId?.fullName ?? 'system'} · ${when(a.createdAt)}` }))} />}
      </div></section></>}
  </AdminPage>;
}
function Activity({ title, items, more }: { title: string; items: { id: string; to?: string; title: string; meta: string }[]; more?: { to: string; label: string } }) {
  return <Card><div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">{title}</h2>{more && <Link to={more.to} className="text-sm text-brand-700 underline">{more.label}</Link>}</div>
    {items.length ? <ul className="divide-y text-sm">{items.map((i) => <li key={i.id} className="min-w-0 py-1.5 [overflow-wrap:anywhere]">{i.to ? <Link to={i.to} className="text-brand-700 underline">{i.title}</Link> : <span className="font-medium">{i.title}</span>}<p className="truncate text-xs text-slate-600">{i.meta}</p></li>)}</ul> : <p className="text-sm text-slate-600">Nothing here yet.</p>}</Card>;
}

/** §16 System Settings, status part (System Operator): real service health. Editable settings arrive in Phase 10. */
/** Live status (the "Status" tab of System settings). */
export function SystemStatus() {
  const q = useQuery({ queryKey: ['admin-system'], queryFn: () => api<any>('/api/admin/system'), refetchInterval: 30_000 });
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate-600">Service health, job queues and recent failures. Refreshes every 30 seconds. Secrets are never shown.</p>{<Link to="/admin/processing" className="text-sm text-brand-700 underline">Document processing monitor</Link>}</div>
    {q.isLoading ? <Spinner /> : q.error ? <Alert>{q.error.message}</Alert> : <>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Health">
        <Stat label="Database" value={q.data.db.ok ? 'OK' : 'Unreachable'} hint={`ping ${q.data.db.pingMs} ms`} bad={!q.data.db.ok} />
        <Stat label="AI provider" value={q.data.ai.configured ? 'Configured' : 'Not configured'} hint={Object.entries(q.data.ai.last24h).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'no calls in 24 h'} bad={!q.data.ai.configured} />
        <Stat label="Uptime" value={`${Math.floor(q.data.uptimeSec / 3600)} h ${Math.floor((q.data.uptimeSec % 3600) / 60)} min`} hint={`Node ${q.data.node}${q.data.commit ? ` · build ${q.data.commit}` : ''}`} />
        <Stat label="Memory" value={`${q.data.memoryMb.rss} MB`} hint={`heap ${q.data.memoryMb.heapUsed} MB`} />
      </ul>
      <Card><h2 className="mb-2 font-semibold">Job queues</h2>{q.data.oldestQueued && <p className="mb-2 text-sm">Oldest queued: {q.data.oldestQueued.type}, waiting {q.data.oldestQueued.waitingSec} s</p>}
        <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="w-full text-left text-sm"><caption className="sr-only">Jobs by type and status</caption><thead><tr className="border-b"><th scope="col" className="py-1">Type</th>{['queued', 'running', 'succeeded', 'failed', 'dead', 'cancelled'].map((s) => <th key={s} scope="col" className="capitalize">{s}</th>)}</tr></thead>
          <tbody>{Object.entries(q.data.queues).map(([t, c]: any) => <tr key={t} className="border-b last:border-0"><td className="py-1"><code>{t}</code></td>{['queued', 'running', 'succeeded', 'failed', 'dead', 'cancelled'].map((s) => <td key={s}>{c[s] ?? 0}</td>)}</tr>)}</tbody></table></div></Card>
      <Card><h2 className="mb-2 font-semibold">Recent failures</h2>{q.data.recentFailures.length ? <ul className="divide-y text-sm">{q.data.recentFailures.map((j: any) => <li key={j.id} className="py-1.5"><code>{j.type}</code> · {j.status} · {j.attempts} attempts · {when(j.at)}<p className="text-xs text-slate-600">{j.error}</p></li>)}</ul> : <p className="text-sm text-slate-600">No failed jobs.</p>}</Card>
    </>}
  </div>;
}
const Stat = ({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) => <li className={`rounded-xl border bg-white p-4 shadow-sm ${bad ? 'border-red-300' : 'border-slate-200'}`}><p className="text-sm text-slate-600">{label}</p><p className={`text-xl font-bold ${bad ? 'text-red-800' : ''}`}>{value}</p>{hint && <p className="text-xs text-slate-600">{hint}</p>}</li>;

/** §3B account settings: profile summary, change password, sign out everywhere. */
/** The signed-in user's own sessions (refresh-token families) with per-session revoke. */
export function MySessions() {
  const q = useQuery({ queryKey: ['my-sessions'], queryFn: () => api<{ items: any[] }>('/api/auth/sessions').then((r) => r.items) });
  if (q.isLoading) return <Spinner />; if (q.error) return <Alert>{(q.error as Error).message}</Alert>;
  return <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="w-full text-left text-sm"><caption className="sr-only">Your active sessions</caption><thead><tr><th scope="col" className="border-b py-1">Signed in</th><th scope="col" className="border-b py-1">Last active</th><th scope="col" className="border-b py-1">Device</th><th className="border-b"><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{q.data!.map((s) => <tr key={s.id} className="border-b last:border-0"><td className="py-1">{new Date(s.startedAt).toLocaleString()}</td><td>{new Date(s.lastUsedAt).toLocaleString()}</td><td className="max-w-xs truncate" title={s.userAgent ?? ''}>{s.current ? <strong>This device. </strong> : null}{s.userAgent ?? 'Unknown'}</td>
      <td className="text-right">{!s.current && <ConfirmButton label="Revoke" ariaLabel={`Revoke session from ${new Date(s.startedAt).toLocaleString()}`} title="Revoke this session?" body={<p>That device is signed out at once.</p>} onConfirm={() => del(`/api/auth/sessions/${s.id}`).then(() => q.refetch())} />}</td></tr>)}
      {!q.data!.length && <tr><td colSpan={4} className="py-2 text-slate-600">No other sessions.</td></tr>}</tbody></table></div>;
}
export function AccountPage() {
  const { user, logout } = useAuth();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' }); const [err, setErr] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => post('/api/auth/change-password', { currentPassword: f.currentPassword, newPassword: f.newPassword }), onSuccess: () => setF({ currentPassword: '', newPassword: '', confirm: '' }) });
  const all = useMutation({ mutationFn: () => post('/api/auth/logout-all', {}), onSuccess: () => logout().then(() => { window.location.href = '/login'; }) });
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (f.newPassword !== f.confirm) return setErr('The new passwords do not match.');
    const r = changePasswordSchema.safeParse({ currentPassword: f.currentPassword, newPassword: f.newPassword }); if (!r.success) return setErr(r.error.issues[0].message);
    m.mutate();
  };
  return <AdminPage title="Account settings" description="Your sign-in details. Role changes are made by an administrator.">
    <Card><dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]"><dt className="font-medium">Name</dt><dd>{user!.fullName}</dd><dt className="font-medium">Email</dt><dd>{user!.email}</dd><dt className="font-medium">Roles</dt><dd>{user!.roles.map((r) => ROLE_LABELS[r]).join(', ')}</dd></dl></Card>
    <Card><h2 className="mb-3 font-semibold">Change password</h2><form noValidate onSubmit={submit} className="grid max-w-md gap-3">
      <Input label="Current password" type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
      <Input label="New password" type="password" autoComplete="new-password" hint="At least 10 characters with a letter and a number." value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
      <Input label="Confirm new password" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
      {(err || m.error) && <Alert>{err ?? m.error!.message}</Alert>}{m.isSuccess && <Alert tone="success">Password changed. Your other sessions were signed out.</Alert>}
      <div><Button type="submit" loading={m.isPending}>Change password</Button></div></form></Card>
    <Card><h2 className="mb-2 font-semibold">Sessions</h2><MySessions />
      <p className="mb-3 mt-4 text-sm text-slate-600">Sign out on every device, including this one.</p>
      <ConfirmButton label="Sign out of all devices" variant="danger" className="px-4 py-2" title="Sign out of all devices?" body={<p>Every session ends, including this one. You will need to sign in again.</p>} onConfirm={() => all.mutateAsync()} />{all.error && <Alert>{all.error.message}</Alert>}</Card>
  </AdminPage>;
}

/** Global search results (top bar). Server returns only what the caller may open. */
export function SearchPage() {
  const [sp] = useSearchParams(); const q = sp.get('q') ?? '';
  const r = useQuery({ queryKey: ['admin-search', q], enabled: q.trim().length >= 2, queryFn: () => api<any>(`/api/admin/search?q=${encodeURIComponent(q)}`) });
  return <AdminPage title="Search results" description={q ? `Results for “${q}” that you have access to.` : 'Type at least 2 characters in the search box.'}>
    {q.trim().length < 2 ? <Alert tone="info">Type at least 2 characters.</Alert> : r.isLoading ? <Spinner /> : r.error ? <Alert>{r.error.message}</Alert> : !r.data.groups.length ? <Alert tone="info">No matches.</Alert>
      : r.data.groups.map((g: any) => <Card key={g.type}><h2 className="mb-2 font-semibold">{g.label}</h2><ul className="divide-y text-sm">{g.items.map((i: any) => <li key={i.id} className="min-w-0 py-1.5 [overflow-wrap:anywhere]"><Link to={i.link} className="text-brand-700 underline">{i.title}</Link>{i.subtitle && <p className="text-xs text-slate-600">{i.subtitle}</p>}</li>)}</ul></Card>)}
  </AdminPage>;
}

/** §12 Content review queue: waiting items (awaiting review and resubmitted) oldest first; filters in the URL. Review actions are on the item page. */
export function ReviewQueuePage() {
  const u = useUrlState(); const subjects = useQuery(list('subjects'));
  const mapping = (l: any) => [l.strand, l.subStrand, l.indicator].filter(Boolean).join(' › ');
  return <AdminPage title="Content review and publishing" description="Generated content waiting for review, oldest first. Open an item to compare it with its source passages, comment, approve, request changes, or publish.">
    <DataTable path="/api/lessons?review=queue" caption="Review queue" searchLabel="Search title or topic" defaultSort="submittedAt" filterKeys={['status', 'subjectId', 'assigned']} pageSizes={[25, 50]}
      toolbar={<><div className="w-56"><Select label="Status" value={u.get('status')} onChange={(e) => u.set({ status: e.target.value || undefined })}><option value="">Waiting (awaiting review or resubmitted)</option>{LESSON_STATUSES.map((v) => <option key={v} value={v}>{LESSON_STATUS_LABEL[v]}</option>)}</Select></div>
        <div className="w-48"><Select label="Assigned reviewer" value={u.get('assigned')} onChange={(e) => u.set({ assigned: e.target.value || undefined })}><option value="">Anyone</option><option value="me">Me</option><option value="none">Not assigned</option></Select></div>
        <div className="w-56"><Select label="Subject" value={u.get('subjectId')} onChange={(e) => u.set({ subjectId: e.target.value || undefined })}><option value="">All subjects</option>{subjects.data?.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select></div></>}
      columns={[
        { key: 'title', header: 'Title', sortable: true, render: (l: any) => <Link to={`/admin/lessons/${l._id}`} className="text-brand-700 underline">{l.title}</Link> },
        { key: 'subject', header: 'Subject', render: (l: any) => l.subjectId?.name ?? '' },
        { key: 'topic', header: 'Topic', render: (l: any) => l.topic ?? '' },
        { key: 'source', header: 'Source manual', render: (l: any) => (l.sourceDocumentIds?.length ? l.sourceDocumentIds.map((d: any) => d.title + (d.approvalStatus !== 'verified_official' ? ' (not verified)' : '')).join('; ') : 'All approved manuals') },
        { key: 'createdAt', header: 'Generated', sortable: true, render: (l: any) => when(l.createdAt) },
        { key: 'createdBy', header: 'Creator', render: (l: any) => l.createdBy?.fullName ?? '' },
        { key: 'mapping', header: 'Curriculum mapping', render: (l: any) => mapping(l) ? <>{mapping(l)}{l.indicatorSource === 'editor' && <span className="block text-xs text-slate-600">entered by editor</span>}</> : <span className="text-amber-900">Not mapped</span> },
        { key: 'status', header: 'Status', sortable: true, render: (l: any) => LESSON_STATUS_LABEL[l.status] ?? l.status },
        { key: 'reviewer', header: 'Assigned reviewer', render: (l: any) => l.assignedReviewerId?.fullName ?? '—' },
        { key: 'version', header: 'Revisions', render: (l: any) => l.version ?? 0 },
        { key: 'submittedAt', header: 'Submitted', sortable: true, render: (l: any) => when(l.submittedAt) },
      ]} />
  </AdminPage>;
}

/** §19 Audit logs: append-only, filterable, exportable (CSV, audited). */
export function AuditLogPage() {
  const u = useUrlState(); const acts = useQuery({ queryKey: ['audit-actions'], queryFn: () => api<any>('/api/admin/audit?pageSize=1').then((r) => ({ actions: r.actions as string[], entityTypes: (r.entityTypes ?? []) as string[] })) });
  const keys = ['action', 'actor', 'outcome', 'entityType', 'target', 'from', 'to', 'requestId']; const [err, setErr] = useState<string | null>(null);
  const exp = (format: 'csv' | 'xlsx') => { setErr(null); download(`/api/admin/audit/export?${exportQs}${exportQs ? '&' : ''}format=${format}`, `audit.${format}`).catch((e) => setErr(e.message)); };
  const exportQs = new URLSearchParams(keys.filter((k) => u.get(k)).map((k) => [k, u.get(k)])).toString();
  const set = (k: string) => (e: any) => u.set({ [k]: e.target.value || undefined });
  return <AdminPage title="Audit logs" description="Every security-relevant action, append-only. Passwords, tokens and keys are never recorded. Exports (up to 5,000 rows, current filters) are themselves recorded."
    actions={<div className="flex gap-2"><Button variant="ghost" onClick={() => exp('csv')}><Download className="h-4 w-4" aria-hidden />Export CSV</Button><Button variant="ghost" onClick={() => exp('xlsx')}><Download className="h-4 w-4" aria-hidden />Export Excel</Button></div>}>
    {err && <Alert>{err}</Alert>}
    <DataTable path="/api/admin/audit" caption="Audit log entries" searchLabel={null} filterKeys={keys} pageSizes={[50, 100, 200]}
      select={(r) => ({ ...r, pageSize: r.pageSize ?? 50 })}
      toolbar={<div className="grid w-full gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
        <Select label="Action" value={u.get('action')} onChange={set('action')}><option value="">All</option>{acts.data?.actions.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
        <Select label="Resource type" value={u.get('entityType')} onChange={set('entityType')}><option value="">All</option>{acts.data?.entityTypes.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}</Select>
        <Input label="Resource id" value={u.get('target')} onChange={set('target')} />
        <Input label="Actor (name or email)" value={u.get('actor')} onChange={set('actor')} />
        <Select label="Outcome" value={u.get('outcome')} onChange={set('outcome')}><option value="">All</option><option value="success">Success</option><option value="failure">Failure</option><option value="denied">Denied</option></Select>
        <Input label="From" type="date" value={u.get('from')} onChange={set('from')} /><Input label="To" type="date" value={u.get('to')} onChange={set('to')} />
        <Input label="Request id" value={u.get('requestId')} onChange={set('requestId')} /></div>}
      columns={[
        { key: 'createdAt', header: 'When', render: (i: any) => <span className="whitespace-nowrap">{when(i.createdAt)}</span> },
        { key: 'actor', header: 'Who', render: (i: any) => <>{i.actorId?.fullName ?? 'anonymous / system'}<br /><span className="text-xs text-slate-600">{i.actorId?.email}</span></> },
        { key: 'action', header: 'Action', render: (i: any) => <code>{i.action}</code> },
        { key: 'outcome', header: 'Outcome', render: (i: any) => <span className={i.outcome && i.outcome !== 'success' ? 'font-semibold text-red-800' : ''}>{i.outcome ?? 'success'}</span> },
        { key: 'target', header: 'Target', render: (i: any) => <><span className="text-xs text-slate-600">{i.entityType}</span> <code className="text-xs">{i.target}</code></> },
        { key: 'changes', header: 'Changes / details', render: (i: any) => <code className="block max-w-sm whitespace-pre-wrap break-all text-xs">{i.before || i.after ? `${JSON.stringify(i.before ?? {})} → ${JSON.stringify(i.after ?? {})}` : i.meta ? JSON.stringify(i.meta) : ''}</code> },
        { key: 'requestId', header: 'Request', render: (i: any) => <code className="text-xs">{i.requestId?.slice(0, 8)}</code> },
      ]} />
  </AdminPage>;
}
