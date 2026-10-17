import type { RequestHandler, Request } from 'express';
import { hasPermission, CONTENT_STAFF_ROLES, type Permission, type Role } from '@ghlearn/shared';
import { verifyAccess } from '../services/auth.js';
import { AppError, forbidden, unauthorized, notFound } from '../lib/errors.js';
import { schoolBlocked } from '../services/schools.js';
import { getSettings } from '../services/platformSettings.js';
import type { FeatureFlag } from '@ghlearn/shared';
import { StudentProfile, TeacherAssignment, Subject, User } from '../models/index.js';
import mongoose from 'mongoose';

export interface AuthCtx { userId: string; roles: Role[]; schoolId?: string; sid?: string }
declare global { namespace Express { interface Request { auth?: AuthCtx; id?: string } } }

export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.gl_at;
  if (!token) return next(unauthorized());
  try {
    const c = verifyAccess(token);
    // Re-check status so suspended accounts lose access before token expiry.
    const u = await User.findById(c.sub).select('status roles schoolId sessionsRevokedAt mustChangePassword +revokedSessions').lean();
    if (!u || u.status !== 'active') return next(unauthorized('Account unavailable'));
    if (c.sid && u.revokedSessions?.some((r) => r.sid === c.sid)) return next(unauthorized('Session revoked'));
    // Sessions revoked (logout everywhere, password or role change): reject access tokens issued earlier.
    if (u.sessionsRevokedAt && (c as any).iat < Math.floor(new Date(u.sessionsRevokedAt).getTime() / 1000)) return next(unauthorized('Session revoked'));
    const roles = u.roles as Role[];
    // Suspended or archived school: its members lose access at once (super admins are never locked out).
    if (u.schoolId && !roles.includes('super_admin') && (await schoolBlocked(String(u.schoolId)))) return next(new AppError(403, 'SCHOOL_INACTIVE', 'Your school is not active on the platform'));
    req.auth = { userId: c.sub, roles, schoolId: u.schoolId ? String(u.schoolId) : undefined, sid: c.sid };
    // §20 maintenance mode: only administrators (admin:access) keep using the API; signing out still works.
    const st = await getSettings();
    if (st.maintenance.enabled && !hasPermission(roles, 'admin:access') && req.originalUrl !== '/api/auth/logout') return next(maintenanceError(st));
    // Temporary password (admin-created or reset account): only the auth endpoints work until it is changed.
    if (u.mustChangePassword && !req.originalUrl.startsWith('/api/auth/')) return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password to continue'));
    next();
  } catch (e) { next(e instanceof AppError ? e : unauthorized('Session expired')); }
};
export const maintenanceError = (st: Awaited<ReturnType<typeof getSettings>>) =>
  new AppError(503, 'MAINTENANCE', st.maintenance.message || 'The platform is under maintenance. Please try again later.', { until: st.maintenance.until });
/** §20 feature flags, enforced on every route of the feature (before authentication, so a switched-off feature is off for everyone). */
export const requireFeature = (f: FeatureFlag): RequestHandler => async (_req, _res, next) => {
  try { if (!(await getSettings()).features[f]) return next(new AppError(403, 'FEATURE_DISABLED', 'This feature is switched off on this platform')); next(); } catch (e) { next(e); }
};
export const requirePermission = (p: Permission): RequestHandler => (req, _res, next) =>
  req.auth && hasPermission(req.auth.roles, p) ? next() : next(forbidden());
export const isContentStaff = (auth: AuthCtx) => auth.roles.some((r) => CONTENT_STAFF_ROLES.includes(r));
export const isSuper = (req: Request) => !!req.auth?.roles.includes('super_admin');

/** Strips keys beginning with $ or containing '.' from body/params (mongo operator injection). */
export const sanitize: RequestHandler = (req, _res, next) => {
  const clean = (v: any): any => {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) { if (k.startsWith('$') || k.includes('.')) delete v[k]; else v[k] = clean(v[k]); } }
    return v;
  };
  if (req.body) clean(req.body);
  next();
};

/**
 * Resource-level guard: can this user access learning content of `subjectId`?
 * student -> subject must be in their StudentProfile.subjectIds
 * teacher -> must have a TeacherAssignment for the subject
 * editors/reviewers/super -> yes; school_admin -> no direct learner access.
 */
export async function canAccessSubject(auth: AuthCtx, subjectId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(subjectId)) return false;
  if (isContentStaff(auth)) return true;
  if (auth.roles.includes('teacher') && (await TeacherAssignment.exists({ teacherId: auth.userId, subjectId }))) return true;
  if (auth.roles.includes('student') && (await StudentProfile.exists({ userId: auth.userId, subjectIds: subjectId }))) return true;
  return false;
}
export const requireSubjectAccess = (param = 'subjectId'): RequestHandler => async (req, _res, next) => {
  const id = String(req.params[param]);
  if (!(await Subject.exists({ _id: mongoose.isValidObjectId(id) ? id : null }))) return next(notFound('Subject not found'));
  (await canAccessSubject(req.auth!, id)) ? next() : next(forbidden('You are not enrolled in this subject'));
};
/** Only staff may see unpublished content. */
export const canSeeUnpublished = (auth: AuthCtx) => isContentStaff(auth);
export const requireAnyPermission = (...ps: Permission[]): RequestHandler => (req, _res, next) =>
  req.auth && ps.some((p) => hasPermission(req.auth!.roles, p)) ? next() : next(forbidden());
