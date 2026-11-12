import { describe, it, expect, beforeAll } from 'vitest';
import { useDb, ctx, loginAs, anon } from './setup.js';
import { User, School, AuditLog, StudentProfile, ClassGroup, RoleAssignment } from '../src/models/index.js';
import { hashPassword, verifyPassword } from '../src/services/auth.js';
useDb();
const id = (x: any) => String(x._id);
const PW = 'SamplePass2026';
const E = { super: 'super@sample.ghlearn.test', school: 'admin@sample.ghlearn.test', curriculum: 'curriculum@sample.ghlearn.test', teacher: 'teacher@sample.ghlearn.test', student: 'kofi@sample.ghlearn.test', operator: 'operator@sample.ghlearn.test' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TEMP = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{14}$/;
let other: any; let otherAdmin: any;
beforeAll(async () => {
  other = await School.create({ name: 'Users Other High', code: 'USR-OTH' });
  otherAdmin = await User.create({ email: 'oadmin@t.gh', fullName: 'Other Admin', roles: ['school_admin'], schoolId: other._id, passwordHash: await hashPassword(PW) });
  await User.create({ email: 'oteacher@t.gh', fullName: 'Other Teacher', roles: ['teacher'], schoolId: other._id, passwordHash: await hashPassword(PW) });
  const { backfillRoleAssignments } = await import('../src/services/roles.js'); await backfillRoleAssignments();
});

describe('create user with a temporary password (§7)', () => {
  it('super admin creates a teacher; password is shown once, hashed, never audited', async () => {
    const sa = await loginAs(E.super);
    const r = await sa.post('/api/admin/users').send({ fullName: 'New Teacher', email: 'New.Teacher@T.gh', role: 'teacher', schoolId: id(ctx.data.school) });
    expect(r.status).toBe(201); expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.temporaryPassword).toMatch(TEMP); expect(r.body.delivery).toBe('shown_once');
    expect(JSON.stringify(r.body.user)).not.toMatch(/passwordHash/); expect(r.body.user.email).toBe('new.teacher@t.gh');
    const u = await User.findOne({ email: 'new.teacher@t.gh' }).select('+passwordHash').lean();
    expect(u!.mustChangePassword).toBe(true); expect(u!.passwordHash).not.toContain(r.body.temporaryPassword); expect(await verifyPassword(r.body.temporaryPassword, u!.passwordHash)).toBe(true);
    expect(await RoleAssignment.countDocuments({ userId: u!._id, role: 'teacher', scopeType: 'school' })).toBe(1);
    const logs = await AuditLog.find({ target: String(u!._id) }).lean();
    expect(logs.map((l) => l.action)).toContain('user.create');
    expect(JSON.stringify(logs)).not.toContain(r.body.temporaryPassword);
  });
  it('a temporary password forces a change before anything else works', async () => {
    const sa = await loginAs(E.super);
    const { body } = await sa.post('/api/admin/users').send({ fullName: 'Forced Change', email: 'forced@t.gh', role: 'student', schoolId: id(ctx.data.school) });
    const a = await loginAs('forced@t.gh', body.temporaryPassword);
    expect((await a.get('/api/auth/me')).body.user.mustChangePassword).toBe(true);
    const blocked = await a.get('/api/notifications'); expect(blocked.status).toBe(403); expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await a.post('/api/auth/change-password').send({ currentPassword: body.temporaryPassword, newPassword: body.temporaryPassword })).status).toBe(422);
    const ch = await a.post('/api/auth/change-password').send({ currentPassword: body.temporaryPassword, newPassword: 'MyOwnPass2026' });
    expect(ch.status).toBe(200); expect(ch.body.user.mustChangePassword).toBeUndefined();
    expect((await a.get('/api/notifications')).status).toBe(200);
    expect((await (await anon()).post('/api/auth/login').send({ email: 'forced@t.gh', password: body.temporaryPassword })).status).toBe(401);
  });
  it('school admin: own school and school roles only', async () => {
    const sa = await loginAs(E.school);
    const ok = await sa.post('/api/admin/users').send({ fullName: 'School Student', email: 'sstudent@t.gh', role: 'student' });
    expect(ok.status).toBe(201); expect(String(ok.body.user.schoolId)).toBe(id(ctx.data.school));
    expect((await sa.post('/api/admin/users').send({ fullName: 'X Y', email: 'x1@t.gh', role: 'student', schoolId: id(other) })).status).toBe(403);
    for (const role of ['school_admin', 'curriculum_admin', 'super_admin', 'system_operator']) expect((await sa.post('/api/admin/users').send({ fullName: 'X Y', email: `x-${role}@t.gh`, role })).status, role).toBe(403);
    expect((await sa.post('/api/admin/users').send({ fullName: 'Dup', email: 'sstudent@t.gh', role: 'student' })).status).toBe(409);
  });
  it('validation and denied roles', async () => {
    const sa = await loginAs(E.super);
    expect((await sa.post('/api/admin/users').send({ fullName: 'No School', email: 'ns@t.gh', role: 'teacher' })).status).toBe(422);
    expect((await sa.post('/api/admin/users').send({ fullName: 'Bad', email: 'not-an-email', role: 'student' })).status).toBe(422);
    expect((await sa.post('/api/admin/users').send({ fullName: 'Extra', email: 'ex@t.gh', role: 'student', passwordHash: 'x' })).status).toBe(422);
    for (const e of [E.teacher, E.curriculum, E.operator, E.student]) expect((await (await loginAs(e)).post('/api/admin/users').send({ fullName: 'Nope', email: `n-${e}`, role: 'student' })).status, e).toBe(403);
    expect((await (await anon()).post('/api/admin/users').send({ fullName: 'Anon', email: 'anon@t.gh', role: 'student' })).status).toBe(401);
  });
});

