/**
 * Provider-independent AI layer. Adapters are chosen by env; nothing is hard-coded at call sites.
 * Unconfigured capability => `disabled` (callers surface that honestly; never faked).
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface LlmProvider { name: string; complete(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number; json?: boolean }): Promise<string> }
export interface EmbeddingProvider { name: string; model: string; dimensions: number; isTestOnly?: boolean; embed(texts: string[], task?: 'document' | 'query'): Promise<number[][]> }
export interface OcrProvider { name: string; recognize(png: Buffer): Promise<{ text: string; confidence: number }> }
export interface ImageProvider { name: string; generate(prompt: string, opts?: { size?: string }): Promise<Buffer> }
/** A provider HTTP error. `permanent` (4xx other than 429: bad request, auth, model not found) makes jobs fail at once instead of spending quota on retries. */
export class ProviderError extends Error { constructor(message: string, public status: number, public permanent: boolean) { super(message); } }
export class AiUnavailableError extends Error { constructor(public capability: string) { super(`${capability} provider is not configured`); } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Bounded retry for free-tier rate limits (429) and transient 5xx, honouring Retry-After. */
export interface CallStats { retries: number; rateLimitHits: number; httpStatus?: number }
export async function withRetry<T>(fn: () => Promise<Response>, parse: (r: Response) => Promise<T>, label: string, max = 5, stats?: CallStats): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const r = await fn();
    if (stats) { stats.httpStatus = r.status; if (r.status === 429) stats.rateLimitHits++; if (attempt > 1) stats.retries = attempt - 1; }
    if (r.ok) return parse(r);
    const retryable = r.status === 429 || r.status >= 500;
    const body = (await r.text().catch(() => '')).slice(0, 300);
    if (!retryable || attempt >= max) throw new ProviderError(`${label} failed: HTTP ${r.status} ${body.replace(/key=[^&\s]+/g, 'key=***')}`, r.status, !retryable);
    const ra = Number(r.headers.get('retry-after')); const wait = ra > 0 ? ra * 1000 : Math.min(60_000, 2000 * 2 ** (attempt - 1)) + Math.random() * 500;
    logger.warn({ label, status: r.status, attempt, wait }, 'AI provider retry'); await sleep(wait);
  }
}

const geminiKey = () => config.EMBEDDING_API_KEY || config.GEMINI_API_KEY;
class GeminiEmbeddings implements EmbeddingProvider {
  name = 'gemini'; model = config.EMBEDDING_MODEL || 'gemini-embedding-001'; dimensions = config.EMBEDDING_DIMENSIONS || 768;
  async embed(texts: string[], task: 'document' | 'query' = 'document') {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 50) { // batch size kept small for free-tier quotas
      const batch = texts.slice(i, i + 50);
      const res = await withRetry(() => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey()! }, signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ requests: batch.map((t) => ({ model: `models/${this.model}`, content: { parts: [{ text: t.slice(0, 8000) }] }, outputDimensionality: this.dimensions, taskType: task === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT' })) }),
      }), (r) => r.json() as Promise<{ embeddings: { values: number[] }[] }>, 'gemini.embed');
      out.push(...res.embeddings.map((e) => e.values));
    }
    return out;
  }
}
class OpenAiCompatEmbeddings implements EmbeddingProvider {
  name = 'openai-compatible'; model = config.EMBEDDING_MODEL || 'text-embedding-3-small'; dimensions = config.EMBEDDING_DIMENSIONS || 1536;
  async embed(texts: string[]) {
    const res = await withRetry(() => fetch(`${config.EMBEDDING_BASE_URL || 'https://api.openai.com/v1'}/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.EMBEDDING_API_KEY}` },
      body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dimensions }) }), (r) => r.json() as Promise<{ data: { embedding: number[] }[] }>, 'openai.embed');
    return res.data.map((d) => d.embedding);
  }
}
/** Deterministic hashed bag-of-words vectors. TEST ONLY: refuses to load outside NODE_ENV=test. */
class TestHashEmbeddings implements EmbeddingProvider {
  name = 'test-hash'; model = 'test-hash-64'; dimensions = 64; isTestOnly = true;
  async embed(texts: string[]) {
    return texts.map((t) => { const v = new Array(64).fill(0); for (const w of t.toLowerCase().match(/[a-z]{3,}/g) ?? []) v[crypto.createHash('md5').update(w).digest()[0] % 64] += 1;
      const n = Math.hypot(...v) || 1; return v.map((x) => x / n); });
  }
}
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const p = config.EMBEDDING_PROVIDER || (config.GEMINI_API_KEY ? 'gemini' : '');
  if (p === 'test-hash') { if (config.NODE_ENV !== 'test') throw new Error('test-hash embeddings are only allowed in tests'); return new TestHashEmbeddings(); }
  if (p === 'gemini' && geminiKey()) return new GeminiEmbeddings();
  if (p === 'openai-compatible' && config.EMBEDDING_API_KEY) return new OpenAiCompatEmbeddings();
  return null;
}

