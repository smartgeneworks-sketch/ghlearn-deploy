/**
 * Document Processing Monitor (spec §10). Maps the real queue + pipeline state of `document.process` jobs to the
 * §10 status set. Nothing here is estimated: progress is only reported where the pipeline counts work
 * (pages extracted, pages OCR'd, passages embedded); every other stage is indeterminate.
 */
import mongoose from 'mongoose';
import { Job, CurriculumDocument, Lesson, Chunk, DocumentPage, Subject, User } from '../models/index.js';
import { AppError, notFound } from '../lib/errors.js';
import { enqueue, worker } from './queue.js';
import { gridfs } from './storage.js';
import { aiStatus } from './ai.js';
import { config } from '../config.js';

export const MONITOR_STATUSES = ['queued', 'extracting', 'ocr', 'mapping', 'indexing', 'awaiting_validation', 'completed', 'failed', 'cancelled'] as const;
export type MonitorStatus = typeof MONITOR_STATUSES[number];
export const MONITOR_LABELS: Record<MonitorStatus, string> = {
  queued: 'Queued', extracting: 'Extracting', ocr: 'OCR processing', mapping: 'Mapping curriculum', indexing: 'Indexing',
  awaiting_validation: 'Awaiting validation', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
};
/** Pipeline step (Job.progress.step / processingStatus) -> §10 stage. */
export const STEP_STAGE: Record<string, MonitorStatus> = { running: 'extracting', extracting: 'extracting', ocr: 'ocr', structuring: 'mapping', chunking: 'indexing', embedding: 'indexing' };
const TYPE = 'document.process';

/** Aggregation stages that join the manual and compute the §10 status (`mstatus`). */
function joinAndClassify() {
  return [
    { $lookup: { from: CurriculumDocument.collection.name, localField: 'documentId', foreignField: '_id', as: 'doc',
      pipeline: [{ $project: { title: 1, subjectId: 1, uploadedBy: 1, approvalStatus: 1, mappingStatus: 1, lastJobId: 1, processingStatus: 1, ocrStatus: 1, pageCount: 1, pageUnit: 1, archivedAt: 1, supersededBy: 1, duplicateOf: 1 } }] } },
    { $set: { doc: { $first: '$doc' } } },
    { $set: { isLatest: { $eq: ['$doc.lastJobId', '$_id'] },
      validated: { $and: [{ $in: ['$doc.approvalStatus', ['verified_official', 'rejected']] }, { $eq: ['$doc.mappingStatus', 'confirmed'] }] } } },
    { $set: { mstatus: { $switch: { branches: [
      { case: { $eq: ['$status', 'queued'] }, then: 'queued' },
      { case: { $eq: ['$status', 'running'] }, then: { $switch: { branches: [
        { case: { $eq: ['$progress.step', 'ocr'] }, then: 'ocr' },
        { case: { $eq: ['$progress.step', 'structuring'] }, then: 'mapping' },
        { case: { $in: ['$progress.step', ['chunking', 'embedding']] }, then: 'indexing' }], default: 'extracting' } } },
      // A finished run waits for validation only while it is the manual's current output and a person has not yet confirmed mapping and approval.
      { case: { $eq: ['$status', 'succeeded'] }, then: { $cond: [{ $and: ['$isLatest', { $not: ['$validated'] }] }, 'awaiting_validation', 'completed'] } },
      { case: { $in: ['$status', ['dead', 'failed']] }, then: 'failed' },
      { case: { $eq: ['$status', 'cancelled'] }, then: 'cancelled' }], default: 'queued' } } } },
  ];
}

