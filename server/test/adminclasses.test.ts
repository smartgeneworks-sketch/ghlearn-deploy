import { describe, it, expect, beforeAll } from 'vitest';
import { useDb, ctx, loginAs } from './setup.js';
import { User, School, StudentProfile, ClassGroup, AcademicYear, ImportBatch, AuditLog, TeacherAssignment, RoleAssignment } from '../src/models/index.js';
import { hashPassword } from '../src/services/auth.js';
import { parseCsv } from '../src/services/enrolmentImport.js';
useDb();
const id = (x: any) => String(x._id);
const PW = 'SamplePass2026';
const E = { super: 'super@sample.ghlearn.test', school: 'admin@sample.ghlearn.test', curriculum: 'curriculum@sample.ghlearn.test', teacher: 'teacher@sample.ghlearn.test', student: 'kofi@sample.ghlearn.test', operator: 'operator@sample.ghlearn.test' };
let other: any, otherStudent: any, otherTeacher: any, otherAdmin: any, year: any;
beforeAll(async () => {
  other = await School.create({ name: 'Classes Other High', code: 'CLS-OTH' });
  otherAdmin = await User.create({ email: 'coadmin@t.gh', fullName: 'Other Admin', roles: ['school_admin'], schoolId: other._id, passwordHash: await hashPassword(PW) });
  otherTeacher = await User.create({ email: 'coteacher@t.gh', fullName: 'Other Teacher', roles: ['teacher'], schoolId: other._id, passwordHash: await hashPassword(PW) });
  otherStudent = await User.create({ email: 'costudent@t.gh', fullName: 'Other Student', roles: ['student'], schoolId: other._id, passwordHash: await hashPassword(PW) });
  await StudentProfile.create({ userId: otherStudent._id, schoolId: other._id, levelId: ctx.data.shs._id, yearOfStudy: 1, subjectIds: [ctx.data.bio._id] });
  const { backfillRoleAssignments } = await import('../src/services/roles.js'); await backfillRoleAssignments();
  year = await AcademicYear.findOne({ current: true });
});

