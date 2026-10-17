import { Link } from 'react-router-dom';
import { BookOpen, Calculator, CheckCircle2, FlaskConical, Globe2, MessageCircle, Sparkles, Languages } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { homeFor, useLanding } from './api';
import { SmartLink, useLandingBase } from './PublicShell';

const SUBJECT_STYLE = [
  { icon: Calculator, tint: 'bg-sky-50 text-sky-700', bar: 'bg-sky-500', pct: 72 },
  { icon: FlaskConical, tint: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500', pct: 58 },
  { icon: Languages, tint: 'bg-amber-50 text-amber-700', bar: 'bg-amber-500', pct: 81 },
  { icon: Globe2, tint: 'bg-violet-50 text-violet-700', bar: 'bg-violet-500', pct: 44 },
  { icon: BookOpen, tint: 'bg-rose-50 text-rose-700', bar: 'bg-rose-500', pct: 63 },
  { icon: BookOpen, tint: 'bg-teal-50 text-teal-700', bar: 'bg-teal-500', pct: 37 },
];
/** Hero CTA destinations adapt to the session: signed-in users go to their dashboard instead of registration. */
export function useCtaTargets() {
  const { user } = useAuth(); const l = useLanding(); const base = useLandingBase();
  const home = user ? homeFor(user, l.features) : null;
  const fix = (href: string) => href.startsWith('/#') ? `${base}${href.slice(1)}` : href;
  return { home, start: home ?? (l.features.selfRegistration ? '/register' : '/login'), fix, base };
}

export function HeroSection() {
  const l = useLanding(); const h = l.content.hero; const c = useCtaTargets();
  const primaryHref = c.home && /^\/(register|login)\b/.test(h.primaryCta.href) ? c.home : !l.features.selfRegistration && h.primaryCta.href.startsWith('/register') ? '/login' : c.fix(h.primaryCta.href);
  return <section aria-labelledby="hero-title" className="relative overflow-hidden bg-gradient-to-b from-navy-50 to-white">
    <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 pb-14 pt-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pb-20 lg:pt-16">
      <div className="gl-rise">
        <p className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-brand-800 shadow-sm"><Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden />{l.t(h.eyebrow)}</p>
        <h1 id="hero-title" className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight text-navy-900 sm:text-5xl lg:text-[3.4rem]">{l.t(h.title)}</h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">{l.t(h.subtitle)}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <SmartLink href={primaryHref} className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand-700 px-7 text-base font-semibold text-white shadow-md shadow-brand-900/10 transition hover:-translate-y-0.5 hover:bg-brand-800">{c.home && primaryHref === c.home ? 'Continue Learning' : h.primaryCta.label}</SmartLink>
          <SmartLink href={c.fix(h.secondaryCta.href)} className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-300 bg-white px-7 text-base font-semibold text-navy-900 transition hover:border-navy-700 hover:bg-navy-50">{h.secondaryCta.label}</SmartLink>
        </div>
        {h.note && <p className="mt-5 flex items-center gap-2 text-sm text-slate-600"><CheckCircle2 className="h-4 w-4 text-brand-700" aria-hidden />{l.t(h.note)}</p>}
      </div>
      <ProductPreview subjects={h.previewSubjects} />
    </div>
  </section>;
}

/**
 * Original product-preview composition (React + SVG, no stock or generated imagery). It mirrors the real screens:
 * subject list, an illustrated lesson, the tutor and a quiz. Clearly labelled as an illustration.
 */
export function ProductPreview({ subjects }: { subjects: string[] }) {
  return <figure className="relative mx-auto w-full max-w-xl gl-rise [animation-delay:120ms] lg:max-w-none" aria-labelledby="preview-caption">
    <div className="relative rounded-[1.75rem] border border-slate-200 bg-white p-3 shadow-2xl shadow-navy-900/10 sm:p-4" aria-hidden>
      <div className="flex items-center gap-1.5 px-1 pb-3"><span className="h-2.5 w-2.5 rounded-full bg-slate-200" /><span className="h-2.5 w-2.5 rounded-full bg-slate-200" /><span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="ml-3 h-5 flex-1 rounded-full bg-slate-100" /></div>
      <div className="grid gap-3 sm:grid-cols-[0.95fr_1.25fr]">
        <div className="space-y-2.5 rounded-2xl bg-navy-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">My subjects</p>
          {subjects.slice(0, 4).map((s, i) => { const st = SUBJECT_STYLE[i % SUBJECT_STYLE.length]; const I = st.icon;
            return <div key={s} className="flex items-center gap-2.5 rounded-xl bg-white p-2.5 shadow-sm">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${st.tint}`}><I className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-navy-900">{s}</p>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100"><div className={`h-1.5 rounded-full ${st.bar}`} style={{ width: `${st.pct}%` }} /></div></div></div>; })}
          <div className="flex items-center gap-3 rounded-xl bg-white p-2.5 shadow-sm">
            <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90"><circle cx="18" cy="18" r="15" fill="none" stroke="#e2e8f0" strokeWidth="4" /><circle cx="18" cy="18" r="15" fill="none" stroke="var(--color-brand-600)" strokeWidth="4" strokeDasharray="94.2" strokeDashoffset="33" strokeLinecap="round" /></svg>
            <div><p className="text-xs font-semibold text-navy-900">Weekly goal</p><p className="text-[11px] text-slate-500">4 of 6 lessons</p></div>
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 p-3">
            <div className="flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">General Science · Lesson</p><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Reviewed</span></div>
            <p className="mt-1 text-sm font-bold text-navy-900">How plants make food</p>
            <LeafDiagram className="mt-2 h-28 w-full" />
          </div>
          <div className="gl-float rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500"><MessageCircle className="h-3.5 w-3.5 text-brand-700" />AI tutor</p>
            <p className="ml-auto mt-2 w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-navy-900 px-3 py-1.5 text-xs text-white">Why do leaves need sunlight?</p>
            <p className="mt-2 max-w-[90%] rounded-2xl rounded-bl-sm bg-brand-50 px-3 py-1.5 text-xs text-navy-900">Sunlight gives the energy for photosynthesis. Let’s look at the diagram together…</p>
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Quick quiz</p>
          <p className="mt-1 text-xs font-semibold text-navy-900">Which gas do plants take in?</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]"><span className="rounded-lg border border-slate-200 px-2 py-1">Oxygen</span><span className="rounded-lg border-2 border-emerald-500 bg-emerald-50 px-2 py-1 font-semibold text-emerald-800">Carbon dioxide ✓</span></div></div>
        <div className="rounded-2xl border border-slate-200 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Progress</p>
          <svg viewBox="0 0 160 48" className="mt-1 h-12 w-full"><polyline points="0,40 25,34 50,36 75,24 100,26 125,14 160,8" fill="none" stroke="var(--color-brand-600)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {[[0, 40], [25, 34], [50, 36], [75, 24], [100, 26], [125, 14], [160, 8]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.5" fill="#fff" stroke="var(--color-brand-600)" strokeWidth="2" />)}</svg></div>
      </div>
    </div>
    <figcaption id="preview-caption" className="mt-3 text-center text-xs text-slate-500">Illustration of the student workspace. Figures shown are examples, not real results.</figcaption>
  </figure>;
}

/** Simple labelled photosynthesis diagram (original SVG). */
export function LeafDiagram({ className = '', labelled = true }: { className?: string; labelled?: boolean }) {
  return <svg viewBox="0 0 260 120" className={className} role="img" aria-label={labelled ? 'Photosynthesis diagram: sunlight, water and carbon dioxide go into a leaf; glucose and oxygen come out' : 'Photosynthesis diagram'}>
    <circle cx="30" cy="26" r="14" fill="#fbbf24" />{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1={30 + 18 * Math.cos(a * Math.PI / 180)} y1={26 + 18 * Math.sin(a * Math.PI / 180)} x2={30 + 24 * Math.cos(a * Math.PI / 180)} y2={26 + 24 * Math.sin(a * Math.PI / 180)} stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />)}
    <path d="M52 40 Q90 52 108 62" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 4" fill="none" markerEnd="url(#ar)" />
    <defs><marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 10 5 0 10z" fill="#475569" /></marker></defs>
    <path d="M110 92 C112 50 160 26 214 30 C206 78 170 104 110 92Z" fill="#34d399" stroke="#059669" strokeWidth="2" />
    <path d="M110 92 C140 72 170 52 206 34" stroke="#047857" strokeWidth="1.6" fill="none" />
    <path d="M70 104 L104 92" stroke="#38bdf8" strokeWidth="2" markerEnd="url(#ar)" /><text x="20" y="112" fontSize="10" fill="#0369a1" fontWeight="600">water</text>
    <path d="M240 74 L214 68" stroke="#64748b" strokeWidth="2" markerEnd="url(#ar)" /><text x="214" y="90" fontSize="10" fill="#334155" fontWeight="600">CO₂</text>
    <path d="M190 22 L214 6" stroke="#10b981" strokeWidth="2" markerEnd="url(#ar)" /><text x="218" y="12" fontSize="10" fill="#047857" fontWeight="600">O₂</text>
    <text x="134" y="72" fontSize="10" fill="#064e3b" fontWeight="700">glucose</text><text x="62" y="20" fontSize="10" fill="#b45309" fontWeight="600">light</text>
  </svg>;
}
