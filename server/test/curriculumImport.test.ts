import { describe, it, expect } from 'vitest';
import { useDb, ctx, loginAs } from './setup.js';
import { AuditLog, CurriculumDocument, CurriculumNode } from '../src/models/index.js';

useDb();
const els = [
  { year: 1, strand: 3, subStrand: 1, kind: 'LO', n: 1, code: '1.3.1.LO.1', page: 86, text: 'Draw and describe angles of various measures.' },
  { year: 1, strand: 3, subStrand: 1, kind: 'CS', n: 1, code: '1.3.1.CS.1', page: 90, text: 'Demonstrate a conceptual understanding of spatial sense.' },
  { year: 1, strand: 3, subStrand: 1, kind: 'LI', n: 1, code: '1.3.1.LI.1', page: 90, contentStandard: 1, text: 'Draw and describe angles with various measures.' },
  { year: 1, strand: 3, subStrand: 1, kind: 'LI', n: 2, code: '1.3.1.LI.2', page: 93, contentStandard: 1, text: 'Solve problems that involve parallel lines', incomplete: true },
];
const body = (documentId: string, extra: any = {}) => ({ documentId, parser: 'ghana-shs-v1', strands: [{ year: 1, strand: 3, title: 'Geometry Around Us', page: 86 }],
  subStrands: [{ year: 1, strand: 3, subStrand: 1, title: 'Spatial Sense', page: 86 }], elements: els, ...extra });

describe('curriculum structure import (Curriculum LMS Phase 2)', () => {
  it('previews by default, imports idempotently with page refs and hierarchy, audits, and refuses non-curriculum documents and foreign LMs', async () => {
    const subjectId = ctx.data.emath._id;
    const cur = await CurriculumDocument.create({ title: 'Maths Curriculum', docType: 'curriculum', subjectId, approvalStatus: 'unverified' });
    const lm = await CurriculumDocument.create({ title: 'LM S5', docType: 'learner_manual', subjectId, approvalStatus: 'verified_official' });
    const other = await CurriculumDocument.create({ title: 'Other LM', docType: 'learner_manual', subjectId: ctx.data.phy._id });
    const teacher = await loginAs('teacher@sample.ghlearn.test');
    expect((await teacher.post('/api/curriculum/import-structure').send(body(String(cur._id)))).status).toBe(403);
    const sup = await loginAs('super@sample.ghlearn.test');
    const dry = await sup.post('/api/curriculum/import-structure').send(body(String(cur._id)));
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.dryRun).toBe(true); expect(dry.body.summary.create).toBe(6);
    expect(dry.body.issues.join('\n')).toMatch(/no learner manual mapped/); expect(dry.body.issues.join('\n')).toMatch(/1\.3\.1\.LI\.2.*cut at a page break/);
    expect(await CurriculumNode.countDocuments({ documentId: cur._id })).toBe(0);
    const lmMap = { lm: [{ year: 1, strand: 3, subStrand: 1, documentIds: [String(lm._id)] }] };
    const run = await sup.post('/api/curriculum/import-structure').send(body(String(cur._id), { dryRun: false, ...lmMap }));
    expect(run.status, JSON.stringify(run.body)).toBe(200); expect(run.body.imported).toBe(6);
    const again = await sup.post('/api/curriculum/import-structure').send(body(String(cur._id), { dryRun: false, ...lmMap }));
    expect(again.body.summary).toMatchObject({ create: 0, update: 0, unchanged: 6 });
    const nodes = await CurriculumNode.find({ documentId: cur._id }).lean();
    expect(nodes).toHaveLength(6);
    const li2 = nodes.find((n) => n.key === 'Y1.S3.SS1.CS1.LI2')!; const cs = nodes.find((n) => n.key === 'Y1.S3.SS1.CS1')!; const ss = nodes.find((n) => n.type === 'subStrand')!;
    expect(String(li2.parentId)).toBe(String(cs._id)); expect(li2.page).toBe(93); expect(li2.verified).toBe(false); expect((li2.meta as any).incomplete).toBe(true);
    expect(ss.lmDocumentIds!.map(String)).toEqual([String(lm._id)]);
    expect(nodes.find((n) => n.type === 'learningOutcome')!.title).toMatch(/Draw and describe/);
    expect(await AuditLog.countDocuments({ action: 'curriculum.import_structure', target: String(cur._id) })).toBe(2);
    expect((await sup.post('/api/curriculum/import-structure').send(body(String(lm._id)))).status).toBe(422);
    expect((await sup.post('/api/curriculum/import-structure').send(body(String(cur._id), { lm: [{ year: 1, strand: 3, subStrand: 1, documentIds: [String(other._id)] }] }))).status).toBe(422);
  });
});
