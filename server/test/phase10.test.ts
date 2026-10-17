import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { useDb, ctx, loginAs, anon } from './setup.js';
import { AuditLog, Notification, AiUsage, Job, AcademicYear, User, PlatformSettings, TutorConversation, Announcement } from '../src/models/index.js';
import { getSettings, clearSettingsCache, DEFAULTS, updateSettings } from '../src/services/platformSettings.js';
import { purgeExpired, retentionPreview } from '../src/services/retention.js';
import { sendReviewReminders } from '../src/services/eventNotifications.js';
import { notify } from '../src/services/notify.js';
import { useTestLlm } from './llmfake.js';
import { getLlm } from '../src/services/ai.js';
import { getAiSettings, updateAiSettings } from '../src/services/aiSettings.js';
import { config } from '../src/config.js';
import { hashPassword } from '../src/services/auth.js';
useDb();
const E = { super: 'super@sample.ghlearn.test', admin: 'admin@sample.ghlearn.test', operator: 'operator@sample.ghlearn.test', teacher: 'teacher@sample.ghlearn.test', ama: 'ama@sample.ghlearn.test', editor: 'editor@sample.ghlearn.test' };
const SUPER = () => String(ctx.data.users.superAdmin._id);
const settle = () => new Promise((r) => setTimeout(r, 60));
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]).toString('base64');
async function reset() { await PlatformSettings.deleteMany({}); clearSettingsCache(); }
afterEach(reset);
beforeAll(() => useTestLlm());

