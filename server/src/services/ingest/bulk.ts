/**
 * Bulk ingestion of many manuals through the normal `document.process` jobs, paced for the provider quotas.
 *
 * A bulk run is a chain of short `ingest.bulk` ticks (each tick enqueues the next one), so it survives restarts and
 * Render sleep like every other job, and it is idempotent: manuals already indexed are skipped, a manual is queued at
 * most `maxTries` times, and nothing is queued while the same manual has an active job.
 *
 * Each tick:
 *  - keeps at most `maxInFlight` of the run's manuals queued/running (the worker runs one job at a time);
 *  - stops queuing for the day once today's embedding requests (one per batch of 50 passages, from AiUsage) reach
 *    `dailyEmbedRequests`, and resumes after midnight UTC;
 *  - pauses for an hour after the provider rate-limits embeddings;
 *  - stops queuing for the month when this month's estimated AI cost (LLM + embeddings) reaches `monthCostShare` of
 *    the platform monthly cost cap;
 *  - while work remains, requests the service's own public health URL so the free Render instance does not sleep
 *    between ticks (only when RENDER_EXTERNAL_URL is set, and only while a run is active).
 */
import mongoose from 'mongoose';
import { AiUsage, Chunk, CurriculumDocument, Job } from '../../models/index.js';
import { registerJob, enqueue } from '../queue.js';
import { queueProcessing } from './pipeline.js';
import { monthStatus, today, thisMonth } from '../usage.js';
import { getAiSettings } from '../aiSettings.js';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';

export type BulkPayload = { runId: string; documentIds: string[]; dailyEmbedRequests: number; maxInFlight: number; maxTries: number; monthCostShare: number;
  tries: Record<string, number>; createdBy?: string; startedAt: string; cancelled?: boolean;
  /** Pause after each page (ms) so the API stays responsive on a small instance. */ throttleMs?: number;
  /** Optional quiet window: queue new manuals only between these UTC hours [start, end). */ activeHoursUtc?: [number, number] };
export const BULK_TICK_MS = 60_000;
const ACTIVE = ['queued', 'running'] as ('queued' | 'running')[];

export async function embeddingSpend(month = thisMonth()) {
  const [r] = await AiUsage.aggregate([{ $match: { day: { $gte: `${month}-01`, $lte: `${month}-31` }, purpose: 'embedding.index' } },
    { $group: { _id: null, n: { $sum: 1 }, chars: { $sum: { $ifNull: ['$chars', 0] } } } }]);
  const chars = r?.chars ?? 0;
  return { requests: r?.n ?? 0, chars, estTokens: Math.round(chars / 4), estCostUsd: Math.round((chars / 4 / 1e6) * config.AI_COST_EMBED_PER_M * 10000) / 10000 };
}
const inWindow = ([a, b]: [number, number], h = new Date().getUTCHours()) => (a <= b ? h >= a && h < b : h >= a || h < b);
const nextUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 5, 0, 0); return d; };

/** Classifies every manual of the run (read-only). */
export async function bulkState(p: Pick<BulkPayload, 'documentIds' | 'tries' | 'maxTries'>) {
  const tried = p.tries ?? {}; // an empty object is not stored by Mongoose (minimize)
  const ids = p.documentIds.map((x) => new mongoose.Types.ObjectId(x));
  const docs = await CurriculumDocument.find({ _id: { $in: ids } }).select('processingStatus lastJobId archivedAt duplicateOf supersededBy').lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const active = new Set((await Job.find({ type: 'document.process', status: { $in: ACTIVE }, 'payload.documentId': { $in: p.documentIds } }).select('payload').lean()).map((j: any) => String(j.payload.documentId)));
  const noVectors = new Set((await Chunk.aggregate([{ $match: { documentId: { $in: ids }, embeddingStatus: { $in: ['failed', 'pending'] } } }, { $group: { _id: '$documentId' } }])).map((r) => String(r._id)));
  const out = { indexed: [] as string[], inFlight: [] as string[], pending: [] as string[], failed: [] as string[], skipped: [] as string[] };
  for (const id of p.documentIds) {
    const d = byId.get(id); const tries = tried[id] ?? 0;
    if (!d || d.archivedAt || d.duplicateOf || d.supersededBy) out.skipped.push(id);
    else if (active.has(id)) out.inFlight.push(id);
    else if (d.processingStatus === 'indexed' && !noVectors.has(id)) out.indexed.push(id);
    else if (tries >= p.maxTries) out.failed.push(id);
    else out.pending.push(id);
  }
  return out;
}

