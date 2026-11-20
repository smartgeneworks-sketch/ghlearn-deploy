import { getSettings } from '../services/platformSettings.js';
import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { ROLES } from '@ghlearn/shared';
import { Announcement, Notification, School } from '../models/index.js';
import { authenticate, requirePermission, isSuper } from '../middleware/index.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { privacyProblems, audienceIds, deliveryStats, effectiveStatus, schedule, assertEditable, SCHOOL_AUDIENCE_ROLES } from '../services/announcements.js';
import { sendReviewReminders } from '../services/eventNotifications.js';
import { emailConfigured } from '../services/mailer.js';

/** §18 announcements: Super Admins (system or any school) and School Admins (their school). Mounted at /api/announcements. */
export const announcementsRouter = Router();
announcementsRouter.use(authenticate);
const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const body = z.object({
  scope: z.enum(['system', 'school']), schoolId: oid.optional(), title: z.string().trim().min(3).max(150), body: z.string().trim().min(3).max(4000),
  link: z.string().regex(/^\/[\w\-/?=&.%]*$/, 'Use an in-app path such as /learn').max(300).optional(),
  audience: z.object({ roles: z.array(z.enum(ROLES)).min(1).max(10), levelId: oid.optional(), yearOfStudy: z.number().int().min(1).max(6).optional() }).strict(),
  publishAt: z.coerce.date().optional(), expiresAt: z.coerce.date(), email: z.boolean().default(false),
}).strict();
const managerScope = (req: any): any => (isSuper(req) ? {} : { scope: 'school', schoolId: req.auth.schoolId ?? new mongoose.Types.ObjectId() });
async function check(req: any, b: any) {
  if (!isSuper(req)) {
    if (b.scope !== 'school') throw forbidden('School administrators can only send announcements to their own school');
    if (b.schoolId && b.schoolId !== req.auth.schoolId) throw forbidden('You can only send announcements to your own school');
    b.schoolId = req.auth.schoolId;
  }
  if (b.scope === 'school') { if (!b.schoolId) throw badRequest('Choose the school'); if (!(await School.exists({ _id: b.schoolId }))) throw notFound('School not found');
    const bad = b.audience.roles.filter((r: string) => !(SCHOOL_AUDIENCE_ROLES as readonly string[]).includes(r)); if (bad.length) throw badRequest(`A school announcement cannot target: ${bad.join(', ')}`); }
  else b.schoolId = undefined;
  const start = b.publishAt ?? new Date();
  if (b.expiresAt <= start) throw badRequest('The end of the publication period must be after its start');
  const maxDays = (await getSettings()).notifications.announcementMaxDays;
  if (b.expiresAt.getTime() - start.getTime() > maxDays * 86400000) throw badRequest(`The publication period can be at most ${maxDays} days`);
  const problems = await privacyProblems(`${b.title}\n${b.body}`);
  if (problems.length) throw new AppError(422, 'PERSONAL_DATA', problems.join(' '), { problems });
  return b;
}
const load = async (req: any) => { const id = String(req.params.id); if (!mongoose.isValidObjectId(id)) throw notFound('Announcement not found');
  const a = await Announcement.findOne({ _id: id, ...managerScope(req) }); if (!a) throw notFound('Announcement not found'); return a; };
const view = async (a: any) => ({ ...(a.toObject ? a.toObject() : a), status: effectiveStatus(a), delivery: a.status === 'draft' ? null : await deliveryStats(a._id) });

