/** Curriculum LMS admin (CURRICULUM_LMS_SPEC §10/§11): modules per indicator, generation within budget, AI review results, edits, restore, analytics. */
import { prepareDiagram } from '../services/lessons/generator.js';
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, requirePermission, requireAnyPermission } from '../middleware/index.js';
import { Lesson, LessonVersion, LessonReview, LearningResource, CurriculumNode, CurriculumDocument, Subject, StudentProfile, Chunk } from '../models/index.js';
import { ResourceProgress } from '../models/ops.js';
import { audit } from '../lib/audit.js';
import { notFound, conflict, badRequest } from '../lib/errors.js';
import { materializeModules, queueModule, revalidate, MODULE_KEYS, MODULE_SECTIONS, readingTime } from '../services/lessons/modules.js';
import { moduleThumbnail } from '../services/lessons/thumbnail.js';
import { budgetStatus, monthStatus } from '../services/usage.js';
import { getAiSettings } from '../services/aiSettings.js';
import { getSettings } from '../services/platformSettings.js';
import { AiUsage } from '../models/index.js';

export const curriculumLmsRouter = Router();
curriculumLmsRouter.use(authenticate);
const oid = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');
const scopeBody = z.object({ documentId: oid, year: z.number().int().min(1).max(3).optional(), strand: z.number().int().min(1).max(9).optional() }).strict();
const loadModule = async (id: string) => { if (!mongoose.isValidObjectId(id)) throw notFound('Module not found'); const l = await Lesson.findOne({ _id: id, contentType: 'module' }); if (!l) throw notFound('Module not found'); return l; };
const keyFilter = (b: { documentId: string; year?: number; strand?: number }) => ({ contentType: 'module', curriculumDocumentId: b.documentId, moduleKey: { $regex: `-Y${b.year ?? '\\d'}\\.S${b.strand ?? '\\d'}\\.` } });

/** Create one module per imported learning indicator (idempotent; stable moduleKey). */
curriculumLmsRouter.post('/modules/materialize', requirePermission('curriculum:manage'), async (req, res) => {
  const b = scopeBody.parse(req.body ?? {});
  const doc = await CurriculumDocument.findById(b.documentId).select('docType subjectId').lean(); if (!doc || doc.docType !== 'curriculum') throw badRequest('Choose an imported curriculum document');
  const r = await materializeModules(b.documentId, b, req.auth!.userId);
  audit(req, 'curriculum_lms.materialize', b.documentId, { ...b, ...r, missingSource: r.missingSource.length }); res.json(r);
});

