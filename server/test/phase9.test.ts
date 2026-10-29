import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { useDb, ctx, loginAs } from './setup.js';
import { AiUsage, AiAlert, AuditLog, Notification, Announcement, User, Question, Job, AiHealthCheck } from '../src/models/index.js';
import { useTestLlm, noLlm, testLlm } from './llmfake.js';
import { updateAiSettings, getAiSettings, clearAiSettingsCache } from '../src/services/aiSettings.js';
import { generate, budgetStatus } from '../src/services/usage.js';
import { config } from '../src/config.js';
import { drain } from '../src/services/queue.js';
import { sentForTest, resetMailer } from '../src/services/mailer.js';
import { flushEmails } from '../src/services/notify.js';
import { readXlsx, binary } from './xlsx.js';
useDb();
const id = (x: any) => String(x._id);
const SUPER = () => id(ctx.data.users.superAdmin);
const settle = () => new Promise((r) => setTimeout(r, 60));
const gen = (userId: string, purpose = 'tutor', content = 'hi', maxTokens = 50) => generate({ system: 's', messages: [{ role: 'user', content }], maxTokens }, { purpose, userId });
let defaults: any;
beforeAll(async () => { useTestLlm(); defaults = await getAiSettings(); });
const KEYS = ['platformDailyRequests', 'perUserDailyRequests', 'schoolDailyRequests', 'schoolBudgets', 'maxInputChars', 'maxOutputTokens', 'maxRetries', 'timeoutSec', 'allowedFeatures', 'alertThresholdPct'];
afterEach(async () => { testLlm.rateLimit = 0; testLlm.fail = 0; await updateAiSettings(Object.fromEntries(KEYS.map((k) => [k, defaults[k]])) as any, SUPER()); });
afterAll(() => { (config as any).SMTP_URL = undefined; resetMailer(); });

