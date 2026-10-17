import { describe, it, expect, beforeAll } from 'vitest';
import { useDb, ctx, loginAs } from './setup.js';
import { Question, User, School, StudentProfile, TeacherAssignment, LearningResource, Lesson, Notification, Mastery, AuditLog, Job, ClassGroup } from '../src/models/index.js';
import { hashPassword } from '../src/services/auth.js';
import { SAMPLES } from './questionSamples.js';
import { csvCell, mdToHtml } from '../src/services/teach/reports.js';
import { drain, enqueue, registerJob } from '../src/services/queue.js';
useDb();
const id = (x: any) => String(x._id);
const PW = 'GoodPass123';
let qs: string[] = []; let yaw: any; let esi: any; let school2: any; let classId = '';

beforeAll(async () => {
  const pw = await hashPassword(PW);
  school2 = await School.create({ name: 'Other SHS', code: 'OTH-2' });
  const t2 = await User.create({ email: 't2@t.gh', fullName: 'Other Teacher', roles: ['teacher'], schoolId: school2._id, passwordHash: pw });
  await TeacherAssignment.create({ teacherId: t2._id, schoolId: school2._id, subjectId: ctx.data.bio._id, yearOfStudy: 1 });
  esi = await User.create({ email: 'esi@t.gh', fullName: 'Esi Other', roles: ['student'], schoolId: school2._id, passwordHash: pw });
  await StudentProfile.create({ userId: esi._id, schoolId: school2._id, levelId: ctx.data.shs._id, yearOfStudy: 1, subjectIds: [ctx.data.bio._id], onboardedAt: new Date() });
  yaw = await User.create({ email: 'yaw@t.gh', fullName: 'Yaw Asante', roles: ['student'], schoolId: ctx.data.school._id, passwordHash: pw });
  await StudentProfile.create({ userId: yaw._id, schoolId: ctx.data.school._id, levelId: ctx.data.shs._id, yearOfStudy: 1, subjectIds: [ctx.data.bio._id], onboardedAt: new Date() });
  await User.create({ email: 'admin2@t.gh', fullName: 'Admin Two', roles: ['school_admin'], schoolId: school2._id, passwordHash: pw });
  await User.create({ email: 'rev@t.gh', fullName: 'Reviewer', roles: ['content_reviewer'], passwordHash: pw });
  const base = { subjectId: ctx.data.bio._id, status: 'published', createdBy: ctx.data.users.editor._id, topic: 'Cells' };
  for (let i = 0; i < 4; i++) { const { _id, ...rest } = SAMPLES.mcq as any; qs.push(id(await Question.create({ ...rest, ...base, stem: `Cells mcq number ${i} ${'abc'.repeat(i)}` }))); }
  // a published lesson always has its published resource (the audience is set on the resource at publish time)
  const pubRes = await LearningResource.create({ title: 'Published cells <lesson>', kind: 'notes', subjectId: ctx.data.bio._id, status: 'published', topic: 'Cells', body: 'x' });
  await Lesson.create({ title: 'Published cells <lesson>', resourceId: pubRes._id, subjectId: ctx.data.bio._id, status: 'published', topic: 'Cells', sections: [{ key: 'E', title: 'Explanations', content: '**Cell** is the unit <script>alert(1)</script> of life\n- one\n- two', data: { terms: [{ term: 'Nucleus', definition: 'Controls <b>' }] } },
    { key: 'F', title: 'Diagrams', data: { diagrams: [{ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>', title: 'Cell', spec: { secret: 'x' } }] } }] });
  await Lesson.create({ title: 'DRAFT lesson never offline', subjectId: ctx.data.bio._id, status: 'draft', sections: [] });
  await LearningResource.create({ title: 'DRAFT resource never offline', kind: 'notes', subjectId: ctx.data.bio._id, status: 'draft', body: 'x' });
});

describe('classes', () => {
  it('teacher creates classes only for own subject and school students', async () => {
    const t = await loginAs('teacher@sample.ghlearn.test'); const bio = id(ctx.data.bio);
    expect((await t.post('/api/teacher/classes').send({ name: 'Econ A', subjectId: id(ctx.data.econ) })).status).toBe(403);
    expect((await t.post('/api/teacher/classes').send({ name: '1 Sci A', subjectId: bio, studentIds: [id(esi)] })).status).toBe(403); // other school
    expect((await t.post('/api/teacher/classes').send({ name: '1 Sci A', subjectId: bio, studentIds: [id(ctx.data.users.kofi)] })).status).toBe(403); // not taking bio
    expect((await t.post('/api/teacher/classes').send({ name: '1 Sci A' })).status).toBe(400);
    const c = await t.post('/api/teacher/classes').send({ name: '1 Sci A', subjectId: bio, yearOfStudy: 1, studentIds: [id(ctx.data.users.ama)] });
    expect(c.status, JSON.stringify(c.body)).toBe(201); classId = c.body.class._id;
    const cand = await t.get(`/api/teacher/classes/${classId}/candidates`); expect(cand.body.items.map((x: any) => x.name)).toEqual(['Yaw Asante']);
    expect((await t.patch(`/api/teacher/classes/${classId}`).send({ addStudents: [id(yaw)] })).body.class.studentIds).toHaveLength(2);
    expect((await t.patch(`/api/teacher/classes/${classId}`).send({ addStudents: [id(esi)] })).status).toBe(403);
    expect((await t.get('/api/teacher/classes')).body.items.map((x: any) => x.name)).toEqual(['1 Sci A']);
  });
  it('isolation: other teachers, other school admins and students cannot see the class', async () => {
    const t2 = await loginAs('t2@t.gh', PW);
    expect((await t2.get('/api/teacher/classes')).body.items).toHaveLength(0);
    for (const p of ['', '/candidates', '/report.csv', '/report.pdf', `/students/${id(ctx.data.users.ama)}`]) expect((await t2.get(`/api/teacher/classes/${classId}${p}`)).status, p).toBe(404);
    expect((await t2.patch(`/api/teacher/classes/${classId}`).send({ name: 'Hijack' })).status).toBe(404);
    expect((await (await loginAs('admin2@t.gh', PW)).get(`/api/teacher/classes/${classId}`)).status).toBe(404);
    expect((await (await loginAs('admin@sample.ghlearn.test')).get(`/api/teacher/classes/${classId}`)).status).toBe(200); // own school admin
    const ama = await loginAs('ama@sample.ghlearn.test');
    expect((await ama.get('/api/teacher/classes')).status).toBe(403);
    expect((await ama.get(`/api/teacher/classes/${classId}`)).status).toBe(403);
    // a non-member student of the same school is not in the class detail
    const t = await loginAs('teacher@sample.ghlearn.test');
    expect((await t.get(`/api/teacher/classes/${classId}/students/${id(ctx.data.users.kofi)}`)).status).toBe(404);
  });
});

describe('class assignments, misconceptions, support, reports', () => {
  it('assignment to a class reaches only class members, with notifications', async () => {
    const t = await loginAs('teacher@sample.ghlearn.test'); const t2 = await loginAs('t2@t.gh', PW);
    const closesAt = new Date(Date.now() + 86400000).toISOString();
    expect((await t2.post('/api/assessments').send({ title: 'Steal', subjectId: id(ctx.data.bio), mode: 'assigned', questionIds: qs, classId })).status).toBe(403);
    const a = await t.post('/api/assessments').send({ title: 'Cells check', subjectId: id(ctx.data.bio), mode: 'assigned', questionIds: qs, classId, closesAt, maxAttempts: 1 });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const ama = await loginAs('ama@sample.ghlearn.test'); const yawA = await loginAs('yaw@t.gh', PW);
    const n = await ama.get('/api/notifications'); expect(n.body.unread).toBeGreaterThan(0);
    const note = n.body.items.find((x: any) => x.type === 'assignment.new'); expect(note.title).toContain('Cells check');
    expect(await Notification.countDocuments({ userId: ctx.data.users.kofi._id })).toBe(0);
    expect(await Notification.countDocuments({ userId: esi._id })).toBe(0);
    // notifications are owner-only: yaw cannot mark ama's as read
    expect((await yawA.post('/api/notifications/read').send({ ids: [note._id] })).body.updated).toBe(0);
    expect((await ama.post('/api/notifications/read').send({ ids: [note._id] })).body.updated).toBe(1);
    // both class members answer wrongly with the same wrong option
    const correct = (SAMPLES.mcq as any).data.options[(SAMPLES.mcq as any).data.correctIndex]; const wrong = (SAMPLES.mcq as any).data.options.find((o: string) => o !== correct);
    for (const s of [ama, yawA]) {
      const at = (await s.post('/api/practice/attempts').send({ subjectId: id(ctx.data.bio), mode: 'assigned', assessmentId: a.body.assessment._id })).body.attempt;
      expect(at, 'class member can start').toBeTruthy();
      for (const q of at.questions) { const i = q.options.indexOf(q.stem.includes('number 0') ? correct : wrong); await s.put(`/api/practice/attempts/${at._id}/responses/${q.id}`).send({ response: i }).expect(200); }
      expect((await s.post(`/api/practice/attempts/${at._id}/submit`)).body.attempt.status).toBe('marked');
    }
    // a same-school student outside the class can't see or start it
    const p = await StudentProfile.findOne({ userId: ctx.data.users.kofi._id }); p!.subjectIds.push(ctx.data.bio._id as any); await p!.save();
    const kofi = await loginAs('kofi@sample.ghlearn.test');
    expect((await kofi.get('/api/practice/assigned')).body.items.map((x: any) => x._id)).not.toContain(a.body.assessment._id);
    expect((await kofi.post('/api/practice/attempts').send({ subjectId: id(ctx.data.bio), mode: 'assigned', assessmentId: a.body.assessment._id })).status).toBe(404);
    p!.subjectIds.pop(); await p!.save();
  });
  it('class view: misconceptions, students needing support, remedial recommendations', async () => {
    const t = await loginAs('teacher@sample.ghlearn.test');
    const o = (await t.get(`/api/teacher/classes/${classId}`)).body;
    expect(o.summary.students).toBe(2); expect(o.assignments[0]).toMatchObject({ title: 'Cells check', submitted: 2, outOf: 2, completionPct: 100 });
    const wrong = (SAMPLES.mcq as any).data.options.find((x: string, i: number) => i !== (SAMPLES.mcq as any).data.correctIndex);
    expect(o.misconceptions.length).toBe(3);
    expect(o.misconceptions[0]).toMatchObject({ topic: 'Cells', responses: 2, wrong: 2, wrongPct: 100 });
    expect(o.misconceptions[0].commonWrongAnswers[0]).toMatchObject({ count: 2 }); expect(o.misconceptions[0].commonWrongAnswers[0].answer.toLowerCase()).toBe(wrong.toLowerCase());
    expect(o.topics[0]).toMatchObject({ topic: 'Cells', students: 2 });
    expect(o.remedial[0]).toMatchObject({ topic: 'Cells', students: 2 });
    expect(o.students.every((s: any) => s.weakTopics[0]?.topic === 'Cells')).toBe(true);
    // forcing a support case: low mastery with enough answers
    await Mastery.updateOne({ userId: yaw._id, subjectId: ctx.data.bio._id, topic: 'Cells' }, { score: 0.2, answered: 10 });
    const o2 = (await t.get(`/api/teacher/classes/${classId}`)).body;
    const y = o2.support.find((s: any) => s.name === 'Yaw Asante'); expect(y.reasons.join(' ')).toMatch(/Overall mastery 20%/);
    const det = (await t.get(`/api/teacher/classes/${classId}/students/${id(yaw)}`)).body;
    expect(det.student.fullName).toBe('Yaw Asante'); expect(det.attempts[0].title).toBe('Cells check'); expect(det.misconceptions).toHaveLength(0); // needs 2 responses per question
  });
  it('remedial assignment and CSV/PDF reports', async () => {
    const t = await loginAs('teacher@sample.ghlearn.test');
    const r = await t.post(`/api/teacher/classes/${classId}/remedial`).send({ topic: 'Cells' }); expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.assessment).toMatchObject({ title: 'Remedial: Cells', classId, maxAttempts: 3 });
    expect((await t.post(`/api/teacher/classes/${classId}/remedial`).send({ topic: 'Nothing here' })).status).toBe(400);
    const csv = await t.get(`/api/teacher/classes/${classId}/report.csv`).buffer(true);
    expect(csv.headers['content-type']).toMatch(/text\/csv/); expect(csv.headers['content-disposition']).toMatch(/attachment; filename="?class-report-1_Sci_A/);
    expect(csv.text).toContain('Yaw Asante'); expect(csv.text).toContain('Overall mastery 20%'); expect(csv.text).not.toContain('Esi');
    const pdf = await t.get(`/api/teacher/classes/${classId}/report.pdf`).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(pdf.headers['content-type']).toBe('application/pdf'); expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-'); expect((pdf.body as Buffer).length).toBeGreaterThan(1500);
    const as = (await t.get('/api/assessments')).body.items.find((x: any) => x.title === 'Cells check');
    const rc = await t.get(`/api/assessments/${as._id}/results.csv`); expect(rc.text.split('\r\n').length).toBe(4);
    expect((await (await loginAs('t2@t.gh', PW)).get(`/api/assessments/${as._id}/results.csv`)).status).toBe(404);
    expect(await AuditLog.countDocuments({ action: 'report.export' })).toBeGreaterThanOrEqual(3);
  });
  it('CSV cells are escaped against formula injection', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`); expect(csvCell('a,b')).toBe('"a,b"'); expect(csvCell(['x', 'y'])).toBe('x; y'); expect(csvCell(null)).toBe('');
    expect(mdToHtml('<img src=x onerror=1> **b**')).toBe('<p>&lt;img src=x onerror=1&gt; <strong>b</strong></p>');
  });
});

describe('offline download', () => {
  it('contains only published material, escaped, for users with subject access', async () => {
    const ama = await loginAs('ama@sample.ghlearn.test');
    const r = await ama.get(`/api/offline/${id(ctx.data.bio)}`); expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/attachment/); expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.text).toContain('Published cells &lt;lesson&gt;'); expect(r.text).not.toContain('DRAFT'); expect(r.text).not.toContain('<script>alert');
    expect(r.text).toContain('<svg xmlns'); expect(r.text).toContain('Controls &lt;b&gt;'); expect(r.text).not.toContain('secret');
    expect((await ama.get(`/api/offline/${id(ctx.data.econ)}`)).status).toBe(403); // not enrolled
    expect((await (await loginAs('teacher@sample.ghlearn.test')).get(`/api/offline/${id(ctx.data.bio)}`)).status).toBe(200);
  });
});

describe('admin analytics', () => {
  it('is permission-scoped', async () => {
    const sup = await loginAs('super@sample.ghlearn.test');
    const all = (await sup.get('/api/analytics')).body; expect(all.scope).toBe('platform');
    for (const k of ['users', 'active', 'enrolment', 'content', 'tutor', 'exercises', 'topics', 'engagement', 'ai', 'storage', 'health']) expect(all[k], k).toBeTruthy();
    expect(all.health.db.ok).toBe(true); expect(all.exercises.attemptsCompleted).toBeGreaterThanOrEqual(2); expect(all.content.lessons.byStatus.published).toBe(1);
    const adm = await loginAs('admin@sample.ghlearn.test');
    const s = (await adm.get('/api/analytics')).body; expect(s.scope).toBe('school'); expect(s.storage).toBeUndefined(); expect(s.health).toBeUndefined(); expect(s.content).toBeUndefined();
    expect(s.filters.schoolId).toBe(id(ctx.data.school)); expect(s.users.byRole.student.total).toBe(3); // ama, kofi, yaw; not esi
    expect((await adm.get(`/api/analytics?schoolId=${id(school2)}`)).status).toBe(403);
    const cls2 = await ClassGroup.create({ name: 'Other class', schoolId: school2._id, studentIds: [esi._id] });
    expect((await adm.get(`/api/analytics?classId=${id(cls2)}`)).status).toBe(403);
    const byClass = (await adm.get(`/api/analytics?classId=${classId}&subjectId=${id(ctx.data.bio)}`)).body;
    expect(byClass.enrolment.students).toBe(2); expect(byClass.topics[0]).toMatchObject({ topic: 'Cells', students: 2 }); expect(byClass.exercises.attemptsCompleted).toBe(2);
    const a2 = (await (await loginAs('admin2@t.gh', PW)).get('/api/analytics')).body; expect(a2.users.byRole.student.total).toBe(1); expect(a2.exercises.attemptsCompleted).toBe(0);
    const rev = (await (await loginAs('rev@t.gh', PW)).get('/api/analytics')).body; expect(rev.scope).toBe('content'); expect(rev.users).toBeUndefined(); expect(rev.topics).toBeUndefined(); expect(rev.content).toBeTruthy();
    expect((await (await loginAs('rev@t.gh', PW)).get(`/api/analytics?schoolId=${id(school2)}`)).status).toBe(403);
    expect((await (await loginAs('teacher@sample.ghlearn.test')).get('/api/analytics')).status).toBe(403);
    expect((await (await loginAs('ama@sample.ghlearn.test')).get('/api/analytics')).status).toBe(403);
    const f = (await adm.get('/api/analytics/filters')).body; expect(f.schools).toHaveLength(1); expect(f.classes.map((c: any) => c.name)).toEqual(['1 Sci A']);
    const fr = (await sup.get('/api/analytics?from=2000-01-01&to=2000-01-02')).body; expect(fr.exercises.attemptsStarted).toBe(0);
  });
});

describe('audit log', () => {
  it('filters, paginates, exports CSV, and is school-scoped', async () => {
    const adm = await loginAs('admin@sample.ghlearn.test');
    const r = (await adm.get('/api/admin/audit?action=class.&limit=5')).body; expect(r.items.length).toBeGreaterThan(0); expect(r.items.every((i: any) => i.action.startsWith('class.'))).toBe(true);
    expect(r.actions).toContain('class.create');
    const t2acts = (await adm.get('/api/admin/audit?actor=t2@t.gh')).body; expect(t2acts.items).toHaveLength(0); // other school's actor invisible
    expect((await adm.get('/api/admin/audit?actor=teacher@sample')).body.items.length).toBeGreaterThan(0);
    const csv = await adm.get('/api/admin/audit.csv?action=report.'); expect(csv.text).toContain('report.export'); expect(csv.text.split('\r\n')[0]).toContain('When,Actor');
    expect((await (await loginAs('teacher@sample.ghlearn.test')).get('/api/admin/audit')).status).toBe(403);
    expect((await (await loginAs('admin2@t.gh', PW)).get('/api/admin/audit?action=class.')).body.items).toHaveLength(0);
  });
});

describe('notifications from jobs', () => {
  it('notifies the requester when a user job finishes or dies', async () => {
    registerJob('lesson.generate', async () => ({ ok: true }));
    await enqueue('lesson.generate', {}, { createdBy: id(ctx.data.users.editor) }); await drain();
    const ed = await loginAs('editor@sample.ghlearn.test');
    const n = (await ed.get('/api/notifications?unread=true')).body; expect(n.items[0]).toMatchObject({ type: 'job.finished', title: 'Lesson generation finished' });
    expect((await ed.post('/api/notifications/read').send({ all: true })).body.updated).toBeGreaterThan(0);
    expect((await ed.get('/api/notifications')).body.unread).toBe(0);
    expect(await Job.countDocuments()).toBeGreaterThan(0);
  });
});
