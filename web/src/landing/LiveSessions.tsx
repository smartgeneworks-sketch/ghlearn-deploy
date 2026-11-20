import { CalendarClock, CheckCircle2, MapPin, MessageSquareText, Video, BellRing, type LucideIcon } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useLanding } from './api';
import { SectionHeading, SmartLink } from './PublicShell';

const POINT_ICONS: LucideIcon[] = [CalendarClock, Video, MessageSquareText, BellRing];
const SIZES = '(min-width: 1024px) 560px, (min-width: 640px) 90vw, 100vw';
const set = (ext: string) => [480, 800, 1200].map((w) => `/img/student-live-${w}.${ext} ${w}w`).join(', ');
export const STUDENT_PHOTO_ALT = 'A student wearing glasses and a light blue sweater concentrates on his laptop at a study desk.';

/** Where the live-sessions CTA goes: students book under Meetings, hosts manage theirs there, visitors sign up first. */
export function liveSessionsCta(user: { roles: string[] } | null | undefined, selfRegistration: boolean) {
  if (!user) return { to: selfRegistration ? '/register' : '/login', kind: 'visitor' as const };
  // Same rule as the app's Meetings nav entry: only students, teachers and counselors use Meetings.
  if (user.roles.includes('student')) return { to: '/meetings', kind: 'student' as const };
  if (user.roles.some((r) => r === 'teacher' || r === 'counselor')) return { to: '/meetings', kind: 'host' as const };
  return null;
}

/** Example of the real booking card a student sees under Meetings (static, clearly labelled). */
function BookingCardExample() {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xl shadow-navy-900/10">
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-wider text-slate-600">My meetings</p>
      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Example</span></div>
    <div className="mt-3 rounded-xl border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="font-semibold text-navy-900">Completing the square</p>
          <p className="mt-0.5 text-sm text-slate-700">Thu, 16:00–16:30 · Online · with your Mathematics teacher</p></div>
        <span className="shrink-0 rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">Confirmed</span></div>
      <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-800 underline decoration-brand-700/40 underline-offset-2"><Video className="h-4 w-4" aria-hidden />Join online meeting</p>
    </div>
    <div className="mt-2 flex items-start justify-between gap-2 rounded-xl border border-dashed border-slate-300 p-3">
      <div className="min-w-0"><p className="font-semibold text-navy-900">Choosing my electives</p>
        <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-700"><MapPin className="h-3.5 w-3.5" aria-hidden />Mon, 12:30 · In person · with the school counselor</p></div>
      <span className="shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Awaiting reply</span></div>
  </div>;
}

export function LiveSessionsSection() {
  const l = useLanding(); const x = l.content.liveSessions; const { user } = useAuth();
  if (l.features.meetings === false) return null;
  const cta = liveSessionsCta(user, l.features.selfRegistration);
  return <section id="live-sessions" aria-labelledby="live-title" className="scroll-mt-20 py-20">
    <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.05fr]">
      <div><SectionHeading id="live-title" eyebrow="Live sessions" title={l.t(x.title)} subtitle={l.t(x.subtitle)} />
        <ul className="mt-8 grid gap-5 sm:grid-cols-2">{x.points.map((p, i) => { const I = POINT_ICONS[i % POINT_ICONS.length];
          return <li key={i} className="flex gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-800"><I className="h-5 w-5" aria-hidden /></span>
            <div><h3 className="font-bold text-navy-900">{l.t(p.title)}</h3><p className="mt-1 text-sm leading-relaxed text-slate-600">{l.t(p.body)}</p></div></li>; })}</ul>
        {x.note && <p className="mt-6 flex gap-2 rounded-2xl bg-navy-50 p-4 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden />{l.t(x.note)}</p>}
        {cta && <div className="mt-8"><SmartLink href={cta.to} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand-700 px-6 text-base font-semibold text-white transition hover:-translate-y-0.5 hover:bg-brand-800">
          <CalendarClock className="h-5 w-5" aria-hidden />{cta.kind === 'visitor' ? x.ctaLabel : cta.kind === 'host' ? 'Manage your sessions' : x.signedInCtaLabel}</SmartLink></div>}
      </div>
      <figure className="relative">
        <div className="relative overflow-hidden rounded-3xl bg-navy-900 shadow-xl shadow-navy-900/10">
          <picture>
            <source type="image/avif" srcSet={set('avif')} sizes={SIZES} />
            <source type="image/webp" srcSet={set('webp')} sizes={SIZES} />
            <img src="/img/student-live-800.jpg" srcSet={set('jpg')} sizes={SIZES} width={1200} height={1000} loading="lazy" decoding="async" alt={STUDENT_PHOTO_ALT} className="block h-auto w-full" />
          </picture>
          <div aria-hidden className="absolute right-3 top-3 flex flex-col items-end gap-2 sm:right-5 sm:top-5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-navy-900 shadow-md"><CalendarClock className="h-3.5 w-3.5 text-brand-700" />Slot open · Thu 16:00</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-navy-900 shadow-md"><CheckCircle2 className="h-3.5 w-3.5 text-brand-700" />Teacher confirmed</span>
          </div>
        </div>
        <div className="relative z-10 mx-auto -mt-10 w-[92%] sm:-mt-16 sm:w-[78%] lg:absolute lg:-bottom-8 lg:-left-8 lg:mt-0 lg:w-[66%]"><BookingCardExample /></div>
        <figcaption className="mt-4 text-xs text-slate-600 lg:ml-[62%] lg:mt-3">Example booking. Times and topics are illustrative; your Meetings page shows your own.</figcaption>
      </figure>
    </div>
  </section>;
}
