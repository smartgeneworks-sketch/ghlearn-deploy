import { audienceFilter } from '../services/eligibility.js';
import mongoose from 'mongoose';
import { Router } from 'express';
import { onboardingSchema, profileUpdateSchema } from '@ghlearn/shared';
import { matchSchool, schoolNameKey } from '../services/schools.js';
import { School, AcademicLevel, Programme, Subject, StudentProfile, User, LearningResource, ResourceProgress } from '../models/index.js';
import { authenticate, requirePermission, requireSubjectAccess, canAccessSubject, canSeeUnpublished, requireAnyPermission } from '../middleware/index.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

export const studentRouter = Router();
studentRouter.use(['/onboarding', '/me', '/subjects', '/resources'], authenticate);

/**
 * Validates a student's own subject choice. No combination or elective limits: any active subjects of the chosen level,
 * core ones in the core list and electives in the elective list. The union becomes THE content authorisation list.
 */
export async function resolveSubjects(input: { levelId: string; programmeId?: string | null; yearOfStudy: number; coreSubjectIds: string[]; electiveSubjectIds: string[] }) {
  const level = await AcademicLevel.findById(input.levelId).lean();
  if (!level || !level.enabled || level.archivedAt) throw badRequest('Academic level is not available');
  if (input.yearOfStudy > level.years) throw badRequest(`${level.name} has only ${level.years} years`);
  let programme = null;
  if (input.programmeId) {
    programme = await Programme.findOne({ _id: input.programmeId, levelId: level._id }).lean();
    if (!programme) throw badRequest('Learning Area does not belong to this level');
    if (programme.active === false || programme.archivedAt) throw badRequest('This Learning Area is not available');
  }
  const check = async (ids: string[], category: 'core' | 'elective') => {
    const uniq = [...new Set(ids)];
    if (uniq.length && (await Subject.countDocuments({ _id: { $in: uniq }, levelId: level._id, category, active: true, archivedAt: null })) !== uniq.length)
      throw badRequest(`One or more ${category} subjects are not available for ${level.name}`);
    return uniq;
  };
  const core = await check(input.coreSubjectIds, 'core'); const electives = await check(input.electiveSubjectIds, 'elective');
  const subjectIds = [...new Set([...core, ...electives])];
  if (!subjectIds.length) throw badRequest('Choose at least one subject');
  return { level, programme, subjectIds };
}

/** Links the typed school name to a configured school when it matches (or validates an explicit schoolId). */
async function linkSchool(schoolName: string, schoolId?: string) {
  if (schoolId) { const s = await School.findOne({ _id: schoolId, active: true }).lean(); if (!s) throw badRequest('School not found or inactive'); return s; }
  return matchSchool(schoolName);
}

studentRouter.post('/onboarding', async (req, res) => {
  if (!req.auth!.roles.includes('student')) throw forbidden('Only students complete onboarding');
  if (await StudentProfile.exists({ userId: req.auth!.userId })) throw conflict('Onboarding already completed. Edit your subjects from your profile.');
  const input = onboardingSchema.parse(req.body);
  const { subjectIds } = await resolveSubjects(input);
  const school = await linkSchool(input.schoolName, input.schoolId);
  const { coreSubjectIds: _c, electiveSubjectIds: _e, schoolId: _s, ...rest } = input;
  const p = await StudentProfile.create({ ...rest, schoolName: input.schoolName, schoolNameKey: schoolNameKey(input.schoolName), schoolId: school?._id, userId: req.auth!.userId, subjectIds, onboardedAt: new Date() });
  if (school) await User.updateOne({ _id: req.auth!.userId }, { schoolId: school._id });
  audit(req, 'student.onboard', String(p._id), { subjectIds, region: input.region, linkedSchool: school ? String(school._id) : null });
  res.status(201).json({ profile: p, linkedSchool: school ? { _id: school._id, name: school.name } : null });
});

