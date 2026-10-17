import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { changePasswordSchema, forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, PASSWORD_HINT, type PublicUser } from '@ghlearn/shared';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Card, Input, Spinner } from '../components/ui';
import { Brand, usePlatform, type PublicSettings } from '../lib/platform';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
const Shell = ({ title, children }: { title: string; children: React.ReactNode }) =>
  <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-brand-600 p-4"><Card className="w-full max-w-md">
    <h1 className="mb-1 text-2xl font-bold text-brand-900"><Brand /></h1><h2 className="mb-4 text-lg">{title}</h2>{children}</Card></div>;

export function LoginPage() {
  const { setUser } = useAuth(); const nav = useNavigate(); const p = usePlatform();
  const f = useForm({ resolver: zodResolver(loginSchema) });
  const m = useMutation({ mutationFn: (v: unknown) => post<{ user: PublicUser }>('/api/auth/login', v), onSuccess: (r) => { setUser(r.user); nav('/'); } });
  return <Shell title="Sign in"><form noValidate onSubmit={f.handleSubmit((v) => m.mutate(v))} className="space-y-3">
    {m.error && <Alert>{m.error.message}</Alert>}
    <Input label="Email" type="email" autoComplete="email" {...f.register('email')} error={f.formState.errors.email?.message} />
    <Input label="Password" type="password" autoComplete="current-password" {...f.register('password')} error={f.formState.errors.password?.message} />
    <p className="text-right text-sm"><Link className="text-brand-700 underline" to="/forgot-password">Forgot password?</Link></p>
    <Button type="submit" loading={m.isPending} className="w-full">Sign in</Button>
    {p.features.selfRegistration && <p className="text-center text-sm">New student? <Link className="text-brand-700 underline" to="/register">Create an account</Link></p>}
    <LegalLinks />
  </form></Shell>;
}

export function RegisterPage() {
  const { setUser } = useAuth(); const nav = useNavigate(); const p = usePlatform();
  const f = useForm({ resolver: zodResolver(registerSchema), defaultValues: { acceptTerms: undefined as any } });
  const m = useMutation({ mutationFn: (v: unknown) => post<{ user: PublicUser }>('/api/auth/register', v), onSuccess: (r) => { setUser(r.user); nav('/onboarding'); } });
  const e = f.formState.errors;
  if (!p.features.selfRegistration) return <Shell title="Create your student account"><Alert tone="info">Self-registration is switched off. Ask your school for an account.</Alert><p className="mt-3 text-center text-sm"><Link className="text-brand-700 underline" to="/login">Sign in</Link></p></Shell>;
  return <Shell title="Create your student account"><form noValidate onSubmit={f.handleSubmit((v) => m.mutate(v))} className="space-y-3">
    {m.error && <Alert>{m.error.message}</Alert>}
    <Input label="Full name" autoComplete="name" {...f.register('fullName')} error={e.fullName?.message} />
    <Input label="Email" type="email" autoComplete="email" {...f.register('email')} error={e.email?.message} />
    <Input label="Password" type="password" autoComplete="new-password" hint="10+ characters with a letter and a number" {...f.register('password')} error={e.password?.message} />
    <Input label="Parent/guardian email (optional)" type="email" {...f.register('guardianEmail')} error={e.guardianEmail?.message} />
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" {...f.register('acceptTerms', { setValueAs: (v) => v === true || v === 'on' || undefined })} className="mt-1" />
      <span>I agree to the {p.legal.terms ? <Link className="text-brand-700 underline" to="/terms" target="_blank">terms of use</Link> : 'terms of use'} and {p.legal.privacy ? <Link className="text-brand-700 underline" to="/privacy" target="_blank">privacy notice</Link> : 'privacy notice'}.</span></label>
    {e.acceptTerms && <p role="alert" className="text-sm text-red-700">{e.acceptTerms.message}</p>}
    <Button type="submit" loading={m.isPending} className="w-full">Create account</Button>
    <p className="text-center text-sm">Already registered? <Link className="text-brand-700 underline" to="/login">Sign in</Link></p>
  </form></Shell>;
}

/**
 * Forgot password. The server says which channels exist (public settings): a link by email, a code by SMS to a verified
 * phone, or neither. Without either the page says so plainly and points to staff-assisted reset; it never pretends a
 * message was sent. The confirmation is the same whether or not an account matched.
 */
