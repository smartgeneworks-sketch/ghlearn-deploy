import { AiUsage, User, AiAlert, featureOf, AI_FEATURES } from '../models/index.js';
import { getLlm, AiUnavailableError, LlmBlockedError, ProviderError, type LlmRequest, type LlmResult, type CallStats, type EmbeddingProvider } from './ai.js';
import { getAiSettings, estimateCost, type AiLimits } from './aiSettings.js';
import { logger } from '../lib/logger.js';
/**
 * Every LLM call goes through here (§17). Before calling the provider it enforces, from the stored AI settings:
 * allowed features, input size, the platform daily request/token budget, the user's daily limit and the school's
 * daily budget. Refusals are recorded too (status = why), so the usage page shows them. Retries and timeouts come
 * from the same settings. Errors here are permanent so jobs do not spend quota retrying them.
 */
export class AiLimitError extends Error { permanent = true; aiLimit = true; constructor(public code: 'BUDGET_EXCEEDED' | 'USER_LIMIT' | 'SCHOOL_LIMIT' | 'FEATURE_DISABLED' | 'INPUT_TOO_LARGE', m: string) { super(m); } }
export class BudgetExceededError extends AiLimitError { constructor(m: string) { super('BUDGET_EXCEEDED', m); } }
export const today = () => new Date().toISOString().slice(0, 10);
const NOT_EMBEDDING: any = { $not: /^embedding/ };
/** Requests that count towards limits: calls that reached the provider (refusals are recorded but never counted). */
const COUNTED: any = { $in: ['ok', 'error', 'blocked', 'timeout', 'rate_limited'] };
export async function budgetStatus() {
  const s = await getAiSettings();
  const [r] = await AiUsage.aggregate([{ $match: { day: today(), purpose: NOT_EMBEDDING, status: COUNTED } }, { $group: { _id: null, n: { $sum: 1 }, tok: { $sum: { $add: [{ $ifNull: ['$inputTokens', 0] }, { $ifNull: ['$outputTokens', 0] }, { $ifNull: ['$thoughtTokens', 0] }] } } } }]);
  return { day: today(), requests: r?.n ?? 0, tokens: r?.tok ?? 0, requestBudget: s.platformDailyRequests, tokenBudget: s.platformDailyTokens };
}
/** Calendar month (UTC) so far: counted requests, tokens and the estimated cost at the configured rates. */
export const thisMonth = () => today().slice(0, 7);
export async function monthStatus() {
  const s = await getAiSettings(); const month = thisMonth();
  const [r] = await AiUsage.aggregate([{ $match: { day: { $gte: `${month}-01`, $lte: `${month}-31` }, purpose: NOT_EMBEDDING, status: COUNTED } },
    { $group: { _id: null, n: { $sum: 1 }, i: { $sum: { $ifNull: ['$inputTokens', 0] } }, o: { $sum: { $add: [{ $ifNull: ['$outputTokens', 0] }, { $ifNull: ['$thoughtTokens', 0] }] } } } }]);
  const requests = r?.n ?? 0; const estCostUsd = estimateCost(s, r?.i ?? 0, r?.o ?? 0);
  return { month, requests, requestBudget: s.platformMonthlyRequests, inputTokens: r?.i ?? 0, outputTokens: r?.o ?? 0, estCostUsd, costBudgetUsd: s.platformMonthlyCostUsd };
}
type Meta = { purpose: string; userId?: string; jobId?: string; refId?: string };
const schoolOf = async (userId?: string) => (userId ? ((await User.findById(userId).select('schoolId').lean())?.schoolId as any) : undefined);
const schoolLimit = (s: AiLimits, schoolId?: unknown) => s.schoolBudgets.find((b) => b.schoolId === String(schoolId))?.dailyRequests ?? s.schoolDailyRequests;

