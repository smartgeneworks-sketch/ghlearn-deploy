import { describe, it, expect, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { useDb, ctx, anon, loginAs } from './setup.js';
import { config } from '../src/config.js';
import { resetMailer, sentForTest, setFetchForTest, emailProvider } from '../src/services/mailer.js';
import { AuditLog, Notification, PasswordReset, User, School } from '../src/models/index.js';
import { sha256, issueReset, MAX_CODE_ATTEMPTS } from '../src/services/passwordReset.js';
import { hashPassword } from '../src/services/auth.js';
import * as AuthRoutes from '../src/routes/auth.js';
useDb();
const PW = 'SamplePass2026';
const settle = () => new Promise((r) => setTimeout(r, 60));
const email = (on: boolean) => { (config as any).SMTP_URL = on ? 'json' : undefined; resetMailer(); sentForTest.length = 0; };
const tokenFrom = (m: any) => /token=([\w-]+)/.exec(JSON.stringify(m))![1];
const auditFor = async (action: string, q: any = {}) => { await settle(); return AuditLog.find({ action, ...q }).lean(); };
afterAll(() => email(false));

describe('forgot password: honest when email is not configured', () => {
  it('says email reset is unavailable, for known and unknown accounts alike, and issues nothing', async () => {
    email(false);
    const pub = await (await anon()).get('/api/settings/public'); expect(pub.body.passwordReset).toEqual({ email: false, sms: false, staffAssisted: true });
    const a = await (await anon()).post('/api/auth/forgot-password').send({ identifier: 'ama@sample.ghlearn.test' });
    const b = await (await anon()).post('/api/auth/forgot-password').send({ identifier: 'nobody@nowhere.test' });
    expect(a.status).toBe(200); expect(a.body).toEqual(b.body); expect(a.body.emailAvailable).toBe(false); expect(a.body.message).toMatch(/teacher or school administrator/);
    expect(await PasswordReset.countDocuments()).toBe(0);
  });
});

describe('forgot password with email configured', () => {
  it('enumeration-safe: identical response; only a real active account gets a 32-byte single-use link, stored hashed, 30 min', async () => {
    email(true);
    expect((await (await anon()).get('/api/settings/public')).body.passwordReset.email).toBe(true);
    const known = await (await anon()).post('/api/auth/forgot-password').send({ identifier: 'Ama@Sample.GHLearn.test' }); await AuthRoutes.lastForgotJob;
    const unknown = await (await anon()).post('/api/auth/forgot-password').send({ identifier: 'nobody@nowhere.test' }); await AuthRoutes.lastForgotJob;
    const notEmail = await (await anon()).post('/api/auth/forgot-password').send({ identifier: 'ama' }); await AuthRoutes.lastForgotJob;
    expect(known.status).toBe(200); expect(known.body).toEqual(unknown.body); expect(notEmail.status).toBe(422); // neither an email nor a phone number: plain input validation, same for everyone expect(known.body.emailAvailable).toBe(true);
    expect(sentForTest).toHaveLength(1); expect(JSON.stringify(sentForTest[0].to)).toContain('ama@sample.ghlearn.test');
    const token = tokenFrom(sentForTest[0]); expect(Buffer.from(token, 'base64url').length).toBe(32);
    const rows = await PasswordReset.find().select('+codeHash').lean(); expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(sha256(token)); expect(JSON.stringify(rows)).not.toContain(token); expect(rows[0].kind).toBe('self');
    const mins = (+rows[0].expiresAt - +rows[0].createdAt!) / 60_000; expect(mins).toBeGreaterThan(29); expect(mins).toBeLessThanOrEqual(30.1);
    expect((await auditFor('auth.password.forgot', { 'meta.delivery': 'sent' })).length).toBe(1);
    expect((await auditFor('auth.password.forgot', { 'meta.reason': 'unknown_account' })).length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(await AuditLog.find({ action: 'auth.password.forgot' }).lean())).not.toContain('nobody@nowhere');
  });
  it('reset: sets the password, revokes every session, is single use, notifies in-app and is audited', async () => {
    email(true); const other = await loginAs('ama@sample.ghlearn.test'); expect((await other.get('/api/auth/me')).status).toBe(200);
    await (await anon()).post('/api/auth/forgot-password').send({ identifier: 'ama@sample.ghlearn.test' }); await AuthRoutes.lastForgotJob;
    const token = tokenFrom(sentForTest.at(-1));
    const v = await (await anon()).post('/api/auth/reset-password/check').send({ token }); expect(v.body.valid).toBe(true);
    const weak = await (await anon()).post('/api/auth/reset-password').send({ token, newPassword: 'short' }); expect(weak.status).toBe(422);
    await new Promise((r) => setTimeout(r, 1100)); // revocation compares whole seconds
    const r = await (await anon()).post('/api/auth/reset-password').send({ token, newPassword: 'NewAmaPass2027' }); expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await other.post('/api/auth/refresh').send({})).status).toBe(401);
    const again = await (await anon()).post('/api/auth/reset-password').send({ token, newPassword: 'OtherPass2028' }); expect(again.status).toBe(400); expect(again.body.error.code).toBe('RESET_INVALID');
    expect((await (await anon()).post('/api/auth/reset-password/check').send({ token })).body.valid).toBe(false);
    await expect(loginAs('ama@sample.ghlearn.test')).rejects.toThrow(); await loginAs('ama@sample.ghlearn.test', 'NewAmaPass2027');
    expect(await Notification.exists({ userId: ctx.data.users.ama._id, title: 'Your password was reset' })).toBeTruthy();
    expect((await auditFor('auth.password.reset', { target: String(ctx.data.users.ama._id), outcome: 'success' })).length).toBe(1);
    expect((await auditFor('auth.password.reset', { outcome: 'failure' })).length).toBeGreaterThanOrEqual(1);
    await User.updateOne({ _id: ctx.data.users.ama._id }, { passwordHash: await hashPassword(PW) });
  });
  it('expired and superseded tokens are refused', async () => {
    const g1 = await issueReset(ctx.data.users.kofi._id, 'self'); const g2 = await issueReset(ctx.data.users.kofi._id, 'self');
    expect((await (await anon()).post('/api/auth/reset-password').send({ token: g1.token, newPassword: 'KofiNewPass2027' })).status).toBe(400); // superseded by g2
    await PasswordReset.updateOne({ tokenHash: sha256(g2.token) }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await (await anon()).post('/api/auth/reset-password/check').send({ token: g2.token })).body.valid).toBe(false);
    expect((await (await anon()).post('/api/auth/reset-password').send({ token: g2.token, newPassword: 'KofiNewPass2027' })).status).toBe(400);
    await loginAs('kofi@sample.ghlearn.test'); // unchanged
  });
  it('per-account limit: at most 3 self-service requests an hour, further ones silently dropped', async () => {
    email(true); await PasswordReset.deleteMany({ userId: ctx.data.users.kofi._id }); sentForTest.length = 0;
    for (let i = 0; i < 5; i++) { const r = await (await anon()).post('/api/auth/forgot-password').send({ identifier: 'kofi@sample.ghlearn.test' }); expect(r.status).toBe(200); await AuthRoutes.lastForgotJob; }
    expect(sentForTest).toHaveLength(AuthRoutes.RESET_LIMITS.accountPerHour);
    expect(await PasswordReset.countDocuments({ userId: ctx.data.users.kofi._id, kind: 'self' })).toBe(3);
    expect((await auditFor('auth.password.forgot', { 'meta.reason': 'account_rate_limited' })).length).toBe(2);
  });
  it('per-IP limits answer 429 (forgot and reset)', async () => {
    const prev = { ...AuthRoutes.RESET_LIMITS }; AuthRoutes.resetStores.forgot.resetAll(); AuthRoutes.resetStores.reset.resetAll();
    AuthRoutes.RESET_LIMITS.forgotPerIp = 2; AuthRoutes.RESET_LIMITS.resetPerIp = 2;
    try {
      const a = await anon();
      for (let i = 0; i < 2; i++) expect((await a.post('/api/auth/forgot-password').send({ identifier: 'x@y.test' })).status).toBe(200);
      const r = await a.post('/api/auth/forgot-password').send({ identifier: 'x@y.test' }); expect(r.status).toBe(429); expect(r.body.error.code).toBe('RATE_LIMITED');
      for (let i = 0; i < 2; i++) expect((await a.post('/api/auth/reset-password').send({ token: 'x'.repeat(43), newPassword: 'Whatever2027' })).status).toBe(400);
      expect((await a.post('/api/auth/reset-password').send({ token: 'x'.repeat(43), newPassword: 'Whatever2027' })).status).toBe(429);
    } finally { Object.assign(AuthRoutes.RESET_LIMITS, prev); AuthRoutes.resetStores.forgot.resetAll(); AuthRoutes.resetStores.reset.resetAll(); }
  });
  it('failed delivery voids the token and is audited as a failure', async () => {
    (config as any).SMTP_URL = undefined; (config as any).EMAIL_API_PROVIDER = 'resend'; (config as any).EMAIL_API_KEY = 'test-key'; (config as any).EMAIL_FROM = 'GH Learn <no-reply@ghlearn.com>';
    const calls: any[] = []; setFetchForTest((async (url: any, init: any) => { calls.push({ url, init }); return new Response('{"message":"domain not verified"}', { status: 403 }); }) as any);
    try {
      expect(emailProvider()).toBe('resend');
      await PasswordReset.deleteMany({}); const failedBefore = (await auditFor('auth.password.forgot', { 'meta.delivery': 'failed' })).length;
      await (await anon()).post('/api/auth/forgot-password').send({ identifier: 'counselor@sample.ghlearn.test' }); await AuthRoutes.lastForgotJob;
      expect(calls[0].url).toBe('https://api.resend.com/emails'); expect(calls[0].init.headers.authorization).toBe('Bearer test-key');
      expect(JSON.parse(calls[0].init.body)).toMatchObject({ from: 'GH Learn <no-reply@ghlearn.com>', to: ['counselor@sample.ghlearn.test'], subject: 'Reset your GH Learn password' });
      const g = await PasswordReset.findOne().lean(); expect(g!.invalidatedAt).toBeTruthy();
      expect((await auditFor('auth.password.forgot', { 'meta.delivery': 'failed', outcome: 'failure' })).length).toBe(failedBefore + 1);
      // Brevo adapter shape
      (config as any).EMAIL_API_PROVIDER = 'brevo'; setFetchForTest((async (url: any, init: any) => { calls.push({ url, init }); return new Response('{"messageId":"x"}', { status: 201 }); }) as any);
      await PasswordReset.deleteMany({}); await (await anon()).post('/api/auth/forgot-password').send({ identifier: 'counselor@sample.ghlearn.test' }); await AuthRoutes.lastForgotJob;
      const last = calls.at(-1); expect(last.url).toBe('https://api.brevo.com/v3/smtp/email'); expect(last.init.headers['api-key']).toBe('test-key');
      expect(JSON.parse(last.init.body)).toMatchObject({ sender: { name: 'GH Learn', email: 'no-reply@ghlearn.com' }, to: [{ email: 'counselor@sample.ghlearn.test' }] });
      expect((await PasswordReset.findOne().lean())!.invalidatedAt).toBeFalsy();
    } finally { (config as any).EMAIL_API_PROVIDER = undefined; (config as any).EMAIL_API_KEY = undefined; (config as any).EMAIL_FROM = undefined; setFetchForTest(null); }
  });
});

