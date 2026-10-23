import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { landingSchema, type LandingContent } from '@ghlearn/shared/src/landing';
import { api, patch, post } from '../lib/api';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { ConfirmButton } from '../components/ConfirmDialog';
import { AdminPage } from './pages';
import { PagesAdmin } from './sitePages';

/**
 * Admin → Public Website (docs/LANDING_SPEC.md §10): the landing-page content (one validated, versioned, audited document)
 * and enquiries from the For Schools and Contact pages. Super Admins only; the server enforces it.
 */
type Issue = { path: string; message: string };
interface LandingAdmin { content: LandingContent; defaults: LandingContent; version: number; updatedAt: string | null; updatedBy: string | null; customised: boolean; featuredLessons: { id: string; title: string | null; public: boolean }[]; emailConfigured: boolean }
const api2 = { get: () => api<LandingAdmin>('/api/admin/website/landing'), put: (c: LandingContent) => api<any>('/api/admin/website/landing', { method: 'PUT', body: JSON.stringify(c) }) };

export function WebsitePage() {
  const [sp, setSp] = useSearchParams();
  const tabs: [string, string][] = [['content', 'Landing page content'], ['pages', 'Pages'], ['enquiries', 'Enquiries']];
  const tab = tabs.some(([k]) => k === sp.get('tab')) ? sp.get('tab')! : 'content';
  const go = (k: string, focus = false) => { setSp(k === 'content' ? {} : { tab: k }, { replace: true }); if (focus) setTimeout(() => document.getElementById(`wtab-${k}`)?.focus()); };
  return <AdminPage title="Public website" description="Content of the public landing page, Help Centre articles and legal drafts, and enquiries sent from the For Schools and Contact pages. Product name, logo and the published legal text are edited in System Settings.">
    <div role="tablist" aria-label="Public website views" className="flex gap-1 overflow-x-auto border-b">
      {tabs.map(([k, l], i) => <button key={k} type="button" role="tab" id={`wtab-${k}`} aria-selected={tab === k} aria-controls={`wpanel-${k}`} tabIndex={tab === k ? 0 : -1}
        onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') go(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length][0], true); }}
        onClick={() => go(k)}
        className={`-mb-px whitespace-nowrap rounded-t-lg border px-4 py-2 text-sm ${tab === k ? 'border-slate-200 border-b-white bg-white font-semibold text-brand-800' : 'border-transparent text-slate-700 hover:text-brand-800'}`}>{l}</button>)}
    </div>
    <div role="tabpanel" id={`wpanel-${tab}`} aria-labelledby={`wtab-${tab}`} className="pt-2">{tab === 'content' ? <LandingEditor /> : tab === 'pages' ? <PagesAdmin /> : <Enquiries />}</div>
  </AdminPage>;
}

const lines = (v: string[]) => v.join('\n'); const unlines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
function Fieldset({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return <Card><fieldset className="space-y-3"><legend className="text-base font-semibold">{title}</legend>{note && <p className="text-xs text-slate-600">{note}</p>}{children}</fieldset></Card>;
}
function Area({ label, value, onChange, rows = 3, hint }: { label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: string }) {
  const id = `ta-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return <div className="space-y-1"><label htmlFor={id} className="block text-sm font-medium">{label}</label><textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-h` : undefined} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />{hint && <p id={`${id}-h`} className="text-xs text-slate-500">{hint}</p>}</div>;
}

