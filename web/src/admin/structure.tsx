import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import * as S from '@ghlearn/shared';
import { api, post, patch, del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Input, Select, SampleBadge, Spinner } from '../components/ui';
import { ConfirmButton } from '../components/ConfirmDialog';
import { useUrlState } from './DataTable';
import { AdminPage } from './pages';
import { Badge, ErrorBox, Section, useConfig } from './common';

type F = { name: string; label: string; type?: 'text' | 'number' | 'select' | 'multi' | 'date' | 'optnumber' | 'csvlist'; options?: string; choices?: string[]; nullable?: boolean };
type Tab = { key: string; title: string; one: string; schema: any; cols: [string, string, ((r: any, ctx: any) => string)?][]; fields: F[]; flag?: 'active' | 'enabled' };
const TABS: Tab[] = [
  { key: 'levels', title: 'Levels', one: 'level', schema: S.levelSchema, flag: 'enabled', cols: [['name', 'Name'], ['kind', 'Kind'], ['years', 'Years']], fields: [{ name: 'kind', label: 'Kind', type: 'select', choices: [...S.LEVEL_KINDS] }, { name: 'name', label: 'Name' }, { name: 'years', label: 'Years', type: 'number' }] },
  { key: 'academic-years', title: 'Academic years', one: 'academic year', schema: S.academicYearSchema, cols: [['label', 'Label'], ['startDate', 'Starts', (r) => r.startDate?.slice(0, 10) ?? ''], ['endDate', 'Ends', (r) => r.endDate?.slice(0, 10) ?? ''], ['current', 'Current', (r) => (r.current ? 'Current' : '')]],
    fields: [{ name: 'label', label: 'Label (2026/2027)' }, { name: 'startDate', label: 'Start', type: 'date' }, { name: 'endDate', label: 'End', type: 'date' }] },
  { key: 'programmes', title: 'Learning Areas', one: 'Learning Area', schema: S.programmeSchema, flag: 'active', cols: [['name', 'Name'], ['code', 'Code'], ['levelId', 'Level', (r, c) => c.levels.get(r.levelId) ?? '']], fields: [{ name: 'name', label: 'Name' }, { name: 'code', label: 'Code' }, { name: 'levelId', label: 'Level', type: 'select', options: 'levels' }, { name: 'description', label: 'Description' }] },
  { key: 'subjects', title: 'Subjects', one: 'subject', schema: S.subjectSchema, flag: 'active', cols: [['name', 'Name'], ['code', 'Code'], ['category', 'Category'], ['curriculumVersion', 'Curriculum version']],
    fields: [{ name: 'name', label: 'Name' }, { name: 'code', label: 'Code' }, { name: 'levelId', label: 'Level', type: 'select', options: 'levels' }, { name: 'category', label: 'Category', type: 'select', choices: ['core', 'elective'] }, { name: 'curriculumVersionId', label: 'Curriculum version', type: 'select', options: 'versions', nullable: true }, { name: 'programmeIds', label: 'Learning Areas (electives)', type: 'multi', options: 'programmes' }, { name: 'aliases', label: 'Search aliases (comma separated)', type: 'csvlist' }] },
  { key: 'combinations', title: 'Combinations', one: 'combination', schema: S.combinationSchema.omit({ schoolId: true }), flag: 'active', cols: [['name', 'Name'], ['programmeId', S.LEARNING_AREA, (r, c) => c.programmes.get(r.programmeId) ?? ''], ['yearOfStudy', 'Year', (r) => (r.yearOfStudy ? String(r.yearOfStudy) : 'Any')], ['subjectIds', 'Subjects', (r) => String(r.subjectIds.length)]],
    fields: [{ name: 'name', label: 'Name' }, { name: 'programmeId', label: S.LEARNING_AREA, type: 'select', options: 'programmes' }, { name: 'yearOfStudy', label: 'Year of study (blank = any)', type: 'optnumber' }, { name: 'subjectIds', label: 'Subjects', type: 'multi', options: 'subjects' }, { name: 'minElectives', label: 'Min electives', type: 'number' }, { name: 'maxElectives', label: 'Max electives', type: 'number' }] },
];
const FIELD_KEYS = (t: Tab) => [...t.fields.map((f) => f.name)];

