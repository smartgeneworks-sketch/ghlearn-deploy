import { ClassGroup, Attempt, Assessment, Mastery, Question, StudentProfile, TeacherAssignment, User, LearningResource, Lesson } from '../../models/index.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { normalize } from '../assess/core.js';
import type { AuthCtx } from '../../middleware/index.js';

const isSuper = (a: AuthCtx) => a.roles.includes('super_admin');
const isSchoolAdmin = (a: AuthCtx) => a.roles.includes('school_admin');

/** Classes visible to the caller: super = all, school admin = own school, teacher = classes they teach. */
export function classFilter(a: AuthCtx): Record<string, unknown> {
  if (isSuper(a)) return {};
  if (isSchoolAdmin(a)) return { schoolId: a.schoolId };
  return { teacherIds: a.userId, schoolId: a.schoolId };
}
export async function loadClass(a: AuthCtx, id: string) {
  const c = await ClassGroup.findOne({ _id: id, ...classFilter(a) });
  if (!c) throw notFound('Class not found'); return c;
}
/** Teachers may only build classes for subjects they are assigned to at their school; students must belong to that school (and take the subject). */
export async function checkMembers(a: AuthCtx, schoolId: string, subjectId: string | undefined, studentIds: string[], teacherIds: string[]) {
  if (subjectId && !isSuper(a) && !isSchoolAdmin(a) && !(await TeacherAssignment.exists({ teacherId: a.userId, subjectId, schoolId }))) throw forbidden('You are not assigned to this subject');
  if (studentIds.length) {
    const ok = await StudentProfile.countDocuments({ userId: { $in: studentIds }, schoolId, ...(subjectId ? { subjectIds: subjectId } : {}) });
    if (ok !== new Set(studentIds).size) throw forbidden('Every student must be at this school and enrolled in the subject');
  }
  if (teacherIds.length) {
    const ok = await User.countDocuments({ _id: { $in: teacherIds }, schoolId, roles: 'teacher' });
    if (ok !== new Set(teacherIds).size) throw forbidden('Co-teachers must be teachers at this school');
  }
}

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : null);
const days = (d?: Date | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null);

/** Human-readable form of a student's answer, resolving permuted MCQ options back to text. */
export function answerText(q: any, perm: any, resp: any): string | null {
  if (resp === undefined || resp === null || resp === '') return null;
  const d = q.data ?? {};
  if (q.type === 'mcq') { const i = Number(resp); const canon = Array.isArray(perm?.options) ? perm.options[i] : i; return d.options?.[canon] ?? null; }
  if (q.type === 'true_false') return resp === true || resp === 'true' ? 'True' : 'False';
  if (['short_answer', 'numerical'].includes(q.type)) return String(resp).trim().slice(0, 80);
  if (q.type === 'gap_fill' && Array.isArray(resp)) return resp.map((x) => String(x ?? '').trim()).join(' | ').slice(0, 80);
  return null; // matching/ordering/written work: per-answer text is not a useful misconception signal
}
function correctText(q: any): string | null {
  const d = q.data ?? {};
  if (q.type === 'mcq') return d.options?.[d.correctIndex] ?? null;
  if (q.type === 'true_false') return d.answer ? 'True' : 'False';
  if (q.type === 'short_answer') return d.acceptedAnswers?.[0] ?? null;
  if (q.type === 'numerical') return `${d.value}${d.unit ? ' ' + d.unit : ''}`;
  if (q.type === 'gap_fill') return (d.gaps ?? []).map((b: any) => b.accepted?.[0]).join(' | ');
  return null;
}

/** Wrong answers grouped by question: what the class most often gets wrong, and what they answer instead. */
export async function misconceptions(attempts: any[], limit = 10) {
  const per = new Map<string, { n: number; wrong: number; answers: Map<string, number> }>();
  const qids = new Set<string>(); for (const a of attempts) for (const r of a.responses) qids.add(String(r.questionId));
  const qs = new Map((await Question.find({ _id: { $in: [...qids] } }).lean()).map((q) => [String(q._id), q]));
  for (const a of attempts) {
    const perms = new Map((a.items ?? []).map((i: any) => [String(i.questionId), i.perm]));
    for (const r of a.responses) {
      const q = qs.get(String(r.questionId)); if (!q || r.maxScore == null || r.markedBy === 'pending') continue;
      const e = per.get(String(q._id)) ?? { n: 0, wrong: 0, answers: new Map() }; per.set(String(q._id), e); e.n++;
      if ((r.score ?? 0) >= r.maxScore) continue; e.wrong++;
      const t = answerText(q, perms.get(String(q._id)), r.response); if (t) { const k = normalize(t) || t; e.answers.set(k, (e.answers.get(k) ?? 0) + 1); }
    }
  }
  return [...per.entries()].filter(([, e]) => e.n >= 2 && e.wrong / e.n >= 0.4).map(([id, e]) => { const q: any = qs.get(id);
    return { questionId: id, stem: q.stem, topic: q.topic, type: q.type, objective: q.objective, responses: e.n, wrong: e.wrong, wrongPct: pct(e.wrong, e.n),
      commonWrongAnswers: [...e.answers.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([answer, count]) => ({ answer, count })),
      correctAnswer: correctText(q), explanation: q.explanation ?? null }; })
    .sort((x, y) => (y.wrongPct! - x.wrongPct!) || y.responses - x.responses).slice(0, limit);
}