class TesseractOcr implements OcrProvider {
  name = 'tesseract'; private worker: any = null;
  async recognize(png: Buffer) {
    if (!this.worker) { const { createWorker } = await import('tesseract.js'); this.worker = await createWorker(config.OCR_LANG, 1, { cachePath: process.env.OCR_CACHE_DIR ?? '/tmp/tesseract-cache', langPath: process.env.OCR_LANG_PATH }); }
    const { data } = await this.worker.recognize(png); return { text: data.text as string, confidence: data.confidence as number };
  }
  async terminate() { await this.worker?.terminate(); this.worker = null; }
}
let ocr: TesseractOcr | null = null;
export function getOcrProvider(): (OcrProvider & { terminate?: () => Promise<void> }) | null {
  if (config.OCR_PROVIDER === 'tesseract') return (ocr ??= new TesseractOcr());
  return null;
}

export const aiStatus = () => {
  const e = (() => { try { return getEmbeddingProvider(); } catch { return null; } })();
  return {
    llm: (() => { try { const l = getLlm(); return l ? `${l.name}:${l.model}${l.isTestOnly ? ' (TEST ONLY)' : ''}` : 'disabled'; } catch { return 'disabled'; } })(),
    embeddings: e ? `${e.name}:${e.model}${e.isTestOnly ? ' (TEST ONLY)' : ''}` : 'disabled',
    ocr: config.OCR_PROVIDER || 'disabled',
    image: config.IMAGE_PROVIDER && config.IMAGE_API_KEY ? config.IMAGE_PROVIDER : 'disabled',
  };
};

// ---------------- LLM ----------------
export interface LlmRequest { system: string; messages: ChatMessage[]; json?: boolean; schema?: unknown; maxTokens?: number; temperature?: number;
  /** Set by services/usage.ts from the stored AI settings (§17): per-request timeout, attempts (1 + retries) and counters. */
  timeoutMs?: number; maxAttempts?: number; stats?: CallStats }
export interface LlmUsage { inputTokens: number; outputTokens: number; thoughtTokens?: number }
export interface LlmResult { text: string; usage: LlmUsage; model: string; finishReason?: string }
export interface StreamingLlm { name: string; model: string; isTestOnly?: boolean;
  generate(req: LlmRequest): Promise<LlmResult>;
  stream(req: LlmRequest): AsyncGenerator<{ delta?: string; done?: LlmResult }> }

