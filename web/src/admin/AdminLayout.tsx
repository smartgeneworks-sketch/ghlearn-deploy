import { Brand } from '../lib/platform';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell as BellIcon, CalendarDays, ChevronRight, LogOut, Menu, Search, UserRound, ShieldOff } from 'lucide-react';
import { ROLE_LABELS } from '@ghlearn/shared';
import { api, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { SampleBadge } from '../components/ui';
import { navFor } from '../components/Layout';
import { adminNavFor, crumbsFor } from './nav';

/** Admin shell (spec §3): permission-filtered sidebar, top bar (§3B) and breadcrumbs (§3C). */
export function AdminLayout() {
  const { user } = useAuth(); const loc = useLocation();
  const [open, setOpen] = useState(false); const [collapsed, setCollapsed] = useState(() => localStorage.getItem('gl_admin_collapsed') === '1');
  useEffect(() => setOpen(false), [loc.pathname]);
  if (!user) return null;
  const items = adminNavFor(user.roles);
  const other = navFor(user.roles).filter((n) => !n.to.startsWith('/admin') && n.to !== '/');
  const toggle = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) { const c = !collapsed; setCollapsed(c); localStorage.setItem('gl_admin_collapsed', c ? '1' : '0'); }
    else setOpen(!open);
  };
  return <div className="min-h-screen bg-slate-50">
    <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:p-2">Skip to content</a>
    <TopBar onToggle={toggle} expanded={typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches ? !collapsed : open} />
    <div className="flex">
      {open && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
      <aside id="admin-sidebar" className={`${open ? 'fixed inset-y-0 left-0 z-40 block w-72 overflow-y-auto pt-16' : 'hidden'} border-r bg-white lg:sticky lg:top-14 lg:block lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto lg:pt-0 ${collapsed ? 'lg:w-16' : 'lg:w-64'}`}>
        <nav aria-label="Admin sections" className="p-2"><ul className="space-y-0.5">
          {items.map(({ to, label, icon: I }) => <li key={to}><NavLink to={to} end={to === '/admin'} title={collapsed ? label : undefined}
            className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-brand-700 text-white' : 'text-slate-800 hover:bg-slate-100'}`}>
            <I className="h-4 w-4 shrink-0" aria-hidden /><span className={collapsed ? 'lg:sr-only' : ''}>{label}</span></NavLink></li>)}
        </ul></nav>
        {other.length > 0 && <nav aria-label="Other areas" className="px-2 pb-2"><p className={`mt-2 px-3 text-xs font-semibold uppercase text-slate-600 ${collapsed ? 'lg:sr-only' : ''}`} aria-hidden>Other areas</p>
            <ul className="mt-1 space-y-0.5">{other.map(({ to, label, icon: I }) => <li key={to}><NavLink to={to} title={collapsed ? label : undefined} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"><I className="h-4 w-4 shrink-0" aria-hidden /><span className={collapsed ? 'lg:sr-only' : ''}>{label}</span></NavLink></li>)}</ul></nav>}
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-4 lg:px-6"><Breadcrumbs /><Outlet /></main>
    </div>
  </div>;
}

function Breadcrumbs() {
  const loc = useLocation(); const c = crumbsFor(loc.pathname);
  return <nav aria-label="Breadcrumb" className="mb-3 text-sm"><ol className="flex flex-wrap items-center gap-1 text-slate-600">
    {c.map((x, i) => <li key={i} className="flex items-center gap-1">{i > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
      {x.to && i < c.length - 1 ? <Link to={x.to} className="text-brand-700 underline">{x.label}</Link> : <span aria-current={i === c.length - 1 ? 'page' : undefined} className="text-slate-800">{x.label}</span>}</li>)}
  </ol></nav>;
}

function TopBar({ onToggle, expanded }: { onToggle: () => void; expanded: boolean }) {
  const { user } = useAuth(); const nav = useNavigate(); const loc = useLocation();
  const [q, setQ] = useState(() => (loc.pathname === '/admin/search' ? new URLSearchParams(loc.search).get('q') ?? '' : ''));
  const years = useQuery({ queryKey: ['/api/config/academic-years'], queryFn: () => api<{ items: any[] }>('/api/config/academic-years').then((r) => r.items), staleTime: 300_000 });
  const current = years.data?.find((y) => y.current);
  return <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-brand-900 px-2 text-white sm:gap-3 sm:px-4">
    <button type="button" onClick={onToggle} aria-controls="admin-sidebar" aria-expanded={expanded} aria-label="Toggle sidebar" className="rounded p-2 hover:bg-white/10"><Menu className="h-5 w-5" aria-hidden /></button>
    <Link to="/admin" className="min-w-0 truncate whitespace-nowrap font-bold"><Brand suffix={<span className="hidden font-normal opacity-80 sm:inline">Admin</span>} /></Link>
    <form role="search" className="ml-1 min-w-0 flex-1 sm:max-w-md" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) nav(`/admin/search?q=${encodeURIComponent(q.trim())}`); }}>
      <label className="relative block"><span className="sr-only">Search the admin panel</span><Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-slate-500" aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" minLength={2} className="w-full rounded-lg border-0 bg-white py-1.5 pl-8 pr-2 text-sm text-slate-900 placeholder:text-slate-600" /></label>
    </form>
    <span className="hidden items-center gap-1 whitespace-nowrap rounded bg-white/10 px-2 py-1 text-xs md:flex" title="Current academic year"><CalendarDays className="h-4 w-4" aria-hidden />
      {years.isLoading ? '…' : current ? <>Academic year {current.label}</> : 'No current academic year'}</span>
    {user!.isSample && <span className="hidden lg:inline"><SampleBadge /></span>}
    <Bell />
    <ProfileMenu />
  </header>;
}

function Bell() {
  const q = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => api<{ unread: number }>('/api/notifications?unread=true&limit=1'), refetchInterval: 60_000, retry: false });
  const n = q.data?.unread ?? 0;
  return <Link to="/admin/notifications" className="relative rounded p-1.5 hover:bg-white/10" aria-label={n ? `Notifications, ${n} unread` : 'Notifications'}><BellIcon className="h-5 w-5" aria-hidden />
    {n > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-900" aria-hidden>{n > 99 ? '99+' : n}</span>}</Link>;
}

