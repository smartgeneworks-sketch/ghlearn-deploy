import { describe, it, expect, beforeAll } from 'vitest';
import { useDb, ctx, loginAs } from './setup.js';
import { drain } from '../src/services/queue.js';
import { Lesson, LessonVersion, LearningResource, CurriculumDocument, Job, AuditLog, Subject } from '../src/models/index.js';
import { curriculumPdf } from './fixtures.js';
import { useTestLlm, testLlm } from './llmfake.js';
import { runCheck, readingTime } from '../src/services/lessons/modules.js';
import { moduleThumbnail } from '../src/services/lessons/thumbnail.js';
import { computeLocks } from '../src/services/lessons/progression.js';

useDb();
const settle = async () => { for (let i = 0; i < 5; i++) { await drain(); await Job.updateMany({ status: 'queued' }, { runAt: new Date(0) }); } await drain(); };
const txt = 'The cell membrane controls what enters and leaves the cell.';
const moduleOut = (bad: boolean) => ({ title: bad ? 'Organelles' : 'The cell membrane', gaps: [], sections: [
  { key: 'A', content: `Introduction. ${txt}`, citations: ['S1'] }, { key: 'B', content: '', data: { objectives: ['State the function of the cell membrane', 'Describe organelles'] }, citations: ['S1'] },
  { key: 'C', content: txt, data: { concepts: [{ name: 'Cell membrane', explanation: 'Controls entry' }] }, citations: ['S1'] }, { key: 'D', content: `## Steps\n${txt} Area $A = l \\times w$.`, citations: ['S1'] },
  { key: 'E', data: { examples: [{ problem: 'Find 3/4 of 120', steps: ['3/4 × 120', '= 90'], answer: '90', check: { type: 'evaluate', expression: '(3/4)*120', expected: bad ? '80' : '90' } },
    { problem: 'Solve 2x + 3 = 11', steps: ['2x = 8', 'x = 4'], answer: 'x = 4', check: { type: 'solution', equation: '2*x+3=11', variable: 'x', value: '4' } }] }, citations: ['S1'] },
  { key: 'F', data: { diagrams: [{ kind: 'flow', title: 'Entry', caption: 'Entry path', alt: 'Substances pass through the membrane', steps: ['Outside', 'Membrane', 'Inside'] }] }, citations: ['S1'] },
  { key: 'G', content: 'At the market, sellers measure ...', citations: [] }, { key: 'H', data: { mistakes: [{ mistake: 'Adding denominators', correction: 'Find a common denominator' }] } },
  { key: 'I', content: '- Membrane controls entry', citations: ['S1'] }, { key: 'J', data: { terms: [{ term: 'Membrane', definition: 'Outer layer of the cell' }] }, citations: ['S1'] },
  { key: 'K', data: { exercises: [{ question: 'Find 10% of 50', answer: '5', difficulty: 'easy', check: { type: 'evaluate', expression: '0.1*50', expected: '5' } }] } },
  { key: 'L', data: { questions: [0, 1, 2].map((i) => ({ question: `Q${i}`, options: ['a', 'b', 'c', 'd'], correctIndex: 2, explanation: 'because' })) }, citations: ['S1'] },
  { key: 'M', content: 'Read the next section of your learner manual.' }] });

let curId = '', lmId = '';
beforeAll(async () => {
  const ed = await loginAs('editor@sample.ghlearn.test');
  lmId = (await ed.post('/api/documents/upload').field('subjectId', String(ctx.data.bio._id)).field('title', 'Bio LM').attach('file', curriculumPdf(), 'c.pdf')).body.document._id;
  await drain(); await CurriculumDocument.updateOne({ _id: lmId }, { approvalStatus: 'verified_official', docType: 'learner_manual' });
  curId = String((await CurriculumDocument.create({ title: 'Bio curriculum', docType: 'curriculum', subjectId: ctx.data.bio._id })).id);
  const els = [{ kind: 'CS', n: 1, sub: 1, text: 'Demonstrate understanding of cells.' }, { kind: 'LI', n: 1, sub: 1, text: 'Describe the cell membrane.' }, { kind: 'LI', n: 2, sub: 1, text: 'Describe organelles FAILCASE.' },
    { kind: 'CS', n: 1, sub: 2, text: 'Demonstrate understanding of tissues.' }, { kind: 'LI', n: 1, sub: 2, text: 'Describe tissues.' }]
    .map((e) => ({ year: 1, strand: 1, subStrand: e.sub, kind: e.kind, n: e.n, code: `1.1.${e.sub}.${e.kind}.${e.n}`, page: 10 + e.n, text: e.text, ...(e.kind === 'LI' ? { contentStandard: 1 } : {}) }));
  const r = await (await loginAs('super@sample.ghlearn.test')).post('/api/curriculum/import-structure').send({ documentId: curId, parser: 't', dryRun: false, strands: [{ year: 1, strand: 1, title: 'Living things', page: 9 }],
    subStrands: [{ year: 1, strand: 1, subStrand: 1, title: 'Cells', page: 9 }, { year: 1, strand: 1, subStrand: 2, title: 'Tissues', page: 9 }], elements: els, lm: [{ year: 1, strand: 1, subStrand: 1, documentIds: [lmId] }] });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
});

