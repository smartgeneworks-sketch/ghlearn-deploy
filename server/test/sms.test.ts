import { config } from '../src/config.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { useDb, ctx, anon, loginAs } from './setup.js';
import { AuditLog, Meeting, Notification, PasswordReset, PhoneOtp, SmsCounter, SmsLog, User } from '../src/models/index.js';
import { normalizeGhPhone, maskPhone } from '../src/services/phone.js';
import { mnotifyAdapter, setSmsFetchForTest, setSmsAdapterForTest, testAdapter, testOutbox, testControl, sendSms, smsText, smsAdapter } from '../src/services/sms.js';
import { updateSettings, clearSettingsCache } from '../src/services/platformSettings.js';
import { sendDueReminders } from '../src/services/meetingReminders.js';
import { notify, flushEmails, smsNotificationText } from '../src/services/notify.js';
import { OTP_LIMITS } from '../src/services/phoneVerify.js';
import * as AuthRoutes from '../src/routes/auth.js';
useDb();
const KEY = 'test-key-SECRET-123';
const settle = () => new Promise((r) => setTimeout(r, 60));
const SUPER = () => String(ctx.data.users.superAdmin._id);
const sms = async (o: Record<string, unknown>) => { await updateSettings({ sms: o }, SUPER(), true); };
const on = async () => { setSmsAdapterForTest(testAdapter()); testControl.fail = null; await sms({ enabled: true, senderId: 'GHLearn', dailyCap: 300 }); };
const off = () => setSmsAdapterForTest(null);
const lastCode = () => /\b(\d{6})\b/.exec(testOutbox.at(-1)!.message)![1];
async function verify(agent: any, phone: string) {
  const r = await agent.post('/api/account/phone').send({ phone }); expect(r.status, JSON.stringify(r.body)).toBe(200);
  const v = await agent.post('/api/account/phone/verify').send({ code: lastCode() }); expect(v.status, JSON.stringify(v.body)).toBe(200);
}
beforeEach(async () => { testOutbox.length = 0; await PhoneOtp.deleteMany({}); await SmsCounter.deleteMany({}); });
afterAll(() => { setSmsAdapterForTest(undefined); setSmsFetchForTest(null); clearSettingsCache(); });

describe('Ghana phone numbers', () => {
  it('normalises local and international forms, names the network, rejects non-mobile numbers', () => {
    for (const s of ['0241234567', '024 123 4567', '024-123-4567', '+233 24 123 4567', '233241234567', '00233241234567', '241234567'])
      expect(normalizeGhPhone(s), s).toEqual({ local: '0241234567', e164: '+233241234567', network: 'MTN' });
    expect(normalizeGhPhone('0201234567')!.network).toBe('Telecel'); expect(normalizeGhPhone('0501234567')!.network).toBe('Telecel');
    expect(normalizeGhPhone('0271234567')!.network).toBe('AirtelTigo'); expect(normalizeGhPhone('0571234567')!.network).toBe('AirtelTigo');
    expect(normalizeGhPhone('0530506573')!.network).toBe('MTN');
    for (const s of ['0302123456', '021123456', '02412345678', '+234241234567', 'abc', '']) expect(normalizeGhPhone(s), s).toBeNull();
    expect(maskPhone('0530506573')).toBe('053****573');
  });
  it('one 160-character GSM-friendly segment', () => {
    expect(smsText('A \u201Cquote\u201D \u2013 dash\u2026')).toBe('A "quote" - dash...');
    const t = smsText('x'.repeat(300)); expect(t).toHaveLength(160); expect(t.endsWith('...')).toBe(true);
    expect(smsNotificationText({ title: 'Meeting confirmed: Careers', body: 'y'.repeat(400) })).toMatch(/^GH Learn: Meeting confirmed: Careers\. y+\.\.\.$/);
  });
});

