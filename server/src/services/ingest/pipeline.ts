import { embedRecorded } from '../usage.js';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { CurriculumDocument, DocumentPage, CurriculumNode, Chunk, Job } from '../../models/index.js';
import { readObject } from '../storage.js';
import { getEmbeddingProvider, getOcrProvider } from '../ai.js';
import { getSettings } from '../platformSettings.js';
import { config } from '../../config.js';
import { registerJob, registerDeadHandler, PermanentJobError, enqueue, type JobCtx } from '../queue.js';
import { isPdf, openPdf, itemsToText, renderPagePng, countFigures, type ExtractedPage } from './pdf.js';
import { extractDocx, extractTxt, extractCsv, FormatError } from './textFormats.js';
import { detectStructure, parentIndexes, boilerplateLines } from './structure.js';
import { chunkPages } from './chunker.js';
import { toStoredVector } from '../../lib/vector.js';
export const MIN_TEXT_CHARS = 25;

/** Gives the event loop back between pages so API requests are answered while a manual is processed; bulk runs add a pause. */
const breathe = (ms = 0) => new Promise((r) => setTimeout(r, ms));
export async function processDocument(documentId: string, ctx: JobCtx, opts: { throttleMs?: number } = {}) {
  const doc = await CurriculumDocument.findById(documentId);
  if (!doc) throw new PermanentJobError('Document not found');
  const t0 = Date.now(); const warnings: string[] = [];
  // Fence: only the document's current job, while it still holds its lease, may write output. A superseded or
  // re-claimed run stops here instead of writing a second copy of the passages.
  const fence = async () => {
    const [cur, me] = await Promise.all([CurriculumDocument.findById(documentId, { lastJobId: 1 }).lean(), Job.findById(ctx.jobId, { status: 1, attempts: 1 }).lean()]);
    if (me && (me.status !== 'running' || me.attempts !== ctx.attempt)) throw new PermanentJobError('This run lost its lease to a newer attempt and stopped without writing output');
    if (me && cur?.lastJobId && String(cur.lastJobId) !== ctx.jobId) throw new PermanentJobError('A newer processing run for this manual replaced this one; it stopped without writing output');
  };
  const set = async (processingStatus: string, pct?: number) => { doc.processingStatus = processingStatus as any; await doc.save(); await ctx.progress(processingStatus, pct); };
  await set('extracting', 5);
  const buf = await readObject(doc.storage ?? {}, doc.provenance?.sourceUrl, doc.provenance?.driveFileId);
  const kind = doc.fileKind ?? 'pdf';
  if (kind === 'pdf' && !isPdf(buf)) throw new PermanentJobError('File is not a valid PDF');
  const checksum = crypto.createHash('sha256').update(buf).digest('hex');
  if (doc.provenance?.checksum && doc.provenance.checksum !== checksum) warnings.push('Checksum differs from the value recorded at import (file changed at source)');
  doc.set('provenance.checksum', checksum); doc.sizeBytes = buf.length;
  let pages: ExtractedPage[] = []; const ocrQueue: number[] = []; let ocrDone = 0; let ocrSkipped = 0; let extra: Record<string, unknown> = {};
  if (kind !== 'pdf') {
    // DOCX, TXT, CSV: text formats have no scanned pages, so OCR is never needed.
    try {
      const r = kind === 'docx' ? await extractDocx(buf) : kind === 'txt' ? extractTxt(buf) : extractCsv(buf);
      pages = r.pages; doc.pageUnit = r.unit; if ('rows' in r) extra = { csvRows: r.rows };
    } catch (e: any) { throw new PermanentJobError(e instanceof FormatError ? e.message : `File could not be read: ${e?.message ?? e}`); }
    doc.pageCount = pages.length; doc.ocrStatus = 'not_needed';
    await ctx.progress('extracting', undefined, { current: pages.length, total: pages.length, unit: `${doc.pageUnit ?? 'page'}s` });
  } else {
  doc.pageUnit = 'page';
  let pdf: any;
  try { pdf = await openPdf(buf); } catch (e: any) { throw new PermanentJobError(`PDF could not be parsed: ${e?.message ?? e}`); }
  doc.pageCount = pdf.numPages;

  // 1. text layer per page
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const text = itemsToText((await page.getTextContent()).items as any); const figures = await countFigures(page);
    if (text.replace(/\s/g, '').length >= MIN_TEXT_CHARS) pages.push({ page: n, text, method: 'text', figures });
    else { pages.push({ page: n, text, method: 'empty', figures }); ocrQueue.push(n); }
    page.cleanup(); await breathe(opts.throttleMs ?? 0);
    if (n % 5 === 0 || n === pdf.numPages) await ctx.progress('extracting', undefined, { current: n, total: pdf.numPages, unit: 'pages' });
  }
  // 2. OCR fallback for pages with no usable text layer
  const upl = (await getSettings()).uploads; // §20: OCR can be switched off and capped below OCR_MAX_PAGES
  const ocr = upl.ocrEnabled ? getOcrProvider() : null;
  if (ocrQueue.length) {
    if (!ocr) { for (const n of ocrQueue) pages[n - 1].method = 'ocr_unavailable'; warnings.push(`${ocrQueue.length} page(s) have no text layer and OCR is disabled (${upl.ocrEnabled ? 'set OCR_PROVIDER=tesseract' : 'switched off in System settings'})`); }
    else {
      await set('ocr');
      const ocrMax = Math.min(upl.ocrMaxPages, config.OCR_MAX_PAGES); const todo = ocrQueue.slice(0, ocrMax); ocrSkipped = ocrQueue.length - todo.length; let k = 0;
      if (ocrSkipped) warnings.push(`OCR limited to ${todo.length} of ${ocrQueue.length} pages (OCR page limit)`);
      for (const n of todo) {
        try { const r = await ocr.recognize(await renderPagePng(await pdf.getPage(n)));
          pages[n - 1] = { ...pages[n - 1], page: n, text: r.text.trim(), method: r.text.trim().length >= MIN_TEXT_CHARS ? 'ocr' : 'empty', ocrConfidence: r.confidence }; ocrDone++;
        } catch (e: any) { ocrSkipped++; warnings.push(`OCR failed on page ${n}: ${e?.message ?? e}`); }
        await ctx.progress('ocr', undefined, { current: ++k, total: todo.length, unit: 'pages' });
      }
    }
  }
  await pdf.destroy();
  // Scanned = most pages have no text layer. The OCR status is reported as it is; nothing is invented when OCR is off.
  doc.ocrStatus = !ocrQueue.length ? 'not_needed' : !ocr ? 'needed_not_configured' : ocrSkipped ? 'partial' : 'done';
  extra = { scanned: ocrQueue.length >= Math.max(1, Math.ceil(pdf.numPages * 0.5)), pagesWithoutTextLayer: ocrQueue.length };
  }
  // Replace any previous output (re-processing is idempotent; a unique (document, ordinal) index backs this up)
  await fence();
  await Promise.all([DocumentPage.deleteMany({ documentId }), CurriculumNode.deleteMany({ documentId, 'detection.confidence': { $ne: 'manual' } }), Chunk.deleteMany({ documentId })]);
  await DocumentPage.insertMany(pages.map((p) => ({ documentId, page: p.page, text: p.text, method: p.method, charCount: p.text.length, ocrConfidence: p.ocrConfidence, figures: p.figures ?? 0 })));

  // 3. structure
  await set('structuring');
  const usable = pages.filter((p) => p.method === 'text' || p.method === 'ocr');
  const detected = detectStructure(usable); const parents = parentIndexes(detected);
  const nodeIds = detected.map(() => new mongoose.Types.ObjectId());
  await CurriculumNode.insertMany(detected.map((n, i) => ({ _id: nodeIds[i], documentId, subjectId: doc.subjectId, curriculumVersionId: doc.curriculumVersionId, type: n.type, code: n.code, title: n.title, page: n.page, order: i,
    parentId: parents[i] >= 0 ? nodeIds[parents[i]] : undefined, detection: { rule: n.rule, confidence: n.confidence, line: n.line }, verified: false })));

  // 4. chunking
  await set('chunking');
  const boiler = boilerplateLines(usable);
  const drafts = chunkPages(usable, detected, parents, boiler);
  const chunkDocs = drafts.map((c) => ({ _id: new mongoose.Types.ObjectId(), documentId, subjectId: doc.subjectId, ordinal: c.ordinal, pageStart: c.pageStart, pageEnd: c.pageEnd,
    nodeIds: c.nodeIdx.map((i) => nodeIds[i]), headingPath: c.nodeIdx.map((i) => detected[i].title), text: c.text, charCount: c.text.length, embeddingStatus: 'pending' }));
  await Chunk.insertMany(chunkDocs);

  // 5. embeddings
  let embedding: Record<string, unknown> = { status: 'disabled', reason: 'No embedding provider configured' };
  const provider = getEmbeddingProvider();
  if (!provider) await Chunk.updateMany({ documentId }, { embeddingStatus: 'disabled' });
  else {
    await set('embedding'); await ctx.progress('embedding', undefined, { current: 0, total: chunkDocs.length, unit: 'passages' });
    try {
      const B = 50;
      for (let i = 0; i < chunkDocs.length; i += B) {
        const batch = chunkDocs.slice(i, i + B);
        const vecs = await embedRecorded(provider, batch.map((c) => [c.headingPath.join(' > '), c.text].filter(Boolean).join('\n')), 'document', { refId: String(documentId) });
        await Chunk.bulkWrite(batch.map((c, k) => ({ updateOne: { filter: { _id: c._id }, update: { embedding: toStoredVector(vecs[k]), embeddingModel: `${provider.name}:${provider.model}`, embeddingStatus: provider.isTestOnly ? 'test_only' : 'done' } } })));
        await ctx.progress('embedding', undefined, { current: Math.min(i + B, chunkDocs.length), total: chunkDocs.length, unit: 'passages' });
      }
      embedding = { status: provider.isTestOnly ? 'test_only' : 'done', provider: provider.name, model: provider.model, dimensions: provider.dimensions };
    } catch (e: any) {
      await Chunk.updateMany({ documentId, embeddingStatus: 'pending' }, { embeddingStatus: 'failed' });
      // Rate-limit/outage: chunks and text remain usable; mark and let the job retry.
      if (ctx.attempt < 3) throw e;
      embedding = { status: 'failed', error: String(e?.message ?? e).slice(0, 300) }; warnings.push('Embedding failed; re-run processing later');
    }
  }
  const count = (m: string) => pages.filter((p) => p.method === m).length;
  const report = {
    finishedAt: new Date(), durationMs: Date.now() - t0, pageCount: pages.length, checksum, fileKind: kind, pageUnit: doc.pageUnit, ocrStatus: doc.ocrStatus, ...extra,
    figures: pages.reduce((a, p) => a + (p.figures ?? 0), 0),
    pages: { text: count('text'), ocr: count('ocr'), empty: count('empty'), ocrUnavailable: count('ocr_unavailable') },
    lowTextPages: pages.filter((p) => p.method !== 'text' && p.method !== 'ocr').map((p) => p.page).slice(0, 200),
    ocrMeanConfidence: count('ocr') ? Math.round(pages.filter((p) => p.ocrConfidence != null).reduce((a, p) => a + (p.ocrConfidence ?? 0), 0) / count('ocr')) : null,
    structure: detected.reduce<Record<string, number>>((a, n) => ((a[n.type] = (a[n.type] ?? 0) + 1), a), {}),
    structureNote: 'Detected headings are unverified until confirmed by a curriculum editor.',
    boilerplateLinesRemoved: boiler.size, chunks: chunkDocs.length, totalChars: chunkDocs.reduce((a, c) => a + c.charCount, 0), embedding, warnings,
  };
  await fence();
  doc.processingReport = report; doc.processingStatus = 'indexed'; await doc.save();
  // Summary kept on the job for the processing monitor (the document's report stays the detailed source).
  return { chunks: chunkDocs.length, pages: pages.length, pageUnit: doc.pageUnit, fileKind: kind, ocrStatus: doc.ocrStatus,
    extraction: report.pages, nodes: detected.length, embedding: (embedding as any).status, warnings: warnings.length };
}

registerJob('document.process', (p, ctx) => processDocument(p.documentId, ctx, { throttleMs: p.throttleMs }));
registerDeadHandler('document.process', async (p, message) => {
  await CurriculumDocument.updateOne({ _id: p.documentId }, { processingStatus: 'failed', processingReport: { failedAt: new Date(), error: message } });
});
export async function queueProcessing(documentId: string, userId?: string, opts: { retryOf?: string; throttleMs?: number } = {}) {
  // The document points at the job before the job exists, so the run's fence never sees a stale lastJobId.
  const _id = new mongoose.Types.ObjectId();
  await CurriculumDocument.updateOne({ _id: documentId }, { processingStatus: 'queued', lastJobId: _id });
  return enqueue('document.process', { documentId, ...(opts.throttleMs ? { throttleMs: opts.throttleMs } : {}) }, { maxAttempts: 3, createdBy: userId, retryOf: opts.retryOf, _id: String(_id) });
}
