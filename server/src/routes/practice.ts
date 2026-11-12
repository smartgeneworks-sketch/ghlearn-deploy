import { studentAudience } from '../services/eligibility.js';
import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { ClassGroup, Attempt, Assessment, Question, StudentProfile, TeacherAssignment, User, Subject, School, Mastery, UserReward, XpEvent, LearningResource, GameSession, GameDesign } from '../models/index.js';
import { ATTEMPT_MODES, QUESTION_TYPES, GAMES } from '../models/assess.js';
import { authenticate, requirePermission, requireAnyPermission, canAccessSubject, isSuper } from '../middleware/index.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { createAttempt, loadOwn, saveResponse, submitAttempt, viewAttempt, verifyResponse, assessmentFor } from '../services/assess/attempts.js';
import { startGame, answerItem, hint, finishGame, sessionView, GAME_INFO, GAME_RULES } from '../services/assess/games.js';
import { BADGES, levelFor, today } from '../services/assess/rewards.js';
import { createHash } from 'node:crypto';
import { notify } from '../services/notify.js';
import { assignmentCsv } from '../services/teach/reports.js';

const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const subjectGate = async (auth: any, subjectId: string) => { if (!(await canAccessSubject(auth, subjectId))) throw forbidden('You are not enrolled in this subject'); };

// ===================== Attempts (students; teachers can try practice too) =====================
export const practiceRouter = Router();
practiceRouter.use(authenticate, requirePermission('learn:access'));
practiceRouter.post('/attempts', async (req, res) => {
  const b = z.object({ subjectId: oid, mode: z.enum(ATTEMPT_MODES), topic: z.string().max(200).optional(), types: z.array(z.enum(QUESTION_TYPES)).max(11).optional(), difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
    count: z.number().int().min(1).max(40).optional(), timeLimitSec: z.number().int().min(30).max(4 * 3600).optional(), assessmentId: oid.optional() }).strict().parse(req.body);
  await subjectGate(req.auth, b.subjectId);
  if (b.mode === 'timed' && !b.timeLimitSec) b.timeLimitSec = Math.max(60, (b.count ?? 10) * 60);
  const a = await createAttempt({ ...b, userId: req.auth!.userId, schoolId: req.auth!.schoolId });
  res.status(201).json({ attempt: await viewAttempt(a) });
});
practiceRouter.get('/attempts', async (req, res) => {
  const q = z.object({ subjectId: oid.optional(), mode: z.string().optional() }).parse(req.query); const f: any = { userId: req.auth!.userId };
  if (q.subjectId) f.subjectId = q.subjectId; if (q.mode) f.mode = q.mode;
  res.json({ items: await Attempt.find(f).select('-items -responses').sort({ createdAt: -1 }).limit(100).populate('subjectId', 'name').populate('assessmentId', 'title').lean() });
});
practiceRouter.get('/attempts/:id', async (req, res) => res.json({ attempt: await viewAttempt(await loadOwn(req.auth!.userId, String(req.params.id))) }));
practiceRouter.put('/attempts/:id/responses/:questionId', async (req, res) => {
  const a = await loadOwn(req.auth!.userId, String(req.params.id)); await saveResponse(a, String(req.params.questionId), z.object({ response: z.any() }).parse(req.body).response);
  res.json({ ok: true, savedAt: new Date(), deadline: a.deadline });
});
practiceRouter.post('/attempts/:id/submit', async (req, res) => {
  const a = await loadOwn(req.auth!.userId, String(req.params.id)); await submitAttempt(a); res.json({ attempt: await viewAttempt(a) });
});
/** Student's assigned work. */
practiceRouter.get('/assigned', async (req, res) => {
  const p = await StudentProfile.findOne({ userId: req.auth!.userId }).lean(); if (!p) return res.json({ items: [] });
  const myClasses = await ClassGroup.find({ studentIds: req.auth!.userId }).distinct('_id');
  const items = await Assessment.find({ schoolId: p.schoolId, status: 'published', subjectId: { $in: p.subjectIds }, $and: [{ $or: [{ yearOfStudy: null }, { yearOfStudy: p.yearOfStudy }] }, { $or: [{ classId: null }, { classId: { $in: myClasses } }] }] }).select('-questionIds').populate('subjectId', 'name').sort({ closesAt: 1 }).lean();
  const mine = await Attempt.find({ userId: req.auth!.userId, assessmentId: { $in: items.map((i) => i._id) } }).select('assessmentId status pct').lean();
  res.json({ items: items.map((a) => ({ ...a, attempts: mine.filter((m) => String(m.assessmentId) === String(a._id)) })) });
});

