import { describe, it, expect, beforeAll } from 'vitest';
import { useDb, ctx, loginAs } from './setup.js';
import { drain } from '../src/services/queue.js';
import { Question, User, CurriculumDocument, Attempt, LearningResource, GameDesign, GameSession, Job, AiUsage, ContentReview } from '../src/models/index.js';
import { hashPassword } from '../src/services/auth.js';
import { curriculumPdf, buildPdf } from './fixtures.js';
import { useTestLlm, testLlm } from './llmfake.js';
import { SAMPLES } from './questionSamples.js';
import { config } from '../src/config.js';
import { validateGame } from '../src/services/assess/games.js';
import { updateAiSettings, getAiSettings } from '../src/services/aiSettings.js';
const setBudget = (n: number) => updateAiSettings({ platformDailyRequests: n }, String(ctx.data.users.superAdmin._id));

useDb();
const id = (x: any) => String(x._id);
const PW = 'GoodPass123';
let bioDoc = '';
const W = ['mango', 'kente', 'volta', 'harmattan', 'cocoa', 'tilapia', 'cassava', 'savanna', 'lagoon', 'baobab', 'yam', 'plantain', 'shea', 'kola', 'akwaaba', 'okra', 'pawpaw', 'sorghum', 'millet', 'guinea', 'coastal', 'forest', 'tamale', 'kumasi', 'accra', 'cape', 'elmina', 'bolga', 'ho', 'tema', 'takoradi', 'sunyani', 'wa', 'keta', 'aburi', 'kintampo', 'nzema', 'ewe', 'dagbani', 'fante', 'twi', 'ga', 'gonja', 'krobo'];
const uniq = (n: number) => [0, 1, 2, 3].map((k) => W[(n * 4 + k) % W.length]).join(' ');
const qBody = (type: string, n = 0, over: any = {}) => { const { _id, citations, ...s } = SAMPLES[type]; return { ...s, subjectId: id(ctx.data.bio), topic: 'Cells', stem: `${type.replace('_', ' ')} ${uniq(n)} ${n}?`, ...over }; };
/** Approved, key-verified bank question created directly (fixture). */
const approvedQ = async (type: string, n: number, over: any = {}) => { const { _id, ...s } = SAMPLES[type]; return Question.create({ ...s, subjectId: ctx.data.bio._id, topic: 'Cells', stem: `Game ${type} ${n} on cells`, status: 'published', version: 1, keyVerifiedAt: new Date(), keyVerifiedVersion: 1, createdBy: ctx.data.users.editor._id, ...over }); };

beforeAll(async () => {
  const pw = await hashPassword(PW);
  await User.create([{ email: 'rev@t.gh', fullName: 'Reviewer One', roles: ['content_reviewer'], passwordHash: pw }, { email: 'ed2@t.gh', fullName: 'Editor Two', roles: ['curriculum_editor'], passwordHash: pw }]);
  const ed = await loginAs('editor@sample.ghlearn.test');
  bioDoc = (await ed.post('/api/documents/upload').field('subjectId', id(ctx.data.bio)).field('title', 'P8 bio manual').attach('file', curriculumPdf(), 'c.pdf')).body.document._id;
  await ed.post('/api/documents/upload').field('subjectId', id(ctx.data.chem)).field('title', 'P8 chem draft').attach('file', buildPdf([{ lines: Array.from({ length: 30 }, (_, i) => `Atoms have protons and electrons; line ${i} on atomic structure.`) }]), 'chem.pdf');
  await drain();
});