/** Usage estimate for generating modules in a scope, checked against the daily request budget and the monthly cost cap. */
async function estimate(ids: any[]) {
  const st = await getAiSettings(); const day = await budgetStatus(); const mo = await monthStatus();
  const hist = await AiUsage.aggregate([{ $match: { purpose: 'module.generate', status: 'ok' } }, { $sort: { createdAt: -1 } }, { $limit: 20 },
    { $group: { _id: null, n: { $sum: 1 }, inp: { $avg: '$inputTokens' }, out: { $avg: { $add: [{ $ifNull: ['$outputTokens', 0] }, { $ifNull: ['$thoughtTokens', 0] }] } } } }]);
  const h = hist[0]; const [cs] = await Chunk.aggregate([{ $group: { _id: null, c: { $avg: '$charCount' } } }]);
  const inp = h?.n ? h.inp : Math.ceil((6000 + 12 * ((cs?.c ?? 1500) + 120)) / 4); const out = h?.n ? h.out : 14000;
  const per = (inp * st.costInputPerM + out * st.costOutputPerM) / 1e6; const n = ids.length;
  const remainingCost = mo.costBudgetUsd > 0 ? Math.max(0, mo.costBudgetUsd - mo.estCostUsd) : Infinity;
  return { modules: n, requests: n, perModule: { inputTokens: Math.round(inp), outputTokens: Math.round(out), costUsd: Math.round(per * 10000) / 10000 }, totalCostUsd: Math.round(per * n * 10000) / 10000,
    basis: h?.n ? `average of the last ${h.n} module generations on this deployment` : 'no history yet: upper bound of 14,000 output tokens per module',
    rates: `USD ${st.costInputPerM}/1M input, ${st.costOutputPerM}/1M output (AI settings)`,
    day: { used: day.requests, limit: day.requestBudget, remaining: Math.max(0, day.requestBudget - day.requests) },
    month: { estCostUsd: Math.round(mo.estCostUsd * 100) / 100, capUsd: mo.costBudgetUsd, remainingUsd: Number.isFinite(remainingCost) ? Math.round(remainingCost * 100) / 100 : null },
    withinBudget: n <= Math.max(0, day.requestBudget - day.requests) && per * n <= remainingCost };
}
curriculumLmsRouter.post('/generate', requirePermission('curriculum:manage'), async (req, res) => {
  const b = z.object({ documentId: oid.optional(), year: z.number().int().min(1).max(3).optional(), strand: z.number().int().min(1).max(9).optional(), lessonIds: z.array(oid).max(200).optional(),
    onlyMissing: z.boolean().default(true), dryRun: z.boolean().default(true) }).strict().parse(req.body ?? {});
  if (!b.lessonIds?.length && !b.documentId) throw badRequest('Give lessonIds or a curriculum documentId (optionally year and strand)');
  const q: any = b.lessonIds?.length ? { _id: { $in: b.lessonIds }, contentType: 'module' } : keyFilter(b as any);
  const all = await Lesson.find(q).select('moduleKey status sourceStatus sections').sort({ order: 1 }).lean();
  const skipped = all.filter((l) => l.sourceStatus !== 'ok').map((l) => ({ moduleKey: l.moduleKey, reason: 'No learner manual mapped (not generated from the title alone)' }));
  const busy = all.filter((l) => l.status === 'generating').map((l) => ({ moduleKey: l.moduleKey, reason: 'Already generating' }));
  const todo = all.filter((l) => l.sourceStatus === 'ok' && l.status !== 'generating' && (!b.onlyMissing || !l.sections?.length));
  const est = await estimate(todo);
  if (b.dryRun) return res.json({ dryRun: true, estimate: est, skipped: [...skipped, ...busy], queue: todo.map((l) => l.moduleKey) });
  if (!est.withinBudget) throw conflict(`Generating ${todo.length} module(s) would exceed the AI budget (about $${est.totalCostUsd} needed, $${est.month.remainingUsd} left this month; ${est.day.remaining} requests left today). Nothing was queued.`);
  const jobs = [];
  for (const l of todo) { const j = await queueModule(String(l._id), req.auth!.userId); await Lesson.updateOne({ _id: l._id }, { lastJobId: j._id, ...(l.status === 'draft' || l.status === 'failed' ? { status: 'generating' } : {}) }); jobs.push(String(j._id)); }
  audit(req, 'curriculum_lms.generate', b.documentId ?? 'lessons', { ...b, queued: todo.length, estimateUsd: est.totalCostUsd });
  res.status(202).json({ queued: todo.length, jobs, estimate: est, skipped: [...skipped, ...busy] });
});