export const listQuerySchema = (z: typeof import('zod').z) => z.object({
  page: z.coerce.number().int().min(1).max(10_000).prefault(1), pageSize: z.coerce.number().int().min(1).max(100).prefault(25),
  status: z.enum(MONITOR_STATUSES).optional(), subjectId: z.string().regex(/^[a-f0-9]{24}$/).optional(), documentId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  q: z.string().trim().max(120).optional(), from: z.coerce.date().optional(), retries: z.enum(['only']).optional(),
  // a date-only `to` includes that whole day
  to: z.string().max(40).transform((v) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999Z` : v)).refine((d) => !Number.isNaN(d.getTime()), 'Invalid date').optional(),
  sort: z.enum(['-createdAt', 'createdAt', '-finishedAt', 'finishedAt', '-attempts', 'attempts']).prefault('-createdAt'),
}).strict();

type Row = any;
async function decorate(rows: Row[]) {
  const subjIds = [...new Set(rows.map((r) => r.doc?.subjectId).filter(Boolean).map(String))];
  const userIds = [...new Set(rows.flatMap((r) => [r.doc?.uploadedBy, r.createdBy]).filter(Boolean).map(String))];
  const [subs, users, retried] = await Promise.all([
    Subject.find({ _id: { $in: subjIds } }, { name: 1, code: 1 }).lean(), User.find({ _id: { $in: userIds } }, { fullName: 1 }).lean(),
    Job.aggregate([{ $match: { retryOf: { $in: rows.map((r) => r._id) } } }, { $group: { _id: '$retryOf', n: { $sum: 1 } } }]),
  ]);
  const sName = new Map(subs.map((s: any) => [String(s._id), `${s.name}${s.code ? ` (${s.code})` : ''}`]));
  const uName = new Map(users.map((u: any) => [String(u._id), u.fullName]));
  const retriedBy = new Map(retried.map((r: any) => [String(r._id), r.n]));
  return rows.map((r) => shapeRow(r, sName, uName, retriedBy));
}

/** Per-stage status for the row: what really happened, from the job's stage timeline and its result. */
function stageStatus(r: Row) {
  const order = ['extracting', 'ocr', 'structuring', 'chunking', 'embedding'];
  const seen = new Set<string>((r.stages ?? []).map((s: any) => s.stage));
  const failedAt = ['dead', 'failed'].includes(r.status) ? r.failedStage : null;
  const cur = r.status === 'running' ? r.progress?.step : null;
  const res = r.status === 'succeeded' ? r.result ?? {} : null;
  const extraction = res ? 'done' : failedAt && STEP_STAGE[failedAt] === 'extracting' ? 'failed' : cur && STEP_STAGE[cur] === 'extracting' ? 'running'
    : [...seen].some((s) => order.indexOf(s) > 0) ? 'done' : r.status === 'cancelled' ? 'cancelled' : 'pending';
  const ocr = res ? (res.ocrStatus ?? (r.isLatest ? r.doc?.ocrStatus : null) ?? 'unknown') : failedAt === 'ocr' ? 'failed' : cur === 'ocr' ? 'running'
    : seen.has('ocr') ? 'done' : extraction === 'done' ? (r.isLatest ? r.doc?.ocrStatus ?? 'not_needed' : 'not_needed') : 'pending';
  const indexing = res ? (res.embedding === 'failed' ? 'embedding_failed' : res.embedding === 'disabled' ? 'text_only' : res.embedding === 'test_only' ? 'test_only' : 'done')
    : failedAt && STEP_STAGE[failedAt] === 'indexing' ? 'failed' : cur && STEP_STAGE[cur] === 'indexing' ? 'running' : r.status === 'cancelled' ? 'cancelled' : 'pending';
  return { extraction, ocr, indexing };
}
function shapeRow(r: Row, sName: Map<string, string>, uName: Map<string, string>, retriedBy: Map<string, number>) {
  const p = r.progress ?? {};
  const measured = r.status === 'running' && typeof p.current === 'number' && typeof p.total === 'number' && p.total > 0;
  const now = Date.now();
  const lastErr = r.errorLog?.at(-1);
  const uploader = r.doc?.uploadedBy ?? r.createdBy;
  return {
    id: String(r._id), status: r.mstatus as MonitorStatus, label: MONITOR_LABELS[r.mstatus as MonitorStatus], queueStatus: r.status,
    step: r.status === 'running' ? p.step ?? null : null,
    progress: measured ? { current: p.current, total: p.total, unit: p.unit } : null,
    waitingForRetry: r.status === 'queued' && r.attempts > 0, nextAttemptAt: r.status === 'queued' ? r.runAt : null,
    stalled: r.status === 'running' && r.lockedUntil && new Date(r.lockedUntil).getTime() < now,
    document: r.doc ? { id: String(r.doc._id), title: r.doc.title, subjectId: r.doc.subjectId ? String(r.doc.subjectId) : null, subject: r.doc.subjectId ? sName.get(String(r.doc.subjectId)) ?? null : null,
      approvalStatus: r.doc.approvalStatus, mappingStatus: r.doc.mappingStatus, archived: !!r.doc.archivedAt, superseded: !!r.doc.supersededBy } : null,
    documentId: r.documentId ? String(r.documentId) : null, isLatest: !!r.isLatest,
    uploader: uploader ? uName.get(String(uploader)) ?? null : null,
    createdAt: r.createdAt, startedAt: (r.stages ?? []).find((s: any) => s.stage === 'running')?.at ?? r.startedAt ?? null, finishedAt: r.finishedAt ?? null,
    // Finished: pages stored. Running: pages extracted so far (only counted during extraction). Otherwise unknown.
    pagesProcessed: r.status === 'succeeded' ? r.result?.pages ?? null : measured && p.step === 'extracting' ? p.current : null,
    pageUnit: r.result?.pageUnit ?? r.doc?.pageUnit ?? 'page',
    stageStatus: stageStatus(r),
    error: ['dead', 'failed', 'queued'].includes(r.status) && lastErr ? { message: String(lastErr.message ?? '').slice(0, 300), stage: lastErr.stage ?? r.failedStage ?? null, at: lastErr.at } : null,
    attempts: r.attempts ?? 0, maxAttempts: r.maxAttempts ?? 3, retries: Math.max(0, (r.attempts ?? 0) - 1) + (retriedBy.get(String(r._id)) ?? 0),
    retryOf: r.retryOf ? String(r.retryOf) : null,
  };
}

export async function listJobs(q: any) {
  const match: any = { type: TYPE };
  if (q.from || q.to) match.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  if (q.documentId) match.documentId = new mongoose.Types.ObjectId(q.documentId);
  if (q.retries === 'only') match.$or = [{ retryOf: { $exists: true, $ne: null } }, { attempts: { $gt: 1 } }];
  const post: any = {};
  if (q.status) post.mstatus = q.status;
  if (q.subjectId) post['doc.subjectId'] = new mongoose.Types.ObjectId(q.subjectId);
  if (q.q) {
    const terms = String(q.q).split(/\s+/).filter(Boolean).slice(0, 5).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const asId = /^[a-f0-9]{24}$/.test(q.q) ? [{ _id: new mongoose.Types.ObjectId(q.q) }] : [];
    post.$or = [...asId, { $and: terms.map((t) => ({ 'doc.title': { $regex: t, $options: 'i' } })) }];
  }
  const field: string = q.sort.replace(/^-/, ''); const dir = (q.sort.startsWith('-') ? -1 : 1) as 1 | -1;
  const [r] = await Job.aggregate([{ $match: match }, ...joinAndClassify(), { $match: post },
    { $facet: { items: [{ $sort: { [field]: dir, _id: -1 } }, { $skip: (q.page - 1) * q.pageSize }, { $limit: q.pageSize }, { $project: { payload: 0, result: { warnings: 0 } } }], total: [{ $count: 'n' }] } }]);
  const total = r.total[0]?.n ?? 0;
  return { items: await decorate(r.items), total, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(total / q.pageSize)) };
}

/** Counts per §10 status (all document-processing jobs). */
export async function statusCounts() {
  const r = await Job.aggregate([{ $match: { type: TYPE } }, ...joinAndClassify(), { $group: { _id: '$mstatus', n: { $sum: 1 } } }]);
  return Object.fromEntries(MONITOR_STATUSES.map((s) => [s, r.find((x) => x._id === s)?.n ?? 0]));
}

async function loadRow(id: string) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw notFound('Job not found');
  const [r] = await Job.aggregate([{ $match: { _id: new mongoose.Types.ObjectId(id), type: TYPE } }, ...joinAndClassify()]);
  if (!r) throw notFound('Job not found');
  return r;
}

/** Why a job can or cannot be retried / cancelled, from its real state. */
function actionsFor(r: Row, active: boolean) {
  const retry = !['dead', 'failed', 'cancelled'].includes(r.status) ? 'Only failed or cancelled jobs can be retried'
    : !r.doc ? 'The manual no longer exists'
    : !r.isLatest ? 'A newer processing run exists for this manual; inspect that one instead'
    : r.doc.archivedAt ? 'The manual is archived; restore it first'
    : r.doc.supersededBy ? 'A newer version replaced this manual; earlier versions are kept as they are'
    : r.doc.duplicateOf ? 'Identical copies are not processed'
    : active ? 'Another processing run for this manual is queued or running' : null;
  const cancel = r.status === 'running' ? 'A running job is not interrupted mid-stage (that could leave partial output); wait for it to finish or fail'
    : r.status !== 'queued' ? 'Only queued jobs can be cancelled' : null;
  return { retry: { allowed: !retry, reason: retry }, cancel: { allowed: !cancel, reason: cancel } };
}

export async function inspectJob(id: string) {
  const r = await loadRow(id);
  const [[row], active, chain, children, stored] = await Promise.all([
    decorate([r]),
    r.documentId ? Job.exists({ type: TYPE, documentId: r.documentId, status: { $in: ['queued', 'running'] }, _id: { $ne: r._id } }) : null,
    (async () => { const out: any[] = []; let cur = r.retryOf; while (cur && out.length < 10) { const j: any = await Job.findById(cur, { status: 1, attempts: 1, createdAt: 1, finishedAt: 1, retryOf: 1, errorLog: { $slice: -1 } }).lean(); if (!j) break; out.push(j); cur = j.retryOf; } return out; })(),
    Job.find({ retryOf: r._id }, { status: 1, attempts: 1, createdAt: 1, finishedAt: 1 }).sort({ createdAt: 1 }).lean(),
    r.documentId ? Promise.all([DocumentPage.countDocuments({ documentId: r.documentId }), Chunk.countDocuments({ documentId: r.documentId }),
      Chunk.aggregate([{ $match: { documentId: r.documentId } }, { $group: { _id: '$embeddingStatus', n: { $sum: 1 } } }])]) : null,
  ]);
  const brief = (j: any) => ({ id: String(j._id), status: j.status, attempts: j.attempts, createdAt: j.createdAt, finishedAt: j.finishedAt ?? null, error: j.errorLog?.at?.(-1)?.message ?? null });
  return {
    job: { ...row, stages: (r.stages ?? []).map((s: any) => ({ stage: s.stage, label: STEP_STAGE[s.stage] ? MONITOR_LABELS[STEP_STAGE[s.stage]] : s.stage, at: s.at, attempt: s.attempt })),
      errorLog: (r.errorLog ?? []).map((e: any) => ({ at: e.at, attempt: e.attempt, stage: e.stage ?? null, message: String(e.message ?? '') })),
      result: r.result ?? null, failedStage: r.failedStage ?? null, lease: r.status === 'running' ? { worker: r.lockedBy, until: r.lockedUntil } : null },
    retryChain: { previous: chain.map(brief), next: children.map(brief) },
    // What is stored for the manual right now (after a failure this can be the partial output of the failed attempt; a retry replaces it).
    storedOutput: stored ? { pages: stored[0], passages: stored[1], embeddings: Object.fromEntries(stored[2].map((x: any) => [x._id ?? 'none', x.n])) } : null,
    documentReport: r.isLatest && r.doc ? (await CurriculumDocument.findById(r.doc._id, { processingReport: 1, processingStatus: 1 }).lean()) : null,
    actions: actionsFor(r, !!active),
  };
}

/**
 * Safe retry: a new job (retryOf the failed one) re-runs the whole pipeline, which replaces the manual's pages,
 * detected structure and passages. Only the manual's current job can be retried, and the switch of lastJobId is
 * a compare-and-set, so two concurrent retries cannot both queue a run.
 */
export async function retryJob(id: string, userId: string) {
  const r = await loadRow(id);
  const active = r.documentId ? await Job.exists({ type: TYPE, documentId: r.documentId, status: { $in: ['queued', 'running'] } }) : null;
  const a = actionsFor(r, !!active);
  if (!a.retry.allowed) throw new AppError(409, 'NOT_RETRYABLE', a.retry.reason!);
  const newId = new mongoose.Types.ObjectId();
  const sw = await CurriculumDocument.updateOne({ _id: r.documentId, lastJobId: r._id }, { processingStatus: 'queued', lastJobId: newId });
  if (!sw.modifiedCount) throw new AppError(409, 'NOT_RETRYABLE', 'Another processing run was queued for this manual at the same time');
  const job = await enqueue(TYPE, { documentId: String(r.documentId) }, { maxAttempts: 3, createdBy: userId, retryOf: String(r._id), _id: String(newId) });
  return { jobId: String(job._id), documentId: String(r.documentId) };
}

/** Cancel a queued job (never a running one). The manual returns to the state its stored output really has. */
export async function cancelJob(id: string, userId: string) {
  const r = await loadRow(id);
  const a = actionsFor(r, false);
  if (!a.cancel.allowed) throw new AppError(409, 'NOT_CANCELLABLE', a.cancel.reason!);
  const at = new Date();
  const u = await Job.updateOne({ _id: r._id, status: 'queued' }, { status: 'cancelled', cancelledAt: at, cancelledBy: userId, finishedAt: at, $push: { stages: { stage: 'cancelled', at, attempt: r.attempts } } });
  if (!u.modifiedCount) throw new AppError(409, 'NOT_CANCELLABLE', 'The job started running before it could be cancelled');
  let documentStatus: string | null = null;
  if (r.doc && r.isLatest) {
    const d: any = await CurriculumDocument.findById(r.doc._id, { processingReport: 1 }).lean();
    if (r.attempts > 0) {
      // An earlier attempt failed after replacing output, so what is stored may be partial: say so instead of claiming it is indexed.
      documentStatus = 'failed';
      await CurriculumDocument.updateOne({ _id: r.doc._id }, { processingStatus: 'failed', processingReport: { failedAt: at, error: `Cancelled after a failed attempt: ${String(r.errorLog?.at(-1)?.message ?? 'unknown error').slice(0, 300)}` } });
    } else {
      documentStatus = d?.processingReport?.finishedAt && !d?.processingReport?.error ? 'indexed' : d?.processingReport?.error ? 'failed' : 'not_processed';
      await CurriculumDocument.updateOne({ _id: r.doc._id }, { processingStatus: documentStatus });
    }
  }
  return { cancelled: true, documentStatus };
}

/** Housekeeping: delete finished processing jobs older than N days, never a manual's or lesson's current job. */
export async function purgeJobs(olderThanDays: number, dryRun: boolean) {
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000);
  const [docKeep, lessonKeep] = await Promise.all([CurriculumDocument.distinct('lastJobId', { lastJobId: { $ne: null } }), Lesson.distinct('lastJobId', { lastJobId: { $ne: null } })]);
  const filter: any = { type: TYPE, status: { $in: ['succeeded', 'dead', 'cancelled'] }, $or: [{ finishedAt: { $lt: cutoff } }, { finishedAt: null, updatedAt: { $lt: cutoff } }], _id: { $nin: [...docKeep, ...lessonKeep] } };
  const n = await Job.countDocuments(filter);
  if (!dryRun && n) await Job.deleteMany(filter);
  return { matched: n, deleted: dryRun ? 0 : n, dryRun, cutoff, kept: 'Each manual\'s current job is always kept' };
}

/** Processing health: queue depth, waits, stalls, recent failures, this instance's worker, providers and storage. */
export async function processingHealth() {
  const now = Date.now(); const day = new Date(now - 86400_000);
  const t = Date.now(); let dbOk = true; try { await mongoose.connection.db!.admin().ping(); } catch { dbOk = false; }
  const dbMs = Date.now() - t;
  const [counts, oldest, stalled, failed24, done24, lastOk, used] = await Promise.all([
    statusCounts(),
    Job.findOne({ type: TYPE, status: 'queued' }).sort({ runAt: 1 }).select('runAt createdAt').lean(),
    Job.countDocuments({ type: TYPE, status: 'running', lockedUntil: { $lt: new Date(now) } }),
    Job.countDocuments({ type: TYPE, status: 'dead', finishedAt: { $gte: day } }),
    Job.countDocuments({ type: TYPE, status: 'succeeded', finishedAt: { $gte: day } }),
    Job.findOne({ type: TYPE, status: 'succeeded' }).sort({ finishedAt: -1 }).select('finishedAt').lean(),
    gridfs.usedBytes().catch(() => null),
  ]);
  const ai = aiStatus();
  const due = oldest && new Date(oldest.runAt as any).getTime() <= now;
  const warnings: string[] = [];
  if (!dbOk) warnings.push('Database is not responding');
  if (!worker.enabled) warnings.push('The job worker is not running on this instance (WORKER_ENABLED is not true), so queued jobs will not start');
  else if (worker.lastTickAt && now - worker.lastTickAt.getTime() > Math.max(60_000, worker.pollMs * 10)) warnings.push('The job worker has not polled recently');
  if (stalled) warnings.push(`${stalled} running job(s) lost their lease (worker restart or crash); they resume automatically`);
  if (due && now - new Date(oldest!.runAt as any).getTime() > 10 * 60_000) warnings.push('A job has been waiting more than 10 minutes');
  if (failed24) warnings.push(`${failed24} processing job(s) failed in the last 24 hours`);
  if (ai.ocr === 'disabled') warnings.push('OCR is not configured: scanned pages are reported as "OCR needed", not read');
  if (ai.embeddings === 'disabled') warnings.push('No embedding provider: manuals are indexed for text search only');
  const quota = config.GRIDFS_QUOTA_MB * 1048576;
  if (used != null && used > quota * 0.9) warnings.push('Upload storage is over 90% of its quota');
  return {
    checkedAt: new Date(), db: { ok: dbOk, pingMs: dbMs }, counts,
    oldestQueued: oldest ? { waitingSec: due ? Math.round((now - new Date(oldest.runAt as any).getTime()) / 1000) : 0, scheduledFor: oldest.runAt } : null,
    stalledRunning: stalled, last24h: { completed: done24, failed: failed24 }, lastSuccessAt: lastOk?.finishedAt ?? null,
    worker: { enabled: worker.enabled, instance: worker.id, startedAt: worker.startedAt, lastPollAt: worker.lastTickAt, lastClaimAt: worker.lastClaimAt, pollMs: worker.pollMs || null, leaseMin: worker.leaseMs / 60_000,
      note: 'Heartbeat is for the instance that answered this request.' },
    providers: { ocr: ai.ocr, embeddings: ai.embeddings },
    storage: { usedMb: used == null ? null : Math.round(used / 1048576 * 10) / 10, quotaMb: config.GRIDFS_QUOTA_MB },
    warnings,
  };
}
