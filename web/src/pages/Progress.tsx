import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Flame, Award, Star } from 'lucide-react';
import { api } from '../lib/api';
import { Alert, Card, Select, Spinner } from '../components/ui';
import { BarChart, LineChart } from '../components/Charts';
const actionLink = (subjectId: string, a: any): string => a.type === 'lesson' ? `/learn/${subjectId}/r/${a.resourceId}` : a.type === 'game' ? `/learn/${subjectId}/games` : a.type === 'assessment' ? `/learn/${subjectId}/practice`
  : `/learn/${subjectId}/practice?mode=${a.mode}${a.topic ? `&topic=${encodeURIComponent(a.topic)}` : ''}`;
export function ProgressPage() {
  const overview = useQuery({ queryKey: ['progress-me'], queryFn: () => api<{ subjects: any[] }>('/api/progress/me') });
  const rewards = useQuery({ queryKey: ['rewards'], queryFn: () => api<any>('/api/rewards/me') });
  const lb = useQuery({ queryKey: ['leaderboard'], retry: false, queryFn: () => api<any>('/api/rewards/leaderboard') });
  const [sid, setSid] = useState(''); const subjectId = sid || overview.data?.subjects[0]?.subjectId;
  const p = useQuery({ queryKey: ['progress', subjectId], enabled: !!subjectId, queryFn: () => api<any>(`/api/progress/me?subjectId=${subjectId}`) });
  if (overview.isLoading) return <Spinner />; if (overview.error) return <Alert>{overview.error.message}</Alert>;
  const r = rewards.data;
  return <section className="space-y-4"><h1 className="text-2xl font-bold">My progress</h1>
    {r && <div className="grid gap-3 sm:grid-cols-3">
      <Card><p className="flex items-center gap-2 text-sm text-slate-600"><Star className="h-4 w-4" aria-hidden />Level {r.level}</p><p className="text-2xl font-bold">{r.xp} XP</p>
        <div className="mt-1 h-2 rounded bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={r.nextLevelXp} aria-valuenow={r.xp} aria-label="Progress to next level"><div className="h-2 rounded bg-brand-700" style={{ width: `${Math.min(100, (100 * r.xp) / r.nextLevelXp)}%` }} /></div>
        <p className="mt-1 text-xs text-slate-500">{r.nextLevelXp - r.xp} XP to level {r.level + 1}</p></Card>
      <Card><p className="flex items-center gap-2 text-sm text-slate-600"><Flame className="h-4 w-4" aria-hidden />Learning streak</p><p className="text-2xl font-bold">{r.streak.current} day{r.streak.current === 1 ? '' : 's'}</p><p className="text-xs text-slate-500">Longest: {r.streak.longest}. A day counts when you complete real practice, not just open the app.</p></Card>
      <Card><p className="flex items-center gap-2 text-sm text-slate-600"><Award className="h-4 w-4" aria-hidden />Badges</p><ul className="mt-1 flex flex-wrap gap-1">{r.allBadges.map((b: any) => { const has = r.badges.some((x: any) => x.key === b.key);
        return <li key={b.key} title={b.description} className={`rounded px-2 py-0.5 text-xs ${has ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>{has ? '🏅' : '🔒'} {b.name}<span className="sr-only">: {b.description}{has ? ' (earned)' : ' (not yet earned)'}</span></li>; })}</ul></Card></div>}
    {r && <p className="text-xs text-slate-500">{r.rules}</p>}
    <Card><div className="flex flex-wrap items-end justify-between gap-2"><h2 className="font-semibold">Subjects</h2><div className="w-64"><Select label="Show details for" value={subjectId ?? ''} onChange={(e) => setSid(e.target.value)}>{overview.data!.subjects.map((s) => <option key={s.subjectId} value={s.subjectId}>{s.name}</option>)}</Select></div></div>
      <BarChart label="Mastery by subject" data={overview.data!.subjects.filter((s) => s.pct != null).map((s) => ({ label: s.name, value: s.pct }))} />
      {overview.data!.subjects.every((s) => s.pct == null) && <p className="text-sm">Practise a subject to see your mastery here.</p>}</Card>
    {p.data && <>
      <Card><h2 className="font-semibold">Recommended next</h2><ul className="mt-2 space-y-2">{p.data.recommendations.map((x: any, i: number) => <li key={i} className="rounded border p-2"><Link className="font-medium text-brand-700 underline" to={actionLink(subjectId!, x.action)}>{x.title}</Link><p className="text-sm text-slate-600">Why: {x.reason}</p></li>)}</ul>
        <details className="mt-2 text-xs text-slate-500"><summary>How are these chosen?</summary>{p.data.method}</details></Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card><h2 className="font-semibold">Mastery by topic {p.data.overall != null && <span className="text-sm font-normal">(average {p.data.overall}%)</span>}</h2>{p.data.mastery.length ? <BarChart label="Topic mastery" data={p.data.mastery.map((m: any) => ({ label: m.topic, value: m.pct }))} /> : <p className="text-sm">No answers yet.</p>}
          <table className="sr-only"><caption>Topic mastery detail</caption><tbody>{p.data.mastery.map((m: any) => <tr key={m.topic}><td>{m.topic}</td><td>{m.pct}%</td><td>{m.answered} answers</td></tr>)}</tbody></table></Card>
        <Card><h2 className="font-semibold">Scores over time</h2><LineChart label="Attempt scores" points={p.data.timeline.map((t: any) => ({ x: new Date(t.at).toLocaleDateString(), y: t.pct }))} />
          <h3 className="mt-3 text-sm font-semibold">By question type</h3><BarChart label="Accuracy by question type" data={p.data.byType.map((t: any) => ({ label: t.type.replace('_', ' '), value: t.pct }))} /></Card>
      </div></>}
    {lb.data ? <Card><h2 className="font-semibold">This week in your {lb.data.scope === 'year' ? 'year group' : 'school'}</h2><p className="text-xs text-slate-500">{lb.data.anonymized ? 'Names are hidden. ' : ''}XP earned {lb.data.period}.</p>
      <ol className="mt-2 space-y-1">{lb.data.entries.map((e: any) => <li key={e.rank} className={`flex justify-between rounded px-2 py-1 ${e.you ? 'bg-brand-50 font-semibold' : ''}`}><span>{e.rank}. {e.name}</span><span>{e.xp} XP</span></li>)}</ol></Card>
      : null}
  </section>;
}
