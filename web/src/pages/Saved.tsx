import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { listSaved, removeLesson } from '../lib/offline';
import { Alert, Card, Spinner } from '../components/ui';
import { LessonView } from '../components/LessonView';

/** Works without network or sign-in check: lessons come from the service worker cache. */
export function SavedPage() {
  const [items, setItems] = useState(listSaved());
  return <main id="main" className="mx-auto max-w-3xl space-y-4 p-4"><h1 className="text-2xl font-bold">Saved lessons</h1>
    <p className="text-sm text-slate-600">These approved lessons are stored on this device and open without internet. <Link className="text-brand-700 underline" to="/">Back to the app</Link></p>
    {items.length ? <ul className="space-y-2">{items.map((s) => <li key={s.id}><Card className="flex items-center justify-between gap-2"><Link className="font-semibold text-brand-700 underline" to={`/saved/${s.id}`}>{s.title}</Link>
      <span className="text-xs text-slate-500">saved {new Date(s.savedAt).toLocaleDateString()} <button className="ml-2 text-red-700 underline" onClick={() => removeLesson(s.id).then(() => setItems(listSaved()))}>Remove<span className="sr-only"> {s.title}</span></button></span></Card></li>)}</ul>
      : <Alert tone="info">No saved lessons. Open a lesson while online and choose “Save for offline”.</Alert>}</main>;
}
export function SavedLessonPage() {
  const { id } = useParams(); const s = listSaved().find((x) => x.id === id);
  const q = useQuery({ queryKey: ['saved', id], enabled: !!s, retry: false, queryFn: () => fetch(s!.url, { credentials: 'include' }).then((r) => { if (!r.ok) throw new Error('Not available offline'); return r.json(); }).then((j) => j.resource) });
  if (!s) return <main className="p-4"><Alert>This lesson is not saved on this device.</Alert></main>;
  if (q.isLoading) return <Spinner />;
  return <main id="main" className="mx-auto max-w-3xl space-y-4 p-4"><Link to="/saved" className="text-sm text-brand-700 underline">← Saved lessons</Link>
    {q.error ? <Alert>{q.error.message}</Alert> : <><h1 className="text-2xl font-bold">{q.data.title}</h1>{q.data.body?.sections ? <LessonView sections={q.data.body.sections} /> : <Card><p className="whitespace-pre-wrap">{q.data.body?.markdown ?? ''}</p></Card>}</>}</main>;
}
