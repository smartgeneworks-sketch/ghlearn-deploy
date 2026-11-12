import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { useDb, ctx, loginAs, anon } from './setup.js';
import { AuditLog, Lesson, LearningResource, CurriculumNode, Enquiry, PlatformSettings, Subject } from '../src/models/index.js';
import { LANDING_DEFAULTS } from '@ghlearn/shared/src/landing';
import { clearLandingCache } from '../src/services/landingContent.js';
/** Public landing API (docs/LANDING_SPEC.md): real data, no leaks, validated + audited content, stored enquiries. */
useDb();
const settle = () => new Promise((r) => setTimeout(r, 60));
const sec = (key: string, kind: string, content: string, data: any = {}) => ({ key, kind, title: kind, content, data, citations: [] });
const SECRET_ANSWER = 'SECRET-ANSWER-KEY-42'; const TEACHER_NOTE = 'TEACHER-ONLY-NOTE';
let pub = '', draft = '', notPreview = '', schoolOnly = '', teacherOnly = '';
async function lesson(title: string, o: { status?: string; publicPreview?: boolean; schoolIds?: any[]; roles?: string[]; resStatus?: string } = {}) {
  const sections = [sec('A', 'identification', 'Overview of photosynthesis'), sec('B', 'objectives', '', { objectives: ['Describe photosynthesis'] }), sec('E', 'explanation', 'Plants use light.'),
    sec('I', 'assessment', '', { questions: [{ question: 'Q?', options: ['a', 'b'], correctIndex: 1, explanation: SECRET_ANSWER }] }), sec('T', 'teacher_prep', TEACHER_NOTE)];
  const r: any = await (LearningResource as any).create({ title, kind: 'notes', subjectId: ctx.data.bio._id, status: o.resStatus ?? (o.status === 'published' || !o.status ? 'published' : 'draft'),
    audience: { roles: o.roles ?? ['student', 'teacher'], schoolIds: o.schoolIds ?? [] }, body: { sections, sourceDocuments: [{ title: 'Manual', approvalStatus: 'verified_official' }] } });
  const l: any = await (Lesson as any).create({ title, subjectId: ctx.data.bio._id, topic: 'Photosynthesis', status: o.status ?? 'published', publicPreview: o.publicPreview ?? true, resourceId: r._id, sections,
    audience: { schoolIds: o.schoolIds ?? [] }, publishedAt: new Date() });
  return String(l._id);
}
beforeAll(async () => {
  pub = await lesson('Photosynthesis public preview');
  draft = await lesson('Photosynthesis draft', { status: 'in_review' });
  notPreview = await lesson('Photosynthesis not preview', { publicPreview: false });
  schoolOnly = await lesson('Photosynthesis school only', { schoolIds: [ctx.data.school._id] });
  teacherOnly = await lesson('Photosynthesis teacher guide', { roles: ['teacher'] });
  await CurriculumNode.create({ documentId: ctx.data.doc._id, subjectId: ctx.data.bio._id, type: 'topic', title: 'Photosynthesis in green plants', verified: true });
  await CurriculumNode.create({ documentId: ctx.data.doc._id, subjectId: ctx.data.bio._id, type: 'topic', title: 'Photosynthesis UNVERIFIED', verified: false });
});
afterEach(async () => { await PlatformSettings.deleteMany({ key: 'landing' }); clearLandingCache(); });

describe('public landing content', () => {
  it('serves defaults with branding and levels to anonymous visitors', async () => {
    const r = await (await anon()).get('/api/public/landing'); expect(r.status).toBe(200);
    expect(r.body.content.hero.title).toBe('Your Curriculum. Your AI Tutor. Your Path to Success.');
    expect(r.body.content.organisation).toMatchObject({ name: 'SmartGene Solutions', email: 'info@smartgenesolutions.com', phone: '+233 53 050 6573' });
    expect(r.body.content.organisation.poweredByLabel).toBe(''); expect(r.body.content.liveSessions.points.length).toBeGreaterThanOrEqual(3); expect(r.body.features.meetings).toBe(true);
    expect(r.body.branding.appName).toBe('GH Learn'); expect(r.body.levels.map((l: any) => [l.kind, l.enabled])).toEqual(expect.arrayContaining([['SHS', true], ['JHS', false]]));
  });
  it('only a super admin edits; invalid content is refused with paths; changes are versioned and audited', async () => {
    for (const e of ['admin@sample.ghlearn.test', 'editor@sample.ghlearn.test', 'operator@sample.ghlearn.test', 'ama@sample.ghlearn.test']) {
      const a = await loginAs(e); expect((await a.get('/api/admin/website/landing')).status).toBe(403); expect((await a.put('/api/admin/website/landing').send(LANDING_DEFAULTS)).status).toBe(403); }
    expect((await (await anon()).put('/api/admin/website/landing').send(LANDING_DEFAULTS)).status).toBe(401);
    const s = await loginAs('super@sample.ghlearn.test');
    const bad = { ...LANDING_DEFAULTS, hero: { ...LANDING_DEFAULTS.hero, primaryCta: { label: 'Go', href: 'javascript:alert(1)' } }, faqs: [] };
    const chk = await s.post('/api/admin/website/landing/check').send(bad); expect(chk.body.ok).toBe(false);
    expect(chk.body.issues.map((i: any) => i.path)).toEqual(expect.arrayContaining(['hero.primaryCta.href', 'faqs']));
    expect((await s.put('/api/admin/website/landing').send(bad)).status).toBe(422);
    expect((await s.put('/api/admin/website/landing').send({ ...LANDING_DEFAULTS, footer: { ...LANDING_DEFAULTS.footer, description: 'key AIzaSyA0123456789012345678901234567890abc' } })).body.error.code).toBe('SECRET_REJECTED');
    const good = { ...LANDING_DEFAULTS, announcement: { ...LANDING_DEFAULTS.announcement, text: 'Term 2 lessons are live' } };
    const p = await s.put('/api/admin/website/landing').send(good); expect(p.status).toBe(200); expect(p.body.changed).toEqual(['announcement']); expect(p.body.version).toBe(1);
    expect((await (await anon()).get('/api/public/landing')).body.content.announcement.text).toBe('Term 2 lessons are live');
    await settle(); const a: any = await AuditLog.findOne({ action: 'landing.update' }).lean();
    expect(a.after.announcement.text).toBe('Term 2 lessons are live'); expect(a.before.announcement.text).toBe(LANDING_DEFAULTS.announcement.text);
    expect((await s.post('/api/admin/website/landing/reset')).body.content.announcement.text).toBe(LANDING_DEFAULTS.announcement.text);
  });
});

