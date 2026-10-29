import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAnyPermission, requirePermission } from '../middleware/index.js';
import { audit } from '../lib/audit.js';
import { listJobs, listQuerySchema, inspectJob, retryJob, cancelJob, purgeJobs, processingHealth, statusCounts, MONITOR_LABELS, MONITOR_STATUSES } from '../services/jobMonitor.js';

/**
 * Document Processing Monitor (spec §10). System operators and curriculum admins (system:health or curriculum:manage)
 * can view, inspect, retry and cancel; purging job history is a system operation (system:health).
 */
export const jobsRouter = Router();
const monitor = requireAnyPermission('system:health', 'curriculum:manage');
jobsRouter.use(authenticate);
const listSchema = listQuerySchema(z);
jobsRouter.get('/', monitor, async (req, res) => {
  const q = listSchema.parse(req.query);
  const [page, counts] = await Promise.all([listJobs(q), statusCounts()]);
  res.json({ ...page, counts, statuses: MONITOR_STATUSES.map((s) => ({ value: s, label: MONITOR_LABELS[s] })) });
});
jobsRouter.get('/health', monitor, async (_req, res) => { res.json(await processingHealth()); });
const purgeSchema = z.object({ olderThanDays: z.number().int().min(1).max(3650), dryRun: z.boolean().prefault(true) }).strict();
jobsRouter.post('/purge', requirePermission('system:health'), async (req, res) => {
  const b = purgeSchema.parse(req.body);
  const r = await purgeJobs(b.olderThanDays, b.dryRun);
  if (!b.dryRun) audit(req, 'jobs.purge', undefined, { olderThanDays: b.olderThanDays, deleted: r.deleted }, { entityType: 'job' });
  res.json(r);
});
jobsRouter.get('/:id', monitor, async (req, res) => { res.json(await inspectJob(String(req.params.id))); });
jobsRouter.post('/:id/retry', monitor, async (req, res) => {
  const r = await retryJob(String(req.params.id), req.auth!.userId);
  audit(req, 'job.retry', String(req.params.id), { newJobId: r.jobId, documentId: r.documentId }, { entityType: 'job' });
  res.status(202).json(r);
});
jobsRouter.post('/:id/cancel', monitor, async (req, res) => {
  const r = await cancelJob(String(req.params.id), req.auth!.userId);
  audit(req, 'job.cancel', String(req.params.id), r, { entityType: 'job' });
  res.json(r);
});