const toGemini = (req: LlmRequest) => ({
  systemInstruction: { parts: [{ text: req.system }] },
  contents: req.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
  generationConfig: { maxOutputTokens: req.maxTokens ?? 4096, temperature: req.temperature ?? 0.4, thinkingConfig: { thinkingLevel: 'low' },
    ...(req.json ? { responseMimeType: 'application/json', ...(req.schema ? { responseSchema: req.schema } : {}) } : {}) },
  safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map((category) => ({ category, threshold: 'BLOCK_LOW_AND_ABOVE' })),
});
const usageOf = (u: any): LlmUsage => ({ inputTokens: u?.promptTokenCount ?? 0, outputTokens: u?.candidatesTokenCount ?? 0, thoughtTokens: u?.thoughtsTokenCount ?? 0 });
const textOf = (d: any) => (d?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? '').join('');
/** §17 model selection: the stored AI settings choose the LLM model (set by services/aiSettings.ts when it loads); env LLM_MODEL is the fallback. */
let llmModelOverride: string | null = null;
export const setLlmModelOverride = (m: string | null | undefined) => { llmModelOverride = m || null; };
export const defaultLlmModel = () => config.LLM_MODEL || 'gemini-3.8-flash';
export const llmProviderName = () => config.LLM_PROVIDER || ((config.LLM_API_KEY || config.GEMINI_API_KEY) ? 'gemini' : '');
class GeminiLlm implements StreamingLlm {
  name = 'gemini'; model = llmModelOverride || defaultLlmModel();
  private url(method: string) { return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:${method}`; }
  private headers() { return { 'content-type': 'application/json', 'x-goog-api-key': (config.LLM_API_KEY || config.GEMINI_API_KEY)! }; }
  async generate(req: LlmRequest): Promise<LlmResult> {
    const d: any = await withRetry(() => fetch(this.url('generateContent'), { method: 'POST', headers: this.headers(), body: JSON.stringify(toGemini(req)), signal: AbortSignal.timeout(req.timeoutMs ?? 180_000) }), (r) => r.json(), 'gemini.generate', req.maxAttempts ?? 4, req.stats);
    const fr = d?.candidates?.[0]?.finishReason;
    if (!d?.candidates?.length || fr === 'SAFETY' || d?.promptFeedback?.blockReason) throw new LlmBlockedError(d?.promptFeedback?.blockReason ?? fr ?? 'NO_CANDIDATE');
    return { text: textOf(d), usage: usageOf(d.usageMetadata), model: this.model, finishReason: fr };
  }
  async *stream(req: LlmRequest) {
    const r = await withRetry(() => fetch(this.url('streamGenerateContent?alt=sse'), { method: 'POST', headers: this.headers(), body: JSON.stringify(toGemini(req)), signal: AbortSignal.timeout(req.timeoutMs ?? 180_000) }), async (x) => x, 'gemini.stream', req.maxAttempts ?? 3, req.stats);
    const reader = r.body!.getReader(); const dec = new TextDecoder(); let buf = ''; let full = ''; let usage: LlmUsage = { inputTokens: 0, outputTokens: 0 }; let fr: string | undefined;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r/g, '');
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const ev = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = ev.split('\n').find((l) => l.startsWith('data:')); if (!line) continue;
        const d = JSON.parse(line.slice(5)); const t = textOf(d);
        if (d.usageMetadata) usage = usageOf(d.usageMetadata); if (d.candidates?.[0]?.finishReason) fr = d.candidates[0].finishReason;
        if (fr === 'SAFETY') throw new LlmBlockedError('SAFETY');
        if (t) { full += t; yield { delta: t }; }
      }
    }
    if (!full.trim()) throw new Error(`Empty response from model (finishReason ${fr ?? 'unknown'})`);
    yield { done: { text: full, usage, model: this.model, finishReason: fr } };
  }
}
export class LlmBlockedError extends Error { permanent = true; constructor(public reason: string) { super(`Response blocked by provider safety filter (${reason})`); } }
/** TEST ONLY scripted LLM: responses come from `testLlm.respond(req)`; refuses outside NODE_ENV=test. */
export const testLlm: { respond: (req: LlmRequest) => string; calls: LlmRequest[]; fail?: number; rateLimit?: number } = { respond: () => 'TEST RESPONSE', calls: [] };
class TestLlm implements StreamingLlm {
  name = 'test-llm'; model = llmModelOverride || 'test-scripted'; isTestOnly = true;
  async generate(req: LlmRequest) {
    testLlm.calls.push(req);
    // Scripted 429s go through the same retry loop as real providers, so retries and rate-limit counting are exercised.
    if (testLlm.rateLimit) return withRetry(async () => (testLlm.rateLimit! > 0 ? (testLlm.rateLimit!--, new Response('quota', { status: 429, headers: { 'retry-after': '0.001' } })) : new Response(JSON.stringify({ t: testLlm.respond(req) }), { status: 200 })),
      async (r) => { const text = ((await r.json()) as any).t as string; return { text, usage: { inputTokens: 10, outputTokens: text.length >> 2 }, model: this.model }; }, 'test.generate', req.maxAttempts ?? 4, req.stats);
    if (testLlm.fail && testLlm.fail-- > 0) throw new Error('test provider outage'); const text = testLlm.respond(req); return { text, usage: { inputTokens: 10, outputTokens: text.length >> 2 }, model: this.model }; }
  async *stream(req: LlmRequest) { const r = await this.generate(req); for (const w of r.text.match(/\S+\s*/g) ?? []) yield { delta: w }; yield { done: r }; }
}
export function getLlm(): StreamingLlm | null {
  const p = llmProviderName();
  if (p === 'test-llm') { if (config.NODE_ENV !== 'test') throw new Error('test-llm is only allowed in tests'); return new TestLlm(); }
  if (p === 'gemini' && (config.LLM_API_KEY || config.GEMINI_API_KEY)) return new GeminiLlm();
  return null;
}

/**
 * §17 models the configured LLM provider offers (Gemini ListModels; it costs no generation quota). Used to validate the
 * stored model choice. Returns null when the provider cannot be asked (not configured, network error).
 */
export async function listLlmModels(): Promise<{ id: string; label: string }[] | null> {
  const p = llmProviderName();
  if (p === 'test-llm' && config.NODE_ENV === 'test') return [{ id: 'test-scripted', label: 'Test scripted' }, { id: 'test-scripted-2', label: 'Test scripted 2' }];
  if (p !== 'gemini' || !(config.LLM_API_KEY || config.GEMINI_API_KEY)) return null;
  try {
    const out: { id: string; label: string }[] = []; let page = '';
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, { headers: { 'x-goog-api-key': (config.LLM_API_KEY || config.GEMINI_API_KEY)! }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return null;
      const d: any = await r.json();
      for (const m of d.models ?? []) if ((m.supportedGenerationMethods ?? []).includes('generateContent') && /^models\/gemini-/.test(m.name)) out.push({ id: m.name.slice(7), label: m.displayName ?? m.name.slice(7) });
      if (!d.nextPageToken) break; page = d.nextPageToken;
    }
    return out;
  } catch { return null; }
}
