import { describe, it, expect, beforeAll } from 'vitest';
import { useDb, ctx, loginAs } from './setup.js';
import { User, School, StudentProfile, Subject, AcademicLevel, AcademicYear, CurriculumDocument, CurriculumNode, Lesson, Chunk, SubjectCombination } from '../src/models/index.js';
import { hashPassword } from '../src/services/auth.js';
useDb();
const id = (x: any) => String(x._id);
const PW = 'SamplePass2026';
const E = { super: 'super@sample.ghlearn.test', school: 'admin@sample.ghlearn.test', curriculum: 'curriculum@sample.ghlearn.test', teacher: 'teacher@sample.ghlearn.test', student: 'kofi@sample.ghlearn.test', editor: 'editor@sample.ghlearn.test', operator: 'operator@sample.ghlearn.test' };
let other: any;
beforeAll(async () => {
  other = await School.create({ name: 'Structure Other High', code: 'STR-OTH', region: 'Volta' });
  await User.create({ email: 'sother@t.gh', fullName: 'Other Candidate', roles: ['teacher'], schoolId: other._id, passwordHash: await hashPassword(PW) });
  const { backfillRoleAssignments } = await import('../src/services/roles.js'); await backfillRoleAssignments();
});

describe('schools (§6)', () => {
  it('list: super sees all with counts matching the database; school admin only their own', async () => {
    const r = await (await loginAs(E.super)).get('/api/admin/schools?sort=name');
    expect(r.status).toBe(200); expect(r.body.total).toBe(await School.countDocuments());
    const s = r.body.items.find((x: any) => x._id === id(ctx.data.school));
    expect(s.counts.students).toBe(await StudentProfile.countDocuments({ schoolId: ctx.data.school._id }));
    expect(s.counts.teachers).toBe(await User.countDocuments({ schoolId: ctx.data.school._id, roles: 'teacher' }));
    const mine = await (await loginAs(E.school)).get('/api/admin/schools'); expect(mine.body.total).toBe(1); expect(mine.body.items[0]._id).toBe(id(ctx.data.school));
    expect((await (await loginAs(E.school)).get(`/api/admin/schools/${id(other)}`)).status).toBe(403);
    for (const e of [E.teacher, E.curriculum, E.operator, E.student]) expect((await (await loginAs(e)).get('/api/admin/schools')).status, e).toBe(403);
  });
  it('detail: counts, admins, usage and links', async () => {
    const d = await (await loginAs(E.school)).get(`/api/admin/schools/${id(ctx.data.school)}`);
    expect(d.status).toBe(200); expect(d.body.admins.map((a: any) => a.email)).toContain(E.school);
    expect(d.body.usage).toHaveProperty('activeLearners30d'); expect(d.body.links.analytics).toContain(id(ctx.data.school));
  });
  it('create: validated unique identifier, region and contact', async () => {
    const sa = await loginAs(E.super);
    const ok = await sa.post('/api/admin/schools').send({ name: 'New Valley SHS', code: 'gh-nv-01', region: 'Ashanti', district: 'Kumasi', type: 'public', contact: { email: 'office@nv.edu.gh', phone: '+233 20 000 0000' }, levelKinds: ['SHS'], programmeIds: [id(ctx.data.sci)] });
    expect(ok.status).toBe(201); expect(ok.body.school.code).toBe('GH-NV-01'); expect(ok.body.school.status).toBe('active');
    expect((await sa.post('/api/admin/schools').send({ name: 'Dup', code: 'GH-NV-01' })).status).toBe(409);
    expect((await sa.post('/api/admin/schools').send({ name: 'Bad code', code: 'NV 01!' })).status).toBe(422);
    expect((await sa.post('/api/admin/schools').send({ name: 'Bad region', code: 'BR-1', region: 'Atlantis' })).status).toBe(422);
    expect((await sa.post('/api/admin/schools').send({ name: 'Bad phone', code: 'BP-1', contact: { phone: 'call me' } })).status).toBe(422);
    expect((await sa.post('/api/admin/schools').send({ name: 'Bad LA', code: 'BL-1', programmeIds: ['0123456789abcdef01234567'] })).status).toBe(422);
    expect((await (await loginAs(E.school)).post('/api/admin/schools').send({ name: 'Mine', code: 'MINE-1' })).status).toBe(403);
  });
  it('edit: school admins only change permitted fields of their own school', async () => {
    const sa = await loginAs(E.school);
    const r = await sa.patch(`/api/admin/schools/${id(ctx.data.school)}`).send({ contact: { phone: '030 000 0000', headName: 'Head Teacher' }, district: 'Accra Metro', type: 'mission' });
    expect(r.status).toBe(200); expect(r.body.school.contact.headName).toBe('Head Teacher');
    expect((await School.findById(ctx.data.school._id).lean())!.levelKinds).toEqual(['SHS']); // partial update did not reset defaults
    for (const body of [{ name: 'Renamed' }, { code: 'NEW-CODE' }]) expect((await sa.patch(`/api/admin/schools/${id(ctx.data.school)}`).send(body)).status).toBe(403);
    expect((await sa.patch(`/api/admin/schools/${id(ctx.data.school)}`).send({ status: 'archived' })).status).toBe(422);
    expect((await sa.patch(`/api/admin/schools/${id(other)}`).send({ district: 'X' })).status).toBe(403);
    expect((await sa.patch(`/api/config/schools/${id(ctx.data.school)}`).send({ name: 'Via config' })).status).toBe(403);
    expect((await (await loginAs(E.super)).patch(`/api/admin/schools/${id(other)}`).send({ code: 'SAMPLE-01' })).status).toBe(409);
  });
  it('status: super admin only; archived schools leave onboarding matching', async () => {
    const sa = await loginAs(E.super);
    expect((await (await loginAs(E.school)).post(`/api/admin/schools/${id(ctx.data.school)}/status`).send({ status: 'suspended' })).status).toBe(403);
    expect((await sa.post(`/api/admin/schools/${id(other)}/status`).send({ status: 'archived' })).status).toBe(200);
    expect((await sa.post(`/api/admin/schools/${id(other)}/status`).send({ status: 'archived' })).status).toBe(409);
    expect((await School.findById(other._id).lean())!.active).toBe(false);
    const { matchSchool } = await import('../src/services/schools.js'); expect(await matchSchool('Structure Other High')).toBeNull();
    const listed = await (await loginAs(E.student)).get('/api/config/schools'); expect(listed.body.items.map((s: any) => s._id)).not.toContain(id(other));
    expect(listed.body.items[0]).not.toHaveProperty('contact');
    expect((await sa.post(`/api/admin/schools/${id(other)}/status`).send({ status: 'active' })).status).toBe(200);
    expect(await matchSchool('Structure Other High')).not.toBeNull();
  });
  it('assign and remove school admins (super only, same school)', async () => {
    const sa = await loginAs(E.super);
    const cand = await User.create({ email: 'cand@t.gh', fullName: 'Admin Candidate', roles: ['teacher'], schoolId: ctx.data.school._id, passwordHash: await hashPassword(PW) });
    const { backfillUser } = await import('../src/services/roles.js'); await backfillUser(cand);
    expect((await (await loginAs(E.school)).post(`/api/admin/schools/${id(ctx.data.school)}/admins`).send({ userId: id(cand) })).status).toBe(403);
    const g = await sa.post(`/api/admin/schools/${id(ctx.data.school)}/admins`).send({ userId: id(cand) }); expect(g.status).toBe(201);
    expect((await User.findById(cand._id).lean())!.roles).toContain('school_admin');
    const o = await User.findOne({ email: 'sother@t.gh' });
    expect((await sa.post(`/api/admin/schools/${id(ctx.data.school)}/admins`).send({ userId: id(o) })).status).toBe(409);
    expect((await sa.delete(`/api/admin/schools/${id(ctx.data.school)}/admins/${id(cand)}`)).status).toBe(200);
    expect((await User.findById(cand._id).lean())!.roles).not.toContain('school_admin');
  });
  it('school combinations: per Learning Area and year, isolated, reference-safe', async () => {
    const sa = await loginAs(E.school); const base = `/api/admin/schools/${id(ctx.data.school)}/combinations`;
    const c = await sa.post(base).send({ name: 'Year 1 Bio-Chem', programmeId: id(ctx.data.sci), subjectIds: [id(ctx.data.bio), id(ctx.data.chem)], yearOfStudy: 1 });
    expect(c.status).toBe(201); expect(String(c.body.combination.schoolId)).toBe(id(ctx.data.school));
    const jhs = await AcademicLevel.create({ kind: 'JHS', name: 'JHS Test Level', years: 3 });
    const jsub = await Subject.create({ name: 'JHS Only', code: 'JHSO', levelId: jhs._id, category: 'core' });
    expect((await sa.post(base).send({ name: 'Wrong level', programmeId: id(ctx.data.sci), subjectIds: [id(jsub)] })).status).toBe(422);
    expect((await sa.post(base).send({ name: 'Too many years', programmeId: id(ctx.data.sci), subjectIds: [id(ctx.data.bio)], yearOfStudy: 5 })).status).toBe(422);
    expect((await sa.post(`/api/admin/schools/${id(other)}/combinations`).send({ name: 'Other', programmeId: id(ctx.data.sci), subjectIds: [id(ctx.data.bio)] })).status).toBe(403);
    const list = await sa.get(base); expect(list.body.items.map((x: any) => x.scope)).toEqual(expect.arrayContaining(['school', 'platform']));
    expect((await sa.patch(`${base}/${id(ctx.data.sciCombo)}`).send({ name: 'Hijack platform' })).status).toBe(404);
    await StudentProfile.updateOne({ userId: ctx.data.users.ama._id }, { combinationId: c.body.combination._id });
    const del = await sa.delete(`${base}/${c.body.combination._id}`); expect(del.status).toBe(409); expect(del.body.error.details.references[0].label).toBe('student profiles');
    expect((await sa.post(`${base}/${c.body.combination._id}/archive`).send({})).status).toBe(200);
    expect((await sa.get(base)).body.items.map((x: any) => x._id)).not.toContain(c.body.combination._id);
    await StudentProfile.updateOne({ userId: ctx.data.users.ama._id }, { combinationId: ctx.data.sciCombo._id });
    expect((await (await loginAs(E.curriculum)).get('/api/config/combinations')).body.items.every((x: any) => !x.schoolId)).toBe(true);
  });
});

