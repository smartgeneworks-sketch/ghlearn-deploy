import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, patch, post, HttpError } from '../lib/api';
import { Alert, Button, Card, Input, Select, Spinner } from '../components/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AdminPage, SystemStatus } from './pages';
import { ErrorBox } from './common';
import { SmsPanel } from './sms';

/**
 * §20 System settings. Every section saves on its own. The server decides which changes are high-impact: it answers
 * 409 CONFIRM_REQUIRED with the list, the dialog shows it, and the change is re-sent with confirm: true. Every saved
 * change is audited with a before/after diff. Operators see the values read-only. No secrets are stored here.
 */
type Change = { key: string; reason: string };
const SECTIONS: [string, string][] = [['branding', 'Branding'], ['theme', 'Theme'], ['academic', 'Academic year and levels'], ['review', 'Review policy'], ['ai', 'AI defaults'],
  ['uploads', 'Uploads'], ['notifications', 'Notifications'], ['retention', 'Data retention'], ['sessions', 'Sessions and sign-in'], ['offline', 'Offline downloads'],
  ['features', 'Feature flags'], ['maintenance', 'Maintenance mode'], ['legal', 'Terms and privacy']];

export function SystemSettingsPage() {
  const [sp, setSp] = useSearchParams(); const t = sp.get('tab'); const tab = t === 'status' || t === 'sms' ? t : 'settings';
  const tabs: [string, string][] = [['settings', 'Settings'], ['status', 'Status'], ['sms', 'SMS and email']];
  const go = (n: string) => setSp(n === 'settings' ? {} : { tab: n }, { replace: true });
  return <AdminPage title="System settings" description="Platform-wide settings, stored in the database and enforced by the server, and the live system status.">
    <div role="tablist" aria-label="System settings views" className="flex gap-1 border-b">
      {tabs.map(([k, l]) => <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`} tabIndex={tab === k ? 0 : -1}
        onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const i = tabs.findIndex(([x]) => x === tab); const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length][0]; go(n); setTimeout(() => document.getElementById(`tab-${n}`)?.focus(), 0); } }}
        onClick={() => go(k)}
        className={`-mb-px rounded-t-lg border px-4 py-2 text-sm ${tab === k ? 'border-slate-200 border-b-white bg-white font-semibold text-brand-800' : 'border-transparent text-slate-700 hover:text-brand-800'}`}>{l}</button>)}
    </div>
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-2">{tab === 'status' ? <SystemStatus /> : tab === 'sms' ? <SmsPanel /> : <SettingsPanel />}</div>
  </AdminPage>;
}

function useSave(after?: () => void) {
  const qc = useQueryClient(); const [pending, setPending] = useState<{ body: any; changes: Change[]; url: string; method: 'patch' | 'post' } | null>(null);
  const send = (url: string, body: any, method: 'patch' | 'post' = 'patch') => (method === 'patch' ? patch<any>(url, body) : post<any>(url, body));
  const m = useMutation({
    mutationFn: async ({ url, body, method = 'patch' }: { url: string; body: any; method?: 'patch' | 'post' }) => {
      try { return await send(url, body, method); } catch (e) {
        if (e instanceof HttpError && e.code === 'CONFIRM_REQUIRED') { setPending({ body, url, method, changes: (e.details as any)?.changes ?? [] }); return { needsConfirm: true }; }
        throw e;
      }
    },
    onSuccess: (r: any) => { if (!r?.needsConfirm) { qc.invalidateQueries({ queryKey: ['admin-settings'] }); qc.invalidateQueries({ queryKey: ['platform'] }); after?.(); } },
  });
  const dialog = <ConfirmDialog open={!!pending} title="Confirm high-impact change" confirmLabel="Confirm and save" onClose={() => setPending(null)}
    onConfirm={async () => { const p = pending!; await send(p.url, { ...p.body, confirm: true }, p.method); qc.invalidateQueries({ queryKey: ['admin-settings'] }); qc.invalidateQueries({ queryKey: ['platform'] }); m.reset(); after?.(); setDone(true); }}>
    <p>These changes affect the whole platform:</p><ul className="list-disc space-y-1 pl-5">{pending?.changes.map((c) => <li key={c.key}>{c.reason}</li>)}</ul><p>The change is recorded in the audit log.</p>
  </ConfirmDialog>;
  const [done, setDone] = useState(false);
  useEffect(() => { if (m.isPending) setDone(false); }, [m.isPending]);
  const saved = done || (m.isSuccess && !(m.data as any)?.needsConfirm);
  return { m, dialog, saved, save: (url: string, body: any, method: 'patch' | 'post' = 'patch') => m.mutate({ url, body, method }) };
}

function SettingsPanel() {
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => api<any>('/api/admin/settings') });
  if (q.isLoading) return <Spinner />; if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data; const edit = d.canEdit;
  return <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
    <nav aria-label="Settings sections" className="lg:sticky lg:top-16 lg:self-start"><ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm lg:block lg:space-y-1">
      {SECTIONS.map(([k, l]) => <li key={k}><a className="text-brand-700 underline lg:no-underline lg:hover:underline" href={`#set-${k}`}>{l}</a></li>)}</ul></nav>
    <div className="min-w-0 space-y-4">
      {!edit && <Alert tone="info">You can view these settings. Only a Super Admin can change them.</Alert>}
      <p className="text-sm text-slate-600">Version {d.version}{d.updatedAt ? `, last changed ${new Date(d.updatedAt).toLocaleString()}${d.updatedBy ? ` by ${d.updatedBy}` : ''}` : ' (defaults, never changed)'}. Every change is recorded in the <Link className="text-brand-700 underline" to="/admin/audit?entityType=settings">audit log</Link> with what changed. Secrets (API keys, passwords) are set in the server environment, never here.</p>
      <Branding d={d} edit={edit} /><Theme d={d} edit={edit} /><Academic d={d} edit={edit} />
      <Simple id="review" title="Review policy" d={d} edit={edit} intro={<Alert tone="info">{d.review.note}</Alert>}
        fields={[['remindersEnabled', 'Send daily review reminders', 'bool'], ['reminderAfterHours', 'Remind about items waiting longer than (hours)', 'number', 4, 336]]} />
      <AiDefaults d={d} />
      <Simple id="uploads" title="Uploads" d={d} edit={edit} intro={<p className="text-sm text-slate-600">The server limit is {d.limits.uploadMaxMbEnv} MB and {d.limits.ocrMaxPagesEnv} OCR pages (environment); these settings can only be lower.</p>}
        fields={[['maxUploadMb', 'Maximum file size (MB)', 'number', 1, d.limits.uploadMaxMbEnv], ['formats', 'Accepted formats', 'formats'], ['ocrEnabled', 'Read scanned pages with OCR', 'bool'], ['ocrMaxPages', 'OCR page limit per manual', 'number', 1, d.limits.ocrMaxPagesEnv]]} />
      <Simple id="notifications" title="Notifications" d={d} edit={edit} intro={!d.limits.emailConfigured ? <p className="text-sm text-slate-600">Email is not configured on the server (SMTP_URL), so notifications are in-app only whatever this setting says.</p> : undefined}
        fields={[['emailEnabled', 'Send notification email', 'bool'], ['announcementMaxDays', 'Longest announcement period (days)', 'number', 1, 365]]} />
      <Retention d={d} edit={edit} />
      <Simple id="sessions" title="Sessions and sign-in" d={d} edit={edit} intro={<p className="text-sm text-slate-600">Applies to new sign-ins and token refreshes.</p>}
        fields={[['accessMinutes', 'Access token lifetime (minutes)', 'number', 5, 60], ['sessionDays', 'Stay signed in for (days without use)', 'number', 1, 60], ['lockoutAttempts', 'Failed sign-ins before lockout', 'number', 3, 20], ['lockoutMinutes', 'Lockout length (minutes)', 'number', 5, 240]]} />
      <Simple id="offline" title="Offline downloads" d={d} edit={edit}
        fields={[['bundleEnabled', 'Allow offline subject downloads (one HTML file)', 'bool'], ['saveLessonsEnabled', 'Allow saving lessons on devices', 'bool'], ['bundleMaxResources', 'Most lessons in one download', 'number', 5, 500]]} />
      <Simple id="features" title="Feature flags" d={d} edit={edit} intro={<p className="text-sm text-slate-600">A switched-off feature is refused by the server for everyone and hidden in the app.{!d.limits.selfRegistrationEnv && ' Self-registration is also switched off in the environment (SELF_REGISTRATION), which takes precedence.'}</p>}
        fields={Object.entries(d.features).map(([k, l]) => [k, l as string, 'bool'] as F)} />
      <Simple id="maintenance" title="Maintenance mode" d={d} edit={edit} intro={<p className="text-sm text-slate-600">While on, only administrators can sign in and use the API; everyone else sees the message. Turning it on asks for confirmation.</p>}
        fields={[['enabled', 'Maintenance mode on', 'bool'], ['message', 'Message shown to users', 'text', 0, 300], ['until', 'Expected end (optional)', 'datetime']]} />
      <Simple id="legal" title="Terms and privacy" d={d} edit={edit} intro={<p className="text-sm text-slate-600">Shown at <Link className="text-brand-700 underline" to="/terms">/terms</Link> and <Link className="text-brand-700 underline" to="/privacy">/privacy</Link>, linked from sign-in and registration. Version {d.legal.version}{d.legal.updatedAt ? `, published ${new Date(d.legal.updatedAt).toLocaleDateString()}` : ''}. Leave a blank line between paragraphs.</p>}
        fields={[['terms', 'Terms of use', 'textarea', 0, 30000], ['privacy', 'Privacy notice', 'textarea', 0, 30000]]} />
    </div></div>;
}

const Box = ({ id, title, children }: { id: string; title: string; children: ReactNode }) =>
  <Card><section id={`set-${id}`} aria-labelledby={`set-${id}-h`} className="scroll-mt-20 space-y-3"><h2 id={`set-${id}-h`} className="text-lg font-semibold">{title}</h2>{children}</section></Card>;
const SaveRow = ({ s, edit, dirty }: { s: ReturnType<typeof useSave>; edit: boolean; dirty: boolean }) => !edit ? null :
  <div className="flex flex-wrap items-center gap-3"><Button type="submit" loading={s.m.isPending} disabled={!dirty}>Save</Button>
    {s.saved && !dirty && <span role="status" className="text-sm text-emerald-800">Saved.</span>}{s.m.error && <div className="w-full"><Alert>{(s.m.error as Error).message}</Alert></div>}{s.dialog}</div>;

type F = [string, string, 'bool' | 'number' | 'text' | 'textarea' | 'datetime' | 'formats', number?, number?];
const FORMATS: [string, string][] = [['pdf', 'PDF'], ['docx', 'Word (DOCX)'], ['txt', 'Plain text'], ['csv', 'CSV']];
const toLocal = (v: string | null) => (v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
function Simple({ id, title, d, edit, fields, intro }: { id: string; title: string; d: any; edit: boolean; fields: F[]; intro?: ReactNode }) {
  const cur = d.settings[id]; const init = () => Object.fromEntries(fields.map(([k, , t]) => [k, t === 'number' ? String(cur[k]) : t === 'datetime' ? toLocal(cur[k]) : cur[k]]));
  const [v, setV] = useState<Record<string, any>>(init); const s = useSave();
  useEffect(() => { setV(init()); }, [d.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const out = () => Object.fromEntries(fields.map(([k, , t]) => [k, t === 'number' ? Number(v[k]) : t === 'datetime' ? (v[k] ? new Date(v[k]).toISOString() : null) : v[k]]));
  const changed = () => { const o = out(); return Object.fromEntries(Object.entries(o).filter(([k, x]) => JSON.stringify(x) !== JSON.stringify(fields.find((f) => f[0] === k)![2] === 'datetime' ? (cur[k] ? new Date(cur[k]).toISOString() : null) : cur[k]))); };
  const dirty = Object.keys(changed()).length > 0;
  return <Box id={id} title={title}>{intro}
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); s.save('/api/admin/settings', { [id]: changed() }); }}>
      <fieldset disabled={!edit} className="grid gap-3 sm:grid-cols-2">
        {fields.map(([k, label, t, min, max]) => t === 'bool' ? <label key={k} className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1 h-4 w-4" checked={!!v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} />{label}</label>
          : t === 'formats' ? <fieldset key={k} className="sm:col-span-2"><legend className="text-sm font-medium">{label}</legend><div className="mt-1 flex flex-wrap gap-4">{FORMATS.map(([f, l]) =>
            <label key={f} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={v[k].includes(f)} onChange={(e) => setV({ ...v, [k]: e.target.checked ? [...v[k], f] : v[k].filter((x: string) => x !== f) })} />{l}</label>)}</div>
            {!v[k].length && <p role="alert" className="text-sm text-red-700">Choose at least one format.</p>}</fieldset>
          : t === 'textarea' ? <div key={k} className="space-y-1 sm:col-span-2"><label htmlFor={`f-${id}-${k}`} className="block text-sm font-medium">{label}</label>
            <textarea id={`f-${id}-${k}`} rows={8} maxLength={max} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
            <p className="text-xs text-slate-600">{v[k].length} / {max} characters</p></div>
          : <Input key={k} label={label} type={t === 'number' ? 'number' : t === 'datetime' ? 'datetime-local' : 'text'} min={t === 'number' ? min : undefined} max={t === 'number' ? max : undefined} maxLength={t === 'text' ? max : undefined}
            hint={t === 'number' ? `${min}–${max}` : undefined} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />)}
      </fieldset>
      <SaveRow s={s} edit={edit} dirty={dirty} />
    </form></Box>;
}

function Branding({ d, edit }: { d: any; edit: boolean }) {
  const b = d.settings.branding; const [v, setV] = useState({ ...b }); const [err, setErr] = useState(''); const s = useSave();
  useEffect(() => setV({ ...d.settings.branding }), [d.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== b[k])); const dirty = Object.keys(changed).length > 0;
  const pick = (f?: File) => { setErr(''); if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return setErr('Choose a PNG, JPEG or WebP image.');
    if (f.size > 150 * 1024) return setErr('The logo must be 150 KB or smaller.');
    const r = new FileReader(); r.onload = () => setV((x: any) => ({ ...x, logo: String(r.result) })); r.readAsDataURL(f); };
  return <Box id="branding" title="Branding"><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); s.save('/api/admin/settings', { branding: changed }); }}>
    <fieldset disabled={!edit} className="grid gap-3 sm:grid-cols-2">
      <Input label="App name" maxLength={40} value={v.appName} onChange={(e) => setV({ ...v, appName: e.target.value })} />
      <Input label="Support email (optional)" type="email" value={v.supportEmail} onChange={(e) => setV({ ...v, supportEmail: e.target.value })} />
      <div className="sm:col-span-2"><Input label="Tagline" maxLength={120} value={v.tagline} onChange={(e) => setV({ ...v, tagline: e.target.value })} /></div>
      <div className="space-y-2 sm:col-span-2"><span className="block text-sm font-medium" id="logo-l">Logo</span>
        <div className="flex flex-wrap items-center gap-3">{v.logo ? <img src={v.logo} alt="Current logo" className="h-14 w-14 rounded border bg-white object-contain p-1" /> : <span className="text-sm text-slate-600">No logo; the app name is shown on its own.</span>}
          <label className="cursor-pointer rounded-lg border border-brand-700 px-3 py-2 text-sm text-brand-700">Choose image<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-describedby="logo-h" onChange={(e) => pick(e.target.files?.[0])} /></label>
          {v.logo && <Button type="button" variant="ghost" onClick={() => setV({ ...v, logo: null })}>Remove logo</Button>}</div>
        <p id="logo-h" className="text-xs text-slate-600">PNG, JPEG or WebP, up to 150 KB. SVG is not accepted.</p>{err && <p role="alert" className="text-sm text-red-700">{err}</p>}</div>
    </fieldset><SaveRow s={s} edit={edit} dirty={dirty} /></form></Box>;
}

