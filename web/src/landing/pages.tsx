import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { enquirySchema } from '@ghlearn/shared/src/landing';
import { ArrowLeft, BookOpen, CheckCircle2, Keyboard, LifeBuoy, Mail, MapPin, MessageSquare, Monitor, Phone, Eye, Contrast, Smartphone } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { LessonView } from '../components/LessonView';
import { sendEnquiry, telHref, useLanding, usePreviewLesson, usePublicSubject } from './api';
import { PublicLayout, SectionHeading } from './PublicShell';
import { LearningSearch, SubjectExplorer } from './Discovery';
import { FAQAccordion, SchoolFeatures, TeacherFeatures } from './Sections';
import { useCtaTargets } from './Hero';
import { subjectLook } from './icons';

const PageHead = ({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) =>
  <div className="bg-gradient-to-b from-navy-50 to-white"><div className="mx-auto max-w-7xl px-4 pb-8 pt-12 sm:px-6">
    {eyebrow && <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">{eyebrow}</p>}
    <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-navy-900 sm:text-5xl">{title}</h1>
    {children && <div className="mt-4 max-w-3xl text-lg leading-relaxed text-slate-600">{children}</div>}</div></div>;
const Panel = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={`rounded-2xl border border-slate-200 bg-white p-6 ${className}`}>{children}</div>;
const NotFound = ({ what }: { what: string }) => <div className="mx-auto max-w-3xl px-4 py-20 text-center"><h1 className="text-3xl font-bold text-navy-900">{what} not found</h1>
  <p className="mt-3 text-slate-600">It may not exist, or it is not available publicly.</p><Link to="/subjects" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand-700 px-6 font-semibold text-white">Browse subjects</Link></div>;

export function SubjectsPage() {
  return <PublicLayout title="Explore subjects" description="Browse the subjects of the Ghanaian SHS and JHS curricula and search topics and public preview lessons.">
    <PageHead eyebrow="Explore" title="Explore subjects">Search and browse the subjects on the platform. Signing up gives you lessons, practice and the AI tutor for the subjects you choose.</PageHead>
    <div className="pt-6"><LearningSearch /></div><SubjectExplorer full />
  </PublicLayout>;
}

export function PublicSubjectPage() {
  const { id = '' } = useParams(); const q = usePublicSubject(id); const { user } = useAuth(); const c = useCtaTargets();
  if (q.isLoading) return <PublicLayout title="Subject"><div className="mx-auto max-w-7xl px-4 py-20" role="status">Loading subject…</div></PublicLayout>;
  if (q.isError || !q.data) return <PublicLayout title="Subject not found"><NotFound what="Subject" /></PublicLayout>;
  const { subject: s, topics, previews } = q.data; const L = subjectLook(s.name); const I = L.icon;
  return <PublicLayout title={s.name} description={`${s.name} (${s.level.name}): curriculum topics and public preview lessons.`}>
    <PageHead eyebrow={`${s.level.name} · ${s.category === 'core' ? 'Core' : 'Elective'}`} title={s.name}>
      <span className="flex flex-wrap gap-4 text-base">{s.publishedLessons > 0 && <span>{s.publishedLessons} published lesson{s.publishedLessons === 1 ? '' : 's'}</span>}{s.documents ? <span>{s.documents} curriculum documents indexed</span> : null}</span>
    </PageHead>
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 pb-20 sm:px-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-8">
        <section aria-labelledby="prev-t"><h2 id="prev-t" className="text-2xl font-bold text-navy-900">Public preview lessons</h2>
          {previews.length ? <ul className="mt-4 grid gap-3 sm:grid-cols-2">{previews.map((p) => <li key={p.id}><Link to={`/preview/${p.id}`} className="flex min-h-16 items-center gap-3 rounded-2xl border border-slate-200 p-4 hover:border-brand-600/50 hover:shadow-md"><BookOpen className="h-5 w-5 text-brand-700" aria-hidden /><span><span className="block font-semibold text-navy-900">{p.title}</span>{p.topic && <span className="text-sm text-slate-500">{p.topic}</span>}</span></Link></li>)}</ul>
            : <p className="mt-3 rounded-2xl bg-navy-50 p-4 text-slate-700">No lessons in this subject are open to the public yet. Students enrolled in {s.name} see every published lesson in their learning space.</p>}</section>
        <section id="topics" aria-labelledby="top-t" className="scroll-mt-20"><h2 id="top-t" className="text-2xl font-bold text-navy-900">Curriculum topics</h2>
          {topics.length ? <ul className="mt-4 flex flex-wrap gap-2">{topics.map((t) => <li key={t.title} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-navy-900">{t.title}</li>)}</ul>
            : <p className="mt-3 rounded-2xl bg-navy-50 p-4 text-slate-700">The topic list for this subject has not been verified yet, so it is not shown publicly.</p>}</section>
      </div>
      <aside className="space-y-4"><Panel><span className={`flex h-12 w-12 items-center justify-center rounded-xl ${L.tint}`}><I className="h-6 w-6" aria-hidden /></span>
        <h2 className="mt-4 text-lg font-bold text-navy-900">{user?.roles.includes('student') ? `Study ${s.name}` : `Learn ${s.name} your way`}</h2>
        <p className="mt-2 text-sm text-slate-600">{user?.roles.includes('student') ? 'Open the subject in your learning space. If it is not one of your subjects, add it from your profile.' : 'Create a free student account, choose this subject and get structured notes, practice and the AI tutor.'}</p>
        <Link to={user?.roles.includes('student') ? `/learn/${s.id}` : c.start} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-brand-700 px-5 font-semibold text-white hover:bg-brand-800">{user?.roles.includes('student') ? 'Open in My subjects' : c.home ? 'Continue Learning' : 'Start Learning Free'}</Link>
        <Link to="/subjects" className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-full border border-slate-300 px-5 font-semibold text-navy-900 hover:bg-navy-50"><ArrowLeft className="h-4 w-4" aria-hidden />All subjects</Link></Panel></aside>
    </div>
  </PublicLayout>;
}

export function PreviewLessonPage() {
  const { id = '' } = useParams(); const q = usePreviewLesson(id); const c = useCtaTargets();
  if (q.isLoading) return <PublicLayout title="Lesson preview"><div className="mx-auto max-w-7xl px-4 py-20" role="status">Loading lesson…</div></PublicLayout>;
  if (q.isError || !q.data) return <PublicLayout title="Lesson not found"><NotFound what="Lesson" /></PublicLayout>;
  const l = q.data.lesson;
  return <PublicLayout title={l.title} description={`Public preview: ${l.title} (${l.subject.name}).`}>
    <PageHead eyebrow={`${l.subject.name} · ${l.subject.level}${l.yearOfStudy ? ` · Year ${l.yearOfStudy}` : ''}`} title={l.title}>
      <p className="text-base">Public preview of a reviewed, published lesson. Assessment answers and teacher notes are only shown inside the app.</p></PageHead>
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 pb-20 sm:px-6 lg:grid-cols-[2fr_1fr]">
      <article className="min-w-0"><LessonView sections={l.sections} /></article>
      <aside className="space-y-4"><Panel><h2 className="font-bold text-navy-900">Continue with practice and the tutor</h2><p className="mt-2 text-sm text-slate-600">Students enrolled in {l.subject.name} get the full lesson, practice questions and the AI tutor.</p>
        <Link to={c.start} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-brand-700 px-5 font-semibold text-white">{c.home ? 'Continue Learning' : 'Start Learning Free'}</Link>
        <Link to={`/subjects/${l.subject.id}`} className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 px-5 font-semibold text-navy-900">About {l.subject.name}</Link></Panel>
        {l.sources.length > 0 && <Panel><h2 className="font-bold text-navy-900">Sources</h2><ul className="mt-2 space-y-1 text-sm text-slate-600">{l.sources.map((s) => <li key={s.title}>{s.title}{s.approvalStatus === 'verified_official' ? ' (verified official material)' : ''}</li>)}</ul></Panel>}</aside>
    </div>
  </PublicLayout>;
}

export function TeachersPage() {
  const l = useLanding();
  return <PublicLayout title="For teachers" description={l.t(l.content.teachers.body)}>
    <PageHead eyebrow="For teachers" title={l.t(l.content.teachers.title)}>{l.t(l.content.teachers.body)}</PageHead>
    <TeacherFeatures standalone />
    <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6"><Panel className="grid gap-6 md:grid-cols-3">
      <div><h2 className="font-bold text-navy-900">How teachers get access</h2><p className="mt-2 text-sm text-slate-600">Teacher accounts are created by a school administrator and linked to your school and subjects. There is no self-registration for teachers.</p></div>
      <div><h2 className="font-bold text-navy-900">Already have an account?</h2><p className="mt-2 text-sm text-slate-600">Sign in and open the Teaching area to see your classes.</p><Link to="/login" className="mt-3 inline-flex min-h-11 items-center rounded-full border border-slate-300 px-5 font-semibold text-navy-900">Log In</Link></div>
      <div><h2 className="font-bold text-navy-900">Your school is not on the platform yet?</h2><p className="mt-2 text-sm text-slate-600">Ask your head teacher to get in touch, or send us an enquiry.</p><Link to="/schools#enquiry" className="mt-3 inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 font-semibold text-white">Enquire for your school</Link></div>
    </Panel></section>
  </PublicLayout>;
}

type FormState = Record<string, string>;
export function EnquiryForm({ kind }: { kind: 'school' | 'contact' }) {
  const l = useLanding(); const o = l.content.organisation;
  const [f, setF] = useState<FormState>({ name: '', email: '', phone: '', organisation: '', role: '', region: '', learners: '', topic: kind === 'contact' ? 'General question' : '', message: '', website: '' });
  const [consent, setConsent] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [done, setDone] = useState<string | null>(null); const [fail, setFail] = useState<string | null>(null);
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setFail(null);
    const body = { kind, name: f.name, email: f.email, phone: f.phone, organisation: f.organisation, role: f.role, region: f.region, topic: f.topic, message: f.message, consent: consent as true, ...(f.learners ? { learners: Number(f.learners) } : {}), ...(f.website ? { website: f.website } : {}) };
    const r = enquirySchema.safeParse(body);
    if (!r.success) { const m: Record<string, string> = {}; for (const i of r.error.issues) m[String(i.path[0] ?? 'form')] ??= i.message; setErrors(m); document.getElementById(`enq-${Object.keys(m)[0]}`)?.focus(); return; }
    setErrors({}); setBusy(true);
    try { const res = await sendEnquiry(r.data); setDone(res.reference); } catch (x: any) { setFail(x?.message ?? 'Your message could not be sent.'); } finally { setBusy(false); }
  };
  if (done) return <div role="status" className="rounded-2xl bg-emerald-50 p-6 text-emerald-900"><CheckCircle2 className="h-8 w-8" aria-hidden /><h3 className="mt-2 text-lg font-bold">Thank you, your message has been received.</h3>
    <p className="mt-1">Reference <strong>{done}</strong>. We reply by email{o.email ? <> from <a className="underline" href={`mailto:${o.email}`}>{o.email}</a></> : ''}.</p></div>;
  const field = (k: string, label: string, p: { type?: string; required?: boolean; autoComplete?: string; textarea?: boolean; inputMode?: 'numeric' } = {}) => <div className={p.textarea ? 'sm:col-span-2' : ''}>
    <label htmlFor={`enq-${k}`} className="block text-sm font-medium text-navy-900">{label}{p.required ? <span aria-hidden className="text-red-700"> *</span> : <span className="text-slate-500"> (optional)</span>}</label>
    {p.textarea ? <textarea id={`enq-${k}`} rows={5} value={f[k]} onChange={set(k)} required={p.required} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `enq-${k}-e` : undefined} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 focus:border-brand-600 focus:outline-none" />
      : <input id={`enq-${k}`} type={p.type ?? 'text'} inputMode={p.inputMode} autoComplete={p.autoComplete} value={f[k]} onChange={set(k)} required={p.required} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `enq-${k}-e` : undefined} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 focus:border-brand-600 focus:outline-none" />}
    {errors[k] && <p id={`enq-${k}-e`} className="mt-1 text-sm text-red-700">{errors[k]}</p>}</div>;
  return <form noValidate onSubmit={submit} aria-label={kind === 'school' ? 'School enquiry form' : 'Contact form'} className="grid gap-4 sm:grid-cols-2">
    {field('name', 'Your name', { required: true, autoComplete: 'name' })}{field('email', 'Email', { type: 'email', required: true, autoComplete: 'email' })}
    {kind === 'school' ? <>{field('organisation', 'School or organisation', { required: true, autoComplete: 'organization' })}{field('role', 'Your role')}{field('region', 'Region')}{field('learners', 'Number of learners', { type: 'number', inputMode: 'numeric' })}{field('phone', 'Phone', { type: 'tel', autoComplete: 'tel' })}</>
      : <><div><label htmlFor="enq-topic" className="block text-sm font-medium text-navy-900">Topic</label><select id="enq-topic" value={f.topic} onChange={set('topic')} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3">
        {['General question', 'Account or sign-in', 'Lessons and content', 'Accessibility', 'Privacy and data', 'Report a problem'].map((t) => <option key={t}>{t}</option>)}</select></div>{field('phone', 'Phone', { type: 'tel', autoComplete: 'tel' })}</>}
    {field('message', kind === 'school' ? 'What would you like to know?' : 'Message', { required: true, textarea: true })}
    <div className="hidden" aria-hidden><label htmlFor="enq-website">Leave this empty</label><input id="enq-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></div>
    <div className="sm:col-span-2"><label className="flex items-start gap-3 text-sm text-slate-700"><input id="enq-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5" aria-invalid={!!errors.consent} aria-describedby={errors.consent ? 'enq-consent-e' : undefined} />
      <span>I agree that {l.branding.appName} stores this message and my contact details to reply to me.</span></label>{errors.consent && <p id="enq-consent-e" className="mt-1 text-sm text-red-700">{errors.consent}</p>}</div>
    {fail && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{fail}{o.email ? <> You can also email <a className="underline" href={`mailto:${o.email}`}>{o.email}</a>.</> : ''}</p>}
    <div className="sm:col-span-2"><button type="submit" disabled={busy} aria-busy={busy} className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand-700 px-7 font-semibold text-white hover:bg-brand-800 disabled:opacity-60">{busy ? 'Sending…' : kind === 'school' ? 'Send enquiry' : 'Send message'}</button></div>
  </form>;
}
function ContactCard() {
  const o = useLanding().content.organisation;
  return <Panel><h2 className="text-lg font-bold text-navy-900">Contact details</h2>
    <dl className="mt-3 space-y-3 text-sm text-slate-700">
      {o.name && <div><dt className="sr-only">Organisation</dt><dd className="font-semibold text-navy-900">{o.poweredByLabel ? `${o.poweredByLabel} ` : ''}{o.name}</dd></div>}
      {o.address && <div className="flex gap-2"><MapPin className="h-4 w-4 shrink-0 text-brand-700" aria-hidden /><dt className="sr-only">Address</dt><dd>{o.address}</dd></div>}
      {o.email && <div className="flex gap-2"><Mail className="h-4 w-4 shrink-0 text-brand-700" aria-hidden /><dt className="sr-only">Email</dt><dd><a className="text-brand-800 underline" href={`mailto:${o.email}`}>{o.email}</a></dd></div>}
      {o.phone && <div className="flex gap-2"><Phone className="h-4 w-4 shrink-0 text-brand-700" aria-hidden /><dt className="sr-only">Phone</dt><dd><a className="text-brand-800 underline" href={telHref(o.phone)}>{o.phone}</a></dd></div>}
      {o.hashtag && <div><dt className="sr-only">Hashtag</dt><dd className="font-semibold text-brand-800">{o.hashtag}</dd></div>}
    </dl></Panel>;
}
export function SchoolsPage() {
  const l = useLanding(); const o = l.content.organisation;
  return <PublicLayout title="For schools" description={l.t(l.content.schools.body)}>
    <PageHead eyebrow="For schools" title={l.t(l.content.schools.title)}>{l.t(l.content.schools.body)}</PageHead>
    <SchoolFeatures standalone />
    <section id="enquiry" aria-labelledby="enq-t" className="mx-auto grid max-w-7xl grid-cols-1 scroll-mt-20 gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1.6fr_1fr]">
      <Panel><SectionHeading id="enq-t" title="Talk to us about your school" subtitle="School onboarding is handled by our team. Tell us about your school and we will get back to you." />
        <div className="mt-6"><EnquiryForm kind="school" /></div></Panel>
      <div className="space-y-4"><ContactCard /><Panel><h2 className="font-bold text-navy-900">What happens next</h2><ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600"><li>We read every enquiry{o.email ? ` sent here or to ${o.email}` : ''}.</li><li>We arrange a call or visit to understand your needs.</li><li>We set up your school, administrators and teachers.</li></ol></Panel></div>
    </section>
  </PublicLayout>;
}

const HELP_TOPICS: { icon: typeof LifeBuoy; title: string; body: ReactNode }[] = [
  { icon: BookOpen, title: 'Getting started', body: <>Create an account on the <Link className="underline" to="/register">sign-up page</Link>, then choose your level, class, learning area and subjects.</> },
  { icon: LifeBuoy, title: 'Signing in', body: <>Use the email and password you registered with on the <Link className="underline" to="/login">Log In page</Link>. If your school created your account, use the temporary password they gave you; you will be asked to choose a new one.</> },
  { icon: MessageSquare, title: 'Using the AI tutor', body: <>Open one of your subjects and choose “Ask the tutor”. Answers are based on that subject’s learner manuals and show the sources used.</> },
  { icon: Smartphone, title: 'Phones and offline use', body: <>The site works in the browser on any device. When allowed, you can save lessons on your device to read offline.</> },
];
export function HelpPage({ contact = false }: { contact?: boolean }) {
  return <PublicLayout title={contact ? 'Contact' : 'Help Centre'} description="Help with accounts, lessons, the AI tutor and contacting the team.">
    <PageHead eyebrow="Support" title={contact ? 'Contact us' : 'Help Centre'}>Find answers to common questions, or send us a message.</PageHead>
    {!contact && <section aria-label="Help topics" className="mx-auto max-w-7xl px-4 sm:px-6"><ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{HELP_TOPICS.map((t) => <li key={t.title}><Panel className="h-full"><t.icon className="h-6 w-6 text-brand-700" aria-hidden /><h2 className="mt-3 font-bold text-navy-900">{t.title}</h2><p className="mt-1 text-sm text-slate-600">{t.body}</p></Panel></li>)}</ul></section>}
    {!contact && <FAQAccordion />}
    <section id="contact" aria-labelledby="contact-t" className="mx-auto grid max-w-7xl grid-cols-1 scroll-mt-20 gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1.6fr_1fr]">
      <Panel><SectionHeading id="contact-t" title="Send us a message" subtitle="We reply by email. For school onboarding, use the For Schools page." /><div className="mt-6"><EnquiryForm kind="contact" /></div></Panel>
      <ContactCard />
    </section>
  </PublicLayout>;
}

export function AccessibilityPage() {
  const l = useLanding();
  const items: [typeof Keyboard, string, string][] = [[Keyboard, 'Keyboard', 'Every page can be used with a keyboard. A “Skip to content” link is the first item, and focus is always visible.'],
    [Eye, 'Screen readers', 'Pages use headings, landmarks and labels. Illustrations have text alternatives; decorative images are hidden from assistive technology.'],
    [Contrast, 'Contrast and text', 'Text colours are chosen to meet WCAG 2.1 AA contrast. You can zoom to 200% without losing content.'],
    [Monitor, 'Motion', 'Animations are subtle and switch off when your device asks for reduced motion.'],
    [Smartphone, 'Any screen size', 'Layouts adapt to phones, tablets and computers, with touch targets of at least 44 pixels.']];
  return <PublicLayout title="Accessibility" description={`Accessibility statement for ${l.branding.appName}.`}>
    <PageHead eyebrow="Accessibility" title="Accessibility statement">We want {l.branding.appName} to be usable by every learner. We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.1 at level AA.</PageHead>
    <div className="mx-auto max-w-4xl space-y-8 px-4 pb-20 sm:px-6">
      <ul className="grid gap-4 sm:grid-cols-2">{items.map(([I, t, d]) => <li key={t}><Panel className="h-full"><I className="h-6 w-6 text-brand-700" aria-hidden /><h2 className="mt-3 font-bold text-navy-900">{t}</h2><p className="mt-1 text-sm text-slate-600">{d}</p></Panel></li>)}</ul>
      <Panel><h2 className="text-lg font-bold text-navy-900">How we check</h2><p className="mt-2 text-slate-600">Our automated tests run the axe accessibility checker on the main pages and interactions, and we test on phone, tablet and desktop screen sizes. Automated checks do not find every problem, so we welcome reports.</p></Panel>
      <Panel><h2 className="text-lg font-bold text-navy-900">Known limitations</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600"><li>Learning content is currently in English only.</li><li>Some generated diagrams have shorter text descriptions than we would like; reviewers improve them over time.</li><li>Uploaded source manuals (PDFs) are not always accessible documents.</li></ul></Panel>
      <Panel><h2 className="text-lg font-bold text-navy-900">Report a problem</h2><p className="mt-2 text-slate-600">If something is hard to use, tell us through the <Link to="/contact" className="font-semibold text-brand-800 underline">contact form</Link> (choose “Accessibility”){l.content.organisation.email ? <> or email <a className="font-semibold text-brand-800 underline" href={`mailto:${l.content.organisation.email}`}>{l.content.organisation.email}</a></> : ''}.</p></Panel>
    </div>
  </PublicLayout>;
}
export const ContactPage = () => <HelpPage contact />;