describe('§13 question bank', () => {
  it('lists every type with how it is marked; essays are teacher-marked', async () => {
    const r = (await (await loginAs('editor@sample.ghlearn.test')).get('/api/questions/types')).body;
    expect(r.types).toHaveLength(11);
    const m = Object.fromEntries(r.types.map((t: any) => [t.key, t.marking]));
    expect(m).toMatchObject({ essay: 'teacher', structured: 'mixed', case_study: 'mixed', mcq: 'auto', numerical: 'auto', diagram_labelling: 'auto' });
    expect(r.teacherMarked).toMatch(/Essay/);
  });
  it('every type: manual create, answer-key check and student preview score full marks with the key', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test');
    for (const [i, t] of Object.keys(SAMPLES).entries()) {
      const b = qBody(t, i); const v = (await ed.post('/api/questions/validate').send(b)).body;
      expect(v.validation.ok, `${t} ${JSON.stringify(v.validation)}`).toBe(true); expect(v.preview).toBeTruthy();
      if (t === 'essay') expect(v.teacherMarked).toBe(true); else if (t === 'case_study') expect(v.teacherMarked).toBe(true); else expect(v.selfCheck, t).toMatchObject({ ok: true });
      const c = await ed.post('/api/questions').send({ ...b, timeLimitSec: 90 }); expect(c.status, `${t} ${JSON.stringify(c.body)}`).toBe(201);
      const d = (await ed.get(`/api/questions/${c.body.question._id}`)).body; expect(d.question.timeLimitSec).toBe(90); expect(d.versions).toHaveLength(1);
      const pm = (await ed.post(`/api/questions/${c.body.question._id}/preview-mark`).send({ response: t === 'essay' ? 'Cells have a membrane, a nucleus and cytoplasm.' : d.answer })).body;
      if (t === 'essay') expect(pm.mark.needsAi).toBe(true); else if (t !== 'case_study') expect(pm.mark.score, t).toBe(pm.mark.maxScore);
    }
    expect(await Attempt.countDocuments()).toBe(0); // previews save nothing
    // a broken key is reported, not saved as valid
    const bad = (await ed.post('/api/questions/validate').send(qBody('mcq', 99, { data: { options: ['a', 'b'], correctIndex: 5 } }))).body; expect(bad.validation.ok).toBe(false);
  });
  it('review rules: submit, request changes, resubmit, verified approval, separation of duties, versions and history', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test'); const rev = await loginAs('rev@t.gh', PW); const sup = await loginAs('super@sample.ghlearn.test');
    const q = (await ed.post('/api/questions').send(qBody('mcq', 20, { stem: 'Which organelle carries out photosynthesis in leaf cells?', data: { options: ['Chloroplast', 'Nucleus', 'Ribosome', 'Vacuole'], correctIndex: 0 } }))).body.question;
    expect((await rev.post(`/api/questions/${q._id}/review`).send({ action: 'approve', answerKeyVerified: true })).body.error.code).toBe('REVIEW_BLOCKED'); // not submitted
    expect((await ed.post(`/api/questions/${q._id}/submit`)).body.question.status).toBe('in_review');
    expect((await ed.patch(`/api/questions/${q._id}`).send({ hint: 'x' })).status).toBe(409); // locked while in review
    expect((await ed.post(`/api/questions/${q._id}/review`).send({ action: 'approve', answerKeyVerified: true })).status).toBe(403); // editors have no content:review
    expect((await rev.post(`/api/questions/${q._id}/review`).send({ action: 'request_changes' })).status).toBe(400); // comment required
    expect((await rev.post(`/api/questions/${q._id}/review`).send({ action: 'request_changes', comment: 'Add a hint' })).body.question.status).toBe('changes_requested');
    expect((await ed.patch(`/api/questions/${q._id}`).send({ hint: 'Think about the green parts' })).body.question.version).toBe(2);
    const rs = await ed.post(`/api/questions/${q._id}/submit`); expect(rs.body.question?.status, JSON.stringify(rs.body)).toBe('resubmitted');
    expect((await rev.get('/api/questions?review=queue')).body.items.map((x: any) => x._id)).toContain(q._id);
    expect((await rev.post(`/api/questions/${q._id}/review`).send({ action: 'approve' })).body.error.code).toBe('KEY_NOT_VERIFIED');
    const ok = (await rev.post(`/api/questions/${q._id}/review`).send({ action: 'approve', answerKeyVerified: true, comment: 'Key checked against manual p.2' })).body.question;
    expect(ok).toMatchObject({ status: 'published', keyVerifiedVersion: 2 });
    const d = (await rev.get(`/api/questions/${q._id}`)).body;
    expect(d.question.keyVerified).toBe(true); expect(d.versions.map((v: any) => v.version)).toEqual([2, 1]);
    expect(d.reviews.map((r: any) => r.action)).toEqual(expect.arrayContaining(['create', 'submit', 'request_changes', 'edit', 'resubmit', 'approve']));
    expect(d.reviews.find((r: any) => r.action === 'approve')).toMatchObject({ by: 'Reviewer One', version: 2 });
    expect((await rev.get(`/api/questions/${q._id}/versions/1`)).body.version.snapshot.hint).toBeUndefined();
    expect((await ed.patch(`/api/questions/${q._id}`).send({ hint: 'y' })).status).toBe(409); // approved: revise or duplicate instead
    // authors can never approve their own work: reviewers and super admins included
    for (const ag of [rev, sup]) { const own = (await ag.post('/api/questions').send({ ...qBody('true_false'), stem: ag === rev ? 'Mitochondria release energy during respiration.' : 'Ribosomes are found only in animal cells.' })).body.question; await ag.post(`/api/questions/${own._id}/submit`);
      const r = await ag.post(`/api/questions/${own._id}/review`).send({ action: 'approve', answerKeyVerified: true }); expect(r.status).toBe(403); expect(r.body.error.message).toMatch(/separation of duties/); }
    // editing makes you an author too
    const ed2 = await loginAs('ed2@t.gh', PW); const shared = (await ed.post('/api/questions').send(qBody('short_answer', 40))).body.question;
    await ed2.patch(`/api/questions/${shared._id}`).send({ hint: 'Starts with p' }); await ed.post(`/api/questions/${shared._id}/submit`);
    expect((await ed2.post(`/api/questions/${shared._id}/review`).send({ action: 'approve', answerKeyVerified: true })).status).toBe(403);
    // an AI cross-check disagreement needs a reviewer comment
    const cc = (await ed.post('/api/questions').send(qBody('mcq', 41))).body.question; await Question.updateOne({ _id: cc._id }, { crossCheck: 'disagreed' }); await ed.post(`/api/questions/${cc._id}/submit`);
    expect((await rev.post(`/api/questions/${cc._id}/review`).send({ action: 'approve', answerKeyVerified: true })).body.error.code).toBe('CROSSCHECK_DISAGREED');
    expect((await rev.post(`/api/questions/${cc._id}/review`).send({ action: 'reject', comment: 'Key is wrong' })).body.question.status).toBe('rejected');
    expect((await ed.patch(`/api/questions/${cc._id}`).send({ data: { options: ['Nucleus', 'Membrane', 'Wall', 'Vacuole'], correctIndex: 1 } })).body.question.status).toBe('draft');
  });
  it('usage tracking, archive blocked while in use, revise/duplicate, restore, time limits, delete', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test'); const rev = await loginAs('rev@t.gh', PW); const t = await loginAs('teacher@sample.ghlearn.test');
    const mk = async (n: number) => { const q = (await ed.post('/api/questions').send({ ...qBody('true_false', 50 + n), stem: n === 1 ? 'Plant cells have a cell wall made of cellulose.' : 'Red blood cells in mammals contain a nucleus.', timeLimitSec: 60 })).body.question; await ed.post(`/api/questions/${q._id}/submit`);
      await rev.post(`/api/questions/${q._id}/review`).send({ action: 'approve', answerKeyVerified: true }); return q._id; };
    const a1 = await mk(1), a2 = await mk(2);
    const draft = (await ed.post('/api/questions').send({ ...qBody('true_false', 60), stem: 'Osmosis needs a partially permeable membrane.' })).body.question;
    expect((await t.post('/api/assessments').send({ title: 'P8 quiz', subjectId: id(ctx.data.bio), mode: 'assigned', questionIds: [a1, draft._id] })).status).toBe(400); // approved only
    const as = (await t.post('/api/assessments').send({ title: 'P8 quiz', subjectId: id(ctx.data.bio), mode: 'assigned', questionIds: [a1, a2] })).body.assessment;
    expect(as.timeLimitSec).toBe(120); // from the questions' own time limits
    const ama = await loginAs('ama@sample.ghlearn.test');
    const at = (await ama.post('/api/practice/attempts').send({ subjectId: id(ctx.data.bio), mode: 'assigned', assessmentId: as._id })).body.attempt;
    for (const it of at.questions) await ama.put(`/api/practice/attempts/${at._id}/responses/${it.id}`).send({ response: false });
    await ama.post(`/api/practice/attempts/${at._id}/submit`);
    const u = (await rev.get(`/api/questions/${a1}`)).body;
    expect(u.usage.assessments).toEqual([expect.objectContaining({ title: 'P8 quiz', open: true })]); expect(u.usage.responses).toBe(1); expect(u.usage.averagePct).toBe(100);
    expect(u.permissions.archive).toBe(false); expect(u.permissions.archiveBlock).toMatch(/P8 quiz/);
    const sup = await loginAs('super@sample.ghlearn.test');
    expect((await sup.post(`/api/questions/${a1}/archive`).send({})).body.error.code).toBe('IN_USE');
    expect((await ed.post(`/api/questions/${a1}/revise`)).body.error.code).toBe('IN_USE');
    const dup = (await ed.post(`/api/questions/${a1}/duplicate`)).body.question; expect(dup).toMatchObject({ status: 'draft', version: 1 });
    expect((await ed.post(`/api/questions/${a1}/archive`).send({})).status).toBe(403); // editors cannot archive
    await t.patch(`/api/assessments/${as._id}`).send({ status: 'closed' });
    expect((await sup.post(`/api/questions/${a1}/archive`).send({ comment: 'Old syllabus' })).body.question.status).toBe('archived');
    expect((await t.get(`/api/questions?subjectId=${id(ctx.data.bio)}`)).body.items.map((x: any) => x._id)).not.toContain(a1); // gone from the bank for teachers
    expect((await sup.post(`/api/questions/${a1}/restore`)).body.question).toMatchObject({ status: 'draft' });
    expect((await sup.get(`/api/questions/${a1}`)).body.question.keyVerified).toBe(false); // needs review again
    expect((await ed.post(`/api/questions/${a2}/revise`)).body.question.status).toBe('draft'); // closed assessment: may be revised
    // delete: unused drafts only, by the author
    const ed2 = await loginAs('ed2@t.gh', PW);
    expect((await ed2.delete(`/api/questions/${draft._id}`)).status).toBe(403);
    expect((await ed.delete(`/api/questions/${draft._id}`)).status).toBe(204);
    expect((await ed.delete(`/api/questions/${a1}`)).status).toBe(409); // used in an assessment
  });
  it('generation uses approved manuals only, checks the budget, and is for authors only', async () => {
    useTestLlm(); const ed = await loginAs('editor@sample.ghlearn.test');
    const body = { subjectId: id(ctx.data.bio), topic: 'Cell membrane', types: ['mcq'], count: 2 };
    let e = (await ed.post('/api/questions/estimate').send(body)).body; expect(e.canGenerate).toBe(false); expect(e.problems.join()).toMatch(/No approved manual/); expect(e.scope.notApproved[0].title).toBe('P8 bio manual');
    expect((await ed.post('/api/questions/generate').send(body)).body.error.code).toBe('NO_APPROVED_SOURCES');
    expect((await ed.post('/api/questions/generate').send({ ...body, subjectId: id(ctx.data.chem) })).body.error.code).toBe('NO_APPROVED_SOURCES');
    await CurriculumDocument.updateOne({ _id: bioDoc }, { approvalStatus: 'verified_official' });
    e = (await ed.post('/api/questions/estimate').send(body)).body; expect(e.canGenerate).toBe(true); expect(e.estimate).toMatchObject({ requests: 2, crossCheck: true }); expect(e.scope.documents[0].title).toBe('P8 bio manual');
    const old = (await getAiSettings()).platformDailyRequests; await setBudget(1);
    try { expect((await ed.post('/api/questions/generate').send(body)).status).toBe(429); } finally { await setBudget(old); }
    let prompt = '';
    testLlm.respond = (req) => { if (/checking an exam answer key/.test(req.system)) return JSON.stringify({ answers: [{ id: 0, answer: 0 }] }); prompt = req.messages[0].content;
      return JSON.stringify({ questions: [{ type: 'mcq', stem: 'Which structure controls entry of substances into a cell membrane study?', citations: ['S1'], explanation: 'x', data: { options: ['Membrane', 'Wall', 'Nucleus', 'Vacuole'], correctIndex: 0 } }] }); };
    const r = await ed.post('/api/questions/generate').send(body); expect(r.status, JSON.stringify(r.body)).toBe(202); await drain();
    const job = await Job.findById(r.body.jobId).lean(); expect(job!.status).toBe('succeeded'); expect(job!.payload.documentIds).toEqual([bioDoc]);
    expect(prompt).toContain('<passage id="S1"');
    const q = await Question.findById((job!.result as any).questionIds[0]).lean(); expect(q).toMatchObject({ status: 'draft', aiGenerated: true, crossCheck: 'agreed' });
    expect(String(q!.citations[0].documentId)).toBe(bioDoc);
    expect(await AiUsage.countDocuments({ purpose: { $in: ['questions.generate', 'questions.crosscheck'] } })).toBe(2);
    expect((await (await loginAs('rev@t.gh', PW)).post('/api/questions/generate').send(body)).status).toBe(202); // reviewers hold content:edit
    expect((await (await loginAs('teacher@sample.ghlearn.test')).post('/api/questions/generate').send(body)).status).toBe(403);
    expect((await (await loginAs('ama@sample.ghlearn.test')).post('/api/questions/validate').send(qBody('mcq'))).status).toBe(403);
  });
});

