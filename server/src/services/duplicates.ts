import mongoose from 'mongoose';
import { CurriculumDocument } from '../models/index.js';

/**
 * Byte-identical manuals (same SHA-256) keep exactly one canonical record; every other copy points at it with
 * `duplicateOf` and is left out of the library list, search, retrieval and processing. Nothing is deleted.
 * The canonical is the existing unmarked record when there is exactly one; otherwise the best record
 * (indexed, then verified, then not archived/superseded, then oldest).
 */
type D = { _id: mongoose.Types.ObjectId; title: string; duplicateOf?: mongoose.Types.ObjectId | null; processingStatus?: string; approvalStatus?: string;
  archivedAt?: Date | null; supersededBy?: unknown; createdAt?: Date; sizeBytes?: number; storage?: { provider?: string; key?: string }; provenance?: { checksum?: string } };
const rank = (d: D) => [d.processingStatus === 'indexed' ? 0 : 1, d.approvalStatus === 'verified_official' ? 0 : 1, d.archivedAt || d.supersededBy ? 1 : 0, +(d.createdAt ?? 0)];
const better = (a: D, b: D) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return String(a._id) < String(b._id) ? -1 : 1; };

export type DuplicateChange = { id: string; title: string; from: string | null; to: string | null };
export async function reconcileDuplicates(o: { dryRun: boolean }) {
  const docs = await CurriculumDocument.find({ 'provenance.checksum': { $nin: [null, ''] } })
    .select('title duplicateOf processingStatus approvalStatus archivedAt supersededBy createdAt sizeBytes storage provenance.checksum').lean<D[]>();
  const groups = new Map<string, D[]>();
  for (const d of docs) { const k = d.provenance!.checksum!; (groups.get(k) ?? groups.set(k, []).get(k)!).push(d); }
  const changes: DuplicateChange[] = []; let copies = 0, groupsWithCopies = 0, copyBytes = 0, gridfsCopyBytes = 0; const indexedCopies: string[] = []; const sharedBlobs: string[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) { const d = g[0]; if (d.duplicateOf) changes.push({ id: String(d._id), title: d.title, from: String(d.duplicateOf), to: null }); continue; }
    groupsWithCopies++;
    const unmarked = g.filter((d) => !d.duplicateOf);
    const canon = unmarked.length === 1 ? unmarked[0] : [...g].sort(better)[0];
    if (canon.duplicateOf) changes.push({ id: String(canon._id), title: canon.title, from: String(canon.duplicateOf), to: null });
    for (const d of g) {
      if (d === canon) continue; copies++; copyBytes += d.sizeBytes ?? 0;
      if (d.processingStatus === 'indexed') indexedCopies.push(String(d._id));
      if (d.storage?.provider === 'gridfs' && d.storage.key) { if (d.storage.key === canon.storage?.key) sharedBlobs.push(String(d._id)); else gridfsCopyBytes += d.sizeBytes ?? 0; }
      if (String(d.duplicateOf ?? '') !== String(canon._id)) changes.push({ id: String(d._id), title: d.title, from: d.duplicateOf ? String(d.duplicateOf) : null, to: String(canon._id) });
    }
  }
  if (!o.dryRun && changes.length)
    await CurriculumDocument.bulkWrite(changes.map((c) => ({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(c.id) }, update: c.to ? { $set: { duplicateOf: new mongoose.Types.ObjectId(c.to) } } : { $unset: { duplicateOf: 1 } } } })));
  return { dryRun: o.dryRun, checked: docs.length, groupsWithCopies, copies, changes, copyBytes, indexedCopies,
    gridfs: { reclaimableBytes: gridfsCopyBytes, sharedBlobs: sharedBlobs.length, note: 'Only copies stored in GridFS take space in the database; remote/Drive copies are references.' } };
}
