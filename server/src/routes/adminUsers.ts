import { notifySecurity } from '../services/eventNotifications.js';
import { Router, type Request } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { createUserSchema, hasPermission, PLATFORM_ROLES, type Role } from '@ghlearn/shared';
import { User, School, RoleAssignment, StudentProfile, ClassGroup, TeacherAssignment, Attempt, UserReward, XpEvent, TutorMessage, AuditLog, RefreshToken } from '../models/index.js';
import { authenticate, requirePermission, isSuper } from '../middleware/index.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { hashPassword, listSessions, revokeAllForUser, revokeSession, temporaryPassword } from '../services/auth.js';
import { backfillUser, SCHOOL_GRANTABLE } from '../services/roles.js';
import { staffReset } from '../services/passwordReset.js';

/**
 * Users and Permissions (spec §7): create with a temporary password, per-role detail, recovery, sessions and audit history.
 * School admins act only on non-administrator members of their own school; nobody acts on their own account here.
 */
export const adminUsersRouter = Router();
adminUsersRouter.use('/users', authenticate, requirePermission('users:manage'));
const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const SCHOOL_REQUIRED: readonly Role[] = ['school_admin', 'teacher', 'counselor'];
const SAFE = 'email fullName roles status schoolId lastLoginAt createdAt failedLogins lockedUntil mustChangePassword passwordChangedAt isSample createdBy';
const noStore = (res: any) => res.set('Cache-Control', 'no-store');

/** Loads a user the caller may see (super: any; others: own school only). */
async function visible(req: Request, id: string) {
  if (!mongoose.isValidObjectId(id)) throw notFound('User not found');
  const u = await User.findOne({ _id: id, ...(isSuper(req) ? {} : { schoolId: req.auth!.schoolId ?? new mongoose.Types.ObjectId() }) });
  if (!u) throw notFound('User not found'); return u;
}
/** The caller may change this account: never their own, and school admins never touch administrator or platform accounts. */
export function assertManageable(req: Request, u: { _id: unknown; roles: string[] }, what: string) {
  if (String(u._id) === req.auth!.userId) throw forbidden(`You cannot ${what} your own account here`);
  if (isSuper(req)) return;
  if (u.roles.some((r) => !SCHOOL_GRANTABLE.includes(r as Role))) throw forbidden('Only a super admin can change administrator or platform accounts');
}

adminUsersRouter.post('/users', async (req, res) => {
  const b = createUserSchema.parse(req.body);
  let schoolId = b.schoolId;
  if (!isSuper(req)) {
    if (!SCHOOL_GRANTABLE.includes(b.role)) throw forbidden('Only a super admin can create administrator or platform accounts');
    if (schoolId && schoolId !== req.auth!.schoolId) throw forbidden('You can only add users to your own school');
    schoolId = req.auth!.schoolId; if (!schoolId) throw forbidden('Your account is not linked to a school');
  }
  if (PLATFORM_ROLES.includes(b.role)) schoolId = undefined;
  if (SCHOOL_REQUIRED.includes(b.role) && !schoolId) throw new AppError(422, 'VALIDATION', 'Choose the school for this role');
  if (schoolId) { const s = await School.findById(schoolId).select('status').lean(); if (!s) throw notFound('School not found'); if ((s as any).status === 'archived') throw conflict('This school is archived'); }
  if (await User.exists({ email: b.email })) throw conflict('An account with this email already exists');
  const pw = temporaryPassword();
  const u = await User.create({ email: b.email, fullName: b.fullName, roles: [b.role], schoolId, passwordHash: await hashPassword(pw), mustChangePassword: true, createdBy: req.auth!.userId, status: 'active' });
  await backfillUser(u);
  audit(req, 'user.create', String(u._id), { role: b.role, delivery: 'shown_once' }, { entityType: 'user', schoolId, after: { email: u.email, fullName: u.fullName, roles: u.roles, schoolId } });
  noStore(res);
  // Email is not configured: the temporary password is returned once to the creating admin, never stored or logged.
  res.status(201).json({ user: await User.findById(u._id).select(SAFE).lean(), temporaryPassword: pw, delivery: 'shown_once', mustChangePassword: true });
});

