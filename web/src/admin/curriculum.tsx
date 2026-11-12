/** Curriculum Management (spec §3 item 5): curriculum versions with a draft → active → archived lifecycle, linked to subjects, manuals and elements. */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as S from '@ghlearn/shared';
import { api, post, patch, del } from '../lib/api';
import { Alert, Button, Input, Select, Spinner, SampleBadge } from '../components/ui';
import { ConfirmButton } from '../components/ConfirmDialog';
import { AdminPage } from './pages';
import { DataTable, useUrlState, type Column } from './DataTable';
import { Badge, ErrorBox, Facts, Section, day, when, useConfig } from './common';

const STATUS_TONE: Record<string, string> = { draft: 'pending', active: 'active', archived: 'archived' };
const VBadge = ({ v }: { v: string }) => <Badge v={STATUS_TONE[v] ?? 'x'} label={v} />;
type VForm = { code: string; name: string; levelId: string; effectiveFrom: string; effectiveTo: string; publisher: string; description: string };
const toForm = (v?: any): VForm => ({ code: v?.code ?? '', name: v?.name ?? '', levelId: v?.levelId?._id ?? v?.levelId ?? '', effectiveFrom: v?.effectiveFrom?.slice(0, 10) ?? '', effectiveTo: v?.effectiveTo?.slice(0, 10) ?? '', publisher: v?.publisher ?? '', description: v?.description ?? '' });
const toBody = (f: VForm) => ({ code: f.code.trim(), name: f.name.trim(), levelId: f.levelId || null, effectiveFrom: f.effectiveFrom || null, effectiveTo: f.effectiveTo || null, publisher: f.publisher.trim(), description: f.description.trim() });
const errorsOf = (f: VForm) => {
  const e: Partial<Record<keyof VForm, string>> = {}; const r = S.curriculumVersionSchema.safeParse(toBody(f));
  if (!r.success) for (const i of r.error.issues) e[i.path[0] as keyof VForm] ??= i.message;
  if (f.effectiveFrom && f.effectiveTo && f.effectiveTo < f.effectiveFrom) e.effectiveTo = 'The end date must be after the start date';
  return e;
};

