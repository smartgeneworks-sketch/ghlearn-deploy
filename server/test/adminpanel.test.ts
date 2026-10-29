import { describe, it, expect, beforeAll } from 'vitest';
import { ROLE_PERMISSIONS, hasPermission, ROLES } from '@ghlearn/shared';
import { useDb, ctx, loginAs, anon } from './setup.js';
import { User, School, AuditLog, RoleAssignment, Subject } from '../src/models/index.js';
import { hashPassword } from '../src/services/auth.js';
import { redact, diff } from '../src/lib/audit.js';
useDb();
const id = (x: any) => String(x._id);
const PW = 'SamplePass2026';
const E = { super: 'super@sample.ghlearn.test', school: 'admin@sample.ghlearn.test', curriculum: 'curriculum@sample.ghlearn.test', operator: 'operator@sample.ghlearn.test',
  editor: 'editor@sample.ghlearn.test', teacher: 'teacher@sample.ghlearn.test', counselor: 'counselor@sample.ghlearn.test', student: 'kofi@sample.ghlearn.test' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let other: any; let otherUser: any; const reviewerEmail = 'rev@t.gh';
beforeAll(async () => {
  other = await School.create({ name: 'Panel Other High', code: 'PANEL-OTH' });
  otherUser = await User.create({ email: 'pother@t.gh', fullName: 'Other School Teacher', roles: ['teacher'], schoolId: other._id, passwordHash: await hashPassword(PW) });
  await User.create({ email: reviewerEmail, fullName: 'Reviewer', roles: ['content_reviewer'], passwordHash: await hashPassword(PW) });
  const { backfillRoleAssignments } = await import('../src/services/roles.js'); await backfillRoleAssignments();
});

describe('Phase 2 permission matrix (shared)', () => {
  const who = (p: any) => ROLES.filter((r) => hasPermission([r], p)).sort();
  it('admin:access is staff-only', () => expect(who('admin:access')).toEqual(['content_reviewer', 'curriculum_admin', 'curriculum_editor', 'school_admin', 'super_admin', 'system_operator']));
  it('roles:assign: super and school admin', () => expect(who('roles:assign')).toEqual(['school_admin', 'super_admin']));
  it('curriculum:manage: super and curriculum admin', () => expect(who('curriculum:manage')).toEqual(['curriculum_admin', 'super_admin']));
  it('system:health: super and system operator', () => expect(who('system:health')).toEqual(['super_admin', 'system_operator']));
  it('system operator holds no learner, content or user permissions', () => expect([...ROLE_PERMISSIONS.system_operator].sort()).toEqual(['admin:access', 'system:health']));
  it('curriculum admin has no learner-data or user permissions', () => {
    for (const p of ['users:manage', 'progress:view_class', 'audit:view', 'roles:assign', 'learn:access', 'content:publish'] as const) expect(hasPermission(['curriculum_admin'], p)).toBe(false);
  });
});

describe('admin:access — overview', () => {
  it('allowed for every admin role, denied for teacher/counselor/student, 401 anonymous', async () => {
    for (const e of [E.super, E.school, E.curriculum, E.operator, E.editor, reviewerEmail]) expect((await (await loginAs(e)).get('/api/admin/overview')).status, e).toBe(200);
    for (const e of [E.teacher, E.counselor, E.student]) expect((await (await loginAs(e)).get('/api/admin/overview')).status, e).toBe(403);
    expect((await (await anon()).get('/api/admin/overview')).status).toBe(401);
  });
  it('cards follow permissions and match the database', async () => {
    const keys = async (e: string) => (await (await loginAs(e)).get('/api/admin/overview')).body.cards.map((c: any) => c.key);
    expect(await keys(E.super)).toEqual(['students', 'teachers', 'schools', 'activeUsers', 'subjects', 'manuals', 'published', 'pendingReviews', 'failedJobs', 'aiRequests']);
    expect(await keys(E.school)).toEqual(['students', 'teachers', 'activeUsers', 'subjects', 'manuals']); // school admins upload manuals
    expect(await keys(E.curriculum)).toEqual(['subjects', 'manuals', 'published', 'failedJobs', 'aiRequests']);
    expect(await keys(E.operator)).toEqual(['failedJobs', 'aiRequests']);
    expect(await keys(reviewerEmail)).toEqual(['manuals', 'published', 'pendingReviews', 'aiRequests']);
    const sa = (await (await loginAs(E.school)).get('/api/admin/overview')).body;
    expect(sa.scope).toBe('school');
    expect(sa.cards.find((c: any) => c.key === 'students').value).toBe(await User.countDocuments({ roles: 'student', schoolId: ctx.data.school._id }));
    const sup = (await (await loginAs(E.super)).get('/api/admin/overview')).body;
    expect(sup.cards.find((c: any) => c.key === 'students').value).toBe(await User.countDocuments({ roles: 'student' }));
    expect(sup.cards.find((c: any) => c.key === 'subjects').value).toBe(await Subject.countDocuments());
    expect(Object.keys(sup.activity).sort()).toEqual(['approvals', 'audit', 'failedJobs', 'generated', 'manuals']);
    expect(Object.keys((await (await loginAs(E.operator)).get('/api/admin/overview')).body.activity)).toEqual(['failedJobs']);
  });
  it('school admin cannot widen scope; bad filters are 422', async () => {
    const sa = await loginAs(E.school);
    expect((await sa.get(`/api/admin/overview?schoolId=${id(other)}`)).status).toBe(403);
    expect((await sa.get('/api/admin/overview?levelId=nope')).status).toBe(422);
    expect((await sa.get('/api/admin/overview?evil=1')).status).toBe(422);
  });
});

describe('curriculum:manage — academic structure writes', () => {
  it('curriculum admin creates and edits subjects; school admin, teacher and operator are denied; delete stays super-only', async () => {
    const ca = await loginAs(E.curriculum);
    const r = await ca.post('/api/config/subjects').send({ name: 'Panel Test Subject', code: 'PTS', levelId: id(ctx.data.shs), category: 'elective' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await ca.patch(`/api/config/subjects/${r.body._id}`).send({ name: 'Panel Test Subject 2' })).status).toBe(200);
    for (const e of [E.school, E.teacher, E.operator, E.editor]) expect((await (await loginAs(e)).patch(`/api/config/subjects/${r.body._id}`).send({ name: 'x' })).status, e).toBe(403);
    expect((await ca.delete(`/api/config/subjects/${r.body._id}`)).status).toBe(403);
    // Update is audited with a before/after diff of only the changed fields.
    const log = await AuditLog.findOne({ action: 'subjects.update', target: r.body._id }).lean();
    expect(log?.before).toEqual({ name: 'Panel Test Subject' }); expect(log?.after).toEqual({ name: 'Panel Test Subject 2' }); expect(log?.entityType).toBe('subjects');
    expect((await (await loginAs(E.super)).delete(`/api/config/subjects/${r.body._id}`)).status).toBe(204);
  });
});

describe('system:health — operations status', () => {
  it('operator and super get status without secrets; others are denied', async () => {
    const r = await (await loginAs(E.operator)).get('/api/admin/system');
    expect(r.status).toBe(200); expect(r.body.db.ok).toBe(true); expect(typeof r.body.ai.configured).toBe('boolean');
    expect(JSON.stringify(r.body)).not.toMatch(/AIza|mongodb(\+srv)?:\/\/|JWT|secret/i);
    expect((await (await loginAs(E.super)).get('/api/admin/system')).status).toBe(200);
    for (const e of [E.school, E.curriculum, E.editor, E.teacher, E.student]) expect((await (await loginAs(e)).get('/api/admin/system')).status, e).toBe(403);
  });
  it('operator cannot reach users, audit, analytics or role assignment', async () => {
    const op = await loginAs(E.operator);
    expect((await op.get('/api/admin/users')).status).toBe(403);
    expect((await op.get('/api/admin/audit')).status).toBe(403);
    expect((await op.get('/api/analytics')).status).toBe(403);
    expect((await op.post('/api/admin/role-assignments').send({ userId: id(ctx.data.users.kofi), role: 'teacher' })).status).toBe(403);
  });
});

describe('roles:assign — scoped grants', () => {
  it('school admin grants school roles only to own-school users', async () => {
    const sa = await loginAs(E.school);
    const t = await User.create({ email: 'grant1@t.gh', fullName: 'Grant One', roles: ['teacher'], schoolId: ctx.data.school._id, passwordHash: await hashPassword(PW) });
    const g = await sa.post('/api/admin/role-assignments').send({ userId: id(t), role: 'counselor' });
    expect(g.status, JSON.stringify(g.body)).toBe(201); expect(g.body.roles.sort()).toEqual(['counselor', 'teacher']);
    expect(g.body.assignment).toMatchObject({ role: 'counselor', scopeType: 'school', scopeId: id(ctx.data.school) });
    expect((await sa.post('/api/admin/role-assignments').send({ userId: id(t), role: 'counselor' })).status).toBe(409);
    for (const role of ['curriculum_admin', 'school_admin', 'super_admin', 'system_operator', 'content_reviewer']) expect((await sa.post('/api/admin/role-assignments').send({ userId: id(t), role })).status, role).toBe(403);
    expect((await sa.post('/api/admin/role-assignments').send({ userId: id(otherUser), role: 'counselor' })).status).toBe(404);
    expect((await sa.post('/api/admin/role-assignments').send({ userId: id(ctx.data.users.schoolAdmin), role: 'teacher' })).status).toBe(403); // self
    const list = (await sa.get(`/api/admin/users/${id(t)}/roles`)).body.items;
    expect(list.map((a: any) => a.role).sort()).toEqual(['counselor', 'teacher']);
    expect((await sa.get(`/api/admin/users/${id(otherUser)}/roles`)).status).toBe(404);
    const rv = await sa.delete(`/api/admin/role-assignments/${list.find((a: any) => a.role === 'counselor')._id}`);
    expect(rv.status).toBe(200); expect(rv.body.roles).toEqual(['teacher']);
    const last = list.find((a: any) => a.role === 'teacher')._id;
    expect((await sa.delete(`/api/admin/role-assignments/${last}`)).status).toBe(409); // keeps at least one role
    const log = await AuditLog.findOne({ action: 'role.grant', target: id(t) }).lean();
    expect(log?.before).toEqual({ roles: ['teacher'] }); expect((log?.after as any).roles.sort()).toEqual(['counselor', 'teacher']); expect(log?.requestId).toBeTruthy();
  });
  it('only a super admin grants platform roles; roles without roles:assign are denied', async () => {
    const sup = await loginAs(E.super);
    const u = await User.create({ email: 'grant2@t.gh', fullName: 'Grant Two', roles: ['curriculum_editor'], passwordHash: await hashPassword(PW) });
    const g = await sup.post('/api/admin/role-assignments').send({ userId: id(u), role: 'curriculum_admin' });
    expect(g.status).toBe(201); expect(g.body.assignment.scopeType).toBe('platform');
    for (const e of [E.curriculum, E.editor, reviewerEmail, E.teacher]) expect((await (await loginAs(e)).post('/api/admin/role-assignments').send({ userId: id(u), role: 'teacher' })).status, e).toBe(403);
    expect((await sup.post('/api/admin/role-assignments').send({ userId: id(ctx.data.users.superAdmin), role: 'teacher' })).status).toBe(403); // self
  });
  it('supers cannot revoke themselves, and role changes revoke the target\'s sessions', async () => {
    const sup = await loginAs(E.super);
    const s2 = await User.create({ email: 'super2@t.gh', fullName: 'Second Super', roles: ['super_admin'], passwordHash: await hashPassword(PW) });
    const { backfillRoleAssignments } = await import('../src/services/roles.js'); await backfillRoleAssignments();
    const s2agent = await loginAs('super2@t.gh'); await sleep(1100);
    expect((await s2agent.get('/api/admin/system')).status).toBe(200);
    // super removes s2's super role (another active super remains) → s2's session is revoked.
    const a = await RoleAssignment.findOne({ userId: s2._id, role: 'super_admin' }).lean();
    expect((await sup.post('/api/admin/role-assignments').send({ userId: id(s2), role: 'system_operator' })).status).toBe(201);
    expect((await sup.delete(`/api/admin/role-assignments/${a!._id}`)).status).toBe(200);
    expect((await s2agent.get('/api/admin/system')).status).toBe(401);
    // Self-revoke is refused, so the only super can never remove itself (last-super guard is defence in depth).
    const own = await RoleAssignment.findOne({ userId: ctx.data.users.superAdmin._id, role: 'super_admin' }).lean();
    expect((await sup.delete(`/api/admin/role-assignments/${own!._id}`)).status).toBe(403);
  });
});

describe('PATCH /users/:id uses the same grant rules', () => {
  it('school admin cannot escalate via PATCH; super can set platform roles', async () => {
    const sa = await loginAs(E.school);
    const u = await User.create({ email: 'patch1@t.gh', fullName: 'Patch One', roles: ['student'], schoolId: ctx.data.school._id, passwordHash: await hashPassword(PW) });
    expect((await sa.patch(`/api/admin/users/${id(u)}`).send({ roles: ['curriculum_admin'] })).status).toBe(403);
    expect((await sa.patch(`/api/admin/users/${id(u)}`).send({ roles: ['student', 'parent'] })).status).toBe(200);
    expect((await RoleAssignment.find({ userId: u._id }).lean()).map((a) => a.role).sort()).toEqual(['parent', 'student']);
  });
});

describe('list helper — /api/admin/users', () => {
  it('paginates, searches, filters and validates sort', async () => {
    const sup = await loginAs(E.super);
    const r = (await sup.get('/api/admin/users?pageSize=2&page=1&sort=email')).body;
    expect(r.items).toHaveLength(2); expect(r.pageSize).toBe(2); expect(r.pages).toBe(Math.ceil(r.total / 2));
    expect(r.items[0].email <= r.items[1].email).toBe(true);
    expect((await sup.get('/api/admin/users?q=curriculum%20admin')).body.items.map((u: any) => u.email)).toContain(E.curriculum);
    expect((await sup.get('/api/admin/users?role=system_operator')).body.items.every((u: any) => u.roles.includes('system_operator'))).toBe(true);
    expect((await sup.get('/api/admin/users?sort=passwordHash')).status).toBe(422);
    expect((await sup.get('/api/admin/users?pageSize=1000')).status).toBe(422);
    expect((await sup.get('/api/admin/users?q=(.*')).status).toBe(200); // regex-escaped
    expect((await (await loginAs(E.school)).get(`/api/admin/users?schoolId=${id(other)}`)).status).toBe(403);
  });
});

describe('global search', () => {
  it('is permission-filtered and scoped', async () => {
    const sup = (await (await loginAs(E.super)).get('/api/admin/search?q=sample')).body;
    expect(sup.groups.map((g: any) => g.type)).toContain('user');
    const ca = (await (await loginAs(E.curriculum)).get('/api/admin/search?q=sample')).body;
    expect(ca.groups.map((g: any) => g.type)).not.toContain('user');
    const sa = (await (await loginAs(E.school)).get('/api/admin/search?q=pother')).body;
    expect(sa.groups).toEqual([]);
    expect((await (await loginAs(E.super)).get('/api/admin/search?q=p')).status).toBe(422);
    expect((await (await loginAs(E.student)).get('/api/admin/search?q=sample')).status).toBe(403);
  });
});

describe('audit extension', () => {
  it('logs login with the request id, failed logins without the email, lockout and logout', async () => {
    const agent = await anon();
    const ok = await agent.post('/api/auth/login').set('x-request-id', 'test-req-123').send({ email: E.teacher, password: PW });
    expect(ok.headers['x-request-id']).toBe('test-req-123');
    const t = await User.findOne({ email: E.teacher }).lean();
    expect(await AuditLog.exists({ action: 'auth.login', actorId: t!._id, requestId: 'test-req-123', outcome: 'success' })).toBeTruthy();
    await agent.post('/api/auth/logout');
    expect(await AuditLog.exists({ action: 'auth.logout', actorId: t!._id })).toBeTruthy();
    const a2 = await anon();
    await a2.post('/api/auth/login').send({ email: 'nobody-here@t.gh', password: 'whatever123' });
    const unk = await AuditLog.findOne({ action: 'auth.login.failure', 'meta.reason': 'unknown_account' }).lean();
    expect(unk?.outcome).toBe('failure'); expect(JSON.stringify(unk)).not.toContain('nobody-here');
    const lk = await User.create({ email: 'lock@t.gh', fullName: 'Lock Me', roles: ['student'], passwordHash: await hashPassword(PW) });
    for (let i = 0; i < 8; i++) await a2.post('/api/auth/login').send({ email: 'lock@t.gh', password: 'wrongpass99' });
    expect((await a2.post('/api/auth/login').send({ email: 'lock@t.gh', password: PW })).status).toBe(423);
    expect(await AuditLog.countDocuments({ action: 'auth.login.failure', actorId: lk._id })).toBe(8);
    expect(await AuditLog.exists({ action: 'auth.lockout', actorId: lk._id, outcome: 'denied' })).toBeTruthy();
    expect(await AuditLog.exists({ action: 'auth.login.locked', actorId: lk._id })).toBeTruthy();
    expect(JSON.stringify(await AuditLog.find({ actorId: lk._id }).lean())).not.toMatch(/wrongpass99|SamplePass/);
  });
  it('is append-only and redacts secrets', async () => {
    await expect(AuditLog.updateOne({}, { action: 'x' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/);
    const d = await AuditLog.findOne(); d!.action = 'tampered'; await expect(d!.save()).rejects.toThrow(/append-only/);
    expect(redact({ password: 'p', nested: { apiKey: 'k', refreshToken: 't', ok: 1 } })).toEqual({ password: '[redacted]', nested: { apiKey: '[redacted]', refreshToken: '[redacted]', ok: 1 } });
    expect(diff({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ before: { b: 2 }, after: { b: 3 } });
  });
  it('audit list filters by outcome and request id; school admins see only their school', async () => {
    const sup = await loginAs(E.super);
    const r = (await sup.get('/api/admin/audit?requestId=test-req-123')).body; expect(r.items.length).toBeGreaterThan(0);
    expect((await sup.get('/api/admin/audit?outcome=denied&pageSize=5')).body.items.every((i: any) => i.outcome === 'denied')).toBe(true);
    const sa = (await (await loginAs(E.school)).get('/api/admin/audit?action=auth.lockout')).body; expect(sa.items).toHaveLength(0);
  });
});

describe('account settings', () => {
  it('change password (wrong current is 422) and logout everywhere', async () => {
    const u = await User.create({ email: 'acct@t.gh', fullName: 'Account', roles: ['teacher'], passwordHash: await hashPassword(PW) });
    const a = await loginAs('acct@t.gh'); const b = await loginAs('acct@t.gh'); await sleep(1100);
    expect((await a.post('/api/auth/change-password').send({ currentPassword: 'nope', newPassword: 'NewPass2026x' })).status).toBe(422);
    expect((await a.post('/api/auth/change-password').send({ currentPassword: PW, newPassword: 'short' })).status).toBe(422);
    expect((await a.post('/api/auth/change-password').send({ currentPassword: PW, newPassword: 'NewPass2026x' })).status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(200);   // new session for the caller
    expect((await b.get('/api/auth/me')).status).toBe(401);   // other session revoked
    expect((await b.post('/api/auth/refresh')).status).toBe(401);
    await sleep(1100);
    expect((await a.post('/api/auth/logout-all')).status).toBe(204);
    expect((await a.get('/api/auth/me')).status).toBe(401);
    const c = await loginAs('acct@t.gh', 'NewPass2026x'); expect((await c.get('/api/auth/me')).status).toBe(200);
    expect(await AuditLog.exists({ action: 'auth.password.change', actorId: u._id, outcome: 'success' })).toBeTruthy();
  });
});