// ===================== Games =====================
export const gamesRouter = Router();
gamesRouter.use(authenticate, requirePermission('learn:access'));
gamesRouter.get('/', (_req, res) => res.json({ games: GAMES.map((g) => ({ key: g, ...GAME_INFO[g] })) }));
const loadSession = async (req: any) => { if (!mongoose.isValidObjectId(req.params.id)) throw notFound(); const s = await GameSession.findOne({ _id: req.params.id, userId: req.auth.userId }); if (!s) throw notFound('Game not found'); return s; };
/** Published games (§14) for this learner: audience-filtered, with the learner's own plays and best score. */
gamesRouter.get('/designs', async (req, res) => {
  const subjectId = oid.parse(req.query.subjectId); await subjectGate(req.auth, subjectId);
  const ds = await GameDesign.find({ subjectId, status: 'published', ...(await studentAudience(req.auth!.userId)) }).select('title type topic objective difficulty settings questionIds content publishedAt').sort({ publishedAt: -1 }).lean();
  const mine = await GameSession.aggregate([{ $match: { userId: new mongoose.Types.ObjectId(req.auth!.userId), designId: { $in: ds.map((d) => d._id) }, status: 'finished' } }, { $group: { _id: '$designId', plays: { $sum: 1 }, best: { $max: '$score' } } }]);
  res.json({ items: ds.map((d: any) => { const m = mine.find((x) => String(x._id) === String(d._id)); const rule = GAME_RULES[d.type];
    return { _id: d._id, title: d.title, type: d.type, info: GAME_INFO[d.type], topic: d.topic, objective: d.objective, difficulty: d.difficulty, hintsEnabled: d.settings?.hintsEnabled !== false, timeLimitSec: d.settings?.timeLimitSec ?? GAME_INFO[d.type].timeLimitSec ?? null,
      items: (d.questionIds?.length ?? 0) + (rule.content ? (d.content?.[rule.content]?.length ?? 0) : 0), plays: m?.plays ?? 0, best: m?.best ?? null }; }) });
});
gamesRouter.post('/sessions', async (req, res) => {
  const b = z.union([z.object({ designId: oid }).strict(), z.object({ subjectId: oid, game: z.enum(GAMES), topic: z.string().max(200).optional() }).strict()]).parse(req.body);
  if ('designId' in b) { const d = await GameDesign.findOne({ _id: b.designId, status: 'published' }).select('subjectId').lean(); if (!d) throw notFound('Game not found'); await subjectGate(req.auth, String(d.subjectId)); }
  else await subjectGate(req.auth, b.subjectId);
  res.status(201).json({ session: sessionView(await startGame({ ...b, userId: req.auth!.userId })) });
});
gamesRouter.get('/sessions', async (req, res) => res.json({ items: await GameSession.find({ userId: req.auth!.userId, status: 'finished' }).select('game topic subjectId score maxScore accuracy xpAwarded finishedAt').sort({ finishedAt: -1 }).limit(50).lean() }));
gamesRouter.get('/sessions/:id', async (req, res) => res.json({ session: sessionView(await loadSession(req)) }));
gamesRouter.post('/sessions/:id/answer', async (req, res) => { const s = await loadSession(req); const b = z.object({ itemId: z.string().max(100), answer: z.any() }).parse(req.body); res.json(await answerItem(s, b.itemId, b.answer)); });
gamesRouter.post('/sessions/:id/hint', async (req, res) => { const s = await loadSession(req); res.json(await hint(s, z.object({ itemId: z.string().max(100) }).parse(req.body).itemId)); });
gamesRouter.post('/sessions/:id/finish', async (req, res) => { const s = await loadSession(req); res.json({ session: sessionView(await finishGame(s, req.auth!.schoolId)) }); });

