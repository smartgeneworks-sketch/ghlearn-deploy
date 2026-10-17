import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { api } from './api';
import { clearSavedLessons } from './offline';
/** §20 public platform settings: branding, theme, maintenance, feature flags, offline policy and legal-text status. */
export interface PublicSettings {
  branding: { appName: string; tagline: string; logo: string | null; supportEmail: string };
  theme: { preset: string; colors: Record<string, string> | null };
  maintenance: { enabled: boolean; message?: string; until?: string | null };
  features: Record<'selfRegistration' | 'tutor' | 'practice' | 'games' | 'meetings' | 'assessments', boolean>;
  offline: { bundleEnabled: boolean; saveLessonsEnabled: boolean };
  legal: { version: number; updatedAt: string | null; terms: boolean; privacy: boolean };
  /** email: a reset link can be emailed (an email provider is configured on the server). sms: a reset code can be texted to a verified phone. */
  passwordReset?: { email: boolean; sms?: boolean; staffAssisted: boolean };
}
export const FALLBACK: PublicSettings = {
  branding: { appName: 'GH Learn', tagline: '', logo: null, supportEmail: '' }, theme: { preset: 'green', colors: null }, maintenance: { enabled: false },
  features: { selfRegistration: true, tutor: true, practice: true, games: true, meetings: true, assessments: true },
  offline: { bundleEnabled: true, saveLessonsEnabled: true }, legal: { version: 0, updatedAt: null, terms: false, privacy: false },
  passwordReset: { email: false, sms: false, staffAssisted: true },
};
export function usePlatform(): PublicSettings {
  const q = useQuery({ queryKey: ['platform'], queryFn: () => api<PublicSettings>('/api/settings/public'), staleTime: 60_000, retry: 1 });
  return q.data ?? FALLBACK;
}
const SHADES = ['50', '100', '600', '700', '800', '900'];
/** Applies the theme colours and app name, and removes saved lessons when the offline policy forbids them. */
export function PlatformEffects() {
  const p = usePlatform();
  useEffect(() => {
    const root = document.documentElement;
    for (const s of SHADES) { const v = p.theme.colors?.[s]; if (v) root.style.setProperty(`--color-brand-${s}`, v); else root.style.removeProperty(`--color-brand-${s}`); }
  }, [p.theme.colors]);
  useEffect(() => { document.title = p.branding.appName; }, [p.branding.appName]);
  useEffect(() => { if (!p.offline.saveLessonsEnabled) clearSavedLessons(); }, [p.offline.saveLessonsEnabled]);
  return null;
}
/** App name with the uploaded logo (decorative; the name is the accessible text). */
export function Brand({ className = '', suffix }: { className?: string; suffix?: ReactNode }) {
  const { branding } = usePlatform();
  return <span className={`inline-flex items-center gap-2 ${className}`}>{branding.logo && <img src={branding.logo} alt="" className="h-7 w-7 rounded bg-white object-contain p-0.5" />}{branding.appName}{suffix}</span>;
}
/** Maintenance: the server answers 503 MAINTENANCE to everyone except administrators. The API client raises an event. */
export const MAINTENANCE_EVENT = 'gl:maintenance';
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const p = usePlatform(); const [hit, setHit] = useState<string | null>(null);
  useEffect(() => { const on = (e: Event) => setHit((e as CustomEvent).detail ?? ''); window.addEventListener(MAINTENANCE_EVENT, on); return () => window.removeEventListener(MAINTENANCE_EVENT, on); }, []);
  useEffect(() => { if (!p.maintenance.enabled) setHit(null); }, [p.maintenance.enabled]);
  if (hit === null) return <>{p.maintenance.enabled && <MaintenanceBanner message={p.maintenance.message} until={p.maintenance.until} />}{children}</>;
  return <main id="main" className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
    <div className="max-w-lg space-y-3 rounded-xl border bg-white p-6 text-center shadow-sm">
      <Wrench className="mx-auto h-10 w-10 text-brand-700" aria-hidden />
      <h1 className="text-xl font-bold">{p.branding.appName} is under maintenance</h1>
      <p>{hit || p.maintenance.message || 'The platform is being updated. Please try again later.'}</p>
      {p.maintenance.until && <p className="text-sm text-slate-600">Expected back: {new Date(p.maintenance.until).toLocaleString()}</p>}
      <p className="text-sm"><Link className="text-brand-700 underline" to="/login" onClick={() => setHit(null)}>Administrator sign-in</Link></p>
    </div></main>;
}
function MaintenanceBanner({ message, until }: { message?: string; until?: string | null }) {
  return <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">
    <strong>Maintenance mode is on.</strong> {message || 'Only administrators can use the platform.'}{until ? ` Expected back ${new Date(until).toLocaleString()}.` : ''}</div>;
}
