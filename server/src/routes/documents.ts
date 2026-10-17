import { Router, type Request } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import * as S from '@ghlearn/shared';
import { hasPermission } from '@ghlearn/shared';
import { CurriculumDocument, CurriculumVersion, DocumentPage, CurriculumNode, Chunk, Job, Subject, AcademicLevel, Programme, LearningResource, Lesson } from '../models/index.js';
import { Question } from '../models/assess.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middleware/index.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { listQuery, paginate, searchFilter } from '../lib/list.js';
import { config } from '../config.js';
import { getSettings } from '../services/platformSettings.js';
import { gridfs, readObject, StorageUnavailableError } from '../services/storage.js';
import { receiveManual, quotaLeft, mimeFor, type ReceivedManual } from '../services/manualUpload.js';
import { queueProcessing } from '../services/ingest/pipeline.js';
import { startBulk, latestBulk, cancelBulk, bulkState } from '../services/ingest/bulk.js';

export const documentsRouter = Router();
documentsRouter.use(authenticate, requireAnyPermission('documents:upload', 'documents:map', 'content:review'));
const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const ACTIVE = ['queued', 'extracting', 'ocr', 'structuring', 'chunking', 'embedding'];
const can = (req: Request, p: S.Permission) => hasPermission(req.auth!.roles, p);
/** Download of the original: allowed by the licensing status, or always for Curriculum Admins and Super Admins. Inline preview is open to every library user. */
export const canDownload = (req: Request, d: { licensingStatus?: string | null }) => can(req, 'curriculum:manage') || (S.DOWNLOADABLE_LICENSING as readonly string[]).includes(d.licensingStatus ?? 'unknown');

/** Multipart text fields -> typed metadata (validated by the shared schema). */
function metaFromFields(f: Record<string, string>): S.ManualMeta {
  const num = (k: string) => (f[k] ? Number(f[k]) : undefined); const str = (k: string) => (f[k]?.trim() ? f[k].trim() : undefined);
  const raw: Record<string, unknown> = { title: str('title'), subjectId: str('subjectId'), levelId: str('levelId'), programmeId: str('programmeId'), yearOfStudy: num('yearOfStudy'),
    curriculumVersionId: str('curriculumVersionId'), docType: str('docType'), audience: str('audience'), publisher: str('publisher'), sourceUrl: str('sourceUrl'), publicationYear: num('publicationYear'),
    language: str('language'), documentVersion: str('documentVersion'), licensingStatus: str('licensingStatus'), tags: f.tags ? f.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined };
  return S.manualMetaSchema.parse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)));
}
/** Reference checks for metadata; returns the version label to mirror. */
async function checkRefs(m: S.ManualMeta) {
  if (m.subjectId && !(await Subject.exists({ _id: m.subjectId }))) throw badRequest('Unknown subject');
  if (m.levelId && !(await AcademicLevel.exists({ _id: m.levelId }))) throw badRequest('Unknown level');
  if (m.programmeId && !(await Programme.exists({ _id: m.programmeId }))) throw badRequest('Unknown Learning Area');
  if (m.curriculumVersionId) {
    const v = await CurriculumVersion.findById(m.curriculumVersionId).select('code status').lean();
    if (!v) throw badRequest('Unknown curriculum version'); if (v.status === 'archived') throw conflict('That curriculum version is archived; choose a draft or active version');
    return v.code;
  }
  return m.curriculumVersionId === null ? null : undefined;
}
const toDocFields = (m: S.ManualMeta, label: string | null | undefined) => {
  const { publisher, sourceUrl, tags, ...rest } = m;
  return { ...rest, ...(tags ? { tags: [...new Set(tags.map((t) => t.toLowerCase()))] } : {}), ...(label !== undefined ? { curriculumVersion: label ?? undefined } : {}),
    ...(publisher !== undefined ? { 'provenance.publisher': publisher || undefined } : {}), ...(sourceUrl !== undefined ? { 'provenance.sourceUrl': sourceUrl || undefined } : {}) };
};
const discard = (f: ReceivedManual) => gridfs.delete(f.stored.key).catch(() => {});
async function findDuplicate(sha: string, not?: unknown) {
  return CurriculumDocument.findOne({ 'provenance.checksum': sha, duplicateOf: null, ...(not ? { _id: { $ne: not } } : {}) }).select('_id title archivedAt versionGroupId').lean();
}

