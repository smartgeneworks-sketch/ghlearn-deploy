import { describe, it, expect, beforeAll } from 'vitest';
import { useDb, ctx, loginAs } from './setup.js';
import { drain } from '../src/services/queue.js';
import { Lesson, LessonVersion, LessonReview, LearningResource, User, CurriculumDocument, CurriculumNode, Job, AuditLog, School, StudentProfile, TeacherAssignment } from '../src/models/index.js';
import { hashPassword } from '../src/services/auth.js';
import { curriculumPdf, buildPdf } from './fixtures.js';
import { useTestLlm, noLlm, testLlm, lessonResponder } from './llmfake.js';
import { config } from '../src/config.js';
import { ProviderError } from '../src/services/ai.js';
import { updateAiSettings, getAiSettings } from '../src/services/aiSettings.js';
const setBudget = (n: number) => updateAiSettings({ platformDailyRequests: n }, String(ctx.data.users.superAdmin._id));

useDb();
const id = (x: any) => String(x._id);
let docId = '', unverifiedId = '';
const settle = async () => { for (let i = 0; i < 5; i++) { await drain(); await Job.updateMany({ status: 'queued' }, { runAt: new Date(0) }); } await drain(); };
const T = { materials: ['Microscope', 'Onion slides'], preparationSteps: ['Prepare slides', 'Check microscopes'], timing: [{ phase: 'Starter', minutes: 10 }], anticipatedMisconceptions: [{ misconception: 'Cells are visible', response: 'Use a microscope' }], differentiation: { support: ['Labelled picture'], extension: ['Compare cells'] }, assessmentNotes: 'Exit ticket' };
const J = { flashcards: [1, 2, 3, 4, 5].map((i) => ({ front: `Card ${i}`, back: 'Back' })), conceptMap: { root: 'Cell', children: [{ label: 'Membrane' }] } };
const respond = () => lessonResponder((keys) => ({ sections: keys.map((k) => ({ key: k, content: `Section ${k}: The cell membrane controls what enters and leaves the cell.`, citations: ['S1'], sourceSupport: 'source',
  data: k === 'T' ? T : k === 'J' ? J : k === 'A' ? { indicators: ['B1.9.9.9 Invented official indicator'] } : {} })) }));
const gen = async (ag: any, body: Record<string, unknown>) => { const r = await ag.post('/api/lessons').send({ subjectId: id(ctx.data.bio), topic: 'Cells and cell structure', documentIds: [docId], ...body }); return r; };

beforeAll(async () => {
  const pw = await hashPassword('GoodPass123');
  await User.create([{ email: 'rev@t.gh', fullName: 'Reviewer One', roles: ['content_reviewer'], passwordHash: pw }, { email: 'rev2@t.gh', fullName: 'Reviewer Two', roles: ['content_reviewer'], passwordHash: pw },
    { email: 'ed2@t.gh', fullName: 'Editor Two', roles: ['curriculum_editor'], passwordHash: pw }]);
  const ed = await loginAs('editor@sample.ghlearn.test');
  docId = (await ed.post('/api/documents/upload').field('subjectId', id(ctx.data.bio)).field('title', 'P7 bio manual').attach('file', curriculumPdf(), 'c.pdf')).body.document._id;
  unverifiedId = (await ed.post('/api/documents/upload').field('subjectId', id(ctx.data.chem)).field('title', 'P7 chem draft').attach('file', buildPdf([{ lines: Array.from({ length: 30 }, (_, i) => `Atoms contain protons, neutrons and electrons; line ${i} about atomic structure.`) }]), 'chem.pdf')).body.document._id;
  await drain();
  await CurriculumDocument.updateOne({ _id: docId }, { approvalStatus: 'verified_official' });
});

