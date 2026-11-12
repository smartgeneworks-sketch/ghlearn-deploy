import { ArrowDown, ArrowUp } from 'lucide-react';
const safeSvg = (s?: string) => !!s && s.startsWith('<svg') && !/<script|on\w+=|href=|<foreignObject/i.test(s);
type P = { q: any; value: any; onChange: (v: any) => void; disabled?: boolean; eliminated?: number[] };
const box = 'rounded border px-2 py-1 disabled:bg-slate-50';
function Choice({ name, options, value, onChange, disabled, eliminated }: { name: string; options: string[]; value: any; onChange: (v: number) => void; disabled?: boolean; eliminated?: number[] }) {
  return <div role="radiogroup" className="grid gap-1">{options.map((o, j) => <label key={j} className={`flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-50 ${eliminated?.includes(j) ? 'line-through opacity-50' : ''}`}>
    <input type="radio" name={name} disabled={disabled || eliminated?.includes(j)} checked={value === j} onChange={() => onChange(j)} /><span>{String.fromCharCode(65 + j)}. {o}</span></label>)}</div>;
}
/** Accessible inputs for every question type: everything works with keyboard and screen readers (no drag-only interactions). */
export function QuestionInput({ q, value, onChange, disabled, eliminated }: P) {
  const id = `q-${q.id}`;
  switch (q.type) {
    case 'mcq': return <Choice name={id} options={q.options} value={value} onChange={onChange} disabled={disabled} eliminated={eliminated} />;
    case 'true_false': return <div role="radiogroup" className="flex gap-4">{[true, false].map((v) => <label key={String(v)} className="flex items-center gap-2"><input type="radio" name={id} disabled={disabled} checked={value === v} onChange={() => onChange(v)} />{v ? 'True' : 'False'}</label>)}</div>;
    case 'short_answer': return <><label className="sr-only" htmlFor={id}>Your answer</label><input id={id} className={`${box} w-full`} disabled={disabled} value={value ?? ''} maxLength={500} onChange={(e) => onChange(e.target.value)} /></>;
    case 'essay': { const words = String(value ?? '').trim().split(/\s+/).filter(Boolean).length;
      return <div><label className="sr-only" htmlFor={id}>Your answer</label><textarea id={id} className={`${box} h-48 w-full`} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
        <p className="text-xs text-slate-500">{words} words{q.wordLimit ? ` (aim for up to ${q.wordLimit})` : ''}</p>
        {q.rubric?.length > 0 && <details className="text-sm"><summary>How this is marked</summary><ul className="list-disc pl-5">{q.rubric.map((c: any) => <li key={c.criterion}>{c.criterion}: {c.maxMarks} marks</li>)}</ul></details>}</div>; }
    case 'gap_fill': { const parts = String(q.text).split(/(\{\{\d+\}\})/); const v: string[] = Array.isArray(value) ? value : [];
      return <p className="leading-9">{parts.map((p, i) => { const m = p.match(/^\{\{(\d+)\}\}$/); if (!m) return <span key={i}>{p}</span>; const n = Number(m[1]) - 1;
        return <input key={i} aria-label={`Blank ${n + 1}`} className={`${box} mx-1 w-32`} disabled={disabled} value={v[n] ?? ''} onChange={(e) => { const c = [...v]; c[n] = e.target.value; onChange(c); }} />; })}
        {q.wordBank && <span className="block text-sm text-slate-500">Word bank: {q.wordBank.join(', ')}</span>}</p>; }
    case 'matching': { const v: any[] = Array.isArray(value) ? value : [];
      return <div className="grid gap-2">{q.left.map((l: string, i: number) => <label key={i} className="grid items-center gap-2 sm:grid-cols-2"><span className="font-medium">{l}</span>
        <select className={box} disabled={disabled} value={v[i] ?? ''} onChange={(e) => { const c = [...v]; c[i] = e.target.value === '' ? null : Number(e.target.value); onChange(c); }}><option value="">Choose a match…</option>{q.right.map((r: string, j: number) => <option key={j} value={j}>{r}</option>)}</select></label>)}</div>; }
    case 'ordering': { const order: number[] = Array.isArray(value) && value.length === q.items.length ? value : q.items.map((_: any, i: number) => i);
      const move = (i: number, d: number) => { const c = [...order]; [c[i], c[i + d]] = [c[i + d], c[i]]; onChange(c); };
      return <ol className="space-y-1" aria-label="Order the items; use the arrow buttons to move them">{order.map((x, i) => <li key={x} className="flex items-center gap-2 rounded border bg-white px-2 py-1"><span className="w-6 text-slate-500">{i + 1}.</span><span className="flex-1">{q.items[x]}</span>
        <button type="button" aria-label={`Move "${q.items[x]}" up`} disabled={disabled || i === 0} onClick={() => move(i, -1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
        <button type="button" aria-label={`Move "${q.items[x]}" down`} disabled={disabled || i === order.length - 1} onClick={() => move(i, 1)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button></li>)}</ol>; }
    case 'diagram_labelling': { const v: string[] = Array.isArray(value) ? value : [];
      return <div className="grid gap-3 md:grid-cols-2">{safeSvg(q.svg) && <div role="img" aria-label={q.alt} className="rounded border bg-white p-1" dangerouslySetInnerHTML={{ __html: q.svg }} />}
        <div className="space-y-2">{q.labels.map((n: number, i: number) => <label key={n} className="flex items-center gap-2"><span className="w-10 font-semibold">({n})</span><input className={`${box} flex-1`} disabled={disabled} value={v[i] ?? ''} onChange={(e) => { const c = [...v]; c[i] = e.target.value; onChange(c); }} /></label>)}</div></div>; }
    case 'numerical': { const v = value ?? {}; return <div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor={id}>Value</label><input id={id} inputMode="decimal" className={`${box} w-40`} disabled={disabled} value={v.value ?? ''} onChange={(e) => onChange({ ...v, value: e.target.value })} />
      {q.requireUnit ? <><label className="sr-only" htmlFor={`${id}-u`}>Unit</label><input id={`${id}-u`} placeholder="unit" className={`${box} w-24`} disabled={disabled} value={v.unit ?? ''} onChange={(e) => onChange({ ...v, unit: e.target.value })} /></> : q.unit && <span>{q.unit}</span>}</div>; }
    case 'structured': case 'case_study': { const v: any[] = Array.isArray(value) ? value : [];
      return <div className="space-y-3">{q.scenario && <blockquote className="rounded border-l-4 border-brand-700 bg-brand-50 p-3 text-sm">{q.scenario}</blockquote>}
        {q.parts.map((p: any, i: number) => <div key={i}><p className="font-medium">({String.fromCharCode(97 + i)}) {p.prompt} <span className="text-xs text-slate-500">[{p.marks} mark{p.marks === 1 ? '' : 's'}]</span></p>
          <QuestionInput q={{ ...p, id: `${q.id}-${i}`, type: p.type }} value={v[i]} disabled={disabled} onChange={(x) => { const c = [...v]; c[i] = x; onChange(c); }} /></div>)}</div>; }
  }
  return <p>Unsupported question type.</p>;
}
export function ResultBox({ r }: { r: any }) {
  if (!r) return null; const good = r.correct; const tone = r.needsReview ? 'border-amber-300 bg-amber-50' : good ? 'border-brand-700 bg-brand-50' : 'border-red-300 bg-red-50';
  return <div role="status" className={`mt-2 rounded border-l-4 p-2 text-sm ${tone}`}><p className="font-semibold">{r.score ?? 0}/{r.maxScore} {r.markedBy === 'ai_provisional' && '· provisional AI mark'}{r.markedBy === 'teacher' && '· marked by your teacher'}{r.markedBy === 'pending' && '· waiting for your teacher'}</p>
    {r.feedback && <p>{r.feedback}</p>}{r.explanation && <p className="mt-1">{r.explanation}</p>}
    {r.correctAnswer != null && !good && typeof r.correctAnswer !== 'object' && <p className="mt-1">Answer: <strong>{String(r.correctAnswer)}</strong></p>}
    {r.criteria?.length > 0 && <ul className="mt-1 list-disc pl-5">{r.criteria.map((c: any) => <li key={c.criterion}>{c.criterion}: {c.marks}/{c.maxMarks}{c.comment && ` (${c.comment})`}</li>)}</ul>}
    {r.parts?.some?.((p: any) => p && typeof p === 'object') && <ul className="mt-1 list-disc pl-5">{r.parts.map((p: any, i: number) => p && typeof p === 'object' && <li key={i}>({String.fromCharCode(97 + i)}) {p.score}/{p.maxScore} {p.feedback}</li>)}</ul>}
    {r.teacherComment && <p className="mt-1">Teacher: “{r.teacherComment}”</p>}
    {r.improvement && <p className="mt-1">💡 {r.improvement}</p>}{r.revisionTopic && !good && <p className="text-xs">Revise: {r.revisionTopic}</p>}</div>;
}
