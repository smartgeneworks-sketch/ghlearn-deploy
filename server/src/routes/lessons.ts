import { notifyPublished } from '../services/eventNotifications.js';
import { Router, type Request } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { hasPermission } from '@ghlearn/shared';
import { Lesson, LessonVersion, LessonReview, LearningResource, CurriculumDocument, CurriculumNode, CurriculumVersion, Programme, Subject, Job, User, Chunk, School, AcademicLevel, LESSON_STATUSES } from '../models/index.js';
import { listQuery, paginate, searchFilter } from '../lib/list.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middleware/index.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { diffLines } from '../lib/diff.js';
import { getLlm } from '../services/ai.js';
import { controlsSchema, queueGeneration, queueSectionRegen, validateLesson, snapshot, SECTIONS, LESSON_KEYS, buildSection, assembleFor, CONTENT_TYPES, UNAVAILABLE_TYPES, contentType,
  sourceScope, estimateGeneration, NO_SOURCES, bySectionKey, type Controls } from '../services/lessons/generator.js';
import { budgetStatus, withLimits, refusal } from '../services/usage.js';
import { notifyRoles, notify } from '../services/notify.js';

/**
 * AI generation workspace (§11) and review queue (§12).
 * Statuses: generating -> draft -> in_review (Awaiting review) -> changes_requested -> resubmitted -> approved -> published; archived; failed (generation).
 */
export const lessonsRouter = Router();
lessonsRouter.use(authenticate, requireAnyPermission('content:edit', 'content:review'));
const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const keyEnum = z.enum(SECTIONS.map((s) => s.key) as [string, ...string[]]);
const EDITABLE = ['draft', 'changes_requested'];
const IN_REVIEW = ['in_review', 'resubmitted'];
const can = (req: Request, p: any) => hasPermission(req.auth!.roles, p);
const isSuper = (req: Request) => req.auth!.roles.includes('super_admin');
const load = async (id: string) => { if (!mongoose.isValidObjectId(id)) throw notFound('Lesson not found'); const l = await Lesson.findById(id); if (!l) throw notFound('Lesson not found'); return l; };
const requireLlm = () => { if (!getLlm()) throw new AppError(503, 'AI_UNAVAILABLE', 'No LLM provider is configured (set GEMINI_API_KEY or LLM_PROVIDER)'); };
const activeJob = (lessonId: unknown) => Job.findOne({ 'payload.lessonId': String(lessonId), status: { $in: ['queued', 'running'] } }).lean();
const log = (l: any, req: Request, action: string, extra: Record<string, unknown> = {}) => LessonReview.create({ lessonId: l._id, action: action as any, version: l.version, by: req.auth!.userId, ...extra });

/** Everyone who authored the current content: the creator and anyone who saved a version (edits, regenerations, restores). */
async function authorsOf(l: any) {
  const ids = new Set<string>([String(l.createdBy)]);
  for (const v of await LessonVersion.find({ lessonId: l._id }).select('createdBy').lean()) if (v.createdBy) ids.add(String(v.createdBy));
  return ids;
}
/** Why this user may not decide (approve / request changes) on this lesson, or null if they may. */
async function decideBlock(req: Request, l: any, action: 'approve' | 'request_changes' = 'approve') {
  if (!can(req, 'content:review')) return 'Only Content Reviewers can approve or request changes';
  // an approved (not yet published) item can still be sent back; published items must be unpublished first
  if (!IN_REVIEW.includes(l.status) && !(action === 'request_changes' && l.status === 'approved')) return 'Only lessons awaiting review or resubmitted can be approved or sent back';
  if ((await authorsOf(l)).has(req.auth!.userId)) return 'You authored or edited this content, so you cannot review it (separation of duties)';
  if (l.assignedReviewerId && String(l.assignedReviewerId) !== req.auth!.userId && !isSuper(req)) return 'This review is assigned to another reviewer';
  return null;
}
async function publishBlock(l: any) {
  if (l.status !== 'approved') return 'Only approved content can be published';
  if (l.approvedVersion !== l.version) return `Mandatory review is incomplete: approval was for version ${l.approvedVersion ?? '–'}, the content is now version ${l.version}`;
  if (!l.validation?.ok) return 'The automatic checks have errors';
  const docs = await CurriculumDocument.find({ _id: { $in: l.sourceDocumentIds ?? [] } }).select('approvalStatus archivedAt supersededBy title').lean();
  if (!docs.length) return 'No source manual is recorded';
  const bad = docs.filter((d) => d.approvalStatus !== 'verified_official' || d.archivedAt || d.supersededBy);
  if (bad.length) return `Source manual no longer approved and current: ${bad.map((d) => d.title).join(', ')}`;
  return null;
}