describe('classes (§15): create, teachers, enrol, transfer', () => {
  let bio: any, gen: any;
  it('creates classes with validated references and no duplicate names per year', async () => {
    const sa = await loginAs(E.school);
    const r = await sa.post('/api/admin/classes').send({ name: '1 Science A Biology', subjectId: id(ctx.data.bio), yearOfStudy: 1, academicYearId: id(year), programmeId: id(ctx.data.sci), teacherIds: [id(ctx.data.users.teacher)] });
    expect(r.status).toBe(201); expect(r.body.assignmentsCreated).toBe(0); bio = r.body.class;
    expect((await sa.post('/api/admin/classes').send({ name: '1 science a biology', academicYearId: id(year) })).status).toBe(409);
    expect((await sa.post('/api/admin/classes').send({ name: 'Bad teacher', teacherIds: [id(otherTeacher)] })).status).toBe(403);
    expect((await sa.post('/api/admin/classes').send({ name: 'Other school', schoolId: id(other) })).status).toBe(403);
    gen = (await sa.post('/api/admin/classes').send({ name: '1 Science A', yearOfStudy: 1, academicYearId: id(year) })).body.class;
    // adding a teacher to a chemistry class creates the missing teaching assignment (reported)
    const chem = (await sa.post('/api/admin/classes').send({ name: '1 Science A Chemistry', subjectId: id(ctx.data.chem), academicYearId: id(year) })).body.class;
    const t = await sa.post(`/api/admin/classes/${chem._id}/teachers`).send({ teacherId: id(ctx.data.users.teacher) });
    expect(t.status).toBe(201); expect(t.body.assignmentsCreated).toBe(1);
    expect(await TeacherAssignment.exists({ teacherId: ctx.data.users.teacher._id, subjectId: ctx.data.chem._id })).toBeTruthy();
    expect((await sa.post(`/api/admin/classes/${chem._id}/teachers`).send({ teacherId: id(ctx.data.users.teacher) })).status).toBe(409);
    expect((await sa.delete(`/api/admin/classes/${chem._id}/teachers/${id(ctx.data.users.teacher)}`)).status).toBe(204);
    expect((await sa.delete(`/api/admin/classes/${chem._id}`)).status).toBe(204);
  });
  it('lists are school-scoped; teachers, curriculum and operator are refused', async () => {
    await ClassGroup.create({ schoolId: other._id, name: 'Other Class', teacherIds: [], studentIds: [otherStudent._id] });
    const mine = await (await loginAs(E.school)).get('/api/admin/classes');
    expect(mine.status).toBe(200); expect(mine.body.items.every((c: any) => c.schoolId._id === id(ctx.data.school))).toBe(true);
    expect((await (await loginAs(E.school)).get(`/api/admin/classes?schoolId=${id(other)}`)).status).toBe(403);
    expect((await (await loginAs(E.super)).get(`/api/admin/classes?schoolId=${id(other)}`)).body.total).toBe(1);
    for (const e of [E.teacher, E.curriculum, E.operator, E.student]) expect((await (await loginAs(e)).get('/api/admin/classes')).status, e).toBe(403);
    const oc = await ClassGroup.findOne({ name: 'Other Class' });
    expect((await (await loginAs(E.school)).get(`/api/admin/classes/${id(oc)}`)).status).toBe(404);
    expect((await (await loginAs(E.school)).post(`/api/admin/classes/${id(oc)}/students`).send({ userIds: [id(ctx.data.users.ama)] })).status).toBe(404);
  });
  it('enrols only students of the school who take the subject; duplicates are reported', async () => {
    const sa = await loginAs(E.school);
    const r = await sa.post(`/api/admin/classes/${bio._id}/students`).send({ userIds: [id(ctx.data.users.ama)] }); expect(r.body).toEqual({ added: 1, alreadyEnrolled: 0 });
    expect((await sa.post(`/api/admin/classes/${bio._id}/students`).send({ userIds: [id(ctx.data.users.ama)] })).body).toEqual({ added: 0, alreadyEnrolled: 1 });
    expect((await sa.post(`/api/admin/classes/${bio._id}/students`).send({ userIds: [id(ctx.data.users.kofi)] })).status).toBe(403); // does not take Biology
    expect((await sa.post(`/api/admin/classes/${bio._id}/students`).send({ userIds: [id(otherStudent)] })).status).toBe(403);
    expect((await sa.post(`/api/admin/classes/${bio._id}/students`).send({ userIds: [id(ctx.data.users.teacher)] })).status).toBe(403);
    const cand = await sa.get(`/api/admin/classes/${gen._id}/candidates?q=kofi`); expect(cand.body.items.map((u: any) => u.email)).toEqual([E.student]);
    expect((await sa.post(`/api/admin/classes/${gen._id}/students`).send({ userIds: [id(ctx.data.users.kofi), id(ctx.data.users.ama)] })).body.added).toBe(2);
    const d = await sa.get(`/api/admin/classes/${bio._id}`); expect(d.body.students.map((s: any) => s.email)).toEqual(['ama@sample.ghlearn.test']); expect(d.body.students[0].takesSubject).toBe(true);
    expect((await sa.patch(`/api/admin/classes/${bio._id}`).send({ subjectId: id(ctx.data.chem) })).status).toBe(409);
  });
  it('transfers between classes of the same school only', async () => {
    const sa = await loginAs(E.school);
    const b = (await sa.post('/api/admin/classes').send({ name: '1 Science B', yearOfStudy: 1, academicYearId: id(year) })).body.class;
    const t = await sa.post(`/api/admin/classes/${gen._id}/transfer`).send({ userIds: [id(ctx.data.users.kofi)], toClassId: b._id });
    expect(t.body).toEqual({ moved: 1, alreadyInTarget: 0 });
    expect((await ClassGroup.findById(gen._id).lean())!.studentIds.map(String)).toEqual([id(ctx.data.users.ama)]);
    expect((await ClassGroup.findById(b._id).lean())!.studentIds.map(String)).toEqual([id(ctx.data.users.kofi)]);
    expect((await sa.post(`/api/admin/classes/${gen._id}/transfer`).send({ userIds: [id(ctx.data.users.kofi)], toClassId: b._id })).status).toBe(422);
    const oc = await ClassGroup.findOne({ name: 'Other Class' });
    expect((await (await loginAs(E.super)).post(`/api/admin/classes/${b._id}/transfer`).send({ userIds: [id(ctx.data.users.kofi)], toClassId: id(oc) })).status).toBe(403);
    expect((await sa.post(`/api/admin/classes/${bio._id}/transfer`).send({ userIds: [id(ctx.data.users.ama)], toClassId: b._id })).status).toBe(200);
    await sa.post(`/api/admin/classes/${b._id}/transfer`).send({ userIds: [id(ctx.data.users.ama)], toClassId: bio._id });
    expect((await sa.delete(`/api/admin/classes/${b._id}`)).status).toBe(409);
    expect((await sa.patch(`/api/admin/classes/${b._id}`).send({ archived: true })).status).toBe(200);
    expect((await sa.post(`/api/admin/classes/${b._id}/students`).send({ userIds: [id(ctx.data.users.ama)] })).status).toBe(409);
  });
  it('exports enrolments as CSV (audited, school-scoped)', async () => {
    const sa = await loginAs(E.school);
    const r = await sa.get('/api/admin/classes/export.csv?archived=all'); expect(r.status).toBe(200); expect(r.headers['content-type']).toContain('text/csv');
    const rows = parseCsv(r.text); expect(rows[0][1]).toBe('Class');
    const expected = (await ClassGroup.find({ schoolId: ctx.data.school._id }).lean()).reduce((n, c) => n + c.studentIds.length, 0);
    expect(rows.length - 1).toBe(expected); expect(r.text).not.toContain('Other Student');
    expect(await AuditLog.exists({ action: 'report.export', target: 'enrolments' })).toBeTruthy();
  });
});

