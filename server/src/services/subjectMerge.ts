/**
 * Merging one subject into another (e.g. retiring "Integrated Science" in favour of "General Science", its new name).
 * Every reference is found from the Mongoose schemas (any path with ref: 'Subject', single or array), so models added
 * later are covered without a hand-kept list. References are re-pointed, never deleted; the source subject is then
 * archived and deactivated so it leaves every picker, the catalog and the landing page while history stays readable.
 */
import mongoose from 'mongoose';
import { Subject } from '../models/index.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';

type RefPath = { model: mongoose.Model<any>; path: string; array: boolean; unique: boolean };
export function subjectRefPaths(): RefPath[] {
  const out: RefPath[] = [];
  for (const model of Object.values(mongoose.models)) {
    const uniqueIdx = model.schema.indexes().filter(([, o]) => o?.unique).map(([f]) => Object.keys(f));
    model.schema.eachPath((path, t: any) => {
      const ref = t.options?.ref ?? t.caster?.options?.ref ?? t.options?.type?.[0]?.ref;
      if (ref !== 'Subject') return;
      out.push({ model, path, array: t.instance === 'Array', unique: uniqueIdx.some((f) => f.includes(path)) || !!t.options?.unique });
    });
  }
  return out;
}
export async function subjectReferenceCounts(id: unknown) {
  const _id = new mongoose.Types.ObjectId(String(id));
  const rows = await Promise.all(subjectRefPaths().map(async (r) => ({ collection: r.model.collection.name, path: r.path, count: await r.model.countDocuments({ [r.path]: _id }) })));
  return rows.filter((r) => r.count > 0);
}

/** dryRun returns what would move. Both subjects must be at the same level; the target must be active. */
export async function mergeSubject(sourceId: string, targetId: string, o: { dryRun?: boolean; userId?: string } = {}) {
  if (sourceId === targetId) throw badRequest('Choose a different subject to merge into');
  const [src, tgt] = await Promise.all([Subject.findById(sourceId), Subject.findById(targetId)]);
  if (!src || !tgt) throw notFound('Subject not found');
  if (String(src.levelId) !== String(tgt.levelId)) throw new AppError(422, 'LEVEL_MISMATCH', `${src.name} and ${tgt.name} are at different levels; nothing was changed`);
  if (tgt.archivedAt || tgt.active === false) throw conflict(`${tgt.name} is archived or inactive`);
  const before = await subjectReferenceCounts(src._id);
  if (o.dryRun) return { dryRun: true, source: { id: sourceId, name: src.name, code: src.code }, target: { id: targetId, name: tgt.name, code: tgt.code }, references: before, moved: [], kept: [] };
  const moved: { collection: string; path: string; count: number }[] = []; const kept: { collection: string; path: string; id: string; reason: string }[] = [];
  for (const r of subjectRefPaths()) {
    const col = r.model.collection.name; let n = 0;
    if (r.array) {
      // Already linked to both: drop the old one. Otherwise replace it in place.
      n += (await r.model.updateMany({ [r.path]: { $all: [src._id, tgt._id] } }, { $pull: { [r.path]: src._id } })).modifiedCount;
      n += (await r.model.updateMany({ [r.path]: src._id }, { $set: { [`${r.path}.$`]: tgt._id } })).modifiedCount;
    } else if (!r.unique) {
      n += (await r.model.updateMany({ [r.path]: src._id }, { $set: { [r.path]: tgt._id } })).modifiedCount;
    } else {
      // A unique index includes the subject: move one by one and keep (not delete) any record that would collide.
      for (const d of await r.model.find({ [r.path]: src._id }).select('_id').lean()) {
        try { n += (await r.model.updateOne({ _id: d._id }, { $set: { [r.path]: tgt._id } })).modifiedCount; }
        catch (e: any) { if (e?.code === 11000) kept.push({ collection: col, path: r.path, id: String(d._id), reason: `a matching record already exists for ${tgt.name}` }); else throw e; }
      }
    }
    if (n) moved.push({ collection: col, path: r.path, count: n });
  }
  src.archivedAt = new Date(); src.archivedBy = o.userId as any; src.active = false;
  src.set('provenance.aliases', [...new Set([...(src.provenance?.aliases ?? []), `merged into ${tgt.code}`])]);
  await src.save();
  await Subject.updateOne({ _id: tgt._id }, { $addToSet: { 'provenance.aliases': src.name } });
  return { dryRun: false, source: { id: sourceId, name: src.name, code: src.code }, target: { id: targetId, name: tgt.name, code: tgt.code }, references: before, moved, kept, remaining: await subjectReferenceCounts(src._id) };
}
