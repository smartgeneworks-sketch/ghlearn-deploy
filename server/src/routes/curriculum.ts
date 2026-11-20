import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import * as S from '@ghlearn/shared';
import { CurriculumNode, CurriculumDocument, CurriculumVersion, Chunk, Lesson, Subject } from '../models/index.js';
import { listQuery, paginate, searchFilter, escapeRx } from '../lib/list.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middleware/index.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { referencesOf, refError } from '../services/references.js';
import { importBody, importStructure } from '../services/curriculumImport.js';

/**
 * Curriculum elements (spec §8): strands, sub-strands, content standards, indicators and topics detected in documents
 * (CurriculumNode). Edit, verify, reorder among siblings, archive/restore (with descendants) and reference-safe delete.
 * Curriculum versions are records with a lifecycle (draft, active, archived) that subjects, documents and elements link to.
 */
export const curriculumRouter = Router();
const curriculumStaff = requireAnyPermission('documents:map', 'curriculum:manage');
// The version list is also readable by uploaders and reviewers so they can pick a version for a manual.
const versionPickers = requireAnyPermission('documents:map', 'curriculum:manage', 'documents:upload', 'content:review');
curriculumRouter.use(authenticate, (req, res, next) => (req.method === 'GET' && /^\/versions\/?$/.test(req.path) ? versionPickers : curriculumStaff)(req, res, next));
const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
export const NODE_TYPES = ['section', 'strand', 'subStrand', 'contentStandard', 'learningOutcome', 'indicator', 'topic'] as const;

