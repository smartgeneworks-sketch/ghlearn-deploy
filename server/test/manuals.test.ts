/** Phase 5: Learner Manuals library (§9) and curriculum versions (Curriculum Management). */
import { describe, it, expect, beforeAll } from 'vitest';
import { useDb, ctx, loginAs } from './setup.js';
import { drain } from '../src/services/queue.js';
import { config } from '../src/config.js';
import { CurriculumDocument, CurriculumNode, CurriculumVersion, DocumentPage, LearningResource, Subject, User, Job } from '../src/models/index.js';
import { gridfs } from '../src/services/storage.js';
import { allowedDocuments } from '../src/services/retrieval.js';
import { hashPassword } from '../src/services/auth.js';
import { curriculumPdf, buildPdf, scannedPage, buildDocx } from './fixtures.js';
useDb();
const id = (x: any) => String(x._id);
const E = { editor: 'editor@sample.ghlearn.test', curriculum: 'curriculum@sample.ghlearn.test', school: 'admin@sample.ghlearn.test', teacher: 'teacher@sample.ghlearn.test', student: 'ama@sample.ghlearn.test', reviewer: 'rev5@t.gh' };
const textPdf = (tag: string) => buildPdf([{ lines: [`SAMPLE MANUAL ${tag}`, 'STRAND 1: Matter', ...Array.from({ length: 20 }, (_, i) => `Matter is anything that has mass and occupies space, line ${i} (${tag}).`)] }]);
beforeAll(async () => { await User.create({ email: E.reviewer, fullName: 'Reviewer Five', roles: ['content_reviewer'], passwordHash: await hashPassword('GoodPass123') }); });

describe('upload validation (§9)', () => {
  it('limits are visible to uploaders only', async () => {
    const l = await (await loginAs(E.editor)).get('/api/documents/upload-limits');
    expect(l.status).toBe(200); expect(l.body.maxMB).toBe(config.UPLOAD_MAX_MB); expect(Object.keys(l.body.formats)).toEqual(['pdf', 'docx', 'txt', 'csv']);
    expect((await (await loginAs(E.teacher)).get('/api/documents/upload-limits')).status).toBe(403);
  });
  it('rejects wrong extension, mismatched mime, content that does not match, encrypted and empty files', async () => {
    const ed = await loginAs(E.editor);
    const up = (buf: Buffer, name: string, contentType?: string) => ed.post('/api/documents/upload').attach('file', buf, contentType ? { filename: name, contentType } : name);
    expect((await up(Buffer.from('MZ...'), 'tool.exe')).body.error.code).toBe('UNSUPPORTED_FILE');
    expect((await up(textPdf('m'), 'm.pdf', 'image/png')).status).toBe(415);
    expect((await up(Buffer.from('just text, not a pdf'), 'fake.pdf')).status).toBe(415);
    expect((await up(Buffer.from('PK\u0003\u0004 not really a zip'), 'fake.docx')).status).toBe(415);
    expect((await up(Buffer.from([0x41, 0, 0x42, 0x43]), 'binary.txt')).status).toBe(415);
    const enc = Buffer.from(textPdf('enc').toString('latin1').replace('/Root', '/Encrypt 99 0 R /Root'), 'latin1');
    const e = await up(enc, 'locked.pdf'); expect(e.status).toBe(422); expect(e.body.error.code).toBe('ENCRYPTED_PDF');
    expect((await up(Buffer.alloc(0), 'empty.txt')).status).toBe(400);
    expect(await CurriculumDocument.countDocuments({ originalFilename: { $in: ['m.pdf', 'fake.pdf', 'fake.docx', 'binary.txt', 'locked.pdf', 'empty.txt'] } })).toBe(0);
  });
  it('enforces the size limit (413) and the storage quota (507) without leaving partial files', async () => {
    const ed = await loginAs(E.editor); const before = await gridfs.usedBytes();
    const maxMB = config.UPLOAD_MAX_MB; (config as any).UPLOAD_MAX_MB = 0.01;
    try { const r = await ed.post('/api/documents/upload').attach('file', Buffer.from('a'.repeat(30_000)), 'big.txt'); expect(r.status).toBe(413); expect(r.body.error.code).toBe('FILE_TOO_LARGE'); }
    finally { (config as any).UPLOAD_MAX_MB = maxMB; }
    const q = config.GRIDFS_QUOTA_MB; (config as any).GRIDFS_QUOTA_MB = before / 1048576 + 0.005;
    try { const r = await ed.post('/api/documents/upload').attach('file', Buffer.from('b'.repeat(20_000)), 'quota.txt'); expect(r.status).toBe(507); expect(r.body.error.code).toBe('STORAGE_QUOTA'); }
    finally { (config as any).GRIDFS_QUOTA_MB = q; }
    expect(await gridfs.usedBytes()).toBe(before);
  });
  it('students, teachers and reviewers cannot upload', async () => {
    for (const [e, pw] of [[E.student], [E.teacher], [E.reviewer, 'GoodPass123']] as const) expect((await (await loginAs(e, pw)).post('/api/documents/upload').attach('file', textPdf('x'), 'x.pdf')).status, e).toBe(403);
  });
});