function VersionForm({ initial, onDone, submitLabel }: { initial?: any; onDone: (v: any) => void; submitLabel: string }) {
  const levels = useConfig('levels'); const [f, setF] = useState<VForm>(toForm(initial)); const [touched, setTouched] = useState(false);
  const m = useMutation({ mutationFn: () => (initial ? patch<{ version: any }>(`/api/curriculum/versions/${initial._id}`, toBody(f)) : post<{ version: any }>('/api/curriculum/versions', toBody(f))), onSuccess: (r) => { if (!initial) setF(toForm()); setTouched(false); onDone(r.version); } });
  const e = touched ? errorsOf(f) : {}; const t = (k: keyof VForm) => ({ value: f[k], onChange: (x: { target: { value: string } }) => setF({ ...f, [k]: x.target.value }), error: e[k] });
  return <form noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={(x) => { x.preventDefault(); setTouched(true); if (!Object.keys(errorsOf(f)).length) m.mutate(); }}>
    <Input label="Code" hint="Short identifier, e.g. SHS 2023+" {...t('code')} /><Input label="Name" {...t('name')} />
    <Select label="Level" value={f.levelId} onChange={(x) => setF({ ...f, levelId: x.target.value })}><option value="">Any level</option>{levels.data?.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</Select>
    <Input label="Publisher" {...t('publisher')} />
    <Input label="Effective from" type="date" {...t('effectiveFrom')} /><Input label="Effective to" type="date" {...t('effectiveTo')} />
    <div className="sm:col-span-2"><Input label="Description" {...t('description')} /></div>
    <div className="sm:col-span-2"><ErrorBox error={m.error} /><Button type="submit" loading={m.isPending} className="mt-2">{submitLabel}</Button></div>
  </form>;
}

export function CurriculumPage() {
  const nav = useNavigate(); const qc = useQueryClient(); const u = useUrlState(); const [adding, setAdding] = useState(false);
  const cols: Column<any>[] = [
    { key: 'code', header: 'Code', sortable: true, render: (v) => <Link className="font-medium text-brand-700 underline" to={`/admin/curriculum/${v._id}`}>{v.code}</Link> },
    { key: 'name', header: 'Name', sortable: true, render: (v) => <>{v.name} {v.isSample && <SampleBadge />}</> },
    { key: 'level', header: 'Level', render: (v) => v.levelId?.name ?? 'Any' },
    { key: 'status', header: 'Status', sortable: true, render: (v) => <VBadge v={v.status} /> },
    { key: 'effective', header: 'Effective', render: (v) => (v.effectiveFrom || v.effectiveTo ? `${day(v.effectiveFrom)} – ${v.effectiveTo ? day(v.effectiveTo) : 'open'}` : '—') },
    { key: 'subjects', header: 'Subjects', render: (v) => v.counts.subjects }, { key: 'documents', header: 'Manuals', render: (v) => v.counts.documents }, { key: 'elements', header: 'Elements', render: (v) => v.counts.elements },
  ];
  return <AdminPage title="Curriculum Management" description="Curriculum versions group the subjects, learner manuals and curriculum elements that belong to one edition of the curriculum. New versions start as drafts; activate a version when it is in use and archive it when it is retired. Archived versions keep their links."
    actions={!adding && <Button onClick={() => setAdding(true)}>New curriculum version</Button>}>
    {adding && <Section title="New curriculum version"><VersionForm submitLabel="Create draft" onDone={(v) => { qc.invalidateQueries({ queryKey: ['/api/curriculum/versions'] }); qc.invalidateQueries({ queryKey: ['cur-versions-all'] }); setAdding(false); nav(`/admin/curriculum/${v._id}`); }} />
      <Button variant="ghost" className="mt-2" onClick={() => setAdding(false)}>Cancel</Button></Section>}
    <Section title="Curriculum versions">
      <DataTable path="/api/curriculum/versions" caption="Curriculum versions" searchLabel="Search code, name or publisher" defaultSort="code" filterKeys={['status']} columns={cols}
        toolbar={<label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Status</span><select className="rounded-lg border border-slate-300 bg-white px-2 py-2" value={u.get('status')} onChange={(e) => u.set({ status: e.target.value || undefined })}><option value="">Any</option>{S.CURRICULUM_VERSION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>} />
    </Section>
  </AdminPage>;
}

const TYPE_LABEL: Record<string, string> = { section: 'Sections', strand: 'Strands', subStrand: 'Sub-strands', contentStandard: 'Content standards', indicator: 'Indicators', topic: 'Topics' };

export function CurriculumVersionPage() {
  const { id } = useParams(); const nav = useNavigate(); const qc = useQueryClient(); const [editing, setEditing] = useState(false); const [pick, setPick] = useState<string[]>([]);
  const q = useQuery({ queryKey: ['cur-version', id], queryFn: () => api<any>(`/api/curriculum/versions/${id}`) });
  const subjects = useConfig('subjects');
  const elDocs = useQuery({ queryKey: ['cur-docs-version', id], queryFn: () => api<{ items: any[] }>(`/api/curriculum/documents?curriculumVersionId=${id}`).then((r) => r.items) });
  const inv = () => { qc.invalidateQueries({ queryKey: ['cur-version', id] }); qc.invalidateQueries({ queryKey: ['/api/curriculum/versions'] }); qc.invalidateQueries({ queryKey: ['cur-versions-all'] }); qc.invalidateQueries({ queryKey: ['/api/config/subjects'] }); };
  const link = useMutation({ mutationFn: () => post(`/api/curriculum/versions/${id}/subjects`, { subjectIds: pick }), onSuccess: () => { setPick([]); inv(); } });
  if (q.isLoading) return <Spinner />; if (q.error) return <Alert>{q.error.message}</Alert>;
  const { version: v, subjects: linked, documents, counts, documentsByStatus, elementsByType } = q.data;
  const linkedIds = new Set(linked.map((s: any) => s._id)); const candidates = (subjects.data ?? []).filter((s) => !linkedIds.has(s._id));
  const act = (op: string) => post(`/api/curriculum/versions/${v._id}/${op}`, {}).then(inv);
  const activeSubjects = linked.filter((s: any) => !s.archivedAt && s.active !== false).length;
  return <AdminPage title={`${v.code} · ${v.name}`} actions={<Link to="/admin/curriculum" className="text-sm text-brand-700 underline">← All curriculum versions</Link>}>
    <div className="flex flex-wrap items-center gap-2"><VBadge v={v.status} />{v.isSample && <SampleBadge />}</div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Lifecycle">
      {v.status === 'draft' && <ConfirmButton label="Activate" tone="primary" variant="primary" className="px-4 py-2" title={`Activate ${v.code}?`} body={<p>Active versions are in use: subjects and manuals linked to it are taught under this edition. Other versions are not changed.</p>} onConfirm={() => act('activate')} />}
      {v.status !== 'archived' && <ConfirmButton label="Archive" variant="ghost" className="px-4 py-2" disabled={activeSubjects > 0} title={`Archive ${v.code}?`} body={<p>The version is retired. Linked manuals and elements keep it; it can no longer be chosen for new links. You can restore it as a draft.</p>} onConfirm={() => act('archive')} />}
      {v.status === 'archived' && <ConfirmButton label="Restore as draft" tone="primary" variant="ghost" className="px-4 py-2" title={`Restore ${v.code}?`} body={<p>It becomes a draft again and can be edited and activated.</p>} onConfirm={() => act('restore')} />}
      {v.status === 'draft' && <ConfirmButton label="Delete" className="px-4 py-2" title={`Delete ${v.code}?`} typeToConfirm={v.code} body={<p>This cannot be undone. Deleting is refused while subjects, manuals or elements link to it.</p>} onConfirm={() => del(`/api/curriculum/versions/${v._id}`).then(() => { inv(); nav('/admin/curriculum'); })} />}
      {v.status !== 'archived' && !editing && <Button variant="ghost" onClick={() => setEditing(true)}>Edit details</Button>}
    </div>
    {v.status !== 'archived' && activeSubjects > 0 && <p className="text-sm text-slate-600">To archive this version, first link its {activeSubjects} active subject(s) to another version.</p>}
    {editing ? <Section title="Edit details"><VersionForm initial={v} submitLabel="Save changes" onDone={() => { setEditing(false); inv(); }} /><Button variant="ghost" className="mt-2" onClick={() => setEditing(false)}>Cancel</Button></Section>
      : <Section title="Details"><Facts items={[['Code', v.code], ['Name', v.name], ['Level', v.levelId?.name ?? 'Any level'], ['Effective', v.effectiveFrom || v.effectiveTo ? `${day(v.effectiveFrom)} – ${v.effectiveTo ? day(v.effectiveTo) : 'open'}` : '—'], ['Publisher', v.publisher || '—'], ['Description', v.description || '—'],
        ['Created', `${when(v.createdAt)}${v.createdBy?.fullName ? ` by ${v.createdBy.fullName}` : ''}`], ...(v.activatedAt ? [['Activated', `${when(v.activatedAt)}${v.activatedBy?.fullName ? ` by ${v.activatedBy.fullName}` : ''}`] as [string, string]] : []), ...(v.archivedAt ? [['Archived', `${when(v.archivedAt)}${v.archivedBy?.fullName ? ` by ${v.archivedBy.fullName}` : ''}`] as [string, string]] : [])]} /></Section>}
    <div className="grid gap-4 lg:grid-cols-3">{[['Subjects', counts.subjects], ['Learner manuals', counts.documents], ['Curriculum elements', counts.elements]].map(([l, n]) => <Section key={l as string} title={l as string}><p className="text-2xl font-bold">{n as number}</p></Section>)}</div>
    <Section title="Linked subjects">
      <ul className="flex flex-wrap gap-2 text-sm">{linked.map((s: any) => <li key={s._id} className="rounded border px-2 py-1">{s.name} ({s.code}){s.archivedAt ? ' · archived' : s.active === false ? ' · inactive' : ''}</li>)}{!linked.length && <li className="text-slate-600">No subjects linked yet.</li>}</ul>
      {v.status !== 'archived' && <fieldset className="space-y-2"><legend className="text-sm font-medium">Link more subjects (moves them from their current version)</legend>
        <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">{candidates.map((s) => <label key={s._id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={pick.includes(s._id)} onChange={(e) => setPick(e.target.checked ? [...pick, s._id] : pick.filter((x) => x !== s._id))} />{s.name}{s.curriculumVersion ? ` (${s.curriculumVersion})` : ''}</label>)}{!candidates.length && <span className="text-sm text-slate-600">All subjects are linked.</span>}</div>
        <ErrorBox error={link.error} /><Button disabled={!pick.length} loading={link.isPending} onClick={() => link.mutate()}>Link {pick.length || ''} subject{pick.length === 1 ? '' : 's'}</Button></fieldset>}
    </Section>
    <Section title="Learner manuals">
      <p className="text-sm text-slate-600">Processing: {Object.entries(documentsByStatus).map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`).join(', ') || 'none'}. Link a manual from its details page.</p>
      <ul className="divide-y text-sm">{documents.map((d: any) => <li key={d._id} className="flex flex-wrap items-center gap-2 py-1.5"><Link className="text-brand-700 underline" to={`/admin/documents/${d._id}`}>{d.title}</Link><span className="text-slate-600">{d.subjectId?.name ?? 'not mapped'}</span><Badge v={d.processingStatus === 'indexed' ? 'active' : d.processingStatus === 'failed' ? 'failed' : 'pending'} label={d.processingStatus.replace(/_/g, ' ')} />{d.archivedAt && <Badge v="archived" />}</li>)}
        {!documents.length && <li className="py-2 text-slate-600">No manuals linked yet.</li>}</ul>
      <Link className="text-sm text-brand-700 underline" to={`/admin/documents?curriculumVersionId=${v._id}&archived=all`}>Open these in the Learner Manuals library</Link>
    </Section>
    <Section title="Curriculum elements">
      <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="text-left text-sm"><caption className="sr-only">Elements by type</caption><thead><tr><th scope="col" className="pr-6">Type</th><th scope="col" className="pr-6">Total</th><th scope="col">Verified</th></tr></thead>
        <tbody>{Object.entries(elementsByType).map(([k, x]: [string, any]) => <tr key={k}><td className="pr-6">{TYPE_LABEL[k] ?? k}</td><td className="pr-6">{x.total}</td><td>{x.verified}</td></tr>)}{!Object.keys(elementsByType).length && <tr><td colSpan={3} className="text-slate-600">No elements yet. They are detected when linked manuals are processed.</td></tr>}</tbody></table></div>
      {!!elDocs.data?.length && <p className="text-sm">Review and verify elements per document: {elDocs.data.map((d, i) => <span key={d._id}>{i ? ', ' : ''}<Link className="text-brand-700 underline" to={`/admin/documents/${d._id}`}>{d.title}</Link> ({d.nodes})</span>)}, or in <Link className="text-brand-700 underline" to="/admin/structure?tab=elements">Academic Structure › Curriculum elements</Link>.</p>}
    </Section>
  </AdminPage>;
}