describe('mNotify adapter (mocked HTTP)', () => {
  const calls: { url: string; init: any }[] = [];
  const mock = (status: number, json: unknown) => setSmsFetchForTest((async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(json), { status }); }) as any);
  beforeEach(() => { calls.length = 0; });
  afterAll(() => setSmsFetchForTest(null));
  it('posts the documented quick-SMS body with the key in the query; sms_type otp only for codes when SMS_OTP_ROUTE=true', async () => {
    const a = mnotifyAdapter(KEY, 'https://api.mnotify.com/api');
    mock(200, { status: 'success', code: '2000', message: 'messages sent successfully', summary: { _id: 'CAMP-1', credit_used: 1, credit_left: 2 } });
    const r = await a.send({ to: ['0241234567'], sender: 'GHLearn', message: 'Hi', otp: false });
    expect(r).toEqual({ ok: true, campaignId: 'CAMP-1', credits: 1, code: '2000' });
    const u = new URL(calls[0].url); expect(u.origin + u.pathname).toBe('https://api.mnotify.com/api/sms/quick'); expect(u.searchParams.get('key')).toBe(KEY);
    expect(calls[0].init.method).toBe('POST'); expect(JSON.parse(calls[0].init.body)).toEqual({ recipient: ['0241234567'], sender: 'GHLearn', message: 'Hi', is_schedule: false, schedule_date: '' });
    // Codes go as normal SMS (credits) by default; the paid OTP route (GHS main wallet) only when SMS_OTP_ROUTE=true.
    await a.send({ to: ['0241234567'], sender: 'GHLearn', message: 'code', otp: true }); expect(JSON.parse(calls[1].init.body).sms_type).toBeUndefined();
    const prev = config.SMS_OTP_ROUTE; (config as any).SMS_OTP_ROUTE = 'true';
    try { await a.send({ to: ['0241234567'], sender: 'GHLearn', message: 'code', otp: true }); expect(JSON.parse(calls[2].init.body).sms_type).toBe('otp'); } finally { (config as any).SMS_OTP_ROUTE = prev; }
  });
  it('maps provider errors and never leaks the key', async () => {
    const a = mnotifyAdapter(KEY);
    mock(200, { status: 'error', code: '1005', message: `Invalid sender id for key ${KEY}` });
    const r = await a.send({ to: ['0241234567'], sender: 'X', message: 'Hi', otp: false }) as any;
    expect(r.ok).toBe(false); expect(r.code).toBe('1005'); expect(r.error).not.toContain(KEY); expect(r.error).toContain('[key]');
    mock(401, { message: 'Unauthenticated' }); expect(((await a.balance()) as any).error).toMatch(/Unauthenticated.*401/);
    setSmsFetchForTest((async () => { throw new Error(`connect ECONNREFUSED ?key=${KEY}`); }) as any);
    const n = await a.send({ to: ['0241234567'], sender: 'X', message: 'Hi', otp: false }) as any; expect(n.ok).toBe(false); expect(n.error).not.toContain(KEY);
  });
  it('reads balance, sender status (404 = not found), registration and campaign reports', async () => {
    const a = mnotifyAdapter(KEY);
    mock(200, { status: 'success', wallet: '50', balance: 3, bonus: 0 }); expect(await a.balance()).toEqual({ ok: true, smsCredits: 3, bonus: 0, wallet: '50' });
    expect(calls.at(-1)!.url).toContain('/balance/sms?key=');
    mock(404, { status: 'error', message: 'sender id not found' }); expect(await a.senderStatus('Nope')).toMatchObject({ ok: false, notFound: true });
    mock(200, { status: 'success', code: '2000', summary: { sender_name: 'GHLearn', status: 'Pending' } }); expect(await a.senderStatus('GHLearn')).toEqual({ ok: true, status: 'pending' });
    expect(JSON.parse(calls.at(-1)!.init.body)).toEqual({ sender_name: 'GHLearn' });
    mock(200, { status: 'success', code: '2000', summary: { status: 'Pending' } }); expect(await a.registerSender('GHLearn', 'School notices')).toEqual({ ok: true, status: 'pending' });
    expect(JSON.parse(calls.at(-1)!.init.body)).toEqual({ sender_name: 'GHLearn', purpose: 'School notices' });
    mock(200, { status: 'success', report: [{ status: 'DELIVERED' }] }); expect(await a.report('CAMP-1')).toEqual({ ok: true, statuses: ['delivered'] });
  });
  it('never uses the real provider under NODE_ENV=test, even with a key in the environment', () => { setSmsAdapterForTest(undefined); expect(smsAdapter()).toBeNull(); });
});