function RecordForm({ tab, initial, onDone, submitLabel }: { tab: Tab; initial?: any; onDone: () => void; submitLabel: string }) {
  const levels = useConfig('levels'); const programmes = useConfig('programmes'); const subjects = useConfig('subjects');
  const versions = useQuery({ queryKey: ['cur-versions-all'], enabled: tab.fields.some((x) => x.options === 'versions'), queryFn: () => api<{ items: any[] }>('/api/curriculum/versions?pageSize=200').then((r) => r.items) });
  const src: Record<string, any[] | undefined> = { levels: levels.data, programmes: programmes.data, subjects: subjects.data,
    versions: versions.data?.filter((v) => v.status !== 'archived' || v._id === initial?.curriculumVersionId).map((v) => ({ _id: v._id, name: `${v.code} · ${v.name}${v.status === 'draft' ? ' (draft)' : v.status === 'archived' ? ' (archived)' : ''}` })) };
  const init = initial && tab.key === 'subjects' ? { ...initial, aliases: (initial.provenance?.aliases ?? []).join(', ') } : initial;
  const defaults = init ? Object.fromEntries(FIELD_KEYS(tab).map((k) => [k, tab.fields.find((f) => f.name === k)?.type === 'date' ? init[k]?.slice(0, 10) : Array.isArray(init[k]) ? init[k].map(String) : init[k] ?? (tab.fields.find((f) => f.name === k)?.type === 'optnumber' ? null : '')])) : undefined;
  const f = useForm({ resolver: zodResolver(initial ? tab.schema.partial() : tab.schema), defaultValues: defaults });
  const m = useMutation({ mutationFn: (v: any) => (initial ? patch(`/api/config/${tab.key}/${initial._id}`, v) : post(`/api/config/${tab.key}`, v)), onSuccess: () => { if (!initial) f.reset(); onDone(); } });
  const err = (n: string) => (f.formState.errors as any)[n]?.message as string | undefined;
  return <form noValidate onSubmit={f.handleSubmit((v) => m.mutate(v))} className="grid gap-3 sm:grid-cols-2">
    {tab.fields.map((fl) => {
      const opts = fl.choices?.map((c) => ({ v: c, l: c })) ?? (src[fl.options!] ?? []).map((o) => ({ v: o._id, l: o.name }));
      if (fl.type === 'select') return <Select key={fl.name} label={fl.label} {...f.register(fl.name, fl.nullable ? { setValueAs: (v) => (v === '' || v == null ? null : v) } : undefined)} error={err(fl.name)}><option value="">{fl.nullable ? 'None' : 'Choose…'}</option>{opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</Select>;
      if (fl.type === 'multi') return <fieldset key={fl.name} className="sm:col-span-2"><legend className="text-sm font-medium">{fl.label}</legend><div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">{opts.map((o) => <label key={o.v} className="flex items-center gap-1 text-sm"><input type="checkbox" value={o.v} {...f.register(fl.name)} />{o.l}</label>)}</div>{err(fl.name) && <p role="alert" className="text-sm text-red-700">{err(fl.name)}</p>}</fieldset>;
      if (fl.type === 'csvlist') return <Input key={fl.name} label={fl.label} {...f.register(fl.name, { setValueAs: (v) => (Array.isArray(v) ? v : String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean)) })} error={err(fl.name)} />;
      if (fl.type === 'optnumber') return <Input key={fl.name} label={fl.label} type="number" min={1} {...f.register(fl.name, { setValueAs: (v) => (v === '' || v === null || v === undefined ? null : Number(v)) })} error={err(fl.name)} />;
      return <Input key={fl.name} label={fl.label} type={fl.type ?? 'text'} {...f.register(fl.name, fl.type === 'number' ? { valueAsNumber: true } : undefined)} error={err(fl.name)} />;
    })}
    <div className="sm:col-span-2"><ErrorBox error={m.error} /><Button type="submit" loading={m.isPending} className="mt-2">{submitLabel}</Button></div></form>;
}