describe('§20 settings: storage, validation, confirmation and audit', () => {
  it('defaults are returned before anything is saved; operators can read but not edit; others are refused', async () => {
    const s = await loginAs(E.super); const g = await s.get('/api/admin/settings');
    expect(g.status).toBe(200); expect(g.body.settings).toEqual(JSON.parse(JSON.stringify(DEFAULTS()))); expect(g.body.canEdit).toBe(true);
    expect(g.body.review).toMatchObject({ mandatoryReview: true, selfApproval: false }); expect(g.body.academic.years.length).toBeGreaterThan(0);
    const op = await loginAs(E.operator); expect((await op.get('/api/admin/settings')).body.canEdit).toBe(false);
    expect((await op.patch('/api/admin/settings').send({ branding: { appName: 'X Learn' } })).status).toBe(403);
    for (const e of [E.admin, E.teacher, E.ama, E.editor]) { const a = await loginAs(e); expect((await a.get('/api/admin/settings')).status).toBe(403); expect((await a.patch('/api/admin/settings').send({ branding: { appName: 'Hack' } })).status).toBe(403); }
    expect((await (await anon()).get('/api/admin/settings')).status).toBe(401);
  });
  it('validation: unknown sections/keys, bad values, env ceilings, bad logos (422)', async () => {
    const s = await loginAs(E.super); const bad = async (body: any) => { const r = await s.patch('/api/admin/settings').send(body); expect(r.status, JSON.stringify(body)).toBe(422); return r; };
    await bad({ branding: { appName: 'A' } }); await bad({ branding: { colour: 'red' } }); await bad({ secrets: { geminiKey: 'x' } });
    await bad({ theme: { preset: 'neon' } }); await bad({ uploads: { maxUploadMb: config.UPLOAD_MAX_MB + 1 } }); await bad({ uploads: { formats: [] } }); await bad({ uploads: { formats: ['exe'] } });
    await bad({ retention: { auditDays: 100 } }); await bad({ sessions: { accessMinutes: 600 } }); await bad({ sessions: { lockoutAttempts: 1 } });
    await bad({ branding: { logo: 'data:image/svg+xml;base64,PHN2Zz4=' } }); await bad({ branding: { logo: 'data:image/png;base64,' + Buffer.from('not a png').toString('base64') } });
    await bad({ branding: { logo: 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(160 * 1024)]).toString('base64') } });
    await bad({}); await bad({ maintenance: { until: 'not a date' } });
    expect((await s.patch('/api/admin/settings').send({ branding: { logo: PNG, appName: 'Accra Learn' }, theme: { preset: 'blue' } })).status).toBe(200);
  });
  it('no secrets in the database: credential-looking values and env secret values are refused', async () => {
    const s = await loginAs(E.super);
    for (const v of ['AIza' + 'x'.repeat(35), 'sk-' + 'a'.repeat(30), 'mongodb+srv://u:p@cluster.example', '-----BEGIN RSA PRIVATE KEY-----', config.JWT_ACCESS_SECRET]) {
      const r = await s.patch('/api/admin/settings').send({ branding: { tagline: `contact ${v}`.slice(0, 120) } }); expect(r.status).toBe(422); expect(r.body.error.code).toBe('SECRET_REJECTED');
    }
    const r = await s.patch('/api/admin/settings').send({ legal: { terms: `Our key is ${'AIza' + 'y'.repeat(35)}` }, confirm: true }); expect(r.body.error.code).toBe('SECRET_REJECTED');
    expect(await PlatformSettings.countDocuments()).toBe(0);
  });
  it('high-impact changes need confirm:true (409 with the list), then save; every change is audited with a diff', async () => {
    const s = await loginAs(E.super); await settle(); const t0 = new Date();
    const c = await s.post('/api/admin/settings/check').send({ maintenance: { enabled: true }, features: { games: false } });
    expect(c.body.changes.map((x: any) => x.key).sort()).toEqual(['features.games', 'maintenance.enabled']);
    const r = await s.patch('/api/admin/settings').send({ features: { games: false }, retention: { jobDays: 30 } });
    expect(r.status).toBe(409); expect(r.body.error.code).toBe('CONFIRM_REQUIRED'); expect(r.body.error.details.changes.map((x: any) => x.key)).toEqual(['features.games', 'retention.jobDays']);
    expect((await getSettings()).features.games).toBe(true);
    const ok = await s.patch('/api/admin/settings').send({ features: { games: false }, retention: { jobDays: 30 }, confirm: true });
    expect(ok.status).toBe(200); expect(ok.body.changed.sort()).toEqual(['features.games', 'retention.jobDays']);
    // low-impact change needs no confirmation
    expect((await s.patch('/api/admin/settings').send({ branding: { tagline: 'New tagline' } })).status).toBe(200);
    await settle();
    const logs = await AuditLog.find({ action: 'settings.update', createdAt: { $gte: t0 } }).sort({ createdAt: 1 }).lean();
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ entityType: 'settings', before: { 'features.games': true, 'retention.jobDays': 90 }, after: { 'features.games': false, 'retention.jobDays': 30 } });
    expect((logs[0].meta as any)).toMatchObject({ confirmed: true, highImpact: ['features.games', 'retention.jobDays'] });
    expect(logs[1].after).toEqual({ 'branding.tagline': 'New tagline' });
    // an identical save changes nothing and writes no audit entry
    await s.patch('/api/admin/settings').send({ branding: { tagline: 'New tagline' } }); await settle();
    expect(await AuditLog.countDocuments({ action: 'settings.update', createdAt: { $gte: t0 } })).toBe(2);
  });
  it('academic year: changing the current year needs confirmation and is audited', async () => {
    const y = await AcademicYear.create({ label: '2031/2032', startDate: new Date('2031-09-01'), endDate: new Date('2032-07-31') });
    const s = await loginAs(E.super);
    const r = await s.post('/api/admin/settings/academic-year').send({ yearId: String(y._id) }); expect(r.status).toBe(409);
    expect((await s.post('/api/admin/settings/academic-year').send({ yearId: String(y._id), confirm: true })).body).toMatchObject({ current: '2031/2032', changed: true });
    expect(await AcademicYear.countDocuments({ current: true })).toBe(1);
    await settle(); expect(await AuditLog.findOne({ action: 'settings.academic_year' }).lean()).toMatchObject({ after: { currentYear: '2031/2032' } });
    expect((await (await loginAs(E.operator)).post('/api/admin/settings/academic-year').send({ yearId: String(y._id), confirm: true })).status).toBe(403);
  });
});

