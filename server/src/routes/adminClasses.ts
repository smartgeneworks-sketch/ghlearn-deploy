import { Router, type Request } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import * as S from '@ghlearn/shared';
import { ClassGroup, User, StudentProfile, Subject, AcademicYear, Programme, School, TeacherAssignment, Assessment, AcademicLevel, ImportBatch } from '../models/index.js';
import { authenticate, requirePermission, isSuper } from '../middleware/index.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { listQuery, paginate, searchFilter, escapeRx } from '../lib/list.js';
import { parsePatch } from '../lib/patch.js';
import * as Imp from '../services/enrolmentImport.js';

/**
 * Classes and Enrolments (spec §15) for School Admins (own school) and Super Admins. Teachers keep their own class
 * tools under /api/teacher. Enrolment always requires a student of the same school; nothing is overwritten silently.
 */
export const adminClassesRouter = Router();
for (const p of ['/classes', '/imports']) adminClassesRouter.use(p, authenticate, requirePermission('users:manage'), requirePermission('class:manage'));
const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const noStore = (res: any) => res.set('Cache-Control', 'no-store');

/** School the caller acts on: a School Admin's own, or the one a Super Admin names. */
async function schoolFor(req: Request, requested?: string) {
  if (!isSuper(req)) {
    if (requested && requested !== req.auth!.schoolId) throw forbidden('You can only manage classes of your own school');
    if (!req.auth!.schoolId) throw forbidden('Your account is not linked to a school'); return req.auth!.schoolId;
  }
  if (!requested) throw new AppError(422, 'VALIDATION', 'Choose a school'); if (!(await School.exists({ _id: requested }))) throw notFound('School not found');
  return requested;
}
async function loadClass(req: Request, id: string) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Class not found');
  const c = await ClassGroup.findOne({ _id: id, ...(isSuper(req) ? {} : { schoolId: req.auth!.schoolId ?? new mongoose.Types.ObjectId() }) } as any);
  if (!c) throw notFound('Class not found'); return c;
}
async function checkRefs(schoolId: string, b: { subjectId?: string | null; academicYearId?: string | null; programmeId?: string | null; teacherIds?: string[] }) {
  if (b.subjectId && !(await Subject.exists({ _id: b.subjectId, archivedAt: null }))) throw new AppError(422, 'VALIDATION', 'Subject not found');
  if (b.academicYearId && !(await AcademicYear.exists({ _id: b.academicYearId, archivedAt: null }))) throw new AppError(422, 'VALIDATION', 'Academic year not found');
  if (b.programmeId) {
    const [p, s] = await Promise.all([Programme.findById(b.programmeId).select('archivedAt').lean(), School.findById(schoolId).select('programmeIds').lean()]);
    if (!p || p.archivedAt) throw new AppError(422, 'VALIDATION', 'Learning Area not found');
    if (s?.programmeIds?.length && !s.programmeIds.map(String).includes(b.programmeId)) throw new AppError(422, 'VALIDATION', 'This school does not offer that Learning Area');
  }
  if (b.teacherIds?.length && (await User.countDocuments({ _id: { $in: b.teacherIds }, schoolId, roles: 'teacher' })) !== new Set(b.teacherIds).size) throw forbidden('Every teacher must be a teacher at this school');
}
/** A teacher added to a subject class gets that subject's teaching assignment if missing (reported back, never silent). */
async function ensureAssignments(schoolId: string, subjectId: unknown, teacherIds: string[], className: string) {
  if (!subjectId) return 0; let n = 0;
  for (const t of teacherIds) if (!(await TeacherAssignment.exists({ teacherId: t, subjectId, schoolId }))) { await TeacherAssignment.create({ teacherId: t, subjectId, schoolId, classGroup: className } as any); n++; }
  return n;
}
const nameClash = async (schoolId: unknown, name: string, academicYearId: unknown, not?: unknown) =>
  ClassGroup.exists(<any>{ schoolId, archived: false, name: new RegExp(`^${escapeRx(name.trim())}$`, 'i'), academicYearId: academicYearId ?? null, ...(not ? { _id: { $ne: not } } : {}) });

const listQ = listQuery(['name', 'createdAt', 'yearOfStudy'] as const, { defaultSort: 'name' }).extend({
  schoolId: oid.optional(), academicYearId: oid.optional(), subjectId: oid.optional(), teacherId: oid.optional(), yearOfStudy: z.coerce.number().int().min(1).max(6).optional(), archived: z.enum(['true', 'false', 'all']).optional() });
