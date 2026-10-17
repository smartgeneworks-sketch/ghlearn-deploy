import { sendExport } from '../services/exporter.js';
import { Router } from 'express';
import { z } from 'zod';
import { ROLES, hasPermission, updateUserSchema } from '@ghlearn/shared';
import { assertManageable } from './adminUsers.js';
import { User, TeacherAssignment, StudentProfile, AuditLog, School } from '../models/index.js';
import { authenticate, requirePermission, isSuper } from '../middleware/index.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { listQuery, paginate, searchFilter } from '../lib/list.js';
import { setRoles } from '../services/roles.js';
import { toCsv } from '../services/teach/reports.js';
import { revokeAllForUser } from '../services/auth.js';
import mongoose from 'mongoose';

export const adminRouter = Router();
adminRouter.use(authenticate, requirePermission('users:manage'));
const scope = (req: any) => (isSuper(req) ? {} : { schoolId: req.auth.schoolId ?? new mongoose.Types.ObjectId() });

const usersQ = listQuery(['createdAt', 'fullName', 'email', 'lastLoginAt', 'status'] as const).extend({
  role: z.enum(ROLES).optional(), status: z.enum(['active', 'suspended']).optional(), schoolId: z.string().regex(/^[a-f0-9]{24}$/).optional() });
adminRouter.get('/users', async (req, res) => {
  const p = usersQ.parse(req.query);
  const f: any = { ...scope(req), ...searchFilter(p.q, ['fullName', 'email']) };
  if (p.role) f.roles = p.role; if (p.status) f.status = p.status;
  if (p.schoolId) { if (!isSuper(req) && p.schoolId !== req.auth!.schoolId) throw forbidden('You can only list users of your school'); f.schoolId = p.schoolId; }
  const out = await paginate<any>(User, f, p, (q) => q.select('email fullName roles status schoolId lastLoginAt createdAt isSample'));
  const names = new Map((await School.find({ _id: { $in: out.items.map((u) => u.schoolId).filter(Boolean) } }).select('name').lean()).map((x) => [String(x._id), x.name]));
  res.json({ ...out, items: out.items.map((u) => ({ ...u, schoolId: u.schoolId ? String(u.schoolId) : undefined, schoolName: u.schoolId ? names.get(String(u.schoolId)) : undefined })) });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const b = updateUserSchema.parse(req.body);
  const u = await User.findOne({ _id: req.params.id, ...scope(req) }); if (!u) throw notFound('User not found');
  const moves = !!(b.status || b.schoolId);
  const profile = b.fullName !== undefined || b.email !== undefined;
  if (moves && String(u._id) === req.auth!.userId) throw forbidden('You cannot change your own status or school');
  if (moves && !isSuper(req)) {
    if (u.roles.some((r) => r === 'super_admin' || r === 'school_admin')) throw forbidden('Cannot change administrator accounts');
    if (b.schoolId && b.schoolId !== req.auth!.schoolId) throw forbidden('Cannot move users to another school');
  }
  if (b.schoolId && isSuper(req) && u.schoolId && String(u.schoolId) !== b.schoolId) throw forbidden('Use "Move to another school" so classes and role grants move safely');
  if (profile) assertManageable(req, u, 'edit');
  if (b.roles) {
    if (!hasPermission(req.auth!.roles, 'roles:assign')) throw forbidden('Missing permission: roles:assign');
    await setRoles(req, u, b.roles);
  }
  if (profile) {
    const before = { fullName: u.fullName, email: u.email }; const after = { fullName: b.fullName ?? u.fullName, email: b.email ?? u.email };
    if (after.email !== before.email && (await User.exists({ email: after.email, _id: { $ne: u._id } }))) throw conflict('An account with this email already exists');
    await User.updateOne({ _id: u._id }, after);
    audit(req, 'user.update', String(u._id), undefined, { entityType: 'user', ...diff(before, after) });
  }
  if (moves) {
    const before = { status: u.status, schoolId: u.schoolId ? String(u.schoolId) : undefined };
    const after = { status: b.status ?? u.status, schoolId: b.schoolId ?? before.schoolId };
    await User.updateOne({ _id: u._id }, after);
    if (b.status === 'suspended') await revokeAllForUser(String(u._id));
    audit(req, b.status && b.status !== before.status ? (b.status === 'suspended' ? 'user.suspend' : 'user.activate') : 'user.update', String(u._id), undefined, { entityType: 'user', ...diff(before, after) });
  }
  res.json({ user: await User.findById(u._id).lean() });
});

const assign = z.object({ teacherId: z.string().regex(/^[a-f0-9]{24}$/), subjectId: z.string().regex(/^[a-f0-9]{24}$/), classGroup: z.string().max(40).optional(), yearOfStudy: z.number().int().min(1).max(3).optional() });
adminRouter.post('/teacher-assignments', async (req, res) => {
  const b = assign.parse(req.body);
  const t = await User.findOne({ _id: b.teacherId, roles: 'teacher', ...scope(req) }); if (!t) throw notFound('Teacher not found in your school');
  const a = await TeacherAssignment.create({ ...b, schoolId: t.schoolId ?? undefined } as any); audit(req, 'teacher.assign', String(a._id)); res.status(201).json(a);
});