describe('§20 public settings, branding and legal text', () => {
  it('public endpoint gives branding, theme colours, features and legal status, and nothing internal', async () => {
    const s = await loginAs(E.super);
    await s.patch('/api/admin/settings').send({ branding: { appName: 'Volta Learn', logo: PNG }, theme: { preset: 'purple' }, legal: { terms: 'Be kind.', privacy: 'We keep little.' }, confirm: true });
    const p = await (await anon()).get('/api/settings/public');
    expect(p.status).toBe(200); expect(p.body.branding).toMatchObject({ appName: 'Volta Learn', logo: PNG }); expect(p.body.theme).toMatchObject({ preset: 'purple', colors: { 700: '#6d28d9' } });
    expect(p.body.legal).toMatchObject({ version: 1, terms: true, privacy: true }); expect(p.body).not.toHaveProperty('retention'); expect(p.body).not.toHaveProperty('sessions');
    const t = await (await anon()).get('/api/settings/legal/terms'); expect(t.body).toMatchObject({ text: 'Be kind.', version: 1 });
    expect((await (await anon()).get('/api/settings/legal/other')).status).toBe(404);
    await s.patch('/api/admin/settings').send({ legal: { privacy: 'We keep very little.' }, confirm: true });
    expect((await (await anon()).get('/api/settings/public')).body.legal.version).toBe(2);
  });
});