export function ForgotPasswordPage() {
  const q = useQuery({ queryKey: ['platform'], queryFn: () => api<PublicSettings>('/api/settings/public'), staleTime: 60_000, retry: 1 });
  const [id, setId] = useState(''); const [err, setErr] = useState<string | null>(null);
  const m = useMutation({ mutationFn: (identifier: string) => post<{ ok: boolean; channel?: 'sms'; emailAvailable: boolean; smsAvailable?: boolean; message: string }>('/api/auth/forgot-password', { identifier }) });
  const codeLink = <p className="text-sm">Have a reset code from your teacher or school administrator? <Link className="text-brand-700 underline" to="/reset-password">Enter your reset code</Link></p>;
  const back = <p className="text-center text-sm"><Link className="text-brand-700 underline" to="/login">Back to sign in</Link></p>;
  if (q.isLoading) return <Shell title="Forgot your password?"><Spinner /></Shell>;
  const emailOn = !!q.data?.passwordReset?.email; const smsOn = !!q.data?.passwordReset?.sms;
  const unavailable = m.data && (m.data.channel === 'sms' ? m.data.smsAvailable === false : m.data.emailAvailable === false);
  if (!emailOn && !smsOn) return <Shell title="Forgot your password?"><div className="space-y-3">
    <Alert tone="info"><strong>Password reset by email is not available yet.</strong> Ask your teacher or school administrator. They can give you a one-time reset code (or a temporary password) from GH Learn, and you then choose your own new password.</Alert>
    {m.data && <p className="sr-only" role="status">{m.data.message}</p>}
    {codeLink}{back}</div></Shell>;
  if (m.isSuccess && !unavailable && m.data.channel === 'sms') return <Shell title="Check your phone"><div className="space-y-3"><Alert tone="success">{m.data.message}</Alert>
    <Link to="/reset-password" state={{ phone: id }} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white hover:bg-brand-800">Enter the code</Link>{back}</div></Shell>;
  if (m.isSuccess && !unavailable) return <Shell title="Check your email"><div className="space-y-3"><Alert tone="success">{m.data.message}</Alert>{codeLink}{back}</div></Shell>;
  const label = emailOn && smsOn ? 'Email or phone number' : smsOn ? 'Phone number' : 'Email';
  const looksPhone = !id.includes('@') && /\d/.test(id);
  const submit = (e: React.FormEvent) => { e.preventDefault(); setErr(null); const r = forgotPasswordSchema.safeParse({ identifier: id }); if (!r.success) return setErr(r.error.issues[0].message); m.mutate(id.trim()); };
  return <Shell title="Forgot your password?"><form noValidate onSubmit={submit} className="space-y-3">
    <p className="text-sm">{emailOn && smsOn ? 'Enter the email address you sign in with, or the phone number you verified on GH Learn. We send a link by email, or a reset code by SMS. Either works once and expires in 30 minutes.'
      : smsOn ? 'Enter the phone number you verified on GH Learn. If it belongs to an account, we text it a reset code. The code works once and expires in 30 minutes. (Reset by email is not available yet.)'
        : 'Enter the email address you sign in with. If it belongs to an account, we email a link to choose a new password. The link works once and expires in 30 minutes.'}</p>
    {(err || m.error) && <Alert>{err ?? m.error!.message}</Alert>}
    {unavailable && <Alert tone="info">{m.data!.message}</Alert>}
    <Input label={label} type={smsOn && !emailOn ? 'tel' : emailOn && !smsOn ? 'email' : 'text'} inputMode={smsOn && !emailOn ? 'tel' : undefined} autoComplete={smsOn && !emailOn ? 'tel' : 'username'}
      hint={smsOn ? 'Phone numbers: Ghana mobile, e.g. 024 123 4567 or +233 24 123 4567' : undefined} value={id} onChange={(e) => setId(e.target.value)} />
    <Button type="submit" loading={m.isPending} className="w-full">{smsOn && (looksPhone || !emailOn) ? 'Send reset code' : 'Send reset link'}</Button>
    {codeLink}{back}
  </form></Shell>;
}

/**
 * Completes a reset with the emailed/staff link (?token=) or, without a link, the account email (or verified phone) plus
 * the 12-character code from staff or from the SMS. The token is moved out of the address bar at once so it is not kept in
 * history or sent as a referrer.
 */