/** Preflight used by generate/stream and by estimates (no provider call). `requests` = how many calls the action needs. */
export async function aiPreflight(m: { purpose: string; userId?: string; requests?: number; inputChars?: number }) {
  const s = await getAiSettings(); const n = m.requests ?? 1; const f = featureOf(m.purpose);
  if (f in AI_FEATURES && !s.allowedFeatures.includes(f as any)) return { ok: false as const, status: 'feature_disabled', error: new AiLimitError('FEATURE_DISABLED', `${AI_FEATURES[f as keyof typeof AI_FEATURES].label} is switched off in AI settings.`) };
  if (m.inputChars != null && m.inputChars > s.maxInputChars) return { ok: false as const, status: 'input_too_large', error: new AiLimitError('INPUT_TOO_LARGE', `Request too large for the AI limit (${m.inputChars.toLocaleString()} characters; the limit is ${s.maxInputChars.toLocaleString()}).`) };
  const b = await budgetStatus();
  if (b.requests + n > b.requestBudget || b.tokens >= b.tokenBudget) return { ok: false as const, status: 'budget_exceeded', error: new BudgetExceededError(`Daily AI budget reached (${b.requests}/${b.requestBudget} requests). Try again tomorrow or raise the platform budget in AI settings.`) };
  const mo = await monthStatus();
  if (mo.requests + n > mo.requestBudget) return { ok: false as const, status: 'budget_exceeded', error: new BudgetExceededError(`Monthly AI budget reached (${mo.requests}/${mo.requestBudget} requests in ${mo.month}). It resets on the 1st, or a Super Admin can raise it in AI settings.`) };
  if (mo.costBudgetUsd > 0 && mo.estCostUsd >= mo.costBudgetUsd) return { ok: false as const, status: 'budget_exceeded', error: new BudgetExceededError(`Monthly AI cost cap reached (about $${mo.estCostUsd.toFixed(2)} of $${mo.costBudgetUsd.toFixed(2)} estimated in ${mo.month}). It resets on the 1st, or a Super Admin can raise it in AI settings.`) };
  if (m.userId && f !== 'health_check') {
    const used = await AiUsage.countDocuments({ day: today(), userId: m.userId, purpose: NOT_EMBEDDING, status: COUNTED });
    if (used + n > s.perUserDailyRequests) return { ok: false as const, status: 'limit_exceeded', error: new AiLimitError('USER_LIMIT', `Your daily AI limit is reached (${used}/${s.perUserDailyRequests} requests). Try again tomorrow.`) };
    const schoolId = await schoolOf(m.userId);
    if (schoolId) {
      const lim = schoolLimit(s, schoolId); const su = await AiUsage.countDocuments({ day: today(), schoolId, purpose: NOT_EMBEDDING, status: COUNTED });
      if (su + n > lim) return { ok: false as const, status: 'limit_exceeded', error: new AiLimitError('SCHOOL_LIMIT', `Your school's daily AI budget is reached (${su}/${lim} requests). Try again tomorrow.`) };
    }
  }
  return { ok: true as const, settings: s };
}

