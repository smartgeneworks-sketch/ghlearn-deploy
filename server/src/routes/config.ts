import { Router, type RequestHandler } from 'express';
import type { Model } from 'mongoose';
import { z, type ZodObject } from 'zod';
import * as S from '@ghlearn/shared';
import { mergeSubject } from '../services/subjectMerge.js';
import { School, AcademicLevel, Programme, Subject, SubjectCombination, AcademicYear, CurriculumVersion } from '../models/index.js';
import { authenticate, requirePermission, isSuper } from '../middleware/index.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { referencesOf, refError } from '../services/references.js';
import { invalidateSchoolStatus } from '../services/schools.js';
import { parsePatch } from '../lib/patch.js';

export const configRouter = Router();
configRouter.use(authenticate);
const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const checkDates = (path: string, v: any) => { if (path === 'academic-years' && v.startDate && v.endDate && new Date(v.endDate) <= new Date(v.startDate)) throw new AppError(422, 'VALIDATION', 'The end date must be after the start date'); };
const archivedQ = z.object({ archived: z.enum(['include', 'only']).optional() }).loose();

/**
 * Generic academic-structure CRUD (spec §8). Reads: any authenticated user (onboarding needs them); archived rows are
 * hidden unless ?archived=include|only. Writes: the given permission. Reorder, archive/restore, and delete that is
 * refused (409 IN_USE with the references) while anything still uses the record.
 */
function crud(path: string, model: Model<any>, schema: ZodObject<any>, writePerm: S.Permission, filterKeys: string[] = [], o: { listFilter?: (req: any) => Record<string, unknown>; project?: (req: any) => string | undefined; lifecycle?: boolean; prepare?: (body: any) => Promise<void> } = {}) {
  const lifecycle = o.lifecycle !== false;
  configRouter.get(`/${path}`, async (req, res) => {
    const q: Record<string, unknown> = { ...(o.listFilter?.(req) ?? {}) };
    for (const k of filterKeys) if (typeof req.query[k] === 'string') q[k] = req.query[k];
    if (lifecycle) { const a = archivedQ.parse(req.query).archived; if (a === 'only') q.archivedAt = { $ne: null }; else if (a !== 'include') q.archivedAt = null; }
    const proj = o.project?.(req);
    res.json({ items: await model.find(q).select(proj ?? '').sort({ order: 1, name: 1, label: 1 }).lean() });
  });
  configRouter.post(`/${path}`, requirePermission(writePerm), async (req, res) => {
    const body = schema.parse(req.body); checkDates(path, body); await o.prepare?.(body);
    if (path === 'academic-years' && body.current) await AcademicYear.updateMany({ current: true }, { current: false });
    const doc = await model.create(body); audit(req, `${path}.create`, String(doc._id), undefined, { entityType: path, after: doc.toObject() }); res.status(201).json(doc);
  });
  configRouter.post(`/${path}/reorder`, requirePermission(writePerm), async (req, res) => {
    const b = z.object({ ids: z.array(oid).min(1).max(500) }).strict().parse(req.body);
    if ((await model.countDocuments({ _id: { $in: b.ids } })) !== new Set(b.ids).size) throw notFound('One or more records were not found');
    await model.bulkWrite(b.ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: (i + 1) * 10 } } } })));
    audit(req, `${path}.reorder`, undefined, { count: b.ids.length }, { entityType: path, after: { ids: b.ids } }); res.json({ ok: true });
  });
  configRouter.patch(`/${path}/:id`, requirePermission(writePerm), async (req, res) => {
    const body = parsePatch(schema, req.body); await o.prepare?.(body);
    const before = await model.findById(req.params.id).lean(); if (!before) throw notFound(); checkDates(path, { ...before, ...body });
    if ((before as any).archivedAt) throw conflict('Restore this record before editing it');
    if (path === 'academic-years' && body.current) await AcademicYear.updateMany({ current: true, _id: { $ne: req.params.id } }, { current: false });
    const doc = await model.findByIdAndUpdate(req.params.id, body, { returnDocument: 'after', runValidators: true }); if (!doc) throw notFound();
    audit(req, `${path}.update`, String(doc._id), undefined, { entityType: path, ...diff(before as any, doc.toObject(), Object.keys(body)) }); res.json(doc);
  });
  if (lifecycle) for (const op of ['archive', 'restore'] as const) configRouter.post(`/${path}/:id/${op}`, requirePermission(writePerm), async (req, res) => {
    const doc = await model.findById(oid.parse(req.params.id)); if (!doc) throw notFound();
    if (op === 'archive' && doc.archivedAt) throw conflict('Already archived'); if (op === 'restore' && !doc.archivedAt) throw conflict('Not archived');
    if (op === 'archive' && path === 'academic-years' && doc.current) throw conflict('Make another academic year current before archiving this one');
    doc.archivedAt = op === 'archive' ? new Date() : undefined; doc.archivedBy = op === 'archive' ? req.auth!.userId : undefined; await doc.save();
    audit(req, `${path}.${op}`, String(doc._id), undefined, { entityType: path, before: { archived: op === 'restore' }, after: { archived: op === 'archive' } }); res.json(doc);
  });
  configRouter.delete(`/${path}/:id`, requirePermission('platform:manage'), async (req, res) => {
    const doc = await model.findById(oid.parse(req.params.id)); if (!doc) throw notFound();
    if (path === 'academic-years' && doc.current) throw conflict('The current academic year cannot be deleted');
    const refs = await referencesOf(path, doc._id); if (refs.length) throw refError(refs);
    await doc.deleteOne(); audit(req, `${path}.delete`, String(doc._id), undefined, { entityType: path, before: doc.toObject() }); res.status(204).end();
  });
  configRouter.get(`/${path}/:id/references`, requirePermission(writePerm), async (req, res) => {
    if (!(await model.exists({ _id: oid.parse(req.params.id) }))) throw notFound();
    res.json({ references: await referencesOf(path, req.params.id) });
  });
}

