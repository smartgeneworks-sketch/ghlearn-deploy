import { describe, it, expect } from 'vitest';
import { useDb, ctx } from './setup.js';
import { Subject, CurriculumDocument } from '../src/models/index.js';
import { unflagRealSubjects } from '../src/services/migrations.js';
useDb();
describe('subjects with real curriculum documents are not sample', () => {
  it('clears isSample only where real documents exist; idempotent', async () => {
    const bio = ctx.data.bio as any; await Subject.updateOne({ _id: bio._id }, { isSample: true });
    const other = await Subject.create({ name: 'Only sample', code: 'ONLY-S', category: 'core', isSample: true } as any).catch(async () => (await Subject.findOne({ isSample: true, _id: { $ne: bio._id } }))!);
    await CurriculumDocument.create({ title: 'Real manual', subjectId: bio._id, storage: { provider: 'remote' } });
    await CurriculumDocument.create({ title: 'Sample manual', subjectId: other._id, isSample: true, storage: { provider: 'remote' } });
    expect(await unflagRealSubjects()).toBeGreaterThanOrEqual(1);
    expect((await Subject.findById(bio._id).lean())!.isSample).toBeFalsy();
    expect((await Subject.findById(other._id).lean())!.isSample).toBe(true);
    expect(await unflagRealSubjects()).toBe(0);
  });
});
