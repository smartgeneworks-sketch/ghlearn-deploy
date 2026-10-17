import { notifySecurity } from '../services/eventNotifications.js';
import { notifyRoles } from '../services/notify.js';
import { Router } from 'express';
import crypto from 'node:crypto';
import { schoolBlocked } from '../services/schools.js';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { registerSchema, loginSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from '@ghlearn/shared';
import { PasswordReset } from '../models/index.js';
import { emailConfigured, sendMail } from '../services/mailer.js';
import * as PR from '../services/passwordReset.js';
import { sendSms, smsAvailable } from '../services/sms.js';
import { normalizeGhPhone, maskPhone } from '../services/phone.js';
import { User } from '../models/index.js';
import { config } from '../config.js';
import { AppError, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import * as A from '../services/auth.js';
import { authenticate, maintenanceError } from '../middleware/index.js';
import { getSettings } from '../services/platformSettings.js';
import { hasPermission, type Role } from '@ghlearn/shared';

export const authRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: config.NODE_ENV === 'test' ? 1000 : 20, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_q, _r, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many attempts, try again later')) });
const DUMMY = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO5G4Zz6m4Tz7w0b6i2YVwq8yJm5Qy3a.';
const meta = (req: any) => ({ ua: req.get('user-agent'), ip: req.ip });
async function startSession(req: any, res: any, u: any) {
  const sid = crypto.randomUUID();
  const access = A.signAccess({ sub: String(u._id), roles: u.roles, schoolId: u.schoolId ? String(u.schoolId) : undefined, sid });
  A.setAuthCookies(res, access, await A.issueRefresh(String(u._id), meta(req), sid));
}

authRouter.post('/register', limiter, async (req, res) => {
  const st = await getSettings();
  if (!config.selfRegistration || !st.features.selfRegistration) throw forbidden('Self-registration is disabled');
  if (st.maintenance.enabled) throw maintenanceError(st);
  const b = registerSchema.parse(req.body);
  if (await User.exists({ email: b.email })) throw conflict('An account with this email already exists');
  // Self-registration ALWAYS yields a student; roles are only elevated by admins.
  const u = await User.create({ email: b.email, fullName: b.fullName, passwordHash: await A.hashPassword(b.password), roles: ['student'],
    dateOfBirth: b.dateOfBirth, guardianEmail: b.guardianEmail || undefined, consent: { termsAcceptedAt: new Date() } });
  await startSession(req, res, u);
  req.auth = { userId: String(u._id), roles: ['student'] }; audit(req, 'auth.register', String(u._id));
  res.status(201).json({ user: await A.toPublicUser(u) });
});

authRouter.post('/login', limiter, async (req, res) => {
  const b = loginSchema.parse(req.body);
  const st = await getSettings(); const { lockoutAttempts, lockoutMinutes } = st.sessions;
  const u = await User.findOne({ email: b.email }).select('+passwordHash');
  const ok = await A.verifyPassword(b.password, u?.passwordHash ?? DUMMY); // constant-ish time for unknown users
  const as = u ? { actorId: String(u._id), schoolId: u.schoolId ? String(u.schoolId) : undefined, entityType: 'auth' } : { entityType: 'auth' };
  if (u?.lockedUntil && u.lockedUntil > new Date()) {
    audit(req, 'auth.login.locked', String(u._id), undefined, { ...as, outcome: 'denied' });
    throw new AppError(423, 'LOCKED', 'Account temporarily locked. Try again later.');
  }
  if (!u || !ok) {
    // Unknown accounts are logged without the submitted email (spec §19: no personal data probing trail).
    if (!u) audit(req, 'auth.login.failure', undefined, { reason: 'unknown_account' }, { ...as, outcome: 'failure' });
    else {
      u.failedLogins = (u.failedLogins ?? 0) + 1; const attempt = u.failedLogins; let locked = false;
      if (u.failedLogins >= lockoutAttempts) { u.lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000); u.failedLogins = 0; locked = true; }
      await u.save();
      audit(req, 'auth.login.failure', String(u._id), { reason: 'bad_password', attempt }, { ...as, outcome: 'failure' });
      if (locked) { audit(req, 'auth.lockout', String(u._id), { minutes: lockoutMinutes, attempts: lockoutAttempts }, { ...as, outcome: 'denied' });
        notifySecurity(u._id, 'security.lockout', `Your account was locked for ${lockoutMinutes} minutes`, `There were ${lockoutAttempts} failed sign-in attempts. If this was not you, change your password after signing in.`).catch(() => undefined);
        if (u.roles.some((r) => r !== 'student' && r !== 'parent' && r !== 'teacher' && r !== 'counselor')) notifyRoles(['super_admin'], { type: 'security.lockout', title: `Staff account locked: ${u.fullName}`, body: `Locked for ${lockoutMinutes} minutes after ${lockoutAttempts} failed sign-in attempts.`, link: `/admin/users/${u._id}` }).catch(() => undefined); }
    }
    throw unauthorized('Invalid email or password');
  }
  if (u.status !== 'active') { audit(req, 'auth.login.failure', String(u._id), { reason: 'inactive' }, { ...as, outcome: 'denied' }); throw forbidden('Account is not active'); }
  if (u.schoolId && !u.roles.includes('super_admin') && (await schoolBlocked(String(u.schoolId)))) {
    audit(req, 'auth.login.failure', String(u._id), { reason: 'school_inactive' }, { ...as, outcome: 'denied' }); throw new AppError(403, 'SCHOOL_INACTIVE', 'Your school is not active on the platform. Contact your administrator.');
  }
  // §20 maintenance: only administrators can sign in (the attempt is audited as denied).
  if (st.maintenance.enabled && !hasPermission(u.roles as Role[], 'admin:access')) { audit(req, 'auth.login.failure', String(u._id), { reason: 'maintenance' }, { ...as, outcome: 'denied' }); throw maintenanceError(st); }
  u.failedLogins = 0; u.lockedUntil = undefined; u.lastLoginAt = new Date(); await u.save();
  await startSession(req, res, u);
  audit(req, 'auth.login', String(u._id), undefined, as);
  res.json({ user: await A.toPublicUser(u) });
});

/** Account settings (spec §3B): change own password; every other session is signed out. */
authRouter.post('/change-password', limiter, authenticate, async (req, res) => {
  const b = changePasswordSchema.parse(req.body);
  const u = await User.findById(req.auth!.userId).select('+passwordHash'); if (!u) throw unauthorized();
  if (!(await A.verifyPassword(b.currentPassword, u.passwordHash))) { audit(req, 'auth.password.change', String(u._id), { reason: 'bad_current' }, { outcome: 'failure' }); throw new AppError(422, 'VALIDATION', 'Current password is incorrect'); }
  if (b.currentPassword === b.newPassword) throw new AppError(422, 'VALIDATION', 'Choose a different password');
  const forced = !!u.mustChangePassword;
  u.passwordHash = await A.hashPassword(b.newPassword); u.mustChangePassword = false; u.passwordChangedAt = new Date(); await u.save();
  await A.revokeAllForUser(String(u._id)); await startSession(req, res, u);
  audit(req, 'auth.password.change', String(u._id), forced ? { forced: true } : undefined);
  if (!forced) notifySecurity(u._id, 'security.password', 'Your password was changed', 'Your other sessions were signed out. If this was not you, contact your administrator at once.').catch(() => undefined);
  res.json({ ok: true, user: await A.toPublicUser(u) });
});
/**
 * Password reset (spec §7). Limits: per IP (express-rate-limit) and per account (RESET_LIMITS.accountPerHour self-service
 * requests; further requests are silently dropped). Responses never say whether an account exists.
 */
export const RESET_LIMITS = { forgotPerIp: config.NODE_ENV === 'test' ? 1000 : 5, resetPerIp: config.NODE_ENV === 'test' ? 1000 : 10, accountPerHour: 3 };
const tooMany = (_q: any, _r: any, next: any) => next(new AppError(429, 'RATE_LIMITED', 'Too many attempts, try again later'));
export const resetStores = { forgot: new MemoryStore(), reset: new MemoryStore() };
export const forgotLimiter = rateLimit({ windowMs: 15 * 60_000, store: resetStores.forgot, limit: () => RESET_LIMITS.forgotPerIp, standardHeaders: 'draft-8', legacyHeaders: false, handler: tooMany });
export const resetLimiter = rateLimit({ windowMs: 15 * 60_000, store: resetStores.reset, limit: () => RESET_LIMITS.resetPerIp, standardHeaders: 'draft-8', legacyHeaders: false, handler: tooMany });
/** Background work of the last forgot-password request (tests await it; the response never waits for it). */
export let lastForgotJob: Promise<void> = Promise.resolve();
const NO_EMAIL = 'Password reset by email is not available yet. Ask your teacher or school administrator for a reset link or code; they can create one for you from GH Learn.';
const resetPageHost = () => { try { const u = new URL(config.appUrl ?? config.corsOrigins[0] ?? ''); return `${u.host}/reset-password`; } catch { return 'the GH Learn reset page'; } };
const NO_SMS = 'Password reset by SMS is not available yet. Use your email address, or ask your teacher or school administrator for a reset link or code.';
authRouter.post('/forgot-password', forgotLimiter, async (req, res) => {
  const b = forgotPasswordSchema.parse(req.body); res.set('Cache-Control', 'no-store');
  if (!b.identifier.includes('@')) {
    const ph = normalizeGhPhone(b.identifier);
    if (!ph) throw new AppError(422, 'VALIDATION', 'Enter your email address, or a Ghana mobile number such as 024 123 4567');
    if (!(await smsAvailable())) { audit(req, 'auth.password.forgot', undefined, { channel: 'sms', delivery: 'not_configured' }, { entityType: 'auth', outcome: 'failure' }); return res.json({ ok: true, channel: 'sms', smsAvailable: false, emailAvailable: emailConfigured(), message: NO_SMS }); }
    res.json({ ok: true, channel: 'sms', smsAvailable: true, emailAvailable: emailConfigured(), message: `If an account has verified that phone number, we have sent it a reset code by SMS. The code works once and expires in ${config.PASSWORD_RESET_MINUTES} minutes. Enter it below with the same phone number.` });
    // As for email: all lookups and sending happen after the response.
    lastForgotJob = (async () => {
      const masked = maskPhone(ph.local);
      const u = await User.findOne({ phone: ph.local, phoneVerifiedAt: { $type: 'date' } }).select('fullName status schoolId').lean();
      if (!u || u.status !== 'active') { audit(req, 'auth.password.forgot', undefined, { channel: 'sms', to: masked, reason: u ? 'inactive' : 'unknown_account' }, { entityType: 'auth', outcome: 'failure' }); return; }
      const sc = { entityType: 'auth', actorId: String(u._id), schoolId: u.schoolId ? String(u.schoolId) : undefined };
      if ((await PR.recentSelfRequests(u._id)) >= RESET_LIMITS.accountPerHour) { audit(req, 'auth.password.forgot', String(u._id), { channel: 'sms', to: masked, reason: 'account_rate_limited' }, { ...sc, outcome: 'denied' }); return; }
      const g = await PR.issueReset(u._id, 'self', { ip: req.ip, channel: 'sms' });
      const r = await sendSms({ to: ph.local, kind: 'reset', userId: u._id, message: `GH Learn password reset code: ${g.code}. Enter it at ${resetPageHost()} within ${config.PASSWORD_RESET_MINUTES} min. Not you? Ignore this.` });
      if (r.status !== 'sent') await PasswordReset.updateOne({ tokenHash: PR.sha256(g.token) }, { invalidatedAt: new Date() });
      audit(req, 'auth.password.forgot', String(u._id), { channel: 'sms', to: masked, delivery: r.status }, { ...sc, outcome: r.status === 'sent' ? 'success' : 'failure' });
    })().catch(() => undefined);
    return;
  }
  if (!emailConfigured()) { audit(req, 'auth.password.forgot', undefined, { delivery: 'not_configured' }, { entityType: 'auth', outcome: 'failure' }); const sms = await smsAvailable(); return res.json({ ok: true, emailAvailable: false, smsAvailable: sms, message: sms ? `${NO_EMAIL} If you have verified a phone number on GH Learn, enter it instead to get a reset code by SMS.` : NO_EMAIL }); }
  res.json({ ok: true, emailAvailable: true, message: `If an account uses that email address, we have sent it a reset link. The link works once and expires in ${config.PASSWORD_RESET_MINUTES} minutes. No email? Check spam, or ask your teacher or school administrator.` });
  // Everything below runs after the response, so timing does not reveal whether the account exists.
  lastForgotJob = (async () => {
    const email = b.identifier.toLowerCase();
    const u = email.includes('@') ? await User.findOne({ email }).select('email fullName status schoolId').lean() : null;
    if (!u || u.status !== 'active') { audit(req, 'auth.password.forgot', undefined, { reason: u ? 'inactive' : 'unknown_account' }, { entityType: 'auth', outcome: 'failure' }); return; }
    const sc = { entityType: 'auth', actorId: String(u._id), schoolId: u.schoolId ? String(u.schoolId) : undefined };
    if ((await PR.recentSelfRequests(u._id)) >= RESET_LIMITS.accountPerHour) { audit(req, 'auth.password.forgot', String(u._id), { reason: 'account_rate_limited' }, { ...sc, outcome: 'denied' }); return; }
    const g = await PR.issueReset(u._id, 'self', { ip: req.ip });
    const r = await sendMail({ to: u.email, subject: 'Reset your GH Learn password',
      text: `Hello ${u.fullName},\n\nSomeone (hopefully you) asked to reset the password for your GH Learn account.\n\nOpen this link to choose a new password. It works once and expires in ${config.PASSWORD_RESET_MINUTES} minutes:\n${g.link}\n\nIf you did not ask for this, ignore this email; your password stays the same.\n\nGH Learn` });
    if (r.status !== 'sent') await PasswordReset.updateOne({ tokenHash: PR.sha256(g.token) }, { invalidatedAt: new Date() });
    audit(req, 'auth.password.forgot', String(u._id), { delivery: r.status, ...(r.status === 'failed' ? { error: r.error } : {}) }, { ...sc, outcome: r.status === 'sent' ? 'success' : 'failure' });
  })().catch(() => undefined);
});
const INVALID = 'This reset link or code is not valid. It may have expired or already been used. Ask for a new one.';
/** Lets the reset page say early whether a link still works (token in the body, never in a logged URL). */
authRouter.post('/reset-password/check', resetLimiter, async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : ''; const g = await PR.findByToken(token);
  res.set('Cache-Control', 'no-store').json(g ? { valid: true, expiresAt: g.expiresAt } : { valid: false, message: INVALID });
});
authRouter.post('/reset-password', resetLimiter, async (req, res) => {
  const b = resetPasswordSchema.parse(req.body); res.set('Cache-Control', 'no-store');
  const g = 'token' in b ? await PR.findByToken(b.token) : await PR.findByCode('phone' in b ? { phone: b.phone } : { email: b.email }, b.code);
  const r = g ? await PR.redeem(g._id, b.newPassword) : null;
  if (!r) { audit(req, 'auth.password.reset', undefined, { via: 'token' in b ? 'link' : 'phone' in b ? 'sms_code' : 'code', reason: 'invalid_or_expired' }, { entityType: 'auth', outcome: 'failure' }); throw new AppError(400, 'RESET_INVALID', INVALID); }
  const u = r.user;
  audit(req, 'auth.password.reset', String(u._id), { via: 'token' in b ? 'link' : 'phone' in b ? 'sms_code' : 'code', kind: r.grant.kind, issuedBy: r.grant.createdBy ? String(r.grant.createdBy) : undefined },
    { entityType: 'auth', actorId: String(u._id), schoolId: u.schoolId ? String(u.schoolId) : undefined });
  notifySecurity(u._id, 'security.password', 'Your password was reset', 'Your password was changed with a reset link or code, and every session was signed out. If this was not you, contact your administrator at once.').catch(() => undefined);
  A.clearAuthCookies(res); res.json({ ok: true });
});
/** Secure logout everywhere: revokes every refresh token and invalidates outstanding access tokens. */
authRouter.post('/logout-all', authenticate, async (req, res) => {
  await A.revokeAllForUser(req.auth!.userId); A.clearAuthCookies(res);
  audit(req, 'auth.logout_all', req.auth!.userId); res.status(204).end();
});

