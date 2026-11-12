import { describe, it, expect, beforeAll } from 'vitest';
import { useDb, ctx, loginAs } from './setup.js';
import { User, StudentProfile, Mastery, Attempt, Question, AuditLog, ResourceProgress, ClassGroup, AcademicYear, GameSession, LearningResource, School, AiUsage } from '../src/models/index.js';
import { hashPassword } from '../src/services/auth.js';
import { useTestLlm, testLlm } from './llmfake.js';
import { readXlsx, binary } from './xlsx.js';
import { SAMPLES } from './questionSamples.js';
useDb();
const id = (x: any) => String(x._id);
let year: any, cls: any, q1: any, q2: any, other: any;
const studentIds: any[] = [];
beforeAll(async () => {
  const d = ctx.data; const pw = await hashPassword('SamplePass2026');
  year = await AcademicYear.create({ label: '2026/2027 LA', current: true });
  other = await School.create({ name: 'Other LA School', code: 'OLA1', region: 'Ashanti' });
  for (let i = 0; i < 6; i++) {
    const u = await User.create({ email: `la${i}@t.gh`, fullName: `Learner Number${i} Test`, roles: ['student'], schoolId: d.school._id, passwordHash: pw });
    await StudentProfile.create({ userId: u._id, schoolId: d.school._id, levelId: d.shs._id, programmeId: d.sci._id, yearOfStudy: 1, subjectIds: [d.bio._id] });
    studentIds.push(u._id);
    await Mastery.create({ userId: u._id, subjectId: d.bio._id, topic: 'Cells', score: i < 4 ? 0.3 : 0.9, answered: 10, correct: i < 4 ? 3 : 9, lastAt: new Date() });
  }
  // A learner in another school: must never appear in the school admin's figures.
  const o = await User.create({ email: 'la-other@t.gh', fullName: 'Other School Learner', roles: ['student'], schoolId: other._id, passwordHash: pw });
  await StudentProfile.create({ userId: o._id, schoolId: other._id, levelId: d.shs._id, yearOfStudy: 2, subjectIds: [d.bio._id] });
  cls = await ClassGroup.create({ name: '1 Sci LA', schoolId: d.school._id, academicYearId: year._id, yearOfStudy: 1, subjectId: d.bio._id, studentIds: studentIds.slice(0, 3), teacherIds: [d.users.teacher._id] });
  const { _id: _a, ...s } = SAMPLES.mcq;
  q1 = await Question.create({ ...s, subjectId: d.bio._id, topic: 'Cells', objective: 'Describe organelles', stem: 'Which organelle makes energy?', status: 'published', version: 1, createdBy: d.users.editor._id });
  q2 = await Question.create({ ...s, subjectId: d.bio._id, topic: 'Cells', objective: 'Describe organelles', stem: 'Which organelle holds DNA?', status: 'published', version: 1, createdBy: d.users.editor._id });
  for (const [i, u] of studentIds.entries()) await Attempt.create({ userId: u, subjectId: d.bio._id, schoolId: d.school._id, mode: 'practice', topic: 'Cells', status: 'marked', score: i < 4 ? 0 : 2, maxScore: 2, pct: i < 4 ? 0 : 100,
    items: [{ questionId: q1._id }, { questionId: q2._id }], responses: [{ questionId: q1._id, response: 0, correct: i >= 4, markedBy: 'auto' }, { questionId: q2._id, response: 0, correct: i >= 4, markedBy: 'auto' }], submittedAt: new Date() });
  await GameSession.create({ userId: studentIds[0], subjectId: d.bio._id, game: 'quiz_challenge', topic: 'Cells', status: 'finished', accuracy: 0.5 });
  await AiUsage.create({ day: new Date().toISOString().slice(0, 10), provider: 'test-llm', model: 't', purpose: 'tutor', feature: 'tutor', status: 'ok', inputTokens: 1000, outputTokens: 500, userId: studentIds[0], schoolId: d.school._id });
});
const get = (a: any, q: Record<string, string> = {}) => a.get('/api/analytics/reports').query(q);
const rep = (b: any, k: string) => b.reports.find((r: any) => r.key === k);

