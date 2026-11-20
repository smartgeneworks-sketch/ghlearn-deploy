import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { useDb, ctx, anon, loginAs } from './setup.js';
import { AuditLog, PhoneOtp, SmsCounter, User } from '../src/models/index.js';
import { setSmsAdapterForTest, testAdapter, testOutbox, testControl } from '../src/services/sms.js';
import { updateSettings, clearSettingsCache } from '../src/services/platformSettings.js';
import { normalizeGhPhone, registerSchema, loginSchema } from '@ghlearn/shared';
useDb();
const PW = 'SamplePass2026';
const SUPER = () => String(ctx.data.users.superAdmin._id);
const on = async () => { setSmsAdapterForTest(testAdapter()); testControl.fail = null; await updateSettings({ sms: { enabled: true, senderId: 'GHLearn', dailyCap: 300 } }, SUPER(), true); };
const off = () => setSmsAdapterForTest(null);
const reg = (o: Record<string, unknown>) => anon().then((a) => a.post('/api/auth/register').send({ fullName: 'New Student', password: 'NewStudent2027', acceptTerms: true, ...o }));
const lastCode = () => /\b(\d{6})\b/.exec(testOutbox.at(-1)!.message)![1];
const settle = () => new Promise((r) => setTimeout(r, 60));
const login = async (email: string, password = 'NewStudent2027') => (await anon()).post('/api/auth/login').send({ email, password });
beforeEach(async () => { testOutbox.length = 0; await PhoneOtp.deleteMany({}); await SmsCounter.deleteMany({}); });
afterAll(() => { setSmsAdapterForTest(undefined); clearSettingsCache(); });

describe('shared phone validation', () => {
  it('normalises the usual Ghana forms and rejects others in the sign-up schema', () => {
    for (const s of ['0241234567', '+233241234567', '233 24 123 4567', '024-123-4567']) expect(normalizeGhPhone(s)!.local).toBe('0241234567');
    expect(registerSchema.safeParse({ fullName: 'Ab', email: 'a@b.test', password: 'Password2027', acceptTerms: true, phone: '0302123456' }).success).toBe(false);
    expect(registerSchema.safeParse({ fullName: 'Ab', email: 'a@b.test', password: 'Password2027', acceptTerms: true, phone: '' }).success).toBe(true);
    expect(registerSchema.safeParse({ fullName: 'Ab', email: 'a@b.test', password: 'Password2027', acceptTerms: true }).success).toBe(true);
    expect(loginSchema.safeParse({ email: '0241234567', password: 'x' }).success).toBe(true);
  });
});

describe('sign-up with a phone number', () => {
  it('without a phone: unchanged', async () => {
    await on(); const r = await reg({ email: 'nophone@ex.test' }); expect(r.status).toBe(201); expect(r.body.phone).toBeUndefined();
    expect((await User.findOne({ email: 'nophone@ex.test' }).lean())!.phone).toBeUndefined(); expect(testOutbox).toHaveLength(0);
  });
  it('rejects a non-mobile number', async () => { await on(); expect((await reg({ email: 'bad@ex.test', phone: '0302123456' })).status).toBe(422); });
  it('SMS on: stores the number unverified, texts a code at once; verifying enables phone sign-in', async () => {
    await on(); const a = await anon();
    const r = await a.post('/api/auth/register').send({ fullName: 'Phone Student', email: 'phone1@ex.test', password: 'NewStudent2027', acceptTerms: true, phone: '+233 24 222 0001' });
    expect(r.status).toBe(201); expect(r.body.phone).toMatchObject({ phoneMasked: '024****001', codeSent: true, verified: false });
    const u = await User.findOne({ email: 'phone1@ex.test' }).lean(); expect(u).toMatchObject({ phone: '0242220001' }); expect(u!.phoneVerifiedAt).toBeUndefined();
    expect(testOutbox).toHaveLength(1); expect(testOutbox[0].otp).toBe(true);
    expect((await a.get('/api/account/phone')).body).toMatchObject({ phone: null, unverifiedPhone: '0242220001', pending: { phoneMasked: '024****001' } });
    // unverified: phone sign-in fails exactly like an unknown account
    const unv = await login('0242220001'); const unknown = await login('0249990000'); const badEmail = await login('nobody@ex.test');
    expect(unv.status).toBe(401); expect(unv.body.error.message).toBe(unknown.body.error.message); expect(unv.body.error.message).toBe(badEmail.body.error.message); expect(unv.body.error.code).toBe(badEmail.body.error.code);
    // resend + verify
    expect((await a.post('/api/account/phone').send({ phone: '0242220001' })).status).toBe(200);
    expect((await a.post('/api/account/phone/verify').send({ code: lastCode() })).status).toBe(200);
    for (const form of ['0242220001', '+233242220001', '233242220001', '024 222 0001', '242220001']) { const l = await login(form); expect(l.status, form).toBe(200); expect(l.body.user.email).toBe('phone1@ex.test'); }
    expect((await login('phone1@EX.test')).status).toBe(200); // email still works, case-insensitive
    expect((await login('0242220001', 'WrongPassword1')).status).toBe(401);
    await settle(); expect(await AuditLog.exists({ action: 'auth.login', target: String(u!._id), 'meta.via': 'phone' })).toBeTruthy();
    expect(JSON.stringify(await AuditLog.find({ action: 'auth.login.failure' }).lean())).not.toMatch(/0242220001|0249990000/);
  });
  it('a number verified on another account cannot be used again; an unverified one can', async () => {
    await on();
    expect((await reg({ email: 'dup@ex.test', phone: '0242220001' })).status).toBe(409);
    const r = await reg({ email: 'dup2@ex.test', phone: '0202220002' }); expect(r.status).toBe(201);
    const r2 = await reg({ email: 'dup3@ex.test', phone: '0202220002' }); expect(r2.status).toBe(201); // both unverified: allowed
  });
  it('SMS off: number stored unverified with an honest message, no code', async () => {
    off(); const r = await reg({ email: 'smsoff@ex.test', phone: '0552220003' }); expect(r.status).toBe(201);
    expect(r.body.phone).toMatchObject({ codeSent: false, reason: 'sms_unavailable' }); expect(r.body.phone.message).toMatch(/not available/);
    expect((await User.findOne({ email: 'smsoff@ex.test' }).lean())!.phone).toBe('0552220003'); expect(testOutbox).toHaveLength(0);
  });
  it('daily cap reached: account still created, honest message', async () => {
    await on(); await updateSettings({ sms: { dailyCap: 1 } }, SUPER(), true); await SmsCounter.create({ day: new Date().toISOString().slice(0, 10), n: 1 });
    const r = await reg({ email: 'cap@ex.test', phone: '0572220004' }); expect(r.status).toBe(201); expect(r.body.phone).toMatchObject({ codeSent: false });
    expect(r.body.phone.message).toMatch(/limit/); await updateSettings({ sms: { dailyCap: 300 } }, SUPER(), true);
  });
});