// ===================== Rewards & leaderboard =====================
export const rewardsRouter = Router();
rewardsRouter.use(authenticate);
rewardsRouter.get('/me', requirePermission('learn:access'), async (req, res) => {
  const r = await UserReward.findOne({ userId: req.auth!.userId }).lean(); const xp = r?.xp ?? 0; const lvl = levelFor(xp);
  const streakAlive = r?.streak?.lastDay && (r.streak.lastDay === today() || r.streak.lastDay === today(new Date(Date.now() - 86400000)));
  res.json({ xp, level: lvl, nextLevelXp: 50 * lvl * lvl, streak: { current: streakAlive ? r!.streak!.current : 0, longest: r?.streak?.longest ?? 0, lastDay: r?.streak?.lastDay },
    badges: (r?.badges ?? []).map((b: any) => ({ ...b, ...BADGES[b.key] })), allBadges: Object.entries(BADGES).map(([key, v]) => ({ key, ...v })),
    recent: await XpEvent.find({ userId: req.auth!.userId }).sort({ createdAt: -1 }).limit(15).lean(),
    rules: 'XP comes from answering and getting questions right and from improving your scores, never from time spent. Replays only earn XP when you beat your best. Daily XP is capped.' });
});
const alias = (userId: string, schoolId: string) => 'Learner ' + createHash('sha256').update(`${schoolId}:${userId}`).digest('hex').slice(0, 4).toUpperCase();
/** Weekly leaderboard: OFF unless the school enables it; anonymised by default; only the requester's own school (and year when scope=year). */
rewardsRouter.get('/leaderboard', requirePermission('learn:access'), async (req, res) => {
  const p = await StudentProfile.findOne({ userId: req.auth!.userId }).lean(); if (!p) throw notFound('Leaderboard not available');
  const school = await School.findById(p.schoolId).lean(); const cfg = (school as any)?.settings?.leaderboard;
  if (!cfg?.enabled) throw new AppError(404, 'LEADERBOARD_DISABLED', 'Your school has not turned on leaderboards');
  const since = today(new Date(Date.now() - 6 * 86400000));
  let users = (await StudentProfile.find({ schoolId: p.schoolId, ...(cfg.scope === 'year' ? { yearOfStudy: p.yearOfStudy } : {}) }).select('userId').lean()).map((x) => x.userId);
  const sub = typeof req.query.subjectId === 'string' && mongoose.isValidObjectId(req.query.subjectId) ? new mongoose.Types.ObjectId(req.query.subjectId) : undefined;
  const rows = await XpEvent.aggregate([{ $match: { userId: { $in: users }, day: { $gte: since }, ...(sub ? { subjectId: sub } : {}) } }, { $group: { _id: '$userId', xp: { $sum: '$xp' } } }, { $sort: { xp: -1 } }, { $limit: 20 }]);
  const names = cfg.anonymized ? [] : await User.find({ _id: { $in: rows.map((r) => r._id) } }).select('fullName').lean();
  const me = req.auth!.userId;
  res.json({ anonymized: cfg.anonymized, scope: cfg.scope, period: `${since} to ${today()}`, entries: rows.map((r, i) => ({ rank: i + 1, xp: r.xp, you: String(r._id) === me,
    name: String(r._id) === me ? 'You' : cfg.anonymized ? alias(String(r._id), String(p.schoolId)) : (() => { const n = names.find((x) => String(x._id) === String(r._id))?.fullName ?? ''; const [f, l] = n.split(' '); return `${f} ${l ? l[0] + '.' : ''}`; })() })) });
});
rewardsRouter.put('/schools/:schoolId/leaderboard', requirePermission('school:manage'), async (req, res) => {
  const id = String(req.params.schoolId); if (!isSuper(req) && req.auth!.schoolId !== id) throw forbidden('You can only configure your own school');
  const b = z.object({ enabled: z.boolean(), anonymized: z.boolean().default(true), scope: z.enum(['school', 'year']).default('year') }).strict().parse(req.body);
  const s = await School.findByIdAndUpdate(id, { 'settings.leaderboard': b }, { returnDocument: 'after' }).lean(); if (!s) throw notFound('School not found');
  audit(req, 'school.leaderboard', id, b); res.json({ leaderboard: (s as any).settings.leaderboard });
});
rewardsRouter.get('/schools/:schoolId/leaderboard', requirePermission('school:manage'), async (req, res) => {
  const id = String(req.params.schoolId); if (!isSuper(req) && req.auth!.schoolId !== id) throw forbidden(); const s = await School.findById(id).lean(); if (!s) throw notFound();
  res.json({ leaderboard: (s as any).settings?.leaderboard ?? { enabled: false, anonymized: true, scope: 'year' } });
});

