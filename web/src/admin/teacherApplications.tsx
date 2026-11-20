import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { GHANA_REGIONS, TEACHING_LEVELS } from '@ghlearn/shared';
import { api, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Input, Select, Spinner } from '../components/ui';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Badge, ErrorBox, Facts, Section, when } from './common';

type App = { _id: string; fullName: string; email: string; phone: string | null; region: string; schoolId: { _id: string; name: string; code: string } | null; schoolName?: string;
  subjectIds: { _id: string; name: string }[]; levels: string[]; staffId?: string; ntcNumber?: string; note?: string; status: 'pending' | 'approved' | 'rejected'; createdAt: string;
  reviewedBy?: { fullName: string } | null; reviewedAt?: string; rejectReason?: string; userId?: string; invitesSent?: number; lastInviteAt?: string; passwordSetAt?: string };
type Options = { subjects: { id: string; name: string; level: string }[]; schools: { id: string; name: string; region: string | null }[] };

export const usePendingTeacherApps = (enabled = true) => useQuery({ queryKey: ['teacher-apps-count'], enabled, refetchInterval: 120_000,
  queryFn: () => api<{ pending: number }>('/api/admin/teacher-applications/count').then((r) => r.pending) });

/** Admin → Users → Teacher applications: review queue (school admins: own school; super admins: all). */
export function TeacherApplications() {
  const [sp, setSp] = useSearchParams(); const status = sp.get('status') ?? 'pending';
  const q = useQuery({ queryKey: ['teacher-apps', status], queryFn: () => api<{ items: App[] }>(`/api/admin/teacher-applications?status=${status}`).then((r) => r.items) });
  const [open, setOpen] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  return <Section title="Teacher applications" actions={<div className="w-44"><Select label="Show" value={status} onChange={(e) => { sp.set('status', e.target.value); setSp(sp, { replace: true }); }}>
    <option value="pending">Waiting for review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All</option></Select></div>}>
    {notice && <div className="mb-3"><Alert tone="success">{notice}</Alert></div>}
    <p className="mb-3 text-sm text-slate-600">Teachers apply at /register/teacher without a password. Approving creates the teacher account in the school with their subjects and emails a link to choose a password (valid 72 hours).</p>
    {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : !q.data!.length ? <p className="text-sm">No applications here.</p> :
      <ul className="space-y-3">{q.data!.map((a) => <li key={a._id} className="rounded-lg border border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="font-semibold">{a.fullName} <Badge v={a.status} /></p>
            <p className="text-sm text-slate-600">{a.email} · {a.schoolId?.name ?? <span>{a.schoolName} <Badge v="not_listed" label="school not on GH Learn" /></span>} · {a.region} · applied {when(a.createdAt)}</p></div>
          <Button variant="ghost" className="px-3 py-1 text-sm" aria-expanded={open === a._id} onClick={() => setOpen(open === a._id ? null : a._id)}>{open === a._id ? 'Close' : a.status === 'pending' ? 'Review' : 'Details'}</Button>
        </div>
        {open === a._id && <Review app={a} onDone={() => setOpen(null)} onResult={(m) => { setNotice(m); setOpen(null); }} />}
      </li>)}</ul>}
  </Section>;
}

