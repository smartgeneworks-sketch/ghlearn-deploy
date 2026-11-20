import mongoose from 'mongoose';
import { z } from 'zod';
import { CurriculumDocument, CurriculumNode } from '../models/index.js';
import { AppError, notFound } from '../lib/errors.js';

/**
 * Curriculum LMS Phase 2: import a parsed curriculum structure (scripts/curriculum/parse-maths-curriculum.py output) into
 * CurriculumNode as Year > Strand > Sub-strand > (Learning outcome | Content standard > Learning indicator).
 * Text and page numbers come from the document; nothing is generated. Idempotent: nodes are keyed per document
 * (`key`), so re-running updates titles/pages in place and never duplicates. Nodes from other sources are untouched.
 */
const el = z.object({ year: z.number().int().min(1).max(3), strand: z.number().int().min(1).max(9), subStrand: z.number().int().min(1).max(9),
  kind: z.enum(['CS', 'LO', 'LI']), n: z.number().int().min(1).max(50), code: z.string().max(40), page: z.number().int().min(1),
  text: z.string().min(1).max(2000), contentStandard: z.number().int().nullish(), incomplete: z.boolean().optional(), garbled: z.boolean().optional(), sourceNote: z.string().max(500).optional() });
export const importBody = z.object({
  documentId: z.string().regex(/^[a-f0-9]{24}$/i), dryRun: z.boolean().default(true), parser: z.string().max(60),
  strands: z.array(z.object({ year: z.number().int(), strand: z.number().int(), title: z.string().min(2).max(200), page: z.number().int() })).min(1).max(60),
  subStrands: z.array(z.object({ year: z.number().int(), strand: z.number().int(), subStrand: z.number().int(), title: z.string().min(2).max(200), page: z.number().int() })).min(1).max(120),
  elements: z.array(el).min(1).max(2000),
  /** Learner manuals per sub-strand (by year/strand/sub-strand). Each must be a learner manual of the same subject. */
  lm: z.array(z.object({ year: z.number().int(), strand: z.number().int(), subStrand: z.number().int(), documentIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(10),
    /** Optional: map one content standard only. Overrides the sub-strand mapping for that standard's indicators; an empty list marks it as having no learner manual (source missing). */
    contentStandard: z.number().int().min(1).max(50).optional() })).max(200).default([]),
}).strict();
export type ImportBody = z.infer<typeof importBody>;

type Planned = { key: string; type: string; code: string; title: string; page: number; parentKey: string | null; order: number; yearOfStudy: number; meta: any; lmDocumentIds?: string[]; lmOverride?: boolean };
export function planNodes(b: ImportBody): { nodes: Planned[]; issues: string[] } {
  const issues: string[] = []; const nodes: Planned[] = []; let order = 0;
  const lm = new Map(b.lm.filter((x) => x.contentStandard === undefined).map((x) => [`${x.year}.${x.strand}.${x.subStrand}`, x.documentIds]));
  const csLm = new Map(b.lm.filter((x) => x.contentStandard !== undefined).map((x) => [`${x.year}.${x.strand}.${x.subStrand}.${x.contentStandard}`, x.documentIds]));
  const years = [...new Set(b.elements.map((e) => e.year))].sort();
  for (const y of years) {
    for (const st of b.strands.filter((s) => s.year === y).sort((a, c) => a.strand - c.strand)) {
      const sk = `Y${y}.S${st.strand}`;
      nodes.push({ key: sk, type: 'strand', code: `${y}.${st.strand}`, title: st.title, page: st.page, parentKey: null, order: ++order * 10, yearOfStudy: y, meta: { year: y, strand: st.strand } });
      for (const ss of b.subStrands.filter((s) => s.year === y && s.strand === st.strand).sort((a, c) => a.subStrand - c.subStrand)) {
        const ssk = `${sk}.SS${ss.subStrand}`; const els = b.elements.filter((e) => e.year === y && e.strand === st.strand && e.subStrand === ss.subStrand);
        const lmIds = lm.get(`${y}.${st.strand}.${ss.subStrand}`) ?? [];
        if (!lmIds.length) issues.push(`Year ${y} ${st.strand}.${ss.subStrand} ${ss.title}: no learner manual mapped (topics will be reported as source missing)`);
        nodes.push({ key: ssk, type: 'subStrand', code: `${y}.${st.strand}.${ss.subStrand}`, title: ss.title, page: ss.page, parentKey: sk, order: ++order * 10, yearOfStudy: y, meta: { year: y, strand: st.strand, subStrand: ss.subStrand }, lmDocumentIds: lmIds });
        for (const e of els.filter((x) => x.kind === 'LO')) nodes.push({ key: `${ssk}.LO${e.n}`, type: 'learningOutcome', code: e.code, title: e.text, page: e.page, parentKey: ssk, order: ++order * 10, yearOfStudy: y, meta: pick(e) });
        for (const cs of els.filter((x) => x.kind === 'CS')) {
          const csk = `${ssk}.CS${cs.n}`;
          const ov = csLm.get(`${y}.${st.strand}.${ss.subStrand}.${cs.n}`);
          if (ov && !ov.length) issues.push(`${cs.code}: no learner manual for this content standard (its indicators will be reported as source missing)`);
          nodes.push({ key: csk, type: 'contentStandard', code: cs.code, title: cs.text, page: cs.page, parentKey: ssk, order: ++order * 10, yearOfStudy: y, meta: pick(cs), lmDocumentIds: ov ?? [], lmOverride: !!ov });
          const lis = els.filter((x) => x.kind === 'LI' && x.contentStandard === cs.n);
          if (!lis.length) issues.push(`${cs.code}: no learning indicators found`);
          for (const li of lis) nodes.push({ key: `${csk}.LI${li.n}`, type: 'indicator', code: li.code, title: li.text, page: li.page, parentKey: csk, order: ++order * 10, yearOfStudy: y, meta: { ...pick(li), contentStandard: cs.n, contentStandardCode: cs.code } });
        }
        if (!els.length) issues.push(`Year ${y} ${st.strand}.${ss.subStrand}: header found but no coded elements`);
      }
    }
  }
  for (const e of b.elements) {
    if (e.incomplete) issues.push(`${e.code}${e.kind === 'LI' ? ` (CS.${e.contentStandard})` : ''} p.${e.page}: text may be cut at a page break — check against the PDF`);
    if (e.sourceNote) issues.push(`${e.code} p.${e.page}: ${e.sourceNote}`);
    if (e.kind === 'LI' && !e.contentStandard) issues.push(`${e.code} p.${e.page}: indicator before any content standard (not imported)`);
    if (!b.subStrands.some((s) => s.year === e.year && s.strand === e.strand && s.subStrand === e.subStrand)) issues.push(`${e.code}: sub-strand title not found (not imported)`);
  }
  const keys = new Set<string>(); for (const n of nodes) { if (keys.has(n.key)) issues.push(`duplicate key ${n.key}`); keys.add(n.key); }
  return { nodes, issues };
}
const pick = (e: any) => ({ year: e.year, strand: e.strand, subStrand: e.subStrand, kind: e.kind, n: e.n, ...(e.incomplete ? { incomplete: true } : {}), ...(e.sourceNote ? { sourceNote: e.sourceNote } : {}) });

