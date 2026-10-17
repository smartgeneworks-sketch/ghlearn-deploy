/**
 * REAL end-to-end AI smoke test (uses GEMINI_API_KEY; in-memory DB with SAMPLE data):
 * ingest Biology sample -> confirm mapping -> generate lesson (queue) -> print validation -> tutor question (SSE).
 * Usage: npx tsx scripts/smoke-ai.ts /workspace/curriculum/sample/LM-Biology-section-1-LVersion.pdf
 */
import fs from 'node:fs';
import request from 'supertest';
import { connectDb, disconnectDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import { drain } from '../src/services/queue.js';
import { AiUsage } from '../src/models/index.js';
await connectDb(undefined); const d = await seed(); const app = createApp();
async function agent(email: string) { const a = request.agent(app); const t = (await a.get('/api/auth/csrf')).body.csrfToken; a.set('X-CSRF-Token', t); await a.post('/api/auth/login').send({ email, password: d.password }); return a; }
const ed = await agent('editor@sample.ghlearn.test');
const up = await ed.post('/api/documents/upload').field('subjectId', String(d.bio._id)).field('yearOfStudy', '1').field('title', 'SAMPLE: Biology Y1 Learner Material Section 1').attach('file', fs.readFileSync(process.argv[2]), 'bio.pdf');
const docId = up.body.document._id; await drain();
await ed.patch(`/api/documents/${docId}`).send({ mappingStatus: 'confirmed' });
const t0 = Date.now();
const L = await ed.post('/api/lessons').send({ subjectId: String(d.bio._id), topic: 'The scientific method and its use in solving everyday problems', yearOfStudy: 1, documentIds: [docId], controls: { length: 'medium', numExercises: 4, numQuizQuestions: 4 } });
if (L.status !== 202) { console.log('create failed', L.status, L.body); process.exit(1); }
await drain();
const lesson = (await ed.get(`/api/lessons/${L.body.lesson._id}`)).body;
console.log('LESSON', JSON.stringify({ status: lesson.lesson.status, title: lesson.lesson.title, seconds: Math.round((Date.now() - t0) / 1000), model: lesson.lesson.aiModel, job: lesson.job?.status, jobErrors: lesson.job?.errorLog, validation: lesson.lesson.validation }, null, 1));
for (const s of lesson.lesson.sections ?? []) console.log(`--- ${s.key} ${s.title} [${s.sourceSupport}] cites=${s.citations.map((c: any) => `p${c.pageStart}-${c.pageEnd}`).join(',')}\n${String(s.content).slice(0, 400)}${s.data && Object.keys(s.data).length ? `\n  data: ${JSON.stringify(s.data).slice(0, 300)}` : ''}`);
fs.writeFileSync('/tmp/smoke-lesson.json', JSON.stringify(lesson.lesson, null, 1));
const ama = await agent('ama@sample.ghlearn.test');
const conv = (await ama.post('/api/tutor/conversations').send({ subjectId: String(d.bio._id) })).body.conversation;
for (const [q, mode] of [['What are the steps of the scientific method? Explain with an example.', 'explain'], ['How do I tell if an organism has radial or bilateral symmetry?', 'hint']]) {
  const r = await ama.post(`/api/tutor/conversations/${conv._id}/messages`).send({ content: q, mode }).buffer(true).parse((res: any, cb: any) => { let s = ''; res.on('data', (c: any) => (s += c)); res.on('end', () => cb(null, s)); });
  const evs = String(r.body).split('\n\n').filter(Boolean).map((b) => ({ e: b.match(/^event: (.*)$/m)?.[1], d: JSON.parse(b.match(/^data: (.*)$/m)![1]) }));
  const done = evs.at(-1)!;
  console.log(`\nTUTOR (${mode}) Q: ${q}\nstream events: ${evs.filter((x) => x.e === 'delta').length} deltas; final: ${done.e} answerType=${done.d.answerType}\ncitations: ${(done.d.citations ?? []).map((c: any) => `p${c.pageStart}-${c.pageEnd}`).join(', ')}\n${done.d.text ?? done.d.message}`);
}
console.log('\nUSAGE', JSON.stringify(await AiUsage.find().select('purpose model inputTokens outputTokens thoughtTokens latencyMs status -_id').lean()));
await disconnectDb();
