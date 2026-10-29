import type { Request } from 'express';
import { ContentVersion, ContentReview, Assessment, GameDesign } from '../../models/index.js';
import { hasPermission } from '@ghlearn/shared';

export type Kind = 'question' | 'game';
export const EDITABLE = ['draft', 'changes_requested', 'rejected'];
export const IN_REVIEW = ['in_review', 'resubmitted'];
export const can = (req: Request, p: any) => hasPermission(req.auth!.roles, p);
/** Strip volatile fields so a snapshot is the authored content only. */
export function plain(doc: any) { const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  for (const k of ['_id', '__v', 'createdAt', 'updatedAt', 'validation', 'status', 'reviewedBy', 'reviewedAt', 'reviewComment', 'keyVerifiedBy', 'keyVerifiedAt', 'keyVerifiedVersion', 'answersVerifiedBy', 'answersVerifiedAt', 'answersVerifiedVersion', 'approvedVersion', 'submittedAt', 'submittedBy', 'publishedBy', 'publishedAt', 'archivedAt', 'archivedBy', 'normStem']) delete o[k];
  return JSON.parse(JSON.stringify(o)); }
export const snapshot = (kind: Kind, doc: any, reason: string, by?: string) =>
  ContentVersion.updateOne({ kind, refId: doc._id, version: doc.version ?? 1 }, { $setOnInsert: { snapshot: plain(doc), reason, createdBy: by } }, { upsert: true });
export const log = (kind: Kind, doc: any, req: Request, action: string, comment?: string) =>
  ContentReview.create({ kind, refId: doc._id, action: action as any, version: doc.version ?? 1, by: req.auth!.userId, comment });
/** The creator plus everyone who saved a version: none of them may review it (separation of duties). */
export async function authorsOf(kind: Kind, doc: any) {
  const ids = new Set<string>([String(doc.createdBy)]);
  for (const v of await ContentVersion.find({ kind, refId: doc._id }).select('createdBy').lean()) if (v.createdBy) ids.add(String(v.createdBy));
  return ids;
}
export async function history(kind: Kind, id: any) {
  const [versions, reviews] = await Promise.all([
    ContentVersion.find({ kind, refId: id }).select('version reason createdBy createdAt').populate('createdBy', 'fullName').sort({ version: -1 }).lean(),
    ContentReview.find({ kind, refId: id }).populate('by', 'fullName').sort({ createdAt: -1 }).limit(100).lean()]);
  return { versions: versions.map((v: any) => ({ version: v.version, reason: v.reason, by: v.createdBy?.fullName, at: v.createdAt })),
    reviews: reviews.map((r: any) => ({ action: r.action, version: r.version, by: r.by?.fullName, comment: r.comment, at: r.createdAt })) };
}
/** Assessments still open to students, and live (non-archived) game designs, that use a question. */
export async function liveUsage(questionId: any) {
  const now = new Date();
  const [assessments, designs] = await Promise.all([
    Assessment.find({ questionIds: questionId, status: 'published', $or: [{ closesAt: null }, { closesAt: { $gt: now } }] }).select('title').lean(),
    GameDesign.find({ questionIds: questionId, status: { $ne: 'archived' } }).select('title status').lean()]);
  return { assessments, designs };
}
