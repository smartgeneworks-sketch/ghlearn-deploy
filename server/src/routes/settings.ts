import { idleClient } from '../services/idle.js';
import { Router } from 'express';
import { z } from 'zod';
import { FEATURE_FLAGS, THEME_PRESETS, type FeatureFlag } from '@ghlearn/shared';
import { authenticate, requireAnyPermission, requirePermission } from '../middleware/index.js';
import { AcademicYear, AcademicLevel, User } from '../models/index.js';
import { config } from '../config.js';
import { audit, diff } from '../lib/audit.js';
import { AppError, notFound } from '../lib/errors.js';
import { loadSettings, getSettings, updateSettings, patchSchema, DEFAULTS, flat, highImpact, SECTION_KEYS, assertNoSecrets } from '../services/platformSettings.js';
import { retentionPreview, purgeExpired } from '../services/retention.js';
import { emailConfigured } from '../services/mailer.js';
import { smsAvailable } from '../services/sms.js';
import { getAiSettings } from '../services/aiSettings.js';

/** §20 public part of the settings: what every visitor's app needs (branding, theme, maintenance banner, features, legal text). */
export const publicSettingsRouter = Router();
publicSettingsRouter.get('/public', async (_req, res) => {
  const st = await loadSettings(); const s = st.settings;
  const features = Object.fromEntries((Object.keys(FEATURE_FLAGS) as FeatureFlag[]).map((f) => [f, f === 'selfRegistration' ? s.features[f] && config.selfRegistration : s.features[f]]));
  res.set('Cache-Control', 'no-cache').json({
    branding: s.branding, theme: { preset: s.theme.preset, colors: THEME_PRESETS[s.theme.preset as keyof typeof THEME_PRESETS] },
    maintenance: s.maintenance.enabled ? { enabled: true, message: s.maintenance.message, until: s.maintenance.until } : { enabled: false },
    features, offline: { bundleEnabled: s.offline.bundleEnabled, saveLessonsEnabled: s.offline.saveLessonsEnabled },
    passwordReset: { email: emailConfigured(), sms: await smsAvailable(), staffAssisted: true },
    /** Idle sign-out limits for the app (seconds), by role group; the server enforces the same limits. */
    idle: idleClient(),
    legal: { version: st.legalVersion, updatedAt: st.legalUpdatedAt ?? null, terms: !!s.legal.terms.trim(), privacy: !!s.legal.privacy.trim() },
  });
});
publicSettingsRouter.get('/legal/:kind', async (req, res) => {
  const kind = z.enum(['terms', 'privacy']).safeParse(req.params.kind); if (!kind.success) throw notFound('Unknown document');
  const st = await loadSettings();
  res.json({ kind: kind.data, text: st.settings.legal[kind.data], version: st.legalVersion, updatedAt: st.legalUpdatedAt ?? null, appName: st.settings.branding.appName });
});