describe('sendSms: honest outcomes, daily cap, masked log without the body', () => {
  it('not configured / disabled / no sender are logged, nothing is sent', async () => {
    off(); expect((await sendSms({ to: '0241234567', message: 'm', kind: 'test' })).status).toBe('not_configured');
    setSmsAdapterForTest(testAdapter()); await sms({ enabled: false, senderId: 'GHLearn' }); expect((await sendSms({ to: '0241234567', message: 'm', kind: 'test' })).status).toBe('disabled');
    await sms({ enabled: true, senderId: '' }); expect((await sendSms({ to: '0241234567', message: 'm', kind: 'test' })).status).toBe('no_sender');
    expect(testOutbox).toHaveLength(0); expect((await sendSms({ to: '12345', message: 'm', kind: 'test' })).status).toBe('invalid_number');
  });
  it('enforces the daily cap atomically', async () => {
    await on(); await sms({ dailyCap: 2 });
    const r = await Promise.all([1, 2, 3, 4].map(() => sendSms({ to: '0241234567', message: 'cap test', kind: 'test' })));
    expect(r.filter((x) => x.status === 'sent')).toHaveLength(2); expect(r.filter((x) => x.status === 'cap_reached')).toHaveLength(2);
    expect(testOutbox).toHaveLength(2); expect((await SmsCounter.findOne().lean())!.n).toBe(2); await sms({ dailyCap: 300 });
  });
  it('logs masked numbers, never the message; provider failure is reported', async () => {
    await on(); testControl.fail = 'Insufficient balance';
    const f = await sendSms({ to: '0241234567', message: 'SECRET-BODY', kind: 'test' }); expect(f).toMatchObject({ status: 'failed', error: 'Insufficient balance' }); testControl.fail = null;
    const logs = await SmsLog.find().lean(); expect(JSON.stringify(logs)).not.toContain('0241234567'); expect(JSON.stringify(logs)).not.toContain('SECRET-BODY');
    expect(logs.some((l) => l.to === '024****567' && l.status === 'failed')).toBe(true);
  });
});

describe('phone verification by SMS code', () => {
  it('unavailable without SMS; with SMS: hashed 6-digit OTP sent as sms_type otp, verifies once', async () => {
    off(); const ama = await loginAs('ama@sample.ghlearn.test');
    expect((await ama.post('/api/account/phone').send({ phone: '0241110001' })).status).toBe(503);
    await on(); expect((await ama.post('/api/account/phone').send({ phone: '0301234567' })).status).toBe(422);
    const r = await ama.post('/api/account/phone').send({ phone: '+233 24 111 0001' }); expect(r.status).toBe(200); expect(r.body.phoneMasked).toBe('024****001');
    const m = testOutbox.at(-1)!; expect(m.otp).toBe(true); expect(m.to).toEqual(['0241110001']); expect(m.sender).toBe('GHLearn'); expect(m.message.length).toBeLessThanOrEqual(160); expect(m.message).toMatch(/^GH Learn code: \d{6}\./);
    const code = lastCode(); const row = await PhoneOtp.findOne().select('+codeHash').lean(); expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/); expect(JSON.stringify(row)).not.toContain(code);
    const mins = (+row!.expiresAt - Date.now()) / 60_000; expect(mins).toBeGreaterThan(9); expect(mins).toBeLessThanOrEqual(10);
    const g = await ama.get('/api/account/phone'); expect(g.body).toMatchObject({ phone: null, pending: { phoneMasked: '024****001' } });
    expect((await ama.post('/api/account/phone/verify').send({ code })).status).toBe(200);
    expect((await ama.post('/api/account/phone/verify').send({ code })).status).toBe(400);
    expect((await ama.get('/api/account/phone')).body).toMatchObject({ phone: '0241110001', pending: null });
    await settle(); const a = await AuditLog.find({ action: { $in: ['user.phone.otp', 'user.phone.verify'] } }).lean();
    expect(a.length).toBeGreaterThanOrEqual(2); expect(JSON.stringify(a)).not.toContain('0241110001'); expect(JSON.stringify(a)).not.toContain(code);
  });
  it('5 wrong codes void the code', async () => {
    await on(); const kofi = await loginAs('kofi@sample.ghlearn.test');
    await kofi.post('/api/account/phone').send({ phone: '0201110002' }); const code = lastCode(); const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 4; i++) expect((await kofi.post('/api/account/phone/verify').send({ code: wrong })).body.error.message).toMatch(`${5 - i}`);
    expect((await kofi.post('/api/account/phone/verify').send({ code: wrong })).body.error.message).toMatch(/Too many/);
    expect((await kofi.post('/api/account/phone/verify').send({ code })).status).toBe(400);
  });
  it('rate limits per user and per number; a verified number belongs to one account', async () => {
    await on(); const t = await loginAs('teacher@sample.ghlearn.test');
    for (let i = 0; i < OTP_LIMITS.perUserPerHour; i++) expect((await t.post('/api/account/phone').send({ phone: `05011100${10 + i}` })).status).toBe(200);
    expect((await t.post('/api/account/phone').send({ phone: '0501110099' })).status).toBe(429);
    await PhoneOtp.deleteMany({});
    const users = ['counselor', 'admin', 'editor', 'curriculum'].map((u) => `${u}@sample.ghlearn.test`);
    const res = []; for (const u of users) res.push((await (await loginAs(u)).post('/api/account/phone').send({ phone: '0571110003' })).status);
    expect(res).toEqual([200, 200, 200, 429]);
    const c = await loginAs('counselor@sample.ghlearn.test'); expect((await c.post('/api/account/phone').send({ phone: '0241110001' })).status).toBe(409); // Ama's
  });
  it('removing the number', async () => {
    await on(); const op = await loginAs('operator@sample.ghlearn.test'); await verify(op, '0261110004');
    expect((await op.delete('/api/account/phone')).status).toBe(204); expect((await op.get('/api/account/phone')).body.phone).toBeNull();
  });
});

