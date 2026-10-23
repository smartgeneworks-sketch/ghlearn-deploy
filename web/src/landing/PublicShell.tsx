import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { hasPermission } from '@ghlearn/shared';
import { ArrowUp, ChevronDown, GraduationCap, LayoutDashboard, UserPlus, Mail, MapPin, Menu, Phone, Search, Settings, X, LifeBuoy } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { homeFor, telHref, useLanding } from './api';

/** Landing anchors live on "/" for visitors; signed-in users are sent from "/" to their dashboard, so they use /welcome. */
export function useLandingBase() { const { user } = useAuth(); return user ? '/welcome' : '/'; }
export const NAV_ITEMS = [
  { label: 'Explore Subjects', hash: 'subjects' }, { label: 'How It Works', hash: 'how-it-works' }, { label: 'AI Tutor', hash: 'ai-tutor' },
  { label: 'Practice & Games', hash: 'practice' }, { label: 'Live Sessions', hash: 'live-sessions' }, { label: 'For Teachers', to: '/teachers' }, { label: 'For Schools', to: '/schools' },
] as const;
/** Nav items for features that are switched on (the live-sessions anchor only exists when meetings are enabled). */
function useNavItems() { const l = useLanding(); return NAV_ITEMS.filter((i) => !('hash' in i && i.hash === 'live-sessions') || l.features.meetings !== false); }
const navTo = (base: string, i: (typeof NAV_ITEMS)[number]) => ('to' in i ? i.to : `${base}#${i.hash}`);