/** Everything the class view needs, computed from stored attempts/mastery (no AI). */
export async function classOverview(c: any) {
  const subjectId = c.subjectId; const ids = c.studentIds.map(String);
  const subj = subjectId ? { subjectId } : {};
  const [users, ms, ats, assignments] = await Promise.all([
    User.find({ _id: { $in: ids } }).select('fullName email lastLoginAt').lean(),
    Mastery.find({ userId: { $in: ids }, ...subj }).lean(),
    Attempt.find({ userId: { $in: ids }, ...subj, status: { $ne: 'in_progress' } }).sort({ submittedAt: 1 }).lean(),
    Assessment.find({ $or: [{ classId: c._id }, { schoolId: c.schoolId, classId: null, ...(subjectId ? { subjectId } : {}), ...(c.yearOfStudy ? { yearOfStudy: { $in: [null, c.yearOfStudy] } } : {}) }] }).sort({ createdAt: -1 }).limit(100).lean(),
  ]);
  const now = Date.now();
  const topicAgg: Record<string, { sum: number; n: number; weak: string[] }> = {};
  for (const m of ms) { const t = (topicAgg[m.topic] ??= { sum: 0, n: 0, weak: [] }); t.sum += m.score; t.n++; if (m.score < 0.6 && m.answered >= 2) t.weak.push(String(m.userId)); }
  const name = new Map(users.map((u) => [String(u._id), u.fullName]));
  const asg = assignments.map((a) => { const sub = ats.filter((x) => String(x.assessmentId) === String(a._id)); const by = new Set(sub.map((x) => String(x.userId)));
    return { _id: a._id, title: a.title, mode: a.mode, classId: a.classId ?? null, closesAt: a.closesAt, opensAt: a.opensAt, questions: a.questionIds.length,
      submitted: by.size, outOf: ids.length, completionPct: pct(by.size, ids.length), avgPct: sub.length ? Math.round(sub.reduce((t, x) => t + (x.pct ?? 0), 0) / sub.length) : null,
      pendingReview: sub.filter((x) => x.status === 'pending_review' || x.provisional).length, overdue: !!a.closesAt && a.closesAt.getTime() < now, submittedBy: [...by] }; });
  const students = ids.map((id: string) => {
    const mine = ms.filter((m) => String(m.userId) === id); const at = ats.filter((a) => String(a.userId) === id);
    const overall = mine.length ? Math.round((100 * mine.reduce((t, m) => t + m.score, 0)) / mine.length) : null;
    const answered = mine.reduce((t, m) => t + m.answered, 0);
    const last3 = at.slice(-3); const recent = last3.length ? Math.round(last3.reduce((t, a) => t + (a.pct ?? 0), 0) / last3.length) : null;
    const lastActive = at.at(-1)?.submittedAt ?? mine.map((m) => m.lastAt).filter(Boolean).sort().at(-1) ?? null;
    const missed = asg.filter((a) => a.overdue && (!a.classId || String(a.classId) === String(c._id)) && !a.submittedBy.includes(id));
    const weak = mine.filter((m) => m.score < 0.6 && m.answered >= 2).sort((x, y) => x.score - y.score).map((m) => ({ topic: m.topic, pct: Math.round(m.score * 100) }));
    const reasons: string[] = [];
    if (overall != null && answered >= 5 && overall < 50) reasons.push(`Overall mastery ${overall}% (below 50%)`);
    if (recent != null && last3.length >= 2 && recent < 40) reasons.push(`Last ${last3.length} attempts average ${recent}% (below 40%)`);
    if (missed.length) reasons.push(`${missed.length} overdue assignment${missed.length > 1 ? 's' : ''} not submitted`);
    const idle = days(lastActive as any); if (idle == null ? true : idle >= 14) reasons.push(idle == null ? 'No practice recorded yet' : `No practice for ${idle} days`);
    return { userId: id, name: name.get(id) ?? 'Unknown', overall, answered, attempts: at.length, recentPct: recent, lastActive, completed: asg.filter((a) => a.submittedBy.includes(id)).length,
      missed: missed.map((a) => a.title), weakTopics: weak.slice(0, 5), needsSupport: reasons.length > 0, reasons };
  });
  const remedial = Object.entries(topicAgg).filter(([, t]) => t.weak.length).sort((x, y) => y[1].weak.length - x[1].weak.length).slice(0, 8)
    .map(([topic, t]) => ({ topic, students: t.weak.length, names: t.weak.map((u) => name.get(u) ?? '').filter(Boolean), classAvg: Math.round((100 * t.sum) / t.n),
      suggestion: t.weak.length >= Math.max(3, ids.length / 3) ? 'Re-teach to the whole class, then set a remedial assignment' : 'Set a remedial assignment for the listed students' }));
  return {
    class: c, students: students.sort((a: any, b: any) => Number(b.needsSupport) - Number(a.needsSupport) || (a.overall ?? -1) - (b.overall ?? -1)),
    support: students.filter((s: any) => s.needsSupport),
    topics: Object.entries(topicAgg).map(([topic, t]) => ({ topic, avgPct: Math.round((100 * t.sum) / t.n), students: t.n, struggling: t.weak.length })).sort((a, b) => a.avgPct - b.avgPct),
    misconceptions: await misconceptions(ats),
    remedial, assignments: asg.map(({ submittedBy, ...a }) => a),
    summary: { students: ids.length, avgMastery: students.filter((s: any) => s.overall != null).length ? Math.round(students.reduce((t: number, s: any) => t + (s.overall ?? 0), 0) / students.filter((s: any) => s.overall != null).length) : null,
      needingSupport: students.filter((s: any) => s.needsSupport).length, attempts: ats.length, pendingReview: ats.filter((a) => a.status === 'pending_review' || a.provisional).length },
    method: 'Needs support = any of: overall mastery below 50% after 5+ answers, last attempts averaging below 40%, an overdue assignment not submitted, or no practice for 14 days. Misconceptions = questions answered wrongly by 40%+ of at least 2 responses, with the most common wrong answers.',
  };
}