describe('formats, metadata and duplicates', () => {
  let pdfId = ''; let txtId = ''; let csvId = ''; let docxId = '';
  it('accepts PDF, TXT, CSV and DOCX with full metadata and links the curriculum version', async () => {
    const ed = await loginAs(E.editor); const ver = ctx.data.ver;
    const r = await ed.post('/api/documents/upload').field('title', 'SAMPLE Physics manual').field('subjectId', id(ctx.data.phy)).field('curriculumVersionId', id(ver))
      .field('docType', 'learner_manual').field('publicationYear', '2024').field('language', 'en').field('documentVersion', '1.2').field('licensingStatus', 'open_licence')
      .field('publisher', 'Sample Press').field('tags', 'physics, matter').attach('file', textPdf('pdf'), 'physics.pdf');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.document).toMatchObject({ fileKind: 'pdf', curriculumVersion: ver.code, publicationYear: 2024, documentVersion: '1.2', licensingStatus: 'open_licence', tags: ['physics', 'matter'], approvalStatus: 'unverified', processingStatus: 'queued', versionNumber: 1 });
    pdfId = r.body.document._id; expect(r.body.document.versionGroupId).toBe(pdfId); expect(r.body.jobId).toBeTruthy();
    txtId = (await ed.post('/api/documents/upload').attach('file', Buffer.from('Unit 1: Forces\nA force is a push or a pull.\f Unit 2: Energy\nEnergy is the ability to do work.'), 'notes.txt')).body.document._id;
    csvId = (await ed.post('/api/documents/upload').attach('file', Buffer.from('topic,indicator\nForces,Describe a push\nEnergy,"Define work, power"\n'), 'scheme.csv')).body.document._id;
    const dx = await ed.post('/api/documents/upload').attach('file', buildDocx([{ paras: ['Strand 1: Living things', 'Cells are the unit of life.'], drawing: true }, { paras: ['Strand 2: Ecology'] }]), 'manual.docx');
    expect(dx.status, JSON.stringify(dx.body)).toBe(201); docxId = dx.body.document._id;
    expect((await ed.post('/api/documents/upload').field('curriculumVersionId', '0123456789abcdef01234567').attach('file', textPdf('badref'), 'r.pdf')).status).toBe(400);
    expect((await ed.post('/api/documents/upload').field('licensingStatus', 'stolen').attach('file', textPdf('badlic'), 'l.pdf')).status).toBe(422);
    await drain();
    for (const d of await CurriculumDocument.find({ _id: { $in: [pdfId, txtId, csvId, docxId] } }).lean()) expect(d.processingStatus, d.originalFilename ?? '').toBe('indexed');
    const t = (await ed.get(`/api/documents/${txtId}/extraction`)).body; expect(t).toMatchObject({ unit: 'page', ocrStatus: 'not_needed' }); expect(t.pages).toHaveLength(2);
    const c = (await ed.get(`/api/documents/${csvId}/extraction`)).body; expect(c.unit).toBe('segment'); expect(c.report.csvRows).toBe(2);
    expect((await ed.get(`/api/documents/${csvId}/pages?from=1&to=1`)).body.items[0].text).toMatch(/indicator: Define work, power/);
    const d = (await ed.get(`/api/documents/${docxId}/extraction`)).body; expect(d.unit).toBe('page'); expect(d.pages.map((p: any) => p.figures)).toEqual([1, 0]); expect(d.report.figures).toBe(1);
    expect(await CurriculumNode.countDocuments({ documentId: pdfId, curriculumVersionId: ver._id })).toBeGreaterThan(0);
  });
  it('detects duplicates by SHA-256 before and during upload; a confirmed duplicate shares storage and is not processed', async () => {
    const ed = await loginAs(E.editor);
    const doc = await CurriculumDocument.findById(pdfId).lean();
    expect((await ed.post('/api/documents/check-duplicate').send({ sha256: doc!.provenance!.checksum })).body.duplicate).toMatchObject({ id: pdfId });
    expect((await ed.post('/api/documents/check-duplicate').send({ sha256: 'f'.repeat(64) })).body.duplicate).toBeNull();
    expect((await ed.post('/api/documents/check-duplicate').send({ sha256: 'nope' })).status).toBe(422);
    const files = await gridfs.usedBytes();
    const d = await ed.post('/api/documents/upload').attach('file', textPdf('pdf'), 'again.pdf');
    expect(d.status).toBe(409); expect(d.body.error).toMatchObject({ code: 'DUPLICATE_DOCUMENT', details: { existingId: pdfId } });
    const ok = await ed.post('/api/documents/upload').field('allowDuplicate', 'true').attach('file', textPdf('pdf'), 'again.pdf');
    expect(ok.status).toBe(201); expect(ok.body.jobId).toBeNull();
    expect(ok.body.document).toMatchObject({ duplicateOf: pdfId, storage: doc!.storage });
    expect(await gridfs.usedBytes()).toBe(files);
    expect((await ed.post(`/api/documents/${ok.body.document._id}/process`)).status).toBe(409);
  });
  it('scanned PDFs are marked "OCR needed / not configured" (no fake OCR) and figures are counted', async () => {
    const ed = await loginAs(E.editor);
    const r = await ed.post('/api/documents/upload').attach('file', buildPdf([scannedPage(['Scanned page one']), scannedPage(['Scanned page two'])]), 'scanned.pdf');
    expect(r.status).toBe(201); await drain();
    const x = (await ed.get(`/api/documents/${r.body.document._id}/extraction`)).body;
    expect(x.ocrStatus).toBe('needed_not_configured'); expect(x.report.scanned).toBe(true); expect(x.report.pagesWithoutTextLayer).toBe(2);
    expect(x.pages.map((p: any) => [p.method, p.figures])).toEqual([['ocr_unavailable', 1], ['ocr_unavailable', 1]]);
    expect((await ed.get(`/api/documents?ocrStatus=needed_not_configured`)).body.items.map((d: any) => d._id)).toContain(r.body.document._id);
  });
  it('metadata: editors edit, reviewers only set approval (separate from processing), others are denied', async () => {
    const ed = await loginAs(E.editor);
    const p = await ed.patch(`/api/documents/${txtId}`).send({ title: 'SAMPLE notes', subjectId: id(ctx.data.phy), curriculumVersionId: id(ctx.data.ver), licensingStatus: 'restricted', tags: ['Forces'], publicationYear: 2023, sourceUrl: 'https://example.org/notes' });
    expect(p.status, JSON.stringify(p.body)).toBe(200); expect(p.body.document).toMatchObject({ title: 'SAMPLE notes', curriculumVersion: 'SHS 2023+', tags: ['forces'], processingStatus: 'indexed', approvalStatus: 'unverified' });
    expect((await ed.patch(`/api/documents/${txtId}`).send({ publicationYear: 1200 })).status).toBe(422);
    expect((await ed.patch(`/api/documents/${txtId}`).send({ processingStatus: 'indexed' })).status).toBe(422);
    expect((await ed.patch(`/api/documents/${txtId}`).send({ approvalStatus: 'verified_official' })).status).toBe(403);
    const rv = await loginAs(E.reviewer, 'GoodPass123');
    const a = await rv.patch(`/api/documents/${txtId}`).send({ approvalStatus: 'verified_official' });
    expect(a.body.document).toMatchObject({ approvalStatus: 'verified_official', processingStatus: 'indexed' });
    expect((await rv.patch(`/api/documents/${txtId}`).send({ title: 'x' })).status).toBe(403);
    for (const e of [E.teacher, E.student]) expect((await (await loginAs(e)).patch(`/api/documents/${txtId}`).send({ title: 'x' })).status, e).toBe(403);
    const list = (await ed.get('/api/documents?tag=forces&licensingStatus=restricted')).body; expect(list.items.map((d: any) => d._id)).toEqual([txtId]);
  });
  it('preview is always allowed for staff; download only where licensing permits (or curriculum:manage)', async () => {
    const ed = await loginAs(E.editor);
    const pv = await ed.get(`/api/documents/${txtId}/file`); expect(pv.status).toBe(200); expect(pv.headers['content-type']).toMatch(/text\/plain/); expect(pv.headers['x-content-type-options']).toBe('nosniff');
    expect((await ed.get(`/api/documents/${txtId}/file?download=1`)).body.error.code).toBe('DOWNLOAD_NOT_PERMITTED');
    const ok = await ed.get(`/api/documents/${pdfId}/file?download=1`); expect(ok.status).toBe(200); expect(ok.headers['content-disposition']).toMatch(/attachment/); expect(ok.headers['content-type']).toBe('application/pdf');
    expect((await (await loginAs(E.curriculum)).get(`/api/documents/${txtId}/file?download=1`)).status).toBe(200);
    expect((await ed.get(`/api/documents/${docxId}/file`)).headers['content-disposition']).toMatch(/attachment/);
    expect((await (await loginAs(E.student)).get(`/api/documents/${pdfId}/file`)).status).toBe(403);
    const det = (await ed.get(`/api/documents/${txtId}`)).body; expect(det.permissions).toMatchObject({ edit: true, review: false, download: false, archive: true });
  });

  it('replacement versions keep earlier versions and their generated resources', async () => {
    const ed = await loginAs(E.editor);
    await LearningResource.create({ title: 'SAMPLE: notes from v1', kind: 'notes', subjectId: ctx.data.phy._id, sourceDocumentId: pdfId, status: 'draft', isSample: true });
    await CurriculumDocument.updateOne({ _id: pdfId }, { mappingStatus: 'confirmed' });
    expect((await ed.post(`/api/documents/${pdfId}/replace`).attach('file', textPdf('pdf'), 'same.pdf')).body.error.code).toBe('SAME_FILE');
    expect((await ed.post(`/api/documents/${pdfId}/replace`).attach('file', Buffer.from('Unit 1: Forces\nA force is a push or a pull.\f Unit 2: Energy\nEnergy is the ability to do work.'), 'n.txt')).body.error.code).toBe('DUPLICATE_DOCUMENT');
    expect((await (await loginAs(E.teacher)).post(`/api/documents/${pdfId}/replace`).attach('file', textPdf('v2'), 'v2.pdf')).status).toBe(403);
    const r = await ed.post(`/api/documents/${pdfId}/replace`).field('documentVersion', '2.0').attach('file', textPdf('v2'), 'physics-v2.pdf');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const v2 = r.body.document; expect(v2).toMatchObject({ versionGroupId: pdfId, versionNumber: 2, supersedes: pdfId, documentVersion: '2.0', title: 'SAMPLE Physics manual', licensingStatus: 'open_licence', approvalStatus: 'unverified', mappingStatus: 'suggested' });
    const old = await CurriculumDocument.findById(pdfId).lean(); expect(String(old!.supersededBy)).toBe(v2._id); expect(old!.processingStatus).toBe('indexed');
    expect(await DocumentPage.countDocuments({ documentId: pdfId })).toBeGreaterThan(0);
    expect((await ed.post(`/api/documents/${pdfId}/process`)).body.error.code).toBe('SUPERSEDED');
    expect((await ed.post(`/api/documents/${pdfId}/replace`).attach('file', textPdf('v3'), 'v3.pdf')).status).toBe(409);
    await drain();
    const det = (await ed.get(`/api/documents/${v2._id}`)).body;
    expect(det.versions.map((v: any) => [v.versionNumber, v.current])).toEqual([[2, true], [1, false]]);
    expect(det.versions.find((v: any) => v.versionNumber === 1).generated.resources).toBe(1);
    const list = (await ed.get('/api/documents?q=physics%20manual')).body.items.map((d: any) => d._id); expect(list).toContain(v2._id); expect(list).not.toContain(pdfId);
    expect((await ed.get('/api/documents?q=physics%20manual&versions=all')).body.items.map((d: any) => d._id)).toContain(pdfId);
    expect(await LearningResource.countDocuments({ sourceDocumentId: pdfId })).toBe(1);
    const auth = { userId: id(await User.findOne({ email: E.editor })), roles: ['curriculum_editor'] } as any;
    await CurriculumDocument.updateOne({ _id: v2._id }, { mappingStatus: 'confirmed' });
    const allowed = (await allowedDocuments(auth, { subjectId: id(ctx.data.phy) } as any)).map(id); expect(allowed).toContain(v2._id); expect(allowed).not.toContain(pdfId);
  });
  it('archive hides a manual from the library and retrieval; restore brings it back; permissions enforced', async () => {
    const ed = await loginAs(E.editor);
    expect((await (await loginAs(E.school)).post(`/api/documents/${csvId}/archive`)).status).toBe(403);
    const a = await ed.post(`/api/documents/${csvId}/archive`).send({ reason: 'Superseded by a newer scheme' }); expect(a.status).toBe(200); expect(a.body.document.archivedAt).toBeTruthy();
    expect((await ed.get('/api/documents')).body.items.map((d: any) => d._id)).not.toContain(csvId);
    expect((await ed.get('/api/documents?archived=true')).body.items.map((d: any) => d._id)).toEqual([csvId]);
    expect((await ed.patch(`/api/documents/${csvId}`).send({ title: 'Renamed scheme' })).status).toBe(409);
    expect((await ed.post(`/api/documents/${csvId}/process`)).status).toBe(409);
    expect((await ed.post(`/api/documents/${csvId}/archive`)).status).toBe(409);
    expect((await ed.post(`/api/documents/${csvId}/restore`)).body.document.archivedAt).toBeFalsy();
  });
});

