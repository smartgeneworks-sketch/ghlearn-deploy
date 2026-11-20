import { notSample } from './public.js';
import { Router, type Request } from 'express';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { teacherApplicationSchema, approveTeacherSchema, rejectTeacherSchema, GHANA_REGIONS, TEACHING_LEVELS } from '@ghlearn/shared';
import { TeacherApplication, User, School, Subject, AcademicLevel, TeacherAssignment } from '../models/index.js';
import { authenticate, requirePermission, isSuper } from '../middleware/index.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { hashPassword } from '../services/auth.js';
import { backfillUser } from '../services/roles.js';
import { normalizeGhPhone, maskPhone } from '../services/phone.js';
import { matchSchool } from '../services/schools.js';
import { sendSms, smsAvailable } from '../services/sms.js';
import { notifyRoles } from '../services/notify.js';
import { brandedMail, sendInvite, appBase, appName } from '../services/invites.js';

/**
 * Teacher applications (public form, no password) and their review (docs/TEACHER_APPLICATIONS.md).
 * The public endpoint always gives the same reply; everything that depends on whether the email is known happens after
 * the response (no enumeration by content or timing).
 */
export const TEACHER_APP_LIMITS = { ipPerHour: config.NODE_ENV === 'test' ? 1000 : 5, emailPerDay: 3 };
const ipStore = new MemoryStore();
const emailHits = new Map<string, number[]>();
export const resetTeacherAppLimits = () => { ipStore.resetAll(); emailHits.clear(); };
const ipLimiter = rateLimit({ windowMs: 60 * 60_000, limit: () => TEACHER_APP_LIMITS.ipPerHour, store: ipStore, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_q, _r, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many applications from this connection. Please try again later.')) });
/** Per-email limit: over it, the reply is unchanged and nothing is sent (no signal either way). */
function emailAllowed(email: string) {
  const k = crypto.createHash('sha256').update(email).digest('hex'); const now = Date.now();
  const hits = (emailHits.get(k) ?? []).filter((t) => now - t < 864e5);
  if (hits.length >= TEACHER_APP_LIMITS.emailPerDay) { emailHits.set(k, hits); return false; }
  hits.push(now); emailHits.set(k, hits); if (emailHits.size > 50_000) emailHits.delete(emailHits.keys().next().value!);
  return true;
}
export const RECEIVED = 'Thank you. Your application has been received. We will email you once an administrator has reviewed it. If you do not hear from us, check your spam folder or ask your school.';
/** Background work of the last application (tests await it; the response never waits for it). */
export let lastApplicationJob: Promise<void> = Promise.resolve();

export const teacherApplyRouter = Router();
/** Form options: regions, forms, active subjects and schools (public identity only). */
teacherApplyRouter.get('/options', async (_req, res) => {
  const levels = await AcademicLevel.find({ archivedAt: null, enabled: { $ne: false } }).select('name kind').lean(); const lv = new Map(levels.map((l) => [String(l._id), l]));
  const [subjects, schools] = await Promise.all([
    Subject.find({ active: true, archivedAt: null, levelId: { $in: levels.map((l) => l._id) } }).select('name levelId').sort({ name: 1 }).lean(),
    School.find({ status: 'active', ...notSample() }).select('name region').sort({ name: 1 }).lean()]);
  res.set('Cache-Control', 'public, max-age=60').json({ regions: GHANA_REGIONS, levels: TEACHING_LEVELS,
    subjects: subjects.map((s) => ({ id: String(s._id), name: s.name, level: lv.get(String(s.levelId))?.name ?? '' })),
    schools: schools.map((s) => ({ id: String(s._id), name: s.name, region: s.region ?? null })) });
});

teacherApplyRouter.post('/', ipLimiter, async (req: Request, res) => {
  const b = teacherApplicationSchema.parse(req.body);
  const ph = b.phone ? normalizeGhPhone(b.phone) : null;
  const subjects = await Subject.find({ _id: { $in: b.subjectIds }, active: true, archivedAt: null }).select('_id').lean();
  if (subjects.length !== new Set(b.subjectIds).size) throw new AppError(422, 'VALIDATION', 'Choose your subjects from the list again');
  let schoolId = b.schoolId || undefined; let schoolName = (b.schoolName ?? '').trim() || undefined;
  if (schoolId) { const s = await School.findOne({ _id: schoolId, status: 'active' }).select('name').lean(); if (!s) throw new AppError(422, 'VALIDATION', 'Choose your school from the list again, or type its name'); schoolName = s.name; }
  else if (schoolName) { const m = await matchSchool(schoolName); if (m) schoolId = String(m._id); }
  res.status(202).set('Cache-Control', 'no-store').json({ ok: true, message: RECEIVED });
  // Honeypot (a field people never see): same reply, nothing stored or sent.
  if (b.website) { audit(req, 'teacher_application.blocked', undefined, { reason: 'honeypot' }, { entityType: 'teacher_application', outcome: 'denied' }); return; }
  if (!emailAllowed(b.email)) { audit(req, 'teacher_application.blocked', undefined, { reason: 'email_rate_limited' }, { entityType: 'teacher_application', outcome: 'denied' }); return; }
  lastApplicationJob = (async () => {
    const name = await appName();
    const existing = await User.findOne({ email: b.email }).select('_id fullName').lean();
    if (existing) {
      // Already has an account: tell the account owner (only they read this inbox); no application is created.
      await brandedMail({ to: b.email, subject: `About your ${name} teacher application`, heading: 'You already have an account',
        paragraphs: [`We received a teacher application for ${b.email}, but this address already has a ${name} account.`,
          `Sign in at ${appBase()}/login. If you forgot your password, use "Forgot password?" on that page.`,
          'If you need teacher access on your existing account, ask your school administrator. If you did not apply, you can ignore this email.'] });
      audit(req, 'teacher_application.existing_account', String(existing._id), undefined, { entityType: 'teacher_application', outcome: 'denied' });
      return;
    }
    const pending = await TeacherApplication.findOne({ email: b.email, status: 'pending' }).select('_id').lean();
    if (pending) {
      await brandedMail({ to: b.email, subject: `Your ${name} teacher application`, heading: 'We already have your application',
        paragraphs: ['Your earlier teacher application is still waiting for review, so we did not create another one.', 'We will email you as soon as an administrator has reviewed it.'] });
      audit(req, 'teacher_application.duplicate', String(pending._id), undefined, { entityType: 'teacher_application', outcome: 'denied' });
      return;
    }
    const a = await TeacherApplication.create({ fullName: b.fullName, email: b.email, phone: ph?.local, region: b.region, schoolId, schoolName,
      subjectIds: b.subjectIds, levels: b.levels, staffId: b.staffId || undefined, ntcNumber: b.ntcNumber || undefined, note: b.note || undefined, consentAt: new Date(), ip: req.ip });
    const mail = await brandedMail({ to: b.email, subject: `We received your ${name} teacher application`, heading: `Thank you, ${b.fullName.split(/\s+/)[0]}`,
      paragraphs: [`We received your application for a teacher account${schoolName ? ` at ${schoolName}` : ''}.`,
        'An administrator will review it. When it is approved, we will email you a link to choose your password and sign in.', 'You do not need to do anything now.'] });
    let sms: string | undefined;
    if (ph && (await smsAvailable())) sms = (await sendSms({ to: ph.local, kind: 'notification', ref: `teacher_application:${a._id}`, message: `${name}: we received your teacher application. We will email you after an administrator reviews it.` })).status;
    const n = { type: 'review.teacher_application', title: `New teacher application: ${b.fullName}`, body: `${schoolName ?? 'School not given'} · ${b.region}`, link: '/admin/users?tab=applications' };
    await notifyRoles(['super_admin'], n);
    if (schoolId) await notifyRoles(['school_admin'], n, { schoolId: new mongoose.Types.ObjectId(schoolId) });
    audit(req, 'teacher_application.submit', String(a._id), { schoolId, freeTextSchool: !schoolId, subjects: b.subjectIds.length, email: mail.status, ...(ph ? { phone: maskPhone(ph.local), sms: sms ?? 'off' } : {}) },
      { entityType: 'teacher_application', schoolId });
  })().catch(() => undefined);
});

/** Review (Admin → Users → Teacher applications): super admins see all; school admins see their own school's. */
export const teacherReviewRouter = Router();
teacherReviewRouter.use('/teacher-applications', authenticate, requirePermission('users:manage'));
const scope = (req: Request) => (isSuper(req) ? {} : { schoolId: new mongoose.Types.ObjectId(req.auth!.schoolId ?? '000000000000000000000000') });
async function load(req: Request, id: string) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Application not found');
  const a = await TeacherApplication.findOne({ _id: id, ...scope(req) }); if (!a) throw notFound('Application not found'); return a;
}
const POP = (q: any) => q.populate('schoolId', 'name code region status').populate('subjectIds', 'name').populate('reviewedBy', 'fullName');
const view = (req: Request, a: any) => ({ ...a, phone: a.phone ? (isSuper(req) ? a.phone : maskPhone(a.phone)) : null, ip: undefined });

teacherReviewRouter.get('/teacher-applications/count', async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ pending: await TeacherApplication.countDocuments({ status: 'pending', ...scope(req) }) });
});
teacherReviewRouter.get('/teacher-applications', async (req, res) => {
  const status = z.enum(['pending', 'approved', 'rejected', 'all']).catch('pending').parse(req.query.status);
  const items = await POP(TeacherApplication.find({ ...(status === 'all' ? {} : { status }), ...scope(req) }).sort({ createdAt: status === 'pending' ? 1 : -1 }).limit(200)).lean();
  res.set('Cache-Control', 'no-store').json({ items: items.map((a: any) => view(req, a)) });
});
/** Schools a reviewer may approve into: every active school for a super admin (including seeded sample ones the public form hides), else their own. */
teacherReviewRouter.get('/teacher-applications/schools', async (req, res) => {
  const q: Record<string, unknown> = isSuper(req) ? { status: 'active' } : { _id: new mongoose.Types.ObjectId(req.auth!.schoolId ?? '000000000000000000000000'), status: 'active' };
  const items = await School.find(q).select('name region isSample').sort({ name: 1 }).lean();
  res.set('Cache-Control', 'no-store').json({ items: items.map((s: any) => ({ id: String(s._id), name: s.name, region: s.region ?? null, isSample: !!s.isSample })) });
});
teacherReviewRouter.get('/teacher-applications/:id', async (req, res) => {
  const a = await load(req, String(req.params.id));
  const item: any = await POP(TeacherApplication.findById(a._id)).lean();
  const suggested = !a.schoolId && a.schoolName ? await matchSchool(a.schoolName) : null;
  res.set('Cache-Control', 'no-store').json({ item: view(req, item), accountExists: !!(await User.exists({ email: a.email })), suggestedSchool: suggested, canCreateSchool: isSuper(req) });
});

