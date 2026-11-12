import { broadcastLogout, onIdleMessage, setSignOutReason } from './idle';
import { clearOffline } from './offline';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, post, type PublicUser, HttpError } from './api';
interface AuthCtx { user: PublicUser | null; loading: boolean; logout: (opts?: { reason?: 'idle' }) => Promise<void>; setUser: (u: PublicUser) => void }
const Ctx = createContext<AuthCtx>(null as any);
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me'], retry: false, staleTime: 60_000,
    // /api/auth/session answers 200 for visitors, so public pages log no failed requests; refresh only when a refresh cookie exists.
    queryFn: async () => { const s = await api<{ user: PublicUser | null; refresh: boolean }>('/api/auth/session');
      if (s.user || !s.refresh) return s.user;
      try { return (await post<{ user: PublicUser }>('/api/auth/refresh', {})).user; } catch (e) { if (e instanceof HttpError && e.status === 401) { if (e.code === 'SESSION_IDLE') setSignOutReason('idle'); return null; } throw e; } } });
  // A hint (no secret, just "someone was signed in here") so the public home can wait for /me instead of flashing the landing page.
  useEffect(() => { if (q.isLoading) return; try { if (q.data) localStorage.setItem(SESSION_HINT, '1'); else localStorage.removeItem(SESSION_HINT); } catch { /* storage off */ } }, [q.data, q.isLoading]);
  // Set "me" to null first (its observer re-renders; clearing it away would leave the old user on screen), then drop the rest.
  const signedOut = () => { clearOffline(); qc.setQueryData(['me'], null); qc.removeQueries({ predicate: (x) => x.queryKey[0] !== 'me' }); qc.getMutationCache().clear(); };
  const out = useMutation({ mutationFn: (reason?: 'idle') => post('/api/auth/logout', reason ? { reason } : {}), onSettled: signedOut });
  // Signing out in one tab signs out every tab (the cookies are shared, so only the local state needs clearing here).
  useEffect(() => onIdleMessage((m) => { if (m.type !== 'logout') return; if (m.reason === 'idle') setSignOutReason('idle'); signedOut(); }), []);
  const logout = (opts?: { reason?: 'idle' }) => { const r = opts?.reason ?? 'manual'; if (r === 'idle') setSignOutReason('idle'); broadcastLogout(r); return out.mutateAsync(opts?.reason).catch(() => undefined).then(() => undefined); };
  return <Ctx.Provider value={{ user: q.data ?? null, loading: q.isLoading, logout, setUser: (u) => qc.setQueryData(['me'], u) }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
export const SESSION_HINT = 'gl:signed-in';
export const hadSession = () => { try { return localStorage.getItem(SESSION_HINT) === '1'; } catch { return false; } };
