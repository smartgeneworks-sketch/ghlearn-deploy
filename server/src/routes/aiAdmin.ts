import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAnyPermission, requirePermission } from '../middleware/index.js';
import { AiHealthCheck, School, AI_FEATURES } from '../models/index.js';
import { config } from '../config.js';
import { aiStatus, listLlmModels, llmProviderName, defaultLlmModel, getEmbeddingProvider } from '../services/ai.js';
import { getSettings } from '../services/platformSettings.js';
import { getAiSettings, updateAiSettings, aiSettingsSchema, AI_DEFAULTS } from '../services/aiSettings.js';
import { aiUsageReport, usageScope } from '../services/aiUsageReport.js';
import { runHealthChecks, HEALTH_CAPABILITIES } from '../services/aiHealth.js';
import { sendExport } from '../services/exporter.js';
import { audit, diff } from '../lib/audit.js';
import { AppError, badRequest } from '../lib/errors.js';

/** §17 AI Usage and Costs: usage reports, stored limits, provider health. Mounted at /api/admin/ai. */
export const aiAdminRouter = Router();
aiAdminRouter.use(authenticate);
const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const filters = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), schoolId: oid.optional(), provider: z.string().max(60).optional(),
  feature: z.string().max(60).optional(), status: z.string().max(30).optional() });
aiAdminRouter.get('/usage', requireAnyPermission('analytics:view', 'system:health'), async (req, res) => {
  const { scope, f } = usageScope(req.auth!, filters.strict().parse(req.query)); res.json(await aiUsageReport(scope, f));
});
const REPORTS = { byFeature: 'AI usage by feature', byProvider: 'AI usage by provider and model', bySchool: 'AI usage by school', byUser: 'AI usage by user', daily: 'AI usage by day', failures: 'AI failed and refused requests' } as const;
aiAdminRouter.get('/usage/export', requireAnyPermission('analytics:view', 'system:health'), async (req, res) => {
  const q = filters.extend({ report: z.enum(Object.keys(REPORTS) as [keyof typeof REPORTS]), format: z.enum(['csv', 'xlsx']).default('csv') }).strict().parse(req.query);
  const { report, format, ...rest } = q; const { scope, f } = usageScope(req.auth!, rest); const r: any = await aiUsageReport(scope, f);
  if (!r[report]) throw badRequest('This report is not available for your role');
  const nums = ['requests', 'ok', 'failed', 'refused', 'inputTokens', 'outputTokens', 'estCostUsd', 'rateLimitHits', 'retries', 'avgLatencyMs'];
  const H = ['Requests', 'Succeeded', 'Failed', 'Refused by limits', 'Input tokens', 'Output tokens', 'Estimated cost (USD)', 'Rate-limit responses', 'Retries', 'Average latency (ms)'];
  const lead: Record<string, [string[], (x: any) => unknown[]]> = {
    byFeature: [['Feature'], (x) => [x.label]], byProvider: [['Provider', 'Model'], (x) => [x.provider, x.model]], bySchool: [['School'], (x) => [x.school]],
    byUser: [['Name', 'Email', 'Roles', 'Last request'], (x) => [x.name, x.email, x.roles, x.lastAt]], daily: [['Day'], (x) => [x.day]] };
  const [header, rows] = report === 'failures'
    ? [['When', 'Provider', 'Model', 'Feature', 'Status', 'HTTP status', 'Rate-limit responses', 'Retries', 'Error'], r.failures.map((x: any) => [x.at, x.provider, x.model, x.feature, x.status, x.httpStatus, x.rateLimitHits, x.retries, x.error])]
    : [[...lead[report][0], ...H], r[report].map((x: any) => [...lead[report][1](x), ...nums.map((k) => x[k])])];
  sendExport(req, res, { report: REPORTS[report], format, header, rows, filters: f, note: `${REPORTS[report]} (${r.filters.from.toISOString().slice(0, 10)} to ${r.filters.to.toISOString().slice(0, 10)}). ${r.labels.cost}` });
});