documentsRouter.get('/stats', async (_req, res) => {
  const agg = async (field: string) => Object.fromEntries((await CurriculumDocument.aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }])).map((r) => [r._id ?? 'none', r.n]));
  res.json({ total: await CurriculumDocument.countDocuments(), duplicates: await CurriculumDocument.countDocuments({ duplicateOf: { $ne: null } }),
    processing: await agg('processingStatus'), mapping: await agg('mappingStatus'), approval: await agg('approvalStatus'),
    jobs: Object.fromEntries((await Job.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])).map((r) => [r._id, r.n])) });
});

const listQ = listQuery(['updatedAt', 'createdAt', 'title', 'sizeBytes', 'pageCount'] as const, { defaultSort: '-updatedAt', maxPageSize: 200 }).extend({
  processingStatus: z.string().max(200).optional(), mappingStatus: z.enum(['unmapped', 'suggested', 'confirmed', 'unconfirmed']).optional(), approvalStatus: z.enum(S.APPROVAL_STATUSES).optional(),
  docType: z.enum(S.DOC_TYPES).optional(), subjectId: oid.optional(), levelId: oid.optional(), curriculumVersionId: oid.optional(), licensingStatus: z.enum(S.LICENSING_STATUSES).optional(),
  ocrStatus: z.enum(S.OCR_STATUSES).optional(), reviewFlag: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(), fileKind: z.enum(S.MANUAL_KINDS as [S.ManualKind, ...S.ManualKind[]]).optional(), tag: z.string().trim().max(40).optional(),
  archived: z.enum(['false', 'true', 'all']).optional(), versions: z.enum(['current', 'all']).optional(), duplicates: z.enum(['hide', 'include', 'only']).optional(),
});
documentsRouter.get('/', async (req, res) => {
  const p = listQ.parse(req.query); const q: Record<string, unknown> = { ...searchFilter(p.q, ['title', 'originalFilename', 'tags']) };
  if (p.processingStatus) { const v = p.processingStatus.split(',').slice(0, 10); q.processingStatus = v.length > 1 ? { $in: v } : v[0]; }
  if (p.mappingStatus) q.mappingStatus = p.mappingStatus === 'unconfirmed' ? { $ne: 'confirmed' } : p.mappingStatus;
  for (const k of ['approvalStatus', 'docType', 'subjectId', 'levelId', 'curriculumVersionId', 'licensingStatus', 'ocrStatus', 'fileKind'] as const) if (p[k]) q[k] = p[k];
  if (p.tag) q.tags = p.tag.toLowerCase();
  if (p.reviewFlag) q.reviewFlags = p.reviewFlag;
  if (p.duplicates === 'only') q.duplicateOf = { $ne: null }; else if (p.duplicates !== 'include') q.duplicateOf = null;
  if (p.archived !== 'all') q.archivedAt = p.archived === 'true' ? { $ne: null } : null;
  if (p.versions !== 'all') q.supersededBy = null;
  const out = await paginate<any>(CurriculumDocument, q, p, (x) => x.select('-processingReport -sourceMeta').populate('subjectId', 'name code').populate('curriculumVersionId', 'code name status').populate('uploadedBy', 'fullName'));
  res.json(out);
});

/** Upload limits and remaining storage, for the upload form. */
documentsRouter.get('/upload-limits', requirePermission('documents:upload'), async (_req, res) => {
  const up = (await getSettings()).uploads;
  res.json({ maxMB: Math.min(up.maxUploadMb, config.UPLOAD_MAX_MB), quotaMB: config.GRIDFS_QUOTA_MB, leftMB: Math.max(0, Math.floor((await quotaLeft()) / 1048576)),
    formats: Object.fromEntries(Object.entries(S.MANUAL_FORMATS).filter(([k]) => up.formats.includes(k as S.ManualKind))), ocr: up.ocrEnabled });
});
/**
 * Bulk processing: queues many manuals through the normal processing jobs, paced for the embedding quota and the
 * monthly cost cap (services/ingest/bulk.ts). One run at a time; manuals already indexed are skipped.
 */