// ===================== Progress & recommendations =====================
export const progressRouter = Router();
progressRouter.use(authenticate);
export async function progressFor(userId: string, subjectId: string) {
  const [mastery, attempts, games, lessons, assigned, topics] = await Promise.all([
    Mastery.find({ userId, subjectId }).sort({ score: 1 }).lean(),
    Attempt.find({ userId, subjectId, status: { $ne: 'in_progress' } }).sort({ submittedAt: 1 }).select('mode topic pct score maxScore submittedAt provisional responses.questionId responses.score responses.maxScore').limit(200).lean(),
    GameSession.find({ userId, subjectId, status: 'finished' }).select('game accuracy score finishedAt topic').lean(),
    (async () => LearningResource.find({ subjectId, status: 'published', ...(await studentAudience(userId)) }).select('title topic').lean())(),
    (async () => { const p = await StudentProfile.findOne({ userId }).lean(); if (!p) return [];
      const as = await Assessment.find({ schoolId: p.schoolId, subjectId, status: 'published', $or: [{ yearOfStudy: null }, { yearOfStudy: p.yearOfStudy }], $and: [{ $or: [{ closesAt: null }, { closesAt: { $gt: new Date() } }] }, { $or: [{ classId: null }, { classId: { $in: await ClassGroup.find({ studentIds: userId }).distinct('_id') } }] }] }).select('title closesAt').lean();
      const done = await Attempt.distinct('assessmentId', { userId, assessmentId: { $in: as.map((a) => a._id) } }); return as.filter((a) => !done.map(String).includes(String(a._id))); })(),
    Question.distinct('topic', { subjectId, status: 'published' }),
  ]);
  const qids = [...new Set(attempts.flatMap((a) => a.responses.map((r: any) => String(r.questionId))))];
  const qtypes = new Map((await Question.find({ _id: { $in: qids } }).select('type').lean()).map((q) => [String(q._id), q.type]));
  const byType: Record<string, { score: number; max: number }> = {};
  for (const a of attempts) for (const r of a.responses as any[]) { const t = qtypes.get(String(r.questionId)); if (!t || !r.maxScore) continue; byType[t] ??= { score: 0, max: 0 }; byType[t].score += r.score ?? 0; byType[t].max += r.maxScore; }
  const recs: { kind: string; topic?: string; title: string; reason: string; action: any; priority: number }[] = [];
  const days = (d?: Date | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 999);
  for (const a of assigned) recs.push({ kind: 'assigned', title: `Complete "${a.title}"`, reason: `Set by your teacher${a.closesAt ? `, due ${new Date(a.closesAt).toDateString()}` : ''}.`, action: { type: 'assessment', assessmentId: a._id }, priority: 100 });
  for (const m of mastery.filter((m) => m.score < 0.6 && m.answered >= 2).slice(0, 3)) { const lesson = lessons.find((l) => l.topic === m.topic);
    recs.push({ kind: 'remedial', topic: m.topic, title: `Revise ${m.topic}`, reason: `Your mastery is ${Math.round(m.score * 100)}% from ${m.answered} answers (${m.correct} fully correct). Below 60% means this topic needs more work.`, action: lesson ? { type: 'lesson', resourceId: lesson._id, then: { type: 'practice', mode: 'topic_revision', topic: m.topic } } : { type: 'practice', mode: 'remedial', topic: m.topic }, priority: 80 - m.score * 50 }); }
  for (const m of mastery.filter((m) => m.score >= 0.6 && days(m.lastAt) >= 7).slice(0, 2))
    recs.push({ kind: 'spaced_review', topic: m.topic, title: `Quick review: ${m.topic}`, reason: `You were doing well (${Math.round(m.score * 100)}%) but last practised ${days(m.lastAt)} days ago. Short reviews help you remember.`, action: { type: 'game', game: 'flashcards', topic: m.topic }, priority: 50 });
  const seen = new Set(mastery.map((m) => m.topic));
  for (const t of topics.filter((t) => !seen.has(t)).slice(0, 2)) recs.push({ kind: 'new_topic', topic: t, title: `Start ${t}`, reason: 'You have not practised this topic yet, and approved questions are available.', action: { type: 'practice', mode: 'topic_revision', topic: t }, priority: 30 });
  if (!recs.length) recs.push({ kind: 'mixed', title: 'Mixed practice', reason: mastery.length ? 'All your topics are at 60% or above. Mixed practice checks you can still tell topics apart.' : 'Answer a few questions so we can find your strengths.', action: { type: 'practice', mode: 'mixed' }, priority: 10 });
  return {
    overall: mastery.length ? Math.round((100 * mastery.reduce((t, m) => t + m.score, 0)) / mastery.length) : null,
    mastery: mastery.map((m) => ({ topic: m.topic, pct: Math.round(m.score * 100), answered: m.answered, correct: m.correct, lastAt: m.lastAt, trend: m.history.slice(-5).map((h: any) => Math.round(h.frac * 100)) })),
    timeline: attempts.slice(-20).map((a) => ({ at: a.submittedAt, pct: a.pct, mode: a.mode, provisional: a.provisional })),
    byType: Object.entries(byType).map(([type, v]) => ({ type, pct: Math.round((100 * v.score) / v.max) })),
    games: Object.values(games.reduce((acc: any, g) => { (acc[g.game] ??= { game: g.game, plays: 0, bestAccuracy: 0 }); acc[g.game].plays++; acc[g.game].bestAccuracy = Math.max(acc[g.game].bestAccuracy, g.accuracy ?? 0); return acc; }, {})),
    recommendations: recs.sort((a, b) => b.priority - a.priority).slice(0, 6),
    method: 'Mastery is a weighted average of your recent results in each topic (newer answers count more). Recommendations are rules: teacher-set work first, then topics below 60%, then topics not practised for a week, then new topics.',
  };
}
progressRouter.get('/me', requirePermission('progress:view_own'), async (req, res) => {
  const p = await StudentProfile.findOne({ userId: req.auth!.userId }).populate('subjectIds', 'name').lean(); if (!p) throw notFound('No student profile');
  const subjectId = typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined;
  if (subjectId) { if (!p.subjectIds.some((s: any) => String(s._id) === subjectId)) throw forbidden('You are not enrolled in this subject'); return res.json({ subjectId, ...(await progressFor(req.auth!.userId, subjectId)) }); }
  const ms = await Mastery.find({ userId: req.auth!.userId }).lean();
  res.json({ subjects: p.subjectIds.map((s: any) => { const m = ms.filter((x) => String(x.subjectId) === String(s._id)); return { subjectId: s._id, name: s.name, topics: m.length, pct: m.length ? Math.round((100 * m.reduce((t, x) => t + x.score, 0)) / m.length) : null }; }) });
});
/** Teacher class view: only students of the teacher's own school, in a subject (and year) the teacher is assigned to. */
async function teacherScope(req: any, subjectId: string) {
  if (isSuper(req)) return { schoolId: req.query.schoolId, yearOfStudy: undefined };
  const t = await TeacherAssignment.findOne({ teacherId: req.auth.userId, subjectId }).lean(); if (!t) throw forbidden('You are not assigned to this subject');
  return { schoolId: String(t.schoolId), yearOfStudy: t.yearOfStudy ?? undefined };
}
progressRouter.get('/class', requirePermission('progress:view_class'), async (req, res) => {
  const subjectId = oid.parse(req.query.subjectId); const sc = await teacherScope(req, subjectId);
  const students = await StudentProfile.find({ schoolId: sc.schoolId, subjectIds: subjectId, ...(sc.yearOfStudy ? { yearOfStudy: sc.yearOfStudy } : {}) }).populate('userId', 'fullName').lean();
  const ids = students.map((s) => (s.userId as any)._id);
  const [ms, ats] = await Promise.all([Mastery.find({ userId: { $in: ids }, subjectId }).lean(), Attempt.find({ userId: { $in: ids }, subjectId, status: { $ne: 'in_progress' } }).select('userId pct submittedAt status').lean()]);
  const topics: Record<string, number[]> = {}; for (const m of ms) (topics[m.topic] ??= []).push(m.score);
  res.json({ students: students.map((s) => { const u = s.userId as any; const m = ms.filter((x) => String(x.userId) === String(u._id)); const a = ats.filter((x) => String(x.userId) === String(u._id));
      return { userId: u._id, name: u.fullName, yearOfStudy: s.yearOfStudy, mastery: m.length ? Math.round((100 * m.reduce((t, x) => t + x.score, 0)) / m.length) : null, attempts: a.length, pendingReview: a.filter((x) => x.status === 'pending_review').length,
        lastActive: a.map((x) => x.submittedAt).sort().at(-1), weakTopics: m.filter((x) => x.score < 0.6).map((x) => x.topic) }; }),
    topics: Object.entries(topics).map(([topic, v]) => ({ topic, avg: Math.round((100 * v.reduce((a, b) => a + b, 0)) / v.length), students: v.length })).sort((a, b) => a.avg - b.avg) });
});