// Schools: super admin creates; a school admin may only update limited fields of their own school. Status changes use
// POST /api/admin/schools/:id/status. Non-admins only see public identity fields.
const ownSchool: RequestHandler = (req, _res, next) => {
  if (isSuper(req)) return next();
  if (req.auth?.schoolId !== req.params.id) return next(forbidden('Not your school'));
  const bad = Object.keys(req.body ?? {}).filter((k) => !(S.SCHOOL_ADMIN_EDITABLE as readonly string[]).includes(k));
  return bad.length ? next(forbidden(`Only a super admin can change: ${bad.join(', ')}`)) : next();
};
const schoolActive: RequestHandler = (req, _res, next) => {
  if (typeof req.body?.active === 'boolean') req.body.status = req.body.active ? 'active' : 'suspended';
  else if (typeof req.body?.status === 'string') req.body.active = req.body.status === 'active';
  if (req.params.id) invalidateSchoolStatus(String(req.params.id));
  next();
};
configRouter.patch('/schools/:id', requirePermission('school:manage'), ownSchool, schoolActive);
configRouter.post('/schools', requirePermission('school:create'), schoolActive);
// Reordering touches every school's record: platform only (found by the §23 route matrix; school admins manage their own school).
configRouter.post('/schools/reorder', requirePermission('platform:manage'));
crud('schools', School, S.schoolSchema.extend({ status: z.enum(S.SCHOOL_STATUSES).optional() }), 'school:manage', [], {
  lifecycle: false, listFilter: (req) => (req.query.status === 'archived' ? { status: 'archived' } : { status: { $ne: 'archived' } }),
  project: (req) => (S.hasPermission(req.auth.roles, 'admin:access') ? undefined : 'name code region district levelKinds status'),
});
/**
 * Merge a subject into another at the same level (Super Admin): every reference moves to the target, the source is
 * archived and deactivated (not deleted). ?dryRun=1 (or body.dryRun) only reports what would move.
 */
configRouter.post('/subjects/:id/merge', requirePermission('platform:manage'), async (req, res) => {
  const b = z.object({ targetId: oid, dryRun: z.boolean().optional() }).strict().parse(req.body ?? {});
  const r = await mergeSubject(oid.parse(req.params.id), b.targetId, { dryRun: b.dryRun || req.query.dryRun === '1', userId: req.auth!.userId });
  if (!r.dryRun) audit(req, 'subjects.merge', String(req.params.id), { targetId: b.targetId, moved: r.moved, kept: r.kept }, { entityType: 'subjects', before: { archived: false, references: r.references }, after: { archived: true, mergedInto: b.targetId } });
  res.json(r);
});
configRouter.post('/subjects/:id/verify', requirePermission('curriculum:manage'), async (req, res) => {
  const s = await Subject.findByIdAndUpdate(req.params.id, { 'provenance.verified': true, 'provenance.categoryInferred': false }, { returnDocument: 'after' });
  if (!s) throw notFound(); audit(req, 'subjects.verify', String(s._id)); res.json(s);
});
crud('levels', AcademicLevel, S.levelSchema, 'curriculum:manage', ['kind']);
crud('academic-years', AcademicYear, S.academicYearSchema, 'curriculum:manage');
crud('programmes', Programme, S.programmeSchema, 'curriculum:manage', ['levelId']);
/** Linking a subject to a curriculum version mirrors the version code into the older free-text label. */
async function subjectVersion(body: any) {
  if (!('curriculumVersionId' in body)) return;
  if (!body.curriculumVersionId) { body.curriculumVersionId = null; body.curriculumVersion = ''; return; }
  const v = await CurriculumVersion.findById(body.curriculumVersionId).select('code status').lean();
  if (!v) throw new AppError(422, 'VALIDATION', 'Unknown curriculum version'); if (v.status === 'archived') throw conflict('That curriculum version is archived');
  body.curriculumVersion = v.code;
}
crud('subjects', Subject, S.subjectSchema, 'curriculum:manage', ['levelId', 'category', 'curriculumVersionId'], { prepare: subjectVersion });
// Platform combinations only (schoolId null); school-specific ones live under /api/admin/schools/:id/combinations.
crud('combinations', SubjectCombination, S.combinationSchema.omit({ schoolId: true }), 'curriculum:manage', ['programmeId'], { listFilter: () => ({ schoolId: null }) });
export { AppError };
