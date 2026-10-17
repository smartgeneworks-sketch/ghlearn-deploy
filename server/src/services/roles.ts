import type { Request } from 'express';
import mongoose from 'mongoose';
import { PLATFORM_ROLES, permissionsOf, type Permission, type Role } from '@ghlearn/shared';
import { RoleAssignment, User } from '../models/index.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { revokeAllForUser } from './auth.js';

/** Roles a School Admin may grant inside their own school (spec §4). Everything else needs a Super Admin. */
export const SCHOOL_GRANTABLE: readonly Role[] = ['teacher', 'counselor', 'student', 'parent'];
/** Administrative permissions that must never be handed out by someone who lacks them (no escalation). */
const PRIVILEGED: readonly Permission[] = ['platform:manage', 'school:create', 'school:manage', 'config:manage', 'users:manage', 'roles:assign',
  'curriculum:manage', 'system:health', 'audit:view', 'admin:access', 'content:review', 'content:publish', 'analytics:view'];

type Granter = { userId: string; roles: Role[]; schoolId?: string };
const isSuperG = (g: Granter) => g.roles.includes('super_admin');
const scopeOf = (role: Role, schoolId?: unknown) => (PLATFORM_ROLES.includes(role)
  ? { scopeType: 'platform' as const, scopeId: null }
  : { scopeType: 'school' as const, scopeId: schoolId ? new mongoose.Types.ObjectId(String(schoolId)) : null });

/** Throws unless `g` may grant or revoke `role` for `target`. Shared by grant, revoke and PATCH /users/:id. */
export function checkRoleChange(g: Granter, target: { _id: unknown; schoolId?: unknown }, role: Role, op: 'grant' | 'revoke') {
  if (String(target._id) === g.userId) throw forbidden(`You cannot ${op} your own roles`);
  if (isSuperG(g)) return;
  if (!SCHOOL_GRANTABLE.includes(role)) throw forbidden('Only a super admin can assign administrator or platform roles');
  if (!g.schoolId || String(target.schoolId ?? '') !== g.schoolId) throw forbidden('You can only manage roles for users of your school');
  const mine = new Set(permissionsOf(g.roles));
  const escalates = permissionsOf([role]).filter((p) => PRIVILEGED.includes(p) && !mine.has(p));
  if (escalates.length) throw forbidden('You cannot grant permissions you do not hold');
}

async function assertNotLastSuper(userId: string) {
  const others = await User.countDocuments({ _id: { $ne: userId }, roles: 'super_admin', status: 'active' });
  if (!others) throw conflict('Cannot remove the last active super admin');
}

/** Recomputes the User.roles cache from assignments, revokes sessions and audits the before/after. */
async function sync(req: Request, userId: string, before: Role[], action: string, meta: Record<string, unknown>) {
  const roles = [...new Set((await RoleAssignment.find({ userId }).lean()).map((a) => a.role as Role))];
  if (!roles.length) throw conflict('A user must keep at least one role');
  await User.updateOne({ _id: userId }, { roles });
  await revokeAllForUser(userId);
  audit(req, action, userId, meta, { entityType: 'user', before: { roles: before }, after: { roles } });
  (await import('./eventNotifications.js')).notifySecurity(userId, 'security.roles', 'Your roles were changed', `Your roles are now: ${roles.map((r) => r.replace(/_/g, ' ')).join(', ')}. You were signed out so the change takes effect.`).catch(() => undefined);
  return roles;
}

export async function grantRole(req: Request, userId: string, role: Role, schoolId?: string) {
  const g = req.auth!; const u = await User.findOne({ _id: userId, ...(isSuperG(g) ? {} : { schoolId: g.schoolId ?? null }) });
  if (!u) throw notFound('User not found');
  checkRoleChange(g, u, role, 'grant');
  await backfillUser(u);
  if (!PLATFORM_ROLES.includes(role) && schoolId) {
    if (u.schoolId && String(u.schoolId) !== schoolId) throw new AppError(422, 'VALIDATION', 'User belongs to another school; move them first');
    if (!u.schoolId) { u.schoolId = schoolId as any; await u.save(); }
  }
  const sc = scopeOf(role, u.schoolId);
  const exists = await RoleAssignment.findOne({ userId: u._id, role, scopeType: sc.scopeType, scopeId: sc.scopeId });
  if (exists) throw conflict('User already has this role');
  const before = [...u.roles] as Role[];
  const a = await RoleAssignment.create({ userId: u._id, role, ...sc, grantedBy: g.userId });
  const roles = await sync(req, String(u._id), before, 'role.grant', { role, scopeType: sc.scopeType, scopeId: sc.scopeId ? String(sc.scopeId) : undefined });
  return { assignment: a, roles };
}

export async function revokeRole(req: Request, assignmentId: string) {
  const g = req.auth!; const a = mongoose.isValidObjectId(assignmentId) ? await RoleAssignment.findById(assignmentId) : null; if (!a) throw notFound('Assignment not found');
  const u = await User.findOne({ _id: a.userId, ...(isSuperG(g) ? {} : { schoolId: g.schoolId ?? null }) }); if (!u) throw notFound('Assignment not found');
  checkRoleChange(g, u, a.role as Role, 'revoke');
  await backfillUser(u);
  if (a.role === 'super_admin') await assertNotLastSuper(String(u._id));
  const before = [...u.roles] as Role[];
  if ((await RoleAssignment.countDocuments({ userId: u._id })) <= 1) throw conflict('A user must keep at least one role');
  await a.deleteOne();
  return { roles: await sync(req, String(u._id), before, 'role.revoke', { role: a.role, scopeType: a.scopeType }) };
}

/** Replace a user's role set (PATCH /api/admin/users/:id), applying the same per-role rules to every change. */
export async function setRoles(req: Request, u: any, next: Role[]) {
  const g = req.auth!; const before = [...new Set(u.roles as Role[])]; const want = [...new Set(next)];
  const add = want.filter((r) => !before.includes(r)), remove = before.filter((r) => !want.includes(r));
  if (!add.length && !remove.length) return before;
  for (const r of add) checkRoleChange(g, u, r, 'grant');
  for (const r of remove) checkRoleChange(g, u, r, 'revoke');
  if (remove.includes('super_admin')) await assertNotLastSuper(String(u._id));
  await backfillUser(u); // make sure assignments mirror the cache before editing
  if (remove.length) await RoleAssignment.deleteMany({ userId: u._id, role: { $in: remove } });
  for (const r of add) await RoleAssignment.updateOne({ userId: u._id, role: r, ...scopeOf(r, u.schoolId) }, { $setOnInsert: { grantedBy: g.userId } }, { upsert: true });
  return sync(req, String(u._id), before, 'role.set', { added: add, removed: remove });
}

/** Users created outside this service (registration, imports) get assignments mirroring their cached roles. */
export async function backfillUser(u: { _id: any; roles: string[]; schoolId?: unknown }) {
  for (const r of u.roles as Role[]) await RoleAssignment.updateOne({ userId: u._id, role: r, ...scopeOf(r, u.schoolId) }, { $setOnInsert: {} }, { upsert: true });
}
/** Idempotent: every user's cached roles get matching assignments (bootstrap, seed). */
export async function backfillRoleAssignments() {
  const have = new Set((await RoleAssignment.distinct('userId')).map(String));
  let n = 0;
  for await (const u of User.find({}).select('roles schoolId').lean().cursor()) { if (!have.has(String(u._id))) { await backfillUser(u as any); n++; } }
  return n;
}