describe('academic structure lifecycle (§8)', () => {
  it('reorder, deactivate (partial updates keep other fields), archive and restore', async () => {
    const ca = await loginAs(E.curriculum);
    const ids = [id(ctx.data.phy), id(ctx.data.chem), id(ctx.data.bio)];
    expect((await ca.post('/api/config/subjects/reorder').send({ ids })).status).toBe(200);
    const listed = (await ca.get(`/api/config/subjects?levelId=${id(ctx.data.shs)}&category=elective`)).body.items.map((s: any) => s._id);
    expect(listed.filter((x: string) => ids.includes(x))).toEqual(ids);
    expect((await ca.patch(`/api/config/subjects/${id(ctx.data.phy)}`).send({ active: false })).status).toBe(200);
    expect((await ca.patch(`/api/config/subjects/${id(ctx.data.phy)}`).send({ name: 'Physics' })).body.active).toBe(false);
    await ca.patch(`/api/config/subjects/${id(ctx.data.phy)}`).send({ active: true });
    expect((await ca.post(`/api/config/subjects/${id(ctx.data.phy)}/archive`).send({})).status).toBe(200);
    expect((await ca.get('/api/config/subjects')).body.items.map((s: any) => s._id)).not.toContain(id(ctx.data.phy));
    expect((await ca.get('/api/config/subjects?archived=only')).body.items.map((s: any) => s._id)).toEqual([id(ctx.data.phy)]);
    expect((await ca.patch(`/api/config/subjects/${id(ctx.data.phy)}`).send({ name: 'Edit archived' })).status).toBe(409);
    const st = await loginAs('ama@sample.ghlearn.test');
    const on = await st.patch('/api/me/profile').send({ coreSubjectIds: [id(ctx.data.core[0])], electiveSubjectIds: [id(ctx.data.phy)] });
    expect(on.status).toBe(400);
    expect((await ca.post(`/api/config/subjects/${id(ctx.data.phy)}/restore`).send({})).status).toBe(200);
    for (const e of [E.school, E.teacher, E.editor, E.operator]) expect((await (await loginAs(e)).post('/api/config/subjects/reorder').send({ ids })).status, e).toBe(403);
    expect((await ca.post('/api/config/levels/reorder').send({ ids: ['0123456789abcdef01234567'] })).status).toBe(404);
  });
  it('delete is refused while referenced and allowed once unused', async () => {
    const sa = await loginAs(E.super);
    const d = await sa.delete(`/api/config/subjects/${id(ctx.data.bio)}`);
    expect(d.status).toBe(409); expect(d.body.error.code).toBe('IN_USE');
    const labels = d.body.error.details.references.map((r: any) => r.label);
    expect(labels).toEqual(expect.arrayContaining(['student profiles', 'teacher assignments', 'documents', 'learning resources', 'combinations']));
    expect((await sa.get(`/api/config/subjects/${id(ctx.data.bio)}/references`)).body.references.length).toBe(labels.length);
    expect((await sa.delete(`/api/config/levels/${id(ctx.data.shs)}`)).status).toBe(409);
    expect((await sa.delete(`/api/config/programmes/${id(ctx.data.sci)}`)).status).toBe(409);
    expect((await sa.delete(`/api/config/combinations/${id(ctx.data.sciCombo)}`)).status).toBe(409);
    const s = await Subject.create({ name: 'Unused Subject', code: 'UNUSED', levelId: ctx.data.shs._id, category: 'elective' });
    expect((await (await loginAs(E.curriculum)).delete(`/api/config/subjects/${id(s)}`)).status).toBe(403);
    expect((await sa.delete(`/api/config/subjects/${id(s)}`)).status).toBe(204);
    expect((await sa.delete(`/api/config/schools/${id(ctx.data.school)}`)).status).toBe(409);
  });
  it('academic years: one current year, valid dates, current cannot be archived or deleted', async () => {
    const ca = await loginAs(E.curriculum);
    const y = await ca.post('/api/config/academic-years').send({ label: '2027/2028', startDate: '2027-09-01', endDate: '2028-07-31', current: true });
    expect(y.status).toBe(201); expect(await AcademicYear.countDocuments({ current: true })).toBe(1);
    expect((await ca.post('/api/config/academic-years').send({ label: '2030/2031', startDate: '2031-09-01', endDate: '2030-07-31' })).status).toBe(422);
    expect((await ca.post(`/api/config/academic-years/${y.body._id}/archive`).send({})).status).toBe(409);
    expect((await (await loginAs(E.super)).delete(`/api/config/academic-years/${y.body._id}`)).status).toBe(409);
    const first = await AcademicYear.findOne({ label: '2026/2027' });
    expect((await ca.patch(`/api/config/academic-years/${id(first)}`).send({ current: true })).status).toBe(200);
    expect((await AcademicYear.findById(y.body._id).lean())!.current).toBe(false);
  });
});