const subjPatch = z.object({ subjectIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(40) });
adminRouter.patch('/students/:userId/subjects', async (req, res) => {
  const b = subjPatch.parse(req.body);
  const p = await StudentProfile.findOne({ userId: req.params.userId, ...scope(req) }); if (!p) throw notFound('Student profile not found');
  const { Subject } = await import('../models/index.js');
  if ((await Subject.countDocuments({ _id: { $in: b.subjectIds }, levelId: p.levelId })) !== new Set(b.subjectIds).size) throw notFound('One or more subjects are invalid for this student\'s level');
  p.subjectIds = b.subjectIds as any; await p.save(); audit(req, 'student.subjects.update', String(p._id), b); res.json({ profile: p });
});

const auditQ = z.object({ action: z.string().max(80).optional(), actor: z.string().max(120).optional(), target: z.string().max(80).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  outcome: z.enum(['success', 'failure', 'denied']).optional(), entityType: z.string().regex(/^[\w-]{1,40}$/).optional(), requestId: z.string().regex(/^[\w.:-]{1,64}$/).optional(),
  page: z.coerce.number().int().min(1).max(1000).prefault(1), limit: z.coerce.number().int().min(1).max(200).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional() });
async function auditFilter(req: any) {
  const p = auditQ.parse(req.query); const q = { ...p, limit: p.pageSize ?? p.limit ?? 50 }; const f: any = {};
  // School admins only see actions performed by users of their school.
  let actors: any[] | null = isSuper(req) ? null : await User.find(scope(req)).distinct('_id');
  if (q.actor) { const rx = new RegExp(q.actor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); const m = await User.find({ ...(isSuper(req) ? {} : scope(req)), $or: [{ email: rx }, { fullName: rx }] }).distinct('_id'); actors = m; }
  if (q.outcome) f.outcome = q.outcome; if (q.entityType) f.entityType = q.entityType; if (q.requestId) f.requestId = q.requestId;
  if (actors) f.actorId = { $in: actors };
  if (q.action) f.action = { $regex: '^' + q.action.replace(/[^\w.:-]/g, '') };
  if (q.target) f.target = q.target;
  if (q.from || q.to) f.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  return { q, f };
}
adminRouter.get('/audit', requirePermission('audit:view'), async (req, res) => {
  const { q, f } = await auditFilter(req);
  const [items, total, actions, entityTypes] = await Promise.all([AuditLog.find(f).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('actorId', 'fullName email').lean(), AuditLog.countDocuments(f), AuditLog.distinct('action', f.actorId ? { actorId: f.actorId } : {}), AuditLog.distinct('entityType', f.actorId ? { actorId: f.actorId } : {})]);
  res.json({ items, total, page: q.page, pageSize: q.limit, pages: Math.max(1, Math.ceil(total / q.limit)), actions: actions.sort(), entityTypes: entityTypes.filter(Boolean).sort() });
});
const AUDIT_HEADER = ['When', 'Actor', 'Email', 'Action', 'Outcome', 'Entity', 'Target', 'IP', 'Request id', 'Details', 'Before', 'After'];
/** Audited export of the (filtered) audit log, CSV or Excel. At most 5,000 rows, newest first. */
async function auditExport(req: any, res: any, format: 'csv' | 'xlsx') {
  const { q, f } = await auditFilter(req);
  const items = await AuditLog.find(f).sort({ createdAt: -1 }).limit(5000).populate('actorId', 'fullName email').lean();
  const { page: _p, limit: _l, pageSize: _s, ...filters } = q;
  sendExport(req, res, { report: 'audit', target: 'audit', format, header: AUDIT_HEADER, filters,
    rows: items.map((i: any) => [i.createdAt, i.actorId?.fullName, i.actorId?.email, i.action, i.outcome, i.entityType, i.target, i.ip, i.requestId, i.meta ? JSON.stringify(i.meta) : '', i.before ? JSON.stringify(i.before) : '', i.after ? JSON.stringify(i.after) : '']),
    note: `Audit log export (${items.length} entries${items.length === 5000 ? ', capped at 5,000' : ''}). Restricted: handle as confidential.` });
}
adminRouter.get('/audit.csv', requirePermission('audit:view'), (req, res) => auditExport(req, res, 'csv'));
adminRouter.get('/audit/export', requirePermission('audit:view'), (req, res) => auditExport(req, res, req.query.format === 'xlsx' ? 'xlsx' : 'csv'));
adminRouter.get('/teacher-assignments', async (req, res) => {
  res.json({ items: await TeacherAssignment.find(isSuper(req) ? {} : { schoolId: req.auth!.schoolId }).populate('teacherId', 'fullName email').populate('subjectId', 'name code').lean() });
});
adminRouter.delete('/teacher-assignments/:id', async (req, res) => {
  const a = await TeacherAssignment.findOneAndDelete({ _id: req.params.id, ...(isSuper(req) ? {} : { schoolId: req.auth!.schoolId }) });
  if (!a) throw notFound(); audit(req, 'teacher.unassign', String(a._id)); res.status(204).end();
});
adminRouter.get('/students/:userId/profile', async (req, res) => {
  const p = await StudentProfile.findOne({ userId: req.params.userId, ...scope(req) }).lean(); if (!p) throw notFound('Student profile not found'); res.json({ profile: p });
});