export async function bulkTick(p: BulkPayload) {
  p.tries ??= {};
  const s = await bulkState(p);
  const embToday = await AiUsage.countDocuments({ day: today(), purpose: 'embedding.index' });
  const limited = await AiUsage.exists({ purpose: 'embedding.index', createdAt: { $gte: new Date(Date.now() - 15 * 60_000) }, $or: [{ status: 'rate_limited' }, { error: /429|RESOURCE_EXHAUSTED|quota/i }] });
  const ai = await getAiSettings(); const month = await monthStatus(); const emb = await embeddingSpend();
  const monthCost = month.estCostUsd + emb.estCostUsd; const costCap = ai.platformMonthlyCostUsd * p.monthCostShare;
  let paused: string | null = null; const queued: string[] = [];
  if (p.cancelled) paused = 'cancelled';
  else if (monthCost >= costCap) paused = `month cost estimate $${monthCost.toFixed(2)} reached ${Math.round(p.monthCostShare * 100)}% of the $${ai.platformMonthlyCostUsd} monthly cap`;
  else if (embToday >= p.dailyEmbedRequests) paused = `daily embedding budget reached (${embToday}/${p.dailyEmbedRequests})`;
  else if (limited) paused = 'embedding provider rate-limited recently; waiting';
  else if (p.activeHoursUtc && !inWindow(p.activeHoursUtc)) paused = `outside the active hours ${p.activeHoursUtc[0]}:00-${p.activeHoursUtc[1]}:00 UTC`;
  else {
    for (const id of s.pending) {
      if (s.inFlight.length + queued.length >= p.maxInFlight) break;
      await queueProcessing(id, p.createdBy, { throttleMs: p.throttleMs }); p.tries[id] = (p.tries[id] ?? 0) + 1; queued.push(id);
    }
  }
  const remaining = s.pending.length + s.inFlight.length;
  const done = !remaining || !!p.cancelled;
  const summary = { runId: p.runId, total: p.documentIds.length, indexed: s.indexed.length, inFlight: s.inFlight.length + queued.length, pending: s.pending.length - queued.length,
    failed: s.failed, skipped: s.skipped.length, queuedNow: queued, paused, embeddingRequestsToday: embToday, dailyEmbedRequests: p.dailyEmbedRequests,
    monthEstCostUsd: Math.round(monthCost * 10000) / 10000, embeddingMonth: emb, finished: done, at: new Date() };
  if (!done) {
    const delay = paused?.startsWith('daily') ? Math.min(nextUtcMidnight().getTime() - Date.now(), 6 * 3600_000) : paused?.startsWith('embedding provider') ? 60 * 60_000 : paused?.startsWith('month') ? 6 * 3600_000 : BULK_TICK_MS;
    // Long waits are split into ticks of at most 10 minutes so the keep-awake request keeps the instance up.
    if (!(await Job.exists({ type: 'ingest.bulk', status: 'queued', 'payload.runId': p.runId }))) await enqueue('ingest.bulk', p, { maxAttempts: 5, createdBy: p.createdBy, delayMs: Math.min(delay, 10 * 60_000) });
    await keepAwake();
  }
  return summary;
}

async function keepAwake() {
  const base = config.RENDER_EXTERNAL_URL?.replace(/\/+$/, ''); if (!base) return;
  try { await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(15_000) }); } catch (e: any) { logger.warn({ err: e?.message }, 'bulk ingest keep-awake request failed'); }
}

export async function startBulk(o: { documentIds: string[]; createdBy?: string; dailyEmbedRequests?: number; maxInFlight?: number; maxTries?: number; monthCostShare?: number; throttleMs?: number; activeHoursUtc?: [number, number] }) {
  const p: BulkPayload = { runId: new mongoose.Types.ObjectId().toHexString(), documentIds: [...new Set(o.documentIds)], dailyEmbedRequests: o.dailyEmbedRequests ?? 800,
    maxInFlight: o.maxInFlight ?? 2, maxTries: o.maxTries ?? 2, monthCostShare: o.monthCostShare ?? 0.9, tries: {}, createdBy: o.createdBy, startedAt: new Date().toISOString(),
    throttleMs: o.throttleMs ?? 150, ...(o.activeHoursUtc ? { activeHoursUtc: o.activeHoursUtc } : {}) };
  return enqueue('ingest.bulk', p, { maxAttempts: 5, createdBy: o.createdBy });
}
/** The latest tick of the latest run (queued or finished), with its last summary. */
export async function latestBulk() {
  const last: any = await Job.findOne({ type: 'ingest.bulk' }).sort({ createdAt: -1 }).lean(); if (!last) return null;
  const done: any = last.status === 'succeeded' ? last : await Job.findOne({ type: 'ingest.bulk', 'payload.runId': last.payload.runId, status: 'succeeded' }).sort({ createdAt: -1 }).lean();
  return { runId: last.payload.runId, nextTickJobId: String(last._id), nextTickStatus: last.status, nextTickAt: last.runAt, startedAt: last.payload.startedAt, settings: { throttleMs: last.payload.throttleMs, activeHoursUtc: last.payload.activeHoursUtc ?? null, dailyEmbedRequests: last.payload.dailyEmbedRequests, maxInFlight: last.payload.maxInFlight, maxTries: last.payload.maxTries, monthCostShare: last.payload.monthCostShare },
    cancelled: !!last.payload.cancelled, last: done?.result ?? null };
}
/** Stops the active run: its queued tick is cancelled; manuals already queued finish normally. */
export async function cancelBulk() {
  const r = await Job.updateMany({ type: 'ingest.bulk', status: 'queued' }, { status: 'cancelled', finishedAt: new Date(), $push: { stages: { stage: 'cancelled', at: new Date(), attempt: 0 } } });
  return { cancelledTicks: r.modifiedCount };
}

registerJob('ingest.bulk', (p: BulkPayload) => bulkTick(p));
