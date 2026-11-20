import mongoose from 'mongoose';
import { User, StudentProfile, Subject, CurriculumDocument, Lesson, LessonReview, Question, Attempt, XpEvent, AuditLog, AiUsage } from '../models/index.js';
import { config } from '../config.js';
import type { AuthCtx } from '../middleware/index.js';
import { can, estCost, oid, resolveScope, type OverviewFilters } from './adminOverview.js';

/**
 * Overview charts (spec §5). Every chart is computed from live collections, filtered by the caller's
 * permissions and school, and omitted when the caller may not see it. Time series use UTC buckets
 * (day up to 62 days, week up to a year, then month) with zero-filled gaps.
 */
export type Unit = 'day' | 'week' | 'month';
export interface Chart {
  key: string; title: string; type: 'line' | 'bar'; valueUnit: 'count' | 'usd' | 'percent';
  series?: { name: string; values: number[] }[]; items?: { label: string; value: number; n?: number; link?: string }[];
  note?: string; estimate?: boolean; link?: string;
}
export const unitFor = (from: Date, to: Date): Unit => { const d = (to.getTime() - from.getTime()) / 86400_000; return d <= 62 ? 'day' : d <= 366 ? 'week' : 'month'; };
const trunc = (d: Date, u: Unit) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), u === 'month' ? 1 : d.getUTCDate()));
  if (u === 'week') x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
};
export function bucketKeys(from: Date, to: Date, u: Unit) {
  const out: string[] = []; const d = trunc(from, u);
  while (d <= to && out.length < 800) { out.push(d.toISOString().slice(0, 10)); if (u === 'day') d.setUTCDate(d.getUTCDate() + 1); else if (u === 'week') d.setUTCDate(d.getUTCDate() + 7); else d.setUTCMonth(d.getUTCMonth() + 1); }
  return out;
}
const B = (field: string, u: Unit) => ({ $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: `$${field}`, unit: u, startOfWeek: 'monday', timezone: 'UTC' } } } });