describe('forgot password by SMS', () => {
  it('capability flag follows SMS availability; unavailable answer is the same for every number', async () => {
    off(); expect((await (await anon()).get('/api/settings/public')).body.passwordReset.sms).toBe(false);
    const a = await (await anon()).post('/api/auth/forgot-password').send({ identifier: '0241110001' });
    const b = await (await anon()).post('/api/auth/forgot-password').send({ identifier: '0249999999' });
    expect(a.status).toBe(200); expect(a.body).toEqual(b.body); expect(a.body.smsAvailable).toBe(false);
    await on(); expect((await (await anon()).get('/api/settings/public')).body.passwordReset.sms).toBe(true);
    expect((await (await anon()).post('/api/auth/forgot-password').send({ identifier: 'ama' })).status).toBe(422);
  });
  it('enumeration-safe; only a verified number gets a single-use 30-minute code (otp); reset revokes every session', async () => {
    await on(); await PasswordReset.deleteMany({}); const ama = await loginAs('ama@sample.ghlearn.test');
    await User.updateOne({ email: 'kofi@sample.ghlearn.test' }, { phone: '0201110002', $unset: { phoneVerifiedAt: 1 } }); // unverified
    const known = await (await anon()).post('/api/auth/forgot-password').send({ identifier: '+233241110001' }); await AuthRoutes.lastForgotJob;
    const unverified = await (await anon()).post('/api/auth/forgot-password').send({ identifier: '0201110002' }); await AuthRoutes.lastForgotJob;
    const unknown = await (await anon()).post('/api/auth/forgot-password').send({ identifier: '0249999999' }); await AuthRoutes.lastForgotJob;
    expect(known.body).toEqual(unverified.body); expect(known.body).toEqual(unknown.body); expect(known.body).toMatchObject({ channel: 'sms', smsAvailable: true });
    expect(testOutbox).toHaveLength(1); const m = testOutbox[0]; expect(m.to).toEqual(['0241110001']); expect(m.otp).toBe(true); expect(m.message.length).toBeLessThanOrEqual(160);
    const code = /code: ([A-Z0-9-]{14})/.exec(m.message)![1];
    const g = await PasswordReset.find().select('+codeHash').lean(); expect(g).toHaveLength(1); expect(g[0]).toMatchObject({ kind: 'self', channel: 'sms' }); expect(JSON.stringify(g)).not.toContain(code);
    expect((+g[0].expiresAt - +g[0].createdAt!) / 60_000).toBeCloseTo(30, 0);
    expect((await (await anon()).post('/api/auth/reset-password').send({ phone: '0249999999', code, newPassword: 'SmsReset2027x' })).status).toBe(400);
    await new Promise((r) => setTimeout(r, 1100));
    const r = await (await anon()).post('/api/auth/reset-password').send({ phone: '024 111 0001', code: code.toLowerCase(), newPassword: 'SmsReset2027x' }); expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await ama.get('/api/auth/me')).status).toBe(401);
    expect((await (await anon()).post('/api/auth/reset-password').send({ phone: '0241110001', code, newPassword: 'Another2028x' })).status).toBe(400);
    await loginAs('ama@sample.ghlearn.test', 'SmsReset2027x');
    await settle(); expect(JSON.stringify(await AuditLog.find({ action: 'auth.password.forgot' }).lean())).not.toMatch(/0241110001|0249999999/);
    await User.updateOne({ email: 'ama@sample.ghlearn.test' }, { passwordHash: (await User.findOne({ email: 'kofi@sample.ghlearn.test' }).select('passwordHash').lean())!.passwordHash });
  });
  it('per-account limit (3 an hour) applies to SMS too, silently', async () => {
    await on(); await PasswordReset.deleteMany({});
    for (let i = 0; i < 5; i++) { expect((await (await anon()).post('/api/auth/forgot-password').send({ identifier: '0241110001' })).status).toBe(200); await AuthRoutes.lastForgotJob; }
    expect(testOutbox).toHaveLength(3);
  });
});