describe('curriculum elements and versions (§8)', () => {
  let doc: any, strand: any, sub: any, ind: any, strand2: any;
  beforeAll(async () => {
    doc = await CurriculumDocument.create({ title: 'Elements Test Doc', subjectId: ctx.data.chem._id, curriculumVersion: 'SHS 2023+' });
    strand = await CurriculumNode.create({ documentId: doc._id, subjectId: ctx.data.chem._id, type: 'strand', title: 'Strand One', order: 1 });
    strand2 = await CurriculumNode.create({ documentId: doc._id, subjectId: ctx.data.chem._id, type: 'strand', title: 'Strand Two', order: 2 });
    sub = await CurriculumNode.create({ documentId: doc._id, subjectId: ctx.data.chem._id, type: 'subStrand', title: 'Sub One', parentId: strand._id, order: 1 });
    ind = await CurriculumNode.create({ documentId: doc._id, subjectId: ctx.data.chem._id, type: 'indicator', title: 'Indicator 1.1', code: 'B1.1.1', parentId: sub._id, order: 1 });
    await Chunk.create({ documentId: doc._id, subjectId: ctx.data.chem._id, text: 'x', nodeIds: [ind._id, strand2._id] });
  });
  it('tree order, edit, verify and sibling reorder', async () => {
    const ca = await loginAs(E.curriculum);
    const t = await ca.get(`/api/curriculum/nodes?documentId=${id(doc)}`);
    expect(t.body.items.map((n: any) => [n.title, n.depth])).toEqual([['Strand One', 0], ['Sub One', 1], ['Indicator 1.1', 2], ['Strand Two', 0]]);
    expect((await ca.patch(`/api/curriculum/nodes/${id(ind)}`).send({ title: 'Indicator 1.1 (edited)', verified: true })).body.node.verified).toBe(true);
    expect((await ca.post('/api/curriculum/nodes/reorder').send({ ids: [id(strand2), id(strand)] })).status).toBe(200);
    expect((await ca.get(`/api/curriculum/nodes?documentId=${id(doc)}`)).body.items[0].title).toBe('Strand Two');
    expect((await ca.post('/api/curriculum/nodes/reorder').send({ ids: [id(strand), id(ind)] })).status).toBe(422);
    expect((await (await loginAs(E.editor)).patch(`/api/curriculum/nodes/${id(ind)}`).send({ code: 'B1.1.1a' })).status).toBe(200);
    for (const e of [E.school, E.teacher, E.operator, E.student]) expect((await (await loginAs(e)).get(`/api/curriculum/nodes?documentId=${id(doc)}`)).status, e).toBe(403);
  });
  it('archive cascades to descendants; restore needs the parent first', async () => {
    const ca = await loginAs(E.curriculum);
    expect((await ca.post(`/api/curriculum/nodes/${id(strand)}/archive`).send({})).body.affected).toBe(3);
    expect((await ca.get(`/api/curriculum/nodes?documentId=${id(doc)}`)).body.items.map((n: any) => n.title)).toEqual(['Strand Two']);
    expect((await ca.post(`/api/curriculum/nodes/${id(sub)}/restore`).send({})).status).toBe(409);
    expect((await ca.patch(`/api/curriculum/nodes/${id(ind)}`).send({ title: 'nope' })).status).toBe(409);
    expect((await ca.post(`/api/curriculum/nodes/${id(strand)}/restore`).send({})).body.affected).toBe(3);
  });
  it('delete is refused while lessons or children use an element', async () => {
    const ca = await loginAs(E.curriculum);
    await Lesson.create({ title: 'Uses indicator', subjectId: ctx.data.chem._id, nodeId: ind._id, status: 'draft' });
    const d = await ca.delete(`/api/curriculum/nodes/${id(ind)}`); expect(d.status).toBe(409); expect(d.body.error.details.references[0].label).toBe('lessons');
    expect((await ca.delete(`/api/curriculum/nodes/${id(sub)}`)).status).toBe(409);
    expect((await ca.delete(`/api/curriculum/nodes/${id(strand2)}`)).status).toBe(204);
    expect((await Chunk.findOne({ documentId: doc._id }).lean())!.nodeIds.map(String)).toEqual([id(ind)]);
  });
  it('versions: records with counts matching the database (writes need curriculum:manage)', async () => {
    const ca = await loginAs(E.curriculum);
    const v = await ca.get('/api/curriculum/versions'); const row = v.body.items.find((x: any) => x.code === 'SHS 2023+');
    expect(row.status).toBe('active');
    expect(row.counts.subjects).toBe(await Subject.countDocuments({ curriculumVersionId: row._id }));
    expect(row.counts.documents).toBe(await CurriculumDocument.countDocuments({ curriculumVersionId: row._id }));
    expect((await (await loginAs(E.editor)).post('/api/curriculum/versions').send({ code: 'X-1', name: 'X' })).status).toBe(403);
    expect((await ca.post('/api/curriculum/versions/rename').send({ from: 'SHS 2023+', to: 'X' })).status).toBe(404);
    expect(await SubjectCombination.countDocuments()).toBeGreaterThan(0);
  });
});
