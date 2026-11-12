import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { TeacherApplications, usePendingTeacherApps } from './teacherApplications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as S from '@ghlearn/shared';
import { api, post, patch, del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Input, Select, SampleBadge, Spinner } from '../components/ui';
import { ConfirmButton } from '../components/ConfirmDialog';
import { StaffResetActions } from '../components/PasswordReset';
import { usePlatform } from '../lib/platform';
import { DataTable, useUrlState } from './DataTable';
import { AdminPage } from './pages';
import { Badge, ErrorBox, Facts, OneTimeSecret, Section, day, useConfig, when } from './common';

const SCHOOL_GRANTABLE = ['teacher', 'counselor', 'student', 'parent'] as const;
const NEEDS_SCHOOL = ['school_admin', 'teacher', 'counselor'];

function CreateUser({ onClose }: { onClose: () => void }) {
  const { user } = useAuth(); const isSuper = user!.roles.includes('super_admin'); const qc = useQueryClient();
  const schools = useConfig('schools', { enabled: isSuper });
  const roles = isSuper ? S.ROLES : SCHOOL_GRANTABLE;
  const [f, setF] = useState({ fullName: '', email: '', role: 'student', schoolId: '' }); const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ pw: string | null; name: string; id: string; emailed?: boolean; emailFailed?: boolean } | null>(null);
  const m = useMutation({ mutationFn: () => post<any>('/api/admin/users', { fullName: f.fullName, email: f.email, role: f.role, ...(isSuper && f.schoolId && !S.PLATFORM_ROLES.includes(f.role as S.Role) ? { schoolId: f.schoolId } : {}) }),
    onSuccess: (r) => { setMade({ pw: r.temporaryPassword ?? null, name: r.user.fullName, id: r.user._id, emailed: r.delivery === 'email', emailFailed: !!r.emailFailed }); setF({ fullName: '', email: '', role: f.role, schoolId: f.schoolId }); qc.invalidateQueries({ queryKey: ['/api/admin/users'] }); } });
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const r = S.createUserSchema.safeParse({ fullName: f.fullName, email: f.email, role: f.role }); if (!r.success) return setErr(r.error.issues[0].message);
    if (isSuper && NEEDS_SCHOOL.includes(f.role) && !f.schoolId) return setErr('Choose the school for this role');
    m.mutate();
  };
  return <Section title="Add a user" actions={<Button variant="ghost" className="px-3 py-1 text-sm" onClick={onClose}>Close</Button>}>
    {made?.emailed && <Alert tone="success">We emailed {made.name} a link to set their password (valid 72 hours).</Alert>}
    {made?.emailFailed && <Alert>The invitation email could not be sent, so a temporary password is shown below instead.</Alert>}
    {made && <p className="mb-2 text-sm">Created <Link className="text-brand-700 underline" to={`/admin/users/${made.id}`}>Open {made.name}</Link></p>}
    {made?.pw ? <OneTimeSecret value={made.pw} who={made.name} onDone={() => setMade({ ...made, pw: null })} /> :
    <form noValidate onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Input label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
      <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <Select label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{S.ROLE_LABELS[r]}</option>)}</Select>
      {isSuper && !S.PLATFORM_ROLES.includes(f.role as S.Role) && <Select label="School" value={f.schoolId} onChange={(e) => setF({ ...f, schoolId: e.target.value })}><option value="">{NEEDS_SCHOOL.includes(f.role) ? 'Choose…' : 'No school'}</option>{schools.data?.filter((s) => s.status === 'active').map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>}
      <p className="text-xs text-slate-600 sm:col-span-2">When email is set up, the user is emailed a link to choose a password; otherwise a temporary password is shown once and must be changed at first sign-in{isSuper ? '' : '. Accounts are created in your school'}.</p>
      <div className="sm:col-span-2">{(err || m.error) && <Alert>{err ?? m.error!.message}</Alert>}<Button type="submit" loading={m.isPending} className="mt-2">Create user</Button></div>
    </form>}</Section>;
}

