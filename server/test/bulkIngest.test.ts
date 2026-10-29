import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { useDb, ctx, loginAs } from './setup.js';
import { drain } from '../src/services/queue.js';
import { AiUsage, AuditLog, Chunk, CurriculumDocument, Job } from '../src/models/index.js';
import { bulkTick, type BulkPayload } from '../src/services/ingest/bulk.js';
import { retrieve } from '../src/services/retrieval.js';
import { today } from '../src/services/usage.js';
import { buildPdf } from './fixtures.js';
useDb();
const id = (x: any) => String(x._id);
const manual = (tag: string) => buildPdf(Array.from({ length: 3 }, (_, p) => ({ lines: [`SAMPLE ${tag} - NOT OFFICIAL`, `STRAND ${p + 1}: Photosynthesis part ${p + 1} for ${tag}`,
  ...Array.from({ length: 30 }, (_, i) => `Page ${p + 1} line ${i}: green plants use light energy to make glucose in sentence ${i} of ${tag}.`)] })));
async function upload(tag: string, process = false) {
  const ed = await loginAs('editor@sample.ghlearn.test');
  const r = await ed.post('/api/documents/upload').field('subjectId', id(ctx.data.bio)).field('title', `SAMPLE bulk ${tag}`).attach('file', manual(tag), `${tag}.pdf`);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  if (!process) { await Job.deleteOne({ _id: r.body.jobId }); await CurriculumDocument.updateOne({ _id: r.body.document._id }, { processingStatus: 'not_processed' }); }
  return r.body.document._id as string;
}

describe('compact vectors', () => {
  it('stores embeddings as float32 BSON vectors and the cosine fallback still retrieves them', async () => {
    const docId = await upload('vec', true); await drain();
    const raw: any = await mongoose.connection.db!.collection('chunks').findOne({ documentId: new mongoose.Types.ObjectId(docId) });
    expect(raw.embedding).toBeInstanceOf(mongoose.mongo.Binary); expect(raw.embedding.sub_type).toBe(9);
    expect(raw.embedding.toFloat32Array().length).toBe(64);
    await CurriculumDocument.updateOne({ _id: docId }, { mappingStatus: 'confirmed' });
    const sup: any = await mongoose.model('User').findOne({ email: 'super@sample.ghlearn.test' }).lean();
    const ps = await retrieve({ userId: id(sup), roles: sup.roles } as any, { subjectId: id(ctx.data.bio), query: 'green plants light energy glucose' });
    expect(ps.length).toBeGreaterThan(0); expect(ps[0].documentId).toBe(docId);
  });
});

