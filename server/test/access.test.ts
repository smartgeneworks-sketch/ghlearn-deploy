import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { useDb, ctx, loginAs, anon } from './setup.js';
useDb();
const id = (x: any) => String(x._id);

describe('cross-subject access control', () => {
  it('Business student CANNOT read Biology resources (list or by id)', async () => {
    const kofi = await loginAs('kofi@sample.ghlearn.test');
    const list = await kofi.get(`/api/subjects/${id(ctx.data.bio)}/resources`);
    expect(list.status).toBe(403); expect(list.body.error.code).toBe('FORBIDDEN');
    const pub = ctx.data.resources.find((r: any) => r.status === 'published' && String(r.subjectId) === id(ctx.data.bio))!;
    expect((await kofi.get(`/api/resources/${id(pub)}`)).status).toBe(403);
    expect((await kofi.get(`/api/subjects/${id(ctx.data.econ)}/resources`)).status).toBe(200);
  });
  it('Science student sees Biology but only PUBLISHED items; drafts are 404', async () => {
    const ama = await loginAs('ama@sample.ghlearn.test');
    const list = await ama.get(`/api/subjects/${id(ctx.data.bio)}/resources`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((r: any) => r.status)).toEqual(['published']);
    const draft = ctx.data.resources.find((r: any) => r.status === 'draft')!;
    expect((await ama.get(`/api/resources/${id(draft)}`)).status).toBe(404);
    expect((await ama.get(`/api/subjects/${id(ctx.data.econ)}/resources`)).status).toBe(403);
    const mine = await ama.get('/api/me/subjects');
    expect(mine.body.items.map((s: any) => s.code).sort()).toEqual(['BIO', 'CHEM', 'ENG', 'MATH', 'PHY', 'S-GENSCI', 'SOC']);
  });
  it('invalid/nonexistent subject ids do not leak and do not crash', async () => {
    const ama = await loginAs('ama@sample.ghlearn.test');
    expect((await ama.get('/api/subjects/not-an-id/resources')).status).toBe(404);
    expect((await ama.get('/api/subjects/0123456789abcdef01234567/resources')).status).toBe(404);
  });
  it('teacher only accesses assigned subjects', async () => {
    const t = await loginAs('teacher@sample.ghlearn.test');
    expect((await t.get(`/api/subjects/${id(ctx.data.bio)}/resources`)).status).toBe(200);
    expect((await t.get(`/api/subjects/${id(ctx.data.econ)}/resources`)).status).toBe(403);
  });
  it('editor sees drafts', async () => {
    const e = await loginAs('editor@sample.ghlearn.test');
    expect((await e.get(`/api/subjects/${id(ctx.data.bio)}/resources`)).body.items).toHaveLength(2);
  });
});

describe('role permissions', () => {
  it('students and school admins cannot change global config; super admin can', async () => {
    const body = { kind: 'JHS', name: 'JHS Extra', years: 3 };
    expect((await (await loginAs('ama@sample.ghlearn.test')).post('/api/config/levels').send(body)).status).toBe(403);
    const sa = await loginAs('admin@sample.ghlearn.test');
    expect((await sa.post('/api/config/levels').send(body)).status).toBe(403);
    expect((await sa.post('/api/config/schools').send({ name: 'Other', code: 'OTH', levelKinds: ['SHS'] })).status).toBe(403);
    expect((await (await loginAs('super@sample.ghlearn.test')).post('/api/config/levels').send(body)).status).toBe(201);
  });
  it('school admin manages only own school and cannot escalate roles', async () => {
    const sa = await loginAs('admin@sample.ghlearn.test');
    expect((await sa.patch(`/api/config/schools/${id(ctx.data.school)}`).send({ region: 'Ashanti' })).status).toBe(200);
    const sup = await loginAs('super@sample.ghlearn.test');
    const other = (await sup.post('/api/config/schools').send({ name: 'Other School', code: 'OTH-1', levelKinds: ['SHS'] })).body;
    expect((await sa.patch(`/api/config/schools/${other._id}`).send({ region: 'X' })).status).toBe(403);
    const users = (await sa.get('/api/admin/users')).body.items;
    expect(users.every((u: any) => u.schoolId === id(ctx.data.school))).toBe(true);
    expect(users.some((u: any) => 'passwordHash' in u)).toBe(false);
    expect((await sa.patch(`/api/admin/users/${id(ctx.data.users.kofi)}`).send({ roles: ['super_admin'] })).status).toBe(403);
    expect((await sa.patch(`/api/admin/users/${id(ctx.data.users.superAdmin)}`).send({ status: 'suspended' })).status).toBe(404);
    expect((await (await loginAs('kofi@sample.ghlearn.test')).get('/api/admin/users')).status).toBe(403);
  });
  it('suspended users lose access immediately', async () => {
    const kofi = await loginAs('kofi@sample.ghlearn.test');
    const sa = await loginAs('admin@sample.ghlearn.test');
    expect((await sa.patch(`/api/admin/users/${id(ctx.data.users.kofi)}`).send({ status: 'suspended' })).status).toBe(200);
    expect((await kofi.get('/api/me/subjects')).status).toBe(401);
    expect((await kofi.post('/api/auth/refresh')).status).toBe(401);
    await sa.patch(`/api/admin/users/${id(ctx.data.users.kofi)}`).send({ status: 'active' });
  });
});