describe('staff-assisted reset', () => {
  it('admin link + code: shown once, 24 h, redeemable by email+code once; wrong codes void it after 5', async () => {
    email(false); const admin = await loginAs('admin@sample.ghlearn.test');
    const r = await admin.post(`/api/admin/users/${ctx.data.users.kofi._id}/reset-link`).send({}); expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store'); expect(r.body.link).toMatch(/\/reset-password\?token=[\w-]{43}$/); expect(r.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const hrs = (+new Date(r.body.expiresAt) - Date.now()) / 3600_000; expect(hrs).toBeGreaterThan(23.9); expect(hrs).toBeLessThanOrEqual(24);
    const row = await PasswordReset.findOne({ userId: ctx.data.users.kofi._id, kind: 'staff' }).select('+codeHash').lean();
    expect(JSON.stringify(row)).not.toContain(r.body.code); expect(String(row!.createdBy)).toBe(String(ctx.data.users.schoolAdmin._id));
    expect(await Notification.exists({ userId: ctx.data.users.kofi._id, title: 'A password reset link was created for you' })).toBeTruthy();
    expect((await auditFor('user.password.reset_link', { target: String(ctx.data.users.kofi._id) })).length).toBe(1);
    expect(JSON.stringify(await AuditLog.find({ action: 'user.password.reset_link' }).lean())).not.toContain(r.body.code);
    const ok = await (await anon()).post('/api/auth/reset-password').send({ email: 'kofi@sample.ghlearn.test', code: r.body.code.toLowerCase().replace(/-/g, ' '), newPassword: 'KofiCode2027x' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200); await loginAs('kofi@sample.ghlearn.test', 'KofiCode2027x');
    expect((await (await anon()).post('/api/auth/reset-password').send({ token: new URL(r.body.link).searchParams.get('token'), newPassword: 'KofiLink2027x' })).status).toBe(400); // used
    const r2 = await admin.post(`/api/admin/users/${ctx.data.users.kofi._id}/reset-link`).send({});
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) expect((await (await anon()).post('/api/auth/reset-password').send({ email: 'kofi@sample.ghlearn.test', code: 'AAAA-AAAA-AAAA', newPassword: 'KofiCode2028x' })).status).toBe(400);
    expect((await (await anon()).post('/api/auth/reset-password').send({ email: 'kofi@sample.ghlearn.test', code: r2.body.code, newPassword: 'KofiCode2028x' })).status).toBe(400); // voided
    await User.updateOne({ _id: ctx.data.users.kofi._id }, { passwordHash: await hashPassword(PW) });
  });
  it('scope: nobody resets a higher role, other schools, themselves; students, counsellors and editors cannot', async () => {
    const admin = await loginAs('admin@sample.ghlearn.test');
    for (const u of [ctx.data.users.superAdmin, ctx.data.users.curriculumAdmin, ctx.data.users.operator]) {
      expect([403, 404]).toContain((await admin.post(`/api/admin/users/${u._id}/reset-link`).send({})).status); // platform accounts are outside a school admin's view
      expect([403, 404]).toContain((await admin.post(`/api/admin/users/${u._id}/reset-password`).send({})).status);
    }
    expect((await admin.post(`/api/admin/users/${ctx.data.users.schoolAdmin._id}/reset-link`).send({})).status).toBe(403); // self
    const peer = await User.create({ email: 'admin2@sample.ghlearn.test', fullName: 'Second Admin', roles: ['school_admin'], schoolId: ctx.data.school._id, passwordHash: await hashPassword(PW) });
    expect((await admin.post(`/api/admin/users/${peer._id}/reset-link`).send({})).status).toBe(403); // administrator accounts: super admin only
    const school2 = await School.create({ name: 'Other School', code: 'OTHER-02' });
    const far = await User.create({ email: 'far@other.test', fullName: 'Far Student', roles: ['student'], schoolId: school2._id, passwordHash: await hashPassword(PW) });
    expect((await admin.post(`/api/admin/users/${far._id}/reset-link`).send({})).status).toBe(404);
    for (const who of ['ama@sample.ghlearn.test', 'counselor@sample.ghlearn.test', 'editor@sample.ghlearn.test', 'teacher@sample.ghlearn.test']) {
      const a = await loginAs(who); expect((await a.post(`/api/admin/users/${ctx.data.users.kofi._id}/reset-link`).send({})).status).toBe(403);
    }
    const sup = await loginAs('super@sample.ghlearn.test');
    expect((await sup.post(`/api/admin/users/${far._id}/reset-link`).send({})).status).toBe(200);
    expect((await sup.post(`/api/admin/users/${ctx.data.users.curriculumAdmin._id}/reset-link`).send({})).status).toBe(200);
    expect(await PasswordReset.countDocuments({ userId: ctx.data.users.superAdmin._id })).toBe(0);
  });
  it('teacher: only students in their own classes; temporary password forces a change and revokes sessions', async () => {
    const t = await loginAs('teacher@sample.ghlearn.test');
    const c = await t.post('/api/teacher/classes').send({ name: 'Biology 1A', subjectId: String(ctx.data.bio._id), studentIds: [String(ctx.data.users.ama._id)] }); expect(c.status, JSON.stringify(c.body)).toBe(201);
    const cid = c.body.class._id; const url = (u: any) => `/api/teacher/classes/${cid}/students/${u}/password-reset`;
    expect((await t.post(url(ctx.data.users.kofi._id)).send({ mode: 'link' })).status).toBe(404); // not in this class
    expect((await t.post(url(ctx.data.users.ama._id)).send({ mode: 'bogus' })).status).toBe(422);
    const other = await User.create({ email: 't2@sample.ghlearn.test', fullName: 'Other Teacher', roles: ['teacher'], schoolId: ctx.data.school._id, passwordHash: await hashPassword(PW) });
    expect((await (await loginAs('t2@sample.ghlearn.test')).post(url(ctx.data.users.ama._id)).send({ mode: 'link' })).status).toBe(404); // not their class
    // a student who also holds a staff role is out of a teacher's reach
    await mongoose.model('ClassGroup').updateOne({ _id: cid }, { $push: { studentIds: other._id } });
    expect((await t.post(url(other._id)).send({ mode: 'temporary' })).status).toBe(403);
    const link = await t.post(url(ctx.data.users.ama._id)).send({ mode: 'link' }); expect(link.status).toBe(200); expect(link.body.code).toBeTruthy();
    expect((await auditFor('user.password.reset_link', { 'meta.via': 'teacher', target: String(ctx.data.users.ama._id) })).length).toBe(1);
    const amaSession = await loginAs('ama@sample.ghlearn.test');
    await new Promise((r) => setTimeout(r, 1100));
    const tmp = await t.post(url(ctx.data.users.ama._id)).send({ mode: 'temporary' }); expect(tmp.status).toBe(200); expect(tmp.body.temporaryPassword).toMatch(/^[A-Za-z2-9]{14}$/);
    expect((await amaSession.get('/api/auth/me')).status).toBe(401);
    expect((await (await anon()).post('/api/auth/reset-password').send({ token: new URL(link.body.link).searchParams.get('token'), newPassword: 'AmaLink2027xx' })).status).toBe(400); // voided by the temp reset
    const ama = await loginAs('ama@sample.ghlearn.test', tmp.body.temporaryPassword);
    expect((await ama.get('/api/auth/me')).body.user.mustChangePassword).toBe(true);
    const blocked = await ama.get('/api/me/subjects'); expect(blocked.status).toBe(403); expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await ama.post('/api/auth/change-password').send({ currentPassword: tmp.body.temporaryPassword, newPassword: PW })).status).toBe(200);
    expect((await ama.get('/api/me/subjects')).status).toBe(200);
    expect(await Notification.exists({ userId: ctx.data.users.ama._id, title: 'Your password was reset by staff' })).toBeTruthy();
    expect((await auditFor('user.password.reset', { 'meta.via': 'teacher' })).length).toBe(1);
    expect((await (await loginAs('counselor@sample.ghlearn.test')).post(url(ctx.data.users.ama._id)).send({ mode: 'link' })).status).toBe(403);
  });
  it('signed-in change password: policy enforced, other sessions revoked, audited', async () => {
    const a = await loginAs('kofi@sample.ghlearn.test'); const b = await loginAs('kofi@sample.ghlearn.test');
    expect((await a.post('/api/auth/change-password').send({ currentPassword: PW, newPassword: 'nodigitshere' })).status).toBe(422);
    expect((await a.post('/api/auth/change-password').send({ currentPassword: 'wrong-one-1', newPassword: 'KofiChange2027' })).status).toBe(422);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await a.post('/api/auth/change-password').send({ currentPassword: PW, newPassword: 'KofiChange2027' })).status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(200); expect((await b.get('/api/auth/me')).status).toBe(401);
    expect((await auditFor('auth.password.change', { target: String(ctx.data.users.kofi._id), outcome: 'success' })).length).toBe(1);
    await User.updateOne({ _id: ctx.data.users.kofi._id }, { passwordHash: await hashPassword(PW) });
  });
});