adminUsersRouter.get('/users/:id', async (req, res) => {
  const u = await visible(req, String(req.params.id));
  const id = u._id; const since = new Date(Date.now() - 30 * 864e5);
  const [user, school, assignments, sessions] = await Promise.all([
    User.findById(id).select(SAFE).populate('createdBy', 'fullName').lean(), u.schoolId ? School.findById(u.schoolId).select('name code status').lean() : null,
    RoleAssignment.find({ userId: id }).populate('scopeId', 'name').populate('grantedBy', 'fullName').lean(), listSessions(String(id))]);
  const out: any = { user, school, assignments, sessions: { active: sessions.length }, canManage: (() => { try { assertManageable(req, u, 'change'); return true; } catch { return false; } })() };
  if (u.roles.includes('student')) {
    const [profile, classes, attempts, attempts30, completed30, reward, lastXp, tutor30] = await Promise.all([
      StudentProfile.findOne({ userId: id }).populate('levelId', 'name').populate('programmeId', 'name').populate('subjectIds', 'name category').populate('combinationId', 'name').lean(),
      ClassGroup.find({ studentIds: id }).select('name archived yearOfStudy academicYearId').populate('academicYearId', 'label').lean(),
      Attempt.countDocuments({ userId: id }), Attempt.countDocuments({ userId: id, createdAt: { $gte: since } }),
      Attempt.countDocuments({ userId: id, createdAt: { $gte: since }, status: { $in: ['submitted', 'marked'] } }),
      UserReward.findOne({ userId: id }).select('xp level').lean(), XpEvent.findOne({ userId: id }).sort({ createdAt: -1 }).select('createdAt').lean(),
      TutorMessage.countDocuments({ userId: id, role: 'user', createdAt: { $gte: since } })]);
    out.student = { profile, classes, activity: { attempts, attempts30d: attempts30, completed30d: completed30, xp: reward?.xp ?? 0, level: reward?.level ?? 1, lastActivityAt: lastXp?.createdAt ?? null, tutorQuestions30d: tutor30 } };
  }
  if (u.roles.includes('teacher')) {
    const [ta, classes] = await Promise.all([TeacherAssignment.find({ teacherId: id }).populate('subjectId', 'name').lean(),
      ClassGroup.find({ teacherIds: id }).select('name archived subjectId studentIds').populate('subjectId', 'name').lean()]);
    out.teacher = { assignments: ta.map((a: any) => ({ _id: a._id, subject: a.subjectId?.name, classGroup: a.classGroup })), classes: classes.map((c: any) => ({ _id: c._id, name: c.name, subject: c.subjectId?.name, archived: c.archived, students: c.studentIds.length })) };
  }
  noStore(res); res.json(out);
});

/** Secure account recovery without email: a new temporary password shown once, sessions revoked, lockout cleared. */
adminUsersRouter.post('/users/:id/reset-password', async (req, res) => {
  const u = await visible(req, String(req.params.id)); assertManageable(req, u, 'reset');
  const r = await staffReset(req, u, 'temporary', 'admin'); noStore(res); res.json(r);
});
/** One-time reset link + code (24 h) the admin hands over in person; the user picks their own password. */
adminUsersRouter.post('/users/:id/reset-link', async (req, res) => {
  const u = await visible(req, String(req.params.id)); assertManageable(req, u, 'reset');
  const r = await staffReset(req, u, 'link', 'admin'); noStore(res); res.json(r);
});
adminUsersRouter.post('/users/:id/unlock', async (req, res) => {
  const u = await visible(req, String(req.params.id)); assertManageable(req, u, 'unlock');
  await User.updateOne({ _id: u._id }, { failedLogins: 0, $unset: { lockedUntil: 1 } });
  audit(req, 'user.unlock', String(u._id), undefined, { entityType: 'user', before: { lockedUntil: u.lockedUntil ?? null }, after: { lockedUntil: null } }); res.json({ ok: true });
});

