import { audienceFilter } from '../services/eligibility.js';
import mongoose from 'mongoose';
import { Router } from 'express';
import { onboardingSchema, profileUpdateSchema } from '@ghlearn/shared';
import { matchSchool, schoolNameKey } from '../services/schools.js';
import { School, AcademicLevel, Programme, Subject, StudentProfile, User, LearningResource, ResourceProgress } from '../models/index.js';
import { authenticate, requirePermission, requireSubjectAccess, canAccessSubject, canSeeUnpublished, requireAnyPermission } from '../middleware/index.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { z } from 'zod';
import { getSettings } from '../services/platformSettings.js';
import { computeLocks, learnerCopy, scoreCheck, checkLayout } from '../services/lessons/progression.js';
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
  const subjects = await Subject.find({ _id: { $in: ids } }).sort({ category: 1, name: 1 }).lean();
  // "My Subject" card summary (§3): published modules, strands, progress, time and where to continue.
  const mods = await LearningResource.find({ subjectId: { $in: ids }, contentType: 'module', status: 'published', ...(await audienceFilter(req.auth!)) }).select('subjectId yearOfStudy strand order readingTime thumbnail').sort({ order: 1 }).lean();
  const prog = await ResourceProgress.find({ userId: req.auth!.userId, resourceId: { $in: mods.map((m) => m._id) } }).select('resourceId completedAt').lean();
  const done = new Set(prog.filter((x) => x.completedAt).map((x) => String(x.resourceId)));
  res.json({ items: subjects.map((sub) => { const ms = mods.filter((m) => String(m.subjectId) === String(sub._id)); if (!ms.length) return sub;
    const completed = ms.filter((m) => done.has(String(m._id))).length; const next = ms.find((m) => !done.has(String(m._id)));
    return { ...sub, yearOfStudy: p?.yearOfStudy ?? null, summary: { strands: new Set(ms.map((m) => `${m.yearOfStudy} ${m.strand}`)).size, modules: ms.length, completed, progressPct: Math.round((completed / ms.length) * 100),
      totalMinutes: ms.reduce((n, m: any) => n + (m.readingTime?.totalMin ?? 0), 0), continueId: next?._id ?? null, thumbnail: ms[0].thumbnail ? { svg: (ms[0].thumbnail as any).svg, alt: (ms[0].thumbnail as any).alt } : null } }; }) });
});

studentRouter.get('/subjects/:subjectId/resources', requireAnyPermission('learn:access', 'content:edit', 'content:review'), requireSubjectAccess(), async (req, res) => {
  const q: Record<string, unknown> = { subjectId: req.params.subjectId, ...(await audienceFilter(req.auth!)) };
  if (!canSeeUnpublished(req.auth!)) q.status = 'published';
  res.json({ items: await LearningResource.find(q).select('-body').sort({ yearOfStudy: 1, title: 1 }).lean() });
});

