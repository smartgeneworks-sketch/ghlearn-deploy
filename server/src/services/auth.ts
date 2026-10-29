import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { Response } from 'express';
import type { PublicUser, Role } from '@ghlearn/shared';
import { config } from '../config.js';
import { settingsNow } from './platformSettings.js';
import { RefreshToken, StudentProfile, User } from '../models/index.js';

export const hashPassword = (p: string) => bcrypt.hash(p, 12);
export const verifyPassword = (p: string, h: string) => bcrypt.compare(p, h);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** sid = refresh-token family, so one session can be revoked on its own (spec §7). */
export interface AccessClaims { sub: string; roles: Role[]; schoolId?: string; sid?: string }
/** Lifetimes come from the §20 session settings (accessMinutes, sessionDays). */
export const accessTtlSec = () => settingsNow().sessions.accessMinutes * 60;
export const sessionMs = () => settingsNow().sessions.sessionDays * 864e5;
export const signAccess = (c: AccessClaims) => jwt.sign(c, config.JWT_ACCESS_SECRET, { expiresIn: accessTtlSec(), issuer: 'ghlearn' });
export const verifyAccess = (t: string) => jwt.verify(t, config.JWT_ACCESS_SECRET, { issuer: 'ghlearn' }) as AccessClaims;

export async function issueRefresh(userId: string, meta: { ua?: string; ip?: string }, family: string = crypto.randomUUID(), lastActiveAt: Date = new Date()) {
  const raw = crypto.randomBytes(48).toString('base64url');
  await RefreshToken.create({ userId, tokenHash: sha(raw), family, expiresAt: new Date(Date.now() + sessionMs()), userAgent: meta.ua, ip: meta.ip, lastActiveAt });
  return raw;
}
/** Rotates a refresh token. Reuse of a revoked token revokes the entire family (theft detection). */
/** The live refresh-token row for a raw token (no rotation), for checks before rotating. */
export const peekRefresh = (raw: string) => RefreshToken.findOne({ tokenHash: sha(raw), revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
export async function rotateRefresh(raw: string, meta: { ua?: string; ip?: string }) {
  const doc = await RefreshToken.findOne({ tokenHash: sha(raw) });
  if (!doc || doc.expiresAt < new Date()) return null;
  if (doc.revokedAt) { await RefreshToken.updateMany({ family: doc.family }, { revokedAt: new Date() }); return null; }
  const next = await issueRefresh(String(doc.userId), meta, doc.family, doc.lastActiveAt ?? doc.createdAt ?? new Date());
  doc.revokedAt = new Date(); doc.replacedBy = sha(next); await doc.save();
  return { userId: String(doc.userId), token: next, family: doc.family };
}
export const revokeRefresh = (raw: string) => RefreshToken.updateOne({ tokenHash: sha(raw) }, { revokedAt: new Date() });
/** Revokes every refresh token and (via User.sessionsRevokedAt, checked in authenticate) every access token issued before now. */
/** Revokes one session (a refresh-token family) of `userId`. Its access token is refused at once via User.revokedSessions. */
export async function revokeSession(userId: string, family: string) {
  const r = await RefreshToken.updateMany({ userId, family, revokedAt: null }, { revokedAt: new Date() });
  const dayAgo = new Date(Date.now() - 864e5);
  await User.updateOne({ _id: userId }, { $pull: { revokedSessions: { at: { $lt: dayAgo } } } });
  await User.updateOne({ _id: userId }, { $push: { revokedSessions: { sid: family, at: new Date() } } });
  return r.modifiedCount;
}
/** Active sessions: one per refresh-token family whose latest token is unrevoked and unexpired. */
export async function listSessions(userId: string) {
  const rows = await RefreshToken.aggregate([
    { $match: { userId: new (await import('mongoose')).default.Types.ObjectId(userId) } }, { $sort: { createdAt: 1 } },
    { $group: { _id: '$family', startedAt: { $first: '$createdAt' }, lastUsedAt: { $last: '$createdAt' }, revokedAt: { $last: '$revokedAt' }, expiresAt: { $last: '$expiresAt' }, userAgent: { $last: '$userAgent' }, ip: { $last: '$ip' } } },
    { $match: { revokedAt: null, expiresAt: { $gt: new Date() } } }, { $sort: { lastUsedAt: -1 } }, { $limit: 50 }]);
  return rows.map((r) => ({ id: r._id as string, startedAt: r.startedAt, lastUsedAt: r.lastUsedAt, expiresAt: r.expiresAt, userAgent: r.userAgent ?? null, ip: r.ip ?? null }));
}
/** Server-generated temporary password meeting the policy (letters + digits, 14 chars, no look-alikes). Never stored or logged. */
export function temporaryPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', digits = '23456789', all = letters + digits;
  const pick = (set: string) => set[crypto.randomInt(set.length)];
  const chars = [pick(letters), pick(letters), pick(digits), pick(digits), ...Array.from({ length: 10 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}
export async function revokeAllForUser(userId: string) {
  const now = new Date();
  await Promise.all([RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: now }), User.updateOne({ _id: userId }, { sessionsRevokedAt: now })]);
}

const base = () => ({ httpOnly: true, secure: config.cookieSecure, sameSite: config.COOKIE_SAMESITE, ...(config.cookieDomain ? { domain: config.cookieDomain } : {}) });
export function setAuthCookies(res: Response, access: string, refresh: string) {
  res.cookie('gl_at', access, { ...base(), path: '/', maxAge: accessTtlSec() * 1000 });
  res.cookie('gl_rt', refresh, { ...base(), path: '/api/auth', maxAge: sessionMs() });
}
export function clearAuthCookies(res: Response) { res.clearCookie('gl_at', { ...base(), path: '/' }); res.clearCookie('gl_rt', { ...base(), path: '/api/auth' }); }

export async function toPublicUser(u: any): Promise<PublicUser> {
  const onboarded = u.roles.includes('student') ? !!(await StudentProfile.exists({ userId: u._id })) : true;
  return { id: String(u._id), email: u.email, fullName: u.fullName, roles: u.roles, schoolId: u.schoolId ? String(u.schoolId) : undefined, onboarded, isSample: u.isSample, ...(u.mustChangePassword ? { mustChangePassword: true } : {}) };
}
