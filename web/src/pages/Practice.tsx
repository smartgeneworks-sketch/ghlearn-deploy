import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Timer } from 'lucide-react';
import { api, post, put } from '../lib/api';
import { registerBeforeIdleLogout } from '../lib/idle';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { QuestionInput, ResultBox } from '../components/QuestionInput';
const MODES: Record<string, string> = { practice: 'Practice (untimed)', timed: 'Timed quiz', topic_revision: 'Topic revision', mixed: 'Mixed revision', remedial: 'Remedial: work on weak spots', mock: 'Mock exam' };

export function PracticeHome() {
  const { subjectId } = useParams(); const nav = useNavigate(); const [sp] = useSearchParams();
  const [mode, setMode] = useState(sp.get('mode') ?? 'practice'); const [topic, setTopic] = useState(sp.get('topic') ?? ''); const [count, setCount] = useState('10'); const [mins, setMins] = useState('10');
  const assigned = useQuery({ queryKey: ['assigned'], queryFn: () => api<{ items: any[] }>('/api/practice/assigned').then((r) => r.items.filter((a) => a.subjectId?._id === subjectId)) });
  const history = useQuery({ queryKey: ['attempts', subjectId], queryFn: () => api<{ items: any[] }>(`/api/practice/attempts?subjectId=${subjectId}`).then((r) => r.items) });
  const topics = useQuery({ queryKey: ['progress', subjectId], queryFn: () => api<any>(`/api/progress/me?subjectId=${subjectId}`).catch(() => null) });
  const start = useMutation({ mutationFn: (b: any) => post<any>('/api/practice/attempts', { subjectId, ...b }), onSuccess: (r) => nav(`/learn/${subjectId}/practice/${r.attempt._id}`) });
  const known = [...new Set([...(topics.data?.mastery ?? []).map((m: any) => m.topic), ...(topics.data?.recommendations ?? []).map((r: any) => r.topic).filter(Boolean)])] as string[];
  return <section className="space-y-4"><Link to={`/learn/${subjectId}`} className="text-sm text-brand-700 underline">← Back to subject</Link><h1 className="text-2xl font-bold">Practice & assessments</h1>
    {!!assigned.data?.length && <Card><h2 className="font-semibold">Set by your teacher</h2><ul className="mt-2 space-y-2">{assigned.data.map((a) => { const done = a.attempts.filter((x: any) => x.status !== 'in_progress').length;
      return <li key={a._id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"><span><strong>{a.title}</strong> <span className="text-sm text-slate-500">{a.mode === 'mock' ? 'Mock exam · ' : ''}{a.timeLimitSec ? `${Math.round(a.timeLimitSec / 60)} min · ` : ''}{a.closesAt ? `due ${new Date(a.closesAt).toLocaleString()}` : 'no deadline'} · attempts {done}/{a.maxAttempts}</span></span>
        <Button disabled={done >= a.maxAttempts} onClick={() => start.mutate({ mode: a.mode, assessmentId: a._id })}>{a.attempts.some((x: any) => x.status === 'in_progress') ? 'Continue' : 'Start'}</Button></li>; })}</ul></Card>}
    <Card><h2 className="mb-2 font-semibold">Start a practice session</h2>
      <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); start.mutate({ mode, topic: topic || undefined, count: Number(count), ...(mode === 'timed' ? { timeLimitSec: Number(mins) * 60 } : {}) }); }}>
        <Select label="Mode" value={mode} onChange={(e) => setMode(e.target.value)}>{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <div><Input label={`Topic${mode === 'topic_revision' ? '' : ' (optional)'}`} list="topics" value={topic} onChange={(e) => setTopic(e.target.value)} /><datalist id="topics">{known.map((t) => <option key={t} value={t} />)}</datalist></div>
        {mode !== 'mock' && <Input label="Questions" type="number" min={1} max={40} value={count} onChange={(e) => setCount(e.target.value)} />}
        {mode === 'timed' && <Input label="Minutes" type="number" min={1} max={240} value={mins} onChange={(e) => setMins(e.target.value)} />}
        <div className="sm:col-span-4">{start.error && <Alert>{start.error.message}</Alert>}<Button type="submit" className="mt-2" loading={start.isPending}>Start</Button></div>
      </form></Card>
    <Card><h2 className="font-semibold">History</h2>{history.isLoading ? <Spinner /> : !history.data?.length ? <p className="text-sm">No attempts yet.</p> :
      <table className="mt-2 w-full text-left text-sm"><thead><tr className="border-b"><th className="py-1">When</th><th>Mode</th><th>Topic</th><th>Score</th><th>Status</th></tr></thead><tbody>
        {history.data.map((a) => <tr key={a._id} className="border-b last:border-0"><td className="py-1"><Link className="text-brand-700 underline" to={`/learn/${subjectId}/practice/${a._id}`}>{new Date(a.createdAt).toLocaleString()}</Link></td><td>{a.assessmentId?.title ?? MODES[a.mode] ?? a.mode}</td><td>{a.topic ?? '-'}</td>
          <td>{a.pct != null ? `${a.pct}%${a.provisional ? ' (provisional)' : ''}` : '-'}</td><td>{a.status.replace('_', ' ')}</td></tr>)}</tbody></table>}</Card></section>;
}
function Countdown({ deadline, onExpire }: { deadline: string; onExpire: () => void }) {
  const [left, setLeft] = useState(() => new Date(deadline).getTime() - Date.now());
  useEffect(() => { const t = setInterval(() => { const l = new Date(deadline).getTime() - Date.now(); setLeft(l); if (l <= 0) { clearInterval(t); onExpire(); } }, 1000); return () => clearInterval(t); }, [deadline]);
  const s = Math.max(0, Math.floor(left / 1000));
  return <span role="timer" aria-live={s < 60 ? 'assertive' : 'off'} className={`flex items-center gap-1 rounded px-2 py-1 font-mono ${s < 60 ? 'bg-red-100 text-red-800' : 'bg-slate-100'}`}><Timer className="h-4 w-4" aria-hidden />{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}
export function AttemptPage() {
  const { subjectId, attemptId } = useParams(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['attempt', attemptId], queryFn: () => api<{ attempt: any }>(`/api/practice/attempts/${attemptId}`).then((r) => r.attempt), refetchInterval: (x) => (x.state.data?.status === 'pending_review' ? 8000 : false) });
  const [answers, setAnswers] = useState<Record<string, any>>({}); const [saveErr, setSaveErr] = useState<string | null>(null);
  useEffect(() => { if (q.data) setAnswers(Object.fromEntries(q.data.questions.map((x: any) => [x.id, x.response]))); }, [q.data?._id, q.data?.status]);
  // Idle sign-out during a timed attempt: save the current answers first.
  const ansRef = useRef(answers); ansRef.current = answers; const inProgress = q.data?.status === 'in_progress';
  useEffect(() => { if (!inProgress) return; return registerBeforeIdleLogout(() => Promise.allSettled(Object.entries(ansRef.current).filter(([, v]) => v != null && v !== '').map(([qid, v]) => put(`/api/practice/attempts/${attemptId}/responses/${qid}`, { response: v })))); }, [inProgress, attemptId]);
  const save = async (qid: string, v: any) => { setAnswers((a) => ({ ...a, [qid]: v })); try { await put(`/api/practice/attempts/${attemptId}/responses/${qid}`, { response: v }); setSaveErr(null); } catch (e: any) { setSaveErr(e.message); if (e.code === 'TIME_UP') qc.invalidateQueries({ queryKey: ['attempt', attemptId] }); } };
  const submit = useMutation({ mutationFn: () => post<any>(`/api/practice/attempts/${attemptId}/submit`, {}), onSuccess: (r) => { qc.setQueryData(['attempt', attemptId], r.attempt); qc.invalidateQueries({ queryKey: ['attempts', subjectId] }); window.scrollTo?.(0, 0); } });
  if (q.isLoading) return <Spinner />; if (q.error) return <Alert>{q.error.message}</Alert>;
  const a = q.data; const live = a.status === 'in_progress'; const unanswered = a.questions.filter((x: any) => answers[x.id] == null || answers[x.id] === '').length;
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><Link to={`/learn/${subjectId}/practice`} className="text-sm text-brand-700 underline">← Practice</Link>
      {live && a.deadline && <Countdown deadline={a.deadline} onExpire={() => submit.mutate()} />}</div>
    <h1 className="text-xl font-bold">{MODES[a.mode] ?? 'Assigned work'}{a.topic && `: ${a.topic}`}</h1>
    {!live && <Card><p className="text-2xl font-bold">{a.score}/{a.maxScore} ({a.pct}%)</p>
      {a.provisional && <Alert tone="info">Some written answers have a provisional mark. Your teacher will confirm the final score.</Alert>}
      {a.autoSubmitted && <p className="text-sm">Time ran out, so your saved answers were submitted automatically.</p>}
      {a.answersHidden && <p className="text-sm">Correct answers will be shown after the assessment closes.</p>}
      {a.reward && <p className="mt-1 text-sm">⭐ +{a.reward.xp} XP{a.reward.newBadges?.length ? ` · New badge: ${a.reward.newBadges.join(', ')}` : ''}</p>}
      {!!a.revisionTopics?.length && <p className="mt-1 text-sm">Revise next: {a.revisionTopics.map((t: string) => <Link key={t} className="mr-2 text-brand-700 underline" to={`/learn/${subjectId}/practice?mode=topic_revision&topic=${encodeURIComponent(t)}`}>{t}</Link>)}</p>}</Card>}
    {saveErr && <Alert>{saveErr}</Alert>}
    <ol className="space-y-4">{a.questions.map((x: any, i: number) => <li key={x.id}><Card><p className="mb-2 font-medium"><span className="mr-2 text-slate-500">{i + 1}.</span>{x.stem} <span className="text-xs text-slate-500">[{x.marks} mark{x.marks === 1 ? '' : 's'} · {x.difficulty}]</span></p>
      <QuestionInput q={x} value={answers[x.id]} disabled={!live} onChange={(v) => save(x.id, v)} />{!live && <ResultBox r={x.result} />}</Card></li>)}</ol>
    {live && <div className="flex items-center gap-3">{unanswered > 0 && <span className="text-sm text-slate-600">{unanswered} unanswered</span>}<Button loading={submit.isPending} onClick={() => (unanswered === 0 || confirm(`${unanswered} question(s) unanswered. Submit anyway?`)) && submit.mutate()}>Submit answers</Button></div>}
  </section>;
}
