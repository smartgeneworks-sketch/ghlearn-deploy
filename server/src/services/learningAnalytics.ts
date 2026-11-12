import mongoose from 'mongoose';
import { StudentProfile, ClassGroup, Subject, Programme, AcademicLevel, User, Attempt, Assessment, Question, GameSession, GameDesign, Mastery, TutorMessage, TutorConversation,
  Lesson, LessonReview, ContentReview, LearningResource, ResourceProgress, XpEvent, AuditLog, School, AiUsage } from '../models/index.js';
import { forbidden } from '../lib/errors.js';
import { getAiSettings, estimateCost } from './aiSettings.js';
import type { AuthCtx } from '../middleware/index.js';
/**
 * §16 Learning Analytics. Every report is computed from persisted records and says what it is:
 *  - measured: counted from records;  - estimate: derived with stated assumptions (AI cost);
 *  - suggestion: a stated rule applied to measured data (not AI);  - ai: an AI recommendation, generated only on request.
 * Privacy defaults: aggregates over fewer than MIN_GROUP learners are suppressed; student-level rows exist only in the
 * "students needing support" report, for Super Admins and School Admins (own school), and only when asked for.
 */
export type Scope = 'platform' | 'school' | 'content';
export const MIN_GROUP = 5;
export interface LaFilters { schoolId?: string; academicYearId?: string; classId?: string; levelId?: string; programmeId?: string; subjectId?: string; topic?: string; from?: Date; to?: Date; showSmallGroups?: boolean }
export type Kind = 'measured' | 'estimate' | 'suggestion' | 'ai';
export interface Column { key: string; label: string; type?: 'number' | 'percent' | 'date' | 'text' }
export interface Report { key: string; title: string; kind: Kind; description: string; method: string; columns: Column[]; rows: Record<string, unknown>[]; summary?: { label: string; value: unknown; kind?: Kind }[];
  chart?: { label: string; labelKey: string; valueKey: string; unit?: string }; suppressedRows?: number; studentLevel?: boolean }
export const REPORTS = [
  ['enrolment', 'Enrolment'], ['subject_selection', 'Subject selection'], ['active_users', 'Active users'], ['lesson_completion', 'Lesson completion'],
  ['exercise_completion', 'Exercise completion'], ['assessment_results', 'Assessment results'], ['topic_performance', 'Topic performance'],
  ['misconceptions', 'Misconceptions (most-missed questions)'], ['remediation', 'Objectives needing remediation'], ['game_participation', 'Game participation'],
  ['tutor_usage', 'AI tutor usage'], ['content_quality', 'Content quality and review status'], ['ai_cost', 'AI cost (estimate)'], ['students_support', 'Students needing support'],
] as const;
export type ReportKey = (typeof REPORTS)[number][0];
/** Learner-data reports are not shown to content staff (they see content and AI reports only). */
const LEARNER: ReportKey[] = ['enrolment', 'subject_selection', 'active_users', 'lesson_completion', 'exercise_completion', 'assessment_results', 'topic_performance', 'misconceptions', 'remediation', 'game_participation', 'tutor_usage', 'students_support'];
export const reportsFor = (scope: Scope): ReportKey[] => REPORTS.map((r) => r[0]).filter((k) => (scope === 'content' ? !LEARNER.includes(k) : true));
export const canSeeStudents = (scope: Scope) => scope === 'platform' || scope === 'school';

