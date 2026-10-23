import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { teacherApplicationSchema, PHONE_HINT } from '@ghlearn/shared';
import { api, post } from '../lib/api';
import { usePlatform } from '../lib/platform';
import { Alert, Button, Input, Select, Spinner } from '../components/ui';
import { Shell } from './Auth';

type Options = { regions: string[]; levels: string[]; subjects: { id: string; name: string; level: string }[]; schools: { id: string; name: string; region: string | null }[] };
const NOT_LISTED = '__other';

/** Public teacher application (no password): an administrator reviews it, then the teacher gets a set-password link by email. */
export function TeacherApplyPage() {
  const p = usePlatform();
  const opts = useQuery({ queryKey: ['teacher-apply-options'], queryFn: () => api<Options>('/api/public/teacher-applications/options') });
  const [f, setF] = useState({ fullName: '', email: '', phone: '', region: '', school: '', schoolName: '', staffId: '', ntcNumber: '', note: '', website: '' });
  const [subjects, setSubjects] = useState<string[]>([]); const [levels, setLevels] = useState<string[]>([]); const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [done, setDone] = useState<string | null>(null); const [fail, setFail] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggle = (list: string[], v: string, put: (x: string[]) => void) => put(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const schools = useMemo(() => (opts.data?.schools ?? []).filter((s) => !f.region || s.region === f.region), [opts.data, f.region]);
  const byLevel = useMemo(() => { const m = new Map<string, Options['subjects']>(); for (const s of opts.data?.subjects ?? []) m.set(s.level || 'Other', [...(m.get(s.level || 'Other') ?? []), s]); return [...m.entries()]; }, [opts.data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setFail(null);
    const other = f.school === NOT_LISTED;
    const body = { fullName: f.fullName, email: f.email, phone: f.phone, region: f.region, schoolId: other ? '' : f.school, schoolName: other ? f.schoolName : '',
      subjectIds: subjects, levels, staffId: f.staffId, ntcNumber: f.ntcNumber, note: f.note, consent: consent as true, ...(f.website ? { website: f.website } : {}) };
    const r = teacherApplicationSchema.safeParse(body);
    if (!r.success) {
      const m: Record<string, string> = {}; for (const i of r.error.issues) m[String(i.path[0] ?? 'form')] ??= i.message;
      if (m.schoolName && !other) { m.school = f.school ? m.schoolName : 'Choose your school, or "My school is not listed"'; delete m.schoolName; }
      setErrors(m); document.getElementById(`ta-${Object.keys(m)[0]}`)?.focus(); return;
    }
    setErrors({}); setBusy(true);
    try { setDone((await post<{ message: string }>('/api/public/teacher-applications', body)).message); } catch (x: any) { setFail(x?.message ?? 'Your application could not be sent. Please try again.'); } finally { setBusy(false); }
  };
  if (done) return <Shell title="Application received"><div className="space-y-3"><Alert tone="success">{done}</Alert>
    <p className="text-sm">What happens next: an administrator checks your details. When your account is approved we email you a link to choose your password. The link works for 72 hours.</p>
    <p className="text-center text-sm"><Link className="text-brand-700 underline" to="/">Back to the home page</Link></p></div></Shell>;
  if (opts.isLoading) return <Shell title="Apply for a teacher account"><Spinner /></Shell>;
  if (opts.error) return <Shell title="Apply for a teacher account"><Alert>{(opts.error as Error).message}</Alert></Shell>;
  const o = opts.data!;
  return <Shell title="Apply for a teacher account"><form noValidate onSubmit={submit} className="space-y-3" aria-describedby="ta-intro">
    <p id="ta-intro" className="text-sm text-slate-600">No password is needed now. After an administrator approves your application, we email you a link to choose one.</p>
    {fail && <Alert>{fail}</Alert>}
    <Input id="ta-fullName" label="Full name" autoComplete="name" value={f.fullName} onChange={set('fullName')} error={errors.fullName} />
    <Input id="ta-email" label="Email" type="email" autoComplete="email" value={f.email} onChange={set('email')} error={errors.email} hint="We send your sign-in details here." />
    <Input id="ta-phone" label="Mobile number (optional)" type="tel" inputMode="tel" autoComplete="tel" placeholder="024 123 4567" value={f.phone} onChange={set('phone')} error={errors.phone} hint={PHONE_HINT} />
    <Select id="ta-region" label="Region" value={f.region} onChange={(e) => { const region = e.target.value; const any = (opts.data?.schools ?? []).some((s) => s.region === region); setF((x) => ({ ...x, region, school: region && !any ? NOT_LISTED : '' })); }} error={errors.region}>
      <option value="">Choose…</option>{o.regions.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
    <Select id="ta-school" label="School" value={f.school} onChange={set('school')} error={errors.school}>
      <option value="">{f.region ? 'Choose…' : 'Choose your region first, or pick below'}</option>
      {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}<option value={NOT_LISTED}>My school is not listed</option></Select>
    {f.school === NOT_LISTED && <Input id="ta-schoolName" label="School name" value={f.schoolName} onChange={set('schoolName')} error={errors.schoolName} hint={schools.length ? 'Type the full name. An administrator links it to your school.' : 'No schools are listed for this region yet. Type the full name; an administrator links it to your school.'} />}
    <fieldset id="ta-subjectIds" tabIndex={-1} aria-describedby={errors.subjectIds ? 'ta-subjects-err' : undefined} className="rounded-lg border border-slate-300 p-3">
      <legend className="px-1 text-sm font-medium">Subjects you teach</legend>
      <div className="max-h-56 space-y-2 overflow-y-auto">{byLevel.map(([lv, list]) => <div key={lv}><p className="text-xs font-semibold uppercase text-slate-500">{lv}</p>
        <div className="grid gap-1 sm:grid-cols-2">{list.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={subjects.includes(s.id)} onChange={() => toggle(subjects, s.id, setSubjects)} />{s.name}</label>)}</div></div>)}</div>
      {errors.subjectIds && <p id="ta-subjects-err" role="alert" className="mt-1 text-sm text-red-700">{errors.subjectIds}</p>}
    </fieldset>
    <fieldset id="ta-levels" tabIndex={-1} aria-describedby={errors.levels ? 'ta-levels-err' : undefined} className="rounded-lg border border-slate-300 p-3">
      <legend className="px-1 text-sm font-medium">Forms you teach</legend>
      <div className="grid grid-cols-3 gap-1">{o.levels.map((l) => <label key={l} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={levels.includes(l)} onChange={() => toggle(levels, l, setLevels)} />{l}</label>)}</div>
      {errors.levels && <p id="ta-levels-err" role="alert" className="mt-1 text-sm text-red-700">{errors.levels}</p>}
    </fieldset>
    <div className="grid gap-3 sm:grid-cols-2">
      <Input id="ta-staffId" label="Staff ID (optional)" value={f.staffId} onChange={set('staffId')} error={errors.staffId} />
      <Input id="ta-ntcNumber" label="Teacher licence (NTC) number (optional)" value={f.ntcNumber} onChange={set('ntcNumber')} error={errors.ntcNumber} />
    </div>
    <label className="block text-sm"><span className="mb-1 block font-medium">Note for the reviewer (optional)</span>
      <textarea id="ta-note" className="w-full rounded-lg border border-slate-300 px-3 py-2" rows={3} maxLength={500} value={f.note} onChange={set('note')} /></label>
    <div className="hidden" aria-hidden><label htmlFor="ta-website">Leave this empty</label><input id="ta-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></div>
    <label className="flex items-start gap-2 text-sm"><input id="ta-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
      <span>I confirm these details are correct, and I agree that {p.branding.appName} and my school may check them. I accept the {p.legal.terms ? <Link className="text-brand-700 underline" to="/terms" target="_blank">terms of use</Link> : 'terms of use'} and {p.legal.privacy ? <Link className="text-brand-700 underline" to="/privacy" target="_blank">privacy notice</Link> : 'privacy notice'}.</span></label>
    {errors.consent && <p role="alert" className="text-sm text-red-700">{errors.consent}</p>}
    <Button type="submit" loading={busy} className="w-full">Send application</Button>
    <p className="text-center text-sm">Already have an account? <Link className="text-brand-700 underline" to="/login">Sign in</Link></p>
  </form></Shell>;
}
