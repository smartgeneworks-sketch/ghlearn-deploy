import { describe, it, expect } from 'vitest';
import { useDb, ctx, loginAs, anon } from './setup.js';
import { AuditLog, Subject } from '../src/models/index.js';

useDb();
describe('subject search aliases', () => {
  it('curriculum admins set aliases through the audited PATCH; public search finds the subject by alias; non-admins cannot', async () => {
    const id = String(ctx.data.emath._id);
    expect((await (await loginAs('teacher@sample.ghlearn.test')).patch(`/api/config/subjects/${id}`).send({ aliases: ['X'] })).status).toBe(403);
    const sup = await loginAs('super@sample.ghlearn.test');
    const r = await sup.patch(`/api/config/subjects/${id}`).send({ aliases: [' Further Maths ', 'Further Maths', 'Pure Mathematics'] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await Subject.findById(id).lean())!.provenance!.aliases).toEqual(['Further Maths', 'Pure Mathematics']);
    expect(await AuditLog.countDocuments({ action: 'subjects.update', target: id })).toBeGreaterThan(0);
    const s = await (await anon()).get('/api/public/search?q=pure%20math');
    expect(s.status).toBe(200); expect(JSON.stringify(s.body)).toContain(id);
    expect((await sup.patch(`/api/config/subjects/${id}`).send({ aliases: ['a'.repeat(81)] })).status).toBe(422);
  });
});
