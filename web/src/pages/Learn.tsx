import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, post, HttpError, download } from '../lib/api';
import { Alert, Button, Card, SampleBadge, Spinner } from '../components/ui';
import { LessonView } from '../components/LessonView';
import { usePlatform } from '../lib/platform';
import { saveLesson, isSaved, removeLesson, offlineSupported } from '../lib/offline';
import { MessageCircle, Download } from 'lucide-react';
import { ModuleDashboard, ModuleReader } from './Modules';
type Subj = { _id: string; name: string; code: string; category: string; isSample?: boolean; curriculumVersion?: string; yearOfStudy?: number | null; summary?: any };
function SubjectSummary({ s }: { s: any }) {
  const svg = s.thumbnail?.svg; const ok = typeof svg === 'string' && svg.startsWith('<svg') && !/<script|on\w+=|href=|<foreignObject|<image/i.test(svg);
  return <div className="mt-2 space-y-1 text-sm text-slate-700">
    {ok && <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="" width={320} height={180} className="aspect-video w-full rounded object-cover" />}
    <p>{s.strands} strand{s.strands === 1 ? '' : 's'} · {s.modules} module{s.modules === 1 ? '' : 's'} · about {Math.round(s.totalMinutes / 6) / 10} h</p>
    <div aria-hidden className="h-2 rounded bg-slate-200"><div className="h-2 rounded bg-brand-700" style={{ width: `${s.progressPct}%` }} /></div>
    <p className="text-xs text-slate-600">{s.completed} of {s.modules} completed ({s.progressPct}%){s.continueId ? ` · ${s.completed ? 'Continue learning' : 'Start learning'}` : ''}</p></div>;
}
export function LearnHome() {
  const q = useQuery({ queryKey: ['my-subjects'], queryFn: () => api<{ items: Subj[] }>('/api/me/subjects').then((r) => r.items) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Alert>{q.error.message}</Alert>;
  return <section><h1 className="mb-4 text-2xl font-bold">My subjects</h1>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{q.data!.map((s, i) => <motion.div key={s._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
      <Link to={`/learn/${s._id}`} className="block rounded-xl focus-visible:outline"><Card className="h-full hover:border-brand-600">
        <div className="flex items-center justify-between"><span className="text-xs uppercase text-slate-500">{s.category}</span>{s.isSample && <SampleBadge />}</div>
        <h2 className="mt-1 text-lg font-semibold">{s.name}</h2><p className="text-sm text-slate-600">{[s.code, s.yearOfStudy && `Year ${s.yearOfStudy}`, s.curriculumVersion].filter(Boolean).join(' · ')}</p>
        {s.summary && <SubjectSummary s={s.summary} />}</Card></Link></motion.div>)}</div>
    {!q.data!.length && <Alert tone="info">No subjects yet. Ask your administrator.</Alert>}</section>;
}
export function SubjectPage() {
  const { subjectId } = useParams(); const p = usePlatform(); const f = p.features;
  const q = useQuery({ queryKey: ['resources', subjectId], retry: false, queryFn: () => api<{ items: any[] }>(`/api/subjects/${subjectId}/resources`).then((r) => r.items) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Alert>{q.error instanceof HttpError && q.error.status === 403 ? 'You are not enrolled in this subject.' : q.error.message}</Alert>;
  return <section><Link to="/learn" className="text-sm text-brand-700 underline">← My subjects</Link>
    <div className="my-3 flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-bold">Learning resources</h1><div className="flex flex-wrap gap-2">{f.practice && <Link to={`/learn/${subjectId}/practice`} className="rounded-lg border border-brand-700 px-3 py-2 text-brand-700">Practice & tests</Link>}{f.games && <Link to={`/learn/${subjectId}/games`} className="rounded-lg border border-brand-700 px-3 py-2 text-brand-700">Games</Link>}{p.offline.bundleEnabled && <OfflineButton subjectId={subjectId!} />}{f.tutor && <Link to={`/learn/${subjectId}/tutor`} className="flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-2 text-white"><MessageCircle className="h-4 w-4" aria-hidden />Ask the tutor</Link>}</div></div>
    <ModuleDashboard subjectId={subjectId!} />
    {q.data!.some((r) => r.contentType === 'module') && q.data!.some((r) => r.contentType !== 'module') && <h2 className="mb-2 text-lg font-semibold">Other resources</h2>}
    <ul className="space-y-2">{q.data!.filter((r) => r.contentType !== 'module').map((r) => <li key={r._id}><Card><div className="flex items-center gap-2"><span className="rounded bg-brand-50 px-2 text-xs uppercase text-brand-900">{r.kind}</span>{r.isSample && <SampleBadge />}{r.status !== 'published' && <span className="text-xs text-red-700">{r.status}</span>}</div>
      <h2 className="mt-1 font-semibold"><Link className="hover:underline" to={`/learn/${subjectId}/r/${r._id}`}>{r.title}</Link></h2><p className="text-sm text-slate-500">{[r.strand, r.topic].filter(Boolean).join(' › ')}</p></Card></li>)}</ul>
    {!q.data!.length && <Alert tone="info">No published resources for this subject yet.</Alert>}</section>;
}
export function ResourcePage() {
  const { subjectId, resourceId } = useParams(); const p = usePlatform();
  const q = useQuery({ queryKey: ['resource', resourceId], retry: false, queryFn: () => api<{ resource: any; progress: any }>(`/api/resources/${resourceId}`) });
  if (q.isLoading) return <Spinner />; if (q.error) return <Alert>{q.error.message}</Alert>;
  const r = q.data!.resource; const b = r.body ?? {};
  return <article className="space-y-4"><Link to={`/learn/${subjectId}`} className="text-sm text-brand-700 underline">← Back</Link>
    <h1 className="text-2xl font-bold">{r.title}</h1>
    {r.contentType === 'module' ? <ModuleReader r={r} progress={q.data!.progress} subjectId={subjectId!} /> : <>
    {r.aiGenerated && <Alert tone="info">This lesson was drafted with AI from your curriculum materials and checked by a reviewer. Page references show where each part comes from.{b.sourceDocuments?.some((d: any) => d.approvalStatus !== 'verified_official') && ' Some source documents have not yet been verified as official.'}</Alert>}
    {b.sections ? <LessonView sections={b.sections} /> : <Card><p className="whitespace-pre-wrap">{b.markdown ?? 'No content.'}</p></Card>}
    {q.data!.progress && <CompleteButton id={r._id} done={!!q.data!.progress.completedAt} />}</>}
    <div className="flex flex-wrap items-center gap-4">{r.status === 'published' && p.offline.saveLessonsEnabled && <SaveOffline r={r} />}{p.features.tutor && <Link to={`/learn/${subjectId}/tutor`} className="inline-flex items-center gap-1 text-brand-700 underline"><MessageCircle className="h-4 w-4" aria-hidden />Questions? Ask the tutor</Link>}</div></article>;
}

/** Lesson completion (feeds Learning Analytics, §16). Shown to learners only (the server returns progress for them). */
function CompleteButton({ id, done }: { id: string; done: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: (completed: boolean) => post<{ progress: any }>(`/api/resources/${id}/complete`, { completed }),
    // Update the cache instead of refetching, so a completion does not count as another lesson open.
    onSuccess: (r) => qc.setQueryData(['resource', id], (old: any) => (old ? { ...old, progress: r.progress } : old)) });
  return <Card className={done ? 'border-emerald-600' : ''}><div className="flex flex-wrap items-center gap-3">{done ? <><p className="font-medium text-emerald-800">You marked this lesson as completed.</p>
    <Button variant="ghost" loading={m.isPending} onClick={() => m.mutate(false)}>Mark as not completed</Button></> : <><p className="text-sm">Finished reading and understood this lesson?</p><Button loading={m.isPending} onClick={() => m.mutate(true)}>Mark as completed</Button></>}
    {m.error && <span role="alert" className="text-sm text-red-800">{m.error.message}</span>}</div></Card>;
}

function OfflineButton({ subjectId }: { subjectId: string }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  return <><button type="button" disabled={busy} title="Download all published lessons as one file you can open without internet" onClick={() => { setBusy(true); setErr(''); download(`/api/offline/${subjectId}`, 'offline.html').catch((e) => setErr(e.message)).finally(() => setBusy(false)); }}
    className="flex items-center gap-1 rounded-lg border border-brand-700 px-3 py-2 text-brand-700 disabled:opacity-60"><Download className="h-4 w-4" aria-hidden />{busy ? 'Preparing…' : 'Download for offline'}</button>{err && <span role="alert" className="text-sm text-red-700">{err}</span>}</>;
}

function SaveOffline({ r }: { r: any }) {
  const [saved, setSaved] = useState(isSaved(r._id)); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  if (!offlineSupported()) return null;
  return <span className="inline-flex items-center gap-2"><button type="button" disabled={busy} className="rounded-lg border border-brand-700 px-3 py-1.5 text-brand-700 disabled:opacity-60"
    onClick={() => { setBusy(true); setMsg(''); (saved ? removeLesson(r._id) : saveLesson(r)).then(() => { setSaved(!saved); setMsg(saved ? 'Removed from this device.' : 'Saved. Open it any time from “Saved lessons”, even offline.'); }).catch((e) => setMsg(e.message)).finally(() => setBusy(false)); }}>
    <Download className="mr-1 inline h-4 w-4" aria-hidden />{saved ? 'Remove offline copy' : 'Save for offline'}</button><span role="status" className="text-sm">{msg}{saved && <> <Link className="underline" to="/saved">Saved lessons</Link></>}</span></span>;
}