// ===================== Teacher assessments & marking =====================
export const assessmentsRouter = Router();
assessmentsRouter.use(authenticate, requireAnyPermission('activity:assign', 'platform:manage'));
const loadOwnAssessment = async (req: any) => { if (!mongoose.isValidObjectId(req.params.id)) throw notFound(); const a = await Assessment.findById(req.params.id); if (!a) throw notFound('Assessment not found');
  if (!isSuper(req)) { const t = await TeacherAssignment.exists({ teacherId: req.auth.userId, subjectId: a.subjectId, schoolId: a.schoolId }); if (!t) throw notFound('Assessment not found'); } return a; };
assessmentsRouter.post('/', async (req, res) => {
  const b = z.object({ title: z.string().trim().min(3).max(200), subjectId: oid, mode: z.enum(['assigned', 'mock']), questionIds: z.array(oid).min(1).max(60), yearOfStudy: z.number().int().min(1).max(6).optional(), classGroup: z.string().max(60).optional(),
    timeLimitSec: z.number().int().min(60).max(4 * 3600).optional(), randomize: z.boolean().default(true), maxAttempts: z.number().int().min(1).max(10).default(1), opensAt: z.iso.datetime().optional(), closesAt: z.iso.datetime().optional(),
    showAnswers: z.enum(['after_submit', 'after_close']).default('after_submit'), classId: oid.optional() }).strict().parse(req.body);
  const sc = await teacherScope(req, b.subjectId);
  let cls: any = null; if (b.classId) { cls = await ClassGroup.findById(b.classId).lean(); if (!cls || String(cls.schoolId) !== String(sc.schoolId) || (cls.subjectId && String(cls.subjectId) !== b.subjectId) || (!isSuper(req) && !cls.teacherIds.map(String).includes(req.auth!.userId))) throw forbidden('Not your class'); } if (!sc.schoolId) throw badRequest('schoolId required');
  const qs = await Question.find({ _id: { $in: b.questionIds }, subjectId: b.subjectId, status: 'published' }).select('timeLimitSec').lean(); if (qs.length !== new Set(b.questionIds).size) throw badRequest('All questions must be approved (published) questions of this subject');
  // no explicit time limit: use the questions' own time limits when every question has one
  if (!b.timeLimitSec && qs.every((q: any) => q.timeLimitSec)) b.timeLimitSec = Math.min(4 * 3600, Math.max(60, qs.reduce((t: number, q: any) => t + q.timeLimitSec, 0)));
  if (b.opensAt && b.closesAt && b.opensAt >= b.closesAt) throw badRequest('closesAt must be after opensAt');
  const a = await Assessment.create({ ...b, schoolId: sc.schoolId, yearOfStudy: cls ? cls.yearOfStudy ?? b.yearOfStudy : b.yearOfStudy ?? sc.yearOfStudy, createdBy: req.auth!.userId, status: 'published' });
  audit(req, 'assessment.create', String(a._id));
  const targets = cls ? cls.studentIds : await StudentProfile.find({ schoolId: sc.schoolId, subjectIds: b.subjectId, ...(a.yearOfStudy ? { yearOfStudy: a.yearOfStudy } : {}) }).distinct('userId');
  await notify(targets, { type: 'assignment.new', title: `New ${b.mode === 'mock' ? 'mock exam' : 'assignment'}: ${b.title}`, body: b.closesAt ? `Due ${new Date(b.closesAt).toUTCString()}` : undefined, link: `/learn/${b.subjectId}/practice` }); res.status(201).json({ assessment: a });
});
assessmentsRouter.get('/', async (req, res) => {
  const f: any = {}; if (!isSuper(req)) { const ts = await TeacherAssignment.find({ teacherId: req.auth!.userId }).lean(); f.$or = ts.map((t) => ({ schoolId: t.schoolId, subjectId: t.subjectId })); if (!ts.length) return res.json({ items: [] }); }
  res.json({ items: await Assessment.find(f).populate('subjectId', 'name').sort({ createdAt: -1 }).limit(100).lean() });
});
assessmentsRouter.patch('/:id', async (req, res) => { const a = await loadOwnAssessment(req);
  const b = z.object({ status: z.enum(['draft', 'published', 'closed']).optional(), closesAt: z.iso.datetime().optional(), showAnswers: z.enum(['after_submit', 'after_close']).optional() }).strict().parse(req.body);
  Object.assign(a, b); await a.save(); res.json({ assessment: a }); });
