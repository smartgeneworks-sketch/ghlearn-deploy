import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpenCheck, FileText, Loader2, Search, X } from 'lucide-react';
import { useLanding, useSearch, useSubjects, type SubjectCardData } from './api';
import { subjectLook } from './icons';
import { SectionHeading } from './PublicShell';
import { useCtaTargets } from './Hero';

export function PopularSearches({ items, onPick }: { items: string[]; onPick: (s: string) => void }) {
  if (!items.length) return null;
  return <div className="mt-4 flex flex-wrap items-center justify-center gap-2"><span className="text-sm text-slate-600">Popular:</span>
    {items.map((p) => <button key={p} type="button" onClick={() => onPick(p)} className="min-h-9 rounded-full border border-slate-200 bg-white px-3.5 text-sm text-navy-900 transition hover:border-brand-600 hover:bg-brand-50">{p}</button>)}</div>;
}

export function LearningSearch({ initial = '' }: { initial?: string }) {
  const l = useLanding(); const s = l.content.search; const [term, setTerm] = useState(initial); const id = useId(); const c = useCtaTargets();
  const r = useSearch(term); const active = r.debounced.length >= 2; const d = r.data; const empty = d && !d.subjects.length && !d.topics.length && !d.lessons.length;
  return <section id="search" aria-labelledby={`${id}-t`} className="relative z-10 -mt-2 px-4 sm:px-6">
    <div className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-navy-900/5 sm:p-8">
      <h2 id={`${id}-t`} className="text-center text-2xl font-bold text-navy-900 sm:text-3xl">{l.t(s.title)}</h2>
      {s.subtitle && <p className="mt-2 text-center text-slate-600">{l.t(s.subtitle)}</p>}
      <form role="search" className="relative mt-6" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor={`${id}-q`} className="sr-only">Search subjects, topics and lessons</label>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
        <input id={`${id}-q`} type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={s.placeholder} autoComplete="off" maxLength={80}
          aria-describedby={`${id}-status`} className="h-14 w-full rounded-full border border-slate-300 bg-slate-50 pl-12 pr-24 text-base text-navy-900 placeholder:text-slate-500 focus:border-brand-600 focus:bg-white focus:outline-none [&::-webkit-search-cancel-button]:hidden" />
        <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {r.isFetching && <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden />}
          {term && <button type="button" onClick={() => setTerm('')} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200" aria-label="Clear search"><X className="h-5 w-5" aria-hidden /></button>}
        </span>
      </form>
      {!term && <PopularSearches items={s.popular} onPick={setTerm} />}
      <div id={`${id}-status`} aria-live="polite" className="mt-4">
        {term.trim().length === 1 && <p className="text-center text-sm text-slate-600">Type at least 2 characters.</p>}
        {active && r.isError && <p role="alert" className="text-center text-sm text-red-700">Search is unavailable right now. Please try again in a moment.</p>}
        {active && empty && <div className="rounded-2xl bg-navy-50 p-5 text-center text-sm text-slate-700">
          <p className="font-semibold text-navy-900">No public results for “{d!.q}”.</p>
          <p className="mt-1">Try another word, or <Link to="/subjects" className="font-semibold text-brand-800 underline">browse all subjects</Link>. Lessons for your own subjects are listed after you <Link to={c.start} className="font-semibold text-brand-800 underline">sign up</Link>.</p></div>}
        {active && d && !empty && <SearchResults d={d} />}
      </div>
    </div>
  </section>;
}
function SearchResults({ d }: { d: NonNullable<ReturnType<typeof useSearch>['data']> }) {
  const group = 'space-y-1'; const row = 'flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50';
  return <div className="grid gap-5 text-left md:grid-cols-3" data-testid="search-results">
    <div><h3 className="px-3 text-xs font-bold uppercase tracking-wider text-slate-500">Subjects ({d.subjects.length})</h3>
      <ul className={group}>{d.subjects.map((s) => { const L = subjectLook(s.name); const I = L.icon; return <li key={s.id}><Link to={`/subjects/${s.id}`} className={row}><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${L.tint}`}><I className="h-4 w-4" aria-hidden /></span><span><span className="block text-sm font-semibold text-navy-900">{s.name}</span><span className="text-xs text-slate-500">{s.level.kind}</span></span></Link></li>; })}
        {!d.subjects.length && <li className="px-3 text-sm text-slate-500">No subjects match.</li>}</ul></div>
    <div><h3 className="px-3 text-xs font-bold uppercase tracking-wider text-slate-500">Topics ({d.topics.length})</h3>
      <ul className={group}>{d.topics.map((t) => <li key={t.subject.id + t.title}><Link to={`/subjects/${t.subject.id}#topics`} className={row}><BookOpenCheck className="h-4 w-4 shrink-0 text-brand-700" aria-hidden /><span><span className="block text-sm font-semibold text-navy-900">{t.title}</span><span className="text-xs text-slate-500">{t.subject.name} · {t.subject.level}</span></span></Link></li>)}
        {!d.topics.length && <li className="px-3 text-sm text-slate-500">No curriculum topics match.</li>}</ul></div>
    <div><h3 className="px-3 text-xs font-bold uppercase tracking-wider text-slate-500">Preview lessons ({d.lessons.length})</h3>
      <ul className={group}>{d.lessons.map((x) => <li key={x.id}><Link to={`/preview/${x.id}`} className={row}><FileText className="h-4 w-4 shrink-0 text-amber-600" aria-hidden /><span><span className="block text-sm font-semibold text-navy-900">{x.title}</span><span className="text-xs text-slate-500">{x.subject.name}{x.topic ? ` · ${x.topic}` : ''}</span></span></Link></li>)}
        {!d.lessons.length && <li className="px-3 text-sm text-slate-500">No public preview lessons match. Signed-in students see all published lessons in their subjects.</li>}</ul></div>
  </div>;
}

export function SubjectCard({ s }: { s: SubjectCardData }) {
  const L = subjectLook(s.name); const I = L.icon;
  const desc = `${s.category === 'core' ? 'Core' : 'Elective'} subject in the ${s.level.name} curriculum.`;
  return <article className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-brand-600/40 hover:shadow-lg hover:shadow-navy-900/5">
    <div className="flex items-start justify-between gap-3"><span className={`flex h-11 w-11 items-center justify-center rounded-xl ${L.tint}`}><I className="h-5 w-5" aria-hidden /></span>
      <span className="rounded-full bg-navy-50 px-2.5 py-1 text-xs font-semibold text-navy-800">{s.level.kind}</span></div>
    <h3 className="mt-4 text-lg font-bold text-navy-900">{s.name}</h3>
    <p className="mt-1 flex-1 text-sm text-slate-600">{desc}</p>
    <ul className="mt-3 space-y-0.5 text-xs text-slate-500">
      {s.publishedLessons > 0 && <li>{s.publishedLessons} published lesson{s.publishedLessons === 1 ? '' : 's'}</li>}
      {s.documents ? <li>{s.documents} curriculum document{s.documents === 1 ? '' : 's'} indexed</li> : null}
    </ul>
    <Link to={`/subjects/${s.id}`} className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-800 group-hover:underline" aria-label={`Explore Subject: ${s.name}`}>Explore Subject<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden /></Link>
  </article>;
}

export function SubjectExplorer({ full = false }: { full?: boolean }) {
  const l = useLanding(); const cfg = l.content.subjects; const [filter, setFilter] = useState<string | null>(null); const c = useCtaTargets();
  const q = useSubjects(filter, !full && !filter); const items = q.data?.items ?? [];
  return <section id="subjects" aria-labelledby="subjects-title" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6">
    <SectionHeading id="subjects-title" title={l.t(cfg.title)} subtitle={l.t(cfg.subtitle)} />
    <div role="group" aria-label="Filter subjects" className="mt-8 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]">
      {[{ id: null as string | null, label: full ? 'All subjects' : 'Featured' }, ...cfg.filters.map((f) => ({ id: f.id as string | null, label: f.label }))].map((f) =>
        <button key={f.id ?? 'all'} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
          className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition ${filter === f.id ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-300 bg-white text-navy-900 hover:border-navy-700'}`}>{f.label}</button>)}
    </div>
    <div aria-live="polite" className="mt-6">
      {q.isLoading ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-label="Loading subjects">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-52 animate-pulse rounded-2xl bg-slate-100" />)}</div>
        : q.isError ? <p role="alert" className="rounded-2xl bg-red-50 p-5 text-sm text-red-800">Subjects could not be loaded. Please refresh the page.</p>
        : q.data?.levelClosed ? <p className="rounded-2xl bg-amber-50 p-5 text-sm text-amber-900"><strong>{q.data.levelClosed}</strong> subjects are not open on the platform yet. Choose another filter, or check back later.</p>
        : !items.length ? <p className="rounded-2xl bg-navy-50 p-5 text-sm text-slate-700">No subjects match this filter yet.</p>
        : <><p className="mb-4 text-sm text-slate-600">{items.length} subject{items.length === 1 ? '' : 's'}{q.data?.filter ? ` in ${q.data.filter.label}` : full ? '' : ' featured'}</p>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{items.map((s) => <li key={s.id}><SubjectCard s={s} /></li>)}</ul></>}
    </div>
    <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      {!full && <Link to="/subjects" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-300 px-5 text-sm font-semibold text-navy-900 hover:bg-navy-50">View all subjects<ArrowRight className="h-4 w-4" aria-hidden /></Link>}
      <p className="text-sm text-slate-600">Want lessons for your subjects? <Link to={c.start} className="font-semibold text-brand-800 underline">{c.home ? 'Go to your subjects' : 'Create your learning space'}</Link>.</p>
    </div>
  </section>;
}