/** Individual student view, restricted to students in the class. */
export async function studentDetail(c: any, userId: string) {
  if (!c.studentIds.map(String).includes(userId)) throw notFound('Student not in this class');
  const u = await User.findById(userId).select('fullName email').lean();
  const ats = await Attempt.find({ userId, ...(c.subjectId ? { subjectId: c.subjectId } : {}), status: { $ne: 'in_progress' } }).sort({ submittedAt: -1 }).limit(50).lean();
  const asmt = new Map((await Assessment.find({ _id: { $in: ats.map((a) => a.assessmentId).filter(Boolean) } }).select('title').lean()).map((a) => [String(a._id), a.title]));
  return { student: u, mastery: await Mastery.find({ userId, ...(c.subjectId ? { subjectId: c.subjectId } : {}) }).sort({ score: 1 }).lean(),
    attempts: ats.map((a) => ({ _id: a._id, mode: a.mode, topic: a.topic, title: a.assessmentId ? asmt.get(String(a.assessmentId)) : null, pct: a.pct, score: a.score, maxScore: a.maxScore, status: a.status, provisional: a.provisional, submittedAt: a.submittedAt, revisionTopics: a.revisionTopics })),
    misconceptions: await misconceptions(ats, 8) };
}

/** Questions for a remedial assignment on one topic. */
export async function remedialQuestions(subjectId: string, topic: string, n = 8) {
  const qs = await Question.find({ subjectId, topic, status: 'published' }).select('_id difficulty').lean();
  const order = { easy: 0, medium: 1, hard: 2 } as Record<string, number>;
  return qs.sort((a, b) => order[a.difficulty ?? 'medium'] - order[b.difficulty ?? 'medium']).slice(0, n).map((q) => q._id);
}

/** Published learning material for a subject, for offline download. Only published lessons/resources are ever included. */
export async function offlineContent(subjectId: string, audience: Record<string, unknown> = {}, max = 10_000) {
  const resources = await LearningResource.find({ subjectId, status: 'published', ...audience }).sort({ topic: 1, title: 1 }).limit(max).lean();
  // lessons only when their published resource is visible to this user (audience chosen at publish time)
  const lessons = await Lesson.find({ subjectId, status: 'published', resourceId: { $in: resources.map((r) => r._id) } }).sort({ topic: 1, title: 1 }).lean();
  const lessonRes = new Set(lessons.map((l) => String(l.resourceId)));
  return { lessons, resources: resources.filter((r) => !lessonRes.has(String(r._id))) };
}
