import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import * as S from '@ghlearn/shared';
import { api, post, patch, del, download } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Input, Select, SampleBadge, Spinner } from '../components/ui';
import { ConfirmButton } from '../components/ConfirmDialog';
import { DataTable, useUrlState } from './DataTable';
import { AdminPage } from './pages';
import { Badge, ErrorBox, Facts, Section, day, downloadCsv, useConfig, when } from './common';

const useIsSuper = () => { const { user } = useAuth(); return S.hasPermission(user!.roles, 'platform:manage'); };
function SchoolPicker({ value, onChange, label = 'School', any }: { value: string; onChange: (v: string) => void; label?: string; any?: boolean }) {
  const schools = useConfig('schools');
  return <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}><option value="">{any ? 'All schools' : 'Choose…'}</option>{schools.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>;
}
const qsOf = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();

function ClassForm({ initial, onDone, submitLabel, schoolId }: { initial?: any; onDone: (c: any) => void; submitLabel: string; schoolId?: string }) {
  const years = useConfig('academic-years'); const subjects = useConfig('subjects'); const programmes = useConfig('programmes');
  const [f, setF] = useState({ name: initial?.name ?? '', academicYearId: String(initial?.academicYearId?._id ?? initial?.academicYearId ?? ''), yearOfStudy: initial?.yearOfStudy ? String(initial.yearOfStudy) : '',
    subjectId: String(initial?.subjectId?._id ?? initial?.subjectId ?? ''), programmeId: String(initial?.programmeId?._id ?? initial?.programmeId ?? '') });
  const body = () => ({ name: f.name.trim(), academicYearId: f.academicYearId || null, yearOfStudy: f.yearOfStudy ? Number(f.yearOfStudy) : null, subjectId: f.subjectId || null, programmeId: f.programmeId || null, ...(initial ? {} : { schoolId: schoolId || undefined }) });
  const m = useMutation({ mutationFn: () => (initial ? patch<any>(`/api/admin/classes/${initial._id}`, body()) : post<any>('/api/admin/classes', body())), onSuccess: (r) => onDone(r) });
  const cur = years.data?.find((y) => y.current);
  return <form noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
    <Input label="Class name" hint="For example 2 Science A" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
    <Select label="Academic year" value={f.academicYearId} onChange={(e) => setF({ ...f, academicYearId: e.target.value })}><option value="">{cur ? 'None' : 'None'}</option>{years.data?.map((y) => <option key={y._id} value={y._id}>{y.label}{y.current ? ' (current)' : ''}</option>)}</Select>
    <Select label="Year of study" value={f.yearOfStudy} onChange={(e) => setF({ ...f, yearOfStudy: e.target.value })}><option value="">Not set</option>{[1, 2, 3, 4, 5, 6].map((y) => <option key={y} value={y}>Year {y}</option>)}</Select>
    <Select label={S.LEARNING_AREA} value={f.programmeId} onChange={(e) => setF({ ...f, programmeId: e.target.value })}><option value="">Not set</option>{programmes.data?.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</Select>
    <Select label="Subject (subject classes only)" value={f.subjectId} disabled={!!initial?.studentCount} onChange={(e) => setF({ ...f, subjectId: e.target.value })}><option value="">None: a form class</option>{subjects.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
    <div className="sm:col-span-2">{initial?.studentCount ? <p className="text-xs text-slate-600">The subject cannot change while students are enrolled.</p> : null}<ErrorBox error={m.error} /><Button type="submit" loading={m.isPending} className="mt-2">{submitLabel}</Button></div></form>;
}

function Rollover({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const qc = useQueryClient(); const years = useConfig('academic-years'); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const run = (dryRun: boolean) => post<any>('/api/admin/classes/rollover', { schoolId: schoolId || undefined, fromAcademicYearId: from, toAcademicYearId: to, dryRun });
  const preview = useMutation({ mutationFn: () => run(true) }); const [done, setDone] = useState<any>(null);
  const p = done ?? preview.data;
  return <Section title="Change academic year" actions={<Button variant="ghost" className="px-3 py-1 text-sm" onClick={onClose}>Close</Button>}>
    <p className="text-sm text-slate-600">Every active class of the source year is copied into the target year with its teachers and students and moved up one year of study; the old class is archived. Final-year classes are archived as graduating. Nothing changes until you apply the preview.</p>
    <div className="grid gap-3 sm:grid-cols-3"><Select label="From" value={from} onChange={(e) => { setFrom(e.target.value); preview.reset(); setDone(null); }}><option value="">Choose…</option>{years.data?.map((y) => <option key={y._id} value={y._id}>{y.label}</option>)}</Select>
      <Select label="To" value={to} onChange={(e) => { setTo(e.target.value); preview.reset(); setDone(null); }}><option value="">Choose…</option>{years.data?.map((y) => <option key={y._id} value={y._id}>{y.label}</option>)}</Select>
      <div className="flex items-end"><Button disabled={!from || !to} loading={preview.isPending} onClick={() => { setDone(null); preview.mutate(); }}>Preview</Button></div></div>
    <ErrorBox error={preview.error} />
    {p && <div className="space-y-2"><p className="text-sm"><strong>{p.dryRun ? 'Preview' : 'Applied'}: {p.from} → {p.to}.</strong> {p.summary.promote} promoted, {p.summary.graduate} graduating ({p.summary.graduatingStudents} students), {p.summary.skip} skipped{p.dryRun ? '' : `; ${p.summary.created} classes created, ${p.summary.promotedProfiles} student profiles moved up`}.</p>
      <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="w-full text-left text-sm"><caption className="sr-only">Academic year change plan</caption><thead><tr><th scope="col" className="border-b py-1">Class</th><th scope="col" className="border-b py-1">Students</th><th scope="col" className="border-b py-1">Action</th><th scope="col" className="border-b py-1">Becomes</th></tr></thead>
        <tbody>{p.plan.map((r: any) => <tr key={r.classId} className="border-b last:border-0"><td className="py-1">{r.name}</td><td>{r.students}</td><td><Badge v={r.action === 'skip' ? 'pending' : 'active'} label={r.action} /></td><td>{r.newName ? `${r.newName}${r.newYearOfStudy ? ` (Year ${r.newYearOfStudy})` : ''}` : r.reason ?? '—'}</td></tr>)}
          {!p.plan.length && <tr><td colSpan={4} className="py-2 text-slate-600">No active classes in the source year.</td></tr>}</tbody></table></div>
      {p.dryRun && p.plan.some((r: any) => r.action !== 'skip') && <ConfirmButton label="Apply academic year change" tone="primary" variant="primary" className="px-4 py-2" title={`Move classes from ${p.from} to ${p.to}?`}
        body={<p>{p.summary.promote} classes are copied into {p.to} and {p.summary.promote + p.summary.graduate} old classes are archived. Student years of study move up by one. Archived classes can be restored, but promoted years are not reversed automatically.</p>}
        onConfirm={() => run(false).then((r) => { setDone(r); qc.invalidateQueries({ queryKey: ['/api/admin/classes'] }); })} />}</div>}
  </Section>;
}

/** §15 Classes and Enrolments. */
export function ClassesPage() {
  const isSuper = useIsSuper(); const u = useUrlState(); const nav = useNavigate(); const qc = useQueryClient();
  const [panel, setPanel] = useState<'' | 'add' | 'rollover'>(''); const years = useConfig('academic-years'); const [schoolForNew, setSchoolForNew] = useState('');
  const [exportErr, setExportErr] = useState<string | null>(null);
  const filters = { schoolId: u.get('schoolId') || undefined, academicYearId: u.get('academicYearId') || undefined, yearOfStudy: u.get('yearOfStudy') || undefined, archived: u.get('archived') || undefined, q: u.get('q') || undefined };
  const needSchool = isSuper && !schoolForNew && !u.get('schoolId');
  return <AdminPage title="Classes and enrolments" description="Form and subject classes, their teachers and students. Import enrolments from CSV, export them, and move classes into a new academic year."
    actions={<div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => { setExportErr(null); download(`/api/admin/classes/export.csv?${qsOf(filters)}`, 'enrolments.csv').catch((e) => setExportErr(e.message)); }}><Download className="h-4 w-4" aria-hidden />Export enrolments</Button>
      <Link to="/admin/classes/import" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium"><Upload className="h-4 w-4" aria-hidden />Import enrolments</Link>
      <Button variant="ghost" onClick={() => setPanel(panel === 'rollover' ? '' : 'rollover')}>Change academic year</Button><Button onClick={() => setPanel(panel === 'add' ? '' : 'add')}>Add class</Button></div>}>
    {exportErr && <Alert>{exportErr}</Alert>}
    {panel && isSuper && <div className="max-w-sm"><SchoolPicker value={schoolForNew || u.get('schoolId')} onChange={setSchoolForNew} label="School for this action" /></div>}
    {panel === 'add' && (needSchool ? <Alert tone="info">Choose a school first.</Alert> : <Section title="Add a class" actions={<Button variant="ghost" className="px-3 py-1 text-sm" onClick={() => setPanel('')}>Close</Button>}>
      <ClassForm schoolId={schoolForNew || u.get('schoolId')} submitLabel="Add class" onDone={(r) => { qc.invalidateQueries({ queryKey: ['/api/admin/classes'] }); nav(`/admin/classes/${r.class._id}`); }} /></Section>)}
    {panel === 'rollover' && (needSchool ? <Alert tone="info">Choose a school first.</Alert> : <Rollover schoolId={schoolForNew || u.get('schoolId')} onClose={() => setPanel('')} />)}
    <DataTable path="/api/admin/classes" caption="Classes" searchLabel="Search class name" defaultSort="name" filterKeys={['schoolId', 'academicYearId', 'yearOfStudy', 'archived']}
      toolbar={<>{isSuper && <div className="w-56"><SchoolPicker any value={u.get('schoolId')} onChange={(v) => u.set({ schoolId: v || undefined })} /></div>}
        <div className="w-40"><Select label="Academic year" value={u.get('academicYearId')} onChange={(e) => u.set({ academicYearId: e.target.value || undefined })}><option value="">Any</option>{years.data?.map((y) => <option key={y._id} value={y._id}>{y.label}</option>)}</Select></div>
        <div className="w-32"><Select label="Year" value={u.get('yearOfStudy')} onChange={(e) => u.set({ yearOfStudy: e.target.value || undefined })}><option value="">Any</option>{[1, 2, 3, 4, 5, 6].map((y) => <option key={y} value={y}>Year {y}</option>)}</Select></div>
        <div className="w-36"><Select label="Status" value={u.get('archived')} onChange={(e) => u.set({ archived: e.target.value || undefined })}><option value="">Active</option><option value="true">Archived</option><option value="all">All</option></Select></div></>}
      columns={[
        { key: 'name', header: 'Class', sortable: true, render: (c: any) => <><Link className="text-brand-700 underline" to={`/admin/classes/${c._id}`}>{c.name}</Link> {c.archived && <Badge v="archived" />} {c.isSample && <SampleBadge />}</> },
        ...(isSuper ? [{ key: 'school', header: 'School', render: (c: any) => c.schoolId?.name ?? '—' }] : []),
        { key: 'academicYear', header: 'Academic year', render: (c: any) => c.academicYearId?.label ?? '—' },
        { key: 'yearOfStudy', header: 'Year', sortable: true, render: (c: any) => (c.yearOfStudy ? `Year ${c.yearOfStudy}` : '—') },
        { key: 'subject', header: 'Subject', render: (c: any) => c.subjectId?.name ?? 'Form class' },
        { key: 'teachers', header: 'Teachers', render: (c: any) => c.teacherIds?.map((t: any) => t.fullName).join(', ') || '—' },
        { key: 'studentCount', header: 'Students' },
      ]} />
  </AdminPage>;
}

function StudentPicker({ classId, onPick }: { classId: string; onPick: (ids: string[]) => Promise<unknown> }) {
  const [q, setQ] = useState(''); const [sel, setSel] = useState<string[]>([]); const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const c = useQuery({ queryKey: ['candidates', classId, q], queryFn: () => api<{ items: any[]; note: string }>(`/api/admin/classes/${classId}/candidates?q=${encodeURIComponent(q)}`) });
  return <div className="space-y-2"><div className="max-w-sm"><Input label="Find students to enrol" value={q} onChange={(e) => setQ(e.target.value)} /></div><p className="text-xs text-slate-600">{c.data?.note}</p>
    {c.isLoading ? <Spinner /> : <ul className="max-h-60 divide-y overflow-y-auto rounded border" aria-label="Students who can be enrolled">{c.data?.items.map((s) => <li key={s._id} className="p-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={sel.includes(s._id)} onChange={(e) => setSel(e.target.checked ? [...sel, s._id] : sel.filter((x) => x !== s._id))} />{s.fullName} <span className="text-slate-600">{s.email}</span></label></li>)}
      {!c.data?.items.length && <li className="p-2 text-sm text-slate-600">No matching students.</li>}</ul>}
    {err && <Alert>{err}</Alert>}{msg && <Alert tone="success">{msg}</Alert>}
    <Button disabled={!sel.length} onClick={() => { setErr(null); onPick(sel).then((r: any) => { setMsg(`${r.added} enrolled${r.alreadyEnrolled ? `, ${r.alreadyEnrolled} already in the class` : ''}.`); setSel([]); c.refetch(); }, (e) => setErr(e.message)); }}>Enrol {sel.length || ''} selected</Button></div>;
}

export function ClassDetailPage() {
  const { id } = useParams(); const qc = useQueryClient(); const nav = useNavigate(); const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<string[]>([]); const [target, setTarget] = useState(''); const [teacher, setTeacher] = useState(''); const [info, setInfo] = useState<string | null>(null);
  const key = ['/api/admin/classes', id]; const q = useQuery({ queryKey: key, queryFn: () => api<any>(`/api/admin/classes/${id}`) });
  const c = q.data?.class; const sid = c ? String(c.schoolId?._id ?? c.schoolId) : '';
  const others = useQuery({ queryKey: ['/api/admin/classes', 'siblings', sid], enabled: !!sid, queryFn: () => api<any>(`/api/admin/classes?schoolId=${sid}&pageSize=100`).then((r) => r.items) });
  const teachers = useQuery({ queryKey: ['/api/admin/users', 'teachers', sid], enabled: !!sid, queryFn: () => api<any>(`/api/admin/users?role=teacher&status=active&schoolId=${sid}&pageSize=100`).then((r) => r.items) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['/api/admin/classes'] }); };
  const addTeacher = useMutation({ mutationFn: () => post<any>(`/api/admin/classes/${id}/teachers`, { teacherId: teacher }), onSuccess: (r) => { setTeacher(''); setInfo(r.assignmentsCreated ? 'Teacher added. A teaching assignment for the class subject was also created.' : 'Teacher added.'); refresh(); } });
  if (q.isLoading) return <Spinner />; if (q.error) return <AdminPage title="Class"><ErrorBox error={q.error} /></AdminPage>;
  const students: any[] = q.data.students;
  return <AdminPage title={c.name} description={`${c.schoolId?.name ?? ''}${c.academicYearId ? ` · ${c.academicYearId.label}` : ''}`}
    actions={<div className="flex flex-wrap gap-2">{c.archived ? <ConfirmButton label="Restore class" tone="primary" variant="primary" className="px-4 py-2" title={`Restore ${c.name}?`} body={<p>The class becomes active again.</p>} onConfirm={() => patch(`/api/admin/classes/${id}`, { archived: false }).then(refresh)} />
      : <><Button variant="ghost" onClick={() => setEditing(!editing)} aria-expanded={editing}>Edit</Button><ConfirmButton label="Archive class" variant="ghost" className="px-4 py-2" title={`Archive ${c.name}?`} body={<p>The class is hidden from teachers and lists. Students stay enrolled and records are kept. You can restore it.</p>} onConfirm={() => patch(`/api/admin/classes/${id}`, { archived: true }).then(refresh)} /></>}
      <ConfirmButton label="Delete class" className="px-4 py-2" title={`Delete ${c.name}?`} typeToConfirm={c.name} body={<p>This cannot be undone. Deleting is refused while students are enrolled or assessments exist; archive the class instead.</p>} onConfirm={() => del(`/api/admin/classes/${id}`).then(() => { refresh(); nav('/admin/classes'); })} /></div>}>
    {c.archived && <Alert tone="info">This class is archived. Restore it to make changes.</Alert>}
    <Section title="Details"><Facts items={[['School', c.schoolId?.name ?? '—'], ['Academic year', c.academicYearId?.label ?? '—'], ['Year of study', c.yearOfStudy ? `Year ${c.yearOfStudy}` : '—'], [S.LEARNING_AREA, c.programmeId?.name ?? '—'], ['Subject', c.subjectId?.name ?? 'Form class'], ['Students', String(c.studentCount)], ['Assessments', String(q.data.assessments)], ['Created', day(c.createdAt)]]} />
      {editing && !c.archived && <div className="mt-4 border-t pt-4"><ClassForm initial={c} submitLabel="Save changes" onDone={() => { setEditing(false); refresh(); }} /></div>}</Section>
    <Section title="Teachers">{info && <Alert tone="success">{info}</Alert>}
      <ul className="divide-y">{c.teacherIds.map((t: any) => <li key={t._id} className="flex items-center justify-between py-2 text-sm"><span><Link className="text-brand-700 underline" to={`/admin/users/${t._id}`}>{t.fullName}</Link> <span className="text-slate-600">{t.email}</span></span>
        {!c.archived && <ConfirmButton label="Remove" variant="ghost" ariaLabel={`Remove teacher ${t.fullName}`} title={`Remove ${t.fullName} from ${c.name}?`} body={<p>Their teaching assignment for the subject is kept; remove it on the user's page if needed.</p>} onConfirm={() => del(`/api/admin/classes/${id}/teachers/${t._id}`).then(refresh)} />}</li>)}
        {!c.teacherIds.length && <li className="py-2 text-sm text-slate-600">No teachers yet.</li>}</ul>
      {!c.archived && <div className="flex flex-wrap items-end gap-2"><div className="w-72"><Select label="Add a teacher" value={teacher} onChange={(e) => setTeacher(e.target.value)}><option value="">Choose…</option>{teachers.data?.filter((t: any) => !c.teacherIds.some((x: any) => x._id === t._id)).map((t: any) => <option key={t._id} value={t._id}>{t.fullName}</option>)}</Select></div>
        <Button disabled={!teacher} loading={addTeacher.isPending} onClick={() => { setInfo(null); addTeacher.mutate(); }}>Add teacher</Button><ErrorBox error={addTeacher.error} /></div>}</Section>
    <Section title={`Students (${students.length})`} actions={<Button variant="ghost" className="px-3 py-1 text-sm" disabled={!students.length} onClick={() => downloadCsv(`${c.name}-students.csv`, ['Name', 'Email', 'Status', 'Year', S.LEARNING_AREA, 'Onboarded'], students.map((s) => [s.fullName, s.email, s.status, s.yearOfStudy, s.learningArea, s.onboarded ? 'yes' : 'no']))}>Download list</Button>}>
      <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="w-full text-left text-sm"><caption className="sr-only">Enrolled students</caption><thead><tr><th className="border-b py-1"><span className="sr-only">Select</span></th><th scope="col" className="border-b py-1">Name</th><th scope="col" className="border-b py-1">Email</th><th scope="col" className="border-b py-1">Year</th><th scope="col" className="border-b py-1">Status</th><th className="border-b"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{students.map((s) => <tr key={s._id} className="border-b last:border-0"><td className="py-1"><input type="checkbox" aria-label={`Select ${s.fullName}`} checked={sel.includes(s._id)} onChange={(e) => setSel(e.target.checked ? [...sel, s._id] : sel.filter((x) => x !== s._id))} /></td>
          <td><Link className="text-brand-700 underline" to={`/admin/users/${s._id}`}>{s.fullName}</Link>{!s.onboarded && <span className="ml-1 text-xs text-slate-600">(not onboarded)</span>}{s.takesSubject === false && <span className="ml-1 text-xs text-amber-800">(no longer takes the subject)</span>}</td><td>{s.email}</td><td>{s.yearOfStudy ?? '—'}</td><td><Badge v={s.status} /></td>
          <td className="text-right">{!c.archived && <ConfirmButton label="Remove" variant="ghost" ariaLabel={`Remove ${s.fullName} from the class`} title={`Remove ${s.fullName} from ${c.name}?`} body={<p>Their account, profile and results are kept.</p>} onConfirm={() => del(`/api/admin/classes/${id}/students/${s._id}`).then(refresh)} />}</td></tr>)}
          {!students.length && <tr><td colSpan={6} className="py-2 text-slate-600">No students enrolled.</td></tr>}</tbody></table></div>
      {!c.archived && sel.length > 0 && <div className="flex flex-wrap items-end gap-2 rounded border bg-slate-50 p-3"><div className="w-72"><Select label={`Transfer ${sel.length} selected to`} value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose a class…</option>{others.data?.filter((o: any) => o._id !== id).map((o: any) => <option key={o._id} value={o._id}>{o.name}{o.academicYearId ? ` (${o.academicYearId.label})` : ''}</option>)}</Select></div>
        <ConfirmButton label="Transfer" tone="primary" variant="primary" className="px-4 py-2" disabled={!target} title={`Transfer ${sel.length} student(s)?`} body={<p>They are enrolled in the target class first, then removed from {c.name}. Students already in the target are not duplicated.</p>}
          onConfirm={() => post<any>(`/api/admin/classes/${id}/transfer`, { userIds: sel, toClassId: target }).then((r) => { setInfo(`${r.moved} moved${r.alreadyInTarget ? ` (${r.alreadyInTarget} were already in the target)` : ''}.`); setSel([]); setTarget(''); refresh(); })} /></div>}
      {!c.archived && <div className="border-t pt-3"><StudentPicker classId={id!} onPick={(ids) => post(`/api/admin/classes/${id}/students`, { userIds: ids }).then((r) => { refresh(); return r; })} /></div>}
    </Section>
  </AdminPage>;
}

const ACTION_LABEL: Record<string, string> = { enrol: 'Enrol', create_and_enrol: 'Create account and enrol', skip: 'Skip (already enrolled)', error: 'Error' };
function BatchView({ batch, onChange }: { batch: any; onChange: (b: any) => void }) {
  const [skipErrors, setSkipErrors] = useState(false); const [creds, setCreds] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const s = batch.summary ?? {}; const rows: any[] = batch.rows ?? [];
  const refetch = () => api<any>(`/api/admin/imports/${batch._id}`).then((r) => onChange(r.batch));
  return <div className="space-y-3">
    <Section title={`Import ${batch.filename ?? ''}`.trim()} actions={<Badge v={batch.status === 'committed' ? 'active' : batch.status === 'preview' ? 'pending' : 'inactive'} label={batch.status.replace('_', ' ')} />}>
      <p className="text-sm">{s.rows} rows: <strong>{s.enrol}</strong> to enrol, <strong>{s.createAndEnrol}</strong> new student accounts ({s.newStudents} people), <strong>{s.skip}</strong> already enrolled, <strong className={s.errors ? 'text-red-700' : ''}>{s.errors}</strong> with errors, {s.warnings} warnings.{s.newClasses?.length ? ` New classes: ${s.newClasses.join(', ')}.` : ''}</p>
      <p className="text-xs text-slate-600">Existing accounts and classes are never changed: rows that would change a name, school or class are reported as errors instead.</p>
      {err && <Alert>{err}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        {(s.errors > 0 || s.warnings > 0) && <Button variant="ghost" onClick={() => download(`/api/admin/imports/${batch._id}/errors.csv`, 'import-report.csv').catch((e) => setErr(e.message))}><Download className="h-4 w-4" aria-hidden />Download error report</Button>}
        {batch.status === 'preview' && <>{s.errors > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />Import only the valid rows</label>}
          <ConfirmButton label="Commit import" tone="primary" variant="primary" className="px-4 py-2" disabled={(s.errors > 0 && !skipErrors) || !(s.enrol + s.createAndEnrol)} title="Commit this import?"
            body={<p>{s.enrol + s.createAndEnrol} enrolments{s.newStudents ? `, ${s.newStudents} new student accounts` : ''}{s.newClasses?.length ? `, ${s.newClasses.length} new classes` : ''}. The rows are checked again against current records first. You can roll it back afterwards.</p>}
            onConfirm={() => post<any>(`/api/admin/imports/${batch._id}/commit`, { skipErrors }).then((r) => { setCreds(r.credentials); onChange(r.batch); }, async (e) => { if (e.code === 'PREVIEW_STALE') await refetch(); throw e; })} />
          <ConfirmButton label="Cancel import" variant="ghost" title="Cancel this preview?" body={<p>Nothing has been imported. The preview is discarded.</p>} onConfirm={() => post<any>(`/api/admin/imports/${batch._id}/cancel`, {}).then((r) => onChange(r.batch))} /></>}
        {['committed', 'failed'].includes(batch.status) && <ConfirmButton label="Roll back import" className="px-4 py-2" title="Roll back this import?" body={<p>Enrolments it added are removed. Student accounts and classes it created are deleted unless they have been used since (signed in, enrolled elsewhere, assessments); those are kept and listed in the report.</p>}
          onConfirm={() => post<any>(`/api/admin/imports/${batch._id}/rollback`, {}).then((r) => onChange(r.batch))} />}
      </div>
      {batch.rollbackReport && <Alert tone="info">Rolled back: {Object.entries(batch.rollbackReport).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${Array.isArray(v) ? v.length : String(v)}`).join(', ')}.</Alert>}
      {batch.error && <Alert>{batch.error}</Alert>}
    </Section>
    {creds && creds.length > 0 && <div role="status" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p><strong>{creds.length} new student accounts.</strong> Their temporary passwords are shown only now and are not stored. Download the list, give each student their password securely, and delete the file afterwards. Students must change the password when they first sign in.</p>
      <div className="flex gap-2"><Button onClick={() => downloadCsv('new-student-credentials.csv', ['Full name', 'Email', 'Temporary password'], creds.map((c) => [c.fullName, c.email, c.temporaryPassword]))}>Download credentials CSV</Button><Button variant="ghost" onClick={() => setCreds(null)}>Done, hide them</Button></div></div>}
    {rows.length > 0 && <Section title="Rows"><div className="relative max-h-[32rem] overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Import rows</caption><thead className="sticky top-0 bg-white"><tr>{['Line', 'Email', 'Name', 'Class', 'Result', 'Notes'].map((h) => <th key={h} scope="col" className="border-b py-1">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r.line} className={`border-b align-top last:border-0 ${r.action === 'error' ? 'bg-red-50' : ''}`}><td className="py-1">{r.line}</td><td>{r.email}</td><td>{r.fullName}</td><td>{r.className}{r.createsClass ? ' (new)' : ''}</td><td>{ACTION_LABEL[r.action] ?? r.action}</td>
        <td>{[...(r.errors ?? []).map((e: string) => <span key={e} className="block text-red-800">{e}</span>), ...(r.warnings ?? []).map((w: string) => <span key={w} className="block text-amber-800">{w}</span>)]}</td></tr>)}</tbody></table></div></Section>}
  </div>;
}

export function ImportPage() {
  const isSuper = useIsSuper(); const qc = useQueryClient();
  const [csv, setCsv] = useState(''); const [filename, setFilename] = useState<string | undefined>(); const [schoolId, setSchoolId] = useState('');
  const [opts, setOpts] = useState({ createMissingStudents: false, createMissingClasses: false }); const [batch, setBatch] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const preview = useMutation({ mutationFn: () => post<any>('/api/admin/imports/enrolments', { csv, filename, schoolId: schoolId || undefined, ...opts }), onSuccess: (r) => { setBatch(r.batch); qc.invalidateQueries({ queryKey: ['/api/admin/imports'] }); } });
  const open = (id: string) => api<any>(`/api/admin/imports/${id}`).then((r) => setBatch(r.batch), (e) => setErr(e.message));
  return <AdminPage title="Import enrolments" description="Enrol students into classes from a CSV file. You see a full preview with duplicates and errors before anything is saved.">
    <Section title="1. Prepare the file" actions={<Button variant="ghost" className="px-3 py-1 text-sm" onClick={() => download('/api/admin/imports/enrolments/template.csv', 'enrolment-template.csv').catch((e) => setErr(e.message))}><Download className="h-4 w-4" aria-hidden />Download template</Button>}>
      <p className="text-sm">Columns: <code>{S.ENROLMENT_COLUMNS.join(', ')}</code>. Required: {S.ENROLMENT_REQUIRED.join(', ')}. One row per student per class; the academic year (for example 2026/2027) picks the class when names repeat across years.</p>
      {err && <Alert>{err}</Alert>}</Section>
    <Section title="2. Upload and preview">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setBatch(null); preview.mutate(); }}>
        {isSuper && <div className="max-w-sm"><SchoolPicker value={schoolId} onChange={setSchoolId} /></div>}
        <label className="block text-sm"><span className="mb-1 block font-medium">CSV file</span><input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 1_000_000) { setErr('The file is larger than 1 MB; split it into smaller files.'); return; } setErr(null); setFilename(f.name); setCsv(await f.text()); }} /></label>
        <label className="block text-sm"><span className="mb-1 block font-medium">Or paste CSV</span><textarea className="h-32 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs" value={csv} onChange={(e) => { setCsv(e.target.value); setFilename(undefined); }} /></label>
        <fieldset className="space-y-1 text-sm"><legend className="font-medium">Options</legend>
          <label className="flex items-center gap-2"><input type="checkbox" checked={opts.createMissingStudents} onChange={(e) => setOpts({ ...opts, createMissingStudents: e.target.checked })} />Create accounts for students who do not exist yet (they get a temporary password and finish onboarding at first sign-in)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={opts.createMissingClasses} onChange={(e) => setOpts({ ...opts, createMissingClasses: e.target.checked })} />Create form classes that do not exist yet</label></fieldset>
        <ErrorBox error={preview.error} /><Button type="submit" loading={preview.isPending} disabled={!csv.trim() || (isSuper && !schoolId)}>Preview import</Button></form></Section>
    {batch && <BatchView batch={batch} onChange={(b) => { setBatch(b); qc.invalidateQueries({ queryKey: ['/api/admin/imports'] }); qc.invalidateQueries({ queryKey: ['/api/admin/classes'] }); }} />}
    <Section title="Import history"><DataTable path="/api/admin/imports" caption="Enrolment imports" searchLabel="" defaultSort="-createdAt"
      columns={[{ key: 'createdAt', header: 'Started', sortable: true, render: (b: any) => when(b.createdAt) }, { key: 'filename', header: 'File', render: (b: any) => b.filename ?? 'Pasted CSV' },
        ...(isSuper ? [{ key: 'school', header: 'School', render: (b: any) => b.schoolId?.name ?? '—' }] : []), { key: 'by', header: 'By', render: (b: any) => b.createdBy?.fullName ?? '—' },
        { key: 'rows', header: 'Rows', render: (b: any) => `${b.summary?.rows ?? 0} (${b.summary?.errors ?? 0} errors)` }, { key: 'status', header: 'Status', render: (b: any) => <Badge v={b.status === 'committed' ? 'active' : 'pending'} label={b.status.replace('_', ' ')} /> },
        { key: 'open', header: 'Open', render: (b: any) => <Button variant="ghost" className="px-2 py-1 text-xs" aria-label={`Open import from ${when(b.createdAt)}`} onClick={() => open(b._id)}>Open</Button> }]} /></Section>
  </AdminPage>;
}
