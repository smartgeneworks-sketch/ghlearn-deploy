import { clearOffline } from './offline';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, post, type PublicUser, HttpError } from './api';
interface AuthCtx { user: PublicUser | null; loading: boolean; logout: () => Promise<void>; setUser: (u: PublicUser) => void }
const Ctx = createContext<AuthCtx>(null as any);
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me'], retry: false, staleTime: 60_000,
    // /api/auth/session answers 200 for visitors, so public pages log no failed requests; refresh only when a refresh cookie exists.
    queryFn: async () => { const s = await api<{ user: PublicUser | null; refresh: boolean }>('/api/auth/session');
      if (s.user || !s.refresh) return s.user;
      try { return (await post<{ user: PublicUser }>('/api/auth/refresh', {})).user; } catch (e) { if (e instanceof HttpError && e.status === 401) return null; throw e; } } });
  // A hint (no secret, just "someone was signed in here") so the public home can wait for /me instead of flashing the landing page.
  useEffect(() => { if (q.isLoading) return; try { if (q.data) localStorage.setItem(SESSION_HINT, '1'); else localStorage.removeItem(SESSION_HINT); } catch { /* storage off */ } }, [q.data, q.isLoading]);
  const out = useMutation({ mutationFn: () => post('/api/auth/logout', {}), onSettled: () => { clearOffline(); qc.clear(); qc.setQueryData(['me'], null); } });
  return <Ctx.Provider value={{ user: q.data ?? null, loading: q.isLoading, logout: () => out.mutateAsync().then(() => undefined), setUser: (u) => qc.setQueryData(['me'], u) }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
export const SESSION_HINT = 'gl:signed-in';
export const hadSession = () => { try { return localStorage.getItem(SESSION_HINT) === '1'; } catch { return false; } };