describe('§14 educational games', () => {
  const qIds: Record<string, string[]> = {};
  beforeAll(async () => {
    for (const [t, n] of [['mcq', 3], ['true_false', 2], ['short_answer', 1], ['numerical', 1], ['gap_fill', 2], ['ordering', 1], ['diagram_labelling', 1], ['matching', 1], ['case_study', 1]] as const)
      qIds[t] = await Promise.all(Array.from({ length: n }, async (_, i) => id(await approvedQ(t, i))));
    await LearningResource.create({ title: 'P8 cells lesson', kind: 'notes', subjectId: ctx.data.bio._id, topic: 'Cells', status: 'published', aiGenerated: true, body: { sections: [
      { key: 'E', data: { terms: [{ term: 'Cell', definition: 'Basic unit of life' }, { term: 'Nucleus', definition: 'Controls the activities of the organelle system' }, { term: 'Osmosis', definition: 'Water movement across a membrane' }, { term: 'Diffusion', definition: 'Spreading of particles' }] } },
      { key: 'F', data: { diagrams: [{ spec: { kind: 'flow', title: 'Making a slide', steps: ['Cut', 'Stain', 'Cover', 'Observe'] } }, { spec: { kind: 'labelled', title: 'Animal cell', centre: 'Animal cell', labels: ['Membrane', 'Nucleus', 'Cytoplasm'] }, alt: 'animal cell' }] } },
      { key: 'J', data: { flashcards: [{ front: 'Cell wall', back: 'Gives shape' }], conceptMap: { root: 'Organisms', children: [{ label: 'Plants', children: ['Mango', 'Cassava'] }, { label: 'Animals', children: ['Goat', 'Tilapia'] }] } } }] } });
  });
  const base = { subjectId: '', topic: 'Cells', objective: 'Identify cell structures and their functions' };
  const designs = () => ({
    quiz_challenge: { questionIds: [...qIds.mcq, ...qIds.true_false] },
    timed_revision: { questionIds: [qIds.mcq[0], qIds.true_false[0], qIds.short_answer[0], qIds.numerical[0], qIds.gap_fill[0]] },
    gap_fill: { questionIds: qIds.gap_fill },
    scenario: { questionIds: qIds.case_study },
    ordering: { questionIds: qIds.ordering, content: { sequences: [{ title: 'Mitosis', steps: ['Prophase', 'Metaphase', 'Anaphase', 'Telophase'] }] } },
    label_diagram: { questionIds: qIds.diagram_labelling, content: { diagrams: [{ title: 'Leaf', centre: 'Leaf', labels: ['Midrib', ['Stalk', 'Petiole'], 'Blade'] }] } },
    match_terms: { content: { pairs: [{ term: 'Nucleus', definition: 'Controls the cell' }, { term: 'Ribosome', definition: 'Makes proteins' }, { term: 'Vacuole', definition: 'Stores cell sap' }] } },
    flashcards: { content: { cards: [{ front: 'Cell', back: 'Unit of life' }, { front: 'Organ', back: 'Group of tissues' }, { front: 'Tissue', back: 'Group of similar cells' }] } },
    word_search: { content: { terms: [{ term: 'Nucleus', clue: 'Control centre of the cell' }, { term: 'Vacuole', clue: 'Stores cell sap' }, { term: 'Membrane', clue: 'Controls what enters and leaves' }] } },
    classification: { content: { groups: [{ title: 'Cells', categories: [{ name: 'Plant only', items: ['Cell wall', 'Chloroplast'] }, { name: 'Both', items: ['Nucleus', 'Membrane'] }] }] } },
  });
  it('every game type the engine runs: created manually, validated by a dry run that plays every item', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test'); base.subjectId = id(ctx.data.bio);
    const meta = (await ed.get('/api/game-designs/meta')).body; expect(meta.types).toHaveLength(10);
    for (const [type, d] of Object.entries(designs())) {
      const r = await ed.post('/api/game-designs').send({ ...base, title: `P8 ${type}`, type, ...d }); expect(r.status, `${type} ${JSON.stringify(r.body)}`).toBe(201);
      expect(r.body.validation.ok, `${type} ${JSON.stringify(r.body.validation)}`).toBe(true);
      expect(r.body.validation.dryRun.passed).toBe(r.body.validation.dryRun.items); expect(r.body.validation.dryRun.items).toBeGreaterThan(0);
      const pv = (await ed.post(`/api/game-designs/${r.body.design._id}/preview`).send({ seed: 5 })).body; expect(pv.items.length).toBeGreaterThan(0);
      expect(JSON.stringify(pv.items)).not.toMatch(/correctIndex|"accepted"|"cat"|"back"/); // students never see answers
    }
  });
  it('links are required; content mistakes and broken interactions block submission', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test'); base.subjectId = id(ctx.data.bio);
    expect((await ed.post('/api/game-designs').send({ ...base, objective: '', title: 'No objective', type: 'flashcards', ...designs().flashcards })).status).toBe(422);
    const bad = async (type: string, d: any) => (await ed.post('/api/game-designs').send({ ...base, title: `Bad ${type}`, type, ...d })).body;
    expect((await bad('classification', { content: { groups: [{ categories: [{ name: 'A', items: ['x', 'y'] }, { name: 'B', items: ['x', 'z'] }] }] } })).validation.errors.join()).toMatch(/more than one place/);
    expect((await bad('word_search', { content: { terms: [{ term: 'Cell wall', clue: 'x' }, { term: 'Nucleus', clue: 'y' }, { term: 'Vacuole', clue: 'z' }] } })).validation.errors.join()).toMatch(/one word/);
    expect((await bad('quiz_challenge', { questionIds: [qIds.mcq[0], qIds.short_answer[0], qIds.true_false[0]] })).validation.errors.join()).toMatch(/cannot play/);
    expect((await bad('flashcards', { content: { cards: [{ front: 'a', back: 'b' }] } })).validation.errors.join()).toMatch(/at least 3/);
    // broken interaction: an empty label can never be typed correctly; the dry run catches it
    const br = await bad('label_diagram', { content: { diagrams: [{ centre: 'Leaf', labels: ['Midrib', ' '] }] } });
    expect(br.validation.ok).toBe(false); expect(br.validation.errors.join()).toMatch(/interaction is broken/);
    expect((await ed.post(`/api/game-designs/${br.design._id}/submit`)).body.error.code).toBe('INVALID_GAME');
    // and direct: a design whose question key is inconsistent fails the dry run even if the stored question claims to be valid
    const q = await approvedQ('ordering', 9, { data: { items: ['A', 'A', 'B'] } });
    const v = await validateGame({ type: 'ordering', subjectId: ctx.data.bio._id, topic: 'Cells', objective: 'x', questionIds: [q._id], content: {}, settings: {}, version: 1 });
    expect(v.ok).toBe(false);
  });
  it('workflow: submit, verified approval by a non-author, publish blocked on unverified answers, publish, play, stats', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test'); const rev = await loginAs('rev@t.gh', PW); base.subjectId = id(ctx.data.bio);
    const d = (await ed.post('/api/game-designs').send({ ...base, title: 'P8 Quiz workflow', type: 'quiz_challenge', settings: { pointsPerItem: 20, hintsEnabled: false, hintCost: 0, streakBonus: 5 }, ...designs().quiz_challenge })).body.design;
    expect((await rev.post(`/api/game-designs/${d._id}/publish`).send({})).body.error.code).toBe('PUBLISH_BLOCKED');
    expect((await ed.post(`/api/game-designs/${d._id}/submit`)).body.design.status).toBe('in_review');
    expect((await ed.post(`/api/game-designs/${d._id}/review`).send({ action: 'approve', answersVerified: true })).status).toBe(403);
    expect((await rev.post(`/api/game-designs/${d._id}/review`).send({ action: 'approve' })).body.error.code).toBe('ANSWERS_NOT_VERIFIED');
    expect((await rev.post(`/api/game-designs/${d._id}/review`).send({ action: 'approve', answersVerified: true })).body.design.status).toBe('approved');
    // a question loses its approval after the game was approved: publishing is blocked
    await Question.updateOne({ _id: qIds.mcq[2] }, { status: 'in_review' });
    const blocked = await rev.post(`/api/game-designs/${d._id}/publish`).send({}); expect(blocked.status).toBe(409); expect(blocked.body.error.message).toMatch(/Unverified answers/);
    await Question.updateOne({ _id: qIds.mcq[2] }, { status: 'published' });
    expect((await ed.post(`/api/game-designs/${d._id}/publish`).send({})).status).toBe(403); // editors cannot publish
    expect((await rev.post(`/api/game-designs/${d._id}/publish`).send({})).body.design.status).toBe('published');
    const h = (await rev.get(`/api/game-designs/${d._id}`)).body; expect(h.reviews.map((r: any) => r.action)).toEqual(expect.arrayContaining(['create', 'submit', 'approve', 'publish']));
    // students: list, play with the design's scoring, no hints, stats
    const ama = await loginAs('ama@sample.ghlearn.test');
    const list = (await ama.get(`/api/games/designs?subjectId=${id(ctx.data.bio)}`)).body.items; expect(list.map((x: any) => x.title)).toContain('P8 Quiz workflow');
    expect(list.map((x: any) => x.title)).not.toContain('P8 flashcards'); // drafts are not listed
    const s = (await ama.post('/api/games/sessions').send({ designId: d._id })).body.session; expect(s).toMatchObject({ title: 'P8 Quiz workflow', maxScore: 100, hintsEnabled: false });
    expect((await ama.post(`/api/games/sessions/${s._id}/hint`).send({ itemId: s.items[0].id })).body.error.code).toBe('HINTS_OFF');
    const qs = await Question.find({ _id: { $in: [...qIds.mcq, ...qIds.true_false] } }).lean();
    for (const it of s.items) { const q: any = qs.find((x) => `q:${x._id}` === it.id)!; const ans = q.type === 'mcq' ? it.options.indexOf(q.data.options[q.data.correctIndex]) : q.data.answer;
      const r = (await ama.post(`/api/games/sessions/${s._id}/answer`).send({ itemId: it.id, answer: ans })).body; expect(r.correct).toBe(true); }
    const fin = (await ama.post(`/api/games/sessions/${s._id}/finish`)).body.session; expect(fin.score).toBe(100 + 5 * 3); expect(fin.accuracy).toBe(100);
    const st = (await rev.get(`/api/game-designs/${d._id}/stats`)).body;
    expect(st).toMatchObject({ sessions: 1, finished: 1, players: 1, completionPct: 100, averageAccuracy: 100 }); expect(st.items).toHaveLength(5);
    // published games are locked; unpublish, then archive
    expect((await ed.patch(`/api/game-designs/${d._id}`).send({ title: 'Changed' })).status).toBe(409);
    expect((await ed.delete(`/api/game-designs/${d._id}`)).status).toBe(409);
    expect((await rev.post(`/api/game-designs/${d._id}/archive`).send({})).body.design.status).toBe('archived');
    expect((await ama.post('/api/games/sessions').send({ designId: d._id })).status).toBe(404);
    expect((await ama.get(`/api/games/designs?subjectId=${id(ctx.data.bio)}`)).body.items.map((x: any) => x.title)).not.toContain('P8 Quiz workflow');
  });
  it('content answers need verification of the current version; authors cannot approve their own game', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test'); const rev = await loginAs('rev@t.gh', PW); base.subjectId = id(ctx.data.bio);
    const d = (await ed.post('/api/game-designs').send({ ...base, title: 'P8 cards', type: 'flashcards', ...designs().flashcards })).body;
    expect(d.validation.unverified.join()).toMatch(/not been verified/);
    await ed.post(`/api/game-designs/${d.design._id}/submit`);
    expect((await rev.post(`/api/game-designs/${d.design._id}/review`).send({ action: 'request_changes', comment: 'Add a card' })).body.design.status).toBe('changes_requested');
    await ed.patch(`/api/game-designs/${d.design._id}`).send({ content: { cards: [...designs().flashcards.content.cards, { front: 'Organism', back: 'A living thing' }] } });
    expect((await ed.post(`/api/game-designs/${d.design._id}/submit`)).body.design.status).toBe('resubmitted');
    const ap = (await rev.post(`/api/game-designs/${d.design._id}/review`).send({ action: 'approve', answersVerified: true })).body; expect(ap.design).toMatchObject({ status: 'approved', answersVerifiedVersion: 2, approvedVersion: 2 });
    expect(ap.validation.unverified).toEqual([]);
    // reviewer-authored game
    const own = (await rev.post('/api/game-designs').send({ ...base, title: 'Rev own', type: 'flashcards', ...designs().flashcards })).body.design; await rev.post(`/api/game-designs/${own._id}/submit`);
    expect((await rev.post(`/api/game-designs/${own._id}/review`).send({ action: 'approve', answersVerified: true })).body.error.code).toBe('REVIEW_BLOCKED');
    expect(await ContentReview.countDocuments({ kind: 'game', refId: d.design._id, action: 'approve' })).toBe(1);
  });
  it('generates drafts from approved content only (verified questions, published lessons), no AI', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test'); base.subjectId = id(ctx.data.bio);
    const n0 = await AiUsage.countDocuments();
    for (const type of ['flashcards', 'word_search', 'match_terms', 'classification', 'ordering', 'label_diagram', 'quiz_challenge']) {
      const r = await ed.post('/api/game-designs/generate').send({ ...base, type }); expect(r.status, `${type} ${JSON.stringify(r.body)}`).toBe(201);
      expect(r.body.design).toMatchObject({ status: 'draft', source: { generated: true } }); expect(r.body.validation.ok, `${type} ${JSON.stringify(r.body.validation.errors)}`).toBe(true);
    }
    expect(await AiUsage.countDocuments()).toBe(n0);
    await Question.create({ ...SAMPLES.mcq, _id: undefined, subjectId: ctx.data.bio._id, topic: 'Unverified topic', stem: 'Approved long ago but never key-verified', status: 'published', createdBy: ctx.data.users.editor._id });
    const none = await ed.post('/api/game-designs/generate').send({ ...base, topic: 'Unverified topic', type: 'quiz_challenge' }); expect(none.status).toBe(422); expect(none.body.error.code).toBe('NOT_ENOUGH_CONTENT');
  });
  it('access: only content staff manage games; students only see published games they are eligible for', async () => {
    for (const u of ['ama@sample.ghlearn.test', 'teacher@sample.ghlearn.test', 'counselor@sample.ghlearn.test']) expect((await (await loginAs(u)).get('/api/game-designs')).status, u).toBe(403);
    const draft = await GameDesign.findOne({ status: 'draft' }).lean(); const ama = await loginAs('ama@sample.ghlearn.test');
    expect((await ama.post('/api/games/sessions').send({ designId: id(draft) })).status).toBe(404);
    const rev = await loginAs('rev@t.gh', PW); const ed = await loginAs('editor@sample.ghlearn.test');
    const d = (await ed.post('/api/game-designs').send({ ...base, subjectId: id(ctx.data.bio), title: 'Year 3 only', type: 'match_terms', ...designs().match_terms })).body.design;
    await ed.post(`/api/game-designs/${d._id}/submit`); await rev.post(`/api/game-designs/${d._id}/review`).send({ action: 'approve', answersVerified: true });
    expect((await rev.post(`/api/game-designs/${d._id}/publish`).send({ audience: { yearOfStudy: 3 } })).body.design.status).toBe('published');
    expect((await ama.get(`/api/games/designs?subjectId=${id(ctx.data.bio)}`)).body.items.map((x: any) => x.title)).not.toContain('Year 3 only');
    expect((await ama.post('/api/games/sessions').send({ designId: d._id })).status).toBe(404);
    expect((await (await loginAs('kofi@sample.ghlearn.test')).get(`/api/games/designs?subjectId=${id(ctx.data.bio)}`)).status).toBe(403); // not enrolled
    expect(await GameSession.countDocuments({ designId: d._id })).toBe(0);
  });
});