const bulkSchema = z.object({ documentIds: z.array(oid).min(1).max(3000), dailyEmbedRequests: z.number().int().min(1).max(1500).optional(),
  maxInFlight: z.number().int().min(1).max(3).optional(), maxTries: z.number().int().min(1).max(3).optional(), monthCostShare: z.number().min(0.1).max(1).optional(),
  throttleMs: z.number().int().min(0).max(2000).optional(), activeHoursUtc: z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(24)]).optional() }).strict();
documentsRouter.post('/bulk-process', requireAnyPermission('documents:upload', 'documents:map'), async (req, res) => {
  const b = bulkSchema.parse(req.body);
  if (await Job.exists({ type: 'ingest.bulk', status: { $in: ['queued', 'running'] } })) throw new AppError(409, 'BULK_ACTIVE', 'A bulk processing run is already active. Cancel it first.');
  const ids = [...new Set(b.documentIds)];
  const ok = await CurriculumDocument.find({ _id: { $in: ids }, archivedAt: null, duplicateOf: null, supersededBy: null }).select('_id').lean();
  if (ok.length !== ids.length) throw badRequest(`${ids.length - ok.length} of the manuals are missing, archived, superseded or identical copies`);
  const job = await startBulk({ ...b, documentIds: ids, createdBy: req.auth!.userId });
  audit(req, 'document.bulk_process', String(job._id), { count: ids.length, dailyEmbedRequests: b.dailyEmbedRequests, maxInFlight: b.maxInFlight }, { entityType: 'job' });
  res.status(202).json({ jobId: String(job._id), runId: (job.payload as any).runId, count: ids.length });
});
documentsRouter.get('/bulk-process', async (_req, res) => {
  const r = await latestBulk(); if (!r) return res.json({ run: null });
  const last: any = await Job.findOne({ type: 'ingest.bulk', 'payload.runId': r.runId }).sort({ createdAt: -1 }).lean();
  const st = await bulkState(last.payload);
  res.json({ run: { ...r, now: { total: last.payload.documentIds.length, indexed: st.indexed.length, inFlight: st.inFlight.length, pending: st.pending.length, failed: st.failed, skipped: st.skipped.length } } });
});
documentsRouter.post('/bulk-process/cancel', requireAnyPermission('documents:upload', 'documents:map'), async (req, res) => {
  const r = await cancelBulk(); audit(req, 'document.bulk_cancel', 'bulk', r, { entityType: 'job' }); res.json(r);
});
/** Duplicate pre-check: the browser hashes the file (SHA-256) before uploading; the server re-checks after the upload. */
documentsRouter.post('/check-duplicate', requirePermission('documents:upload'), async (req, res) => {
  const b = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body);
  const d = await findDuplicate(b.sha256);
  res.json({ duplicate: d ? { id: String(d._id), title: d.title, archived: !!d.archivedAt } : null });
});

documentsRouter.post('/upload', requirePermission('documents:upload'), async (req, res) => {
  const f = await receiveManual(req);
  let m: S.ManualMeta; let label: string | null | undefined;
  try { m = metaFromFields(f.fields); label = await checkRefs(m); } catch (e) { await discard(f); throw e; }
  const existing = await findDuplicate(f.sha256);
  if (existing && f.fields.allowDuplicate !== 'true') { await discard(f); throw new AppError(409, 'DUPLICATE_DOCUMENT', `This file was already added as "${existing.title}"`, { existingId: String(existing._id) }); }
  // A confirmed duplicate shares the original's stored bytes (no second copy in GridFS) and is not processed.
  let storage = f.stored;
  if (existing) { const orig = await CurriculumDocument.findById(existing._id).select('storage').lean(); await discard(f); storage = orig!.storage as any; }
  const _id = new mongoose.Types.ObjectId();
  const doc = await CurriculumDocument.create({ _id, versionGroupId: _id, versionNumber: 1, ...toDocFields(m, label), title: m.title ?? f.filename.replace(/\.[a-z]+$/i, ''), originalFilename: f.filename,
    mimeType: f.mimeType, fileKind: f.kind, sizeBytes: f.size, provenance: { checksum: f.sha256, publisher: m.publisher || undefined, sourceUrl: m.sourceUrl || undefined, retrievedAt: new Date(), uploadedVia: 'upload' },
    storage, duplicateOf: existing?._id, approvalStatus: 'unverified', mappingStatus: m.subjectId ? 'suggested' : 'unmapped', uploadedBy: req.auth!.userId });
  const job = existing ? null : await queueProcessing(String(doc._id), req.auth!.userId);
  audit(req, 'document.upload', String(doc._id), { checksum: f.sha256, size: f.size, kind: f.kind, duplicateOf: existing ? String(existing._id) : undefined }, { entityType: 'document' });
  res.status(201).json({ document: await CurriculumDocument.findById(doc._id).lean(), jobId: job ? String(job._id) : null });
});