function LandingEditor() {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['admin-landing'], queryFn: api2.get });
  const [d, setD] = useState<LandingContent | null>(null); const [json, setJson] = useState<string | null>(null); const [issues, setIssues] = useState<Issue[]>([]); const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { if (q.data && !d) setD(q.data.content); }, [q.data, d]);
  const dirty = useMemo(() => !!d && !!q.data && JSON.stringify(d) !== JSON.stringify(q.data.content), [d, q.data]);
  const save = useMutation({ mutationFn: async (c: LandingContent) => {
    const chk = await post<{ ok: boolean; issues: Issue[] }>('/api/admin/website/landing/check', c); if (!chk.ok) { setIssues(chk.issues); throw new Error('Fix the problems listed above, then save again.'); }
    return api2.put(c); }, onSuccess: (r) => { setIssues([]); setSaved(r.changed.length ? `Saved version ${r.version}. Changed: ${r.changed.join(', ')}.` : 'No changes.'); qc.invalidateQueries({ queryKey: ['admin-landing'] }); qc.invalidateQueries({ queryKey: ['public-landing'] }); setD(r.content); } });
  const reset = useMutation({ mutationFn: () => post<any>('/api/admin/website/landing/reset', {}), onSuccess: (r) => { setD(r.content); setSaved('Restored the default content.'); qc.invalidateQueries({ queryKey: ['admin-landing'] }); qc.invalidateQueries({ queryKey: ['public-landing'] }); } });
  if (q.isLoading || !d) return q.error ? <Alert>{q.error.message}</Alert> : <Spinner />;
  const up = <K extends keyof LandingContent>(k: K, v: Partial<LandingContent[K]>) => { setSaved(null); setD({ ...d, [k]: { ...(d[k] as any), ...v } }); };
  const local = landingSchema.safeParse(d); const localIssues = local.success ? [] : local.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const shown = issues.length ? issues : localIssues;
  return <div className="space-y-4">
    <p className="text-sm text-slate-600">Version {q.data!.version}{q.data!.updatedAt ? `, saved ${new Date(q.data!.updatedAt).toLocaleString()}${q.data!.updatedBy ? ` by ${q.data!.updatedBy}` : ''}` : ' (defaults, never edited)'}. Text is plain text; <code>{'{appName}'}</code> is replaced with the product name. Links are internal paths (/schools, /#subjects) or https:// links. Every save is validated and recorded in the audit log.</p>
    {shown.length > 0 && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800"><p className="font-semibold">{shown.length} problem{shown.length === 1 ? '' : 's'} to fix before saving:</p><ul className="mt-1 list-disc pl-5">{shown.slice(0, 12).map((i) => <li key={i.path + i.message}><code>{i.path || 'content'}</code>: {i.message}</li>)}</ul></div>}
    <Fieldset title="Announcement bar">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.announcement.enabled} onChange={(e) => up('announcement', { enabled: e.target.checked })} />Show the announcement bar</label>
      <Input label="Announcement text" value={d.announcement.text} onChange={(e) => up('announcement', { text: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-2"><Input label="Link label (optional)" value={d.announcement.linkLabel} onChange={(e) => up('announcement', { linkLabel: e.target.value })} /><Input label="Link (optional)" value={d.announcement.linkHref} onChange={(e) => up('announcement', { linkHref: e.target.value })} /></div>
    </Fieldset>
    <Fieldset title="Hero">
      <Input label="Label above the heading" value={d.hero.eyebrow} onChange={(e) => up('hero', { eyebrow: e.target.value })} />
      <Input label="Heading" value={d.hero.title} onChange={(e) => up('hero', { title: e.target.value })} />
      <Area label="Paragraph" value={d.hero.subtitle} onChange={(v) => up('hero', { subtitle: v })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Primary button label" value={d.hero.primaryCta.label} onChange={(e) => up('hero', { primaryCta: { ...d.hero.primaryCta, label: e.target.value } })} />
        <Input label="Primary button link" value={d.hero.primaryCta.href} onChange={(e) => up('hero', { primaryCta: { ...d.hero.primaryCta, href: e.target.value } })} hint="Signed-in users always go to their dashboard instead of /register or /login." />
        <Input label="Secondary button label" value={d.hero.secondaryCta.label} onChange={(e) => up('hero', { secondaryCta: { ...d.hero.secondaryCta, label: e.target.value } })} />
        <Input label="Secondary button link" value={d.hero.secondaryCta.href} onChange={(e) => up('hero', { secondaryCta: { ...d.hero.secondaryCta, href: e.target.value } })} /></div>
      <Input label="Note under the buttons" value={d.hero.note} onChange={(e) => up('hero', { note: e.target.value })} />
      <Area label="Subjects in the product preview (one per line, 2 to 6)" value={lines(d.hero.previewSubjects)} onChange={(v) => up('hero', { previewSubjects: unlines(v) })} rows={4} />
    </Fieldset>
    <Fieldset title="Sign-up buttons" note="Header Sign up menu, For Teachers section, final band, footer and the sign-in page. Student buttons open /register; teacher buttons open the teacher application (/register/teacher), which an administrator approves.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Header button" value={d.signup.headerLabel} onChange={(e) => up('signup', { headerLabel: e.target.value })} />
        <Input label="Teacher application button (For Teachers section)" value={d.signup.teacherApplyLabel} onChange={(e) => up('signup', { teacherApplyLabel: e.target.value })} />
        <Input label="Menu: student choice" value={d.signup.studentLabel} onChange={(e) => up('signup', { studentLabel: e.target.value })} />
        <Input label="Menu: student hint" value={d.signup.studentHint} onChange={(e) => up('signup', { studentHint: e.target.value })} />
        <Input label="Menu: teacher choice" value={d.signup.teacherLabel} onChange={(e) => up('signup', { teacherLabel: e.target.value })} />
        <Input label="Menu: teacher hint" value={d.signup.teacherHint} onChange={(e) => up('signup', { teacherHint: e.target.value })} />
        <Input label="Sign-in page: student button" value={d.signup.loginStudentLabel} onChange={(e) => up('signup', { loginStudentLabel: e.target.value })} />
        <Input label="Sign-in page: teacher link" value={d.signup.loginTeacherLabel} onChange={(e) => up('signup', { loginTeacherLabel: e.target.value })} />
        <Input label="Final band: student button" value={d.finalCta.primaryLabel} onChange={(e) => up('finalCta', { primaryLabel: e.target.value })} />
        <Input label="Final band: teacher button" value={d.finalCta.secondaryLabel} onChange={(e) => up('finalCta', { secondaryLabel: e.target.value })} hint="Links to the teacher application." /></div>
      <Area label="Note under the teacher application button" value={d.signup.teacherNote} onChange={(v) => up('signup', { teacherNote: v })} rows={2} hint="Say how approval really works; no promises about timing." />
    </Fieldset>
    <Fieldset title="Search and subjects">
      <Area label="Popular searches (one per line)" value={lines(d.search.popular)} onChange={(v) => up('search', { popular: unlines(v) })} rows={4} />
      <Area label="Featured subject codes (one per line, in order)" value={lines(d.subjects.featuredCodes)} onChange={(v) => setD({ ...d, subjects: { ...d.subjects, featuredCodes: unlines(v).map((x) => x.toUpperCase()) } })} rows={4} hint="Codes as in Academic Structure, e.g. MATH, S-GENSCI, S-COM. Inactive subjects are never shown." />
      <p className="text-xs text-slate-600">Subject filters are edited in “All content (JSON)” below.</p>
    </Fieldset>
    <Fieldset title="Featured lesson" note="The first public-preview lesson listed here fills the lesson card. Mark a published lesson as a public preview in AI Content Generation → the lesson → Public preview.">
      <Area label="Lesson ids (one per line)" value={lines(d.lessons.featuredLessonIds)} onChange={(v) => setD({ ...d, lessons: { ...d.lessons, featuredLessonIds: unlines(v) } })} rows={2} />
      {q.data!.featuredLessons.length > 0 && <ul className="text-sm">{q.data!.featuredLessons.map((f) => <li key={f.id}>{f.title ?? 'Unknown lesson'}: {f.public ? 'public preview, shown' : 'not a public preview, not shown'}</li>)}</ul>}
    </Fieldset>
    <Fieldset title="Live sessions" note="Describes the existing Meetings feature: students book teachers or counselors at their own school; online sessions use an external meeting link. Hidden when Meetings is switched off in System Settings.">
      <Input label="Live sessions heading" value={d.liveSessions.title} onChange={(e) => up('liveSessions', { title: e.target.value })} />
      <Area label="Live sessions paragraph" value={d.liveSessions.subtitle} onChange={(v) => up('liveSessions', { subtitle: v })} rows={2} />
      {d.liveSessions.points.map((p, i) => <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr]">
        <Input label={`Benefit ${i + 1} title`} value={p.title} onChange={(e) => up('liveSessions', { points: d.liveSessions.points.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
        <Area label={`Benefit ${i + 1} text`} value={p.body} onChange={(v) => up('liveSessions', { points: d.liveSessions.points.map((x, j) => (j === i ? { ...x, body: v } : x)) })} rows={2} /></div>)}
      <Area label="Live sessions note" value={d.liveSessions.note} onChange={(v) => up('liveSessions', { note: v })} rows={2} />
      <div className="grid gap-3 sm:grid-cols-2"><Input label="Button for visitors" value={d.liveSessions.ctaLabel} onChange={(e) => up('liveSessions', { ctaLabel: e.target.value })} />
        <Input label="Button for signed-in students" value={d.liveSessions.signedInCtaLabel} onChange={(e) => up('liveSessions', { signedInCtaLabel: e.target.value })} /></div>
    </Fieldset>
    <Fieldset title="Organisation (footer and Contact page)" note="Also the address enquiry notifications are sent to, when email is configured.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Label before the name (optional, e.g. Powered by)" value={d.organisation.poweredByLabel} onChange={(e) => up('organisation', { poweredByLabel: e.target.value })} />
        <Input label="Organisation name" value={d.organisation.name} onChange={(e) => up('organisation', { name: e.target.value })} />
        <Input label="Address" value={d.organisation.address} onChange={(e) => up('organisation', { address: e.target.value })} />
        <Input label="Email" type="email" value={d.organisation.email} onChange={(e) => up('organisation', { email: e.target.value })} hint={q.data!.emailConfigured ? 'Email delivery is configured.' : 'Email delivery is not configured on the server, so enquiries are only stored here.'} />
        <Input label="Phone (as displayed)" value={d.organisation.phone} onChange={(e) => up('organisation', { phone: e.target.value })} hint="The call link uses the digits only." />
        <Input label="Hashtag" value={d.organisation.hashtag} onChange={(e) => up('organisation', { hashtag: e.target.value })} /></div>
    </Fieldset>
    <Fieldset title="Footer">
      <Area label="Short description" value={d.footer.description} onChange={(v) => up('footer', { description: v })} />
      <Area label="Data-protection note" value={d.footer.dataProtection} onChange={(v) => up('footer', { dataProtection: v })} hint="Phrase it as a commitment, not a certification." />
      <Input label="Language note" value={d.footer.languageNote} onChange={(e) => up('footer', { languageNote: e.target.value })} />
    </Fieldset>
    <Fieldset title={`Frequently asked questions (${d.faqs.length})`} note="Answers must describe what the platform really does today.">
      {d.faqs.map((f, i) => <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-3">
        <Input label={`Question ${i + 1}`} value={f.q} onChange={(e) => setD({ ...d, faqs: d.faqs.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
        <Area label={`Answer ${i + 1}`} value={f.a} onChange={(v) => setD({ ...d, faqs: d.faqs.map((x, j) => (j === i ? { ...x, a: v } : x)) })} />
        <div className="flex gap-2">
          <Button variant="ghost" className="px-3 py-1 text-sm" disabled={i === 0} onClick={() => { const n = [...d.faqs]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setD({ ...d, faqs: n }); }} aria-label={`Move question ${i + 1} up`}>Move up</Button>
          <Button variant="ghost" className="px-3 py-1 text-sm" onClick={() => setD({ ...d, faqs: d.faqs.filter((_, j) => j !== i) })} aria-label={`Remove question ${i + 1}`}>Remove</Button></div></div>)}
      <Button variant="ghost" onClick={() => setD({ ...d, faqs: [...d.faqs, { q: '', a: '' }] })}>Add a question</Button>
    </Fieldset>
    <Card><details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) setJson(JSON.stringify(d, null, 2)); }}>
      <summary className="cursor-pointer font-semibold">All content (JSON)</summary>
      <p className="mt-2 text-xs text-slate-600">Every section, including headings of the other sections, subject filters and feature cards. Apply copies it into the form above; nothing is saved until you press Save.</p>
      {json !== null && <><label htmlFor="landing-json" className="sr-only">Landing content JSON</label><textarea id="landing-json" value={json} onChange={(e) => setJson(e.target.value)} rows={18} className="mt-2 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs" spellCheck={false} />
        <Button variant="ghost" className="mt-2" onClick={() => { try { setD(JSON.parse(json)); setIssues([]); } catch { setIssues([{ path: '', message: 'The JSON is not valid' }]); } }}>Apply JSON to the form</Button></>}
    </details></Card>
    <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-white/95 py-3">
      <Button onClick={() => save.mutate(d)} loading={save.isPending} disabled={!dirty}>Save landing content</Button>
      <Button variant="ghost" disabled={!dirty} onClick={() => { setD(q.data!.content); setIssues([]); }}>Discard changes</Button>
      {q.data!.customised && <ConfirmButton variant="ghost" label="Restore defaults" title="Restore the default landing content?" body={<p>Every customised text, link and FAQ goes back to the built-in default. This is recorded in the audit log.</p>} onConfirm={() => reset.mutateAsync()} />}
      <a className="text-sm text-brand-700 underline" href="/welcome" target="_blank" rel="noreferrer">Open the landing page</a>
      {save.error && <span role="alert" className="text-sm text-red-700">{save.error.message}</span>}{saved && <span role="status" className="text-sm text-brand-800">{saved}</span>}
    </div>
  </div>;
}

interface Enq { _id: string; kind: 'school' | 'contact'; name: string; email: string; phone?: string; organisation?: string; role?: string; region?: string; learners?: number; topic?: string; message: string; status: 'new' | 'in_progress' | 'closed'; adminNote?: string; emailStatus?: string; createdAt: string }
const STATUS: Record<Enq['status'], string> = { new: 'New', in_progress: 'In progress', closed: 'Closed' };
const EMAIL: Record<string, string> = { sent: 'notification emailed', failed: 'notification email failed', not_configured: 'email not configured', no_address: 'no organisation email set' };
function Enquiries() {
  const [status, setStatus] = useState(''); const [kind, setKind] = useState(''); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-enquiries', status, kind], queryFn: () => api<{ items: Enq[]; total: number; newCount: number }>(`/api/admin/website/enquiries?${new URLSearchParams({ ...(status ? { status } : {}), ...(kind ? { kind } : {}) })}`) });
  const upd = useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<Enq> }) => patch(`/api/admin/website/enquiries/${id}`, body), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-enquiries'] }) });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3"><div className="w-44"><Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
      <div className="w-44"><Select label="Type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All</option><option value="school">School enquiries</option><option value="contact">Contact messages</option></Select></div>
      {q.data && <p className="pb-2 text-sm text-slate-600">{q.data.total} shown · {q.data.newCount} new in total</p>}</div>
    {q.isLoading ? <Spinner /> : q.error ? <Alert>{q.error.message}</Alert> : !q.data!.items.length ? <Alert tone="info">No enquiries yet.</Alert>
      : <ul className="space-y-3">{q.data!.items.map((e) => <li key={e._id}><Card>
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">{e.kind === 'school' ? `School enquiry: ${e.organisation}` : `Contact: ${e.topic || 'General'}`}</h2>
          <p className="text-sm text-slate-600">{e.name} · <a className="text-brand-700 underline" href={`mailto:${e.email}`}>{e.email}</a>{e.phone ? ` · ${e.phone}` : ''} · {new Date(e.createdAt).toLocaleString()}{e.emailStatus ? ` · ${EMAIL[e.emailStatus] ?? e.emailStatus}` : ''}</p>
          {e.kind === 'school' && <p className="text-sm text-slate-600">{[e.role, e.region, e.learners ? `${e.learners} learners` : ''].filter(Boolean).join(' · ')}</p>}</div>
          <div className="w-40"><Select label="Status" value={e.status} onChange={(x) => upd.mutate({ id: e._id, body: { status: x.target.value as Enq['status'] } })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div></div>
        <p className="mt-2 whitespace-pre-wrap text-sm">{e.message}</p>
        <NoteEditor e={e} onSave={(adminNote) => upd.mutateAsync({ id: e._id, body: { adminNote } })} />
      </Card></li>)}</ul>}
    {upd.error && <Alert>{upd.error.message}</Alert>}
  </div>;
}
function NoteEditor({ e, onSave }: { e: Enq; onSave: (n: string) => Promise<unknown> }) {
  const [n, setN] = useState(e.adminNote ?? ''); const [busy, setBusy] = useState(false);
  return <div className="mt-3 flex flex-wrap items-end gap-2"><div className="min-w-64 flex-1"><Input label="Internal note" value={n} onChange={(x) => setN(x.target.value)} /></div>
    <Button variant="ghost" loading={busy} disabled={n === (e.adminNote ?? '')} onClick={() => { setBusy(true); onSave(n).finally(() => setBusy(false)); }}>Save note</Button></div>;
}