// ---------------- §11 workspace: options, scope, estimate ----------------
lessonsRouter.get('/budget', async (_req, res) => res.json(await budgetStatus()));
lessonsRouter.get('/options', async (_req, res) => {
  const llm = (() => { try { return getLlm(); } catch { return null; } })();
  res.json({
    contentTypes: CONTENT_TYPES.map((t) => ({ id: t.id, label: t.label, sections: t.sections, audience: (t as any).audienceRoles ?? ['student', 'teacher'] })),
    unavailable: UNAVAILABLE_TYPES,
    sections: SECTIONS.map((s) => ({ key: s.key, title: s.title })), lessonSections: LESSON_KEYS,
    illustrations: { diagrams: { available: true, note: 'Diagrams and concept maps are generated as data and drawn by the server (SVG), with alt text.' },
      images: { available: false, reason: 'Image illustrations are not configured: no image provider is set up.' } },
    languages: [{ code: 'en', label: 'English' }], defaults: controlsSchema.parse({}),
    provider: llm ? `${llm.name}:${llm.model}${llm.isTestOnly ? ' (TEST ONLY)' : ''}` : null,
  });
});

const scopeQ = z.object({ subjectId: oid, documentIds: z.union([oid, z.array(oid).max(10)]).optional(), curriculumVersionId: oid.optional(),
  pageFrom: z.coerce.number().int().min(1).optional(), pageTo: z.coerce.number().int().min(1).optional() });
/** Approved, current manuals and curriculum elements (strand / sub-strand / indicator) available for a request. */
lessonsRouter.get('/scope', requirePermission('content:edit'), async (req, res) => {
  const q = scopeQ.parse(req.query); const documentIds = q.documentIds ? [q.documentIds].flat() : undefined;
  const scope = await sourceScope(q.subjectId, { ...q, documentIds });
  const nodes = scope.documents.length ? await CurriculumNode.find({ documentId: { $in: scope.documents.map((d) => d.id) }, type: { $in: ['strand', 'subStrand', 'contentStandard', 'indicator', 'topic'] }, archivedAt: null })
    .select('type code title page verified documentId parentId').sort({ documentId: 1, order: 1 }).limit(400).lean() : [];
  res.json({ ...scope, nodes: nodes.map((n) => ({ id: String(n._id), type: n.type, code: n.code, title: n.title, page: n.page, verified: n.verified, documentId: String(n.documentId) })) });
});

const createBody = z.object({
  contentType: z.enum(CONTENT_TYPES.map((t) => t.id) as [string, ...string[]]).prefault('lesson'),
  title: z.string().trim().min(3).max(200).optional(), subjectId: oid, topic: z.string().trim().min(3).max(300), subtopic: z.string().trim().max(300).optional(),
  strand: z.string().max(300).optional(), subStrand: z.string().max(300).optional(), indicator: z.string().max(500).optional(), nodeId: oid.optional(),
  yearOfStudy: z.number().int().min(1).max(6).optional(), programmeId: oid.optional(), curriculumVersionId: oid.optional(),
  documentIds: z.array(oid).max(10).optional(), pageFrom: z.number().int().min(1).optional(), pageTo: z.number().int().min(1).optional(),
  controls: controlsSchema.prefault({}),
}).strict();
type CreateBody = z.infer<typeof createBody>;

/** Validates a request against real data and prepares the lesson fields; throws 4xx with the reason. No provider calls. */
async function prepare(b: CreateBody) {
  const subject = await Subject.findById(b.subjectId).lean(); if (!subject) throw badRequest('Unknown subject');
  const type = contentType(b.contentType);
  if ((b.pageFrom != null || b.pageTo != null) && b.documentIds?.length !== 1) throw badRequest('A page range needs exactly one source manual');
  if (b.pageFrom != null && b.pageTo != null && b.pageFrom > b.pageTo) throw badRequest('The page range starts after it ends');
  if (b.programmeId && !(await Programme.exists({ _id: b.programmeId }))) throw badRequest('Unknown programme');
  if (b.curriculumVersionId && !(await CurriculumVersion.exists({ _id: b.curriculumVersionId }))) throw badRequest('Unknown curriculum version');
  if (b.documentIds?.length && (await CurriculumDocument.countDocuments({ _id: { $in: b.documentIds }, subjectId: b.subjectId })) !== b.documentIds.length) throw badRequest('Source manuals must belong to the subject');
  const controls = { ...b.controls } as Controls;
  if (type.id === 'lesson') controls.sections = (controls.sections ?? []).filter((k) => k !== 'T') as any; else controls.sections = [...type.sections] as any;
  if (!controls.sections.length) throw badRequest('Choose at least one section');
  if (type.id === 'labelled_diagrams' && controls.illustrations === 'none') throw badRequest('Labelled diagrams need illustrations set to diagrams');
  // curriculum mapping: from a curriculum element of the source manual when given; typed text is labelled as the editor's
  const fields: Record<string, unknown> = { strand: b.strand, subStrand: b.subStrand, indicator: b.indicator, indicatorSource: b.indicator ? 'editor' : null };
  if (b.nodeId) {
    const node = await CurriculumNode.findById(b.nodeId).lean();
    if (!node || String(node.subjectId) !== b.subjectId || node.archivedAt) throw badRequest('Unknown curriculum element for this subject');
    if (b.documentIds?.length && !b.documentIds.includes(String(node.documentId))) throw badRequest('The curriculum element must come from a selected source manual');
    const chain: any[] = []; let cur: any = node;
    while (cur && chain.length < 8) { chain.unshift(cur); cur = cur.parentId ? await CurriculumNode.findById(cur.parentId).lean() : null; }
    const label = (n: any) => `${n.code ? `${n.code} ` : ''}${n.title}`.trim();
    const strand = chain.find((n) => n.type === 'strand'); const sub = chain.find((n) => n.type === 'subStrand'); const ind = [...chain].reverse().find((n) => n.type === 'indicator' || n.type === 'contentStandard');
    if (strand) fields.strand = label(strand); if (sub) fields.subStrand = label(sub);
    if (ind) { fields.indicator = label(ind); fields.indicatorSource = 'curriculum_node'; }
  }
  const scope = await sourceScope(b.subjectId, { documentIds: b.documentIds, curriculumVersionId: b.curriculumVersionId, pageFrom: b.pageFrom, pageTo: b.pageTo });
  const problems: string[] = [];
  if (b.documentIds?.length && scope.notApproved.length) problems.push(`Not approved as verified official: ${scope.notApproved.map((d) => d.title).join(', ')}`);
  if (!scope.passages) problems.push(NO_SOURCES);
  return { subject, type, controls, fields, scope, problems };
}

