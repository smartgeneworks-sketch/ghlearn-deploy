import { MathText } from '../lib/math';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post } from '../lib/api';
import { Alert, Button, Card } from '../components/ui';
import { Section } from '../components/LessonView';
import { Clock, CheckCircle2, Lock, PlayCircle, Sparkles } from 'lucide-react';

const safeSvg = (s?: string) => !!s && s.startsWith('<svg') && !/<script|on\w+=|href=|<foreignObject|<image/i.test(s);
const thumbSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const STATUS: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };
export const minutes = (rt: any) => rt ? [`Reading time: ${rt.readingMin} min`, rt.readingAndExamplesMin > rt.readingMin && `Reading and examples: ${rt.readingAndExamplesMin} min`, `Lesson and practice: ${rt.totalMin} min`].filter(Boolean) as string[] : [];

/** "My Subject" dashboard (§3/§5): strands, sub-strands and module cards in curriculum order. Renders nothing when the subject has no modules. */
export function ModuleDashboard({ subjectId }: { subjectId: string }) {
  const q = useQuery({ queryKey: ['modules', subjectId], retry: false, queryFn: () => api<any>(`/api/subjects/${subjectId}/modules`) });
  if (q.isLoading || q.error || !q.data?.totals.modules) return null;
  const d = q.data; const t = d.totals;
  return <section aria-labelledby="mods-h" className="mb-8 space-y-4">
    <Card><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="mods-h" className="text-xl font-bold">{d.subject.name}</h2>
      <p className="text-sm text-slate-600">{[d.subject.levelId?.name, `${t.strands} strand${t.strands === 1 ? '' : 's'}`, `${t.modules} module${t.modules === 1 ? '' : 's'}`, `about ${Math.round(t.totalMinutes / 6) / 10} h of learning (${t.readingMinutes} min reading)`].filter(Boolean).join(' · ')}</p></div>
      {d.continue && <Link to={`/learn/${subjectId}/r/${d.continue._id}`} className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-2 text-white"><PlayCircle className="h-4 w-4" aria-hidden />{t.completed ? 'Continue learning' : 'Start learning'}</Link>}</div>
      <div className="mt-3" aria-label={`Subject progress ${t.progressPct}%`}><div className="h-2 rounded bg-slate-200"><div className="h-2 rounded bg-brand-700" style={{ width: `${t.progressPct}%` }} /></div>
        <p className="mt-1 text-xs text-slate-600">{t.completed} of {t.modules} completed ({t.progressPct}%)</p></div></Card>
    <h2 className="text-lg font-semibold">Learning Resources</h2>
    {d.strands.map((st: any) => <div key={st.key} className="space-y-3"><h3 className="font-semibold text-brand-900">Year {st.yearOfStudy} · {st.title}</h3>
      {st.subStrands.map((ss: any) => <div key={ss.title}><h4 className="mb-2 text-sm font-medium text-slate-700">{ss.title}</h4>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{ss.modules.map((m: any) => <li key={m._id}><ModuleCard m={m} subjectId={subjectId} /></li>)}</ul></div>)}</div>)}
  </section>;
}
function ModuleCard({ m, subjectId }: { m: any; subjectId: string }) {
  const rt = m.readingTime;
  return <Card className="flex h-full flex-col overflow-hidden p-0">
    {safeSvg(m.thumbnail?.svg) ? <img src={thumbSrc(m.thumbnail.svg)} alt={m.thumbnail.alt ?? ''} width={320} height={180} loading="lazy" className="aspect-video w-full object-cover" /> : <div className="aspect-video bg-slate-100" />}
    <div className="flex flex-1 flex-col gap-1 p-3">
      <p className="text-xs text-slate-600">{m.subStrand}</p>
      <h5 className="font-semibold leading-snug">{m.title}</h5>
      {m.intro && <p className="line-clamp-3 text-sm text-slate-700">{m.intro}</p>}
      {m.objective && <p className="text-xs text-slate-600"><strong>You will:</strong> {m.objective}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 text-xs">
        {rt && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden />{rt.readingMin} min read · {rt.totalMin} min total</span>}
        <span className={`rounded px-1.5 py-0.5 ${m.status === 'completed' ? 'bg-emerald-100 text-emerald-900' : m.status === 'in_progress' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-800'}`}>{STATUS[m.status]}</span>
        {m.aiApproved && <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-sky-900" title="Passed automated checks; not reviewed by a person"><Sparkles className="h-3 w-3" aria-hidden />AI-Approved</span>}
      </div>
      {m.locked ? <p className="mt-2 inline-flex items-center gap-1 text-sm text-slate-600"><Lock className="h-4 w-4" aria-hidden />{m.lockReason}</p>
        : <Link to={`/learn/${subjectId}/r/${m._id}`} className="mt-2 inline-flex items-center justify-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 text-sm text-white" aria-label={`${m.status === 'not_started' ? 'Start' : m.status === 'completed' ? 'Review' : 'Continue'}: ${m.title}`}>{m.status === 'not_started' ? 'Start' : m.status === 'completed' ? 'Review' : 'Continue'}</Link>}
    </div></Card>;
}

/** Module reader (§9/§13): counts active reading time and scroll depth, server-scored knowledge check, completion rule, prev/next. */
export function ModuleReader({ r, progress, subjectId }: { r: any; progress: any; subjectId: string }) {
  const b = r.body ?? {}; const qc = useQueryClient(); const isLearner = !!progress;
  const end = useRef<HTMLDivElement>(null); const [scroll, setScroll] = useState(progress?.maxScrollPct ?? 0);
  useEffect(() => { if (!isLearner) return; let active = 0; let last = Date.now(); let maxPct = progress?.maxScrollPct ?? 0;
    const onAct = () => { last = Date.now(); };
    const onScroll = () => { onAct(); const el = document.documentElement; const pct = Math.min(100, Math.round(((el.scrollTop + window.innerHeight) / el.scrollHeight) * 100)); if (pct > maxPct) { maxPct = pct; setScroll(pct); } };
    const tick = setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - last < 60_000) active += 5; }, 5000);
    const send = () => { if (!active && maxPct <= (progress?.maxScrollPct ?? 0)) return; const s = Math.min(120, active); active -= s; post(`/api/resources/${r._id}/progress`, { activeSeconds: s, scrollPct: maxPct }).catch(() => undefined); };
    const flush = setInterval(send, 30_000); window.addEventListener('scroll', onScroll, { passive: true }); ['keydown', 'pointerdown', 'pointermove'].forEach((e) => window.addEventListener(e, onAct, { passive: true })); onScroll();
    return () => { clearInterval(tick); clearInterval(flush); send(); window.removeEventListener('scroll', onScroll); ['keydown', 'pointerdown', 'pointermove'].forEach((e) => window.removeEventListener(e, onAct)); };
  }, [r._id]); // eslint-disable-line react-hooks/exhaustive-deps
  const L = b.sections?.find((s: any) => s.key === 'L'); const rule = r.completionRule;
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2 text-sm">{minutes(r.readingTime).map((x) => <span key={x} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5"><Clock className="h-3 w-3" aria-hidden /><MathText text={x} /></span>)}</div>
    {r.aiApproved && <Alert tone="info">AI-Approved: these notes were generated from your learner manual and passed automated checks (structure, sources, maths answers verified by calculation). They have not been reviewed by a person; report any error to your teacher.</Alert>}
    <p className="text-sm text-slate-700"><strong>Learning indicator:</strong> {r.indicator}</p>
    <div className="space-y-4">{(b.sections ?? []).filter((s: any) => s.key !== 'L').map((s: any) => <Section key={s.key} s={s} listen />)}</div>
    {L && <KnowledgeCheck r={r} section={L} learner={isLearner} prior={progress} />}
    <div ref={end} />
    {isLearner && <CompleteModule id={r._id} done={!!progress.completedAt} scroll={scroll} rule={rule} passed={progress.checkScorePct != null && progress.checkScorePct >= (rule?.passMarkPct ?? 0)} hasCheck={!!L} onDone={() => { qc.invalidateQueries({ queryKey: ['modules', subjectId] }); }} />}
    <nav className="flex justify-between gap-2" aria-label="Module navigation">{r.nav?.prev ? <Link className="text-brand-700 underline" to={`/learn/${subjectId}/r/${r.nav.prev}`}>← Previous module</Link> : <span />}{r.nav?.next && <Link className="text-brand-700 underline" to={`/learn/${subjectId}/r/${r.nav.next}`}>Next module →</Link>}</nav>
    {b.sourceDocuments?.length > 0 && <p className="text-xs text-slate-600">Source: {b.sourceDocuments.map((d: any) => d.title).join('; ')} (page references under each section).</p>}
  </div>;
}
function KnowledgeCheck({ r, section, learner, prior }: { r: any; section: any; learner: boolean; prior: any }) {
  const qs = section.data?.questions ?? []; const [ans, setAns] = useState<number[]>(qs.map(() => -1)); const qc = useQueryClient();
  // Snapshot of the questions as shown when submitted: the order changes after every attempt until the learner passes.
  const [snap, setSnap] = useState<{ qs: any[]; ans: number[] } | null>(null);
  const m = useMutation({ mutationFn: () => post<any>(`/api/resources/${r._id}/check`, { answers: ans, ...(r.checkAttempt != null ? { attempt: r.checkAttempt } : {}) }),
    onMutate: () => setSnap({ qs, ans }), onSuccess: () => qc.invalidateQueries({ queryKey: ['resource', r._id] }) });
  const res = m.data; const staffView = !learner && qs.some((q: any) => q.correctIndex != null);
  const failed = res && !res.passed; const shown = res?.passed && snap ? snap.qs : qs; const chosen = res?.passed && snap ? snap.ans : ans;
  const retry = () => { m.reset(); setSnap(null); setAns(qs.map(() => -1)); };
  return <Card><h2 className="text-lg font-semibold">L. Knowledge check</h2>
    {prior?.checkAttempts > 0 && !res && <p className="text-sm text-slate-700">Your last score: {prior.checkScorePct}% ({prior.checkAttempts} attempt{prior.checkAttempts === 1 ? '' : 's'}).{!prior.checkScorePct || prior.checkScorePct < 100 ? ' The questions are in a new order for this attempt.' : ''}</p>}
    {failed ? <div className="mt-2 space-y-3" role="status">
      <p className="font-semibold text-amber-900">{res.correct} / {res.total} ({res.pct}%): {res.passMarkPct}% is needed to pass.</p>
      <p className="text-sm text-slate-700">These questions need another look. The answers are shown once you pass.</p>
      <ul className="space-y-2">{res.results.filter((x: any) => !x.correct).map((x: any, i: number) => <li key={i} className="rounded border border-amber-200 bg-amber-50 p-2 text-sm"><p className="font-medium"><MathText text={x.question} /></p>{x.hint && <p className="text-slate-700"><MathText text={x.hint} /></p>}</li>)}</ul>
      <Button type="button" onClick={retry}>Try again</Button></div>
    : <form className="mt-2 space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      {shown.map((q: any, i: number) => <fieldset key={`${r.checkAttempt ?? 0}-${i}`} className="rounded border p-3"><legend className="font-medium">{i + 1}. <MathText text={q.question} /></legend>
        <div className="mt-1 grid gap-1">{q.options.map((o: string, j: number) => { const rr = res?.results?.[i]; const right = (rr?.correctIndex ?? (staffView ? q.correctIndex : undefined)) === j;
          return <label key={j} className={`flex items-center gap-2 rounded px-2 py-1 ${rr && right ? 'bg-emerald-50' : rr && chosen[i] === j ? 'bg-red-50' : ''}`}><input type="radio" name={`lq${i}`} checked={chosen[i] === j} onChange={() => setAns(ans.map((a, k) => (k === i ? j : a)))} disabled={!learner || !!res} /><MathText text={o} />{(rr || staffView) && right && <span className="text-xs text-emerald-800">✓ correct</span>}</label>; })}</div>
        {(res?.results?.[i]?.explanation || (staffView && q.explanation)) && <p className="mt-1 text-sm text-slate-700"><MathText text={res?.results?.[i]?.explanation ?? q.explanation} /></p>}</fieldset>)}
      {learner && <div className="flex flex-wrap items-center gap-3">{!res && <Button type="submit" loading={m.isPending} disabled={ans.length !== qs.length || ans.some((a) => a < 0)}>Check my answers</Button>}
        {res && <p role="status" className="font-semibold text-emerald-800">{res.correct} / {res.total} ({res.pct}%): passed</p>}
        {m.error && <span role="alert" className="text-sm text-red-800">{m.error.message}</span>}</div>}
    </form>}</Card>;
}
function CompleteModule({ id, done, scroll, rule, passed, hasCheck, onDone }: { id: string; done: boolean; scroll: number; rule: any; passed: boolean; hasCheck: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: (completed: boolean) => post<{ progress: any }>(`/api/resources/${id}/complete`, { completed }), onSuccess: (r) => { qc.setQueryData(['resource', id], (old: any) => (old ? { ...old, progress: { ...old.progress, ...r.progress } } : old)); onDone(); } });
  const needScroll = rule && scroll < rule.minScrollPct;
  return <Card className={done ? 'border-emerald-600' : ''}><div className="flex flex-wrap items-center gap-3">{done ? <p className="inline-flex items-center gap-1 font-medium text-emerald-800"><CheckCircle2 className="h-5 w-5" aria-hidden />Module completed.</p> : <>
    <ul className="text-sm"><li>{needScroll ? '○' : '✓'} Read to the end{rule ? ` (${Math.min(scroll, 100)}% read)` : ''}</li>{hasCheck && <li>{passed ? '✓' : '○'} Pass the knowledge check{rule ? ` (${rule.passMarkPct}%)` : ''}</li>}</ul>
    <Button loading={m.isPending} onClick={() => m.mutate(true)}>Mark as completed</Button></>}
    {m.error && <span role="alert" className="text-sm text-red-800">{m.error.message}</span>}</div></Card>;
}