describe('§17 AI limits are stored in the DB and enforced on the server', () => {
  it('per-user daily limit: refused calls never reach the provider and are recorded as limit_exceeded', async () => {
    await updateAiSettings({ perUserDailyRequests: 2 }, SUPER());
    const ama = id(ctx.data.users.ama); testLlm.calls.length = 0;
    await gen(ama); await gen(ama);
    await expect(gen(ama)).rejects.toMatchObject({ code: 'USER_LIMIT' });
    expect(testLlm.calls.length).toBe(2);
    expect(await AiUsage.countDocuments({ userId: ctx.data.users.ama._id, status: 'limit_exceeded' })).toBe(1);
    await gen(id(ctx.data.users.kofi)); // other users unaffected
    await updateAiSettings({ perUserDailyRequests: defaults.perUserDailyRequests }, SUPER());
  });
  it('school budget (per-school override) and platform budget', async () => {
    await updateAiSettings({ schoolBudgets: [{ schoolId: id(ctx.data.school), dailyRequests: 3 }] }, SUPER());
    await expect(gen(id(ctx.data.users.teacher))).rejects.toMatchObject({ code: 'SCHOOL_LIMIT' }); // Ama 2 + Kofi 1 already used
    await gen(id(ctx.data.users.editor)); // no school: not limited by it
    await updateAiSettings({ schoolBudgets: [], platformDailyRequests: 1 }, SUPER());
    await expect(gen(id(ctx.data.users.editor))).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    const b = await budgetStatus(); expect(b.requests).toBeGreaterThanOrEqual(b.requestBudget);
    await updateAiSettings({ platformDailyRequests: defaults.platformDailyRequests }, SUPER());
  });
  it('switched-off features, input size and output-token clamp', async () => {
    await updateAiSettings({ allowedFeatures: defaults.allowedFeatures.filter((f: string) => f !== 'tutor'), maxInputChars: 1000, maxOutputTokens: 300 }, SUPER());
    await expect(gen(SUPER())).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    await expect(gen(SUPER(), 'lesson.generate', 'x'.repeat(1001))).rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' });
    testLlm.calls.length = 0; await gen(SUPER(), 'lesson.generate', 'hi', 4000); expect(testLlm.calls[0].maxTokens).toBe(300);
    await updateAiSettings({ allowedFeatures: defaults.allowedFeatures, maxInputChars: defaults.maxInputChars, maxOutputTokens: defaults.maxOutputTokens }, SUPER());
  });
  it('HTTP: limits map to 403/413/429 with a code (analytics recommendation endpoint)', async () => {
    await updateAiSettings({ perUserDailyRequests: 0 }, SUPER());
    const a = await loginAs('super@sample.ghlearn.test');
    const r = await a.post('/api/analytics/recommendations').send({}); expect([200, 429]).toContain(r.status);
    if (r.status === 200) expect(r.body.text).toBeNull(); else expect(r.body.error.code).toBe('USER_LIMIT');
    await updateAiSettings({ perUserDailyRequests: defaults.perUserDailyRequests }, SUPER());
  });
  it('retries and rate-limit events are counted; timeout setting is applied', async () => {
    await updateAiSettings({ maxRetries: 2, timeoutSec: 7 }, SUPER());
    testLlm.rateLimit = 2; testLlm.calls.length = 0;
    await gen(SUPER(), 'lesson.generate');
    const u: any = await AiUsage.findOne({ purpose: 'lesson.generate', status: 'ok' }).sort({ createdAt: -1 }).lean();
    expect(u.rateLimitHits).toBe(2); expect(u.retries).toBe(2); expect(testLlm.calls.at(-1)!.timeoutMs).toBe(7000);
    testLlm.rateLimit = 5; await updateAiSettings({ maxRetries: 0 }, SUPER());
    await expect(gen(SUPER(), 'lesson.generate')).rejects.toThrow();
    const f: any = await AiUsage.findOne({ status: 'rate_limited' }).lean(); expect(f.httpStatus).toBe(429);
    testLlm.rateLimit = 0; await updateAiSettings({ maxRetries: defaults.maxRetries, timeoutSec: defaults.timeoutSec }, SUPER());
  });
  it('budget threshold alert notifies super admins once per day', async () => {
    await AiAlert.deleteMany({}); await updateAiSettings({ platformDailyRequests: (await budgetStatus()).requests + 2, alertThresholdPct: 50 }, SUPER());
    await gen(SUPER(), 'lesson.generate'); await gen(SUPER(), 'lesson.generate'); await settle();
    const n = await Notification.find({ userId: ctx.data.users.superAdmin._id, type: 'ai.budget' }).lean(); expect(n.length).toBeGreaterThanOrEqual(1);
    const before = n.length; await gen(SUPER(), 'lesson.generate').catch(() => undefined); await settle();
    expect(await Notification.countDocuments({ userId: ctx.data.users.superAdmin._id, type: 'ai.budget' })).toBeLessThanOrEqual(before + 1); // at most one more ("full")
    await updateAiSettings({ platformDailyRequests: defaults.platformDailyRequests, alertThresholdPct: defaults.alertThresholdPct }, SUPER());
  });
});