export function Logo({ className = '' }: { className?: string }) {
  const { branding } = useLanding();
  return <span className={`inline-flex items-center gap-2 font-bold tracking-tight ${className}`}>
    {branding.logo ? <img src={branding.logo} alt="" className="h-8 w-8 rounded-lg bg-white object-contain p-0.5" />
      : <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden><rect width="32" height="32" rx="9" fill="var(--color-brand-700)" /><path d="M8 21.5 16 9l8 12.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /><circle cx="16" cy="21.5" r="2.4" fill="#fbbf24" /></svg>}
    <span>{branding.appName}</span></span>;
}

export function AnnouncementBar() {
  const { content: { announcement: a } } = useLanding(); const key = `gl:announce:${a.text}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  useEffect(() => { try { setHidden(localStorage.getItem(key) === '1'); } catch { /* */ } }, [key]);
  if (!a.enabled || !a.text || hidden) return null;
  return <div role="region" aria-label="Announcement" className="bg-navy-900 text-sm text-white">
    <div className="relative mx-auto flex max-w-7xl items-center justify-center gap-3 px-10 py-2 text-center">
      <p>{a.text}{a.linkLabel && a.linkHref && <> <SmartLink href={a.linkHref} className="ml-1 font-semibold text-amber-300 underline underline-offset-2 hover:text-amber-200">{a.linkLabel}</SmartLink></>}</p>
      <button type="button" onClick={() => { setHidden(true); try { localStorage.setItem(key, '1'); } catch { /* */ } }} className="absolute right-2 rounded p-1.5 hover:bg-white/10" aria-label="Dismiss announcement"><X className="h-4 w-4" aria-hidden /></button>
    </div></div>;
}
/** Internal paths through the router, https links as normal anchors. */
export function SmartLink({ href, className, children, onClick }: { href: string; className?: string; children: ReactNode; onClick?: () => void }) {
  return href.startsWith('/') ? <Link to={href} className={className} onClick={onClick}>{children}</Link> : <a href={href} className={className} onClick={onClick} rel="noopener noreferrer">{children}</a>;
}

function AuthActions({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { user } = useAuth(); const l = useLanding();
  const btn = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition';
  if (user) {
    const home = homeFor(user, l.features);
    return <div className={`flex ${compact ? 'flex-col items-stretch' : 'items-center'} gap-2`}>
      {hasPermission(user.roles, 'admin:access') && home !== '/admin' && <Link to="/admin" onClick={onNavigate} className={`${btn} text-navy-900 hover:bg-slate-100`}><Settings className="h-4 w-4" aria-hidden />Admin panel</Link>}
      {user.roles.includes('teacher') && home !== '/teach' && <Link to="/teach" onClick={onNavigate} className={`${btn} text-navy-900 hover:bg-slate-100`}><GraduationCap className="h-4 w-4" aria-hidden />Teacher workspace</Link>}
      <Link to={home} onClick={onNavigate} className={`${btn} bg-brand-700 text-white shadow-sm hover:bg-brand-800`}><LayoutDashboard className="h-4 w-4" aria-hidden />Continue Learning</Link>
    </div>;
  }
  return <div className={`flex ${compact ? 'flex-col items-stretch' : 'items-center'} gap-2`}>
    <Link to="/login" onClick={onNavigate} className={`${btn} text-navy-900 hover:bg-slate-100 ${compact ? 'border border-slate-300' : ''}`}>Log In</Link>
    {compact && <>{l.features.selfRegistration && <Link to="/register" onClick={onNavigate} className={`${btn} bg-brand-700 text-white shadow-sm hover:bg-brand-800`}>{l.content.signup.loginStudentLabel}</Link>}
      <Link to="/register/teacher" onClick={onNavigate} className={`${btn} border border-brand-700 text-brand-800 hover:bg-brand-50`}>{l.content.signup.teacherApplyLabel}</Link></>}
  </div>;
}

/**
 * Primary "Sign up" button in the header bar (also on phones): a small menu with the student and the teacher route.
 * With student self-registration off it links straight to the teacher application.
 */
export function SignUpMenu() {
  const l = useLanding(); const s = l.content.signup; const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null); const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => { if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector<HTMLElement>('button')?.focus(); } };
    const c = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', k); document.addEventListener('mousedown', c); return () => { window.removeEventListener('keydown', k); document.removeEventListener('mousedown', c); }; }, [open]);
  const cls = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-brand-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-800 sm:px-5';
  if (!l.features.selfRegistration) return <Link to="/register/teacher" className={cls}>{s.headerLabel}<span className="sr-only"> as a teacher</span></Link>;
  const item = 'flex min-h-12 flex-col justify-center rounded-xl px-3 py-2 hover:bg-brand-50 focus-visible:bg-brand-50';
  return <div ref={ref} className="relative">
    <button type="button" className={cls} aria-expanded={open} aria-controls="signup-menu" onClick={() => setOpen((o) => !o)}>
      <UserPlus className="hidden h-4 w-4 sm:block" aria-hidden />{s.headerLabel}<ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} aria-hidden /></button>
    {open && <div id="signup-menu" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
      <ul aria-label={s.headerLabel}>
        <li><Link to="/register" className={item}><span className="font-semibold text-navy-900">{s.studentLabel}</span>{s.studentHint && <span className="text-xs text-slate-600">{s.studentHint}</span>}</Link></li>
        <li><Link to="/register/teacher" className={item}><span className="font-semibold text-navy-900">{s.teacherLabel}</span>{s.teacherHint && <span className="text-xs text-slate-600">{s.teacherHint}</span>}</Link></li>
      </ul></div>}
  </div>;
}

export function Navbar() {
  const { user } = useAuth(); const l = useLanding(); const base = useLandingBase(); const [open, setOpen] = useState(false); const navItems = useNavItems();
  const logoTo = user ? homeFor(user, l.features) : '/';
  return <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
    <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
      <Link to={logoTo} className="shrink-0 text-lg text-navy-900" aria-label={user ? `${l.branding.appName}: go to your dashboard` : `${l.branding.appName} home`}><Logo /></Link>
      <nav aria-label="Main" className="hidden flex-1 items-center justify-center gap-1 xl:flex">
        {navItems.map((i) => 'to' in i
          ? <NavLink key={i.label} to={i.to} className={({ isActive }) => `rounded-full px-3 py-2 text-sm font-medium transition hover:bg-slate-100 hover:text-navy-900 ${isActive ? 'text-brand-800' : 'text-slate-700'}`}>{i.label}</NavLink>
          : <Link key={i.label} to={navTo(base, i)} className="rounded-full px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-navy-900">{i.label}</Link>)}
      </nav>
      <div className="ml-auto flex items-center gap-1 xl:ml-0">
        <Link to={`${base}#search`} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100" aria-label="Search subjects and topics"><Search className="h-5 w-5" aria-hidden /></Link>
        <div className="hidden md:block"><AuthActions /></div>
        {!user && <SignUpMenu />}
        <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-navy-900 hover:bg-slate-100 xl:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
          {open ? <X className="h-6 w-6" aria-hidden /> : <Menu className="h-6 w-6" aria-hidden />}</button>
      </div>
    </div>
    <MobileNavigation open={open} onClose={() => setOpen(false)} base={base} />
  </header>;
}

export function MobileNavigation({ open, onClose, base }: { open: boolean; onClose: () => void; base: string }) {
  const ref = useRef<HTMLDivElement>(null); const navItems = useNavItems();
  useEffect(() => { if (!open) return; ref.current?.querySelector<HTMLElement>('a,button')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open, onClose]);
  if (!open) return null;
  return <div id="mobile-nav" ref={ref} className="border-t border-slate-200 bg-white px-4 pb-5 pt-2 shadow-lg xl:hidden">
    <nav aria-label="Mobile"><ul className="divide-y divide-slate-100">
      {navItems.map((i) => <li key={i.label}><Link to={navTo(base, i)} onClick={onClose} className="flex min-h-12 items-center text-base font-medium text-navy-900">{i.label}</Link></li>)}
    </ul></nav>
    <div className="mt-3 md:hidden"><AuthActions compact onNavigate={onClose} /></div>
  </div>;
}

export function Footer() {
  const l = useLanding(); const base = useLandingBase(); const o = l.content.organisation; const year = new Date().getFullYear();
  const cols: { title: string; links: { label: string; to: string }[] }[] = [
    { title: 'Learn', links: [{ label: 'Explore Subjects', to: '/subjects' }, { label: 'How It Works', to: `${base}#how-it-works` }, { label: 'AI Tutor', to: `${base}#ai-tutor` }, { label: 'For Students', to: `${base}#personalized` }, ...(l.features.meetings !== false ? [{ label: 'Live Sessions', to: `${base}#live-sessions` }] : [])] },
    { title: 'Sign up', links: [...(l.features.selfRegistration ? [{ label: 'Student account', to: '/register' }] : []), { label: 'Teacher application', to: '/register/teacher' }, { label: 'Log in', to: '/login' }] },
    { title: 'Educators', links: [{ label: 'For Teachers', to: '/teachers' }, { label: 'For Schools', to: '/schools' }] },
    { title: 'Support', links: [{ label: 'Help Centre', to: '/help' }, { label: 'Contact', to: '/contact' }, { label: 'Accessibility', to: '/accessibility' }] },
    { title: 'Legal', links: [{ label: 'Privacy Policy', to: '/privacy' }, { label: 'Terms of Service', to: '/terms' }] },
  ];
  return <footer className="bg-navy-900 text-slate-300" aria-labelledby="footer-title">
    <h2 id="footer-title" className="sr-only">Site footer</h2>
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.3fr_2fr]">
      <div className="space-y-4">
        <Link to={base} className="text-lg text-white"><Logo /></Link>
        {l.content.footer.description && <p className="max-w-sm text-sm leading-relaxed">{l.t(l.content.footer.description)}</p>}
        <Link to="/help" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-4 text-sm font-semibold text-white hover:bg-white/10"><LifeBuoy className="h-4 w-4" aria-hidden />Get help</Link>
      </div>
      <div className="grid grid-cols-2 gap-8 sm:grid-cols-5">
        {cols.map((c) => <div key={c.title}><h3 className="text-sm font-semibold text-white">{c.title}</h3>
          <ul className="mt-3 space-y-1">{c.links.map((x) => <li key={x.label}><Link to={x.to} className="inline-flex min-h-9 items-center text-sm hover:text-white hover:underline">{x.label}</Link></li>)}</ul></div>)}
      </div>
    </div>
    <div className="border-t border-white/10">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-8 text-sm sm:px-6 md:grid-cols-2">
        {o.name && <section aria-label={`${o.poweredByLabel} ${o.name}`.trim()} className="space-y-1.5">
          <p className="font-semibold text-white">{o.poweredByLabel ? `${o.poweredByLabel} ` : ''}{o.name}</p>
          {o.address && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{o.address}</p>}
          {o.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 shrink-0" aria-hidden />Email: <a className="underline hover:text-white" href={`mailto:${o.email}`}>{o.email}</a></p>}
          {o.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0" aria-hidden />Phone: <a className="underline hover:text-white" href={telHref(o.phone)}>{o.phone}</a></p>}
          {o.hashtag && <p className="font-semibold text-amber-300">{o.hashtag}</p>}
        </section>}
        <div className="space-y-2 md:text-right">
          {l.content.footer.dataProtection && <p className="md:ml-auto md:max-w-md">{l.t(l.content.footer.dataProtection)}</p>}
          {l.content.footer.languageNote && <p>{l.t(l.content.footer.languageNote)}</p>}
          <p>© {year} {l.branding.appName}. All rights reserved.</p>
          <a href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); document.getElementById('main')?.focus({ preventScroll: true }); }}
            className="inline-flex min-h-11 items-center gap-1 font-semibold text-white hover:underline"><ArrowUp className="h-4 w-4" aria-hidden />Back to top</a>
        </div>
      </div>
    </div>
  </footer>;
}

