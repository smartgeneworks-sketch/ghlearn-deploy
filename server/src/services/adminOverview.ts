import mongoose from 'mongoose';
import { hasPermission, type Permission } from '@ghlearn/shared';
import { User, School, Subject, CurriculumDocument, Lesson, Question, Job, AiUsage, AuditLog, StudentProfile } from '../models/index.js';
import { config } from '../config.js';
import { budgetStatus } from './usage.js';
import { AppError, forbidden } from '../lib/errors.js';
import type { AuthCtx } from '../middleware/index.js';

/** Overview (spec §5): live counts, activity and warnings, every block filtered by the caller's permissions and school. */
export interface OverviewFilters { from?: Date; to?: Date; levelId?: string; schoolId?: string; subjectId?: string }
export interface Card { key: string; label: string; value: number; hint?: string; link?: string; estimate?: boolean }
export interface Warning { level: 'warning' | 'info'; text: string; link?: string }
export const oid = (s?: string) => (s ? new mongoose.Types.ObjectId(s) : undefined);
export const can = (a: AuthCtx, ...ps: Permission[]) => ps.some((p) => hasPermission(a.roles, p));
const isSuper = (a: AuthCtx) => a.roles.includes('super_admin');
export const estCost = (i: number, o: number) => Math.round(((i * config.AI_COST_INPUT_PER_M + o * config.AI_COST_OUTPUT_PER_M) / 1e6) * 10000) / 10000;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Resolves the caller's effective scope. School admins are pinned to their school; dates default to the last 30 days. */
export function resolveScope(a: AuthCtx, f: OverviewFilters, raw: Record<string, unknown> = {}) {
  if (f.schoolId && !isSuper(a) && f.schoolId !== a.schoolId) throw forbidden('You can only view your own school');
  const schoolPinned = !isSuper(a) && a.roles.includes('school_admin');
  const schoolId = schoolPinned ? a.schoolId : f.schoolId;
  // A date-only "to" (from a date input) means the end of that day.
  const to = f.to ? (typeof raw.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.to) ? new Date(f.to.getTime() + 86400_000 - 1) : f.to) : new Date();
  const from = f.from ?? new Date(to.getTime() - 30 * 86400_000);
  if (from > to) throw new AppError(422, 'VALIDATION', '"from" must be before "to"');
  if (to.getTime() - from.getTime() > 731 * 86400_000) throw new AppError(422, 'VALIDATION', 'The date range can be at most two years');
  const range = { $gte: from, $lte: to };
  const sch = schoolId ? { schoolId: oid(schoolId) } : {};
  const content = { ...(f.subjectId ? { subjectId: oid(f.subjectId) } : {}), ...(f.levelId ? { levelId: oid(f.levelId) } : {}) };
  /** Builds a management-page link carrying only the filters that page understands (and only the ones the user set). */
  const link = (path: string, carry: ('from' | 'to' | 'levelId' | 'schoolId' | 'subjectId')[] = [], extra: Record<string, string | undefined> = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    for (const k of carry) {
      if (k === 'from' && f.from) p.set('from', day(f.from)); else if (k === 'to' && f.to) p.set('to', day(f.to));
      else if (k === 'schoolId' && f.schoolId && !schoolPinned) p.set('schoolId', f.schoolId);
      else if ((k === 'levelId' || k === 'subjectId') && f[k]) p.set(k, f[k]!);
    }
    const s = p.toString(); return s ? `${path}?${s}` : path;
  };
  return { schoolPinned, schoolId, from, to, range, sch, content, link };
}
export type Scope = ReturnType<typeof resolveScope>;

