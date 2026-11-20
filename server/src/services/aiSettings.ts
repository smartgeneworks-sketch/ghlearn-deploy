import { z } from 'zod';
import { AiSettings, AI_FEATURES, type AiFeature } from '../models/index.js';
import { config } from '../config.js';
import { setLlmModelOverride } from './ai.js';
/**
 * §17 AI limits, stored in the database (singleton) and enforced on the server by services/usage.ts.
 * Env values (LLM_DAILY_*_BUDGET, AI_COST_*_PER_M) are only used to create the first record.
 */
export const aiSettingsSchema = z.object({
  platformDailyRequests: z.number().int().min(0).max(100_000),
  platformDailyTokens: z.number().int().min(0).max(1_000_000_000),
  /** Hard monthly caps (calendar month, UTC). Requests are counted exactly; cost is estimated from the token rates below (0 = no cost cap). */
  platformMonthlyRequests: z.number().int().min(0).max(10_000_000),
  platformMonthlyCostUsd: z.number().min(0).max(100_000),
  perUserDailyRequests: z.number().int().min(0).max(10_000),
  schoolDailyRequests: z.number().int().min(0).max(100_000),
  schoolBudgets: z.array(z.object({ schoolId: z.string().regex(/^[a-f0-9]{24}$/i), dailyRequests: z.number().int().min(0).max(100_000) }).strict()).max(500),
  maxInputChars: z.number().int().min(1000).max(2_000_000),
  maxOutputTokens: z.number().int().min(256).max(65_536),
  maxRetries: z.number().int().min(0).max(5),
  timeoutSec: z.number().int().min(5).max(600),
  allowedFeatures: z.array(z.enum(Object.keys(AI_FEATURES) as [AiFeature, ...AiFeature[]])).max(10),
  alertThresholdPct: z.number().int().min(10).max(100),
  costInputPerM: z.number().min(0).max(1000), costOutputPerM: z.number().min(0).max(1000),
  /** §17 LLM model id for the configured provider; null = env LLM_MODEL or the built-in default. Checked against the provider's model list on save. */
  llmModel: z.string().regex(/^[a-z0-9][a-z0-9.\-]{2,63}$/, 'Use a model id such as gemini-3.8-flash').nullable(),
}).strict();
export type AiLimits = z.infer<typeof aiSettingsSchema>;
export const AI_DEFAULTS = (): AiLimits => ({
  platformDailyRequests: config.LLM_DAILY_REQUEST_BUDGET, platformDailyTokens: config.LLM_DAILY_TOKEN_BUDGET,
  platformMonthlyRequests: config.LLM_MONTHLY_REQUEST_BUDGET, platformMonthlyCostUsd: config.LLM_MONTHLY_COST_BUDGET_USD,
  perUserDailyRequests: config.AI_USER_DAILY_REQUESTS, schoolDailyRequests: config.AI_SCHOOL_DAILY_REQUESTS, schoolBudgets: [],
  maxInputChars: 200_000, maxOutputTokens: 12_000, maxRetries: 3, timeoutSec: 180,
  allowedFeatures: Object.keys(AI_FEATURES) as AiFeature[], alertThresholdPct: 80,
  costInputPerM: config.AI_COST_INPUT_PER_M, costOutputPerM: config.AI_COST_OUTPUT_PER_M, llmModel: null,
});
const FIELDS = Object.keys(aiSettingsSchema.shape) as (keyof AiLimits)[];
let cache: { at: number; v: AiLimits & { updatedAt?: Date; updatedBy?: unknown } } | null = null;
const plain = (d: any): AiLimits & { updatedAt?: Date; updatedBy?: unknown } => {
  const def = AI_DEFAULTS(); const o: any = {};
  for (const k of FIELDS) o[k] = d?.[k] ?? def[k];
  o.schoolBudgets = (o.schoolBudgets ?? []).map((b: any) => ({ schoolId: String(b.schoolId), dailyRequests: b.dailyRequests }));
  return { ...o, updatedAt: d?.updatedAt, updatedBy: d?.updatedBy };
};
/** Current limits (cached 10 s per instance; writes clear the cache). */
export async function getAiSettings() {
  if (cache && Date.now() - cache.at < 10_000) return cache.v;
  let d = await AiSettings.findOne({ key: 'ai' }).lean();
  if (!d) d = (await AiSettings.findOneAndUpdate({ key: 'ai' }, { $setOnInsert: { key: 'ai', ...AI_DEFAULTS() } }, { upsert: true, returnDocument: 'after' }).lean())!;
  cache = { at: Date.now(), v: plain(d) }; setLlmModelOverride(cache.v.llmModel); return cache.v;
}
export async function updateAiSettings(patch: Partial<AiLimits>, by: string) {
  const before = await getAiSettings();
  const next = aiSettingsSchema.parse({ ...Object.fromEntries(FIELDS.map((k) => [k, before[k]])), ...patch });
  await AiSettings.updateOne({ key: 'ai' }, { $set: { ...next, updatedBy: by } }, { upsert: true });
  cache = null; return { before, after: await getAiSettings() };
}
export const clearAiSettingsCache = () => { cache = null; setLlmModelOverride(null); };
export const estimateCost = (s: Pick<AiLimits, 'costInputPerM' | 'costOutputPerM'>, input: number, output: number) => Math.round(((input * s.costInputPerM + output * s.costOutputPerM) / 1e6) * 10000) / 10000;
