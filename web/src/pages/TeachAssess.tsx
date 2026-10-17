import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, post, put, patch } from '../lib/api';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { BarChart } from '../components/Charts';
import { ResultBox } from '../components/QuestionInput';

export function TeachAssessPage() {
  const qc = useQueryClient();
  const subs = useQuery({ queryKey: ['teach-subjects'], queryFn: () => api<{ items: any[] }>('/api/me/subjects').catch(() => ({ items: [] })).then((r) => r.items) });
  const all = useQuery({ queryKey: ['/api/config/subjects'], queryFn: () => api<{ items: any[] }>('/api/config/subjects').then((r) => r.items) });
  const list = useQuery({ queryKey: ['assessments'], queryFn: () => api<{ items: any[] }>('/api/assessments').then((r) => r.items) });
  const queue = useQuery({ queryKey: ['marking'], queryFn: () => api<{ items: any[] }>('/api/assessments/marking/queue').then((r) => r.items) });
  const [sp] = useSearchParams();
  const classes = useQuery({ queryKey: ['classes'], queryFn: () => api<{ items: any[] }>('/api/teacher/classes').then((r) => r.items).catch(() => []) });
  const [f, setF] = useState({ classId: sp.get('classId') ?? '', title: '', subjectId: '', mode: 'assigned', minutes: '30', maxAttempts: '1', closesAt: '', showAnswers: 'after_submit' }); const [picked, setPicked] = useState<string[]>([]);
  const bank = useQuery({ queryKey: ['bank', f.subjectId], enabled: !!f.subjectId, queryFn: () => api<{ items: any[] }>(`/api/questions?subjectId=${f.subjectId}&status=published`).then((r) => r.items) });
  const cls = useQuery({ queryKey: ['class', f.subjectId], enabled: !!f.subjectId, retry: false, queryFn: () => api<any>(`/api/progress/class?subjectId=${f.subjectId}`) });
  const create = useMutation({ mutationFn: () => post('/api/assessments', { title: f.title, subjectId: f.subjectId, mode: f.mode, questionIds: picked, timeLimitSec: f.minutes ? Number(f.minutes) * 60 : undefined, maxAttempts: Number(f.maxAttempts), closesAt: f.closesAt ? new Date(f.closesAt).toISOString() : undefined, showAnswers: f.showAnswers, classId: f.classId || undefined }),
    onSuccess: () => { setPicked([]); setF({ ...f, title: '' }); qc.invalidateQueries({ queryKey: ['assessments'] }); } });
  const subjects = subs.data?.length ? subs.data : all.data;
  return <section className="space-y-4"><h1 className="text-2xl font-bold">Assessments & marking</h1>
    <Card><h2 className="font-semibold">Written answers to mark ({queue.data?.length ?? 0})</h2>{queue.data?.length ? <ul className="mt-2 divide-y text-sm">{queue.data.map((a) => <li key={a._id} className="flex justify-between py-1"><span>{a.userId?.fullName} · {a.subjectId?.name} · {new Date(a.submittedAt).toLocaleString()}</span><Link className="text-brand-700 underline" to={`/teach/marking/${a._id}`}>Mark</Link></li>)}</ul> : <p className="text-sm">Nothing waiting.</p>}</Card>
    <Card><h2 className="mb-2 font-semibold">Set work for your class</h2><div className="grid gap-3 sm:grid-cols-3">
      <Select label="Subject" value={f.subjectId} onChange={(e) => { setPicked([]); setF({ ...f, subjectId: e.target.value }); }}><option value="">Choose…</option>{subjects?.map((x: any) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select>
      <Select label="Class" value={f.classId} onChange={(e) => { const c = classes.data?.find((x: any) => x._id === e.target.value); setF({ ...f, classId: e.target.value, subjectId: c?.subjectId?._id ?? f.subjectId }); }}><option value="">Everyone in my subject year</option>{classes.data?.filter((c: any) => !f.subjectId || !c.subjectId || c.subjectId._id === f.subjectId).map((c: any) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select>
      <Input label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /><Select label="Type" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="assigned">Assignment</option><option value="mock">Mock exam</option></Select>
      <Input label="Time limit (minutes, blank = none)" type="number" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /><Input label="Attempts allowed" type="number" min={1} max={10} value={f.maxAttempts} onChange={(e) => setF({ ...f, maxAttempts: e.target.value })} />
      <Input label="Closes at (optional)" type="datetime-local" value={f.closesAt} onChange={(e) => setF({ ...f, closesAt: e.target.value })} />
      <Select label="Show answers" value={f.showAnswers} onChange={(e) => setF({ ...f, showAnswers: e.target.value })}><option value="after_submit">After each student submits</option><option value="after_close">After it closes</option></Select></div>
      {bank.data && <fieldset className="mt-3"><legend className="text-sm font-medium">Approved questions ({picked.length} chosen)</legend><ul className="max-h-64 overflow-auto rounded border p-2 text-sm">{bank.data.map((q) => <li key={q._id}><label><input type="checkbox" checked={picked.includes(q._id)} onChange={(e) => setPicked(e.target.checked ? [...picked, q._id] : picked.filter((x) => x !== q._id))} /> <span className="rounded bg-slate-100 px-1 text-xs">{q.type}</span> {q.stem} <span className="text-xs text-slate-500">({q.topic}, {q.difficulty})</span></label></li>)}</ul></fieldset>}
      {create.error && <Alert>{create.error.message}</Alert>}<Button className="mt-2" disabled={!f.subjectId || f.title.length < 3 || !picked.length} loading={create.isPending} onClick={() => create.mutate()}>Publish to class</Button></Card>
    {cls.data && <Card><h2 className="font-semibold">Class progress</h2><div className="grid gap-4 md:grid-cols-2"><table className="text-sm"><thead><tr className="border-b text-left"><th>Student</th><th>Mastery</th><th>Attempts</th><th>Weak topics</th></tr></thead><tbody>{cls.data.students.map((s: any) => <tr key={s.userId} className="border-b"><td className="py-1">{s.name}</td><td>{s.mastery ?? '-'}{s.mastery != null && '%'}</td><td>{s.attempts}{s.pendingReview ? ` (${s.pendingReview} to mark)` : ''}</td><td>{s.weakTopics.join(', ')}</td></tr>)}</tbody></table>
      <BarChart label="Class average by topic" data={cls.data.topics.map((t: any) => ({ label: t.topic, value: t.avg }))} /></div></Card>}
    {cls.error && f.subjectId && <Alert tone="info">{cls.error.message}</Alert>}
    <Card><h2 className="font-semibold">Your assessments</h2>{list.isLoading ? <Spinner /> : <ul className="mt-2 divide-y text-sm">{list.data?.map((a) => <li key={a._id} className="py-1"><Link className="text-brand-700 underline" to={`/teach/assessments/${a._id}`}>{a.title}</Link> · {a.subjectId?.name} · {a.mode} · {a.status}</li>)}</ul>}</Card>
  </section>;
}
export function AssessmentResultsPage() {
  const { id } = useParams(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['results', id], queryFn: () => api<any>(`/api/assessments/${id}/results`) });
  const close = useMutation({ mutationFn: () => patch(`/api/assessments/${id}`, { status: 'closed' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['results', id] }) });
  if (q.isLoading) return <Spinner />; if (q.error) return <Alert>{q.error.message}</Alert>;
  return <section className="space-y-4"><Link to="/teach/assess" className="text-sm text-brand-700 underline">← Assessments</Link><h1 className="text-xl font-bold">{q.data.assessment.title}</h1>
    {q.data.assessment.status !== 'closed' && <Button variant="ghost" onClick={() => close.mutate()}>Close assessment</Button>}
    <Card><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-1">Student</th><th>Score</th><th>Status</th><th>Submitted</th><th /></tr></thead><tbody>{q.data.attempts.map((a: any) => <tr key={a._id} className="border-b"><td className="py-1">{a.userId?.fullName}</td><td>{a.pct != null ? `${a.score}/${a.maxScore} (${a.pct}%)` : '-'}{a.provisional ? ' provisional' : ''}</td><td>{a.status.replace('_', ' ')}{a.autoSubmitted ? ' (time up)' : ''}</td><td>{a.submittedAt ? new Date(a.submittedAt).toLocaleString() : '-'}</td>
      <td>{a.status === 'pending_review' && <Link className="text-brand-700 underline" to={`/teach/marking/${a._id}`}>Mark</Link>}</td></tr>)}</tbody></table>{!q.data.attempts.length && <p className="text-sm">No attempts yet.</p>}</Card></section>;
}
function VerifyBox({ attemptId, q, r, rub, onDone }: any) {
  const isEssay = q.type === 'essay'; const [crit, setCrit] = useState<Record<string, number>>(Object.fromEntries((r.criteria ?? []).map((c: any) => [c.criterion, c.marks])));
  const [parts, setParts] = useState<(number | null)[]>((r.parts ?? []).map((p: any) => p?.score ?? null)); const [comment, setComment] = useState('');
  const m = useMutation({ mutationFn: () => post(`/api/assessments/marking/${attemptId}/responses/${q.id}/verify`, isEssay ? { criteria: (rub?.rubric ?? []).map((c: any) => ({ criterion: c.criterion, marks: Number(crit[c.criterion] ?? 0) })), comment: comment || undefined } : { partScores: parts, comment: comment || undefined }), onSuccess: onDone });
  return <div className="mt-2 rounded bg-slate-50 p-2 text-sm"><p className="font-medium">Student answer</p><pre className="whitespace-pre-wrap rounded bg-white p-2">{typeof r.response === 'string' ? r.response : JSON.stringify(r.response, null, 1)}</pre>
    {rub?.data?.guidance && <p className="mt-1"><strong>Guidance:</strong> {rub.data.guidance}</p>}
    {isEssay ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{(rub?.rubric ?? []).map((c: any) => <Input key={c.criterion} label={`${c.criterion} (max ${c.maxMarks})`} type="number" min={0} max={c.maxMarks} value={crit[c.criterion] ?? ''} onChange={(e) => setCrit({ ...crit, [c.criterion]: Number(e.target.value) })} hint={r.criteria?.find((x: any) => x.criterion === c.criterion)?.comment && `AI: ${r.criteria.find((x: any) => x.criterion === c.criterion).comment}`} />)}</div>
      : <div className="mt-2 grid gap-2 sm:grid-cols-3">{(r.parts ?? []).map((p: any, i: number) => <Input key={i} label={`Part (${String.fromCharCode(97 + i)}) max ${p?.maxScore}`} type="number" min={0} max={p?.maxScore} value={parts[i] ?? ''} onChange={(e) => { const c = [...parts]; c[i] = Number(e.target.value); setParts(c); }} />)}</div>}
    <Input label="Comment to student (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />{m.error && <Alert>{m.error.message}</Alert>}<Button className="mt-2" loading={m.isPending} onClick={() => m.mutate()}>Confirm mark</Button></div>;
}
export function MarkingPage() {
  const { attemptId } = useParams(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mark', attemptId], queryFn: () => api<any>(`/api/assessments/marking/${attemptId}`).then((r) => r.attempt) });
  if (q.isLoading) return <Spinner />; if (q.error) return <Alert>{q.error.message}</Alert>;
  const a = q.data;
  return <section className="space-y-4"><Link to="/teach/assess" className="text-sm text-brand-700 underline">← Assessments</Link><h1 className="text-xl font-bold">Marking: {a.score}/{a.maxScore}{a.provisional ? ' (provisional)' : ''}</h1>
    <Alert tone="info">AI marks are provisional suggestions against your rubric. Check each one; your mark is final and is what the student sees.</Alert>
    {a.questions.map((x: any, i: number) => { const r = a.responses.find((y: any) => y.questionId === x.id); const rub = a.rubrics.find((y: any) => y._id === x.id);
      return <Card key={x.id}><p className="font-medium">{i + 1}. {x.stem}</p><ResultBox r={x.result} />{r?.needsReview && <VerifyBox attemptId={attemptId} q={x} r={r} rub={rub} onDone={() => qc.invalidateQueries({ queryKey: ['mark', attemptId] })} />}</Card>; })}</section>;
}
export function LeaderboardSettings({ schoolId }: { schoolId: string }) {
  const q = useQuery({ queryKey: ['lbset', schoolId], queryFn: () => api<any>(`/api/rewards/schools/${schoolId}/leaderboard`).then((r) => r.leaderboard) });
  const m = useMutation({ mutationFn: (b: any) => put<any>(`/api/rewards/schools/${schoolId}/leaderboard`, b), onSuccess: () => q.refetch() });
  if (!q.data) return null; const v = q.data;
  return <Card><h2 className="font-semibold">Leaderboard</h2><p className="text-sm text-slate-600">Off by default. When on, students see weekly XP rankings for their own school only. Names are hidden unless you turn anonymisation off.</p>
    <div className="mt-2 flex flex-wrap gap-4 text-sm"><label><input type="checkbox" checked={v.enabled} onChange={(e) => m.mutate({ ...v, enabled: e.target.checked })} /> Enabled</label>
      <label><input type="checkbox" checked={v.anonymized} onChange={(e) => m.mutate({ ...v, anonymized: e.target.checked })} /> Anonymised (recommended)</label>
      <label>Scope <select className="rounded border" value={v.scope} onChange={(e) => m.mutate({ ...v, scope: e.target.value })}><option value="year">Year group</option><option value="school">Whole school</option></select></label></div>{m.error && <Alert>{m.error.message}</Alert>}</Card>;
}