/** Secrets are reported as set / not set only. */
const secretStatus = () => [
  { name: 'GEMINI_API_KEY', purpose: 'Gemini LLM and embeddings', set: !!config.GEMINI_API_KEY }, { name: 'LLM_API_KEY', purpose: 'LLM (overrides GEMINI_API_KEY)', set: !!config.LLM_API_KEY },
  { name: 'EMBEDDING_API_KEY', purpose: 'Embeddings (overrides GEMINI_API_KEY)', set: !!config.EMBEDDING_API_KEY }, { name: 'IMAGE_API_KEY', purpose: 'Illustration provider', set: !!config.IMAGE_API_KEY },
  { name: 'SMTP_URL', purpose: 'Email for notifications and password reset (or SMTP_HOST/PORT/USER/PASS)', set: (!!config.SMTP_URL && config.SMTP_URL !== 'json') || !!config.SMTP_HOST },
  { name: 'EMAIL_API_KEY', purpose: 'HTTP email API key (EMAIL_API_PROVIDER brevo or resend)', set: !!config.EMAIL_API_KEY },
  { name: 'EMAIL_FROM', purpose: 'Sender address for email', set: !!config.EMAIL_FROM }];
/**
 * §17 provider and model selection. Providers and keys are chosen in the environment (keys are never stored or shown,
 * only set/unset); the LLM model is chosen here. The embedding model stays in env because changing it invalidates the
 * stored vectors (a full re-index is needed). OCR can be switched off in System settings (uploads.ocrEnabled).
 */