describe('user detail, edit and audit history', () => {
  it('per-role detail without secrets; school isolation', async () => {
    const sa = await loginAs(E.school);
    const d = await sa.get(`/api/admin/users/${id(ctx.data.users.ama)}`);
    expect(d.status).toBe(200); expect(d.body.student.profile.programmeId.name).toBe('General Science'); expect(d.body.student.activity).toHaveProperty('attempts30d');
    expect(JSON.stringify(d.body)).not.toMatch(/passwordHash|tokenHash|revokedSessions/);
    const t = await sa.get(`/api/admin/users/${id(ctx.data.users.teacher)}`); expect(t.body.teacher.assignments[0].subject).toBe('Biology');
    expect((await sa.get(`/api/admin/users/${id(otherAdmin)}`)).status).toBe(404);
    expect((await sa.get(`/api/admin/users/${id(ctx.data.users.superAdmin)}`)).status).toBe(404);
  });
  it('edit name/email: permitted fields only, no admin accounts for school admins', async () => {
    const sa = await loginAs(E.school);
    expect((await sa.patch(`/api/admin/users/${id(ctx.data.users.kofi)}`).send({ fullName: 'Kofi Boateng (Sample Student) ' })).status).toBe(200);
    expect((await sa.patch(`/api/admin/users/${id(ctx.data.users.kofi)}`).send({ email: 'ama@sample.ghlearn.test' })).status).toBe(409);
    expect((await sa.patch(`/api/admin/users/${id(ctx.data.users.schoolAdmin)}`).send({ fullName: 'Me' })).status).toBe(403);
    expect((await sa.patch(`/api/admin/users/${id(ctx.data.users.kofi)}`).send({ passwordHash: 'x' })).status).toBe(422);
    const h = await sa.get(`/api/admin/users/${id(ctx.data.users.kofi)}/audit`);
    expect(h.status).toBe(200); expect(h.body.items.map((i: any) => i.action)).toContain('user.update');
    expect((await sa.get(`/api/admin/users/${id(otherAdmin)}/audit`)).status).toBe(404);
  });
});

