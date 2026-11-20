import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { hasPermission, type Role } from '@ghlearn/shared';
import { type ReactNode } from 'react';
import { BookOpen, LayoutDashboard, Settings, LogOut, GraduationCap, BarChart3, ClipboardCheck, Bell as BellIcon, CalendarClock, UserRound, KeyRound } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { SampleBadge } from './ui';
import { Brand, usePlatform, type PublicSettings } from '../lib/platform';
export function navFor(all: Role[], features: Partial<PublicSettings['features']> = {}) {
  // Learner/teacher areas follow the roles a user actually holds: a super admin's blanket permissions
  // must not put "My progress" or "Assessments" in their menus (they can still open them by URL).
  const roles = all.filter((r) => r !== 'super_admin') as Role[];
  const n: { to: string; label: string; icon: typeof BookOpen }[] = [];
  if (roles.includes('student')) n.push({ to: '/learn', label: 'My subjects', icon: BookOpen });
  if (hasPermission(roles, 'progress:view_own')) n.push({ to: '/progress', label: 'My progress', icon: BarChart3 });
  if (roles.includes('teacher')) n.push({ to: '/teach', label: 'Teaching', icon: GraduationCap });
  if (hasPermission(roles, 'activity:assign') && features.assessments !== false) n.push({ to: '/teach/assess', label: 'Assessments', icon: ClipboardCheck });
  if (roles.some((r) => r === 'student' || r === 'teacher' || r === 'counselor') && features.meetings !== false) n.push({ to: '/meetings', label: 'Meetings', icon: CalendarClock });
  // Every administrative area lives in the admin panel (/admin) with its own permission-filtered sidebar.
  if (hasPermission(all, 'admin:access')) n.push({ to: '/admin', label: 'Admin panel', icon: Settings });
  if (!n.length) n.push({ to: '/', label: 'Dashboard', icon: LayoutDashboard });
  return n;
}
export function Layout({ children }: { children?: ReactNode } = {}) {
  const { user, logout } = useAuth(); const nav = useNavigate(); const p = usePlatform();
  if (!user) return null;
  return <div className="min-h-screen">
    <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-white focus:p-2">Skip to content</a>
    <header className="border-b bg-brand-900 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
        <Brand className="text-lg font-bold" />
        <nav aria-label="Main" className="flex flex-1 flex-wrap gap-1">
          {navFor(user.roles, p.features).map(({ to, label, icon: I }) => <NavLink key={to} to={to} className={({ isActive }) => `flex items-center gap-1 rounded px-3 py-1.5 text-sm ${isActive ? 'bg-white/20' : 'hover:bg-white/10'}`}><I className="h-4 w-4" aria-hidden />{label}</NavLink>)}
        </nav>
        {user.roles.includes('student') && p.offline.saveLessonsEnabled && <Link to="/saved" className="rounded px-2 py-1 text-sm hover:bg-white/10">Saved lessons</Link>}
        {user.roles.includes('student') && <Link to="/profile" className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-white/10"><UserRound className="h-4 w-4" aria-hidden />My profile</Link>}
        <Link to="/account" className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-white/10"><KeyRound className="h-4 w-4" aria-hidden />Account</Link>
        <Bell />
        {user.isSample && <SampleBadge />}
        <span className="hidden text-sm opacity-90 sm:inline">{user.fullName}</span>
        <button onClick={() => logout().then(() => nav('/login'))} className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-white/10"><LogOut className="h-4 w-4" aria-hidden />Sign out</button>
      </div>
    </header>
    <main id="main" className="mx-auto max-w-6xl px-4 py-6"><Welcome />{children ?? <Outlet />}</main>
    <LegalFooter />
  </div>;
}

/** Unread badge, polled every 60 s (cheap count query). */
function Bell() {
  const q = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => api<{ unread: number }>('/api/notifications?unread=true&limit=1'), refetchInterval: 60_000, retry: false });
  const n = q.data?.unread ?? 0;
  return <Link to="/notifications" className="relative rounded p-1.5 hover:bg-white/10" aria-label={n ? `Notifications, ${n} unread` : 'Notifications'}><BellIcon className="h-5 w-5" aria-hidden />
    {n > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-900" aria-hidden>{n > 99 ? '99+' : n}</span>}</Link>;
}

/** Terms and privacy links (§20), shown when the texts are published. */
export function LegalFooter({ className = '' }: { className?: string }) {
  const p = usePlatform(); if (!p.legal.terms && !p.legal.privacy) return null;
  return <footer className={`mx-auto flex max-w-6xl flex-wrap gap-4 px-4 pb-6 text-sm text-slate-600 ${className}`}>
    {p.legal.terms && <Link className="underline" to="/terms">Terms of use</Link>}{p.legal.privacy && <Link className="underline" to="/privacy">Privacy notice</Link>}
    {p.branding.supportEmail && <a className="underline" href={`mailto:${p.branding.supportEmail}`}>Contact support</a>}</footer>;
}

/** Shown once after a new account sets its password (set-password link); dismissible. */
function Welcome() {
  const loc = useLocation(); const nav = useNavigate(); const { user } = useAuth(); const p = usePlatform();
  if (!(loc.state as any)?.welcome || !user) return null;
  const teacher = user.roles.includes('teacher');
  return <div role="status" className="mb-4 rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-900">
    <p className="font-semibold">Welcome to {p.branding.appName}, {user.fullName.split(/\s+/)[0]}. Your password is set and you are signed in.</p>
    {teacher && <p className="mt-1">This is your teaching dashboard. Start by creating a class for each group you teach, then add students and set work. Your subjects were added by the administrator who approved you.</p>}
    <button type="button" className="mt-2 text-brand-700 underline" onClick={() => nav(loc.pathname + loc.search, { replace: true, state: null })}>Dismiss</button>
  </div>;
}