describe('CSV enrolment import: validate, preview, commit, rollback (§15)', () => {
  const head = 'email,full_name,class,year_of_study,academic_year';
  it('serves a template and rejects malformed files', async () => {
    const sa = await loginAs(E.school);
    const t = await sa.get('/api/admin/imports/enrolments/template.csv'); expect(t.text.split(/\r\n/)[0]).toBe(head);
    expect((await sa.post('/api/admin/imports/enrolments').send({ csv: 'name,class\na,b' })).body.error.message).toMatch(/Missing required column\(s\): email/);
    expect((await sa.post('/api/admin/imports/enrolments').send({ csv: 'email,class,password\na@b.c,X,y' })).body.error.message).toMatch(/Unknown column/);
    expect((await sa.post('/api/admin/imports/enrolments').send({ csv: head + '\n"unclosed,X' })).status).toBe(422);
    expect((await (await loginAs(E.teacher)).post('/api/admin/imports/enrolments').send({ csv: head })).status).toBe(403);
  });
  let batch: any; let preexisting: string[];
  it('preview classifies every row without writing', async () => {
    const sa = await loginAs(E.school);
    const usersBefore = await User.countDocuments(); preexisting = (await ClassGroup.findOne({ name: '1 Science A' }).lean())!.studentIds.map(String);
    const csv = [head,
      'kofi@sample.ghlearn.test,Kofi B,1 Science A,1,',           // 2: existing, name differs -> enrol + warning
      'ama@sample.ghlearn.test,,1 Science A,,',                   // 3: already enrolled -> skip
      'new.one@t.gh,New One,1 Science A,1,2026/2027',            // 4: create + enrol
      'new.one@t.gh,New One,1 Science A,1,2026/2027',            // 5: duplicate of 4
      'not-an-email,X,1 Science A,,',                              // 6: bad email
      'costudent@t.gh,Other Student,1 Science A,,',                // 7: other school
      'teacher@sample.ghlearn.test,Bio,1 Science A,,',             // 8: not a student
      'new.two@t.gh,New Two,1 Arts Z,1,',                          // 9: create class + create student
      'new.three@t.gh,New Three,1 Science A Biology,,',           // 10: new student into subject class
      'kofi@sample.ghlearn.test,,1 Science A,9,',                  // 11: bad year
      'kofi@sample.ghlearn.test,,1 Science A,,1999/2000',          // 12: unknown academic year
    ].join('\r\n');
    const r = await sa.post('/api/admin/imports/enrolments').send({ csv, filename: 'test.csv', createMissingStudents: true, createMissingClasses: true });
    expect(r.status).toBe(201); batch = r.body.batch;
    const by = Object.fromEntries(batch.rows.map((x: any) => [x.line, x]));
    expect(by[2].action).toBe('enrol'); expect(by[2].warnings.join()).toMatch(/account name is kept/);
    expect(by[3].action).toBe('skip'); expect(by[4].action).toBe('create_and_enrol');
    expect(by[5].errors).toEqual(['Duplicate of line 4']); expect(by[6].errors).toEqual(['Email is not valid']);
    expect(by[7].errors[0]).toMatch(/another school/); expect(by[8].errors[0]).toMatch(/not a student/);
    expect(by[9].action).toBe('create_and_enrol'); expect(by[9].createsClass).toBe(true);
    expect(by[10].errors[0]).toMatch(/no subjects yet/); expect(by[11].errors[0]).toMatch(/year_of_study/); expect(by[12].errors[0]).toMatch(/1999\/2000/);
    expect(batch.summary).toMatchObject({ rows: 11, enrol: 1, createAndEnrol: 2, skip: 1, errors: 7, newClasses: ['1 Arts Z'], newStudents: 2 });
    expect(await User.countDocuments()).toBe(usersBefore); expect(await ClassGroup.exists({ name: '1 Arts Z' })).toBeNull();
    const rep = await sa.get(`/api/admin/imports/${batch._id}/errors.csv`); expect(parseCsv(rep.text).length).toBe(1 + 10);
    expect((await (await loginAs('coadmin@t.gh')).get(`/api/admin/imports/${batch._id}`)).status).toBe(404);
  });
  let created: any;
  it('commit needs explicit consent to skip errors, then applies only valid rows and returns passwords once', async () => {
    const sa = await loginAs(E.school);
    expect((await sa.post(`/api/admin/imports/${batch._id}/commit`).send({})).body.error.code).toBe('IMPORT_HAS_ERRORS');
    const r = await sa.post(`/api/admin/imports/${batch._id}/commit`).send({ skipErrors: true });
    expect(r.status).toBe(200); expect(r.headers['cache-control']).toBe('no-store'); created = r.body.batch.created;
    expect(r.body.credentials.map((c: any) => c.email).sort()).toEqual(['new.one@t.gh', 'new.two@t.gh']);
    expect(created.userIds).toHaveLength(2); expect(created.classIds).toHaveLength(1); expect(created.enrolments).toHaveLength(3);
    const n1 = await User.findOne({ email: 'new.one@t.gh' }).lean(); expect(n1!.mustChangePassword).toBe(true); expect(String(n1!.schoolId)).toBe(id(ctx.data.school));
    expect(await RoleAssignment.exists({ userId: n1!._id, role: 'student' })).toBeTruthy();
    const sciA = (await ClassGroup.findOne({ name: '1 Science A' }).lean())!.studentIds.map(String);
    expect(sciA).toEqual(expect.arrayContaining([...preexisting, id(ctx.data.users.kofi), id(n1)]));
    expect(JSON.stringify(await ImportBatch.findById(batch._id).lean())).not.toContain(r.body.credentials[0].temporaryPassword);
    expect(JSON.stringify(await AuditLog.find({ entityType: 'import' }).lean())).not.toContain(r.body.credentials[0].temporaryPassword);
    expect((await sa.post(`/api/admin/imports/${batch._id}/commit`).send({ skipErrors: true })).status).toBe(409);
  });
  it('rollback removes exactly what the import created; earlier enrolments stay', async () => {
    const sa = await loginAs(E.school);
    // A student who already signed in is kept (and reported), never deleted.
    await User.updateOne({ email: 'new.two@t.gh' }, { lastLoginAt: new Date() });
    const r = await sa.post(`/api/admin/imports/${batch._id}/rollback`).send({});
    expect(r.status).toBe(200); expect(r.body.report).toMatchObject({ enrolmentsRemoved: 3, usersDeleted: 1, usersKept: ['new.two@t.gh'], classesDeleted: 1 });
    expect(await User.exists({ email: 'new.one@t.gh' })).toBeNull(); expect(await ClassGroup.exists({ name: '1 Arts Z' })).toBeNull();
    expect((await ClassGroup.findOne({ name: '1 Science A' }).lean())!.studentIds.map(String).sort()).toEqual([...preexisting].sort());
    expect((await sa.post(`/api/admin/imports/${batch._id}/rollback`).send({})).status).toBe(409);
    expect((await sa.get('/api/admin/imports')).body.items[0].status).toBe('rolled_back');
  });
  it('a stale preview is refreshed instead of committed', async () => {
    const sa = await loginAs(E.school);
    const p = (await sa.post('/api/admin/imports/enrolments').send({ csv: `${head}\nkofi@sample.ghlearn.test,,1 Science A,,` })).body.batch;
    expect(p.rows[0].action).toBe('enrol');
    await ClassGroup.updateOne({ name: '1 Science A' }, { $addToSet: { studentIds: ctx.data.users.kofi._id } });
    const c = await sa.post(`/api/admin/imports/${p._id}/commit`).send({}); expect(c.status).toBe(409); expect(c.body.error.code).toBe('PREVIEW_STALE');
    expect((await sa.get(`/api/admin/imports/${p._id}`)).body.batch.rows[0].action).toBe('skip');
    expect((await sa.post(`/api/admin/imports/${p._id}/commit`).send({})).body.error.code).toBe('NOTHING_TO_IMPORT');
    expect((await sa.post(`/api/admin/imports/${p._id}/cancel`).send({})).status).toBe(200);
  });
  it('a blank academic_year also matches a class not tied to a year; an explicit other year explains the mismatch', async () => {
    const sa = await loginAs(E.school); const yl = await ClassGroup.create({ schoolId: ctx.data.school._id, name: 'Yearless Club', studentIds: [] });
    const r = (await sa.post('/api/admin/imports/enrolments').send({ csv: `${head}\nkofi@sample.ghlearn.test,,Yearless Club,,\nama@sample.ghlearn.test,,Yearless Club,,${year.label}` })).body.batch;
    expect(r.rows[0]).toMatchObject({ action: 'enrol', errors: [] }); expect(r.rows[0].academicYear).toBeUndefined();
    expect(r.rows[1].errors.join()).toMatch(/exists at this school, but not for/);
    await sa.post(`/api/admin/imports/${r._id}/cancel`).send({}); await yl.deleteOne();
  });
  it('without the create options, unknown students and classes are errors', async () => {
    const r = await (await loginAs(E.school)).post('/api/admin/imports/enrolments').send({ csv: `${head}\nnobody@t.gh,No Body,1 Science A,,\nkofi@sample.ghlearn.test,,No Such Class,,` });
    expect(r.body.batch.rows.map((x: any) => x.action)).toEqual(['error', 'error']);
  });
});