describe('public subjects and search never leak restricted content', () => {
  it('lists active subjects at enabled levels with real counts; filters work; JHS reports closed', async () => {
    const a = await anon(); const r = await a.get('/api/public/subjects'); expect(r.status).toBe(200);
    const bio = r.body.items.find((s: any) => s.code === 'BIO'); expect(bio.publishedLessons).toBe(3); // sample notes + public + not-preview (published for students); school-only and teacher-only excluded
    expect(r.body.items[0].code).toBe('MATH'); // featured order
    const sci = await a.get('/api/public/subjects?filter=math-science'); expect(sci.body.items.map((s: any) => s.code)).toEqual(expect.arrayContaining(['BIO', 'CHEM', 'MATH'])); expect(sci.body.items.map((s: any) => s.code)).not.toContain('ECON');
    const jhs = await a.get('/api/public/subjects?filter=jhs'); expect(jhs.body.items).toEqual([]); expect(jhs.body.levelClosed).toBe('Junior High School');
    expect((await a.get('/api/public/subjects?filter=nope')).status).toBe(422);
    await Subject.updateOne({ code: 'PHY' }, { active: false });
    expect((await a.get('/api/public/subjects')).body.items.map((s: any) => s.code)).not.toContain('PHY');
    await Subject.updateOne({ code: 'PHY' }, { active: true });
  });
  it('search returns subjects, verified topics and only public-preview lessons', async () => {
    const a = await anon(); const r = await a.get('/api/public/search?q=photosynth'); expect(r.status).toBe(200);
    expect(r.body.topics.map((t: any) => t.title)).toEqual(['Photosynthesis in green plants']);
    expect(r.body.lessons.map((l: any) => l.id)).toEqual([pub]);
    expect(JSON.stringify(r.body)).not.toMatch(/draft|not preview|school only|teacher guide|UNVERIFIED/i);
    expect((await a.get('/api/public/search?q=biol')).body.subjects.map((s: any) => s.code)).toContain('BIO');
    expect((await a.get('/api/public/search?q=senior high')).body.subjects.length).toBeGreaterThan(0);
    expect((await a.get('/api/public/search?q=x')).status).toBe(422);
    expect((await a.get('/api/public/search?q=' + encodeURIComponent('.*'))).body.subjects).toEqual([]); // regex is escaped
    // signed-in users get exactly the same public answer
    const ama = await loginAs('ama@sample.ghlearn.test'); expect((await ama.get('/api/public/search?q=photosynth')).body.lessons.map((l: any) => l.id)).toEqual([pub]);
  });
  it('a preview lesson hides assessment answers and teacher notes; anything else is 404', async () => {
    const a = await anon(); const r = await a.get(`/api/public/lessons/${pub}`); expect(r.status).toBe(200);
    expect(r.body.lesson.sections.map((s: any) => s.key)).toEqual(['A', 'B', 'E']);
    expect(JSON.stringify(r.body)).not.toContain(SECRET_ANSWER); expect(JSON.stringify(r.body)).not.toContain(TEACHER_NOTE);
    for (const id of [draft, notPreview, schoolOnly, teacherOnly, '0123456789abcdef01234567', 'bad']) expect((await a.get(`/api/public/lessons/${id}`)).status).toBe(404);
    const sub = await a.get(`/api/public/subjects/${ctx.data.bio._id}`); expect(sub.body.previews.map((p: any) => p.id)).toEqual([pub]); expect(sub.body.topics.map((t: any) => t.title)).toEqual(['Photosynthesis in green plants']);
  });
  it('the publish permission toggles a preview; restricted or unpublished lessons cannot be made public; unpublish clears it', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test'); expect((await ed.post(`/api/lessons/${notPreview}/public-preview`).send({ enabled: true })).status).toBe(403);
    const s = await loginAs('super@sample.ghlearn.test');
    expect((await s.post(`/api/lessons/${schoolOnly}/public-preview`).send({ enabled: true })).status).toBe(409);
    expect((await s.post(`/api/lessons/${draft}/public-preview`).send({ enabled: true })).status).toBe(409);
    expect((await s.post(`/api/lessons/${teacherOnly}/public-preview`).send({ enabled: true })).status).toBe(409);
    expect((await s.post(`/api/lessons/${notPreview}/public-preview`).send({ enabled: true })).status).toBe(200);
    expect((await (await anon()).get(`/api/public/lessons/${notPreview}`)).status).toBe(200);
    await settle(); expect(await AuditLog.exists({ action: 'lesson.public_preview', target: notPreview })).toBeTruthy();
    expect((await s.post(`/api/lessons/${notPreview}/unpublish`).send({})).status).toBe(200);
    expect((await Lesson.findById(notPreview).lean() as any).publicPreview).toBe(false);
    expect((await (await anon()).get(`/api/public/lessons/${notPreview}`)).status).toBe(404);
  });
});