export async function overviewCharts(a: AuthCtx, f: OverviewFilters, raw: Record<string, unknown> = {}) {
  const S = resolveScope(a, f, raw); const { range, content, link, from, to } = S;
  const unit = unitFor(from, to); const buckets = bucketKeys(from, to, unit);
  const fill = (rows: { _id: string; n: number }[]) => { const m = new Map(rows.map((r) => [r._id, r.n])); return buckets.map((k) => Math.round((m.get(k) ?? 0) * 10000) / 10000); };
  const count = (model: mongoose.Model<any>, match: object, field: string, sum: unknown = 1) =>
    model.aggregate([{ $match: { ...match, [field]: range } }, { $group: { _id: B(field, unit), n: { $sum: sum } } }]).then(fill);

  const people = can(a, 'users:manage'); const learnerAnalytics = people && can(a, 'analytics:view');
  const docsPerm = can(a, 'documents:upload', 'documents:map', 'content:review');
  // Learner population when a level/subject filter narrows it (null = everyone in scope).
  const learnerFilter = f.levelId || f.subjectId;
  const learners = learnerFilter && people ? await StudentProfile.find({ ...S.sch, ...(f.levelId ? { levelId: oid(f.levelId) } : {}), ...(f.subjectId ? { subjectIds: oid(f.subjectId) } : {}) }).distinct('userId') : null;
  const scopeUsers = learners ?? (S.schoolId ? await User.find(S.sch).distinct('_id') : null);
  const levelSubjects = f.levelId ? await Subject.find({ levelId: oid(f.levelId) }).distinct('_id') : null;
  const subjectMatch = f.subjectId ? { subjectId: oid(f.subjectId) } : levelSubjects ? { subjectId: { $in: levelSubjects } } : {};

  const jobs: Promise<Chart | null>[] = [];
  const add = (ok: boolean, fn: () => Promise<Chart | null>) => { if (ok) jobs.push(fn()); };

  add(people, async () => {
    const base = { ...S.sch, ...(learners ? { _id: { $in: learners } } : {}) };
    const [students, staff] = await Promise.all([count(User, { ...base, roles: 'student' }, 'createdAt'), learnerFilter ? null : count(User, { ...base, roles: { $ne: 'student' } }, 'createdAt')]);
    return { key: 'registrations', title: 'New registrations', type: 'line', valueUnit: 'count', series: [{ name: 'Students', values: students }, ...(staff ? [{ name: 'Staff', values: staff }] : [])],
      note: learnerFilter ? 'Students matching the level/subject filter.' : undefined, link: link('/admin/users', ['schoolId'], { role: 'student', sort: '-createdAt' }) };
  });
  add(people, async () => {
    const uf = scopeUsers ? { $in: scopeUsers } : undefined;
    const [logins, xp, first] = await Promise.all([
      AuditLog.aggregate([{ $match: { action: 'auth.login', createdAt: range, ...(uf ? { actorId: uf } : {}) } }, { $group: { _id: { b: B('createdAt', unit), u: '$actorId' } } }]),
      XpEvent.aggregate([{ $match: { createdAt: range, ...(uf ? { userId: uf } : {}) } }, { $group: { _id: { b: B('createdAt', unit), u: '$userId' } } }]),
      AuditLog.findOne({ action: 'auth.login' }).sort({ createdAt: 1 }).select('createdAt').lean()]);
    const sets = new Map<string, Set<string>>();
    for (const r of [...logins, ...xp]) { if (!r._id.u) continue; (sets.get(r._id.b) ?? sets.set(r._id.b, new Set()).get(r._id.b)!).add(String(r._id.u)); }
    return { key: 'activeUsers', title: 'Active users', type: 'line', valueUnit: 'count', series: [{ name: 'Distinct active users', values: buckets.map((k) => sets.get(k)?.size ?? 0) }],
      note: `Distinct users who signed in or earned XP in each ${unit}.${first ? ` Sign-ins are recorded since ${new Date(first.createdAt as any).toISOString().slice(0, 10)}.` : ''}` };
  });
  add(people, async () => {
    const m: any = { ...S.sch, ...(f.levelId ? { levelId: oid(f.levelId) } : {}) };
    const rows = await StudentProfile.aggregate([{ $match: m }, { $unwind: '$subjectIds' }, ...(f.subjectId ? [{ $match: { subjectIds: oid(f.subjectId) } }] : []), { $group: { _id: '$subjectIds', n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 15 }]);
    const names = new Map((await Subject.find({ _id: { $in: rows.map((r) => r._id) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
    return { key: 'enrolment', title: 'Subject enrolment (top 15)', type: 'bar', valueUnit: 'count',
      items: rows.map((r) => ({ label: names.get(String(r._id)) ?? 'Unknown subject', value: r.n, ...(can(a, 'analytics:view') ? { link: link('/admin/analytics', ['schoolId', 'levelId', 'from', 'to'], { subjectId: String(r._id) }) } : {}) })),
      note: 'Current subject choices of onboarded students (not limited to the date range). School scope uses the school linked on the student profile.' };
  });
  add(docsPerm, async () => {
    const rows = await CurriculumDocument.aggregate([{ $match: { duplicateOf: null, ...content } }, { $group: { _id: { p: '$processingStatus', m: '$mappingStatus' }, n: { $sum: 1 } } }]);
    const L: [string, string, (p: string, m: string) => boolean][] = [
      ['Not processed', 'processingStatus=not_processed', (p) => p === 'not_processed'], ['Queued', 'processingStatus=queued', (p) => p === 'queued'],
      ['Extracting', 'processingStatus=extracting', (p) => p === 'extracting'], ['OCR processing', 'processingStatus=ocr', (p) => p === 'ocr'],
      ['Mapping curriculum', 'processingStatus=structuring', (p) => p === 'structuring'], ['Indexing', 'processingStatus=chunking,embedding', (p) => p === 'chunking' || p === 'embedding'],
      ['Awaiting validation', 'processingStatus=indexed&mappingStatus=unconfirmed', (p, m) => p === 'indexed' && m !== 'confirmed'], ['Completed', 'processingStatus=indexed&mappingStatus=confirmed', (p, m) => p === 'indexed' && m === 'confirmed'],
      ['Failed', 'processingStatus=failed', (p) => p === 'failed']];
    const base = link('/admin/documents', ['subjectId', 'levelId']);
    return { key: 'processing', title: 'Manual processing status', type: 'bar', valueUnit: 'count',
      items: L.map(([label, q, test]) => ({ label, value: rows.filter((r) => test(r._id.p, r._id.m)).reduce((t, r) => t + r.n, 0), link: `${base}${base.includes('?') ? '&' : '?'}${q}` })),
      note: 'All non-duplicate documents, by the spec §10 processing stages. "Awaiting validation" = indexed but curriculum mapping not yet confirmed.' };
  });
  add(docsPerm, async () => ({ key: 'uploads', title: 'Manual uploads', type: 'line', valueUnit: 'count', series: [{ name: 'Uploaded or imported', values: await count(CurriculumDocument, { duplicateOf: null, ...content }, 'createdAt') }], link: link('/admin/documents', ['subjectId', 'levelId']) }));
  add(can(a, 'content:edit', 'content:review'), async () => {
    const [gen, pub] = await Promise.all([count(Lesson, content, 'createdAt'), count(Lesson, content, 'publishedAt')]);
    return { key: 'lessons', title: 'Lessons generated vs published', type: 'line', valueUnit: 'count', series: [{ name: 'Generated', values: gen }, { name: 'Published', values: pub }],
      link: can(a, 'content:review') ? link('/admin/review', ['subjectId'], { status: 'published' }) : link('/admin/lessons', ['subjectId']) };
  });
  add(can(a, 'content:review'), async () => {
    const ids = Object.keys(content).length ? { lessonId: { $in: await Lesson.find(content).distinct('_id') } } : {};
    const [sub, rev, pub, lq, qq] = await Promise.all([count(LessonReview, { ...ids, action: 'submit' }, 'createdAt'), count(LessonReview, { ...ids, action: { $in: ['approve', 'request_changes'] } }, 'createdAt'),
      count(LessonReview, { ...ids, action: 'publish' }, 'createdAt'), Lesson.countDocuments({ ...content, status: { $in: ['in_review', 'resubmitted'] } }), Question.countDocuments({ ...content, status: 'in_review' })]);
    return { key: 'review', title: 'Review workload', type: 'line', valueUnit: 'count', series: [{ name: 'Submitted for review', values: sub }, { name: 'Reviewed', values: rev }, { name: 'Published', values: pub }],
      note: `Lesson review events. Waiting now: ${lq} lesson(s) and ${qq} question(s).`, link: link('/admin/review', ['subjectId']) };
  });
  add(learnerAnalytics, async () => {
    const m = { ...S.sch, ...subjectMatch, ...(learners ? { userId: { $in: learners } } : {}) };
    const [started, done] = await Promise.all([count(Attempt, m, 'startedAt'), count(Attempt, { ...m, status: { $ne: 'in_progress' } }, 'startedAt')]);
    return { key: 'exercises', title: 'Exercise completion', type: 'line', valueUnit: 'count', series: [{ name: 'Started', values: started }, { name: 'Completed', values: done }],
      note: 'Practice, quizzes and assessments by start date; completed = submitted or marked.', link: link('/admin/analytics', ['from', 'to', 'schoolId', 'levelId', 'subjectId']) };
  });
  add(learnerAnalytics, async () => {
    const rows = await Attempt.aggregate([{ $match: { ...S.sch, ...subjectMatch, ...(learners ? { userId: { $in: learners } } : {}), status: { $in: ['submitted', 'marked'] }, submittedAt: range, pct: { $type: 'number' } } },
      { $group: { _id: '$subjectId', avg: { $avg: '$pct' }, n: { $sum: 1 } } }, { $sort: { avg: 1 } }, { $limit: 20 }]);
    if (!rows.length) return null; // only when real attempt data exists
    const names = new Map((await Subject.find({ _id: { $in: rows.map((r) => r._id) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
    return { key: 'performance', title: 'Average score by subject', type: 'bar', valueUnit: 'percent',
      items: rows.map((r) => ({ label: names.get(String(r._id)) ?? 'Unknown subject', value: Math.round(r.avg), n: r.n, link: link('/admin/analytics', ['from', 'to', 'schoolId', 'levelId'], { subjectId: String(r._id) }) })),
      note: 'Mean score of submitted or marked attempts in the period; n = attempts.' };
  });
  add(can(a, 'system:health') || (can(a, 'analytics:view') && !S.schoolPinned), async () => {
    const rows = await AiUsage.aggregate([{ $match: { createdAt: range } }, { $group: { _id: B('createdAt', unit), n: { $sum: 1 }, err: { $sum: { $cond: [{ $eq: ['$status', 'ok'] }, 0, 1] } },
      i: { $sum: { $ifNull: ['$inputTokens', 0] } }, o: { $sum: { $add: [{ $ifNull: ['$outputTokens', 0] }, { $ifNull: ['$thoughtTokens', 0] }] } } } }]);
    const by = new Map(rows.map((r) => [r._id, r]));
    return [{ key: 'aiRequests', title: 'AI requests', type: 'line', valueUnit: 'count', series: [{ name: 'Requests', values: buckets.map((k) => by.get(k)?.n ?? 0) }, { name: 'Errors', values: buckets.map((k) => by.get(k)?.err ?? 0) }],
      note: 'All model and embedding calls (platform-wide).', link: can(a, 'analytics:view') ? link('/admin/analytics', ['from', 'to']) : undefined },
    { key: 'aiCost', title: 'Estimated AI cost (USD)', type: 'line', valueUnit: 'usd', estimate: true, series: [{ name: 'Estimated cost', values: buckets.map((k) => { const r = by.get(k); return r ? estCost(r.i, r.o) : 0; }) }],
      note: `Estimate, not a bill: USD ${config.AI_COST_INPUT_PER_M}/1M input and ${config.AI_COST_OUTPUT_PER_M}/1M output+thinking tokens. The free tier is not billed.` }] as any;
  });

  const charts = (await Promise.all(jobs)).flat().filter(Boolean) as Chart[];
  return { unit, buckets, from, to, scope: S.schoolPinned ? 'school' : 'platform', charts };
}