describe('§11 generation workspace', () => {
  it('lists the option set: content types, unavailable types with reasons, images not configured, English only', async () => {
    useTestLlm();
    const o = (await (await loginAs('editor@sample.ghlearn.test')).get('/api/lessons/options')).body;
    const ids = o.contentTypes.map((t: any) => t.id);
    for (const k of ['lesson', 'learner_notes', 'summary', 'worked_examples', 'labelled_diagrams', 'concept_map', 'real_life_scenarios', 'activities', 'practical', 'research_project', 'formative_questions', 'revision_cards', 'vocabulary', 'teacher_prep']) expect(ids).toContain(k);
    expect(o.unavailable.map((t: any) => t.id)).toEqual(expect.arrayContaining(['infographics', 'games']));
    expect(o.illustrations.images.available).toBe(false); expect(o.languages).toEqual([{ code: 'en', label: 'English' }]);
    expect(o.defaults).toMatchObject({ difficulty: { easy: 40, medium: 40, hard: 20 }, numActivities: 2, language: 'en' });
    expect(o.contentTypes.find((t: any) => t.id === 'teacher_prep').audience).toEqual(['teacher']);
  });
  it('scope lists approved manuals and curriculum elements; estimate shows tokens, cost basis and budget without calling the provider', async () => {
    useTestLlm();
    const ed = await loginAs('editor@sample.ghlearn.test');
    const s = (await ed.get(`/api/lessons/scope?subjectId=${id(ctx.data.bio)}`)).body;
    expect(s.documents.map((d: any) => d.id)).toContain(docId); expect(s.passages).toBeGreaterThan(0);
    const e = await ed.post('/api/lessons/estimate').send({ subjectId: id(ctx.data.bio), topic: 'Cells', documentIds: [docId], contentType: 'summary' });
    expect(e.status, JSON.stringify(e.body)).toBe(200);
    expect(e.body.sections).toEqual(['J', 'K']); expect(e.body.canGenerate).toBe(true);
    expect(e.body.estimate).toMatchObject({ provider: expect.stringContaining('test-llm'), requests: 1, maxRequestsWithRetries: 3, budget: { allowed: true } });
    expect(e.body.estimate.inputTokens).toBeGreaterThan(0); expect(typeof e.body.estimate.costBasis).toBe('string');
    expect(testLlm.calls.length).toBe(0);
  });
  it('refuses unapproved sources with no provider call, and rejects invalid options', async () => {
    useTestLlm();
    const ed = await loginAs('editor@sample.ghlearn.test');
    const r = await ed.post('/api/lessons').send({ subjectId: id(ctx.data.chem), topic: 'Atoms', documentIds: [unverifiedId] });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('NO_APPROVED_SOURCES');
    const r2 = await ed.post('/api/lessons').send({ subjectId: id(ctx.data.chem), topic: 'Atoms' });
    expect(r2.body.error.code).toBe('NO_APPROVED_SOURCES');
    const e = (await ed.post('/api/lessons/estimate').send({ subjectId: id(ctx.data.chem), topic: 'Atoms', documentIds: [unverifiedId] })).body;
    expect(e.canGenerate).toBe(false); expect(e.problems.join(' ')).toMatch(/Not approved/);
    expect(testLlm.calls.length).toBe(0); expect(await Lesson.countDocuments({ subjectId: ctx.data.chem._id })).toBe(0);
    expect((await gen(ed, { controls: { difficulty: { easy: 50, medium: 50, hard: 50 } } })).status).toBe(422);
    expect((await gen(ed, { controls: { illustrations: 'images' } })).status).toBe(422);
    expect((await gen(ed, { controls: { language: 'tw' } })).status).toBe(422);
    expect((await gen(ed, { pageFrom: 1, pageTo: 1, documentIds: [docId, unverifiedId] })).status).toBe(400);
    expect((await gen(ed, { contentType: 'infographics' })).status).toBe(422);
    const empty = await gen(ed, { pageFrom: 3, pageTo: 3 }); expect(empty.status).toBe(422); expect(empty.body.error.code).toBe('NO_APPROVED_SOURCES'); // page 3 is blank
    expect((await gen(ed, { contentType: 'labelled_diagrams', controls: { illustrations: 'none' } })).status).toBe(400);
  });
  it('maps the curriculum element from the manual, never from the model; obeys the page range; type-specific sections and prompt', async () => {
    useTestLlm(); testLlm.respond = respond();
    const ed = await loginAs('editor@sample.ghlearn.test');
    let node = await CurriculumNode.findOne({ documentId: docId, type: 'indicator' }).lean();
    if (!node) node = (await CurriculumNode.create({ documentId: docId, subjectId: ctx.data.bio._id, type: 'indicator', code: 'B1.1.1.1', title: 'Describe the parts of a plant cell', order: 1, page: 1 })).toObject() as any;
    const r = await gen(ed, { contentType: 'revision_cards', nodeId: id(node), pageFrom: 2, pageTo: 2, controls: { difficulty: { easy: 20, medium: 30, hard: 50 } } });
    expect(r.status, JSON.stringify(r.body)).toBe(202); expect(r.body.estimate.requests).toBe(1);
    await settle();
    const l = (await Lesson.findById(r.body.lesson._id).lean())!;
    expect(l.status).toBe('draft'); expect(l.contentType).toBe('revision_cards');
    expect(l.sections.map((s) => s.key)).toEqual(['J', 'K']);
    expect(l.indicatorSource).toBe('curriculum_node'); expect(l.indicator).toContain(node!.title);
    const prompt = testLlm.calls.at(-1)!.messages.at(-1)!.content;
    expect(prompt).toMatch(/revision cards/i); expect(prompt).toContain('20% easy');
    // only page-2 passages were offered and cited
    for (const s of l.sections) for (const c of s.citations as any[]) { expect(c.pageEnd ?? c.pageStart).toBeGreaterThanOrEqual(2); expect(c.pageStart).toBeLessThanOrEqual(2); } // chunks overlapping page 2
    // a full lesson: the model's own "official indicator" is dropped with a warning; typed text is labelled as the editor's
    const r2 = await gen(ed, { indicator: 'Explain organelle functions' }); await settle();
    const l2 = (await Lesson.findById(r2.body.lesson._id).lean())!;
    expect(l2.indicatorSource).toBe('editor'); expect(JSON.stringify(l2.sections)).not.toContain('Invented official indicator');
    expect(l2.validation!.warnings.join(' ')).toMatch(/indicator/i);
    expect(l2.sections.map((s) => s.key)).not.toContain('T');
  });
  it('cancels a queued generation, retries it, and deletes a failed one (creator or Curriculum Admin only)', async () => {
    useTestLlm(); testLlm.respond = respond();
    const ed = await loginAs('editor@sample.ghlearn.test');
    const r = await gen(ed, { contentType: 'summary' }); const lid = r.body.lesson._id;
    const c = await ed.post(`/api/lessons/${lid}/cancel`); expect(c.status).toBe(200); expect(c.body.lesson.status).toBe('failed'); expect(c.body.lesson.generationError).toMatch(/Cancelled by/);
    expect((await Job.findById(r.body.jobId).lean())!.status).toBe('cancelled');
    expect((await ed.post(`/api/lessons/${lid}/cancel`)).status).toBe(409);
    const d = (await ed.get(`/api/lessons/${lid}`)).body.permissions; expect(d).toMatchObject({ retry: true, delete: true, cancel: false });
    const rt = await ed.post(`/api/lessons/${lid}/retry`); expect(rt.status).toBe(202); await settle();
    expect((await Lesson.findById(lid).lean())!.status).toBe('draft');
    expect((await ed.post(`/api/lessons/${lid}/retry`)).status).toBe(409);
    expect((await ed.delete(`/api/lessons/${lid}`)).status).toBe(409); // not failed
    // provider errors are recorded and shown; the failed generation can be removed
    testLlm.fail = 99;
    const f = await gen(ed, { contentType: 'summary' }); const fid = f.body.lesson._id; await settle(); testLlm.fail = 0;
    const fl = (await ed.get(`/api/lessons/${fid}`)).body; expect(fl.lesson.status).toBe('failed'); expect(fl.lesson.generationError).toMatch(/test provider outage/);
    expect(fl.job.status).toBe('dead');
    expect((await (await loginAs('ed2@t.gh', 'GoodPass123')).delete(`/api/lessons/${fid}`)).status).toBe(403);
    expect((await (await loginAs('ama@sample.ghlearn.test')).delete(`/api/lessons/${fid}`)).status).toBe(403);
    expect((await ed.delete(`/api/lessons/${fid}`)).status).toBe(204);
    expect(await Lesson.exists({ _id: fid })).toBeNull(); expect(await LessonVersion.countDocuments({ lessonId: fid })).toBe(0); expect(await Job.countDocuments({ 'payload.lessonId': fid })).toBe(0);
    expect(await AuditLog.exists({ action: 'lesson.delete', target: fid })).toBeTruthy();
    // a Curriculum Admin may delete someone else's failed generation
    testLlm.fail = 99; const f2 = await gen(ed, { contentType: 'summary' }); await settle(); testLlm.fail = 0;
    expect((await (await loginAs('curriculum@sample.ghlearn.test')).delete(`/api/lessons/${f2.body.lesson._id}`)).status).toBe(204);
    // budget exhausted: refused before queueing
    await setBudget(0);
    const b = await gen(ed, { contentType: 'summary' }); expect(b.status).toBe(429); expect(b.body.error.code).toBe('AI_BUDGET');
    await setBudget(200);
  });
  it('a non-retryable provider error fails the generation at once (no quota spent on retries) and is shown', async () => {
    useTestLlm(); testLlm.respond = () => { throw new ProviderError('gemini.generate failed: HTTP 400 API key not valid', 400, true); };
    const ed = await loginAs('editor@sample.ghlearn.test');
    const r = await gen(ed, { contentType: 'summary' }); await drain();
    const d = (await ed.get(`/api/lessons/${r.body.lesson._id}`)).body;
    expect(d.lesson.status).toBe('failed'); expect(d.lesson.generationError).toMatch(/HTTP 400 API key not valid/); expect(d.job).toMatchObject({ status: 'dead', attempts: 1 });
    expect(testLlm.calls.length).toBe(1);
    expect((await ed.delete(`/api/lessons/${r.body.lesson._id}`)).status).toBe(204);
  });
  it('denies generation to roles without content:edit', async () => {
    useTestLlm();
    for (const e of ['ama@sample.ghlearn.test', 'teacher@sample.ghlearn.test', 'admin@sample.ghlearn.test', 'operator@sample.ghlearn.test', 'counselor@sample.ghlearn.test']) {
      const a = await loginAs(e);
      expect((await a.get('/api/lessons/options')).status, e).toBe(403);
      expect((await a.post('/api/lessons/estimate').send({ subjectId: id(ctx.data.bio), topic: 'Cells' })).status, e).toBe(403);
      expect((await gen(a, {})).status, e).toBe(403);
    }
  });
});