/** Curriculum LMS Phase 2: import a parsed curriculum (dry run by default = preview with issues). Audited when applied. */
curriculumRouter.post('/import-structure', requirePermission('documents:map'), async (req, res) => {
  const b = importBody.parse(req.body);
  const r = await importStructure(b, req.auth!.userId);
  if (!b.dryRun) audit(req, 'curriculum.import_structure', b.documentId, { parser: b.parser, ...r.summary, issues: r.issues.length }, { entityType: 'curriculum_document' });
  res.json(r);
});
curriculumRouter.get('/documents', async (req, res) => {
  const q = z.object({ subjectId: oid.optional(), curriculumVersionId: oid.optional() }).refine((x) => x.subjectId || x.curriculumVersionId, 'Choose a subject or a curriculum version').parse(req.query);
  const m: any = {}; if (q.subjectId) m.subjectId = new mongoose.Types.ObjectId(q.subjectId); if (q.curriculumVersionId) m.curriculumVersionId = new mongoose.Types.ObjectId(q.curriculumVersionId);
  const counts = await CurriculumNode.aggregate([{ $match: m }, { $group: { _id: '$documentId', n: { $sum: 1 } } }]);
  const docs = await CurriculumDocument.find({ _id: { $in: counts.map((c) => c._id) } }).select('title curriculumVersion versionNumber supersededBy').sort({ title: 1 }).lean();
  const by = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json({ items: docs.map((d) => ({ ...d, nodes: by.get(String(d._id)) ?? 0 })) });
});
/** All elements of one document in tree order (parents before children, siblings by order). */
curriculumRouter.get('/nodes', async (req, res) => {
  const q = z.object({ documentId: oid, archived: z.enum(['include', 'only']).optional(), type: z.enum(NODE_TYPES).optional() }).parse(req.query);
  const all = await CurriculumNode.find({ documentId: q.documentId }).select('type code title page order parentId verified archivedAt detection.confidence').sort({ order: 1, page: 1, _id: 1 }).limit(5000).lean();
  const used = new Map((await Lesson.aggregate([{ $match: { nodeId: { $in: all.map((n) => n._id) } } }, { $group: { _id: '$nodeId', n: { $sum: 1 } } }])).map((r) => [String(r._id), r.n]));
  const kids = new Map<string, any[]>(); for (const n of all) { const k = String(n.parentId ?? ''); kids.set(k, [...(kids.get(k) ?? []), n]); }
  const ids = new Set(all.map((n) => String(n._id))); const out: any[] = [];
  const walk = (pid: string, depth: number) => { for (const n of kids.get(pid) ?? []) { out.push({ ...n, depth, lessons: used.get(String(n._id)) ?? 0, children: (kids.get(String(n._id)) ?? []).length }); walk(String(n._id), depth + 1); } };
  walk('', 0); for (const n of all) if (n.parentId && !ids.has(String(n.parentId)) && !out.some((o) => String(o._id) === String(n._id))) out.push({ ...n, depth: 0, orphan: true, lessons: used.get(String(n._id)) ?? 0 });
  const items = out.filter((n) => (q.archived === 'only' ? n.archivedAt : q.archived === 'include' ? true : !n.archivedAt) && (!q.type || n.type === q.type));
  res.json({ items, total: items.length });
});
const patchB = z.object({ title: z.string().trim().min(2).max(300).optional(), code: z.string().trim().max(60).optional(), type: z.enum(NODE_TYPES).optional(), verified: z.boolean().optional() }).strict();
curriculumRouter.patch('/nodes/:id', async (req, res) => {
  const b = patchB.parse(req.body);
  const n = await CurriculumNode.findById(oid.parse(req.params.id)); if (!n) throw notFound('Element not found');
  if (n.archivedAt) throw conflict('Restore this element before editing it');
  const before = n.toObject(); n.set({ ...b, ...(b.verified ? { verifiedBy: req.auth!.userId } : {}) }); await n.save();
  audit(req, 'node.update', String(n._id), undefined, { entityType: 'curriculum_node', ...diff(before as any, n.toObject() as any, Object.keys(b)) }); res.json({ node: n });
});
curriculumRouter.post('/nodes/reorder', async (req, res) => {
  const b = z.object({ ids: z.array(oid).min(1).max(500) }).strict().parse(req.body);
  const ns = await CurriculumNode.find({ _id: { $in: b.ids } }).select('documentId parentId').lean();
  if (ns.length !== new Set(b.ids).size) throw notFound('One or more elements were not found');
  if (new Set(ns.map((n) => `${n.documentId}:${n.parentId ?? ''}`)).size !== 1) throw new AppError(422, 'VALIDATION', 'Only siblings (same document and parent) can be reordered together');
  await CurriculumNode.bulkWrite(b.ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: (i + 1) * 10 } } } })));
  audit(req, 'node.reorder', String(ns[0].documentId), { count: b.ids.length }, { entityType: 'curriculum_node' }); res.json({ ok: true });
});
async function descendants(id: mongoose.Types.ObjectId) {
  const out: mongoose.Types.ObjectId[] = []; let frontier = [id];
  while (frontier.length && out.length < 5000) { const next = await CurriculumNode.find({ parentId: { $in: frontier } }).distinct('_id'); out.push(...next); frontier = next; }
  return out;
}
for (const op of ['archive', 'restore'] as const) curriculumRouter.post(`/nodes/:id/${op}`, async (req, res) => {
  const n = await CurriculumNode.findById(oid.parse(req.params.id)); if (!n) throw notFound('Element not found');
  if (op === 'archive' && n.archivedAt) throw conflict('Already archived'); if (op === 'restore' && !n.archivedAt) throw conflict('Not archived');
  if (op === 'restore' && n.parentId && (await CurriculumNode.exists({ _id: n.parentId, archivedAt: { $ne: null } }))) throw conflict('Restore the parent element first');
  const ids = [n._id, ...(await descendants(n._id))];
  await CurriculumNode.updateMany({ _id: { $in: ids } }, op === 'archive' ? { $set: { archivedAt: new Date() } } : { $unset: { archivedAt: 1 } });
  audit(req, `node.${op}`, String(n._id), { affected: ids.length }, { entityType: 'curriculum_node' }); res.json({ affected: ids.length });
});
curriculumRouter.delete('/nodes/:id', async (req, res) => {
  const n = await CurriculumNode.findById(oid.parse(req.params.id)); if (!n) throw notFound('Element not found');
  const refs = await referencesOf('nodes', n._id); if (refs.length) throw refError(refs);
  await n.deleteOne(); await Chunk.updateMany({ documentId: n.documentId }, { $pull: { nodeIds: n._id } });
  audit(req, 'node.delete', String(n._id), undefined, { entityType: 'curriculum_node', before: { title: n.title, type: n.type, documentId: String(n.documentId) } }); res.status(204).end();
});

