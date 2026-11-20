import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ThumbsUp, ThumbsDown, Trash2, Plus } from 'lucide-react';
import { api, post, del, streamPost } from '../lib/api';
import { Markdown } from '../components/Markdown';
import { Alert, Button, Card } from '../components/ui';
const TYPE: Record<string, [string, string]> = { source: ['From your curriculum materials', 'bg-brand-50 text-brand-900'], mixed: ['Curriculum + general knowledge', 'bg-amber-50 text-amber-900'], general: ['General knowledge (not from your materials)', 'bg-amber-50 text-amber-900'], refusal: ['Outside this subject', 'bg-slate-100'], error: ['Error', 'bg-red-50 text-red-800'] };

export function TutorPage() {
  const { subjectId } = useParams(); const qc = useQueryClient();
  const convs = useQuery({ queryKey: ['convs', subjectId], queryFn: () => api<{ items: any[]; retentionDays: number }>(`/api/tutor/conversations?subjectId=${subjectId}`) });
  const [cid, setCid] = useState<string | null>(null);
  const msgs = useQuery({ queryKey: ['msgs', cid], enabled: !!cid, queryFn: () => api<{ items: any[] }>(`/api/tutor/conversations/${cid}/messages`).then((r) => r.items) });
  const create = useMutation({ mutationFn: () => post<any>('/api/tutor/conversations', { subjectId }), onSuccess: (r) => { setCid(r.conversation._id); qc.invalidateQueries({ queryKey: ['convs', subjectId] }); } });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/tutor/conversations/${id}`), onSuccess: () => { setCid(null); qc.invalidateQueries({ queryKey: ['convs', subjectId] }); } });
  const fb = useMutation({ mutationFn: ({ id, rating }: { id: string; rating: string }) => post(`/api/tutor/messages/${id}/feedback`, { rating }), onSuccess: () => qc.invalidateQueries({ queryKey: ['msgs', cid] }) });
  const [text, setText] = useState(''); const [mode, setMode] = useState<'hint' | 'explain' | 'check'>('hint');
  const [live, setLive] = useState<{ q: string; a: string; sources: any[] } | null>(null); const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!cid && convs.data?.items[0]) setCid(convs.data.items[0]._id); }, [convs.data, cid]);
  useEffect(() => { end.current?.scrollIntoView?.({ behavior: 'smooth' }); }, [msgs.data, live?.a]);
  async function send() {
    let id = cid; if (!id) id = (await create.mutateAsync()).conversation._id;
    const q = text.trim(); if (!q) return; setText(''); setErr(null); setLive({ q, a: '', sources: [] });
    try {
      await streamPost(`/api/tutor/conversations/${id}/messages`, { content: q, mode }, (ev, d) => {
        if (ev === 'meta') setLive((l) => l && { ...l, sources: d.sources });
        if (ev === 'delta') setLive((l) => l && { ...l, a: l.a + d.text });
        if (ev === 'error') setErr(d.message);
      });
    } catch (e: any) { setErr(e.message); }
    setLive(null); qc.invalidateQueries({ queryKey: ['msgs', id] }); qc.invalidateQueries({ queryKey: ['convs', subjectId] });
  }
  return <section className="grid gap-4 lg:grid-cols-4">
    <aside className="space-y-2"><Link to={`/learn/${subjectId}`} className="text-sm text-brand-700 underline">← Back to subject</Link>
      <Button className="w-full" onClick={() => create.mutate()}><Plus className="h-4 w-4" aria-hidden />New conversation</Button>
      <ul className="space-y-1" aria-label="Conversations">{convs.data?.items.map((c) => <li key={c._id} className="flex items-center gap-1"><button onClick={() => setCid(c._id)} className={`flex-1 truncate rounded px-2 py-1 text-left text-sm ${c._id === cid ? 'bg-brand-50 font-medium' : 'hover:bg-slate-100'}`}>{c.title}</button>
        <button aria-label="Delete conversation" onClick={() => confirm('Delete this conversation?') && remove.mutate(c._id)} className="p-1 text-slate-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button></li>)}</ul>
      <p className="text-xs text-slate-500">Conversations are kept for {convs.data?.retentionDays ?? 180} days, then deleted automatically. Don't share personal information.</p></aside>
    <div className="lg:col-span-3"><Card className="flex h-[70vh] flex-col">
      <h1 className="mb-2 text-lg font-bold">Subject tutor</h1>
      <div className="flex-1 space-y-3 overflow-y-auto" aria-live="polite">
        {msgs.data?.map((m) => m.role === 'user' ? <div key={m._id} className="ml-auto max-w-[80%] rounded-lg bg-brand-700 px-3 py-2 text-white">{m.content}</div> :
          <div key={m._id} className="max-w-[90%] rounded-lg border bg-white px-3 py-2">{m.answerType && <span className={`mb-1 inline-block rounded px-2 text-xs ${TYPE[m.answerType]?.[1]}`}>{TYPE[m.answerType]?.[0]}</span>}
            <Markdown text={m.content} />
            {!!m.citations?.length && <details className="mt-1 text-xs text-slate-600"><summary>Sources ({m.citations.length})</summary><ul>{m.citations.map((c: any, i: number) => <li key={i}>p.{c.pageStart}{c.pageEnd !== c.pageStart && `–${c.pageEnd}`}: "{c.quote?.slice(0, 160)}…"</li>)}</ul></details>}
            {m.answerType !== 'error' && <div className="mt-1 flex gap-1"><button aria-label="Helpful" aria-pressed={m.feedback?.rating === 'up'} onClick={() => fb.mutate({ id: m._id, rating: 'up' })} className={`rounded p-1 ${m.feedback?.rating === 'up' ? 'text-brand-700' : 'text-slate-400'}`}><ThumbsUp className="h-4 w-4" /></button>
              <button aria-label="Not helpful" aria-pressed={m.feedback?.rating === 'down'} onClick={() => fb.mutate({ id: m._id, rating: 'down' })} className={`rounded p-1 ${m.feedback?.rating === 'down' ? 'text-red-700' : 'text-slate-400'}`}><ThumbsDown className="h-4 w-4" /></button></div>}</div>)}
        {live && <><div className="ml-auto max-w-[80%] rounded-lg bg-brand-700 px-3 py-2 text-white">{live.q}</div><div className="max-w-[90%] rounded-lg border px-3 py-2">{live.a ? <Markdown text={live.a} /> : <span className="text-sm text-slate-500">Searching your materials… ({live.sources.length} passages)</span>}</div></>}
        {!msgs.data?.length && !live && <Alert tone="info">Ask a question about this subject. In <strong>hint</strong> mode I'll guide you step by step instead of giving the answer straight away.</Alert>}
        <div ref={end} />
      </div>
      {err && <Alert>{err}</Alert>}
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label className="sr-only" htmlFor="mode">Mode</label><select id="mode" value={mode} onChange={(e) => setMode(e.target.value as any)} className="rounded border px-2"><option value="hint">Hint first</option><option value="explain">Explain</option><option value="check">Check my answer</option></select>
        <label className="sr-only" htmlFor="q">Your question</label><input id="q" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Ask about this subject…" className="min-w-0 flex-1 rounded border px-3 py-2" />
        <Button type="submit" disabled={!text.trim() || !!live}>Send</Button></form>
    </Card></div></section>;
}