/** Curriculum LMS "My Subject" dashboard (§3/§5/§13): published modules in curriculum order with progress, reading time and lock state. */
studentRouter.get('/subjects/:subjectId/modules', requireAnyPermission('learn:access', 'content:edit', 'content:review'), requireSubjectAccess(), async (req, res) => {
  const subject = await Subject.findById(req.params.subjectId).select('name code description levelId').populate('levelId', 'name').lean(); if (!subject) throw notFound('Subject not found');
  const mods = await LearningResource.find({ subjectId: req.params.subjectId, contentType: 'module', status: 'published', ...(await audienceFilter(req.auth!)) })
    .select('title moduleKey order yearOfStudy strand subStrand intro objective thumbnail readingTime aiApproved indicator').sort({ order: 1 }).lean();
  const prog = await ResourceProgress.find({ userId: req.auth!.userId, resourceId: { $in: mods.map((m) => m._id) } }).lean();
  const pm = new Map(prog.map((p) => [String(p.resourceId), p])); const done = new Set(prog.filter((p) => p.completedAt).map((p) => String(p.resourceId)));
  const cfg = (await getSettings()).curriculumLms; const locks = computeLocks(mods, done, cfg.lockMode);
  const cards = mods.map((m) => { const p = pm.get(String(m._id)); const lock = locks.get(String(m._id))!;
    return { ...m, status: p?.completedAt ? 'completed' : p ? 'in_progress' : 'not_started', locked: req.auth!.roles.includes('student') ? lock.locked : false, lockReason: lock.reason,
      progress: p ? { lastOpenedAt: p.lastOpenedAt, completedAt: p.completedAt ?? null, maxScrollPct: p.maxScrollPct ?? 0, checkScorePct: p.checkScorePct ?? null } : null }; });
  const strands: any[] = [];
  for (const c of cards) { const sk = `Y${c.yearOfStudy} ${c.strand}`; let st = strands.find((x) => x.key === sk); if (!st) strands.push(st = { key: sk, yearOfStudy: c.yearOfStudy, title: c.strand, subStrands: [] });
    let ss = st.subStrands.find((x: any) => x.title === c.subStrand); if (!ss) st.subStrands.push(ss = { title: c.subStrand, modules: [] }); ss.modules.push(c); }
  const last = [...prog].sort((a, b) => +new Date(b.lastOpenedAt ?? 0) - +new Date(a.lastOpenedAt ?? 0))[0];
  const next = cards.find((c) => c.status !== 'completed' && !c.locked);
  res.json({ subject, lockMode: cfg.lockMode, totals: { strands: strands.length, modules: cards.length, completed: done.size, progressPct: cards.length ? Math.round((done.size / cards.length) * 100) : 0,
    totalMinutes: cards.reduce((n, c: any) => n + (c.readingTime?.totalMin ?? 0), 0), readingMinutes: cards.reduce((n, c: any) => n + (c.readingTime?.readingMin ?? 0), 0) },
    continue: (last && cards.find((c) => String(c._id) === String(last.resourceId) && c.status !== 'completed')) ?? next ?? null, strands });
});
async function moduleGate(req: any, r: any) {
  if (r.contentType !== 'module' || !req.auth!.roles.includes('student')) return null;
  const mods = await LearningResource.find({ subjectId: r.subjectId, contentType: 'module', status: 'published', ...(await audienceFilter(req.auth!)) }).select('moduleKey order').lean();
  const done = new Set((await ResourceProgress.find({ userId: req.auth!.userId, resourceId: { $in: mods.map((m) => m._id) }, completedAt: { $ne: null } }).select('resourceId').lean()).map((p) => String(p.resourceId)));
  const cfg = (await getSettings()).curriculumLms; return { lock: computeLocks(mods, done, cfg.lockMode).get(String(r._id)), cfg, mods };
}
studentRouter.get('/resources/:id', requireAnyPermission('learn:access', 'content:edit', 'content:review'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Resource not found');
  const r = await LearningResource.findOne({ _id: req.params.id, ...(await audienceFilter(req.auth!)) }).lean();
  // Same 404 for missing, unauthorised-unpublished and outside the audience, to avoid leaking existence.
  if (!r || (r.status !== 'published' && !canSeeUnpublished(req.auth!))) throw notFound('Resource not found');
  if (!(await canAccessSubject(req.auth!, String(r.subjectId)))) throw forbidden('You are not enrolled in this subject');
  const gate = await moduleGate(req, r);
  if (gate?.lock?.locked) throw new AppError(403, 'MODULE_LOCKED', 'Complete the previous module first.', { requires: gate.lock.requires ?? null });
  // Lesson completion analytics (§16): record that a learner opened a published lesson.
  let progress = null;
  if (req.auth!.roles.includes('student') && r.status === 'published') {
    const now = new Date();
    progress = await ResourceProgress.findOneAndUpdate({ userId: req.auth!.userId, resourceId: r._id },
      { $set: { lastOpenedAt: now, subjectId: r.subjectId, topic: (r as any).topic, schoolId: req.auth!.schoolId ?? (await StudentProfile.findOne({ userId: req.auth!.userId }).select('schoolId').lean())?.schoolId }, $setOnInsert: { openedAt: now }, $inc: { opens: 1 } },
      { upsert: true, new: true }).lean();
  }
  if (gate) { const ordered = gate.mods.sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)); const i = ordered.findIndex((m: any) => String(m._id) === String(r._id));
    (r as any).nav = { prev: ordered[i - 1]?._id ?? null, next: ordered[i + 1]?._id ?? null }; (r as any).completionRule = { minScrollPct: gate.cfg.minScrollPct, passMarkPct: gate.cfg.passMarkPct };
    // Answers stay hidden until the learner passes; before that the check is shown in a fresh order per attempt.
    const passed = !!(progress as any)?.checkPassedAt; const attempt = (progress as any)?.checkAttempts ?? 0;
    if (passed) r.body = { ...(r.body as any), sourceMap: undefined };
    else { r.body = learnerCopy(r.body, progress ? checkLayout(r.body, `${req.auth!.userId}:${r._id}:${attempt}`) : undefined); (r as any).checkAttempt = attempt; } }
  res.json({ resource: r, progress: progress ? { openedAt: progress.openedAt, completedAt: progress.completedAt ?? null, activeSeconds: (progress as any).activeSeconds ?? 0, maxScrollPct: (progress as any).maxScrollPct ?? 0, checkScorePct: (progress as any).checkScorePct ?? null, checkAttempts: (progress as any).checkAttempts ?? 0 } : null });
});
/** Reading activity pings from the module reader: active (visible, interacting) seconds since the last ping, capped, and scroll depth. */
studentRouter.post('/resources/:id/progress', requirePermission('learn:access'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Resource not found');
  const b = z.object({ activeSeconds: z.number().int().min(0).max(120), scrollPct: z.number().min(0).max(100) }).strict().parse(req.body ?? {});
  const r = await LearningResource.findOne({ _id: req.params.id, status: 'published', contentType: 'module', ...(await audienceFilter(req.auth!)) }).select('subjectId moduleKey').lean(); if (!r) throw notFound('Resource not found');
  if (!(await canAccessSubject(req.auth!, String(r.subjectId)))) throw forbidden('You are not enrolled in this subject');
  const p = await ResourceProgress.findOneAndUpdate({ userId: req.auth!.userId, resourceId: r._id }, { $inc: { activeSeconds: b.activeSeconds }, $max: { maxScrollPct: Math.round(b.scrollPct) }, $set: { lastOpenedAt: new Date(), moduleKey: r.moduleKey } }, { new: true }).lean();
  if (!p) throw conflict('Open the module first'); res.json({ activeSeconds: p.activeSeconds, maxScrollPct: p.maxScrollPct });
});
/** Knowledge check (section L): scored on the server; answers and explanations are returned only after an attempt. */
studentRouter.post('/resources/:id/check', requirePermission('learn:access'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Resource not found');
  const { answers, attempt } = z.object({ answers: z.array(z.number().int().min(-1).max(5)).max(20), attempt: z.number().int().min(0).optional() }).strict().parse(req.body ?? {});
  const r = await LearningResource.findOne({ _id: req.params.id, status: 'published', contentType: 'module', ...(await audienceFilter(req.auth!)) }).select('subjectId body').lean(); if (!r) throw notFound('Resource not found');
  if (!(await canAccessSubject(req.auth!, String(r.subjectId)))) throw forbidden('You are not enrolled in this subject');
  const pass = (await getSettings()).curriculumLms.passMarkPct;
  const cur = await ResourceProgress.findOne({ userId: req.auth!.userId, resourceId: r._id }).select('checkAttempts checkPassedAt').lean(); if (!cur) throw conflict('Open the module first');
  const n = cur.checkAttempts ?? 0; if (attempt !== undefined && attempt !== n) throw conflict('The questions have been reshuffled since you opened them. Reload the page and try again.');
  // After a pass the learner sees the original order with answers; before that, the layout for this attempt.
  const layout = cur.checkPassedAt ? undefined : checkLayout(r.body, `${req.auth!.userId}:${r._id}:${n}`);
  const sc = scoreCheck(r.body, answers, layout, pass); if (answers.length !== sc.total) throw new AppError(422, 'VALIDATION_FAILED', `Answer all ${sc.total} questions`);
  const p = await ResourceProgress.findOneAndUpdate({ userId: req.auth!.userId, resourceId: r._id }, { $set: { checkScorePct: sc.pct, ...(sc.pct >= pass ? { checkPassedAt: new Date() } : {}) }, $inc: { checkAttempts: 1 } }, { new: true }).lean();
  if (!p) throw conflict('Open the module first'); res.json({ ...sc, passMarkPct: pass, passed: sc.pct >= pass });
});
/** A learner marks a lesson as completed (or not). Only for lessons they can open. */
studentRouter.post('/resources/:id/complete', requirePermission('learn:access'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Resource not found');
  const done = req.body?.completed !== false;
  const r = await LearningResource.findOne({ _id: req.params.id, status: 'published', ...(await audienceFilter(req.auth!)) }).select('subjectId topic contentType body.sections.key body.sections.data.questions.question').lean();
  if (!r) throw notFound('Resource not found');
  if (!(await canAccessSubject(req.auth!, String(r.subjectId)))) throw forbidden('You are not enrolled in this subject');
  if (r.contentType === 'module' && done) { // §9: completion from real interactions, not from opening
    const cfg = (await getSettings()).curriculumLms; const cur = await ResourceProgress.findOne({ userId: req.auth!.userId, resourceId: r._id }).lean();
    const hasCheck = ((r.body as any)?.sections?.find((s: any) => s.key === 'L')?.data?.questions ?? []).length > 0;
    const missing = [(cur?.maxScrollPct ?? 0) < cfg.minScrollPct && `read to the end (${cur?.maxScrollPct ?? 0}% of ${cfg.minScrollPct}% read)`, hasCheck && !cur?.checkPassedAt && `pass the knowledge check (${cfg.passMarkPct}% needed)`].filter(Boolean);
    if (missing.length) throw new AppError(409, 'NOT_COMPLETE', `To complete this module, ${missing.join(' and ')}.`);
  }
  const now = new Date();
  const p = await ResourceProgress.findOneAndUpdate({ userId: req.auth!.userId, resourceId: r._id },
    { $set: { completedAt: done ? now : null, subjectId: r.subjectId, topic: (r as any).topic, lastOpenedAt: now, schoolId: (await StudentProfile.findOne({ userId: req.auth!.userId }).select('schoolId').lean())?.schoolId }, $setOnInsert: { openedAt: now, opens: 1 } },
    { upsert: true, new: true }).lean();
  res.json({ progress: { openedAt: p!.openedAt, completedAt: p!.completedAt ?? null } });
});
