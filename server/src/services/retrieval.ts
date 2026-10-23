import { embedRecorded } from './usage.js';
/**
 * RAG retrieval with SERVER-ENFORCED filters. Callers never pass raw filters:
 *  - subject access is checked via canAccessSubject (enrolment / assignment)
 *  - learners only get chunks from documents that are indexed, mapping-confirmed, not rejected, not duplicates,
 *    and (if the document has a level) at the learner's level
 *  - staff (editor/reviewer/super) may include unconfirmed documents, e.g. for lesson generation
 * Vector search: Atlas $vectorSearch (VECTOR_SEARCH=atlas) or local cosine fallback; if no embedding provider, keyword scoring.
 */
import mongoose from 'mongoose';
import { Chunk, CurriculumDocument, StudentProfile } from '../models/index.js';
import { canAccessSubject, canSeeUnpublished, type AuthCtx } from '../middleware/index.js';
import { getEmbeddingProvider } from './ai.js';
import { config } from '../config.js';
import { forbidden } from '../lib/errors.js';
import { fromStoredVector } from '../lib/vector.js';
export interface Passage { chunkId: string; documentId: string; documentTitle: string; pageStart: number; pageEnd: number; headingPath: string[]; text: string; score: number; approvalStatus: string }
export interface RetrieveOpts { subjectId: string; query: string; k?: number; documentIds?: string[]; includeUnconfirmed?: boolean;
  /** Generation (§11): only manuals approved as verified official and current (indexed, not archived, superseded or duplicate); mapping need not be confirmed. */
  approvedOnly?: boolean; curriculumVersionId?: string; pageFrom?: number; pageTo?: number }

export async function allowedDocuments(auth: AuthCtx, o: RetrieveOpts) {
  if (!(await canAccessSubject(auth, o.subjectId))) throw forbidden('You are not enrolled in this subject');
  const staff = canSeeUnpublished(auth);
  const q: Record<string, unknown> = { subjectId: new mongoose.Types.ObjectId(o.subjectId), processingStatus: 'indexed', approvalStatus: { $ne: 'rejected' }, duplicateOf: null, archivedAt: null, supersededBy: null };
  if (o.approvedOnly) q.approvalStatus = 'verified_official';
  else if (!(staff && o.includeUnconfirmed)) q.mappingStatus = 'confirmed';
  if (o.curriculumVersionId && mongoose.isValidObjectId(o.curriculumVersionId)) q.curriculumVersionId = new mongoose.Types.ObjectId(o.curriculumVersionId);
  if (!staff && auth.roles.includes('student')) {
    const p = await StudentProfile.findOne({ userId: auth.userId }).select('levelId').lean();
    q.$or = [{ levelId: null }, { levelId: p?.levelId }];
  }
  if (o.documentIds?.length) q._id = { $in: o.documentIds.filter(mongoose.isValidObjectId).map((x) => new mongoose.Types.ObjectId(x)) };
  return CurriculumDocument.find(q).select('_id title approvalStatus').lean();
}
const cosine = (a: number[], b: number[]) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x * y) || 1); };
const terms = (s: string) => [...new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])];

export async function retrieve(auth: AuthCtx, o: RetrieveOpts): Promise<Passage[]> {
  const docs = await allowedDocuments(auth, o); if (!docs.length) return [];
  const docIds = docs.map((d) => d._id); const meta = new Map(docs.map((d) => [String(d._id), d]));
  const k = Math.min(o.k ?? 6, 12); const subj = new mongoose.Types.ObjectId(o.subjectId);
  const filter: Record<string, unknown> = { documentId: { $in: docIds }, subjectId: subj };
  // section/page range: passages overlapping [pageFrom, pageTo]
  if (o.pageFrom != null) filter.pageEnd = { $gte: o.pageFrom };
  if (o.pageTo != null) filter.pageStart = { $lte: o.pageTo };
  let scored: { c: any; score: number }[] = [];
  const emb = getEmbeddingProvider();
  if (emb) {
    const [qv] = await embedRecorded(emb, [o.query.slice(0, 2000)], 'query');
    if (config.VECTOR_SEARCH === 'atlas') {
      const rows = await Chunk.aggregate([{ $vectorSearch: { index: 'chunk_vectors', path: 'embedding', queryVector: qv, numCandidates: k * 20, limit: o.pageFrom != null || o.pageTo != null ? k * 5 : k, filter: { subjectId: subj, documentId: { $in: docIds } } } },
        { $project: { embedding: 0, score: { $meta: 'vectorSearchScore' } } }]);
      scored = rows.filter((c: any) => (o.pageFrom == null || c.pageEnd >= o.pageFrom) && (o.pageTo == null || c.pageStart <= o.pageTo)).map((c: any) => ({ c, score: c.score }));
    } else {
      const rows = await Chunk.find({ ...filter, embeddingStatus: { $in: ['done', 'test_only'] } }).select('+embedding').limit(5000).lean();
      scored = rows.map((c) => ({ c, v: fromStoredVector(c.embedding) })).filter((r) => r.v?.length === qv.length).map(({ c, v }) => ({ c, score: cosine(qv, v!) }));
    }
  }
  if (!scored.length) { // keyword fallback (no embeddings available)
    const t = terms(o.query); const rows = await Chunk.find(filter).limit(5000).lean();
    scored = rows.map((c) => { const txt = c.text.toLowerCase(); return { c, score: t.reduce((a, w) => a + (txt.includes(w) ? 1 : 0), 0) / (t.length || 1) }; }).filter((r) => r.score > 0);
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k).map(({ c, score }) => ({
    chunkId: String(c._id), documentId: String(c.documentId), documentTitle: meta.get(String(c.documentId))?.title ?? '', approvalStatus: meta.get(String(c.documentId))?.approvalStatus ?? 'unverified',
    pageStart: c.pageStart, pageEnd: c.pageEnd, headingPath: c.headingPath ?? [], text: c.text, score: Math.round(score * 1000) / 1000 }));
}
/** Passages are UNTRUSTED data. Neutralise markup that could close our delimiters or impersonate roles. */
export function fencePassages(ps: Passage[]) {
  const clean = (s: string) => s.replace(/[<>]/g, (m) => (m === '<' ? '‹' : '›')).replace(/\u0000/g, '');
  return ps.map((p, i) => `<passage id="S${i + 1}" source="${clean(p.documentTitle)}" pages="${p.pageStart}-${p.pageEnd}">\n${clean(p.text)}\n</passage>`).join('\n');
}