describe('phone sign-in: lockout identical to email', () => {
  it('wrong passwords via phone lock the account like via email', async () => {
    await on(); await User.updateOne({ email: 'kofi@sample.ghlearn.test' }, { phone: '0262220005', phoneVerifiedAt: new Date() });
    await updateSettings({ sessions: { lockoutAttempts: 3, lockoutMinutes: 30 } }, SUPER(), true);
    for (let i = 0; i < 3; i++) expect((await login('0262220005', 'nope-wrong-1')).status).toBe(401);
    const l = await login('0262220005', PW); expect(l.status).toBe(423);
    expect((await login('kofi@sample.ghlearn.test', PW)).status).toBe(423);
    await User.updateOne({ email: 'kofi@sample.ghlearn.test' }, { $unset: { lockedUntil: 1, phone: 1, phoneVerifiedAt: 1 }, failedLogins: 0 });
    await updateSettings({ sessions: { lockoutAttempts: 5, lockoutMinutes: 15 } }, SUPER(), true);
  });
  it('staff and sample accounts still sign in by email', async () => { await loginAs('admin@sample.ghlearn.test'); await loginAs('teacher@sample.ghlearn.test'); });
});

describe('admin: phone shown masked; super admins clear a verification', () => {
  it('list masks, detail full for super only; clear is super-only and audited, and stops phone sign-in', async () => {
    const u = await User.findOne({ email: 'phone1@ex.test' }).lean();
    const sa = await loginAs('super@sample.ghlearn.test');
    const list = await sa.get('/api/admin/users?q=phone1'); const row = list.body.items.find((x: any) => x.email === 'phone1@ex.test');
    expect(row).toMatchObject({ phoneMasked: '024****001', phoneVerified: true }); expect(JSON.stringify(list.body)).not.toContain('0242220001');
    expect((await sa.get(`/api/admin/users/${u!._id}`)).body.user).toMatchObject({ phone: '0242220001', phoneVerified: true });
    await User.updateOne({ _id: u!._id }, { schoolId: ctx.data.school._id });
    const ad = await loginAs('admin@sample.ghlearn.test');
    const d = await ad.get(`/api/admin/users/${u!._id}`); expect(d.body.user.phone).toBe('024****001'); expect(JSON.stringify(d.body)).not.toContain('0242220001');
    expect((await ad.post(`/api/admin/users/${u!._id}/phone/clear-verification`).send({})).status).toBe(403);
    const c = await sa.post(`/api/admin/users/${u!._id}/phone/clear-verification`).send({}); expect(c.body).toEqual({ ok: true, phoneMasked: '024****001', phoneVerified: false });
    expect((await sa.post(`/api/admin/users/${u!._id}/phone/clear-verification`).send({})).status).toBe(409);
    await settle(); expect(await AuditLog.exists({ action: 'user.phone.verification_cleared', target: String(u!._id) })).toBeTruthy();
    expect((await login('0242220001')).status).toBe(401); expect((await login('phone1@ex.test')).status).toBe(200);
  });
});
