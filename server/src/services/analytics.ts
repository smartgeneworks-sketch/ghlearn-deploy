import mongoose from 'mongoose';
import { User, StudentProfile, ClassGroup, CurriculumDocument, Job, Lesson, Question, LearningResource, TutorMessage, TutorConversation, Attempt, Assessment, GameSession, Mastery, AiUsage, XpEvent, AuditLog, Subject } from '../models/index.js';
import { forbidden } from '../lib/errors.js';
import { config } from '../config.js';
import { budgetStatus } from './usage.js';
import type { AuthCtx } from '../middleware/index.js';

export type Scope = 'platform' | 'school' | 'content';
export interface Filters { region?: string; schoolId?: string; levelId?: string; classId?: string; subjectId?: string; topic?: string; from?: Date; to?: Date }
/** Which sections each scope may see. School admins see their learners, never platform storage/health or other schools; content staff see content pipeline/AI only, never learner data. */
export const SECTIONS: Record<Scope, string[]> = {
  platform: ['users', 'active', 'enrolment', 'content', 'tutor', 'exercises', 'topics', 'engagement', 'ai', 'storage', 'health'],
  school: ['users', 'active', 'enrolment', 'published', 'tutor', 'exercises', 'topics', 'engagement', 'ai'],
  content: ['content', 'ai'],
};
const id = (s?: string) => (s ? new mongoose.Types.ObjectId(s) : undefined);

export async function resolveScope(a: AuthCtx, f: Filters): Promise<{ scope: Scope; f: Filters }> {
  if (a.roles.includes('super_admin')) return { scope: 'platform', f };
  if (a.roles.includes('school_admin')) {
    if (f.schoolId && f.schoolId !== a.schoolId) throw forbidden('You can only view analytics for your school');
    if (f.classId && !(await ClassGroup.exists({ _id: f.classId, schoolId: a.schoolId }))) throw forbidden('Class is not in your school');
    return { scope: 'school', f: { ...f, schoolId: a.schoolId } };
  }
  if (a.roles.includes('content_reviewer') || a.roles.includes('curriculum_admin')) {
    if (f.schoolId || f.classId || f.region) throw forbidden('Content analytics are not school-, class- or region-specific');
    return { scope: 'content', f };
  }
  throw forbidden('Missing permission: analytics:view');
}

