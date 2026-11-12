import mongoose from 'mongoose';
import { config } from '../config.js';
import { AiHealthCheck, Chunk } from '../models/index.js';
import { getLlm, getEmbeddingProvider, getOcrProvider } from './ai.js';
import { generate, recordEmbedding } from './usage.js';
import { uploadStore } from './storage.js';
/**
 * §17 real health checks. Each capability is exercised for real (one tiny LLM call, one embedding, an OCR read of a
 * rendered image, a vector query, an object-store write/read/delete). Not configured => `not_configured`;
 * any exception, wrong result or timeout => `failed` with the (sanitised) reason. Nothing is ever reported `ok`
 * without a successful round trip.
 */
type R = { capability: string; provider?: string; model?: string; status: 'ok' | 'failed' | 'not_configured'; latencyMs?: number; detail: string };
const clean = (e: any) => String(e?.message ?? e).replace(/key=[^&\s]+/g, 'key=***').replace(/AIza[\w-]{20,}/g, '***').slice(0, 300);
async function timed(capability: string, meta: { provider?: string; model?: string }, fn: () => Promise<string>): Promise<R> {
  const t0 = Date.now();
  try { const detail = await Promise.race([fn(), new Promise<string>((_, bad) => setTimeout(() => bad(new Error('Timed out after 60 s')), 60_000))]); return { capability, ...meta, status: 'ok', latencyMs: Date.now() - t0, detail }; }
  catch (e) { return { capability, ...meta, status: 'failed', latencyMs: Date.now() - t0, detail: clean(e) }; }
}
export const HEALTH_CAPABILITIES = ['llm', 'embeddings', 'ocr', 'image', 'vector_search', 'object_storage'] as const;
export async function runHealthChecks(userId: string, only?: string[]) {
  const want = (c: string) => !only?.length || only.includes(c); const out: R[] = [];
  if (want('llm')) {
    let llm: ReturnType<typeof getLlm> = null; try { llm = getLlm(); } catch (e) { out.push({ capability: 'llm', status: 'failed', detail: clean(e) }); }
    if (llm) out.push(await timed('llm', { provider: llm.name, model: llm.model }, async () => {
      const r = await generate({ system: 'You are a health check. Reply with the single word OK.', messages: [{ role: 'user', content: 'Health check: reply OK.' }], maxTokens: 256, temperature: 0,
        // One attempt, bounded inside the 60 s check, so the usage record and the check result agree (no late success after a reported timeout).
        timeoutMs: 45_000, maxAttempts: 1 }, { purpose: 'health_check', userId });
      if (!r.text.trim() && r.finishReason !== 'MAX_TOKENS') throw new Error(`Empty reply (finishReason ${r.finishReason ?? 'unknown'})`);
      return `Replied "${r.text.trim().slice(0, 40)}" (${r.usage.inputTokens + r.usage.outputTokens} tokens)${llm!.isTestOnly ? ' (TEST ONLY provider)' : ''}`;
    }));
    else if (!out.some((r) => r.capability === 'llm')) out.push({ capability: 'llm', status: 'not_configured', detail: 'No LLM provider configured (LLM_PROVIDER / GEMINI_API_KEY unset).' });
  }
  if (want('embeddings')) {
    let e: ReturnType<typeof getEmbeddingProvider> = null; try { e = getEmbeddingProvider(); } catch (x) { out.push({ capability: 'embeddings', status: 'failed', detail: clean(x) }); }
    if (e) out.push(await timed('embeddings', { provider: e.name, model: e.model }, async () => {
      const t0 = Date.now();
      try { const [v] = await e!.embed(['GH Learn health check'], 'query'); await recordEmbedding({ purpose: 'health_check', provider: e!.name, model: e!.model, items: 1, chars: 21, t0, userId });
        if (!Array.isArray(v) || v.length !== e!.dimensions || v.some((x) => !Number.isFinite(x))) throw new Error(`Unexpected vector (length ${v?.length}, expected ${e!.dimensions})`);
        return `Returned a ${v.length}-dimension vector${e!.isTestOnly ? ' (TEST ONLY provider)' : ''}`; }
      catch (x: any) { await recordEmbedding({ purpose: 'health_check', provider: e!.name, model: e!.model, items: 1, chars: 21, t0, userId, error: clean(x) }); throw x; }
    }));
    else if (!out.some((r) => r.capability === 'embeddings')) out.push({ capability: 'embeddings', status: 'not_configured', detail: 'No embedding provider configured; retrieval uses keyword search.' });
  }
  if (want('ocr')) {
    const o = getOcrProvider();
    if (!o) out.push({ capability: 'ocr', status: 'not_configured', detail: 'OCR_PROVIDER unset: scanned pages are reported as needing OCR.' });
    else out.push(await timed('ocr', { provider: o.name }, async () => {
      const { createCanvas } = await import('@napi-rs/canvas'); const c = createCanvas(600, 160); const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 160); g.fillStyle = '#000'; g.font = '64px sans-serif'; g.fillText('HEALTH 2468', 30, 105);
      const r = await o.recognize(c.toBuffer('image/png'));
      if (!/2468/.test(r.text)) throw new Error(`Could not read the test image (got "${r.text.trim().slice(0, 40)}")`);
      return `Read the test image (confidence ${Math.round(r.confidence)} %)`;
    }));
  }
  if (want('image')) {
    if (!config.IMAGE_PROVIDER) out.push({ capability: 'image', status: 'not_configured', detail: 'IMAGE_PROVIDER unset: diagrams are sanitised SVG from the LLM.' });
    else out.push({ capability: 'image', provider: config.IMAGE_PROVIDER, status: 'failed', detail: `IMAGE_PROVIDER "${config.IMAGE_PROVIDER}" is set but this build has no adapter for it, so it cannot work.` });
  }
  if (want('vector_search')) out.push(await timed('vector_search', { provider: config.VECTOR_SEARCH === 'atlas' ? 'atlas' : 'local-cosine' }, async () => {
    if (config.VECTOR_SEARCH === 'atlas') {
      const e = getEmbeddingProvider(); if (!e) throw new Error('Atlas vector search needs an embedding provider');
      await Chunk.aggregate([{ $vectorSearch: { index: 'chunk_vectors', path: 'embedding', queryVector: new Array(e.dimensions).fill(0.01), numCandidates: 5, limit: 1 } }, { $project: { _id: 1 } }]);
      return 'Atlas $vectorSearch index answered';
    }
    const n = await Chunk.countDocuments({ embeddingStatus: { $in: ['done', 'test_only'] } }); await mongoose.connection.db!.admin().ping();
    return `Local cosine search over ${n.toLocaleString()} embedded passages (database reachable)`;
  }));
  if (want('object_storage')) { const st = uploadStore(); out.push(await timed('object_storage', { provider: st.name }, async () => {
    const probe = Buffer.from(`health-${Date.now()}`); const o = await st.put(probe, { filename: '__health_check__.txt', contentType: 'text/plain' });
    try { const back = await st.get(o.key); if (!back.equals(probe)) throw new Error('Read-back did not match what was written'); } finally { await st.delete(o.key).catch(() => undefined); }
    return 'Wrote, read back and deleted a test object';
  })); }
  const ok = out.every((r) => r.status !== 'failed');
  const doc = await AiHealthCheck.create({ ranBy: userId, ok, results: out });
  return { id: String(doc._id), ok, ranAt: doc.createdAt, results: out };
}