/** One assignment per subject and form of that subject's level (e.g. Biology at SHS + "SHS 2" => yearOfStudy 2). */
async function assign(teacherId: unknown, schoolId: string, subjectIds: string[], levels: string[]) {
  const subs = await Subject.find({ _id: { $in: subjectIds } }).select('levelId').lean();
  const kinds = new Map((await AcademicLevel.find({ _id: { $in: subs.map((s) => s.levelId) } }).select('kind').lean()).map((l) => [String(l._id), l.kind as string]));
  const rows: any[] = [];
  for (const s of subs) {
    const k = kinds.get(String(s.levelId)); const years = levels.filter((l) => l.startsWith(`${k} `)).map((l) => Number(l.split(' ')[1]));
    for (const y of years.length ? years : [undefined]) rows.push({ teacherId, schoolId, subjectId: s._id, ...(y ? { yearOfStudy: y } : {}) });
  }
  if (rows.length) await TeacherAssignment.insertMany(rows);
  return rows.length;
}

teacherReviewRouter.post('/teacher-applications/:id/approve', async (req, res) => {
  const a = await load(req, String(req.params.id)); const b = approveTeacherSchema.parse(req.body);
  if (a.status !== 'pending') throw conflict(`This application was already ${a.status}`);
  if (!isSuper(req) && b.schoolId !== req.auth!.schoolId) throw forbidden('You can only approve teachers for your own school');
  const school = await School.findById(b.schoolId).select('name status').lean();
  if (!school) throw notFound('School not found'); if (school.status !== 'active') throw conflict('This school is not active');
  const subjects = await Subject.find({ _id: { $in: b.subjectIds }, archivedAt: null }).select('_id').lean();
  if (subjects.length !== new Set(b.subjectIds).size) throw new AppError(422, 'VALIDATION', 'One of the subjects no longer exists');
  if (await User.exists({ email: a.email })) throw conflict('An account with this email already exists. Reject this application, or change that account\'s role from Users.');
  const fullName = b.fullName ?? a.fullName; const wasFreeText = !a.schoolId;
  // Unusable random password until the teacher sets one from the emailed link (mustChangePassword guards it too).
  const u = await User.create({ email: a.email, fullName, roles: ['teacher'], schoolId: b.schoolId, status: 'active', mustChangePassword: true, createdBy: req.auth!.userId,
    passwordHash: await hashPassword(crypto.randomBytes(32).toString('base64url')), consent: { termsAcceptedAt: a.consentAt }, ...(a.phone ? { phone: a.phone } : {}) });
  await backfillUser(u);
  const assignments = await assign(u._id, b.schoolId, b.subjectIds, b.levels);
  Object.assign(a, { status: 'approved', reviewedBy: req.auth!.userId, reviewedAt: new Date(), userId: u._id, schoolId: b.schoolId, subjectIds: b.subjectIds, levels: b.levels, fullName });
  const inv = await sendInvite(u, { by: req.auth!.userId, why: 'teacher', schoolName: school.name, sms: true });
  if (inv.email === 'sent') { a.invitesSent += 1; a.lastInviteAt = new Date(); }
  await a.save();
  const sc = { entityType: 'teacher_application', schoolId: b.schoolId };
  audit(req, 'user.create', String(u._id), { role: 'teacher', via: 'teacher_application', delivery: inv.email === 'sent' ? 'email' : 'none' }, { entityType: 'user', schoolId: b.schoolId, after: { email: u.email, fullName, roles: u.roles, schoolId: b.schoolId } });
  audit(req, 'teacher_application.approve', String(a._id), { userId: String(u._id), assignments, email: inv.email, ...(inv.sms ? { sms: inv.sms } : {}), schoolFromFreeText: wasFreeText }, sc);
  res.json({ ok: true, userId: String(u._id), invite: inv });
});

