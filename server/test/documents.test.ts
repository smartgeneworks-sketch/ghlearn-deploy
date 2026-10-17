import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { useDb, ctx, loginAs } from './setup.js';
import { drain } from '../src/services/queue.js';
import { CurriculumDocument, Chunk, CurriculumNode } from '../src/models/index.js';
import { importIndex } from '../src/services/importer.js';
import { curriculumPdf, buildPdf, scannedPage } from './fixtures.js';
useDb();
const id = (x: any) => String(x._id);
const SAMPLE = '/workspace/curriculum/sample/LM-Biology-section-1-LVersion.pdf';

describe('document upload & processing pipeline', () => {
  let docId = '';
  it('rejects non-PDFs, unauthorised roles, and accepts a valid PDF', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test');
    expect((await ed.post('/api/documents/upload').attach('file', Buffer.from('hello'), 'notes.pdf')).status).toBe(415);
    expect((await ed.post('/api/documents/upload').attach('file', curriculumPdf(), 'x.exe')).status).toBe(415);
    expect((await ed.post('/api/documents/upload')).status).toBe(400);
    const stu = await loginAs('ama@sample.ghlearn.test');
    expect((await stu.post('/api/documents/upload').attach('file', curriculumPdf(), 'c.pdf')).status).toBe(403);
    expect((await stu.get('/api/documents')).status).toBe(403);
    const r = await ed.post('/api/documents/upload').field('title', 'SAMPLE test curriculum').field('subjectId', id(ctx.data.bio)).attach('file', curriculumPdf(), 'curriculum.pdf');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.document).toMatchObject({ approvalStatus: 'unverified', mappingStatus: 'suggested', storage: { provider: 'gridfs' } });
    docId = r.body.document._id;
  });
  it('detects duplicates by checksum', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test');
    const d = await ed.post('/api/documents/upload').attach('file', curriculumPdf(), 'again.pdf');
    expect(d.status).toBe(409); expect(d.body.error).toMatchObject({ code: 'DUPLICATE_DOCUMENT', details: { existingId: docId } });
  });
  it('processes: pages, unverified structure, chunks, embeddings marked TEST ONLY, report', async () => {
    expect(await drain()).toBeGreaterThan(0);
    const ed = await loginAs('editor@sample.ghlearn.test');
    const d = (await ed.get(`/api/documents/${docId}`)).body;
    expect(d.document.processingStatus).toBe('indexed');
    const rep = d.document.processingReport;
    expect(rep.pageCount).toBe(3); expect(rep.pages).toMatchObject({ text: 2, ocrUnavailable: 1 });
    expect(rep.lowTextPages).toEqual([3]);
    expect(rep.structure).toMatchObject({ strand: 1, subStrand: 2, contentStandard: 1, indicator: 1 });
    expect(rep.embedding.status).toBe('test_only');
    expect(rep.warnings.join(' ')).toMatch(/OCR is disabled/);
    expect(d.nodes.every((n: any) => n.verified === false)).toBe(true);
    expect(d.chunkStats.test_only).toBe(rep.chunks);
    const chunks = (await ed.get(`/api/documents/${docId}/chunks`)).body.items;
    expect(chunks[0].headingPath[0]).toBe('Diversity of Living Things');
    expect(chunks.every((c: any) => c.subjectId === id(ctx.data.bio) && !('embedding' in c))).toBe(true);
    expect((await ed.get(`/api/documents/${docId}/pages?from=1&to=2`)).body.items[1].text).toMatch(/Microscopy/);
    const job = (await ed.get(`/api/documents/jobs/${d.document.lastJobId}`)).body.job;
    expect(job.status).toBe('succeeded');
  });
  it('mapping: editor maps/confirms + verifies nodes; only reviewers set approval', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test');
    expect((await ed.patch(`/api/documents/${docId}`).send({ approvalStatus: 'verified_official' })).status).toBe(403);
    expect((await ed.patch(`/api/documents/${docId}`).send({ subjectId: id(ctx.data.chem), yearOfStudy: 1, docType: 'curriculum', mappingStatus: 'confirmed' })).status).toBe(200);
    expect(await Chunk.countDocuments({ documentId: docId, subjectId: ctx.data.chem._id })).toBeGreaterThan(0);
    const inj = await ed.patch(`/api/documents/${docId}`).send({ $set: { approvalStatus: 'verified_official' } }); // operator keys stripped
    expect(inj.body.document?.approvalStatus ?? 'unverified').toBe('unverified');
    expect((await ed.patch(`/api/documents/${docId}`).send({ bogus: 1 })).status).toBe(422);
    const node = await CurriculumNode.findOne({ documentId: docId, type: 'strand' });
    expect((await ed.patch(`/api/documents/${docId}/nodes/${node!._id}`).send({ verified: true, title: 'Diversity of Living Things (edited)' })).body.node.verified).toBe(true);
    expect((await ed.post(`/api/documents/${docId}/nodes`).send({ type: 'topic', title: 'Manual topic', page: 2 })).status).toBe(201);
    const { User } = await import('../src/models/index.js');
    const { hashPassword } = await import('../src/services/auth.js');
    await User.create({ email: 'rev@t.gh', fullName: 'Reviewer', roles: ['content_reviewer'], passwordHash: await hashPassword('GoodPass123') });
    const rv = await loginAs('rev@t.gh', 'GoodPass123');
    expect((await rv.patch(`/api/documents/${docId}`).send({ approvalStatus: 'verified_official' })).body.document.approvalStatus).toBe('verified_official');
    expect((await rv.patch(`/api/documents/${docId}`).send({ title: 'nope' })).status).toBe(403);
  });
  it('re-processing is idempotent and keeps manual nodes', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test');
    const before = await Chunk.countDocuments({ documentId: docId });
    expect((await ed.post(`/api/documents/${docId}/process`)).status).toBe(202);
    expect((await ed.post(`/api/documents/${docId}/process`)).status).toBe(409);
    await drain();
    expect(await Chunk.countDocuments({ documentId: docId })).toBe(before);
    expect(await CurriculumNode.countDocuments({ documentId: docId, 'detection.confidence': 'manual' })).toBe(1);
  });
  it('corrupt PDFs fail permanently with a visible report', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test');
    const bad = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('garbage '.repeat(50))]);
    const r = await ed.post('/api/documents/upload').attach('file', bad, 'bad.pdf');
    expect(r.status).toBe(201); await drain();
    const d = await CurriculumDocument.findById(r.body.document._id).lean();
    expect(d!.processingStatus).toBe('failed'); expect((d!.processingReport as any).error).toMatch(/could not be parsed/i);
  });
  it.runIf(fs.existsSync(SAMPLE))('processes the real SAMPLE Biology learner material (38 pages)', async () => {
    const ed = await loginAs('editor@sample.ghlearn.test');
    const r = await ed.post('/api/documents/upload').field('title', 'SAMPLE: Biology Y1 Section 1 (dev test)').field('subjectId', id(ctx.data.bio)).attach('file', fs.readFileSync(SAMPLE), 'LM-Biology-section-1-LVersion.pdf');
    expect(r.status).toBe(201); await drain();
    const d = (await ed.get(`/api/documents/${r.body.document._id}`)).body;
    const rep = d.document.processingReport;
    expect(rep.pageCount).toBe(38); expect(rep.pages.text).toBeGreaterThan(30);
    expect(d.nodes.find((n: any) => n.type === 'section')?.title).toMatch(/Introduction to Biology/);
    expect(rep.boilerplateLinesRemoved).toBeGreaterThan(0);
    expect(rep.chunks).toBeGreaterThan(20);
  }, 120_000);
});