export async function importStructure(b: ImportBody, userId: string) {
  const doc = await CurriculumDocument.findById(b.documentId).select('subjectId docType curriculumVersionId archivedAt title').lean();
  if (!doc) throw notFound('Document not found');
  if (doc.docType !== 'curriculum') throw new AppError(422, 'VALIDATION', 'Only a curriculum document can be imported as structure');
  if (!doc.subjectId) throw new AppError(422, 'VALIDATION', 'Map the curriculum document to a subject first');
  const lmIds = [...new Set(b.lm.flatMap((x) => x.documentIds))];
  if (lmIds.length) {
    const lms = await CurriculumDocument.find({ _id: { $in: lmIds } }).select('subjectId docType approvalStatus archivedAt title').lean();
    for (const id of lmIds) {
      const d = lms.find((x) => String(x._id) === id);
      if (!d) throw new AppError(422, 'VALIDATION', `Learner manual ${id} not found`);
      if (String(d.subjectId) !== String(doc.subjectId) || d.docType !== 'learner_manual' || d.archivedAt) throw new AppError(422, 'VALIDATION', `${d.title} is not a current learner manual of this subject`);
    }
  }
  const { nodes, issues } = planNodes(b);
  const existing = new Map((await CurriculumNode.find({ documentId: doc._id, key: { $in: nodes.map((n) => n.key) } }).select('key title page').lean()).map((n) => [n.key, n]));
  const summary = { create: nodes.filter((n) => !existing.has(n.key)).length, update: nodes.filter((n) => existing.has(n.key) && (existing.get(n.key)!.title !== n.title || existing.get(n.key)!.page !== n.page)).length,
    unchanged: 0, byType: {} as Record<string, number> };
  summary.unchanged = nodes.length - summary.create - summary.update;
  for (const n of nodes) summary.byType[n.type] = (summary.byType[n.type] ?? 0) + 1;
  if (b.dryRun) return { dryRun: true, summary, issues, preview: nodes.slice(0, 400).map(({ key, type, code, title, page, yearOfStudy }) => ({ key, type, code, title, page, yearOfStudy })) };
  const ids = new Map<string, mongoose.Types.ObjectId>();
  for (const n of nodes) {
    const parentId = n.parentKey ? ids.get(n.parentKey) : undefined;
    const r = await CurriculumNode.findOneAndUpdate({ documentId: doc._id, key: n.key }, {
      $set: { type: n.type, code: n.code, title: n.title, page: n.page, order: n.order, parentId, yearOfStudy: n.yearOfStudy, meta: n.meta, subjectId: doc.subjectId, curriculumVersionId: doc.curriculumVersionId,
        detection: { rule: `curriculum-import:${b.parser}`, confidence: 'explicit_label', line: n.code }, ...(n.lmDocumentIds ? { lmDocumentIds: n.lmDocumentIds } : {}), ...(n.type === 'contentStandard' ? { lmOverride: !!n.lmOverride } : {}) },
      $setOnInsert: { verified: false } }, { upsert: true, returnDocument: 'after' }).select('_id').lean();
    ids.set(n.key, r!._id as any);
  }
  return { dryRun: false, summary, issues, imported: nodes.length };
}