announcementsRouter.get('/', requirePermission('users:manage'), async (req, res) => {
  const q = z.object({ status: z.string().max(20).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
  const f: any = { ...managerScope(req) };
  if (q.status === 'expired') { f.status = 'published'; f.expiresAt = { $lt: new Date() }; } else if (q.status === 'published') { f.status = 'published'; f.expiresAt = { $gte: new Date() }; } else if (q.status) f.status = q.status;
  const [items, total] = await Promise.all([Announcement.find(f).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).populate('createdBy', 'fullName').populate('schoolId', 'name').lean(), Announcement.countDocuments(f)]);
  res.json({ items: items.map((a) => ({ ...a, status: effectiveStatus(a) })), total, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(total / q.pageSize)), emailConfigured: emailConfigured() });
});
announcementsRouter.post('/preview-audience', requirePermission('users:manage'), async (req, res) => {
  const b = await check(req, body.parse(req.body)); res.json({ recipients: (await audienceIds(b)).length });
});
announcementsRouter.post('/', requirePermission('users:manage'), async (req, res) => {
  const b = await check(req, body.parse(req.body));
  const a = await Announcement.create({ ...b, createdBy: req.auth!.userId, status: 'draft' });
  audit(req, 'announcement.create', String(a._id), { scope: a.scope, roles: b.audience.roles }, { entityType: 'announcement', schoolId: b.schoolId });
  res.status(201).json({ announcement: await view(a) });
});
announcementsRouter.get('/:id', requirePermission('users:manage'), async (req, res) => {
  const a: any = await load(req); await a.populate([{ path: 'createdBy', select: 'fullName' }, { path: 'publishedBy', select: 'fullName' }, { path: 'withdrawnBy', select: 'fullName' }, { path: 'schoolId', select: 'name' }]); res.json({ announcement: await view(a) });
});
announcementsRouter.get('/:id/recipients', requirePermission('users:manage'), async (req, res) => {
  const a = await load(req); const q = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
  const f = { announcementId: a._id };
  const [items, total] = await Promise.all([Notification.find(f).sort({ _id: 1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).select('userId readAt delivery createdAt').populate('userId', 'fullName roles').lean(), Notification.countDocuments(f)]);
  res.json({ items: items.map((n: any) => ({ name: n.userId?.fullName, roles: n.userId?.roles, inApp: n.delivery?.inApp ?? 'delivered', email: n.delivery?.email ?? 'pending', emailError: n.delivery?.emailError, readAt: n.readAt, at: n.createdAt })), total, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(total / q.pageSize)) });
});
announcementsRouter.patch('/:id', requirePermission('users:manage'), async (req, res) => {
  const a = await load(req); assertEditable(a);
  const cur = { scope: a.scope, schoolId: a.schoolId ? String(a.schoolId) : undefined, title: a.title, body: a.body, link: a.link ?? undefined, audience: { roles: a.audience?.roles ?? [], levelId: a.audience?.levelId ? String(a.audience.levelId) : undefined, yearOfStudy: a.audience?.yearOfStudy ?? undefined }, publishAt: a.publishAt ?? undefined, expiresAt: a.expiresAt, email: a.email };
  const next = await check(req, body.parse({ ...JSON.parse(JSON.stringify(cur)), ...req.body }));
  const before = a.toObject(); a.set(next); if (a.status === 'scheduled') a.status = 'draft'; await a.save();
  audit(req, 'announcement.update', String(a._id), undefined, { entityType: 'announcement', ...diff(before as any, a.toObject() as any, Object.keys(req.body ?? {})) });
  res.json({ announcement: await view(a) });
});
announcementsRouter.post('/:id/publish', requirePermission('users:manage'), async (req, res) => {
  const a = await load(req); if (a.status !== 'draft') throw new AppError(409, 'NOT_DRAFT', `This announcement is already ${effectiveStatus(a)}`);
  await check(req, { scope: a.scope, schoolId: a.schoolId ? String(a.schoolId) : undefined, title: a.title, body: a.body, audience: { roles: a.audience?.roles ?? [] }, publishAt: a.publishAt && a.publishAt > new Date() ? a.publishAt : undefined, expiresAt: a.expiresAt });
  if (a.expiresAt <= new Date()) throw badRequest('The publication period has already ended; change the end date first');
  const later = !!a.publishAt && a.publishAt > new Date();
  a.status = later ? 'scheduled' : 'published'; a.publishedBy = req.auth!.userId as any; a.publishedAt = later ? a.publishAt : new Date();
  const job = await schedule(a); a.jobId = job._id; await a.save();
  audit(req, 'announcement.publish', String(a._id), { scheduledFor: later ? a.publishAt : undefined, email: a.email }, { entityType: 'announcement' });
  res.status(202).json({ announcement: await view(a), jobId: String(job._id) });
});
announcementsRouter.post('/:id/withdraw', requirePermission('users:manage'), async (req, res) => {
  const a = await load(req); if (!['scheduled', 'published'].includes(a.status)) throw new AppError(409, 'NOT_PUBLISHED', 'Only scheduled or published announcements can be withdrawn');
  a.status = 'withdrawn'; a.withdrawnBy = req.auth!.userId as any; a.withdrawnAt = new Date(); await a.save();
  const r = await Notification.updateMany({ announcementId: a._id, 'delivery.inApp': 'delivered' }, { 'delivery.inApp': 'withdrawn' });
  audit(req, 'announcement.withdraw', String(a._id), { removedFromInboxes: r.modifiedCount }, { entityType: 'announcement' });
  res.json({ announcement: await view(a) });
});
announcementsRouter.delete('/:id', requirePermission('users:manage'), async (req, res) => {
  const a = await load(req); if (a.status !== 'draft') throw new AppError(409, 'NOT_DRAFT', 'Only drafts can be deleted; withdraw a published announcement instead');
  await a.deleteOne(); audit(req, 'announcement.delete', String(a._id), { title: a.title }, { entityType: 'announcement' }); res.status(204).end();
});
/** Sends review reminders now (also runs daily as a job). Content reviewers and super admins. */
announcementsRouter.post('/review-reminders', requirePermission('content:review'), async (req, res) => {
  const r = await sendReviewReminders({ force: true }); audit(req, 'notification.review_reminders', undefined, r, { entityType: 'notification' }); res.json(r);
});