function listFilter(req: Request, p: z.infer<typeof listQ>) {
  const f: any = { ...searchFilter(p.q, ['name']) };
  if (!isSuper(req)) { if (p.schoolId && p.schoolId !== req.auth!.schoolId) throw forbidden('You can only list classes of your own school'); f.schoolId = req.auth!.schoolId ?? new mongoose.Types.ObjectId(); }
  else if (p.schoolId) f.schoolId = p.schoolId;
  if (p.academicYearId) f.academicYearId = p.academicYearId; if (p.subjectId) f.subjectId = p.subjectId; if (p.teacherId) f.teacherIds = p.teacherId; if (p.yearOfStudy) f.yearOfStudy = p.yearOfStudy;
  if (p.archived !== 'all') f.archived = p.archived === 'true';
  return f;
}
adminClassesRouter.get('/classes', async (req, res) => {
  const p = listQ.parse(req.query);
  const out = await paginate<any>(ClassGroup, listFilter(req, p), p, (q) => q.populate('subjectId', 'name').populate('academicYearId', 'label').populate('programmeId', 'name').populate('schoolId', 'name').populate('teacherIds', 'fullName'));
  res.json({ ...out, items: out.items.map((c) => ({ ...c, studentCount: c.studentIds.length, studentIds: undefined })) });
});
adminClassesRouter.post('/classes', async (req, res) => {
  const b = S.classSchema.parse(req.body); const schoolId = await schoolFor(req, b.schoolId);
  await checkRefs(schoolId, b);
  if (await nameClash(schoolId, b.name, b.academicYearId)) throw conflict('A class with this name already exists for this academic year');
  const c = await ClassGroup.create({ ...b, schoolId, teacherIds: [...new Set(b.teacherIds)], studentIds: [], createdBy: req.auth!.userId });
  const assignmentsCreated = await ensureAssignments(schoolId, b.subjectId, b.teacherIds, b.name);
  audit(req, 'class.create', String(c._id), { assignmentsCreated }, { entityType: 'class', schoolId, after: c.toObject() });
  res.status(201).json({ class: c, assignmentsCreated });
});
adminClassesRouter.get('/classes/export.csv', async (req, res) => {
  const p = listQ.parse(req.query); const f = listFilter(req, p);
  const cs = await ClassGroup.find(f).sort({ name: 1 }).limit(2000).populate('subjectId', 'name').populate('academicYearId', 'label').populate('schoolId', 'name').populate('teacherIds', 'fullName').lean();
  const ids = [...new Set(cs.flatMap((c) => c.studentIds.map(String)))];
  const [us, ps] = await Promise.all([User.find({ _id: { $in: ids } }).select('fullName email status').lean(), StudentProfile.find({ userId: { $in: ids } }).select('userId yearOfStudy programmeId').populate('programmeId', 'name').lean()]);
  const um = new Map(us.map((u) => [String(u._id), u])); const pm = new Map(ps.map((x: any) => [String(x.userId), x]));
  const rows: unknown[][] = [];
  for (const c of cs as any[]) for (const sid of c.studentIds.map(String)) { const u = um.get(sid); const pr = pm.get(sid); if (u) rows.push([c.schoolId?.name, c.name, c.academicYearId?.label, c.yearOfStudy, c.subjectId?.name, c.teacherIds.map((t: any) => t.fullName).join('; '), u.fullName, u.email, u.status, pr?.yearOfStudy, pr?.programmeId?.name, c.archived ? 'archived' : 'active']); }
  audit(req, 'report.export', 'enrolments', { format: 'csv', rows: rows.length, classes: cs.length }, { entityType: 'class' });
  noStore(res); res.type('text/csv').attachment(`enrolments-${new Date().toISOString().slice(0, 10)}.csv`)
    .send(Imp.toCsvRows(['School', 'Class', 'Academic year', 'Year', 'Subject', 'Teachers', 'Student', 'Email', 'Account status', 'Profile year', 'Learning Area', 'Class status'], rows));
});