describe('recovery and sessions', () => {
  let tid: string;
  beforeAll(async () => { const u = await User.create({ email: 'rec@t.gh', fullName: 'Recover Me', roles: ['teacher'], schoolId: ctx.data.school._id, passwordHash: await hashPassword(PW) }); tid = id(u);
    const { backfillUser } = await import('../src/services/roles.js'); await backfillUser(u); });
  it('lists and revokes one session immediately; others keep working', async () => {
    const a1 = await loginAs('rec@t.gh'); const a2 = await loginAs('rec@t.gh');
    const own = await a1.get('/api/auth/sessions'); expect(own.body.items).toHaveLength(2); expect(own.body.items.filter((s: any) => s.current)).toHaveLength(1);
    const sa = await loginAs(E.school);
    const l = await sa.get(`/api/admin/users/${tid}/sessions`); expect(l.status).toBe(200); expect(l.body.items).toHaveLength(2);
    expect(JSON.stringify(l.body)).not.toMatch(/tokenHash|replacedBy/);
    const cur1 = own.body.items.find((s: any) => s.current).id;
    expect((await sa.delete(`/api/admin/users/${tid}/sessions/${cur1}`)).status).toBe(204);
    expect((await a1.get('/api/auth/me')).status).toBe(401); expect((await a1.post('/api/auth/refresh').send({})).status).toBe(401);
    expect((await a2.get('/api/auth/me')).status).toBe(200);
    expect((await sa.delete(`/api/admin/users/${tid}/sessions/not-a-session-id`)).status).toBe(404);
    await sleep(1100);
    expect((await sa.post(`/api/admin/users/${tid}/sessions/revoke-all`).send({})).status).toBe(200);
    expect((await a2.get('/api/auth/me')).status).toBe(401);
  });
  it('reset password: new temporary password, old one dead, lockout cleared', async () => {
    await User.updateOne({ _id: tid }, { lockedUntil: new Date(Date.now() + 3600_000) });
    expect((await (await anon()).post('/api/auth/login').send({ email: 'rec@t.gh', password: PW })).status).toBe(423);
    const sa = await loginAs(E.school);
    const r = await sa.post(`/api/admin/users/${tid}/reset-password`).send({}); expect(r.status).toBe(200); expect(r.body.temporaryPassword).toMatch(TEMP);
    expect((await (await anon()).post('/api/auth/login').send({ email: 'rec@t.gh', password: PW })).status).toBe(401);
    const a = await loginAs('rec@t.gh', r.body.temporaryPassword); expect((await a.get('/api/teacher/classes')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(JSON.stringify(await AuditLog.find({ action: 'user.password.reset' }).lean())).not.toContain(r.body.temporaryPassword);
  });
  it('unlock clears a lockout', async () => {
    await User.updateOne({ _id: tid }, { lockedUntil: new Date(Date.now() + 3600_000) });
    expect((await (await loginAs(E.school)).post(`/api/admin/users/${tid}/unlock`).send({})).status).toBe(200);
    expect((await User.findById(tid).lean())!.lockedUntil).toBeFalsy();
  });
  it('denied: self, administrators, other schools, non-admins', async () => {
    const sa = await loginAs(E.school);
    expect((await sa.post(`/api/admin/users/${id(ctx.data.users.schoolAdmin)}/reset-password`).send({})).status).toBe(403);
    expect((await sa.post(`/api/admin/users/${id(otherAdmin)}/reset-password`).send({})).status).toBe(404);
    expect((await sa.post(`/api/admin/users/${id(ctx.data.users.superAdmin)}/sessions/revoke-all`).send({})).status).toBe(404);
    const sup = await loginAs(E.super);
    expect((await sup.post(`/api/admin/users/${id(ctx.data.users.superAdmin)}/reset-password`).send({})).status).toBe(403);
    expect((await sup.post(`/api/admin/users/${id(otherAdmin)}/unlock`).send({})).status).toBe(200);
    expect((await (await loginAs(E.teacher)).post(`/api/admin/users/${tid}/reset-password`).send({})).status).toBe(403);
    expect((await (await loginAs(E.curriculum)).get(`/api/admin/users/${tid}/sessions`)).status).toBe(403);
  });
});

describe('school transfer (super admin) and school status', () => {
  it('moves a student, leaves old classes, re-scopes grants; school admins cannot', async () => {
    const st = await User.create({ email: 'mover@t.gh', fullName: 'Mover', roles: ['student'], schoolId: ctx.data.school._id, passwordHash: await hashPassword(PW) });
    const { backfillUser } = await import('../src/services/roles.js'); await backfillUser(st);
    await StudentProfile.create({ userId: st._id, schoolId: ctx.data.school._id, levelId: ctx.data.shs._id, yearOfStudy: 1, subjectIds: [ctx.data.bio._id] });
    const c = await ClassGroup.create({ schoolId: ctx.data.school._id, name: 'Move Class', studentIds: [st._id], teacherIds: [] });
    expect((await (await loginAs(E.school)).post(`/api/admin/users/${id(st)}/transfer-school`).send({ schoolId: id(other) })).status).toBe(403);
    const r = await (await loginAs(E.super)).post(`/api/admin/users/${id(st)}/transfer-school`).send({ schoolId: id(other) });
    expect(r.status).toBe(200); expect(r.body.classesLeft).toBe(1);
    expect((await ClassGroup.findById(c._id).lean())!.studentIds).toHaveLength(0);
    expect(String((await StudentProfile.findOne({ userId: st._id }).lean())!.schoolId)).toBe(id(other));
    expect(String((await RoleAssignment.findOne({ userId: st._id }).lean())!.scopeId)).toBe(id(other));
    expect((await (await loginAs(E.school)).get(`/api/admin/users/${id(st)}`)).status).toBe(404);
    expect((await (await loginAs(E.super)).post(`/api/admin/users/${id(otherAdmin)}/transfer-school`).send({ schoolId: id(ctx.data.school) })).status).toBe(409);
    expect((await (await loginAs(E.super)).patch(`/api/admin/users/${id(st)}`).send({ schoolId: id(ctx.data.school) })).status).toBe(403);
  });
  it('suspending a school locks its members out at once; super admins are unaffected', async () => {
    const member = await loginAs('oteacher@t.gh'); expect((await member.get('/api/auth/me')).status).toBe(200);
    const sup = await loginAs(E.super);
    expect((await sup.post(`/api/admin/schools/${id(other)}/status`).send({ status: 'suspended', reason: 'Test' })).status).toBe(200);
    const r = await member.get('/api/teacher/classes'); expect(r.status).toBe(403); expect(r.body.error.code).toBe('SCHOOL_INACTIVE');
    const l = await (await anon()).post('/api/auth/login').send({ email: 'oteacher@t.gh', password: PW }); expect(l.status).toBe(403); expect(l.body.error.code).toBe('SCHOOL_INACTIVE');
    expect((await sup.get('/api/admin/schools')).status).toBe(200);
    expect((await sup.post(`/api/admin/schools/${id(other)}/status`).send({ status: 'active' })).status).toBe(200);
    expect((await member.get('/api/teacher/classes')).status).toBe(200);
  });
});