lessonsRouter.post('/estimate', requirePermission('content:edit'), async (req, res) => {
  const b = createBody.parse(req.body); const p = await prepare(b);
  const estimate = await estimateGeneration(p.scope, p.controls, p.controls.sections, undefined, undefined, req.auth!.userId);
  res.json({ scope: { documents: p.scope.documents, notApproved: p.scope.notApproved, passages: p.scope.passages }, mapping: p.fields, sections: p.controls.sections, estimate, problems: p.problems,
    canGenerate: !p.problems.length && estimate.budget.allowed && !!estimate.provider });
});

lessonsRouter.post('/', requirePermission('content:edit'), async (req, res) => {
  const b = createBody.parse(req.body);
  requireLlm();
  const p = await prepare(b);
  if (p.problems.length) throw new AppError(422, 'NO_APPROVED_SOURCES', p.problems.join(' '), { notApproved: p.scope.notApproved });
  const estimate = await estimateGeneration(p.scope, p.controls, p.controls.sections, undefined, undefined, req.auth!.userId);
  if (!estimate.budget.allowed) throw refusal(estimate.budget, 'AI_BUDGET', `Daily AI budget reached (${estimate.budget.used}/${estimate.budget.limit} requests). Try again tomorrow.`);
  const { nodeId, documentIds, controls: _c, ...rest } = b; void _c;
  const lesson = await Lesson.create({ ...rest, ...p.fields, nodeId, controls: p.controls, contentType: p.type.id, title: b.title ?? `(generating) ${b.topic}`, levelId: p.subject.levelId,
    sourceDocumentIds: documentIds, status: 'generating', createdBy: req.auth!.userId, estimate });
  const job = await queueGeneration(String(lesson._id), req.auth!.userId); lesson.lastJobId = job._id; await lesson.save();
  audit(req, 'lesson.create', String(lesson._id), { contentType: p.type.id }); res.status(202).json({ lesson, jobId: String(job._id), estimate });
});

// ---------------- lists (workspace + §12 review queue) ----------------
const lessonsQ = listQuery(['updatedAt', 'title', 'status', 'createdAt', 'submittedAt'] as const, { maxPageSize: 200, defaultPageSize: 200 }).extend({
  subjectId: z.string().regex(/^[a-f0-9]{24}$/).optional(), status: z.union([z.enum(LESSON_STATUSES), z.array(z.enum(LESSON_STATUSES)).max(9)]).optional(),
  contentType: z.string().max(40).optional(), assigned: z.union([z.literal('me'), z.literal('none'), oid]).optional(), review: z.literal('queue').optional() });
lessonsRouter.get('/', async (req, res) => {
  const p = lessonsQ.parse(req.query);
  const q: Record<string, unknown> = { ...searchFilter(p.q, ['title', 'topic', 'subtopic']) };
  if (p.subjectId) q.subjectId = p.subjectId;
  if (p.review === 'queue' && !p.status) q.status = { $in: IN_REVIEW };
  if (p.status) q.status = Array.isArray(p.status) ? { $in: p.status } : p.status;
  if (p.contentType) q.contentType = p.contentType === 'lesson' ? { $in: ['lesson', null] } : p.contentType;
  if (p.assigned) q.assignedReviewerId = p.assigned === 'me' ? req.auth!.userId : p.assigned === 'none' ? null : p.assigned;
  res.json(await paginate(Lesson, q, p, (x) => x.select('-sections').populate('subjectId', 'name code').populate('createdBy', 'fullName').populate('assignedReviewerId', 'fullName')
    .populate('sourceDocumentIds', 'title approvalStatus')));
});
lessonsRouter.get('/reviewers', requireAnyPermission('content:review', 'curriculum:manage'), async (_req, res) => {
  res.json({ items: (await User.find({ roles: { $in: ['content_reviewer', 'super_admin'] }, status: 'active' }).select('fullName roles').sort({ fullName: 1 }).limit(200).lean())
    .map((u) => ({ id: String(u._id), name: u.fullName })) });
});

