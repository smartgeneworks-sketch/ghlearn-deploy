import { AuditLog, Notification, AiUsage, Job, AiHealthCheck, AiAlert, TutorConversation, TutorMessage } from '../models/index.js';
import { registerJob, enqueue } from './queue.js';
import { getSettings, type Settings } from './platformSettings.js';
import { logger } from '../lib/logger.js';
/**
 * §20 data retention. A real daily job (`retention.purge`, 02:30 UTC) deletes records older than the stored retention
 * periods. Audit logs are kept for at least 365 days (schema minimum) and are deleted only by this job, through the
 * AuditLog `maintenance` option; every run writes its own `retention.purge` audit entry with the counts.
 * Tutor conversations also expire through their TTL index (expiresAt, set from retention.tutorDays when a conversation is used).
 */
const FINISHED = ['succeeded', 'failed', 'dead', 'cancelled'];
const before = (days: number) => new Date(Date.now() - days * 864e5);
const dayStr = (d: Date) => d.toISOString().slice(0, 10);
function filters(r: Settings['retention']) {
  return {
    notifications: { model: Notification, q: { createdAt: { $lt: before(r.notificationDays) } }, days: r.notificationDays },
    aiUsage: { model: AiUsage, q: { day: { $lt: dayStr(before(r.aiUsageDays)) } }, days: r.aiUsageDays },
    aiHealthChecks: { model: AiHealthCheck, q: { createdAt: { $lt: before(r.aiUsageDays) } }, days: r.aiUsageDays },
    aiAlerts: { model: AiAlert, q: { createdAt: { $lt: before(r.aiUsageDays) } }, days: r.aiUsageDays },
    jobs: { model: Job, q: { status: { $in: FINISHED }, finishedAt: { $lt: before(r.jobDays) } }, days: r.jobDays },
    tutorConversations: { model: TutorConversation, q: { $or: [{ expiresAt: { $lt: new Date() } }, { lastMessageAt: { $lt: before(r.tutorDays) } }] }, days: r.tutorDays },
    auditLogs: { model: AuditLog, q: { createdAt: { $lt: before(Math.max(365, r.auditDays)) } }, days: Math.max(365, r.auditDays) },
  } as Record<string, { model: any; q: any; days: number }>;
}
/** What the next purge would delete with the given (or stored) periods. Read-only. */
export async function retentionPreview(r?: Settings['retention']) {
  const f = filters(r ?? (await getSettings()).retention);
  const out: Record<string, { days: number; due: number }> = {};
  for (const [k, v] of Object.entries(f)) out[k] = { days: v.days, due: await (v.model as any).countDocuments(v.q) };
  return out;
}
export async function purgeExpired(o: { force?: boolean } = {}) {
  const r = (await getSettings()).retention;
  if (!r.purgeEnabled && !o.force) return { skipped: 'The retention purge is switched off in System settings' };
  const f = filters(r); const deleted: Record<string, number> = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === 'tutorConversations') {
      const ids = await (TutorConversation as any).find(v.q).distinct('_id');
      for (let i = 0; i < ids.length; i += 1000) { const part = ids.slice(i, i + 1000); await TutorMessage.deleteMany({ conversationId: { $in: part } }); }
      deleted[k] = (await TutorConversation.deleteMany({ _id: { $in: ids } })).deletedCount ?? 0;
    } else if (k === 'auditLogs') deleted[k] = (await (AuditLog as any).deleteMany(v.q).setOptions({ maintenance: true })).deletedCount ?? 0;
    else deleted[k] = (await (v.model as any).deleteMany(v.q)).deletedCount ?? 0;
  }
  await AuditLog.create({ action: 'retention.purge', entityType: 'settings', target: 'retention', outcome: 'success', meta: { deleted, periods: r } });
  logger.info({ deleted }, 'retention purge');
  return { deleted };
}
const next0230 = () => { const d = new Date(); d.setUTCHours(2, 30, 0, 0); if (d <= new Date()) d.setUTCDate(d.getUTCDate() + 1); return d; };
registerJob('retention.purge', async () => { const r = await purgeExpired(); await enqueue('retention.purge', {}, { maxAttempts: 2, delayMs: next0230().getTime() - Date.now() }); return r; });
export async function ensureRetentionJob() {
  if (!(await Job.exists({ type: 'retention.purge', status: { $in: ['queued', 'running'] } }))) await enqueue('retention.purge', {}, { maxAttempts: 2, delayMs: next0230().getTime() - Date.now() });
}