export function ResetPasswordPage() {
  const [sp] = useSearchParams(); const [token] = useState(() => sp.get('token') ?? ''); const loc = useLocation(); const p = usePlatform();
  const smsOn = !!p.passwordReset?.sms; const fromSms = (loc.state as { phone?: string } | null)?.phone ?? '';
  useEffect(() => { if (sp.get('token')) window.history.replaceState(null, '', '/reset-password'); }, [sp]);
  const check = useQuery({ queryKey: ['reset-check', token], enabled: !!token, retry: false, gcTime: 0, queryFn: () => post<{ valid: boolean; expiresAt?: string; message?: string }>('/api/auth/reset-password/check', { token }) });
  const [f, setF] = useState({ email: fromSms, code: '', newPassword: '', confirm: '' }); const [err, setErr] = useState<string | null>(null);
  const isPhone = !f.email.includes('@') && /\d/.test(f.email);
  const body = () => (token ? { token, newPassword: f.newPassword } : isPhone ? { phone: f.email.trim(), code: f.code, newPassword: f.newPassword } : { email: f.email, code: f.code, newPassword: f.newPassword });
  const m = useMutation({ mutationFn: () => post<{ ok: boolean }>('/api/auth/reset-password', body()) });
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (f.newPassword !== f.confirm) return setErr('The new passwords do not match.');
    const r = resetPasswordSchema.safeParse(body()); if (!r.success) return setErr(r.error.issues[0].message);
    m.mutate();
  };
  if (m.isSuccess) return <Shell title="Password changed"><div className="space-y-3"><Alert tone="success">Your password was changed and you were signed out everywhere. Sign in with your new password.</Alert>
    <Link to="/login" className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white hover:bg-brand-800">Sign in</Link></div></Shell>;
  if (token && check.isLoading) return <Shell title="Choose a new password"><Spinner /></Shell>;
  if (token && !check.data?.valid) return <Shell title="This link does not work"><div className="space-y-3"><Alert>{check.data?.message ?? (check.error as Error | null)?.message ?? 'This reset link is not valid.'}</Alert>
    <p className="text-sm"><Link className="text-brand-700 underline" to="/forgot-password">Ask for a new link</Link> or <Link className="text-brand-700 underline" to="/reset-password" reloadDocument>enter a reset code</Link>.</p></div></Shell>;
  return <Shell title={token ? 'Choose a new password' : 'Reset with a code'}><form noValidate onSubmit={submit} className="space-y-3">
    {!token && <p className="text-sm">{fromSms ? 'Enter the 12-character code we texted to your phone.' : smsOn ? 'Enter your email (or the phone number the code was texted to) and the 12-character reset code from SMS or from your teacher or school administrator.' : 'Enter your email and the 12-character reset code from your teacher or school administrator.'}</p>}
    {(err || m.error) && <Alert>{err ?? m.error!.message}</Alert>}
    {!token && <><Input label={smsOn || fromSms ? 'Email or phone number' : 'Email'} type={smsOn || fromSms ? 'text' : 'email'} autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <Input label="Reset code" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} placeholder="ABCD-EFGH-JKLM" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></>}
    <Input label="New password" type="password" autoComplete="new-password" hint={PASSWORD_HINT} value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
    <Input label="Confirm new password" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
    <Button type="submit" loading={m.isPending} className="w-full">Set new password</Button>
    <p className="text-center text-sm"><Link className="text-brand-700 underline" to="/login">Back to sign in</Link></p>
  </form></Shell>;
}

/** Forced password change for admin-created accounts and administrator resets (spec §7). Shown before anything else. */
export function ChangePasswordPage() {
  const { user, setUser, logout } = useAuth(); const nav = useNavigate();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' }); const [err, setErr] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => post<{ user: PublicUser }>('/api/auth/change-password', { currentPassword: f.currentPassword, newPassword: f.newPassword }), onSuccess: (r) => { setUser(r.user); nav('/', { replace: true }); } });
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (f.newPassword !== f.confirm) return setErr('The new passwords do not match.');
    const r = changePasswordSchema.safeParse({ currentPassword: f.currentPassword, newPassword: f.newPassword }); if (!r.success) return setErr(r.error.issues[0].message);
    m.mutate();
  };
  return <Shell title="Choose a new password"><form noValidate onSubmit={submit} className="space-y-3">
    <Alert tone="info">{user?.fullName ? `${user.fullName}, your` : 'Your'} password was set by staff (an administrator or your teacher). Choose your own password to continue.</Alert>
    {(err || m.error) && <Alert>{err ?? m.error!.message}</Alert>}
    <Input label="Temporary password" type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
    <Input label="New password" type="password" autoComplete="new-password" hint="At least 10 characters with a letter and a number." value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
    <Input label="Confirm new password" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
    <Button type="submit" loading={m.isPending} className="w-full">Save password and continue</Button>
    <Button variant="ghost" className="w-full" onClick={() => logout().then(() => nav('/login'))}>Sign out</Button>
  </form></Shell>;
}

function LegalLinks() {
  const p = usePlatform(); if (!p.legal.terms && !p.legal.privacy) return null;
  return <p className="flex justify-center gap-4 text-xs text-slate-600">{p.legal.terms && <Link className="underline" to="/terms">Terms of use</Link>}{p.legal.privacy && <Link className="underline" to="/privacy">Privacy notice</Link>}</p>;
}
/** Public terms of use and privacy notice (§20), edited in System settings. */
export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const q = useQuery({ queryKey: ['legal', kind], queryFn: () => api<{ text: string; version: number; updatedAt: string | null; appName: string }>(`/api/settings/legal/${kind}`) });
  const title = kind === 'terms' ? 'Terms of use' : 'Privacy notice';
  return <main id="main" className="mx-auto max-w-3xl space-y-4 px-4 py-8">
    <Link to="/" className="text-sm text-brand-700 underline">← Back</Link>
    <h1 className="text-2xl font-bold">{q.data ? `${q.data.appName}: ${title}` : title}</h1>
    {q.isLoading ? <Spinner /> : q.error ? <Alert>{q.error.message}</Alert> : !q.data!.text.trim() ? <Alert tone="info">This text has not been published yet.</Alert>
      : <><p className="text-sm text-slate-600">Version {q.data!.version}{q.data!.updatedAt ? `, updated ${new Date(q.data!.updatedAt).toLocaleDateString()}` : ''}</p>
        <div className="space-y-3">{q.data!.text.split(/\n{2,}/).map((para, i) => <p key={i} className="whitespace-pre-wrap leading-relaxed">{para}</p>)}</div></>}
  </main>;
}