describe('§16 learning analytics', () => {
  it('lesson completion: opening a published lesson is recorded and a learner can mark it completed', async () => {
    const ama = await loginAs('ama@sample.ghlearn.test'); const r = ctx.data.resources[0];
    const o = await ama.get(`/api/resources/${id(r)}`); expect(o.status).toBe(200); expect(o.body.progress.openedAt).toBeTruthy(); expect(o.body.progress.completedAt).toBeNull();
    await ama.get(`/api/resources/${id(r)}`);
    const c = await ama.post(`/api/resources/${id(r)}/complete`).send({}); expect(c.status).toBe(200); expect(c.body.progress.completedAt).toBeTruthy();
    const p = await ResourceProgress.findOne({ userId: ctx.data.users.ama._id, resourceId: r._id }).lean(); expect(p!.opens).toBe(2); expect(String(p!.schoolId)).toBe(id(ctx.data.school));
    // Draft lessons and lessons outside the learner's subjects cannot be completed.
    expect((await ama.post(`/api/resources/${id(ctx.data.resources[1])}/complete`).send({})).status).toBe(404);
    expect((await ama.post(`/api/resources/${id(ctx.data.resources[2])}/complete`).send({})).status).toBeGreaterThanOrEqual(403);
    const undo = await ama.post(`/api/resources/${id(r)}/complete`).send({ completed: false }); expect(undo.body.progress.completedAt).toBeNull();
    // Staff previews are not counted.
    await (await loginAs('editor@sample.ghlearn.test')).get(`/api/resources/${id(r)}`);
    expect(await ResourceProgress.countDocuments({ userId: ctx.data.users.editor._id })).toBe(0);
  });
  it('super admin gets every learner report, each labelled measured / estimate / suggestion', async () => {
    const a = await loginAs('super@sample.ghlearn.test'); const r = await get(a); expect(r.status).toBe(200); expect(r.body.scope).toBe('platform');
    const keys = r.body.reports.map((x: any) => x.key);
    for (const k of ['enrolment', 'subject_selection', 'active_users', 'lesson_completion', 'exercise_completion', 'assessment_results', 'topic_performance', 'misconceptions', 'remediation', 'game_participation', 'tutor_usage', 'content_quality', 'ai_cost']) expect(keys).toContain(k);
    expect(keys).not.toContain('students_support'); // student-level data is off by default
    for (const x of r.body.reports) expect(['measured', 'estimate', 'suggestion']).toContain(x.kind);
    expect(rep(r.body, 'ai_cost').kind).toBe('estimate'); expect(rep(r.body, 'remediation').kind).toBe('suggestion'); expect(rep(r.body, 'enrolment').kind).toBe('measured');
    expect(rep(r.body, 'enrolment').summary[0].value).toBeGreaterThanOrEqual(9);
    const t = rep(r.body, 'topic_performance').rows.find((x: any) => x.topic === 'Cells'); expect(t.learners).toBe(7 - 1 + 0); expect(t.mastery).toBe(Math.round(((0.3 * 4 + 0.9 * 2) / 6) * 100));
    const m = rep(r.body, 'misconceptions').rows; expect(m[0].wrongPct).toBe(67); expect(m[0].answers).toBe(6);
    const rem = rep(r.body, 'remediation').rows; expect(rem[0].objective).toBe('Describe organelles'); expect(rem[0].correctPct).toBe(33);
    const g = rep(r.body, 'game_participation').rows[0]; expect(g.sessions).toBe(1); expect(g.accuracy).toBeNull(); // 1 player < 5: accuracy hidden
    expect(rep(r.body, 'ai_cost').rows.find((x: any) => x.feature === 'tutor').tokens).toBe(1500);
    const ex = rep(r.body, 'exercise_completion'); expect(ex.rows.find((x: any) => x.mode === 'practice').completed).toBe(6);
    expect(JSON.stringify(r.body)).not.toMatch(/Learner Number|Ama Mensah/); // no names in aggregate reports
  });
  it('filters: class and academic year narrow to the class learners; small groups are hidden by default', async () => {
    const a = await loginAs('super@sample.ghlearn.test');
    const r = await get(a, { classId: id(cls), reports: 'topic_performance,misconceptions,enrolment' }); expect(r.status).toBe(200);
    expect(rep(r.body, 'enrolment').summary[0].value).toBe(3);
    const t = rep(r.body, 'topic_performance'); expect(t.rows[0].mastery).toBeNull(); expect(t.suppressedRows).toBe(1); // 3 learners < 5
    const shown = await get(a, { classId: id(cls), reports: 'topic_performance', showSmallGroups: 'true' }); expect(rep(shown.body, 'topic_performance').rows[0].mastery).toBe(30);
    const y = await get(a, { academicYearId: id(year), reports: 'enrolment' }); expect(rep(y.body, 'enrolment').summary[0].value).toBe(3);
    const lvl = await get(a, { levelId: id(ctx.data.shs), programmeId: id(ctx.data.sci), subjectId: id(ctx.data.bio), topic: 'Cells', reports: 'enrolment,topic_performance' });
    expect(rep(lvl.body, 'enrolment').summary[0].value).toBe(7); // 6 + Ama (science, takes biology)
    const future = await get(a, { from: '2030-01-01', to: '2030-02-01', reports: 'exercise_completion' }); expect(rep(future.body, 'exercise_completion').rows).toEqual([]);
    expect((await get(a, { bogus: '1' })).status).toBe(422);
  });
  it('school admin is forced to their school; other schools and foreign classes are denied', async () => {
    const a = await loginAs('admin@sample.ghlearn.test');
    const r = await get(a, { reports: 'enrolment' }); expect(r.body.scope).toBe('school'); expect(rep(r.body, 'enrolment').summary[0].value).toBe(8); // 6 + Ama + Kofi, not the other school
    expect((await get(a, { schoolId: id(other) })).status).toBe(403);
    const foreign = await ClassGroup.create({ name: 'Foreign', schoolId: other._id, yearOfStudy: 1 });
    expect((await get(a, { classId: id(foreign) })).status).toBe(403);
  });
  it('student-level data: only Super/School Admins, only on request, and the view is audited', async () => {
    const a = await loginAs('admin@sample.ghlearn.test');
    const r = await get(a, { reports: 'students_support' }); expect(r.status).toBe(200);
    const s = rep(r.body, 'students_support'); expect(s.studentLevel).toBe(true); expect(s.rows.length).toBe(4); expect(s.rows[0].student).toMatch(/Learner Number/);
    await new Promise((x) => setTimeout(x, 50));
    expect(await AuditLog.countDocuments({ action: 'analytics.student_view', actorId: ctx.data.users.schoolAdmin._id })).toBe(1);
    const cur = await loginAs('curriculum@sample.ghlearn.test');
    expect((await get(cur, { reports: 'students_support' })).status).toBe(403);
    expect((await get(cur, { showSmallGroups: 'true' })).status).toBe(403);
  });
  it('content staff see only content and AI reports, cannot filter by school/class/year', async () => {
    for (const email of ['curriculum@sample.ghlearn.test']) {
      const a = await loginAs(email); const r = await get(a); expect(r.status).toBe(200); expect(r.body.scope).toBe('content');
      expect(r.body.reports.map((x: any) => x.key).sort()).toEqual(['ai_cost', 'content_quality']);
      expect((await get(a, { schoolId: id(ctx.data.school) })).status).toBe(403);
      expect((await get(a, { classId: id(cls) })).status).toBe(403);
      expect((await get(a, { academicYearId: id(year) })).status).toBe(403);
      const f = await a.get('/api/analytics/filters'); expect(f.body.classes).toEqual([]); expect(f.body.academicYears).toEqual([]); expect(f.body.canSeeStudents).toBe(false);
    }
  });
  it('denies teachers, students, editors and operators', async () => {
    for (const e of ['teacher', 'ama', 'editor', 'operator', 'counselor']) {
      const a = await loginAs(`${e}@sample.ghlearn.test`);
      expect((await get(a)).status).toBe(403);
      expect((await a.get('/api/analytics/reports/enrolment/export').query({ format: 'csv' })).status).toBe(403);
    }
  });
  it('CSV and Excel exports are permission-checked and audited with the filters', async () => {
    const a = await loginAs('super@sample.ghlearn.test');
    const c = await a.get('/api/analytics/reports/topic_performance/export').query({ format: 'csv', subjectId: id(ctx.data.bio) });
    expect(c.status).toBe(200); expect(c.headers['content-type']).toMatch(/text\/csv/); expect(c.text).toMatch(/Average mastery/); expect(c.text).toMatch(/Cells/);
    const x = await a.get('/api/analytics/reports/ai_cost/export').query({ format: 'xlsx' }).buffer(true).parse(binary);
    expect(x.status).toBe(200); expect(x.headers['content-disposition']).toMatch(/\.xlsx/);
    const book = await readXlsx(x.body); expect(book.files).toContain('xl/workbook.xml'); expect(book.texts.join(' ')).toMatch(/Estimate/); expect(book.texts).toContain('Estimated cost (USD)');
    await new Promise((r) => setTimeout(r, 50));
    const logs = await AuditLog.find({ action: 'report.export', 'meta.report': { $in: ['analytics.topic_performance', 'analytics.ai_cost'] } }).lean();
    expect(logs.map((l: any) => l.meta.format).sort()).toEqual(['csv', 'xlsx']); expect((logs.find((l: any) => l.meta.format === 'csv') as any).meta.filters.subjectId).toBe(id(ctx.data.bio));
    const cur = await loginAs('curriculum@sample.ghlearn.test');
    expect((await cur.get('/api/analytics/reports/enrolment/export').query({ format: 'csv' })).status).toBe(403); // learner report outside content scope
    expect((await cur.get('/api/analytics/reports/content_quality/export').query({ format: 'csv' })).status).toBe(200);
    const sa = await loginAs('admin@sample.ghlearn.test');
    expect((await sa.get('/api/analytics/reports/enrolment/export').query({ format: 'csv', schoolId: id(other) })).status).toBe(403);
    const ss = await sa.get('/api/analytics/reports/students_support/export').query({ format: 'csv' }); expect(ss.status).toBe(200); expect(ss.text).toMatch(/Learner Number/);
  });
  it('AI recommendation: on request only, aggregated data only, labelled, and budget-limited', async () => {
    useTestLlm(); testLlm.calls.length = 0;
    const a = await loginAs('admin@sample.ghlearn.test');
    const r = await a.post('/api/analytics/recommendations').send({ subjectId: id(ctx.data.bio) }); expect(r.status).toBe(200);
    expect(r.body.kind).toBe('ai'); expect(r.body.label).toMatch(/AI recommendation/); expect(r.body.text).toBeTruthy();
    const sent = JSON.stringify(testLlm.calls.at(-1)); expect(sent).toMatch(/Describe organelles/); expect(sent).not.toMatch(/Learner Number|Ama Mensah|@t\.gh/);
    const { updateAiSettings, getAiSettings } = await import('../src/services/aiSettings.js');
    const s = await getAiSettings(); await updateAiSettings({ allowedFeatures: s.allowedFeatures.filter((f: string) => f !== 'analytics_summary') }, id(ctx.data.users.superAdmin));
    const off = await a.post('/api/analytics/recommendations').send({}); expect(off.status).toBe(403); expect(off.body.error?.code ?? off.body.code).toBe('FEATURE_DISABLED');
    await updateAiSettings({ allowedFeatures: s.allowedFeatures }, id(ctx.data.users.superAdmin));
  });
});