describe('§20 enforcement on the server', () => {
  it('maintenance mode: non-admins get 503 (API, login, refresh, register); admins are exempt; logout still works', async () => {
    const ama = await loginAs(E.ama); const teacher = await loginAs(E.teacher); const admin = await loginAs(E.admin);
    await updateSettings({ maintenance: { enabled: true, message: 'Upgrading the servers', until: null } }, SUPER(), true);
    const r = await ama.get('/api/auth/me'); expect(r.status).toBe(503); expect(r.body.error).toMatchObject({ code: 'MAINTENANCE', message: 'Upgrading the servers' });
    expect((await teacher.get('/api/teacher/classes')).status).toBe(503);
    expect((await ama.post('/api/auth/refresh')).status).toBe(503);
    const fresh = await anon(); const l = await fresh.post('/api/auth/login').send({ email: E.ama, password: 'SamplePass2026' }); expect(l.status).toBe(503);
    expect((await (await anon()).post('/api/auth/register').send({ email: 'new@x.test', fullName: 'New Person', password: 'GoodPass123!', dateOfBirth: '2008-01-01' })).status).toBe(503);
    expect((await admin.get('/api/auth/me')).status).toBe(200); expect((await admin.get('/api/admin/overview')).status).not.toBe(503);
    expect((await loginAs(E.super)).get).toBeTruthy(); // admins can still sign in
    expect((await (await anon()).get('/api/settings/public')).body.maintenance).toMatchObject({ enabled: true, message: 'Upgrading the servers' });
    expect((await ama.post('/api/auth/logout')).status).toBeLessThan(300);
    await settle(); expect(await AuditLog.exists({ action: 'auth.login.failure', 'meta.reason': 'maintenance' })).toBeTruthy();
    await updateSettings({ maintenance: { enabled: false } }, SUPER(), true);
    expect((await teacher.get('/api/auth/me')).status).toBe(200);
  });
  it('feature flags switch features off for everyone on the server', async () => {
    const ama = await loginAs(E.ama); const t = await loginAs(E.teacher);
    expect((await ama.get('/api/games')).status).not.toBe(403);
    await updateSettings({ features: { games: false, tutor: false, practice: false, meetings: false, assessments: false } }, SUPER(), true);
    for (const [agent, path] of [[ama, '/api/games'], [ama, '/api/tutor/conversations'], [ama, '/api/practice/attempts'], [t, '/api/meetings'], [t, '/api/assessments']] as const) {
      const r = await agent.get(path); expect(r.status, path).toBe(403); expect(r.body.error.code).toBe('FEATURE_DISABLED');
    }
    await updateSettings({ features: { selfRegistration: false } }, SUPER(), true);
    expect((await (await anon()).post('/api/auth/register').send({ email: 'n2@x.test', fullName: 'New Two', password: 'GoodPass123!', dateOfBirth: '2008-01-01' })).status).toBe(403);
    expect((await (await anon()).get('/api/settings/public')).body.features).toMatchObject({ games: false, tutor: false, selfRegistration: false });
  });
  it('upload limits and formats come from settings (never above UPLOAD_MAX_MB); OCR can be switched off', async () => {
    const ed = await loginAs(E.editor);
    await updateSettings({ uploads: { maxUploadMb: 1, formats: ['pdf', 'docx'] } }, SUPER(), true);
    const l = await ed.get('/api/documents/upload-limits'); expect(l.body.maxMB).toBe(1); expect(Object.keys(l.body.formats)).toEqual(['pdf', 'docx']);
    const t = await ed.post('/api/documents/upload').attach('file', Buffer.from('plain text manual '.repeat(50)), 'notes.txt'); expect(t.status).toBe(415); expect(t.body.error.message).toMatch(/PDF, Word/);
    const big = await ed.post('/api/documents/upload').attach('file', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1.2 * 1048576, 0x20)]), 'big.pdf'); expect(big.status).toBe(413); expect(big.body.error.message).toMatch(/1 MB/);
    await updateSettings({ uploads: { ocrEnabled: false } }, SUPER(), true); expect((await ed.get('/api/documents/upload-limits')).body.ocr).toBe(false);
  });
  it('offline policy: bundle downloads can be switched off and are capped', async () => {
    const ama = await loginAs(E.ama);
    expect((await ama.get(`/api/offline/${ctx.data.bio._id}`)).status).toBe(200);
    await updateSettings({ offline: { bundleEnabled: false } }, SUPER(), true);
    const r = await ama.get(`/api/offline/${ctx.data.bio._id}`); expect(r.status).toBe(403); expect(r.body.error.code).toBe('FEATURE_DISABLED');
    expect((await (await anon()).get('/api/settings/public')).body.offline).toEqual({ bundleEnabled: false, saveLessonsEnabled: true });
  });
  it('session settings: token lifetimes and the lockout threshold follow the stored values', async () => {
    await updateSettings({ sessions: { accessMinutes: 10, sessionDays: 3, lockoutAttempts: 3, lockoutMinutes: 30 } }, SUPER(), true);
    const a = await anon(); const ok = await a.post('/api/auth/login').send({ email: E.teacher, password: 'SamplePass2026' });
    const cookies = ([] as string[]).concat(ok.headers['set-cookie'] as any);
    expect(cookies.find((c) => c.startsWith('gl_at='))).toMatch(/Max-Age=600/); expect(cookies.find((c) => c.startsWith('gl_rt='))).toMatch(/Max-Age=259200/);
    await User.create({ email: 'lock10@x.test', fullName: 'Lock Ten', roles: ['student'], passwordHash: await hashPassword('GoodPass123') });
    const b = await anon(); for (let i = 0; i < 3; i++) await b.post('/api/auth/login').send({ email: 'lock10@x.test', password: 'wrong-password' });
    const u = await User.findOne({ email: 'lock10@x.test' }).lean(); expect(u!.lockedUntil!.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    expect((await b.post('/api/auth/login').send({ email: 'lock10@x.test', password: 'GoodPass123' })).status).toBe(423);
  });
  it('review policy, notification email switch and announcement period limit', async () => {
    await updateSettings({ review: { remindersEnabled: false } }, SUPER(), true);
    expect(await sendReviewReminders()).toMatchObject({ notified: 0, skipped: expect.stringMatching(/switched off/) });
    await updateSettings({ notifications: { emailEnabled: false, announcementMaxDays: 7 } }, SUPER(), true);
    const prev = config.SMTP_URL; (config as any).SMTP_URL = 'json';
    try { await notify([ctx.data.users.ama._id], { type: 'announcement', title: 'Email off test', email: true }); } finally { (config as any).SMTP_URL = prev; }
    expect((await Notification.findOne({ title: 'Email off test' }).lean())!.delivery!.email).toBe('disabled');
    const s = await loginAs(E.super);
    const r = await s.post('/api/announcements').send({ scope: 'system', title: 'Long one', body: 'Body text here', audience: { roles: ['student'] }, expiresAt: new Date(Date.now() + 20 * 864e5).toISOString() });
    expect(r.status).toBe(400); expect(r.body.error.message).toMatch(/at most 7 days/);
    expect(await Announcement.countDocuments({ title: 'Long one' })).toBe(0);
  });
});