function ConfigTab({ tab, canWrite, canDelete }: { tab: Tab; canWrite: boolean; canDelete: boolean }) {
  const qc = useQueryClient(); const [showArchived, setShowArchived] = useState(false); const [editing, setEditing] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const q = useConfig(tab.key, { archived: showArchived ? 'include' : undefined }); const levels = useConfig('levels'); const programmes = useConfig('programmes');
  const ctx = { levels: new Map((levels.data ?? []).map((l) => [l._id, l.name])), programmes: new Map((programmes.data ?? []).map((p) => [p._id, p.name])) };
  const done = () => { qc.invalidateQueries({ queryKey: ['/api/config/' + tab.key] }); setEditing(null); };
  const rows = q.data ?? []; const live = rows.filter((r) => !r.archivedAt);
  const move = async (i: number, d: -1 | 1) => { setErr(null); const ids = live.map((r) => r._id); const j = i + d; [ids[i], ids[j]] = [ids[j], ids[i]]; try { await post(`/api/config/${tab.key}/reorder`, { ids }); done(); } catch (e: any) { setErr(e.message); } };
  const act = (r: any, path: string, body?: any) => (path === 'delete' ? del(`/api/config/${tab.key}/${r._id}`) : path === 'patch' ? patch(`/api/config/${tab.key}/${r._id}`, body) : post(`/api/config/${tab.key}/${r._id}/${path}`, {})).then(done);
  const name = (r: any) => r.name ?? r.label;
  return <div className="space-y-4">
    {canWrite ? <Section title={`Add ${tab.one}`}><RecordForm tab={tab} onDone={done} submitLabel="Add" /></Section> : <Alert tone="info">Read-only: changing {tab.title.toLowerCase()} needs the Curriculum Admin or Super Admin role.</Alert>}
    <Section title={tab.title} actions={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>}>
      {err && <Alert>{err}</Alert>}
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="w-full text-left text-sm"><caption className="sr-only">{tab.title}</caption>
        <thead><tr>{canWrite && <th scope="col" className="w-20 border-b py-2">Order</th>}{tab.cols.map(([k, h]) => <th key={k} scope="col" className="border-b py-2">{h}</th>)}<th scope="col" className="border-b py-2">Status</th><th className="border-b"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{rows.length ? rows.map((r) => { const i = live.indexOf(r); const flagOn = tab.flag ? r[tab.flag] !== false : true; return [<tr key={r._id} className="border-b align-top last:border-0">
          {canWrite && <td className="py-2">{!r.archivedAt && <span className="inline-flex gap-1"><button type="button" className="rounded border p-1 disabled:opacity-30" disabled={i <= 0} aria-label={`Move ${name(r)} up`} onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3" aria-hidden /></button>
            <button type="button" className="rounded border p-1 disabled:opacity-30" disabled={i >= live.length - 1} aria-label={`Move ${name(r)} down`} onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3" aria-hidden /></button></span>}</td>}
          {tab.cols.map(([k, , fn]) => <td key={k} className="py-2">{fn ? fn(r, ctx) : String(r[k] ?? '')}</td>)}
          <td className="py-2">{r.archivedAt ? <Badge v="archived" /> : flagOn ? <Badge v="active" /> : <Badge v="inactive" />}</td>
          <td className="space-x-1 whitespace-nowrap py-2 text-right">{r.isSample && <SampleBadge />}{canWrite && (r.archivedAt
            ? <ConfirmButton label="Restore" tone="primary" variant="ghost" ariaLabel={`Restore ${name(r)}`} title={`Restore ${name(r)}?`} body={<p>It becomes available again.</p>} onConfirm={() => act(r, 'restore')} />
            : <>
              <Button variant="ghost" className="px-2 py-1 text-xs" aria-expanded={editing === r._id} aria-label={`Edit ${name(r)}`} onClick={() => setEditing(editing === r._id ? null : r._id)}>Edit</Button>
              {tab.flag && <ConfirmButton label={flagOn ? 'Deactivate' : 'Activate'} tone={flagOn ? 'danger' : 'primary'} variant="ghost" ariaLabel={`${flagOn ? 'Deactivate' : 'Activate'} ${name(r)}`} title={`${flagOn ? 'Deactivate' : 'Activate'} ${name(r)}?`}
                body={<p>{flagOn ? 'It stays visible on existing records but cannot be chosen for new ones.' : 'It can be chosen again.'}</p>} onConfirm={() => act(r, 'patch', { [tab.flag!]: !flagOn })} />}
              {tab.key === 'academic-years' && !r.current && <ConfirmButton label="Make current" tone="primary" variant="ghost" ariaLabel={`Make ${name(r)} current`} title={`Make ${name(r)} the current academic year?`} body={<p>The top bar and new classes use the current year. Classes are not moved; use "Change academic year" in Classes and Enrolments.</p>} onConfirm={() => act(r, 'patch', { current: true })} />}
              <ConfirmButton label="Archive" variant="ghost" ariaLabel={`Archive ${name(r)}`} title={`Archive ${name(r)}?`} body={<p>It is hidden from lists and new choices. Records that use it keep it. You can restore it later.</p>} onConfirm={() => act(r, 'archive')} />
              {canDelete && <ConfirmButton label="Delete" ariaLabel={`Delete ${name(r)}`} title={`Delete ${name(r)}?`} body={<p>This cannot be undone. Deleting is refused while anything still uses it; archive it instead.</p>} onConfirm={() => act(r, 'delete')} />}
            </>)}</td></tr>,
          editing === r._id && <tr key={r._id + ':e'}><td colSpan={tab.cols.length + 3} className="bg-slate-50 p-3"><RecordForm tab={tab} initial={r} onDone={done} submitLabel="Save changes" /></td></tr>]; })
          : <tr><td colSpan={tab.cols.length + 3} className="py-4 text-center text-slate-600">None yet.</td></tr>}</tbody></table></div>}
    </Section></div>;
}

function ElementsTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient(); const subjects = useConfig('subjects'); const [subjectId, setSubjectId] = useState(''); const [documentId, setDocumentId] = useState('');
  const [showArchived, setShowArchived] = useState(false); const [edit, setEdit] = useState<{ id: string; title: string; code: string; verified: boolean } | null>(null); const [err, setErr] = useState<string | null>(null);
  const docs = useQuery({ queryKey: ['cur-docs', subjectId], enabled: !!subjectId, queryFn: () => api<{ items: any[] }>(`/api/curriculum/documents?subjectId=${subjectId}`).then((r) => r.items) });
  const key = ['cur-nodes', documentId, showArchived];
  const nodes = useQuery({ queryKey: key, enabled: !!documentId, queryFn: () => api<{ items: any[] }>(`/api/curriculum/nodes?documentId=${documentId}${showArchived ? '&archived=include' : ''}`).then((r) => r.items) });
  const done = () => { qc.invalidateQueries({ queryKey: ['cur-nodes', documentId] }); setEdit(null); };
  const save = useMutation({ mutationFn: () => patch(`/api/curriculum/nodes/${edit!.id}`, { title: edit!.title, code: edit!.code, verified: edit!.verified }), onSuccess: done });
  const sib = (n: any) => (nodes.data ?? []).filter((x) => String(x.parentId ?? '') === String(n.parentId ?? '') && !x.archivedAt);
  const move = async (n: any, d: -1 | 1) => { setErr(null); const s = sib(n).map((x) => x._id); const i = s.indexOf(n._id); [s[i], s[i + d]] = [s[i + d], s[i]]; try { await post('/api/curriculum/nodes/reorder', { ids: s }); done(); } catch (e: any) { setErr(e.message); } };
  return <div className="space-y-4"><Section title="Curriculum elements">
    <p className="text-sm text-slate-600">Strands, sub-strands, content standards, indicators and topics detected in curriculum documents. Unverified items were detected automatically and need a person to confirm them. Sub-topics are not modelled yet.</p>
    <div className="grid gap-3 sm:grid-cols-2"><Select label="Subject" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setDocumentId(''); }}><option value="">Choose…</option>{subjects.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
      <Select label="Document" value={documentId} disabled={!docs.data?.length} onChange={(e) => setDocumentId(e.target.value)}><option value="">{subjectId && docs.data && !docs.data.length ? 'No elements for this subject' : 'Choose…'}</option>{docs.data?.map((d) => <option key={d._id} value={d._id}>{d.title} ({d.nodes})</option>)}</Select></div>
    {documentId && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>}
    {err && <Alert>{err}</Alert>}
    {nodes.isLoading ? <Spinner /> : nodes.data && <ul aria-label="Curriculum elements" className="divide-y rounded-lg border">{nodes.data.map((n) => { const s = sib(n); const i = s.findIndex((x) => x._id === n._id); return <li key={n._id} className="p-2 text-sm" style={{ paddingLeft: `${0.5 + n.depth * 1.5}rem` }}>
      {edit?.id === n._id ? <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}><div className="w-24"><Input label="Code" value={edit!.code} onChange={(e) => setEdit({ ...edit!, code: e.target.value })} /></div><div className="min-w-[16rem] flex-1"><Input label="Title" value={edit!.title} onChange={(e) => setEdit({ ...edit!, title: e.target.value })} /></div>
        <label className="flex items-center gap-1 pb-2"><input type="checkbox" checked={edit!.verified} onChange={(e) => setEdit({ ...edit!, verified: e.target.checked })} />Verified</label><Button type="submit" className="px-3 py-1 text-sm" loading={save.isPending}>Save</Button><Button variant="ghost" className="px-3 py-1 text-sm" onClick={() => setEdit(null)}>Cancel</Button><ErrorBox error={save.error} /></form>
      : <div className="flex flex-wrap items-center gap-2"><Badge v="x" label={n.type} />{n.code && <code>{n.code}</code>}<span className={n.archivedAt ? 'text-slate-500 line-through' : ''}>{n.title}</span>{n.verified ? <Badge v="active" label="verified" /> : <Badge v="pending" label="unverified" />}{n.archivedAt && <Badge v="archived" />}{n.lessons > 0 && <span className="text-xs text-slate-600">{n.lessons} lesson(s)</span>}
        {canWrite && <span className="ml-auto inline-flex flex-wrap gap-1">{n.archivedAt ? <ConfirmButton label="Restore" tone="primary" variant="ghost" ariaLabel={`Restore ${n.title}`} title={`Restore ${n.title}?`} body={<p>It and its archived sub-elements become available again.</p>} onConfirm={() => post(`/api/curriculum/nodes/${n._id}/restore`, {}).then(done)} /> : <>
          <button type="button" className="rounded border p-1 disabled:opacity-30" disabled={i <= 0} aria-label={`Move ${n.title} up`} onClick={() => move(n, -1)}><ArrowUp className="h-3 w-3" aria-hidden /></button>
          <button type="button" className="rounded border p-1 disabled:opacity-30" disabled={i < 0 || i >= s.length - 1} aria-label={`Move ${n.title} down`} onClick={() => move(n, 1)}><ArrowDown className="h-3 w-3" aria-hidden /></button>
          <Button variant="ghost" className="px-2 py-1 text-xs" aria-label={`Edit ${n.title}`} onClick={() => setEdit({ id: n._id, title: n.title, code: n.code ?? '', verified: !!n.verified })}>Edit</Button>
          <ConfirmButton label="Archive" variant="ghost" ariaLabel={`Archive ${n.title}`} title={`Archive ${n.title}?`} body={<p>{n.children ? 'Its sub-elements are archived too. ' : ''}Archived elements are hidden but kept for lessons that use them.</p>} onConfirm={() => post(`/api/curriculum/nodes/${n._id}/archive`, {}).then(done)} />
          <ConfirmButton label="Delete" ariaLabel={`Delete ${n.title}`} title={`Delete ${n.title}?`} body={<p>Deleting is refused while lessons or sub-elements use it.</p>} onConfirm={() => del(`/api/curriculum/nodes/${n._id}`).then(done)} /></>}</span>}</div>}</li>; })}
      {!nodes.data.length && <li className="p-3 text-slate-600">No elements.</li>}</ul>}
  </Section></div>;
}
/** §8 Academic structure: create, edit, reorder, deactivate, archive/restore and reference-safe delete. */
export function StructurePage() {
  const { user } = useAuth(); const u = useUrlState();
  const canWrite = S.hasPermission(user!.roles, 'curriculum:manage'); const canDelete = S.hasPermission(user!.roles, 'platform:manage');
  const canElements = S.hasPermission(user!.roles, 'documents:map') || canWrite;
  const all = [...TABS.map((t) => ({ key: t.key, title: t.title })), ...(canElements ? [{ key: 'elements', title: 'Curriculum elements' }] : [])];
  if (u.get('tab') === 'versions' && canWrite) return <Navigate to="/admin/curriculum" replace />; // versions moved to Curriculum Management
  const k = all.some((t) => t.key === u.get('tab')) ? u.get('tab') : all[0].key;
  const tab = TABS.find((t) => t.key === k);
  return <AdminPage title="Academic structure" description="Levels, academic years, Learning Areas, subjects, combinations and curriculum elements. Items in use cannot be deleted; archive them instead.">
    <div role="tablist" aria-label="Structure" className="flex flex-wrap gap-2">{all.map((t) => <button key={t.key} id={`tab-${t.key}`} role="tab" aria-selected={t.key === k} aria-controls="config-panel" onClick={() => u.set({ tab: t.key })} className={`rounded-full px-3 py-1 text-sm ${t.key === k ? 'bg-brand-700 text-white' : 'border bg-white'}`}>{t.title}</button>)}</div>
    <div id="config-panel" role="tabpanel" aria-labelledby={`tab-${k}`}>
      {tab ? <ConfigTab key={k} tab={tab} canWrite={canWrite} canDelete={canDelete} /> : <ElementsTab canWrite={canElements} />}</div>
  </AdminPage>;
}