documentsRouter.get('/jobs/:jobId', async (req, res) => {
  const j = await Job.findById(req.params.jobId).lean(); if (!j) throw notFound(); res.json({ job: j });
});

async function loadDoc(id: string) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Document not found');
  const d = await CurriculumDocument.findById(id); if (!d) throw notFound('Document not found'); return d;
}
/** Resources generated from a document (kept when a replacement version is uploaded). */
async function generatedFrom(ids: mongoose.Types.ObjectId[]) {
  const [lessons, resources, questions] = await Promise.all([
    Lesson.aggregate([{ $match: { sourceDocumentIds: { $in: ids } } }, { $unwind: '$sourceDocumentIds' }, { $match: { sourceDocumentIds: { $in: ids } } }, { $group: { _id: '$sourceDocumentIds', n: { $sum: 1 } } }]),
    LearningResource.aggregate([{ $match: { sourceDocumentId: { $in: ids } } }, { $group: { _id: '$sourceDocumentId', n: { $sum: 1 } } }]),
    Question.aggregate([{ $match: { sourceDocumentId: { $in: ids } } }, { $group: { _id: '$sourceDocumentId', n: { $sum: 1 } } }])]);
  const m = (rows: any[]) => new Map(rows.map((r) => [String(r._id), r.n as number]));
  const L = m(lessons), R = m(resources), Q = m(questions);
  return (id: unknown) => ({ lessons: L.get(String(id)) ?? 0, resources: R.get(String(id)) ?? 0, questions: Q.get(String(id)) ?? 0 });
}
documentsRouter.get('/:id', async (req, res) => {
  const d0 = await loadDoc(String(req.params.id));
  await d0.populate([{ path: 'subjectId', select: 'name code' }, { path: 'levelId', select: 'name kind' }, { path: 'programmeId', select: 'name' }, { path: 'duplicateOf', select: 'title' },
    { path: 'curriculumVersionId', select: 'code name status' }, { path: 'uploadedBy', select: 'fullName' }, { path: 'archivedBy', select: 'fullName' }, { path: 'approvedBy', select: 'fullName' }, { path: 'mappedBy', select: 'fullName' }]);
  const doc: any = d0.toObject();
  const group = doc.versionGroupId ?? doc._id;
  const [nodes, jobs, duplicates, chunkStats, versions, pageStats] = await Promise.all([
    CurriculumNode.find({ documentId: doc._id }).sort({ order: 1 }).limit(500).lean(),
    Job.find({ 'payload.documentId': String(doc._id) }).sort({ createdAt: -1 }).limit(10).lean(),
    CurriculumDocument.find({ duplicateOf: doc._id }).select('title provenance.sourceUrl').limit(50).lean(),
    Chunk.aggregate([{ $match: { documentId: doc._id } }, { $group: { _id: '$embeddingStatus', n: { $sum: 1 } } }]),
    CurriculumDocument.find({ $or: [{ versionGroupId: group }, { _id: group }] }).select('title versionNumber documentVersion createdAt processingStatus approvalStatus supersededBy supersededAt archivedAt uploadedBy sizeBytes')
      .populate('uploadedBy', 'fullName').sort({ versionNumber: -1 }).lean(),
    DocumentPage.aggregate([{ $match: { documentId: doc._id } }, { $group: { _id: '$method', n: { $sum: 1 }, figures: { $sum: '$figures' } } }])]);
  const gen = await generatedFrom(versions.map((v) => v._id as mongoose.Types.ObjectId));
  res.json({ document: doc, nodes, jobs, duplicates, chunkStats: Object.fromEntries(chunkStats.map((c) => [c._id, c.n])),
    pageStats: Object.fromEntries(pageStats.map((p) => [p._id, { pages: p.n, figures: p.figures }])),
    versions: versions.map((v) => ({ ...v, current: !v.supersededBy, generated: gen(v._id) })), generated: gen(doc._id),
    permissions: { edit: can(req, 'documents:map') && !doc.archivedAt, review: can(req, 'content:review'), upload: can(req, 'documents:upload'), archive: can(req, 'documents:map'),
      reprocess: (can(req, 'documents:upload') || can(req, 'documents:map')) && !doc.archivedAt && !doc.supersededBy && !doc.duplicateOf,
      replace: can(req, 'documents:upload') && !doc.archivedAt && !doc.supersededBy && !doc.duplicateOf, download: canDownload(req, doc), delete: can(req, 'platform:manage') && !doc.supersededBy } });
});