/** Academic-year change: promote every class of one year into the next (preview first, then apply). */
adminClassesRouter.post('/classes/rollover', async (req, res) => {
  const b = z.object({ schoolId: oid.optional(), fromAcademicYearId: oid, toAcademicYearId: oid, dryRun: z.boolean().prefault(true) }).strict().parse(req.body);
  const schoolId = await schoolFor(req, b.schoolId);
  if (b.fromAcademicYearId === b.toAcademicYearId) throw new AppError(422, 'VALIDATION', 'Choose two different academic years');
  const [from, to] = await Promise.all([AcademicYear.findById(b.fromAcademicYearId).lean(), AcademicYear.findById(b.toAcademicYearId).lean()]);
  if (!from || !to) throw notFound('Academic year not found'); if (to.archivedAt) throw conflict('The target academic year is archived');
  if (from.startDate && to.startDate && to.startDate <= from.startDate) throw new AppError(422, 'VALIDATION', 'The target year must start after the source year');
  const cs = await ClassGroup.find({ schoolId, academicYearId: from._id, archived: false }).lean();
  const done = new Set((await ClassGroup.find({ rolledFromId: { $in: cs.map((c) => c._id) } }).distinct('rolledFromId')).map(String));
  const levelYears = async (c: any) => {
    const lid = c.programmeId ? (await Programme.findById(c.programmeId).select('levelId').lean())?.levelId : c.subjectId ? (await Subject.findById(c.subjectId).select('levelId').lean())?.levelId : null;
    return (lid ? (await AcademicLevel.findById(lid).select('years').lean())?.years : null) ?? 3;
  };
  const plan: any[] = [];
  for (const c of cs) {
    const max = await levelYears(c); const y = c.yearOfStudy ?? null;
    const action = done.has(String(c._id)) ? 'skip' : y && y >= max ? 'graduate' : 'promote';
    const newName = y && new RegExp(`^${y}(?=\\D)`).test(c.name) ? c.name.replace(new RegExp(`^${y}`), String(y + 1)) : c.name;
    plan.push({ classId: c._id, name: c.name, yearOfStudy: y, students: c.studentIds.length, action, ...(action === 'promote' ? { newName, newYearOfStudy: y ? y + 1 : null } : {}), ...(action === 'skip' ? { reason: 'Already rolled over' } : {}) });
  }
  const summary = { classes: plan.length, promote: plan.filter((p) => p.action === 'promote').length, graduate: plan.filter((p) => p.action === 'graduate').length, skip: plan.filter((p) => p.action === 'skip').length,
    graduatingStudents: plan.filter((p) => p.action === 'graduate').reduce((n, p) => n + p.students, 0) };
  if (b.dryRun) return res.json({ dryRun: true, from: from.label, to: to.label, plan, summary });
  let created = 0, promoted = 0;
  for (const p of plan) {
    const c = cs.find((x) => String(x._id) === String(p.classId))!;
    if (p.action === 'promote') {
      if (await nameClash(schoolId, p.newName, to._id)) { p.action = 'skip'; p.reason = `A class named "${p.newName}" already exists in ${to.label}`; continue; }
      await ClassGroup.create({ schoolId, name: p.newName, subjectId: c.subjectId, programmeId: c.programmeId, yearOfStudy: p.newYearOfStudy ?? undefined, academicYearId: to._id, teacherIds: c.teacherIds, studentIds: c.studentIds, rolledFromId: c._id, createdBy: req.auth!.userId });
      created++;
      if (c.yearOfStudy) promoted += (await StudentProfile.updateMany({ userId: { $in: c.studentIds }, schoolId, yearOfStudy: c.yearOfStudy }, { $set: { yearOfStudy: c.yearOfStudy + 1 } })).modifiedCount;
    }
    if (p.action !== 'skip') await ClassGroup.updateOne({ _id: c._id }, { archived: true });
  }
  audit(req, 'class.rollover', undefined, { ...summary, created, promotedProfiles: promoted }, { entityType: 'class', schoolId, before: { academicYear: from.label }, after: { academicYear: to.label } });
  res.json({ dryRun: false, from: from.label, to: to.label, plan, summary: { ...summary, created, promotedProfiles: promoted } });
});

