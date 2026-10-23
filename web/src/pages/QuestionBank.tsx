import { apiBase } from '../lib/apiBase';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@ghlearn/shared';
import { Sparkles, Plus, CheckCircle2, ShieldCheck } from 'lucide-react';
import { api, post, patch, del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { QuestionInput, ResultBox } from '../components/QuestionInput';
import { ConfirmButton } from '../components/ConfirmDialog';
import { useUrlState } from '../admin/DataTable';
import { QUESTION_STATUS_LABEL, REVIEW_ACTION_LABEL, statusTone } from '../lib/lessonStatus';
import { Estimate } from './Lessons';

export const QTYPES = ['mcq', 'true_false', 'short_answer', 'gap_fill', 'matching', 'ordering', 'diagram_labelling', 'numerical', 'structured', 'essay', 'case_study'];
const TEMPLATES: Record<string, any> = {
  mcq: { options: ['', '', '', ''], correctIndex: 0 }, true_false: { answer: true }, short_answer: { acceptedAnswers: [''], allowSpelling: true }, gap_fill: { text: 'The {{1}} ...', gaps: [{ accepted: [''] }] },
  matching: { pairs: [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }] }, ordering: { items: ['', '', ''] }, diagram_labelling: { centre: '', labels: [{ accepted: [''] }, { accepted: [''] }], alt: '' },
  numerical: { value: 0, tolerance: 0, toleranceType: 'abs', unit: '', requireUnit: false, workedSolution: '' }, structured: { parts: [{ prompt: '', type: 'short_answer', acceptedAnswers: [''], marks: 1 }] },
  essay: { guidance: '', wordLimit: 300 }, case_study: { scenario: '', parts: [{ prompt: '', type: 'mcq', options: ['', ''], correctIndex: 0, marks: 1 }, { prompt: '', type: 'essay', rubric: [{ criterion: 'Reasoning', maxMarks: 3 }] }] },
};
const KEY_HELP: Record<string, string> = {
  mcq: 'options: 2 to 6 choices; correctIndex: the correct option, counting from 0. Options are shuffled for students.',
  true_false: 'answer: true or false.', short_answer: 'acceptedAnswers: every acceptable answer (case-insensitive); or keywords with minKeywords for longer answers.',
  gap_fill: 'text: the sentence with {{1}}, {{2}} … blanks; gaps: accepted answers for each blank, in order.', matching: 'pairs: each left item with its correct right match (2 to 10).',
  ordering: 'items: listed in the CORRECT order; students see them shuffled.', diagram_labelling: 'centre: what is drawn; labels: accepted names for each numbered label; alt: a description that does not give the answers away.',
  numerical: 'value, tolerance (abs or pct), unit; requireUnit makes the unit part of the answer.', structured: 'parts: each with prompt, type (short_answer, numerical, mcq or essay), marks and that type’s key. Essay parts need a rubric and are teacher-marked.',
  essay: 'guidance: model answer points for markers; wordLimit. The rubric below sets the marks.', case_study: 'scenario plus parts (as for structured). Essay parts are teacher-marked.',
};
const St = ({ v }: { v: string }) => <span className={`rounded px-2 py-0.5 text-xs ${statusTone(v)}`}>{QUESTION_STATUS_LABEL[v] ?? v}</span>;
const typeLabel = (types: any[] | undefined, t: string) => types?.find((x) => x.key === t)?.label ?? t.replace(/_/g, ' ');
const MarkTag = ({ q }: { q: any }) => q.teacherMarked ? <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-900">Teacher-marked{['structured', 'case_study'].includes(q.type) ? ' parts' : ''}</span> : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">Auto-marked</span>;
const useTypes = () => useQuery({ queryKey: ['qtypes'], queryFn: () => api<any>('/api/questions/types'), staleTime: 3600_000 });
const useSubjects = () => useQuery({ queryKey: ['/api/config/subjects'], queryFn: () => api<{ items: any[] }>('/api/config/subjects').then((r) => r.items) });
const parseJson = (s: string, what: string) => { try { return JSON.parse(s); } catch { throw new Error(`${what} is not valid JSON`); } };

