/** §10 Document Processing Monitor: jobs list, health, failed-job inspector, retry / cancel / purge. */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission, OCR_STATUS_LABELS } from '@ghlearn/shared';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { api, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { ConfirmButton } from '../components/ConfirmDialog';
import { AdminPage } from './pages';
import { DataTable, useUrlState, type Column } from './DataTable';
import { Badge, ErrorBox, Facts, Section, when } from './common';

export type Measure = { current: number; total: number; unit: string } | null;
/** Real progress when the stage counts work; otherwise an indeterminate bar (never an invented percentage). */
export function JobProgress({ progress, label, id }: { progress: Measure; label: string; id: string }) {
  if (progress) {
    const pct = Math.round((progress.current / progress.total) * 100);
    return <div className="min-w-[8rem] space-y-1"><div className="text-xs" id={id}>{label}: {progress.current} of {progress.total} {progress.unit}</div>
      <div role="progressbar" aria-labelledby={id} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.current} aria-valuetext={`${progress.current} of ${progress.total} ${progress.unit}`} className="h-2 rounded bg-slate-200"><div className="h-2 rounded bg-brand-600" style={{ width: `${pct}%` }} /></div></div>;
  }
  return <div className="min-w-[8rem] space-y-1"><div className="text-xs" id={id}>{label}: in progress (not measured at this stage)</div>
    <div role="progressbar" aria-labelledby={id} aria-valuetext="In progress" className="h-2 overflow-hidden rounded bg-slate-200"><div className="h-2 w-1/3 animate-pulse rounded bg-brand-600/70" /></div></div>;
}
const TONE: Record<string, string> = { queued: 'pending', extracting: 'pending', ocr: 'pending', mapping: 'pending', indexing: 'pending', awaiting_validation: 'suspended', completed: 'active', failed: 'failed', cancelled: 'cancelled' };
export const StatusBadge = ({ s, label }: { s: string; label: string }) => <Badge v={TONE[s] ?? 'pending'} label={label} />;
const STAGE_LABEL: Record<string, string> = { done: 'Done', running: 'In progress', failed: 'Failed', pending: 'Pending', cancelled: 'Cancelled', unknown: '—',
  test_only: 'Indexed (test embeddings)', text_only: 'Text only (no embedding provider)', embedding_failed: 'Passages stored, embeddings failed' };
const stageText = (v: string, ocr = false) => (ocr ? (OCR_STATUS_LABELS as Record<string, string>)[v] : undefined) ?? STAGE_LABEL[v] ?? v.replace(/_/g, ' ');
const RUNNING_STATES = ['extracting', 'ocr', 'mapping', 'indexing'];
const useSubjects = () => useQuery({ queryKey: ['/api/config/subjects', ''], queryFn: () => api<{ items: any[] }>('/api/config/subjects').then((r) => r.items) });
const useCanDocs = () => { const { user } = useAuth(); return ['documents:upload', 'documents:map', 'content:review'].some((p) => hasPermission(user!.roles, p as any)); };
const shortId = (id: string) => id.slice(-8);

export function ManualLink({ doc }: { doc: any }) {
  const canDocs = useCanDocs();
  if (!doc) return <span className="text-slate-600">Manual deleted</span>;
  return canDocs ? <Link to={`/admin/documents/${doc.id}`} className="text-brand-700 underline">{doc.title}</Link> : <span>{doc.title}</span>;
}

function StatusCell({ r }: { r: any }) {
  return <div className="space-y-1"><StatusBadge s={r.status} label={r.label} />
    {r.waitingForRetry && <p className="text-xs text-slate-700">Retry {r.attempts + 1} of {r.maxAttempts} at {when(r.nextAttemptAt)}</p>}
    {r.stalled && <p className="text-xs text-amber-800">Lease expired; resumes on the next worker poll</p>}
    {RUNNING_STATES.includes(r.status) && <JobProgress id={`p-${r.id}`} progress={r.progress} label={r.label} />}</div>;
}

