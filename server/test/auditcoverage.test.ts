import { describe, it, expect, beforeAll } from 'vitest';
import { useDb, ctx, loginAs, anon } from './setup.js';
import { AuditLog, User, Question } from '../src/models/index.js';
import { drain } from '../src/services/queue.js';
import { curriculumPdf, buildPdf } from './fixtures.js';
import { SAMPLES } from './questionSamples.js';
import { readXlsx, binary } from './xlsx.js';
/**
 * §19 coverage: every event type the spec lists is written to the audit log, with actor, action, resource type and id,
 * timestamp and outcome, and without secrets. One test per category.
 */
useDb();
const id = (x: any) => String(x._id);
const settle = () => new Promise((r) => setTimeout(r, 60)); // audit() is fire-and-forget
async function entry(action: string, extra: Record<string, unknown> = {}) {
  await settle(); const e: any = await AuditLog.findOne({ action, ...extra }).sort({ createdAt: -1 }).lean();
  expect(e, `audit entry ${action}`).toBeTruthy(); expect(e.createdAt).toBeInstanceOf(Date); expect(['success', 'failure', 'denied']).toContain(e.outcome);
  return e;
}
let docId = '';
beforeAll(async () => {
  const ed = await loginAs('editor@sample.ghlearn.test');
  docId = (await ed.post('/api/documents/upload').field('subjectId', id(ctx.data.bio)).field('title', 'Audit bio manual').attach('file', curriculumPdf(), 'c.pdf')).body.document._id;
  await drain();
});
describe('§19 audit coverage', () => {
  it('login and failed login', async () => {
    await loginAs('teacher@sample.ghlearn.test');
    const ok = await entry('auth.login', { actorId: ctx.data.users.teacher._id }); expect(ok.outcome).toBe('success');
    const a = await anon(); expect((await a.post('/api/auth/login').send({ email: 'teacher@sample.ghlearn.test', password: 'WrongPass999' })).status).toBe(401);
    const bad = await entry('auth.login.failure'); expect(bad.outcome).toBe('failure'); expect(JSON.stringify(bad)).not.toContain('WrongPass999');
  });
  it('role and permission changes (grant, revoke, set)', async () => {
    const s = await loginAs('super@sample.ghlearn.test'); const t = ctx.data.users.teacher;
    const g = await s.post('/api/admin/role-assignments').send({ userId: id(t), role: 'counselor', schoolId: id(ctx.data.school) }); expect(g.status).toBe(201);
    const e = await entry('role.grant', { target: id(t) }); expect(e.actorId).toEqual(ctx.data.users.superAdmin._id); expect(e.entityType).toBe('user'); expect(e.after.roles).toContain('counselor'); expect(e.before.roles).not.toContain('counselor');
    expect((await s.delete(`/api/admin/role-assignments/${g.body.assignment._id}`)).status).toBe(200);
    expect((await entry('role.revoke', { target: id(t) })).after.roles).not.toContain('counselor');
  });
  it('activation and suspension', async () => {
    const s = await loginAs('admin@sample.ghlearn.test'); const k = ctx.data.users.kofi;
    expect((await s.patch(`/api/admin/users/${id(k)}`).send({ status: 'suspended' })).status).toBe(200);
    const e = await entry('user.suspend', { target: id(k) }); expect(e.before.status).toBe('active'); expect(e.after.status).toBe('suspended');
    expect((await s.patch(`/api/admin/users/${id(k)}`).send({ status: 'active' })).status).toBe(200);
    await entry('user.activate', { target: id(k) });
  });
  it('manual uploads and replacements', async () => {
    const e = await entry('document.upload', { target: docId }); expect(e.actorId).toEqual(ctx.data.users.editor._id);
    const ed = await loginAs('editor@sample.ghlearn.test');
    const r = await ed.post(`/api/documents/${docId}/replace`).attach('file', buildPdf([{ lines: Array.from({ length: 30 }, (_, i) => `Cells version two line ${i}: the nucleus controls the cell.`) }]), 'v2.pdf');
    expect(r.status).toBeLessThan(300);
    await entry('document.replace');
  });
  it('curriculum changes (structure and versions)', async () => {
    const c = await loginAs('curriculum@sample.ghlearn.test');
    expect((await c.patch(`/api/config/subjects/${id(ctx.data.chem)}`).send({ name: 'Chemistry (audited)' })).status).toBe(200);
    const e = await entry('subjects.update', { target: id(ctx.data.chem) }); expect(e.after.name).toBe('Chemistry (audited)'); expect(e.before.name).not.toBe('Chemistry (audited)');
    expect((await c.post('/api/curriculum/versions').send({ code: 'AUD-2026', name: 'Audit test version' })).status).toBe(201);
    await entry('curriculum_version.create');
  });
  it('approvals and publication', async () => {
    const { _id, ...s } = SAMPLES.mcq;
    const q = await Question.create({ ...s, subjectId: ctx.data.bio._id, topic: 'Cells', stem: 'Audit approval: which organelle releases energy?', status: 'in_review', version: 1, createdBy: ctx.data.users.editor._id, submittedBy: ctx.data.users.editor._id, submittedAt: new Date() });
    const rv = await loginAs('super@sample.ghlearn.test');
    const r = await rv.post(`/api/questions/${id(q)}/review`).send({ action: 'approve', answerKeyVerified: true }); expect(r.status).toBe(200);
    const e = await entry('question.approve', { target: id(q) }); expect(e.meta.answerKeyVerified).toBe(true);
  });
  it('AI configuration changes (with a before/after diff)', async () => {
    const s = await loginAs('super@sample.ghlearn.test');
    expect((await s.patch('/api/admin/ai/settings').send({ maxRetries: 1 })).status).toBe(200);
    const e = await entry('ai_config.update'); expect(e.after.maxRetries).toBe(1); expect(e.before).toBeTruthy();
    expect((await (await loginAs('operator@sample.ghlearn.test')).patch('/api/admin/ai/settings').send({ maxRetries: 2 })).status).toBe(403);
  });
  it('exports (audit CSV and Excel record format and filters)', async () => {
    const s = await loginAs('super@sample.ghlearn.test');
    const c = await s.get('/api/admin/audit/export').query({ format: 'csv', action: 'auth.' }); expect(c.status).toBe(200); expect(c.text).toMatch(/auth\.login/);
    const e = await entry('report.export', { 'meta.report': 'audit', 'meta.format': 'csv' }); expect(e.meta.filters.action).toBe('auth.'); expect(e.entityType).toBe('report');
    const x = await s.get('/api/admin/audit/export').query({ format: 'xlsx' }).buffer(true).parse(binary); expect(x.status).toBe(200);
    const book = await readXlsx(x.body); expect(book.texts).toContain('Action'); expect(book.texts).toContain('auth.login');
    await entry('report.export', { 'meta.report': 'audit', 'meta.format': 'xlsx' });
    expect((await s.get('/api/admin/audit.csv')).status).toBe(200); // legacy CSV link still audited
  });
  it('deletion and archival', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test');
    const q = await ed.post('/api/questions').send({ ...(({ _id, citations, ...x }: any) => x)(SAMPLES.true_false), subjectId: id(ctx.data.bio), topic: 'Cells', stem: 'Audit delete: cells are alive?' });
    expect(q.status).toBe(201); const qid = q.body.question?._id ?? q.body._id;
    expect((await ed.delete(`/api/questions/${qid}`)).status).toBeLessThan(300); await entry('question.delete', { target: qid });
    const cur = await loginAs('curriculum@sample.ghlearn.test');
    expect((await cur.post(`/api/documents/${docId}/archive`).send({ reason: 'audit test' })).status).toBeLessThan(300);
    const e = await entry('document.archive', { target: docId }); expect(e.after.archived).toBe(true); expect(e.meta.reason).toBe('audit test');
  });
  it('never logs secrets', async () => {
    const s = await loginAs('super@sample.ghlearn.test');
    const u = await s.post('/api/admin/users').send({ email: 'audit-new@t.gh', fullName: 'Audit New', role: 'teacher', schoolId: id(ctx.data.school) }); expect(u.status).toBe(201);
    const tp = u.body.temporaryPassword; expect(tp).toBeTruthy();
    const a = await anon(); await a.post('/api/auth/login').send({ email: 'audit-new@t.gh', password: tp });
    await a.post('/api/auth/change-password').send({ currentPassword: tp, newPassword: 'BrandNewPass2026' });
    await settle();
    const all = JSON.stringify(await AuditLog.find().lean());
    for (const secret of [tp, 'BrandNewPass2026', 'SamplePass2026', 'WrongPass999']) expect(all).not.toContain(secret);
    expect(all).not.toMatch(/passwordHash|"\$2[aby]\$/);
  });
  it('is append-only', async () => {
    await expect(AuditLog.updateOne({}, { action: 'tampered' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/);
  });
  it('restricted viewer: only Super and School Admins; school admins see their school only; filters work', async () => {
    for (const e of ['teacher', 'editor', 'curriculum', 'operator', 'counselor', 'ama']) {
      const a = await loginAs(`${e}@sample.ghlearn.test`);
      expect((await a.get('/api/admin/audit')).status).toBe(403); expect((await a.get('/api/admin/audit/export').query({ format: 'csv' })).status).toBe(403);
    }
    const s = await loginAs('super@sample.ghlearn.test');
    const all = await s.get('/api/admin/audit').query({ pageSize: 200 }); expect(all.status).toBe(200); expect(all.body.entityTypes).toContain('user');
    const byEntity = await s.get('/api/admin/audit').query({ entityType: 'document' }); expect(byEntity.body.items.length).toBeGreaterThan(0); expect(byEntity.body.items.every((i: any) => i.entityType === 'document')).toBe(true);
    const fails = await s.get('/api/admin/audit').query({ outcome: 'failure' }); expect(fails.body.items.every((i: any) => i.outcome === 'failure')).toBe(true);
    const tgt = await s.get('/api/admin/audit').query({ target: docId }); expect(tgt.body.items.length).toBeGreaterThan(1);
    const sa = await loginAs('admin@sample.ghlearn.test');
    const mine = await sa.get('/api/admin/audit').query({ pageSize: 200 }); expect(mine.status).toBe(200);
    const school = (await User.find({ schoolId: ctx.data.school._id }).distinct('_id')).map(String);
    expect(mine.body.items.length).toBeGreaterThan(0); expect(mine.body.items.every((i: any) => school.includes(String(i.actorId?._id ?? i.actorId)))).toBe(true);
    expect(mine.body.items.some((i: any) => i.action === 'ai_config.update')).toBe(false); // the super admin's actions are hidden
  });
});
