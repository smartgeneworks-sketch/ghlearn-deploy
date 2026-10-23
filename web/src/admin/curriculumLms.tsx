import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, patch, post } from '../lib/api';
import { Alert, Button, Card, Select, Spinner } from '../components/ui';
import { Badge, ErrorBox, Facts, Section, useConfig, when } from './common';
import { Section as LessonSection } from '../components/LessonView';

const usd = (n?: number | null) => (n == null ? '—' : `$${n.toFixed(n < 1 ? 4 : 2)}`);
function Estimate({ e }: { e: any }) {
  return <div className="rounded border p-3 text-sm"><Facts items={[['Modules / requests', `${e.modules} / ${e.requests}`], ['Estimated cost', `${usd(e.totalCostUsd)} (${usd(e.perModule.costUsd)} per module)`],
    ['Basis', e.basis], ['Rates', e.rates], ['Today', `${e.day.used} of ${e.day.limit} requests used`], ['This month', `${usd(e.month.estCostUsd)} of ${e.month.capUsd ? usd(e.month.capUsd) : 'no cap'}`],
    ['Within budget', e.withinBudget ? 'Yes' : 'No — generation will be refused']]} /></div>;
}

/** Admin › Curriculum LMS: per-subject module list, AI review state, generation with a cost estimate, settings and analytics. */
export function CurriculumLmsPage() {
  const subjects = useConfig('subjects'); const [sp, setSp] = useSearchParams(); const sid = sp.get('subject') ?? '';
  const ov = useQuery({ queryKey: ['clms', sid], enabled: !!sid, queryFn: () => api<any>(`/api/curriculum-lms/subjects/${sid}/overview`) });
  const [filter, setFilter] = useState('all');
  const d = ov.data; const mods = (d?.modules ?? []).filter((m: any) => filter === 'all' || (filter === 'attention' ? m.aiReview?.status === 'needs_attention' || m.status === 'failed' : filter === 'missing' ? m.sourceStatus !== 'ok' : m.status === filter));
  return <div className="space-y-4"><h1 className="text-2xl font-bold">Curriculum LMS modules</h1>
    <p className="text-sm text-slate-600">One module per learning indicator, generated only from the mapped learner manual. Modules that pass every automated check are published as <strong>AI-Approved</strong> (not reviewed by a person); the rest wait here.</p>
    <Select label="Subject" value={sid} onChange={(e) => setSp(e.target.value ? { subject: e.target.value } : {})}><option value="">Choose…</option>{subjects.data?.filter((s) => !s.archivedAt).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</Select>
    <ErrorBox error={ov.error} />{ov.isLoading && sid && <Spinner />}
    {d && <>
      <Section title="Summary"><Facts items={[['Learning indicators', d.summary.indicators], ['Modules', d.summary.modules], ['Generated', d.summary.generated], ['Published (AI-Approved)', `${d.summary.published} (${d.summary.aiApprovedPublished})`],
        ['Needs attention', d.summary.needsAttention], ['No learner manual', d.summary.sourceMissing], ['Generated, not published', d.summary.unpublished]]} /></Section>
      <Generate curricula={d.curricula} sid={sid} />
      <Settings s={d.settings} sid={sid} />
      <Section title="Modules" actions={<Select label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All</option><option value="published">Published</option><option value="attention">Needs attention</option><option value="draft">Not generated</option><option value="missing">No learner manual</option></Select>}>
        {!mods.length ? <p className="text-sm text-slate-600">No modules{d.summary.modules ? ' match this filter' : ' yet: materialise them from an imported curriculum above'}.</p> :
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th className="p-1">Module</th><th className="p-1">Status</th><th className="p-1">Checks</th><th className="p-1">Reading</th><th className="p-1">Version</th></tr></thead>
          <tbody>{mods.map((m: any) => <tr key={m._id} className="border-t"><td className="p-1"><Link className="text-brand-700 underline" to={`/admin/curriculum-lms/${m._id}`}>{m.title}</Link><div className="text-xs text-slate-600">{m.moduleKey} · {m.subStrand}</div></td>
            <td className="p-1"><Badge v={m.status} />{m.aiReview?.status && <> <Badge v={m.aiReview.status} /></>}{m.sourceStatus !== 'ok' && <> <Badge v="missing_lm" label="no learner manual" /></>}</td>
            <td className="p-1">{m.version ? `${m.errors} error(s), ${m.warnings} warning(s)` : '—'}</td><td className="p-1">{m.readingTime ? `${m.readingTime.readingMin}/${m.readingTime.totalMin} min` : '—'}</td><td className="p-1">{m.version || '—'}</td></tr>)}</tbody></table></div>}
      </Section>
      <Analytics sid={sid} /></>}
  </div>;
}
function Generate({ curricula, sid }: { curricula: any[]; sid: string }) {
  const qc = useQueryClient(); const [f, setF] = useState({ documentId: curricula[0]?._id ?? '', year: '', strand: '' });
  const body = () => ({ documentId: f.documentId, ...(f.year ? { year: Number(f.year) } : {}), ...(f.strand ? { strand: Number(f.strand) } : {}) });
  const mat = useMutation({ mutationFn: () => post<any>('/api/curriculum-lms/modules/materialize', body()), onSuccess: () => qc.invalidateQueries({ queryKey: ['clms', sid] }) });
  const est = useMutation({ mutationFn: () => post<any>('/api/curriculum-lms/generate', { ...body(), dryRun: true }) });
  const gen = useMutation({ mutationFn: () => post<any>('/api/curriculum-lms/generate', { ...body(), dryRun: false }), onSuccess: () => qc.invalidateQueries({ queryKey: ['clms', sid] }) });
  if (!curricula.length) return <Section title="Create and generate"><p className="text-sm">No imported curriculum for this subject. Import its structure first.</p></Section>;
  return <Section title="Create and generate"><div className="grid gap-2 sm:grid-cols-3">
    <Select label="Curriculum" value={f.documentId} onChange={(e) => setF({ ...f, documentId: e.target.value })}>{curricula.map((c) => <option key={c._id} value={c._id}>{c.title}</option>)}</Select>
    <Select label="Year" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}><option value="">All</option>{[1, 2, 3].map((y) => <option key={y} value={y}>Year {y}</option>)}</Select>
    <Select label="Strand" value={f.strand} onChange={(e) => setF({ ...f, strand: e.target.value })}><option value="">All</option>{[1, 2, 3, 4, 5, 6].map((y) => <option key={y} value={y}>Strand {y}</option>)}</Select></div>
    <div className="mt-3 flex flex-wrap gap-2"><Button variant="ghost" loading={mat.isPending} onClick={() => mat.mutate()}>Create modules (no AI)</Button><Button variant="ghost" loading={est.isPending} onClick={() => { gen.reset(); est.mutate(); }}>Estimate generation</Button>
      {est.data && est.data.queue.length > 0 && est.data.estimate.withinBudget && <Button loading={gen.isPending} onClick={() => gen.mutate()}>Generate {est.data.queue.length} module(s)</Button>}</div>
    {mat.data && <p role="status" className="mt-2 text-sm">Created {mat.data.created}, updated {mat.data.updated}, unchanged {mat.data.unchanged}; {mat.data.missingSource.length} without a learner manual.</p>}
    {est.data && <div className="mt-2 space-y-2"><Estimate e={est.data.estimate} />{est.data.skipped.length > 0 && <p className="text-sm text-amber-900">Skipped {est.data.skipped.length}: {[...new Set(est.data.skipped.map((s: any) => s.reason))].join('; ')}</p>}</div>}
    {gen.data && <p role="status" className="mt-2 text-sm">Queued {gen.data.queued} module(s). Progress appears in the list; check the processing monitor for job details.</p>}
    {[mat, est, gen].map((m, i) => m.error && <Alert key={i}>{(m.error as Error).message}</Alert>)}</Section>;
}
function Settings({ s, sid }: { s: any; sid: string }) {
  const qc = useQueryClient(); const [v, setV] = useState(s);
  const m = useMutation({ mutationFn: () => patch('/api/admin/settings', { curriculumLms: { autoPublish: v.autoPublish, lockMode: v.lockMode, wordsPerMinute: Number(v.wordsPerMinute), passMarkPct: Number(v.passMarkPct), minScrollPct: Number(v.minScrollPct) } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['clms', sid] }) });
  return <Section title="Publishing and progression settings"><div className="grid gap-3 sm:grid-cols-3 text-sm">
    <label className="flex items-center gap-2"><input type="checkbox" checked={v.autoPublish} onChange={(e) => setV({ ...v, autoPublish: e.target.checked })} />Publish modules that pass every automated check (AI-Approved)</label>
    <Select label="Module locking" value={v.lockMode} onChange={(e) => setV({ ...v, lockMode: e.target.value })}><option value="free">Free navigation</option><option value="sequential">Sequential within a strand</option><option value="prerequisite">Prerequisites within a content standard</option></Select>
    {([['wordsPerMinute', 'Reading speed (words/min)', 80, 400], ['passMarkPct', 'Knowledge-check pass mark (%)', 0, 100], ['minScrollPct', 'Read to at least (%)', 0, 100]] as const).map(([k, l, mi, ma]) => <label key={k} className="grid gap-1"><span className="font-medium">{l}</span><input className="rounded border px-2 py-1" type="number" min={mi} max={ma} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>)}</div>
    <div className="mt-2 flex items-center gap-2"><Button loading={m.isPending} onClick={() => m.mutate()}>Save settings</Button>{m.isSuccess && <span role="status" className="text-sm">Saved.</span>}{m.error && <span role="alert" className="text-sm text-red-800">{(m.error as Error).message}</span>}</div></Section>;
}
function Analytics({ sid }: { sid: string }) {
  const q = useQuery({ queryKey: ['clms-an', sid], retry: false, queryFn: () => api<any>(`/api/curriculum-lms/subjects/${sid}/analytics`) });
  if (q.error) return null; if (!q.data) return null; const d = q.data;
  return <Section title="Learner analytics"><p className="text-sm text-slate-600">{d.note} Enrolled learners: {d.enrolled}.</p>
    {!d.modules.length ? <p className="text-sm">No published modules yet.</p> : <div className="overflow-x-auto"><table className="mt-2 w-full text-sm"><thead><tr className="text-left"><th className="p-1">Module</th><th className="p-1">Learners</th><th className="p-1">Completed</th><th className="p-1">Avg active min</th><th className="p-1">Avg read %</th><th className="p-1">Avg check %</th></tr></thead>
      <tbody>{d.modules.map((r: any) => <tr key={r.resourceId} className="border-t"><td className="p-1">{r.title}</td><td className="p-1">{r.learners}</td><td className="p-1">{r.completed}{r.completionPct != null && ` (${r.completionPct}%)`}</td><td className="p-1">{r.avgMinutes ?? '—'}</td><td className="p-1">{r.avgScrollPct ?? '—'}</td><td className="p-1">{r.avgCheckScorePct ?? '—'}</td></tr>)}</tbody></table></div>}</Section>;
}