describe('Curriculum LMS units', () => {
  it('CAS checks evaluate, solutions and equivalence with mathjs; unparseable checks are skipped, not passed', () => {
    expect(runCheck({ type: 'evaluate', expression: '(3/4)*120', expected: '90' }).result).toBe('pass');
    expect(runCheck({ type: 'evaluate', expression: '2^10', expected: '1000' }).result).toBe('fail');
    expect(runCheck({ type: 'solution', equation: '3*x-5=10', variable: 'x', value: '5' }).result).toBe('pass');
    expect(runCheck({ type: 'solution', equation: '3*x-5=10', variable: 'x', value: '4' }).result).toBe('fail');
    expect(runCheck({ type: 'equivalent', left: '(x+1)^2', right: 'x^2+2*x+1' }).result).toBe('pass');
    expect(runCheck({ type: 'equivalent', left: '(x+1)^2', right: 'x^2+1' }).result).toBe('fail');
    expect(runCheck({ type: 'evaluate', expression: 'half of it', expected: '3' }).result).toBe('skip');
    expect(runCheck(null).result).toBe('skip');
  });
  it('reading time is computed from content (more content, more time; examples and practice add time) and thumbnails are deterministic SVG with alt text', () => {
    const short = readingTime([{ key: 'D', content: 'word '.repeat(160) }], 160); const long = readingTime([{ key: 'D', content: 'word '.repeat(800) }, { key: 'E', data: { examples: [{ problem: 'p', steps: ['a', 'b', 'c'], answer: '1' }] } }, { key: 'K', data: { exercises: [{}, {}] } }], 160);
    expect(short.readingMin).toBe(1); expect(long.readingMin).toBe(5); expect(long.readingAndExamplesMin).toBeGreaterThan(long.readingMin); expect(long.totalMin).toBeGreaterThanOrEqual(long.readingAndExamplesMin + 4);
    const t = moduleThumbnail({ topic: 'Draw and describe angles of various measures', strandNo: 3 });
    expect(t.motif).toBe('angles'); expect(t.svg).toMatch(/^<svg[^>]+viewBox="0 0 320 180"/); expect(t.svg).not.toMatch(/<image|href=|<script/); expect(t.alt).toMatch(/rays/);
    expect(moduleThumbnail({ topic: 'Draw and describe angles of various measures', strandNo: 3 }).svg).toBe(t.svg);
  });
  it('lock modes: sequential within a strand, prerequisite within a content standard, free', () => {
    const m = [{ _id: 'a', moduleKey: 'M-Y1.S1.SS1.CS1.LI1', order: 1 }, { _id: 'b', moduleKey: 'M-Y1.S1.SS1.CS1.LI2', order: 2 }, { _id: 'c', moduleKey: 'M-Y1.S1.SS2.CS1.LI1', order: 3 }, { _id: 'd', moduleKey: 'M-Y1.S2.SS1.CS1.LI1', order: 4 }];
    const seq = computeLocks(m, new Set(), 'sequential'); expect([...'abcd'].map((k) => seq.get(k)!.locked)).toEqual([false, true, true, false]);
    const pre = computeLocks(m, new Set(), 'prerequisite'); expect([...'abcd'].map((k) => pre.get(k)!.locked)).toEqual([false, true, false, false]);
    expect([...computeLocks(m, new Set(), 'free').values()].every((x) => !x.locked)).toBe(true);
    expect(computeLocks(m, new Set(['a']), 'sequential').get('b')!.locked).toBe(false);
  });
});