describe('§17 AI admin API', () => {
  it('settings: secrets only as set / not set; super edits, operator reads, others denied; validation strict', async () => {
    (config as any).GEMINI_API_KEY = 'AIzaFAKE-secret-value-123'; const s = await loginAs('super@sample.ghlearn.test');
    const r = await s.get('/api/admin/ai/settings'); expect(r.status).toBe(200); expect(JSON.stringify(r.body)).not.toContain('AIzaFAKE');
    expect(r.body.secrets.find((x: any) => x.name === 'GEMINI_API_KEY')).toMatchObject({ set: true }); expect(r.body.canEdit).toBe(true);
    (config as any).GEMINI_API_KEY = undefined;
    const op = await loginAs('operator@sample.ghlearn.test'); const o = await op.get('/api/admin/ai/settings'); expect(o.status).toBe(200); expect(o.body.canEdit).toBe(false);
    for (const e of ['admin', 'teacher', 'editor', 'ama']) expect((await (await loginAs(`${e}@sample.ghlearn.test`)).get('/api/admin/ai/settings')).status).toBe(403);
    expect((await s.patch('/api/admin/ai/settings').send({ maxRetries: 99 })).status).toBe(422);
    expect((await s.patch('/api/admin/ai/settings').send({ bogus: 1 })).status).toBe(422);
    expect((await s.patch('/api/admin/ai/settings').send({ schoolBudgets: [{ schoolId: '0123456789abcdef01234567', dailyRequests: 5 }] })).status).toBe(400);
    const p = await s.patch('/api/admin/ai/settings').send({ perUserDailyRequests: 12 }); expect(p.status).toBe(200); expect(p.body.changed).toEqual(['perUserDailyRequests']);
    clearAiSettingsCache(); expect((await getAiSettings()).perUserDailyRequests).toBe(12); expect((await getAiSettings()).maxRetries).toBe(defaults.maxRetries); // other keys untouched
    await updateAiSettings({ perUserDailyRequests: defaults.perUserDailyRequests }, SUPER());
  });
  it('health checks: a failure is never shown as success; unconfigured is not_configured; audited', async () => {
    const s = await loginAs('super@sample.ghlearn.test');
    useTestLlm(); testLlm.fail = 10; await updateAiSettings({ maxRetries: 0 }, SUPER());
    const bad = await s.post('/api/admin/ai/health').send({ capabilities: ['llm'] }); expect(bad.status).toBe(200);
    expect(bad.body.ok).toBe(false); expect(bad.body.results[0]).toMatchObject({ capability: 'llm', status: 'failed' });
    testLlm.fail = 0; testLlm.calls.length = 0;
    const good = await s.post('/api/admin/ai/health').send({ capabilities: ['llm', 'object_storage'] });
    expect(testLlm.calls[0]).toMatchObject({ maxAttempts: 1, timeoutMs: 45_000 }); // bounded inside the check: no late success after a reported timeout
    expect(good.body.results.find((x: any) => x.capability === 'llm').status).toBe('ok'); expect(good.body.results.find((x: any) => x.capability === 'object_storage').status).toBe('ok');
    noLlm(); const none = await s.post('/api/admin/ai/health').send({ capabilities: ['llm'] }); expect(none.body.results[0].status).toBe('not_configured'); expect(none.body.results[0].status).not.toBe('ok');
    useTestLlm(); await updateAiSettings({ maxRetries: defaults.maxRetries }, SUPER());
    await settle(); expect(await AuditLog.countDocuments({ action: 'ai.health_check', outcome: 'failure' })).toBeGreaterThanOrEqual(1);
    expect(await AiHealthCheck.countDocuments()).toBe(3);
    const op = await loginAs('operator@sample.ghlearn.test'); expect((await op.get('/api/admin/ai/health')).status).toBe(200);
    expect((await (await loginAs('admin@sample.ghlearn.test')).post('/api/admin/ai/health').send({})).status).toBe(403);
  });
  it('usage report: by provider, feature, school, user; estimated cost labelled; scoped per role; exports audited', async () => {
    const s = await loginAs('super@sample.ghlearn.test'); const r = await s.get('/api/admin/ai/usage'); expect(r.status).toBe(200);
    expect(r.body.totals.requests).toBeGreaterThan(5); expect(r.body.totals.refused).toBeGreaterThan(0); expect(r.body.labels.cost).toMatch(/Estimated cost, not a bill/);
    expect(r.body.byFeature.map((x: any) => x.label).join()).toMatch(/tutor/i); expect(r.body.byProvider[0].provider).toBe('test-llm');
    expect(r.body.bySchool.length).toBeGreaterThan(0); expect(r.body.byUser.length).toBeGreaterThan(0); expect(r.body.rateLimit).toBeTruthy(); expect(r.body.failures.length).toBeGreaterThan(0);
    const sa = await loginAs('admin@sample.ghlearn.test'); const m = await sa.get('/api/admin/ai/usage'); expect(m.body.scope).toBe('school'); expect(m.body.budgets.platform).toBeUndefined(); expect(m.body.budgets.school).toBeTruthy();
    expect(m.body.byUser.every((u: any) => [id(ctx.data.users.ama), id(ctx.data.users.kofi), id(ctx.data.users.teacher)].includes(u.userId))).toBe(true);
    expect((await sa.get('/api/admin/ai/usage').query({ schoolId: '0123456789abcdef01234567' })).status).toBe(403);
    const cur = await loginAs('curriculum@sample.ghlearn.test'); const c = await cur.get('/api/admin/ai/usage'); expect(c.body.byUser).toBeFalsy(); expect(c.body.bySchool).toBeFalsy();
    expect((await cur.get('/api/admin/ai/usage/export').query({ report: 'byUser', format: 'csv' })).status).toBe(400);
    for (const e of ['teacher', 'editor', 'ama']) expect((await (await loginAs(`${e}@sample.ghlearn.test`)).get('/api/admin/ai/usage')).status).toBe(403);
    const csv = await s.get('/api/admin/ai/usage/export').query({ report: 'byFeature', format: 'csv' }); expect(csv.status).toBe(200); expect(csv.text).toMatch(/Estimated cost \(USD\)/);
    const x = await s.get('/api/admin/ai/usage/export').query({ report: 'failures', format: 'xlsx' }).buffer(true).parse(binary); expect(x.status).toBe(200);
    expect((await readXlsx(x.body)).texts.join(' ')).toMatch(/Estimated cost, not a bill/);
    await settle(); expect(await AuditLog.countDocuments({ action: 'report.export', 'meta.report': { $in: ['AI usage by feature', 'AI failed and refused requests'] } })).toBe(2);
  });
});