/** Own sessions (account settings): list and revoke one. */
authRouter.get('/sessions', authenticate, async (req, res) => {
  const items = await A.listSessions(req.auth!.userId); res.set('Cache-Control', 'no-store');
  res.json({ items: items.map((s) => ({ ...s, current: s.id === req.auth!.sid })) });
});
authRouter.delete('/sessions/:sid', authenticate, async (req, res) => {
  const sid = String(req.params.sid); if (!/^[\w-]{8,64}$/.test(sid)) throw new AppError(422, 'VALIDATION', 'Invalid session id');
  if (!(await A.revokeSession(req.auth!.userId, sid))) throw new AppError(404, 'NOT_FOUND', 'Session not found');
  audit(req, 'auth.session.revoke', req.auth!.userId, { self: true }); res.status(204).end();
});

authRouter.post('/refresh', limiter, async (req, res) => {
  const raw = req.cookies?.gl_rt; if (!raw) throw unauthorized();
  const r = await A.rotateRefresh(raw, meta(req));
  if (!r) { A.clearAuthCookies(res); throw unauthorized('Session expired'); }
  const u = await User.findById(r.userId);
  if (!u || u.status !== 'active') { A.clearAuthCookies(res); throw unauthorized(); }
  if (u.schoolId && !u.roles.includes('super_admin') && (await schoolBlocked(String(u.schoolId)))) { A.clearAuthCookies(res); throw unauthorized('School inactive'); }
  const st = await getSettings(); if (st.maintenance.enabled && !hasPermission(u.roles as Role[], 'admin:access')) throw maintenanceError(st);
  A.setAuthCookies(res, A.signAccess({ sub: String(u._id), roles: u.roles as any, schoolId: u.schoolId ? String(u.schoolId) : undefined, sid: r.family }), r.token);
  res.json({ user: await A.toPublicUser(u) });
});