/** Page-level extraction index (method, characters, figures, OCR confidence) for every page or segment. */
documentsRouter.get('/:id/extraction', async (req, res) => {
  const d = await loadDoc(String(req.params.id));
  const pages = await DocumentPage.find({ documentId: d._id }).select('page method charCount figures ocrConfidence').sort({ page: 1 }).limit(5000).lean();
  res.json({ unit: d.pageUnit ?? 'page', ocrStatus: d.ocrStatus ?? null, processingStatus: d.processingStatus, report: d.processingReport ?? null, pages });
});
documentsRouter.get('/:id/pages', async (req, res) => {
  const from = Math.max(1, Number(req.query.from) || 1); const to = Math.min(from + 19, Number(req.query.to) || from + 4);
  res.json({ items: await DocumentPage.find({ documentId: req.params.id, page: { $gte: from, $lte: to } }).sort({ page: 1 }).lean() });
});
documentsRouter.get('/:id/chunks', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  res.json({ items: await Chunk.find({ documentId: req.params.id }).sort({ ordinal: 1 }).skip((page - 1) * 20).limit(20).lean(), total: await Chunk.countDocuments({ documentId: req.params.id }) });
});
/** The original file. Inline (preview) for every library user; ?download=1 needs licensing permission or Curriculum Admin. GridFS files are streamed. */
documentsRouter.get('/:id/file', async (req, res) => {
  const doc = await loadDoc(String(req.params.id)); const dl = req.query.download === '1';
  if (dl && !canDownload(req, doc)) throw new AppError(403, 'DOWNLOAD_NOT_PERMITTED', 'The licensing status of this document does not allow downloading. Use the preview instead.');
  const name = (doc.originalFilename ?? `document.${doc.fileKind ?? 'pdf'}`).replace(/["\r\n]/g, '');
  const kind = doc.fileKind ?? 'pdf';
  // Text formats are always served as plain text so a browser never renders them as HTML.
  const type = kind === 'pdf' ? 'application/pdf' : kind === 'docx' ? mimeFor('docx') : 'text/plain; charset=utf-8';
  res.set({ 'Content-Type': type, 'Content-Disposition': `${dl || kind === 'docx' ? 'attachment' : 'inline'}; filename="${name}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  if (dl) audit(req, 'document.download', String(doc._id), undefined, { entityType: 'document' });
  try {
    if (doc.storage?.provider === 'gridfs' && doc.storage.key) {
      const st = await gridfs.stat(doc.storage.key); if (!st) throw new StorageUnavailableError('The stored file is missing');
      res.set('Content-Length', String(st.length));
      const s = gridfs.downloadStream(doc.storage.key); s.on('error', () => res.destroy()); s.pipe(res); return;
    }
    res.send(await readObject(doc.storage ?? {}, doc.provenance?.sourceUrl, doc.provenance?.driveFileId));
  } catch (e) { if (e instanceof StorageUnavailableError) throw new AppError(503, 'STORAGE_UNAVAILABLE', e.message); throw e; }
});

const patchSchema = S.manualMetaSchema.extend({ mappingStatus: z.enum(['unmapped', 'suggested', 'confirmed']).optional(), approvalStatus: z.enum(S.APPROVAL_STATUSES).optional(),
  duplicateOf: oid.nullable().optional(),
  /** Reviewer fields: a note on how the decision was reached, and open review flags (e.g. needs_ocr, teacher_version). */
  approvalNote: z.string().trim().max(1000).optional(), reviewFlags: z.array(z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/)).max(10).optional() }).strict();
const REVIEW_KEYS = ['approvalStatus', 'approvalNote', 'reviewFlags'];
documentsRouter.patch('/:id', requireAnyPermission('documents:map', 'content:review'), async (req, res) => {
  // Permission is decided on the keys sent, before validation, so a denied caller learns nothing about the payload.
  const keys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
  if (keys.some((k) => REVIEW_KEYS.includes(k)) && !can(req, 'content:review')) throw forbidden('Only reviewers can change approval status');
  if (keys.some((k) => !REVIEW_KEYS.includes(k)) && !can(req, 'documents:map')) throw forbidden('Only curriculum editors can change metadata and mapping');
  const b = patchSchema.parse(req.body);
  const doc = await loadDoc(String(req.params.id));
  if (doc.archivedAt) throw conflict('Restore this document before editing it');
  const { mappingStatus, approvalStatus, duplicateOf, approvalNote, reviewFlags, ...meta } = b;
  const label = await checkRefs(meta);
  if (mappingStatus === 'confirmed' && !(meta.subjectId !== undefined ? meta.subjectId : doc.subjectId)) throw badRequest('Choose a subject before confirming the mapping');
  if (duplicateOf === String(doc._id)) throw badRequest('A document cannot duplicate itself');
  const before = { approvalStatus: doc.approvalStatus, mappingStatus: doc.mappingStatus, processingStatus: doc.processingStatus, reviewFlags: [...(doc.reviewFlags ?? [])] };
  doc.set({ ...toDocFields(meta, label), ...(mappingStatus ? { mappingStatus } : {}), ...(approvalStatus ? { approvalStatus } : {}), ...(duplicateOf !== undefined ? { duplicateOf } : {}),
    ...(approvalNote !== undefined ? { approvalNote: approvalNote || undefined } : {}), ...(reviewFlags !== undefined ? { reviewFlags: [...new Set(reviewFlags)] } : {}) });
  if (mappingStatus === 'confirmed') doc.mappedBy = req.auth!.userId as any;
  if (approvalStatus) doc.approvedBy = req.auth!.userId as any;
  await doc.save();
  if (meta.subjectId !== undefined) await Promise.all([Chunk.updateMany({ documentId: doc._id }, { subjectId: meta.subjectId }), CurriculumNode.updateMany({ documentId: doc._id }, { subjectId: meta.subjectId })]);
  if (meta.curriculumVersionId !== undefined) await CurriculumNode.updateMany({ documentId: doc._id }, meta.curriculumVersionId ? { curriculumVersionId: meta.curriculumVersionId } : { $unset: { curriculumVersionId: 1 } });
  // Approval never changes processing, and nothing here publishes content (spec §9: no auto-publish).
  audit(req, Object.keys(b).every((k) => REVIEW_KEYS.includes(k)) ? 'document.approval' : 'document.update', String(doc._id), b, { entityType: 'document', before, after: { approvalStatus: doc.approvalStatus, mappingStatus: doc.mappingStatus, processingStatus: doc.processingStatus, reviewFlags: doc.reviewFlags } });
  res.json({ document: doc });
});

documentsRouter.post('/:id/process', requireAnyPermission('documents:upload', 'documents:map'), async (req, res) => {
  const doc = await loadDoc(String(req.params.id));
  if (doc.archivedAt) throw conflict('Restore this document before processing it');
  if (doc.duplicateOf) throw conflict('Identical copies are not processed; process the original instead');
  if (doc.supersededBy) throw new AppError(409, 'SUPERSEDED', 'A newer version replaced this document. Earlier versions are kept as they are so resources generated from them keep their sources.');
  if (await Job.exists({ 'payload.documentId': String(doc._id), status: { $in: ['queued', 'running'] } })) throw new AppError(409, 'ALREADY_QUEUED', 'Processing is already queued');
  const job = await queueProcessing(String(doc._id), req.auth!.userId); audit(req, 'document.process', String(doc._id), undefined, { entityType: 'document' });
  res.status(202).json({ jobId: String(job._id) });
});

for (const op of ['archive', 'restore'] as const) documentsRouter.post(`/:id/${op}`, requirePermission('documents:map'), async (req, res) => {
  const b = z.object({ reason: z.string().trim().max(300).optional() }).strict().parse(req.body ?? {});
  const doc = await loadDoc(String(req.params.id));
  if (op === 'archive' && doc.archivedAt) throw conflict('Already archived'); if (op === 'restore' && !doc.archivedAt) throw conflict('Not archived');
  if (op === 'archive' && ACTIVE.includes(doc.processingStatus)) throw conflict('Wait for processing to finish before archiving');
  doc.archivedAt = op === 'archive' ? new Date() : undefined; doc.archivedBy = op === 'archive' ? (req.auth!.userId as any) : undefined; await doc.save();
  audit(req, `document.${op}`, String(doc._id), b.reason ? { reason: b.reason } : undefined, { entityType: 'document', before: { archived: op === 'restore' }, after: { archived: op === 'archive' } });
  res.json({ document: doc });
});

/** Replacement version: a new document in the same version group. The earlier version stays (read-only) with its chunks and links to generated resources. */
/**
 * Permanent delete (platform:manage). Refused while generated lessons, resources or questions cite it, while identical
 * duplicates point to it, while it is processing, or for a superseded version (history is kept; delete the newer one first).
 * Deleting a current replacement makes the version it superseded current again. The stored file is removed only when
 * no other record shares it.
 */
documentsRouter.delete('/:id', requirePermission('platform:manage'), async (req, res) => {
  const doc = await loadDoc(String(req.params.id));
  if (doc.supersededBy) throw conflict('This is an earlier version kept for history. Delete the newer version first.');
  if (RUNNING_STATES.includes(doc.processingStatus as string)) throw conflict('Wait for processing to finish');
  const g = (await generatedFrom([doc._id as mongoose.Types.ObjectId]))(doc._id); const dups = await CurriculumDocument.countDocuments({ duplicateOf: doc._id });
  const refs = [['lessons', g.lessons], ['learning resources', g.resources], ['questions', g.questions], ['duplicate records', dups]].filter(([, n]) => (n as number) > 0).map(([label, count]) => ({ label, count }));
  if (refs.length) throw new AppError(409, 'IN_USE', `Still referenced by ${refs.map((r) => `${r.count} ${r.label}`).join(', ')}. Archive it instead.`, { references: refs });
  // Its finished processing jobs go too, so the monitor never lists runs for a manual that no longer exists (delete is refused while processing).
  await Promise.all([DocumentPage.deleteMany({ documentId: doc._id }), Chunk.deleteMany({ documentId: doc._id }), CurriculumNode.deleteMany({ documentId: doc._id }),
    Job.deleteMany({ type: 'document.process', documentId: doc._id, status: { $nin: ['queued', 'running'] } })]);
  if (doc.supersedes) await CurriculumDocument.updateOne({ _id: doc.supersedes, supersededBy: doc._id }, { $unset: { supersededBy: 1, supersededAt: 1 } });
  await doc.deleteOne();
  if (doc.storage?.provider === 'gridfs' && doc.storage.key && !(await CurriculumDocument.exists({ 'storage.provider': 'gridfs', 'storage.key': doc.storage.key }))) await gridfs.delete(doc.storage.key).catch(() => {});
  audit(req, 'document.delete', String(doc._id), { title: doc.title, checksum: doc.provenance?.checksum }, { entityType: 'document', before: { title: doc.title, versionNumber: doc.versionNumber } });
  res.status(204).end();
});
const RUNNING_STATES = ['queued', 'extracting', 'ocr', 'structuring', 'chunking', 'embedding'];
documentsRouter.post('/:id/replace', requirePermission('documents:upload'), async (req, res) => {
  const prev = await loadDoc(String(req.params.id));
  const refuse = prev.archivedAt ? 'Restore this document before replacing it' : prev.supersededBy ? 'Only the current version can be replaced' : prev.duplicateOf ? 'Replace the original, not an identical copy' : ACTIVE.includes(prev.processingStatus) ? 'Wait for processing to finish before replacing' : null;
  if (refuse) { req.resume(); throw conflict(refuse); }
  const f = await receiveManual(req);
  let m: S.ManualMeta; let label: string | null | undefined;
  try { m = metaFromFields(f.fields); label = await checkRefs(m); } catch (e) { await discard(f); throw e; }
  if (f.sha256 === prev.provenance?.checksum) { await discard(f); throw new AppError(409, 'SAME_FILE', 'This is the same file as the current version'); }
  const other = await findDuplicate(f.sha256, prev._id);
  if (other) { await discard(f); throw new AppError(409, 'DUPLICATE_DOCUMENT', `This file was already added as "${other.title}"`, { existingId: String(other._id) }); }
  const group = prev.versionGroupId ?? prev._id;
  const top = await CurriculumDocument.findOne({ $or: [{ versionGroupId: group }, { _id: group }] }).sort({ versionNumber: -1 }).select('versionNumber').lean();
  const p: any = prev.toObject();
  const inherit = { subjectId: p.subjectId, levelId: p.levelId, programmeId: p.programmeId, yearOfStudy: p.yearOfStudy, curriculumVersionId: p.curriculumVersionId, curriculumVersion: p.curriculumVersion,
    docType: p.docType, audience: p.audience, language: p.language, publicationYear: p.publicationYear, licensingStatus: p.licensingStatus, tags: p.tags, title: p.title };
  const doc = await CurriculumDocument.create({ ...inherit, ...toDocFields(m, label), versionGroupId: group, versionNumber: (top?.versionNumber ?? 1) + 1, supersedes: prev._id,
    originalFilename: f.filename, mimeType: f.mimeType, fileKind: f.kind, sizeBytes: f.size,
    provenance: { checksum: f.sha256, publisher: m.publisher ?? p.provenance?.publisher, sourceUrl: m.sourceUrl ?? p.provenance?.sourceUrl, retrievedAt: new Date(), uploadedVia: 'upload' }, storage: f.stored,
    // A new file needs fresh review: approval resets and a confirmed mapping becomes a suggestion.
    approvalStatus: 'unverified', mappingStatus: p.mappingStatus === 'confirmed' ? 'suggested' : p.mappingStatus, uploadedBy: req.auth!.userId });
  prev.supersededBy = doc._id as any; prev.supersededAt = new Date(); await prev.save();
  const job = await queueProcessing(String(doc._id), req.auth!.userId);
  audit(req, 'document.replace', String(doc._id), { previousId: String(prev._id), versionNumber: doc.versionNumber, checksum: f.sha256 }, { entityType: 'document' });
  res.status(201).json({ document: await CurriculumDocument.findById(doc._id).lean(), previousId: String(prev._id), jobId: String(job._id) });
});

const nodeSchema = z.object({ type: z.enum(['section', 'strand', 'subStrand', 'contentStandard', 'indicator', 'topic']).optional(), title: z.string().trim().min(2).max(300).optional(),
  code: z.string().max(60).optional(), page: z.number().int().min(1).optional(), verified: z.boolean().optional(), parentId: oid.nullable().optional() }).strict();
documentsRouter.post('/:id/nodes', requirePermission('documents:map'), async (req, res) => {
  const b = nodeSchema.required({ type: true, title: true }).parse(req.body);
  const doc = await CurriculumDocument.findById(req.params.id).lean(); if (!doc) throw notFound();
  const n = await CurriculumNode.create({ ...b, documentId: doc._id, subjectId: doc.subjectId, order: 10_000, detection: { rule: 'manual', confidence: 'manual' }, verified: true, verifiedBy: req.auth!.userId });
  audit(req, 'node.create', String(n._id)); res.status(201).json({ node: n });
});
documentsRouter.patch('/:id/nodes/:nodeId', requirePermission('documents:map'), async (req, res) => {
  const b = nodeSchema.parse(req.body);
  const n = await CurriculumNode.findOneAndUpdate({ _id: req.params.nodeId, documentId: req.params.id }, { ...b, ...(b.verified ? { verifiedBy: req.auth!.userId } : {}) }, { returnDocument: 'after' });
  if (!n) throw notFound(); audit(req, 'node.update', String(n._id), b); res.json({ node: n });
});
documentsRouter.delete('/:id/nodes/:nodeId', requirePermission('documents:map'), async (req, res) => {
  const n = await CurriculumNode.findOneAndDelete({ _id: req.params.nodeId, documentId: req.params.id }); if (!n) throw notFound();
  await Chunk.updateMany({ documentId: req.params.id }, { $pull: { nodeIds: n._id } }); audit(req, 'node.delete', String(n._id)); res.status(204).end();
});