adminClassesRouter.get('/classes/:id', async (req, res) => {
  const c = await loadClass(req, String(req.params.id));
  await c.populate([{ path: 'subjectId', select: 'name' }, { path: 'academicYearId', select: 'label' }, { path: 'programmeId', select: 'name' }, { path: 'schoolId', select: 'name' }, { path: 'teacherIds', select: 'fullName email status' }]);
  const [us, ps, assessments] = await Promise.all([User.find({ _id: { $in: c.studentIds } }).select('fullName email status lastLoginAt').sort({ fullName: 1 }).lean(),
    StudentProfile.find({ userId: { $in: c.studentIds } }).select('userId yearOfStudy programmeId subjectIds').populate('programmeId', 'name').lean(), Assessment.countDocuments({ classId: c._id })]);
  const pm = new Map(ps.map((p: any) => [String(p.userId), p])); const subj = (c.subjectId as any)?._id ? String((c.subjectId as any)._id) : null;
  res.json({ class: { ...c.toObject(), studentIds: undefined, studentCount: c.studentIds.length }, assessments,
    students: us.map((u) => { const p: any = pm.get(String(u._id)); return { ...u, onboarded: !!p, yearOfStudy: p?.yearOfStudy ?? null, learningArea: p?.programmeId?.name ?? null, subjects: p?.subjectIds?.length ?? 0, takesSubject: subj ? !!p?.subjectIds?.map(String).includes(subj) : null }; }) });
});
adminClassesRouter.patch('/classes/:id', async (req, res) => {
  const c = await loadClass(req, String(req.params.id));
  const b: any = parsePatch(S.classSchema.omit({ schoolId: true, teacherIds: true }).extend({ archived: z.boolean().optional() }), req.body, true);
  if (c.archived && b.archived !== false) throw conflict('Restore this class before editing it');
  if ('subjectId' in b && String(b.subjectId ?? '') !== String(c.subjectId ?? '') && c.studentIds.length) throw conflict('Remove the students before changing the subject of a class');
  await checkRefs(String(c.schoolId), b);
  if ((b.name || 'academicYearId' in b) && b.archived !== true && (await nameClash(c.schoolId, b.name ?? c.name, 'academicYearId' in b ? b.academicYearId : c.academicYearId, c._id))) throw conflict('A class with this name already exists for this academic year');
  const before = c.toObject(); c.set(b); await c.save();
  const action = b.archived === true ? 'class.archive' : b.archived === false ? 'class.restore' : 'class.update';
  audit(req, action, String(c._id), undefined, { entityType: 'class', schoolId: String(c.schoolId), ...diff(before as any, c.toObject() as any, Object.keys(b)) }); res.json({ class: c });
});
adminClassesRouter.delete('/classes/:id', async (req, res) => {
  const c = await loadClass(req, String(req.params.id));
  const n = await Assessment.countDocuments({ classId: c._id });
  if (c.studentIds.length || n) throw new AppError(409, 'IN_USE', `Still in use by ${[c.studentIds.length && `${c.studentIds.length} enrolled students`, n && `${n} assessments`].filter(Boolean).join(', ')}. Archive it instead.`, { references: [{ label: 'enrolled students', count: c.studentIds.length }, { label: 'assessments', count: n }].filter((r) => r.count) });
  await c.deleteOne(); audit(req, 'class.delete', String(c._id), undefined, { entityType: 'class', schoolId: String(c.schoolId), before: { name: c.name } }); res.status(204).end();
});
adminClassesRouter.post('/classes/:id/teachers', async (req, res) => {
  const c = await loadClass(req, String(req.params.id)); if (c.archived) throw conflict('This class is archived');
  const b = z.object({ teacherId: oid }).strict().parse(req.body);
  if (c.teacherIds.map(String).includes(b.teacherId)) throw conflict('This teacher already teaches the class');
  await checkRefs(String(c.schoolId), { teacherIds: [b.teacherId] });
  c.teacherIds.push(b.teacherId as any); await c.save();
  const assignmentsCreated = await ensureAssignments(String(c.schoolId), c.subjectId, [b.teacherId], c.name);
  audit(req, 'class.teacher.add', String(c._id), { teacherId: b.teacherId, assignmentsCreated }, { entityType: 'class', schoolId: String(c.schoolId) }); res.status(201).json({ ok: true, assignmentsCreated });
});
adminClassesRouter.delete('/classes/:id/teachers/:teacherId', async (req, res) => {
  const c = await loadClass(req, String(req.params.id)); const t = oid.parse(req.params.teacherId);
  if (!c.teacherIds.map(String).includes(t)) throw notFound('This teacher does not teach the class');
  c.teacherIds = c.teacherIds.filter((x) => String(x) !== t) as any; await c.save();
  audit(req, 'class.teacher.remove', String(c._id), { teacherId: t }, { entityType: 'class', schoolId: String(c.schoolId) }); res.status(204).end();
});
/** Students of the class's school who could be enrolled (search by name or email). */
adminClassesRouter.get('/classes/:id/candidates', async (req, res) => {
  const c = await loadClass(req, String(req.params.id)); const q = z.object({ q: z.string().trim().max(80).optional() }).parse(req.query);
  const pf: any = { schoolId: c.schoolId, userId: { $nin: c.studentIds }, ...(c.subjectId ? { subjectIds: c.subjectId } : {}) };
  const pids = await StudentProfile.find(pf).distinct('userId');
  const us = await User.find({ _id: { $in: pids }, roles: 'student', status: 'active', ...searchFilter(q.q, ['fullName', 'email']) }).select('fullName email').sort({ fullName: 1 }).limit(20).lean();
  res.json({ items: us, note: c.subjectId ? 'Only students at this school who take the class subject are listed.' : 'Only onboarded students at this school are listed.' });
});
async function checkStudents(c: any, ids: string[]) {
  const us = await User.find({ _id: { $in: ids }, roles: 'student' }).select('schoolId').lean();
  const ps = await StudentProfile.find({ userId: { $in: ids } }).select('userId schoolId subjectIds').lean(); const pm = new Map(ps.map((p) => [String(p.userId), p]));
  const bad = ids.filter((id) => { const u = us.find((x) => String(x._id) === id); const p = pm.get(id); return !u || (String(u.schoolId ?? '') !== String(c.schoolId) && String(p?.schoolId ?? '') !== String(c.schoolId)); });
  if (bad.length) throw forbidden(`${bad.length} of the selected accounts are not students at this school`);
  if (c.subjectId) { const no = ids.filter((id) => !pm.get(id)?.subjectIds?.map(String).includes(String(c.subjectId))); if (no.length) throw forbidden(`${no.length} of the selected students do not take this class's subject`); }
}
adminClassesRouter.post('/classes/:id/students', async (req, res) => {
  const c = await loadClass(req, String(req.params.id)); if (c.archived) throw conflict('This class is archived');
  const b = z.object({ userIds: z.array(oid).min(1).max(200) }).strict().parse(req.body); const ids = [...new Set(b.userIds)];
  await checkStudents(c, ids);
  const already = ids.filter((id) => c.studentIds.map(String).includes(id)); const add = ids.filter((id) => !already.includes(id));
  if (add.length) await ClassGroup.updateOne({ _id: c._id }, { $addToSet: { studentIds: { $each: add } } });
  audit(req, 'class.enrol', String(c._id), { added: add.length, alreadyEnrolled: already.length }, { entityType: 'class', schoolId: String(c.schoolId), after: { added: add } });
  res.json({ added: add.length, alreadyEnrolled: already.length });
});
adminClassesRouter.delete('/classes/:id/students/:userId', async (req, res) => {
  const c = await loadClass(req, String(req.params.id)); const u = oid.parse(req.params.userId);
  const r = await ClassGroup.updateOne({ _id: c._id }, { $pull: { studentIds: u } }); if (!r.modifiedCount) throw notFound('This student is not enrolled in the class');
  audit(req, 'class.unenrol', String(c._id), { userId: u }, { entityType: 'class', schoolId: String(c.schoolId) }); res.status(204).end();
});
/** Transfer students between two classes of the same school (enrol in the target first, then leave the source). */
adminClassesRouter.post('/classes/:id/transfer', async (req, res) => {
  const c = await loadClass(req, String(req.params.id));
  const b = z.object({ userIds: z.array(oid).min(1).max(200), toClassId: oid }).strict().parse(req.body); const ids = [...new Set(b.userIds)];
  if (b.toClassId === String(c._id)) throw new AppError(422, 'VALIDATION', 'Choose a different class');
  const t = await loadClass(req, b.toClassId);
  if (String(t.schoolId) !== String(c.schoolId)) throw forbidden('Both classes must belong to the same school (use "Move to another school" for school transfers)');
  if (t.archived) throw conflict('The target class is archived');
  const notIn = ids.filter((id) => !c.studentIds.map(String).includes(id)); if (notIn.length) throw new AppError(422, 'VALIDATION', `${notIn.length} of the selected students are not in this class`);
  await checkStudents(t, ids);
  const already = ids.filter((id) => t.studentIds.map(String).includes(id));
  await ClassGroup.updateOne({ _id: t._id }, { $addToSet: { studentIds: { $each: ids } } });
  await ClassGroup.updateOne({ _id: c._id }, { $pull: { studentIds: { $in: ids } } });
  audit(req, 'class.transfer', String(c._id), { toClassId: String(t._id), moved: ids.length, alreadyInTarget: already.length }, { entityType: 'class', schoolId: String(c.schoolId) });
  res.json({ moved: ids.length, alreadyInTarget: already.length });
});