export async function overview(a: AuthCtx, f: OverviewFilters, raw: Record<string, unknown> = {}) {
  const S = resolveScope(a, f, raw); const { schoolPinned, schoolId, from, to, range, sch, content, link } = S;
  const people = can(a, 'users:manage'); const docsPerm = can(a, 'documents:upload', 'documents:map', 'content:review');
  const lessonsLink = (status?: string) => (can(a, 'content:review') ? link('/admin/review', ['subjectId'], { status }) : link('/admin/lessons', ['subjectId'], { status }));
  const cards: Promise<Card | null>[] = [];
  const card = (ok: boolean, c: () => Promise<Card>) => cards.push(ok ? c() : Promise.resolve(null));

  card(people, async () => ({ key: 'students', label: 'Students', value: await User.countDocuments({ roles: 'student', ...sch }), link: link('/admin/users', ['schoolId'], { role: 'student' }) }));
  card(people, async () => ({ key: 'teachers', label: 'Teachers', value: await User.countDocuments({ roles: 'teacher', ...sch }), link: link('/admin/users', ['schoolId'], { role: 'teacher' }) }));
  card(can(a, 'school:create'), async () => ({ key: 'schools', label: 'Schools', value: await School.countDocuments({}), link: '/admin/schools' }));
  card(people, async () => ({ key: 'activeUsers', label: 'Active users', value: await User.countDocuments({ lastLoginAt: range, ...sch }), hint: 'Signed in during the selected period', link: link('/admin/users', ['schoolId'], { sort: '-lastLoginAt' }) }));
  card(can(a, 'config:manage', 'curriculum:manage'), async () => ({ key: 'subjects', label: 'Subjects', value: await Subject.countDocuments(f.levelId ? { levelId: oid(f.levelId) } : {}), link: '/admin/structure?tab=subjects' }));
  card(docsPerm, async () => ({ key: 'manuals', label: 'Learner manuals', value: await CurriculumDocument.countDocuments({ docType: 'learner_manual', duplicateOf: null, ...content }), link: link('/admin/documents', ['subjectId', 'levelId'], { docType: 'learner_manual' }) }));
  card(can(a, 'content:edit', 'content:review'), async () => ({ key: 'published', label: 'Published lessons', value: await Lesson.countDocuments({ status: 'published', ...content }), link: lessonsLink('published') }));
  card(can(a, 'content:review'), async () => ({ key: 'pendingReviews', label: 'Pending reviews', value: (await Promise.all([Lesson.countDocuments({ status: { $in: ['in_review', 'resubmitted'] }, ...content }), Question.countDocuments({ status: 'in_review', ...content })])).reduce((x, y) => x + y, 0), hint: 'Lessons and questions awaiting review', link: link('/admin/review', ['subjectId']) }));
  card(can(a, 'system:health', 'documents:map'), async () => ({ key: 'failedJobs', label: 'Failed jobs', value: await Job.countDocuments({ status: { $in: ['failed', 'dead'] }, updatedAt: range }), hint: 'Processing or generation jobs that failed in the period',
    link: can(a, 'system:health') ? '/admin/system' : link('/admin/documents', ['subjectId', 'levelId'], { processingStatus: 'failed' }) }));
  const aiOk = can(a, 'system:health') || (can(a, 'analytics:view') && !schoolPinned);
  card(aiOk, async () => {
    const [r] = await AiUsage.aggregate([{ $match: { createdAt: range } }, { $group: { _id: null, n: { $sum: 1 }, i: { $sum: { $ifNull: ['$inputTokens', 0] } }, o: { $sum: { $add: [{ $ifNull: ['$outputTokens', 0] }, { $ifNull: ['$thoughtTokens', 0] }] } } } }]);
    return { key: 'aiRequests', label: 'AI requests', value: r?.n ?? 0, hint: `Estimated cost USD ${estCost(r?.i ?? 0, r?.o ?? 0).toFixed(2)} (estimate, not a bill)`, estimate: true, ...(can(a, 'analytics:view') ? { link: link('/admin/analytics', ['from', 'to']) } : {}) };
  });

  const act: Record<string, Promise<unknown[]>> = {};
  if (docsPerm) act.manuals = CurriculumDocument.find({ duplicateOf: null, ...content }).sort({ createdAt: -1 }).limit(5).select('title processingStatus createdAt').lean();
  if (can(a, 'content:edit', 'content:review')) act.generated = (async () => {
    const [ls, qs] = await Promise.all([Lesson.find(content).sort({ createdAt: -1 }).limit(5).select('title status createdAt').lean(),
      Question.find({ ...content, aiGenerated: true }).sort({ createdAt: -1 }).limit(5).select('stem topic status createdAt').lean()]);
    return [...ls.map((l: any) => ({ _id: l._id, kind: 'lesson', title: l.title, status: l.status, createdAt: l.createdAt })),
      ...qs.map((q: any) => ({ _id: q._id, kind: 'question', title: String(q.stem).slice(0, 90), topic: q.topic, status: q.status, createdAt: q.createdAt }))]
      .sort((x, y) => +new Date(y.createdAt) - +new Date(x.createdAt)).slice(0, 6);
  })();
  if (can(a, 'content:review')) act.approvals = (async () => {
    const [ls, qs] = await Promise.all([Lesson.find({ status: { $in: ['in_review', 'resubmitted'] }, ...content }).sort({ updatedAt: 1 }).limit(5).select('title updatedAt').lean(),
      Question.find({ status: 'in_review', ...content }).sort({ updatedAt: 1 }).limit(5).select('stem topic updatedAt').lean()]);
    return [...ls.map((l: any) => ({ _id: l._id, kind: 'lesson', title: l.title, updatedAt: l.updatedAt })), ...qs.map((q: any) => ({ _id: q._id, kind: 'question', title: String(q.stem).slice(0, 90), topic: q.topic, updatedAt: q.updatedAt }))]
      .sort((x, y) => +new Date(x.updatedAt) - +new Date(y.updatedAt)).slice(0, 6);
  })();
  if (can(a, 'system:health', 'documents:map'))
    act.failedJobs = Job.find({ status: { $in: ['failed', 'dead'] } }).sort({ updatedAt: -1 }).limit(5).select('type status attempts updatedAt errorLog payload').lean()
      .then((js) => js.map((j: any) => ({ _id: j._id, type: j.type, status: j.status, attempts: j.attempts, updatedAt: j.updatedAt, documentId: j.payload?.documentId ? String(j.payload.documentId) : undefined, error: String(j.errorLog?.at(-1)?.message ?? '').slice(0, 160) })));
  if (can(a, 'audit:view')) act.audit = (async () => {
    // Admin actions only (sign-ins are in the audit log itself, not this feed).
    const f2: any = { action: { $not: /^auth\.login/ }, createdAt: range };
    if (!isSuper(a)) f2.actorId = { $in: await User.find({ schoolId: oid(a.schoolId) ?? new mongoose.Types.ObjectId() }).distinct('_id') };
    return AuditLog.find(f2).sort({ createdAt: -1 }).limit(8).select('action outcome target entityType createdAt actorId requestId').populate('actorId', 'fullName').lean();
  })();

  const keys = Object.keys(act);
  const [cs, lists, warn] = await Promise.all([Promise.all(cards), Promise.all(Object.values(act)), warnings(a, S)]);
  return {
    filters: { from, to, levelId: f.levelId, subjectId: f.subjectId, schoolId }, scope: schoolPinned ? 'school' : 'platform',
    cards: cs.filter(Boolean) as Card[], activity: Object.fromEntries(keys.map((k, i) => [k, lists[i]])), warnings: warn,
    links: {
      manuals: docsPerm ? link('/admin/documents', ['subjectId', 'levelId']) : undefined, generated: can(a, 'content:edit', 'content:review') ? lessonsLink() : undefined,
      approvals: can(a, 'content:review') ? link('/admin/review', ['subjectId']) : undefined,
      failedJobs: can(a, 'system:health') ? '/admin/system' : can(a, 'documents:map') ? link('/admin/documents', ['subjectId', 'levelId'], { processingStatus: 'failed' }) : undefined,
      audit: can(a, 'audit:view') ? link('/admin/audit', ['from', 'to']) : undefined,
    },
  };
}

