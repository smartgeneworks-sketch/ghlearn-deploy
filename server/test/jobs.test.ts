import { describe, it, expect, beforeAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { useDb, ctx, loginAs, anon } from './setup.js';
import { drain } from '../src/services/queue.js';
import { Job, Chunk, DocumentPage, CurriculumDocument, AuditLog } from '../src/models/index.js';
import { migrateProcessingMonitor } from '../src/services/migrations.js';
import { buildPdf } from './fixtures.js';
import { fromStoredVector } from '../src/lib/vector.js';
useDb();
const id = (x: any) => String(x._id);
const manual = (tag: string) => buildPdf(Array.from({ length: 4 }, (_, p) => ({ lines: [`SAMPLE ${tag} - NOT OFFICIAL`, `STRAND ${p + 1}: Topic ${p + 1} for ${tag}`,
  ...Array.from({ length: 40 }, (_, i) => `Page ${p + 1} line ${i}: cells, tissues and organs are described here in sentence ${i} of ${tag}.`)] })));
async function upload(tag: string) {
  const ed = await loginAs('editor@sample.ghlearn.test');
  const r = await ed.post('/api/documents/upload').field('subjectId', id(ctx.data.bio)).field('title', `SAMPLE monitor ${tag}`).attach('file', manual(tag), `${tag}.pdf`);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { docId: r.body.document._id as string, jobId: r.body.jobId as string };
}
const stored = async (docId: string) => {
  const chunks = await Chunk.find({ documentId: docId }).select('+embedding ordinal embeddingStatus').lean();
  return { pages: await DocumentPage.countDocuments({ documentId: docId }), chunks: chunks.length, ordinals: new Set(chunks.map((c) => c.ordinal)).size,
    embedded: chunks.filter((c: any) => fromStoredVector(c.embedding)?.length).length };
};

describe('processing monitor: access (spec §4/§10)', () => {
  it('system operators and curriculum admins can view; purge is operator-only; everyone else is denied', async () => {
    const { jobId } = await upload('access');
    for (const email of ['operator@sample.ghlearn.test', 'curriculum@sample.ghlearn.test', 'super@sample.ghlearn.test']) {
      const a = await loginAs(email);
      expect((await a.get('/api/jobs')).status, email).toBe(200);
      expect((await a.get('/api/jobs/health')).status, email).toBe(200);
      expect((await a.get(`/api/jobs/${jobId}`)).status, email).toBe(200);
    }
    expect((await (await loginAs('operator@sample.ghlearn.test')).post('/api/jobs/purge').send({ olderThanDays: 30 })).status).toBe(200);
    expect((await (await loginAs('curriculum@sample.ghlearn.test')).post('/api/jobs/purge').send({ olderThanDays: 30 })).status).toBe(403);
    for (const email of ['editor@sample.ghlearn.test', 'teacher@sample.ghlearn.test', 'ama@sample.ghlearn.test', 'admin@sample.ghlearn.test', 'counselor@sample.ghlearn.test']) {
      const a = await loginAs(email);
      for (const [m, p] of [['get', '/api/jobs'], ['get', '/api/jobs/health'], ['get', `/api/jobs/${jobId}`], ['post', `/api/jobs/${jobId}/retry`], ['post', `/api/jobs/${jobId}/cancel`], ['post', '/api/jobs/purge']] as const)
        expect((await (a as any)[m](p).send(m === 'post' ? {} : undefined)).status, `${email} ${m} ${p}`).toBe(403);
    }
    expect((await (await anon()).get('/api/jobs')).status).toBe(401);
    await drain();
  });
});

describe('processing monitor: statuses, progress and the failed-job inspector', () => {
  it('maps real pipeline stages to the §10 statuses; progress only when measured', async () => {
    const { docId, jobId } = await upload('stages');
    const op = await loginAs('operator@sample.ghlearn.test');
    const row = async () => (await op.get(`/api/jobs?documentId=${docId}`)).body.items[0];
    expect(await row()).toMatchObject({ id: jobId, status: 'queued', label: 'Queued', progress: null, uploader: 'Curriculum Editor (Sample)', document: { title: 'SAMPLE monitor stages', subject: expect.stringMatching(/Biology/) } });
    // a running job: only stages that count work report progress
    const cases: [any, string, any][] = [
      [{ step: 'extracting', current: 2, total: 4, unit: 'pages' }, 'extracting', { current: 2, total: 4, unit: 'pages' }],
      [{ step: 'ocr', current: 1, total: 3, unit: 'pages' }, 'ocr', { current: 1, total: 3, unit: 'pages' }],
      [{ step: 'structuring' }, 'mapping', null], [{ step: 'chunking' }, 'indexing', null],
      [{ step: 'embedding', current: 50, total: 120, unit: 'passages' }, 'indexing', { current: 50, total: 120, unit: 'passages' }]];
    for (const [progress, status, measured] of cases) {
      await Job.updateOne({ _id: jobId }, { status: 'running', progress, lockedUntil: new Date(Date.now() + 60_000) });
      const r = await row(); expect(r.status, progress.step).toBe(status); expect(r.progress).toEqual(measured);
    }
    expect((await op.get(`/api/jobs?status=mapping`)).body.items.map((x: any) => x.id)).not.toContain(jobId);
    await Job.updateOne({ _id: jobId }, { status: 'queued', progress: {}, lockedUntil: null, attempts: 0 });
    await drain();
    const done = await row();
    expect(done).toMatchObject({ status: 'awaiting_validation', label: 'Awaiting validation', pagesProcessed: 4, stageStatus: { extraction: 'done', ocr: 'not_needed', indexing: 'test_only' }, retries: 0, error: null });
    expect(done.startedAt).toBeTruthy(); expect(done.finishedAt).toBeTruthy();
    const insp = (await op.get(`/api/jobs/${jobId}`)).body;
    expect(insp.job.stages.map((s: any) => s.stage)).toEqual(expect.arrayContaining(['queued', 'running', 'extracting', 'structuring', 'chunking', 'embedding', 'done']));
    // validation by people moves it to Completed
    await CurriculumDocument.updateOne({ _id: docId }, { approvalStatus: 'verified_official', mappingStatus: 'confirmed' });
    expect((await row()).status).toBe('completed');
    const counts = (await op.get('/api/jobs')).body.counts; expect(counts.completed).toBeGreaterThanOrEqual(1);
    expect((await op.get('/api/jobs?status=bogus')).status).toBe(422);
  });

  it('safe retry after a crash mid-write: no duplicate passages or embeddings, double retry refused', async () => {
    const { docId, jobId } = await upload('retry');
    await Job.updateOne({ _id: jobId }, { maxAttempts: 1 });
    const orig = Chunk.insertMany.bind(Chunk);
    const spy = vi.spyOn(Chunk, 'insertMany').mockImplementationOnce((async (docs: any[]) => { await orig(docs.slice(0, Math.ceil(docs.length / 2))); throw new Error('Simulated crash while writing passages'); }) as any);
    await drain(); spy.mockRestore();
    const partial = await stored(docId);
    expect(partial.chunks).toBeGreaterThan(0);
    // the unique (document, ordinal) index refuses a second copy of a stored passage
    const one: any = await Chunk.findOne({ documentId: docId }).lean();
    await expect(Chunk.collection.insertOne({ ...one, _id: new mongoose.Types.ObjectId() })).rejects.toThrow(/E11000/);

    const ca = await loginAs('curriculum@sample.ghlearn.test');
    const insp = (await ca.get(`/api/jobs/${jobId}`)).body;
    expect(insp.job).toMatchObject({ status: 'failed', label: 'Failed', failedStage: 'chunking', error: { message: 'Simulated crash while writing passages', stage: 'chunking' }, stageStatus: { extraction: 'done', indexing: 'failed' } });
    expect(insp.job.errorLog).toHaveLength(1); expect(insp.storedOutput.passages).toBe(partial.chunks);
    expect(insp.actions.retry).toEqual({ allowed: true, reason: null }); expect(insp.actions.cancel.allowed).toBe(false);
    expect((await CurriculumDocument.findById(docId).lean())!.processingStatus).toBe('failed');

    const r1 = await ca.post(`/api/jobs/${jobId}/retry`); expect(r1.status, JSON.stringify(r1.body)).toBe(202);
    const r2 = await ca.post(`/api/jobs/${jobId}/retry`); expect(r2.status).toBe(409);
    expect(r2.body.error?.message ?? JSON.stringify(r2.body)).toMatch(/newer processing run|queued or running/);
    const [r3a, r3b] = await Promise.all([ca.post(`/api/jobs/${r1.body.jobId}/retry`), ca.post(`/api/jobs/${r1.body.jobId}/retry`)]);
    expect([r3a.status, r3b.status]).toEqual([409, 409]); // not failed yet
    await drain();
    const after = await stored(docId);
    const newJob: any = await Job.findById(r1.body.jobId).lean();
    expect(newJob.status).toBe('succeeded'); expect(String(newJob.retryOf)).toBe(jobId);
    expect(after.chunks).toBe(newJob.result.chunks); expect(after.ordinals).toBe(after.chunks); expect(after.embedded).toBe(after.chunks); expect(after.pages).toBe(4);
    expect(after.chunks).toBeGreaterThan(partial.chunks);
    // retrying again via a normal reprocess gives exactly the same output (idempotent)
    const ed = await loginAs('editor@sample.ghlearn.test');
    expect((await ed.post(`/api/documents/${docId}/process`)).status).toBe(202); await drain();
    expect(await stored(docId)).toEqual(after);
    const list = (await ca.get(`/api/jobs?documentId=${docId}&sort=createdAt`)).body.items;
    expect(list.map((x: any) => x.status)).toEqual(['failed', 'completed', 'awaiting_validation']);
    expect(list[0].retries).toBe(1);
    expect((await ca.get(`/api/jobs/${r1.body.jobId}`)).body.retryChain.previous[0]).toMatchObject({ id: jobId, status: 'dead', error: 'Simulated crash while writing passages' });
    expect(await AuditLog.countDocuments({ action: 'job.retry', target: jobId })).toBe(1);
  });

  it('a superseded or re-claimed run stops before writing output (fence)', async () => {
    const { docId, jobId } = await upload('fence');
    await drain(); const before = await stored(docId);
    const ed = await loginAs('editor@sample.ghlearn.test');
    const j2 = (await ed.post(`/api/documents/${docId}/process`)).body.jobId;
    await CurriculumDocument.updateOne({ _id: docId }, { lastJobId: new mongoose.Types.ObjectId() }); // a newer run took over
    await drain();
    const j: any = await Job.findById(j2).lean();
    expect(j.status).toBe('dead'); expect(j.errorLog.at(-1).message).toMatch(/newer processing run/);
    expect(await stored(docId)).toEqual(before);
    expect(jobId).not.toBe(j2);
  });

  it('cancel: queued only; the manual returns to its real state; a cancelled job can be retried', async () => {
    const { docId } = await upload('cancel'); await drain();
    const ed = await loginAs('editor@sample.ghlearn.test'); const op = await loginAs('operator@sample.ghlearn.test');
    const j = (await ed.post(`/api/documents/${docId}/process`)).body.jobId;
    expect((await CurriculumDocument.findById(docId).lean())!.processingStatus).toBe('queued');
    const c = await op.post(`/api/jobs/${j}/cancel`); expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body).toEqual({ cancelled: true, documentStatus: 'indexed' });
    expect((await CurriculumDocument.findById(docId).lean())!.processingStatus).toBe('indexed');
    expect((await op.post(`/api/jobs/${j}/cancel`)).status).toBe(409);
    const row = (await op.get(`/api/jobs/${j}`)).body.job; expect(row).toMatchObject({ status: 'cancelled', label: 'Cancelled' });
    // running jobs are never interrupted
    const j3 = (await op.post(`/api/jobs/${j}/retry`)).body.jobId; expect(j3).toBeTruthy();
    await Job.updateOne({ _id: j3 }, { status: 'running', lockedUntil: new Date(Date.now() + 60_000) });
    const rc = await op.post(`/api/jobs/${j3}/cancel`); expect(rc.status).toBe(409); expect(JSON.stringify(rc.body)).toMatch(/not interrupted/);
    await Job.updateOne({ _id: j3 }, { status: 'queued', lockedUntil: null }); await drain();
    expect((await Job.findById(j3).lean())!.status).toBe('succeeded');
    // a queued job waiting after a failed attempt: the stored output may be partial, so the manual is marked failed
    const j4 = (await ed.post(`/api/documents/${docId}/process`)).body.jobId;
    await Job.updateOne({ _id: j4 }, { attempts: 1, runAt: new Date(Date.now() + 600_000), $push: { errorLog: { at: new Date(), attempt: 1, message: 'Embedding provider unavailable', stage: 'embedding' } } });
    expect((await op.get(`/api/jobs/${j4}`)).body.job).toMatchObject({ status: 'queued', waitingForRetry: true });
    expect((await op.post(`/api/jobs/${j4}/cancel`)).body.documentStatus).toBe('failed');
    expect((await CurriculumDocument.findById(docId).lean())!.processingReport).toMatchObject({ error: expect.stringMatching(/Cancelled after a failed attempt: Embedding provider unavailable/) });
  });

  it('purge removes old finished jobs but never a manual\'s current job; dry run first', async () => {
    const { docId, jobId } = await upload('purge'); await drain();
    const old = new Date(Date.now() - 40 * 86400_000);
    const extra = await Job.insertMany([{ type: 'document.process', status: 'succeeded', finishedAt: old, documentId: docId, payload: { documentId: docId } },
      { type: 'document.process', status: 'dead', finishedAt: old, documentId: docId, payload: { documentId: docId } },
      { type: 'document.process', status: 'succeeded', finishedAt: new Date(), documentId: docId, payload: { documentId: docId } }]);
    await Job.updateOne({ _id: jobId }, { finishedAt: old });
    const op = await loginAs('operator@sample.ghlearn.test');
    expect((await op.post('/api/jobs/purge').send({ olderThanDays: 0 })).status).toBe(422);
    const dry = (await op.post('/api/jobs/purge').send({ olderThanDays: 30 })).body;
    expect(dry).toMatchObject({ dryRun: true, deleted: 0 }); expect(dry.matched).toBeGreaterThanOrEqual(2);
    expect(await Job.countDocuments({ _id: { $in: extra.map((e) => e._id) } })).toBe(3);
    const real = (await op.post('/api/jobs/purge').send({ olderThanDays: 30, dryRun: false })).body;
    expect(real.deleted).toBe(dry.matched);
    expect(await Job.exists({ _id: jobId })).toBeTruthy(); // current job kept although old
    expect(await Job.countDocuments({ _id: { $in: extra.map((e) => e._id) } })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'jobs.purge' })).toBe(1);
  });

  it('health reports real queue, worker and provider state', async () => {
    const h = (await (await loginAs('operator@sample.ghlearn.test')).get('/api/jobs/health')).body;
    expect(h.db.ok).toBe(true); expect(h.worker.enabled).toBe(false);
    expect(h.warnings.join()).toMatch(/worker is not running/); expect(h.warnings.join()).toMatch(/OCR is not configured/);
    expect(h.providers.embeddings).toMatch(/TEST ONLY/); expect(h.storage.quotaMb).toBeGreaterThan(0); expect(h.counts).toHaveProperty('awaiting_validation');
  });

  it('migration removes legacy duplicate passages, then builds the unique index', async () => {
    await Chunk.collection.dropIndex('documentId_1_ordinal_1');
    const one: any = await Chunk.findOne().lean();
    await Chunk.collection.insertOne({ ...one, _id: new mongoose.Types.ObjectId() });
    const r = await migrateProcessingMonitor(); expect(r.removed).toBe(1);
    expect(await Chunk.collection.indexExists('documentId_1_ordinal_1')).toBe(true);
    expect(await Chunk.countDocuments({ documentId: one.documentId, ordinal: one.ordinal })).toBe(1);
  });
});