// ---- CSV enrolment import ----
adminClassesRouter.get('/imports/enrolments/template.csv', (_req, res) => { res.type('text/csv').attachment('enrolment-template.csv').send(Imp.TEMPLATE_CSV); });
const previewB = z.object({ csv: z.string().min(1).max(1_000_000), filename: z.string().trim().max(200).optional(), schoolId: oid.optional(),
  createMissingStudents: z.boolean().prefault(false), createMissingClasses: z.boolean().prefault(false) }).strict();
adminClassesRouter.post('/imports/enrolments', async (req, res) => {
  const b = previewB.parse(req.body); const schoolId = await schoolFor(req, b.schoolId);
  const s = await School.findById(schoolId).select('status').lean(); if ((s as any)?.status !== 'active') throw conflict('The school is not active');
  const opts = { createMissingStudents: b.createMissingStudents, createMissingClasses: b.createMissingClasses };
  const v = await Imp.validate(b.csv, schoolId, opts);
  const batch = await ImportBatch.create({ kind: 'enrolments', schoolId, status: 'preview', filename: b.filename, checksum: v.checksum, options: opts, rows: v.rows, summary: { ...v.summary, fingerprint: v.fingerprint }, createdBy: req.auth!.userId });
  audit(req, 'import.preview', String(batch._id), { rows: v.summary.rows, errors: v.summary.errors }, { entityType: 'import', schoolId });
  res.status(201).json({ batch: shape(batch.toObject()), csvKept: false });
  // The raw CSV is not stored; commit re-validates the stored rows against the database.
});
const shape = (b: any) => ({ ...b, summary: b.summary ? { ...b.summary, fingerprint: undefined } : b.summary });
async function loadBatch(req: Request) {
  const id = oid.parse(req.params.id);
  const b = await ImportBatch.findOne({ _id: id, ...(isSuper(req) ? {} : { schoolId: req.auth!.schoolId ?? new mongoose.Types.ObjectId() }) }); if (!b) throw notFound('Import not found'); return b;
}
adminClassesRouter.get('/imports', async (req, res) => {
  const p = listQuery(['createdAt'] as const).extend({ schoolId: oid.optional(), status: z.string().max(20).optional() }).parse(req.query);
  const f: any = isSuper(req) ? (p.schoolId ? { schoolId: p.schoolId } : {}) : { schoolId: req.auth!.schoolId ?? new mongoose.Types.ObjectId() }; if (p.status) f.status = p.status;
  const out = await paginate<any>(ImportBatch, f, p, (q) => q.select('-rows').populate('createdBy', 'fullName').populate('schoolId', 'name'));
  res.json({ ...out, items: out.items.map(shape) });
});
adminClassesRouter.get('/imports/:id', async (req, res) => { res.json({ batch: shape((await loadBatch(req)).toObject()) }); });
adminClassesRouter.get('/imports/:id/errors.csv', async (req, res) => {
  const b = await loadBatch(req);
  const rows = b.rows.filter((r: any) => r.errors?.length || r.warnings?.length).map((r: any) => [r.line, r.email, r.fullName, r.className, r.action, (r.errors ?? []).join('; '), (r.warnings ?? []).join('; ')]);
  res.type('text/csv').attachment(`import-${b._id}-report.csv`).send(Imp.toCsvRows(['Line', 'Email', 'Full name', 'Class', 'Result', 'Errors', 'Warnings'], rows));
});
/** Rebuilds the CSV from the stored rows so commit can re-validate exactly what was previewed. */
const rebuild = (b: any) => Imp.toCsvRows([...S.ENROLMENT_COLUMNS], b.rows.map((r: any) => [r.email, r.fullName, r.className, r.yearOfStudy ?? '', r.academicYear ?? '']));
adminClassesRouter.post('/imports/:id/commit', async (req, res) => {
  const body = z.object({ skipErrors: z.boolean().prefault(false) }).strict().parse(req.body ?? {});
  const b = await loadBatch(req);
  if (b.status !== 'preview') throw conflict(`This import is ${b.status.replace('_', ' ')}`);
  if (Date.now() - new Date(b.createdAt as any).getTime() > 24 * 3600_000) throw conflict('This preview is older than 24 hours; upload the file again');
  const v = await Imp.validate(rebuild(b), String(b.schoolId), { createMissingStudents: !!b.options?.createMissingStudents, createMissingClasses: !!b.options?.createMissingClasses });
  // Lines shift by nothing (same order), so the fingerprints are comparable.
  if (v.fingerprint !== (b.summary as any)?.fingerprint) {
    await ImportBatch.updateOne({ _id: b._id }, { rows: v.rows, summary: { ...v.summary, fingerprint: v.fingerprint } });
    throw new AppError(409, 'PREVIEW_STALE', 'Records changed since the preview. Review the refreshed preview and commit again.');
  }
  if (v.summary.errors && !body.skipErrors) throw new AppError(422, 'IMPORT_HAS_ERRORS', `${v.summary.errors} row(s) have errors. Fix the file, or choose to import only the valid rows.`);
  if (!v.summary.enrol && !v.summary.createAndEnrol) throw new AppError(422, 'NOTHING_TO_IMPORT', 'There is nothing to import');
  const lock = await ImportBatch.findOneAndUpdate({ _id: b._id, status: 'preview' }, { status: 'committing', committedBy: req.auth!.userId }); if (!lock) throw conflict('This import is already being committed');
  try {
    const credentials = await Imp.commit(b._id, v.rows as any, String(b.schoolId), req.auth!.userId);
    const done = await ImportBatch.findByIdAndUpdate(b._id, { status: 'committed', committedAt: new Date() }, { returnDocument: 'after' }).lean();
    audit(req, 'import.commit', String(b._id), { enrolments: done!.created?.enrolments?.length ?? 0, usersCreated: done!.created?.userIds?.length ?? 0, classesCreated: done!.created?.classIds?.length ?? 0, skippedErrors: v.summary.errors }, { entityType: 'import', schoolId: String(b.schoolId) });
    noStore(res);
    // Temporary passwords for new students are returned once here and never stored.
    res.json({ batch: shape(done), credentials });
  } catch (e: any) {
    await ImportBatch.updateOne({ _id: b._id }, { status: 'failed', error: String(e?.message ?? e).slice(0, 300) });
    audit(req, 'import.commit', String(b._id), { error: String(e?.message ?? e).slice(0, 200) }, { entityType: 'import', schoolId: String(b.schoolId), outcome: 'failure' });
    throw new AppError(500, 'IMPORT_FAILED', 'The import stopped part-way. Roll it back to undo the records it created.');
  }
});
adminClassesRouter.post('/imports/:id/rollback', async (req, res) => {
  const b = await loadBatch(req);
  if (!['committed', 'failed'].includes(b.status)) throw conflict(`Only committed or failed imports can be rolled back (this one is ${b.status.replace('_', ' ')})`);
  const lock = await ImportBatch.findOneAndUpdate({ _id: b._id, status: b.status }, { status: 'committing' }); if (!lock) throw conflict('This import is being changed by someone else');
  const report = await Imp.rollback(b.toObject());
  const done = await ImportBatch.findByIdAndUpdate(b._id, { status: 'rolled_back', rolledBackAt: new Date(), rolledBackBy: req.auth!.userId, rollbackReport: report }, { returnDocument: 'after' }).lean();
  audit(req, 'import.rollback', String(b._id), report, { entityType: 'import', schoolId: String(b.schoolId) });
  res.json({ batch: shape(done), report });
});
adminClassesRouter.post('/imports/:id/cancel', async (req, res) => {
  const b = await loadBatch(req); if (b.status !== 'preview') throw conflict('Only previews can be cancelled');
  b.status = 'cancelled'; await b.save(); audit(req, 'import.cancel', String(b._id), undefined, { entityType: 'import', schoolId: String(b.schoolId) }); res.json({ batch: shape(b.toObject()) });
});
export { badRequest };
