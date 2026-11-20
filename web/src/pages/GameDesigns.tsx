import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@ghlearn/shared';
import { Plus, Wand2, Lightbulb, ShieldCheck } from 'lucide-react';
import { api, post, patch, del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { QuestionInput } from '../components/QuestionInput';
import { ConfirmButton } from '../components/ConfirmDialog';
import { useUrlState } from '../admin/DataTable';
import { GAME_STATUS_LABEL, REVIEW_ACTION_LABEL, statusTone } from '../lib/lessonStatus';
import { WordSearch } from './Games';

const St = ({ v }: { v: string }) => <span className={`rounded px-2 py-0.5 text-xs ${statusTone(v)}`}>{GAME_STATUS_LABEL[v] ?? v}</span>;
const CONTENT_TEMPLATE: Record<string, any> = {
  pairs: [{ term: '', definition: '' }, { term: '', definition: '' }, { term: '', definition: '' }], cards: [{ front: '', back: '' }, { front: '', back: '' }, { front: '', back: '' }],
  terms: [{ term: '', clue: '' }, { term: '', clue: '' }, { term: '', clue: '' }], sequences: [{ title: '', steps: ['', '', ''] }], diagrams: [{ title: '', centre: '', labels: ['', ''], alt: '' }],
  groups: [{ title: '', categories: [{ name: '', items: ['', ''] }, { name: '', items: ['', ''] }] }],
};
const CONTENT_HELP: Record<string, string> = {
  pairs: 'term and definition for each pair (3 to 8).', cards: 'front (prompt) and back (answer) for each card.', terms: 'term: one word of 3 to 10 letters; clue: what the learner reads. Optional hint per item.',
  sequences: 'title and steps in the CORRECT order (3 to 8 steps).', diagrams: 'centre (what is labelled) and labels; a label can be a list of accepted names, e.g. ["Stalk", "Petiole"].', groups: 'each round: categories with a name and the items that belong in it (an item may only appear once).',
};
const useMeta = () => useQuery({ queryKey: ['game-meta'], queryFn: () => api<any>('/api/game-designs/meta'), staleTime: 3600_000 });
const useSubjects = () => useQuery({ queryKey: ['/api/config/subjects'], queryFn: () => api<{ items: any[] }>('/api/config/subjects').then((r) => r.items) });
const parseJson = (s: string) => { try { return JSON.parse(s); } catch { throw new Error('The game content is not valid JSON'); } };

function ValidationPanel({ v }: { v: any }) {
  if (!v) return null;
  return <section aria-label="Validation" className={`rounded border p-3 text-sm ${v.ok && !v.unverified.length ? 'border-brand-700 bg-brand-50' : 'border-amber-300 bg-amber-50'}`}>
    <p className="flex items-center gap-1 font-medium"><ShieldCheck className="h-4 w-4" aria-hidden />{v.ok ? `Validation passed: the dry run played ${v.dryRun.items} item(s) (${v.dryRun.passed} passed) with the correct answers.` : 'Validation failed: publishing is blocked.'}</p>
    {v.errors.map((e: string) => <p key={e} className="text-red-800">✗ {e}</p>)}
    {v.unverified.length > 0 && <><p className="mt-1 font-medium">Unverified answers (publishing is blocked until verified):</p>{v.unverified.map((e: string) => <p key={e}>• {e}</p>)}</>}
    {v.warnings.map((e: string) => <p key={e} className="text-amber-900">⚠ {e}</p>)}</section>;
}

/** Create or edit a game (§14): links, type, difficulty, scoring and hints, verified questions and/or reviewed content. */
export function GameEditor({ initial, onDone }: { initial?: any; onDone: (d?: any) => void }) {
  const meta = useMeta(); const subjects = useSubjects();
  const [f, setF] = useState<any>(initial ? { ...initial, subjectId: initial.subjectId?._id ?? initial.subjectId } : { title: '', subjectId: '', type: 'flashcards', topic: '', objective: '', strand: '', yearOfStudy: '', difficulty: 'medium' });
  const [st, setSt] = useState<any>({ pointsPerItem: 10, hintsEnabled: true, hintCost: 3, timeLimitSec: '', streakBonus: 2, ...(initial?.settings ?? {}) });
  const rule = meta.data?.types.find((t: any) => t.key === f.type);
  const [content, setContent] = useState(() => JSON.stringify(initial?.content?.[rule?.content] ?? (rule?.content ? CONTENT_TEMPLATE[rule.content] : []), null, 2));
  const [picked, setPicked] = useState<string[]>(initial?.questionIds?.map(String) ?? []);
  const bank = useQuery({ queryKey: ['verified-bank', f.subjectId], enabled: !!f.subjectId && !!rule?.questionTypes.length, queryFn: () => api<{ items: any[] }>(`/api/questions?subjectId=${f.subjectId}&status=published&verified=true`).then((r) => r.items) });
  const choose = (type: string) => { const r = meta.data?.types.find((t: any) => t.key === type); setF({ ...f, type }); setContent(JSON.stringify(r?.content ? CONTENT_TEMPLATE[r.content] : [], null, 2)); setPicked([]); };
  const m = useMutation({ mutationFn: () => {
    const settings = { pointsPerItem: Number(st.pointsPerItem), hintsEnabled: !!st.hintsEnabled, hintCost: Number(st.hintCost), streakBonus: Number(st.streakBonus), ...(st.timeLimitSec ? { timeLimitSec: Number(st.timeLimitSec) } : {}) };
    const b: any = { title: f.title, topic: f.topic, objective: f.objective, strand: f.strand || undefined, yearOfStudy: f.yearOfStudy ? Number(f.yearOfStudy) : undefined, difficulty: f.difficulty, settings, questionIds: picked, content: rule?.content ? { [rule.content]: parseJson(content) } : {} };
    return initial ? patch<any>(`/api/game-designs/${initial._id}`, b) : post<any>('/api/game-designs', { ...b, subjectId: f.subjectId, type: f.type }); }, onSuccess: (r) => onDone(r.design) });
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const allowed = (bank.data ?? []).filter((q) => rule?.questionTypes.includes(q.type));
  return <Card><form aria-label={initial ? 'Edit game' : 'New game'} onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
    <h2 className="mb-2 font-semibold">{initial ? `Edit game (version ${initial.version})` : 'New game'}</h2>
    <div className="grid gap-3 sm:grid-cols-3">
      <Input label="Title" required value={f.title} onChange={s('title')} />
      <Select label="Subject" required disabled={!!initial} value={f.subjectId} onChange={(e) => { setF({ ...f, subjectId: e.target.value }); setPicked([]); }}><option value="">Choose…</option>{subjects.data?.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select>
      <Select label="Game type" disabled={!!initial} value={f.type} onChange={(e) => choose(e.target.value)}>{meta.data?.types.map((t: any) => <option key={t.key} value={t.key}>{t.name}</option>)}</Select>
      <Input label="Topic" required value={f.topic} onChange={s('topic')} /><Input label="Learning objective" required value={f.objective} onChange={s('objective')} /><Input label="Strand (optional)" value={f.strand ?? ''} onChange={s('strand')} />
      <Select label="Difficulty" value={f.difficulty} onChange={s('difficulty')}>{['easy', 'medium', 'hard'].map((x) => <option key={x}>{x}</option>)}</Select>
      <Input label="Year of study (optional)" type="number" min={1} max={6} value={f.yearOfStudy ?? ''} onChange={s('yearOfStudy')} />
    </div>
    {rule && <p className="mt-2 rounded bg-slate-50 p-2 text-sm"><strong>{rule.name}:</strong> {rule.description} Needs {rule.help}</p>}
    <fieldset className="mt-3 grid gap-3 sm:grid-cols-5"><legend className="text-sm font-medium">Scoring and hints</legend>
      <Input label="Points per item" type="number" min={1} max={100} value={st.pointsPerItem} onChange={(e) => setSt({ ...st, pointsPerItem: e.target.value })} />
      <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={!!st.hintsEnabled} onChange={(e) => setSt({ ...st, hintsEnabled: e.target.checked })} />Hints allowed</label>
      <Input label="Hint cost (points)" type="number" min={0} max={99} disabled={!st.hintsEnabled} value={st.hintCost} onChange={(e) => setSt({ ...st, hintCost: e.target.value })} />
      <Input label="Time limit in seconds (optional)" type="number" min={30} max={3600} value={st.timeLimitSec ?? ''} onChange={(e) => setSt({ ...st, timeLimitSec: e.target.value })} />
      <Input label="Streak bonus" type="number" min={0} max={20} value={st.streakBonus} onChange={(e) => setSt({ ...st, streakBonus: e.target.value })} hint="Quiz challenge only" /></fieldset>
    {rule?.questionTypes.length > 0 && <fieldset className="mt-3"><legend className="text-sm font-medium">Approved questions with a verified answer key ({picked.length} chosen)</legend>
      {!f.subjectId ? <p className="text-sm">Choose a subject first.</p> : bank.isLoading ? <Spinner /> : allowed.length ? <ul className="max-h-60 overflow-auto rounded border p-2 text-sm">{allowed.map((q) => <li key={q._id}><label><input type="checkbox" checked={picked.includes(q._id)} onChange={(e) => setPicked(e.target.checked ? [...picked, q._id] : picked.filter((x) => x !== q._id))} /> <span className="rounded bg-slate-100 px-1 text-xs">{q.type.replace(/_/g, ' ')}</span> {q.stem} <span className="text-xs text-slate-600">({q.topic})</span></label></li>)}</ul>
        : <p className="text-sm">No verified questions of the types this game plays ({rule.questionTypes.join(', ').replace(/_/g, ' ')}) in this subject yet.</p>}</fieldset>}
    {rule?.content && <div className="mt-3"><label className="text-sm font-medium" htmlFor="gcontent">Game content: {rule.content} (JSON)</label><p id="gcontent-help" className="text-xs text-slate-600">{CONTENT_HELP[rule.content]} A reviewer verifies these answers before the game can be published.</p>
      <textarea id="gcontent" aria-describedby="gcontent-help" className="h-56 w-full rounded border p-2 font-mono text-xs" value={content} onChange={(e) => setContent(e.target.value)} /></div>}
    {m.error && <Alert>{m.error.message}</Alert>}
    <div className="mt-3 flex gap-2"><Button type="submit" loading={m.isPending}>{initial ? 'Save changes' : 'Save as draft'}</Button><Button type="button" variant="ghost" onClick={() => onDone()}>Cancel</Button></div>
  </form></Card>;
}

function GenerateGame({ onDone }: { onDone: (d: any) => void }) {
  const meta = useMeta(); const subjects = useSubjects(); const [g, setG] = useState({ subjectId: '', type: 'flashcards', topic: '', objective: '', difficulty: 'medium' });
  const m = useMutation({ mutationFn: () => post<any>('/api/game-designs/generate', g), onSuccess: (r) => onDone(r.design) });
  return <Card><h2 className="mb-1 flex items-center gap-2 font-semibold"><Wand2 className="h-5 w-5" aria-hidden />Generate a game from approved content</h2>
    <p className="mb-2 text-sm text-slate-600">Builds a draft from approved bank questions with a verified answer key and from published lessons on the topic (key terms, flashcards, diagrams, concept maps). No AI call is made. The draft still needs review.</p>
    <form aria-label="Generate game" className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Select label="Subject" required value={g.subjectId} onChange={(e) => setG({ ...g, subjectId: e.target.value })}><option value="">Choose…</option>{subjects.data?.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select>
      <Select label="Game type" value={g.type} onChange={(e) => setG({ ...g, type: e.target.value })}>{meta.data?.types.map((t: any) => <option key={t.key} value={t.key}>{t.name}</option>)}</Select>
      <Select label="Difficulty" value={g.difficulty} onChange={(e) => setG({ ...g, difficulty: e.target.value })}>{['easy', 'medium', 'hard'].map((x) => <option key={x}>{x}</option>)}</Select>
      <Input label="Topic (exactly as in the bank and lessons)" required value={g.topic} onChange={(e) => setG({ ...g, topic: e.target.value })} />
      <div className="sm:col-span-2"><Input label="Learning objective" required value={g.objective} onChange={(e) => setG({ ...g, objective: e.target.value })} /></div>
      {m.error && <div className="sm:col-span-3"><Alert>{m.error.message}</Alert></div>}
      <div><Button type="submit" disabled={!g.subjectId || g.topic.length < 2 || g.objective.length < 5} loading={m.isPending}>Generate draft</Button></div></form></Card>;
}

function GameList({ review }: { review?: boolean }) {
  const u = useUrlState(); const meta = useMeta(); const subjects = useSubjects();
  const qs = new URLSearchParams(Object.entries({ subjectId: u.get('subjectId'), status: review ? '' : u.get('status'), type: u.get('type'), review: review ? 'queue' : '', search: u.get('search') }).filter(([, v]) => v) as any).toString();
  const list = useQuery({ queryKey: ['game-designs', qs], queryFn: () => api<{ items: any[] }>(`/api/game-designs?${qs}`).then((r) => r.items) });
  return <Card><div className="grid gap-2 sm:grid-cols-4">
      <Select label="Subject filter" value={u.get('subjectId')} onChange={(e) => u.set({ subjectId: e.target.value || undefined })}><option value="">All subjects</option>{subjects.data?.map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</Select>
      {!review && <Select label="Status filter" value={u.get('status')} onChange={(e) => u.set({ status: e.target.value || undefined })}><option value="">Any</option>{Object.entries(GAME_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}
      <Select label="Game type filter" value={u.get('type')} onChange={(e) => u.set({ type: e.target.value || undefined })}><option value="">Any</option>{meta.data?.types.map((t: any) => <option key={t.key} value={t.key}>{t.name}</option>)}</Select>
      <Input label="Search title" value={u.get('search')} onChange={(e) => u.set({ search: e.target.value || undefined })} /></div>
    {list.isLoading ? <Spinner /> : list.error ? <Alert>{list.error.message}</Alert> : <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Table, scrolls sideways on small screens"><table className="mt-3 w-full text-left text-sm"><caption className="sr-only">{review ? 'Games awaiting review' : 'Games'}</caption>
      <thead><tr className="border-b"><th className="py-1">Title</th><th>Type</th><th>Subject · topic</th><th>Status</th><th>Checks</th><th>Version</th><th>Plays</th></tr></thead>
      <tbody>{list.data!.map((d) => <tr key={d._id} className="border-b"><td className="py-1"><Link className="text-brand-700 underline" to={`/admin/games/${d._id}`}>{d.title}</Link>{d.source?.generated && <span className="ml-1 text-xs text-slate-600">(generated)</span>}</td><td>{d.info?.name}</td><td>{d.subjectId?.name} · {d.topic}</td><td><St v={d.status} /></td>
        <td>{!d.validation ? '—' : !d.validation.ok ? <span className="text-red-800">{d.validation.errors.length} error(s)</span> : d.validation.unverified.length ? 'Answers unverified' : 'Passed'}</td><td>{d.version}</td><td>{d.sessions} ({d.players} player{d.players === 1 ? '' : 's'})</td></tr>)}</tbody></table>
      {!list.data!.length && <p className="text-sm">{review ? 'Nothing is waiting for review.' : 'No games yet.'}</p>}</div>}</Card>;
}

export function GameDesignsPage() {
  const { user } = useAuth(); const u = useUrlState(); const nav = useNavigate();
  const canEdit = hasPermission(user!.roles, 'content:edit'), canReview = hasPermission(user!.roles, 'content:review');
  const tabs = [['list', 'Games'], ...(canReview ? [['review', 'Review queue']] : []), ...(canEdit ? [['new', 'New game'], ['generate', 'Generate from content']] : [])];
  const tab = u.get('tab') || 'list'; const open = (d?: any) => (d ? nav(`/admin/games/${d._id}`) : u.set({ tab: 'list' }));
  return <section className="space-y-4"><div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Educational Games</h1>{canEdit && <Button onClick={() => u.set({ tab: 'new' })}><Plus className="h-4 w-4" aria-hidden />New game</Button>}</div>
    <p className="text-sm text-slate-600">Every game links to a subject, topic and objective, uses only approved content, and is auto-marked. A game is published only after a reviewer has verified its answers and the validation dry run passes.</p>
    <nav aria-label="Games sections" className="flex flex-wrap gap-1 border-b">{tabs.map(([k, l]) => <button key={k} aria-current={tab === k ? 'page' : undefined} className={`rounded-t px-3 py-2 text-sm ${tab === k ? 'border-b-2 border-brand-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => u.set({ tab: k })}>{l}</button>)}</nav>
    {tab === 'list' && <GameList />}{tab === 'review' && canReview && <GameList review />}
    {tab === 'new' && canEdit && <GameEditor onDone={open} />}{tab === 'generate' && canEdit && <GenerateGame onDone={open} />}</section>;
}

/** Plays the design exactly as students will (same build and marking) through the preview endpoints: no session, XP or mastery. */
function GamePreview({ id, game }: { id: string; game: string }) {
  const start = useMutation({ mutationFn: () => post<any>(`/api/game-designs/${id}/preview`, {}) });
  const [i, setI] = useState(0); const [val, setVal] = useState<any>(null); const [res, setRes] = useState<Record<string, any>>({}); const [hints, setHints] = useState<Record<string, any>>({}); const [flipped, setFlipped] = useState(false);
  const p = start.data;
  const check = async (itemId: string, answer: any) => { const r = await post<any>(`/api/game-designs/${id}/preview/check`, { seed: p.seed, itemId, answer }).catch((e) => ({ error: e.message })); setRes((x) => ({ ...x, [itemId]: r })); return r; };
  const hint = async (itemId: string) => { const r = await post<any>(`/api/game-designs/${id}/preview/check`, { seed: p.seed, itemId, hint: true }).catch((e) => ({ hint: e.message })); setHints((x) => ({ ...x, [itemId]: r })); };
  const reset = () => { setI(0); setVal(null); setRes({}); setHints({}); setFlipped(false); start.mutate(); };
  if (!p) return <div><Button onClick={() => start.mutate()} loading={start.isPending}>Start preview</Button>{start.error && <Alert>{start.error.message}</Alert>}</div>;
  const total = Object.values(res).reduce((t: number, r: any) => t + (r?.score ?? 0), 0);
  const head = <p className="text-sm" aria-live="polite">Preview score {total} / {p.maxScore}{p.settings?.timeLimitSec ? ` · students get ${p.settings.timeLimitSec}s` : ''} · <button className="text-brand-700 underline" onClick={reset}>Restart with a new shuffle</button></p>;
  if (game === 'word_search') return <div className="space-y-2">{head}<WordSearch s={p} found={res} onFound={check} /></div>;
  const it = p.items[i]; if (!it) return <div>{head}<p>End of preview.</p></div>;
  const r = res[it.id]; const h = hints[it.id]?.hint; const hintText = typeof h === 'string' ? h : h?.text;
  const next = () => { setVal(null); setFlipped(false); setI(i + 1); };
  return <div className="space-y-2">{head}<p className="text-sm text-slate-600">Item {i + 1} of {p.items.length}</p>
    <div className="rounded border p-3">{game === 'flashcards' ? <div className="text-center"><p className="text-lg font-semibold">{it.front}</p>{!flipped ? <Button className="mt-2" onClick={() => setFlipped(true)}>Flip card</Button> : !r ? <div className="mt-2 flex justify-center gap-2"><Button onClick={() => check(it.id, { knew: true })}>I knew it</Button><Button variant="ghost" onClick={() => check(it.id, { knew: false })}>Not yet</Button></div> : <p className="mt-2 rounded bg-brand-50 p-2">{r.reveal}</p>}</div>
      : game === 'classification' ? <div><p className="mb-2 font-medium">{it.title}</p>{it.things.map((t: string) => <label key={t} className="grid items-center gap-2 sm:grid-cols-2"><span>{t}</span><select className="rounded border px-2 py-1" disabled={!!r} value={val?.[t] ?? ''} onChange={(e) => setVal({ ...(val ?? {}), [t]: e.target.value })}><option value="">Choose group…</option>{it.categories.map((c: string) => <option key={c}>{c}</option>)}</select>
          {r?.reveal && <span className="text-xs sm:col-span-2">{r.reveal[t] === val?.[t] ? '✓' : `✗ ${r.reveal[t]}`}</span>}</label>)}</div>
      : <div><p className="mb-2 font-medium">{it.stem}</p><QuestionInput q={it} value={val} onChange={setVal} disabled={!!r} eliminated={h?.eliminate != null ? [h.eliminate] : []} /></div>}
      {hintText && <p className="mt-2 rounded bg-amber-50 p-2 text-sm">💡 {hintText}</p>}
      {r && game !== 'flashcards' && <p role="status" className={`mt-2 rounded p-2 text-sm ${r.correct ? 'bg-brand-50' : 'bg-red-50'}`}>{r.error ?? `${r.correct ? '✓' : '✗'} ${r.feedback} (+${r.score} of ${r.max})`}</p>}
      <div className="mt-2 flex gap-2">{!r && game !== 'flashcards' && <><Button disabled={val == null} onClick={() => check(it.id, val)}>Check</Button>{p.settings?.hintsEnabled !== false && <Button variant="ghost" onClick={() => hint(it.id)} disabled={!!hints[it.id]}><Lightbulb className="h-4 w-4" aria-hidden />Hint (−{p.settings?.hintCost ?? 3})</Button>}</>}
        {(r || game === 'flashcards') && <Button variant={r ? 'primary' : 'ghost'} onClick={next}>{i + 1 >= p.items.length ? 'Finish preview' : 'Next'}</Button>}</div></div></div>;
}

export function GameDesignPage() {
  const { id } = useParams(); const qc = useQueryClient(); const nav = useNavigate();
  const d = useQuery({ queryKey: ['game-design', id], queryFn: () => api<any>(`/api/game-designs/${id}`) });
  const stats = useQuery({ queryKey: ['game-stats', id], queryFn: () => api<any>(`/api/game-designs/${id}/stats`) });
  const [editing, setEditing] = useState(false); const [verified, setVerified] = useState(false); const [comment, setComment] = useState(''); const [year, setYear] = useState('');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['game-design', id] }); qc.invalidateQueries({ queryKey: ['game-designs'] }); };
  const act = useMutation({ mutationFn: ({ path, body }: { path: string; body?: any }) => post<any>(`/api/game-designs/${id}/${path}`, body ?? {}), onSuccess: () => { setComment(''); setVerified(false); refresh(); }, onError: refresh });
  const remove = useMutation({ mutationFn: () => del(`/api/game-designs/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['game-designs'] }); nav('/admin/games'); } });
  if (d.isLoading) return <Spinner />; if (d.error) return <Alert>{d.error.message}</Alert>;
  const { design: g, info, validation: v, questions, versions, reviews, permissions: p, subject } = d.data;
  if (editing) return <section className="space-y-4"><GameEditor initial={g} onDone={(r) => { setEditing(false); if (r) refresh(); }} /></section>;
  const doAct = (path: string, body?: any) => act.mutateAsync({ path, body });
  const s = stats.data;
  return <section className="space-y-4"><Link to="/admin/games" className="text-sm text-brand-700 underline">← Educational games</Link>
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold">{g.title}</h1><St v={g.status} /><span className="text-sm text-slate-600">{info.name} · version {g.version}</span>{g.answersVerifiedVersion === g.version && <span className="rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-900">Answers verified</span>}</div>
    <p className="text-sm text-slate-600">{subject?.name} · Topic: {g.topic} · Objective: {g.objective} · {g.difficulty} · {g.settings?.pointsPerItem ?? 10} points per item · hints {g.settings?.hintsEnabled === false ? 'off' : `on (−${g.settings?.hintCost ?? 3})`}{g.settings?.timeLimitSec ? ` · ${g.settings.timeLimitSec}s` : ''}{g.source?.generated ? ` · generated from ${g.source.from.length} approved source item(s)` : ''}</p>
    <ValidationPanel v={v} />
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Card><h2 className="mb-2 font-semibold">Preview as a student</h2><GamePreview id={id!} game={g.type} /></Card>
      <Card><h2 className="mb-2 font-semibold">Content</h2>
        {questions.length > 0 && <><h3 className="text-sm font-medium">Bank questions</h3><ul className="list-disc pl-5 text-sm">{questions.map((q: any) => <li key={q._id}><Link className="text-brand-700 underline" to={`/admin/questions/${q._id}`}>{q.stem}</Link> ({q.type.replace(/_/g, ' ')}, {q.status === 'published' ? (q.keyVerified ? 'approved, key verified' : 'approved, key not verified') : q.status.replace(/_/g, ' ')})</li>)}</ul></>}
        {Object.entries(g.content ?? {}).map(([k, val]) => <div key={k}><h3 className="mt-2 text-sm font-medium">{k}</h3><pre tabIndex={0} aria-label={`Game content ${k}`} className="max-h-60 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(val, null, 1)}</pre></div>)}
        {g.source?.from?.length > 0 && <details className="mt-2 text-sm"><summary>Generated from</summary><ul className="list-disc pl-5">{g.source.from.map((x: any) => <li key={x.kind + x.id}>{x.kind}: {x.title}</li>)}</ul></details>}</Card>
    </div>
    <Card><h2 className="mb-2 font-semibold">Workflow</h2><div className="flex flex-wrap gap-2">
      {p.edit && <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>}
      {p.submit && <ConfirmButton tone="primary" variant="primary" className="px-3 py-1.5 text-sm" label={g.status === 'changes_requested' ? 'Resubmit for review' : 'Submit for review'} title="Submit this game for review?" body={<p>A Content Reviewer who did not create or edit it will play it and verify the answers.</p>} onConfirm={() => doAct('submit')} />}
      {g.status === 'approved' && (p.publish ? <><div className="w-40"><Input label="Only for year (optional)" type="number" min={1} max={6} value={year} onChange={(e) => setYear(e.target.value)} /></div>
        <ConfirmButton tone="primary" variant="primary" className="self-end px-3 py-1.5 text-sm" label="Publish" title={`Publish “${g.title}”?`} body={<p>Students {year ? `in year ${year} ` : ''}enrolled in {subject?.name} will see it in their games list.</p>} onConfirm={() => doAct('publish', { audience: year ? { yearOfStudy: Number(year) } : {} })} /></> : <p className="text-sm text-slate-600">Publishing blocked: {p.publishBlock}</p>)}
      {p.unpublish && <ConfirmButton tone="primary" variant="ghost" className="px-3 py-1.5 text-sm" label="Unpublish" title="Unpublish this game?" body={<p>Students no longer see it. Past plays and scores are kept.</p>} onConfirm={() => doAct('unpublish', {})} />}
      {p.archive && <ConfirmButton className="px-3 py-1.5 text-sm" label="Archive" title="Archive this game?" body={<p>It is hidden from students and from the list of active games. It can be restored to draft.</p>} onConfirm={() => doAct('archive', {})} />}
      {p.restore && <ConfirmButton tone="primary" variant="ghost" className="px-3 py-1.5 text-sm" label="Restore to draft" title="Restore this game?" body={<p>It returns as a draft and needs review again.</p>} onConfirm={() => doAct('restore')} />}
      {p.delete && <ConfirmButton className="px-3 py-1.5 text-sm" label="Delete draft" title="Delete this draft permanently?" body={<p>It has never been published or played. This cannot be undone.</p>} onConfirm={() => remove.mutateAsync()} />}</div>
      {['in_review', 'resubmitted'].includes(g.status) && (p.decide ? <form aria-label="Review" className="mt-3 space-y-2 rounded border p-3" onSubmit={(e) => e.preventDefault()}>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /><span>I played the preview and verified every answer in this game.</span></label>
        <div><label className="text-sm font-medium" htmlFor="gcomment">Comment (required to request changes)</label><textarea id="gcomment" className="h-16 w-full rounded border p-2 text-sm" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        <div className="flex gap-2"><ConfirmButton tone="primary" variant="primary" className="px-3 py-1.5 text-sm" disabled={!verified || !v.ok} label="Approve" title="Approve this game?" body={<p>Your answer verification for version {g.version} is recorded. A Content Reviewer can then publish it.</p>} onConfirm={() => doAct('review', { action: 'approve', answersVerified: true, comment: comment || undefined })} />
          <ConfirmButton tone="primary" variant="ghost" className="px-3 py-1.5 text-sm" disabled={!comment.trim()} label="Request changes" title="Send back to the author?" body={<p>The author sees your comment and can edit and resubmit.</p>} onConfirm={() => doAct('review', { action: 'request_changes', comment })} /></div></form>
        : <p className="mt-2 text-sm text-slate-600">{p.decideBlock}</p>)}
      {g.status === 'approved' && p.decide && <div className="mt-2"><ConfirmButton tone="primary" variant="ghost" className="px-3 py-1.5 text-sm" label="Send back for changes" title="Send back for changes?" body={<p>Add a comment in the review log below explaining what to change.</p>} onConfirm={() => doAct('review', { action: 'request_changes', comment: comment || 'Changes needed before publishing' })} /></div>}
      {(act.error || remove.error) && <Alert>{(act.error ?? remove.error)!.message}</Alert>}</Card>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Card><h2 className="mb-2 font-semibold">Participation and performance</h2>{!s ? <Spinner /> : <><dl className="grid grid-cols-2 gap-1 text-sm"><dt>Sessions</dt><dd>{s.sessions} ({s.finished} finished{s.completionPct != null ? `, ${s.completionPct}% completion` : ''})</dd><dt>Players</dt><dd>{s.players}</dd>
          <dt>Average score</dt><dd>{s.averageScorePct != null ? `${s.averageScorePct}%` : '—'}</dd><dt>Average accuracy</dt><dd>{s.averageAccuracy != null ? `${s.averageAccuracy}%` : '—'}</dd><dt>Hints used</dt><dd>{s.hintsUsed}</dd><dt>XP awarded</dt><dd>{s.xpAwarded}</dd><dt>Last played</dt><dd>{s.lastPlayed ? new Date(s.lastPlayed).toLocaleString() : 'Never'}</dd></dl>
        {s.items.length > 0 && <table className="mt-2 w-full text-left text-sm"><caption className="text-left text-sm font-medium">Hardest items first</caption><thead><tr className="border-b"><th>Item</th><th>Answers</th><th>Correct</th></tr></thead><tbody>{s.items.map((x: any) => <tr key={x.itemId} className="border-b"><td className="py-1">{x.label}</td><td>{x.answers}</td><td>{x.correctPct}%</td></tr>)}</tbody></table>}
        <p className="mt-1 text-xs text-slate-600">Counts real student sessions only; previews are not recorded.</p></>}</Card>
      <Card><h2 className="mb-2 font-semibold">Versions and history</h2><ul className="text-sm">{versions.map((x: any) => <li key={x.version} className="border-b py-1">Version {x.version}: {x.reason} · {x.by ?? 'unknown'} · {new Date(x.at).toLocaleString()}</li>)}</ul>
        <h3 className="mt-3 text-sm font-medium">Review log</h3><ol className="text-sm">{reviews.map((r: any, i: number) => <li key={i} className="border-b py-1">{REVIEW_ACTION_LABEL[r.action] ?? r.action} (v{r.version}) by {r.by ?? 'unknown'}, {new Date(r.at).toLocaleString()}{r.comment ? `: “${r.comment}”` : ''}</li>)}</ol></Card>
    </div></section>;
}