lessonsRouter.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Lesson not found');
  const l = await Lesson.findById(req.params.id).populate('subjectId', 'name code').populate('assignedReviewerId', 'fullName').populate('createdBy', 'fullName')
    .populate('programmeId', 'name').populate('curriculumVersionId', 'code name').populate('reviewedBy', 'fullName').populate('publishedBy', 'fullName').lean();
  if (!l) throw notFound('Lesson not found');
  const raw = await Lesson.findById(req.params.id).select('createdBy assignedReviewerId status version approvedVersion validation sourceDocumentIds').lean();
  const [versions, reviews, job, docs, block, pub, active] = await Promise.all([
    LessonVersion.find({ lessonId: l._id }).select('version reason createdBy createdAt').sort({ version: -1 }).populate('createdBy', 'fullName').lean(),
    LessonReview.find({ lessonId: l._id }).sort({ createdAt: -1 }).populate('by', 'fullName').populate('assigneeId', 'fullName').lean(),
    l.lastJobId ? Job.findById(l.lastJobId).lean() : null,
    CurriculumDocument.find({ _id: { $in: l.sourceDocumentIds ?? [] } }).select('title approvalStatus archivedAt supersededBy provenance.sourceUrl').lean(),
    decideBlock(req, raw), publishBlock(raw), activeJob(l._id)]);
  const sendBack = l.status === 'approved' ? await decideBlock(req, raw, 'request_changes') : block;
  const mine = String(raw!.createdBy) === req.auth!.userId;
  const permissions = {
    edit: can(req, 'content:edit') && EDITABLE.includes(l.status) && !active,
    submit: can(req, 'content:edit') && ['draft', 'changes_requested'].includes(l.status) && !!l.validation?.ok && !active,
    decide: { allowed: !block, reason: block }, requestChanges: { allowed: !sendBack, reason: sendBack }, publish: { allowed: can(req, 'content:publish') && !pub, reason: can(req, 'content:publish') ? pub : 'Needs the publish permission' },
    unpublish: can(req, 'content:publish') && l.status === 'published', archive: (can(req, 'content:publish') || (can(req, 'curriculum:manage') && l.status !== 'published')) && !['archived', 'generating'].includes(l.status),
    assign: (can(req, 'content:review') || can(req, 'curriculum:manage')) && !['published', 'archived', 'generating', 'failed'].includes(l.status), assignOthers: can(req, 'curriculum:manage') || isSuper(req),
    comment: true, cancel: can(req, 'content:edit') && active?.status === 'queued', retry: can(req, 'content:edit') && l.status === 'failed' && !active,
    delete: !active && ((can(req, 'content:edit') && l.status === 'failed' && (mine || can(req, 'curriculum:manage'))) || (l.status === 'archived' && can(req, 'platform:manage'))),
  };
  res.json({ lesson: l, versions, reviews, job, sourceDocuments: docs, permissions, type: contentType(l.contentType) });
});

