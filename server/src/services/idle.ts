import type { Request } from 'express';
import { RefreshToken } from '../models/index.js';
import { settingsNow } from './platformSettings.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';

/**
 * Idle sign-out, enforced on the server as well as in the app. A session (refresh-token family) records when its user was
 * last active. The app reports "ms since the user last did something" in X-Idle-Ms (background polling therefore does not
 * keep a session alive); requests without the header count as activity now. The stored time is written at most once a minute
 * per session. A session idle for longer than its limit is refused by `authenticate` and by /refresh (a closed laptop
 * cannot resume), revoked, and audited as session.idle_timeout.
 */
export const ADMIN_ROLES = ['super_admin', 'school_admin', 'curriculum_admin', 'curriculum_editor', 'content_reviewer', 'system_operator'];
export const IDLE_TOUCH = { ms: 60_000 };
let override: { userSeconds: number; adminSeconds: number; warnSeconds: number } | null = null;
/** E2E/test only: short idle limits in seconds (the settings minimum is 5 minutes). Ignored outside NODE_ENV=test. */
export const setIdleOverrideForTest = (o: typeof override) => { if (config.NODE_ENV === 'test') override = o; };
export const isAdminRoles = (roles: readonly string[]) => roles.some((r) => ADMIN_ROLES.includes(r));
export function idleClient() {
  if (override) return { ...override };
  const s = settingsNow().sessions; return { userSeconds: s.idleMinutesUser * 60, adminSeconds: s.idleMinutesAdmin * 60, warnSeconds: 60 };
}
export const idleLimitMs = (roles: readonly string[]) => { const c = idleClient(); return (isAdminRoles(roles) ? c.adminSeconds : c.userSeconds) * 1000; };
const reportedActiveAt = (req: Request, now: number) => {
  const v = Number(req.get('x-idle-ms')); return Number.isFinite(v) && v > 0 ? now - Math.min(v, 30 * 864e5) : now;
};
type Entry = { last: number; persisted: number };
const cache = new Map<string, Entry>();
export const resetIdleCache = () => cache.clear();
async function entry(sid: string): Promise<Entry | null> {
  let c = cache.get(sid); if (c) return c;
  const d = await RefreshToken.findOne({ family: sid }).sort({ createdAt: -1 }).select('lastActiveAt createdAt').lean(); if (!d) return null;
  const l = +(d.lastActiveAt ?? d.createdAt!); c = { last: l, persisted: l };
  if (cache.size > 20_000) cache.delete(cache.keys().next().value!);
  cache.set(sid, c); return c;
}
/** Per authenticated request: 'idle' when the session has been idle too long, otherwise records the activity (throttled). */
export async function touchSession(req: Request, sid: string | undefined, roles: readonly string[]): Promise<'ok' | 'idle'> {
  if (!sid) return 'ok';
  const now = Date.now(); const c = await entry(sid); if (!c) return 'ok';
  // Idle when the session saw no activity for longer than the limit, or the app itself reports the user idle that long.
  const limit = idleLimitMs(roles); const reported = reportedActiveAt(req, now);
  if (now - c.last > limit || now - reported > limit) return 'idle';
  const latest = Math.max(c.last, reported);
  c.last = latest;
  if (c.last - c.persisted >= IDLE_TOUCH.ms) { c.persisted = c.last; await RefreshToken.updateMany({ family: sid, revokedAt: null }, { lastActiveAt: new Date(c.last) }); }
  return 'ok';
}
/** For /refresh: last activity of the session from the database (and this process's newer knowledge, if any). */
export function idleExpired(doc: { family: string; lastActiveAt?: Date | null; createdAt?: Date }, roles: readonly string[], now = Date.now()) {
  const last = Math.max(+(doc.lastActiveAt ?? doc.createdAt ?? new Date(now)), cache.get(doc.family)?.last ?? 0);
  return now - last > idleLimitMs(roles);
}
export const forgetSession = (sid: string) => cache.delete(sid);
export function auditIdle(req: Request, userId: string, sid: string, via: 'request' | 'refresh' | 'client', schoolId?: string) {
  audit(req, 'session.idle_timeout', userId, { via, sid: sid.slice(0, 8) }, { entityType: 'auth', actorId: userId, schoolId, outcome: 'denied' });
}