describe('academic-year change (rollover)', () => {
  it('previews, promotes classes and students once, graduates the final year', async () => {
    const sa = await loginAs(E.school);
    const next = await AcademicYear.create({ label: '2027/2028', startDate: '2027-09-01', endDate: '2028-07-31' });
    const y3 = await ClassGroup.create({ schoolId: ctx.data.school._id, name: '3 Arts A', yearOfStudy: 3, academicYearId: year._id, teacherIds: [], studentIds: [] });
    const body = { fromAcademicYearId: id(year), toAcademicYearId: id(next) };
    const plan = await sa.post('/api/admin/classes/rollover').send(body);
    expect(plan.status).toBe(200); expect(plan.body.dryRun).toBe(true);
    const sciA = plan.body.plan.find((p: any) => p.name === '1 Science A'); expect(sciA).toMatchObject({ action: 'promote', newName: '2 Science A', newYearOfStudy: 2 });
    expect(plan.body.plan.find((p: any) => p.name === '3 Arts A').action).toBe('graduate');
    expect(await ClassGroup.countDocuments({ academicYearId: next._id })).toBe(0);
    const kofiYear = (await StudentProfile.findOne({ userId: ctx.data.users.kofi._id }).lean())!.yearOfStudy;
    const done = await sa.post('/api/admin/classes/rollover').send({ ...body, dryRun: false }); expect(done.status).toBe(200);
    const n = await ClassGroup.findOne({ name: '2 Science A', academicYearId: next._id }).lean(); expect(n).toBeTruthy();
    expect(n!.studentIds.map(String)).toEqual(expect.arrayContaining([id(ctx.data.users.ama), id(ctx.data.users.kofi)]));
    expect((await ClassGroup.findOne({ name: '1 Science A', academicYearId: year._id }).lean())!.archived).toBe(true);
    expect((await ClassGroup.findById(y3._id).lean())!.archived).toBe(true);
    expect((await StudentProfile.findOne({ userId: ctx.data.users.kofi._id }).lean())!.yearOfStudy).toBe(kofiYear + 1); // once, despite two year-1 classes
    expect((await sa.post('/api/admin/classes/rollover').send({ ...body, dryRun: false })).body.summary.promote).toBe(0);
    expect((await sa.post('/api/admin/classes/rollover').send({ fromAcademicYearId: id(next), toAcademicYearId: id(year) })).status).toBe(422);
    expect((await (await loginAs('coadmin@t.gh')).post('/api/admin/classes/rollover').send({ ...body, schoolId: id(ctx.data.school) })).status).toBe(403);
  });
});
