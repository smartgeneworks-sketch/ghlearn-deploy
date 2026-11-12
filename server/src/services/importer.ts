/**
 * Imports the crawled curriculumresources.edu.gh index as UNVERIFIED documents.
 * Idempotent (upsert by source URL). Never marks anything official or confirmed-mapped.
 */
import { CurriculumDocument, Subject, AcademicLevel } from '../models/index.js';
export interface IndexEntry { url: string; filename: string; title?: string; section?: string; level?: string | null; subject?: string | null; inferredLevel?: string; inferredSubject?: string;
  audience?: string | null; category?: string | null; version?: string | null; sizeBytes?: number; sourcePages?: string[]; folder?: string[] }
const DOC_TYPE: Record<string, string> = { 'Learner Material': 'learner_manual', 'Teacher Manual': 'teacher_manual', 'Teacher Guide': 'teacher_manual', Curriculum: 'curriculum', Assessment: 'assessment', Guide: 'guide', 'PLC Material': 'guide' };
const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function parseLevel(level?: string | null): { kind?: 'SHS' | 'JHS'; year?: number } {
  const m = (level ?? '').match(/^(SHS) Year (\d)$|^(JHS) (\d)$/);
  if (!m) return {};
  return m[1] ? { kind: 'SHS', year: Number(m[2]) } : { kind: 'JHS', year: Number(m[4]) };
}
export async function importIndex(entries: IndexEntry[], extra: { drive?: Map<string, string>; sha?: Map<string, string>; batch?: string } = {}) {
  const batch = extra.batch ?? `index-${new Date().toISOString().slice(0, 10)}`;
  const subjects = await Subject.find().lean(); const levels = await AcademicLevel.find().lean();
  const firstBySha = new Map<string, string>(); // sha -> canonical sourceUrl
  // pre-existing canonical docs by checksum
  for (const d of await CurriculumDocument.find({ 'provenance.checksum': { $ne: null }, duplicateOf: null }).select('provenance').lean()) if (d.provenance?.checksum && d.provenance.sourceUrl) firstBySha.set(d.provenance.checksum, d.provenance.sourceUrl);
  let created = 0, updated = 0, matchedSubject = 0;
  const ops = entries.map((e) => {
    const lv = parseLevel(e.level ?? e.inferredLevel); const level = lv.kind ? levels.find((l) => l.kind === lv.kind) : undefined;
    const subjName = norm(e.subject ?? e.inferredSubject);
    const subj = level && subjName ? subjects.find((s) => String(s.levelId) === String(level._id) && norm(s.name) === subjName) : undefined;
    if (subj) matchedSubject++;
    const sha = extra.sha?.get(e.url);
    if (sha && !firstBySha.has(sha)) firstBySha.set(sha, e.url);
    return { e, sha, level, subj, lv };
  });
  const urlToId = new Map<string, unknown>();
  // pass 1: upsert all
  for (const { e, sha, level, subj, lv } of ops) {
    const set: Record<string, unknown> = {
      title: e.title || e.filename, originalFilename: e.filename, mimeType: 'application/pdf', sizeBytes: e.sizeBytes,
      docType: DOC_TYPE[e.category ?? ''] ?? 'other', audience: e.audience === 'Learner' ? 'learner' : e.audience === 'Teacher' ? 'teacher' : 'unknown',
      curriculumVersion: e.version ?? undefined,
      sourceMeta: { section: e.section, level: e.level ?? null, subject: e.subject ?? null, inferredLevel: e.inferredLevel, inferredSubject: e.inferredSubject, category: e.category, audience: e.audience, sourcePages: e.sourcePages, folder: e.folder },
      'provenance.sourceUrl': e.url, 'provenance.publisher': 'curriculumresources.edu.gh (NaCCA/MoE portal, as listed; not independently verified)',
      'provenance.retrievedAt': new Date(), 'provenance.importBatch': batch, 'provenance.uploadedVia': 'import',
      'provenance.driveFileId': extra.drive?.get(e.url), 'provenance.checksum': sha,
      storage: { provider: 'remote', key: e.url },
    };
    const setOnInsert: Record<string, unknown> = { approvalStatus: 'unverified', processingStatus: 'not_processed', mappingStatus: subj ? 'suggested' : 'unmapped' };
    if (level) setOnInsert.levelId = level._id; if (lv.year) setOnInsert.yearOfStudy = lv.year; if (subj) setOnInsert.subjectId = subj._id;
    const r = await CurriculumDocument.updateOne({ 'provenance.sourceUrl': e.url }, { $set: set, $setOnInsert: setOnInsert }, { upsert: true });
    r.upsertedCount ? created++ : updated++;
  }
  for (const d of await CurriculumDocument.find({ 'provenance.importBatch': batch }).select('_id provenance.sourceUrl').lean()) urlToId.set(d.provenance!.sourceUrl!, d._id);
  // pass 2: duplicates (identical bytes) point to the first occurrence
  let duplicates = 0;
  for (const { e, sha } of ops) {
    if (!sha) continue; const canon = firstBySha.get(sha)!;
    if (canon !== e.url) { duplicates++; await CurriculumDocument.updateOne({ 'provenance.sourceUrl': e.url }, { duplicateOf: urlToId.get(canon) ?? (await CurriculumDocument.findOne({ 'provenance.sourceUrl': canon }).select('_id'))?._id }); }
  }
  return { batch, total: entries.length, created, updated, duplicates, matchedSubject };
}
