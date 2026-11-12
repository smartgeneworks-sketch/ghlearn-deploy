import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as S from '@ghlearn/shared';
import { api, post, patch, del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Input, Select, SampleBadge, Spinner } from '../components/ui';
import { ConfirmButton } from '../components/ConfirmDialog';
import { LeaderboardSettings } from '../pages/TeachAssess';
import { DataTable, useUrlState } from './DataTable';
import { AdminPage } from './pages';
import { Badge, ErrorBox, Facts, Section, useConfig } from './common';

type SchoolForm = { name: string; code: string; region: string; district: string; type: string; levelKinds: string[]; programmeIds: string[]; contact: { email: string; phone: string; address: string; headName: string } };
const blank: SchoolForm = { name: '', code: '', region: '', district: '', type: '', levelKinds: ['SHS'], programmeIds: [], contact: { email: '', phone: '', address: '', headName: '' } };
const fromSchool = (s: any): SchoolForm => ({ name: s.name, code: s.code, region: s.region ?? '', district: s.district ?? '', type: s.type ?? '', levelKinds: s.levelKinds ?? ['SHS'], programmeIds: (s.programmeIds ?? []).map(String), contact: { email: '', phone: '', address: '', headName: '', ...(s.contact ?? {}) } });
const clean = (f: SchoolForm, keys?: readonly string[]) => {
  const c = Object.fromEntries(Object.entries(f.contact).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
  const all: Record<string, unknown> = { name: f.name, code: f.code, region: f.region || undefined, district: f.district || undefined, type: f.type || undefined, levelKinds: f.levelKinds, programmeIds: f.programmeIds, contact: c };
  return Object.fromEntries(Object.entries(all).filter(([k, v]) => v !== undefined && (!keys || keys.includes(k))));
};

function SchoolFields({ f, setF, limited }: { f: SchoolForm; setF: (f: SchoolForm) => void; limited?: boolean }) {
  const programmes = useConfig('programmes'); const levels = useConfig('levels');
  const kindOf = new Map((levels.data ?? []).map((l) => [l._id, l.kind]));
  const c = (k: keyof SchoolForm['contact']) => (e: any) => setF({ ...f, contact: { ...f.contact, [k]: e.target.value } });
  return <div className="grid gap-3 sm:grid-cols-2">
    <Input label="Name" value={f.name} disabled={limited} onChange={(e) => setF({ ...f, name: e.target.value })} />
    <Input label="Unique identifier" hint="Letters, digits and hyphens (e.g. a GES or EMIS code). Stored in capitals." disabled={limited} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
    <Select label="Region" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}><option value="">Not set</option>{S.GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}</Select>
    <Input label="District" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} />
    <Select label="Institution type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Not set</option>{S.SCHOOL_TYPES.map((t) => <option key={t} value={t}>{S.SCHOOL_TYPE_LABELS[t]}</option>)}</Select>
    <fieldset><legend className="text-sm font-medium">Levels offered</legend><div className="flex gap-3">{S.LEVEL_KINDS.map((k) => <label key={k} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.levelKinds.includes(k)} onChange={(e) => setF({ ...f, levelKinds: e.target.checked ? [...f.levelKinds, k] : f.levelKinds.filter((x) => x !== k) })} />{k}</label>)}</div></fieldset>
    <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Learning Areas offered</legend><div className="flex flex-wrap gap-3">{(programmes.data ?? []).filter((p) => f.levelKinds.includes(kindOf.get(p.levelId) ?? 'SHS')).map((p) => <label key={p._id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.programmeIds.includes(p._id)} onChange={(e) => setF({ ...f, programmeIds: e.target.checked ? [...f.programmeIds, p._id] : f.programmeIds.filter((x) => x !== p._id) })} />{p.name}</label>)}</div></fieldset>
    <Input label="Contact email" type="email" value={f.contact.email} onChange={c('email')} /><Input label="Contact phone" value={f.contact.phone} onChange={c('phone')} />
    <Input label="Head of school" value={f.contact.headName} onChange={c('headName')} /><Input label="Address" value={f.contact.address} onChange={c('address')} />
  </div>;
}
function CreateSchool({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient(); const [f, setF] = useState<SchoolForm>(blank); const [err, setErr] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => post<any>('/api/admin/schools', clean(f)), onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/admin/schools'] }); qc.invalidateQueries({ queryKey: ['/api/config/schools'] }); setF(blank); } });
  return <Section title="Add a school" actions={<Button variant="ghost" className="px-3 py-1 text-sm" onClick={onClose}>Close</Button>}>
    <form noValidate onSubmit={(e) => { e.preventDefault(); setErr(null); const r = S.schoolSchema.safeParse(clean(f)); if (!r.success) return setErr(`${r.error.issues[0].path.join('.')}: ${r.error.issues[0].message}`); m.mutate(); }} className="space-y-3">
      <SchoolFields f={f} setF={setF} />{(err || m.error) && <Alert>{err ?? m.error!.message}</Alert>}{m.isSuccess && <Alert tone="success">School added.</Alert>}<Button type="submit" loading={m.isPending}>Add school</Button></form></Section>;
}

/** §6 Schools and Institutions list. School admins see only their own school. */
export function SchoolsPage() {
  const { user } = useAuth(); const u = useUrlState(); const [adding, setAdding] = useState(false);
  const canCreate = S.hasPermission(user!.roles, 'school:create');
  return <AdminPage title="Schools and institutions" description="Schools on the platform with their status, Learning Areas and membership counts. School admins manage their own school." actions={canCreate && !adding && <Button onClick={() => setAdding(true)}>Add school</Button>}>
    {adding && <CreateSchool onClose={() => setAdding(false)} />}
    <DataTable path="/api/admin/schools" caption="Schools" searchLabel="Search name, identifier or district" defaultSort="name" filterKeys={['status', 'region', 'type']}
      toolbar={<><div className="w-40"><Select label="Status" value={u.get('status')} onChange={(e) => u.set({ status: e.target.value || undefined })}><option value="">Any</option>{S.SCHOOL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
        <div className="w-44"><Select label="Region" value={u.get('region')} onChange={(e) => u.set({ region: e.target.value || undefined })}><option value="">All regions</option>{S.GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}</Select></div>
        <div className="w-48"><Select label="Type" value={u.get('type')} onChange={(e) => u.set({ type: e.target.value || undefined })}><option value="">All types</option>{S.SCHOOL_TYPES.map((t) => <option key={t} value={t}>{S.SCHOOL_TYPE_LABELS[t]}</option>)}</Select></div></>}
      columns={[
        { key: 'name', header: 'School', sortable: true, render: (s: any) => <><Link className="text-brand-700 underline" to={`/admin/schools/${s._id}`}>{s.name}</Link> {s.isSample && <SampleBadge />}</> },
        { key: 'code', header: 'Identifier', sortable: true },
        { key: 'region', header: 'Region / district', sortable: true, render: (s: any) => [s.region, s.district].filter(Boolean).join(' · ') || '—' },
        { key: 'type', header: 'Type', render: (s: any) => (s.type ? S.SCHOOL_TYPE_LABELS[s.type as S.SchoolType] : '—') },
        { key: 'status', header: 'Status', sortable: true, render: (s: any) => <Badge v={s.status} /> },
        { key: 'students', header: 'Students', className: 'text-right', render: (s: any) => s.counts.students },
        { key: 'teachers', header: 'Teachers', className: 'text-right', render: (s: any) => s.counts.teachers },
        { key: 'classes', header: 'Classes', className: 'text-right', render: (s: any) => s.counts.classes },
      ]} />
  </AdminPage>;
}

function AdminsCard({ s, admins, onDone }: { s: any; admins: any[]; onDone: () => void }) {
  const [pick, setPick] = useState('');
  const cands = useQuery({ queryKey: ['school-admin-cands', s._id], queryFn: () => api<any>(`/api/admin/users?schoolId=${s._id}&pageSize=100&sort=fullName`).then((r) => r.items.filter((u: any) => !u.roles.includes('school_admin') && u.roles.every((x: string) => S.SCHOOL_ROLES.includes(x as S.Role)))) });
  const g = useMutation({ mutationFn: () => post(`/api/admin/schools/${s._id}/admins`, { userId: pick }), onSuccess: () => { setPick(''); onDone(); cands.refetch(); } });
  return <><ul className="space-y-1 text-sm">{admins.map((a) => <li key={a._id} className="flex flex-wrap items-center gap-2"><Link className="text-brand-700 underline" to={`/admin/users/${a._id}`}>{a.fullName}</Link><span className="text-slate-600">{a.email}</span><Badge v={a.status} />
    <ConfirmButton label="Remove admin role" ariaLabel={`Remove admin role from ${a.fullName}`} title={`Remove ${a.fullName} as school admin?`} body={<p>They keep their other roles and are signed out everywhere.</p>} onConfirm={() => del(`/api/admin/schools/${s._id}/admins/${a._id}`).then(onDone)} /></li>)}
    {!admins.length && <li className="text-slate-600">No school admin yet.</li>}</ul>
    <div className="flex flex-wrap items-end gap-2"><div className="w-72"><Select label="Make a member of this school its admin" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Choose…</option>{cands.data?.map((u: any) => <option key={u._id} value={u._id}>{u.fullName} ({u.email})</option>)}</Select></div>
      <ConfirmButton label="Assign" tone="primary" variant="primary" className="px-3 py-2 text-sm" disabled={!pick} title="Grant the School Admin role?" body={<p>They can manage this school's users, classes and settings. They are signed out and must sign in again.</p>} onConfirm={() => g.mutateAsync()} /></div>
    <p className="text-xs text-slate-600">To add a new person as school admin, create the account in Users and Permissions first.</p></>;
}
function Combinations({ s, canEdit }: { s: any; canEdit: boolean }) {
  const qc = useQueryClient(); const subjects = useConfig('subjects'); const programmes = useConfig('programmes');
  const key = ['school-combos', s._id]; const q = useQuery({ queryKey: key, queryFn: () => api<{ items: any[] }>(`/api/admin/schools/${s._id}/combinations`).then((r) => r.items) });
  const [f, setF] = useState({ name: '', programmeId: '', yearOfStudy: '', subjectIds: [] as string[] });
  const done = () => qc.invalidateQueries({ queryKey: key });
  const m = useMutation({ mutationFn: () => post(`/api/admin/schools/${s._id}/combinations`, { name: f.name, programmeId: f.programmeId, subjectIds: f.subjectIds, ...(f.yearOfStudy ? { yearOfStudy: Number(f.yearOfStudy) } : {}) }), onSuccess: () => { setF({ name: '', programmeId: '', yearOfStudy: '', subjectIds: [] }); done(); } });
  const offered = (programmes.data ?? []).filter((p) => !s.programmeIds?.length || s.programmeIds.map(String).includes(p._id));
  const prog = programmes.data?.find((p) => p._id === f.programmeId);
  return <>{q.isLoading ? <Spinner /> : <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="w-full text-left text-sm"><caption className="sr-only">Subject combinations</caption><thead><tr><th scope="col" className="border-b py-1">Name</th><th scope="col" className="border-b py-1">{S.LEARNING_AREA}</th><th scope="col" className="border-b py-1">Year</th><th scope="col" className="border-b py-1">Subjects</th><th scope="col" className="border-b py-1">Scope</th><th scope="col" className="border-b"><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{q.data?.map((c) => <tr key={c._id} className="border-b last:border-0"><td className="py-1">{c.name}</td><td>{c.programmeId?.name}</td><td>{c.yearOfStudy ?? 'Any'}</td><td>{c.subjectIds.map((x: any) => x.name).join(', ')}</td><td>{c.scope === 'school' ? 'This school' : 'Platform'}</td>
      <td className="whitespace-nowrap text-right">{canEdit && c.scope === 'school' && <span className="space-x-1"><ConfirmButton label="Archive" variant="ghost" ariaLabel={`Archive ${c.name}`} title={`Archive ${c.name}?`} body={<p>It is hidden from new choices. Students who already have it keep it.</p>} onConfirm={() => post(`/api/admin/schools/${s._id}/combinations/${c._id}/archive`, {}).then(done)} />
        <ConfirmButton label="Delete" ariaLabel={`Delete ${c.name}`} title={`Delete ${c.name}?`} body={<p>Deleting is refused while students use this combination; archive it instead.</p>} onConfirm={() => del(`/api/admin/schools/${s._id}/combinations/${c._id}`).then(done)} /></span>}</td></tr>)}
      {!q.data?.length && <tr><td colSpan={6} className="py-2 text-slate-600">No combinations yet.</td></tr>}</tbody></table></div>}
    {canEdit && <form noValidate className="grid gap-3 border-t pt-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Input label="Combination name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <Select label={S.LEARNING_AREA} value={f.programmeId} onChange={(e) => setF({ ...f, programmeId: e.target.value, subjectIds: [] })}><option value="">Choose…</option>{offered.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</Select>
      <Select label="Year of study" value={f.yearOfStudy} onChange={(e) => setF({ ...f, yearOfStudy: e.target.value })}><option value="">Any year</option>{[1, 2, 3].map((y) => <option key={y} value={y}>Year {y}</option>)}</Select>
      {prog && <fieldset className="sm:col-span-3"><legend className="text-sm font-medium">Subjects</legend><div className="flex flex-wrap gap-3">{(subjects.data ?? []).filter((x) => x.levelId === prog.levelId).map((x) => <label key={x._id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.subjectIds.includes(x._id)} onChange={(e) => setF({ ...f, subjectIds: e.target.checked ? [...f.subjectIds, x._id] : f.subjectIds.filter((y) => y !== x._id) })} />{x.name}</label>)}</div></fieldset>}
      <div className="sm:col-span-3"><ErrorBox error={m.error} /><Button type="submit" disabled={!f.name || !f.programmeId || !f.subjectIds.length} loading={m.isPending}>Add combination</Button></div></form>}</>;
}

/** §6 school detail: counts, usage, edit, status, admins, Learning Areas and combinations. */
export function SchoolDetailPage() {
  const { id = '' } = useParams(); const { user } = useAuth(); const qc = useQueryClient();
  const isSuper = user!.roles.includes('super_admin');
  const q = useQuery({ queryKey: ['school', id], queryFn: () => api<any>(`/api/admin/schools/${id}`) });
  const [f, setF] = useState<SchoolForm | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['school', id] }); qc.invalidateQueries({ queryKey: ['/api/admin/schools'] }); qc.invalidateQueries({ queryKey: ['/api/config/schools'] }); };
  const save = useMutation({ mutationFn: () => patch(`/api/admin/schools/${id}`, clean(f!, isSuper ? undefined : S.SCHOOL_ADMIN_EDITABLE)), onSuccess: () => { setF(null); refresh(); } });
  const status = (st: string, reason?: string) => post(`/api/admin/schools/${id}/status`, { status: st, ...(reason ? { reason } : {}) }).then(refresh);
  if (q.isLoading) return <Spinner />; if (q.error) return <AdminPage title="School"><ErrorBox error={q.error} /></AdminPage>;
  const { school: s, counts: c, usage, admins, programmes, links } = q.data;
  const canEdit = S.hasPermission(user!.roles, 'school:manage');
  return <AdminPage title={s.name} description={`${s.code}${s.region ? ` · ${s.region}` : ''}${s.district ? ` · ${s.district}` : ''}`} actions={<div className="flex flex-wrap items-center gap-2"><Badge v={s.status} />{s.isSample && <SampleBadge />}</div>}>
    {s.status !== 'active' && <Alert tone="info">This school is {s.status}. Its members cannot sign in{s.statusReason ? ` (reason: ${s.statusReason})` : ''}.</Alert>}
    <ul aria-label="School figures" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{[['Students', c.students, `/admin/users?role=student&schoolId=${id}`], ['Not onboarded', c.studentsNotOnboarded, `/admin/users?role=student&schoolId=${id}`], ['Teachers', c.teachers, `/admin/users?role=teacher&schoolId=${id}`], ['Admins', c.admins, null], ['Classes', c.classes, links.classes], ['Combinations', q.data.combinations, null]].map(([l, v, to]) =>
      <li key={l as string} className="rounded-xl border bg-white p-3"><p className="text-sm text-slate-600">{l}</p><p className="text-2xl font-bold">{to && S.hasPermission(user!.roles, 'users:manage') ? <Link className="text-brand-800 underline" to={to as string}>{v as number}</Link> : (v as number)}</p></li>)}</ul>
    <Section title="Usage and learning analytics"><Facts items={[['Active learners (30 days)', String(usage.activeLearners30d)], ['Exercises started (30 days)', String(usage.attempts30d)], ['Tutor questions (30 days)', String(usage.tutorQuestions30d)]]} />
      <p className="text-xs text-slate-600">{usage.note}</p>{S.hasPermission(user!.roles, 'analytics:view') && <Link className="text-sm text-brand-700 underline" to={links.analytics}>Open school analytics</Link>}</Section>
    <Section title="Details" actions={canEdit && !f && <Button variant="ghost" className="px-3 py-1 text-sm" onClick={() => setF(fromSchool(s))}>Edit details</Button>}>
      {f ? <form noValidate onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3"><SchoolFields f={f} setF={setF} limited={!isSuper} />{!isSuper && <p className="text-xs text-slate-600">Name and identifier are changed by a super admin.</p>}
        <ErrorBox error={save.error} /><div className="flex gap-2"><Button type="submit" loading={save.isPending}>Save</Button><Button variant="ghost" onClick={() => setF(null)}>Cancel</Button></div></form>
      : <Facts items={[['Identifier', s.code], ['Region', s.region ?? '—'], ['District', s.district ?? '—'], ['Type', s.type ? S.SCHOOL_TYPE_LABELS[s.type as S.SchoolType] : '—'], ['Levels', s.levelKinds.join(', ')],
        [`${S.LEARNING_AREA}s`, programmes.length ? programmes.map((p: any) => p.name).join(', ') : 'Not configured (all are allowed)'],
        ['Contact', [s.contact?.headName, s.contact?.email, s.contact?.phone, s.contact?.address].filter(Boolean).join(' · ') || '—']]} />}</Section>
    {isSuper && <Section title="Status"><p className="text-sm text-slate-600">Suspending or archiving signs every member out at once and blocks sign-in. Archived schools are also hidden from student onboarding. Records are kept.</p>
      <div className="flex flex-wrap gap-2">
        {s.status !== 'active' && <ConfirmButton label={s.status === 'archived' ? 'Restore school' : 'Reactivate school'} tone="primary" variant="primary" className="px-3 py-2 text-sm" title={`Reactivate ${s.name}?`} body={<p>Its {c.students + c.teachers + c.admins} members can sign in again.</p>} onConfirm={() => status('active')} />}
        {s.status === 'active' && <ConfirmButton label="Suspend school" className="px-3 py-2 text-sm" title={`Suspend ${s.name}?`} body={<p>{c.students} students, {c.teachers} teachers and {c.admins} admins lose access at once until it is reactivated.</p>} onConfirm={() => status('suspended')} />}
        {s.status !== 'archived' && <ConfirmButton label="Archive school" className="px-3 py-2 text-sm" typeToConfirm={s.code} title={`Archive ${s.name}?`} body={<p>Members lose access and the school is hidden from onboarding. Nothing is deleted; it can be restored.</p>} onConfirm={() => status('archived')} />}
      </div></Section>}
    <Section title="School admins">{isSuper ? <AdminsCard s={s} admins={admins} onDone={refresh} /> : <ul className="text-sm">{admins.map((a: any) => <li key={a._id}>{a.fullName} ({a.email})</li>)}</ul>}</Section>
    <Section title="Subject combinations"><p className="text-sm text-slate-600">Platform combinations for this school's Learning Areas, plus combinations this school defines (optionally per year of study).</p><Combinations s={s} canEdit={canEdit} /></Section>
    {canEdit && user!.schoolId === s._id && <LeaderboardSettings schoolId={s._id} />}
  </AdminPage>;
}