// ---------------- editing ----------------
const sectionEdit = z.object({ key: keyEnum, content: z.string().max(20000).optional(), data: z.record(z.string(), z.unknown()).optional(), sourceSupport: z.enum(['source', 'general', 'mixed', 'none']).optional() }).strict();
lessonsRouter.patch('/:id', requirePermission('content:edit'), async (req, res) => {
  const b = z.object({ title: z.string().trim().min(3).max(200).optional(), sections: z.array(sectionEdit).max(12).optional(), baseVersion: z.number().int().optional() }).strict().parse(req.body);
  const l = await load(String(req.params.id));
  if (!EDITABLE.includes(l.status)) throw conflict(`A lesson that is ${l.status.replace(/_/g, ' ')} cannot be edited${IN_REVIEW.includes(l.status) ? ' while it is being reviewed (a reviewer can request changes)' : l.status === 'published' ? '. Unpublish it first' : ''}.`);
  if (b.baseVersion != null && b.baseVersion !== l.version) throw new AppError(409, 'VERSION_CONFLICT', 'The lesson changed since you opened it. Reload to see the latest version.');
  if (b.title) l.title = b.title;
  const allowed = (l.controls as any)?.sections ?? LESSON_KEYS;
  const sections = l.sections.map((s: any) => s.toObject());
  for (const e of b.sections ?? []) {
    if (!allowed.includes(e.key)) throw badRequest(`Section ${e.key} is not part of this content`);
    const i = sections.findIndex((s: any) => s.key === e.key);
    const merged = { ...(i >= 0 ? sections[i] : { key: e.key, kind: SECTIONS.find((s) => s.key === e.key)!.kind, title: SECTIONS.find((s) => s.key === e.key)!.title, citations: [] }), ...e, editedBy: req.auth!.userId, editedAt: new Date() };
    if (['F', 'J'].includes(e.key) && e.data) Object.assign(merged, { data: buildSection({ key: e.key, content: merged.content, data: e.data, citations: [] }, []).data });
    if (e.key === 'A' && e.data) delete (merged.data as any).indicators; // indicators come from curriculum records only
    if (i >= 0) sections[i] = merged; else sections.push(merged);
  }
  sections.sort(bySectionKey);
  const full = await assembleFor(l, sections.filter((s: any) => s.key !== 'K')); l.sections = full as any; l.validation = validateLesson(full, l.controls as any, undefined, l.contentType ?? 'lesson') as any;
  await snapshot(l, 'Manual edit (draft saved)', req.auth!.userId); await l.save();
  audit(req, 'lesson.edit', String(l._id), { version: l.version }); res.json({ lesson: l });
});
lessonsRouter.post('/:id/sections/:key/regenerate', requirePermission('content:edit'), async (req, res) => {
  const key = keyEnum.parse(req.params.key); const { instructions } = z.object({ instructions: z.string().max(1000).optional() }).parse(req.body ?? {});
  requireLlm(); const l = await load(String(req.params.id));
  if (!EDITABLE.includes(l.status)) throw conflict(`A lesson that is ${l.status.replace(/_/g, ' ')} cannot be regenerated`);
  if (!((l.controls as any)?.sections ?? LESSON_KEYS).includes(key)) throw badRequest(`Section ${key} is not part of this content`);
  if (await activeJob(l._id)) throw new AppError(409, 'ALREADY_QUEUED', 'A generation job is already running for this lesson');
  const b = await withLimits({ ...(await budgetStatus()), allowed: true }, { purpose: 'lesson.regenerateSection', userId: req.auth!.userId }); if (!b.allowed) throw refusal(b, 'AI_BUDGET', `Daily AI budget reached (${b.requests}/${b.requestBudget} requests). Try again tomorrow.`);
  const job = await queueSectionRegen(String(l._id), key, req.auth!.userId, instructions); l.lastJobId = job._id; await l.save();
  res.status(202).json({ jobId: String(job._id) });
});
lessonsRouter.get('/:id/versions/:v', async (req, res) => {
  const v = await LessonVersion.findOne({ lessonId: req.params.id, version: Number(req.params.v) }).lean(); if (!v) throw notFound('Version not found'); res.json({ version: v });
});
lessonsRouter.get('/:id/compare', async (req, res) => {
  const a = Number(req.query.a), b = Number(req.query.b);
  const [va, vb] = await Promise.all([LessonVersion.findOne({ lessonId: req.params.id, version: a }).lean(), LessonVersion.findOne({ lessonId: req.params.id, version: b }).lean()]);
  if (!va || !vb) throw notFound('Version not found');
  const keys = [...new Set([...va.sections, ...vb.sections].map((s) => s.key))].sort();
  res.json({ a, b, titleChanged: va.title !== vb.title, sections: keys.map((k) => {
    const sa = va.sections.find((s) => s.key === k), sb = vb.sections.find((s) => s.key === k);
    const ta = sa ? `${sa.content ?? ''}\n${sa.data ? JSON.stringify(sa.data, null, 1) : ''}` : ''; const tb = sb ? `${sb.content ?? ''}\n${sb.data ? JSON.stringify(sb.data, null, 1) : ''}` : '';
    return { key: k, changed: ta !== tb, diff: ta === tb ? [] : diffLines(ta, tb) }; }) });
});
lessonsRouter.post('/:id/versions/:v/restore', requirePermission('content:edit'), async (req, res) => {
  const l = await load(String(req.params.id)); if (!EDITABLE.includes(l.status)) throw conflict(`A lesson that is ${l.status.replace(/_/g, ' ')} cannot be restored`);
  const v = await LessonVersion.findOne({ lessonId: l._id, version: Number(req.params.v) }).lean(); if (!v) throw notFound('Version not found');
  l.sections = v.sections as any; l.title = v.title ?? l.title; l.validation = validateLesson(v.sections as any[], l.controls as any, undefined, l.contentType ?? 'lesson') as any;
  await snapshot(l, `Restored version ${v.version}`, req.auth!.userId); await l.save();
  audit(req, 'lesson.restore', String(l._id), { from: v.version }); res.json({ lesson: l });
});
/** Passages each section cites, with their manual and page, for comparing generated content with its sources (§12). */
lessonsRouter.get('/:id/sources', async (req, res) => {
  const l = await load(String(req.params.id));
  const ids = [...new Set(l.sections.flatMap((s: any) => s.citations.map((c: any) => String(c.chunkId))))].filter(mongoose.isValidObjectId);
  const [chunks, docs] = await Promise.all([Chunk.find({ _id: { $in: ids } }).select('text pageStart pageEnd documentId headingPath').lean(),
    CurriculumDocument.find({ _id: { $in: [...new Set(l.sections.flatMap((s: any) => s.citations.map((c: any) => String(c.documentId))))].filter(mongoose.isValidObjectId) } }).select('title approvalStatus archivedAt supersededBy').lean()]);
  const ch = new Map(chunks.map((c) => [String(c._id), c])); const dm = new Map(docs.map((d) => [String(d._id), d]));
  res.json({ sections: l.sections.filter((s: any) => s.key !== 'K').map((s: any) => ({ key: s.key, title: s.title, sourceSupport: s.sourceSupport, content: s.content,
    passages: s.citations.map((c: any) => { const k = ch.get(String(c.chunkId)); const d = dm.get(String(c.documentId));
      return { chunkId: String(c.chunkId), found: !!k, text: k?.text ?? null, headingPath: k?.headingPath ?? [], pageStart: c.pageStart, pageEnd: c.pageEnd,
        document: d ? { id: String(d._id), title: d.title, approvalStatus: d.approvalStatus, current: !d.archivedAt && !d.supersededBy } : null }; }) })) });
});