assessmentsRouter.get('/:id/results', async (req, res) => { const a = await loadOwnAssessment(req);
  const ats = await Attempt.find({ assessmentId: a._id, schoolId: a.schoolId }).select('userId status pct score maxScore submittedAt provisional autoSubmitted').populate('userId', 'fullName').lean();
  res.json({ assessment: a, attempts: ats }); });
assessmentsRouter.get('/:id/results.csv', async (req, res) => { const a = await loadOwnAssessment(req);
  const ats = await Attempt.find({ assessmentId: a._id, schoolId: a.schoolId }).populate('userId', 'fullName').lean();
  const csv = assignmentCsv(ats.map((x: any) => ({ name: x.userId?.fullName, status: x.status, score: x.score, maxScore: x.maxScore, pct: x.pct, provisional: x.provisional, submittedAt: x.submittedAt, revisionTopics: x.revisionTopics })));
  audit(req, 'report.export', String(a._id), { format: 'csv', kind: 'assessment' });
  res.type('text/csv').attachment(`results-${String(a.title).replace(/[^\w-]+/g, '_').slice(0, 40)}.csv`).send(csv); });
assessmentsRouter.get('/:id/attempts/:attemptId', async (req, res) => { const a = await loadOwnAssessment(req);
  const at = await Attempt.findOne({ _id: req.params.attemptId, assessmentId: a._id }); if (!at) throw notFound('Attempt not found');
  const v = await viewAttempt(at, { revealAnswers: true }); const st = await User.findById(at.userId).select('fullName').lean();
  res.json({ attempt: { ...v, student: st?.fullName, responses: at.responses.map((r: any) => ({ questionId: r.questionId, response: r.response, score: r.score, maxScore: r.maxScore, criteria: r.criteria, parts: r.parts, markedBy: r.markedBy, needsReview: r.needsReview, feedback: r.feedback })) } }); });
