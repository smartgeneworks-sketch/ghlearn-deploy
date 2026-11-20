import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { usePlatform } from '../lib/platform';
import { post } from '../lib/api';
import { DEFAULT_IDLE, idleLimitSeconds, isBusy, lastActivity, markActive, onIdleMessage, runBeforeIdleLogout } from '../lib/idle';
import { Button } from './ui';

const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;
const BEAT_KEY = 'gl:lastBeat';
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const readBeat = () => { try { return Number(localStorage.getItem(BEAT_KEY)) || 0; } catch { return 0; } };

/**
 * Signs a signed-in user out after a period of inactivity (limits from the platform settings: one for administrator
 * roles, one for everyone else). A warning dialog with a countdown appears shortly before. Activity in any tab keeps
 * every tab alive; a streaming tutor answer or an upload counts as activity. On timeout, registered savers run (e.g. the
 * answers of a timed assessment), the session ends on the server, and the app goes to the login page.
 */
export function IdleTimer() {
  const { user, logout } = useAuth(); const p = usePlatform(); const nav = useNavigate(); const loc = useLocation();
  const cfg = p.idle ?? DEFAULT_IDLE;
  const limitMs = user ? idleLimitSeconds(user.roles, cfg) * 1000 : 0; const warnMs = Math.min(cfg.warnSeconds * 1000, limitMs / 2);
  const [left, setLeft] = useState<number | null>(null);
  const warning = useRef(false); warning.current = left != null;
  const expiring = useRef(false);
  const where = useRef(''); where.current = loc.pathname + loc.search + loc.hash;

  const expire = useCallback(async () => {
    if (expiring.current) return; expiring.current = true; setLeft(null);
    const next = where.current;
    try { await runBeforeIdleLogout(); } finally {
      // Leave the protected page first so its guard does not redirect without the reason.
      nav(`/login?reason=idle&next=${encodeURIComponent(next)}`, { replace: true });
      await logout({ reason: 'idle' });
    }
  }, [logout, nav]);

  const beat = useCallback((force = false) => {
    const now = Date.now();
    if (!force && (now - lastActivity() > 60_000 || now - readBeat() < 60_000)) return;
    try { localStorage.setItem(BEAT_KEY, String(now)); } catch { /* ignore */ }
    post('/api/auth/activity', {}).catch(() => undefined);
  }, []);

  const tick = useCallback(() => {
    if (expiring.current || !limitMs) return;
    if (isBusy()) markActive();
    const remaining = limitMs - (Date.now() - lastActivity());
    if (remaining <= 0) { void expire(); return; }
    setLeft(remaining <= warnMs ? Math.ceil(remaining / 1000) : null);
    beat();
  }, [limitMs, warnMs, expire, beat]);

  const tickRef = useRef(tick); tickRef.current = tick; const expireRef = useRef(expire); expireRef.current = expire;
  // Signing in counts as activity.
  // Signing in counts as activity on the server too, so the first keep-alive is due a minute later (not right after sign-in).
  useEffect(() => { if (user) { markActive(Date.now(), true); try { localStorage.setItem(BEAT_KEY, String(Date.now())); } catch { /* ignore */ } } else { expiring.current = false; setLeft(null); } }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    const tick = () => tickRef.current(); const expire = () => expireRef.current();
    // While the warning shows, only "Stay signed in" (or activity in another tab) keeps the session.
    const onAct = () => { if (!warning.current && !expiring.current) markActive(); };
    const onVis = () => { if (document.visibilityState !== 'visible') return; tick(); onAct(); };
    for (const e of EVENTS) window.addEventListener(e, onAct, { passive: true, capture: true });
    document.addEventListener('visibilitychange', onVis);
    const onServerIdle = () => { void expire(); };
    window.addEventListener('gl:idle-expired', onServerIdle);
    const off = onIdleMessage((m) => { if (m.type === 'active') tick(); });
    const t = setInterval(tick, 1000);
    return () => { for (const e of EVENTS) window.removeEventListener(e, onAct, { capture: true }); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('gl:idle-expired', onServerIdle); off(); clearInterval(t); };
  }, [user?.id]);

  if (!user || left == null) return null;
  return <IdleWarning seconds={left} onStay={() => { markActive(Date.now(), true); setLeft(null); beat(true); }}
    onSignOut={async () => { expiring.current = true; setLeft(null); nav('/login', { replace: true }); await logout(); }} />;
}

/** Accessible warning: a labelled alertdialog, focus moved in and trapped, Escape keeps the session. */
export function IdleWarning({ seconds, onStay, onSignOut }: { seconds: number; onStay: () => void; onSignOut: () => void }) {
  const id = useId(); const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const back = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(); return () => back?.focus?.(); }, []);
  // Announce at a few points rather than every second.
  const say = seconds > 30 ? 'one minute' : seconds > 10 ? '30 seconds' : '10 seconds';
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onStay(); return; }
    if (e.key !== 'Tab' || !box.current) return;
    const f = [...box.current.querySelectorAll<HTMLElement>('button')]; if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  };
  return createPortal(<div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" onKeyDown={onKey}>
    <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl">
      <h2 id={`${id}-t`} className="text-lg font-semibold">Are you still there?</h2>
      <p id={`${id}-d`} className="text-sm text-slate-700">For your security you will be signed out because of inactivity in <span role="timer" aria-live="off" className="font-mono font-semibold">{fmt(seconds)}</span>.</p>
      <p className="sr-only" aria-live="assertive">{`Signing out in less than ${say}`}</p>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onSignOut}>Sign out</Button><Button data-autofocus onClick={onStay}>Stay signed in</Button></div>
    </div></div>, document.body);
}
