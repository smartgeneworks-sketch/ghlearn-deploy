import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Lightbulb, RotateCcw, Trophy } from 'lucide-react';
import { api, post } from '../lib/api';
import { Alert, Button, Card, Input, Spinner } from '../components/ui';
import { QuestionInput } from '../components/QuestionInput';

export function GamesHome() {
  const { subjectId } = useParams(); const nav = useNavigate(); const [topic, setTopic] = useState('');
  const games = useQuery({ queryKey: ['games'], queryFn: () => api<{ games: any[] }>('/api/games').then((r) => r.games) });
  const start = useMutation({ mutationFn: (game: string) => post<any>('/api/games/sessions', { subjectId, game, topic: topic || undefined }), onSuccess: (r) => nav(`/learn/${subjectId}/games/${r.session._id}`) });
  const designs = useQuery({ queryKey: ['game-designs-pub', subjectId], queryFn: () => api<{ items: any[] }>(`/api/games/designs?subjectId=${subjectId}`).then((r) => r.items) });
  const play = useMutation({ mutationFn: (designId: string) => post<any>('/api/games/sessions', { designId }), onSuccess: (r) => nav(`/learn/${subjectId}/games/${r.session._id}`) });
  return <section className="space-y-4"><Link to={`/learn/${subjectId}`} className="text-sm text-brand-700 underline">← Back to subject</Link><h1 className="text-2xl font-bold">Learning games</h1>
    <p className="text-sm text-slate-600">Every game uses approved content from your subject. You earn XP for correct answers and for beating your best score, never for time spent.</p>
    {designs.data && designs.data.length > 0 && <section aria-labelledby="set-games"><h2 id="set-games" className="mb-2 text-lg font-semibold">Games for your topics</h2>{play.error && <Alert>{play.error.message}</Alert>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{designs.data.map((d) => <li key={d._id}><Card className="h-full"><h3 className="font-semibold">{d.title}</h3><p className="text-sm text-slate-600">{d.info.name} · {d.topic} · {d.difficulty}</p>
        <p className="mt-1 text-sm">Goal: {d.objective}</p><p className="mt-1 text-xs text-slate-600">{d.items} item(s){d.timeLimitSec ? ` · ${Math.round(d.timeLimitSec / 60) || 1} min` : ''}{d.hintsEnabled ? ' · hints available' : ' · no hints'}{d.plays ? ` · played ${d.plays}×, best ${d.best}` : ''}</p>
        <Button className="mt-3" onClick={() => play.mutate(d._id)} loading={play.isPending && play.variables === d._id} aria-label={`Play ${d.title}`}>Play</Button></Card></li>)}</ul></section>}
    <h2 className="text-lg font-semibold">Quick play</h2><p className="text-sm text-slate-600">Mixes approved questions and lessons from the whole subject (or one topic).</p>
    <div className="max-w-xs"><Input label="Topic (optional)" value={topic} onChange={(e) => setTopic(e.target.value)} /></div>
    {start.error && <Alert>{start.error.message}</Alert>}
    {games.isLoading ? <Spinner /> : <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{games.data?.map((g) => <li key={g.key}><Card className="h-full"><h2 className="font-semibold">{g.name}</h2><p className="mb-3 text-sm text-slate-600">{g.description}</p>
      <Button onClick={() => start.mutate(g.key)} loading={start.isPending && start.variables === g.key}>Play</Button></Card></li>)}</ul>}</section>;
}
export function WordSearch({ s, onFound, found }: { s: any; onFound: (itemId: string, a: any) => Promise<any>; found: Record<string, any> }) {
  const grid: string[] = s.items[0].grid; const [sel, setSel] = useState<[number, number] | null>(null); const [msg, setMsg] = useState(''); const [typed, setTyped] = useState('');
  const cells = new Set(Object.values(found).filter((f: any) => f?.reveal).flatMap((f: any) => { const { start, end } = f.reveal; const dr = Math.sign(end[0] - start[0]), dc = Math.sign(end[1] - start[1]); const n = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1])) + 1; return [...Array(n)].map((_, i) => `${start[0] + dr * i},${start[1] + dc * i}`); }));
  const pick = async (r: number, c: number) => { if (!sel) { setSel([r, c]); setMsg(`Start at row ${r + 1}, column ${c + 1}. Now choose the last letter.`); return; }
    const [r0, c0] = sel; setSel(null); const dr = Math.sign(r - r0), dc = Math.sign(c - c0); const n = Math.max(Math.abs(r - r0), Math.abs(c - c0)) + 1;
    const word = [...Array(n)].map((_, i) => grid[r0 + dr * i]?.[c0 + dc * i] ?? '').join('');
    const item = s.items.find((it: any) => !found[it.id]?.correct && it.length === word.length); if (!item) { setMsg(`"${word}" is not one of the words.`); return; }
    const cand = s.items.filter((it: any) => !found[it.id]?.correct && it.length === word.length);
    for (const it of cand) { const r1 = await onFound(it.id, { word, start: [r0, c0], end: [r, c] }); if (r1?.correct) { setMsg(r1.feedback); return; } }
    setMsg(`"${word}" is not one of the words.`); };
  return <div className="grid gap-4 md:grid-cols-2"><div><table className="border-collapse font-mono" aria-label="Word search grid"><tbody>{grid.map((row, r) => <tr key={r}>{[...row].map((ch, c) => <td key={c}>
      <button aria-label={`Row ${r + 1} column ${c + 1}: ${ch}`} onClick={() => pick(r, c)} className={`h-8 w-8 border text-center ${cells.has(`${r},${c}`) ? 'bg-brand-100 font-bold' : sel && sel[0] === r && sel[1] === c ? 'bg-amber-200' : 'hover:bg-slate-100'}`}>{ch}</button></td>)}</tr>)}</tbody></table>
      <p role="status" className="mt-2 text-sm">{msg}</p></div>
    <div><h3 className="font-medium">Clues</h3><ol className="list-decimal space-y-1 pl-5 text-sm">{s.items.map((it: any) => <li key={it.id} className={found[it.id]?.correct ? 'line-through' : ''}>{it.clue} ({it.length} letters)</li>)}</ol>
      <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); const w = typed.trim().toUpperCase(); const cand = s.items.filter((it: any) => !found[it.id]?.correct && it.length === w.length); for (const it of cand) { const r = await onFound(it.id, { word: w }); if (r?.correct) { setMsg(r.feedback); setTyped(''); return; } } setMsg('Not one of the words.'); }}>
        <Input label="Accessible mode: type a word you found" value={typed} onChange={(e) => setTyped(e.target.value)} /><Button type="submit" className="self-end">Check</Button></form></div></div>;
}
export function GamePlayPage() {
  const { subjectId, sessionId } = useParams(); const nav = useNavigate();
  const q = useQuery({ queryKey: ['game', sessionId], queryFn: () => api<{ session: any }>(`/api/games/sessions/${sessionId}`).then((r) => r.session) });
  const [i, setI] = useState(0); const [val, setVal] = useState<any>(null); const [res, setRes] = useState<Record<string, any>>({}); const [hints, setHints] = useState<Record<string, any>>({}); const [flipped, setFlipped] = useState(false);
  const [final, setFinal] = useState<any>(null); const [queue, setQueue] = useState<string[]>([]); const [left, setLeft] = useState<number | null>(null);
  const s = q.data;
  useEffect(() => { if (s) { setQueue(s.items.map((x: any) => x.id)); setRes(Object.fromEntries(s.answered.map((a: any) => [a.itemId, a]))); if (s.status === 'finished') setFinal(s); } }, [s?._id]);
  useEffect(() => { if (!s?.deadline || final) return; const t = setInterval(() => { const l = Math.max(0, Math.floor((new Date(s.deadline).getTime() - Date.now()) / 1000)); setLeft(l); if (l <= 0) { clearInterval(t); finish.mutate(); } }, 1000); return () => clearInterval(t); }, [s?.deadline, final]);
  const answer = async (itemId: string, a: any) => { const r = await post<any>(`/api/games/sessions/${sessionId}/answer`, { itemId, answer: a }).catch((e) => ({ error: e.message })); setRes((x) => ({ ...x, [itemId]: r })); return r; };
  const finish = useMutation({ mutationFn: () => post<any>(`/api/games/sessions/${sessionId}/finish`, {}), onSuccess: (r) => setFinal(r.session) });
  const replay = useMutation({ mutationFn: () => post<any>('/api/games/sessions', s.designId ? { designId: s.designId } : { subjectId, game: s.game, topic: s.topic }), onSuccess: (r) => { setFinal(null); setI(0); setRes({}); setHints({}); nav(`/learn/${subjectId}/games/${r.session._id}`); } });
  if (q.isLoading) return <Spinner />; if (q.error) return <Alert>{q.error.message}</Alert>;
  const header = <div className="flex flex-wrap items-center justify-between gap-2"><Link to={`/learn/${subjectId}/games`} className="text-sm text-brand-700 underline">← Games</Link>
    <h1 className="text-xl font-bold">{s.title ?? <>{s.info.name}{s.topic && `: ${s.topic}`}</>}</h1><span className="rounded bg-slate-100 px-2 py-1 text-sm" aria-live="polite">Score {Object.values(res).reduce((t: number, r: any) => t + (r?.score ?? 0), 0)}{left != null && ` · ${left}s left`}</span></div>;
  if (final) return <section className="space-y-4">{header}<Card><p className="flex items-center gap-2 text-2xl font-bold"><Trophy className="h-6 w-6 text-amber-500" aria-hidden />{final.score} / {final.maxScore}</p>
    <p>Accuracy {final.accuracy}% · hints used {final.hintsUsed}</p><p className="text-sm">⭐ +{final.xpAwarded ?? 0} XP{final.reward?.replay ? (final.xpAwarded ? ' for beating your best score' : ` (replay: beat your best of ${final.reward.previousBest} to earn XP)`) : ''}</p>
    {final.reward?.newBadges?.length > 0 && <p className="text-sm">🏅 New badge: {final.reward.newBadges.join(', ')}</p>}
    <Button className="mt-3" onClick={() => replay.mutate()} loading={replay.isPending}><RotateCcw className="h-4 w-4" aria-hidden />Play again</Button></Card></section>;
  if (s.game === 'word_search') return <section className="space-y-4">{header}<Card><WordSearch s={s} found={res} onFound={answer} /><Button className="mt-4" onClick={() => finish.mutate()}>Finish</Button></Card></section>;
  const id = queue[i]; const it = s.items.find((x: any) => x.id === id); const r = res[id];
  const next = () => { setVal(null); setFlipped(false); if (i + 1 >= queue.length) finish.mutate(); else setI(i + 1); };
  const getHint = async () => { const hr = await post<any>(`/api/games/sessions/${sessionId}/hint`, { itemId: id }); setHints((x) => ({ ...x, [id]: hr })); };
  if (!it) return <section>{header}<Button onClick={() => finish.mutate()}>Finish</Button></section>;
  const h = hints[id]?.hint; const hintText = typeof h === 'string' ? h : h?.text;
  return <section className="space-y-4">{header}<p className="text-sm text-slate-500">Item {i + 1} of {queue.length}{it.topic && ` · ${it.topic}`}</p>
    <Card>{s.game === 'flashcards' ? <div className="text-center"><p className="text-xl font-semibold">{it.front}</p>
        {!flipped ? <Button className="mt-4" onClick={() => setFlipped(true)}>Flip card</Button> : !r ? <div className="mt-4 flex justify-center gap-2"><Button onClick={async () => { const x = await answer(id, { knew: true }); void x; }}>I knew it</Button><Button variant="ghost" onClick={async () => { await answer(id, { knew: false }); setQueue((q2) => [...q2, id]); }}>Not yet</Button></div>
          : <p className="mt-4 rounded bg-brand-50 p-3">{r.reveal}</p>}</div>
      : s.game === 'classification' ? <div><p className="mb-2 font-medium">{it.title}</p><div className="grid gap-2">{it.things.map((t: string) => <label key={t} className="grid items-center gap-2 sm:grid-cols-2"><span>{t}</span>
          <select className="rounded border px-2 py-1" disabled={!!r} value={val?.[t] ?? ''} onChange={(e) => setVal({ ...(val ?? {}), [t]: e.target.value })}><option value="">Choose group…</option>{it.categories.map((c: string) => <option key={c}>{c}</option>)}</select>
          {r?.reveal && <span className="text-xs sm:col-span-2">{r.reveal[t] === val?.[t] ? '✓' : `✗ ${r.reveal[t]}`}</span>}</label>)}</div></div>
      : <div><p className="mb-2 font-medium">{it.stem}</p><QuestionInput q={it} value={val} onChange={setVal} disabled={!!r} eliminated={h?.eliminate != null ? [h.eliminate] : []} /></div>}
      {hintText && <p className="mt-2 rounded bg-amber-50 p-2 text-sm">💡 {hintText}</p>}
      {r && s.game !== 'flashcards' && <p role="status" className={`mt-2 rounded p-2 text-sm ${r.correct ? 'bg-brand-50' : 'bg-red-50'}`}>{r.error ?? `${r.correct ? '✓' : '✗'} ${r.feedback} (+${r.score}${r.bonus ? `, streak bonus +${r.bonus}` : ''})`}{r.reveal && !r.correct && typeof r.reveal === 'string' && <> Answer: <strong>{r.reveal}</strong></>}</p>}
      <div className="mt-3 flex gap-2">{!r && s.game !== 'flashcards' && <><Button disabled={val == null} onClick={() => answer(id, val)}>Check</Button>{s.hintsEnabled !== false && <Button variant="ghost" onClick={getHint} disabled={!!hints[id]}><Lightbulb className="h-4 w-4" aria-hidden />Hint (−{s.hintCost ?? 3})</Button>}</>}
        {(r || (s.game === 'flashcards' && r)) && <Button onClick={next}>{i + 1 >= queue.length ? 'Finish' : 'Next'}</Button>}
        <Button variant="ghost" onClick={() => finish.mutate()}>End game</Button></div></Card></section>;
}
