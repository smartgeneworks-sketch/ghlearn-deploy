import mongoose from 'mongoose';
import { AiUsage, User, School, AiAlert, AI_FEATURES } from '../models/index.js';
import { getAiSettings, estimateCost } from './aiSettings.js';
import { budgetStatus, monthStatus, today } from './usage.js';
import { forbidden } from '../lib/errors.js';
import type { AuthCtx } from '../middleware/index.js';
/**
 * §17 AI usage and costs from the AiUsage records. Who sees what:
 *  - platform (Super Admin): everything, including per-school and per-user figures;
 *  - school (School Admin): only requests made by users of their school, per user within it;
 *  - operations (System Operator) and content staff: providers, models, features, failures and rate limits, per school counts for operators; never per user.
 * Costs are estimates from the token counts and the rates in AI settings.
 */
export type UsageScope = 'platform' | 'school' | 'operations' | 'content';
export interface UsageFilters { from?: Date; to?: Date; schoolId?: string; provider?: string; feature?: string; status?: string }
const oid = (s: string) => new mongoose.Types.ObjectId(s);
export function usageScope(a: AuthCtx, f: UsageFilters): { scope: UsageScope; f: UsageFilters } {
  if (a.roles.includes('super_admin')) return { scope: 'platform', f };
  if (a.roles.includes('school_admin')) { if (f.schoolId && f.schoolId !== a.schoolId) throw forbidden('You can only see AI usage for your school'); return { scope: 'school', f: { ...f, schoolId: a.schoolId } }; }
  if (a.roles.includes('system_operator')) return { scope: 'operations', f };
  if (a.roles.some((r) => ['curriculum_admin', 'content_reviewer'].includes(r))) { if (f.schoolId) throw forbidden('Content staff see platform totals only'); return { scope: 'content', f }; }
  throw forbidden('Missing permission: analytics:view or system:health');
}
const FAILED = ['error', 'blocked', 'timeout', 'rate_limited']; const REFUSED = ['budget_exceeded', 'limit_exceeded', 'feature_disabled', 'input_too_large'];
const tokOut = { $add: [{ $ifNull: ['$outputTokens', 0] }, { $ifNull: ['$thoughtTokens', 0] }] };
const sums = { requests: { $sum: 1 }, ok: { $sum: { $cond: [{ $eq: ['$status', 'ok'] }, 1, 0] } }, failed: { $sum: { $cond: [{ $in: ['$status', FAILED] }, 1, 0] } },
  refused: { $sum: { $cond: [{ $in: ['$status', REFUSED] }, 1, 0] } }, inputTokens: { $sum: { $ifNull: ['$inputTokens', 0] } }, outputTokens: { $sum: tokOut },
  rateLimitHits: { $sum: { $ifNull: ['$rateLimitHits', 0] } }, retries: { $sum: { $ifNull: ['$retries', 0] } }, units: { $sum: { $ifNull: ['$units', 0] } }, latency: { $avg: '$latencyMs' } };
export const featureLabel = (k?: string) => (k && k in AI_FEATURES ? AI_FEATURES[k as keyof typeof AI_FEATURES].label : k === 'embeddings' ? 'Embeddings (indexing and search)' : k === 'health_check' ? 'Health checks' : k ?? 'Other');

