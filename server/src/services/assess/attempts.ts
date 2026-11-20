import mongoose from 'mongoose';
import { Attempt, Question, Assessment, StudentProfile, Mastery, ClassGroup, TeacherAssignment } from '../../models/index.js';
import { notify } from '../notify.js';
import { prng, shuffled, makePerm, presentQuestion, markResponse, totalMarks, OBJECTIVE } from './core.js';
import { awardXp, grantBadges, updateMastery } from './rewards.js';
import { enqueue } from '../queue.js';
import { getLlm } from '../ai.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { config } from '../../config.js';

export const MODE_DEFAULTS: Record<string, { count: number; timeLimitSec?: number; objectiveOnly?: boolean }> = {
  practice: { count: 10, objectiveOnly: true }, timed: { count: 10, timeLimitSec: 600, objectiveOnly: true }, topic_revision: { count: 10 },
  mixed: { count: 12 }, remedial: { count: 8, objectiveOnly: true }, mock: { count: 20, timeLimitSec: 3600 }, assigned: { count: 0 },
};
type Opts = { userId: string; schoolId?: string; subjectId: string; mode: string; topic?: string; types?: string[]; difficulty?: string; count?: number; timeLimitSec?: number; assessmentId?: string };

/** Eligibility for a teacher-assigned/mock assessment: same school, matching year, enrolled in the subject, window open, attempts left. */
export async function assessmentFor(userId: string, assessmentId: string) {
  const a = await Assessment.findById(assessmentId).lean(); const p = await StudentProfile.findOne({ userId }).lean();
  if (!a || a.status !== 'published' || !p || String(a.schoolId) !== String(p.schoolId) || (a.yearOfStudy && a.yearOfStudy !== p.yearOfStudy) || !p.subjectIds.map(String).includes(String(a.subjectId))) throw notFound('Assessment not found');
  if (a.classId && !(await ClassGroup.exists({ _id: a.classId, studentIds: userId }))) throw notFound('Assessment not found');
  return { a, p };
}
async function pick(o: Opts, n: number, objectiveOnly: boolean) {
  const q: any = { subjectId: o.subjectId, status: 'published' };
  if (o.topic) q.topic = o.topic; if (o.difficulty) q.difficulty = o.difficulty;
  const types = o.types?.length ? o.types : objectiveOnly ? OBJECTIVE : undefined; if (types) q.type = { $in: types };
  const all = await Question.find(q).select('_id topic').lean(); const rnd = prng(Date.now() & 0xffffffff);
  if (o.mode === 'remedial') {
    const weak = (await Mastery.find({ userId: o.userId, subjectId: o.subjectId }).sort({ score: 1 }).limit(3).lean()).filter((m) => m.score < 0.7).map((m) => m.topic);
    const wrong = new Set((await Attempt.find({ userId: o.userId, subjectId: o.subjectId, status: { $ne: 'in_progress' } }).sort({ createdAt: -1 }).limit(10).select('responses.questionId responses.correct').lean())
      .flatMap((a) => a.responses.filter((r: any) => r.correct === false).map((r: any) => String(r.questionId))));
    const score = (x: any) => (wrong.has(String(x._id)) ? 2 : 0) + (weak.includes(x.topic) ? 1 : 0) + rnd();
    return all.sort((a, b) => score(b) - score(a)).slice(0, n).map((x) => x._id);
  }
  if (o.mode === 'mixed') { const byTopic = new Map<string, any[]>(); for (const x of shuffled(all, rnd)) byTopic.set(x.topic, [...(byTopic.get(x.topic) ?? []), x]);
    const out: any[] = []; while (out.length < n && [...byTopic.values()].some((v) => v.length)) for (const v of byTopic.values()) if (v.length && out.length < n) out.push(v.shift()._id); return out; }
  return shuffled(all, rnd).slice(0, n).map((x) => x._id);
}
export async function createAttempt(o: Opts) {
  const def = MODE_DEFAULTS[o.mode]; if (!def) throw badRequest('Unknown mode');
  let ids: any[]; let timeLimit = o.timeLimitSec ?? def.timeLimitSec; let randomize = true; let schoolId = o.schoolId;
  if (o.mode === 'assigned' || (o.mode === 'mock' && o.assessmentId)) {
    if (!o.assessmentId) throw badRequest('assessmentId is required for assigned work');
    const { a, p } = await assessmentFor(o.userId, o.assessmentId);
    if (String(a.subjectId) !== o.subjectId || a.mode !== o.mode) throw badRequest('Assessment does not match subject/mode');
    const now = new Date(); if ((a.opensAt && now < a.opensAt) || (a.closesAt && now > a.closesAt)) throw new AppError(409, 'NOT_OPEN', 'This assessment is not open');
    const used = await Attempt.countDocuments({ userId: o.userId, assessmentId: a._id });
    const open = await Attempt.findOne({ userId: o.userId, assessmentId: a._id, status: 'in_progress' }); if (open) return open;
    if (used >= (a.maxAttempts ?? 1)) throw new AppError(409, 'NO_ATTEMPTS_LEFT', 'You have used all attempts for this assessment');
    ids = (await Question.find({ _id: { $in: a.questionIds }, status: 'published' }).select('_id').lean()).map((x) => x._id);
    timeLimit = a.timeLimitSec ?? undefined; randomize = a.randomize; schoolId = String(p.schoolId);
  } else {
    if (o.mode === 'topic_revision' && !o.topic) throw badRequest('Choose a topic for topic revision');
    ids = await pick(o, Math.min(o.count ?? def.count, 40), !!def.objectiveOnly && !o.types?.length);
  }
  if (!ids.length) throw new AppError(422, 'NO_QUESTIONS', 'No approved questions are available for this selection yet');
  const seed = Math.floor(Math.random() * 2 ** 31); const rnd = prng(seed);
  const qs = await Question.find({ _id: { $in: ids } }).lean(); const ordered = randomize ? shuffled(ids.map(String), rnd) : ids.map(String);
  const items = ordered.map((id) => { const q = qs.find((x) => String(x._id) === id)!; return { questionId: q._id, perm: makePerm(q, rnd, randomize) }; });
  return Attempt.create({ userId: o.userId, schoolId, subjectId: o.subjectId, assessmentId: o.assessmentId, mode: o.mode as any, topic: o.topic, seed, items,
    deadline: timeLimit ? new Date(Date.now() + timeLimit * 1000) : undefined });
}
const graceMs = () => config.ATTEMPT_GRACE_SEC * 1000;
export const timeUp = (a: any) => !!a.deadline && Date.now() > a.deadline.getTime() + graceMs();
export async function loadOwn(userId: string, id: string) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Attempt not found');
  const a = await Attempt.findOne({ _id: id, userId }); if (!a) throw notFound('Attempt not found'); // same 404 for others' attempts
  if (a.status === 'in_progress' && timeUp(a)) { a.autoSubmitted = true; await submitAttempt(a); }
  return a;
}
export async function saveResponse(a: any, questionId: string, response: unknown) {
  if (a.status !== 'in_progress') throw a.autoSubmitted && timeUp(a) ? new AppError(409, 'TIME_UP', 'Time is up: your attempt was submitted with the answers saved before the deadline') : conflict('This attempt has already been submitted');
  if (timeUp(a)) { a.autoSubmitted = true; await submitAttempt(a); throw new AppError(409, 'TIME_UP', 'Time is up: your attempt was submitted with the answers saved before the deadline'); }
  if (!a.items.some((i: any) => String(i.questionId) === questionId)) throw notFound('Question is not part of this attempt');
  if (JSON.stringify(response ?? null).length > 20000) throw badRequest('Answer too long');
  const i = a.responses.findIndex((r: any) => String(r.questionId) === questionId);
  const r = { questionId, response, answeredAt: new Date() }; if (i >= 0) a.responses[i] = r; else a.responses.push(r);
  await a.save();
}
export async function recomputeAttempt(a: any) {
  const score = a.responses.reduce((t: number, r: any) => t + (r.score ?? 0), 0); const max = a.responses.reduce((t: number, r: any) => t + (r.maxScore ?? 0), 0);
  a.score = score; a.maxScore = max; a.pct = max ? Math.round((score / max) * 1000) / 10 : 0;
  const unverified = a.responses.some((r: any) => r.needsReview && !r.verifiedAt); a.provisional = unverified; a.status = unverified ? 'pending_review' : 'marked';
  a.revisionTopics = [...new Set(a.responses.filter((r: any) => r.maxScore && r.score / r.maxScore < 0.6).map((r: any) => r.revisionTopic).filter(Boolean))];
}
export async function submitAttempt(a: any) {
  if (a.status !== 'in_progress') return a;
  const qs = await Question.find({ _id: { $in: a.items.map((i: any) => i.questionId) } }).lean();
  const responses: any[] = []; let needsAi = false;
  for (const it of a.items) {
    const q: any = qs.find((x) => String(x._id) === String(it.questionId)); if (!q) continue;
    const saved = a.responses.find((r: any) => String(r.questionId) === String(it.questionId));
    const late = saved?.answeredAt && a.deadline && saved.answeredAt.getTime() > a.deadline.getTime() + graceMs();
    const resp = late ? undefined : saved?.response; const m = markResponse(q, resp, it.perm);
    const pending = !!m.needsAi && resp != null && resp !== '';
    needsAi ||= pending;
    responses.push({ questionId: q._id, response: resp, answeredAt: saved?.answeredAt, score: m.score, maxScore: m.maxScore, correct: m.needsAi ? undefined : m.correct, feedback: m.feedback,
      explanation: m.explanation, improvement: m.improvement, revisionTopic: q.topic, parts: m.parts, markedBy: pending ? 'pending' : m.needsAi ? 'auto' : 'auto', needsReview: pending || undefined });
  }
  a.responses = responses; a.submittedAt = new Date(); await recomputeAttempt(a);
  if (needsAi) { a.status = 'pending_review'; a.provisional = true; }
  await a.save();
  if (needsAi) { const ts = await TeacherAssignment.find({ subjectId: a.subjectId, schoolId: a.schoolId }).distinct('teacherId'); await notify(ts, { type: 'marking.pending', title: 'Written answers to mark', body: 'A student submitted work with written answers that need your verification.', link: `/teach/marking/${a._id}` }); }
  if (needsAi && getLlm()) await enqueue('attempt.aiMark', { attemptId: String(a._id) }, { maxAttempts: 3, createdBy: String(a.userId) });
  else if (needsAi) await Attempt.updateOne({ _id: a._id }, { $set: { 'responses.$[r].feedback': 'Your teacher will mark this answer.' } }, { arrayFilters: [{ 'r.markedBy': 'pending' }] });
  await afterMarked(a, qs);
  return a;
}
/** Mastery + XP for auto-marked work. XP: 2 per answered objective item + 3 per fully correct; improvements over the best previous score earn a bonus. */
async function afterMarked(a: any, qs: any[]) {
  let answered = 0, correct = 0;
  for (const r of a.responses) { if (r.markedBy !== 'auto' || r.response == null || r.response === '') continue; answered++; if (r.correct) correct++;
    const q = qs.find((x) => String(x._id) === String(r.questionId)); if (q) await updateMastery(String(a.userId), String(a.subjectId), q.topic, r.maxScore ? r.score / r.maxScore : 0); }
  const qualifies = answered >= Math.min(3, Math.ceil(a.items.length / 2));
  const prev = await mongoose.model('Attempt').findOne({ userId: a.userId, subjectId: a.subjectId, mode: a.mode, topic: a.topic, assessmentId: a.assessmentId, _id: { $ne: a._id }, status: { $ne: 'in_progress' } }).sort({ pct: -1 }).lean() as any;
  const improvement = prev ? Math.max(0, (a.pct ?? 0) - (prev.pct ?? 0)) : 0;
  const xp = answered * 2 + correct * 3 + Math.round(improvement / 5);
  const res = await awardXp({ userId: String(a.userId), schoolId: a.schoolId ? String(a.schoolId) : undefined, subjectId: String(a.subjectId), source: 'attempt', refId: String(a._id), xp, reason: `${correct}/${answered} correct (${a.mode})`, qualifies });
  const badges = []; if (a.items.length >= 5 && a.pct === 100 && !a.provisional) badges.push('perfect_score'); if (prev && improvement >= 20) badges.push('improver'); if (a.mode === 'remedial' && qualifies) badges.push('reviewer');
  const nb = await grantBadges(String(a.userId), badges);
  a.$locals.reward = { xp: res.xp, newBadges: [...res.newBadges, ...nb] };
}
/** Teacher verifies (or overrides) an AI-provisional / unmarked written answer. */
export async function verifyResponse(a: any, questionId: string, v: { score?: number; criteria?: { criterion: string; marks: number }[]; partScores?: number[]; comment?: string }, teacherId: string) {
  const r = a.responses.find((x: any) => String(x.questionId) === questionId); if (!r) throw notFound('Response not found');
  if (!r.needsReview) throw conflict('This answer does not need teacher marking');
  const q: any = await Question.findById(questionId).lean(); const max = totalMarks(q);
  let score: number | undefined = v.score;
  if (v.criteria && q.type === 'essay') { r.criteria = q.rubric.map((c: any) => { const m = v.criteria!.find((x) => x.criterion === c.criterion); const prev = r.criteria?.find((x: any) => x.criterion === c.criterion);
    return { criterion: c.criterion, maxMarks: c.maxMarks, marks: Math.max(0, Math.min(c.maxMarks, m?.marks ?? prev?.marks ?? 0)), comment: prev?.comment }; }); score = r.criteria.reduce((t: number, c: any) => t + c.marks, 0); }
  if (v.partScores && r.parts) { r.parts = r.parts.map((p: any, i: number) => (v.partScores![i] != null ? { ...p, score: Math.max(0, Math.min(p.maxScore, v.partScores![i])), provisional: false } : p)); score = r.parts.reduce((t: number, p: any) => t + (p.score ?? 0), 0); }
  const sc: number = score ?? r.score ?? 0; score = sc;
  if (sc < 0 || sc > max) throw badRequest(`Score must be between 0 and ${max}`);
  Object.assign(r, { score: sc, correct: sc === max, markedBy: 'teacher', needsReview: false, verifiedBy: teacherId, verifiedAt: new Date(), teacherComment: v.comment });
  a.markModified('responses'); await recomputeAttempt(a); await a.save();
  await updateMastery(String(a.userId), String(a.subjectId), q.topic, max ? sc / max : 0);
  if (!a.provisional) await notify([a.userId], { type: 'attempt.marked', title: 'Your work has been marked', body: `Final score: ${a.score}/${a.maxScore} (${a.pct}%)`, link: `/learn/${a.subjectId}/practice/${a._id}` });
  await awardXp({ userId: String(a.userId), schoolId: a.schoolId ? String(a.schoolId) : undefined, subjectId: String(a.subjectId), source: 'written', refId: `${a._id}:${questionId}`, xp: 5 + Math.round((10 * sc) / (max || 1)), reason: 'Written answer marked', qualifies: true });
  return a;
}
/** Student/teacher view. Correct answers hidden while in progress, or until close when the assessment says so. */
export async function viewAttempt(a: any, opts: { revealAnswers?: boolean } = {}) {
  const qs = await Question.find({ _id: { $in: a.items.map((i: any) => i.questionId) } }).lean();
  let reveal = a.status !== 'in_progress';
  if (reveal && a.assessmentId && !opts.revealAnswers) { const as = await Assessment.findById(a.assessmentId).lean(); if (as?.showAnswers === 'after_close' && (!as.closesAt || new Date() < as.closesAt)) reveal = false; }
  return { _id: a._id, mode: a.mode, subjectId: a.subjectId, topic: a.topic, assessmentId: a.assessmentId, status: a.status, startedAt: a.startedAt, deadline: a.deadline, submittedAt: a.submittedAt, autoSubmitted: a.autoSubmitted,
    score: a.status === 'in_progress' ? undefined : a.score, maxScore: a.status === 'in_progress' ? undefined : a.maxScore, pct: a.status === 'in_progress' ? undefined : a.pct, provisional: a.provisional, revisionTopics: a.revisionTopics,
    reward: a.$locals?.reward, answersHidden: a.status !== 'in_progress' && !reveal,
    questions: a.items.map((it: any) => { const q = qs.find((x) => String(x._id) === String(it.questionId)); if (!q) return null; const r = a.responses.find((x: any) => String(x.questionId) === String(it.questionId));
      const res = r && a.status !== 'in_progress' ? { score: r.score, maxScore: r.maxScore, correct: r.correct, markedBy: r.markedBy, needsReview: r.needsReview, criteria: r.criteria, teacherComment: r.teacherComment,
        ...(reveal ? { feedback: r.feedback, explanation: r.explanation, improvement: r.improvement, revisionTopic: r.revisionTopic, parts: r.parts, correctAnswer: markResponse(q, '\u0000', null).correctAnswer } : {}) } : undefined;
      return { ...presentQuestion(q, it.perm), response: r?.response, result: res }; }).filter(Boolean) };
}