async function providerConfig(llmModel: string | null) {
  const e = (() => { try { return getEmbeddingProvider(); } catch { return null; } })(); const up = (await getSettings()).uploads;
  return [
    { capability: 'llm', label: 'Text generation (LLM)', provider: llmProviderName() || null, envVar: 'LLM_PROVIDER', model: llmProviderName() ? llmModel || defaultLlmModel() : null,
      modelSource: llmModel ? 'settings' : config.LLM_MODEL ? 'env' : 'default', modelEditable: !!llmProviderName(), keyVars: ['LLM_API_KEY', 'GEMINI_API_KEY'] },
    { capability: 'embeddings', label: 'Embeddings (retrieval)', provider: e?.name ?? null, envVar: 'EMBEDDING_PROVIDER', model: e?.model ?? null, modelSource: config.EMBEDDING_MODEL ? 'env' : 'default', modelEditable: false,
      note: 'Set in the environment: changing the embedding model needs a full re-index of every manual', keyVars: ['EMBEDDING_API_KEY', 'GEMINI_API_KEY'] },
    { capability: 'ocr', label: 'OCR for scanned pages', provider: config.OCR_PROVIDER || null, envVar: 'OCR_PROVIDER', model: config.OCR_PROVIDER ? `lang ${config.OCR_LANG}` : null, modelSource: 'env', modelEditable: false,
      note: !config.OCR_PROVIDER ? 'Not configured (OCR_PROVIDER unset): scanned pages without a text layer are skipped and reported on the manual' : up.ocrEnabled ? `On; at most ${Math.min(up.ocrMaxPages, config.OCR_MAX_PAGES)} pages per manual (System settings → Uploads)` : 'Switched off in System settings → Uploads', keyVars: [] },
    { capability: 'image', label: 'Illustrations', provider: config.IMAGE_PROVIDER && config.IMAGE_API_KEY ? config.IMAGE_PROVIDER : null, envVar: 'IMAGE_PROVIDER', model: null, modelSource: 'env', modelEditable: false,
      note: 'No illustration adapter is built in; diagrams are sanitised SVG written by the LLM', keyVars: ['IMAGE_API_KEY'] },
    { capability: 'vector', label: 'Vector search', provider: config.VECTOR_SEARCH, envVar: 'VECTOR_SEARCH', model: null, modelSource: 'env', modelEditable: false, keyVars: [] },
    { capability: 'storage', label: 'File storage', provider: config.STORAGE_PROVIDER, envVar: 'STORAGE_PROVIDER', model: null, modelSource: 'env', modelEditable: false, keyVars: [] },
  ];
}
aiAdminRouter.get('/settings', requireAnyPermission('platform:manage', 'system:health'), async (req, res) => {
  const s = await getAiSettings(); const schools = await School.find({ _id: { $in: s.schoolBudgets.map((b) => b.schoolId) } }).select('name').lean();
  res.json({ settings: { ...s, schoolBudgets: s.schoolBudgets.map((b) => ({ ...b, school: schools.find((x) => String(x._id) === b.schoolId)?.name })) }, defaults: AI_DEFAULTS(),
    features: Object.entries(AI_FEATURES).map(([key, v]) => ({ key, label: v.label, purposes: v.purposes })),
    providers: { ...aiStatus(), vectorSearch: config.VECTOR_SEARCH, objectStorage: config.STORAGE_PROVIDER }, providerConfig: await providerConfig(s.llmModel), secrets: secretStatus(), canEdit: req.auth!.roles.includes('super_admin') });
});
aiAdminRouter.patch('/settings', requirePermission('platform:manage'), async (req, res) => {
  const patch = aiSettingsSchema.partial().strict().parse(req.body);
  if (patch.schoolBudgets?.length && (await School.countDocuments({ _id: { $in: patch.schoolBudgets.map((b) => b.schoolId) } })) !== new Set(patch.schoolBudgets.map((b) => b.schoolId)).size) throw badRequest('Unknown school in school budgets');
  if (patch.llmModel) { // §17 model selection is checked against the configured provider's own model list
    const models = await listLlmModels();
    if (!models) throw new AppError(422, 'VALIDATION', 'The model list could not be read from the configured LLM provider, so the model cannot be changed now');
    if (!models.some((m) => m.id === patch.llmModel)) throw new AppError(422, 'VALIDATION', `The provider does not offer the model "${patch.llmModel}"`);
  }
  const sent = Object.keys(req.body ?? {}) as (keyof typeof patch)[]; const only = Object.fromEntries(sent.filter((k) => k in patch).map((k) => [k, patch[k]]));
  const { before, after } = await updateAiSettings(only, req.auth!.userId);
  const d = diff(before as any, after as any, Object.keys(only));
  audit(req, 'ai_config.update', 'ai', undefined, { entityType: 'ai_config', ...d });
  res.json({ settings: after, changed: Object.keys(d.after) });
});
/** §17 models offered by the configured LLM provider (read from the provider; no generation quota is used). */
aiAdminRouter.get('/models', requireAnyPermission('platform:manage', 'system:health'), async (_req, res) => {
  const models = await listLlmModels(); const s = await getAiSettings();
  res.json({ provider: llmProviderName() || null, available: models !== null, models: models ?? [], selected: s.llmModel, defaultModel: defaultLlmModel() });
});
aiAdminRouter.get('/health', requireAnyPermission('platform:manage', 'system:health'), async (_req, res) => {
  res.json({ items: await AiHealthCheck.find().sort({ createdAt: -1 }).limit(10).populate('ranBy', 'fullName').lean(), capabilities: HEALTH_CAPABILITIES });
});
aiAdminRouter.post('/health', requireAnyPermission('platform:manage', 'system:health'), async (req, res) => {
  const { capabilities } = z.object({ capabilities: z.array(z.enum(HEALTH_CAPABILITIES)).max(6).optional() }).strict().parse(req.body ?? {});
  const r = await runHealthChecks(req.auth!.userId, capabilities);
  audit(req, 'ai.health_check', r.id, { ok: r.ok, results: r.results.map((x) => `${x.capability}:${x.status}`) }, { entityType: 'ai_config', outcome: r.ok ? 'success' : 'failure' });
  res.json(r);
});