describe('index import', () => {
  it('imports entries as unverified, suggests subjects, flags identical-checksum duplicates, is idempotent', async () => {
    const entries = [
      { url: 'https://curriculumresources.edu.gh/a/LM-Biology-1.pdf', filename: 'LM-Biology-1.pdf', title: 'Biology LM 1', level: 'SHS Year 1', subject: 'Biology', category: 'Learner Material', audience: 'Learner' },
      { url: 'https://curriculumresources.edu.gh/b/LM-Biology-1-copy.pdf', filename: 'LM-Biology-1-copy.pdf', title: 'Biology LM 1 copy', level: 'SHS Year 1', subject: 'Biology', category: 'Learner Material', audience: 'Learner' },
      { url: 'https://curriculumresources.edu.gh/c/COMPUTING-B4.pdf', filename: 'COMPUTING-B4.pdf', title: 'Computing B4', level: 'Basic 4', subject: 'Computing', category: 'Curriculum', audience: 'Teacher' },
    ];
    const sha = new Map([[entries[0].url, 'aa'], [entries[1].url, 'aa'], [entries[2].url, 'bb']]);
    const drive = new Map([[entries[0].url, 'DRIVE1']]);
    const r = await importIndex(entries, { sha, drive, batch: 'test' });
    expect(r).toMatchObject({ total: 3, created: 3, duplicates: 1, matchedSubject: 2 });
    const docs = await CurriculumDocument.find({ 'provenance.importBatch': 'test' }).sort({ title: 1 }).lean();
    expect(docs.every((d) => d.approvalStatus === 'unverified' && d.mappingStatus !== 'confirmed' && d.storage?.provider === 'remote')).toBe(true);
    expect(docs[0]).toMatchObject({ mappingStatus: 'suggested', yearOfStudy: 1, docType: 'learner_manual', audience: 'learner' });
    expect(String(docs[1].duplicateOf)).toBe(String(docs[0]._id));
    expect(docs[2]).toMatchObject({ mappingStatus: 'unmapped', docType: 'curriculum' });
    expect(docs[0].provenance?.driveFileId).toBe('DRIVE1');
    expect((await importIndex(entries, { sha, drive, batch: 'test' }))).toMatchObject({ created: 0, updated: 3 });
    const ed = await loginAs('editor@sample.ghlearn.test');
    const list = await ed.get('/api/documents?q=biology%20lm');
    const titles = list.body.items.map((d: any) => d.title);
    expect(titles).toContain('Biology LM 1'); expect(titles).not.toContain('Biology LM 1 copy'); // duplicates hidden by default
    const withDup = await ed.get('/api/documents?q=biology%20lm&duplicates=only');
    expect(withDup.body.items.map((d: any) => d.title)).toEqual(['Biology LM 1 copy']);
  });
});

