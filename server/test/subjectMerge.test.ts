import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { useDb, ctx, loginAs } from './setup.js';
import { Subject, StudentProfile, TeacherAssignment, AuditLog, User } from '../src/models/index.js';
import { subjectRefPaths } from '../src/services/subjectMerge.js';
useDb();
const id = (x: any) => String(x._id);

describe('subject merge (retire a subject into another)', () => {
  it('finds every Subject reference from the schemas', () => {
    const paths = subjectRefPaths().map((r) => `${r.model.modelName}.${r.path}`);
    for (const p of ['StudentProfile.subjectIds', 'TeacherAssignment.subjectId', 'CurriculumDocument.subjectId', 'Chunk.subjectId', 'Lesson.subjectId', 'TutorConversation.subjectId', 'SubjectCombination.subjectIds'])
      expect(paths).toContain(p);
  });
  it('super admin only; dry run changes nothing; merge moves enrolments and assignments, archives the source, audited', async () => {
    const lvl = ctx.data.bio.levelId;
    const old = await Subject.create({ name: 'Integrated Science', code: 'ISCI', levelId: lvl, category: 'core' });
    const gs = await Subject.findOne({ code: 'S-GENSCI' });
    expect(gs).toBeTruthy();
    const kofi = await User.findOne({ email: 'kofi@sample.ghlearn.test' });
    const ama = await User.findOne({ email: 'ama@sample.ghlearn.test' });
    // kofi: old only; ama: both (must not end up with General Science twice)
    await StudentProfile.updateOne({ userId: kofi!._id }, { $pull: { subjectIds: gs!._id } }); await StudentProfile.updateOne({ userId: kofi!._id }, { $push: { subjectIds: old._id } });
    await StudentProfile.updateOne({ userId: ama!._id }, { $addToSet: { subjectIds: { $each: [old._id, gs!._id] } } });
    const teacher = await User.findOne({ email: 'teacher@sample.ghlearn.test' });
    await TeacherAssignment.create({ teacherId: teacher!._id, schoolId: teacher!.schoolId, subjectId: old._id, classGroup: 'SHS1 A', yearOfStudy: 1 } as any);

    const ed = await loginAs('curriculum@sample.ghlearn.test');
    expect((await ed.post(`/api/config/subjects/${id(old)}/merge`).send({ targetId: id(gs) })).status).toBe(403);
    const sup = await loginAs('super@sample.ghlearn.test');
    const dry = await sup.post(`/api/config/subjects/${id(old)}/merge`).send({ targetId: id(gs), dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.references.find((r: any) => r.collection === 'studentprofiles').count).toBe(2);
    expect((await Subject.findById(old._id))!.archivedAt).toBeFalsy();

    const other = await Subject.create({ name: 'Elsewhere', code: 'ZZOTHER', levelId: new mongoose.Types.ObjectId(), category: 'core' });
    expect((await sup.post(`/api/config/subjects/${id(old)}/merge`).send({ targetId: id(other) })).status).toBe(422);

    const r = await sup.post(`/api/config/subjects/${id(old)}/merge`).send({ targetId: id(gs) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.remaining).toEqual([]);
    const k = await StudentProfile.findOne({ userId: kofi!._id }).lean(); const a = await StudentProfile.findOne({ userId: ama!._id }).lean();
    expect(k!.subjectIds.map(String)).toContain(id(gs)); expect(k!.subjectIds.map(String)).not.toContain(id(old));
    expect(a!.subjectIds.map(String).filter((x) => x === id(gs))).toHaveLength(1);
    expect(await TeacherAssignment.countDocuments({ subjectId: gs!._id })).toBeGreaterThan(0);
    const s = await Subject.findById(old._id).lean();
    expect(s!.archivedAt).toBeTruthy(); expect(s!.active).toBe(false);
    expect(await AuditLog.exists({ action: 'subjects.merge', targetId: id(old) })).toBeTruthy();
    // Gone from pickers and the public catalog
    expect((await sup.get('/api/config/subjects')).body.map?.((x: any) => x.code) ?? (await sup.get('/api/config/subjects')).body.items.map((x: any) => x.code)).not.toContain('ISCI');
    const pub = await (await loginAs('kofi@sample.ghlearn.test')).get('/api/public/subjects');
    expect(pub.body.items.map((x: any) => x.code)).not.toContain('ISCI');
    expect((await sup.post(`/api/config/subjects/${id(old)}/merge`).send({ targetId: id(gs) })).status).toBe(200); // re-run is harmless
  });
});