/** Structured question editor (§13): links, difficulty, marks, time limit, answer key and rubric, with a server-side answer-key check. */
export function QuestionEditor({ initial, onDone }: { initial?: any; onDone: (q?: any) => void }) {
  const subjects = useSubjects(); const types = useTypes();
  const [f, setF] = useState<any>(initial ? { ...initial, subjectId: initial.subjectId?._id ?? initial.subjectId, timeLimitSec: initial.timeLimitSec ?? '' } : { type: 'mcq', difficulty: 'medium', marks: 1, topic: '', stem: '', explanation: '', subjectId: '', objective: '', strand: '', yearOfStudy: '', timeLimitSec: '', hint: '' });
  const [data, setData] = useState(JSON.stringify(initial?.data ?? TEMPLATES[f.type], null, 2)); const [rubric, setRubric] = useState(JSON.stringify(initial?.rubric?.length ? initial.rubric : [{ criterion: 'Knowledge and understanding', maxMarks: 4, descriptors: [] }], null, 2));
  const body = () => ({ subjectId: f.subjectId, topic: f.topic, objective: f.objective || undefined, strand: f.strand || undefined, yearOfStudy: f.yearOfStudy ? Number(f.yearOfStudy) : undefined, type: f.type, difficulty: f.difficulty, stem: f.stem, marks: Number(f.marks) || 1,
    timeLimitSec: f.timeLimitSec ? Number(f.timeLimitSec) : initial ? null : undefined, explanation: f.explanation || undefined, hint: f.hint || undefined, data: parseJson(data, 'The answer key'), rubric: f.type === 'essay' ? parseJson(rubric, 'The rubric') : [] });
  const check = useMutation({ mutationFn: () => { const b: any = body(); if (!b.subjectId) delete b.subjectId; if (!b.timeLimitSec) delete b.timeLimitSec; return post<any>('/api/questions/validate', b); } });
  const m = useMutation({ mutationFn: () => { const b: any = body(); if (initial) { const { subjectId: _s, type: _t, ...rest } = b; return patch<any>(`/api/questions/${initial._id}`, rest); } return post<any>('/api/questions', b); }, onSuccess: (r) => onDone(r.question) });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const info = types.data?.types.find((t: any) => t.key === f.type);
  return <Card><form aria-label={initial ? 'Edit question' : 'New question'} onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
    <h2 className="mb-2 font-semibold">{initial ? `Edit question (version ${initial.version ?? 1})` : 'New question'}</h2>
    <div className="grid gap-3 sm:grid-cols-3">
      <Select label="Subject" value={f.subjectId} disabled={!!initial} required onChange={s('subjectId')}><option value="">Choose…</option>{subjects.data?.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select>
      <Select label="Question type" value={f.type} disabled={!!initial} onChange={(e) => { setF({ ...f, type: e.target.value }); setData(JSON.stringify(TEMPLATES[e.target.value], null, 2)); check.reset(); }}>{QTYPES.map((t) => <option key={t} value={t}>{typeLabel(types.data?.types, t)}</option>)}</Select>
      <Select label="Difficulty" value={f.difficulty} onChange={s('difficulty')}>{['easy', 'medium', 'hard'].map((t) => <option key={t}>{t}</option>)}</Select>
      <Input label="Topic" required value={f.topic} onChange={s('topic')} /><Input label="Learning objective" value={f.objective ?? ''} onChange={s('objective')} /><Input label="Strand (optional)" value={f.strand ?? ''} onChange={s('strand')} />
      <Input label="Year of study (optional)" type="number" min={1} max={6} value={f.yearOfStudy ?? ''} onChange={s('yearOfStudy')} />
      <Input label="Marks" type="number" min={1} max={100} value={f.marks} onChange={s('marks')} hint="Rubric or parts totals override this." />
      <Input label="Time limit in seconds (optional)" type="number" min={10} max={3600} value={f.timeLimitSec} onChange={s('timeLimitSec')} hint="Used as the default assessment time when every question has one." />
      <div className="sm:col-span-3"><label className="text-sm font-medium" htmlFor="qstem">Question</label><textarea id="qstem" required className="h-20 w-full rounded border p-2" value={f.stem} onChange={s('stem')} /></div>
      <div className="sm:col-span-2"><label className="text-sm font-medium" htmlFor="qdata">Answer key and options (JSON)</label><p id="qdata-help" className="text-xs text-slate-600">{KEY_HELP[f.type]}</p>
        <textarea id="qdata" aria-describedby="qdata-help" className="h-56 w-full rounded border p-2 font-mono text-xs" value={data} onChange={(e) => setData(e.target.value)} /></div>
      <div className="space-y-2">{f.type === 'essay' && <div><label className="text-sm font-medium" htmlFor="rub">Rubric (JSON)</label><p className="text-xs text-slate-600">criterion, maxMarks and optional descriptors (marks, description).</p><textarea id="rub" className="h-40 w-full rounded border p-2 font-mono text-xs" value={rubric} onChange={(e) => setRubric(e.target.value)} /></div>}
        <Input label="Explanation (feedback after answering)" value={f.explanation ?? ''} onChange={s('explanation')} /><Input label="Hint (optional)" value={f.hint ?? ''} onChange={s('hint')} />
        {info && <p className="rounded bg-slate-50 p-2 text-xs"><strong>{info.marking === 'teacher' ? 'Teacher-marked.' : info.marking === 'mixed' ? 'Auto-marked, essay parts teacher-marked.' : 'Auto-marked.'}</strong> {info.note}</p>}</div>
    </div>
    {check.data && <KeyCheck r={check.data} />}{check.error && <Alert>{check.error.message}</Alert>}
    {m.error && <Alert>{m.error.message}</Alert>}
    <div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="ghost" loading={check.isPending} onClick={() => check.mutate()}><ShieldCheck className="h-4 w-4" aria-hidden />Check answer key</Button>
      <Button type="submit" loading={m.isPending}>{initial ? 'Save changes' : 'Save as draft'}</Button><Button type="button" variant="ghost" onClick={() => onDone()}>Cancel</Button></div>
  </form></Card>;
}
function KeyCheck({ r }: { r: any }) {
  return <section aria-label="Answer key check" className="mt-3 rounded border bg-slate-50 p-3 text-sm">
    {r.validation.ok ? <p className="flex items-center gap-1 font-medium text-brand-900"><CheckCircle2 className="h-4 w-4" aria-hidden />The answer key is consistent ({r.marks} mark{r.marks === 1 ? '' : 's'}).</p> : <p className="font-medium text-red-800">The answer key has problems:</p>}
    {r.validation.errors.map((e: string) => <p key={e} className="text-red-800">✗ {e}</p>)}{r.validation.warnings.map((e: string) => <p key={e} className="text-amber-900">⚠ {e}</p>)}
    {r.selfCheck && <p>Marking the key as a student answer scores {r.selfCheck.score}/{r.selfCheck.maxScore}{r.selfCheck.ok ? ' (full marks).' : ': check the key.'}</p>}
    {r.teacherMarked && <p>Written answers are teacher-marked against the rubric.</p>}
    {r.preview && <details><summary>What students see</summary><div className="mt-1 rounded border bg-white p-2"><p className="mb-1">{r.preview.stem}</p><QuestionInput q={{ ...r.preview, svg: r.svg }} value={null} onChange={() => {}} disabled /></div></details>}</section>;
}

function QuestionList({ subjects, review }: { subjects: any[]; review?: boolean }) {
  const u = useUrlState(); const types = useTypes();
  const qs = new URLSearchParams(Object.entries({ subjectId: u.get('subjectId'), status: review ? '' : u.get('status'), review: review ? 'queue' : '', type: u.get('type'), difficulty: u.get('difficulty'), search: u.get('search'), page: u.get('page') }).filter(([, v]) => v) as any).toString();
  const list = useQuery({ queryKey: ['questions', qs], queryFn: () => api<{ items: any[]; total: number; topics: string[] }>(`/api/questions?${qs}`) });
  const page = Number(u.get('page') || 1);
  return <Card><div className="grid gap-2 sm:grid-cols-5">
      <Select label="Subject filter" value={u.get('subjectId')} onChange={(e) => u.set({ subjectId: e.target.value || undefined })}><option value="">All subjects</option>{subjects.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select>
      {!review && <Select label="Status filter" value={u.get('status')} onChange={(e) => u.set({ status: e.target.value || undefined })}><option value="">Any</option>{Object.entries(QUESTION_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
      <Select label="Type filter" value={u.get('type')} onChange={(e) => u.set({ type: e.target.value || undefined })}><option value="">Any</option>{QTYPES.map((x) => <option key={x} value={x}>{typeLabel(types.data?.types, x)}</option>)}</Select>
      <Select label="Difficulty filter" value={u.get('difficulty')} onChange={(e) => u.set({ difficulty: e.target.value || undefined })}><option value="">Any</option>{['easy', 'medium', 'hard'].map((x) => <option key={x}>{x}</option>)}</Select>
      <Input label="Search question text" value={u.get('search')} onChange={(e) => u.set({ search: e.target.value || undefined })} /></div>
    {list.isLoading ? <Spinner /> : list.error ? <Alert>{list.error.message}</Alert> : <>
      <p className="mt-2 text-sm text-slate-600" role="status">{list.data!.total} question(s){review ? ' awaiting review' : ''}</p>
      <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="mt-2 w-full text-left text-sm"><caption className="sr-only">{review ? 'Questions awaiting review' : 'Questions'}</caption>
        <thead><tr className="border-b"><th className="py-1">Question</th><th>Type</th><th>Subject · topic</th><th>Difficulty</th><th>Marks</th><th>Status</th><th>Answer key</th><th>Version</th></tr></thead>
        <tbody>{list.data!.items.map((q) => <tr key={q._id} className="border-b align-top"><td className="max-w-md py-1"><Link className="text-brand-700 underline" to={`/admin/questions/${q._id}`}>{q.stem.length > 110 ? `${q.stem.slice(0, 110)}…` : q.stem}</Link>{q.aiGenerated && <span className="ml-1 text-xs text-slate-600">(AI draft)</span>}</td>
          <td>{typeLabel(types.data?.types, q.type)}<div><MarkTag q={q} /></div></td><td>{q.subjectId?.name} · {q.topic}</td><td>{q.difficulty}</td><td>{q.marks}{q.timeLimitSec ? ` · ${q.timeLimitSec}s` : ''}</td><td><St v={q.status} /></td>
          <td>{q.keyVerified ? 'Verified' : q.validation && !q.validation.ok ? <span className="text-red-800">Invalid</span> : 'Not verified'}</td><td>{q.version ?? 1}</td></tr>)}</tbody></table></div>
      {!list.data!.items.length && <p className="text-sm">{review ? 'Nothing is waiting for review.' : 'No questions match.'}</p>}
      {list.data!.total > 50 && <nav aria-label="Pages" className="mt-2 flex gap-2"><Button variant="ghost" disabled={page <= 1} onClick={() => u.set({ page: String(page - 1) }, false)}>Previous</Button><span className="self-center text-sm">Page {page} of {Math.ceil(list.data!.total / 50)}</span><Button variant="ghost" disabled={page * 50 >= list.data!.total} onClick={() => u.set({ page: String(page + 1) }, false)}>Next</Button></nav>}</>}</Card>;
}

function GenerateQuestions({ subjects }: { subjects: any[] }) {
  const types = useTypes(); const qc = useQueryClient();
  const [g, setG] = useState({ subjectId: '', topic: '', objective: '', count: '6', difficulty: 'mixed', types: ['mcq', 'true_false', 'short_answer'] as string[] }); const [jobId, setJobId] = useState<string | null>(null);
  const body = () => ({ subjectId: g.subjectId, topic: g.topic, objective: g.objective || undefined, count: Number(g.count) || 1, difficulty: g.difficulty, types: g.types });
  const ready = !!g.subjectId && g.topic.trim().length >= 2 && g.types.length > 0;
  const est = useQuery({ queryKey: ['qestimate', JSON.stringify(body())], enabled: ready, retry: false, queryFn: () => post<any>('/api/questions/estimate', body()) });
  const gen = useMutation({ mutationFn: () => post<any>('/api/questions/generate', body()), onSuccess: (r) => setJobId(r.jobId) });
  const job = useQuery({ queryKey: ['qjob', jobId], enabled: !!jobId, queryFn: () => api<any>(`/api/questions/jobs/${jobId}`).then((r) => r.job), refetchInterval: (x) => (['queued', 'running'].includes(x.state.data?.status) ? 3000 : false) });
  useEffect(() => { if (job.data?.status === 'succeeded') qc.invalidateQueries({ queryKey: ['questions'] }); }, [job.data?.status]);
  return <Card><h2 className="mb-1 flex items-center gap-2 font-semibold"><Sparkles className="h-5 w-5" aria-hidden />Generate draft questions from approved manuals</h2>
    <p className="mb-2 text-sm text-slate-600">Uses only manuals a Content Reviewer verified as official. Every generated question is a draft: answer keys are cross-checked by a second AI pass and must still be verified by a reviewer.</p>
    <form aria-label="Generate questions" onSubmit={(e) => { e.preventDefault(); gen.mutate(); }}><div className="grid gap-3 sm:grid-cols-4"><Select label="Subject" value={g.subjectId} onChange={(e) => setG({ ...g, subjectId: e.target.value })}><option value="">Choose…</option>{subjects.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select>
      <Input label="Topic" value={g.topic} onChange={(e) => setG({ ...g, topic: e.target.value })} /><Input label="Objective (optional)" value={g.objective} onChange={(e) => setG({ ...g, objective: e.target.value })} />
      <div className="grid grid-cols-2 gap-2"><Input label="How many" type="number" min={1} max={15} value={g.count} onChange={(e) => setG({ ...g, count: e.target.value })} />
        <Select label="Difficulty" value={g.difficulty} onChange={(e) => setG({ ...g, difficulty: e.target.value })}>{['mixed', 'easy', 'medium', 'hard'].map((x) => <option key={x}>{x}</option>)}</Select></div>
      <fieldset className="sm:col-span-4"><legend className="text-sm font-medium">Question types</legend><div className="flex flex-wrap gap-3">{QTYPES.map((t) => <label key={t} className="text-sm"><input type="checkbox" checked={g.types.includes(t)} onChange={(e) => setG({ ...g, types: e.target.checked ? [...g.types, t] : g.types.filter((x) => x !== t) })} /> {typeLabel(types.data?.types, t)}</label>)}</div></fieldset></div>
      <div className="mt-2"><Estimate q={est} ready={ready} /></div>
      {gen.error && <Alert>{gen.error.message}</Alert>}<Button type="submit" className="mt-2" disabled={!ready || !est.data?.canGenerate} loading={gen.isPending}>Generate drafts</Button></form>
    {job.data && <p role="status" className="mt-2 text-sm">{job.data.status === 'succeeded' ? `Created ${job.data.result.created} draft(s); skipped ${job.data.result.duplicatesSkipped} near-duplicate(s); ${job.data.result.invalid} need fixes. Review them in the Questions tab (status Draft, marked AI draft).` : ['dead', 'failed'].includes(job.data.status) ? `Failed: ${job.data.errorLog?.at(-1)?.message ?? job.data.lastError ?? 'unknown error'}` : `${job.data.status}… ${job.data.progress?.step ?? ''}`}</p>}</Card>;
}

/** Assessments (§13): teachers assemble them from approved questions (Teach › Assessments); admins see all, with results. */
function AssessmentsTab() {
  const list = useQuery({ queryKey: ['assessments'], queryFn: () => api<{ items: any[] }>('/api/assessments').then((r) => r.items) }); const [open, setOpen] = useState<string | null>(null);
  const res = useQuery({ queryKey: ['results', open], enabled: !!open, queryFn: () => api<any>(`/api/assessments/${open}/results`) });
  if (list.isLoading) return <Spinner />; if (list.error) return <Alert>{list.error.message}</Alert>;
  return <Card><h2 className="font-semibold">Assessments</h2><p className="text-sm text-slate-600">Teachers build assessments from approved bank questions only, schedule them (opens/closes, time limit, attempts), and mark written answers in Teach › Assessments. Results appear here.</p>
    <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="mt-2 w-full text-left text-sm"><caption className="sr-only">Assessments</caption><thead><tr className="border-b"><th className="py-1">Title</th><th>Subject</th><th>Mode</th><th>Questions</th><th>Time limit</th><th>Closes</th><th>Status</th><th>Results</th></tr></thead>
      <tbody>{list.data!.map((a) => <tr key={a._id} className="border-b"><td className="py-1">{a.title}</td><td>{a.subjectId?.name}</td><td>{a.mode === 'mock' ? 'Mock exam' : 'Assignment'}</td><td>{a.questionIds?.length}</td><td>{a.timeLimitSec ? `${Math.round(a.timeLimitSec / 60)} min` : 'None'}</td>
        <td>{a.closesAt ? new Date(a.closesAt).toLocaleString() : 'Open-ended'}</td><td>{a.status}</td><td><Button variant="ghost" className="px-2 py-1 text-xs" aria-expanded={open === a._id} onClick={() => setOpen(open === a._id ? null : a._id)}>{open === a._id ? 'Hide' : 'Show'} results</Button></td></tr>)}</tbody></table></div>
    {!list.data!.length && <p className="text-sm">No assessments yet.</p>}
    {open && (res.isLoading ? <Spinner /> : res.data && <section aria-label="Results" className="mt-3 rounded border p-3 text-sm"><h3 className="font-medium">{res.data.assessment.title}: {res.data.attempts.length} attempt(s)</h3>
      {res.data.attempts.length ? <table className="mt-1 w-full text-left"><thead><tr className="border-b"><th>Student</th><th>Score</th><th>Status</th><th>Submitted</th></tr></thead><tbody>{res.data.attempts.map((x: any) => <tr key={x._id} className="border-b"><td className="py-1">{x.userId?.fullName}</td><td>{x.pct != null ? `${x.score}/${x.maxScore} (${x.pct}%)` : '-'}{x.provisional ? ' provisional' : ''}</td><td>{x.status.replace(/_/g, ' ')}</td><td>{x.submittedAt ? new Date(x.submittedAt).toLocaleString() : '-'}</td></tr>)}</tbody></table> : <p>No attempts yet.</p>}
      <a className="mt-2 inline-block text-brand-700 underline" href={`${apiBase()}/api/assessments/${open}/results.csv`}>Download CSV</a></section>)}</Card>;
}

export function QuestionBankPage() {
  const { user } = useAuth(); const roles = user!.roles; const nav = useNavigate(); const u = useUrlState(); const subjects = useSubjects(); const types = useTypes();
  const canEdit = hasPermission(roles, 'content:edit'), canReview = hasPermission(roles, 'content:review'), canAssess = hasPermission(roles, 'activity:assign') || hasPermission(roles, 'platform:manage');
  const tabs = [['bank', 'Questions'], ...(canReview ? [['review', 'Review queue']] : []), ...(canEdit ? [['generate', 'Generate'], ['new', 'New question']] : []), ...(canAssess ? [['assessments', 'Assessments']] : []), ['types', 'Question types']];
  const tab = u.get('tab') || 'bank';
  return <section className="space-y-4"><div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Question Bank and Assessments</h1>{canEdit && <Button onClick={() => u.set({ tab: 'new' })}><Plus className="h-4 w-4" aria-hidden />New question</Button>}</div>
    <nav aria-label="Question bank sections" className="flex flex-wrap gap-1 border-b">{tabs.map(([k, l]) => <button key={k} aria-current={tab === k ? 'page' : undefined} className={`rounded-t px-3 py-2 text-sm ${tab === k ? 'border-b-2 border-brand-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => u.set({ tab: k })}>{l}</button>)}</nav>
    {tab === 'bank' && <QuestionList subjects={subjects.data ?? []} />}
    {tab === 'review' && canReview && <QuestionList subjects={subjects.data ?? []} review />}
    {tab === 'generate' && canEdit && <GenerateQuestions subjects={subjects.data ?? []} />}
    {tab === 'new' && canEdit && <QuestionEditor onDone={(q) => (q ? nav(`/admin/questions/${q._id}`) : u.set({ tab: 'bank' }))} />}
    {tab === 'assessments' && canAssess && <AssessmentsTab />}
    {tab === 'types' && <Card><h2 className="font-semibold">Question types and marking</h2><p className="text-sm">{types.data?.teacherMarked}</p>
      <table className="mt-2 w-full text-left text-sm"><caption className="sr-only">Question types</caption><thead><tr className="border-b"><th className="py-1">Type</th><th>Marking</th><th>Notes</th></tr></thead><tbody>{types.data?.types.map((t: any) => <tr key={t.key} className="border-b"><td className="py-1">{t.label}</td><td>{t.marking === 'auto' ? 'Auto-marked' : t.marking === 'teacher' ? 'Teacher-marked' : 'Auto-marked, essay parts teacher-marked'}</td><td>{t.note}</td></tr>)}</tbody></table></Card>}
  </section>;
}

/** One question: preview as a student, answer key, review workflow, usage, versions and history. */
export function QuestionDetailPage() {
  const { id } = useParams(); const qc = useQueryClient(); const nav = useNavigate();
  const d = useQuery({ queryKey: ['question', id], queryFn: () => api<any>(`/api/questions/${id}`) });
  const [editing, setEditing] = useState(false); const [resp, setResp] = useState<any>(null); const [verified, setVerified] = useState(false); const [comment, setComment] = useState(''); const [ver, setVer] = useState<number | null>(null);
  const mark = useMutation({ mutationFn: () => post<any>(`/api/questions/${id}/preview-mark`, { response: resp }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['question', id] }); qc.invalidateQueries({ queryKey: ['questions'] }); };
  const act = useMutation({ mutationFn: ({ path, body }: { path: string; body?: any }) => post<any>(`/api/questions/${id}/${path}`, body ?? {}), onSuccess: (r, v) => { setComment(''); setVerified(false); if (v.path === 'duplicate') nav(`/admin/questions/${r.question._id}`); else refresh(); } });
  const remove = useMutation({ mutationFn: () => del(`/api/questions/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['questions'] }); nav('/admin/questions'); } });
  const version = useQuery({ queryKey: ['qversion', id, ver], enabled: ver != null, queryFn: () => api<any>(`/api/questions/${id}/versions/${ver}`).then((r) => r.version) });
  if (d.isLoading) return <Spinner />; if (d.error) return <Alert>{d.error.message}</Alert>;
  const { question: q, preview, answer, usage, versions, reviews, permissions: p, typeInfo } = d.data;
  if (editing) return <section className="space-y-4"><QuestionEditor initial={q} onDone={(r) => { setEditing(false); if (r) refresh(); }} /></section>;
  const doAct = (path: string, body?: any) => act.mutateAsync({ path, body });
  return <section className="space-y-4">
    <Link to="/admin/questions" className="text-sm text-brand-700 underline">← Question bank</Link>
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold">{typeInfo?.label ?? q.type} question</h1><St v={q.status} /><MarkTag q={q} /><span className="text-sm text-slate-600">Version {q.version ?? 1}</span>
      {q.keyVerified ? <span className="rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-900">Answer key verified by {q.keyVerifiedBy?.fullName}</span> : <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-900">Answer key not verified</span>}
      {q.crossCheck && <span className={`rounded px-2 py-0.5 text-xs ${q.crossCheck === 'agreed' ? 'bg-brand-50 text-brand-900' : 'bg-red-50 text-red-800'}`}>AI cross-check {q.crossCheck}</span>}</div>
    <p className="text-sm text-slate-600">{q.subjectId?.name} · {q.topic}{q.objective ? ` · Objective: ${q.objective}` : ''} · {q.difficulty} · {q.marks} mark{q.marks === 1 ? '' : 's'}{q.timeLimitSec ? ` · ${q.timeLimitSec}s` : ''}{q.yearOfStudy ? ` · Year ${q.yearOfStudy}` : ''} · created by {q.createdBy?.fullName ?? 'unknown'}{q.aiGenerated ? ` (AI draft, ${q.aiModel ?? 'model'})` : ''}</p>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Card><h2 className="mb-2 font-semibold">Preview as a student</h2><p className="mb-2">{preview.stem}</p><QuestionInput q={{ ...preview, svg: d.data.svg }} value={resp} onChange={setResp} />
        <div className="mt-2 flex gap-2"><Button disabled={resp == null} loading={mark.isPending} onClick={() => mark.mutate()}>Check answer</Button><Button variant="ghost" onClick={() => { setResp(null); mark.reset(); }}>Reset</Button>{answer != null && <Button variant="ghost" onClick={() => setResp(answer)}>Fill in the key</Button>}</div>
        {mark.data && <div className="mt-2"><ResultBox r={mark.data.mark} /><p className="text-xs text-slate-600">{mark.data.note}</p></div>}{mark.error && <Alert>{mark.error.message}</Alert>}</Card>
      <Card><h2 className="mb-2 font-semibold">Answer key{q.rubric?.length ? ' and rubric' : ''}</h2>
        <pre tabIndex={0} aria-label="Answer key" className="max-h-64 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify({ ...q.data, ...(q.rubric?.length ? { rubric: q.rubric } : {}) }, null, 1)}</pre>
        {q.explanation && <p className="mt-2 text-sm"><strong>Explanation:</strong> {q.explanation}</p>}{q.hint && <p className="text-sm"><strong>Hint:</strong> {q.hint}</p>}
        <p className="text-sm"><strong>Sources:</strong> {q.citations?.length ? q.citations.map((c: any, i: number) => <span key={i}>{c.pageStart ? `p.${c.pageStart}${c.pageEnd && c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ''}` : 'document'}{i < q.citations.length - 1 ? ', ' : ''}</span>) : 'none recorded'}</p>
        {q.validation && <div className="mt-1 text-sm">{q.validation.ok && !q.validation.warnings.length && <p className="text-brand-900">✓ Automatic checks passed.</p>}{q.validation.errors.map((e: string) => <p key={e} className="text-red-800">✗ {e}</p>)}{q.validation.warnings.map((e: string) => <p key={e} className="text-amber-900">⚠ {e}</p>)}</div>}
        {q.reviewComment && <p className="mt-1 text-sm"><strong>Last review note:</strong> {q.reviewComment}</p>}</Card>
    </div>
    <Card><h2 className="mb-2 font-semibold">Workflow</h2>
      <div className="flex flex-wrap gap-2">
        {p.edit && <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>}
        {p.submit && <ConfirmButton tone="primary" variant="primary" className="px-3 py-1.5 text-sm" label={q.status === 'changes_requested' ? 'Resubmit for review' : 'Submit for review'} title="Submit this question for review?" body={<p>A Content Reviewer who did not write or edit it will check the answer key. You cannot edit it while it is being reviewed.</p>} onConfirm={() => doAct('submit')} />}
        {p.revise && <ConfirmButton tone="primary" variant="ghost" className="px-3 py-1.5 text-sm" label="Revise" title="Take this question back to draft?" body={<p>It leaves the bank (no new assessments or games can use it) until it is approved again as a new version.</p>} onConfirm={() => doAct('revise')} />}
        {p.duplicate && <ConfirmButton tone="primary" variant="ghost" className="px-3 py-1.5 text-sm" label="Duplicate" title="Make a draft copy?" body={<p>Creates a new draft with the same content, authored by you. The original is unchanged.</p>} onConfirm={() => doAct('duplicate')} />}
        {p.archive && <ConfirmButton className="px-3 py-1.5 text-sm" label="Archive" title="Archive this question?" body={<p>It is removed from the bank, practice and games. Past attempts keep their marks. It can be restored to draft later.</p>} onConfirm={() => doAct('archive', {})} />}
        {p.restore && <ConfirmButton tone="primary" variant="ghost" className="px-3 py-1.5 text-sm" label="Restore to draft" title="Restore this question?" body={<p>It returns as a draft and needs review again.</p>} onConfirm={() => doAct('restore')} />}
        {p.delete && <ConfirmButton className="px-3 py-1.5 text-sm" label="Delete draft" title="Delete this draft permanently?" body={<p>It has never been approved or used. This cannot be undone.</p>} onConfirm={() => remove.mutateAsync()} />}
      </div>
      {!p.archive && p.archiveBlock && <p className="mt-2 text-sm text-slate-600">Cannot archive: {p.archiveBlock}.</p>}
      {['in_review', 'resubmitted'].includes(q.status) && (p.decide ? <form aria-label="Review" className="mt-3 space-y-2 rounded border p-3" onSubmit={(e) => e.preventDefault()}>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /><span>I checked the answer key{q.rubric?.length || q.teacherMarked ? ' and rubric' : ''} against the source, and it is correct and unambiguous.</span></label>
        <div><label className="text-sm font-medium" htmlFor="rcomment">Comment {q.crossCheck === 'disagreed' ? '(required: the AI cross-check disagreed)' : '(required to request changes or reject)'}</label><textarea id="rcomment" className="h-16 w-full rounded border p-2 text-sm" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        <div className="flex flex-wrap gap-2"><ConfirmButton tone="primary" variant="primary" className="px-3 py-1.5 text-sm" disabled={!verified} label="Approve" title="Approve this question?" body={<p>It goes into the bank: teachers can use it in assessments, and it appears in practice and games. Your answer-key verification is recorded.</p>} onConfirm={() => doAct('review', { action: 'approve', answerKeyVerified: true, comment: comment || undefined })} />
          <ConfirmButton tone="primary" variant="ghost" className="px-3 py-1.5 text-sm" disabled={!comment.trim()} label="Request changes" title="Send back to the author?" body={<p>The author sees your comment and can edit and resubmit.</p>} onConfirm={() => doAct('review', { action: 'request_changes', comment })} />
          <ConfirmButton className="px-3 py-1.5 text-sm" disabled={!comment.trim()} label="Reject" title="Reject this question?" body={<p>It will not enter the bank. The author can still edit it into a new draft.</p>} onConfirm={() => doAct('review', { action: 'reject', comment })} /></div></form>
        : <p className="mt-2 text-sm text-slate-600">{p.decideBlock}</p>)}
      {(act.error || remove.error) && <Alert>{(act.error ?? remove.error)!.message}</Alert>}</Card>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Card><h2 className="mb-2 font-semibold">Usage</h2><dl className="grid grid-cols-2 gap-1 text-sm"><dt>Answered</dt><dd>{usage.responses} time(s){usage.averagePct != null ? ` · average ${usage.averagePct}%` : ''}</dd><dt>In assessments</dt><dd>{usage.assessmentResponses} answer(s)</dd><dt>Game sessions</dt><dd>{usage.gameSessions}</dd></dl>
        <h3 className="mt-2 text-sm font-medium">Assessments using it</h3>{usage.assessments.length ? <ul className="list-disc pl-5 text-sm">{usage.assessments.map((a: any) => <li key={a._id}>{a.title} ({a.mode === 'mock' ? 'mock exam' : 'assignment'}, {a.open ? 'open' : a.status}{a.school ? `, ${a.school}` : ''})</li>)}</ul> : <p className="text-sm">None.</p>}
        <h3 className="mt-2 text-sm font-medium">Games using it</h3>{usage.gameDesigns.length ? <ul className="list-disc pl-5 text-sm">{usage.gameDesigns.map((g: any) => <li key={g._id}><Link className="text-brand-700 underline" to={`/admin/games/${g._id}`}>{g.title}</Link> ({g.status})</li>)}</ul> : <p className="text-sm">None.</p>}</Card>
      <Card><h2 className="mb-2 font-semibold">Versions and history</h2>
        <ul className="text-sm">{versions.map((v: any) => <li key={v.version} className="flex items-center justify-between border-b py-1"><span>Version {v.version}: {v.reason} · {v.by ?? 'unknown'} · {new Date(v.at).toLocaleString()}</span><Button variant="ghost" className="px-2 py-0.5 text-xs" aria-label={`Compare version ${v.version}`} onClick={() => setVer(ver === v.version ? null : v.version)}>{ver === v.version ? 'Hide' : 'Compare'}</Button></li>)}</ul>
        {ver != null && version.data && <div className="mt-2 grid gap-2 sm:grid-cols-2 text-xs"><div><p className="font-medium">Version {ver}</p><pre tabIndex={0} className="max-h-48 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify({ stem: version.data.snapshot.stem, data: version.data.snapshot.data, rubric: version.data.snapshot.rubric, marks: version.data.snapshot.marks }, null, 1)}</pre></div>
          <div><p className="font-medium">Current (version {q.version ?? 1})</p><pre tabIndex={0} className="max-h-48 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify({ stem: q.stem, data: q.data, rubric: q.rubric, marks: q.marks }, null, 1)}</pre></div></div>}
        <h3 className="mt-3 text-sm font-medium">Review log</h3><ol className="text-sm">{reviews.map((r: any, i: number) => <li key={i} className="border-b py-1">{REVIEW_ACTION_LABEL[r.action] ?? r.action} (v{r.version}) by {r.by ?? 'unknown'}, {new Date(r.at).toLocaleString()}{r.comment ? `: “${r.comment}”` : ''}</li>)}</ol></Card>
    </div></section>;
}
