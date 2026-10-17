import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { useDb, ctx, loginAs, anon } from './setup.js';
useDb();
const reg = { fullName: 'Test Learner', email: 'Learner@Test.gh', password: 'GoodPass123', acceptTerms: true };

describe('auth', () => {
  it('registers a student, sets httpOnly cookies, returns /me', async () => {
    const a = await anon();
    const r = await a.post('/api/auth/register').send({ ...reg, roles: ['super_admin'] });
    expect(r.status).toBe(201);
    expect(r.body.user.roles).toEqual(['student']); // cannot self-assign roles
    expect(r.body.user.email).toBe('learner@test.gh');
    expect(r.body.user.onboarded).toBe(false);
    const cookies = ([] as string[]).concat(r.headers['set-cookie'] as any);
    expect(cookies.some((c) => c.startsWith('gl_at=') && /HttpOnly/i.test(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith('gl_rt=') && /Path=\/api\/auth/.test(c))).toBe(true);
    expect((await a.get('/api/auth/me')).body.user.email).toBe('learner@test.gh');
  });
  it('rejects duplicates, weak passwords and missing consent with standard errors', async () => {
    expect((await (await anon()).post('/api/auth/register').send(reg)).status).toBe(409);
    const weak = await (await anon()).post('/api/auth/register').send({ ...reg, email: 'w@t.gh', password: 'short' });
    expect(weak.status).toBe(422);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
    expect((await (await anon()).post('/api/auth/register').send({ ...reg, email: 'c@t.gh', acceptTerms: false })).status).toBe(422);
  });
  it('rejects bad credentials and NoSQL operator injection', async () => {
    expect((await (await anon()).post('/api/auth/login').send({ email: 'ama@sample.ghlearn.test', password: 'nope' })).status).toBe(401);
    expect((await (await anon()).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } })).status).toBe(422);
  });
  it('locks the account after repeated failures', async () => {
    await (await anon()).post('/api/auth/register').send({ ...reg, email: 'lock@t.gh' });
    for (let i = 0; i < 8; i++) await (await anon()).post('/api/auth/login').send({ email: 'lock@t.gh', password: 'wrongpass1' });
    expect((await (await anon()).post('/api/auth/login').send({ email: 'lock@t.gh', password: reg.password })).status).toBe(423);
  });
  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const a = await anon();
    const r = await a.post('/api/auth/login').send({ email: 'ama@sample.ghlearn.test', password: 'SamplePass2026' });
    const old = ([] as string[]).concat(r.headers['set-cookie'] as any).find((c) => c.startsWith('gl_rt='))!.split(';')[0];
    expect((await a.post('/api/auth/refresh')).status).toBe(200);
    // replay old token -> rejected, and whole family revoked
    const b = await anon();
    expect((await b.post('/api/auth/refresh').set('Cookie', `${old}; gl_csrf=${b.csrf}`)).status).toBe(401);
    expect((await a.post('/api/auth/refresh')).status).toBe(401);
  });
  it('logout revokes refresh', async () => {
    const a = await loginAs('kofi@sample.ghlearn.test');
    expect((await a.post('/api/auth/logout')).status).toBe(204);
    expect((await a.post('/api/auth/refresh')).status).toBe(401);
    expect((await a.get('/api/auth/me')).status).toBe(401);
  });
  it('unauthenticated access is 401 and unknown routes 404 with JSON error', async () => {
    const r = await (await anon()).get('/api/me/subjects');
    expect(r.status).toBe(401); expect(r.body.error.code).toBe('UNAUTHENTICATED');
    expect((await (await anon()).get('/api/nope')).body.error.code).toBe('NOT_FOUND');
    const h = await (await anon()).get('/api/health');
    expect(h.headers['x-content-type-options']).toBe('nosniff'); expect(h.body.ai.llm).toBe('disabled');
  });

  it('CSRF: unsafe requests need a matching token; bad origins rejected', async () => {
    const a = await loginAs('ama@sample.ghlearn.test');
    const noHeader = await request(ctx.app).post('/api/auth/login').send({ email: 'ama@sample.ghlearn.test', password: 'SamplePass2026' });
    expect(noHeader.status).toBe(403); expect(noHeader.body.error.code).toBe('CSRF_INVALID');
    const wrong = await a.post('/api/auth/logout').set('X-CSRF-Token', 'forged');
    expect(wrong.body.error.code).toBe('CSRF_INVALID');
    const evil = await a.post('/api/auth/logout').set('Origin', 'https://evil.example');
    expect(evil.body.error.code).toBe('CSRF_ORIGIN');
    expect((await a.get('/api/me/subjects')).status).toBe(200); // safe methods unaffected
    expect((await a.post('/api/auth/logout')).status).toBe(204);
  });
});
