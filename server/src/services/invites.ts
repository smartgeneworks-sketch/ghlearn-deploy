import { PasswordReset } from '../models/index.js';
import { issueReset, sha256, INVITE_HOURS } from './passwordReset.js';
import { sendMail, emailConfigured } from './mailer.js';
import { sendSms, smsAvailable } from './sms.js';
import { getSettings } from './platformSettings.js';
import { config } from '../config.js';

/**
 * Account invitations: a single-use set-password link (a PasswordReset grant of kind "invite", stored hashed, 72 hours).
 * A new invite voids the earlier unused ones. The link goes only to the account email; an SMS (to a number that is not
 * verified yet) never carries the token, it only points the person to their email.
 */
export const appBase = () => config.appUrl ?? config.corsOrigins[0] ?? 'http://localhost:5173';
const host = () => { try { return new URL(appBase()).host; } catch { return 'GH Learn'; } };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const appName = async () => (await getSettings()).branding.appName || 'GH Learn';

/** Branded, simple HTML email (inline styles only) with a plain-text twin. */
export async function brandedMail(o: { to: string; subject: string; heading: string; paragraphs: string[]; button?: { label: string; url: string }; footer?: string }) {
  const name = await appName();
  const text = [o.heading, '', ...o.paragraphs.flatMap((p) => [p, '']), ...(o.button ? [`${o.button.label}: ${o.button.url}`, ''] : []), o.footer ?? `${name} · ${host()}`].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#14532d;color:#ffffff;padding:18px 24px;font-size:20px;font-weight:bold">${esc(name)}</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:20px">${esc(o.heading)}</h1>
${o.paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(p)}</p>`).join('\n')}
${o.button ? `<p style="margin:20px 0"><a href="${esc(o.button.url)}" style="background:#15803d;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">${esc(o.button.label)}</a></p>
<p style="margin:0 0 12px;font-size:13px;color:#475569">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${esc(o.button.url)}</span></p>` : ''}
</td></tr><tr><td style="padding:14px 24px;background:#f8fafc;font-size:12px;color:#64748b">${esc(o.footer ?? `${name} · ${host()}`)}</td></tr></table></td></tr></table></body></html>`;
  return sendMail({ to: o.to, subject: o.subject, text, html });
}

export type InviteResult = { email: 'sent' | 'failed' | 'not_configured'; sms?: string; expiresAt?: Date };
/**
 * Issues a set-password link and emails it. If the email cannot be sent the grant is voided at once (nobody holds the
 * link). `why` changes the wording: an approved teacher application, or an account an administrator created.
 */
export async function sendInvite(u: { _id: unknown; email: string; fullName: string; phone?: string | null; roles?: string[] }, o: { by?: string; why: 'teacher' | 'account'; schoolName?: string; sms?: boolean }): Promise<InviteResult> {
  if (!emailConfigured()) return { email: 'not_configured' };
  const g = await issueReset(u._id, 'invite', { createdBy: o.by });
  const name = await appName();
  const first = u.fullName.split(/\s+/)[0];
  const r = await brandedMail({ to: u.email,
    subject: o.why === 'teacher' ? `Your ${name} teacher account is approved` : `Your ${name} account is ready`,
    heading: o.why === 'teacher' ? `Welcome to ${name}, ${first}` : `Hello ${first}, your account is ready`,
    paragraphs: [
      o.why === 'teacher' ? `Your application for a teacher account${o.schoolName ? ` at ${o.schoolName}` : ''} has been approved.` : `An administrator created a ${name} account for you.`,
      `Your sign-in email is: ${u.email}`,
      `Choose your password with the button below. The link works once and expires in ${INVITE_HOURS} hours. If it expires, open it anyway and ask for a new one.`,
      'If you did not expect this email, you can ignore it.',
    ], button: { label: 'Set your password', url: g.link } });
  if (r.status !== 'sent') { await PasswordReset.updateOne({ tokenHash: sha256(g.token) }, { invalidatedAt: new Date() }); return { email: r.status }; }
  let sms: string | undefined;
  if (o.sms && u.phone && (await smsAvailable())) {
    sms = (await sendSms({ to: u.phone, kind: 'notification', userId: u._id, ref: 'invite',
      message: `${name}: your ${o.why === 'teacher' ? 'teacher ' : ''}account is approved. We emailed you a link to set your password. Then sign in at ${host()}/login` })).status;
  }
  return { email: 'sent', expiresAt: g.expiresAt, ...(sms ? { sms } : {}) };
}