describe('Curriculum LMS end to end (test model)', () => {
  it('materialises modules per indicator, generates only with an LM, AI-approves and publishes passing modules, flags failing ones, tracks real progress, supports edit/restore and analytics', async () => {
    useTestLlm(); testLlm.respond = (req: any) => JSON.stringify(moduleOut(/FAILCASE/.test(req.messages.at(-1).content)));
    const sup = await loginAs('super@sample.ghlearn.test');
    const mat = await sup.post('/api/curriculum-lms/modules/materialize').send({ documentId: curId });
    expect(mat.status, JSON.stringify(mat.body)).toBe(200); expect(mat.body).toMatchObject({ indicators: 3, created: 3, existing: 0 }); expect(mat.body.missingSource).toHaveLength(1);
    expect((await sup.post('/api/curriculum-lms/modules/materialize').send({ documentId: curId })).body).toMatchObject({ created: 0, existing: 3 });
    expect((await (await loginAs('teacher@sample.ghlearn.test')).post('/api/curriculum-lms/modules/materialize').send({ documentId: curId })).status).toBe(403);
    const dry = await sup.post('/api/curriculum-lms/generate').send({ documentId: curId });
    expect(dry.body.dryRun).toBe(true); expect(dry.body.queue).toHaveLength(2); expect(dry.body.skipped[0].reason).toMatch(/No learner manual/); expect(dry.body.estimate.perModule.costUsd).toBeGreaterThanOrEqual(0);
    expect(testLlm.calls.length).toBe(0);
    const run = await sup.post('/api/curriculum-lms/generate').send({ documentId: curId, dryRun: false }); expect(run.status, JSON.stringify(run.body)).toBe(202); expect(run.body.queued).toBe(2);
    await settle();
    const [good, bad, none] = await Promise.all(['LI1', 'LI2'].map((k) => Lesson.findOne({ moduleKey: { $regex: `SS1\\.CS1\\.${k}$` } })).concat([Lesson.findOne({ moduleKey: { $regex: 'SS2' } })]));
    expect(good!.status, JSON.stringify(good!.validation)).toBe('published'); expect(good!.aiReview.status).toBe('ai_approved'); expect(good!.aiReview.label).toMatch(/not reviewed by a person/);
    expect(good!.sourceMap.documents[0].documentId).toBe(lmId); expect(good!.readingTime.readingMin).toBeGreaterThan(0); expect(good!.validation!.checks.find((c: any) => c.id === 'maths').ok).toBe(true);
    expect(bad!.status).toBe('in_review'); expect(bad!.aiReview.status).toBe('needs_attention'); expect(bad!.validation!.errors.join()).toMatch(/E\.1: maths check failed/); expect(bad!.resourceId).toBeFalsy();
    expect(none!.version).toBe(0); expect(none!.sourceStatus).toBe('missing_lm');
    expect(await AuditLog.countDocuments({ action: 'lesson.ai_publish', target: String(good!._id) })).toBe(1);
    const res = await LearningResource.findById(good!.resourceId).lean(); expect(res!.thumbnail!.svg).toMatch(/^<svg/); expect(res!.aiApproved).toBe(true);
    // student portal
    const ama = await loginAs('ama@sample.ghlearn.test');
    const dash = await ama.get(`/api/subjects/${ctx.data.bio._id}/modules`); expect(dash.status).toBe(200);
    expect(dash.body.totals.modules).toBe(1); const card = dash.body.strands[0].subStrands[0].modules[0]; expect(card.status).toBe('not_started'); expect(card.locked).toBe(false); expect(card.thumbnail.alt).toBeTruthy();
    const open = await ama.get(`/api/resources/${good!.resourceId}`); expect(open.status).toBe(200);
    expect(open.body.resource.body.sections.find((s: any) => s.key === 'L').data.questions[0].correctIndex).toBeUndefined(); expect(open.body.resource.body.sourceMap).toBeUndefined();
    expect((await ama.post(`/api/resources/${good!.resourceId}/complete`).send({})).body.error?.message ?? '').toMatch(/read to the end.*knowledge check/);
    await ama.post(`/api/resources/${good!.resourceId}/progress`).send({ activeSeconds: 60, scrollPct: 95 });
    expect((await ama.post(`/api/resources/${good!.resourceId}/progress`).send({ activeSeconds: 500, scrollPct: 95 })).status).toBe(422);
    // a wrong answer to every question: pct 0 whatever the shuffled order ('c' is the only correct option)
    const qsOf = (b: any) => b.resource.body.sections.find((s: any) => s.key === 'L').data.questions;
    const wrongAns = qsOf(open.body).map((q: any) => q.options.indexOf('a'));
    const wrong = await ama.post(`/api/resources/${good!.resourceId}/check`).send({ answers: wrongAns, attempt: open.body.resource.checkAttempt }); expect(wrong.body).toMatchObject({ pct: 0, passed: false });
    // failed attempt: which questions were wrong plus a hint back to the notes, never the answers
    expect(wrong.body.results[0].correctIndex).toBeUndefined(); expect(wrong.body.results[0].explanation).toBeUndefined(); expect(wrong.body.results[0].hint).toMatch(/^Review section [C-J]\./); expect(wrong.body.results[0].question).toMatch(/^Q\d$/);
    expect((await ama.post(`/api/resources/${good!.resourceId}/check`).send({ answers: wrongAns, attempt: 0 })).status).toBe(409); // stale order
    const again = await ama.get(`/api/resources/${good!.resourceId}`); expect(again.body.resource.checkAttempt).toBe(1); expect(qsOf(again.body)[0].correctIndex).toBeUndefined();
    expect((await ama.post(`/api/resources/${good!.resourceId}/complete`).send({})).status).toBe(409);
    const ok = await ama.post(`/api/resources/${good!.resourceId}/check`).send({ answers: qsOf(again.body).map((q: any) => q.options.indexOf('c')), attempt: 1 });
    expect(ok.body.passed).toBe(true); expect(ok.body.results[0].explanation).toBe('because'); expect(qsOf(again.body)[ok.body.results.findIndex(() => true)].options[ok.body.results[0].correctIndex]).toBe('c');
    expect(qsOf((await ama.get(`/api/resources/${good!.resourceId}`)).body)[0].correctIndex).toBe(2); // answers visible after passing
    expect((await ama.post(`/api/resources/${good!.resourceId}/complete`).send({})).status).toBe(200);
    expect((await ama.get(`/api/subjects/${ctx.data.bio._id}/modules`)).body.totals).toMatchObject({ completed: 1, progressPct: 100 });
    // admin: a failing edit keeps the published copy and flags; restore re-publishes a passing version
    const v0 = good!.version;
    const edit = await sup.patch(`/api/curriculum-lms/modules/${good!._id}`).send({ sections: [{ key: 'D', content: 'See https://example.com' }] });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200); expect(edit.body.outcome).toBe('flagged');
    expect((await LearningResource.findById(good!.resourceId).lean())!.body.version).toBe(v0);
    const rest = await sup.post(`/api/curriculum-lms/modules/${good!._id}/restore`).send({ version: v0 }); expect(rest.body.outcome).toBe('published');
    expect(await LessonVersion.countDocuments({ lessonId: good!._id })).toBe(3);
    expect((await LearningResource.findById(good!.resourceId).lean())!.body.version).toBe(v0 + 2);
    expect((await sup.patch(`/api/lessons/${good!._id}`).send({ title: 'x y z' })).status).toBe(409);
    // auto-publish off: a module that now passes is approved, not published
    expect((await sup.patch('/api/admin/settings').send({ curriculumLms: { autoPublish: false } })).status).toBeLessThan(300);
    const fixed = moduleOut(false).sections.find((s) => s.key === 'E')!;
    const fx = await sup.patch(`/api/curriculum-lms/modules/${bad!._id}`).send({ sections: [{ key: 'E', data: fixed.data }] }); expect(fx.body.outcome).toBe('approved');
    expect((await Lesson.findById(bad!._id))!.status).toBe('approved');
    const ov = await sup.get(`/api/curriculum-lms/subjects/${ctx.data.bio._id}/overview`); expect(ov.body.summary).toMatchObject({ indicators: 3, modules: 3, aiApprovedPublished: 1, sourceMissing: 1 });
    const an = await sup.get(`/api/curriculum-lms/subjects/${ctx.data.bio._id}/analytics`); expect(an.body.modules[0]).toMatchObject({ learners: 1, completed: 1, avgCheckScorePct: 100, checkAttempts: 2 });
  });
});