describe('curriculum versions lifecycle (Curriculum Management)', () => {
  let vid = '';
  it('create (draft), validate, edit; only curriculum:manage writes', async () => {
    const ca = await loginAs(E.curriculum);
    const c = await ca.post('/api/curriculum/versions').send({ code: 'SHS 2027', name: 'SHS curriculum 2027 (draft)', levelId: id(ctx.data.shs), effectiveFrom: '2027-09-01', publisher: 'NaCCA' });
    expect(c.status, JSON.stringify(c.body)).toBe(201); expect(c.body.version.status).toBe('draft'); vid = c.body.version._id;
    expect((await ca.post('/api/curriculum/versions').send({ code: 'shs 2027', name: 'dup' })).status).toBe(409);
    expect((await ca.post('/api/curriculum/versions').send({ code: '!', name: 'bad' })).status).toBe(422);
    expect((await ca.post('/api/curriculum/versions').send({ code: 'D-1', name: 'dates', effectiveFrom: '2027-01-01', effectiveTo: '2026-01-01' })).status).toBe(422);
    expect((await ca.patch(`/api/curriculum/versions/${vid}`).send({ description: 'Pilot' })).body.version.description).toBe('Pilot');
    for (const e of [E.editor, E.teacher, E.school]) {
      const a = await loginAs(e);
      expect((await a.post('/api/curriculum/versions').send({ code: 'N-1', name: 'n' })).status, e).toBe(403);
      expect((await a.post(`/api/curriculum/versions/${vid}/activate`)).status, e).toBe(403);
    }
    expect((await (await loginAs(E.student)).get('/api/curriculum/versions')).status).toBe(403);
    expect((await (await loginAs(E.teacher)).get('/api/curriculum/versions')).status).toBe(403);
    // uploaders and reviewers may read the list (to pick a version), but not the detail
    expect((await (await loginAs(E.school)).get('/api/curriculum/versions')).status).toBe(200);
    expect((await (await loginAs(E.reviewer, 'GoodPass123')).get('/api/curriculum/versions')).status).toBe(200);
    expect((await (await loginAs(E.school)).get(`/api/curriculum/versions/${vid}`)).status).toBe(403);
  });
  it('link subjects and manuals; counts, label mirror; archive blocked while subjects use it', async () => {
    const ca = await loginAs(E.curriculum);
    expect((await ca.post(`/api/curriculum/versions/${vid}/activate`)).body.version.status).toBe('active');
    expect((await ca.post(`/api/curriculum/versions/${vid}/activate`)).status).toBe(409);
    expect((await ca.post(`/api/curriculum/versions/${vid}/subjects`).send({ subjectIds: [id(ctx.data.chem)] })).body.linked).toBe(1);
    expect((await Subject.findById(ctx.data.chem._id).lean())!.curriculumVersion).toBe('SHS 2027');
    const ed = await loginAs(E.editor);
    const u = await ed.post('/api/documents/upload').field('subjectId', id(ctx.data.chem)).field('curriculumVersionId', vid).attach('file', textPdf('chem'), 'chem.pdf'); expect(u.status).toBe(201); await drain();
    const d = (await ca.get(`/api/curriculum/versions/${vid}`)).body;
    expect(d.counts).toMatchObject({ subjects: 1, documents: 1 }); expect(d.counts.elements).toBe(await CurriculumNode.countDocuments({ curriculumVersionId: vid }));
    expect(d.documentsByStatus.indexed).toBe(1); expect(d.elementsByType.strand.total).toBeGreaterThan(0);
    expect((await ca.get(`/api/curriculum/documents?curriculumVersionId=${vid}`)).body.items.map((x: any) => x._id)).toEqual([u.body.document._id]);
    expect((await ca.patch(`/api/curriculum/versions/${vid}`).send({ code: 'SHS 2027.1' })).status).toBe(200);
    expect((await Subject.findById(ctx.data.chem._id).lean())!.curriculumVersion).toBe('SHS 2027.1');
    expect((await CurriculumDocument.findById(u.body.document._id).lean())!.curriculumVersion).toBe('SHS 2027.1');
    const blocked = await ca.post(`/api/curriculum/versions/${vid}/archive`); expect(blocked.status).toBe(409); expect(blocked.body.error.code).toBe('IN_USE');
    // subjects form: linking via the subjects config route also mirrors the label
    const sa = await loginAs('super@sample.ghlearn.test');
    const s = await sa.patch(`/api/config/subjects/${id(ctx.data.chem)}`).send({ curriculumVersionId: id(ctx.data.ver) });
    expect(s.status, JSON.stringify(s.body)).toBe(200); expect((await Subject.findById(ctx.data.chem._id).lean())!.curriculumVersion).toBe('SHS 2023+');
    expect((await ca.post(`/api/curriculum/versions/${vid}/archive`)).body.version.status).toBe('archived');
    // archived versions keep their links but take no new manuals/subjects
    expect((await CurriculumDocument.findById(u.body.document._id).lean())!.curriculumVersionId?.toString()).toBe(vid);
    expect((await ed.post('/api/documents/upload').field('curriculumVersionId', vid).attach('file', textPdf('late'), 'late.pdf')).status).toBe(409);
    expect((await sa.patch(`/api/config/subjects/${id(ctx.data.chem)}`).send({ curriculumVersionId: vid })).status).toBe(409);
    expect((await ca.post(`/api/curriculum/versions/${vid}/subjects`).send({ subjectIds: [id(ctx.data.chem)] })).status).toBe(409);
    expect((await ca.patch(`/api/curriculum/versions/${vid}`).send({ name: 'x' })).status).toBe(409);
    expect((await ca.post(`/api/curriculum/versions/${vid}/restore`)).body.version.status).toBe('draft');
  });
  it('delete: only unreferenced drafts', async () => {
    const ca = await loginAs(E.curriculum);
    const r = await ca.delete(`/api/curriculum/versions/${vid}`); expect(r.status).toBe(409); expect(JSON.stringify(r.body)).toMatch(/documents/);
    const t = (await ca.post('/api/curriculum/versions').send({ code: 'TMP-1', name: 'Temp' })).body.version;
    expect((await ca.delete(`/api/curriculum/versions/${t._id}`)).status).toBe(204);
    expect((await ca.delete(`/api/curriculum/versions/${id(ctx.data.ver)}`)).status).toBe(409);
  });
  it('migration turns free-text labels into version records and links them', async () => {
    const { migrateCurriculumVersions } = await import('../src/services/migrations.js');
    const s = await Subject.create({ name: 'Legacy Subject', code: 'LEG1', levelId: ctx.data.shs._id, category: 'elective', curriculumVersion: 'Legacy 2010' });
    await migrateCurriculumVersions(); await migrateCurriculumVersions();
    const v = await CurriculumVersion.find({ code: 'Legacy 2010' }).lean(); expect(v).toHaveLength(1); expect(v[0].status).toBe('active');
    expect(String((await Subject.findById(s._id).lean())!.curriculumVersionId)).toBe(id(v[0]));
    // a document's edition label ("Learner Version") is not a curriculum version: it moves to documentVersion
    const d = await CurriculumDocument.create({ title: 'Imported LM', curriculumVersion: 'Learner Version', storage: { provider: 'remote', key: 'x' } });
    const linked = await CurriculumDocument.create({ title: 'Imported legacy', curriculumVersion: 'Legacy 2010', storage: { provider: 'remote', key: 'y' } });
    await migrateCurriculumVersions();
    expect(await CurriculumVersion.countDocuments({ code: 'Learner Version' })).toBe(0);
    const d2 = await CurriculumDocument.findById(d._id).lean(); expect(d2!.documentVersion).toBe('Learner Version'); expect(d2!.curriculumVersion).toBeUndefined();
    expect(String((await CurriculumDocument.findById(linked._id).lean())!.curriculumVersionId)).toBe(id(v[0]));
  });
});