export async function analytics(scope: Scope, f: Filters) {
  const to = f.to ?? new Date(); const from = f.from ?? new Date(to.getTime() - 30 * 86400000);
  const range = { $gte: from, $lte: to };
  const show = new Set(SECTIONS[scope]); const out: Record<string, unknown> = { scope, sections: [...show], filters: { ...f, from, to } };
  const subj = f.subjectId ? { subjectId: id(f.subjectId) } : {};

  // Learner population for the filters (null = no learner filter, platform-wide).
  let learners: mongoose.Types.ObjectId[] | null = null;
  if (f.schoolId || f.levelId || f.classId || f.region) {
    const pf: any = {}; if (f.region) pf.region = f.region; if (f.schoolId) pf.schoolId = id(f.schoolId); if (f.levelId) pf.levelId = id(f.levelId); if (f.subjectId) pf.subjectIds = id(f.subjectId);
    if (f.classId) { const c = await ClassGroup.findById(f.classId).lean(); pf.userId = { $in: c?.studentIds ?? [] }; }
    learners = await StudentProfile.find(pf).distinct('userId') as any;
  }
  const who = (k = 'userId') => (learners ? { [k]: { $in: learners } } : {});
  const userScope = f.schoolId ? { schoolId: id(f.schoolId) } : {};

  if (show.has('users')) {
    const byRole = await User.aggregate([{ $match: userScope }, { $unwind: '$roles' }, { $group: { _id: { role: '$roles', status: '$status' }, n: { $sum: 1 } } }]);
    const roles: Record<string, any> = {}; for (const r of byRole) { (roles[r._id.role] ??= { total: 0 }); roles[r._id.role].total += r.n; roles[r._id.role][r._id.status] = r.n; }
    out.users = { total: await User.countDocuments(userScope), newInRange: await User.countDocuments({ ...userScope, createdAt: range }), byRole: roles, loggedInInRange: await User.countDocuments({ ...userScope, lastLoginAt: range }) };
  }
  if (show.has('active')) {
    const ids = new Set<string>();
    const add = (xs: unknown[]) => xs.forEach((x) => ids.add(String(x)));
    add(await Attempt.distinct('userId', { ...who(), ...subj, updatedAt: range })); add(await GameSession.distinct('userId', { ...who(), ...subj, updatedAt: range }));
    add(await TutorMessage.distinct('userId', { ...who(), role: 'user', createdAt: range }));
    const staffActors = await AuditLog.distinct('actorId', { createdAt: range });
    const teachers = await User.countDocuments({ _id: { $in: staffActors }, roles: 'teacher', ...userScope });
    const teacherLogins = await User.countDocuments({ roles: 'teacher', lastLoginAt: range, ...userScope });
    out.active = { students: ids.size, teachers: Math.max(teachers, teacherLogins), method: 'Active student = submitted/started practice, played a game or asked the tutor in the range. Active teacher = logged in or took an audited action in the range.' };
  }
  if (show.has('enrolment')) {
    const m: any = {}; if (f.region) m.region = f.region; if (f.schoolId) m.schoolId = id(f.schoolId); if (f.levelId) m.levelId = id(f.levelId); if (learners) m.userId = { $in: learners };
    const bySubject = await StudentProfile.aggregate([{ $match: m }, { $unwind: '$subjectIds' }, ...(f.subjectId ? [{ $match: { subjectIds: id(f.subjectId) } }] : []), { $group: { _id: '$subjectIds', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 40 }]);
    const names = new Map((await Subject.find({ _id: { $in: bySubject.map((x) => x._id) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
    const byYear = await StudentProfile.aggregate([{ $match: m }, { $group: { _id: '$yearOfStudy', n: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
    const byRegion = await StudentProfile.aggregate([{ $match: m }, { $group: { _id: '$region', n: { $sum: 1 } } }, { $sort: { n: -1 } }]);
    out.enrolment = { students: await StudentProfile.countDocuments(m), bySubject: bySubject.map((x) => ({ subjectId: x._id, subject: names.get(String(x._id)) ?? '?', students: x.n })), byYear: byYear.map((x) => ({ year: x._id, students: x.n })), byRegion: byRegion.map((x) => ({ region: x._id ?? 'Not set', students: x.n })),
      classes: await ClassGroup.countDocuments({ ...userScope, archived: false, ...(f.subjectId ? subj : {}) }) };
  }
  const cf: any = { ...subj, ...(f.levelId ? { levelId: id(f.levelId) } : {}) };
  if (show.has('content')) {
    const docs = await CurriculumDocument.aggregate([{ $match: cf }, { $group: { _id: '$processingStatus', n: { $sum: 1 } } }]);
    const jobs = await Job.aggregate([{ $match: { createdAt: range } }, { $group: { _id: { type: '$type', status: '$status' }, n: { $sum: 1 } } }]);
    const jobTable: Record<string, any> = {}; for (const j of jobs) (jobTable[j._id.type] ??= {})[j._id.status] = j.n;
    const lessons = await Lesson.aggregate([{ $match: cf }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const qs = await Question.aggregate([{ $match: { ...subj, ...(f.topic ? { topic: f.topic } : {}) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const obj = (xs: any[]) => Object.fromEntries(xs.map((x) => [x._id ?? 'unknown', x.n]));
    const proc = jobTable['document.process'] ?? {};
    out.content = { manuals: { total: await CurriculumDocument.countDocuments(cf), uploadedInRange: await CurriculumDocument.countDocuments({ ...cf, createdAt: range }), byProcessing: obj(docs) },
      processing: { succeeded: proc.succeeded ?? 0, failed: (proc.dead ?? 0) + (proc.failed ?? 0), queued: (proc.queued ?? 0) + (proc.running ?? 0), successRate: proc.succeeded || proc.dead ? Math.round((100 * (proc.succeeded ?? 0)) / ((proc.succeeded ?? 0) + (proc.dead ?? 0) + (proc.failed ?? 0))) : null },
      jobs: jobTable, lessons: { byStatus: obj(lessons), generatedInRange: await Lesson.countDocuments({ ...cf, createdAt: range }) }, questions: { byStatus: obj(qs), generatedInRange: await Question.countDocuments({ ...subj, aiGenerated: true, createdAt: range }) },
      pendingReviews: { lessons: await Lesson.countDocuments({ ...cf, status: { $in: ['in_review', 'resubmitted'] } }), questions: await Question.countDocuments({ ...subj, status: 'in_review' }) },
      published: { resources: await LearningResource.countDocuments({ ...subj, status: 'published' }), questions: await Question.countDocuments({ ...subj, status: 'published' }) } };
  }
  if (show.has('published')) out.published = { resources: await LearningResource.countDocuments({ ...subj, status: 'published' }), questions: await Question.countDocuments({ ...subj, status: 'published' }), note: 'Platform-wide approved content available to your students.' };
  if (show.has('tutor')) {
    const conv = f.subjectId ? await TutorConversation.distinct('_id', { ...subj, ...who() }) : null;
    const mf: any = { createdAt: range, ...who(), ...(conv ? { conversationId: { $in: conv } } : {}) };
    const [asked, answers, types, fb] = await Promise.all([
      TutorMessage.countDocuments({ ...mf, role: 'user' }), TutorMessage.countDocuments({ ...mf, role: 'assistant' }),
      TutorMessage.aggregate([{ $match: { ...mf, role: 'assistant' } }, { $group: { _id: '$answerType', n: { $sum: 1 } } }]),
      TutorMessage.aggregate([{ $match: { ...mf, role: 'assistant', 'feedback.rating': { $exists: true } } }, { $group: { _id: '$feedback.rating', n: { $sum: 1 } } }]) ]);
    const up = fb.find((x) => x._id === 'up')?.n ?? 0; const down = fb.find((x) => x._id === 'down')?.n ?? 0;
    out.tutor = { questions: asked, answers, users: (await TutorMessage.distinct('userId', { ...mf, role: 'user' })).length, answerTypes: Object.fromEntries(types.map((t) => [t._id ?? 'unknown', t.n])),
      feedback: { up, down, rated: up + down, helpfulPct: up + down ? Math.round((100 * up) / (up + down)) : null } };
  }
  const af: any = { ...who(), ...subj, ...(f.topic ? { topic: f.topic } : {}), ...(f.schoolId && !learners ? { schoolId: id(f.schoolId) } : {}) };
  if (show.has('exercises')) {
    const modes = await Attempt.aggregate([{ $match: { ...af, startedAt: range } }, { $group: { _id: '$mode', started: { $sum: 1 }, done: { $sum: { $cond: [{ $ne: ['$status', 'in_progress'] }, 1, 0] } }, avg: { $avg: '$pct' } } }]);
    const started = modes.reduce((t, m) => t + m.started, 0); const done = modes.reduce((t, m) => t + m.done, 0);
    const asf: any = { ...subj, createdAt: range, ...(f.schoolId ? { schoolId: id(f.schoolId) } : {}), ...(f.classId ? { classId: id(f.classId) } : {}) };
    const assigns = await Assessment.find(asf).select('_id').lean();
    const asub = assigns.length ? await Attempt.countDocuments({ assessmentId: { $in: assigns.map((a) => a._id) }, status: { $ne: 'in_progress' }, ...who() }) : 0;
    const games = await GameSession.aggregate([{ $match: { ...who(), ...subj, startedAt: range } }, { $group: { _id: '$game', n: { $sum: 1 }, finished: { $sum: { $cond: [{ $eq: ['$status', 'finished'] }, 1, 0] } }, acc: { $avg: '$accuracy' } } }]);
    out.exercises = { attemptsStarted: started, attemptsCompleted: done, completionPct: started ? Math.round((100 * done) / started) : null,
      byMode: modes.map((m) => ({ mode: m._id, started: m.started, completed: m.done, avgPct: m.avg == null ? null : Math.round(m.avg) })),
      assignments: { set: assigns.length, submissions: asub }, games: games.map((g) => ({ game: g._id, played: g.n, finished: g.finished, avgAccuracy: g.acc == null ? null : Math.round(g.acc * (g.acc <= 1 ? 100 : 1)) })),
      pendingMarking: await Attempt.countDocuments({ ...af, status: 'pending_review' }) };
  }
  if (show.has('topics')) {
    const mm: any = { ...who(), ...subj, ...(f.topic ? { topic: f.topic } : {}) };
    if (!learners && f.schoolId) mm.userId = { $in: await StudentProfile.find({ schoolId: id(f.schoolId) }).distinct('userId') };
    const t = await Mastery.aggregate([{ $match: mm }, { $group: { _id: '$topic', avg: { $avg: '$score' }, students: { $sum: 1 }, answered: { $sum: '$answered' }, weak: { $sum: { $cond: [{ $lt: ['$score', 0.6] }, 1, 0] } } } }, { $sort: { avg: 1 } }, { $limit: 30 }]);
    out.topics = t.map((x) => ({ topic: x._id, avgPct: Math.round(x.avg * 100), students: x.students, answered: x.answered, below60: x.weak }));
  }
  if (show.has('engagement')) {
    const day = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
    const series = await XpEvent.aggregate([{ $match: { ...who(), ...subj, createdAt: range, ...(f.schoolId && !learners ? { schoolId: id(f.schoolId) } : {}) } }, { $group: { _id: { d: day, u: '$userId' }, xp: { $sum: '$xp' }, n: { $sum: 1 } } }, { $group: { _id: '$_id.d', users: { $sum: 1 }, xp: { $sum: '$xp' }, events: { $sum: '$n' } } }, { $sort: { _id: 1 } }]);
    out.engagement = { daily: series.map((s) => ({ day: s._id, activeLearners: s.users, learningEvents: s.events, xp: s.xp })), method: 'Counts learning events that earned XP (answers, completed games, lessons), not time on screen.' };
  }
  if (show.has('ai')) {
    const um: any = { createdAt: range, ...(scope === 'school' ? { userId: { $in: learners ?? (await User.find({ schoolId: id(f.schoolId) }).distinct('_id')) } } : {}) };
    const rows = await AiUsage.aggregate([{ $match: um }, { $group: { _id: { purpose: '$purpose', status: '$status' }, n: { $sum: 1 }, inT: { $sum: { $ifNull: ['$inputTokens', 0] } }, outT: { $sum: { $add: [{ $ifNull: ['$outputTokens', 0] }, { $ifNull: ['$thoughtTokens', 0] }] } } } }]);
    const by: Record<string, any> = {}; let inT = 0, outT = 0, errors = 0, n = 0;
    for (const r of rows) { const p = (by[r._id.purpose] ??= { requests: 0, errors: 0, inputTokens: 0, outputTokens: 0 }); p.requests += r.n; p.inputTokens += r.inT; p.outputTokens += r.outT; if (r._id.status !== 'ok') { p.errors += r.n; errors += r.n; } inT += r.inT; outT += r.outT; n += r.n; }
    const cost = (i: number, o: number) => Math.round(((i * config.AI_COST_INPUT_PER_M + o * config.AI_COST_OUTPUT_PER_M) / 1e6) * 10000) / 10000;
    for (const p of Object.values(by)) p.estCostUsd = cost(p.inputTokens, p.outputTokens);
    out.ai = { requests: n, errors, inputTokens: inT, outputTokens: outT, estCostUsd: cost(inT, outT), byPurpose: by, ...(scope !== 'school' ? { today: await budgetStatus() } : {}),
      method: `Estimate at USD ${config.AI_COST_INPUT_PER_M}/1M input and ${config.AI_COST_OUTPUT_PER_M}/1M output+thinking tokens (AI_COST_*_PER_M). On the free tier nothing is billed.` };
  }
  if (show.has('storage')) {
    const db = mongoose.connection.db!; const st: any = await db.stats().catch(() => ({}));
    const [gf] = await db.collection('uploads.files').aggregate([{ $group: { _id: null, bytes: { $sum: '$length' }, n: { $sum: 1 } } }]).toArray().catch(() => []);
    const cols = ['chunks', 'documentpages', 'lessons', 'questions', 'attempts', 'tutormessages', 'auditlogs', 'aiusages', 'notifications'];
    const counts = Object.fromEntries(await Promise.all(cols.map(async (c) => [c, await db.collection(c).estimatedDocumentCount().catch(() => 0)])));
    const sizes = Object.fromEntries(await Promise.all(['chunks', 'documentpages', 'curriculumdocuments', 'jobs', 'auditlogs'].map(async (c) => {
      const [r]: any[] = await db.collection(c).aggregate([{ $collStats: { storageStats: {} } }]).toArray().catch(() => []);
      return [c, r ? { dataBytes: r.storageStats?.size ?? null, indexBytes: r.storageStats?.totalIndexSize ?? null, avgDocBytes: r.storageStats?.avgObjSize ?? null } : null];
    })));
    out.storage = { dataBytes: st.dataSize ?? null, storageBytes: st.storageSize ?? null, indexBytes: st.indexSize ?? null, uploads: { files: gf?.n ?? 0, bytes: gf?.bytes ?? 0 }, collections: counts, collectionSizes: sizes, quotaBytes: 512 * 1024 * 1024, note: 'Atlas M0 quota is 512 MB (data + indexes).' };
  }
  if (show.has('health')) {
    const t0 = Date.now(); let dbOk = true; try { await mongoose.connection.db!.admin().ping(); } catch { dbOk = false; }
    const [queued, running, dead] = await Promise.all([Job.countDocuments({ status: 'queued' }), Job.countDocuments({ status: 'running' }), Job.countDocuments({ status: 'dead', finishedAt: range })]);
    const recent = await Job.find({ 'errorLog.0': { $exists: true }, updatedAt: range }).sort({ updatedAt: -1 }).limit(10).select('type status errorLog updatedAt').lean();
    out.health = { db: { ok: dbOk, pingMs: Date.now() - t0 }, uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576), queue: { queued, running, deadInRange: dead },
      aiErrorsInRange: await AiUsage.countDocuments({ createdAt: range, status: { $in: ['error', 'budget_exceeded'] } }),
      recentErrors: recent.map((j) => ({ jobId: j._id, type: j.type, status: j.status, at: j.errorLog.at(-1)?.at, message: j.errorLog.at(-1)?.message })) };
  }
  return out;
}
