import { notify } from './notify.js';
/**
 * MongoDB-backed job queue (no Redis needed; survives Render free-tier sleep).
 * States: queued -> running -> succeeded | failed (will retry, back to queued w/ backoff) | dead (max attempts) | cancelled.
 * Claiming is atomic (findOneAndUpdate) with a lease; expired leases are re-claimable, so crashed work resumes.
 */
import os from 'node:os';
import { Job } from '../models/index.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
/** A real measurement for the current stage (e.g. 12 of 40 pages). Only pass it when the stage actually counts work. */
export type Measure = { current: number; total: number; unit: string };
export type JobCtx = { jobId: string; attempt: number; progress: (step: string, pct?: number, measure?: Measure) => Promise<void> };
type Handler = (payload: any, ctx: JobCtx) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const WORKER_ID = `${os.hostname()}:${process.pid}`;
const LEASE_MS = 10 * 60_000;
export const registerJob = (type: string, h: Handler) => handlers.set(type, h);
/** User-initiated jobs whose outcome is worth a notification. */
const JOB_LABELS: Record<string, string> = { 'document.process': 'Manual processing', 'lesson.generate': 'Lesson generation', 'lesson.regenerateSection': 'Section regeneration', 'questions.generate': 'Question generation' };
export async function enqueue(type: string, payload: unknown, opts: { maxAttempts?: number; createdBy?: string; delayMs?: number; retryOf?: string; _id?: string } = {}) {
  const documentId = (payload as any)?.documentId;
  return Job.create({ ...(opts._id ? { _id: opts._id } : {}), type, payload, maxAttempts: opts.maxAttempts ?? 3, createdBy: opts.createdBy, runAt: new Date(Date.now() + (opts.delayMs ?? 0)),
    documentId: documentId || undefined, retryOf: opts.retryOf, stages: [{ stage: 'queued', at: new Date(), attempt: 0 }] });
}
export const backoffMs = (attempt: number) => Math.min(30 * 60_000, 15_000 * 4 ** (attempt - 1));

/** Claims and runs at most one due job. Returns false if none was available. */
export async function runOnce(): Promise<boolean> {
  const now = new Date();
  const job = await Job.findOneAndUpdate(
    { $or: [{ status: 'queued', runAt: { $lte: now } }, { status: 'running', lockedUntil: { $lt: now } }], type: { $in: [...handlers.keys()] } },
    { $set: { status: 'running', lockedBy: WORKER_ID, lockedUntil: new Date(Date.now() + LEASE_MS), startedAt: now }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, returnDocument: 'after' });
  if (!job) return false;
  worker.lastClaimAt = new Date();
  let stage = 'running';
  await Job.updateOne({ _id: job._id }, { $push: { stages: { stage, at: now, attempt: job.attempts } }, $set: { progress: { step: stage } } });
  const ctx: JobCtx = { jobId: String(job._id), attempt: job.attempts,
    progress: async (step, pct, m) => {
      const upd: any = { $set: { progress: { step, pct, ...(m ? { current: m.current, total: m.total, unit: m.unit } : {}) }, lockedUntil: new Date(Date.now() + LEASE_MS) } };
      if (step !== stage) { stage = step; upd.$push = { stages: { stage: step, at: new Date(), attempt: job.attempts } }; }
      await Job.updateOne({ _id: job._id }, upd);
    } };
  try {
    const result = await handlers.get(job.type)!(job.payload, ctx);
    await Job.updateOne({ _id: job._id }, { $set: { status: 'succeeded', result, finishedAt: new Date(), lockedUntil: null, progress: { step: 'done' } }, $unset: { failedStage: 1 },
      $push: { stages: { stage: 'done', at: new Date(), attempt: job.attempts } } });
    if (job.createdBy && JOB_LABELS[job.type]) await notify([job.createdBy], { type: 'job.finished', title: `${JOB_LABELS[job.type]} finished`, meta: { jobId: String(job._id), type: job.type } });
  } catch (err: any) {
    const dead = job.attempts >= job.maxAttempts || err?.permanent;
    logger.warn({ jobId: String(job._id), type: job.type, attempt: job.attempts, err: err?.message }, 'job failed');
    const at = new Date();
    await Job.updateOne({ _id: job._id }, { status: dead ? 'dead' : 'queued', lockedUntil: null, finishedAt: dead ? at : undefined, failedStage: stage,
      runAt: new Date(Date.now() + (dead ? 0 : backoffMs(job.attempts))),
      $push: { errorLog: { at, message: String(err?.message ?? err).slice(0, 1000), attempt: job.attempts, stage },
        stages: { stage: dead ? 'failed' : 'retry_wait', at, attempt: job.attempts } } });
    if (dead) await onDead.get(job.type)?.(job.payload, String(err?.message ?? err));
    if (dead && job.type === 'document.process') await (await import('./eventNotifications.js')).notifyProcessingFailed(job, String(err?.message ?? err)).catch(() => undefined);
    if (dead && job.createdBy && JOB_LABELS[job.type]) await notify([job.createdBy], { type: 'job.failed', title: `${JOB_LABELS[job.type]} failed`, body: String(err?.message ?? err).slice(0, 300), meta: { jobId: String(job._id), type: job.type } });
  }
  return true;
}
const onDead = new Map<string, (payload: any, message: string) => Promise<void>>();
export const registerDeadHandler = (type: string, h: (payload: any, message: string) => Promise<void>) => onDead.set(type, h);
/** Error that must not be retried (e.g. invalid PDF). */
export class PermanentJobError extends Error { permanent = true; }
/** For tests/scripts: run until no due jobs remain. */
export async function drain(limit = 100) { let n = 0; while (n < limit && (await runOnce())) n++; return n; }

let timer: NodeJS.Timeout | null = null; let busy = false;
/** In-process worker heartbeat for the health view (this instance only). */
export const worker: { id: string; enabled: boolean; startedAt: Date | null; lastTickAt: Date | null; lastClaimAt: Date | null; pollMs: number; leaseMs: number } =
  { id: WORKER_ID, enabled: false, startedAt: null, lastTickAt: null, lastClaimAt: null, pollMs: 0, leaseMs: LEASE_MS };
export function startWorker() {
  if (config.WORKER_ENABLED !== 'true' || timer) return;
  Object.assign(worker, { enabled: true, startedAt: new Date(), pollMs: config.WORKER_POLL_MS });
  timer = setInterval(async () => { worker.lastTickAt = new Date(); if (busy) return; busy = true; try { while (await runOnce()); } catch (e) { logger.error({ e }, 'worker loop'); } finally { busy = false; } }, config.WORKER_POLL_MS);
  logger.info({ worker: WORKER_ID }, 'job worker started');
}
export const stopWorker = () => { if (timer) clearInterval(timer); timer = null; worker.enabled = false; };