/** Pending written answers (AI-provisional or unmarked) across the teacher's subjects/school. */
assessmentsRouter.get('/marking/queue', async (req, res) => {
  const ts = isSuper(req) ? null : await TeacherAssignment.find({ teacherId: req.auth!.userId }).lean();
  const f: any = { status: 'pending_review' }; if (ts) { if (!ts.length) return res.json({ items: [] }); f.$or = ts.map((t) => ({ schoolId: t.schoolId, subjectId: t.subjectId })); }
  res.json({ items: await Attempt.find(f).select('userId subjectId assessmentId mode submittedAt pct').populate('userId', 'fullName').populate('subjectId', 'name').sort({ submittedAt: 1 }).limit(100).lean() });
});
assessmentsRouter.get('/marking/:attemptId', async (req, res) => {
  const at = await markable(req); const v = await viewAttempt(at, { revealAnswers: true }); const qs = await Question.find({ _id: { $in: at.items.map((i: any) => i.questionId) } }).select('rubric data.guidance data.parts type').lean();
  res.json({ attempt: { ...v, responses: at.responses, rubrics: qs } });
});
async function markable(req: any) {
  if (!mongoose.isValidObjectId(req.params.attemptId)) throw notFound(); const at = await Attempt.findById(req.params.attemptId); if (!at) throw notFound('Attempt not found');
  if (!isSuper(req)) { const t = await TeacherAssignment.exists({ teacherId: req.auth.userId, subjectId: at.subjectId, schoolId: at.schoolId }); if (!t) throw notFound('Attempt not found'); }
  return at;
}
assessmentsRouter.post('/marking/:attemptId/responses/:questionId/verify', async (req, res) => {
  const at = await markable(req);
  const b = z.object({ score: z.number().min(0).optional(), criteria: z.array(z.object({ criterion: z.string(), marks: z.number().min(0) })).optional(), partScores: z.array(z.number().min(0).nullable()).optional(), comment: z.string().max(2000).optional() }).strict().parse(req.body);
  await verifyResponse(at, String(req.params.questionId), b as any, req.auth!.userId); audit(req, 'attempt.verify', String(at._id), { questionId: req.params.questionId });
  res.json({ attempt: { _id: at._id, status: at.status, score: at.score, maxScore: at.maxScore, pct: at.pct, provisional: at.provisional } });
});
export { Subject, assessmentFor };