// ---------------- generation controls: cancel, retry, delete ----------------
lessonsRouter.post('/:id/cancel', requirePermission('content:edit'), async (req, res) => {
  const l = await load(String(req.params.id)); const j = await activeJob(l._id);
  if (!j) throw conflict('No generation is queued for this lesson');
  if (j.status === 'running') throw conflict('The request has already been sent to the AI provider and cannot be stopped; wait for it to finish or fail');
  const at = new Date();
  const u = await Job.updateOne({ _id: j._id, status: 'queued' }, { status: 'cancelled', cancelledAt: at, cancelledBy: req.auth!.userId, finishedAt: at, $push: { stages: { stage: 'cancelled', at, attempt: j.attempts } } });
  if (!u.modifiedCount) throw conflict('The job started before it could be cancelled');
  const who = (await User.findById(req.auth!.userId).select('fullName').lean())?.fullName ?? 'a user';
  if (l.status === 'generating') { l.status = 'failed'; l.generationError = `Cancelled by ${who} before generation started`; await l.save(); }
  await log(l, req, 'cancel', { comment: j.type === 'lesson.regenerateSection' ? `Section ${(j.payload as any)?.key} regeneration cancelled` : 'Generation cancelled' });
  audit(req, 'lesson.cancel', String(l._id), { jobId: String(j._id) }); res.json({ lesson: l });
});
lessonsRouter.post('/:id/retry', requirePermission('content:edit'), async (req, res) => {
  const l = await load(String(req.params.id));
  if (l.status !== 'failed') throw conflict('Only failed generations can be retried');
  if (await activeJob(l._id)) throw new AppError(409, 'ALREADY_QUEUED', 'A generation job is already queued for this lesson');
  requireLlm();
  const scope = await sourceScope(String(l.subjectId), { documentIds: l.sourceDocumentIds?.map(String), curriculumVersionId: l.curriculumVersionId ? String(l.curriculumVersionId) : undefined, pageFrom: l.pageFrom ?? undefined, pageTo: l.pageTo ?? undefined });
  if (!scope.passages) throw new AppError(422, 'NO_APPROVED_SOURCES', NO_SOURCES);
  const ctrl = controlsSchema.safeParse(l.controls ?? {}); const controls = (ctrl.success ? ctrl.data : controlsSchema.parse({})) as Controls;
  const estimate = await estimateGeneration(scope, controls, controls.sections, undefined, undefined, req.auth!.userId);
  if (!estimate.budget.allowed) throw refusal(estimate.budget, 'AI_BUDGET', `Daily AI budget reached (${estimate.budget.used}/${estimate.budget.limit} requests). Try again tomorrow.`);
  const job = await queueGeneration(String(l._id), req.auth!.userId);
  l.status = 'generating'; l.generationError = undefined; l.lastJobId = job._id; l.estimate = estimate; await l.save();
  await log(l, req, 'retry'); audit(req, 'lesson.retry', String(l._id), { jobId: String(job._id) }); res.status(202).json({ lesson: l, jobId: String(job._id), estimate });
});
lessonsRouter.delete('/:id', requirePermission('content:edit'), async (req, res) => {
  const l = await load(String(req.params.id));
  if (!['failed', 'archived'].includes(l.status)) throw conflict('Only failed generations (or archived items, by a Super Admin) can be deleted; archive other content instead');
  if (await activeJob(l._id)) throw conflict('A generation job is still queued or running');
  if (l.status === 'archived' && !can(req, 'platform:manage')) throw forbidden('Only a Super Admin can permanently delete archived content');
  if (l.status === 'failed' && String(l.createdBy) !== req.auth!.userId && !can(req, 'curriculum:manage')) throw forbidden('Only the creator or a Curriculum Admin can delete this generation');
  if (l.resourceId) await LearningResource.deleteOne({ _id: l.resourceId, status: 'archived' }); // its published copy was withdrawn when archived
  await Promise.all([LessonVersion.deleteMany({ lessonId: l._id }), LessonReview.deleteMany({ lessonId: l._id }), Job.deleteMany({ 'payload.lessonId': String(l._id), status: { $nin: ['queued', 'running'] } })]);
  await l.deleteOne();
  audit(req, 'lesson.delete', String(l._id), { title: l.title, error: l.generationError }, { entityType: 'lesson', before: { title: l.title, status: l.status } });
  res.status(204).end();
});