describe('reviewer note and flags', () => {
  it('only reviewers set approvalNote/reviewFlags; recorded as document.approval in the audit log', async () => {
    const docId = await upload('note');
    const ed = await loginAs('editor@sample.ghlearn.test');
    expect((await ed.patch(`/api/documents/${docId}`).send({ approvalNote: 'x' })).status).toBe(403);
    expect((await ed.patch(`/api/documents/${docId}`).send({ reviewFlags: ['needs_ocr'] })).status).toBe(403);
    const sup = await loginAs('super@sample.ghlearn.test');
    expect((await sup.patch(`/api/documents/${docId}`).send({ reviewFlags: ['Bad Flag'] })).status).toBe(422);
    const r = await sup.patch(`/api/documents/${docId}`).send({ approvalStatus: 'verified_official', approvalNote: 'automated check: opens, text layer, metadata', reviewFlags: [] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.document).toMatchObject({ approvalStatus: 'verified_official', approvalNote: 'automated check: opens, text layer, metadata', reviewFlags: [] });
    const f = await sup.patch(`/api/documents/${docId}`).send({ approvalStatus: 'unverified', reviewFlags: ['teacher_version', 'teacher_version'], approvalNote: 'flagged' });
    expect(f.body.document.reviewFlags).toEqual(['teacher_version']);
    expect((await sup.get('/api/documents?reviewFlag=teacher_version')).body.items.map((d: any) => d._id)).toEqual([docId]);
    const a = await AuditLog.find({ action: 'document.approval', targetId: docId }).lean();
    expect(a.length).toBe(2);
  });
});

describe('bulk processing', () => {
  const payload = (ids: string[], o: Partial<BulkPayload> = {}): BulkPayload => ({ runId: 'r1', documentIds: ids, dailyEmbedRequests: 100, maxInFlight: 1, maxTries: 2, monthCostShare: 0.9, tries: {}, startedAt: new Date().toISOString(), ...o });
  it('queues within the in-flight window, skips indexed manuals, chains its next tick, and finishes', async () => {
    const ids = [await upload('b1'), await upload('b2'), await upload('b3')];
    const p = payload(ids);
    const t1 = await bulkTick(p);
    expect(t1.queuedNow).toHaveLength(1); expect(t1.finished).toBe(false);
    expect(await Job.countDocuments({ type: 'ingest.bulk', status: 'queued' })).toBe(1);
    // A second tick while the first manual is still queued does not queue more (window = 1) nor chain twice.
    const t2 = await bulkTick(p); expect(t2.queuedNow).toHaveLength(0);
    expect(await Job.countDocuments({ type: 'ingest.bulk', status: 'queued' })).toBe(1);
    await Job.deleteMany({ type: 'ingest.bulk' });
    let last: any; for (let i = 0; i < 10 && !(last?.finished); i++) { await drain(5); await Job.deleteMany({ type: 'ingest.bulk' }); last = await bulkTick(p); }
    expect(last.finished).toBe(true); expect(last.indexed).toBe(3); expect(Object.values(p.tries)).toEqual([1, 1, 1]);
    expect(await Job.countDocuments({ type: 'ingest.bulk', status: 'queued' })).toBe(0);
    // Idempotent: re-running over indexed manuals queues nothing.
    const again = await bulkTick(payload(ids)); expect(again.queuedNow).toEqual([]); expect(again.finished).toBe(true);
  });
  it('pauses at the daily embedding budget and the monthly cost cap', async () => {
    const ids = [await upload('d1')];
    await AiUsage.create(Array.from({ length: 3 }, () => ({ day: today(), purpose: 'embedding.index', status: 'ok', chars: 1000 })) as any);
    const t = await bulkTick(payload(ids, { dailyEmbedRequests: 3 }));
    expect(t.paused).toMatch(/daily embedding budget/); expect(t.queuedNow).toEqual([]);
    const next = await Job.findOne({ type: 'ingest.bulk', status: 'queued' }).lean();
    expect(next!.runAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000 + 1000);
    await Job.deleteMany({ type: 'ingest.bulk' });
    await AiUsage.create({ day: today(), purpose: 'embedding.index', status: 'ok', chars: 4e9 }); // ~$150 estimated
    const c = await bulkTick(payload(ids, { dailyEmbedRequests: 1000 }));
    expect(c.paused).toMatch(/monthly cap/);
    await AiUsage.deleteMany({});
    const h = new Date().getUTCHours();
    const q = await bulkTick(payload(ids, { activeHoursUtc: [(h + 1) % 24, (h + 2) % 24] }));
    expect(q.paused).toMatch(/outside the active hours/); expect(q.queuedNow).toEqual([]);
    const ok = await bulkTick(payload(ids, { activeHoursUtc: [h, h + 1], throttleMs: 5 }));
    expect(ok.queuedNow).toEqual(ids);
    expect((await Job.findOne({ type: 'document.process', 'payload.documentId': ids[0] }).lean())!.payload).toMatchObject({ throttleMs: 5 });
  });
  it('API: starts one run at a time (audited), reports status, cancels', async () => {
    await Job.deleteMany({ type: 'ingest.bulk' });
    const ids = [await upload('a1'), await upload('a2')];
    const stu = await loginAs('ama@sample.ghlearn.test');
    expect((await stu.post('/api/documents/bulk-process').send({ documentIds: ids })).status).toBe(403);
    const sup = await loginAs('super@sample.ghlearn.test');
    const r = await sup.post('/api/documents/bulk-process').send({ documentIds: ids, dailyEmbedRequests: 500 });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect((await sup.post('/api/documents/bulk-process').send({ documentIds: ids })).status).toBe(409);
    const g = await sup.get('/api/documents/bulk-process'); expect(g.status, JSON.stringify(g.body)).toBe(200); const s = g.body.run;
    expect(s).toMatchObject({ runId: r.body.runId, settings: { dailyEmbedRequests: 500 }, now: { total: 2, pending: 2 } });
    expect(await AuditLog.exists({ action: 'document.bulk_process' })).toBeTruthy();
    expect((await sup.post('/api/documents/bulk-process/cancel')).body.cancelledTicks).toBe(1);
  });
});