describe('OCR fallback (tesseract, local)', () => {
  it('OCRs an image-only page when OCR_PROVIDER=tesseract', async () => {
    const { config } = await import('../src/config.js');
    (config as any).OCR_PROVIDER = 'tesseract';
    process.env.OCR_LANG_PATH = '/tmp/ghl-tessdata';
    fs.mkdirSync('/tmp/ghl-tessdata', { recursive: true });
    const td = '/workspace/waec-platform/server/eng.traineddata';
    if (fs.existsSync(td) && !fs.existsSync('/tmp/ghl-tessdata/eng.traineddata.gz')) { const zlib = await import('node:zlib'); fs.writeFileSync('/tmp/ghl-tessdata/eng.traineddata.gz', zlib.gzipSync(fs.readFileSync(td))); }
    try {
      const ed = await loginAs('editor@sample.ghlearn.test');
      const pdf = buildPdf([scannedPage(['STRAND 2: Energy and Forces', 'Photosynthesis converts light energy', 'into chemical energy in plants.'])]);
      const r = await ed.post('/api/documents/upload').field('title', 'SAMPLE scanned page').attach('file', pdf, 'scan.pdf');
      expect(r.status).toBe(201); await drain();
      const d = (await ed.get(`/api/documents/${r.body.document._id}`)).body;
      expect(d.document.processingReport.pages.ocr).toBe(1);
      const page = (await ed.get(`/api/documents/${r.body.document._id}/pages`)).body.items[0];
      expect(page.method).toBe('ocr'); expect(page.text).toMatch(/Photosynthesis/i);
      expect(d.nodes.find((n: any) => n.type === 'strand')?.title).toMatch(/Energy and Forces/i);
    } finally { (config as any).OCR_PROVIDER = ''; const { getOcrProvider } = await import('../src/services/ai.js'); }
  }, 180_000);
});