/** Disclosure-style profile menu: account settings, sign out, sign out everywhere. Escape and outside click close it. */
function ProfileMenu() {
  const { user, logout } = useAuth(); const nav = useNavigate(); const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null); const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', k); document.addEventListener('mousedown', c);
    return () => { document.removeEventListener('keydown', k); document.removeEventListener('mousedown', c); };
  }, [open]);
  const out = async (all: boolean) => { setOpen(false); if (all) { await post('/api/auth/logout-all', {}).catch(() => undefined); } await logout(); nav('/login'); };
  const roles = user!.roles.map((r) => ROLE_LABELS[r]).join(', ');
  return <div ref={ref} className="relative">
    <button ref={btn} type="button" aria-expanded={open} aria-controls="profile-menu" onClick={() => setOpen(!open)} className="flex items-center gap-1 rounded px-2 py-1.5 text-sm hover:bg-white/10">
      <UserRound className="h-5 w-5" aria-hidden /><span className="hidden max-w-[10rem] truncate md:inline">{user!.fullName}</span><span className="sr-only">Account menu</span></button>
    {open && <div id="profile-menu" className="absolute right-0 mt-1 w-64 rounded-xl border bg-white p-2 text-slate-900 shadow-lg">
      <p className="px-2 py-1 text-sm font-semibold">{user!.fullName}</p><p className="truncate px-2 text-xs text-slate-600">{user!.email}</p><p className="px-2 pb-2 text-xs text-slate-600">{roles}</p>
      <ul className="border-t pt-1">
        <li><Link to="/admin/account" onClick={() => setOpen(false)} className="block rounded px-2 py-1.5 text-sm hover:bg-slate-100">Account settings</Link></li>
        <li><button type="button" onClick={() => out(false)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100"><LogOut className="h-4 w-4" aria-hidden />Sign out</button></li>
        <li><button type="button" onClick={() => out(true)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100"><ShieldOff className="h-4 w-4" aria-hidden />Sign out of all devices</button></li>
      </ul></div>}
  </div>;
}
