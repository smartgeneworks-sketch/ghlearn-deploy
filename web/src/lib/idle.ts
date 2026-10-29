/**
 * Idle sign-out, client side. One "last activity" time shared by every tab (localStorage) plus a BroadcastChannel for
 * instant cross-tab messages (activity, sign-out). The API client reports the idle time to the server in X-Idle-Ms, and
 * work in progress (a tutor answer streaming, a file uploading) counts as activity.
 */
export const IDLE_KEY = 'gl:lastActive';
export const ADMIN_ROLES = ['super_admin', 'school_admin', 'curriculum_admin', 'curriculum_editor', 'content_reviewer', 'system_operator'];
export type IdleConfig = { userSeconds: number; adminSeconds: number; warnSeconds: number };
export const DEFAULT_IDLE: IdleConfig = { userSeconds: 1800, adminSeconds: 900, warnSeconds: 60 };
export const idleLimitSeconds = (roles: readonly string[], c: IdleConfig = DEFAULT_IDLE) => (roles.some((r) => ADMIN_ROLES.includes(r)) ? c.adminSeconds : c.userSeconds);

let local = Date.now(); let lastWrite = 0; let busy = 0;
const readShared = () => { try { return Number(localStorage.getItem(IDLE_KEY)) || 0; } catch { return 0; } };
/** Most recent activity in any tab of this browser. */
export const lastActivity = () => Math.max(local, readShared());
/** Milliseconds since the user last did something (0 while work is in progress). */
export const idleMs = () => (busy > 0 ? 0 : Math.max(0, Date.now() - lastActivity()));
export const isBusy = () => busy > 0;

type Msg = { type: 'active'; at: number } | { type: 'logout'; reason?: 'idle' | 'manual' };
let ch: BroadcastChannel | null | undefined;
const channel = () => { if (ch === undefined) { try { ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('gl-idle') : null; } catch { ch = null; } } return ch; };
const listeners = new Set<(m: Msg) => void>();
/** Messages from other tabs (BroadcastChannel, with the storage event as a fallback for sign-out). */
export function onIdleMessage(fn: (m: Msg) => void) {
  listeners.add(fn);
  const c = channel(); const h = (e: MessageEvent) => fn(e.data as Msg); c?.addEventListener('message', h);
  const s = (e: StorageEvent) => { if (e.key === 'gl:logout' && e.newValue && !c) fn({ type: 'logout', reason: e.newValue.startsWith('idle') ? 'idle' : 'manual' }); };
  if (typeof window !== 'undefined') window.addEventListener('storage', s);
  return () => { listeners.delete(fn); c?.removeEventListener('message', h); if (typeof window !== 'undefined') window.removeEventListener('storage', s); };
}
/** Record user activity (throttled to one shared write a second). */
export function markActive(now = Date.now(), force = false) {
  local = now;
  if (!force && now - lastWrite < 1000) return; lastWrite = now;
  try { localStorage.setItem(IDLE_KEY, String(now)); } catch { /* storage off: this tab still works */ }
  channel()?.postMessage({ type: 'active', at: now } satisfies Msg);
}
/** Tell the other tabs to sign out. */
export function broadcastLogout(reason: 'idle' | 'manual') {
  channel()?.postMessage({ type: 'logout', reason } satisfies Msg);
  try { localStorage.setItem('gl:logout', `${reason}:${Date.now()}`); } catch { /* ignore */ }
}
/** Wrap long-running work (tutor stream, upload) so it counts as activity while it runs. */
export async function trackBusy<T>(p: Promise<T>): Promise<T> {
  busy++; markActive();
  try { return await p; } finally { busy--; markActive(); }
}

/** Work to finish before an idle sign-out (e.g. saving the answers of a timed assessment). */
const savers = new Set<() => unknown | Promise<unknown>>();
export function registerBeforeIdleLogout(fn: () => unknown | Promise<unknown>) { savers.add(fn); return () => { savers.delete(fn); }; }
export async function runBeforeIdleLogout(timeoutMs = 4000) {
  const all = Promise.allSettled([...savers].map((f) => Promise.resolve().then(f)));
  await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]);
}

/** Why the user was last signed out (shown on the login page when it is reached without ?reason). */
let reason: 'idle' | null = null;
export const setSignOutReason = (r: 'idle' | null) => { reason = r; };
export const peekSignOutReason = () => reason;

/** Only same-site paths are followed after signing in (no other origins, protocol-relative or backslash tricks). */
export function safeNext(p: unknown): string | null {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.startsWith('/\\') || p.length > 2000) return null;
  if (/[\u0000-\u001f]/.test(p) || /^\/[a-z][a-z0-9+.-]*:/i.test(p)) return null;
  try { const u = new URL(p, 'https://x.invalid'); if (u.origin !== 'https://x.invalid') return null; if (/^\/(login|register|logout)(\/|$)/.test(u.pathname)) return null; return u.pathname + u.search + u.hash; } catch { return null; }
}
/** Test helper. */
export function _resetIdleForTest(now = Date.now()) { local = now; lastWrite = 0; busy = 0; reason = null; savers.clear(); ch = undefined; listeners.clear(); }
