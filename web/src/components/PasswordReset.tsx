import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { changePasswordSchema, PASSWORD_HINT } from '@ghlearn/shared';
import { post } from '../lib/api';
import { Alert, Button, Card, Input } from './ui';
import { ConfirmButton } from './ConfirmDialog';

export type StaffResetResult =
  | { mode: 'link'; link: string; code: string; expiresAt: string }
  | { mode: 'temporary'; temporaryPassword: string };

function CopyValue({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return <div className="space-y-1"><p className="font-medium">{label}</p><div className="flex flex-wrap items-center gap-2">
    <code aria-label={label} className={`break-all rounded bg-white px-2 py-1 ${mono ? 'font-mono text-base' : 'text-xs'}`}>{value}</code>
    <Button variant="ghost" className="px-2 py-1 text-xs" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => navigator.clipboard?.writeText(value).then(() => setCopied(true))}><Copy className="h-3 w-3" aria-hidden />{copied ? 'Copied' : 'Copy'}</Button></div></div>;
}
/** Shows a staff-issued reset secret once. Nothing is kept client-side after "Done". */
export function StaffResetSecret({ r, who, onDone }: { r: StaffResetResult; who: string; onDone: () => void }) {
  return <div role="status" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
    {r.mode === 'link' ? <>
      <p><strong>One-time reset for {who}.</strong> Shown only now. Hand it over in person. It works once and expires {new Date(r.expiresAt).toLocaleString()}. {who} chooses their own password.</p>
      <CopyValue label="Reset code" value={r.code} />
      <p>Give them the code and tell them to open <strong>Forgot password? → I have a reset code</strong> on the sign-in page, then enter their email and this code. On their own device they can open the link instead:</p>
      <CopyValue label="Reset link" value={r.link} mono={false} />
    </> : <>
      <p><strong>Temporary password for {who}.</strong> Shown only now. Give it to them in person. Every session was signed out, and they must choose a new password when they sign in.</p>
      <CopyValue label="Temporary password" value={r.temporaryPassword} />
    </>}
    <Button className="px-2 py-1 text-xs" onClick={onDone}>Done, hide it</Button></div>;
}
/** Staff actions: one-time link + code (preferred), or a temporary password with forced change. */
export function StaffResetActions({ who, linkUrl, tempUrl, tempBody, linkBody, onDone }: { who: string; linkUrl: string; tempUrl: string; linkBody?: unknown; tempBody?: unknown; onDone?: () => void }) {
  const [r, setR] = useState<StaffResetResult | null>(null);
  if (r) return <StaffResetSecret r={r} who={who} onDone={() => setR(null)} />;
  return <div className="flex flex-wrap gap-2">
    <ConfirmButton label="Create reset link" tone="primary" variant="primary" className="px-3 py-1 text-sm" title={`Create a one-time reset link for ${who}?`}
      body={<><p>You get a link and a 12-character code, shown once, valid for 24 hours. {who} uses either one to choose a new password. Their current password keeps working until then.</p><p>Earlier reset links for this account stop working. They are notified in the app, and this is recorded in the audit log.</p></>}
      onConfirm={() => post<StaffResetResult>(linkUrl, linkBody ?? {}).then((x) => { setR(x); onDone?.(); })} />
    <ConfirmButton label="Set temporary password" className="px-3 py-1 text-sm" title={`Set a temporary password for ${who}?`}
      body={<><p>A temporary password is generated and shown once. Their current password stops working, every session is signed out, and they must choose a new password when they next sign in.</p><p>This is recorded in the audit log.</p></>}
      onConfirm={() => post<StaffResetResult>(tempUrl, tempBody ?? {}).then((x) => { setR({ mode: 'temporary', temporaryPassword: (x as any).temporaryPassword }); onDone?.(); })} />
  </div>;
}
/** Signed-in password change (current + new + confirm). The server signs out every other session. */
export function ChangePasswordCard() {
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' }); const [err, setErr] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => post('/api/auth/change-password', { currentPassword: f.currentPassword, newPassword: f.newPassword }), onSuccess: () => setF({ currentPassword: '', newPassword: '', confirm: '' }) });
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); m.reset();
    if (f.newPassword !== f.confirm) return setErr('The new passwords do not match.');
    const r = changePasswordSchema.safeParse({ currentPassword: f.currentPassword, newPassword: f.newPassword }); if (!r.success) return setErr(r.error.issues[0].message);
    m.mutate();
  };
  return <Card><h2 className="mb-3 font-semibold">Change password</h2><form noValidate onSubmit={submit} className="grid max-w-md gap-3">
    <Input label="Current password" type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
    <Input label="New password" type="password" autoComplete="new-password" hint={PASSWORD_HINT} value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
    <Input label="Confirm new password" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
    {(err || m.error) && <Alert>{err ?? m.error!.message}</Alert>}{m.isSuccess && <Alert tone="success">Password changed. Your other sessions were signed out.</Alert>}
    <div><Button type="submit" loading={m.isPending}>Change password</Button></div></form></Card>;
}
