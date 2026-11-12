import { DataTable, useUrlState } from '../admin/DataTable';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@ghlearn/shared';
import { Sparkles, RefreshCw, History, Send, BookOpen, Gauge } from 'lucide-react';
import { api, post, patch, del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { ConfirmButton } from '../components/ConfirmDialog';
import { Section } from '../components/LessonView';
import { LESSON_STATUS_LABEL, LESSON_STATUSES, REVIEW_ACTION_LABEL, statusTone } from '../lib/lessonStatus';

const St = ({ v }: { v: string }) => <span className={`rounded px-2 py-0.5 text-xs ${statusTone(v)}`}>{LESSON_STATUS_LABEL[v] ?? v}</span>;
const cfg = (k: string, enabled = true) => ({ queryKey: ['/api/config/' + k], enabled, queryFn: () => api<{ items: any[] }>('/api/config/' + k).then((r) => r.items) });
const usd = (n: number | null | undefined) => (n == null ? 'not configured' : n < 0.01 ? `< $0.01 (${n.toFixed(5)})` : `$${n.toFixed(2)}`);
function useDebounced<T>(v: T, ms = 500) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; }
const Check = ({ label, ...p }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => <label className="flex items-center gap-1 text-sm"><input type="checkbox" {...p} /> {label}</label>;

const INIT = { contentType: 'lesson', subjectId: '', topic: '', subtopic: '', nodeId: '', strand: '', subStrand: '', indicator: '', yearOfStudy: '1', programmeId: '', curriculumVersionId: '', pageFrom: '', pageTo: '',
  depth: 'standard', readingLevel: 'standard', length: 'medium', durationMinutes: '', numActivities: '2', numExercises: '5', numQuizQuestions: '5', easy: '40', medium: '40', hard: '20',
  illustrations: 'diagrams', numDiagrams: '2', includeGhanaContext: true, language: 'en', teacherNotes: '', sections: [] as string[] };

/** §11 AI generation workspace: request a resource or a whole lesson from approved, current manuals, with a live estimate. */
export function LessonsPage() {
  const { user } = useAuth(); const nav = useNavigate();
  const canEdit = hasPermission(user!.roles, 'content:edit');
  const subjects = useQuery(cfg('subjects'));
  return <section className="space-y-4"><h1 className="text-2xl font-bold">AI generation workspace</h1>
    <p className="text-sm text-slate-600">Content is generated only from manuals a Content Reviewer has verified as official. Every draft is reviewed before anyone else can see it.</p>
    {canEdit ? <GenerateForm subjects={subjects.data ?? []} onDone={(id) => nav(`/admin/lessons/${id}`)} /> : <Alert tone="info">You can review content here. Generating content needs the Curriculum Editor role.</Alert>}
    <LessonList subjects={subjects.data ?? []} /></section>;
}

function GenerateForm({ subjects, onDone }: { subjects: any[]; onDone: (id: string) => void }) {
  const [f, setF] = useState(INIT); const [docIds, setDocIds] = useState<string[]>([]);
  const opts = useQuery({ queryKey: ['lesson-options'], queryFn: () => api<any>('/api/lessons/options') });
  const programmes = useQuery(cfg('programmes')); const versions = useQuery({ queryKey: ['cur-versions'], queryFn: () => api<any>('/api/curriculum/versions?pageSize=100').then((r) => r.items as any[]) });
  const scope = useQuery({ queryKey: ['lesson-scope', f.subjectId, f.curriculumVersionId], enabled: !!f.subjectId,
    queryFn: () => api<any>(`/api/lessons/scope?subjectId=${f.subjectId}${f.curriculumVersionId ? `&curriculumVersionId=${f.curriculumVersionId}` : ''}`) });
  const type = opts.data?.contentTypes.find((t: any) => t.id === f.contentType);
  useEffect(() => { if (opts.data && !f.sections.length) setF((x) => ({ ...x, sections: opts.data.lessonSections })); }, [opts.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = (k: keyof typeof INIT) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const sum = Number(f.easy) + Number(f.medium) + Number(f.hard);
  const body = useMemo(() => ({ contentType: f.contentType, subjectId: f.subjectId, topic: f.topic.trim(), subtopic: f.subtopic.trim() || undefined, nodeId: f.nodeId || undefined,
    strand: f.nodeId ? undefined : f.strand || undefined, subStrand: f.nodeId ? undefined : f.subStrand || undefined, indicator: f.nodeId ? undefined : f.indicator || undefined,
    yearOfStudy: Number(f.yearOfStudy), programmeId: f.programmeId || undefined, curriculumVersionId: f.curriculumVersionId || undefined, documentIds: docIds.length ? docIds : undefined,
    pageFrom: docIds.length === 1 ? num(f.pageFrom) : undefined, pageTo: docIds.length === 1 ? num(f.pageTo) : undefined,
    controls: { depth: f.depth, readingLevel: f.readingLevel, length: f.length, durationMinutes: num(f.durationMinutes), numActivities: Number(f.numActivities), numExercises: Number(f.numExercises), numQuizQuestions: Number(f.numQuizQuestions),
      difficulty: { easy: Number(f.easy), medium: Number(f.medium), hard: Number(f.hard) }, illustrations: f.illustrations, includeDiagrams: f.illustrations === 'diagrams', numDiagrams: Number(f.numDiagrams),
      includeGhanaContext: f.includeGhanaContext, language: f.language, teacherNotes: f.teacherNotes || undefined, ...(f.contentType === 'lesson' ? { sections: f.sections } : {}) } }), [f, docIds]);
  const ready = !!f.subjectId && f.topic.trim().length >= 3 && sum === 100 && (f.contentType !== 'lesson' || f.sections.length > 0);
  const dBody = useDebounced(JSON.stringify(body));
  const est = useQuery({ queryKey: ['lesson-estimate', dBody], enabled: ready, retry: false, queryFn: () => post<any>('/api/lessons/estimate', JSON.parse(dBody)) });
  const m = useMutation({ mutationFn: () => post<any>('/api/lessons', body), onSuccess: (r) => onDone(r.lesson._id) });
  const nodes = (scope.data?.nodes ?? []).filter((n: any) => !docIds.length || docIds.includes(n.documentId));
  if (opts.isLoading) return <Spinner />; if (opts.error) return <Alert>{opts.error.message}</Alert>;
  const o = opts.data;
  return <Card><h2 className="mb-1 flex items-center gap-2 font-semibold"><Sparkles className="h-5 w-5" aria-hidden />Generate content</h2>
    <p className="mb-3 text-xs text-slate-600">AI provider: {o.provider ?? 'not configured'}</p>
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} aria-label="Generate content">
      <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-1 text-sm font-semibold">What to create</legend>
        <Select label="Content type" value={f.contentType} onChange={s('contentType')}>{o.contentTypes.map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
        <div className="text-xs text-slate-600 sm:col-span-2"><p>{type && (type.id === 'lesson' ? 'A full lesson with the sections you choose.' : `Sections ${type.sections.join(', ')}${type.audience.length === 1 ? ` · visible to ${type.audience[0]}s only once published` : ''}.`)}</p>
          <p className="mt-1">Not available here: {o.unavailable.map((u: any) => `${u.label} (${u.reason})`).join('; ')}</p></div>
        <Select label="Subject" value={f.subjectId} onChange={(e) => { setDocIds([]); setF({ ...f, subjectId: e.target.value, nodeId: '', pageFrom: '', pageTo: '' }); }}><option value="">Choose…</option>{subjects.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select>
        <Input label="Topic" value={f.topic} onChange={s('topic')} required minLength={3} /><Input label="Subtopic (optional)" value={f.subtopic} onChange={s('subtopic')} />
        <Select label="Year of study" value={f.yearOfStudy} onChange={s('yearOfStudy')}>{[1, 2, 3].map((y) => <option key={y} value={y}>Year {y}</option>)}</Select>
        <Select label="Programme (optional)" value={f.programmeId} onChange={s('programmeId')}><option value="">Any programme</option>{programmes.data?.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</Select>
        <Select label="Curriculum version (optional)" value={f.curriculumVersionId} onChange={(e) => { setDocIds([]); setF({ ...f, curriculumVersionId: e.target.value, nodeId: '' }); }}><option value="">Any version</option>{versions.data?.map((v) => <option key={v._id} value={v._id}>{v.code} {v.name}</option>)}</Select>
      </fieldset>
      {f.subjectId && <fieldset className="space-y-2"><legend className="text-sm font-semibold">Source manuals (approved, current)</legend>
        {scope.isLoading ? <Spinner /> : !scope.data?.documents.length ? <Alert>No approved manual for this subject{f.curriculumVersionId ? ' and version' : ''}. A Content Reviewer must verify a manual as official before content can be generated.</Alert>
          : <div className="flex flex-wrap gap-3">{scope.data.documents.map((d: any) => <Check key={d.id} label={d.title} checked={docIds.includes(d.id)} onChange={(e) => setDocIds(e.target.checked ? [...docIds, d.id] : docIds.filter((x) => x !== d.id))} />)}</div>}
        <p className="text-xs text-slate-600">{docIds.length ? `${docIds.length} selected.` : 'None selected: all approved manuals of the subject are searched.'}{scope.data?.notApproved?.length ? ` Not usable until verified: ${scope.data.notApproved.map((d: any) => d.title).join(', ')}.` : ''}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="From page" type="number" min={1} value={f.pageFrom} onChange={s('pageFrom')} disabled={docIds.length !== 1} hint={docIds.length !== 1 ? 'Select exactly one manual to limit pages' : undefined} />
          <Input label="To page" type="number" min={1} value={f.pageTo} onChange={s('pageTo')} disabled={docIds.length !== 1} />
        </div></fieldset>}
      {f.subjectId && <fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-1 text-sm font-semibold">Curriculum mapping</legend>
        <div className="sm:col-span-3"><Select label="Curriculum element from the manual" value={f.nodeId} onChange={s('nodeId')}><option value="">None (type the mapping below)</option>
          {nodes.map((n: any) => <option key={n.id} value={n.id}>{n.type}: {n.code ? `${n.code} ` : ''}{n.title}{n.page ? ` (p.${n.page})` : ''}{n.verified ? ' ✓ verified' : ' (unverified extraction)'}</option>)}</Select>
          <p className="mt-1 text-xs text-slate-600">{f.nodeId ? 'Strand, sub-strand and indicator are taken from this element of the manual.' : 'Typed text is labelled “entered by editor”: it is not shown as an official indicator. The AI never adds indicators.'}</p></div>
        {!f.nodeId && <><Input label="Strand (optional)" value={f.strand} onChange={s('strand')} /><Input label="Sub-strand (optional)" value={f.subStrand} onChange={s('subStrand')} /><Input label="Learning indicator (optional)" value={f.indicator} onChange={s('indicator')} /></>}
      </fieldset>}
      <fieldset className="grid gap-3 sm:grid-cols-4"><legend className="mb-1 text-sm font-semibold">Options</legend>
        <Select label="Depth" value={f.depth} onChange={s('depth')}>{['introductory', 'standard', 'extended'].map((x) => <option key={x}>{x}</option>)}</Select>
        <Select label="Reading level" value={f.readingLevel} onChange={s('readingLevel')}>{['simple', 'standard', 'advanced'].map((x) => <option key={x}>{x}</option>)}</Select>
        <Select label="Length" value={f.length} onChange={s('length')}>{['short', 'medium', 'long'].map((x) => <option key={x}>{x}</option>)}</Select>
        <Input label="Lesson duration (minutes)" type="number" min={15} max={240} value={f.durationMinutes} onChange={s('durationMinutes')} placeholder="from length" />
        <Input label="Activities" type="number" min={1} max={5} value={f.numActivities} onChange={s('numActivities')} />
        <Input label="Exercises" type="number" min={2} max={10} value={f.numExercises} onChange={s('numExercises')} /><Input label="Quiz questions" type="number" min={3} max={10} value={f.numQuizQuestions} onChange={s('numQuizQuestions')} />
        <Select label="Language" value={f.language} onChange={s('language')}>{o.languages.map((l: any) => <option key={l.code} value={l.code}>{l.label}</option>)}</Select>
        <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Difficulty mix (%)</legend><div className="grid grid-cols-3 gap-2">
          <Input label="Easy" type="number" min={0} max={100} value={f.easy} onChange={s('easy')} /><Input label="Medium" type="number" min={0} max={100} value={f.medium} onChange={s('medium')} /><Input label="Hard" type="number" min={0} max={100} value={f.hard} onChange={s('hard')} /></div>
          <p className={`text-xs ${sum === 100 ? 'text-slate-600' : 'font-semibold text-red-700'}`} role={sum === 100 ? undefined : 'alert'}>Total {sum}%{sum !== 100 ? ': must add up to 100' : ''}</p></fieldset>
        <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Illustrations</legend>
          <label className="block text-sm"><input type="radio" name="ill" checked={f.illustrations === 'diagrams'} onChange={() => setF({ ...f, illustrations: 'diagrams' })} /> Diagrams and concept maps (drawn from data, with alt text)</label>
          <label className="block text-sm"><input type="radio" name="ill" checked={f.illustrations === 'none'} onChange={() => setF({ ...f, illustrations: 'none' })} /> None</label>
          <label className="block text-sm text-slate-500"><input type="radio" name="ill" disabled /> Images: not configured ({o.illustrations.images.reason})</label>
          {f.illustrations === 'diagrams' && <div className="mt-1 w-40"><Input label="Diagrams" type="number" min={1} max={3} value={f.numDiagrams} onChange={s('numDiagrams')} /></div>}</fieldset>
        <div className="sm:col-span-2"><Check label="Use Ghanaian contexts and examples" checked={f.includeGhanaContext} onChange={s('includeGhanaContext')} /></div>
        {f.contentType === 'lesson' && <fieldset className="sm:col-span-4"><legend className="text-sm font-medium">Lesson sections</legend><div className="flex flex-wrap gap-3">{o.sections.filter((x: any) => o.lessonSections.includes(x.key)).map((x: any) =>
          <Check key={x.key} label={`${x.key}. ${x.title}`} checked={f.sections.includes(x.key)} disabled={x.key === 'K'} onChange={(e) => setF({ ...f, sections: e.target.checked ? [...f.sections, x.key].sort() : f.sections.filter((k) => k !== x.key) })} />)}</div></fieldset>}
        <div className="sm:col-span-4"><Input label="Editor instructions (optional)" value={f.teacherNotes} onChange={s('teacherNotes')} /></div>
      </fieldset>
      <Estimate q={est} ready={ready} />
      {m.error && <Alert>{m.error.message}</Alert>}
      <Button type="submit" disabled={!ready || !est.data?.canGenerate} loading={m.isPending}>Generate {type?.id === 'lesson' ? 'lesson' : 'resource'}</Button>
    </form></Card>;
}
export function Estimate({ q, ready }: { q: any; ready: boolean }) {
  if (!ready) return <p className="text-sm text-slate-600">Choose a subject and topic to see the estimate.</p>;
  if (q.isLoading) return <Spinner label="Estimating" />; if (q.error) return <Alert>{q.error.message}</Alert>; if (!q.data) return null;
  const { estimate: e, problems, scope } = q.data;
  return <section aria-label="Estimate" className="rounded-lg border bg-slate-50 p-3 text-sm"><h3 className="flex items-center gap-2 font-semibold"><Gauge className="h-4 w-4" aria-hidden />Estimate before generating</h3>
    <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-3">
      <div><dt className="text-xs text-slate-600">AI requests</dt><dd>{e.requests} (up to {e.maxRequestsWithRetries} with retries)</dd></div>
      <div><dt className="text-xs text-slate-600">Tokens</dt><dd>~{e.inputTokens.toLocaleString()} in · ~{e.outputTokens.toLocaleString()} out</dd></div>
      <div><dt className="text-xs text-slate-600">Cost</dt><dd>{usd(e.costUsd)}</dd></div>
      <div><dt className="text-xs text-slate-600">Daily quota</dt><dd>{e.budget.used}/{e.budget.limit} requests used · {e.budget.remaining} left</dd></div>
      <div><dt className="text-xs text-slate-600">Source passages</dt><dd>{scope.passages} from {scope.documents.length} manual(s)</dd></div>
      <div><dt className="text-xs text-slate-600">Provider</dt><dd>{e.provider ?? 'not configured'}</dd></div></dl>
    <p className="mt-1 text-xs text-slate-600">{e.outputBasis}. {e.costBasis}</p>
    {!e.budget.allowed && <Alert>Daily AI quota reached: try again tomorrow.</Alert>}
    {problems.map((p: string) => <Alert key={p}>{p}</Alert>)}</section>;
}

/** Lesson list (§7): server-paginated, filters in the URL so Overview cards and charts deep-link here. */
function LessonList({ subjects }: { subjects: any[] }) {
  const u = useUrlState(); const opts = useQuery({ queryKey: ['lesson-options'], queryFn: () => api<any>('/api/lessons/options'), retry: false });
  const typeLabel = (id?: string) => opts.data?.contentTypes.find((t: any) => t.id === (id ?? 'lesson'))?.label ?? id ?? 'Full lesson';
  return <DataTable path="/api/lessons" caption="Generated content" searchLabel="Search title or topic" defaultSort="-updatedAt" filterKeys={['status', 'subjectId', 'contentType']} refetchInterval={5000}
    toolbar={<><div className="w-48"><Select label="Status" value={u.get('status')} onChange={(e) => u.set({ status: e.target.value || undefined })}><option value="">Any</option>{LESSON_STATUSES.map((x) => <option key={x} value={x}>{LESSON_STATUS_LABEL[x]}</option>)}</Select></div>
      <div className="w-48"><Select label="Type filter" value={u.get('contentType')} onChange={(e) => u.set({ contentType: e.target.value || undefined })}><option value="">Any</option>{opts.data?.contentTypes.map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></div>
      <div className="w-56"><Select label="Subject filter" value={u.get('subjectId')} onChange={(e) => u.set({ subjectId: e.target.value || undefined })}><option value="">All subjects</option>{subjects.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select></div></>}
    columns={[
      { key: 'title', header: 'Title', sortable: true, render: (l: any) => <Link className="text-brand-700 underline" to={`/admin/lessons/${l._id}`}>{l.title}</Link> },
      { key: 'type', header: 'Type', render: (l: any) => typeLabel(l.contentType) },
      { key: 'subject', header: 'Subject', render: (l: any) => l.subjectId?.name ?? '' },
      { key: 'status', header: 'Status', sortable: true, render: (l: any) => <St v={l.status} /> },
      { key: 'version', header: 'Version' },
      { key: 'checks', header: 'Checks', render: (l: any) => (l.validation ? (l.validation.ok ? 'Passed' : `${l.validation.errors.length} error(s)`) : '—') },
      { key: 'updatedAt', header: 'Updated', sortable: true, render: (l: any) => new Date(l.updatedAt).toLocaleString() },
    ]} />;
}

function SectionEditor({ lesson, s, canEdit }: { lesson: any; s: any; canEdit: boolean }) {
  const qc = useQueryClient(); const [edit, setEdit] = useState(false); const [content, setContent] = useState(s.content ?? ''); const [data, setData] = useState(JSON.stringify(s.data ?? {}, null, 2)); const [instr, setInstr] = useState('');
  const done = () => qc.invalidateQueries({ queryKey: ['lesson', lesson._id] });
  const save = useMutation({ mutationFn: () => patch('/api/lessons/' + lesson._id, { baseVersion: lesson.version, sections: [{ key: s.key, content, data: JSON.parse(data || '{}') }] }), onSuccess: () => { setEdit(false); done(); } });
  const regen = useMutation({ mutationFn: () => post(`/api/lessons/${lesson._id}/sections/${s.key}/regenerate`, { instructions: instr || undefined }), onSuccess: done });
  return <div className="space-y-2"><Section s={s} />
    {canEdit && <div className="flex flex-wrap items-end gap-2 pl-2">
      {s.key !== 'K' && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEdit(!edit)}>{edit ? 'Cancel edit' : `Edit section ${s.key}`}</Button>}
      {s.key === 'K' ? <span className="text-xs text-slate-500">Built automatically from the citations in the other sections.</span> : <><div className="w-64"><Input label={`Instructions for regenerating ${s.key} (optional)`} value={instr} onChange={(e) => setInstr(e.target.value)} /></div>
        <ConfirmButton tone="primary" variant="ghost" label={<><RefreshCw className="h-3 w-3" aria-hidden />Regenerate {s.key}</>} ariaLabel={`Regenerate section ${s.key}`} title={`Regenerate section ${s.key}?`} confirmLabel="Regenerate"
          body={<p>Uses one AI request from today's quota. The current text is kept as a version you can restore.</p>} onConfirm={() => regen.mutateAsync()} /></>}
      {regen.error && <Alert>{regen.error.message}</Alert>}</div>}
    {edit && <Card><label className="text-sm font-medium" htmlFor={`c-${s.key}`}>Content (markdown)</label><textarea id={`c-${s.key}`} className="h-48 w-full rounded border p-2 font-mono text-sm" value={content} onChange={(e) => setContent(e.target.value)} />
      <label className="text-sm font-medium" htmlFor={`d-${s.key}`}>Structured data (JSON)</label><textarea id={`d-${s.key}`} className="h-40 w-full rounded border p-2 font-mono text-xs" value={data} onChange={(e) => setData(e.target.value)} />
      {save.error && <Alert>{save.error instanceof SyntaxError ? 'Data is not valid JSON' : save.error.message}</Alert>}<Button className="mt-2" loading={save.isPending} onClick={() => save.mutate()}>Save draft</Button></Card>}
  </div>;
}

function SourcesCompare({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['lesson-sources', id], queryFn: () => api<any>(`/api/lessons/${id}/sources`) });
  if (q.isLoading) return <Spinner />; if (q.error) return <Alert>{q.error.message}</Alert>;
  return <div className="space-y-3">{q.data.sections.map((s: any) => <Card key={s.key}><h3 className="font-semibold">{s.key}. {s.title} <span className="text-xs font-normal text-slate-600">({s.sourceSupport === 'source' ? 'from the sources' : s.sourceSupport === 'general' ? 'general knowledge' : s.sourceSupport})</span></h3>
    <div className="mt-2 grid gap-3 lg:grid-cols-2"><div><h4 className="text-xs font-semibold uppercase text-slate-600">Generated</h4><p className="whitespace-pre-wrap text-sm">{s.content || '—'}</p></div>
      <div><h4 className="text-xs font-semibold uppercase text-slate-600">Cited passages</h4>{!s.passages.length ? <p className="text-sm text-amber-900">No passage cited.</p> : s.passages.map((p: any, i: number) => <blockquote key={i} className="mb-2 border-l-4 border-slate-300 pl-2 text-sm">
        <p className="text-xs text-slate-600">{p.document ? `${p.document.title}${p.document.approvalStatus !== 'verified_official' ? ' (not verified)' : ''}${!p.document.current ? ' (no longer current)' : ''}` : 'Manual no longer available'}, p.{p.pageStart}{p.pageEnd !== p.pageStart ? `–${p.pageEnd}` : ''}</p>
        <p className="whitespace-pre-wrap">{p.found ? p.text : 'Passage no longer available'}</p></blockquote>)}</div></div></Card>)}</div>;
}

function Publish({ l, onPublish }: { l: any; onPublish: (audience: any) => Promise<unknown> }) {
  const programmes = useQuery(cfg('programmes')); const schools = useQuery(cfg('schools')); const levels = useQuery(cfg('levels'));
  const [a, setA] = useState({ levelId: '', yearOfStudy: '', programmeIds: [] as string[], schoolIds: [] as string[] });
  const tog = (k: 'programmeIds' | 'schoolIds', v: string) => (e: any) => setA({ ...a, [k]: e.target.checked ? [...a[k], v] : a[k].filter((x) => x !== v) });
  const audience = { levelId: a.levelId || undefined, yearOfStudy: a.yearOfStudy ? Number(a.yearOfStudy) : undefined, programmeIds: a.programmeIds, schoolIds: a.schoolIds };
  const summary = [a.levelId && levels.data?.find((x) => x._id === a.levelId)?.name, a.yearOfStudy && `Year ${a.yearOfStudy}`, a.programmeIds.length && `${a.programmeIds.length} programme(s)`, a.schoolIds.length && `${a.schoolIds.length} institution(s)`].filter(Boolean).join(', ');
  return <fieldset className="space-y-2 rounded border p-2"><legend className="px-1 text-sm font-semibold">Who can see it once published</legend>
    <p className="text-xs text-slate-600">Only learners enrolled in {l.subjectId?.name ?? 'the subject'} (and teachers of it) can see it; narrow it further here. Leave a box empty for “all”.</p>
    <div className="grid grid-cols-2 gap-2"><Select label="Level" value={a.levelId} onChange={(e) => setA({ ...a, levelId: e.target.value })}><option value="">All levels</option>{levels.data?.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select>
      <Select label="Year" value={a.yearOfStudy} onChange={(e) => setA({ ...a, yearOfStudy: e.target.value })}><option value="">All years</option>{[1, 2, 3].map((y) => <option key={y} value={y}>Year {y}</option>)}</Select></div>
    <fieldset><legend className="text-xs font-medium">Programmes</legend><div className="flex flex-wrap gap-2">{programmes.data?.map((p) => <Check key={p._id} label={p.name} checked={a.programmeIds.includes(p._id)} onChange={tog('programmeIds', p._id)} />)}</div></fieldset>
    <fieldset><legend className="text-xs font-medium">Institutions</legend><div className="flex max-h-32 flex-wrap gap-2 overflow-auto">{schools.data?.map((p) => <Check key={p._id} label={p.name} checked={a.schoolIds.includes(p._id)} onChange={tog('schoolIds', p._id)} />)}</div></fieldset>
    <ConfirmButton tone="primary" variant="primary" className="px-3 py-1.5 text-sm" label="Publish" title={`Publish “${l.title}”?`} confirmLabel="Publish"
      body={<><p>Version {l.version} becomes visible to {summary || 'everyone eligible for the subject'}{l.contentType === 'teacher_prep' ? ' (teachers only)' : ''}.</p><p>You can unpublish it later.</p></>} onConfirm={() => onPublish(audience)} /></fieldset>;
}

export function LessonEditorPage() {
  const { id } = useParams(); const { user } = useAuth(); const qc = useQueryClient(); const nav = useNavigate();
  const q = useQuery({ queryKey: ['lesson', id], queryFn: () => api<any>(`/api/lessons/${id}`), refetchInterval: (x) => (x.state.data?.lesson.status === 'generating' || ['queued', 'running'].includes(x.state.data?.job?.status) ? 3000 : false) });
  const [tab, setTab] = useState<'content' | 'sources' | 'versions'>('content');
  const [cmp, setCmp] = useState<{ a: number; b: number } | null>(null); const [comment, setComment] = useState(''); const [note, setNote] = useState(''); const [noteKey, setNoteKey] = useState(''); const [assignee, setAssignee] = useState(''); const [title, setTitle] = useState<string | null>(null);
  const compare = useQuery({ queryKey: ['cmp', id, cmp], enabled: !!cmp, queryFn: () => api<any>(`/api/lessons/${id}/compare?a=${cmp!.a}&b=${cmp!.b}`) });
  const perm = q.data?.permissions;
  const reviewers = useQuery({ queryKey: ['lesson-reviewers'], enabled: !!perm?.assignOthers, queryFn: () => api<any>('/api/lessons/reviewers').then((r) => r.items as any[]) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['lesson', id] });
  const act = (path: string, body?: any) => post(`/api/lessons/${id}/${path}`, body ?? {}).then((r) => { refresh(); return r; });
  const quick = useMutation({ mutationFn: ({ path, body }: { path: string; body?: any }) => act(path, body), onSuccess: () => { setNote(''); setNoteKey(''); } });
  const saveTitle = useMutation({ mutationFn: () => patch(`/api/lessons/${id}`, { title, baseVersion: q.data.lesson.version }), onSuccess: () => { setTitle(null); refresh(); } });
  if (q.isLoading) return <Spinner />; if (q.error) return <Alert>{q.error.message}</Alert>;
  const { lesson: l, versions, reviews, job, sourceDocuments, type } = q.data;
  const p = perm;
  const busy = l.status === 'generating' || ['queued', 'running'].includes(job?.status);
  const reviewer = l.assignedReviewerId;
  return <section className="space-y-4"><Link to="/admin/lessons" className="text-sm text-brand-700 underline">← Generation workspace</Link>
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold">{l.title}</h1><St v={l.status} />
      <span className="text-sm text-slate-600">{type?.label ?? 'Full lesson'} · v{l.version} · {l.subjectId?.name} · AI-generated ({l.aiModel ?? 'pending'}) · by {l.createdBy?.fullName ?? 'unknown'}, {new Date(l.createdAt).toLocaleString()}</span></div>
    {busy && <Alert tone="info">Generating… {job?.status === 'queued' ? 'waiting in the queue' : job?.progress?.step ?? 'calling the AI provider'} (generation progress is not measured)</Alert>}
    {l.generationError && <Alert>Generation failed: {l.generationError}</Alert>}
    {job?.errorLog?.length > 0 && <details className="text-sm"><summary>Provider errors by attempt ({job.errorLog.length})</summary>{job.errorLog.map((e: any, i: number) => <p key={i}>Attempt {e.attempt}: {e.message}</p>)}</details>}
    {(p.cancel || p.retry || p.delete) && <div className="flex flex-wrap gap-2">
      {p.cancel && <ConfirmButton label="Cancel generation" title="Cancel this generation?" body={<p>The request has not been sent to the AI provider yet, so no quota is used.</p>} onConfirm={() => act('cancel')} className="px-3 py-1.5 text-sm" />}
      {p.retry && <ConfirmButton tone="primary" variant="primary" className="px-3 py-1.5 text-sm" label="Retry generation" title="Retry this generation?" confirmLabel="Retry" body={<p>Sends the same request again{l.estimate ? ` (about ${l.estimate.requests} AI request(s), up to ${l.estimate.maxRequestsWithRetries} with retries)` : ''}. It uses today's quota.</p>} onConfirm={() => act('retry')} />}
      {p.delete && <ConfirmButton label={l.status === 'archived' ? 'Delete permanently' : 'Delete failed generation'} title={l.status === 'archived' ? 'Delete this archived item permanently?' : 'Delete this failed generation?'} typeToConfirm="DELETE" body={<p>Deletes “{l.title}”, its versions, history and finished jobs. This cannot be undone.</p>} onConfirm={() => del(`/api/lessons/${id}`).then(() => nav('/admin/lessons'))} className="px-3 py-1.5 text-sm" />}</div>}
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card><h2 className="font-semibold">Curriculum mapping and sources</h2>
          <dl className="mt-1 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-600">Topic</dt><dd>{l.topic}{l.subtopic ? ` · ${l.subtopic}` : ''}</dd></div>
            <div><dt className="text-xs text-slate-600">Year · programme · version</dt><dd>{[l.yearOfStudy && `Year ${l.yearOfStudy}`, l.programmeId?.name, l.curriculumVersionId?.code].filter(Boolean).join(' · ') || '—'}</dd></div>
            <div><dt className="text-xs text-slate-600">Strand / sub-strand</dt><dd>{[l.strand, l.subStrand].filter(Boolean).join(' / ') || '—'}</dd></div>
            <div><dt className="text-xs text-slate-600">Indicator</dt><dd>{l.indicator ?? '—'}{l.indicator && <span className="ml-1 rounded bg-slate-100 px-1 text-xs">{l.indicatorSource === 'curriculum_node' ? 'from the manual' : 'entered by editor, not an official code'}</span>}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-slate-600">Source manuals</dt><dd>{sourceDocuments.map((d: any) => `${d.title} (${d.approvalStatus === 'verified_official' ? 'verified official' : d.approvalStatus}${d.archivedAt || d.supersededBy ? ', no longer current' : ''})`).join('; ') || 'All approved manuals of the subject'}{l.pageFrom ? ` · pages ${l.pageFrom}–${l.pageTo ?? '…'}` : ''}</dd></div>
            {l.estimate && <div className="sm:col-span-2"><dt className="text-xs text-slate-600">Estimate at request</dt><dd>{l.estimate.requests} request(s), ~{l.estimate.inputTokens?.toLocaleString()} in / ~{l.estimate.outputTokens?.toLocaleString()} out tokens, cost {usd(l.estimate.costUsd)}</dd></div>}
          </dl></Card>
        <Card><h2 className="font-semibold">Automatic checks</h2>{!l.validation ? <p className="text-sm">Not yet checked.</p> : <>
          <p className={`text-sm ${l.validation.ok ? 'text-brand-700' : 'text-red-700'}`}>{l.validation.ok ? '✓ All required checks passed' : `${l.validation.errors.length} error(s) must be fixed before review`}</p>
          <ul className="list-disc pl-5 text-sm text-red-800">{l.validation.errors.map((e: string) => <li key={e}>{e}</li>)}</ul><ul className="list-disc pl-5 text-sm text-amber-900">{l.validation.warnings.map((e: string) => <li key={e}>{e}</li>)}</ul></>}</Card>
      </div>
      <Card><h2 className="font-semibold">Review and publishing</h2>
        <p className="mt-1 text-sm">Reviewer: {reviewer ? <strong>{reviewer.fullName}</strong> : 'not assigned'}{l.submittedAt && <span className="block text-xs text-slate-600">Submitted {new Date(l.submittedAt).toLocaleString()}</span>}</p>
        <div className="mt-2 space-y-3">
          {p.edit && <div className="flex items-end gap-2"><div className="flex-1"><Input label="Title" value={title ?? l.title} onChange={(e) => setTitle(e.target.value)} /></div>{title != null && title !== l.title && <Button loading={saveTitle.isPending} onClick={() => saveTitle.mutate()}>Save draft</Button>}</div>}
          {saveTitle.error && <Alert>{saveTitle.error.message}</Alert>}
          {p.submit && <ConfirmButton tone="primary" variant="primary" className="px-3 py-1.5 text-sm" label={<><Send className="h-4 w-4" aria-hidden />{l.status === 'changes_requested' ? 'Resubmit for review' : 'Submit for review'}</>} ariaLabel={l.status === 'changes_requested' ? 'Resubmit for review' : 'Submit for review'}
            title="Submit for review?" confirmLabel="Submit" body={<p>Version {l.version} goes to {reviewer ? reviewer.fullName : 'the Content Reviewers'}. You cannot edit it while it is being reviewed.</p>} onConfirm={() => act('submit')} />}
          {!p.submit && p.edit && !l.validation?.ok && <p className="text-xs text-red-700">Fix the check errors before submitting.</p>}
          {p.assign && <div className="space-y-1">{p.assignOthers ? <div className="flex items-end gap-2"><div className="flex-1"><Select label="Assign reviewer" value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Choose…</option>{reviewers.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></div>
              <Button variant="ghost" disabled={!assignee} loading={quick.isPending} onClick={() => quick.mutate({ path: 'assign', body: { reviewerId: assignee } })}>Assign</Button></div>
            : hasPermission(user!.roles, 'content:review') && String(reviewer?._id) !== user!.id && <Button variant="ghost" loading={quick.isPending} onClick={() => quick.mutate({ path: 'assign', body: { reviewerId: user!.id } })}>Assign to me</Button>}
            {reviewer && (p.assignOthers || String(reviewer._id) === user!.id) && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => quick.mutate({ path: 'assign', body: { reviewerId: null } })}>Remove assignment</Button>}</div>}
          {(p.decide.allowed || p.requestChanges?.allowed) && <div className="space-y-2"><label className="block text-sm font-medium" htmlFor="rv-comment">Review comment</label><textarea id="rv-comment" className="h-20 w-full rounded border p-2 text-sm" value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              {p.decide.allowed && <ConfirmButton tone="primary" variant="primary" className="px-3 py-1.5 text-sm" label="Approve" title={`Approve version ${l.version}?`} body={<p>You confirm it matches the cited passages and the curriculum. Publishing is a separate step.</p>} onConfirm={() => act('review', { action: 'approve', comment: comment || undefined }).then(() => setComment(''))} />}
              <ConfirmButton className="px-3 py-1.5 text-sm" label="Request changes" title="Send back for changes?" disabled={!comment.trim()} body={<p>The author is notified with your comment: “{comment}”.</p>} onConfirm={() => act('review', { action: 'request_changes', comment }).then(() => setComment(''))} /></div>
            {!comment.trim() && <p className="text-xs text-slate-600">Requesting changes needs a comment.</p>}</div>}
          {!p.decide.allowed && ['in_review', 'resubmitted'].includes(l.status) && hasPermission(user!.roles, 'content:review') && <Alert tone="info">{p.decide.reason}</Alert>}
          {l.status === 'approved' && (p.publish.allowed ? <Publish l={l} onPublish={(audience) => act('publish', { audience })} /> : <Alert tone="info">Publishing blocked: {p.publish.reason}</Alert>)}
          {p.unpublish && <PublicPreviewToggle l={l} onToggle={(enabled) => act('public-preview', { enabled })} />}
          {p.unpublish && <ConfirmButton className="px-3 py-1.5 text-sm" label="Unpublish" title="Unpublish?" body={<p>It disappears for learners and teachers at once. The approval of version {l.version} stays, so you can publish it again.</p>} onConfirm={() => act('unpublish')} />}
          {p.archive && <ConfirmButton variant="ghost" className="px-3 py-1.5 text-sm" label="Archive" title="Archive this content?" body={<p>{l.status === 'published' ? 'It is withdrawn from learners and ' : 'It '}leaves the workspace lists. History is kept.</p>} onConfirm={() => act('archive')} />}
          {quick.error && <Alert>{quick.error.message}</Alert>}
        </div>
        <h3 className="mt-4 text-sm font-semibold">Comments</h3>
        <div className="space-y-1"><label className="block text-xs" htmlFor="note">Add a comment</label><textarea id="note" className="h-16 w-full rounded border p-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex items-end gap-2"><div className="w-40"><Select label="About section" value={noteKey} onChange={(e) => setNoteKey(e.target.value)}><option value="">Whole item</option>{l.sections.map((s: any) => <option key={s.key} value={s.key}>{s.key}. {s.title}</option>)}</Select></div>
            <Button variant="ghost" disabled={!note.trim()} onClick={() => quick.mutate({ path: 'comments', body: { comment: note, sectionKey: noteKey || undefined } })}>Add comment</Button></div></div>
        <h3 className="mt-4 text-sm font-semibold">History</h3><ol className="space-y-1 text-xs">{reviews.map((r: any) => <li key={r._id}><time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time> · {r.by?.fullName ?? 'unknown'}: <strong>{REVIEW_ACTION_LABEL[r.action] ?? r.action}</strong>{r.assigneeId ? ` ${r.assigneeId.fullName}` : ''} (v{r.version}){r.sectionKey ? ` · section ${r.sectionKey}` : ''}{r.comment && `: “${r.comment}”`}</li>)}{!reviews.length && <li>No actions yet.</li>}</ol></Card>
    </div>
    <div role="tablist" aria-label="Lesson views" className="flex gap-2 border-b">{([['content', 'Content', BookOpen], ['sources', 'Compare with sources', BookOpen], ['versions', 'Versions', History]] as const).map(([k, label, I]) =>
      <button key={k} role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`} className={`flex items-center gap-1 px-3 py-2 text-sm ${tab === k ? 'border-b-2 border-brand-700 font-semibold text-brand-800' : 'text-slate-700'}`} onClick={() => setTab(k)}><I className="h-4 w-4" aria-hidden />{label}</button>)}</div>
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {tab === 'content' && <div className="space-y-4">{!l.sections.length ? <p className="text-sm">No content yet.</p> : l.sections.map((s: any) => <SectionEditor key={`${s.key}-${l.version}`} lesson={l} s={s} canEdit={p.edit} />)}</div>}
      {tab === 'sources' && <SourcesCompare id={id!} />}
      {tab === 'versions' && <Card><ul className="text-sm">{versions.map((v: any) => <li key={v.version} className="flex flex-wrap items-center gap-2 py-0.5">v{v.version} · {v.reason} · {v.createdBy?.fullName} · {new Date(v.createdAt).toLocaleString()}{v.version === l.approvedVersion && <span className="rounded bg-brand-50 px-1 text-xs">approved</span>}
          {v.version > 1 && <button className="text-xs text-brand-700 underline" onClick={() => setCmp({ a: v.version - 1, b: v.version })}>compare with v{v.version - 1}</button>}
          {p.edit && v.version !== l.version && <ConfirmButton variant="ghost" tone="primary" label={`Restore v${v.version}`} title={`Restore version ${v.version}?`} confirmLabel="Restore" body={<p>Its content becomes a new version; the current one is kept.</p>} onConfirm={() => act(`versions/${v.version}/restore`)} />}</li>)}</ul>
        {compare.data && <div className="mt-3 space-y-2"><h3 className="text-sm font-semibold">Changes v{compare.data.a} → v{compare.data.b}</h3>{compare.data.sections.filter((s: any) => s.changed).map((s: any) => <details key={s.key} open><summary className="text-sm">Section {s.key}</summary>
          <pre tabIndex={0} className="max-h-64 overflow-auto rounded bg-slate-50 p-2 text-xs">{s.diff.map((d: any, i: number) => <div key={i} className={d.op === '+' ? 'bg-green-100' : d.op === '-' ? 'bg-red-100' : ''}>{d.op} {d.line}</div>)}</pre></details>)}
          {!compare.data.sections.some((s: any) => s.changed) && <p className="text-sm">No differences.</p>}</div>}</Card>}
    </div>
  </section>;
}

/** Public preview on the website (docs/LANDING_SPEC.md): anonymous visitors can read the published copy without assessment answers or teacher notes. */
function PublicPreviewToggle({ l, onToggle }: { l: any; onToggle: (enabled: boolean) => Promise<unknown> }) {
  const [err, setErr] = useState<string | null>(null); const on = !!l.publicPreview; const restricted = !!l.audience?.schoolIds?.length;
  return <div className="w-full space-y-1 rounded border border-slate-200 p-2 text-sm">
    <p><strong>Public preview:</strong> {on ? <>on. Visitors can read it at <a className="text-brand-700 underline" href={`/preview/${l._id}`} target="_blank" rel="noreferrer">/preview/{l._id}</a> (no answers or teacher notes).</> : restricted ? 'not available, because this item is limited to particular institutions.' : 'off. Only signed-in learners in its audience can open it.'}</p>
    {(!restricted || on) && <ConfirmButton tone={on ? 'danger' : 'primary'} className="px-3 py-1.5 text-sm" label={on ? 'Remove public preview' : 'Show as public preview'} title={on ? 'Remove the public preview?' : 'Show this lesson publicly?'}
      body={<p>{on ? 'It disappears from the public website and search at once.' : 'Anyone, without signing in, can read its overview, objectives, explanations, diagrams, activities and revision summary on the website and find it in public search. Assessment answers and teacher notes stay private.'}</p>}
      onConfirm={() => onToggle(!on).then(() => setErr(null), (e) => setErr(e.message))} />}
    {err && <Alert>{err}</Alert>}</div>;
}
