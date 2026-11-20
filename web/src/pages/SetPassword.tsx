import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { setPasswordSchema, PASSWORD_HINT, type PublicUser } from '@ghlearn/shared';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePlatform } from '../lib/platform';
import { Alert, Button, Input, Spinner } from '../components/ui';
import { Shell } from './Auth';

/**
 * Invitation link (approved teacher, or an account an administrator created): choose a password, then you are signed in.
 * The token is read from the link once and removed from the address bar so it is not kept in history.
 */
export function SetPasswordPage() {
  const [sp] = useSearchParams(); const nav = useNavigate(); const { setUser } = useAuth(); const p = usePlatform();
  const [token] = useState(() => sp.get('token') ?? '');
  useEffect(() => { if (sp.get('token')) window.history.replaceState(null, '', '/set-password'); }, []);
  const check = useQuery({ queryKey: ['set-password-check', token], enabled: token.length >= 40, retry: false, staleTime: Infinity,
    queryFn: () => post<{ valid: boolean; email?: string; fullName?: string; message?: string }>('/api/auth/set-password/check', { token }) });
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState<{ pw?: string; pw2?: string }>({});
  const save = useMutation({ mutationFn: () => post<{ signedIn: boolean; user?: PublicUser }>('/api/auth/set-password', { token, newPassword: pw }),
    onSuccess: (r) => { if (r.signedIn && r.user) { setUser(r.user); nav('/', { replace: true, state: { welcome: true } }); } } });
  const renew = useMutation({ mutationFn: () => post<{ message: string }>('/api/auth/set-password/request-new', { token }) });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = setPasswordSchema.safeParse({ token, newPassword: pw });
    const next: typeof err = {}; if (!r.success) next.pw = r.error.issues.find((i) => i.path[0] === 'newPassword')?.message ?? 'Choose a stronger password'; if (pw !== pw2) next.pw2 = 'The passwords do not match';
    setErr(next); if (Object.keys(next).length) return document.getElementById(next.pw ? 'sp-pw' : 'sp-pw2')?.focus();
    save.mutate();
  };
  const invalid = !token || check.data?.valid === false || (save.error as any)?.code === 'INVITE_INVALID';
  if (token && check.isLoading) return <Shell title="Set your password"><Spinner /></Shell>;
  if (save.data && !save.data.signedIn) return <Shell title="Password saved"><Alert tone="success">Your password is saved. Sign in with your email and new password.</Alert><p className="mt-3 text-center"><Link className="text-brand-700 underline" to="/login">Sign in</Link></p></Shell>;
  if (invalid) return <Shell title="This link no longer works"><div className="space-y-3">
    <Alert tone="info">{token ? 'This link has expired or has already been used. Set-password links work once, for 72 hours.' : 'This page needs the link from your invitation email.'}</Alert>
    {renew.data ? <Alert tone="success">{renew.data.message}</Alert> : token && <Button className="w-full" loading={renew.isPending} onClick={() => renew.mutate()}>Request a new link</Button>}
    {renew.error && <Alert>{(renew.error as Error).message}</Alert>}
    <p className="text-sm">Already chose a password? <Link className="text-brand-700 underline" to="/login">Sign in</Link>. Forgot it? Use <Link className="text-brand-700 underline" to="/forgot-password">Forgot password</Link>.</p>
  </div></Shell>;
  if (check.error) return <Shell title="Set your password"><Alert>{(check.error as Error).message}</Alert></Shell>;
  const first = check.data?.fullName?.split(/\s+/)[0];
  return <Shell title="Set your password"><form noValidate onSubmit={submit} className="space-y-3">
    <p className="text-sm">Welcome to {p.branding.appName}{first ? `, ${first}` : ''}. Choose the password you will use to sign in.</p>
    <p className="text-sm">Your sign-in email: <strong>{check.data?.email}</strong></p>
    {save.error && <Alert>{(save.error as Error).message}</Alert>}
    <input type="email" autoComplete="username" value={check.data?.email ?? ''} readOnly hidden />
    <Input id="sp-pw" label="New password" type="password" autoComplete="new-password" hint={PASSWORD_HINT} value={pw} onChange={(e) => setPw(e.target.value)} error={err.pw} />
    <Input id="sp-pw2" label="Confirm new password" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} error={err.pw2} />
    <Button type="submit" loading={save.isPending} className="w-full">Save password and sign in</Button>
  </form></Shell>;
}