const ann = (over: any = {}) => ({ scope: 'school', title: 'Sports day', body: 'Sports day is on Friday. Bring your house colours.', audience: { roles: ['student'] }, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), ...over });
describe('§18 notifications', () => {
  it('school announcement: audience, publish period, delivery recorded per channel, email only when configured', async () => {
    const a = await loginAs('admin@sample.ghlearn.test');
    expect((await a.post('/api/announcements/preview-audience').send(ann())).body.recipients).toBe(2);
    const c = await a.post('/api/announcements').send(ann({ email: true })); expect(c.status).toBe(201); expect(c.body.announcement.status).toBe('draft');
    const p = await a.post(`/api/announcements/${c.body.announcement._id}/publish`).send({}); expect(p.status).toBe(202);
    await drain(); await flushEmails();
    const n = await Notification.find({ announcementId: c.body.announcement._id }).lean(); expect(n.length).toBe(2);
    expect(n.every((x: any) => x.delivery.inApp === 'delivered' && x.delivery.email === 'not_configured')).toBe(true); // no SMTP: never pretends to send
    const ama = await loginAs('ama@sample.ghlearn.test'); const inbox = await ama.get('/api/notifications'); expect(inbox.body.items.some((x: any) => x.title === 'Sports day')).toBe(true);
    expect((await (await loginAs('teacher@sample.ghlearn.test')).get('/api/notifications')).body.items.some((x: any) => x.title === 'Sports day')).toBe(false); // not in the audience
    const d = await a.get(`/api/announcements/${c.body.announcement._id}`); expect(d.body.announcement.delivery).toBeTruthy();
    const w = await a.post(`/api/announcements/${c.body.announcement._id}/withdraw`).send({}); expect(w.status).toBe(200);
    expect((await ama.get('/api/notifications')).body.items.some((x: any) => x.title === 'Sports day')).toBe(false);
    await settle(); for (const act of ['announcement.create', 'announcement.publish', 'announcement.withdraw']) expect(await AuditLog.countDocuments({ action: act })).toBeGreaterThanOrEqual(1);
  });
  it('email is sent and recorded when SMTP is configured, honouring preferences', async () => {
    (config as any).SMTP_URL = 'json'; resetMailer(); sentForTest.length = 0;
    const kofi = await loginAs('kofi@sample.ghlearn.test');
    const prefs = await kofi.get('/api/notifications/preferences'); expect(prefs.body.emailConfigured).toBe(true);
    expect((await kofi.put('/api/notifications/preferences').send({ categories: { announcements: { inApp: true, email: false }, security: { inApp: false, email: true } } })).status).toBe(200);
    const after = await kofi.get('/api/notifications/preferences'); expect(after.body.categories.find((x: any) => x.key === 'security').inApp).toBe(true); // mandatory
    const s = await loginAs('super@sample.ghlearn.test');
    const c = await s.post('/api/announcements').send(ann({ scope: 'system', title: 'Maintenance window', body: 'GH Learn will be unavailable on Sunday from 02:00 to 03:00.', email: true }));
    expect(c.status).toBe(201); await s.post(`/api/announcements/${c.body.announcement._id}/publish`).send({}); await drain(); await flushEmails();
    const ama = await Notification.findOne({ announcementId: c.body.announcement._id, userId: ctx.data.users.ama._id }).lean(); expect(ama!.delivery!.email).toBe('sent');
    const k = await Notification.findOne({ announcementId: c.body.announcement._id, userId: ctx.data.users.kofi._id }).lean(); expect(k!.delivery!.email).toBe('opted_out');
    expect(sentForTest.some((m: any) => m.subject.includes('Maintenance window') && JSON.stringify(m).includes('ama@sample'))).toBe(true);
    (config as any).SMTP_URL = undefined; resetMailer();
  });
  it('scheduled announcements publish at their start and hide after their end', async () => {
    const a = await loginAs('admin@sample.ghlearn.test');
    const c = await a.post('/api/announcements').send(ann({ title: 'Exam timetable', body: 'The exam timetable is on the notice board.', publishAt: new Date(Date.now() + 3600000).toISOString() }));
    const p = await a.post(`/api/announcements/${c.body.announcement._id}/publish`).send({}); expect(p.body.announcement.status).toBe('scheduled');
    const job: any = await Job.findById(p.body.jobId).lean(); expect(new Date(job.runAt).getTime()).toBeGreaterThan(Date.now() + 3500000);
    expect(await Notification.countDocuments({ announcementId: c.body.announcement._id })).toBe(0);
  });
  it('privacy: no student personal data in broad announcements; school admins cannot target other schools or platform roles', async () => {
    const a = await loginAs('admin@sample.ghlearn.test');
    for (const body of ['Congratulations to Ama Mensah for winning.', 'Call 024 123 4567 for details.', 'Write to kofi@sample.ghlearn.test.']) {
      const r = await a.post('/api/announcements').send(ann({ body })); expect(r.status).toBe(422); expect(r.body.error.code).toBe('PERSONAL_DATA');
    }
    expect((await a.post('/api/announcements').send(ann({ scope: 'system' }))).status).toBe(403);
    expect((await a.post('/api/announcements').send(ann({ audience: { roles: ['super_admin'] } }))).status).toBe(400);
    expect((await a.post('/api/announcements').send(ann({ expiresAt: new Date(Date.now() + 400 * 86400000).toISOString() }))).status).toBe(400);
    for (const e of ['teacher', 'ama', 'editor', 'operator']) expect((await (await loginAs(`${e}@sample.ghlearn.test`)).post('/api/announcements').send(ann())).status).toBe(403);
    const s = await loginAs('super@sample.ghlearn.test'); const sys = await s.post('/api/announcements').send(ann({ scope: 'system', title: 'Holiday', body: 'Enjoy the holiday.' }));
    expect((await a.get(`/api/announcements/${sys.body.announcement._id}`)).status).toBe(404); // school admins do not see system announcements
  });
  it('event notifications: publication, processing failure, review reminders, security', async () => {
    const { notifyProcessingFailed, sendReviewReminders } = await import('../src/services/eventNotifications.js');
    await notifyProcessingFailed({ _id: 'j1', type: 'document.process', documentId: ctx.data.doc._id } as any, 'OCR failed'); await settle();
    expect(await Notification.countDocuments({ type: 'processing.failed', userId: ctx.data.users.operator._id })).toBe(1);
    await Question.create({ ...(({ _id, ...x }: any) => x)((await import('./questionSamples.js')).SAMPLES.mcq), subjectId: ctx.data.bio._id, topic: 'Cells', stem: 'Reminder question?', status: 'in_review', version: 1, createdBy: ctx.data.users.editor._id, submittedAt: new Date(Date.now() - 3 * 86400000) });
    const r = await sendReviewReminders({ force: true }); expect(r.notified).toBeGreaterThan(0);
    expect(await Notification.countDocuments({ type: 'review.reminder' })).toBeGreaterThan(0);
    const rv = await loginAs('super@sample.ghlearn.test'); expect((await rv.post('/api/announcements/review-reminders').send({})).status).toBe(200);
    expect((await (await loginAs('teacher@sample.ghlearn.test')).post('/api/announcements/review-reminders').send({})).status).toBe(403);
    const a = await loginAs('teacher@sample.ghlearn.test'); await a.post('/api/auth/change-password').send({ currentPassword: 'SamplePass2026', newPassword: 'TeacherNew2026!' }); await settle(); await settle();
    expect(await Notification.countDocuments({ type: 'security.password', userId: ctx.data.users.teacher._id })).toBe(1);
    const q = await Question.findOne({ stem: 'Reminder question?' }); const s = await loginAs('super@sample.ghlearn.test');
    await s.post(`/api/questions/${id(q)}/review`).send({ action: 'approve', answerKeyVerified: true }); await settle();
    expect(await Notification.countDocuments({ type: 'content.published', userId: ctx.data.users.editor._id })).toBeGreaterThanOrEqual(1);
  });
});