// ---- Curriculum versions (Curriculum Management): draft -> active -> archived ----
const vListQ = listQuery(['code', 'name', 'status', 'createdAt'] as const, { defaultSort: 'code', maxPageSize: 200 }).extend({ status: z.enum(S.CURRICULUM_VERSION_STATUSES).optional(), levelId: oid.optional() });
async function versionCounts(ids: unknown[]) {
  const agg = (m: any) => m.aggregate([{ $match: { curriculumVersionId: { $in: ids } } }, { $group: { _id: '$curriculumVersionId', n: { $sum: 1 } } }]);
  const [s, d, n] = await Promise.all([agg(Subject), agg(CurriculumDocument), agg(CurriculumNode)]);
  const m = (rows: any[]) => new Map(rows.map((r) => [String(r._id), r.n as number]));
  const S1 = m(s), D = m(d), N = m(n);
  return (id: unknown) => ({ subjects: S1.get(String(id)) ?? 0, documents: D.get(String(id)) ?? 0, elements: N.get(String(id)) ?? 0 });
}
curriculumRouter.get('/versions', async (req, res) => {
  const p = vListQ.parse(req.query); const f: any = { ...searchFilter(p.q, ['code', 'name', 'publisher']) }; if (p.status) f.status = p.status; if (p.levelId) f.levelId = p.levelId;
  const out = await paginate<any>(CurriculumVersion, f, p, (q) => q.populate('levelId', 'name kind'));
  const c = await versionCounts(out.items.map((v) => v._id));
  res.json({ ...out, items: out.items.map((v) => ({ ...v, counts: c(v._id) })) });
});
async function loadVersion(id: string) { if (!mongoose.isValidObjectId(id)) throw notFound('Curriculum version not found'); const v = await CurriculumVersion.findById(id); if (!v) throw notFound('Curriculum version not found'); return v; }
const vDates = (b: { effectiveFrom?: string | null; effectiveTo?: string | null }, cur?: any) => {
  const from = b.effectiveFrom !== undefined ? b.effectiveFrom : cur?.effectiveFrom?.toISOString?.().slice(0, 10); const to = b.effectiveTo !== undefined ? b.effectiveTo : cur?.effectiveTo?.toISOString?.().slice(0, 10);
  if (from && to && to < from) throw new AppError(422, 'VALIDATION', 'The end date must be after the start date');
};
curriculumRouter.get('/versions/:id', async (req, res) => {
  const v = await loadVersion(String(req.params.id)); await v.populate([{ path: 'levelId', select: 'name kind' }, { path: 'activatedBy', select: 'fullName' }, { path: 'archivedBy', select: 'fullName' }, { path: 'createdBy', select: 'fullName' }]);
  const [subjects, docsByStatus, nodesByType, documents] = await Promise.all([
    Subject.find({ curriculumVersionId: v._id }).select('name code levelId active archivedAt').sort({ name: 1 }).lean(),
    CurriculumDocument.aggregate([{ $match: { curriculumVersionId: v._id } }, { $group: { _id: '$processingStatus', n: { $sum: 1 } } }]),
    CurriculumNode.aggregate([{ $match: { curriculumVersionId: v._id, archivedAt: null } }, { $group: { _id: '$type', n: { $sum: 1 }, verified: { $sum: { $cond: ['$verified', 1, 0] } } } }]),
    CurriculumDocument.find({ curriculumVersionId: v._id, supersededBy: null }).select('title processingStatus approvalStatus subjectId archivedAt').populate('subjectId', 'name').sort({ title: 1 }).limit(50).lean()]);
  res.json({ version: v, subjects, documents, counts: (await versionCounts([v._id]))(v._id),
    documentsByStatus: Object.fromEntries(docsByStatus.map((r) => [r._id, r.n])), elementsByType: Object.fromEntries(nodesByType.map((r) => [r._id, { total: r.n, verified: r.verified }])) });
});
curriculumRouter.post('/versions', requirePermission('curriculum:manage'), async (req, res) => {
  const b = S.curriculumVersionSchema.parse(req.body); vDates(b);
  if (await CurriculumVersion.exists({ code: new RegExp(`^${escapeRx(b.code)}$`, 'i') })) throw conflict('A curriculum version with this code already exists');
  const v = await CurriculumVersion.create({ ...b, status: 'draft', createdBy: req.auth!.userId });
  audit(req, 'curriculum_version.create', String(v._id), undefined, { entityType: 'curriculum_version', after: v.toObject() }); res.status(201).json({ version: v });
});
curriculumRouter.patch('/versions/:id', requirePermission('curriculum:manage'), async (req, res) => {
  const v = await loadVersion(String(req.params.id)); if (v.status === 'archived') throw conflict('Restore this version before editing it');
  const b = S.curriculumVersionSchema.partial().parse(req.body); vDates(b, v);
  if (b.code && b.code !== v.code && (await CurriculumVersion.exists({ _id: { $ne: v._id }, code: new RegExp(`^${escapeRx(b.code)}$`, 'i') }))) throw conflict('A curriculum version with this code already exists');
  const before = v.toObject(); v.set(b); await v.save();
  // The code is mirrored into the older free-text label on linked subjects and documents.
  if (b.code && b.code !== before.code) await Promise.all([Subject.updateMany({ curriculumVersionId: v._id }, { curriculumVersion: b.code }), CurriculumDocument.updateMany({ curriculumVersionId: v._id }, { curriculumVersion: b.code })]);
  audit(req, 'curriculum_version.update', String(v._id), undefined, { entityType: 'curriculum_version', ...diff(before as any, v.toObject() as any, Object.keys(b)) }); res.json({ version: v });
});
const TRANSITIONS: Record<string, { from: string[]; to: S.CurriculumVersionStatus }> = { activate: { from: ['draft'], to: 'active' }, archive: { from: ['draft', 'active'], to: 'archived' }, restore: { from: ['archived'], to: 'draft' } };
for (const op of Object.keys(TRANSITIONS)) curriculumRouter.post(`/versions/:id/${op}`, requirePermission('curriculum:manage'), async (req, res) => {
  const v = await loadVersion(String(req.params.id)); const t = TRANSITIONS[op];
  if (!t.from.includes(v.status)) throw conflict(`A ${v.status} version cannot be ${op === 'activate' ? 'activated' : op + 'd'}`);
  if (op === 'archive') {
    // Subjects still taught under this version must move to another version first (relationships stay valid).
    const n = await Subject.countDocuments({ curriculumVersionId: v._id, archivedAt: null, active: { $ne: false } });
    if (n) throw new AppError(409, 'IN_USE', `${n} active subject(s) still use this version. Link them to another version first.`, { references: [{ label: 'active subjects', count: n }] });
  }
  const before = v.status; v.status = t.to;
  if (op === 'activate') { v.activatedAt = new Date(); v.activatedBy = req.auth!.userId as any; }
  if (op === 'archive') { v.archivedAt = new Date(); v.archivedBy = req.auth!.userId as any; } else if (op === 'restore') { v.archivedAt = undefined; v.archivedBy = undefined; }
  await v.save(); audit(req, `curriculum_version.${op}`, String(v._id), undefined, { entityType: 'curriculum_version', before: { status: before }, after: { status: v.status } }); res.json({ version: v });
});
/** Links subjects to this version (replacing their previous version link). */
curriculumRouter.post('/versions/:id/subjects', requirePermission('curriculum:manage'), async (req, res) => {
  const v = await loadVersion(String(req.params.id)); if (v.status === 'archived') throw conflict('Archived versions cannot take new subjects');
  const b = z.object({ subjectIds: z.array(oid).min(1).max(200) }).strict().parse(req.body);
  if ((await Subject.countDocuments({ _id: { $in: b.subjectIds } })) !== new Set(b.subjectIds).size) throw notFound('One or more subjects were not found');
  const r = await Subject.updateMany({ _id: { $in: b.subjectIds } }, { curriculumVersionId: v._id, curriculumVersion: v.code });
  audit(req, 'curriculum_version.link_subjects', String(v._id), { subjects: r.modifiedCount }, { entityType: 'curriculum_version', after: { subjectIds: b.subjectIds } }); res.json({ linked: r.modifiedCount });
});
curriculumRouter.delete('/versions/:id', requirePermission('curriculum:manage'), async (req, res) => {
  const v = await loadVersion(String(req.params.id)); if (v.status !== 'draft') throw conflict('Only draft versions can be deleted; archive it instead');
  const refs = await referencesOf('versions', v._id); if (refs.length) throw refError(refs);
  await v.deleteOne(); audit(req, 'curriculum_version.delete', String(v._id), undefined, { entityType: 'curriculum_version', before: { code: v.code } }); res.status(204).end();
});