/** System warnings feed (spec §5): each warning is computed from live data and shown only to roles that can act on it. */
async function warnings(a: AuthCtx, S: Scope): Promise<Warning[]> {
  const w: Warning[] = []; const tasks: Promise<void>[] = [];
  const ops = can(a, 'system:health'); const docs = can(a, 'documents:map', 'system:health');
  if (docs) tasks.push((async () => {
    const [stuck, failed] = await Promise.all([
      CurriculumDocument.countDocuments({ processingStatus: { $in: ['queued', 'extracting', 'ocr', 'structuring', 'chunking', 'embedding'] }, updatedAt: { $lt: new Date(Date.now() - 2 * 3600_000) } }),
      CurriculumDocument.countDocuments({ processingStatus: 'failed', duplicateOf: null })]);
    if (stuck) w.push({ level: 'warning', text: `${stuck} document(s) have been processing for more than 2 hours.`, link: can(a, 'documents:map') ? '/admin/documents?processingStatus=queued,extracting,ocr,structuring,chunking,embedding' : undefined });
    if (failed) w.push({ level: 'warning', text: `${failed} document(s) failed processing and need a retry.`, link: can(a, 'documents:map') ? '/admin/documents?processingStatus=failed' : undefined });
  })());
  if (ops) tasks.push((async () => {
    const n = await Job.countDocuments({ status: { $in: ['failed', 'dead'] }, updatedAt: { $gte: new Date(Date.now() - 86400_000) } });
    if (n) w.push({ level: 'warning', text: `${n} background job(s) failed in the last 24 hours.`, link: '/admin/system' });
  })());
  if (ops || can(a, 'content:edit')) tasks.push((async () => {
    const b = await budgetStatus();
    if (b.requests >= 0.8 * b.requestBudget) w.push({ level: 'warning', text: `AI daily request budget is ${Math.round((100 * b.requests) / b.requestBudget)}% used (${b.requests}/${b.requestBudget}).` });
    if (b.tokens >= 0.8 * b.tokenBudget) w.push({ level: 'warning', text: `AI daily token budget is ${Math.round((100 * b.tokens) / b.tokenBudget)}% used.` });
    const errs = await AiUsage.countDocuments({ createdAt: { $gte: new Date(Date.now() - 86400_000) }, status: { $in: ['error', 'budget_exceeded'] } });
    if (errs) w.push({ level: 'warning', text: `${errs} AI request(s) failed in the last 24 hours.`, link: ops ? '/admin/system' : undefined });
    if (ops && !config.GEMINI_API_KEY) w.push({ level: 'info', text: 'No AI provider key is configured; AI generation and the tutor are unavailable.' });
  })());
  if (can(a, 'content:review')) tasks.push((async () => {
    const old = new Date(Date.now() - 7 * 86400_000);
    const n = (await Promise.all([Lesson.countDocuments({ status: { $in: ['in_review', 'resubmitted'] }, updatedAt: { $lt: old } }), Question.countDocuments({ status: 'in_review', updatedAt: { $lt: old } })])).reduce((x, y) => x + y, 0);
    if (n) w.push({ level: 'warning', text: `${n} item(s) have waited more than 7 days for review.`, link: '/admin/review?sort=submittedAt' });
  })());
  if (can(a, 'users:manage')) tasks.push((async () => {
    const studs = await User.find({ roles: 'student', status: 'active', ...S.sch }).distinct('_id');
    const onboarded = await StudentProfile.countDocuments({ userId: { $in: studs } });
    if (studs.length - onboarded > 0) w.push({ level: 'info', text: `${studs.length - onboarded} student account(s) have not finished onboarding (no subjects chosen yet).`, link: S.link('/admin/users', ['schoolId'], { role: 'student' }) });
  })());
  if (can(a, 'config:manage', 'curriculum:manage')) tasks.push((async () => {
    const { AcademicYear } = await import('../models/index.js');
    if (!(await AcademicYear.exists({ current: true }))) w.push({ level: 'warning', text: 'No academic year is marked as current.', link: '/admin/structure?tab=academic-years' });
  })());
  await Promise.all(tasks);
  return w.sort((x, y) => (x.level === y.level ? 0 : x.level === 'warning' ? -1 : 1));
}