export async function laScope(a: AuthCtx, f: LaFilters): Promise<{ scope: Scope; f: LaFilters }> {
  if (a.roles.includes('super_admin')) return { scope: 'platform', f };
  if (a.roles.includes('school_admin')) {
    if (f.schoolId && f.schoolId !== a.schoolId) throw forbidden('You can only view analytics for your school');
    if (f.classId && !(await ClassGroup.exists({ _id: f.classId, schoolId: a.schoolId }))) throw forbidden('Class is not in your school');
    return { scope: 'school', f: { ...f, schoolId: a.schoolId } };
  }
  if (a.roles.includes('content_reviewer') || a.roles.includes('curriculum_admin')) {
    if (f.schoolId || f.classId || f.academicYearId) throw forbidden('Content analytics are not school-, class- or year-specific');
    if (f.showSmallGroups) throw forbidden('Only Super Admins and School Admins can show small groups');
    return { scope: 'content', f: { ...f, showSmallGroups: false } };
  }
  throw forbidden('Missing permission: analytics:view');
}
const oid = (s?: string) => (s ? new mongoose.Types.ObjectId(s) : undefined);
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : null);
/** Learners matching the filters (null = no learner filter). */
async function learnersFor(f: LaFilters): Promise<mongoose.Types.ObjectId[] | null> {
  if (!(f.schoolId || f.levelId || f.classId || f.programmeId || f.academicYearId || f.subjectId)) return null;
  const pf: any = {}; if (f.schoolId) pf.schoolId = oid(f.schoolId); if (f.levelId) pf.levelId = oid(f.levelId); if (f.programmeId) pf.programmeId = oid(f.programmeId); if (f.subjectId) pf.subjectIds = oid(f.subjectId);
  const cf: any = {}; if (f.classId) cf._id = oid(f.classId); if (f.academicYearId) cf.academicYearId = oid(f.academicYearId); if (f.schoolId) cf.schoolId = oid(f.schoolId);
  if (f.classId || f.academicYearId) pf.userId = { $in: (await ClassGroup.find(cf).select('studentIds').lean()).flatMap((c) => c.studentIds) };
  return StudentProfile.find(pf).distinct('userId') as any;
}
export async function buildReports(scope: Scope, f: LaFilters, keys: ReportKey[]) {
  const to = f.to ?? new Date(); const from = f.from ?? new Date(to.getTime() - 30 * 86400000); const range = { $gte: from, $lte: to };
  const learners = await learnersFor(f); const who = (k = 'userId') => (learners ? { [k]: { $in: learners } } : {});
  const subj = f.subjectId ? { subjectId: oid(f.subjectId) } : {}; const topic = f.topic ? { topic: f.topic } : {};
  const small = (n: number) => !f.showSmallGroups && n < MIN_GROUP;
  const out: Report[] = [];
  const subjectNames = async (ids: unknown[]) => new Map((await Subject.find({ _id: { $in: ids } }).select('name category').lean()).map((s) => [String(s._id), s]));
  for (const key of keys) {
    if (key === 'enrolment') {
      const m: any = { ...(learners ? { userId: { $in: learners } } : {}) };
      const [byLevel, bySchool, total] = await Promise.all([StudentProfile.aggregate([{ $match: m }, { $group: { _id: { l: '$levelId', y: '$yearOfStudy' }, n: { $sum: 1 } } }, { $sort: { '_id.y': 1 } }]),
        scope === 'platform' ? StudentProfile.aggregate([{ $match: m }, { $group: { _id: '$schoolId', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 50 }]) : Promise.resolve([]), StudentProfile.countDocuments(m)]);
      const levels = new Map((await AcademicLevel.find().select('name').lean()).map((l) => [String(l._id), l.name])); const schools = new Map((await School.find({ _id: { $in: bySchool.map((x: any) => x._id) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
      const classes = await ClassGroup.countDocuments({ archived: false, ...(f.schoolId ? { schoolId: oid(f.schoolId) } : {}), ...(f.academicYearId ? { academicYearId: oid(f.academicYearId) } : {}), ...(f.subjectId ? subj : {}) });
      const rows = [...byLevel.map((x) => ({ group: `${levels.get(String(x._id.l)) ?? 'Level'} · Year ${x._id.y ?? '?'}`, students: x.n })), ...bySchool.map((x: any) => ({ group: `School: ${x._id ? schools.get(String(x._id)) ?? 'Unknown' : 'Not linked to a school'}`, students: x.n }))];
      out.push({ key, title: 'Enrolment', kind: 'measured', description: 'Students with an academic profile, by level and year (and by school for the platform).', method: 'Counted from student profiles matching the filters. Date range does not apply (current enrolment).',
        columns: [{ key: 'group', label: 'Group' }, { key: 'students', label: 'Students', type: 'number' }], rows, summary: [{ label: 'Students', value: total }, { label: 'Active classes', value: classes }], chart: { label: 'Students by level and year', labelKey: 'group', valueKey: 'students' } });
    }
    if (key === 'subject_selection') {
      const m: any = learners ? { userId: { $in: learners } } : {}; const total = await StudentProfile.countDocuments(m);
      const rows0 = await StudentProfile.aggregate([{ $match: m }, { $unwind: '$subjectIds' }, ...(f.subjectId ? [{ $match: { subjectIds: oid(f.subjectId) } }] : []), { $group: { _id: '$subjectIds', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 60 }]);
      const names = await subjectNames(rows0.map((x) => x._id));
      const byProg = await StudentProfile.aggregate([{ $match: m }, { $group: { _id: '$programmeId', n: { $sum: 1 } } }, { $sort: { n: -1 } }]); const progs = new Map((await Programme.find({ _id: { $in: byProg.map((x) => x._id) } }).select('name').lean()).map((p) => [String(p._id), p.name]));
      out.push({ key, title: 'Subject selection', kind: 'measured', description: 'How many of the filtered students take each subject, and the Learning Areas they are in.', method: 'Counted from the subject list on each student profile (the list that controls access to content).',
        columns: [{ key: 'subject', label: 'Subject' }, { key: 'category', label: 'Core or elective' }, { key: 'students', label: 'Students', type: 'number' }, { key: 'share', label: 'Share of students', type: 'percent' }],
        rows: rows0.map((x) => ({ subject: names.get(String(x._id))?.name ?? 'Unknown subject', category: names.get(String(x._id))?.category ?? '', students: x.n, share: pct(x.n, total) })),
        summary: [{ label: 'Students', value: total }, ...byProg.slice(0, 6).map((p) => ({ label: `Learning Area: ${p._id ? progs.get(String(p._id)) ?? 'Unknown' : 'Not set'}`, value: p.n }))], chart: { label: 'Students per subject', labelKey: 'subject', valueKey: 'students' } });
    }
    if (key === 'active_users') {
      const day = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
      const series = await XpEvent.aggregate([{ $match: { ...who(), ...subj, createdAt: range, ...(f.schoolId && !learners ? { schoolId: oid(f.schoolId) } : {}) } }, { $group: { _id: { d: day, u: '$userId' } } }, { $group: { _id: '$_id.d', users: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
      const ids = new Set<string>(); const add = (xs: unknown[]) => xs.forEach((x) => ids.add(String(x)));
      add(await Attempt.distinct('userId', { ...who(), ...subj, updatedAt: range })); add(await GameSession.distinct('userId', { ...who(), ...subj, updatedAt: range })); add(await TutorMessage.distinct('userId', { ...who(), role: 'user', createdAt: range }));
      add(await ResourceProgress.distinct('userId', { ...who(), ...subj, lastOpenedAt: range }));
      const uScope: any = f.schoolId ? { schoolId: oid(f.schoolId) } : {};
      const teachers = new Set([...(await User.find({ ...uScope, roles: 'teacher', lastLoginAt: range }).distinct('_id')), ...(await AuditLog.distinct('actorId', { createdAt: range, actorId: { $in: await User.find({ ...uScope, roles: 'teacher' }).distinct('_id') } }))].map(String));
      out.push({ key, title: 'Active users', kind: 'measured', description: 'Learners who did real learning work in the period, per day and in total.', method: 'Active learner = opened a lesson, practised, played a game or asked the tutor in the period. Active teacher = signed in or took an audited action. Daily figures count learning events that earned XP.',
        columns: [{ key: 'day', label: 'Day', type: 'date' }, { key: 'activeLearners', label: 'Active learners', type: 'number' }], rows: series.map((s) => ({ day: s._id, activeLearners: s.users })),
        summary: [{ label: 'Active learners in period', value: ids.size }, { label: 'Active teachers in period', value: teachers.size }], chart: { label: 'Active learners per day', labelKey: 'day', valueKey: 'activeLearners' } });
    }
    if (key === 'lesson_completion') {
      const pm: any = { ...who(), ...subj, ...topic, lastOpenedAt: range, ...(f.schoolId && !learners ? { schoolId: oid(f.schoolId) } : {}) };
      const rows0 = await ResourceProgress.aggregate([{ $match: pm }, { $group: { _id: '$resourceId', opened: { $sum: 1 }, completed: { $sum: { $cond: [{ $ifNull: ['$completedAt', false] }, 1, 0] } } } }, { $sort: { opened: -1 } }, { $limit: 100 }]);
      const res = new Map((await LearningResource.find({ _id: { $in: rows0.map((r) => r._id) } }).select('title topic subjectId').lean()).map((r) => [String(r._id), r])); const sn = await subjectNames([...res.values()].map((r) => r.subjectId));
      let supp = 0; const rows = rows0.map((r) => { const x: any = res.get(String(r._id)); const hide = small(r.opened); if (hide) supp++;
        return { lesson: x?.title ?? 'Removed lesson', subject: sn.get(String(x?.subjectId))?.name ?? '', topic: x?.topic ?? '', opened: hide ? null : r.opened, completed: hide ? null : r.completed, completion: hide ? null : pct(r.completed, r.opened) }; });
      const [o, c] = [rows0.reduce((t, r) => t + r.opened, 0), rows0.reduce((t, r) => t + r.completed, 0)];
      out.push({ key, title: 'Lesson completion', kind: 'measured', description: 'Published lessons learners opened in the period and how many marked them as completed.', method: `Recorded when a learner opens a lesson and when they press "Mark as completed". Rows with fewer than ${MIN_GROUP} learners are hidden unless small groups are shown.`,
        columns: [{ key: 'lesson', label: 'Lesson' }, { key: 'subject', label: 'Subject' }, { key: 'topic', label: 'Topic' }, { key: 'opened', label: 'Learners who opened', type: 'number' }, { key: 'completed', label: 'Completed', type: 'number' }, { key: 'completion', label: 'Completion', type: 'percent' }],
        rows, suppressedRows: supp, summary: [{ label: 'Lesson opens (learner, lesson)', value: o }, { label: 'Completions', value: c }, { label: 'Completion rate', value: pct(c, o) == null ? null : `${pct(c, o)} %` }], chart: { label: 'Completion by lesson (%)', labelKey: 'lesson', valueKey: 'completion', unit: '%' } });
    }
    const af: any = { ...who(), ...subj, ...topic, ...(f.schoolId && !learners ? { schoolId: oid(f.schoolId) } : {}) };
    if (key === 'exercise_completion') {
      const modes = await Attempt.aggregate([{ $match: { ...af, startedAt: range } }, { $group: { _id: '$mode', started: { $sum: 1 }, done: { $sum: { $cond: [{ $ne: ['$status', 'in_progress'] }, 1, 0] } }, avg: { $avg: '$pct' }, learners: { $addToSet: '$userId' } } }]);
      const started = modes.reduce((t, m) => t + m.started, 0); const done = modes.reduce((t, m) => t + m.done, 0);
      out.push({ key, title: 'Exercise completion', kind: 'measured', description: 'Practice, quizzes and assignments started and finished in the period, by mode.', method: 'Counted from attempts; completed = submitted (marked or awaiting marking). Average score is over completed attempts.',
        columns: [{ key: 'mode', label: 'Mode' }, { key: 'learners', label: 'Learners', type: 'number' }, { key: 'started', label: 'Started', type: 'number' }, { key: 'completed', label: 'Completed', type: 'number' }, { key: 'completion', label: 'Completion', type: 'percent' }, { key: 'avgPct', label: 'Average score', type: 'percent' }],
        rows: modes.map((m) => ({ mode: String(m._id).replace(/_/g, ' '), learners: m.learners.length, started: m.started, completed: m.done, completion: pct(m.done, m.started), avgPct: small(m.learners.length) || m.avg == null ? null : Math.round(m.avg) })),
        summary: [{ label: 'Started', value: started }, { label: 'Completed', value: done }, { label: 'Completion rate', value: pct(done, started) == null ? null : `${pct(done, started)} %` }, { label: 'Awaiting teacher marking', value: await Attempt.countDocuments({ ...af, status: 'pending_review' }) }],
        chart: { label: 'Completion by mode (%)', labelKey: 'mode', valueKey: 'completion', unit: '%' } });
    }
    if (key === 'assessment_results') {
      const asf: any = { ...subj, createdAt: range, ...(f.schoolId ? { schoolId: oid(f.schoolId) } : {}), ...(f.classId ? { classId: oid(f.classId) } : {}) };
      const as = await Assessment.find(asf).select('title subjectId classId mode closesAt').sort({ createdAt: -1 }).limit(100).lean();
      const stats = await Attempt.aggregate([{ $match: { assessmentId: { $in: as.map((a) => a._id) }, ...who() } }, { $group: { _id: '$assessmentId', submitted: { $sum: { $cond: [{ $in: ['$status', ['marked', 'submitted']] }, 1, 0] } }, pending: { $sum: { $cond: [{ $eq: ['$status', 'pending_review'] }, 1, 0] } }, avg: { $avg: { $cond: [{ $eq: ['$status', 'marked'] }, '$pct', null] } }, pass: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'marked'] }, { $gte: ['$pct', 50] }] }, 1, 0] } }, marked: { $sum: { $cond: [{ $eq: ['$status', 'marked'] }, 1, 0] } } } }]);
      const by = new Map(stats.map((s) => [String(s._id), s])); const sn = await subjectNames(as.map((a) => a.subjectId)); const cls = new Map((await ClassGroup.find({ _id: { $in: as.map((a) => a.classId).filter(Boolean) } }).select('name').lean()).map((c) => [String(c._id), c.name]));
      let supp = 0;
      const rows = as.map((a) => { const s: any = by.get(String(a._id)) ?? { submitted: 0, pending: 0, avg: null, pass: 0, marked: 0 }; const hide = small(s.marked); if (hide && s.marked) supp++;
        return { assessment: a.title, subject: sn.get(String(a.subjectId))?.name ?? '', class: a.classId ? cls.get(String(a.classId)) ?? '' : 'Whole year', mode: a.mode, submissions: s.submitted + s.pending, awaitingMarking: s.pending, averagePct: hide || s.avg == null ? null : Math.round(s.avg), passRate: hide ? null : pct(s.pass, s.marked) }; });
      out.push({ key, title: 'Assessment results', kind: 'measured', description: 'Assignments and mock exams set in the period: submissions, average mark and pass rate (50 % or more).', method: `Final marks only (marked attempts); provisional AI marks are excluded until a teacher confirms. Averages over fewer than ${MIN_GROUP} marked learners are hidden unless small groups are shown.`,
        columns: [{ key: 'assessment', label: 'Assessment' }, { key: 'subject', label: 'Subject' }, { key: 'class', label: 'Class' }, { key: 'mode', label: 'Type' }, { key: 'submissions', label: 'Submissions', type: 'number' }, { key: 'awaitingMarking', label: 'Awaiting marking', type: 'number' }, { key: 'averagePct', label: 'Average', type: 'percent' }, { key: 'passRate', label: 'Pass rate', type: 'percent' }],
        rows, suppressedRows: supp, chart: { label: 'Average mark by assessment (%)', labelKey: 'assessment', valueKey: 'averagePct', unit: '%' } });
    }
    if (key === 'topic_performance') {
      const mm: any = { ...who(), ...subj, ...topic }; if (!learners && f.schoolId) mm.userId = { $in: await StudentProfile.find({ schoolId: oid(f.schoolId) }).distinct('userId') };
      const t = await Mastery.aggregate([{ $match: mm }, { $group: { _id: { s: '$subjectId', t: '$topic' }, avg: { $avg: '$score' }, students: { $sum: 1 }, answered: { $sum: '$answered' }, weak: { $sum: { $cond: [{ $lt: ['$score', 0.6] }, 1, 0] } } } }, { $sort: { avg: 1 } }, { $limit: 60 }]);
      const sn = await subjectNames(t.map((x) => x._id.s)); let supp = 0;
      const rows = t.map((x) => { const hide = small(x.students); if (hide) supp++; return { subject: sn.get(String(x._id.s))?.name ?? '', topic: x._id.t, learners: x.students, answers: x.answered, mastery: hide ? null : Math.round(x.avg * 100), below60: hide ? null : x.weak }; });
      out.push({ key, title: 'Topic performance', kind: 'measured', description: 'Average mastery per topic, weakest first.', method: `Mastery is the running share of correct answers per learner and topic from practice, quizzes and assignments. Topics with fewer than ${MIN_GROUP} learners are hidden unless small groups are shown. Date range does not apply (mastery is cumulative).`,
        columns: [{ key: 'subject', label: 'Subject' }, { key: 'topic', label: 'Topic' }, { key: 'learners', label: 'Learners', type: 'number' }, { key: 'answers', label: 'Answers', type: 'number' }, { key: 'mastery', label: 'Average mastery', type: 'percent' }, { key: 'below60', label: 'Learners below 60 %', type: 'number' }],
        rows, suppressedRows: supp, chart: { label: 'Average mastery by topic (%)', labelKey: 'topic', valueKey: 'mastery', unit: '%' } });
    }
    if (key === 'misconceptions' || key === 'remediation') {
      const per = await Attempt.aggregate([{ $match: { ...af, updatedAt: range, status: { $ne: 'in_progress' } } }, { $unwind: '$responses' }, { $match: { 'responses.correct': { $in: [true, false] } } },
        { $group: { _id: '$responses.questionId', answers: { $sum: 1 }, wrong: { $sum: { $cond: ['$responses.correct', 0, 1] } }, learners: { $addToSet: '$userId' } } }]);
      const qs = new Map((await Question.find({ _id: { $in: per.map((p) => p._id) } }).select('stem type topic objective subjectId').lean()).map((q) => [String(q._id), q])); const sn = await subjectNames([...qs.values()].map((q) => q.subjectId));
      if (key === 'misconceptions') {
        let supp = 0; const rows = per.filter((p) => p.wrong > 0 && qs.has(String(p._id))).sort((a, b) => b.wrong / b.answers - a.wrong / a.answers || b.answers - a.answers).slice(0, 50).map((p) => { const q: any = qs.get(String(p._id)); const hide = small(p.learners.length); if (hide) supp++;
          return { question: String(q.stem).slice(0, 160), type: q.type, subject: sn.get(String(q.subjectId))?.name ?? '', topic: q.topic ?? '', objective: q.objective ?? '', answers: hide ? null : p.answers, wrongPct: hide ? null : pct(p.wrong, p.answers) }; }).filter((r) => r.answers !== null || f.showSmallGroups);
        out.push({ key, title: 'Misconceptions (most-missed questions)', kind: 'measured', description: 'Auto-marked questions learners most often got wrong in the period. These point to likely misconceptions to address in class.', method: `Share of wrong answers per question over submitted attempts (auto-marked parts only). Questions answered by fewer than ${MIN_GROUP} learners are hidden unless small groups are shown. No learner is named.`,
          columns: [{ key: 'question', label: 'Question' }, { key: 'type', label: 'Type' }, { key: 'subject', label: 'Subject' }, { key: 'topic', label: 'Topic' }, { key: 'objective', label: 'Objective' }, { key: 'answers', label: 'Answers', type: 'number' }, { key: 'wrongPct', label: 'Wrong', type: 'percent' }], rows, suppressedRows: supp });
      } else {
        const g = new Map<string, { subject: string; topic: string; objective: string; answers: number; wrong: number; learners: Set<string>; questions: number }>();
        for (const p of per) { const q: any = qs.get(String(p._id)); if (!q) continue; const k = `${q.subjectId}|${q.topic}|${q.objective ?? ''}`;
          const e = g.get(k) ?? { subject: sn.get(String(q.subjectId))?.name ?? '', topic: q.topic ?? '', objective: q.objective || '(no objective set)', answers: 0, wrong: 0, learners: new Set<string>(), questions: 0 };
          e.answers += p.answers; e.wrong += p.wrong; e.questions++; p.learners.forEach((l: any) => e.learners.add(String(l))); g.set(k, e); }
        let supp = 0; const rows = [...g.values()].map((e) => ({ ...e, correctPct: pct(e.answers - e.wrong, e.answers)! })).filter((e) => e.answers >= 10 && e.correctPct < 60).sort((a, b) => a.correctPct - b.correctPct)
          .map((e) => { const hide = small(e.learners.size); if (hide) supp++; return { subject: e.subject, topic: e.topic, objective: e.objective, questions: e.questions, answers: hide ? null : e.answers, correctPct: hide ? null : e.correctPct, action: 'Reteach and set remedial practice' }; }).filter((r) => r.answers !== null || f.showSmallGroups);
        out.push({ key, title: 'Objectives needing remediation', kind: 'suggestion', description: 'Learning objectives where learners answered fewer than 60 % of questions correctly (at least 10 answers). A rule applied to measured answers, not an AI judgement.', method: `Rule: correct rate below 60 % over at least 10 auto-marked answers in the period, grouped by the objective linked to each bank question. Groups with fewer than ${MIN_GROUP} learners are hidden unless small groups are shown.`,
          columns: [{ key: 'subject', label: 'Subject' }, { key: 'topic', label: 'Topic' }, { key: 'objective', label: 'Objective' }, { key: 'questions', label: 'Questions', type: 'number' }, { key: 'answers', label: 'Answers', type: 'number' }, { key: 'correctPct', label: 'Correct', type: 'percent' }, { key: 'action', label: 'Suggested action' }], rows, suppressedRows: supp });
      }
    }
    if (key === 'game_participation') {
      const gs = await GameSession.aggregate([{ $match: { ...who(), ...subj, ...topic, startedAt: range } }, { $group: { _id: { g: '$game', d: '$designId' }, sessions: { $sum: 1 }, players: { $addToSet: '$userId' }, finished: { $sum: { $cond: [{ $eq: ['$status', 'finished'] }, 1, 0] } }, acc: { $avg: '$accuracy' }, hints: { $sum: '$hintsUsed' } } }, { $sort: { sessions: -1 } }]);
      const ds = new Map((await GameDesign.find({ _id: { $in: gs.map((x) => x._id.d).filter(Boolean) } }).select('title').lean()).map((d) => [String(d._id), d.title]));
      out.push({ key, title: 'Game participation', kind: 'measured', description: 'Game sessions in the period by game (authored games by title), with completion and accuracy.', method: 'Counted from game sessions. Accuracy is the share of correct answers in finished sessions.',
        columns: [{ key: 'game', label: 'Game' }, { key: 'type', label: 'Type' }, { key: 'players', label: 'Players', type: 'number' }, { key: 'sessions', label: 'Sessions', type: 'number' }, { key: 'finished', label: 'Finished', type: 'number' }, { key: 'accuracy', label: 'Average accuracy', type: 'percent' }, { key: 'hints', label: 'Hints used', type: 'number' }],
        rows: gs.map((x) => ({ game: x._id.d ? ds.get(String(x._id.d)) ?? 'Archived game' : 'Generated from the question bank', type: String(x._id.g).replace(/_/g, ' '), players: x.players.length, sessions: x.sessions, finished: x.finished, accuracy: small(x.players.length) || x.acc == null ? null : Math.round(x.acc * (x.acc <= 1 ? 100 : 1)), hints: x.hints })),
        chart: { label: 'Sessions by game', labelKey: 'game', valueKey: 'sessions' } });
    }
    if (key === 'tutor_usage') {
      const conv = f.subjectId ? await TutorConversation.distinct('_id', { ...subj, ...who() }) : null;
      const mf: any = { createdAt: range, ...who(), ...(conv ? { conversationId: { $in: conv } } : {}) };
      const [asked, users, types, fb] = await Promise.all([TutorMessage.countDocuments({ ...mf, role: 'user' }), TutorMessage.distinct('userId', { ...mf, role: 'user' }),
        TutorMessage.aggregate([{ $match: { ...mf, role: 'assistant' } }, { $group: { _id: '$answerType', n: { $sum: 1 } } }]), TutorMessage.aggregate([{ $match: { ...mf, role: 'assistant', 'feedback.rating': { $exists: true } } }, { $group: { _id: '$feedback.rating', n: { $sum: 1 } } }])]);
      const up = fb.find((x) => x._id === 'up')?.n ?? 0; const down = fb.find((x) => x._id === 'down')?.n ?? 0; const total = types.reduce((t, x) => t + x.n, 0);
      const label: Record<string, string> = { source: 'Answered from approved manuals', general: 'General knowledge (labelled)', mixed: 'Manuals and general knowledge', refusal: 'Declined (off-topic or unsafe)', error: 'Failed' };
      out.push({ key, title: 'AI tutor usage', kind: 'measured', description: 'Questions learners asked the AI tutor in the period and how the answers were grounded.', method: 'Counted from tutor messages (kept for the retention period only). Helpful = thumbs-up share of rated answers.',
        columns: [{ key: 'answerType', label: 'Answer type' }, { key: 'answers', label: 'Answers', type: 'number' }, { key: 'share', label: 'Share', type: 'percent' }], rows: types.map((t) => ({ answerType: label[t._id] ?? t._id ?? 'Unknown', answers: t.n, share: pct(t.n, total) })),
        summary: [{ label: 'Questions asked', value: asked }, { label: 'Learners using the tutor', value: users.length }, { label: 'Rated helpful', value: up + down ? `${pct(up, up + down)} % of ${up + down}` : null }] });
    }
    if (key === 'content_quality') {
      const cf: any = { ...subj, ...topic };
      const [ls, qs, gs, decided, cc, turn, tfDown] = await Promise.all([Lesson.aggregate([{ $match: cf }, { $group: { _id: '$status', n: { $sum: 1 } } }]), Question.aggregate([{ $match: cf }, { $group: { _id: '$status', n: { $sum: 1 } } }]), GameDesign.aggregate([{ $match: cf }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        Promise.all([LessonReview.aggregate([{ $match: { createdAt: range, action: { $in: ['approve', 'request_changes'] } } }, { $group: { _id: '$action', n: { $sum: 1 } } }]), ContentReview.aggregate([{ $match: { createdAt: range, action: { $in: ['approve', 'request_changes', 'reject'] } } }, { $group: { _id: '$action', n: { $sum: 1 } } }])]),
        Question.aggregate([{ $match: { ...cf, crossCheck: { $in: ['agreed', 'disagreed'] } } }, { $group: { _id: '$crossCheck', n: { $sum: 1 } } }]),
        Lesson.aggregate([{ $match: { ...cf, reviewedAt: range, submittedAt: { $ne: null } } }, { $project: { h: { $divide: [{ $subtract: ['$reviewedAt', '$submittedAt'] }, 3600000] } } }, { $group: { _id: null, avg: { $avg: '$h' }, n: { $sum: 1 } } }]),
        TutorMessage.countDocuments({ createdAt: range, 'feedback.rating': 'down' })]);
      const o = (xs: any[]) => Object.fromEntries(xs.map((x) => [x._id ?? 'unknown', x.n])); const L = o(ls), Q = o(qs), G = o(gs); const all = new Set([...Object.keys(L), ...Object.keys(Q), ...Object.keys(G)]);
      const dec = [...decided[0], ...decided[1]].reduce((m: any, x) => ((m[x._id] = (m[x._id] ?? 0) + x.n), m), {}); const ccO = o(cc);
      const order = ['generating', 'draft', 'in_review', 'resubmitted', 'changes_requested', 'rejected', 'approved', 'published', 'archived', 'failed'];
      out.push({ key, title: 'Content quality and review status', kind: 'measured', description: 'Where lessons, questions and games are in the review workflow, and quality signals.', method: 'Current counts by status; decisions, cross-check results and turnaround from review records in the period.',
        columns: [{ key: 'status', label: 'Status' }, { key: 'lessons', label: 'Lessons and resources', type: 'number' }, { key: 'questions', label: 'Questions', type: 'number' }, { key: 'games', label: 'Games', type: 'number' }],
        rows: [...all].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((s) => ({ status: s.replace(/_/g, ' '), lessons: L[s] ?? 0, questions: Q[s] ?? 0, games: G[s] ?? 0 })),
        summary: [{ label: 'Review decisions in period', value: (dec.approve ?? 0) + (dec.request_changes ?? 0) + (dec.reject ?? 0) }, { label: 'Changes requested', value: (dec.approve ?? 0) + (dec.request_changes ?? 0) ? `${pct(dec.request_changes ?? 0, (dec.approve ?? 0) + (dec.request_changes ?? 0) + (dec.reject ?? 0))} % of decisions` : null },
          { label: 'AI answer cross-check disagreed', value: (ccO.agreed ?? 0) + (ccO.disagreed ?? 0) ? `${ccO.disagreed ?? 0} of ${(ccO.agreed ?? 0) + (ccO.disagreed ?? 0)} questions` : null },
          { label: 'Average lesson review time', value: turn[0]?.n ? `${Math.round(turn[0].avg)} h (${turn[0].n} reviews)` : null }, { label: 'Tutor answers rated unhelpful', value: tfDown }] });
    }
    if (key === 'ai_cost') {
      const s = await getAiSettings(); const um: any = { createdAt: range, ...(f.schoolId ? { schoolId: oid(f.schoolId) } : {}) };
      const r = await AiUsage.aggregate([{ $match: um }, { $group: { _id: '$feature', n: { $sum: 1 }, i: { $sum: { $ifNull: ['$inputTokens', 0] } }, o: { $sum: { $add: [{ $ifNull: ['$outputTokens', 0] }, { $ifNull: ['$thoughtTokens', 0] }] } } } }, { $sort: { n: -1 } }]);
      out.push({ key, title: 'AI cost (estimate)', kind: 'estimate', description: 'AI requests in the period by feature, with an estimated cost. Full details are in AI Usage and Costs.', method: `Estimate, not a bill: tokens recorded per request × USD ${s.costInputPerM}/1M input and ${s.costOutputPerM}/1M output tokens (rates in AI settings). Free-tier usage is not billed.`,
        columns: [{ key: 'feature', label: 'Feature' }, { key: 'requests', label: 'Requests (measured)', type: 'number' }, { key: 'tokens', label: 'Tokens (measured)', type: 'number' }, { key: 'estCostUsd', label: 'Estimated cost (USD)' }],
        rows: r.map((x) => ({ feature: x._id ?? 'other', requests: x.n, tokens: x.i + x.o, estCostUsd: estimateCost(s, x.i, x.o) })) });
    }
    if (key === 'students_support' && canSeeStudents(scope)) {
      const mm: any = { ...who(), ...subj, ...topic }; if (!learners && f.schoolId) mm.userId = { $in: await StudentProfile.find({ schoolId: oid(f.schoolId) }).distinct('userId') };
      const t = await Mastery.aggregate([{ $match: mm }, { $group: { _id: '$userId', avg: { $avg: '$score' }, answered: { $sum: '$answered' }, weak: { $push: { $cond: [{ $lt: ['$score', 0.6] }, '$topic', '$$REMOVE'] } }, last: { $max: '$lastAt' } } }, { $match: { answered: { $gte: 5 }, avg: { $lt: 0.5 } } }, { $sort: { avg: 1 } }, { $limit: 100 }]);
      const us = new Map((await User.find({ _id: { $in: t.map((x) => x._id) } }).select('fullName').lean()).map((u) => [String(u._id), u.fullName]));
      out.push({ key, title: 'Students needing support', kind: 'suggestion', studentLevel: true, description: 'Individual learners whose average mastery is below 50 % (at least 5 answers). Student-level data: shown only to administrators of these learners.', method: 'Rule: average mastery below 50 % over at least 5 answers in the filtered subjects and topics. Treat as a prompt to check in, not a grade.',
        columns: [{ key: 'student', label: 'Student' }, { key: 'mastery', label: 'Average mastery', type: 'percent' }, { key: 'answers', label: 'Answers', type: 'number' }, { key: 'weakTopics', label: 'Topics below 60 %' }, { key: 'lastActive', label: 'Last practice', type: 'date' }],
        rows: t.map((x) => ({ student: us.get(String(x._id)) ?? 'Unknown', mastery: Math.round(x.avg * 100), answers: x.answered, weakTopics: x.weak.slice(0, 6).join('; '), lastActive: x.last })) });
    }
  }
  return { scope, filters: { ...f, from, to }, minGroup: MIN_GROUP, reports: out };
}
