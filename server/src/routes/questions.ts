import { notifyPublished } from '../services/eventNotifications.js';
import { Router, type Request } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Question, Subject, Job, CurriculumDocument, Assessment, Attempt, GameDesign, GameSession, ContentVersion } from '../models/index.js';
import { QUESTION_TYPES, QUESTION_STATUSES } from '../models/assess.js';
import { authenticate, requireAnyPermission, requirePermission, canAccessSubject, isContentStaff } from '../middleware/index.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { getLlm } from '../services/ai.js';
import { refusal } from '../services/usage.js';
import { validateQuestion, findNearDuplicate, questionText, normalize, totalMarks, presentQuestion, makePerm, prng, labelSvg, markResponse, solveResponse, TYPE_INFO, teacherMarked } from '../services/assess/core.js';
import { queueQuestionGeneration, estimateQuestions } from '../services/assess/generate.js';
import { sourceScope } from '../services/lessons/generator.js';
import { EDITABLE, IN_REVIEW, can, snapshot, log, authorsOf, history, liveUsage } from '../services/assess/review.js';

/**
 * Question bank (§13). Authors (content:edit) draft and submit; Content Reviewers (content:review) verify the answer key and approve,
 * never for content they authored. Approved = `published`: only then usable in assessments, practice and games.
 * Teachers (activity:assign) may READ approved questions of subjects they teach, to build assessments.
 */
export const questionsRouter = Router();
questionsRouter.use(authenticate, requireAnyPermission('content:edit', 'content:review', 'activity:assign'));
const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const isStaff = (req: any) => isContentStaff(req.auth);
const staffOnly = (req: any) => { if (!isStaff(req)) throw forbidden(); };
const rubric = z.array(z.object({ criterion: z.string().min(2).max(200), maxMarks: z.number().int().min(1).max(50), descriptors: z.array(z.object({ marks: z.number(), description: z.string().max(500) })).max(10).default([]) })).max(10);
const body = z.object({ subjectId: oid, topic: z.string().trim().min(2).max(200), strand: z.string().max(200).optional(), objective: z.string().max(500).optional(), yearOfStudy: z.number().int().min(1).max(6).optional(),
  type: z.enum(QUESTION_TYPES), difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'), stem: z.string().trim().min(5).max(4000), data: z.record(z.string(), z.any()).default({}), rubric: rubric.default([]),
  marks: z.number().int().min(1).max(100).default(1), timeLimitSec: z.number().int().min(10).max(3600).nullable().optional(), explanation: z.string().max(3000).optional(), hint: z.string().max(500).optional(), sourceDocumentId: oid.optional(),
  sourcePages: z.array(z.number().int().min(1)).max(20).optional() }).strict();
const load = async (id: string) => { if (!mongoose.isValidObjectId(id)) throw notFound('Question not found'); const q = await Question.findById(id); if (!q) throw notFound('Question not found'); return q; };
const label = (s: string) => s.replace(/_/g, ' ');
/** Partial schemas still fill defaults: keep only the fields the client actually sent. */
const sent = <T extends object>(parsed: T, raw: any): T => Object.fromEntries(Object.entries(parsed).filter(([k]) => raw && k in raw)) as T;

questionsRouter.get('/types', (_req, res) => res.json({ types: QUESTION_TYPES.map((t) => ({ key: t, ...TYPE_INFO[t] })), statuses: QUESTION_STATUSES,
  teacherMarked: 'Essay questions, and the essay parts of structured and case-study questions, are teacher-marked (an AI-provisional mark is shown first when AI is configured; the teacher verifies). Every other type is marked automatically.' }));
