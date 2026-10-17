/** Browser E2E backend: in-memory MongoDB, SAMPLE seed, scripted test LLM (NODE_ENV=test only). Never used in production. */
import fs from 'node:fs';
import { connectDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed } from '../src/seed.js';
import { testLlm, ProviderError } from '../src/services/ai.js';
import { lessonResponder } from '../test/llmfake.js';
import { curriculumPdf } from '../test/fixtures.js';
if (process.env.NODE_ENV !== 'test' || process.env.LLM_PROVIDER !== 'test-llm') throw new Error('run with NODE_ENV=test LLM_PROVIDER=test-llm');
await connectDb();
await seed('SamplePass2026');
const base = lessonResponder();
/** Same scripted lesson as the unit tests, minus the deliberately broken parts (bad diagram, unknown citation). */
const lesson = (req: any) => { const o = JSON.parse(base(req)); for (const sec of o.sections) {
  if (sec.key === 'F') sec.data.diagrams = [{ kind: 'flow', title: 'Path of light in a microscope', caption: 'Path of light', alt: 'Light passes from mirror to lens to eye', steps: ['Mirror', 'Lens', 'Eye'] }];
  if (sec.key === 'D') sec.citations = ['S1'];
  if (sec.key === 'B') sec.data.objectives = ['State the functions of the cell membrane', 'Describe the parts of a plant cell'];
} return JSON.stringify(o); };
testLlm.respond = (req) => {
  // E2E fixture for a provider that rejects the request (non-retryable): the generation fails at once and can be retried or deleted
  if (/Topic: [^\n]*E2E rejected request/.test(req.messages.at(-1)?.content ?? '')) throw new ProviderError('test-llm.generate failed: HTTP 400 request rejected by the test provider', 400, true);
  // §13 question generation and the answer-key cross-check (scripted: one MCQ per request, citing S1)
  if (/You write assessment questions/.test(req.system)) { const topic = (req.messages.at(-1)?.content ?? '').match(/Topic: ([^\n.]*)/)?.[1] ?? 'the topic';
    return JSON.stringify({ questions: [{ type: 'mcq', stem: `In the study of ${topic}, which quantity tells you how fast an object moves?`, difficulty: 'easy', citations: ['S1'], explanation: 'Speed is distance travelled per unit time.', hint: 'Think of distance and time.', data: { options: ['Speed', 'Mass', 'Colour', 'Volume'], correctIndex: 0 } }] }); }
  if (/checking an exam answer key/.test(req.system)) { const qs = JSON.parse((req.messages[0].content.match(/QUESTIONS: (\[.*\])/) ?? [, '[]'])[1]); return JSON.stringify({ answers: qs.map((q: any) => ({ id: q.id, answer: 0 })) }); }
  return respond0(req);
};
const respond0 = (req: any) => (/"key": one of/.test(req.messages.at(-1)?.content ?? '') ? lesson(req)
  : 'The cell membrane controls what enters and leaves the cell [S1].\n\nGeneral knowledge (not from your curriculum materials): membranes are made of lipids.');
fs.writeFileSync(process.env.E2E_PDF ?? '/tmp/e2e-manual.pdf', curriculumPdf());
const { startWorker } = await import('../src/services/queue.js');
await import('../src/services/ingest/pipeline.js');
startWorker();
// SMS: in-memory fake provider (no real texts). SMS stays off until a spec sets a sender ID; the outbox is readable on a
// separate local port so no test-only route is added to the app.
const sms = await import('../src/services/sms.js');
sms.setSmsAdapterForTest(sms.testAdapter());
const http = await import('node:http');
http.createServer((req, res) => {
  if (req.method === 'DELETE') sms.testOutbox.length = 0;
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(sms.testOutbox));
}).listen(Number(process.env.SMS_OUTBOX_PORT ?? 8788), '127.0.0.1');
const port = Number(process.env.PORT ?? 8787);
createApp().listen(port, () => console.log(`e2e api on :${port}`));
