import { z } from 'zod';
import { MANUAL_KINDS, THEME_KEYS, FEATURE_FLAGS, type ManualKind, type FeatureFlag } from '@ghlearn/shared';
import { PlatformSettings } from '../models/index.js';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
/**
 * §20 System settings. Stored in the database (one document), cached per instance for 10 s, and enforced on the server
 * where each setting applies (see ENFORCEMENT below and docs/ADMIN_PANEL.md §20). Environment variables stay the hard
 * ceilings (UPLOAD_MAX_MB, OCR_MAX_PAGES, SELF_REGISTRATION) and the only home of secrets; nothing secret is stored here.
 */
const LOGO_MAX_BYTES = 150 * 1024;
const text = (max: number) => z.string().max(max).transform((s) => s.replace(/\r\n/g, '\n'));
const logo = z.string().max(Math.ceil(LOGO_MAX_BYTES * 1.4) + 40).nullable().superRefine((v, ctx) => {
  if (v == null) return;
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(v);
  if (!m) return ctx.addIssue({ code: 'custom', message: 'The logo must be a PNG, JPEG or WebP image' });
  const b = Buffer.from(m[2], 'base64');
  if (b.length > LOGO_MAX_BYTES) return ctx.addIssue({ code: 'custom', message: 'The logo must be 150 KB or smaller' });
  const ok = m[1] === 'png' ? b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : m[1] === 'jpeg' ? b[0] === 0xff && b[1] === 0xd8 : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
  if (!ok) ctx.addIssue({ code: 'custom', message: `The file content is not a ${m[1].toUpperCase()} image` });
});
const flags = Object.keys(FEATURE_FLAGS) as [FeatureFlag, ...FeatureFlag[]];
export const sections = {
  branding: z.object({ appName: z.string().trim().min(2).max(40), tagline: z.string().trim().max(120), logo, supportEmail: z.union([z.email().max(200), z.literal('')]) }).strict(),
  theme: z.object({ preset: z.enum(THEME_KEYS as [string, ...string[]]) }).strict(),
  review: z.object({ remindersEnabled: z.boolean(), reminderAfterHours: z.number().int().min(4).max(336) }).strict(),
  uploads: z.object({ maxUploadMb: z.number().min(1).max(config.UPLOAD_MAX_MB), formats: z.array(z.enum(MANUAL_KINDS as [ManualKind, ...ManualKind[]])).min(1).max(MANUAL_KINDS.length),
    ocrEnabled: z.boolean(), ocrMaxPages: z.number().int().min(1).max(config.OCR_MAX_PAGES) }).strict(),
  notifications: z.object({ emailEnabled: z.boolean(), announcementMaxDays: z.number().int().min(1).max(365) }).strict(),
  retention: z.object({ notificationDays: z.number().int().min(30).max(1825), aiUsageDays: z.number().int().min(90).max(1825), jobDays: z.number().int().min(7).max(730),
    auditDays: z.number().int().min(365).max(3650), tutorDays: z.number().int().min(7).max(730), purgeEnabled: z.boolean() }).strict(),
  sessions: z.object({ accessMinutes: z.number().int().min(5).max(60), sessionDays: z.number().int().min(1).max(60), lockoutAttempts: z.number().int().min(3).max(20),
    lockoutMinutes: z.number().int().min(5).max(240) }).strict(),
  offline: z.object({ bundleEnabled: z.boolean(), saveLessonsEnabled: z.boolean(), bundleMaxResources: z.number().int().min(5).max(500) }).strict(),
  features: z.object(Object.fromEntries(flags.map((f) => [f, z.boolean()])) as Record<FeatureFlag, z.ZodBoolean>).strict(),
  maintenance: z.object({ enabled: z.boolean(), message: z.string().trim().max(300), until: z.coerce.date().nullable() }).strict(),
  legal: z.object({ terms: text(30_000), privacy: text(30_000) }).strict(),
  /** SMS switch, sender ID (blank = SMS_SENDER_ID env) and the daily send cap that protects the wallet. The API key is env-only. */
  sms: z.object({ enabled: z.boolean(), senderId: z.string().trim().regex(/^[A-Za-z0-9 ]{0,11}$/, 'Up to 11 letters, digits or spaces'), dailyCap: z.number().int().min(0).max(10_000) }).strict(),
};
export type Section = keyof typeof sections;
export const SECTION_KEYS = Object.keys(sections) as Section[];
export const settingsSchema = z.object(sections).strict();
export type Settings = z.infer<typeof settingsSchema>;
export const patchSchema = z.object(Object.fromEntries(SECTION_KEYS.map((k) => [k, sections[k].partial().strict().optional()])) as { [K in Section]: z.ZodOptional<z.ZodObject<any>> })
  .extend({ confirm: z.boolean().optional() }).strict();

