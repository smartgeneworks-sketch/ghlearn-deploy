import { Router, type Request } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import * as S from '@ghlearn/shared';
import { School, User, StudentProfile, ClassGroup, RoleAssignment, Programme, Subject, SubjectCombination, XpEvent, Attempt, TutorMessage, AcademicLevel } from '../models/index.js';
import { authenticate, requireAnyPermission, requirePermission, isSuper } from '../middleware/index.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { listQuery, paginate, searchFilter } from '../lib/list.js';
import { grantRole, revokeRole } from '../services/roles.js';
import { invalidateSchoolStatus } from '../services/schools.js';
import { referencesOf, refError } from '../services/references.js';
import { parsePatch } from '../lib/patch.js';

/** Schools and Institutions (spec §6). Super admins manage every school; a School Admin sees and edits only their own. */
export const adminSchoolsRouter = Router();
adminSchoolsRouter.use('/schools', authenticate, requireAnyPermission('school:create', 'school:manage'));
const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const ownOnly = (req: Request, id: string) => { if (!isSuper(req) && req.auth!.schoolId !== id) throw forbidden('You can only manage your own school'); };
const load = async (req: Request, id: string) => { if (!mongoose.isValidObjectId(id)) throw notFound('School not found'); ownOnly(req, id); const s = await School.findById(id); if (!s) throw notFound('School not found'); return s; };

async function counts(ids: mongoose.Types.ObjectId[]) {
  const by = (rows: any[]) => new Map(rows.map((r) => [String(r._id), r.n as number]));
  const [students, teachers, admins, classes] = await Promise.all([
    StudentProfile.aggregate([{ $match: { schoolId: { $in: ids } } }, { $group: { _id: '$schoolId', n: { $sum: 1 } } }]),
    User.aggregate([{ $match: { schoolId: { $in: ids }, roles: 'teacher' } }, { $group: { _id: '$schoolId', n: { $sum: 1 } } }]),
    User.aggregate([{ $match: { schoolId: { $in: ids }, roles: 'school_admin' } }, { $group: { _id: '$schoolId', n: { $sum: 1 } } }]),
    ClassGroup.aggregate([{ $match: { schoolId: { $in: ids }, archived: false } }, { $group: { _id: '$schoolId', n: { $sum: 1 } } }])]);
  const m = { students: by(students), teachers: by(teachers), admins: by(admins), classes: by(classes) };
  return (id: unknown) => ({ students: m.students.get(String(id)) ?? 0, teachers: m.teachers.get(String(id)) ?? 0, admins: m.admins.get(String(id)) ?? 0, classes: m.classes.get(String(id)) ?? 0 });
}

const listQ = listQuery(['name', 'code', 'createdAt', 'status', 'region'] as const, { defaultSort: 'name' }).extend({
  status: z.enum(S.SCHOOL_STATUSES).optional(), region: z.enum(S.GHANA_REGIONS).optional(), type: z.enum(S.SCHOOL_TYPES).optional() });
adminSchoolsRouter.get('/schools', async (req, res) => {
  const p = listQ.parse(req.query);
  const f: any = { ...searchFilter(p.q, ['name', 'code', 'district']) };
  if (!isSuper(req)) f._id = req.auth!.schoolId ?? new mongoose.Types.ObjectId();
  if (p.status) f.status = p.status; if (p.region) f.region = p.region; if (p.type) f.type = p.type;
  const out = await paginate<any>(School, f, p);
  const c = await counts(out.items.map((s) => s._id));
  res.json({ ...out, items: out.items.map((s) => ({ ...s, counts: c(s._id) })) });
});

async function checkProgrammes(ids: string[] | undefined, levelKinds?: string[]) {
  if (!ids?.length) return;
  const ps = await Programme.find({ _id: { $in: ids } }).populate('levelId', 'kind').lean();
  if (ps.length !== new Set(ids).size) throw new AppError(422, 'VALIDATION', 'One or more Learning Areas do not exist');
  if (levelKinds && ps.some((p: any) => p.levelId && !levelKinds.includes(p.levelId.kind))) throw new AppError(422, 'VALIDATION', 'A Learning Area belongs to a level this school does not offer');
}

adminSchoolsRouter.post('/schools', requirePermission('school:create'), async (req, res) => {
  const b = S.schoolSchema.parse(req.body);
  await checkProgrammes(b.programmeIds, b.levelKinds);
  if (await School.exists({ code: b.code })) throw conflict(`Identifier ${b.code} is already used by another school`);
  const status = b.active === false ? 'suspended' : 'active';
  const s = await School.create({ ...b, status, active: status === 'active', statusChangedAt: new Date() });
  audit(req, 'school.create', String(s._id), undefined, { entityType: 'school', schoolId: String(s._id), after: s.toObject() });
  res.status(201).json({ school: s });
});