/** Adds the stored limits (feature switch, user and school budgets) to an estimate's budget block. */
export async function withLimits<B extends { allowed: boolean }>(budget: B, m: { purpose: string; userId?: string; requests?: number }) {
  const pf = await aiPreflight(m);
  return { ...budget, allowed: budget.allowed && pf.ok, ...(pf.ok ? {} : { blockedBy: pf.error.message, blockedCode: pf.error.code }) };
}
/** The HTTP error for a refused estimate. */
export function refusal(b: { blockedBy?: string; blockedCode?: string }, code: string, fallback: string) {
  return b.blockedCode && b.blockedCode !== 'BUDGET_EXCEEDED' ? new AiLimitError(b.blockedCode as any, b.blockedBy!) : Object.assign(new Error(b.blockedBy ?? fallback), { aiLimit: true, code });
}
const statusOf = (e: any) => e instanceof LlmBlockedError ? 'blocked' : e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : e instanceof ProviderError && e.status === 429 ? 'rate_limited' : 'error';
async function record(m: Meta, llm: { name: string; model: string } | null, t0: number, status: string, res?: LlmResult, error?: string, stats?: CallStats) {
  const schoolId = await schoolOf(m.userId).catch(() => undefined);
  await AiUsage.create({ day: today(), provider: llm?.name, model: res?.model ?? llm?.model, purpose: m.purpose, feature: featureOf(m.purpose), userId: m.userId, schoolId, jobId: m.jobId, refId: m.refId,
    inputTokens: res?.usage.inputTokens, outputTokens: res?.usage.outputTokens, thoughtTokens: res?.usage.thoughtTokens, latencyMs: Date.now() - t0, status: status as any, error: error?.replace(/key=[^&\s]+/g, 'key=***').slice(0, 500),
    rateLimitHits: stats?.rateLimitHits || undefined, retries: stats?.retries || undefined, httpStatus: stats?.httpStatus });
  if (status !== 'feature_disabled' && status !== 'input_too_large') thresholdAlerts(m.userId).catch((e) => logger.warn({ e }, 'ai alert'));
}
/** Budget-threshold alerts (§17): super admins hear once per day when the platform passes the threshold or 100 %, school admins for their school. */
async function thresholdAlerts(userId?: string) {
  const s = await getAiSettings(); const b = await budgetStatus(); const { notifyRoles } = await import('./notify.js');
  const fire = async (scope: string, used: number, limit: number, send: (title: string, body: string) => Promise<unknown>) => {
    if (!limit) return; const pct = (100 * used) / limit; const level = pct >= 100 ? 'full' : pct >= s.alertThresholdPct ? 'threshold' : null; if (!level) return;
    try { await AiAlert.create({ day: today(), scope, level }); } catch { return; } // already sent today
    await send(level === 'full' ? 'AI budget reached' : `AI budget at ${Math.round(pct)} %`, `${used} of ${limit} requests used today (${scope === 'platform' ? 'whole platform' : 'your school'}).`);
  };
  await fire('platform', b.requests, b.requestBudget, (title, body) => notifyRoles(['super_admin'], { type: 'ai.budget', title, body, link: '/admin/ai-usage' }));
  // Monthly caps: whichever of requests or estimated cost is further along (at most one alert per level per day).
  const mo = await monthStatus(); const reqPct = mo.requestBudget ? mo.requests / mo.requestBudget : 0; const costPct = mo.costBudgetUsd ? mo.estCostUsd / mo.costBudgetUsd : 0;
  const byCost = costPct > reqPct;
  await fire('platform-month', byCost ? Math.round(mo.estCostUsd * 100) : mo.requests, byCost ? Math.round(mo.costBudgetUsd * 100) : mo.requestBudget, (title, body) => notifyRoles(['super_admin'], { type: 'ai.budget', title: `Monthly ${title}`,
    body: byCost ? `About $${mo.estCostUsd.toFixed(2)} of the $${mo.costBudgetUsd.toFixed(2)} estimated monthly cost cap used (${mo.month}).` : `${mo.requests} of ${mo.requestBudget} requests used this month (${mo.month}).`, link: '/admin/ai-usage' }));
  const schoolId = await schoolOf(userId);
  if (schoolId) { const su = await AiUsage.countDocuments({ day: today(), schoolId, purpose: NOT_EMBEDDING, status: COUNTED });
    await fire(`school:${schoolId}`, su, schoolLimit(s, schoolId), (title, body) => notifyRoles(['school_admin'], { type: 'ai.budget', title, body, link: '/admin/ai-usage' }, { schoolId })); }
}
const requireLlm = () => { const l = getLlm(); if (!l) throw new AiUnavailableError('LLM'); return l; };
const inputChars = (req: LlmRequest) => req.system.length + req.messages.reduce((t, x) => t + x.content.length, 0);
async function prepare(req: LlmRequest, m: Meta) {
  const llm = requireLlm(); const t0 = Date.now();
  const pf = await aiPreflight({ purpose: m.purpose, userId: m.userId, inputChars: inputChars(req) });
  if (!pf.ok) { await record(m, llm, t0, pf.status, undefined, pf.error.message); throw pf.error; }
  const s = pf.settings; const stats: CallStats = { retries: 0, rateLimitHits: 0 };
  return { llm, t0, stats, req: { ...req, maxTokens: Math.min(req.maxTokens ?? 4096, s.maxOutputTokens), // A caller may ask for a tighter bound (e.g. health checks), never a looser one than the settings.
    timeoutMs: Math.min(req.timeoutMs ?? Infinity, s.timeoutSec * 1000), maxAttempts: Math.min(req.maxAttempts ?? Infinity, s.maxRetries + 1), stats } };
}
export async function generate(req: LlmRequest, m: Meta): Promise<LlmResult> {
  const p = await prepare(req, m);
  try { const r = await p.llm.generate(p.req); await record(m, p.llm, p.t0, 'ok', r, undefined, p.stats); return r; }
  catch (e: any) { await record(m, p.llm, p.t0, statusOf(e), undefined, e?.message, p.stats); throw e; }
}
export async function* stream(req: LlmRequest, m: Meta) {
  const p = await prepare(req, m);
  try { for await (const ev of p.llm.stream(p.req)) { if (ev.done) await record(m, p.llm, p.t0, 'ok', ev.done, undefined, p.stats); yield ev; } }
  catch (e: any) { await record(m, p.llm, p.t0, statusOf(e), undefined, e?.message, p.stats); throw e; }
}
/** Embedding calls are recorded too (provider, model, items, characters; Gemini returns no token count). They never count towards the request budget. */
export async function recordEmbedding(m: { purpose: 'embedding.index' | 'embedding.query' | 'health_check'; provider: string; model: string; items: number; chars: number; t0: number; error?: string; userId?: string; refId?: string }) {
  await AiUsage.create({ day: today(), provider: m.provider, model: m.model, purpose: m.purpose, feature: m.purpose === 'health_check' ? 'health_check' : 'embeddings', userId: m.userId, refId: m.refId,
    units: m.items, chars: m.chars, inputTokens: undefined, latencyMs: Date.now() - m.t0, status: m.error ? 'error' : 'ok', error: m.error?.replace(/key=[^&\s]+/g, 'key=***').slice(0, 500), schoolId: await schoolOf(m.userId).catch(() => undefined) }).catch(() => undefined);
}
/** Calls an embedding provider and records the call (success or failure). */
export async function embedRecorded(p: EmbeddingProvider, texts: string[], task: 'document' | 'query', m: { userId?: string; refId?: string } = {}) {
  const t0 = Date.now(); const chars = texts.reduce((t, x) => t + x.length, 0);
  try { const v = await p.embed(texts, task); await recordEmbedding({ purpose: task === 'query' ? 'embedding.query' : 'embedding.index', provider: p.name, model: p.model, items: texts.length, chars, t0, ...m }); return v; }
  catch (e: any) { await recordEmbedding({ purpose: task === 'query' ? 'embedding.query' : 'embedding.index', provider: p.name, model: p.model, items: texts.length, chars, t0, error: String(e?.message ?? e), ...m }); throw e; }
}
/** Parses JSON from a model reply, tolerating ```json fences. */
export function parseJson<T>(text: string): T {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(t) as T;
}