describe('enquiries', () => {
  const body = { kind: 'school', name: 'Akosua Owusu', email: 'akosua@example.com', organisation: 'Test SHS', role: 'Headteacher', learners: 900, message: 'We would like a demonstration for our staff.', consent: true };
  it('are validated (honeypot, consent, school name), stored and audited; email only when configured', async () => {
    const a = await anon();
    expect((await a.post('/api/public/enquiries').send({ ...body, consent: false })).status).toBe(422);
    expect((await a.post('/api/public/enquiries').send({ ...body, organisation: '' })).status).toBe(422);
    expect((await a.post('/api/public/enquiries').send({ ...body, website: 'http://spam' })).status).toBe(422);
    const r = await a.post('/api/public/enquiries').send(body); expect(r.status).toBe(201); expect(r.body.reference).toMatch(/^[A-F0-9]{8}$/);
    const e: any = await Enquiry.findOne({ email: 'akosua@example.com' }).lean(); expect(e).toMatchObject({ kind: 'school', status: 'new', organisation: 'Test SHS' }); expect(['sent', 'not_configured', 'failed', 'no_address']).toContain(e.emailStatus);
    expect((await a.post('/api/public/enquiries').send({ kind: 'contact', name: 'Kwame', email: 'k@example.com', message: 'Where do I find my lessons?', consent: true })).status).toBe(201);
    await settle(); expect(await AuditLog.exists({ action: 'enquiry.create' })).toBeTruthy();
  });
  it('only super admins list and update them', async () => {
    const t = await loginAs('admin@sample.ghlearn.test'); expect((await t.get('/api/admin/website/enquiries')).status).toBe(403);
    const s = await loginAs('super@sample.ghlearn.test'); const l = await s.get('/api/admin/website/enquiries?kind=school'); expect(l.status).toBe(200);
    expect(l.body.items[0]).not.toHaveProperty('ip'); const id = l.body.items[0]._id;
    const p = await s.patch(`/api/admin/website/enquiries/${id}`).send({ status: 'in_progress', adminNote: 'Called back' }); expect(p.body.status).toBe('in_progress');
    await settle(); expect(await AuditLog.exists({ action: 'enquiry.update', target: id })).toBeTruthy();
    expect((await s.patch(`/api/admin/website/enquiries/${id}`).send({ status: 'bogus' })).status).toBe(422);
  });
});

describe('sample data on public pages (production behaviour)', () => {
  afterEach(() => { delete process.env.HIDE_SAMPLE_PUBLIC; });
  it('hides the sample school, sample lessons and their counts, but keeps real subjects merged into seeded records', async () => {
    const before = await (await anon()).get(`/api/public/subjects/${ctx.data.bio._id}`); expect(before.body.previews.length).toBeGreaterThan(0);
    await Lesson.updateMany({}, { isSample: true }); await LearningResource.updateMany({}, { isSample: true });
    process.env.HIDE_SAMPLE_PUBLIC = '1'; const a = await anon();
    const opts = await a.get('/api/public/teacher-applications/options');
    expect(opts.body.schools.map((s: any) => s.name)).not.toContain('Sample Academy (Sample)');
    const sub = await a.get(`/api/public/subjects/${ctx.data.bio._id}`); expect(sub.status).toBe(200);
    expect(sub.body.previews).toEqual([]); expect(sub.body.subject.publishedLessons).toBe(0);
    expect((await a.get(`/api/public/lessons/${pub}`)).status).toBe(404);
    expect((await a.get('/api/public/search?q=photosynthesis')).body.lessons).toEqual([]);
    delete process.env.HIDE_SAMPLE_PUBLIC;
    expect((await a.get('/api/public/teacher-applications/options')).body.schools.map((s: any) => s.name)).toContain('Sample Academy (Sample)');
    await Lesson.updateMany({}, { isSample: false }); await LearningResource.updateMany({}, { isSample: false });
  });
});
