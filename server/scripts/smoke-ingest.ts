/** Real end-to-end ingest of one PDF with the configured providers (in-memory DB). Usage: npx tsx scripts/smoke-ingest.ts file.pdf */
import fs from 'node:fs';
import { connectDb, disconnectDb } from '../src/db.js';
import { CurriculumDocument, Chunk } from '../src/models/index.js';
import { uploadStore } from '../src/services/storage.js';
import { queueProcessing } from '../src/services/ingest/pipeline.js';
import { drain } from '../src/services/queue.js';
await connectDb(undefined);
const buf = fs.readFileSync(process.argv[2]);
const doc = await CurriculumDocument.create({ title: 'smoke', storage: await uploadStore().put(buf, { filename: 'smoke.pdf', contentType: 'application/pdf' }) });
await queueProcessing(String(doc._id)); await drain();
const d = await CurriculumDocument.findById(doc._id).lean();
const c = await Chunk.findOne({ documentId: doc._id }).select('+embedding').lean();
console.log(JSON.stringify({ status: d!.processingStatus, report: d!.processingReport, firstChunkDims: c?.embedding?.length, model: c?.embeddingModel, embeddingStatus: c?.embeddingStatus }, null, 1));
await disconnectDb();