/** One module: automated checks, source map, sections, edit, regenerate, restore, unpublish. */
export function CurriculumLmsModulePage() {
  const { id } = useParams(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['clms-mod', id], queryFn: () => api<any>(`/api/curriculum-lms/modules/${id}`), refetchInterval: (x) => (x.state.data?.module?.status === 'generating' ? 5000 : false) });
  const done = () => qc.invalidateQueries({ queryKey: ['clms-mod', id] });
  const [edit, setEdit] = useState<{ key: string; content: string } | null>(null); const [title, setTitle] = useState<string | null>(null);
  const save = useMutation({ mutationFn: (b: any) => patch<any>(`/api/curriculum-lms/modules/${id}`, b), onSuccess: () => { setEdit(null); setTitle(null); done(); } });
  const regen = useMutation({ mutationFn: (dryRun: boolean) => post<any>(`/api/curriculum-lms/modules/${id}/regenerate`, { dryRun }), onSuccess: (r, dry) => { if (!dry) done(); } });
  const restore = useMutation({ mutationFn: (version: number) => post<any>(`/api/curriculum-lms/modules/${id}/restore`, { version }), onSuccess: done });
  const unpub = useMutation({ mutationFn: () => post<any>(`/api/lessons/${id}/unpublish`, { comment: 'Unpublished from Curriculum LMS' }), onSuccess: done });
  if (q.isLoading) return <Spinner />; if (q.error) return <Alert>{(q.error as Error).message}</Alert>;
  const { module: m, versions, reviews, sources } = q.data; const v = m.validation ?? {};
  return <div className="space-y-4"><Link to={`/admin/curriculum-lms?subject=${m.subjectId}`} className="text-sm text-brand-700 underline">← Modules</Link>
    <div className="flex flex-wrap items-center gap-2">{title == null ? <h1 className="text-2xl font-bold">{m.title}</h1> : <input aria-label="Title" className="rounded border px-2 py-1 text-xl" value={title} onChange={(e) => setTitle(e.target.value)} />}
      {title == null ? <Button variant="ghost" onClick={() => setTitle(m.title)}>Rename</Button> : <><Button loading={save.isPending} onClick={() => save.mutate({ title })}>Save</Button><Button variant="ghost" onClick={() => setTitle(null)}>Cancel</Button></>}</div>
    <Section title="Status"><Facts items={[['Key', m.moduleKey], ['Indicator', m.indicator], ['Status', <><Badge v={m.status} /> {m.aiReview?.status && <Badge v={m.aiReview.status} />}</>], ['AI review', m.aiReview?.label ?? '—'], ['Source', m.sourceStatus === 'ok' ? sources.map((s: any) => s.title).join('; ') : 'No learner manual mapped'],
      ['Reading time', m.readingTime ? `${m.readingTime.readingMin} min reading · ${m.readingTime.readingAndExamplesMin} with examples · ${m.readingTime.totalMin} total${m.readingTime.override ? ' (set by admin)' : ''}` : '—'], ['Generated', when(m.generatedAt)], ['Checked', when(m.validatedAt)], ['Version', m.version], ...(m.generationError ? [['Error', m.generationError] as [string, string]] : [])]} />
      <div className="mt-3 flex flex-wrap gap-2"><Button variant="ghost" loading={regen.isPending && regen.variables} onClick={() => regen.mutate(true)}>Estimate regeneration</Button>
        {regen.data?.estimate && !regen.data.jobId && regen.data.estimate.withinBudget && <Button loading={regen.isPending} onClick={() => regen.mutate(false)}>Regenerate ({usd(regen.data.estimate.totalCostUsd)})</Button>}
        {m.status === 'published' && <Button variant="danger" loading={unpub.isPending} onClick={() => unpub.mutate()}>Unpublish</Button>}
        {m.thumbnail?.svg && <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(m.thumbnail.svg)}`} alt={m.thumbnail.alt} width={160} height={90} className="rounded border" />}</div>
      {regen.data?.estimate && <div className="mt-2"><Estimate e={regen.data.estimate} /></div>}
      {[save, regen, restore, unpub].map((x, i) => x.error && <Alert key={i}>{(x.error as Error).message}</Alert>)}</Section>
    <Section title="Automated checks">{!m.version ? <p className="text-sm">Not generated yet.</p> : <>
      {(v.errors ?? []).length > 0 && <><h3 className="font-medium text-red-800">Errors (block publishing)</h3><ul className="list-disc pl-5 text-sm">{v.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul></>}
      {(v.warnings ?? []).length > 0 && <><h3 className="mt-2 font-medium text-amber-900">Warnings</h3><ul className="list-disc pl-5 text-sm">{v.warnings.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul></>}
      {(v.checks ?? []).length > 0 && <ul className="mt-2 text-sm">{v.checks.map((c: any, i: number) => <li key={i}>{c.ok ? '✓' : '✗'} {c.name}{c.detail ? ` — ${c.detail}` : ''}</li>)}</ul>}</>}</Section>
    {m.sourceMap?.length > 0 && <Section title="Source map"><ul className="text-sm">{m.sourceMap.map((s: any, i: number) => <li key={i}><strong>{s.key}</strong>: {s.support}{s.pages?.length ? `, pp. ${s.pages.join(', ')}` : ''}</li>)}</ul></Section>}
    <Section title="Sections">{(m.sections ?? []).map((s: any) => <div key={s.key} className="mb-3">
      {edit?.key === s.key ? <Card><label className="grid gap-1"><span className="font-medium">{s.key}. {s.title} (text)</span><textarea className="min-h-40 rounded border p-2 font-mono text-sm" value={edit!.content} onChange={(e) => setEdit({ key: s.key, content: e.target.value })} /></label>
        <div className="mt-2 flex gap-2"><Button loading={save.isPending} onClick={() => save.mutate({ sections: [{ key: s.key, content: edit!.content }] })}>Save as new version</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div></Card>
        : <><LessonSection s={s} /><Button variant="ghost" onClick={() => setEdit({ key: s.key, content: s.content ?? '' })}>Edit {s.key} text</Button></>}</div>)}</Section>
    <Section title="Versions"><ul className="text-sm">{versions.map((x: any) => <li key={x.version} className="flex flex-wrap items-center gap-2 py-0.5">v{x.version} · {when(x.createdAt)} · {x.reason ?? ''}{x.version !== m.version && <Button variant="ghost" loading={restore.isPending && restore.variables === x.version} onClick={() => restore.mutate(x.version)}>Restore</Button>}</li>)}</ul></Section>
    <Section title="History"><ul className="text-sm">{reviews.map((r: any) => <li key={r._id}>{when(r.createdAt)} · {r.action}{r.comment ? ` — ${r.comment}` : ''}</li>)}</ul></Section>
  </div>;
}