teacherReviewRouter.post('/teacher-applications/:id/reject', async (req, res) => {
  const a = await load(req, String(req.params.id)); const b = rejectTeacherSchema.parse(req.body);
  if (a.status !== 'pending') throw conflict(`This application was already ${a.status}`);
  Object.assign(a, { status: 'rejected', reviewedBy: req.auth!.userId, reviewedAt: new Date(), rejectReason: b.reason }); await a.save();
  const name = await appName();
  const r = await brandedMail({ to: a.email, subject: `Your ${name} teacher application`, heading: `Hello ${a.fullName.split(/\s+/)[0]}`,
    paragraphs: ['Thank you for applying for a teacher account. We are sorry, but we could not approve your application.', `Reason: ${b.reason}`,
      `If you think this is a mistake, please contact your school administrator. You are welcome to apply again at ${appBase()}/register/teacher once the issue is resolved.`] });
  audit(req, 'teacher_application.reject', String(a._id), { reason: b.reason, email: r.status }, { entityType: 'teacher_application', schoolId: a.schoolId ? String(a.schoolId) : undefined });
  res.json({ ok: true, email: r.status });
});

teacherReviewRouter.post('/teacher-applications/:id/resend', async (req, res) => {
  const a = await load(req, String(req.params.id));
  if (a.status !== 'approved' || !a.userId) throw conflict('Only approved applications have an invitation');
  const u = await User.findById(a.userId).select('email fullName phone status passwordChangedAt roles').lean();
  if (!u || u.status !== 'active') throw conflict('This account is not active');
  if (u.passwordChangedAt) throw conflict('This teacher has already set a password. Use a password reset from their user page instead.');
  const inv = await sendInvite(u, { by: req.auth!.userId, why: 'teacher' });
  if (inv.email === 'sent') { a.invitesSent += 1; a.lastInviteAt = new Date(); await a.save(); }
  audit(req, 'teacher_application.resend', String(a._id), { userId: String(u._id), email: inv.email }, { entityType: 'teacher_application', schoolId: a.schoolId ? String(a.schoolId) : undefined });
  res.json({ ok: true, invite: inv });
});

/** Super admin: remove an application (spam, tests). An approved one only once its account is no longer active. */
teacherReviewRouter.delete('/teacher-applications/:id', async (req, res) => {
  if (!isSuper(req)) throw forbidden('Only a super admin can delete applications');
  const a = await load(req, String(req.params.id));
  if (a.status === 'approved' && a.userId && (await User.exists({ _id: a.userId, status: 'active' }))) throw conflict('Suspend the teacher account first, or keep the application as a record');
  await TeacherApplication.deleteOne({ _id: a._id });
  audit(req, 'teacher_application.delete', String(a._id), { status: a.status, userId: a.userId ? String(a.userId) : undefined }, { entityType: 'teacher_application', schoolId: a.schoolId ? String(a.schoolId) : undefined });
  res.status(204).end();
});