/** §20 System settings for administrators. Super Admins edit; System Operators can read. Mounted at /api/admin/settings. */
export const settingsAdminRouter = Router();
settingsAdminRouter.use(authenticate);
settingsAdminRouter.get('/', requireAnyPermission('platform:manage', 'system:health'), async (req, res) => {
  const st = await loadSettings();
  const [years, levels, by, ai, retention] = await Promise.all([
    AcademicYear.find({ archivedAt: null }).sort({ startDate: -1, label: -1 }).select('label startDate endDate current').lean(),
    AcademicLevel.find({ archivedAt: null }).sort({ order: 1, name: 1 }).select('name kind years enabled').lean(),
    st.updatedBy ? User.findById(st.updatedBy).select('fullName').lean() : null, getAiSettings(), retentionPreview(st.settings.retention)]);
  res.json({
    settings: st.settings, defaults: DEFAULTS(), version: st.version, updatedAt: st.updatedAt ?? null, updatedBy: by?.fullName ?? null,
    legal: { version: st.legalVersion, updatedAt: st.legalUpdatedAt ?? null },
    limits: { uploadMaxMbEnv: config.UPLOAD_MAX_MB, ocrMaxPagesEnv: config.OCR_MAX_PAGES, selfRegistrationEnv: config.selfRegistration, emailConfigured: emailConfigured()},
    themes: Object.entries(THEME_PRESETS).map(([key, v]) => ({ key, ...v })), features: FEATURE_FLAGS,
    academic: { years, levels },
    review: { mandatoryReview: true, selfApproval: false, note: 'Every lesson, question and game is reviewed before publishing, and nobody can approve their own work. These rules are fixed.' },
    ai: { platformDailyRequests: ai.platformDailyRequests, platformMonthlyRequests: ai.platformMonthlyRequests, platformMonthlyCostUsd: ai.platformMonthlyCostUsd, perUserDailyRequests: ai.perUserDailyRequests, schoolDailyRequests: ai.schoolDailyRequests, allowedFeatures: ai.allowedFeatures, llmModel: ai.llmModel, maxRetries: ai.maxRetries, timeoutSec: ai.timeoutSec },
    retention, canEdit: req.auth!.roles.includes('super_admin'),
  });
});
settingsAdminRouter.patch('/', requirePermission('platform:manage'), async (req, res) => {
  assertNoSecrets(req.body);
  const { confirm, ...patch } = patchSchema.parse(req.body);
  if (!Object.keys(patch).length) throw new AppError(422, 'VALIDATION', 'Nothing to change');
  const { before, after, impact, stored } = await updateSettings(patch as any, req.auth!.userId, !!confirm);
  const fb = flat(before), fa = flat(after); const d = diff(fb, fa);
  if (Object.keys(d.after).length) audit(req, 'settings.update', 'platform', { sections: Object.keys(patch), confirmed: !!confirm, highImpact: impact.map((i) => i.key), version: stored.version }, { entityType: 'settings', ...d });
  res.json({ settings: after, changed: Object.keys(d.after), version: stored.version });
});
/** Shows which of the submitted changes would need confirmation, without saving (the UI uses it to build the dialog). */
settingsAdminRouter.post('/check', requirePermission('platform:manage'), async (req, res) => {
  assertNoSecrets(req.body);
  const { confirm: _c, ...patch } = patchSchema.parse(req.body); const before = await getSettings();
  const merged: any = {}; for (const k of SECTION_KEYS) merged[k] = { ...before[k], ...((patch as any)[k] ?? {}) };
  const { settingsSchema } = await import('../services/platformSettings.js');
  const after = settingsSchema.parse(merged);
  res.json({ changes: highImpact(before, after), changed: Object.keys(diff(flat(before), flat(after)).after) });
});
settingsAdminRouter.post('/academic-year', requirePermission('platform:manage'), async (req, res) => {
  const b = z.object({ yearId: z.string().regex(/^[a-f0-9]{24}$/i), confirm: z.boolean().optional() }).strict().parse(req.body);
  const y = await AcademicYear.findOne({ _id: b.yearId, archivedAt: null }); if (!y) throw notFound('Academic year not found');
  const cur = await AcademicYear.findOne({ current: true }).select('label').lean();
  if (y.current) return res.json({ current: y.label, changed: false });
  if (!b.confirm) throw new AppError(409, 'CONFIRM_REQUIRED', 'These changes need confirmation', { changes: [{ key: 'academic.currentYear', reason: `Makes ${y.label} the current academic year for every school (classes, enrolment and reports default to it)` }] });
  await AcademicYear.updateMany({ current: true }, { current: false }); y.current = true; await y.save();
  audit(req, 'settings.academic_year', String(y._id), undefined, { entityType: 'settings', before: { currentYear: cur?.label ?? null }, after: { currentYear: y.label } });
  res.json({ current: y.label, changed: true });
});
settingsAdminRouter.get('/retention', requireAnyPermission('platform:manage', 'system:health'), async (_req, res) => res.json({ preview: await retentionPreview() }));
settingsAdminRouter.post('/retention/run', requirePermission('platform:manage'), async (req, res) => {
  const b = z.object({ confirm: z.boolean().optional() }).strict().parse(req.body ?? {});
  const preview = await retentionPreview();
  if (!b.confirm) throw new AppError(409, 'CONFIRM_REQUIRED', 'These changes need confirmation', { changes: [{ key: 'retention.run', reason: `Permanently deletes ${Object.values(preview).reduce((n, p) => n + p.due, 0)} records older than the retention periods` }] });
  const r = await purgeExpired({ force: true });
  audit(req, 'settings.retention_run', 'retention', r, { entityType: 'settings' });
  res.json(r);
});