authRouter.post('/logout', async (req, res) => {
  if (req.cookies?.gl_rt) await A.revokeRefresh(req.cookies.gl_rt);
  let sub: string | undefined; try { if (req.cookies?.gl_at) sub = A.verifyAccess(req.cookies.gl_at).sub; } catch { /* expired: still log out */ }
  if (sub) audit(req, 'auth.logout', sub, undefined, { actorId: sub, entityType: 'auth' });
  A.clearAuthCookies(res); res.status(204).end();
});

/** Like /me, but answers 200 { user: null } for visitors (public pages make no failing request). `refresh` says a refresh cookie is present. */
authRouter.get('/session', (req, res, next) => {
  const anonymous = () => res.json({ user: null, refresh: !!req.cookies?.gl_rt });
  if (!req.cookies?.gl_at) return anonymous();
  authenticate(req, res, (err?: any) => {
    if (err) return err?.status === 401 ? anonymous() : next(err);
    User.findById(req.auth!.userId).then(async (u) => (u ? res.json({ user: await A.toPublicUser(u), refresh: false }) : anonymous())).catch(next);
  });
});
authRouter.get('/me', authenticate, async (req, res) => {
  const u = await User.findById(req.auth!.userId); if (!u) throw unauthorized();
  res.json({ user: await A.toPublicUser(u) });
});
