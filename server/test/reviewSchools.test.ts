import { describe, it, expect, afterEach } from 'vitest';
import { useDb, loginAs, anon } from './setup.js';
import { School } from '../src/models/index.js';
useDb();
afterEach(() => { delete process.env.HIDE_SAMPLE_PUBLIC; });
describe('teacher application review: school list', () => {
  it('the public form hides sample schools, but a super admin reviewing can still pick them; a school admin sees only their own', async () => {
    process.env.HIDE_SAMPLE_PUBLIC = '1';
    const sample = await School.findOne({ isSample: true }).lean();
    expect(sample).toBeTruthy();
    const pub = (await (await anon()).get('/api/public/teacher-applications/options')).body.schools.map((s: any) => s.id);
    expect(pub).not.toContain(String(sample!._id));
    const su = await loginAs('super@sample.ghlearn.test');
    const r = await su.get('/api/admin/teacher-applications/schools');
    expect(r.status).toBe(200); expect(r.body.items.map((s: any) => s.id)).toContain(String(sample!._id));
    const sa = await loginAs('admin@sample.ghlearn.test');
    const mine = (await sa.get('/api/admin/teacher-applications/schools')).body.items;
    expect(mine.length).toBe(1);
    const stu = await loginAs('ama@sample.ghlearn.test'); expect((await stu.get('/api/admin/teacher-applications/schools')).status).toBe(403);
  });
});