adminUsersRouter.get('/users/:id/sessions', async (req, res) => {
  const u = await visible(req, String(req.params.id)); if (String(u._id) !== req.auth!.userId) assertManageable(req, u, 'view sessions of');
  noStore(res); res.json({ items: await listSessions(String(u._id)) });
});
adminUsersRouter.delete('/users/:id/sessions/:sid', async (req, res) => {
  const u = await visible(req, String(req.params.id)); assertManageable(req, u, 'revoke sessions of');
  const sid = String(req.params.sid); if (!/^[\w-]{8,64}$/.test(sid)) throw new AppError(422, 'VALIDATION', 'Invalid session id');
  if (!(await RefreshToken.exists({ userId: u._id, family: sid }))) throw notFound('Session not found');
  await revokeSession(String(u._id), sid); audit(req, 'user.session.revoke', String(u._id), { sid: sid.slice(0, 8) }, { entityType: 'user' }); res.status(204).end();
});
adminUsersRouter.post('/users/:id/sessions/revoke-all', async (req, res) => {
  const u = await visible(req, String(req.params.id)); assertManageable(req, u, 'revoke sessions of');
  await revokeAllForUser(String(u._id)); audit(req, 'user.session.revoke_all', String(u._id), undefined, { entityType: 'user' });
  notifySecurity(u._id, 'security.sessions', 'You were signed out of all devices', 'An administrator ended all your sessions. Sign in again to continue.').catch(() => undefined); res.json({ ok: true });
});

/** Audit history of one user: what they did and what was done to their account (spec §7). */
adminUsersRouter.get('/users/:id/audit', requirePermission('audit:view'), async (req, res) => {
  const u = await visible(req, String(req.params.id));
  const p = z.object({ page: z.coerce.number().int().min(1).max(1000).prefault(1), pageSize: z.coerce.number().int().min(1).max(100).prefault(25) }).parse(req.query);
  const f = { $or: [{ actorId: u._id }, { target: String(u._id) }] };
  const [items, total] = await Promise.all([AuditLog.find(f).sort({ createdAt: -1 }).skip((p.page - 1) * p.pageSize).limit(p.pageSize).populate('actorId', 'fullName').lean(), AuditLog.countDocuments(f)]);
  res.json({ items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) });
});

/**
 * Move a student or teacher to another school (super admin). They leave every class of the old school; their
 * school-scoped role grants move with them; sessions are revoked. Administrators must be re-granted explicitly.
 */
adminUsersRouter.post('/users/:id/transfer-school', async (req, res) => {
  if (!isSuper(req)) throw forbidden('Only a super admin can move users between schools');
  const b = z.object({ schoolId: oid }).strict().parse(req.body);
  const u = await visible(req, String(req.params.id)); assertManageable(req, u, 'transfer');
  if (u.roles.some((r) => !['student', 'teacher', 'counselor', 'parent'].includes(r))) throw conflict('Remove administrator or platform roles before moving this account');
  if (String(u.schoolId ?? '') === b.schoolId) throw conflict('The user is already at this school');
  const to = await School.findById(b.schoolId).select('name status').lean(); if (!to) throw notFound('School not found'); if ((to as any).status !== 'active') throw conflict('The destination school is not active');
  const from = u.schoolId ? String(u.schoolId) : null;
  const left = from ? await ClassGroup.find({ schoolId: from, $or: [{ studentIds: u._id }, { teacherIds: u._id }] }).distinct('_id') : [];
  if (left.length) await ClassGroup.updateMany({ _id: { $in: left } }, { $pull: { studentIds: u._id, teacherIds: u._id } });
  if (from) await TeacherAssignment.deleteMany({ teacherId: u._id, schoolId: from });
  await User.updateOne({ _id: u._id }, { schoolId: b.schoolId });
  await StudentProfile.updateOne({ userId: u._id }, { schoolId: b.schoolId, schoolName: to.name, schoolNameKey: (await import('../services/schools.js')).schoolNameKey(to.name) });
  await RoleAssignment.updateMany({ userId: u._id, scopeType: 'school' }, { scopeId: b.schoolId });
  await revokeAllForUser(String(u._id));
  audit(req, 'user.transfer_school', String(u._id), { classesLeft: left.length }, { entityType: 'user', before: { schoolId: from }, after: { schoolId: b.schoolId } });
  res.json({ ok: true, classesLeft: left.length });
});
export const canAssign = (req: Request) => hasPermission(req.auth!.roles, 'roles:assign');