function HealthPanel() {
  const u = useUrlState();
  const h = useQuery({ queryKey: ['jobs-health'], queryFn: () => api<any>('/api/jobs/health'), refetchInterval: 15_000 });
  if (h.isLoading) return <Spinner label="Loading health" />; if (h.error) return <ErrorBox error={h.error} />;
  const d = h.data; const labels: Record<string, string> = { queued: 'Queued', extracting: 'Extracting', ocr: 'OCR processing', mapping: 'Mapping curriculum', indexing: 'Indexing', awaiting_validation: 'Awaiting validation', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };
  return <section aria-labelledby="health-h" className="space-y-3"><h2 id="health-h" className="text-lg font-semibold">Processing health</h2>
    {d.warnings.length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><ul className="space-y-1">{d.warnings.map((w: string) => <li key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{w}</span></li>)}</ul></div>}
    <ul className="flex flex-wrap gap-2" aria-label="Jobs by status">{Object.entries(d.counts).map(([k, n]: any) => <li key={k}>
      <button type="button" aria-pressed={u.get('status') === k} onClick={() => u.set({ status: u.get('status') === k ? undefined : k })} className={`rounded-lg border px-3 py-1.5 text-sm ${u.get('status') === k ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-slate-300 bg-white'}`}>{labels[k]}: {n}</button></li>)}</ul>
    <Card><Facts items={[
      ['Database', d.db.ok ? `OK (${d.db.pingMs} ms)` : 'Not responding'],
      ['Worker (this instance)', d.worker.enabled ? `Running · last poll ${when(d.worker.lastPollAt)} · last job claimed ${when(d.worker.lastClaimAt)}` : 'Not running'],
      ['Oldest queued', d.oldestQueued ? (d.oldestQueued.waitingSec ? `waiting ${Math.round(d.oldestQueued.waitingSec / 60)} min` : `scheduled for ${when(d.oldestQueued.scheduledFor)}`) : 'Nothing queued'],
      ['Stalled running jobs', String(d.stalledRunning)],
      ['Last 24 hours', `${d.last24h.completed} finished, ${d.last24h.failed} failed · last success ${when(d.lastSuccessAt)}`],
      ['OCR', d.providers.ocr === 'disabled' ? 'Not configured' : d.providers.ocr],
      ['Embeddings', d.providers.embeddings === 'disabled' ? 'Not configured (text search only)' : d.providers.embeddings],
      ['Upload storage', d.storage.usedMb == null ? 'Unknown' : `${d.storage.usedMb} of ${d.storage.quotaMb} MB`],
    ]} /><p className="mt-2 text-xs text-slate-600">Checked {when(d.checkedAt)}. {d.worker.note}</p></Card></section>;
}

function PurgeCard() {
  const qc = useQueryClient(); const [days, setDays] = useState('30');
  const n = Number(days); const valid = Number.isInteger(n) && n >= 1 && n <= 3650;
  const preview = useMutation({ mutationFn: () => post<any>('/api/jobs/purge', { olderThanDays: n, dryRun: true }) });
  const run = () => post<any>('/api/jobs/purge', { olderThanDays: n, dryRun: false }).then((r) => { preview.reset(); qc.invalidateQueries({ queryKey: ['/api/jobs'] }); qc.invalidateQueries({ queryKey: ['jobs-health'] }); setDone(r.deleted); });
  const [done, setDone] = useState<number | null>(null);
  return <Card><h2 className="mb-1 font-semibold">Purge job history</h2><p className="mb-3 text-sm text-slate-600">Deletes finished, failed and cancelled processing jobs older than the given age. Each manual's current job is always kept, and manuals, pages and passages are not touched.</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (valid) { setDone(null); preview.mutate(); } }}>
      <div className="w-40"><Input label="Older than (days)" type="number" min={1} max={3650} value={days} onChange={(e) => { setDays(e.target.value); preview.reset(); }} error={valid ? undefined : 'Enter 1 to 3650'} /></div>
      <Button type="submit" variant="ghost" loading={preview.isPending} disabled={!valid}>Preview</Button>
      {preview.data && (preview.data.matched > 0
        ? <ConfirmButton label={`Purge ${preview.data.matched} job${preview.data.matched === 1 ? '' : 's'}`} title="Purge job history?" confirmLabel="Purge" body={<p>{preview.data.matched} job record(s) finished before {when(preview.data.cutoff)} will be deleted permanently.</p>} onConfirm={run} />
        : <p className="text-sm" role="status">No jobs match.</p>)}
    </form>{preview.error && <ErrorBox error={preview.error} />}{done != null && <Alert tone="success">Deleted {done} job record(s).</Alert>}</Card>;
}