// ---------------- §12 review workflow ----------------
lessonsRouter.post('/:id/submit', requirePermission('content:edit'), async (req, res) => {
  const l = await load(String(req.params.id));
  if (!['draft', 'changes_requested'].includes(l.status)) throw conflict(`A lesson that is ${l.status.replace(/_/g, ' ')} cannot be submitted`);
  if (!l.validation?.ok) throw new AppError(422, 'VALIDATION_FAILED', 'Fix validation errors before submitting', l.validation?.errors);
  if (await activeJob(l._id)) throw conflict('Wait for the running generation to finish');
  const resubmit = l.status === 'changes_requested';
  l.status = resubmit ? 'resubmitted' : 'in_review'; l.submittedAt = new Date(); l.submittedBy = req.auth!.userId as any; await l.save();
  await log(l, req, resubmit ? 'resubmit' : 'submit', { comment: req.body?.comment ? String(req.body.comment).slice(0, 2000) : undefined });
  const msg = { type: 'review.requested', title: `${resubmit ? 'Resubmitted' : 'Ready'} for review: ${l.title}`, link: `/admin/lessons/${l._id}` };
  (l.assignedReviewerId ? notify([l.assignedReviewerId], msg) : notifyRoles(['content_reviewer'], msg)).catch(() => undefined);
  audit(req, resubmit ? 'lesson.resubmit' : 'lesson.submit', String(l._id), { version: l.version }); res.json({ lesson: l });
});
lessonsRouter.post('/:id/assign', requireAnyPermission('content:review', 'curriculum:manage'), async (req, res) => {
  const { reviewerId } = z.object({ reviewerId: oid.nullable() }).strict().parse(req.body);
  const l = await load(String(req.params.id));
  if (['published', 'archived', 'generating', 'failed'].includes(l.status)) throw conflict(`A lesson that is ${l.status} has no review to assign`);
  const others = can(req, 'curriculum:manage') || isSuper(req);
  if (reviewerId && reviewerId !== req.auth!.userId && !others) throw forbidden('Reviewers can only assign reviews to themselves');
  if (!reviewerId && l.assignedReviewerId && String(l.assignedReviewerId) !== req.auth!.userId && !others) throw forbidden('Only the assigned reviewer or a Curriculum Admin can remove this assignment');
  if (reviewerId) {
    const u = await User.findById(reviewerId).select('roles fullName').lean();
    if (!u || !hasPermission(u.roles as any, 'content:review')) throw badRequest('The assignee must be a Content Reviewer');
    if ((await authorsOf(l)).has(reviewerId)) throw badRequest('An author of this content cannot be its reviewer (separation of duties)');
  }
  l.assignedReviewerId = (reviewerId ?? undefined) as any; l.assignedAt = reviewerId ? new Date() : undefined; l.assignedBy = (reviewerId ? req.auth!.userId : undefined) as any; await l.save();
  await log(l, req, reviewerId ? 'assign' : 'unassign', { assigneeId: reviewerId ?? undefined });
  if (reviewerId && reviewerId !== req.auth!.userId) notify([reviewerId], { type: 'review.assigned', title: `Review assigned to you: ${l.title}`, link: `/admin/lessons/${l._id}` }).catch(() => undefined);
  audit(req, 'lesson.assign', String(l._id), { reviewerId }); res.json({ lesson: l });
});
lessonsRouter.post('/:id/comments', async (req, res) => {
  const b = z.object({ comment: z.string().trim().min(1).max(2000), sectionKey: keyEnum.optional() }).strict().parse(req.body);
  const l = await load(String(req.params.id));
  const c = await log(l, req, 'comment', { comment: b.comment, sectionKey: b.sectionKey });
  res.status(201).json({ comment: c });
});
lessonsRouter.post('/:id/review', requirePermission('content:review'), async (req, res) => {
  const b = z.object({ action: z.enum(['approve', 'request_changes', 'comment']), comment: z.string().max(2000).optional() }).parse(req.body);
  const l = await load(String(req.params.id));
  if (b.action === 'comment') { if (!b.comment?.trim()) throw badRequest('Write a comment'); await log(l, req, 'comment', { comment: b.comment }); return res.json({ lesson: l }); }
  const block = await decideBlock(req, l, b.action);
  if (block) throw (block.startsWith('Only lessons') ? conflict(block) : forbidden(block));
  if (b.action === 'request_changes' && !b.comment?.trim()) throw badRequest('Explain what needs to change');
  if (b.action === 'approve' && !l.validation?.ok) throw new AppError(422, 'VALIDATION_FAILED', 'Lesson has validation errors', l.validation?.errors);
  l.status = b.action === 'approve' ? 'approved' : 'changes_requested'; l.reviewedBy = req.auth!.userId as any; l.reviewedAt = new Date();
  l.approvedVersion = b.action === 'approve' ? l.version : undefined; await l.save();
  await log(l, req, b.action, { comment: b.comment });
  await notify([l.createdBy], { type: 'review.decision', title: b.action === 'approve' ? `Approved: ${l.title}` : `Changes requested: ${l.title}`, body: b.comment, link: `/admin/lessons/${l._id}` });
  audit(req, `lesson.${b.action}`, String(l._id), { version: l.version }); res.json({ lesson: l });
});
const audienceBody = z.object({ levelId: oid.optional(), yearOfStudy: z.number().int().min(1).max(6).optional(), programmeIds: z.array(oid).max(20).optional(), schoolIds: z.array(oid).max(50).optional() }).strict();
lessonsRouter.post('/:id/publish', requirePermission('content:publish'), async (req, res) => {
  const b = z.object({ audience: audienceBody.prefault({}) }).strict().parse(req.body ?? {});
  const l = await load(String(req.params.id));
  const block = await publishBlock(l);
  if (block) throw (l.status !== 'approved' ? conflict(block) : new AppError(422, l.approvedVersion !== l.version ? 'REVIEW_INCOMPLETE' : block.startsWith('Source') || block.startsWith('No source') ? 'SOURCE_NOT_CURRENT' : 'VALIDATION_FAILED', block));
  const a = b.audience;
  if (a.levelId && !(await AcademicLevel.exists({ _id: a.levelId }))) throw badRequest('Unknown level');
  if (a.programmeIds?.length && (await Programme.countDocuments({ _id: { $in: a.programmeIds } })) !== a.programmeIds.length) throw badRequest('Unknown programme');
  if (a.schoolIds?.length && (await School.countDocuments({ _id: { $in: a.schoolIds } })) !== a.schoolIds.length) throw badRequest('Unknown institution');
  const type = contentType(l.contentType);
  const docs = await CurriculumDocument.find({ _id: { $in: l.sourceDocumentIds } }).select('approvalStatus title').lean();
  const pages = [...new Set(l.sections.flatMap((s: any) => s.citations.map((c: any) => c.pageStart)))].filter(Boolean).sort((x: any, y: any) => x - y);
  const body = { lessonId: String(l._id), version: l.version, contentType: type.id, sections: l.sections, sourceDocuments: docs.map((d) => ({ id: String(d._id), title: d.title, approvalStatus: d.approvalStatus })) };
  const audience = { roles: (type as any).audienceRoles ?? ['student', 'teacher'], levelId: a.levelId, yearOfStudy: a.yearOfStudy ?? undefined, programmeIds: a.programmeIds ?? [], schoolIds: a.schoolIds ?? [] };
  const r = await LearningResource.findOneAndUpdate({ _id: l.resourceId ?? new mongoose.Types.ObjectId() }, { title: l.title, kind: type.kind, contentType: type.id, subjectId: l.subjectId, yearOfStudy: l.yearOfStudy, strand: l.strand, subStrand: l.subStrand,
    indicator: l.indicator, topic: l.topic, sourceDocumentId: l.sourceDocumentIds?.[0], sourcePages: pages, status: 'published', aiGenerated: true, body, audience }, { upsert: true, returnDocument: 'after' });
  l.status = 'published'; l.resourceId = r!._id; l.publishedBy = req.auth!.userId as any; l.publishedAt = new Date(); l.audience = { levelId: a.levelId, yearOfStudy: a.yearOfStudy, programmeIds: a.programmeIds ?? [], schoolIds: a.schoolIds ?? [] } as any; await l.save();
  await log(l, req, 'publish');
  audit(req, 'lesson.publish', String(l._id), { resourceId: String(r!._id), audience }); notifyPublished('lesson', l, req.auth!.userId, String(r!._id)).catch(() => undefined); res.json({ lesson: l, resourceId: String(r!._id) });
});
lessonsRouter.post('/:id/unpublish', requirePermission('content:publish'), async (req, res) => {
  const l = await load(String(req.params.id)); if (l.status !== 'published') throw conflict('Lesson is not published');
  await LearningResource.updateOne({ _id: l.resourceId }, { status: 'archived' });
  l.status = 'approved'; (l as any).publicPreview = false; await l.save(); // the approval of this exact version still stands; editing needs changes requested first
  await log(l, req, 'unpublish', { comment: req.body?.comment ? String(req.body.comment).slice(0, 2000) : undefined });
  audit(req, 'lesson.unpublish', String(l._id)); res.json({ lesson: l });
});
/** Public preview (docs/LANDING_SPEC.md): lets anonymous visitors read the published copy (without assessment answers or teacher notes). */
lessonsRouter.post('/:id/public-preview', requirePermission('content:publish'), async (req, res) => {
  const b = z.object({ enabled: z.boolean() }).strict().parse(req.body ?? {});
  const l = await load(String(req.params.id));
  if (b.enabled) {
    if (l.status !== 'published') throw conflict('Only published lessons can be shown as a public preview');
    if ((l as any).audience?.schoolIds?.length) throw conflict('This lesson is limited to particular institutions, so it cannot be public');
    const r = await LearningResource.findById(l.resourceId).select('audience status').lean();
    if (!r || r.status !== 'published' || !(r as any).audience?.roles?.includes('student')) throw conflict('Only lessons published for students can be public');
  }
  const before = !!(l as any).publicPreview; (l as any).publicPreview = b.enabled; (l as any).publicPreviewBy = req.auth!.userId; (l as any).publicPreviewAt = new Date(); await l.save();
  audit(req, 'lesson.public_preview', String(l._id), { enabled: b.enabled }, { entityType: 'lesson', before: { publicPreview: before }, after: { publicPreview: b.enabled } });
  res.json({ publicPreview: b.enabled });
});
lessonsRouter.post('/:id/archive', requireAnyPermission('content:publish', 'curriculum:manage'), async (req, res) => {
  const l = await load(String(req.params.id));
  if (['archived', 'generating'].includes(l.status)) throw conflict(`A lesson that is ${l.status} cannot be archived`);
  if (l.status === 'published' && !can(req, 'content:publish')) throw forbidden('Archiving published content withdraws it; that needs the publish permission');
  if (await activeJob(l._id)) throw conflict('Wait for the running generation to finish');
  if (l.resourceId) await LearningResource.updateOne({ _id: l.resourceId }, { status: 'archived' });
  l.status = 'archived'; l.archivedAt = new Date(); l.archivedBy = req.auth!.userId as any; await l.save();
  await log(l, req, 'archive', { comment: req.body?.comment ? String(req.body.comment).slice(0, 2000) : undefined });
  audit(req, 'lesson.archive', String(l._id)); res.json({ lesson: l });
});