describe('SMS notifications for meetings', () => {
  it('opt-in only, verified numbers only, meeting events only; preferences accept sms', async () => {
    await on(); const amaId = ctx.data.users.ama._id; const ama = await loginAs('ama@sample.ghlearn.test', 'SamplePass2026');
    await notify([amaId], { type: 'meeting.accept', title: 'Meeting confirmed: Careers', body: 'Teacher confirmed the meeting.' }); await flushEmails();
    expect((await Notification.findOne({ userId: amaId, type: 'meeting.accept' }).lean())!.delivery!.sms).toBe('opted_out'); expect(testOutbox).toHaveLength(0);
    const p = await ama.get('/api/notifications/preferences'); expect(p.body.sms).toEqual({ available: true, phoneVerified: true });
    expect(p.body.categories.find((c: any) => c.key === 'meetings')).toMatchObject({ sms: false, smsCapable: true });
    expect((await ama.put('/api/notifications/preferences').send({ categories: { meetings: { sms: true }, announcements: { sms: true } } })).status).toBe(200);
    const p2 = (await ama.get('/api/notifications/preferences')).body.categories;
    expect(p2.find((c: any) => c.key === 'meetings')).toMatchObject({ sms: true, inApp: true }); expect(p2.find((c: any) => c.key === 'announcements').sms).toBe(false);
    await notify([amaId], { type: 'meeting.decline', title: 'Meeting declined: Careers', body: 'Teacher declined.' }); await flushEmails();
    expect((await Notification.findOne({ userId: amaId, type: 'meeting.decline' }).lean())!.delivery!.sms).toBe('sent');
    expect(testOutbox.at(-1)!.message).toBe('GH Learn: Meeting declined: Careers. Teacher declined.'); expect(testOutbox.at(-1)!.otp).toBe(false);
    await notify([amaId], { type: 'meeting.cancel', title: 'Meeting cancelled', body: 'x' }); await flushEmails(); expect(testOutbox).toHaveLength(1);
    await notify([amaId], { type: 'announcement', title: 'News', body: 'x' }); await flushEmails(); expect(testOutbox).toHaveLength(1);
    const kofi = await loginAs('kofi@sample.ghlearn.test'); await kofi.put('/api/notifications/preferences').send({ categories: { meetings: { sms: true } } });
    await notify([ctx.data.users.kofi._id], { type: 'meeting.accept', title: 'Meeting confirmed', body: 'x' }); await flushEmails();
    expect((await Notification.findOne({ userId: ctx.data.users.kofi._id, type: 'meeting.accept' }).lean())!.delivery!.sms).toBe('no_number');
  });
  it('reminder job: once per confirmed meeting starting within the hour', async () => {
    await on(); const { ama, teacher } = ctx.data.users; const start = new Date(Date.now() + 30 * 60_000);
    const m = await Meeting.create({ studentId: ama._id, hostId: teacher._id, schoolId: ctx.data.school._id, start, end: new Date(+start + 30 * 60_000), topic: 'Careers', mode: 'in_person', location: 'Room 4', status: 'confirmed' });
    await Meeting.create({ studentId: ama._id, hostId: teacher._id, schoolId: ctx.data.school._id, start: new Date(Date.now() + 3 * 3600_000), end: new Date(Date.now() + 4 * 3600_000), topic: 'Later', mode: 'in_person', status: 'confirmed' });
    expect(await sendDueReminders()).toEqual({ due: 1, reminded: 1 }); await flushEmails();
    const n = await Notification.find({ type: 'meeting.reminder' }).lean(); expect(n.map((x) => String(x.userId)).sort()).toEqual([String(ama._id), String(teacher._id)].sort());
    expect(testOutbox.at(-1)!.message).toMatch(/^GH Learn: Meeting reminder: Careers\. With Biology Teacher.*Room 4/); expect(testOutbox.at(-1)!.message.length).toBeLessThanOrEqual(160);
    expect(await sendDueReminders()).toEqual({ due: 0, reminded: 0 });
    await Meeting.updateOne({ _id: m._id }, { $unset: { reminderSentAt: 1 }, status: 'cancelled', active: false }); expect((await sendDueReminders()).due).toBe(0);
  });
});