export function ProcessingMonitorPage() {
  const { user } = useAuth(); const u = useUrlState(); const subjects = useSubjects();
  const ops = hasPermission(user!.roles, 'system:health');
  const columns: Column<any>[] = [
    { key: 'id', header: 'Job', render: (r) => <Link to={`/admin/processing/${r.id}`} className="font-mono text-brand-700 underline" aria-label={`Inspect job ${r.id}`}>{shortId(r.id)}</Link> },
    { key: 'manual', header: 'Manual', render: (r) => <div><ManualLink doc={r.document} />{r.document?.superseded && <span className="ml-1 text-xs text-slate-600">(replaced)</span>}</div> },
    { key: 'subject', header: 'Subject', render: (r) => r.document?.subject ?? '—' },
    { key: 'uploader', header: 'Uploader', render: (r) => r.uploader ?? '—' },
    { key: 'status', header: 'Status', render: (r) => <StatusCell r={r} /> },
    { key: 'createdAt', header: 'Started / ended', sortable: true, render: (r) => <div className="whitespace-nowrap text-xs"><div>{r.startedAt ? when(r.startedAt) : `Queued ${when(r.createdAt)}`}</div><div>{r.finishedAt ? when(r.finishedAt) : '—'}</div></div> },
    { key: 'pages', header: 'Pages', render: (r) => r.pagesProcessed ?? '—' },
    { key: 'stages', header: 'Extraction · OCR · Indexing', render: (r) => <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs"><dt>Extraction</dt><dd>{stageText(r.stageStatus.extraction)}</dd><dt>OCR</dt><dd>{stageText(r.stageStatus.ocr, true)}</dd><dt>Indexing</dt><dd>{stageText(r.stageStatus.indexing)}</dd></dl> },
    { key: 'error', header: 'Error', render: (r) => r.error ? <p className="max-w-xs text-xs text-red-800">{r.error.stage ? `${r.error.stage}: ` : ''}{r.error.message}</p> : '—' },
    { key: 'attempts', header: 'Retries', sortable: true, render: (r) => r.retries },
  ];
  return <AdminPage title="Document processing monitor" description="Every manual processing run with its real stage. Progress bars appear only where the pipeline counts work (pages extracted, pages OCR'd, passages embedded). Refreshes every 10 seconds.">
    <HealthPanel />
    <section aria-labelledby="jobs-h" className="space-y-3"><h2 id="jobs-h" className="text-lg font-semibold">Jobs</h2>
      <DataTable path="/api/jobs" caption="Document processing jobs" searchLabel="Search manual title or job id" defaultSort="-createdAt" filterKeys={['status', 'subjectId', 'from', 'to', 'retries']} rowKey={(r: any) => r.id} refetchInterval={10_000}
        toolbar={<>
          <div className="w-48"><Select label="Status" value={u.get('status')} onChange={(e) => u.set({ status: e.target.value || undefined })}><option value="">All statuses</option>
            {[['queued', 'Queued'], ['extracting', 'Extracting'], ['ocr', 'OCR processing'], ['mapping', 'Mapping curriculum'], ['indexing', 'Indexing'], ['awaiting_validation', 'Awaiting validation'], ['completed', 'Completed'], ['failed', 'Failed'], ['cancelled', 'Cancelled']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>
          <div className="w-52"><Select label="Subject" value={u.get('subjectId')} onChange={(e) => u.set({ subjectId: e.target.value || undefined })}><option value="">All subjects</option>{subjects.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select></div>
          <div className="w-40"><Input label="Created from" type="date" value={u.get('from')} onChange={(e) => u.set({ from: e.target.value || undefined })} /></div>
          <div className="w-40"><Input label="Created to" type="date" value={u.get('to')} onChange={(e) => u.set({ to: e.target.value ? `${e.target.value}T23:59:59` : undefined })} /></div>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={u.get('retries') === 'only'} onChange={(e) => u.set({ retries: e.target.checked ? 'only' : undefined })} /> Only retried jobs</label>
        </>} columns={columns} />
    </section>
    {ops && <PurgeCard />}
  </AdminPage>;
}

export function JobInspectorPage() {
  const { id = '' } = useParams(); const qc = useQueryClient(); const nav = useNavigate();
  const q = useQuery({ queryKey: ['job', id], queryFn: () => api<any>(`/api/jobs/${id}`), refetchInterval: (x) => (['queued', 'running'].includes(x.state.data?.job?.queueStatus) ? 5000 : false) });
  const [msg, setMsg] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />; if (q.error) return <AdminPage title="Processing job"><ErrorBox error={q.error} /><Link to="/admin/processing" className="text-brand-700 underline">Back to the monitor</Link></AdminPage>;
  const { job, retryChain, storedOutput, documentReport, actions } = q.data;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['job'] }); qc.invalidateQueries({ queryKey: ['/api/jobs'] }); qc.invalidateQueries({ queryKey: ['jobs-health'] }); };
  const retry = () => post<any>(`/api/jobs/${id}/retry`, {}).then((r) => { refresh(); nav(`/admin/processing/${r.jobId}`); });
  const cancel = () => post<any>(`/api/jobs/${id}/cancel`, {}).then((r) => { refresh(); setMsg(`Cancelled. The manual's processing status is now “${String(r.documentStatus ?? 'unchanged').replace(/_/g, ' ')}”.`); });
  const rep = documentReport?.processingReport;
  return <AdminPage title={`Processing job ${shortId(job.id)}`} description={job.document ? `Manual: ${job.document.title}` : 'The manual for this job was deleted.'}
    actions={<div className="flex flex-wrap gap-2">
      <ConfirmButton label={<><RefreshCw className="h-4 w-4" aria-hidden />Retry</>} ariaLabel="Retry" tone="primary" variant="ghost" className="px-3 py-2 text-sm" disabled={!actions.retry.allowed} title="Retry this job?" confirmLabel="Queue retry"
        body={<p>A new run processes the stored file again from the start. It replaces this manual's pages, detected headings and passages (no duplicates are created). Verified and manually added headings are kept. Approval does not change.</p>} onConfirm={retry} />
      <ConfirmButton label="Cancel job" variant="danger" className="px-3 py-2 text-sm" disabled={!actions.cancel.allowed} title="Cancel this job?" confirmLabel="Cancel job" body={<p>The job will not run. The manual returns to the state of its stored output.</p>} onConfirm={cancel} />
    </div>}>
    {!actions.retry.allowed && ['failed', 'cancelled'].includes(job.status) && <Alert tone="info">Retry is not available: {actions.retry.reason}</Alert>}
    {!actions.cancel.allowed && job.queueStatus === 'running' && <Alert tone="info">{actions.cancel.reason}</Alert>}
    {msg && <Alert tone="success">{msg}</Alert>}
    <Section title="Summary"><div className="mb-3"><StatusCell r={job} /></div><Facts items={[
      ['Job id', <code key="i">{job.id}</code>], ['Manual', <ManualLink key="m" doc={job.document} />], ['Subject', job.document?.subject ?? '—'], ['Uploader', job.uploader ?? '—'],
      ['Queued', when(job.createdAt)], ['Started', when(job.startedAt)], ['Ended', when(job.finishedAt)],
      ['Attempts', `${job.attempts} of ${job.maxAttempts}${job.retries ? ` · retries: ${job.retries}` : ''}`],
      ['Pages processed', job.pagesProcessed == null ? '—' : String(job.pagesProcessed)],
      ['Extraction', stageText(job.stageStatus.extraction)], ['OCR', stageText(job.stageStatus.ocr, true)], ['Indexing', stageText(job.stageStatus.indexing)],
      ...(job.result ? [['Result', `${job.result.pages} ${job.result.pageUnit ?? 'page'}(s), ${job.result.chunks} passages, ${job.result.nodes ?? 0} detected headings, embeddings: ${job.result.embedding}${job.result.warnings ? `, ${job.result.warnings} warning(s)` : ''}`] as [string, string]] : []),
      ...(job.document ? [['Validation', `mapping ${job.document.mappingStatus}, approval ${String(job.document.approvalStatus).replace(/_/g, ' ')}`] as [string, string]] : []),
    ]} /></Section>
    {job.error && <Section title="Error"><Alert><strong>{job.error.stage ? `Failed while ${job.error.stage}: ` : ''}</strong>{job.error.message}</Alert></Section>}
    <Section title="Stage timeline"><ol className="space-y-1 text-sm">{job.stages.map((s: any, i: number) => <li key={i} className="flex gap-3"><span className="w-44 shrink-0 text-slate-600">{when(s.at)}</span><span>{s.label === s.stage ? s.stage.replace(/_/g, ' ') : s.label}{s.attempt ? ` (attempt ${s.attempt})` : ''}</span></li>)}</ol></Section>
    <Section title="Error log">{job.errorLog.length ? <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="w-full text-left text-sm"><caption className="sr-only">Errors by attempt</caption><thead><tr className="border-b"><th scope="col" className="py-1">When</th><th scope="col">Attempt</th><th scope="col">Stage</th><th scope="col">Message</th></tr></thead>
      <tbody>{job.errorLog.map((e: any, i: number) => <tr key={i} className="border-b align-top last:border-0"><td className="py-1 pr-2">{when(e.at)}</td><td>{e.attempt}</td><td>{e.stage ?? '—'}</td><td className="whitespace-pre-wrap break-words">{e.message}</td></tr>)}</tbody></table></div> : <p className="text-sm text-slate-600">No errors recorded.</p>}</Section>
    {storedOutput && <Section title="Stored output for this manual"><Facts items={[['Pages', String(storedOutput.pages)], ['Passages', String(storedOutput.passages)],
      ['Embeddings', Object.entries(storedOutput.embeddings).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', ') || 'none']]} />
      {job.status === 'failed' && <p className="mt-2 text-sm text-slate-600">After a failure this can be partial output from the failed attempt. A retry replaces it completely.</p>}</Section>}
    {rep && (rep.error || rep.warnings?.length > 0) && <Section title="Manual's processing report">{rep.error && <Alert>{rep.error}</Alert>}{rep.warnings?.length > 0 && <ul className="list-disc pl-5 text-sm">{rep.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul>}</Section>}
    {(retryChain.previous.length > 0 || retryChain.next.length > 0) && <Section title="Retry history"><ul className="space-y-1 text-sm">
      {retryChain.previous.map((j: any) => <li key={j.id}>Retry of <Link className="font-mono text-brand-700 underline" to={`/admin/processing/${j.id}`}>{shortId(j.id)}</Link> ({j.status}{j.error ? `: ${j.error}` : ''})</li>)}
      {retryChain.next.map((j: any) => <li key={j.id}>Retried as <Link className="font-mono text-brand-700 underline" to={`/admin/processing/${j.id}`}>{shortId(j.id)}</Link> ({j.status})</li>)}</ul></Section>}
    <p><Link to="/admin/processing" className="text-brand-700 underline">Back to the monitor</Link></p>
  </AdminPage>;
}