adminSchoolsRouter.get('/schools/:id', async (req, res) => {
  const s = await load(req, String(req.params.id)); const id = s._id; const since = new Date(Date.now() - 30 * 864e5);
  const studentIds = await StudentProfile.find({ schoolId: id }).distinct('userId');
  const [c, admins, programmes, combinations, active30, attempts30, tutor30, unlinked] = await Promise.all([
    counts([id]), RoleAssignment.find({ role: 'school_admin', scopeType: 'school', scopeId: id }).populate('userId', 'fullName email status lastLoginAt').lean(),
    Programme.find({ _id: { $in: s.programmeIds } }).select('name code active archivedAt').lean(),
    SubjectCombination.countDocuments({ schoolId: id, archivedAt: null }),
    XpEvent.distinct('userId', { schoolId: id, createdAt: { $gte: since } }).then((x) => x.length),
    Attempt.countDocuments({ userId: { $in: studentIds }, createdAt: { $gte: since } }),
    TutorMessage.countDocuments({ userId: { $in: studentIds }, role: 'user', createdAt: { $gte: since } }),
    User.countDocuments({ schoolId: id, roles: 'student', _id: { $nin: studentIds } })]);
  res.json({ school: s.toObject(), counts: { ...c(id), studentsNotOnboarded: unlinked }, admins: admins.filter((a: any) => a.userId).map((a: any) => ({ assignmentId: a._id, ...a.userId })),
    programmes, combinations, usage: { activeLearners30d: active30, attempts30d: attempts30, tutorQuestions30d: tutor30, note: 'Measured from recorded activity in the last 30 days.' },
    links: { analytics: `/admin/analytics?schoolId=${id}`, users: `/admin/users?schoolId=${id}`, classes: `/admin/classes?schoolId=${id}` } });
});

adminSchoolsRouter.patch('/schools/:id', requirePermission('school:manage'), async (req, res) => {
  const s = await load(req, String(req.params.id));
  const b: any = parsePatch(S.schoolSchema.omit({ active: true }), req.body, true);
  if (!isSuper(req)) { const bad = Object.keys(b).filter((k) => !(S.SCHOOL_ADMIN_EDITABLE as readonly string[]).includes(k)); if (bad.length) throw forbidden(`Only a super admin can change: ${bad.join(', ')}`); }
  await checkProgrammes(b.programmeIds, b.levelKinds ?? s.levelKinds);
  if (b.code && b.code !== s.code && (await School.exists({ code: b.code }))) throw conflict(`Identifier ${b.code} is already used by another school`);
  const before = s.toObject();
  s.set(b); await s.save();
  audit(req, 'school.update', String(s._id), undefined, { entityType: 'school', schoolId: String(s._id), ...diff(before as any, s.toObject() as any, Object.keys(b)) });
  res.json({ school: s });
});

/** Activate, suspend or archive (super admin). Suspended and archived schools lock their members out at once. */
adminSchoolsRouter.post('/schools/:id/status', requirePermission('school:create'), async (req, res) => {
  const b = S.schoolStatusSchema.parse(req.body);
  const s = await load(req, String(req.params.id));
  if (s.status === b.status) throw conflict(`The school is already ${b.status}`);
  const before = s.status;
  s.status = b.status; s.active = b.status === 'active'; s.statusReason = b.reason; s.statusChangedAt = new Date(); await s.save();
  invalidateSchoolStatus(String(s._id));
  const action = { active: 'school.activate', suspended: 'school.suspend', archived: 'school.archive' }[b.status];
  audit(req, action, String(s._id), b.reason ? { reason: b.reason } : undefined, { entityType: 'school', schoolId: String(s._id), before: { status: before }, after: { status: b.status } });
  res.json({ school: s, affectedUsers: await User.countDocuments({ schoolId: s._id }) });
});

adminSchoolsRouter.post('/schools/:id/admins', requirePermission('school:create'), async (req, res) => {
  const b = z.object({ userId: oid }).strict().parse(req.body); const s = await load(req, String(req.params.id));
  const u = await User.findById(b.userId).select('schoolId'); if (!u) throw notFound('User not found');
  if (u.schoolId && String(u.schoolId) !== String(s._id)) throw conflict('This user belongs to another school; move them first');
  res.status(201).json(await grantRole(req, b.userId, 'school_admin', String(s._id)));
});
adminSchoolsRouter.delete('/schools/:id/admins/:userId', requirePermission('school:create'), async (req, res) => {
  const s = await load(req, String(req.params.id));
  const a = await RoleAssignment.findOne({ userId: oid.parse(req.params.userId), role: 'school_admin', scopeType: 'school', scopeId: s._id }); if (!a) throw notFound('This user is not an admin of this school');
  res.json(await revokeRole(req, String(a._id)));
});