export async function aiUsageReport(scope: UsageScope, f: UsageFilters) {
  const s = await getAiSettings(); const to = f.to ?? new Date(); const from = f.from ?? new Date(to.getTime() - 30 * 86400000);
  const m: any = { createdAt: { $gte: from, $lte: to } };
  if (f.schoolId) m.schoolId = oid(f.schoolId); if (f.provider) m.provider = f.provider; if (f.feature) m.feature = f.feature;
  if (f.status === 'failed') m.status = { $in: FAILED }; else if (f.status === 'refused') m.status = { $in: REFUSED }; else if (f.status) m.status = f.status;
  const cost = (r: any) => estimateCost(s, r.inputTokens, r.outputTokens);
  const row = (r: any) => ({ requests: r.requests, ok: r.ok, failed: r.failed, refused: r.refused, inputTokens: r.inputTokens, outputTokens: r.outputTokens, estCostUsd: cost(r), rateLimitHits: r.rateLimitHits, retries: r.retries, units: r.units, avgLatencyMs: r.latency == null ? null : Math.round(r.latency) });
  const [tot] = await AiUsage.aggregate([{ $match: m }, { $group: { _id: null, ...sums } }]);
  const byProvider = (await AiUsage.aggregate([{ $match: m }, { $group: { _id: { p: '$provider', m: '$model' }, ...sums } }, { $sort: { requests: -1 } }])).map((r) => ({ provider: r._id.p ?? 'none', model: r._id.m ?? '—', ...row(r) }));
  const byFeature = (await AiUsage.aggregate([{ $match: m }, { $group: { _id: { $ifNull: ['$feature', '$purpose'] }, ...sums } }, { $sort: { requests: -1 } }])).map((r) => ({ feature: r._id, label: featureLabel(r._id), ...row(r) }));
  const daily = (await AiUsage.aggregate([{ $match: m }, { $group: { _id: '$day', ...sums } }, { $sort: { _id: 1 } }])).map((r) => ({ day: r._id, ...row(r) }));
  let bySchool: any[] | undefined; let byUser: any[] | undefined;
  if (scope === 'platform' || scope === 'operations') {
    const rows = await AiUsage.aggregate([{ $match: m }, { $group: { _id: '$schoolId', ...sums } }, { $sort: { requests: -1 } }, { $limit: 100 }]);
    const names = new Map((await School.find({ _id: { $in: rows.map((r) => r._id).filter(Boolean) } }).select('name').lean()).map((x) => [String(x._id), x.name]));
    bySchool = rows.map((r) => ({ schoolId: r._id ? String(r._id) : null, school: r._id ? names.get(String(r._id)) ?? 'Unknown school' : 'No school (platform staff, system jobs)', ...row(r) }));
  }
  if (scope === 'platform' || scope === 'school') {
    const rows = await AiUsage.aggregate([{ $match: { ...m, userId: { $ne: null } } }, { $group: { _id: '$userId', ...sums, last: { $max: '$createdAt' } } }, { $sort: { requests: -1 } }, { $limit: 100 }]);
    const users = new Map((await User.find({ _id: { $in: rows.map((r) => r._id) } }).select('fullName email roles').lean()).map((u) => [String(u._id), u]));
    byUser = rows.map((r) => { const u: any = users.get(String(r._id)); return { userId: String(r._id), name: u?.fullName ?? 'Deleted user', email: u?.email, roles: u?.roles ?? [], lastAt: r.last, ...row(r) }; });
  }
  const failures = (await AiUsage.find({ ...m, status: { $in: [...FAILED, ...REFUSED] } }).sort({ createdAt: -1 }).limit(25).select('createdAt provider model purpose feature status error httpStatus rateLimitHits retries').lean())
    .map((x: any) => ({ at: x.createdAt, provider: x.provider, model: x.model, feature: featureLabel(x.feature ?? x.purpose), status: x.status, httpStatus: x.httpStatus, rateLimitHits: x.rateLimitHits ?? 0, retries: x.retries ?? 0, error: x.error }));
  const rateLimit = { hits: tot?.rateLimitHits ?? 0, requestsAffected: await AiUsage.countDocuments({ ...m, rateLimitHits: { $gt: 0 } }), finalRateLimited: await AiUsage.countDocuments({ ...m, status: 'rate_limited' }) };
  const b = await budgetStatus();
  const budgets: any = { day: today(), thresholdPct: s.alertThresholdPct, perUserDailyRequests: s.perUserDailyRequests,
    platform: { used: b.requests, limit: b.requestBudget, pct: b.requestBudget ? Math.round((100 * b.requests) / b.requestBudget) : null, tokens: b.tokens, tokenLimit: b.tokenBudget },
    month: await (async () => { const mo = await monthStatus(); return { ...mo, pct: mo.requestBudget ? Math.round((100 * mo.requests) / mo.requestBudget) : null, costPct: mo.costBudgetUsd ? Math.round((100 * mo.estCostUsd) / mo.costBudgetUsd) : null }; })(),
    alertsToday: (await AiAlert.find({ day: today(), ...(scope === 'school' ? { scope: `school:${f.schoolId}` } : {}) }).select('scope level createdAt').lean()).map((a) => ({ scope: a.scope, level: a.level, at: a.createdAt })) };
  if (f.schoolId) { const used = await AiUsage.countDocuments({ day: today(), schoolId: oid(f.schoolId), purpose: { $not: /^embedding/ }, status: { $in: ['ok', 'error', 'blocked', 'timeout', 'rate_limited'] } });
    const limit = s.schoolBudgets.find((x) => x.schoolId === f.schoolId)?.dailyRequests ?? s.schoolDailyRequests; budgets.school = { used, limit, pct: limit ? Math.round((100 * used) / limit) : null }; }
  if (scope === 'school') { delete budgets.platform; delete budgets.month; }
  return { scope, filters: { ...f, from, to }, totals: tot ? row(tot) : row({ requests: 0, ok: 0, failed: 0, refused: 0, inputTokens: 0, outputTokens: 0, rateLimitHits: 0, retries: 0, units: 0, latency: null }),
    byProvider, byFeature, daily, bySchool, byUser, failures, rateLimit, budgets,
    labels: { cost: `Estimated cost, not a bill: USD ${s.costInputPerM} per 1M input tokens and ${s.costOutputPerM} per 1M output and thinking tokens (rates set in AI settings). Free-tier usage is not billed. Embedding calls report items, not tokens.`,
      measured: 'Requests, tokens, failures, retries and rate-limit responses are measured from each recorded call.', refused: 'Refused = stopped before reaching the provider by a limit or a switched-off feature; not counted against budgets.' } };
}