questionsRouter.get('/', async (req, res) => {
  const q = z.object({ subjectId: oid.optional(), status: z.string().optional(), review: z.enum(['queue']).optional(), type: z.string().optional(), topic: z.string().optional(), difficulty: z.string().optional(), search: z.string().max(100).optional(), verified: z.enum(['true']).optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
  const f: any = {};
  if (!isStaff(req)) { if (!q.subjectId || !(await canAccessSubject(req.auth!, q.subjectId))) throw forbidden('You do not teach this subject'); f.status = 'published'; }
  else if (q.review === 'queue') f.status = { $in: IN_REVIEW }; else if (q.status) f.status = q.status;
  for (const k of ['subjectId', 'type', 'topic', 'difficulty'] as const) if (q[k]) f[k] = q[k];
  if (q.verified) f.keyVerifiedAt = { $ne: null };
  if (q.search) f.normStem = { $regex: normalize(q.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
  const [items, total, topics] = await Promise.all([Question.find(f).sort({ updatedAt: -1 }).skip((q.page - 1) * 50).limit(50).populate('subjectId', 'name').populate('createdBy', 'fullName').lean(), Question.countDocuments(f), Question.distinct('topic', q.subjectId ? { subjectId: q.subjectId } : {})]);
  res.json({ items: items.map((x: any) => ({ ...x, teacherMarked: teacherMarked(x), keyVerified: !!x.keyVerifiedAt && x.keyVerifiedVersion === (x.version ?? 1) })), total, topics });
});
questionsRouter.get('/jobs/:jobId', async (req, res) => { staffOnly(req); if (!mongoose.isValidObjectId(req.params.jobId)) throw notFound(); const j = await Job.findOne({ _id: req.params.jobId, type: 'questions.generate' }).lean(); if (!j) throw notFound(); res.json({ job: j }); });

/** Why this user may not decide on this question, or null. Same rules as lessons: reviewers only, never an author, only items under review. */
async function decideBlock(req: Request, q: any) {
  if (!can(req, 'content:review')) return 'Only Content Reviewers can approve, reject or request changes';
  if (!IN_REVIEW.includes(q.status)) return `Only questions awaiting review can be decided (this one is ${label(q.status)})`;
  if ((await authorsOf('question', q)).has(req.auth!.userId)) return 'You authored or edited this question, so you cannot review it (separation of duties)';
  return null;
}
async function usageOf(id: any) {
  const _id = new mongoose.Types.ObjectId(String(id));
  const [assessments, designs, agg, games] = await Promise.all([
    Assessment.find({ questionIds: _id }).select('title status mode closesAt schoolId').populate('schoolId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
    GameDesign.find({ questionIds: _id }).select('title status type').lean(),
    Attempt.aggregate([{ $match: { 'responses.questionId': _id } }, { $unwind: '$responses' }, { $match: { 'responses.questionId': _id, 'responses.maxScore': { $gt: 0 } } },
      { $group: { _id: null, n: { $sum: 1 }, score: { $sum: { $ifNull: ['$responses.score', 0] } }, max: { $sum: '$responses.maxScore' }, assessed: { $sum: { $cond: [{ $ifNull: ['$assessmentId', false] }, 1, 0] } } } }]),
    GameSession.countDocuments({ 'items.questionId': String(id) })]);
  const a = agg[0]; const now = Date.now();
  return { assessments: assessments.map((x: any) => ({ _id: x._id, title: x.title, status: x.status, mode: x.mode, school: x.schoolId?.name, open: x.status === 'published' && (!x.closesAt || new Date(x.closesAt).getTime() > now) })),
    gameDesigns: designs, responses: a?.n ?? 0, assessmentResponses: a?.assessed ?? 0, averagePct: a?.max ? Math.round((100 * a.score) / a.max) : null, gameSessions: games };
}
questionsRouter.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Question not found');
  const q: any = await Question.findById(req.params.id).populate('subjectId', 'name').populate('createdBy reviewedBy keyVerifiedBy', 'fullName').lean(); if (!q) throw notFound('Question not found');
  if (!isStaff(req) && (q.status !== 'published' || !(await canAccessSubject(req.auth!, String(q.subjectId._id))))) throw notFound('Question not found');
  const raw = { ...q, createdBy: q.createdBy?._id ?? q.createdBy };
  const pm = makePerm(q, prng(1), false); const preview = presentQuestion(q, pm);
  const base = { question: { ...q, teacherMarked: teacherMarked(q), keyVerified: !!q.keyVerifiedAt && q.keyVerifiedVersion === (q.version ?? 1) }, typeInfo: TYPE_INFO[q.type], preview, ...(q.type === 'diagram_labelling' ? { svg: labelSvg(q.data) } : {}) };
  if (!isStaff(req)) return res.json(base);
  const [block, h, usage, live] = await Promise.all([decideBlock(req, raw), history('question', q._id), usageOf(q._id), liveUsage(q._id)]);
  const inUse = live.assessments.length + live.designs.length > 0; const neverApproved = !h.reviews.some((r) => r.action === 'approve');
  res.json({ ...base, answer: solveResponse(q, pm), usage, ...h, permissions: {
    edit: can(req, 'content:edit') && EDITABLE.includes(q.status), submit: can(req, 'content:edit') && ['draft', 'changes_requested'].includes(q.status) && !!q.validation?.ok,
    decide: !block, decideBlock: block, archive: (can(req, 'content:publish') || can(req, 'curriculum:manage')) && q.status !== 'archived' && !inUse,
    archiveBlock: inUse ? `Used by ${[...live.assessments.map((a: any) => `open assessment "${a.title}"`), ...live.designs.map((d: any) => `game "${d.title}"`)].join(', ')}` : null,
    restore: (can(req, 'content:publish') || can(req, 'curriculum:manage')) && q.status === 'archived', revise: can(req, 'content:edit') && q.status === 'published' && !inUse,
    duplicate: can(req, 'content:edit'), delete: EDITABLE.includes(q.status) && neverApproved && usage.responses === 0 && !usage.assessments.length && !usage.gameDesigns.length && (String(raw.createdBy) === req.auth!.userId || can(req, 'curriculum:manage')) } });
});
questionsRouter.get('/:id/versions/:v', async (req, res) => { staffOnly(req); const q = await load(String(req.params.id));
  const v = await ContentVersion.findOne({ kind: 'question', refId: q._id, version: Number(req.params.v) }).populate('createdBy', 'fullName').lean(); if (!v) throw notFound('Version not found'); res.json({ version: v }); });

async function checkSource(b: any) { if (b.sourceDocumentId && !(await CurriculumDocument.exists({ _id: b.sourceDocumentId, subjectId: b.subjectId }))) throw badRequest('Source document must belong to the subject'); }
function prepare(b: any) { const q: any = { ...b, citations: b.sourceDocumentId && b.sourcePages ? [{ documentId: b.sourceDocumentId, pageStart: b.sourcePages?.[0], pageEnd: b.sourcePages?.at(-1) }] : b.citations ?? (b.sourceDocumentId ? [{ documentId: b.sourceDocumentId }] : []) };
  delete q.sourcePages; q.marks = totalMarks(q) || q.marks; q.validation = validateQuestion(q); q.normStem = normalize(questionText(q)).slice(0, 300); return q; }
/** Check an answer key without saving: validation, the student view and the answer that scores full marks. */
questionsRouter.post('/validate', requirePermission('content:edit'), async (req, res) => {
  const b = body.partial({ subjectId: true, topic: true }).parse(req.body); const q = prepare(b); const pm = makePerm(q, prng(1), false);
  let preview: any = null, answer: any = null, selfCheck: any = null;
  if (q.validation.ok) { preview = presentQuestion(q, pm); answer = solveResponse(q, pm); if (!teacherMarked(q)) { const m = markResponse(q, answer, pm); selfCheck = { score: m.score, maxScore: m.maxScore, ok: m.correct && m.score === m.maxScore }; } }
  res.json({ validation: q.validation, marks: q.marks, preview, answer, selfCheck, teacherMarked: teacherMarked(q), ...(q.type === 'diagram_labelling' && q.validation.ok ? { svg: labelSvg(q.data) } : {}) });
});
questionsRouter.post('/', requirePermission('content:edit'), async (req, res) => {
  staffOnly(req);
  const b = body.parse(req.body); const subject = await Subject.findById(b.subjectId).lean(); if (!subject) throw badRequest('Unknown subject'); await checkSource(b);
  const q = prepare({ ...b, levelId: subject.levelId, createdBy: req.auth!.userId, status: 'draft', aiGenerated: false, version: 1 });
  const pool = (await Question.find({ subjectId: b.subjectId, status: { $nin: ['rejected', 'archived'] } }).select('stem data type').limit(3000).lean()).map((x) => ({ _id: x._id, type: x.type, text: questionText(x) }));
  const dup = findNearDuplicate(q, pool); if (dup && !req.query.allowDuplicate) throw new AppError(409, 'NEAR_DUPLICATE', `Very similar to an existing question (${Math.round(dup.sim * 100)}% overlap)`, { duplicateOf: String(dup.id) });
  const doc = await Question.create(q); await snapshot('question', doc, 'Created manually', req.auth!.userId); await log('question', doc, req, 'create');
  audit(req, 'question.create', String(doc._id)); res.status(201).json({ question: doc });
});
questionsRouter.patch('/:id', requirePermission('content:edit'), async (req, res) => {
  staffOnly(req); const ex = await load(String(req.params.id));
  if (!EDITABLE.includes(ex.status)) throw conflict(ex.status === 'published' ? 'Approved questions are not edited in place. Use "Revise" (moves it back to draft as a new version) or "Duplicate".'
    : `A question that is ${label(ex.status)} cannot be edited${IN_REVIEW.includes(ex.status) ? ' while it is being reviewed (a reviewer can request changes)' : ''}.`);
  const b = sent(body.partial().omit({ subjectId: true }).parse(req.body), req.body); await checkSource({ ...b, subjectId: ex.subjectId });
  const merged = prepare({ ...ex.toObject(), ...b, sourceDocumentId: b.sourceDocumentId ?? ex.sourceDocumentId, ...(b.sourcePages || b.sourceDocumentId ? {} : { citations: ex.citations }) });
  Object.assign(ex, { ...merged, _id: ex._id, version: (ex.version ?? 1) + 1, status: ex.status === 'rejected' ? 'draft' : ex.status, reviewedBy: undefined, reviewedAt: undefined, keyVerifiedAt: undefined, keyVerifiedBy: undefined, keyVerifiedVersion: undefined, crossCheck: undefined });
  await ex.save(); await snapshot('question', ex, 'Edited', req.auth!.userId); await log('question', ex, req, 'edit');
  audit(req, 'question.edit', String(ex._id)); res.json({ question: ex });
});
questionsRouter.post('/:id/submit', requirePermission('content:edit'), async (req, res) => { staffOnly(req); const q = await load(String(req.params.id));
  if (!['draft', 'changes_requested'].includes(q.status)) throw conflict(`Cannot submit a ${label(q.status)} question`);
  const v = validateQuestion(q.toObject()); q.validation = v as any; if (!v.ok) throw new AppError(422, 'INVALID_QUESTION', 'Fix validation errors first', v.errors);
  const again = q.status === 'changes_requested'; Object.assign(q, { status: again ? 'resubmitted' : 'in_review', submittedAt: new Date(), submittedBy: req.auth!.userId }); await q.save();
  await snapshot('question', q, 'Submitted', req.auth!.userId); await log('question', q, req, again ? 'resubmit' : 'submit');
  audit(req, 'question.submit', String(q._id)); res.json({ question: q }); });
/** Approve needs the reviewer's explicit answer-key verification; a disagreeing AI cross-check needs a comment explaining why the key stands. */
questionsRouter.post('/:id/review', requirePermission('content:review'), async (req, res) => {
  const b = z.object({ action: z.enum(['approve', 'reject', 'request_changes', 'comment']), comment: z.string().trim().max(1000).optional(), answerKeyVerified: z.boolean().optional() }).strict().parse(req.body);
  const q = await load(String(req.params.id));
  if (b.action === 'comment') { if (!b.comment) throw badRequest('Write a comment'); await log('question', q, req, 'comment', b.comment); return res.json({ question: q }); }
  const block = await decideBlock(req, q); if (block) throw new AppError(403, 'REVIEW_BLOCKED', block);
  if (b.action === 'approve') {
    if (b.answerKeyVerified !== true) throw new AppError(422, 'KEY_NOT_VERIFIED', 'Confirm that you checked the answer key (and rubric) against the source before approving');
    if (q.crossCheck === 'disagreed' && !b.comment) throw new AppError(422, 'CROSSCHECK_DISAGREED', 'The AI cross-check disagreed with this answer key. Explain in a comment why the key is correct, or request changes.');
    const v = validateQuestion(q.toObject()); q.validation = v as any; if (!v.ok) throw new AppError(422, 'INVALID_QUESTION', 'Fix validation errors first', v.errors);
    Object.assign(q, { status: 'published', keyVerifiedBy: req.auth!.userId, keyVerifiedAt: new Date(), keyVerifiedVersion: q.version ?? 1 });
  } else { if (!b.comment) throw badRequest(b.action === 'reject' ? 'Give a reason for rejecting' : 'Say what needs changing'); q.status = b.action === 'reject' ? 'rejected' : 'changes_requested'; }
  Object.assign(q, { reviewedBy: req.auth!.userId, reviewedAt: new Date(), reviewComment: b.comment }); await q.save(); await log('question', q, req, b.action, b.comment);
  audit(req, `question.${b.action}`, String(q._id), b.action === 'approve' ? { answerKeyVerified: true, version: q.version } : undefined);
  if (b.action === 'approve') notifyPublished('question', q, req.auth!.userId).catch(() => undefined);
  res.json({ question: q });
});
const archiver = (req: Request) => { if (!can(req, 'content:publish') && !can(req, 'curriculum:manage')) throw forbidden('Only Content Reviewers or Curriculum Admins can archive or restore'); };
questionsRouter.post('/:id/archive', async (req, res) => { archiver(req); const q = await load(String(req.params.id)); if (q.status === 'archived') throw conflict('Already archived');
  const b = z.object({ comment: z.string().trim().max(1000).optional() }).strict().parse(req.body ?? {});
  const live = await liveUsage(q._id); if (live.assessments.length || live.designs.length) throw new AppError(409, 'IN_USE', `In use by ${[...live.assessments.map((a: any) => `open assessment "${a.title}"`), ...live.designs.map((d: any) => `game "${d.title}"`)].join(', ')}. Close the assessment or remove it from the game first.`, live);
  Object.assign(q, { status: 'archived', archivedAt: new Date(), archivedBy: req.auth!.userId }); await q.save(); await log('question', q, req, 'archive', b.comment);
  audit(req, 'question.archive', String(q._id)); res.json({ question: q }); });
questionsRouter.post('/:id/restore', async (req, res) => { archiver(req); const q = await load(String(req.params.id)); if (q.status !== 'archived') throw conflict('Only archived questions can be restored');
  Object.assign(q, { status: 'draft', archivedAt: undefined, archivedBy: undefined, keyVerifiedAt: undefined, keyVerifiedBy: undefined, keyVerifiedVersion: undefined }); await q.save(); await log('question', q, req, 'restore', 'Restored to draft: needs review again');
  audit(req, 'question.restore', String(q._id)); res.json({ question: q }); });
/** Take an approved, unused question back to draft to change it (it leaves the bank until approved again). */
questionsRouter.post('/:id/revise', requirePermission('content:edit'), async (req, res) => { staffOnly(req); const q = await load(String(req.params.id));
  if (q.status !== 'published') throw conflict('Only approved questions are revised; edit drafts directly');
  const live = await liveUsage(q._id); if (live.assessments.length || live.designs.length) throw new AppError(409, 'IN_USE', 'This question is used by an open assessment or a game, so it must stay as approved. Duplicate it instead.', live);
  Object.assign(q, { status: 'draft', keyVerifiedAt: undefined, keyVerifiedBy: undefined, keyVerifiedVersion: undefined, reviewedAt: undefined, reviewedBy: undefined }); await q.save(); await log('question', q, req, 'edit', 'Taken back to draft for revision');
  audit(req, 'question.revise', String(q._id)); res.json({ question: q }); });
questionsRouter.post('/:id/duplicate', requirePermission('content:edit'), async (req, res) => { staffOnly(req); const q = await load(String(req.params.id));
  const o: any = q.toObject(); for (const k of ['_id', 'createdAt', 'updatedAt', 'reviewedBy', 'reviewedAt', 'reviewComment', 'keyVerifiedBy', 'keyVerifiedAt', 'keyVerifiedVersion', 'archivedAt', 'archivedBy', 'submittedAt', 'submittedBy', 'duplicateOf', 'generationJobId', 'crossCheck']) delete o[k];
  const doc = await Question.create({ ...o, status: 'draft', version: 1, createdBy: req.auth!.userId, aiGenerated: false, validation: validateQuestion(o) });
  await snapshot('question', doc, `Copied from question ${q._id} (version ${q.version ?? 1})`, req.auth!.userId); await log('question', doc, req, 'create', `Copy of ${q._id}`);
  audit(req, 'question.duplicate', String(doc._id), { from: String(q._id) }); res.status(201).json({ question: doc }); });
questionsRouter.delete('/:id', requirePermission('content:edit'), async (req, res) => { staffOnly(req); const q = await load(String(req.params.id));
  if (!EDITABLE.includes(q.status)) throw conflict('Only drafts can be deleted; archive approved questions instead');
  if (String(q.createdBy) !== req.auth!.userId && !can(req, 'curriculum:manage')) throw forbidden('Only the author or a Curriculum Admin can delete a draft');
  const u = await usageOf(q._id); if (u.responses || u.assessments.length || u.gameDesigns.length) throw new AppError(409, 'IN_USE', 'This question has been used; archive it instead');
  await q.deleteOne(); audit(req, 'question.delete', String(q._id)); res.status(204).end(); });
/** Preview as a student: mark a response exactly as an attempt would, without saving anything. */
questionsRouter.post('/:id/preview-mark', async (req, res) => {
  const q: any = await Question.findById(mongoose.isValidObjectId(req.params.id) ? req.params.id : null).lean(); if (!q) throw notFound('Question not found');
  if (!isStaff(req) && (q.status !== 'published' || !(await canAccessSubject(req.auth!, String(q.subjectId))))) throw notFound('Question not found');
  const { response } = z.object({ response: z.any() }).parse(req.body); const m = markResponse(q, response, makePerm(q, prng(1), false));
  res.json({ mark: m, teacherMarked: teacherMarked(q), note: m.needsAi ? 'Written answers are teacher-marked against the rubric (with an AI-provisional mark first when AI is configured). Nothing was saved.' : 'Preview only: nothing was saved.' });
});

// ---------- AI generation from approved manuals only ----------
const genSchema = z.object({ subjectId: oid, topic: z.string().trim().min(2).max(200), objective: z.string().max(500).optional(), yearOfStudy: z.number().int().min(1).max(6).optional(),
  types: z.array(z.enum(QUESTION_TYPES)).min(1).max(11), count: z.number().int().min(1).max(15).default(6), difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'), documentIds: z.array(oid).max(10).optional() }).strict();
async function plan(raw: unknown) {
  const b = genSchema.parse(raw); if (!(await Subject.exists({ _id: b.subjectId }))) throw badRequest('Unknown subject');
  const scope = await sourceScope(b.subjectId, { documentIds: b.documentIds }); const problems: string[] = [];
  if (!scope.documents.length) problems.push(`No approved manual for this subject${b.documentIds?.length ? ' among the selected documents' : ''}. A Content Reviewer must verify the source manual as official (and it must be indexed, current and not archived) before questions can be generated from it.`);
  else if (!scope.passages) problems.push('The approved manuals have no indexed passages.');
  return { b, scope, problems };
}
questionsRouter.post('/estimate', requirePermission('content:edit'), async (req, res) => {
  const p = await plan(req.body); const estimate = await estimateQuestions(p.scope, p.b.types, p.b.count, req.auth!.userId);
  res.json({ scope: { documents: p.scope.documents, notApproved: p.scope.notApproved, passages: p.scope.passages }, estimate, problems: p.problems, canGenerate: !p.problems.length && estimate.budget.allowed && !!estimate.provider });
});
questionsRouter.post('/generate', requirePermission('content:edit'), async (req, res) => {
  const p = await plan(req.body);
  if (!getLlm()) throw new AppError(503, 'AI_UNAVAILABLE', 'No LLM provider is configured');
  if (p.problems.length) throw new AppError(422, 'NO_APPROVED_SOURCES', p.problems.join(' '), { notApproved: p.scope.notApproved });
  const estimate = await estimateQuestions(p.scope, p.b.types, p.b.count, req.auth!.userId);
  if (!estimate.budget.allowed) throw refusal(estimate.budget, 'BUDGET_EXCEEDED', `Today's AI budget would be exceeded (${estimate.budget.used}/${estimate.budget.limit} requests used, this needs ${estimate.requests}). Try again tomorrow.`);
  const job = await queueQuestionGeneration({ ...p.b, documentIds: p.b.documentIds ?? p.scope.documents.map((d) => d.id), userId: req.auth!.userId }); audit(req, 'question.generate', String(job._id), p.b);
  res.status(202).json({ jobId: job._id, estimate });
});
