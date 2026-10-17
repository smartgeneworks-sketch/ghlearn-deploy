import crypto from 'node:crypto';
import { PasswordReset, User } from '../models/index.js';
import { config } from '../config.js';
import type { Request } from 'express';
import { hashPassword, revokeAllForUser, temporaryPassword } from './auth.js';
import { audit } from '../lib/audit.js';
import { conflict } from '../lib/errors.js';
import { notifySecurity } from './eventNotifications.js';
import { normalizeGhPhone } from './phone.js';

/**
 * Password reset grants (spec §7 recovery).
 * - Token: 32 random bytes (base64url, 43 chars), stored only as SHA-256; single use; self-service lives PASSWORD_RESET_MINUTES.
 * - Staff grants add a 12-character code (60 bits, no look-alikes) for typing on another device, redeemed with the account
 *   email; 5 wrong codes void the grant. Staff grants live STAFF_RESET_HOURS.
 * Issuing a new grant voids the user's earlier unused grants of the same kind; a successful reset voids all of them.
 */
export const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
export const TOKEN_BYTES = 32; export const MAX_CODE_ATTEMPTS = 5;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newToken = () => crypto.randomBytes(TOKEN_BYTES).toString('base64url');
export function newCode() { const c = Array.from({ length: 12 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join(''); return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`; }
export const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
const appUrl = () => config.appUrl ?? config.corsOrigins[0] ?? 'http://localhost:5173';
export const resetLink = (token: string) => `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;

export async function issueReset(userId: any, kind: 'self' | 'staff', o: { createdBy?: string; ip?: string; channel?: 'email' | 'sms' } = {}) {
  const now = new Date();
  await PasswordReset.updateMany({ userId, kind, usedAt: null, invalidatedAt: null, expiresAt: { $gt: now } }, { invalidatedAt: now });
  const token = newToken(); const code = kind === 'staff' || o.channel === 'sms' ? newCode() : undefined;
  const ttl = kind === 'self' ? config.PASSWORD_RESET_MINUTES * 60_000 : config.STAFF_RESET_HOURS * 3600_000;
  const expiresAt = new Date(now.getTime() + ttl);
  await PasswordReset.create({ userId, kind, tokenHash: sha256(token), ...(code ? { codeHash: sha256(normCode(code)) } : {}), createdBy: o.createdBy, ip: o.ip, ...(o.channel ? { channel: o.channel } : {}), expiresAt });
  return { token, code, expiresAt, link: resetLink(token) };
}
/** Self-service requests for this user in the last hour (per-account rate limit). */
export const recentSelfRequests = (userId: any) => PasswordReset.countDocuments({ userId, kind: 'self', createdAt: { $gt: new Date(Date.now() - 3600_000) } });

const live = () => ({ usedAt: null, invalidatedAt: null, expiresAt: { $gt: new Date() } });
/** A usable grant for this token, or null (unknown, used, voided or expired all look the same). */
export async function findByToken(token: string) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 100) return null;
  return PasswordReset.findOne({ tokenHash: sha256(token), ...live() }).lean();
}
/**
 * A usable coded grant for (email or verified phone, code): a staff-issued code, or a code sent by SMS to the verified
 * phone. Wrong codes count against the grant; the 5th voids it.
 */
export async function findByCode(who: { email?: string; phone?: string }, code: string) {
  const ph = who.phone ? normalizeGhPhone(who.phone) : null; if (who.phone && !ph) return null;
  const u = ph ? await User.findOne({ phone: ph.local, phoneVerifiedAt: { $type: 'date' } }).select('_id').lean()
    : await User.findOne({ email: String(who.email ?? '').toLowerCase().trim() }).select('_id').lean();
  if (!u) return null;
  const g = await PasswordReset.findOne({ userId: u._id, codeHash: { $exists: true }, ...live() }).select('+codeHash').sort({ createdAt: -1 });
  if (!g?.codeHash) return null;
  if (g.attempts >= MAX_CODE_ATTEMPTS) { await PasswordReset.updateOne({ _id: g._id }, { invalidatedAt: new Date() }); return null; }
  const a = Buffer.from(g.codeHash, 'hex'), b = Buffer.from(sha256(normCode(code)), 'hex');
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return g.toObject();
  const r = await PasswordReset.findOneAndUpdate({ _id: g._id }, { $inc: { attempts: 1 } }, { new: true });
  if (r && r.attempts >= MAX_CODE_ATTEMPTS) await PasswordReset.updateOne({ _id: g._id }, { invalidatedAt: new Date() });
  return null;
}
/**
 * Redeems a grant: claims it atomically (a second use loses the race and gets null), sets the password, clears
 * lockout and any forced change, signs out every session and voids the user's other grants.
 */
export async function redeem(grantId: any, newPassword: string) {
  const g = await PasswordReset.findOneAndUpdate({ _id: grantId, ...live() }, { usedAt: new Date() }, { new: true }).lean(); if (!g) return null;
  const u = await User.findById(g.userId); if (!u || u.status !== 'active') return null;
  u.passwordHash = await hashPassword(newPassword); u.mustChangePassword = false; u.passwordChangedAt = new Date(); u.failedLogins = 0; u.lockedUntil = undefined;
  await u.save(); await revokeAllForUser(String(u._id));
  await PasswordReset.updateMany({ userId: u._id, _id: { $ne: g._id }, usedAt: null, invalidatedAt: null }, { invalidatedAt: new Date() });
  return { user: u, grant: g };
}

/**
 * Staff-assisted reset (no email needed). The caller has already checked scope. mode 'link' issues a one-time link + code
 * (STAFF_RESET_HOURS); mode 'temporary' sets a temporary password with a forced change at next sign-in and signs out every
 * session. Audited; the user is told in-app. The secret is returned once and never stored or logged.
 */
export async function staffReset(req: Request, u: { _id: any; schoolId?: unknown; status?: string | null }, mode: 'link' | 'temporary', via: 'admin' | 'teacher') {
  if (u.status && u.status !== 'active') throw conflict('This account is not active. Reactivate it first.');
  const scope = { entityType: 'user', schoolId: u.schoolId ? String(u.schoolId) : undefined };
  if (mode === 'link') {
    const g = await issueReset(u._id, 'staff', { createdBy: req.auth!.userId, ip: req.ip });
    audit(req, 'user.password.reset_link', String(u._id), { via, delivery: 'shown_once', expiresAt: g.expiresAt }, scope);
    notifySecurity(u._id, 'security.password', 'A password reset link was created for you', `Staff created a one-time reset link for your account. It expires ${g.expiresAt.toUTCString()}. If you did not ask for this, tell your school administrator.`).catch(() => undefined);
    return { mode, link: g.link, code: g.code, expiresAt: g.expiresAt, delivery: 'shown_once' as const };
  }
  const pw = temporaryPassword();
  await User.updateOne({ _id: u._id }, { passwordHash: await hashPassword(pw), mustChangePassword: true, failedLogins: 0, $unset: { lockedUntil: 1 } });
  await revokeAllForUser(String(u._id));
  await PasswordReset.updateMany({ userId: u._id, usedAt: null, invalidatedAt: null }, { invalidatedAt: new Date() });
  audit(req, 'user.password.reset', String(u._id), { via, delivery: 'shown_once' }, scope);
  notifySecurity(u._id, 'security.password', 'Your password was reset by staff', 'You must choose a new password when you next sign in. All your sessions were signed out.').catch(() => undefined);
  return { mode, temporaryPassword: pw, delivery: 'shown_once' as const, mustChangePassword: true };
}