describe('§20 data retention job', () => {
  it('preview counts, then the purge deletes only expired records (audit logs kept for at least 365 days) and audits itself', async () => {
    const old = (d: number) => new Date(Date.now() - d * 864e5);
    const ama = ctx.data.users.ama._id;
    await Notification.collection.insertMany([{ userId: ama, type: 'x', title: 'old', createdAt: old(400) }, { userId: ama, type: 'x', title: 'new', createdAt: old(5) }]);
    await AiUsage.collection.insertMany([{ day: old(500).toISOString().slice(0, 10), purpose: 'tutor', status: 'ok' }, { day: old(1).toISOString().slice(0, 10), purpose: 'tutor', status: 'ok' }]);
    await Job.collection.insertMany([{ type: 'x.old', status: 'succeeded', finishedAt: old(100) }, { type: 'x.queued', status: 'queued', createdAt: old(400) }]);
    await AuditLog.collection.insertMany([{ action: 'old.event', createdAt: old(800) }, { action: 'recent.event', createdAt: old(400) }]);
    await TutorConversation.collection.insertOne({ userId: ama, subjectId: ctx.data.bio._id, title: 'old chat', lastMessageAt: old(400), expiresAt: new Date(Date.now() + 864e5) });
    const p = await retentionPreview(); expect(p).toMatchObject({ notifications: { due: 1 }, aiUsage: { due: 1 }, jobs: { due: 1 }, auditLogs: { days: 730, due: 1 }, tutorConversations: { due: 1 } });
    const s = await loginAs(E.super);
    expect((await s.post('/api/admin/settings/retention/run').send({})).status).toBe(409);
    const r = await s.post('/api/admin/settings/retention/run').send({ confirm: true });
    expect(r.status).toBe(200); expect(r.body.deleted).toMatchObject({ notifications: 1, aiUsage: 1, jobs: 1, auditLogs: 1, tutorConversations: 1 });
    expect(await Notification.exists({ title: 'new' })).toBeTruthy(); expect(await Job.exists({ type: 'x.queued' })).toBeTruthy();
    expect(await AuditLog.exists({ action: 'recent.event' })).toBeTruthy(); expect(await AuditLog.exists({ action: 'old.event' })).toBeFalsy();
    await settle(); expect(await AuditLog.exists({ action: 'retention.purge' })).toBeTruthy(); expect(await AuditLog.exists({ action: 'settings.retention_run' })).toBeTruthy();
    await updateSettings({ retention: { purgeEnabled: false } }, SUPER(), true);
    expect(await purgeExpired()).toMatchObject({ skipped: expect.stringMatching(/switched off/) });
    expect((await (await loginAs(E.operator)).post('/api/admin/settings/retention/run').send({ confirm: true })).status).toBe(403);
  });
  it('the daily job is registered and re-queues itself', async () => {
    const { ensureRetentionJob } = await import('../src/services/retention.js');
    await ensureRetentionJob(); await ensureRetentionJob();
    expect(await Job.countDocuments({ type: 'retention.purge', status: 'queued' })).toBe(1);
  });
});

describe('§17 provider and model selection', () => {
  it('model list comes from the provider; the stored model is validated, used by the adapter and audited; keys only set/unset', async () => {
    const s = await loginAs(E.super);
    const m = await s.get('/api/admin/ai/models'); expect(m.body).toMatchObject({ provider: 'test-llm', available: true, selected: null }); expect(m.body.models.map((x: any) => x.id)).toContain('test-scripted-2');
    expect((await s.patch('/api/admin/ai/settings').send({ llmModel: 'no-such-model' })).status).toBe(422);
    expect((await s.patch('/api/admin/ai/settings').send({ llmModel: 'Bad Model!' })).status).toBe(422);
    expect((await s.patch('/api/admin/ai/settings').send({ llmModel: 'test-scripted-2' })).status).toBe(200);
    expect(getLlm()!.model).toBe('test-scripted-2');
    const g = await s.get('/api/admin/ai/settings'); const llm = g.body.providerConfig.find((p: any) => p.capability === 'llm');
    expect(llm).toMatchObject({ model: 'test-scripted-2', modelSource: 'settings', modelEditable: true });
    expect(g.body.providerConfig.find((p: any) => p.capability === 'embeddings').modelEditable).toBe(false);
    for (const sec of g.body.secrets) expect(Object.keys(sec).sort()).toEqual(['name', 'purpose', 'set']);
    await settle(); expect(await AuditLog.findOne({ action: 'ai_config.update' }).sort({ createdAt: -1 }).lean()).toMatchObject({ after: { llmModel: 'test-scripted-2' } });
    expect((await (await loginAs(E.operator)).patch('/api/admin/ai/settings').send({ llmModel: 'test-scripted' })).status).toBe(403);
    await updateAiSettings({ llmModel: null }, SUPER()); expect(getLlm()!.model).toBe('test-scripted'); expect((await getAiSettings()).llmModel).toBeNull();
  });
});