describe('§12 review queue', () => {
  let lid = '';
  it('submit, assign, comment, request changes, resubmit, approve: separation of duties and who/when', async () => {
    useTestLlm(); testLlm.respond = respond();
    const ed = await loginAs('editor@sample.ghlearn.test'); const rv = await loginAs('rev@t.gh', 'GoodPass123'); const rv2 = await loginAs('rev2@t.gh', 'GoodPass123');
    const cur = await loginAs('curriculum@sample.ghlearn.test');
    const r = await gen(ed, { contentType: 'revision_cards' }); lid = r.body.lesson._id; await settle();
    expect((await ed.post(`/api/lessons/${lid}/submit`)).body.lesson.status).toBe('in_review');
    expect((await ed.patch(`/api/lessons/${lid}`).send({ title: 'Edited while in review' })).status).toBe(409);
    const q = (await rv.get('/api/lessons?review=queue')).body.items; const row = q.find((x: any) => x._id === lid);
    expect(row).toMatchObject({ status: 'in_review', createdBy: { fullName: expect.any(String) }, sourceDocumentIds: [{ title: 'P7 bio manual' }] });
    // assignment: self only for reviewers; others by Curriculum Admin; authors and non-reviewers cannot be assignees
    const rv2Id = id((await User.findOne({ email: 'rev2@t.gh' }).lean())!); const rvId = id((await User.findOne({ email: 'rev@t.gh' }).lean())!);
    expect((await rv.post(`/api/lessons/${lid}/assign`).send({ reviewerId: rv2Id })).status).toBe(403);
    expect((await ed.post(`/api/lessons/${lid}/assign`).send({ reviewerId: rvId })).status).toBe(403);
    expect((await cur.post(`/api/lessons/${lid}/assign`).send({ reviewerId: id(ctx.data.users.editor) })).status).toBe(400);
    expect((await cur.post(`/api/lessons/${lid}/assign`).send({ reviewerId: rv2Id })).body.lesson.assignedReviewerId).toBe(rv2Id);
    expect((await rv.get('/api/lessons?review=queue&assigned=me')).body.items.length).toBe(0);
    expect((await rv2.get('/api/lessons?review=queue&assigned=me')).body.items.map((x: any) => x._id)).toEqual([lid]);
    // the unassigned reviewer cannot decide; Curriculum Admin cannot decide either
    expect((await rv.post(`/api/lessons/${lid}/review`).send({ action: 'approve' })).status).toBe(403);
    expect((await cur.post(`/api/lessons/${lid}/review`).send({ action: 'approve' })).status).toBe(403);
    expect((await (await rv.get(`/api/lessons/${lid}`)).body.permissions.decide.reason)).toMatch(/assigned to another/);
    expect((await ed.post(`/api/lessons/${lid}/comments`).send({ comment: 'Please check card 3', sectionKey: 'J' })).status).toBe(201);
    expect((await (await loginAs('ama@sample.ghlearn.test')).post(`/api/lessons/${lid}/comments`).send({ comment: 'hi' })).status).toBe(403);
    // compare with the source passages
    const src = (await rv2.get(`/api/lessons/${lid}/sources`)).body.sections;
    expect(src[0].passages[0]).toMatchObject({ found: true, text: expect.stringContaining('cell'), document: { title: 'P7 bio manual', approvalStatus: 'verified_official', current: true } });
    expect((await rv2.post(`/api/lessons/${lid}/review`).send({ action: 'request_changes' })).status).toBe(400);
    expect((await rv2.post(`/api/lessons/${lid}/review`).send({ action: 'request_changes', comment: 'Card 3 is wrong' })).body.lesson.status).toBe('changes_requested');
    expect((await ed.patch(`/api/lessons/${lid}`).send({ title: 'Cell revision cards' })).status).toBe(200);
    expect((await ed.post(`/api/lessons/${lid}/submit`)).body.lesson.status).toBe('resubmitted');
    expect((await rv2.get('/api/lessons?status=resubmitted')).body.items.map((x: any) => x._id)).toContain(lid);
    expect((await rv2.post(`/api/lessons/${lid}/review`).send({ action: 'approve', comment: 'Good now' })).body.lesson).toMatchObject({ status: 'approved', approvedVersion: expect.any(Number) });
    // history: who did what and when
    const hist = await LessonReview.find({ lessonId: lid }).sort({ createdAt: 1 }).lean();
    expect(hist.map((h) => h.action)).toEqual(['submit', 'assign', 'comment', 'request_changes', 'resubmit', 'approve']);
    for (const h of hist) { expect(h.by).toBeTruthy(); expect(h.createdAt).toBeInstanceOf(Date); }
    expect(String(hist.find((h) => h.action === 'approve')!.by)).toBe(rv2Id);
    const det = (await rv2.get(`/api/lessons/${lid}`)).body;
    expect(det.reviews[0]).toMatchObject({ action: 'approve', by: { fullName: 'Reviewer Two' } });
    expect(det.versions.length).toBeGreaterThanOrEqual(2);
    for (const a of ['lesson.submit', 'lesson.assign', 'lesson.request_changes', 'lesson.resubmit', 'lesson.approve']) expect(await AuditLog.exists({ action: a, target: lid }), a).toBeTruthy();
  });
  it('a reviewer who edited the content cannot approve it', async () => {
    useTestLlm(); testLlm.respond = respond();
    const ed = await loginAs('editor@sample.ghlearn.test'); const sup = await loginAs('super@sample.ghlearn.test');
    const r = await gen(ed, { contentType: 'summary' }); await settle(); const x = r.body.lesson._id;
    await sup.patch(`/api/lessons/${x}`).send({ title: 'Summary edited by super' });
    await ed.post(`/api/lessons/${x}/submit`);
    expect((await sup.post(`/api/lessons/${x}/review`).send({ action: 'approve' })).status).toBe(403);
    expect((await sup.post(`/api/lessons/${x}/assign`).send({ reviewerId: id(ctx.data.users.superAdmin) })).status).toBe(400);
    await sup.post(`/api/lessons/${x}/archive`);
  });
  it('publishing is blocked while mandatory review is incomplete or a source is no longer approved; audience limits who sees it', async () => {
    const rv2 = await loginAs('rev2@t.gh', 'GoodPass123'); const ed = await loginAs('editor@sample.ghlearn.test');
    expect((await ed.post(`/api/lessons/${lid}/publish`)).status).toBe(403);
    expect((await (await loginAs('curriculum@sample.ghlearn.test')).post(`/api/lessons/${lid}/publish`)).status).toBe(403);
    await Lesson.updateOne({ _id: lid }, { $inc: { version: 1 } });
    const inc = await rv2.post(`/api/lessons/${lid}/publish`); expect(inc.status).toBe(422); expect(inc.body.error.code).toBe('REVIEW_INCOMPLETE');
    await Lesson.updateOne({ _id: lid }, { $inc: { version: -1 } });
    await CurriculumDocument.updateOne({ _id: docId }, { supersededBy: ctx.data.doc._id });
    expect((await rv2.post(`/api/lessons/${lid}/publish`)).body.error.code).toBe('SOURCE_NOT_CURRENT');
    await CurriculumDocument.updateOne({ _id: docId }, { $unset: { supersededBy: 1 } });
    // publish for General Science year 2 only: Ama (General Science, year 1) does not see it
    const p = await rv2.post(`/api/lessons/${lid}/publish`).send({ audience: { programmeIds: [id(ctx.data.sci)], yearOfStudy: 2 } });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const res = (await LearningResource.findById(p.body.resourceId).lean())!; expect(res).toMatchObject({ kind: 'revision', contentType: 'revision_cards', status: 'published' });
    const ama = await loginAs('ama@sample.ghlearn.test');
    expect((await ama.get(`/api/resources/${p.body.resourceId}`)).status).toBe(404);
    expect((await ama.get(`/api/subjects/${id(ctx.data.bio)}/resources`)).body.items.map((x: any) => String(x._id))).not.toContain(p.body.resourceId);
    await StudentProfile.updateOne({ userId: ctx.data.users.ama._id }, { yearOfStudy: 2 });
    expect((await ama.get(`/api/resources/${p.body.resourceId}`)).status).toBe(200);
    await StudentProfile.updateOne({ userId: ctx.data.users.ama._id }, { yearOfStudy: 1 });
    // unpublish keeps the approval and hides it; archive withdraws it
    expect((await ed.post(`/api/lessons/${lid}/unpublish`)).status).toBe(403);
    const un = await rv2.post(`/api/lessons/${lid}/unpublish`); expect(un.body.lesson.status).toBe('approved');
    expect((await LearningResource.findById(p.body.resourceId).lean())!.status).toBe('archived');
    expect((await rv2.post(`/api/lessons/${lid}/publish`).send({ audience: { schoolIds: [id(ctx.data.school)] } })).status).toBe(200);
    expect((await ama.get(`/api/resources/${p.body.resourceId}`)).status).toBe(200);
    expect((await (await loginAs('curriculum@sample.ghlearn.test')).post(`/api/lessons/${lid}/archive`)).status).toBe(403); // withdrawing published content needs publish permission
    const ar = await rv2.post(`/api/lessons/${lid}/archive`); expect(ar.body.lesson).toMatchObject({ status: 'archived', archivedBy: expect.any(String) });
    expect((await ama.get(`/api/resources/${p.body.resourceId}`)).status).toBe(404);
    const acts = (await LessonReview.find({ lessonId: lid }).lean()).map((h) => h.action);
    expect(acts).toEqual(expect.arrayContaining(['publish', 'unpublish', 'archive']));
    // archived content: only a Super Admin can delete it permanently (with its withdrawn resource)
    expect((await rv2.delete(`/api/lessons/${lid}`)).status).toBe(403);
    expect((await (await loginAs('curriculum@sample.ghlearn.test')).delete(`/api/lessons/${lid}`)).status).toBe(403);
    expect((await (await loginAs('super@sample.ghlearn.test')).delete(`/api/lessons/${lid}`)).status).toBe(204);
    expect(await LearningResource.exists({ _id: p.body.resourceId })).toBeNull(); expect(await LessonReview.countDocuments({ lessonId: lid })).toBe(0);
    lid = (await Lesson.findOne({ status: { $ne: 'failed' } }).lean())!._id.toString(); // later denial checks need an existing item
  });
  it('an approved item can be sent back; teacher-prep resources are visible to teachers only, at their institution', async () => {
    useTestLlm(); testLlm.respond = respond();
    const ed = await loginAs('editor@sample.ghlearn.test'); const rv = await loginAs('rev@t.gh', 'GoodPass123');
    const r = await gen(ed, { contentType: 'teacher_prep' }); expect(r.status, JSON.stringify(r.body)).toBe(202); await settle(); const x = r.body.lesson._id;
    const l = (await Lesson.findById(x).lean())!; expect(l.sections.map((s) => s.key)).toEqual(['T', 'K']); expect(l.validation!.ok, JSON.stringify(l.validation)).toBe(true);
    await ed.post(`/api/lessons/${x}/submit`);
    await rv.post(`/api/lessons/${x}/review`).send({ action: 'approve' });
    expect((await rv.post(`/api/lessons/${x}/review`).send({ action: 'request_changes', comment: 'One more check' })).body.lesson.status).toBe('changes_requested');
    await ed.post(`/api/lessons/${x}/submit`); await rv.post(`/api/lessons/${x}/review`).send({ action: 'approve' });
    const p = await rv.post(`/api/lessons/${x}/publish`); expect(p.status).toBe(200);
    expect((await LearningResource.findById(p.body.resourceId).lean())!.audience!.roles).toEqual(['teacher']);
    expect((await (await loginAs('ama@sample.ghlearn.test')).get(`/api/resources/${p.body.resourceId}`)).status).toBe(404);
    const t = await loginAs('teacher@sample.ghlearn.test');
    expect((await t.get(`/api/resources/${p.body.resourceId}`)).status).toBe(200);
    // restricted to another institution: the teacher no longer sees it
    const other = await School.create({ name: 'Other P7 School', code: 'OP7', levelIds: [ctx.data.shs._id] } as any);
    await rv.post(`/api/lessons/${x}/unpublish`); await rv.post(`/api/lessons/${x}/publish`).send({ audience: { schoolIds: [id(other)] } });
    expect((await t.get(`/api/resources/${p.body.resourceId}`)).status).toBe(404);
    expect(await TeacherAssignment.exists({ teacherId: ctx.data.users.teacher._id })).toBeTruthy();
  });
  it('lets only reviewers into the queue actions', async () => {
    for (const e of ['ama@sample.ghlearn.test', 'teacher@sample.ghlearn.test', 'admin@sample.ghlearn.test', 'operator@sample.ghlearn.test']) {
      const a = await loginAs(e);
      expect((await a.get('/api/lessons?review=queue')).status, e).toBe(403);
      expect((await a.post(`/api/lessons/${lid}/review`).send({ action: 'approve' })).status, e).toBe(403);
      expect((await a.get('/api/lessons/reviewers')).status, e).toBe(403);
    }
    expect((await (await loginAs('editor@sample.ghlearn.test')).get('/api/lessons/reviewers')).status).toBe(403);
    expect((await (await loginAs('curriculum@sample.ghlearn.test')).get('/api/lessons/reviewers')).body.items.map((u: any) => u.name)).toEqual(expect.arrayContaining(['Reviewer One', 'Reviewer Two']));
    noLlm();
  });
});