function Theme({ d, edit }: { d: any; edit: boolean }) {
  const [v, setV] = useState(d.settings.theme.preset); const s = useSave();
  useEffect(() => setV(d.settings.theme.preset), [d.version]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Box id="theme" title="Theme"><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); s.save('/api/admin/settings', { theme: { preset: v } }); }}>
    <fieldset disabled={!edit}><legend className="mb-2 text-sm text-slate-600">Colour scheme. Every option keeps text readable (WCAG AA contrast).</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{d.themes.map((t: any) => <label key={t.key} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm ${v === t.key ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-300'}`}>
        <input type="radio" name="theme" value={t.key} checked={v === t.key} onChange={() => setV(t.key)} className="h-4 w-4" />
        <span className="flex gap-1" aria-hidden>{['900', '700', '100'].map((sh) => <span key={sh} className="h-6 w-6 rounded border" style={{ background: t[sh] }} />)}</span>{t.label}</label>)}</div></fieldset>
    <SaveRow s={s} edit={edit} dirty={v !== d.settings.theme.preset} /></form></Box>;
}

function Academic({ d, edit }: { d: any; edit: boolean }) {
  const cur = d.academic.years.find((y: any) => y.current); const [y, setY] = useState(cur?._id ?? ''); const s = useSave();
  useEffect(() => setY(cur?._id ?? ''), [cur?._id]);
  return <Box id="academic" title="Academic year and levels">
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); s.save('/api/admin/settings/academic-year', { yearId: y }, 'post'); }}>
      <Select label="Current academic year" disabled={!edit} value={y} onChange={(e) => setY(e.target.value)}><option value="">None</option>{d.academic.years.map((x: any) => <option key={x._id} value={x._id}>{x.label}{x.current ? ' (current)' : ''}</option>)}</Select>
      {edit && <Button type="submit" disabled={!y || y === cur?._id} loading={s.m.isPending}>Make current</Button>}{s.saved && <span role="status" className="text-sm text-emerald-800">Saved.</span>}{s.dialog}
    </form>{s.m.error && <Alert>{(s.m.error as Error).message}</Alert>}
    <div><h3 className="text-sm font-semibold">Levels</h3>
      <ul className="mt-1 divide-y text-sm">{d.academic.levels.map((l: any) => <li key={l._id} className="flex flex-wrap justify-between gap-2 py-1"><span>{l.name} <span className="text-slate-600">({l.kind}, {l.years} years)</span></span><span className={l.enabled ? 'text-emerald-800' : 'text-slate-600'}>{l.enabled ? 'Enabled' : 'Disabled'}</span></li>)}</ul>
      <p className="mt-2 text-sm"><Link className="text-brand-700 underline" to="/admin/structure">Add, rename, enable or archive levels and years in Academic structure</Link></p></div>
  </Box>;
}