export const DEFAULTS = (): Settings => ({
  branding: { appName: 'GH Learn', tagline: 'Ghana curriculum learning for students and teachers', logo: null, supportEmail: '' },
  theme: { preset: 'green' },
  review: { remindersEnabled: true, reminderAfterHours: 24 },
  uploads: { maxUploadMb: config.UPLOAD_MAX_MB, formats: [...MANUAL_KINDS], ocrEnabled: true, ocrMaxPages: config.OCR_MAX_PAGES },
  notifications: { emailEnabled: true, announcementMaxDays: 180 },
  retention: { notificationDays: 365, aiUsageDays: 400, jobDays: 90, auditDays: 730, tutorDays: config.TUTOR_RETENTION_DAYS, purgeEnabled: true },
  sessions: { accessMinutes: Math.max(5, Math.min(60, Math.round(config.ACCESS_TTL_SECONDS / 60))), sessionDays: Math.max(1, Math.min(60, config.REFRESH_TTL_DAYS)), lockoutAttempts: 8, lockoutMinutes: 15 },
  offline: { bundleEnabled: true, saveLessonsEnabled: true, bundleMaxResources: 200 },
  features: Object.fromEntries(flags.map((f) => [f, f === 'selfRegistration' ? config.selfRegistration : true])) as Record<FeatureFlag, boolean>,
  maintenance: { enabled: false, message: '', until: null },
  legal: { terms: '', privacy: '' },
  sms: { enabled: true, senderId: '', dailyCap: 300 },
});

/** Stored values merged over the defaults; values that no longer validate (e.g. an env ceiling was lowered) fall back to the clamp or default. */
function merge(data: any): Settings {
  const def = DEFAULTS(); const out: any = {};
  for (const k of SECTION_KEYS) {
    const sec = { ...def[k], ...(data?.[k] ?? {}) };
    if (k === 'uploads') { sec.maxUploadMb = Math.min(sec.maxUploadMb, config.UPLOAD_MAX_MB); sec.ocrMaxPages = Math.min(sec.ocrMaxPages, config.OCR_MAX_PAGES); }
    const r = sections[k].safeParse(sec); out[k] = r.success ? r.data : def[k];
  }
  return out;
}
export interface Stored { settings: Settings; version: number; legalVersion: number; legalUpdatedAt?: Date; updatedAt?: Date; updatedBy?: unknown }
let cache: { at: number; v: Stored } | null = null;
/** Last loaded settings, for synchronous callers (token signing); defaults until the first load. */
export const settingsNow = (): Settings => cache?.v.settings ?? DEFAULTS();
export async function loadSettings(): Promise<Stored> {
  if (cache && Date.now() - cache.at < 10_000) return cache.v;
  const d: any = await PlatformSettings.findOne({ key: 'platform' }).lean();
  cache = { at: Date.now(), v: { settings: merge(d?.data), version: d?.version ?? 0, legalVersion: d?.legalVersion ?? 0, legalUpdatedAt: d?.legalUpdatedAt, updatedAt: d?.updatedAt, updatedBy: d?.updatedBy } };
  return cache.v;
}
export const getSettings = async () => (await loadSettings()).settings;
export const clearSettingsCache = () => { cache = null; };

