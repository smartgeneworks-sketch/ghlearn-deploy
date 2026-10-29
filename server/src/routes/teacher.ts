import { getSettings } from '../services/platformSettings.js';
import { audienceFilter } from '../services/eligibility.js';
import { Router } from 'express';
import { z } from 'zod';
import { ClassGroup, Assessment, StudentProfile, User, Subject, School, TeacherAssignment, Notification, NotificationPreference, NOTIFICATION_CATEGORIES, type NotificationCategory } from '../models/index.js';
import { authenticate, requirePermission, requireSubjectAccess, isSuper } from '../middleware/index.js';
import { badRequest, notFound, AppError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { classFilter, loadClass, checkMembers, classOverview, studentDetail, remedialQuestions, offlineContent } from '../services/teach/classes.js';
import { classCsv, classPdf, offlineHtml } from '../services/teach/reports.js';
import { notify, inboxFilter, prefsOf, MANDATORY, SMS_CATEGORIES } from '../services/notify.js';
import { smsAvailable } from '../services/sms.js';
import { emailConfigured } from '../services/mailer.js';
import { staffReset } from '../services/passwordReset.js';

const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const slug = (s: string) => s.replace(/[^\w-]+/g, '_').slice(0, 40);
export const teacherRouter = Router();
teacherRouter.use(authenticate, requirePermission('class:manage'));

teacherRouter.get('/subjects', async (req, res) => {
  const ts = await TeacherAssignment.find(isSuper(req) ? {} : req.auth!.roles.includes('school_admin') ? { schoolId: req.auth!.schoolId } : { teacherId: req.auth!.userId }).populate('subjectId', 'name code').lean();
  res.json({ items: ts });
});
teacherRouter.get('/classes', async (req, res) => {
  const q = z.object({ archived: z.enum(['true', 'false']).optional() }).parse(req.query);
  const items = await ClassGroup.find({ ...classFilter(req.auth!), archived: q.archived === 'true' }).populate('subjectId', 'name code').populate('teacherIds', 'fullName').sort({ name: 1 }).lean();
  res.json({ items: items.map((c) => ({ ...c, studentCount: c.studentIds.length, studentIds: undefined })) });
});
const classBody = z.object({ name: z.string().trim().min(2).max(80), subjectId: oid.optional(), yearOfStudy: z.number().int().min(1).max(4).optional(), studentIds: z.array(oid).max(200).default([]), teacherIds: z.array(oid).max(10).default([]), schoolId: oid.optional() }).strict();
teacherRouter.post('/classes', async (req, res) => {
  const b = classBody.parse(req.body);
  const schoolId = isSuper(req) ? b.schoolId : req.auth!.schoolId; if (!schoolId) throw badRequest('schoolId is required');
  const isTeacher = !isSuper(req) && !req.auth!.roles.includes('school_admin');
  if (isTeacher && !b.subjectId) throw badRequest('Choose the subject you teach this class');
  const teacherIds = [...new Set([...(isTeacher ? [req.auth!.userId] : []), ...b.teacherIds])];
  await checkMembers(req.auth!, schoolId, b.subjectId, b.studentIds, teacherIds.filter((t) => t !== req.auth!.userId || !isTeacher));
  const c = await ClassGroup.create({ ...b, schoolId, teacherIds, studentIds: [...new Set(b.studentIds)], createdBy: req.auth!.userId });
  audit(req, 'class.create', String(c._id), { name: b.name, students: b.studentIds.length }); res.status(201).json({ class: c });
});
teacherRouter.patch('/classes/:id', async (req, res) => {
  const c = await loadClass(req.auth!, String(req.params.id));
  const b = z.object({ name: z.string().trim().min(2).max(80).optional(), yearOfStudy: z.number().int().min(1).max(4).nullable().optional(), archived: z.boolean().optional(),
    addStudents: z.array(oid).max(200).optional(), removeStudents: z.array(oid).max(200).optional(), addTeachers: z.array(oid).max(10).optional(), removeTeachers: z.array(oid).max(10).optional() }).strict().parse(req.body);
  await checkMembers(req.auth!, String(c.schoolId), c.subjectId ? String(c.subjectId) : undefined, b.addStudents ?? [], b.addTeachers ?? []);
  if (b.name) c.name = b.name; if (b.yearOfStudy !== undefined) c.yearOfStudy = b.yearOfStudy as any; if (b.archived !== undefined) c.archived = b.archived;
  const set = (cur: any[], add: string[] = [], rm: string[] = []) => [...new Set([...cur.map(String), ...add])].filter((x) => !rm.includes(x));
  c.studentIds = set(c.studentIds, b.addStudents, b.removeStudents) as any; c.teacherIds = set(c.teacherIds, b.addTeachers, b.removeTeachers) as any;
  if (!c.teacherIds.length && !isSuper(req) && !req.auth!.roles.includes('school_admin')) throw badRequest('A class needs at least one teacher');
  await c.save(); audit(req, 'class.update', String(c._id), b); res.json({ class: c });
});
/** Students who could be added: same school, taking the subject, matching year when set. Names only. */
teacherRouter.get('/classes/:id/candidates', async (req, res) => {
  const c = await loadClass(req.auth!, String(req.params.id));
  const ps = await StudentProfile.find({ schoolId: c.schoolId, ...(c.subjectId ? { subjectIds: c.subjectId } : {}), ...(c.yearOfStudy ? { yearOfStudy: c.yearOfStudy } : {}), userId: { $nin: c.studentIds } }).populate({ path: 'userId', select: 'fullName', match: { status: 'active' } }).limit(500).lean();
  // Suspended or archived students are not offered (populate leaves userId null; filtered below).
  res.json({ items: ps.map((p: any) => ({ userId: p.userId?._id, name: p.userId?.fullName, yearOfStudy: p.yearOfStudy })).filter((x) => x.userId) });
});
teacherRouter.get('/classes/:id', async (req, res) => {
  const c = await loadClass(req.auth!, String(req.params.id)); await c.populate('subjectId', 'name code');
  res.json(await classOverview(c.toObject()));
});
teacherRouter.get('/classes/:id/students/:userId', async (req, res) => {
  const c = await loadClass(req.auth!, String(req.params.id)); res.json(await studentDetail(c.toObject(), oid.parse(req.params.userId)));
});
/**
 * Staff-assisted password reset for a student in one of the caller's classes (teachers: only classes they teach; school
 * admins: their school's classes). Conservative: the target must hold only the student role and be active.
 */
teacherRouter.post('/classes/:id/students/:userId/password-reset', async (req, res) => {
  const c = await loadClass(req.auth!, String(req.params.id)); const userId = oid.parse(req.params.userId);
  const { mode } = z.object({ mode: z.enum(['link', 'temporary']) }).strict().parse(req.body);
  if (!c.studentIds.map(String).includes(userId)) throw notFound('Student not found in this class');
  const u = await User.findById(userId).select('roles status schoolId').lean(); if (!u) throw notFound('Student not found in this class');
  if (userId === req.auth!.userId || !u.roles.length || u.roles.some((r) => r !== 'student')) throw new AppError(403, 'FORBIDDEN', 'Teachers can only reset student accounts');
  const r = await staffReset(req, u as any, mode, 'teacher'); res.set('Cache-Control', 'no-store').json(r);
});
teacherRouter.get('/classes/:id/report.:fmt', async (req, res) => {
  const fmt = z.enum(['csv', 'pdf']).parse(req.params.fmt); const c = await loadClass(req.auth!, String(req.params.id));
  const o = await classOverview(c.toObject()); const name = `class-report-${slug(c.name)}-${new Date().toISOString().slice(0, 10)}`;
  audit(req, 'report.export', String(c._id), { format: fmt, kind: 'class' });
  if (fmt === 'csv') return void res.type('text/csv').attachment(`${name}.csv`).send(classCsv(o));
  const [subj, school] = await Promise.all([c.subjectId ? Subject.findById(c.subjectId).select('name').lean() : null, School.findById(c.schoolId).select('name').lean()]);
  res.type('application/pdf').attachment(`${name}.pdf`).send(await classPdf(o, { subject: subj?.name, school: school?.name }));
});
/** One-click remedial assignment on a weak topic, for the whole class or listed students' class. */
teacherRouter.post('/classes/:id/remedial', async (req, res) => {
  const c = await loadClass(req.auth!, String(req.params.id)); if (!c.subjectId) throw badRequest('Class has no subject');
  const b = z.object({ topic: z.string().min(1).max(200), count: z.number().int().min(3).max(20).default(8), closesAt: z.coerce.date().optional() }).strict().parse(req.body);
  const qs = await remedialQuestions(String(c.subjectId), b.topic, b.count); if (qs.length < 3) throw badRequest('Not enough published questions on this topic (need 3)');
  const a = await Assessment.create({ title: `Remedial: ${b.topic}`, subjectId: c.subjectId, schoolId: c.schoolId, yearOfStudy: c.yearOfStudy, classId: c._id, mode: 'assigned', questionIds: qs, maxAttempts: 3, randomize: true, closesAt: b.closesAt, createdBy: req.auth!.userId });
  await notify(c.studentIds, { type: 'assignment.new', title: `Remedial practice: ${b.topic}`, body: 'Your teacher set extra practice to help with this topic.', link: `/learn/${c.subjectId}/practice` });
  audit(req, 'assessment.create', String(a._id), { remedial: true, classId: String(c._id) }); res.status(201).json({ assessment: a });
});

/** Offline pack: a single self-contained HTML file of published materials (any role with subject access). */
export const offlineRouter = Router();
offlineRouter.get('/:subjectId', authenticate, requireSubjectAccess('subjectId'), async (req, res) => {
  const off = (await getSettings()).offline; // §20 offline-download policy
  if (!off.bundleEnabled) throw new AppError(403, 'FEATURE_DISABLED', 'Offline downloads are switched off on this platform');
  const s = await Subject.findById(req.params.subjectId).lean(); if (!s) throw notFound('Subject not found');
  const html = offlineHtml(s as any, await offlineContent(String(s._id), await audienceFilter(req.auth!), off.bundleMaxResources));
  audit(req, 'offline.download', String(s._id));
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").type('text/html').attachment(`${slug(s.name)}-offline.html`).send(html);
});

/** Notifications: owner-only. */
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);
notificationsRouter.get('/', async (req, res) => {
  const q = z.object({ unread: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
  
  const f: any = { ...inboxFilter(req.auth!.userId), ...(q.unread === 'true' ? { readAt: null } : {}) };
  const [items, unread] = await Promise.all([Notification.find(f).sort({ createdAt: -1 }).limit(q.limit).select('-delivery.emailError').lean(), Notification.countDocuments({ ...inboxFilter(req.auth!.userId), readAt: null })]);
  res.json({ items, unread });
});
/** §18 preferences: in-app and email per category. Security alerts cannot be switched off in the app. */
notificationsRouter.get('/preferences', async (req, res) => {
  const p = (await prefsOf([req.auth!.userId]))(req.auth!.userId);
  res.json({ categories: Object.entries(NOTIFICATION_CATEGORIES).map(([key, label]) => ({ key, label, ...p[key as NotificationCategory], mandatoryInApp: MANDATORY.includes(key as NotificationCategory), smsCapable: SMS_CATEGORIES.includes(key as NotificationCategory) })), emailConfigured: emailConfigured(),
    sms: { available: await smsAvailable(), phoneVerified: !!(await User.exists({ _id: req.auth!.userId, phoneVerifiedAt: { $type: 'date' } })) } });
});
notificationsRouter.put('/preferences', async (req, res) => {
  const keys = Object.keys(NOTIFICATION_CATEGORIES) as [NotificationCategory, ...NotificationCategory[]];
  const b = z.object({ categories: z.partialRecord(z.enum(keys), z.object({ inApp: z.boolean().optional(), email: z.boolean().optional(), sms: z.boolean().optional() }).strict()) }).strict().parse(req.body);
  const cur = (await prefsOf([req.auth!.userId]))(req.auth!.userId); const next = { ...cur };
  for (const [k, v] of Object.entries(b.categories) as [NotificationCategory, any][]) next[k] = { ...cur[k], ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
  for (const k of Object.keys(next) as NotificationCategory[]) if (!SMS_CATEGORIES.includes(k)) next[k].sms = false;
  for (const k of MANDATORY) next[k].inApp = true;
  await NotificationPreference.updateOne({ userId: req.auth!.userId }, { $set: { categories: next } }, { upsert: true });
  res.json({ ok: true });
});
notificationsRouter.post('/read', async (req, res) => {
  const b = z.object({ ids: z.array(oid).max(100).optional(), all: z.boolean().optional() }).strict().parse(req.body);
  
  const r = await Notification.updateMany({ ...inboxFilter(req.auth!.userId), readAt: null, ...(b.all ? {} : { _id: { $in: b.ids ?? [] } }) }, { readAt: new Date() });
  res.json({ updated: r.modifiedCount });
});
void User;