/** Admin view of a subject's modules in curriculum order, with publication and automated-review state (§11 Content Publishing / QA). */
curriculumLmsRouter.get('/subjects/:subjectId/overview', requireAnyPermission('content:edit', 'content:review', 'curriculum:manage'), async (req, res) => {
  const sid = String(req.params.subjectId); if (!mongoose.isValidObjectId(sid)) throw notFound('Subject not found');
  const subject = await Subject.findById(sid).select('name code levelId status').lean(); if (!subject) throw notFound('Subject not found');
  const docs = await CurriculumDocument.find({ subjectId: sid, docType: 'curriculum', archivedAt: null }).select('title approvalStatus').lean();
  const docIds = docs.map((d) => d._id);
  const [mods, indicators, subs] = await Promise.all([
    Lesson.find({ subjectId: sid, contentType: 'module' }).select('title moduleKey order yearOfStudy strand subStrand indicator status sourceStatus version validation.ok validation.errors validation.warnings aiReview.status aiReview.at readingTime publishedAt generatedAt validatedAt generationError thumbnail.motif thumbnail.custom curriculumDocumentId').sort({ order: 1 }).lean(),
    CurriculumNode.countDocuments({ documentId: { $in: docIds }, type: 'indicator' }),
    CurriculumNode.find({ documentId: { $in: docIds }, type: 'subStrand' }).select('key title lmDocumentIds yearOfStudy').sort({ order: 1 }).lean()]);
  const count = (f: (m: any) => boolean) => mods.filter(f).length;
  res.json({ subject, curricula: docs, settings: (await getSettings()).curriculumLms,
    summary: { indicators, modules: mods.length, generated: count((m) => m.version > 0), aiApprovedPublished: count((m) => m.status === 'published' && m.aiReview?.status === 'ai_approved'), published: count((m) => m.status === 'published'),
      needsAttention: count((m) => m.aiReview?.status === 'needs_attention' || m.status === 'failed'), sourceMissing: count((m) => m.sourceStatus !== 'ok'), unpublished: count((m) => m.version > 0 && m.status !== 'published') },
    subStrands: subs.map((s) => ({ key: s.key, title: s.title, yearOfStudy: s.yearOfStudy, learnerManuals: (s.lmDocumentIds ?? []).length })),
    modules: mods.map((m) => ({ ...m, errors: m.validation?.errors?.length ?? 0, warnings: m.validation?.warnings?.length ?? 0, validation: undefined })) });
});
curriculumLmsRouter.get('/modules/:id', requireAnyPermission('content:edit', 'content:review', 'curriculum:manage'), async (req, res) => {
  const l = await loadModule(String(req.params.id));
  const [versions, reviews, docs] = await Promise.all([LessonVersion.find({ lessonId: l._id }).select('version reason createdAt createdBy').sort({ version: -1 }).limit(50).lean(),
    LessonReview.find({ lessonId: l._id }).sort({ createdAt: -1 }).limit(50).lean(), CurriculumDocument.find({ _id: { $in: l.sourceDocumentIds } }).select('title approvalStatus pageCount').lean()]);
  res.json({ module: l, versions, reviews, sources: docs, sectionGuide: MODULE_SECTIONS.map((s) => ({ key: s.key, title: s.title })) });
});
/** Admin edit: sections, title, order, reading time override, thumbnail motif. Every change is a new version and re-runs the checks. */
const sectionEdit = z.object({ key: z.enum(MODULE_KEYS as [string, ...string[]]), content: z.string().max(30000).optional(), data: z.record(z.string(), z.any()).optional() }).strict();
curriculumLmsRouter.patch('/modules/:id', requirePermission('content:edit'), async (req, res) => {
  const b = z.object({ title: z.string().trim().min(3).max(120).optional(), indicator: z.string().trim().min(3).max(2000).optional(), order: z.number().int().min(0).optional(), sections: z.array(sectionEdit).max(13).optional(),
    readingTime: z.object({ readingMin: z.number().int().min(1).max(600), totalMin: z.number().int().min(1).max(600) }).strict().nullable().optional(),
    thumbnailMotif: z.string().max(40).optional(), regenerateThumbnail: z.boolean().optional() }).strict().parse(req.body ?? {});
  const l = await loadModule(String(req.params.id)); if (l.status === 'generating') throw conflict('The module is being generated; try again when it finishes');
  const before = { title: l.title, indicator: l.indicator, order: l.order, version: l.version };
  if (b.title) l.title = b.title; if (b.indicator) l.indicator = b.indicator; if (b.order !== undefined) l.order = b.order;
  if (b.sections) { const secs = l.sections.map((s: any) => s.toObject?.() ?? s);
    for (const e of b.sections) { const i = secs.findIndex((s: any) => s.key === e.key); const base = i >= 0 ? secs[i] : { key: e.key, kind: 'module', title: MODULE_SECTIONS.find((s) => s.key === e.key)!.title, citations: [], sourceSupport: 'general' };
      // Figures are always drawn on the server from their spec: an edited F section is re-rendered (no AI), never stored as client SVG.
      const data = e.key === 'F' && e.data && Array.isArray(e.data.diagrams) ? { ...e.data, diagrams: e.data.diagrams.slice(0, 3).map((d: any) => prepareDiagram({ spec: d?.spec ?? d, alt: d?.alt, caption: d?.caption })) } : e.data;
      const merged = { ...base, ...(e.content !== undefined ? { content: e.content } : {}), ...(data ? { data } : {}), editedBy: req.auth!.userId, editedAt: new Date() }; if (i >= 0) secs[i] = merged; else secs.push(merged); }
    l.sections = secs.sort((x: any, y: any) => x.key.localeCompare(y.key)) as any; }
  if (b.readingTime === null) l.readingTime = readingTime(l.sections as any, (await getSettings()).curriculumLms.wordsPerMinute);
  else if (b.readingTime) l.readingTime = { ...(l.readingTime ?? {}), ...b.readingTime, readingAndExamplesMin: b.readingTime.readingMin, override: true, overrideBy: req.auth!.userId, overrideAt: new Date() };
  if (b.regenerateThumbnail) l.thumbnail = { ...moduleThumbnail({ topic: `${l.title} ${l.indicator}`, subStrand: l.subStrand ?? undefined, strandNo: Number(String(l.moduleKey).match(/\.S(\d)/)?.[1] ?? 1) }), custom: false } as any;
  if (b.thumbnailMotif) { const t = moduleThumbnail({ topic: b.thumbnailMotif, strandNo: Number(String(l.moduleKey).match(/\.S(\d)/)?.[1] ?? 1) }); if (t.motif === 'number' && b.thumbnailMotif !== 'number') throw badRequest('Unknown illustration'); l.thumbnail = { ...t, custom: true } as any; }
  const outcome = await revalidate(l, req.auth!.userId, 'Admin edit');
  if (l.resourceId && (b.order !== undefined || b.thumbnailMotif || b.regenerateThumbnail || b.readingTime !== undefined) && l.status === 'published')
    await LearningResource.updateOne({ _id: l.resourceId }, { order: l.order, thumbnail: { svg: l.thumbnail?.svg, alt: l.thumbnail?.alt }, readingTime: l.readingTime });
  audit(req, 'curriculum_lms.module.update', String(l._id), { fields: Object.keys(b), outcome, sections: b.sections?.map((s) => s.key) }, { before, after: { title: l.title, indicator: l.indicator, order: l.order, version: l.version } });
  res.json({ module: l, outcome });
});
curriculumLmsRouter.post('/modules/:id/regenerate', requirePermission('curriculum:manage'), async (req, res) => {
  const b = z.object({ keys: z.array(z.enum(MODULE_KEYS as [string, ...string[]])).max(13).optional(), instructions: z.string().max(1000).optional(), dryRun: z.boolean().default(false) }).strict().parse(req.body ?? {});
  const l = await loadModule(String(req.params.id)); if (l.status === 'generating') throw conflict('Already generating');
  if (l.sourceStatus !== 'ok') throw conflict('No learner manual is mapped to this sub-strand; map one in Curriculum Import first');
  const est = await estimate([l]); if (b.dryRun) return res.json({ estimate: est });
  if (!est.withinBudget) throw conflict(`Regenerating would exceed the AI budget (about $${est.totalCostUsd}; $${est.month.remainingUsd} left this month).`);
  const j = await queueModule(String(l._id), req.auth!.userId, { keys: b.keys, instructions: b.instructions }); l.lastJobId = j._id as any; await l.save();
  audit(req, 'curriculum_lms.module.regenerate', String(l._id), { keys: b.keys ?? 'all', estimateUsd: est.totalCostUsd }); res.status(202).json({ jobId: String(j._id), estimate: est });
});
/** Restore an earlier version: becomes a new version, checked again (published only if it passes). */
curriculumLmsRouter.post('/modules/:id/restore', requirePermission('content:publish'), async (req, res) => {
  const { version } = z.object({ version: z.number().int().min(1) }).strict().parse(req.body ?? {});
  const l = await loadModule(String(req.params.id)); const v = await LessonVersion.findOne({ lessonId: l._id, version }).lean(); if (!v) throw notFound('Version not found');
  l.sections = v.sections as any; l.title = v.title ?? l.title; if (v.sourceMap) l.sourceMap = v.sourceMap;
  const outcome = await revalidate(l, req.auth!.userId, `Restored version ${version}`);
  await LessonReview.create({ lessonId: l._id, action: 'restore', version: l.version, by: req.auth!.userId, comment: `Restored version ${version}` });
  audit(req, 'curriculum_lms.module.restore', String(l._id), { from: version, to: l.version, outcome }); res.json({ module: l, outcome });
});
/** §11 Student analytics per module: real interactions only. */
curriculumLmsRouter.get('/subjects/:subjectId/analytics', requirePermission('analytics:view'), async (req, res) => {
  const sid = String(req.params.subjectId); if (!mongoose.isValidObjectId(sid)) throw notFound('Subject not found');
  const sId = new mongoose.Types.ObjectId(sid);
  const resources = await LearningResource.find({ subjectId: sId, contentType: 'module', status: 'published' }).select('title moduleKey order').sort({ order: 1 }).lean();
  const stats = await ResourceProgress.aggregate([{ $match: { subjectId: sId, resourceId: { $in: resources.map((r) => r._id) } } },
    { $group: { _id: '$resourceId', learners: { $sum: 1 }, completed: { $sum: { $cond: [{ $ifNull: ['$completedAt', false] }, 1, 0] } }, avgActiveSec: { $avg: '$activeSeconds' }, avgScroll: { $avg: '$maxScrollPct' },
      attempts: { $sum: '$checkAttempts' }, avgScore: { $avg: '$checkScorePct' }, scored: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$checkScorePct', null] }, null] }, 1, 0] } } } }]);
  const by = new Map(stats.map((s) => [String(s._id), s]));
  const enrolled = await StudentProfile.countDocuments({ subjectIds: sId });
  const rows = resources.map((r) => { const s = by.get(String(r._id)); return { resourceId: r._id, title: r.title, moduleKey: r.moduleKey, learners: s?.learners ?? 0, completed: s?.completed ?? 0,
    completionPct: s?.learners ? Math.round((s.completed / s.learners) * 100) : null, avgMinutes: s ? Math.round((s.avgActiveSec ?? 0) / 6) / 10 : null, avgScrollPct: s ? Math.round(s.avgScroll ?? 0) : null,
    avgCheckScorePct: s?.scored ? Math.round(s.avgScore) : null, checkAttempts: s?.attempts ?? 0 }; });
  const difficult = rows.filter((r) => r.avgCheckScorePct !== null && r.checkAttempts >= 3).sort((a, b) => a.avgCheckScorePct! - b.avgCheckScorePct!).slice(0, 5);
  res.json({ enrolled, modules: rows, difficult, note: 'Counts come from learners\' recorded activity (opens, active reading time, scroll depth, knowledge-check attempts). Opening a module is not counted as reading it.' });
});