/** Students edit their own region, school name, year, Learning Area and subjects. Access follows the new list immediately. */
studentRouter.patch('/me/profile', async (req, res) => {
  if (!req.auth!.roles.includes('student')) throw forbidden('Only students have a learner profile');
  const b = profileUpdateSchema.parse(req.body);
  const p = await StudentProfile.findOne({ userId: req.auth!.userId }); if (!p) throw notFound('No student profile yet');
  const change: Record<string, unknown> = {};
  if (b.region) change.region = b.region;
  if (b.yearOfStudy !== undefined || b.programmeId !== undefined || b.coreSubjectIds) {
    const cur = await Subject.find({ _id: { $in: p.subjectIds } }).select('category').lean();
    const r = await resolveSubjects({ levelId: String(p.levelId), yearOfStudy: b.yearOfStudy ?? p.yearOfStudy, programmeId: b.programmeId === undefined ? (p.programmeId ? String(p.programmeId) : undefined) : b.programmeId,
      coreSubjectIds: b.coreSubjectIds ?? cur.filter((s) => s.category === 'core').map((s) => String(s._id)), electiveSubjectIds: b.electiveSubjectIds ?? cur.filter((s) => s.category === 'elective').map((s) => String(s._id)) });
    if (b.yearOfStudy !== undefined) change.yearOfStudy = b.yearOfStudy;
    if (b.programmeId !== undefined) change.programmeId = b.programmeId ?? undefined;
    if (b.coreSubjectIds) change.subjectIds = r.subjectIds;
  }
  if (b.schoolName && b.schoolName !== p.schoolName) {
    const school = await matchSchool(b.schoolName);
    Object.assign(change, { schoolName: b.schoolName, schoolNameKey: schoolNameKey(b.schoolName), schoolId: school?._id ?? null });
    await User.updateOne({ _id: req.auth!.userId }, school ? { schoolId: school._id } : { $unset: { schoolId: 1 } });
  }
  p.set(change); await p.save();
  audit(req, 'student.profile.update', String(p._id), { ...b });
  res.json({ profile: p });
});

studentRouter.get('/me/profile', async (req, res) => {
  const p = await StudentProfile.findOne({ userId: req.auth!.userId }).populate('subjectIds', 'name code category').populate('schoolId', 'name').populate('levelId', 'name kind').populate('programmeId', 'name').lean();
  if (!p) throw notFound('No student profile yet'); res.json({ profile: p });
});

/** Learning space: only subjects this user is authorised for. */
studentRouter.get('/me/subjects', requirePermission('learn:access'), async (req, res) => {
  const p = await StudentProfile.findOne({ userId: req.auth!.userId }).lean();
  const ids = p?.subjectIds ?? [];
  res.json({ items: await Subject.find({ _id: { $in: ids } }).sort({ category: 1, name: 1 }).lean() });
});

studentRouter.get('/subjects/:subjectId/resources', requireAnyPermission('learn:access', 'content:edit', 'content:review'), requireSubjectAccess(), async (req, res) => {
  const q: Record<string, unknown> = { subjectId: req.params.subjectId, ...(await audienceFilter(req.auth!)) };
  if (!canSeeUnpublished(req.auth!)) q.status = 'published';
  res.json({ items: await LearningResource.find(q).select('-body').sort({ yearOfStudy: 1, title: 1 }).lean() });
});

studentRouter.get('/resources/:id', requireAnyPermission('learn:access', 'content:edit', 'content:review'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Resource not found');
  const r = await LearningResource.findOne({ _id: req.params.id, ...(await audienceFilter(req.auth!)) }).lean();
  // Same 404 for missing, unauthorised-unpublished and outside the audience, to avoid leaking existence.
  if (!r || (r.status !== 'published' && !canSeeUnpublished(req.auth!))) throw notFound('Resource not found');
  if (!(await canAccessSubject(req.auth!, String(r.subjectId)))) throw forbidden('You are not enrolled in this subject');
  // Lesson completion analytics (§16): record that a learner opened a published lesson.
  let progress = null;
  if (req.auth!.roles.includes('student') && r.status === 'published') {
    const now = new Date();
    progress = await ResourceProgress.findOneAndUpdate({ userId: req.auth!.userId, resourceId: r._id },
      { $set: { lastOpenedAt: now, subjectId: r.subjectId, topic: (r as any).topic, schoolId: req.auth!.schoolId ?? (await StudentProfile.findOne({ userId: req.auth!.userId }).select('schoolId').lean())?.schoolId }, $setOnInsert: { openedAt: now }, $inc: { opens: 1 } },
      { upsert: true, new: true }).lean();
  }
  res.json({ resource: r, progress: progress ? { openedAt: progress.openedAt, completedAt: progress.completedAt ?? null } : null });
});
/** A learner marks a lesson as completed (or not). Only for lessons they can open. */
studentRouter.post('/resources/:id/complete', requirePermission('learn:access'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Resource not found');
  const done = req.body?.completed !== false;
  const r = await LearningResource.findOne({ _id: req.params.id, status: 'published', ...(await audienceFilter(req.auth!)) }).select('subjectId topic').lean();
  if (!r) throw notFound('Resource not found');
  if (!(await canAccessSubject(req.auth!, String(r.subjectId)))) throw forbidden('You are not enrolled in this subject');
  const now = new Date();
  const p = await ResourceProgress.findOneAndUpdate({ userId: req.auth!.userId, resourceId: r._id },
    { $set: { completedAt: done ? now : null, subjectId: r.subjectId, topic: (r as any).topic, lastOpenedAt: now, schoolId: (await StudentProfile.findOne({ userId: req.auth!.userId }).select('schoolId').lean())?.schoolId }, $setOnInsert: { openedAt: now, opens: 1 } },
    { upsert: true, new: true }).lean();
  res.json({ progress: { openedAt: p!.openedAt, completedAt: p!.completedAt ?? null } });
});
