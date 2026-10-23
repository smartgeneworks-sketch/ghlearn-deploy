import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { hasPermission, roleGrantSchema, type Permission } from '@ghlearn/shared';
import { User, School, CurriculumDocument, Lesson, Question, Job, RoleAssignment, AiUsage } from '../models/index.js';
import { authenticate, requirePermission, isSuper } from '../middleware/index.js';
import { notFound } from '../lib/errors.js';
import { escapeRx } from '../lib/list.js';
import { overview } from '../services/adminOverview.js';
import { overviewCharts } from '../services/adminCharts.js';
import { grantRole, revokeRole, backfillUser } from '../services/roles.js';
import { config } from '../config.js';
import { recentErrors } from '../services/errorLog.js';
import rateLimit from 'express-rate-limit';
import { PassThrough } from 'node:stream';
import { audit } from '../lib/audit.js';
import { AppError, forbidden } from '../lib/errors.js';
import { writeBackup } from '../services/backupExport.js';
import { logger } from '../lib/logger.js';

/**
 * Admin panel endpoints (Phase 2). Mounted on /api/admin before the users:manage router, with route-level
 * guards so unmatched paths fall through. Every endpoint re-checks permissions server-side (spec §4).
 */
export const adminPanelRouter = Router();
const oid = z.string().regex(/^[a-f0-9]{24}$/);
const can = (req: any, ...ps: Permission[]) => ps.some((p) => hasPermission(req.auth.roles, p));

const overviewQ = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), levelId: oid.optional(), schoolId: oid.optional(), subjectId: oid.optional() }).strict();
adminPanelRouter.get('/overview', authenticate, requirePermission('admin:access'), async (req, res) => {
  res.json(await overview(req.auth!, overviewQ.parse(req.query), req.query as any));
});
adminPanelRouter.get('/overview/charts', authenticate, requirePermission('admin:access'), async (req, res) => {
  res.json(await overviewCharts(req.auth!, overviewQ.parse(req.query), req.query as any));
});

/** Global search (top bar): only the entity types the caller may open, scoped to their school. */
adminPanelRouter.get('/search', authenticate, requirePermission('admin:access'), async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(2).max(80) }).parse(req.query);
  const rx = { $regex: escapeRx(q), $options: 'i' };
  const groups: { type: string; label: string; items: { id: string; title: string; subtitle?: string; link: string }[] }[] = [];
  const add = async (type: string, label: string, run: () => Promise<{ id: string; title: string; subtitle?: string; link: string }[]>) => { const items = await run(); if (items.length) groups.push({ type, label, items }); };
  const sch = isSuper(req) ? {} : { schoolId: req.auth!.schoolId ?? new mongoose.Types.ObjectId() };
  const jobs: Promise<void>[] = [];
  if (can(req, 'users:manage')) jobs.push(add('user', 'Users', async () => (await User.find({ ...sch, $or: [{ fullName: rx }, { email: rx }] }).limit(5).select('fullName email roles').lean())
    .map((u: any) => ({ id: String(u._id), title: u.fullName, subtitle: `${u.email} · ${u.roles.join(', ')}`, link: `/admin/users?q=${encodeURIComponent(u.email)}` }))));
  if (can(req, 'school:create', 'school:manage')) jobs.push(add('school', 'Schools', async () => (await School.find({ ...(isSuper(req) ? {} : { _id: req.auth!.schoolId ?? new mongoose.Types.ObjectId() }), $or: [{ name: rx }, { code: rx }] }).limit(5).select('name code region').lean())
    .map((s: any) => ({ id: String(s._id), title: s.name, subtitle: [s.code, s.region].filter(Boolean).join(' · '), link: '/admin/schools' }))));
  if (can(req, 'documents:upload', 'documents:map', 'content:review')) jobs.push(add('document', 'Learner manuals', async () => (await CurriculumDocument.find({ duplicateOf: null, $or: [{ title: rx }, { originalFilename: rx }] }).limit(5).select('title processingStatus').lean())
    .map((d: any) => ({ id: String(d._id), title: d.title, subtitle: d.processingStatus, link: `/admin/documents/${d._id}` }))));
  if (can(req, 'content:edit', 'content:review')) {
    jobs.push(add('lesson', 'Lessons', async () => (await Lesson.find({ $or: [{ title: rx }, { topic: rx }] }).limit(5).select('title status').lean())
      .map((l: any) => ({ id: String(l._id), title: l.title, subtitle: l.status, link: `/admin/lessons/${l._id}` }))));
    jobs.push(add('question', 'Questions', async () => (await Question.find({ $or: [{ stem: rx }, { topic: rx }] }).limit(5).select('stem topic status').lean())
      .map((x: any) => ({ id: String(x._id), title: String(x.stem).slice(0, 90), subtitle: `${x.topic} · ${x.status}`, link: `/admin/questions?q=${encodeURIComponent(x.topic)}` }))));
  }
  await Promise.all(jobs);
  const order = ['user', 'school', 'document', 'lesson', 'question'];
  res.json({ q, groups: groups.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type)) });
});

