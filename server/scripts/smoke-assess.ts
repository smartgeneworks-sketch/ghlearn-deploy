/**
 * REAL Gemini smoke test for Phase 5 (in-memory DB, SAMPLE data): ingest Biology sample -> lesson (new §7 A-K) ->
 * question generation (all types, cross-check, dedupe) -> review -> mock attempt with essay -> AI-provisional marking -> games.
 * Usage: npx tsx scripts/smoke-assess.ts /workspace/curriculum/sample/LM-Biology-section-1-LVersion.pdf
 */
import fs from 'node:fs';
import request from 'supertest';
import { connectDb, disconnectDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import { drain } from '../src/services/queue.js';
import { AiUsage, Question, User } from '../src/models/index.js';
import { hashPassword } from '../src/services/auth.js';
await connectDb(undefined); const d = await seed(); const app = createApp();
await User.create({ email: 'rev@sample.ghlearn.test', fullName: 'Reviewer', roles: ['content_reviewer'], passwordHash: await hashPassword(d.password) });
async function agent(email: string) { const a = request.agent(app); const t = (await a.get('/api/auth/csrf')).body.csrfToken; a.set('X-CSRF-Token', t); await a.post('/api/auth/login').send({ email, password: d.password }); return a; }
const ed = await agent('editor@sample.ghlearn.test'); const rev = await agent('rev@sample.ghlearn.test'); const ama = await agent('ama@sample.ghlearn.test');
const bio = String(d.bio._id);
const up = await ed.post('/api/documents/upload').field('subjectId', bio).field('yearOfStudy', '1').field('title', 'SAMPLE: Biology Y1 Learner Material Section 1').attach('file', fs.readFileSync(process.argv[2]), 'bio.pdf');
const docId = up.body.document._id; await drain(); await ed.patch(`/api/documents/${docId}`).send({ mappingStatus: 'confirmed' });
const topic = 'Classification of living organisms';
let t0 = Date.now();
const L = await ed.post('/api/lessons').send({ subjectId: bio, topic, yearOfStudy: 1, documentIds: [docId], controls: { length: 'medium', numQuizQuestions: 4 } }); await drain();
const lesson = (await ed.get(`/api/lessons/${L.body.lesson._id}`)).body.lesson;
fs.writeFileSync('/tmp/smoke-lesson5.json', JSON.stringify(lesson, null, 1));
console.log('LESSON', JSON.stringify({ status: lesson.status, seconds: Math.round((Date.now() - t0) / 1000), validation: lesson.validation }, null, 1));
for (const s of lesson.sections ?? []) console.log(`--- ${s.key} ${s.title} [${s.sourceSupport}] cites=${s.citations.length} data=${JSON.stringify(s.data ?? {}).slice(0, 260)}`);
if (lesson.validation?.ok) { await ed.post(`/api/lessons/${lesson._id}/submit`); await rev.post(`/api/lessons/${lesson._id}/review`).send({ action: 'approve' }); const p = await rev.post(`/api/lessons/${lesson._id}/publish`); console.log('PUBLISH', p.status); }
t0 = Date.now();
const G = await ed.post('/api/questions/generate').send({ subjectId: bio, topic, yearOfStudy: 1, documentIds: [docId], count: 12, types: ['mcq', 'true_false', 'short_answer', 'gap_fill', 'matching', 'ordering', 'diagram_labelling', 'numerical', 'structured', 'essay', 'case_study'] });
if (G.status !== 202) { console.log('generate failed', G.status, G.body); process.exit(1); }
await drain(); const job = (await ed.get(`/api/questions/jobs/${G.body.jobId}`)).body.job;
console.log('\nQUESTIONS job', job.status, Math.round((Date.now() - t0) / 1000) + 's', JSON.stringify({ ...job.result, questionIds: undefined }), job.errorLog?.map((e: any) => e.message));
const qs = await Question.find({ _id: { $in: job.result?.questionIds ?? [] } }).lean();
for (const q of qs) console.log(`* [${q.type}/${q.difficulty}] ${q.stem.slice(0, 110)}\n   ok=${q.validation?.ok} errors=${JSON.stringify(q.validation?.errors)} warnings=${JSON.stringify(q.validation?.warnings)} pages=${q.citations.map((c: any) => c.pageStart).join(',')}`);
let approved = 0; for (const q of qs) if (q.validation?.ok && !q.validation.warnings.some((w: string) => /disagreed/.test(w))) { const r = await rev.post(`/api/questions/${q._id}/review`).send({ action: 'approve' }); if (r.status === 200) approved++; }
console.log('approved', approved);
const at = (await ama.post('/api/practice/attempts').send({ subjectId: bio, mode: 'mock', count: 12 })).body.attempt;
if (!at) { console.log('no attempt'); process.exit(1); }
for (const q of at.questions) {
  const ans: any = q.type === 'mcq' ? 0 : q.type === 'true_false' ? true : q.type === 'essay' ? 'Living things are classified into groups based on shared features. Scientists use kingdoms such as plants and animals, and smaller groups down to species. For example, a goat and a sheep are both mammals because they have hair and feed young on milk. Classification helps us identify organisms and study them.'
    : ['structured', 'case_study'].includes(q.type) ? q.parts.map((p: any) => (p.type === 'mcq' ? 0 : p.type === 'essay' ? 'Grouping organisms by shared characteristics helps identification, for example separating plants and animals.' : 'kingdom')) : q.type === 'ordering' ? q.items.map((_: any, i: number) => i) : q.type === 'matching' ? q.left.map((_: any, i: number) => i) : q.type === 'gap_fill' ? Array(q.blanks).fill('species') : q.type === 'numerical' ? { value: 5 } : q.type === 'diagram_labelling' ? q.labels.map(() => 'nucleus') : 'kingdom';
  await ama.put(`/api/practice/attempts/${at._id}/responses/${q.id}`).send({ response: ans });
}
await ama.post(`/api/practice/attempts/${at._id}/submit`); await drain();
const res = (await ama.get(`/api/practice/attempts/${at._id}`)).body.attempt;
console.log('\nATTEMPT', JSON.stringify({ status: res.status, score: res.score, max: res.maxScore, provisional: res.provisional, revisionTopics: res.revisionTopics }));
for (const q of res.questions) console.log(`- ${q.type}: ${q.result?.score}/${q.result?.maxScore} by ${q.result?.markedBy}${q.result?.needsReview ? ' (needs teacher review)' : ''} :: ${String(q.result?.feedback).slice(0, 220)}${q.result?.criteria?.length ? ' criteria=' + JSON.stringify(q.result.criteria) : ''}`);
const games = (await ama.get('/api/games')).body.games;
for (const g of games) { const r = await ama.post('/api/games/sessions').send({ subjectId: bio, game: g.key }); console.log(`GAME ${g.key}: ${r.status} ${r.status === 201 ? r.body.session.items.length + ' items' : r.body.error?.code}`); }
console.log('\nUSAGE', JSON.stringify(await AiUsage.aggregate([{ $group: { _id: { p: '$purpose', s: '$status' }, n: { $sum: 1 }, inTok: { $sum: '$inputTokens' }, outTok: { $sum: '$outputTokens' }, ms: { $avg: '$latencyMs' } } }])));
await disconnectDb();