/** Scrolls to #hash after navigation (React Router does not), waiting for lazily rendered sections. */
function useHashScroll() {
  const { hash, pathname } = useLocation();
  useEffect(() => {
    if (!hash) { window.scrollTo(0, 0); return; }
    let n = 0; const id = decodeURIComponent(hash.slice(1));
    const tick = () => { const el = document.getElementById(id); if (el) { el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      const f = el.querySelector<HTMLElement>('input[type=search]'); if (f) f.focus({ preventScroll: true }); else { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); } }
      else if (n++ < 40) setTimeout(tick, 50); };
    tick();
  }, [hash, pathname]);
}
export function PublicLayout({ children, title, description }: { children: ReactNode; title?: string; description?: string }) {
  const l = useLanding(); useHashScroll();
  useEffect(() => {
    document.title = title ? `${title} · ${l.branding.appName}` : `${l.branding.appName}: ${l.content.hero.title}`;
    const m = document.querySelector('meta[name="description"]'); const d = description ?? l.t(l.content.hero.subtitle);
    if (m) m.setAttribute('content', d);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', document.title); document.querySelector('meta[property="og:description"]')?.setAttribute('content', d);
  }, [title, description, l.branding.appName, l.content.hero.title, l.content.hero.subtitle]);
  return <div id="top" className="flex min-h-screen flex-col bg-white text-slate-800">
    <a href="#main" className="sr-only z-50 rounded bg-white p-2 focus:not-sr-only focus:absolute focus:left-2 focus:top-2">Skip to content</a>
    <AnnouncementBar /><Navbar />
    <main id="main" tabIndex={-1} className="flex-1 outline-none">{children}</main>
    <Footer />
  </div>;
}
/** Shared section heading. */
export function SectionHeading({ id, eyebrow, title, subtitle, center = false, dark = false }: { id?: string; eyebrow?: string; title: string; subtitle?: string; center?: boolean; dark?: boolean }) {
  return <div className={`max-w-3xl ${center ? 'mx-auto text-center' : ''}`}>
    {eyebrow && <p className={`text-xs font-bold uppercase tracking-[0.18em] ${dark ? 'text-amber-300' : 'text-brand-700'}`}>{eyebrow}</p>}
    <h2 id={id} className={`mt-2 text-3xl font-bold tracking-tight sm:text-4xl ${dark ? 'text-white' : 'text-navy-900'}`}>{title}</h2>
    {subtitle && <p className={`mt-3 text-lg leading-relaxed ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{subtitle}</p>}
  </div>;
}
