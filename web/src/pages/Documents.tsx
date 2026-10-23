/** §9 Learner Manuals library: upload (PDF/DOCX/TXT/CSV), metadata, preview/download, processing, extraction, versions, archive. */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as S from '@ghlearn/shared';
import { Archive, Download, Eye, RefreshCw, RotateCcw, Upload, AlertTriangle } from 'lucide-react';
import { api, patch, post, del, download, fetchBlob } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Card, Input, Select, Spinner, SampleBadge } from '../components/ui';
import { ConfirmButton } from '../components/ConfirmDialog';
import { AdminPage } from '../admin/pages';
import { JobProgress } from '../admin/jobs';
import { MONITOR_PERMS } from '../admin/nav';
import { DataTable, useUrlState, type Column } from '../admin/DataTable';
import { Badge, ErrorBox, Facts, Section, day, when } from '../admin/common';
import { ApprovalBadge, DropZone, LicBadge, MetaFields, OcrBadge, ProcBadge, Progress, RUNNING, UploadError, emptyMeta, fmtBytes, metaFromDoc, metaToFields, metaToJson, metaValid, useManualUpload, useSubjects, useUploadLimits, useVersions, type MetaForm } from '../manuals/shared';

function UploadPanel() {
  const qc = useQueryClient(); const nav = useNavigate();
  const limits = useUploadLimits(true); const maxMB = limits.data?.maxMB ?? 60;
  const up = useManualUpload(maxMB); const [m, setM] = useState<MetaForm>(emptyMeta()); const [allowDup, setAllowDup] = useState(false); const [done, setDone] = useState<{ id: string; title: string; dup: boolean } | null>(null);
  const busy = !!up.progress;
  const submit = async () => {
    setDone(null);
    const r = await up.send<{ document: any; jobId: string | null }>('/api/documents/upload', { ...metaToFields(m), allowDuplicate: allowDup && up.dup ? 'true' : undefined });
    if (r) { setDone({ id: r.document._id, title: r.document.title, dup: !!r.document.duplicateOf }); setM(emptyMeta()); setAllowDup(false); qc.invalidateQueries({ queryKey: ['/api/documents'] }); qc.invalidateQueries({ queryKey: ['documents'] }); limits.refetch(); }
  };
  const blocked = !up.file || !!up.problem || up.hashing || busy || !metaValid(m, false) || (!!up.dup && !allowDup) || (limits.data ? limits.data.leftMB <= 0 && !up.dup : false);
  return <Section title="Upload a learner manual" id="upload">
    <form noValidate className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!blocked) submit(); }}>
      <DropZone id="up-file" label={`File (PDF, DOCX, TXT or CSV, max ${maxMB} MB)`} file={up.file} onFile={up.setFile} disabled={busy} />
      {limits.data && <p className="text-xs text-slate-600">Storage left for uploads: {limits.data.leftMB} MB of {limits.data.quotaMB} MB (files are kept in the database's file store, which has a fixed free-tier size).</p>}
      {up.problem && <Alert>{up.problem}</Alert>}
      {up.hashing && <p role="status" className="text-sm text-slate-600">Checking for an identical file…</p>}
      {up.dup && <Alert tone="info">An identical file is already in the library{up.dup.title ? <> as <strong>{up.dup.title}</strong></> : ''}. <Link className="underline" to={`/admin/documents/${up.dup.id}`}>Open the existing document</Link>.
        <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} />Add it anyway as a separate record (it shares the stored file and is not processed again)</label></Alert>}
      <details open className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Details (§9 metadata, editable later)</summary><div className="mt-3"><MetaFields m={m} set={setM} disabled={busy} compact /></div></details>
      {up.progress && <Progress sent={up.progress.sent} total={up.progress.total} label={up.progress.sent >= up.progress.total ? 'Uploaded, checking the file…' : `Uploading ${up.file?.name}`} />}
      <UploadError e={up.error} />
      {done && <Alert tone="success">{done.dup ? 'Added as a duplicate record.' : 'Uploaded. Processing has been queued; approval stays "unverified" until a reviewer checks it.'} <Link className="underline" to={`/admin/documents/${done.id}`}>Open {done.title}</Link></Alert>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={blocked} loading={busy}><Upload className="h-4 w-4" aria-hidden />Upload & process</Button>
        {busy && <Button type="button" variant="ghost" onClick={up.cancel}>Cancel upload</Button>}
        {done && <Button type="button" variant="ghost" onClick={() => nav(`/admin/documents/${done.id}`)}>Go to document</Button>}</div>
    </form></Section>;
}

const F = ({ k, label, children, u }: { k: string; label: string; children: React.ReactNode; u: ReturnType<typeof useUrlState> }) =>
  <div className="text-sm"><label htmlFor={`f-${k}`} className="mb-1 block font-medium text-slate-700">{label}</label><select id={`f-${k}`} className="rounded-lg border border-slate-300 bg-white px-2 py-2" value={u.get(k)} onChange={(e) => u.set({ [k]: e.target.value || undefined })}>{children}</select></div>;

export function DocumentsPage() {
  const { user } = useAuth(); const u = useUrlState(); const subjects = useSubjects(); const versions = useVersions();
  const stats = useQuery({ queryKey: ['documents', 'stats'], queryFn: () => api<any>('/api/documents/stats'), refetchInterval: 15_000 });
  const cols: Column<any>[] = [
    { key: 'title', header: 'Title', sortable: true, render: (d) => <div className="space-y-1"><Link className="font-medium text-brand-700 underline" to={`/admin/documents/${d._id}`}>{d.title}</Link>
      <div className="flex flex-wrap gap-1">{d.isSample && <SampleBadge />}{d.duplicateOf && <Badge v="suspended" label="duplicate" />}{d.archivedAt && <Badge v="archived" />}{d.supersededBy && <Badge v="archived" label="superseded" />}{(d.versionNumber ?? 1) > 1 && <Badge v="x" label={`version ${d.versionNumber}`} />}<OcrBadge v={d.ocrStatus} /></div></div> },
    { key: 'subject', header: 'Subject', render: (d) => d.subjectId?.name ?? <span className="text-slate-500">not mapped</span> },
    { key: 'version', header: 'Curriculum version', render: (d) => d.curriculumVersionId?.code ?? d.curriculumVersion ?? '—' },
    { key: 'fileKind', header: 'Format', render: (d) => (d.fileKind ?? 'pdf').toUpperCase() },
    { key: 'processingStatus', header: 'Processing', render: (d) => <ProcBadge v={d.processingStatus} /> },
    { key: 'approvalStatus', header: 'Approval', render: (d) => <ApprovalBadge v={d.approvalStatus} /> },
    { key: 'licensingStatus', header: 'Licensing', render: (d) => (S.LICENSING_LABELS as any)[d.licensingStatus ?? 'unknown'] },
    { key: 'sizeBytes', header: 'Size', sortable: true, render: (d) => fmtBytes(d.sizeBytes) },
    { key: 'updatedAt', header: 'Updated', sortable: true, render: (d) => day(d.updatedAt) },
  ];
  const filters = ['processingStatus', 'approvalStatus', 'mappingStatus', 'ocrStatus', 'fileKind', 'licensingStatus', 'docType', 'subjectId', 'curriculumVersionId', 'archived', 'versions', 'duplicates', 'tag', 'levelId'];
  const monitor = MONITOR_PERMS.some((p) => S.hasPermission(user!.roles, p));
  return <AdminPage title="Learner Manuals" description="Learner manuals, teacher guides and curriculum documents. Uploads are processed into pages, structure and searchable passages; nothing is published automatically and approval is separate from processing."
    actions={monitor ? <Link to="/admin/processing" className="text-sm text-brand-700 underline">Document processing monitor</Link> : undefined}>
    {stats.data && <div className="grid gap-3 sm:grid-cols-4">{[['Documents', stats.data.total], ['Indexed', stats.data.processing.indexed ?? 0], ['Failed', stats.data.processing.failed ?? 0], ['Identical duplicates', stats.data.duplicates]].map(([l, v]) =>
      <Card key={l as string}><div className="text-sm text-slate-600">{l}</div><div className="text-2xl font-bold">{v as number}</div></Card>)}</div>}
    {S.hasPermission(user!.roles, 'documents:upload') && <UploadPanel />}
    <Section title="Library">
      <DataTable path="/api/documents" caption="Learner manuals" searchLabel="Search title, file name or tag" defaultSort="-updatedAt" filterKeys={filters} columns={cols} refetchInterval={15_000}
        toolbar={<>
          <F u={u} k="processingStatus" label="Processing"><option value="">Any</option>{['not_processed', 'queued', 'extracting', 'ocr', 'structuring', 'chunking', 'embedding', 'indexed', 'failed'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}{u.get('processingStatus').includes(',') && <option value={u.get('processingStatus')}>{u.get('processingStatus').replace(/,/g, ' or ')}</option>}</F>
          <F u={u} k="approvalStatus" label="Approval"><option value="">Any</option>{S.APPROVAL_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</F>
          <F u={u} k="mappingStatus" label="Mapping"><option value="">Any</option>{['unmapped', 'suggested', 'confirmed', 'unconfirmed'].map((s) => <option key={s} value={s}>{s === 'unconfirmed' ? 'not confirmed' : s}</option>)}</F>
          <F u={u} k="ocrStatus" label="OCR"><option value="">Any</option>{S.OCR_STATUSES.map((s) => <option key={s} value={s}>{S.OCR_STATUS_LABELS[s]}</option>)}</F>
          <F u={u} k="fileKind" label="Format"><option value="">Any</option>{S.MANUAL_KINDS.map((k) => <option key={k} value={k}>{S.MANUAL_FORMATS[k].label}</option>)}</F>
          <F u={u} k="licensingStatus" label="Licensing"><option value="">Any</option>{S.LICENSING_STATUSES.map((s) => <option key={s} value={s}>{S.LICENSING_LABELS[s]}</option>)}</F>
          <F u={u} k="docType" label="Type"><option value="">Any</option>{S.DOC_TYPES.map((s) => <option key={s} value={s}>{S.DOC_TYPE_LABELS[s]}</option>)}</F>
          <F u={u} k="subjectId" label="Subject"><option value="">Any</option>{subjects.data?.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</F>
          <F u={u} k="curriculumVersionId" label="Curriculum version"><option value="">Any</option>{versions.data?.map((x) => <option key={x._id} value={x._id}>{x.code}</option>)}</F>
          <F u={u} k="archived" label="Archived"><option value="">Hide archived</option><option value="true">Archived only</option><option value="all">Include archived</option></F>
          <F u={u} k="versions" label="Versions"><option value="">Current only</option><option value="all">Include earlier versions</option></F>
          <F u={u} k="duplicates" label="Duplicates"><option value="">Hide</option><option value="include">Include</option><option value="only">Only duplicates</option></F>
        </>} />
    </Section>
  </AdminPage>;
}

/** Original file preview: PDFs in a frame (fetched with the session into a blob URL), text formats as text. */
function Preview({ d }: { d: any }) {
  const kind = d.fileKind ?? 'pdf';
  const q = useQuery({ queryKey: ['preview', d._id], enabled: kind !== 'docx', staleTime: 300_000, queryFn: async () => { const b = await fetchBlob(`/api/documents/${d._id}/file`); return kind === 'pdf' ? { url: URL.createObjectURL(new Blob([b], { type: 'application/pdf' })) } : { text: (await b.text()).slice(0, 200_000) }; } });
  useEffect(() => () => { if (q.data?.url) URL.revokeObjectURL(q.data.url); }, [q.data?.url]);
  if (kind === 'docx') return <Alert tone="info">Word files cannot be shown in the browser. Inspect the extracted text below{d.__canDownload ? ' or download the original' : ''}.</Alert>;
  if (q.isLoading) return <Spinner label="Loading the original" />; if (q.error) return <ErrorBox error={q.error} />;
  return q.data?.url ? <iframe title={`Original file: ${d.title}`} src={q.data.url} className="h-[70vh] w-full rounded border" />
    : <pre tabIndex={0} aria-label="Original file text" className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs">{q.data?.text}</pre>;
}

function MetadataCard({ d, canEdit }: { d: any; canEdit: boolean }) {
  const qc = useQueryClient(); const [m, setM] = useState<MetaForm>(metaFromDoc(d)); const [saved, setSaved] = useState(false);
  const save = useMutation({ mutationFn: (extra: Record<string, unknown>) => patch(`/api/documents/${d._id}`, { ...metaToJson(m), ...extra }), onSuccess: () => { setSaved(true); qc.invalidateQueries({ queryKey: ['document', d._id] }); qc.invalidateQueries({ queryKey: ['/api/documents'] }); } });
  const dirty = JSON.stringify(metaToJson(m)) !== JSON.stringify(metaToJson(metaFromDoc(d)));
  return <Section title="Details and curriculum mapping">
    {!canEdit && <p className="text-sm text-slate-600">{d.archivedAt ? 'Restore this document to edit it.' : 'Read-only: editing needs the Curriculum Editor or Curriculum Admin role.'}</p>}
    <form noValidate onSubmit={(e) => { e.preventDefault(); setSaved(false); save.mutate({}); }} className="space-y-3">
      <MetaFields m={m} set={(x) => { setM(x); setSaved(false); }} disabled={!canEdit} keepVersionId={d.curriculumVersionId?._id} />
      {canEdit && <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!dirty || !metaValid(m, true)} loading={save.isPending && !save.variables?.mappingStatus}>Save details</Button>
        <Button type="button" variant="ghost" disabled={!m.subjectId || !metaValid(m, true) || (d.mappingStatus === 'confirmed' && !dirty)} onClick={() => { setSaved(false); save.mutate({ mappingStatus: 'confirmed' }); }}>Save & confirm mapping</Button></div>}
      <ErrorBox error={save.error} />{saved && <Alert tone="success">Saved.</Alert>}
    </form>
    <Facts items={[['Mapping', <Badge key="m" v={d.mappingStatus === 'confirmed' ? 'active' : 'pending'} label={d.mappingStatus} />], ['Uploaded by', d.uploadedBy?.fullName ?? (d.provenance?.uploadedVia === 'import' ? 'Index import' : '—')], ['Upload date', when(d.createdAt)],
      ['Original file', `${d.originalFilename ?? '—'} · ${(d.fileKind ?? 'pdf').toUpperCase()} · ${fmtBytes(d.sizeBytes)}`], ['SHA-256', <code key="s" className="break-all text-xs">{d.provenance?.checksum ?? '—'}</code>], ['Stored in', d.storage?.provider ?? '—']]} />
    {d.sourceMeta && <details className="text-sm"><summary className="cursor-pointer">Original source metadata</summary><pre tabIndex={0} className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(d.sourceMeta, null, 2)}</pre></details>}
  </Section>;
}

function ApprovalCard({ d, canReview }: { d: any; canReview: boolean }) {
  const qc = useQueryClient();
  const set = (approvalStatus: string) => patch(`/api/documents/${d._id}`, { approvalStatus }).then(() => qc.invalidateQueries({ queryKey: ['document', d._id] }));
  return <Section title="Approval">
    <p className="text-sm text-slate-600">Approval is a reviewer's decision about provenance and is separate from processing. Approving does not publish anything; lessons and resources go through Content Review.</p>
    <div className="flex flex-wrap items-center gap-2"><ApprovalBadge v={d.approvalStatus} />{d.approvedBy && <span className="text-sm text-slate-600">by {d.approvedBy.fullName}</span>}</div>
    {d.approvalNote && <p className="text-sm text-slate-700" data-testid="approval-note"><span className="font-medium">Note:</span> {d.approvalNote}</p>}
    {d.reviewFlags?.length > 0 && <div className="flex flex-wrap gap-1" aria-label="Review flags">{d.reviewFlags.map((f: string) => <span key={f} className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{f.replace(/_/g, ' ')}</span>)}</div>}
    {canReview ? <div className="flex flex-wrap gap-2">
      {d.approvalStatus !== 'verified_official' && <ConfirmButton label="Mark verified official" tone="primary" variant="primary" className="px-3 py-2 text-sm" title="Mark this document as verified official?" body={<p>Confirm you have checked that it is an authentic official document. Content generated from it can then be cited as official.</p>} onConfirm={() => set('verified_official')} />}
      {d.approvalStatus !== 'rejected' && <ConfirmButton label="Reject" variant="danger" className="px-3 py-2 text-sm" title="Reject this document?" body={<p>Rejected documents are excluded from search and the tutor. Processing results are kept.</p>} onConfirm={() => set('rejected')} />}
      {d.approvalStatus !== 'unverified' && <ConfirmButton label="Reset to unverified" tone="primary" variant="ghost" className="px-3 py-2 text-sm" title="Reset approval to unverified?" body={<p>It stays searchable for staff, flagged as unverified.</p>} onConfirm={() => set('unverified')} />}
    </div> : <p className="text-sm text-slate-600">Only Content Reviewers can change approval.</p>}
  </Section>;
}

function ProcessingCard({ d, jobs, chunkStats, perms }: { d: any; jobs: any[]; chunkStats: any; perms: any }) {
  const qc = useQueryClient(); const r = d.processingReport ?? {}; const job = jobs[0];
  const { user } = useAuth(); const monitor = MONITOR_PERMS.some((p) => S.hasPermission(user!.roles, p));
  return <Section title="Processing" actions={perms.reprocess && <ConfirmButton label={<><RefreshCw className="h-4 w-4" aria-hidden />{d.processingStatus === 'not_processed' ? 'Process' : 'Reprocess'}</>} ariaLabel={d.processingStatus === 'not_processed' ? 'Process' : 'Reprocess'} tone="primary" variant="ghost" className="px-3 py-1 text-sm"
    title={d.processingStatus === 'not_processed' ? 'Process this document?' : 'Reprocess this document?'} confirmLabel="Queue processing" disabled={RUNNING.includes(d.processingStatus)}
    body={<p>Pages, detected structure and passages are rebuilt from the stored file. Verified and manually added elements are kept. Approval does not change.</p>}
    onConfirm={() => post(`/api/documents/${d._id}/process`, {}).then(() => qc.invalidateQueries({ queryKey: ['document', d._id] }))} />}>
    {job && ['queued', 'running'].includes(job.status) && <div role="status" className="space-y-1">{job.status === 'queued' ? <p className="text-sm">Queued{job.attempts ? ` (waiting to retry after attempt ${job.attempts})` : ''}.</p>
      : <JobProgress id="doc-job-progress" label={`Processing: ${String(job.progress?.step ?? 'starting').replace(/_/g, ' ')}`} progress={typeof job.progress?.current === 'number' && job.progress?.total ? { current: job.progress.current, total: job.progress.total, unit: job.progress.unit ?? '' } : null} />}</div>}
    {job && monitor && <p className="text-sm"><Link to={`/admin/processing/${job._id}`} className="text-brand-700 underline">Inspect the latest processing job</Link></p>}
    {r.error && <Alert><AlertTriangle className="inline h-4 w-4" aria-hidden /> {r.error}</Alert>}
    {d.ocrStatus === 'needed_not_configured' && <Alert tone="info"><strong>OCR needed / not configured.</strong> {r.pagesWithoutTextLayer ?? r.pages?.ocrUnavailable ?? 'Some'} page(s) are scanned images without a text layer. OCR is not configured on this server, so their text is missing; nothing was guessed.</Alert>}
    {r.pageCount != null && <Facts items={[
      [d.pageUnit === 'segment' ? 'Segments' : 'Pages', `${r.pageCount}${r.pages ? ` (text ${r.pages.text}, OCR ${r.pages.ocr}, empty ${r.pages.empty}, OCR unavailable ${r.pages.ocrUnavailable})` : ''}`],
      ['Format', `${(r.fileKind ?? d.fileKind ?? 'pdf').toUpperCase()}${d.pageUnit === 'segment' ? ' · no page numbers, split into segments' : ''}`],
      ['OCR', (S.OCR_STATUS_LABELS as any)[d.ocrStatus ?? ''] ?? '—'],
      ...(r.scanned != null ? [['Scanned', r.scanned ? 'Yes (most pages have no text layer)' : 'No'] as [string, string]] : []),
      ...(r.csvRows != null ? [['CSV rows', String(r.csvRows)] as [string, string]] : []),
      ['Figures / images', String(r.figures ?? 0)],
      ...(r.ocrMeanConfidence != null ? [['OCR mean confidence', `${r.ocrMeanConfidence}%`] as [string, string]] : []),
      ...(r.lowTextPages?.length ? [['Pages needing attention', r.lowTextPages.join(', ')] as [string, string]] : []),
      ['Structure found', Object.entries(r.structure ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'],
      ['Passages', `${r.chunks ?? 0} (${r.totalChars?.toLocaleString() ?? 0} characters)`],
      ['Embeddings', `${r.embedding?.status ?? '—'}${r.embedding?.model ? ` · ${r.embedding.model}` : ''}${chunkStats && Object.keys(chunkStats).length ? ` (${Object.entries(chunkStats).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`],
      ['Finished', `${when(r.finishedAt)} · ${Math.round((r.durationMs ?? 0) / 1000)} s`]]} />}
    {!!r.warnings?.length && <div><h3 className="text-sm font-medium">Warnings</h3><ul className="list-disc pl-5 text-sm text-amber-900">{r.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul></div>}
    {jobs.some((j) => j.errorLog?.length) && <div><h3 className="text-sm font-medium">Errors</h3><ul className="list-disc pl-5 text-sm text-red-800">{jobs.flatMap((j) => (j.errorLog ?? []).map((e: any, i: number) => <li key={j._id + i}>{when(e.at ?? j.updatedAt)} · attempt {e.attempt}: {e.message}</li>))}</ul></div>}
  </Section>;
}

function ExtractionCard({ d }: { d: any }) {
  const x = useQuery({ queryKey: ['extraction', d._id, d.processingStatus], enabled: (d.pageCount ?? 0) > 0, queryFn: () => api<any>(`/api/documents/${d._id}/extraction`) });
  const [sel, setSel] = useState(1); const [from, setFrom] = useState(0); const per = 40;
  const page = useQuery({ queryKey: ['page', d._id, sel, d.processingStatus], enabled: (d.pageCount ?? 0) > 0, queryFn: () => api<{ items: any[] }>(`/api/documents/${d._id}/pages?from=${sel}&to=${sel}`).then((r) => r.items[0]) });
  if (!d.pageCount) return <Section title="Extraction"><p className="text-sm text-slate-600">{RUNNING.includes(d.processingStatus) ? 'Extraction is running…' : 'Nothing has been extracted yet.'}</p></Section>;
  const unit = x.data?.unit === 'segment' ? 'Segment' : 'Page'; const rows = x.data?.pages ?? [];
  return <Section title="Extraction inspector">
    <p className="text-sm text-slate-600">Text taken from each {unit.toLowerCase()} of the original, with the method used. Choose a {unit.toLowerCase()} to read its text.</p>
    {x.isLoading ? <Spinner /> : <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div><div className="relative max-h-[28rem] overflow-auto rounded border"><table className="w-full text-left text-sm"><caption className="sr-only">{unit}s</caption>
        <thead className="sticky top-0 bg-slate-50"><tr><th scope="col" className="px-2 py-1">{unit}</th><th scope="col" className="px-2 py-1">Method</th><th scope="col" className="px-2 py-1">Characters</th><th scope="col" className="px-2 py-1">Figures</th></tr></thead>
        <tbody>{rows.slice(from, from + per).map((p: any) => <tr key={p.page} className={`border-t ${p.page === sel ? 'bg-brand-50' : ''}`}>
          <td className="px-2 py-1"><button type="button" className="text-brand-700 underline" aria-pressed={p.page === sel} aria-label={`Show ${unit.toLowerCase()} ${p.page}`} onClick={() => setSel(p.page)}>{p.page}</button></td>
          <td className="px-2 py-1">{p.method === 'ocr_unavailable' ? <Badge v="suspended" label="no text layer" /> : p.method}{p.ocrConfidence != null ? ` · ${Math.round(p.ocrConfidence)}%` : ''}</td><td className="px-2 py-1">{p.charCount}</td><td className="px-2 py-1">{p.figures ?? 0}</td></tr>)}</tbody></table></div>
        {rows.length > per && <div className="mt-2 flex items-center gap-2 text-sm"><Button variant="ghost" className="px-2 py-1" disabled={from === 0} onClick={() => setFrom(Math.max(0, from - per))}>Previous</Button><span>{from + 1}–{Math.min(from + per, rows.length)} of {rows.length}</span><Button variant="ghost" className="px-2 py-1" disabled={from + per >= rows.length} onClick={() => setFrom(from + per)}>Next</Button></div>}</div>
      <div><div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="font-medium">{unit} {sel}</h3>{page.data && <span className="text-xs text-slate-600">{page.data.method} · {page.data.charCount} characters · {page.data.figures ?? 0} figure(s)</span>}</div>
        {page.isLoading ? <Spinner /> : <pre tabIndex={0} aria-label={`${unit} ${sel} text`} className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs">{page.data?.text || (page.data?.method === 'ocr_unavailable' ? '(No text layer. OCR is not configured, so no text was extracted.)' : '(no text)')}</pre>}</div>
    </div>}
  </Section>;
}

function StructureCard({ d, nodes, canMap }: { d: any; nodes: any[]; canMap: boolean }) {
  const qc = useQueryClient(); const inv = () => qc.invalidateQueries({ queryKey: ['document', d._id] });
  const node = useMutation({ mutationFn: ({ nid, b }: { nid: string; b: any }) => (b === null ? del(`/api/documents/${d._id}/nodes/${nid}`) : patch(`/api/documents/${d._id}/nodes/${nid}`, b)), onSuccess: inv });
  const addNode = useMutation({ mutationFn: (b: any) => post(`/api/documents/${d._id}/nodes`, b), onSuccess: inv });
  const [nn, setNn] = useState({ type: 'strand', title: '', page: '' }); const [edit, setEdit] = useState<{ id: string; title: string } | null>(null);
  return <Section title="Detected structure"><p className="text-sm text-slate-600">Detected automatically and <strong>unverified</strong> until a person confirms each item.</p>
    <ErrorBox error={node.error ?? addNode.error} />
    <ul className="divide-y text-sm">{nodes.map((n) => <li key={n._id} className="flex flex-wrap items-center gap-2 py-1.5">
      <span className="w-32 text-xs uppercase text-slate-600">{n.type}{n.code ? ` ${n.code}` : ''}</span>
      {edit?.id === n._id ? <form className="flex flex-1 flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); node.mutate({ nid: n._id, b: { title: edit!.title } }); setEdit(null); }}><div className="min-w-[14rem] flex-1"><Input label="Title" value={edit!.title} onChange={(e) => setEdit({ id: edit!.id, title: e.target.value })} /></div><Button type="submit" className="px-3 py-1 text-sm">Save</Button><Button type="button" variant="ghost" className="px-3 py-1 text-sm" onClick={() => setEdit(null)}>Cancel</Button></form>
        : <span className="flex-1">{n.title} <span className="text-xs text-slate-600">{n.page ? `p.${n.page} · ` : ''}{n.detection?.confidence}</span></span>}
      {n.verified ? <Badge v="active" label="verified" /> : <Badge v="pending" label="unverified" />}
      {canMap && edit?.id !== n._id && <><Button variant="ghost" className="px-2 py-0.5 text-xs" aria-label={`${n.verified ? 'Unverify' : 'Verify'} ${n.title}`} onClick={() => node.mutate({ nid: n._id, b: { verified: !n.verified } })}>{n.verified ? 'Unverify' : 'Verify'}</Button>
        <Button variant="ghost" className="px-2 py-0.5 text-xs" aria-label={`Edit ${n.title}`} onClick={() => setEdit({ id: n._id, title: n.title })}>Edit</Button>
        <ConfirmButton label="Remove" ariaLabel={`Remove ${n.title}`} className="px-2 py-0.5 text-xs" title={`Remove ${n.title}?`} body={<p>The element is deleted from this document. Removal is refused while lessons use it.</p>} onConfirm={() => node.mutateAsync({ nid: n._id, b: null })} /></>}</li>)}
      {!nodes.length && <li className="py-2 text-slate-600">No labelled strands or sections found.</li>}</ul>
    {canMap && <form className="grid gap-2 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); addNode.mutate({ type: nn.type, title: nn.title, ...(nn.page ? { page: Number(nn.page) } : {}) }); setNn({ ...nn, title: '' }); }}>
      <Select label="Type" value={nn.type} onChange={(e) => setNn({ ...nn, type: e.target.value })}>{['section', 'strand', 'subStrand', 'contentStandard', 'learningOutcome', 'indicator', 'topic'].map((t) => <option key={t}>{t}</option>)}</Select>
      <Input label="Title" value={nn.title} onChange={(e) => setNn({ ...nn, title: e.target.value })} /><Input label="Page" type="number" min={1} value={nn.page} onChange={(e) => setNn({ ...nn, page: e.target.value })} />
      <div className="flex items-end"><Button type="submit" disabled={nn.title.trim().length < 2}>Add item</Button></div></form>}
  </Section>;
}

function VersionsCard({ d, versions, canReplace, maxMB }: { d: any; versions: any[]; canReplace: boolean; maxMB: number }) {
  const nav = useNavigate(); const qc = useQueryClient(); const up = useManualUpload(maxMB); const [ver, setVer] = useState(''); const [open, setOpen] = useState(false);
  const busy = !!up.progress;
  const submit = async () => { const r = await up.send<{ document: any }>(`/api/documents/${d._id}/replace`, { documentVersion: ver || undefined }); if (r) { qc.invalidateQueries({ queryKey: ['/api/documents'] }); qc.invalidateQueries({ queryKey: ['document'] }); nav(`/admin/documents/${r.document._id}`); } };
  const g = (x: any) => [x.generated.lessons && `${x.generated.lessons} lesson(s)`, x.generated.resources && `${x.generated.resources} resource(s)`, x.generated.questions && `${x.generated.questions} question(s)`].filter(Boolean).join(', ') || 'none';
  return <Section title="Versions" actions={canReplace && !open && <Button variant="ghost" className="px-3 py-1 text-sm" onClick={() => setOpen(true)}><Upload className="h-4 w-4" aria-hidden />Upload replacement version</Button>}>
    <p className="text-sm text-slate-600">A replacement becomes the current version and is processed again. Earlier versions are kept with their pages and passages, so lessons, resources and questions generated from them keep their sources.</p>
    <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="w-full text-left text-sm"><caption className="sr-only">Document versions</caption>
      <thead><tr className="border-b"><th scope="col" className="py-1">Version</th><th scope="col">Uploaded</th><th scope="col">Processing</th><th scope="col">Approval</th><th scope="col">Generated from it</th><th scope="col">Status</th></tr></thead>
      <tbody>{versions.map((v) => <tr key={v._id} className={`border-b last:border-0 ${v._id === d._id ? 'bg-brand-50' : ''}`}>
        <td className="py-1">{v._id === d._id ? <strong>v{v.versionNumber ?? 1}{v.documentVersion ? ` (${v.documentVersion})` : ''} · this page</strong> : <Link className="text-brand-700 underline" to={`/admin/documents/${v._id}`}>v{v.versionNumber ?? 1}{v.documentVersion ? ` (${v.documentVersion})` : ''}</Link>}</td>
        <td>{day(v.createdAt)}{v.uploadedBy?.fullName ? ` · ${v.uploadedBy.fullName}` : ''}</td><td><ProcBadge v={v.processingStatus} /></td><td><ApprovalBadge v={v.approvalStatus} /></td><td>{g(v)}</td>
        <td>{v.archivedAt ? <Badge v="archived" /> : v.current ? <Badge v="active" label="current" /> : <Badge v="archived" label={`superseded ${day(v.supersededAt)}`} />}</td></tr>)}</tbody></table></div>
    {open && <form noValidate className="space-y-3 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); if (up.file && !up.problem && !up.dup) submit(); }}>
      <h3 className="font-medium">Upload a replacement for v{d.versionNumber ?? 1}</h3>
      <DropZone id="replace-file" label={`Replacement file (PDF, DOCX, TXT or CSV, max ${maxMB} MB)`} file={up.file} onFile={up.setFile} disabled={busy} />
      <div className="max-w-xs"><Input label="Document version (optional)" value={ver} onChange={(e) => setVer(e.target.value)} hint="e.g. 2.0" /></div>
      {up.problem && <Alert>{up.problem}</Alert>}{up.hashing && <p role="status" className="text-sm">Checking for an identical file…</p>}
      {up.dup && <Alert>{up.dup.id === d._id ? 'This is the same file as the current version.' : <>This file is already in the library. <Link className="underline" to={`/admin/documents/${up.dup.id}`}>Open it</Link>.</>}</Alert>}
      {up.progress && <Progress sent={up.progress.sent} total={up.progress.total} label="Uploading replacement" />}
      <UploadError e={up.error} />
      <div className="flex gap-2"><Button type="submit" disabled={!up.file || !!up.problem || !!up.dup || up.hashing || busy} loading={busy}>Upload replacement</Button>
        <Button type="button" variant="ghost" onClick={() => { if (busy) up.cancel(); up.reset(); setOpen(false); }}>{busy ? 'Cancel upload' : 'Cancel'}</Button></div>
    </form>}
  </Section>;
}

export function DocumentDetailPage() {
  const { id } = useParams(); const { user } = useAuth(); const qc = useQueryClient(); const nav = useNavigate(); const [preview, setPreview] = useState(false);
  const canUpload = S.hasPermission(user!.roles, 'documents:upload'); const limits = useUploadLimits(canUpload);
  const q = useQuery({ queryKey: ['document', id], queryFn: () => api<any>(`/api/documents/${id}`), refetchInterval: (qq) => (RUNNING.includes(qq.state.data?.document?.processingStatus) ? 3000 : false) });
  if (q.isLoading) return <Spinner />; if (q.error) return <Alert>{q.error.message}</Alert>;
  const { document: d, nodes, jobs, chunkStats, versions, generated, permissions: p, duplicates } = q.data;
  const current = versions.find((v: any) => v.current);
  const inv = () => { qc.invalidateQueries({ queryKey: ['document'] }); qc.invalidateQueries({ queryKey: ['/api/documents'] }); };
  return <AdminPage title={d.title} actions={<Link to="/admin/documents" className="text-sm text-brand-700 underline">← All learner manuals</Link>}>
    <div className="flex flex-wrap items-center gap-2">{d.isSample && <SampleBadge />}<ProcBadge v={d.processingStatus} /><ApprovalBadge v={d.approvalStatus} /><OcrBadge v={d.ocrStatus} /><LicBadge v={d.licensingStatus} />
      <Badge v="x" label={`${(d.fileKind ?? 'pdf').toUpperCase()} · v${d.versionNumber ?? 1}`} />{d.curriculumVersionId && <Badge v="x" label={`curriculum ${d.curriculumVersionId.code}`} />}{d.archivedAt && <Badge v="archived" />}{d.supersededBy && <Badge v="archived" label="superseded" />}</div>
    {d.supersededBy && <Alert tone="info">This is an earlier version, kept for the content generated from it. {current && <Link className="underline" to={`/admin/documents/${current._id}`}>Open the current version (v{current.versionNumber})</Link>}</Alert>}
    {d.archivedAt && <Alert tone="info">Archived {when(d.archivedAt)}{d.archivedBy?.fullName ? ` by ${d.archivedBy.fullName}` : ''}. It is hidden from the library, search and the tutor.</Alert>}
    {d.duplicateOf && <Alert tone="info">Identical file to <Link className="underline" to={`/admin/documents/${d.duplicateOf._id}`}>{d.duplicateOf.title}</Link>; it shares that stored file and is not processed separately.</Alert>}
    {d.approvalStatus === 'unverified' && <Alert tone="info">Provenance not verified. Content from this document must not be treated as official until a reviewer verifies it.</Alert>}
    <div className="flex flex-wrap gap-2" role="group" aria-label="Document actions">
      <Button variant="ghost" aria-expanded={preview} onClick={() => setPreview(!preview)}><Eye className="h-4 w-4" aria-hidden />{preview ? 'Hide preview' : 'Preview original'}</Button>
      {p.download ? <Button variant="ghost" onClick={() => download(`/api/documents/${d._id}/file?download=1`, d.originalFilename ?? 'document')}><Download className="h-4 w-4" aria-hidden />Download original</Button>
        : <span className="self-center text-sm text-slate-600">Download not permitted ({(S.LICENSING_LABELS as any)[d.licensingStatus ?? 'unknown']} licence); use the preview.</span>}
      {p.archive && (d.archivedAt
        ? <ConfirmButton label={<><RotateCcw className="h-4 w-4" aria-hidden />Restore</>} ariaLabel="Restore" confirmLabel="Restore" tone="primary" variant="ghost" className="px-4 py-2" title="Restore this document?" body={<p>It returns to the library, search and the tutor (subject to approval and mapping).</p>} onConfirm={() => post(`/api/documents/${d._id}/restore`, {}).then(inv)} />
        : <ConfirmButton label={<><Archive className="h-4 w-4" aria-hidden />Archive</>} ariaLabel="Archive" confirmLabel="Archive" variant="ghost" className="px-4 py-2" disabled={RUNNING.includes(d.processingStatus)} title="Archive this document?" body={<><p>It is hidden from the library, search and the tutor. Pages, passages and everything generated from it are kept, and you can restore it later.</p>{(generated.lessons + generated.resources + generated.questions) > 0 && <p>{generated.lessons} lesson(s), {generated.resources} resource(s) and {generated.questions} question(s) cite it; they keep their sources.</p>}</>} onConfirm={() => post(`/api/documents/${d._id}/archive`, {}).then(inv)} />)}
      {p.delete && <ConfirmButton label="Delete permanently" className="px-4 py-2" typeToConfirm="DELETE" title="Delete this document permanently?" body={<p>Its pages, passages, elements and stored file are removed. This cannot be undone. Deleting is refused while lessons, resources, questions or duplicate records refer to it; archive it instead.{d.supersedes ? ' The previous version becomes current again.' : ''}</p>}
        onConfirm={() => del(`/api/documents/${d._id}`).then(() => { qc.invalidateQueries({ queryKey: ['/api/documents'] }); qc.invalidateQueries({ queryKey: ['document'] }); nav('/admin/documents'); })} />}
    </div>
    {preview && <Section title="Original file"><Preview d={{ ...d, __canDownload: p.download }} /></Section>}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0"><ProcessingCard d={d} jobs={jobs} chunkStats={chunkStats} perms={p} /><ApprovalCard d={d} canReview={p.review} /></div>
    <MetadataCard key={d._id} d={d} canEdit={p.edit} />
    <ExtractionCard d={d} />
    <StructureCard d={d} nodes={nodes} canMap={p.edit} />
    <VersionsCard d={d} versions={versions} canReplace={p.replace} maxMB={limits.data?.maxMB ?? 60} />
    {!!duplicates.length && <p className="text-sm text-slate-600">{duplicates.length} identical record(s) point to this document.</p>}
  </AdminPage>;
}