/** Values that look like credentials are refused anywhere in the settings (no secrets in the database). */
const SECRET_LIKE = [/AIza[0-9A-Za-z_-]{30,}/, /\bsk-[A-Za-z0-9_-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /mongodb(\+srv)?:\/\/[^\s/]*:[^\s/]*@/i, /smtps?:\/\/[^\s/]*:[^\s/]*@/i, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bxox[abp]-[A-Za-z0-9-]{20,}/, /\brnd_[A-Za-z0-9]{20,}/];
const envSecrets = () => [config.GEMINI_API_KEY, config.LLM_API_KEY, config.EMBEDDING_API_KEY, config.IMAGE_API_KEY, config.SMTP_URL, config.SMTP_PASS, config.EMAIL_API_KEY, config.BMS_API_KEY, config.JWT_ACCESS_SECRET, config.JWT_REFRESH_SECRET, config.MONGODB_URI]
  .filter((s): s is string => !!s && s.length >= 12 && s !== 'json');
export function assertNoSecrets(v: unknown, path = ''): void {
  if (typeof v === 'string') {
    if (v.startsWith('data:image/')) return; // validated binary image, base64 can contain anything
    if (SECRET_LIKE.some((r) => r.test(v)) || envSecrets().some((s) => v.includes(s))) throw new AppError(422, 'SECRET_REJECTED', `${path || 'A value'} looks like a credential. Secrets belong in environment variables, not in settings.`);
  } else if (v && typeof v === 'object' && !(v instanceof Date)) for (const [k, x] of Object.entries(v)) assertNoSecrets(x, path ? `${path}.${k}` : k);
}

/** Flattened view ("section.key": value) used for diffs and confirmation lists. */
export const flat = (s: Partial<Settings>) => Object.fromEntries(Object.entries(s).flatMap(([k, sec]) => Object.entries(sec as object).map(([f, v]) => [`${k}.${f}`, v instanceof Date ? v.toISOString() : v])));
/** §20 "high-impact changes need confirmation": the server refuses these without `confirm: true`. */
export function highImpact(before: Settings, after: Settings): { key: string; reason: string }[] {
  const out: { key: string; reason: string }[] = []; const add = (key: string, reason: string) => out.push({ key, reason });
  if (after.maintenance.enabled && !before.maintenance.enabled) add('maintenance.enabled', 'Turns on maintenance mode: everyone except administrators is signed out of the app until it is turned off');
  for (const f of flags) if (before.features[f] && !after.features[f]) add(`features.${f}`, `Switches off ${FEATURE_FLAGS[f]} for every school`);
  const ret = after.retention, rb = before.retention;
  for (const k of ['notificationDays', 'aiUsageDays', 'jobDays', 'auditDays', 'tutorDays'] as const) if (ret[k] < rb[k]) add(`retention.${k}`, `Shortens retention from ${rb[k]} to ${ret[k]} days; older records are deleted by the next daily purge`);
  if (ret.purgeEnabled && !rb.purgeEnabled) add('retention.purgeEnabled', 'Turns on the daily purge, which deletes records older than the retention periods');
  const s = after.sessions, sb = before.sessions;
  if (s.sessionDays < sb.sessionDays || s.accessMinutes < sb.accessMinutes) add('sessions', 'Shortens sign-in sessions for every user');
  if (s.lockoutAttempts !== sb.lockoutAttempts || s.lockoutMinutes !== sb.lockoutMinutes) add('sessions.lockout', 'Changes when and for how long accounts are locked after failed sign-ins');
  const removed = before.uploads.formats.filter((f) => !after.uploads.formats.includes(f));
  if (removed.length) add('uploads.formats', `Stops accepting ${removed.join(', ').toUpperCase()} uploads`);
  if (after.uploads.maxUploadMb < before.uploads.maxUploadMb) add('uploads.maxUploadMb', `Lowers the upload limit to ${after.uploads.maxUploadMb} MB`);
  if (before.offline.bundleEnabled && !after.offline.bundleEnabled) add('offline.bundleEnabled', 'Stops offline subject downloads');
  if (before.offline.saveLessonsEnabled && !after.offline.saveLessonsEnabled) add('offline.saveLessonsEnabled', 'Stops saving lessons on devices');
  if (after.legal.terms !== before.legal.terms || after.legal.privacy !== before.legal.privacy) add('legal', 'Publishes new terms or privacy text to every user');
  if (after.notifications.emailEnabled !== before.notifications.emailEnabled && !after.notifications.emailEnabled) add('notifications.emailEnabled', 'Stops all notification email');
  return out;
}

export async function updateSettings(patch: Partial<{ [K in Section]: Record<string, unknown> }>, by: string, confirm: boolean) {
  assertNoSecrets(patch);
  const cur = await loadSettings(); const before = cur.settings;
  const merged: any = {}; for (const k of SECTION_KEYS) merged[k] = { ...before[k], ...(patch[k] ?? {}) };
  const r = settingsSchema.safeParse(merged); if (!r.success) throw r.error;
  const after = r.data;
  if (after.maintenance.enabled && after.maintenance.until && after.maintenance.until.getTime() <= Date.now() && !before.maintenance.enabled) throw new AppError(422, 'VALIDATION', 'The expected end of maintenance must be in the future');
  const impact = highImpact(before, after);
  if (impact.length && !confirm) throw new AppError(409, 'CONFIRM_REQUIRED', 'These changes need confirmation', { changes: impact });
  const legalChanged = after.legal.terms !== before.legal.terms || after.legal.privacy !== before.legal.privacy;
  await PlatformSettings.updateOne({ key: 'platform' }, { $set: { data: after, updatedBy: by, ...(legalChanged ? { legalUpdatedAt: new Date() } : {}) }, $inc: { version: 1, ...(legalChanged ? { legalVersion: 1 } : {}) } }, { upsert: true });
  cache = null; const next = await loadSettings();
  return { before, after: next.settings, impact, stored: next };
}

/** Maintenance is on when enabled (the "until" time is shown to users; an administrator turns it off). */
export const maintenanceOn = (s: Settings) => s.maintenance.enabled;
export async function featureOn(f: FeatureFlag) { return (await getSettings()).features[f]; }
