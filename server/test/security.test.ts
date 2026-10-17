import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { useDb, ctx, loginAs, anon } from './setup.js';
import { User } from '../src/models/index.js';
import { hashPassword } from '../src/services/auth.js';
import { config } from '../src/config.js';
/**
 * §23 security: a route-by-role matrix GENERATED from the live Express router (every route the app serves), plus
 * secret protection. New routes are covered automatically: an unauthenticated route that is not on the public
 * allow-list, or an admin route that a learner can reach, fails this test.
 */
useDb();
type R = { method: string; path: string };
const ZERO = '000000000000000000000000';
function routes(): R[] {
  const src = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const prefixes = [...new Set([...src.matchAll(/app\.use\('(\/api[^']*)'/g)].map((m) => m[1]))].sort((a, b) => b.length - a.length);
  const out: R[] = []; const app: any = ctx.app;
  for (const l of app.router.stack) {
    if (l.route) { for (const m of Object.keys(l.route.methods)) out.push({ method: m.toUpperCase(), path: l.route.path }); continue; }
    if (!l.handle?.stack) continue;
    const mount = prefixes.find((p) => { const r = l.matchers?.[0]?.(p); return r && r.path === p; });
    if (!mount) throw new Error('router with unknown mount path');
    for (const s of l.handle.stack) if (s.route) for (const m of Object.keys(s.route.methods)) if (m !== '_all') out.push({ method: m.toUpperCase(), path: mount + (s.route.path === '/' ? '' : s.route.path) });
  }
  return out.filter((r) => r.method !== 'HEAD');
}
const fill = (p: string) => p.replace(/:fmt\b/g, 'csv').replace(/:kind\b/g, 'terms').replace(/:key\b/g, 'overview').replace(/:[A-Za-z_]+/g, ZERO).replace(/[{}*]/g, '');
const call = (agent: any, r: R) => (agent[r.method.toLowerCase()](fill(r.path)) as any).send({});
const PUBLIC = new Set(['GET /api/auth/csrf', 'GET /api/health', 'GET /api/docs/openapi.json', 'POST /api/auth/register', 'POST /api/auth/login', 'POST /api/auth/refresh', 'POST /api/auth/logout',
  'POST /api/auth/forgot-password', 'POST /api/auth/reset-password', 'POST /api/auth/reset-password/check', 'GET /api/settings/public', 'GET /api/settings/legal/:kind', 'GET /api/config/catalog', 'GET /api/config/schools/search', 'POST /api/auth/accept-invite',
  // Public website (docs/LANDING.md): session probe and the public landing, catalogue, search, preview and enquiry endpoints.
  'GET /api/auth/session', 'GET /api/public/landing', 'GET /api/public/subjects', 'GET /api/public/subjects/:id', 'GET /api/public/search', 'GET /api/public/lessons/:id', 'POST /api/public/enquiries']);
/** Areas only staff with an admin permission may use. Learners, parents, teachers and counselors are refused all of them. */
const ADMIN_AREA = [/^\/api\/admin(\/|$)/, /^\/api\/jobs(\/|$)/, /^\/api\/documents(\/|$)/, /^\/api\/analytics\/reports/, /^\/api\/curriculum\/review/];
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CONTENT_WRITE = [/^\/api\/config\//, /^\/api\/curriculum\//, /^\/api\/questions(\/|$)/, /^\/api\/game-designs(\/|$)/, /^\/api\/announcements(\/|$)/];
/** Platform-only (Super Admin) routes: school admins and operators are refused. */
const PLATFORM_ONLY: R[] = [
  { method: 'PATCH', path: '/api/admin/settings' }, { method: 'POST', path: '/api/admin/settings/academic-year' }, { method: 'POST', path: '/api/admin/settings/retention/run' },
  { method: 'POST', path: '/api/admin/settings/check' }, { method: 'PATCH', path: '/api/admin/ai/settings' },
];
const denied = (s: number) => s === 401 || s === 403 || s === 404;
let all: R[]; const agents: Record<string, any> = {};
beforeAll(async () => {
  all = routes();
  await User.create({ email: 'parent10@x.test', fullName: 'Parent Ten', roles: ['parent'], passwordHash: await hashPassword('GoodPass123') });
  for (const [k, e] of Object.entries({ student: 'ama@sample.ghlearn.test', teacher: 'teacher@sample.ghlearn.test', counselor: 'counselor@sample.ghlearn.test', schoolAdmin: 'admin@sample.ghlearn.test', operator: 'operator@sample.ghlearn.test', editor: 'editor@sample.ghlearn.test' }))
    agents[k] = await loginAs(e);
  agents.parent = await loginAs('parent10@x.test', 'GoodPass123');
});

describe('§23 generated route-by-role matrix (direct API calls)', () => {
  it('the router walk finds every mounted area', () => {
    expect(all.length).toBeGreaterThan(250); console.log(`route matrix: ${all.length} routes`);
    for (const p of ['/api/admin/users', '/api/admin/settings', '/api/admin/ai/settings', '/api/jobs', '/api/announcements', '/api/analytics/reports']) expect(all.some((r) => r.path.startsWith(p)), p).toBe(true);
  });
  it('anonymous callers get 401 on every route except the documented public ones', async () => {
    const a = await anon(); const bad: string[] = [];
    for (const r of all) { if (PUBLIC.has(`${r.method} ${r.path}`)) continue; const s = (await call(a, r)).status; if (s !== 401) bad.push(`${r.method} ${r.path} -> ${s}`); }
    expect(bad).toEqual([]);
  });
  it('learners, parents, teachers and counselors are refused every admin-area route', async () => {
    const targets = all.filter((r) => ADMIN_AREA.some((x) => x.test(r.path)));
    expect(targets.length).toBeGreaterThan(90);
    const bad: string[] = [];
    for (const role of ['student', 'parent', 'teacher', 'counselor']) for (const r of targets) { const s = (await call(agents[role], r)).status; if (!denied(s)) bad.push(`${role} ${r.method} ${r.path} -> ${s}`); }
    expect(bad).toEqual([]);
  });
  it('learners and parents cannot write curriculum, questions, games, configuration or announcements', async () => {
    const targets = all.filter((r) => WRITE.has(r.method) && CONTENT_WRITE.some((x) => x.test(r.path)));
    expect(targets.length).toBeGreaterThan(40);
    const bad: string[] = [];
    for (const role of ['student', 'parent']) for (const r of targets) { const s = (await call(agents[role], r)).status; if (!denied(s)) bad.push(`${role} ${r.method} ${r.path} -> ${s}`); }
    expect(bad).toEqual([]);
  });
  it('platform-only routes refuse school admins, operators and editors', async () => {
    for (const r of PLATFORM_ONLY) expect(all.some((x) => x.method === r.method && x.path === r.path), `${r.method} ${r.path} exists`).toBe(true);
    const bad: string[] = [];
    for (const role of ['schoolAdmin', 'operator', 'editor']) for (const r of PLATFORM_ONLY) { const s = (await call(agents[role], r)).status; if (s !== 403) bad.push(`${role} ${r.method} ${r.path} -> ${s}`); }
    expect(bad).toEqual([]);
  });
  it('school admins cannot change platform users, schools or curriculum structure', async () => {
    const targets = all.filter((r) => WRITE.has(r.method) && (/^\/api\/config\//.test(r.path) || r.path === '/api/admin/schools' || /^\/api\/admin\/ai\//.test(r.path)));
    const bad: string[] = [];
    for (const r of targets) { const s = (await call(agents.schoolAdmin, r)).status; if (!denied(s)) bad.push(`${r.method} ${r.path} -> ${s}`); }
    expect(bad).toEqual([]);
  });
});

describe('§23 staff roles only reach their own areas', () => {
  it('content staff and operators cannot manage users, schools or classes; content staff cannot see the audit log', async () => {
    agents.curriculum = await loginAs('curriculum@sample.ghlearn.test');
    const people = all.filter((r) => /^\/api\/admin\/(users|schools|classes)(\/|$)/.test(r.path));
    expect(people.length).toBeGreaterThan(20);
    const bad: string[] = [];
    for (const role of ['editor', 'curriculum']) for (const r of people) { const s = (await call(agents[role], r)).status; if (!denied(s)) bad.push(`${role} ${r.method} ${r.path} -> ${s}`); }
    for (const r of people.filter((x) => WRITE.has(x.method))) { const s = (await call(agents.operator, r)).status; if (!denied(s)) bad.push(`operator ${r.method} ${r.path} -> ${s}`); }
    for (const r of all.filter((x) => x.path.startsWith('/api/admin/audit'))) for (const role of ['editor', 'curriculum']) { const s = (await call(agents[role], r)).status; if (!denied(s)) bad.push(`${role} ${r.method} ${r.path} -> ${s}`); }
    expect(bad).toEqual([]);
  });
});

describe('§23 secret protection', () => {
  const FAKE = { GEMINI_API_KEY: 'AIzaFAKEgeminiKEY0123456789abcdefghijk', LLM_API_KEY: 'llm-fake-secret-0123456789abcdef', EMBEDDING_API_KEY: 'emb-fake-secret-0123456789abcdef',
    IMAGE_API_KEY: 'img-fake-secret-0123456789abcdef', SMTP_URL: 'smtps://mailer:smtp-fake-password-0123@smtp.example.test:465' };
  it('no GET response for any role ever contains a secret value (env keys, JWT secrets, SMTP password, password hashes)', async () => {
    const saved: Record<string, unknown> = {}; for (const [k, v] of Object.entries(FAKE)) { saved[k] = (config as any)[k]; (config as any)[k] = v; }
    try {
      const needles = [...Object.values(FAKE), 'smtp-fake-password-0123', config.JWT_ACCESS_SECRET, config.JWT_REFRESH_SECRET, '$2b$12$'];
      const sup = await loginAs('super@sample.ghlearn.test'); const bad: string[] = [];
      const gets = all.filter((r) => r.method === 'GET' && !r.path.includes(':'));
      expect(gets.length).toBeGreaterThan(60);
      for (const [name, agent] of [['super', sup], ['operator', agents.operator], ['schoolAdmin', agents.schoolAdmin], ['student', agents.student]] as const)
        for (const r of gets) { const res = await agent.get(r.path); const body = typeof res.text === 'string' ? res.text : ''; for (const n of needles) if (n && body.includes(n)) bad.push(`${name} ${r.path} leaks ${n.slice(0, 6)}…`); }
      expect(bad).toEqual([]);
      const ai = await sup.get('/api/admin/ai/settings'); expect(ai.body.secrets.find((s: any) => s.name === 'GEMINI_API_KEY')).toEqual({ name: 'GEMINI_API_KEY', purpose: expect.any(String), set: true });
    } finally { for (const [k, v] of Object.entries(saved)) (config as any)[k] = v; }
  });
  it('error responses do not expose stack traces or internals', async () => {
    const sup = await loginAs('super@sample.ghlearn.test');
    for (const p of ['/api/admin/users/not-an-id', '/api/curriculum/subjects/zzz', `/api/admin/schools/${ZERO}`]) {
      const r = await sup.get(p); expect(r.status).toBeLessThan(500); expect(r.text).not.toMatch(/at .+\.(ts|js):\d+|node_modules|MongoServerError|CastError/);
    }
  });
  it('mutating requests without the CSRF token are refused', async () => {
    const sup = await loginAs('super@sample.ghlearn.test');
    const r = await sup.patch('/api/admin/settings').set('X-CSRF-Token', 'wrong').send({ branding: { tagline: 'x' } }); expect(r.status).toBe(403);
  });
});