/** Operational status for System Operators (spec §4): no learner or content data, no secrets. */
adminPanelRouter.get('/system', authenticate, requirePermission('system:health'), async (_req, res) => {
  const t = Date.now(); let dbOk = true; try { await mongoose.connection.db!.admin().ping(); } catch { dbOk = false; }
  const dbMs = Date.now() - t;
  const [byStatus, oldestQueued, recentFailures, aiDay, errors] = await Promise.all([
    Job.aggregate([{ $group: { _id: { type: '$type', status: '$status' }, n: { $sum: 1 } } }]),
    Job.findOne({ status: 'queued' }).sort({ runAt: 1 }).select('runAt type').lean(),
    Job.find({ status: { $in: ['failed', 'dead'] } }).sort({ updatedAt: -1 }).limit(10).select('type status attempts updatedAt errorLog').lean(),
    AiUsage.aggregate([{ $match: { createdAt: { $gte: new Date(Date.now() - 86400_000) } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    recentErrors(20),
  ]);
  const queues: Record<string, Record<string, number>> = {};
  for (const r of byStatus) (queues[r._id.type] ??= {})[r._id.status] = r.n;
  const m = process.memoryUsage();
  res.json({
    checkedAt: new Date(), uptimeSec: Math.round(process.uptime()), node: process.version, commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
    db: { ok: dbOk, pingMs: dbMs }, memoryMb: { rss: Math.round(m.rss / 1048576), heapUsed: Math.round(m.heapUsed / 1048576) },
    queues, oldestQueued: oldestQueued ? { type: oldestQueued.type, waitingSec: Math.max(0, Math.round((Date.now() - new Date(oldestQueued.runAt as any).getTime()) / 1000)) } : null,
    recentFailures: recentFailures.map((j: any) => ({ id: String(j._id), type: j.type, status: j.status, attempts: j.attempts, at: j.updatedAt, error: String(j.errorLog?.at(-1)?.message ?? '').slice(0, 200) })),
    recentErrors: errors,
    ai: { configured: !!config.GEMINI_API_KEY, last24h: Object.fromEntries(aiDay.map((r) => [r._id ?? 'unknown', r.n])) },
  });
});

/** Scoped role assignments (spec §4). Grant rules live in services/roles.ts. */
adminPanelRouter.get('/users/:id/roles', authenticate, requirePermission('roles:assign'), async (req, res) => {
  const u = await User.findOne({ _id: oid.parse(req.params.id), ...(isSuper(req) ? {} : { schoolId: req.auth!.schoolId ?? new mongoose.Types.ObjectId() }) }).select('fullName email roles schoolId').lean();
  if (!u) throw notFound('User not found');
  await backfillUser(u as any);
  res.json({ user: u, items: await RoleAssignment.find({ userId: u._id }).populate('scopeId', 'name').populate('grantedBy', 'fullName').sort({ createdAt: 1 }).lean() });
});
adminPanelRouter.post('/role-assignments', authenticate, requirePermission('roles:assign'), async (req, res) => {
  const b = roleGrantSchema.parse(req.body);
  res.status(201).json(await grantRole(req, b.userId, b.role, b.schoolId));
});
adminPanelRouter.delete('/role-assignments/:id', authenticate, requirePermission('roles:assign'), async (req, res) => {
  res.json(await revokeRole(req, String(req.params.id)));
});

/**
 * Encrypted backup export (spec: ops phase H). Super admins only, audited, 3 per hour per user. Streams
 * GLBK1 | salt | iv | AES-256-GCM(gzip(EJSON lines)) | tag; see services/backupExport.ts and scripts/backup-restore.mjs.
 * Excludes tokens, OTPs, resets and error events always; ?excludeChunks=true (or body) also skips embedding chunks.
 */
const backupLimiter = rateLimit({ windowMs: 60 * 60_000, limit: config.NODE_ENV === 'test' ? 1000 : 3, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: (req) => `backup:${req.auth!.userId}` /* always authenticated + super admin here */, message: { error: { code: 'RATE_LIMITED', message: 'Backup exports are limited to 3 per hour' } } });
adminPanelRouter.post('/system/backup', authenticate, (req, _res, next) => next(isSuper(req) ? undefined : forbidden('Only super admins can export backups')), backupLimiter, async (req, res) => {
  const passphrase = config.BACKUP_PASSPHRASE;
  if (!passphrase || passphrase.length < 16) throw new AppError(503, 'BACKUP_NOT_CONFIGURED', 'Backups are not configured on this server (BACKUP_PASSPHRASE)');
  const flag = req.body?.excludeChunks ?? req.query.excludeChunks; const excludeChunks = flag === true || flag === 'true' || flag === '1';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  audit(req, 'system.backup_export', undefined, { excludeChunks }, { entityType: 'system' });
  res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `attachment; filename="ghlearn-${stamp}${excludeChunks ? '-nochunks' : ''}.glbk"`);
  const counter = new PassThrough(); let bytes = 0; counter.on('data', (c: Buffer) => { bytes += c.length; }); counter.pipe(res);
  const t0 = Date.now();
  try {
    const counts = await writeBackup(counter, { passphrase, excludeChunks, meta: { requestedBy: req.auth!.userId } });
    const docs = Object.values(counts).reduce((a, b) => a + b, 0);
    audit(req, 'system.backup_export.complete', undefined, { excludeChunks, bytes, docs, ms: Date.now() - t0, counts }, { entityType: 'system' });
    logger.info({ bytes, docs, ms: Date.now() - t0 }, 'backup export complete');
  } catch (e) {
    audit(req, 'system.backup_export.complete', undefined, { excludeChunks, bytes, error: String(e).slice(0, 200) }, { entityType: 'system', outcome: 'failure' });
    logger.error({ err: e, bytes }, 'backup export failed'); res.destroy(); // truncated file fails the GCM tag check on restore
  }
});