/** Subject combinations: platform-wide ones for the school's Learning Areas plus the school's own (spec §6, §15). */
adminSchoolsRouter.get('/schools/:id/combinations', async (req, res) => {
  const s = await load(req, String(req.params.id));
  const q = z.object({ archived: z.enum(['include', 'only']).optional() }).parse(req.query);
  const arch = q.archived === 'only' ? { archivedAt: { $ne: null } } : q.archived === 'include' ? {} : { archivedAt: null };
  const prog = s.programmeIds.length ? { programmeId: { $in: s.programmeIds } } : {};
  const items = await SubjectCombination.find({ ...arch, $or: [{ schoolId: s._id }, { schoolId: null, ...prog }] }).populate('programmeId', 'name').populate('subjectIds', 'name category').sort({ order: 1, name: 1 }).lean();
  res.json({ items: items.map((c: any) => ({ ...c, scope: c.schoolId ? 'school' : 'platform' })) });
});
async function checkCombination(s: any, b: { programmeId?: string; subjectIds?: string[]; yearOfStudy?: number | null }, current?: any) {
  const programmeId = b.programmeId ?? String(current?.programmeId ?? '');
  const p = await Programme.findById(programmeId).lean(); if (!p) throw new AppError(422, 'VALIDATION', 'Learning Area not found');
  if (s.programmeIds.length && !s.programmeIds.map(String).includes(programmeId)) throw new AppError(422, 'VALIDATION', 'This school does not offer that Learning Area');
  const ids = b.subjectIds ?? (current?.subjectIds ?? []).map(String);
  if ((await Subject.countDocuments({ _id: { $in: ids }, levelId: p.levelId, archivedAt: null })) !== new Set(ids).size) throw new AppError(422, 'VALIDATION', 'Every subject must belong to the Learning Area\'s level');
  const lv = await AcademicLevel.findById(p.levelId).select('years').lean();
  if (b.yearOfStudy && lv && b.yearOfStudy > lv.years) throw new AppError(422, 'VALIDATION', `This level has only ${lv.years} years`);
}
adminSchoolsRouter.post('/schools/:id/combinations', requirePermission('school:manage'), async (req, res) => {
  const s = await load(req, String(req.params.id));
  const b = S.combinationSchema.omit({ schoolId: true }).parse(req.body);
  await checkCombination(s, b);
  const c = await SubjectCombination.create({ ...b, schoolId: s._id });
  audit(req, 'combination.create', String(c._id), undefined, { entityType: 'combination', schoolId: String(s._id), after: c.toObject() }); res.status(201).json({ combination: c });
});
const schoolCombo = async (req: Request) => {
  const s = await load(req, String(req.params.id));
  const c = await SubjectCombination.findOne({ _id: oid.parse(req.params.cid), schoolId: s._id }); if (!c) throw notFound('Combination not found for this school (platform combinations are edited in Academic Structure)');
  return { s, c };
};
adminSchoolsRouter.patch('/schools/:id/combinations/:cid', requirePermission('school:manage'), async (req, res) => {
  const { s, c } = await schoolCombo(req);
  const b: any = parsePatch(S.combinationSchema.omit({ schoolId: true }), req.body, true); await checkCombination(s, b, c);
  const before = c.toObject(); c.set(b); await c.save();
  audit(req, 'combination.update', String(c._id), undefined, { entityType: 'combination', schoolId: String(s._id), ...diff(before as any, c.toObject() as any, Object.keys(b)) }); res.json({ combination: c });
});
for (const op of ['archive', 'restore'] as const) adminSchoolsRouter.post(`/schools/:id/combinations/:cid/${op}`, requirePermission('school:manage'), async (req, res) => {
  const { s, c } = await schoolCombo(req); const archive = op === 'archive';
  c.archivedAt = archive ? new Date() : undefined; c.archivedBy = archive ? (req.auth!.userId as any) : undefined; await c.save();
  audit(req, `combination.${op}`, String(c._id), undefined, { entityType: 'combination', schoolId: String(s._id) }); res.json({ combination: c });
});
adminSchoolsRouter.delete('/schools/:id/combinations/:cid', requirePermission('school:manage'), async (req, res) => {
  const { s, c } = await schoolCombo(req);
  const refs = await referencesOf('combinations', c._id); if (refs.length) throw refError(refs);
  await c.deleteOne(); audit(req, 'combination.delete', String(c._id), undefined, { entityType: 'combination', schoolId: String(s._id), before: c.toObject() }); res.status(204).end();
});