function Review({ app, onDone, onResult }: { app: App; onDone: () => void; onResult: (msg: string) => void }) {
  const { user } = useAuth(); const isSuper = user!.roles.includes('super_admin'); const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['teacher-app', app._id], queryFn: () => api<{ item: App; accountExists: boolean; suggestedSchool: { _id: string; name: string } | null; canCreateSchool: boolean }>(`/api/admin/teacher-applications/${app._id}`) });
  const opts = useQuery({ queryKey: ['teacher-apply-options'], queryFn: () => api<Options>('/api/public/teacher-applications/options') });
  // Reviewer's school list (the public form hides seeded sample schools; reviewers must still be able to pick them).
  const revSchools = useQuery({ queryKey: ['teacher-review-schools'], queryFn: () => api<{ items: { id: string; name: string; region: string | null }[] }>('/api/admin/teacher-applications/schools').then((r) => r.items) });
  const [schoolId, setSchoolId] = useState(app.schoolId?._id ?? (isSuper ? '' : user!.schoolId ?? ''));
  const [subjects, setSubjects] = useState(app.subjectIds.map((s) => s._id)); const [levels, setLevels] = useState<string[]>(app.levels);
  const [reason, setReason] = useState(''); const [msg, setMsg] = useState<string | null>(null);
  const [newSchool, setNewSchool] = useState<{ name: string; code: string; region: string } | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['teacher-apps'] }); qc.invalidateQueries({ queryKey: ['teacher-apps-count'] }); qc.invalidateQueries({ queryKey: ['teacher-app', app._id] }); };
  const inviteText = (i: { email: string; sms?: string }) => (i.email === 'sent' ? `A set-password link was emailed to ${app.email}${i.sms === 'sent' ? ' and an SMS was sent' : ''}.` : i.email === 'not_configured' ? 'Email is not configured, so no link was sent. Use a reset link from the user page.' : 'The email could not be sent. Try "Resend invite" later, or use a reset link from the user page.');
  const approve = useMutation({ mutationFn: () => post<{ userId: string; invite: { email: string; sms?: string } }>(`/api/admin/teacher-applications/${app._id}/approve`, { schoolId, subjectIds: subjects, levels }),
    onSuccess: (r) => { onResult(`Approved ${app.fullName}. ${inviteText(r.invite)}`); refresh(); } });
  const reject = useMutation({ mutationFn: () => post(`/api/admin/teacher-applications/${app._id}/reject`, { reason }), onSuccess: () => { onResult(`Rejected ${app.fullName}'s application. The applicant was emailed the reason.`); refresh(); } });
  const resend = useMutation({ mutationFn: () => post<{ invite: { email: string } }>(`/api/admin/teacher-applications/${app._id}/resend`, {}), onSuccess: (r) => { setMsg(inviteText(r.invite)); refresh(); } });
  const create = useMutation({ mutationFn: () => post<{ school: { _id: string } }>('/api/admin/schools', { name: newSchool!.name, code: newSchool!.code, region: newSchool!.region || undefined, levelKinds: [...new Set(levels.map((l) => l.split(' ')[0]))] }),
    onSuccess: (r) => { setSchoolId(r.school._id); setNewSchool(null); qc.invalidateQueries({ queryKey: ['teacher-apply-options'] }); qc.invalidateQueries({ queryKey: ['teacher-review-schools'] }); } });
  const d = detail.data; const a = d?.item ?? app;
  const toggle = (list: string[], v: string, put: (x: string[]) => void) => put(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  if (detail.isLoading || opts.isLoading || revSchools.isLoading) return <Spinner />;
  return <div className="mt-3 space-y-3 border-t pt-3">
    {msg && <Alert tone="success">{msg}</Alert>}
    <Facts items={[['Email', a.email], ['Phone', a.phone ?? '—'], ['Region', a.region], ['School given', a.schoolId?.name ?? `${a.schoolName ?? '—'} (not on GH Learn)`],
      ['Subjects', a.subjectIds.map((s) => s.name).join(', ')], ['Forms', a.levels.join(', ')], ['Staff ID', a.staffId ?? '—'], ['NTC licence', a.ntcNumber ?? '—'], ['Note', a.note ?? '—'],
      ...(a.status !== 'pending' ? [['Reviewed', `${a.reviewedBy?.fullName ?? '—'}, ${when(a.reviewedAt)}`] as [string, string]] : []),
      ...(a.rejectReason ? [['Reason', a.rejectReason] as [string, string]] : []),
      ...(a.status === 'approved' ? [['Password', a.passwordSetAt ? `Set ${when(a.passwordSetAt)}` : `Not set yet (${a.invitesSent ?? 0} invite${a.invitesSent === 1 ? '' : 's'} sent, last ${when(a.lastInviteAt)})`] as [string, string]] : [])]} />
    {d?.accountExists && a.status === 'pending' && <Alert>An account with this email already exists. Reject this application, or change that account's role from the user list.</Alert>}
    {a.status === 'pending' && <>
      <div className="grid gap-3 sm:grid-cols-2">
        {isSuper ? <Select label="School" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}><option value="">Choose…</option>{(revSchools.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.region ? ` (${s.region})` : ''}</option>)}</Select>
          : <p className="text-sm"><span className="font-medium">School:</span> your school</p>}
        {isSuper && !a.schoolId && <div className="text-sm">{d?.suggestedSchool && <p>Possible match: <button type="button" className="text-brand-700 underline" onClick={() => setSchoolId(d.suggestedSchool!._id)}>{d.suggestedSchool.name}</button></p>}
          {!newSchool && <Button variant="ghost" className="mt-1 px-3 py-1 text-sm" onClick={() => setNewSchool({ name: a.schoolName ?? '', code: '', region: a.region })}>Create this school</Button>}</div>}
      </div>
      {newSchool && <fieldset className="grid gap-2 rounded-lg border border-slate-300 p-3 sm:grid-cols-3"><legend className="px-1 text-sm font-medium">New school (super admin; audited)</legend>
        <Input label="Name" value={newSchool.name} onChange={(e) => setNewSchool({ ...newSchool, name: e.target.value })} />
        <Input label="Identifier code" hint="Letters, digits and hyphens, e.g. BHC-01" value={newSchool.code} onChange={(e) => setNewSchool({ ...newSchool, code: e.target.value })} />
        <Select label="Region" value={newSchool.region} onChange={(e) => setNewSchool({ ...newSchool, region: e.target.value })}><option value="">—</option>{GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}</Select>
        <div className="flex gap-2 sm:col-span-3"><Button loading={create.isPending} onClick={() => create.mutate()}>Create school</Button><Button variant="ghost" onClick={() => setNewSchool(null)}>Cancel</Button></div>
        <div className="sm:col-span-3"><ErrorBox error={create.error} /></div></fieldset>}
      <fieldset className="rounded-lg border border-slate-300 p-3"><legend className="px-1 text-sm font-medium">Subjects to assign</legend>
        <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">{opts.data!.subjects.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={subjects.includes(s.id)} onChange={() => toggle(subjects, s.id, setSubjects)} />{s.name} <span className="text-xs text-slate-500">{s.level}</span></label>)}</div></fieldset>
      <fieldset className="rounded-lg border border-slate-300 p-3"><legend className="px-1 text-sm font-medium">Forms</legend>
        <div className="grid grid-cols-3 gap-1">{TEACHING_LEVELS.map((l) => <label key={l} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={levels.includes(l)} onChange={() => toggle(levels, l, setLevels)} />{l}</label>)}</div></fieldset>
      <ErrorBox error={approve.error ?? reject.error} />
      <div className="flex flex-wrap items-end gap-3">
        <ConfirmButton label="Approve" tone="primary" variant="primary" className="px-4 py-2" disabled={!schoolId || !subjects.length || !levels.length} title={`Approve ${a.fullName}?`}
          body={<p>This creates a teacher account for {a.email} in the chosen school with {subjects.length} subject{subjects.length === 1 ? '' : 's'}, and emails a link to set a password.</p>}
          confirmLabel="Approve and send invite" onConfirm={() => approve.mutateAsync()} />
        <div className="min-w-64 flex-1"><Input label="Reason for rejecting (sent to the applicant)" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <ConfirmButton label="Reject" disabled={reason.trim().length < 5} title={`Reject ${a.fullName}'s application?`} body={<p>We will email the applicant: “{reason}”.</p>} confirmLabel="Reject and email" onConfirm={() => reject.mutateAsync()} />
      </div></>}
    {a.status === 'approved' && !a.passwordSetAt && <div><Button variant="ghost" loading={resend.isPending} onClick={() => resend.mutate()}>Resend invite</Button> <span className="text-xs text-slate-600">A new link replaces the old one.</span><ErrorBox error={resend.error} /></div>}
    <Button variant="ghost" className="px-3 py-1 text-sm" onClick={onDone}>Close</Button>
  </div>;
}
