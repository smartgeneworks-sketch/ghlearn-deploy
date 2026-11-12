import { School, Subject, CurriculumDocument, CurriculumNode, CurriculumVersion, Job, Chunk } from '../models/index.js';
import { logger } from '../lib/logger.js';
/** Idempotent data migrations run at start-up (each one only touches documents that still need it). */
export async function migrate() {
  // Phase 4: School.status replaces the boolean `active` flag.
  await School.updateMany({ status: { $exists: false }, active: false }, { $set: { status: 'suspended' } });
  await School.updateMany({ status: { $exists: false } }, { $set: { status: 'active', active: true } });
  await migrateCurriculumVersions();
  // Phase 5: manuals get a version group (their own id) and a file kind; existing files are PDFs.
  await CurriculumDocument.collection.updateMany({ versionGroupId: { $exists: false } }, [{ $set: { versionGroupId: '$_id' } }]);
  await CurriculumDocument.updateMany({ fileKind: { $exists: false } }, { $set: { fileKind: 'pdf' } });
  await migrateProcessingMonitor();
  await unflagRealSubjects();
}
/**
 * The real curriculum catalogue was merged into the seeded subject records, so those subjects still said isSample and learners saw a
 * SAMPLE DATA badge. A subject that has real (non-sample) curriculum documents is a real subject. Sample lessons keep their own flag.
 */
export async function unflagRealSubjects() {
  const ids = await CurriculumDocument.distinct('subjectId', { isSample: { $ne: true }, subjectId: { $ne: null } });
  const r = await Subject.updateMany({ _id: { $in: ids }, isSample: true }, { $unset: { isSample: 1 } });
  if (r.modifiedCount) logger.info({ subjects: r.modifiedCount }, 'subjects with real curriculum documents are no longer marked as sample');
  return r.modifiedCount;
}
/**
 * Phase 6: jobs carry their document id as a field (for monitor filters), and passages are unique per (document, ordinal).
 * Any legacy duplicates are removed (keeping the oldest copy) before the unique index is built.
 */
export async function migrateProcessingMonitor() {
  await Job.collection.updateMany({ type: 'document.process', documentId: { $exists: false }, 'payload.documentId': { $type: 'string', $regex: /^[a-f0-9]{24}$/ } },
    [{ $set: { documentId: { $toObjectId: '$payload.documentId' } } }]);
  if (await Chunk.collection.indexExists('documentId_1_ordinal_1').catch(() => false)) return { removed: 0 };
  let removed = 0;
  const dups = Chunk.collection.aggregate<{ ids: any[] }>([{ $group: { _id: { d: '$documentId', o: '$ordinal' }, ids: { $push: '$_id' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }], { allowDiskUse: true });
  for await (const g of dups) { const extra = g.ids.sort((a, b) => String(a).localeCompare(String(b))).slice(1); removed += (await Chunk.collection.deleteMany({ _id: { $in: extra } })).deletedCount; }
  if (removed) logger.warn({ removed }, 'removed duplicate passages before building the unique index');
  await Chunk.syncIndexes();
  return { removed };
}
/**
 * Phase 5: every free-text curriculum version label on a subject becomes a CurriculumVersion record (active, since it
 * is already in use) and is linked. Documents link when their label names one of those versions. Imported documents
 * carry the source site's edition label instead ("Learner Version", "Teacher Version"); that is not a curriculum
 * version, so it moves to `documentVersion` (the original stays in sourceMeta) instead of creating a bogus version.
 */
export async function migrateCurriculumVersions() {
  const labels = new Set<string>((await Subject.distinct('curriculumVersion', { curriculumVersionId: null }))
    .filter((l): l is string => typeof l === 'string' && l.trim().length > 0).map((l) => l.trim()));
  for (const code of labels) {
    const v = (await CurriculumVersion.findOne({ code }).lean()) ?? (await CurriculumVersion.create({ code, name: code, status: 'active', activatedAt: new Date(), description: 'Created from an existing version label.' })).toObject();
    await Subject.updateMany({ curriculumVersion: code, curriculumVersionId: null }, { curriculumVersionId: v._id });
  }
  for (const label of await CurriculumDocument.distinct('curriculumVersion', { curriculumVersionId: null })) {
    if (typeof label !== 'string' || !label.trim()) continue;
    const v = await CurriculumVersion.findOne({ code: label.trim() }).lean();
    if (v) {
      const docs = await CurriculumDocument.find({ curriculumVersion: label, curriculumVersionId: null }).distinct('_id');
      await CurriculumDocument.updateMany({ _id: { $in: docs } }, { curriculumVersionId: v._id }); await CurriculumNode.updateMany({ documentId: { $in: docs } }, { curriculumVersionId: v._id });
    } else {
      await CurriculumDocument.updateMany({ curriculumVersion: label, curriculumVersionId: null, $or: [{ documentVersion: null }, { documentVersion: '' }] }, { $set: { documentVersion: label.trim().slice(0, 40) }, $unset: { curriculumVersion: 1 } });
      await CurriculumDocument.updateMany({ curriculumVersion: label, curriculumVersionId: null }, { $unset: { curriculumVersion: 1 } });
    }
  }
}
