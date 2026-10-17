import { landingSchema, LANDING_DEFAULTS, type LandingContent } from '@ghlearn/shared/src/landing';
import { PlatformSettings } from '../models/index.js';
import { assertNoSecrets } from './platformSettings.js';
/**
 * Landing-page content (docs/LANDING_SPEC.md §10). Stored as its own PlatformSettings document (key "landing") so it is
 * versioned separately from system settings. Sections that no longer validate fall back to the defaults.
 */
const KEY = 'landing';
export interface StoredLanding { content: LandingContent; version: number; updatedAt?: Date; updatedBy?: unknown; customised: boolean }
let cache: { at: number; v: StoredLanding } | null = null;
export const clearLandingCache = () => { cache = null; };
function merge(data: any): LandingContent {
  const out: any = {};
  for (const k of Object.keys(LANDING_DEFAULTS) as (keyof LandingContent)[]) {
    const r = (landingSchema.shape as any)[k].safeParse(data?.[k] ?? LANDING_DEFAULTS[k]);
    out[k] = r.success ? r.data : LANDING_DEFAULTS[k];
  }
  return out;
}
export async function loadLanding(): Promise<StoredLanding> {
  if (cache && Date.now() - cache.at < 10_000) return cache.v;
  const d: any = await PlatformSettings.findOne({ key: KEY }).lean();
  cache = { at: Date.now(), v: { content: merge(d?.data), version: d?.version ?? 0, updatedAt: d?.updatedAt, updatedBy: d?.updatedBy, customised: !!d } };
  return cache.v;
}
/** Validates the whole document (throws ZodError) and stores it. Returns before/after for the audit diff. */
export async function saveLanding(input: unknown, by: string) {
  assertNoSecrets(input);
  const next = landingSchema.parse(input);
  const before = (await loadLanding()).content;
  await PlatformSettings.updateOne({ key: KEY }, { $set: { data: next, updatedBy: by }, $inc: { version: 1 } }, { upsert: true });
  cache = null; const stored = await loadLanding();
  return { before, after: stored.content, stored };
}
export async function resetLanding() { await PlatformSettings.deleteOne({ key: KEY }); cache = null; return loadLanding(); }
