import { Router } from 'express';
import { z } from 'zod';
import { GHANA_REGIONS } from '@ghlearn/shared';
import { authenticate, requirePermission } from '../middleware/index.js';
import { analytics, resolveScope } from '../services/analytics.js';
import { School, AcademicLevel, Subject, ClassGroup, AcademicYear, Programme, Question } from '../models/index.js';
import { laScope, buildReports, reportsFor, REPORTS, canSeeStudents, type ReportKey } from '../services/learningAnalytics.js';
import { sendExport } from '../services/exporter.js';
import { audit } from '../lib/audit.js';
import { forbidden } from '../lib/errors.js';

const oid = z.string().regex(/^[a-f0-9]{24}$/i);
export const filterSchema = z.object({ region: z.enum(GHANA_REGIONS).optional(), schoolId: oid.optional(), levelId: oid.optional(), classId: oid.optional(), subjectId: oid.optional(), topic: z.string().max(200).optional(),
  from: z.coerce.date().optional(), to: z.coerce.date().optional() }).strict();
export const analyticsRouter = Router();
analyticsRouter.use(authenticate, requirePermission('analytics:view'));
analyticsRouter.get('/', async (req, res) => {
  const { scope, f } = await resolveScope(req.auth!, filterSchema.parse(req.query));
  res.json(await analytics(scope, f));
});
/** Options for the filter bar, limited to what the caller may filter by. */
analyticsRouter.get('/filters', async (req, res) => {
  const { scope, f } = await resolveScope(req.auth!, {});
  const [schools, levels, subjects, classes] = await Promise.all([
    scope === 'platform' ? School.find().select('name').sort({ name: 1 }).lean() : scope === 'school' ? School.find({ _id: f.schoolId }).select('name').lean() : [],
    AcademicLevel.find().select('name kind').lean(), Subject.find().select('name code').sort({ name: 1 }).lean(),
    scope === 'content' ? [] : ClassGroup.find(scope === 'school' ? { schoolId: f.schoolId } : {}).select('name schoolId').sort({ name: 1 }).limit(500).lean() ]);
  const [years, programmes] = await Promise.all([scope === 'content' ? [] : AcademicYear.find().select('label current').sort({ startDate: -1 }).lean(),
    Programme.find().select('name').sort({ name: 1 }).lean()]);
  const topics = (await Question.distinct('topic', { status: { $ne: 'archived' } })).filter(Boolean).sort().slice(0, 500);
  res.json({ scope, regions: scope === 'content' ? [] : GHANA_REGIONS, schools, levels, subjects, classes, academicYears: years, programmes, topics,
    reports: reportsFor(scope).map((k) => ({ key: k, title: REPORTS.find((r) => r[0] === k)![1] })), canSeeStudents: canSeeStudents(scope) });
});

/** §16 reports. Filters: school, academic year, class, level, Learning Area (programmeId), subject, topic, date range. */
const laFilterSchema = z.object({ schoolId: oid.optional(), academicYearId: oid.optional(), classId: oid.optional(), levelId: oid.optional(), programmeId: oid.optional(), subjectId: oid.optional(),
  topic: z.string().max(200).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), showSmallGroups: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  reports: z.string().max(400).optional() }).strict();
function parse(q: unknown) {
  const { reports, ...f } = laFilterSchema.parse(q);
  return { f, keys: reports ? (reports.split(',').filter((k) => REPORTS.some((r) => r[0] === k)) as ReportKey[]) : undefined };
}
analyticsRouter.get('/reports', async (req, res) => {
  const { f: raw, keys } = parse(req.query); const { scope, f } = await laScope(req.auth!, raw);
  const allowed = reportsFor(scope); const want = (keys ?? allowed.filter((k) => k !== 'students_support')).filter((k) => allowed.includes(k));
  if (keys?.includes('students_support')) {
    if (!canSeeStudents(scope)) throw forbidden('Student-level analytics are only available to Super Admins and School Admins');
    audit(req, 'analytics.student_view', 'students_support', { filters: f });
  }
  if (f.showSmallGroups && !canSeeStudents(scope)) throw forbidden('Only Super Admins and School Admins can show small groups');
  res.json(await buildReports(scope, f, want));
});
analyticsRouter.get('/reports/:key/export', async (req, res) => {
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv'; const { format: _f, ...q } = req.query as Record<string, unknown>;
  const key = String(req.params.key) as ReportKey; const { f: raw } = parse(q); const { scope, f } = await laScope(req.auth!, raw);
  if (!reportsFor(scope).includes(key)) throw forbidden('You cannot export this report');
  if (key === 'students_support' && !canSeeStudents(scope)) throw forbidden('Student-level analytics are only available to Super Admins and School Admins');
  if (f.showSmallGroups && !canSeeStudents(scope)) throw forbidden('Only Super Admins and School Admins can show small groups');
  const r = (await buildReports(scope, f, [key])).reports[0];
  if (!r) throw forbidden('You cannot export this report');
  const kindLabel = { measured: 'Measured data', estimate: 'Estimate', suggestion: 'Rule-based suggestion (not AI)', ai: 'AI recommendation' }[r.kind];
  const from = (f.from ?? new Date(Date.now() - 30 * 86400000)).toISOString().slice(0, 10); const to = (f.to ?? new Date()).toISOString().slice(0, 10);
  sendExport(req, res, { report: `analytics.${key}`, format, header: r.columns.map((c) => c.label), filters: f,
    rows: r.rows.map((row) => r.columns.map((c) => { const v = row[c.key]; return v == null ? (r.suppressedRows ? 'hidden (small group)' : '') : v instanceof Date ? v.toISOString() : v; })),
    note: `${r.title} — ${kindLabel}. ${from} to ${to}. ${r.method}` });
});
/**
 * Optional AI recommendation (§16), generated only when a user asks. It sees aggregated, small-group-suppressed figures
 * only (never names or student-level rows), costs one AI request, and is labelled as an AI recommendation.
 */
analyticsRouter.post('/recommendations', async (req, res) => {
  const { f: raw } = parse(req.body ?? {}); const { scope, f } = await laScope(req.auth!, { ...raw, showSmallGroups: false });
  const keys = (['topic_performance', 'remediation', 'misconceptions', 'lesson_completion', 'exercise_completion'] as ReportKey[]).filter((k) => reportsFor(scope).includes(k));
  if (!keys.length) throw forbidden('No learner reports are available to summarise in your scope');
  const data = await buildReports(scope, f, keys);
  const facts = data.reports.map((r) => ({ report: r.title, kind: r.kind, summary: r.summary, rows: r.rows.filter((x) => Object.values(x).every((v) => v !== null)).slice(0, 15) }));
  if (facts.every((x) => !x.rows.length)) return res.json({ kind: 'ai', text: null, note: 'Not enough measured data (after hiding small groups) for a recommendation.' });
  const { generate } = await import('../services/usage.js');
  const r = await generate({ system: 'You advise Ghanaian school leaders and teachers. Using ONLY the aggregated figures given, write at most 5 short, practical recommendations as a bullet list. Name topics and objectives, not people. Say when the data is thin. Do not invent numbers.',
    messages: [{ role: 'user', content: `Figures (JSON):\n${JSON.stringify(facts).slice(0, 12000)}` }], maxTokens: 900, temperature: 0.3 }, { purpose: 'analytics.summary', userId: req.auth!.userId });
  audit(req, 'analytics.ai_summary', scope, { filters: f, reports: keys });
  res.json({ kind: 'ai', label: 'AI recommendation — check against the measured figures before acting', text: r.text.trim(), model: r.model ?? null, generatedAt: new Date() });
});
