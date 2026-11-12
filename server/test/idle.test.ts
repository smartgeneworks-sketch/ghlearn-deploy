import { describe, it, expect, afterAll } from 'vitest';
import { useDb, anon, loginAs } from './setup.js';
import { AuditLog, RefreshToken, User } from '../src/models/index.js';
import { clearSettingsCache } from '../src/services/platformSettings.js';
import { resetIdleCache } from '../src/services/idle.js';
useDb();
const STUDENT = 'ama@sample.ghlearn.test', EDITOR = 'editor@sample.ghlearn.test', SUPER = 'super@sample.ghlearn.test';
const MIN = 60_000;
const uid = async (email: string) => String((await User.findOne({ email }).lean())!._id);
const latest = async (email: string) => (await RefreshToken.find({ userId: await uid(email), revokedAt: null }).sort({ createdAt: -1 }).limit(1).lean())[0];
/** Pretend the session's last recorded activity was `ms` ago (as if the process had restarted). */
const ageSession = async (email: string, ms: number) => { const t = await latest(email); await RefreshToken.updateMany({ family: t.family }, { lastActiveAt: new Date(Date.now() - ms) }); resetIdleCache(); return t.family; };
afterAll(() => clearSettingsCache());

describe('idle sign-out settings', () => {
  it('defaults are 30 min (users) and 15 min (admin roles), served to the app', async () => {
    const pub = await (await anon()).get('/api/settings/public');
    expect(pub.body.idle).toEqual({ userSeconds: 1800, adminSeconds: 900, warnSeconds: 60 });
  });
  it('super admins edit both values within 5-240 minutes; the change is audited and served', async () => {
    const s = await loginAs(SUPER);
    for (const bad of [4, 241, 7.5]) expect((await s.patch('/api/admin/settings').send({ sessions: { idleMinutesUser: bad }, confirm: true })).status).toBe(422);
    expect((await s.patch('/api/admin/settings').send({ sessions: { idleMinutesAdmin: 0 }, confirm: true })).status).toBe(422);
    const ok = await s.patch('/api/admin/settings').send({ sessions: { idleMinutesUser: 45, idleMinutesAdmin: 5 }, confirm: true });
    expect(ok.status).toBe(200);
    expect((await (await anon()).get('/api/settings/public')).body.idle).toMatchObject({ userSeconds: 2700, adminSeconds: 300 });
    const a = await AuditLog.findOne({ action: 'settings.update' }).sort({ createdAt: -1 }).lean();
    expect(JSON.stringify(a)).toContain('idleMinutesUser');
    const op = await loginAs('operator@sample.ghlearn.test');
    expect((await op.patch('/api/admin/settings').send({ sessions: { idleMinutesUser: 60 } })).status).toBe(403);
    expect((await s.patch('/api/admin/settings').send({ sessions: { idleMinutesUser: 30, idleMinutesAdmin: 15 }, confirm: true })).status).toBe(200);
  });
});

describe('server-side idle expiry', () => {
  it('a session idle past its limit is refused, revoked and audited', async () => {
    const a = await loginAs(STUDENT);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    const fam = await ageSession(STUDENT, 31 * MIN);
    const r = await a.get('/api/auth/me');
    expect(r.status).toBe(401); expect(r.body.error?.code ?? r.body.code).toBe('SESSION_IDLE');
    expect(await RefreshToken.countDocuments({ family: fam, revokedAt: null })).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'session.idle_timeout', actorId: await uid(STUDENT) })).toBeGreaterThan(0);
    expect((await a.post('/api/auth/refresh')).status).toBe(401);
  });
  it('uses the reported idle time, with the shorter limit for admin roles; no header counts as activity', async () => {
    const st = await loginAs(STUDENT);
    expect((await st.get('/api/auth/me').set('X-Idle-Ms', String(16 * MIN))).status).toBe(200);
    expect((await st.get('/api/auth/me').set('X-Idle-Ms', String(31 * MIN))).status).toBe(401);
    const ed = await loginAs(EDITOR);
    expect((await ed.get('/api/auth/me').set('X-Idle-Ms', String(14 * MIN))).status).toBe(200);
    const r = await ed.get('/api/auth/me').set('X-Idle-Ms', String(16 * MIN));
    expect(r.status).toBe(401); expect(r.body.error?.code ?? r.body.code).toBe('SESSION_IDLE');
    const st2 = await loginAs(STUDENT);
    await ageSession(STUDENT, 20 * MIN);
    expect((await st2.get('/api/auth/me')).status).toBe(200);
  });
  it('refresh is refused after idle expiry (a closed laptop cannot resume)', async () => {
    const a = await loginAs('kofi@sample.ghlearn.test');
    const fresh = await a.post('/api/auth/refresh'); expect(fresh.status).toBe(200);
    const fam = await ageSession('kofi@sample.ghlearn.test', 31 * MIN);
    const r = await a.post('/api/auth/refresh');
    expect(r.status).toBe(401); expect(r.body.error?.code ?? r.body.code).toBe('SESSION_IDLE');
    expect(await RefreshToken.countDocuments({ family: fam, revokedAt: null })).toBe(0);
    const log = await AuditLog.findOne({ action: 'session.idle_timeout', actorId: await uid('kofi@sample.ghlearn.test') }).sort({ createdAt: -1 }).lean();
    expect((log as any).meta.via).toBe('refresh');
  });
  it('rotation keeps the last-activity time (refreshing alone is not activity)', async () => {
    const a = await loginAs('teacher@sample.ghlearn.test');
    const when = new Date(Date.now() - 10 * MIN); const t = await latest('teacher@sample.ghlearn.test');
    await RefreshToken.updateMany({ family: t.family }, { lastActiveAt: when }); resetIdleCache();
    expect((await a.post('/api/auth/refresh')).status).toBe(200);
    expect(+(await latest('teacher@sample.ghlearn.test')).lastActiveAt!).toBe(+when);
  });
  it('records activity at most once a minute per session', async () => {
    const a = await loginAs('counselor@sample.ghlearn.test');
    const fam = await ageSession('counselor@sample.ghlearn.test', 10 * MIN);
    expect((await a.post('/api/auth/activity')).status).toBe(204);
    const t1 = (await latest('counselor@sample.ghlearn.test')).lastActiveAt!;
    expect(Date.now() - +t1).toBeLessThan(5000);
    const marker = new Date(+t1 - 1000);
    await RefreshToken.updateMany({ family: fam }, { lastActiveAt: marker });
    for (let i = 0; i < 3; i++) expect((await a.get('/api/auth/me')).status).toBe(200);
    expect(+(await latest('counselor@sample.ghlearn.test')).lastActiveAt!).toBe(+marker);
  });
  it('an idle sign-out by the app is audited as session.idle_timeout', async () => {
    const a = await loginAs(SUPER); const before = await AuditLog.countDocuments({ action: 'session.idle_timeout' });
    expect((await a.post('/api/auth/logout').send({ reason: 'idle' })).status).toBeLessThan(300);
    const log = await AuditLog.findOne({ action: 'session.idle_timeout' }).sort({ createdAt: -1 }).lean();
    expect(await AuditLog.countDocuments({ action: 'session.idle_timeout' })).toBe(before + 1); expect((log as any).meta.via).toBe('client');
  });
});