function AiDefaults({ d }: { d: any }) {
  const a = d.ai;
  return <Box id="ai" title="AI defaults"><dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[16rem_1fr]">
    {([['Platform requests per day', a.platformDailyRequests], ['Platform requests per month', a.platformMonthlyRequests ?? '—'], ['Monthly cost cap (estimated)', a.platformMonthlyCostUsd ? `$${a.platformMonthlyCostUsd}` : 'none'], ['Requests per user per day', a.perUserDailyRequests], ['Requests per school per day', a.schoolDailyRequests],
      ['Model', a.llmModel ?? 'provider default'], ['Retries / timeout', `${a.maxRetries} / ${a.timeoutSec} s`], ['Allowed features', a.allowedFeatures.length]] as [string, ReactNode][]).map(([k, x]) => [<dt key={k} className="font-medium">{k}</dt>, <dd key={k + 'd'}>{x}</dd>])}</dl>
    <p className="text-sm"><Link className="text-brand-700 underline" to="/admin/ai-usage">Change AI limits, providers and the model in AI usage and costs</Link></p></Box>;
}

const RET: [string, string, number, number][] = [['notificationDays', 'Notifications', 30, 1825], ['aiUsageDays', 'AI usage records and health checks', 90, 1825], ['jobDays', 'Finished processing jobs', 7, 730], ['tutorDays', 'Tutor conversations', 7, 730], ['auditDays', 'Audit log', 365, 3650]];
function Retention({ d, edit }: { d: any; edit: boolean }) {
  const r = d.settings.retention; const qc = useQueryClient();
  const [v, setV] = useState<Record<string, any>>(() => ({ ...Object.fromEntries(RET.map(([k]) => [k, String(r[k])])), purgeEnabled: r.purgeEnabled }));
  useEffect(() => setV({ ...Object.fromEntries(RET.map(([k]) => [k, String(d.settings.retention[k])])), purgeEnabled: d.settings.retention.purgeEnabled }), [d.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useSave(); const run = useSave(() => qc.invalidateQueries({ queryKey: ['admin-settings'] }));
  const changed = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'purgeEnabled' ? x : Number(x)]).filter(([k, x]) => x !== r[k as string]));
  const KEY: Record<string, string> = { notificationDays: 'notifications', aiUsageDays: 'aiUsage', jobDays: 'jobs', tutorDays: 'tutorConversations', auditDays: 'auditLogs' };
  return <Box id="retention" title="Data retention">
    <p className="text-sm text-slate-600">A daily job (02:30 UTC) permanently deletes records older than these periods. The audit log is kept for at least 365 days. Each run is itself recorded in the audit log.</p>
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); s.save('/api/admin/settings', { retention: changed }); }}>
      <fieldset disabled={!edit} className="grid gap-3 sm:grid-cols-2">{RET.map(([k, l, min, max]) => <Input key={k} label={`${l} (days)`} type="number" min={min} max={max} hint={`${min}–${max}. Due for deletion now: ${d.retention[KEY[k]]?.due ?? 0}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />)}
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1 h-4 w-4" checked={v.purgeEnabled} onChange={(e) => setV({ ...v, purgeEnabled: e.target.checked })} />Run the daily purge</label></fieldset>
      <SaveRow s={s} edit={edit} dirty={Object.keys(changed).length > 0} /></form>
    {edit && <div className="flex flex-wrap items-center gap-3 border-t pt-3"><Button variant="ghost" loading={run.m.isPending} onClick={() => run.save('/api/admin/settings/retention/run', {}, 'post')}>Run purge now</Button>
      {run.saved && <span role="status" className="text-sm text-emerald-800">Purge finished.</span>}{run.m.error && <Alert>{(run.m.error as Error).message}</Alert>}{run.dialog}</div>}
  </Box>;
}