describe('admin SMS panel (super admins)', () => {
  it('status hides the key; test send is masked and audited; log masked; delivery refresh; sender registration audited', async () => {
    await on(); const sa = await loginAs('super@sample.ghlearn.test');
    for (const u of ['admin', 'teacher', 'operator']) expect((await (await loginAs(`${u}@sample.ghlearn.test`)).get('/api/admin/sms/status')).status, u).toBe(403);
    const st = await sa.get('/api/admin/sms/status?refresh=1'); expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ configured: true, provider: 'test', available: true, senderId: 'GHLearn', senderSource: 'settings', dailyCap: 300, live: { balance: { ok: true, smsCredits: 120 }, senderStatus: { ok: true, status: 'approved' } } });
    expect(typeof st.body.keyPresent).toBe('boolean'); expect(JSON.stringify(st.body)).not.toMatch(/BMS_API_KEY|"key"/);
    const t = await sa.post('/api/admin/sms/test').send({ phone: '0551110005' }); expect(t.body).toMatchObject({ status: 'sent', to: '055****005', network: 'MTN' });
    expect(testOutbox.at(-1)!.message).toBe('GH Learn SMS test'); expect(testOutbox.at(-1)!.otp).toBe(false);
    expect((await sa.post('/api/admin/sms/test').send({ phone: '0301234567' })).status).toBe(422);
    await settle(); expect(await AuditLog.exists({ action: 'sms.test', 'meta.to': '055****005' })).toBeTruthy();
    const log = await sa.get('/api/admin/sms/log?limit=5'); expect(log.body.items.length).toBeGreaterThan(0); expect(log.body.items.length).toBeLessThanOrEqual(5);
    expect(JSON.stringify(log.body)).not.toMatch(/0551110005|0241110001/); expect(log.body.items[0]).toMatchObject({ kind: 'test', to: '055****005', status: 'sent' });
    const d = await sa.post(`/api/admin/sms/log/${log.body.items[0]._id}/delivery`); expect(d.body.log.delivery).toBe('delivered');
    const reg = await sa.post('/api/admin/sms/sender/register').send({ name: 'GHLearn', purpose: 'Verification codes and meeting notices' }); expect(reg.body).toEqual({ ok: true, status: 'pending' });
    await settle(); expect(await AuditLog.exists({ action: 'sms.sender.register', target: 'GHLearn' })).toBeTruthy();
  });
  it('daily cap and sender ID are edited through audited settings; the key cannot be stored there', async () => {
    await on(); const sa = await loginAs('super@sample.ghlearn.test');
    const r = await sa.patch('/api/admin/settings').send({ sms: { dailyCap: 150, senderId: 'GHLearn' } }); expect(r.status, JSON.stringify(r.body)).toBe(200);
    await settle(); const a = await AuditLog.findOne({ action: 'settings.update' }).sort({ createdAt: -1 }).lean(); expect(JSON.stringify(a)).toContain('dailyCap'); expect(a!.meta).toMatchObject({ sections: ['sms'] });
    expect((await sa.get('/api/admin/sms/status')).body.dailyCap).toBe(150);
    expect((await sa.patch('/api/admin/settings').send({ sms: { apiKey: 'x' } })).status).toBe(422);
    expect((await sa.patch('/api/admin/settings').send({ sms: { senderId: 'TooLongSenderName' } })).status).toBe(422);
    expect((await sa.patch('/api/admin/settings').send({ sms: { dailyCap: -1 } })).status).toBe(422);
    await sa.patch('/api/admin/settings').send({ sms: { dailyCap: 300 } });
  });
});
