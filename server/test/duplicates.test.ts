import { describe, it, expect } from 'vitest';
import { useDb, loginAs } from './setup.js';
import { CurriculumDocument, AuditLog } from '../src/models/index.js';
useDb();
const mk = (title: string, sha: string, x: Record<string, unknown> = {}) =>
  CurriculumDocument.create({ title, provenance: { checksum: sha, sourceUrl: `https://example.test/${title}.pdf` }, storage: { provider: 'remote' }, sizeBytes: 1000, ...x });

describe('byte-identical duplicates: one canonical copy, audited, nothing deleted', () => {
  it('dry run reports, the real run repairs and audits, a second run changes nothing', async () => {
    const a = await mk('A original', 'aa'); const a2 = await mk('A copy', 'aa', { duplicateOf: a._id }); const a3 = await mk('A unmarked copy', 'aa');
    const b = await mk('B indexed', 'bb', { processingStatus: 'indexed', duplicateOf: undefined });
    const b2 = await mk('B older but unprocessed', 'bb', { createdAt: new Date('2020-01-01') });
    const lone = await mk('Lone wrongly marked', 'cc', { duplicateOf: a._id });
    const c = await mk('C chain target', 'dd'); const c2 = await mk('C copy', 'dd', { duplicateOf: c._id }); const c3 = await mk('C chained', 'dd', { duplicateOf: c2._id });
    const before = await CurriculumDocument.countDocuments();
    const ed = await loginAs('editor@sample.ghlearn.test');
    expect((await ed.post('/api/documents/duplicates/reconcile').send({ dryRun: true })).status).toBe(403);
    const su = await loginAs('super@sample.ghlearn.test');
    const dry = await su.post('/api/documents/duplicates/reconcile').send({ dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, groupsWithCopies: 3, copies: 5, copyBytes: 5000, gridfs: { reclaimableBytes: 0 } });
    const ch = Object.fromEntries(dry.body.changes.map((x: any) => [x.title, x.to]));
    expect(ch).toEqual({ 'A unmarked copy': String(a._id), 'B older but unprocessed': String(b._id), 'Lone wrongly marked': null, 'C chained': String(c._id) });
    expect(await CurriculumDocument.countDocuments({ duplicateOf: { $ne: null } })).toBe(4); // dry run wrote nothing
    expect(await AuditLog.countDocuments({ action: 'document.duplicates_reconcile' })).toBe(0);
    const run = await su.post('/api/documents/duplicates/reconcile').send({ dryRun: false });
    expect(run.body.changesTotal).toBe(4);
    const get = async (d: any) => (await CurriculumDocument.findById(d._id).lean())!.duplicateOf;
    expect(String(await get(a3))).toBe(String(a._id)); expect(String(await get(b2))).toBe(String(b._id)); expect(String(await get(c3))).toBe(String(c._id));
    expect(await get(lone)).toBeFalsy(); expect(await get(a)).toBeFalsy(); expect(await get(b)).toBeFalsy(); expect(String(await get(a2))).toBe(String(a._id));
    expect(await CurriculumDocument.countDocuments()).toBe(before); // nothing deleted
    const log: any = await AuditLog.findOne({ action: 'document.duplicates_reconcile' }).lean();
    expect(log.meta).toMatchObject({ copies: 5, changed: 4 });
    expect((await su.post('/api/documents/duplicates/reconcile').send({ dryRun: false })).body.changesTotal).toBe(0);
    // copies stay out of the default library list
    const list = await su.get('/api/documents?limit=100');
    const titles = list.body.items.map((x: any) => x.title);
    expect(titles).toContain('A original'); expect(titles).not.toContain('A copy'); expect(titles).not.toContain('C chained');
  });
});
