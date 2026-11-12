import { describe, it, expect } from 'vitest';
import { GHANA_REGIONS } from '@ghlearn/shared';
import { useDb, ctx, anon } from './setup.js';
useDb();
const id = (x: any) => String(x._id);
async function newStudent(email: string) {
  const a = await anon();
  await a.post('/api/auth/register').send({ fullName: 'New Student', email, password: 'GoodPass123', acceptTerms: true });
  return a;
}
const base = () => ({ region: 'Ashanti', schoolName: 'Sample Academy', levelId: id(ctx.data.shs), yearOfStudy: 1 });
describe('student onboarding', () => {
  it('lists exactly the 16 regions of Ghana', () => {
    expect(GHANA_REGIONS).toHaveLength(16);
    expect(GHANA_REGIONS).toEqual(expect.arrayContaining(['Ahafo', 'Bono East', 'North East', 'Oti', 'Savannah', 'Western North', 'Greater Accra', 'Upper West']));
  });
  it('accepts any core + elective choice (no combination or elective limits), links a matching school, and enforces access', async () => {
    const a = await newStudent('s1@t.gh'); const d = ctx.data;
    // Science-only elective + Business electives together, no Learning Area: previously rejected, now allowed.
    const r = await a.post('/api/onboarding').send({ ...base(), schoolName: '  sample academy ', coreSubjectIds: [id(d.core[0]), id(d.core[1])], electiveSubjectIds: [id(d.bio), id(d.econ), id(d.acc), id(d.phy), id(d.chem), id(d.emath)] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.profile.subjectIds).toHaveLength(8);
    expect(r.body.profile.region).toBe('Ashanti'); expect(r.body.profile.schoolName).toBe('sample academy');
    expect(r.body.linkedSchool?._id).toBe(id(d.school)); // "(Sample)" suffix and case are ignored when matching
    const me = (await a.get('/api/auth/me')).body.user; expect(me.onboarded).toBe(true); expect(me.schoolId).toBe(id(d.school));
    expect((await a.get(`/api/subjects/${id(d.bio)}/resources`)).status).toBe(200);
    expect((await a.get(`/api/subjects/${id(d.econ)}/resources`)).status).toBe(200);
    // unselected subject is still denied
    expect((await a.get(`/api/subjects/${id(d.core[2])}/resources`)).status).toBe(403);
    expect((await a.post('/api/onboarding').send({ ...base(), coreSubjectIds: [id(d.core[0])] })).status).toBe(409);
  });
  it('keeps an unmatched free-text school name without linking', async () => {
    const a = await newStudent('s3@t.gh'); const d = ctx.data;
    const r = await a.post('/api/onboarding').send({ ...base(), region: 'Western North', schoolName: 'Sefwi Wiawso Senior High School', programmeId: id(d.sci), coreSubjectIds: [id(d.core[0])] });
    expect(r.status, JSON.stringify(r.body)).toBe(201); expect(r.body.linkedSchool).toBeNull(); expect(r.body.profile.schoolId).toBeUndefined();
    expect((await a.get('/api/auth/me')).body.user.schoolId).toBeUndefined();
  });
  it('validates region, school name, subject categories/levels, Learning Area, years and disabled levels', async () => {
    const a = await newStudent('s2@t.gh'); const d = ctx.data; const ok = { ...base(), coreSubjectIds: [id(d.core[0])] };
    expect((await a.post('/api/onboarding').send({ ...ok, region: 'Brong Ahafo' })).status).toBe(422); // pre-2019 region
    expect((await a.post('/api/onboarding').send({ ...ok, region: undefined })).status).toBe(422);
    expect((await a.post('/api/onboarding').send({ ...ok, schoolName: '' })).status).toBe(422);
    expect((await a.post('/api/onboarding').send({ ...ok, coreSubjectIds: [] })).status).toBe(422); // at least one subject
    expect((await a.post('/api/onboarding').send({ ...ok, coreSubjectIds: [id(d.bio)] })).status).toBe(400); // elective in core list
    expect((await a.post('/api/onboarding').send({ ...ok, electiveSubjectIds: [id(d.core[1])] })).status).toBe(400);
    expect((await a.post('/api/onboarding').send({ ...ok, programmeId: id(d.shs) })).status).toBe(400);
    expect((await a.post('/api/onboarding').send({ ...ok, yearOfStudy: 4 })).status).toBe(422);
    const { AcademicLevel } = await import('../src/models/index.js');
    const jhs = await AcademicLevel.findOne({ kind: 'JHS' });
    expect((await a.post('/api/onboarding').send({ ...ok, levelId: id(jhs) })).status).toBe(400);
    const e = (await a.post('/api/onboarding').send({ ...ok, coreSubjectIds: [id(d.bio)] })).body.error.message; expect(e).toMatch(/core subjects/);
  });
  it('students edit their own subjects, region and school later; access follows immediately', async () => {
    const a = await newStudent('s4@t.gh'); const d = ctx.data;
    expect((await a.post('/api/onboarding').send({ ...base(), schoolName: 'Unknown College', coreSubjectIds: [id(d.core[0])], electiveSubjectIds: [id(d.bio)] })).status).toBe(201);
    expect((await a.get(`/api/subjects/${id(d.econ)}/resources`)).status).toBe(403);
    let r = await a.patch('/api/me/profile').send({ coreSubjectIds: [id(d.core[0]), id(d.core[3])], electiveSubjectIds: [id(d.econ)] });
    expect(r.status, JSON.stringify(r.body)).toBe(200); expect(r.body.profile.subjectIds).toHaveLength(3);
    expect((await a.get(`/api/subjects/${id(d.econ)}/resources`)).status).toBe(200);
    expect((await a.get(`/api/subjects/${id(d.bio)}/resources`)).status).toBe(403); // dropped subject: denied again
    expect((await a.patch('/api/me/profile').send({ coreSubjectIds: [id(d.core[0])] })).status).toBe(422); // must send both lists
    expect((await a.patch('/api/me/profile').send({ coreSubjectIds: [], electiveSubjectIds: [] })).status).toBe(422);
    expect((await a.patch('/api/me/profile').send({ subjectIds: [id(d.bio)] })).status).toBe(422); // unknown key rejected
    r = await a.patch('/api/me/profile').send({ region: 'Volta', schoolName: 'Sample Academy (Sample)' });
    expect(r.body.profile.region).toBe('Volta'); expect(String(r.body.profile.schoolId)).toBe(id(d.school));
    const p = (await a.get('/api/me/profile')).body.profile; expect(p.subjectIds.map((s: any) => s.name).sort()).toEqual(['Economics', 'English Language', 'Social Studies']);
  });
  it('non-students cannot onboard or edit a learner profile', async () => {
    const { loginAs } = await import('./setup.js');
    const t = await loginAs('teacher@sample.ghlearn.test'); const d = ctx.data;
    expect((await t.post('/api/onboarding').send({ ...base(), coreSubjectIds: [id(d.core[0])] })).status).toBe(403);
    expect((await t.patch('/api/me/profile').send({ region: 'Volta' })).status).toBe(403);
  });
  it('region is an analytics filter (super and school admin), refused for content-only scope', async () => {
    const { loginAs } = await import('./setup.js');
    const sup = await loginAs('super@sample.ghlearn.test');
    const r = await sup.get('/api/analytics?region=Ashanti'); expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.enrolment.students).toBe(1); expect(r.body.enrolment.byRegion).toEqual([{ region: 'Ashanti', students: 1 }]);
    const all = (await sup.get('/api/analytics')).body.enrolment.byRegion; expect(all.find((x: any) => x.region === 'Greater Accra').students).toBe(2);
    expect((await sup.get('/api/analytics?region=Brong%20Ahafo')).status).toBe(422);
    expect((await sup.get('/api/analytics/filters')).body.regions).toHaveLength(16);
    const adm = await loginAs('admin@sample.ghlearn.test');
    const s = (await adm.get('/api/analytics?region=Volta')).body; expect(s.filters.schoolId).toBe(id(ctx.data.school)); expect(s.enrolment.students).toBe(1); // s4 moved to Volta + linked
    const { User } = await import('../src/models/index.js'); const { hashPassword } = await import('../src/services/auth.js');
    await User.create({ email: 'rev@t.gh', fullName: 'Reviewer', roles: ['content_reviewer'], passwordHash: await hashPassword('SamplePass2026') });
    expect((await (await loginAs('rev@t.gh')).get('/api/analytics?region=Volta')).status).toBe(403);
  });
});
