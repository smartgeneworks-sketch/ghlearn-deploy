import { StaffResetActions } from '../components/PasswordReset';
import { usePlatform } from '../lib/platform';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, post, patch, download } from '../lib/api';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { BarChart } from '../components/Charts';
import { Download, Users, AlertTriangle } from 'lucide-react';

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

/** Teacher workspace home: classes and offline packs. */
export function TeachHome() {
  const qc = useQueryClient(); const offlineOn = usePlatform().offline.bundleEnabled;
  const classes = useQuery({ queryKey: ['classes'], queryFn: () => api<{ items: any[] }>('/api/teacher/classes').then((r) => r.items) });
  const subs = useQuery({ queryKey: ['teacher-subjects'], queryFn: () => api<{ items: any[] }>('/api/teacher/subjects').then((r) => r.items) });
  const [f, setF] = useState({ name: '', subjectId: '', yearOfStudy: '' });
  const create = useMutation({ mutationFn: () => post<any>('/api/teacher/classes', { name: f.name, subjectId: f.subjectId || undefined, yearOfStudy: f.yearOfStudy ? Number(f.yearOfStudy) : undefined }),
    onSuccess: () => { setF({ name: '', subjectId: '', yearOfStudy: '' }); qc.invalidateQueries({ queryKey: ['classes'] }); } });
  const [dl, setDl] = useState<string | null>(null);
  const subjects = [...new Map((subs.data ?? []).filter((t) => t.subjectId).map((t) => [t.subjectId._id, t.subjectId])).values()];
  return <section className="space-y-4"><h1 className="text-2xl font-bold">Teaching</h1>
    <Card><h2 className="mb-2 font-semibold">Your classes</h2>
      {classes.isLoading ? <Spinner /> : classes.data?.length ? <ul className="divide-y">{classes.data.map((c) => <li key={c._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <Link className="font-medium text-brand-700 underline" to={`/teach/classes/${c._id}`}>{c.name}</Link>
        <span className="text-sm text-slate-600"><Users className="mr-1 inline h-4 w-4" aria-hidden />{c.studentCount} students · {c.subjectId?.name ?? 'All subjects'}{c.yearOfStudy ? ` · Year ${c.yearOfStudy}` : ''}</span></li>)}</ul>
        : <p className="text-sm">No classes yet. Create one below, then add students.</p>}</Card>
    <Card><h2 className="mb-2 font-semibold">New class</h2><div className="grid gap-3 sm:grid-cols-3">
      <Input label="Class name" placeholder="e.g. 1 Science A" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <Select label="Subject" value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })}><option value="">Choose…</option>{subjects.map((s: any) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
      <Select label="Year" value={f.yearOfStudy} onChange={(e) => setF({ ...f, yearOfStudy: e.target.value })}><option value="">Any</option>{[1, 2, 3].map((y) => <option key={y} value={y}>Year {y}</option>)}</Select></div>
      {create.error && <Alert>{create.error.message}</Alert>}
      <Button className="mt-2" disabled={f.name.trim().length < 2} loading={create.isPending} onClick={() => create.mutate()}>Create class</Button></Card>
    {offlineOn && <Card><h2 className="mb-1 font-semibold">Offline packs</h2><p className="mb-2 text-sm text-slate-600">One HTML file with every approved, published lesson for a subject. Opens in any browser without internet; share it by USB or print it.</p>
      <div className="flex flex-wrap gap-2">{subjects.map((s: any) => <Button key={s._id} variant="ghost" loading={dl === s._id} onClick={() => { setDl(s._id); download(`/api/offline/${s._id}`, `${s.name}.html`).finally(() => setDl(null)); }}><Download className="h-4 w-4" aria-hidden />{s.name}</Button>)}</div>
      {!subjects.length && <p className="text-sm">You have no assigned subjects yet. Ask your school admin.</p>}</Card>}
  </section>;
}

const TABS = ['Students', 'Needs support', 'Misconceptions', 'Topics', 'Assignments', 'Members'] as const;
export function ClassPage() {
  const { id } = useParams(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['class', id], queryFn: () => api<any>(`/api/teacher/classes/${id}`) });
  const [tab, setTab] = useState<(typeof TABS)[number]>('Students'); const [err, setErr] = useState('');
  const remedial = useMutation({ mutationFn: (topic: string) => post<any>(`/api/teacher/classes/${id}/remedial`, { topic }), onSuccess: () => qc.invalidateQueries({ queryKey: ['class', id] }) });
  if (q.isLoading) return <Spinner />; if (q.error) return <Alert>{q.error.message}</Alert>;
  const o = q.data; const c = o.class;
  const exp = (fmt: string) => download(`/api/teacher/classes/${id}/report.${fmt}`, `report.${fmt}`).catch((e) => setErr(e.message));
  return <section className="space-y-4"><Link to="/teach" className="text-sm text-brand-700 underline">← Classes</Link>
    <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-bold">{c.name} <span className="text-base font-normal text-slate-600">{c.subjectId?.name}{c.yearOfStudy ? ` · Year ${c.yearOfStudy}` : ''}</span></h1>
      <div className="flex gap-2"><Button variant="ghost" onClick={() => exp('csv')}><Download className="h-4 w-4" aria-hidden />CSV</Button><Button variant="ghost" onClick={() => exp('pdf')}><Download className="h-4 w-4" aria-hidden />PDF report</Button></div></div>
    {err && <Alert>{err}</Alert>}
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">{[['Students', o.summary.students], ['Average mastery', o.summary.avgMastery == null ? '—' : `${o.summary.avgMastery}%`], ['Needing support', o.summary.needingSupport], ['Attempts', o.summary.attempts], ['To mark', o.summary.pendingReview]].map(([k, v]) =>
      <Card key={k as string} className="p-3"><dt className="text-xs text-slate-500">{k}</dt><dd className="text-xl font-bold">{v}</dd></Card>)}</dl>
    <div role="tablist" aria-label="Class views" className="flex flex-wrap gap-1 border-b">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-t px-3 py-1.5 text-sm ${tab === t ? 'border-b-2 border-brand-700 font-semibold' : 'text-slate-600'}`}>{t}{t === 'Needs support' && o.support.length ? ` (${o.support.length})` : ''}</button>)}</div>
    <div role="tabpanel">
      {tab === 'Students' && <Card><table className="w-full text-sm"><thead><tr className="border-b text-left"><th>Student</th><th>Mastery</th><th>Recent</th><th>Assignments</th><th>Weak topics</th><th>Last active</th></tr></thead><tbody>
        {o.students.map((s: any) => <tr key={s.userId} className="border-b"><td className="py-1"><Link className="text-brand-700 underline" to={`/teach/classes/${id}/students/${s.userId}`}>{s.name}</Link>{s.needsSupport && <AlertTriangle className="ml-1 inline h-4 w-4 text-amber-600" aria-label="needs support" />}</td>
          <td>{s.overall ?? '—'}{s.overall != null && '%'}</td><td>{s.recentPct ?? '—'}{s.recentPct != null && '%'}</td><td>{s.completed}{s.missed.length ? <span className="text-red-700"> ({s.missed.length} overdue)</span> : ''}</td><td>{s.weakTopics.map((w: any) => `${w.topic} ${w.pct}%`).join(', ')}</td><td>{fmtDate(s.lastActive)}</td></tr>)}</tbody></table>
        {!o.students.length && <p className="text-sm">No students yet — add them under Members.</p>}</Card>}
      {tab === 'Needs support' && <Card>{o.support.length ? <ul className="space-y-2">{o.support.map((s: any) => <li key={s.userId}><Link className="font-medium text-brand-700 underline" to={`/teach/classes/${id}/students/${s.userId}`}>{s.name}</Link><ul className="ml-5 list-disc text-sm">{s.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>
        {s.weakTopics.length > 0 && <p className="text-sm">Suggested: revise {s.weakTopics.slice(0, 2).map((w: any) => w.topic).join(' and ')} with a remedial assignment.</p>}</li>)}</ul> : <p className="text-sm">No one flagged right now.</p>}
        <p className="mt-3 text-xs text-slate-500">{o.method}</p></Card>}
      {tab === 'Misconceptions' && <Card>{o.misconceptions.length ? <ol className="space-y-3">{o.misconceptions.map((m: any) => <li key={m.questionId} className="rounded border p-3">
        <p className="text-sm font-semibold">{m.wrongPct}% wrong ({m.wrong}/{m.responses}) · {m.topic}</p><p>{m.stem}</p>
        {m.commonWrongAnswers.length > 0 && <p className="text-sm text-red-800">Common wrong answers: {m.commonWrongAnswers.map((a: any) => `“${a.answer}” ×${a.count}`).join(', ')}</p>}
        {m.correctAnswer && <p className="text-sm text-emerald-800">Correct: {m.correctAnswer}</p>}{m.explanation && <p className="text-sm text-slate-600">{m.explanation}</p>}</li>)}</ol> : <p className="text-sm">No common misconceptions yet (needs 2+ responses per question with 40%+ wrong).</p>}</Card>}
      {tab === 'Topics' && <Card>{o.topics.length ? <BarChart label="Class mastery by topic" data={o.topics.map((t: any) => ({ label: t.topic, value: t.avgPct }))} /> : <p className="text-sm">No topic data yet.</p>}
        <h3 className="mt-4 font-semibold">Remedial recommendations</h3>{o.remedial.length ? <ul className="divide-y text-sm">{o.remedial.map((r: any) => <li key={r.topic} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span><strong>{r.topic}</strong> — {r.students} student(s) below 60% ({r.names.join(', ')}). {r.suggestion}.</span>
          <Button variant="ghost" loading={remedial.isPending && remedial.variables === r.topic} onClick={() => remedial.mutate(r.topic)}>Set remedial practice</Button></li>)}</ul> : <p className="text-sm">No topic below 60%.</p>}
        {remedial.error && <Alert>{remedial.error.message}</Alert>}{remedial.isSuccess && <Alert tone="success">Remedial assignment set and students notified.</Alert>}</Card>}
      {tab === 'Assignments' && <Card><p className="mb-2 text-sm"><Link className="text-brand-700 underline" to={`/teach/assess?classId=${id}`}>Set new work for this class</Link></p>
        <table className="w-full text-sm"><thead><tr className="border-b text-left"><th>Title</th><th>Due</th><th>Submitted</th><th>Average</th><th>To mark</th></tr></thead><tbody>{o.assignments.map((a: any) => <tr key={a._id} className="border-b">
          <td className="py-1"><Link className="text-brand-700 underline" to={`/teach/assessments/${a._id}`}>{a.title}</Link>{!a.classId && <span className="text-xs text-slate-500"> (whole year)</span>}</td><td className={a.overdue ? 'text-red-700' : ''}>{fmtDate(a.closesAt)}</td><td>{a.submitted}/{a.outOf}</td><td>{a.avgPct ?? '—'}{a.avgPct != null && '%'}</td><td>{a.pendingReview || ''}</td></tr>)}</tbody></table></Card>}
      {tab === 'Members' && <Members id={id!} cls={c} />}
    </div>
  </section>;
}
function Members({ id, cls }: { id: string; cls: any }) {
  const qc = useQueryClient();
  const cand = useQuery({ queryKey: ['candidates', id], queryFn: () => api<{ items: any[] }>(`/api/teacher/classes/${id}/candidates`).then((r) => r.items) });
  const members = useQuery({ queryKey: ['class', id], queryFn: () => api<any>(`/api/teacher/classes/${id}`) });
  const [pick, setPick] = useState<string[]>([]);
  const m = useMutation({ mutationFn: (b: any) => patch(`/api/teacher/classes/${id}`, b), onSuccess: () => { setPick([]); qc.invalidateQueries({ queryKey: ['class', id] }); qc.invalidateQueries({ queryKey: ['candidates', id] }); } });
  return <Card><h3 className="font-semibold">In this class</h3><ul className="mb-3 divide-y text-sm">{members.data?.students.map((s: any) => <li key={s.userId} className="flex justify-between py-1">{s.name}<button className="text-red-700 underline" onClick={() => m.mutate({ removeStudents: [s.userId] })}>Remove<span className="sr-only"> {s.name}</span></button></li>)}</ul>
    <fieldset><legend className="font-semibold">Add students</legend><p className="text-xs text-slate-500">Students at your school taking {cls.subjectId?.name ?? 'the subject'}{cls.yearOfStudy ? ` in year ${cls.yearOfStudy}` : ''}.</p>
      {cand.data?.length ? <ul className="max-h-60 overflow-auto text-sm">{cand.data.map((s) => <li key={s.userId}><label><input type="checkbox" checked={pick.includes(s.userId)} onChange={(e) => setPick(e.target.checked ? [...pick, s.userId] : pick.filter((x) => x !== s.userId))} /> {s.name}</label></li>)}</ul> : <p className="text-sm">No more eligible students.</p>}</fieldset>
    {m.error && <Alert>{m.error.message}</Alert>}<Button className="mt-2" disabled={!pick.length} loading={m.isPending} onClick={() => m.mutate({ addStudents: pick })}>Add {pick.length || ''} student{pick.length === 1 ? '' : 's'}</Button>
    <div className="mt-4 border-t pt-3"><Button variant="danger" onClick={() => m.mutate({ archived: !cls.archived })}>{cls.archived ? 'Restore class' : 'Archive class'}</Button></div></Card>;
}
export function ClassStudentPage() {
  const { id, userId } = useParams();
  const q = useQuery({ queryKey: ['class-student', id, userId], queryFn: () => api<any>(`/api/teacher/classes/${id}/students/${userId}`) });
  if (q.isLoading) return <Spinner />; if (q.error) return <Alert>{q.error.message}</Alert>;
  const d = q.data;
  return <section className="space-y-4"><Link to={`/teach/classes/${id}`} className="text-sm text-brand-700 underline">← Class</Link><h1 className="text-2xl font-bold">{d.student.fullName}</h1>
    <Card><h2 className="font-semibold">Mastery by topic</h2>{d.mastery.length ? <BarChart label="Mastery by topic" data={d.mastery.map((m: any) => ({ label: m.topic, value: Math.round(m.score * 100) }))} /> : <p className="text-sm">No answers yet.</p>}</Card>
    <Card><h2 className="font-semibold">Attempts</h2><table className="w-full text-sm"><thead><tr className="border-b text-left"><th>When</th><th>Work</th><th>Score</th><th>Status</th><th>Revise</th></tr></thead><tbody>{d.attempts.map((a: any) => <tr key={a._id} className="border-b">
      <td className="py-1">{fmtDate(a.submittedAt)}</td><td>{a.title ?? a.mode.replace('_', ' ')}{a.topic ? ` · ${a.topic}` : ''}</td><td>{a.pct ?? '—'}{a.pct != null && '%'}{a.provisional && ' (provisional)'}</td>
      <td>{a.status === 'pending_review' ? <Link className="text-brand-700 underline" to={`/teach/marking/${a._id}`}>Mark</Link> : a.status}</td><td>{a.revisionTopics?.join(', ')}</td></tr>)}</tbody></table></Card>
    {d.misconceptions.length > 0 && <Card><h2 className="font-semibold">Repeated mistakes</h2><ul className="list-disc pl-5 text-sm">{d.misconceptions.map((m: any) => <li key={m.questionId}>{m.stem} — wrong {m.wrong}/{m.responses}{m.correctAnswer ? `; correct: ${m.correctAnswer}` : ''}</li>)}</ul></Card>}
    <Card><h2 className="mb-1 font-semibold">Password help</h2><p className="mb-3 text-sm text-slate-600">If {d.student.fullName} cannot sign in, create a one-time reset code to hand over in person, or set a temporary password. Both are recorded in the audit log and the student is told in the app.</p>
      <StaffResetActions who={d.student.fullName} linkUrl={`/api/teacher/classes/${id}/students/${userId}/password-reset`} linkBody={{ mode: 'link' }} tempUrl={`/api/teacher/classes/${id}/students/${userId}/password-reset`} tempBody={{ mode: 'temporary' }} /></Card>
  </section>;
}