/** §7 Users and Permissions: server-paginated, searchable, deep-linkable (?role=student from the Overview). */
export function AdminUsersPage() {
  const qc = useQueryClient(); const { user } = useAuth(); const u = useUrlState(); const [adding, setAdding] = useState(false);
  const isSuper = user!.roles.includes('super_admin'); const schools = useConfig('schools', { enabled: isSuper });
  const m = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => patch(`/api/admin/users/${id}`, { status }), onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/admin/users'] }) });
  const mayChange = (x: any) => x._id !== user!.id && (isSuper || x.roles.every((r: string) => (SCHOOL_GRANTABLE as readonly string[]).includes(r)));
  const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') === 'applications' ? 'applications' : 'users'; const pending = usePendingTeacherApps();
  const tabs = <div role="tablist" aria-label="Users sections" className="mb-4 flex gap-2 border-b">{([['users', 'All users'], ['applications', 'Teacher applications']] as const).map(([k, l]) =>
    <button key={k} role="tab" type="button" aria-selected={tab === k} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600'}`}
      onClick={() => setSp(k === 'users' ? {} : { tab: k }, { replace: true })}>{l}{k === 'applications' && !!pending.data && <span className="ml-2 rounded-full bg-red-700 px-2 py-0.5 text-xs text-white" aria-label={`${pending.data} waiting`}>{pending.data}</span>}</button>)}</div>;
  if (tab === 'applications') return <AdminPage title="Users and permissions" description="Review teacher applications.">{tabs}<TeacherApplications /></AdminPage>;
  return <AdminPage title="Users and permissions" description="Search, filter and manage accounts. Role changes follow the grant rules and sign the user out everywhere."
    actions={!adding && <Button onClick={() => setAdding(true)}>Add user</Button>}>
    {tabs}
    {adding && <CreateUser onClose={() => setAdding(false)} />}
    <DataTable path="/api/admin/users" caption="Users" searchLabel="Search name or email" defaultSort="-createdAt" filterKeys={['role', 'status', 'schoolId']}
      toolbar={<><div className="w-48"><Select label="Role" value={u.get('role')} onChange={(e) => u.set({ role: e.target.value || undefined })}><option value="">All roles</option>{S.ROLES.map((r) => <option key={r} value={r}>{S.ROLE_LABELS[r]}</option>)}</Select></div>
        {isSuper && <div className="w-56"><Select label="School" value={u.get('schoolId')} onChange={(e) => u.set({ schoolId: e.target.value || undefined })}><option value="">All schools</option>{schools.data?.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select></div>}
        <div className="w-40"><Select label="Status" value={u.get('status')} onChange={(e) => u.set({ status: e.target.value || undefined })}><option value="">Any</option><option value="active">Active</option><option value="suspended">Suspended</option></Select></div></>}
      columns={[
        { key: 'fullName', header: 'Name', sortable: true, render: (x: any) => <><Link className="text-brand-700 underline" to={`/admin/users/${x._id}`}>{x.fullName}</Link> {x.isSample && <SampleBadge />}</> },
        { key: 'email', header: 'Email', sortable: true },
        { key: 'phone', header: 'Phone', render: (x: any) => (x.phoneMasked ? <span className="whitespace-nowrap"><span className="font-mono">{x.phoneMasked}</span> <span className="text-xs text-slate-600">{x.phoneVerified ? 'verified' : 'not verified'}</span></span> : '') },
        { key: 'roles', header: 'Roles', render: (x: any) => x.roles.map((r: S.Role) => S.ROLE_LABELS[r]).join(', ') },
        { key: 'school', header: 'School', render: (x: any) => x.schoolName ?? '' },
        { key: 'status', header: 'Status', sortable: true, render: (x: any) => <Badge v={x.status} /> },
        { key: 'lastLoginAt', header: 'Last sign-in', sortable: true, render: (x: any) => (x.lastLoginAt ? day(x.lastLoginAt) : 'never') },
        { key: 'createdAt', header: 'Created', sortable: true, render: (x: any) => day(x.createdAt) },
        { key: 'actions', header: 'Actions', className: 'whitespace-nowrap text-right', render: (x: any) => mayChange(x) && (x.status === 'active'
          ? <ConfirmButton label="Suspend" ariaLabel={`Suspend ${x.fullName}`} title={`Suspend ${x.fullName}?`} body={<p>They are signed out everywhere and cannot sign in until reactivated.</p>} onConfirm={() => m.mutateAsync({ id: x._id, status: 'suspended' })} />
          : <ConfirmButton label="Reactivate" tone="primary" ariaLabel={`Reactivate ${x.fullName}`} title={`Reactivate ${x.fullName}?`} body={<p>They will be able to sign in again.</p>} onConfirm={() => m.mutateAsync({ id: x._id, status: 'active' })} />) },
      ]} />
  </AdminPage>;
}

function EditDetails({ u, onDone }: { u: any; onDone: () => void }) {
  const [f, setF] = useState({ fullName: u.fullName, email: u.email });
  const m = useMutation({ mutationFn: () => patch(`/api/admin/users/${u._id}`, f), onSuccess: onDone });
  const dirty = f.fullName !== u.fullName || f.email !== u.email;
  return <form noValidate onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="grid gap-3 sm:grid-cols-2">
    <Input label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
    <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
    <div className="sm:col-span-2"><ErrorBox error={m.error} />{m.isSuccess && !dirty && <Alert tone="success">Saved.</Alert>}<Button type="submit" disabled={!dirty} loading={m.isPending} className="mt-1">Save details</Button></div></form>;
}
function RolesEditor({ u, onDone }: { u: any; onDone: () => void }) {
  const { user } = useAuth(); const isSuper = user!.roles.includes('super_admin'); const self = u._id === user!.id;
  const grantable = isSuper ? S.ROLES : SCHOOL_GRANTABLE; const [roles, setRoles] = useState<string[]>(u.roles);
  const m = useMutation({ mutationFn: () => patch(`/api/admin/users/${u._id}`, { roles }), onSuccess: onDone });
  const locked = roles.filter((r) => !(grantable as readonly string[]).includes(r));
  return <fieldset disabled={self} className="space-y-2"><legend className="sr-only">Roles</legend>
    {self && <p className="text-sm text-slate-600">You cannot change your own roles.</p>}
    {locked.length > 0 && <p className="text-xs text-slate-600">Only a super admin can change: {locked.map((r) => S.ROLE_LABELS[r as S.Role]).join(', ')}</p>}
    <div className="flex flex-wrap gap-3">{grantable.map((r) => <label key={r} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />{S.ROLE_LABELS[r]}</label>)}</div>
    <ConfirmButton label="Save roles" tone="primary" variant="primary" className="px-3 py-1 text-sm" disabled={!roles.length || JSON.stringify([...roles].sort()) === JSON.stringify([...u.roles].sort())}
      title="Change roles?" body={<p>New roles: {roles.map((r) => S.ROLE_LABELS[r as S.Role]).join(', ')}. The user is signed out everywhere and must sign in again.</p>} onConfirm={() => m.mutateAsync()} />
    <ErrorBox error={m.error} /></fieldset>;
}
function TeacherAssignments({ u, schoolId }: { u: any; schoolId?: string }) {
  const qc = useQueryClient(); const subjects = useConfig('subjects'); const [as, setAs] = useState({ subjectId: '', classGroup: '' });
  const q = useQuery({ queryKey: ['assignments', u._id], queryFn: () => api<{ items: any[] }>('/api/admin/teacher-assignments').then((r) => r.items.filter((a) => (a.teacherId?._id ?? a.teacherId) === u._id && (!schoolId || String(a.schoolId) === schoolId))) });
  const done = () => { qc.invalidateQueries({ queryKey: ['assignments', u._id] }); qc.invalidateQueries({ queryKey: ['user', u._id] }); };
  const am = useMutation({ mutationFn: () => post('/api/admin/teacher-assignments', { teacherId: u._id, subjectId: as.subjectId, ...(as.classGroup ? { classGroup: as.classGroup } : {}) }), onSuccess: done });
  const ad = useMutation({ mutationFn: (id: string) => del(`/api/admin/teacher-assignments/${id}`), onSuccess: done });
  return <div className="space-y-2"><h3 className="text-sm font-semibold">Subjects taught</h3>
    <ul className="text-sm">{q.data?.map((a) => <li key={a._id} className="flex items-center gap-2">{a.subjectId?.name} {a.classGroup && `· ${a.classGroup}`}
      <ConfirmButton label="Remove" variant="ghost" ariaLabel={`Remove ${a.subjectId?.name}`} title="Remove this teaching assignment?" body={<p>{u.fullName} will no longer be assigned to {a.subjectId?.name}.</p>} onConfirm={() => ad.mutateAsync(a._id)} /></li>)}
      {!q.data?.length && <li className="text-slate-600">None</li>}</ul>
    <div className="grid gap-2 sm:grid-cols-3"><Select label="Subject" value={as.subjectId} onChange={(e) => setAs({ ...as, subjectId: e.target.value })}><option value="">Choose…</option>{subjects.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
      <Input label="Class label (optional)" value={as.classGroup} onChange={(e) => setAs({ ...as, classGroup: e.target.value })} /><div className="flex items-end"><Button disabled={!as.subjectId} loading={am.isPending} onClick={() => am.mutate()}>Assign subject</Button></div></div><ErrorBox error={am.error} /></div>;
}
function StudentSubjects({ u, profile }: { u: any; profile: any }) {
  const qc = useQueryClient(); const subjects = useConfig('subjects');
  const [subs, setSubs] = useState<string[] | null>(null);
  const cur = subs ?? (profile.subjectIds ?? []).map((s: any) => s._id ?? s);
  const m = useMutation({ mutationFn: () => patch(`/api/admin/students/${u._id}/subjects`, { subjectIds: cur }), onSuccess: () => { setSubs(null); qc.invalidateQueries({ queryKey: ['user', u._id] }); } });
  const levelId = profile.levelId?._id ?? profile.levelId;
  return <fieldset className="space-y-2"><legend className="text-sm font-semibold">Subjects</legend>
    <div className="flex flex-wrap gap-3">{(subjects.data ?? []).filter((s) => s.levelId === levelId).map((s) => <label key={s._id} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={cur.includes(s._id)} onChange={(e) => setSubs(e.target.checked ? [...cur, s._id] : cur.filter((x: string) => x !== s._id))} />{s.name}</label>)}</div>
    <Button className="px-3 py-1 text-sm" disabled={!subs} loading={m.isPending} onClick={() => m.mutate()}>Save subjects</Button><ErrorBox error={m.error} />{m.isSuccess && <Alert tone="success">Subjects updated.</Alert>}</fieldset>;
}
function Sessions({ u, canManage }: { u: any; canManage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sessions', u._id], queryFn: () => api<{ items: any[] }>(`/api/admin/users/${u._id}/sessions`).then((r) => r.items), enabled: canManage });
  const done = () => qc.invalidateQueries({ queryKey: ['sessions', u._id] });
  if (!canManage) return <p className="text-sm text-slate-600">You cannot manage this account's sessions.</p>;
  return <div className="space-y-2">{q.isLoading ? <Spinner /> : !q.data?.length ? <p className="text-sm text-slate-600">No active sessions.</p> :
    <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="w-full text-left text-sm"><caption className="sr-only">Active sessions</caption><thead><tr><th scope="col" className="border-b py-1">Signed in</th><th scope="col" className="border-b py-1">Last active</th><th scope="col" className="border-b py-1">Device</th><th scope="col" className="border-b py-1">IP address</th><th scope="col" className="border-b py-1"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{q.data.map((s) => <tr key={s.id} className="border-b last:border-0"><td className="py-1">{when(s.startedAt)}</td><td>{when(s.lastUsedAt)}</td><td className="max-w-xs truncate" title={s.userAgent ?? ''}>{s.userAgent ?? 'Unknown'}</td><td>{s.ip ?? '—'}</td>
        <td className="text-right"><ConfirmButton label="Revoke" ariaLabel={`Revoke session from ${when(s.startedAt)}`} title="Revoke this session?" body={<p>That device is signed out at once.</p>} onConfirm={() => del(`/api/admin/users/${u._id}/sessions/${s.id}`).then(done)} /></td></tr>)}</tbody></table></div>}
    {!!q.data?.length && <ConfirmButton label="Sign out everywhere" className="px-3 py-1 text-sm" title={`Sign ${u.fullName} out everywhere?`} body={<p>Every session ends at once. Their password is unchanged.</p>} onConfirm={() => post(`/api/admin/users/${u._id}/sessions/revoke-all`, {}).then(done)} />}
  </div>;
}
function Recovery({ u, onDone }: { u: any; onDone: () => void }) {
  const p = usePlatform();
  const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
  return <div className="space-y-2">
    <StaffResetActions who={u.fullName} linkUrl={`/api/admin/users/${u._id}/reset-link`} tempUrl={`/api/admin/users/${u._id}/reset-password`} onDone={onDone} />
    {p.passwordReset?.email && u.mustChangePassword && !u.passwordChangedAt && u.status === 'active' && <ConfirmButton label="Resend invite" tone="primary" variant="ghost" className="px-3 py-1 text-sm" title={`Email ${u.fullName} a new set-password link?`}
      body={<p>A new link (valid 72 hours) is emailed to {u.email}. Any earlier link stops working.</p>} confirmLabel="Send link" onConfirm={() => post(`/api/admin/users/${u._id}/resend-invite`, {}).then(onDone)} />}
    {locked && <ConfirmButton label="Unlock account" tone="primary" variant="ghost" className="px-3 py-1 text-sm" title="Unlock this account?" body={<p>Clears the lockout after repeated failed sign-ins.</p>} onConfirm={() => post(`/api/admin/users/${u._id}/unlock`, {}).then(onDone)} />}
    <p className="text-xs text-slate-600">{p.passwordReset?.email ? 'Users can also reset their own password by email from the sign-in page.' : 'Self-service reset by email is not available because no email provider is configured. Use a reset link or code, handed over in person.'}</p></div>;
}
function MoveSchool({ u, onDone }: { u: any; onDone: () => void }) {
  const schools = useConfig('schools'); const [to, setTo] = useState('');
  const name = schools.data?.find((s) => s._id === to)?.name;
  return <div className="flex flex-wrap items-end gap-2"><div className="w-64"><Select label="Move to another school" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{schools.data?.filter((s) => s._id !== String(u.schoolId ?? '') && s.status === 'active').map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select></div>
    <ConfirmButton label="Move" className="px-3 py-2 text-sm" disabled={!to} title={`Move ${u.fullName} to ${name}?`} body={<p>They leave every class at their current school, their school role grants move with them and they are signed out.</p>}
      onConfirm={() => post(`/api/admin/users/${u._id}/transfer-school`, { schoolId: to }).then(onDone)} /></div>;
}
function AuditHistory({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['user-audit', id, page], queryFn: () => api<any>(`/api/admin/users/${id}/audit?page=${page}&pageSize=10`) });
  if (q.isLoading) return <Spinner />; if (q.error) return <ErrorBox error={q.error} />;
  return <div className="space-y-2"><div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="w-full text-left text-sm"><caption className="sr-only">Audit history</caption><thead><tr><th scope="col" className="border-b py-1">When</th><th scope="col" className="border-b py-1">Action</th><th scope="col" className="border-b py-1">By</th><th scope="col" className="border-b py-1">Outcome</th></tr></thead>
    <tbody>{q.data.items.map((a: any) => <tr key={a._id} className="border-b last:border-0"><td className="py-1">{when(a.createdAt)}</td><td><code>{a.action}</code></td><td>{a.actorId?.fullName ?? '—'}</td><td>{a.outcome}</td></tr>)}
      {!q.data.items.length && <tr><td colSpan={4} className="py-2 text-slate-600">No recorded actions.</td></tr>}</tbody></table></div>
    {q.data.pages > 1 && <nav aria-label="Audit history pages" className="flex items-center gap-2 text-sm"><Button variant="ghost" className="px-2 py-1" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {q.data.pages}</span><Button variant="ghost" className="px-2 py-1" disabled={page >= q.data.pages} onClick={() => setPage(page + 1)}>Next</Button></nav>}</div>;
}

/** §7 user detail: details, roles, school, per-role information, security (recovery, sessions) and audit history. */
export function UserDetailPage() {
  const { id = '' } = useParams(); const { user: me } = useAuth(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['user', id], queryFn: () => api<any>(`/api/admin/users/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['user', id] }); qc.invalidateQueries({ queryKey: ['/api/admin/users'] }); };
  if (q.isLoading) return <Spinner />; if (q.error) return <AdminPage title="User"><ErrorBox error={q.error} /></AdminPage>;
  const { user: u, school, assignments, student, teacher, canManage } = q.data;
  const isSuper = me!.roles.includes('super_admin'); const self = u._id === me!.id;
  const p = student?.profile; const a = student?.activity;
  return <AdminPage title={u.fullName} description={u.email} actions={<div className="flex flex-wrap gap-2"><Badge v={u.status} />{u.mustChangePassword && <Badge v="pending" label="must change password" />}{u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge v="suspended" label="locked" />}{u.isSample && <SampleBadge />}</div>}>
    <Section title="Account"><Facts items={[['Roles', u.roles.map((r: S.Role) => S.ROLE_LABELS[r]).join(', ')], ['School', school ? <>{school.name} ({school.code}){school.status !== 'active' && <> <Badge v={school.status} /></>}</> : 'None'],
      ['Created', `${when(u.createdAt)}${u.createdBy?.fullName ? ` by ${u.createdBy.fullName}` : ''}`], ['Last sign-in', u.lastLoginAt ? when(u.lastLoginAt) : 'never'], ['Password changed', when(u.passwordChangedAt)],
      ['Role grants', assignments.map((x: any) => `${S.ROLE_LABELS[x.role as S.Role]} (${x.scopeType === 'platform' ? 'platform' : x.scopeId?.name ?? 'no school'})`).join(', ') || '—'],
      ['Active sessions', String(q.data.sessions.active)],
      ['Phone', u.phone ? <>{u.phone} <Badge v={u.phoneVerified ? 'active' : 'pending'} label={u.phoneVerified ? 'verified' : 'not verified'} />
        {isSuper && u.phoneVerified && <span className="ml-2"><ConfirmButton label="Clear verification" ariaLabel={`Clear phone verification for ${u.fullName}`} title="Clear this phone verification?"
          body={<p>The number stays on the account but is no longer verified, so it cannot be used to sign in or reset the password until the user verifies it again. The user is told and the change is audited.</p>}
          onConfirm={() => post(`/api/admin/users/${u._id}/phone/clear-verification`, {}).then(refresh)} /></span>}</> : 'None']]} />
      {canManage && <EditDetails key={u.email + u.fullName} u={u} onDone={refresh} />}</Section>
    {S.hasPermission(me!.roles, 'roles:assign') && <Section title="Roles"><RolesEditor key={u.roles.join()} u={u} onDone={refresh} /></Section>}
    {student && <Section title="Student">{p ? <><Facts items={[['Level', p.levelId?.name ?? '—'], [S.LEARNING_AREA, p.programmeId?.name ?? '—'], ['Year of study', String(p.yearOfStudy)], ['Combination', p.combinationId?.name ?? '—'],
      ['Region', p.region ?? '—'], ['School (as typed)', `${p.schoolName ?? '—'}${p.schoolId ? '' : ' (not linked)'}`],
      ['Classes', student.classes.length ? student.classes.map((c: any) => <span key={c._id} className="mr-2"><Link className="text-brand-700 underline" to={`/admin/classes/${c._id}`}>{c.name}</Link>{c.archived ? ' (archived)' : ''}</span>) : 'None'],
      ['Activity (30 days)', `${a.attempts30d} exercises started, ${a.completed30d} completed, ${a.tutorQuestions30d} tutor questions`], ['All time', `${a.attempts} exercises · ${a.xp} XP (level ${a.level}) · last activity ${a.lastActivityAt ? day(a.lastActivityAt) : 'none'}`]]} />
      {canManage && <StudentSubjects key={JSON.stringify(p.subjectIds)} u={u} profile={p} />}</> : <p className="text-sm text-slate-600">Not onboarded yet: the student chooses level and subjects at first sign-in.</p>}</Section>}
    {teacher && <Section title="Teacher"><Facts items={[['Classes', teacher.classes.length ? teacher.classes.map((c: any) => <span key={c._id} className="mr-2"><Link className="text-brand-700 underline" to={`/admin/classes/${c._id}`}>{c.name}</Link> ({c.subject ?? 'general'}, {c.students} students){c.archived ? ' archived' : ''}</span>) : 'None']]} />
      {canManage && <TeacherAssignments u={u} schoolId={u.schoolId} />}</Section>}
    {(canManage || self) && <Section title="Security and recovery">
      <Facts items={[['Failed sign-ins', String(u.failedLogins ?? 0)], ['Locked until', u.lockedUntil && new Date(u.lockedUntil) > new Date() ? when(u.lockedUntil) : 'Not locked']]} />
      {canManage && <Recovery u={u} onDone={refresh} />}
      <h3 className="pt-2 text-sm font-semibold">Active sessions</h3><Sessions u={u} canManage={canManage} />
      {isSuper && canManage && u.roles.every((r: string) => ['student', 'teacher', 'counselor', 'parent'].includes(r)) && <MoveSchool u={u} onDone={refresh} />}</Section>}
    {S.hasPermission(me!.roles, 'audit:view') && <Section title="Audit history"><AuditHistory id={u._id} /></Section>}
  </AdminPage>;
}