describe('permanent delete (super admin)', () => {
  it('is reference-checked, frees the stored file, and undoes a replacement', async () => {
    const ed = await loginAs(E.editor); const sa = await loginAs('super@sample.ghlearn.test');
    const v1 = (await ed.post('/api/documents/upload').attach('file', textPdf('del-v1'), 'del.pdf')).body.document; await drain();
    const v2 = (await ed.post(`/api/documents/${v1._id}/replace`).attach('file', textPdf('del-v2'), 'del2.pdf')).body.document; await drain();
    expect((await ed.delete(`/api/documents/${v2._id}`)).status).toBe(403);
    expect((await sa.delete(`/api/documents/${v1._id}`)).status).toBe(409); // superseded: history kept
    const key = (await CurriculumDocument.findById(v2._id).lean())!.storage!.key!;
    expect(await Job.countDocuments({ documentId: v2._id })).toBeGreaterThan(0);
    expect((await sa.delete(`/api/documents/${v2._id}`)).status).toBe(204);
    expect(await Job.countDocuments({ documentId: v2._id })).toBe(0); // its processing history goes with it
    expect(await gridfs.stat(key)).toBeNull(); expect(await DocumentPage.countDocuments({ documentId: v2._id })).toBe(0);
    expect((await CurriculumDocument.findById(v1._id).lean())!.supersededBy).toBeFalsy(); // v1 is current again
    await LearningResource.create({ title: 'SAMPLE cites v1', kind: 'notes', subjectId: ctx.data.phy._id, sourceDocumentId: v1._id, status: 'draft', isSample: true });
    const r = await sa.delete(`/api/documents/${v1._id}`); expect(r.status).toBe(409); expect(r.body.error.code).toBe('IN_USE');
    await LearningResource.deleteMany({ sourceDocumentId: v1._id });
    expect((await sa.delete(`/api/documents/${v1._id}`)).status).toBe(204);
  });
});
