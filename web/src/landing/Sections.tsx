import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, BookOpen, BookOpenCheck, Brain, CheckCircle2, ChevronDown, ClipboardCheck, Clock, Gamepad2, GitBranch, Image as ImageIcon, Layers, Lightbulb, ListChecks,
  MessageCircle, Network, PenLine, Puzzle, RefreshCcw, School, ShieldCheck, Smartphone, Sparkles, Target, Users, XCircle, type LucideIcon } from 'lucide-react';
import type { LandingContent } from '@ghlearn/shared/src/landing';
import { useAuth } from '../lib/auth';
import { useLanding, usePreviewLesson } from './api';
import { SectionHeading, SmartLink } from './PublicShell';
import { LeafDiagram, useCtaTargets } from './Hero';

const Btn = ({ to, children, variant = 'primary' }: { to: string; children: React.ReactNode; variant?: 'primary' | 'light' | 'outline' }) =>
  <SmartLink href={to} className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-base font-semibold transition hover:-translate-y-0.5 ${variant === 'primary' ? 'bg-brand-700 text-white hover:bg-brand-800' : variant === 'light' ? 'bg-white text-navy-900 hover:bg-amber-50' : 'border border-white/40 text-white hover:bg-white/10'}`}>{children}<ArrowRight className="h-4 w-4" aria-hidden /></SmartLink>;
const Demo = ({ children = 'Demo' }: { children?: React.ReactNode }) => <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">{children}</span>;

export function HowItWorks() {
  const l = useLanding(); const h = l.content.howItWorks;
  return <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 bg-navy-50/60 py-20">
    <div className="mx-auto max-w-7xl px-4 sm:px-6"><SectionHeading id="how-title" eyebrow="How it works" title={l.t(h.title)} center />
      <ol className="relative mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <span aria-hidden className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-brand-600/30 to-transparent lg:block" />
        {h.steps.map((s, i) => <li key={i} className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-900 text-xl font-bold text-white" aria-hidden>{i + 1}</span>
          <h3 className="mt-5 text-lg font-bold text-navy-900"><span className="sr-only">Step {i + 1}: </span>{l.t(s.title)}</h3>
          <p className="mt-2 text-slate-600">{l.t(s.body)}</p></li>)}
      </ol></div>
  </section>;
}

export function AITutorShowcase() {
  const l = useLanding(); const t = l.content.tutor; const { user } = useAuth(); const c = useCtaTargets();
  const to = user?.roles.includes('student') ? '/learn' : c.start;
  return <section id="ai-tutor" aria-labelledby="tutor-title" className="scroll-mt-20 py-20">
    <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
      <div><SectionHeading id="tutor-title" eyebrow="AI tutor" title={l.t(t.title)} subtitle={l.t(t.subtitle)} />
        <ul className="mt-6 space-y-3 text-slate-700">
          {['Answers come from the learner manuals indexed for your subject, with the sources shown.', 'When the manuals do not cover a question, the tutor says so and labels general explanations.', 'Only for the subjects you are enrolled in, within daily fair-use limits.'].map((x) =>
            <li key={x} className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />{x}</li>)}
        </ul>
        {!l.features.tutor && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">The AI tutor is switched off on this platform at the moment.</p>}
        <div className="mt-8"><Btn to={to}>{t.ctaLabel}</Btn></div></div>
      <figure className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-navy-900/5" aria-labelledby="tutor-demo-cap">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3"><p className="flex items-center gap-2 font-semibold text-navy-900"><MessageCircle className="h-5 w-5 text-brand-700" aria-hidden />General Science tutor</p><Demo>Simulated example</Demo></div>
        <div className="space-y-4 pt-4">
          <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-navy-900 px-4 py-2.5 text-white"><span className="sr-only">Student: </span>Can you explain photosynthesis in simple terms?</p>
          <div className="max-w-[92%] space-y-3 rounded-2xl rounded-bl-sm bg-brand-50 px-4 py-3 text-navy-900">
            <p><span className="sr-only">Tutor: </span>Photosynthesis is the process by which green plants use sunlight, water and carbon dioxide to make food. Let's break it down step by step.</p>
            <div className="rounded-xl bg-white p-2"><LeafDiagram className="h-28 w-full" labelled={false} /><p className="sr-only">Diagram: light, water and carbon dioxide go into a leaf; glucose is made and oxygen is released.</p></div>
            <ol className="list-decimal space-y-1 pl-5 text-sm"><li>Leaves absorb light using chlorophyll.</li><li>Roots bring water; leaves take in carbon dioxide from the air.</li><li>The plant makes glucose (food) and releases oxygen.</li></ol>
            <p className="rounded-lg bg-white px-3 py-2 text-sm"><strong>Try this:</strong> Why do plants kept in a dark cupboard become weak and pale?</p>
            <p className="text-xs text-slate-600">Source: illustrative example written for this page. Real tutor answers cite the pages of your subject’s learner manual.</p>
          </div>
        </div>
        <figcaption id="tutor-demo-cap" className="sr-only">Simulated tutor conversation, written for this page</figcaption>
      </figure>
    </div>
  </section>;
}

const LESSON_PARTS: [LucideIcon, string][] = [[ImageIcon, 'Illustrated explanations'], [ListChecks, 'Step-by-step examples'], [Network, 'Concept maps'], [Layers, 'Labelled diagrams'],
  [Lightbulb, 'Real-life scenarios'], [PenLine, 'Practical activities'], [BookOpenCheck, 'Summaries']];
export function IllustratedLessonPreview() {
  const l = useLanding(); const x = l.content.lessons; const first = x.featuredLessonIds[0];
  const real = usePreviewLesson(first ?? ''); const lesson = first ? real.data?.lesson : undefined;
  const objectives: string[] = lesson?.sections.find((s) => s.key === 'B')?.data?.objectives ?? ['Name the raw materials and products of photosynthesis', 'Describe the role of light and chlorophyll', 'Explain why photosynthesis matters for life on Earth'];
  const explanation = lesson ? (lesson.sections.find((s) => s.key === 'E')?.content ?? '').replace(/[#*_>`]/g, '').slice(0, 260) : 'Green plants trap light energy with chlorophyll in their leaves. They use it to join water and carbon dioxide into glucose, and release oxygen as a by-product.';
  const cta = lesson ? `/preview/${lesson.id}` : '/subjects';
  return <section id="lessons" aria-labelledby="lessons-title" className="scroll-mt-20 bg-navy-900 py-20 text-white">
    <div className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
      <div><SectionHeading id="lessons-title" eyebrow="Interactive lessons" title={l.t(x.title)} subtitle={l.t(x.body)} dark />
        <ul className="mt-8 grid grid-cols-2 gap-3">{LESSON_PARTS.map(([I, t]) => <li key={t} className="flex items-center gap-3 rounded-xl bg-white/5 p-3 text-sm"><I className="h-5 w-5 shrink-0 text-amber-300" aria-hidden />{t}</li>)}</ul>
        <div className="mt-8"><Btn to={cta} variant="light">{x.ctaLabel}</Btn></div></div>
      <article className="rounded-3xl bg-white p-6 text-navy-900 shadow-2xl" aria-label={lesson ? `Preview lesson: ${lesson.title}` : 'Sample lesson layout'}>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-wider text-brand-700">{lesson ? `${lesson.subject.name} · ${lesson.subject.level}` : 'General Science · SHS 1'}</p>
          {lesson ? <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Published preview</span> : <Demo>Sample layout, not a published lesson</Demo>}</div>
        <h3 className="mt-2 text-2xl font-bold">{lesson ? lesson.title : 'Photosynthesis: how plants make food'}</h3>
        <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_1fr]">
          <div><h4 className="text-sm font-bold">Learning objectives</h4><ul className="mt-2 space-y-1.5 text-sm text-slate-700">{objectives.slice(0, 3).map((o) => <li key={o} className="flex gap-2"><Target className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden />{o}</li>)}</ul></div>
          <div className="rounded-2xl bg-navy-50 p-2"><LeafDiagram className="h-32 w-full" labelled={false} /><p className="px-1 text-xs text-slate-600">Figure: inputs and outputs of photosynthesis.</p></div>
        </div>
        <h4 className="mt-5 text-sm font-bold">Key explanation</h4><p className="mt-1 text-sm leading-relaxed text-slate-700">{explanation}</p>
        <SampleQuiz compact questions={[QUIZ[0]]} />
      </article>
    </div>
  </section>;
}

export interface QuizQ { q: string; options: string[]; correct: number; why: string }
export const QUIZ: QuizQ[] = [
  { q: 'Which gas do green plants take in for photosynthesis?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'], correct: 1, why: 'Plants take in carbon dioxide through tiny pores (stomata) in their leaves and use it, with water and light energy, to make glucose. Oxygen is released, not taken in.' },
  { q: 'What is ¾ of 20?', options: ['12', '15', '16', '5'], correct: 1, why: 'Find one quarter first: 20 ÷ 4 = 5. Three quarters is 3 × 5 = 15.' },
  { q: 'Which action best protects a river near your community?', options: ['Washing cars on the riverbank', 'Planting trees along the banks', 'Dumping refuse after rain', 'Mining sand from the riverbed'], correct: 1, why: 'Tree roots hold soil together and reduce erosion, so less silt and waste wash into the river. The other actions pollute or damage it.' },
];
/** Working demo quiz (client-side, clearly labelled): select an answer, see why, try again or move on. */
export function SampleQuiz({ questions = QUIZ, compact = false }: { questions?: QuizQ[]; compact?: boolean }) {
  const [i, setI] = useState(0); const [pick, setPick] = useState<number | null>(null); const [score, setScore] = useState(0); const id = useId(); const q = questions[i]; const done = pick !== null;
  const choose = (n: number) => { if (done) return; setPick(n); if (n === q.correct) setScore((s) => s + 1); };
  const reset = () => { setI(0); setPick(null); setScore(0); };
  return <div className={`${compact ? 'mt-5 rounded-2xl border border-slate-200 p-4' : 'rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-navy-900/5'}`}>
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-navy-900">{compact ? 'Knowledge check' : `Sample quiz · Question ${i + 1} of ${questions.length}`}</h3><Demo>Demo question</Demo></div>
    <fieldset className="mt-3"><legend id={`${id}-q`} className="font-semibold text-navy-900">{q.q}</legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{q.options.map((o, n) => { const right = done && n === q.correct, wrong = done && n === pick && n !== q.correct;
        return <button key={o} type="button" onClick={() => choose(n)} aria-pressed={pick === n} disabled={done && n !== pick && n !== q.correct}
          className={`flex min-h-11 items-center justify-between gap-2 rounded-xl border-2 px-3 py-2 text-left text-sm transition ${right ? 'border-emerald-500 bg-emerald-50 text-emerald-900' : wrong ? 'border-red-400 bg-red-50 text-red-900' : 'border-slate-200 hover:border-brand-600 disabled:opacity-60'}`}>
          {o}{right && <CheckCircle2 className="h-4 w-4" aria-label="Correct answer" />}{wrong && <XCircle className="h-4 w-4" aria-label="Your answer, incorrect" />}</button>; })}</div></fieldset>
    <div aria-live="polite">{done && <div className={`mt-3 rounded-xl p-3 text-sm ${pick === q.correct ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-950'}`}>
      <p className="font-semibold">{pick === q.correct ? 'Correct!' : `Not quite. The answer is “${q.options[q.correct]}”.`}</p><p className="mt-1">Why: {q.why}</p></div>}</div>
    <div className="mt-3 flex flex-wrap gap-2">
      {done && i < questions.length - 1 && <button type="button" onClick={() => { setI(i + 1); setPick(null); }} className="min-h-11 rounded-full bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">Next question</button>}
      {done && i === questions.length - 1 && questions.length > 1 && <p className="self-center text-sm font-semibold text-navy-900" role="status">You scored {score} of {questions.length}.</p>}
      {(done || i > 0) && <button type="button" onClick={reset} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-300 px-4 text-sm font-semibold text-navy-900 hover:bg-slate-50"><RefreshCcw className="h-4 w-4" aria-hidden />Try again</button>}
    </div>
  </div>;
}

const PRACTICE: [LucideIcon, string, string][] = [[ClipboardCheck, 'Quick quizzes', 'Short sets that mark themselves.'], [Puzzle, 'Match the concept', 'Pair terms with their meanings.'], [Layers, 'Flashcards', 'Revise key words and facts.'],
  [ImageIcon, 'Diagram labelling', 'Name the parts of a figure.'], [Clock, 'Timed challenges', 'Build speed and confidence.'], [RefreshCcw, 'Topic revision', 'Return to topics you found hard.'], [Brain, 'Problem solving', 'Worked steps, then your turn.']];
export function PracticeAndGames() {
  const l = useLanding(); const p = l.content.practice; const { user } = useAuth(); const c = useCtaTargets();
  return <section id="practice" aria-labelledby="practice-title" className="scroll-mt-20 py-20">
    <div className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1fr]">
      <div><SectionHeading id="practice-title" eyebrow="Practice & games" title={l.t(p.title)} subtitle={l.t(p.subtitle)} />
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">{PRACTICE.map(([I, t, d]) => <li key={t} className="flex gap-3 rounded-2xl border border-slate-200 p-4 transition hover:border-brand-600/40 hover:shadow-md"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-800"><I className="h-5 w-5" aria-hidden /></span><span><span className="block font-semibold text-navy-900">{t}</span><span className="text-sm text-slate-600">{d}</span></span></li>)}</ul>
        <p className="mt-4 text-sm text-slate-600">Activity types depend on what has been reviewed and published for each subject.</p>
        <div className="mt-6"><Btn to={user?.roles.includes('student') ? '/learn' : c.start}>{p.ctaLabel}</Btn></div></div>
      <div id="sample-quiz"><SampleQuiz /><p className="mt-3 text-center text-xs text-slate-500">These demo questions were written for this page. In the app, questions come from reviewed content for your subjects.</p></div>
    </div>
  </section>;
}

export function PersonalizedLearningShowcase() {
  const l = useLanding(); const p = l.content.personalized; const c = useCtaTargets();
  return <section id="personalized" aria-labelledby="personal-title" className="scroll-mt-20 bg-gradient-to-b from-white to-navy-50 py-20">
    <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.1fr_1fr]">
      <figure className="order-2 rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-navy-900/5 lg:order-1" aria-label="Illustration of a personal learning space">
        <div className="flex items-center justify-between"><p className="font-bold text-navy-900">My learning space</p><Demo>Illustration</Demo></div>
        <div className="mt-4 flex flex-wrap gap-2">{['Mathematics', 'English Language', 'General Science', 'Biology', 'Chemistry'].map((s) => <span key={s} className="rounded-full bg-navy-50 px-3 py-1 text-xs font-semibold text-navy-800">{s}</span>)}</div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Recommended next</p>
            <ul className="mt-2 space-y-2 text-sm">{['Cell structure and function', 'Simultaneous equations', 'Writing a formal letter'].map((x) => <li key={x} className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-brand-700" aria-hidden />{x}</li>)}</ul></div>
          <div className="rounded-2xl border border-slate-200 p-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Revise soon</p>
            <ul className="mt-2 space-y-2 text-sm">{[['Chemical bonding', 48], ['Fractions', 62]].map(([x, v]) => <li key={x as string}><span className="flex justify-between"><span>{x}</span><span className="text-slate-500">{v}%</span></span><span className="mt-1 block h-1.5 rounded-full bg-slate-100"><span className="block h-1.5 rounded-full bg-amber-500" style={{ width: `${v}%` }} /></span></li>)}</ul></div>
        </div>
        <figcaption className="mt-3 text-xs text-slate-500">Example layout. Your space shows your own subjects, lessons and results.</figcaption>
      </figure>
      <div className="order-1 lg:order-2"><SectionHeading id="personal-title" eyebrow="For students" title={l.t(p.title)} subtitle={l.t(p.subtitle)} />
        <p className="mt-5 flex gap-3 rounded-2xl bg-white p-4 text-slate-700 shadow-sm"><ShieldCheck className="h-6 w-6 shrink-0 text-brand-700" aria-hidden />Your subject choices decide what you can open. The server checks every request against them, so lessons, practice and the tutor stay within your subjects.</p>
        <div className="mt-8"><Btn to={c.home ?? (l.features.selfRegistration ? '/register' : '/login')}>{c.home ? 'Continue Learning' : p.ctaLabel}</Btn></div></div>
    </div>
  </section>;
}

const TEACHER_FEATURES = ['Explore the reviewed curriculum resources for the subjects you teach', 'Read teacher preparation notes for published lessons', 'Assign practice and assessments to your classes',
  'Mark written answers and review results', 'See the most-missed questions to spot misconceptions', 'Set remedial practice on a weak topic in one step', 'Track class progress for the classes you are assigned'];
export function TeacherFeatures({ standalone = false }: { standalone?: boolean }) {
  const l = useLanding(); const x = l.content.teachers; const { user } = useAuth();
  return <section id="teachers" aria-labelledby="teachers-title" className="scroll-mt-20 py-20">
    <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
      <div><SectionHeading id="teachers-title" eyebrow="For teachers" title={l.t(x.title)} subtitle={l.t(x.body)} />
        <ul className="mt-6 space-y-2.5">{TEACHER_FEATURES.map((f) => <li key={f} className="flex gap-3 text-slate-700"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />{f}</li>)}</ul>
        {user?.roles.includes('teacher') ? <div className="mt-8"><Btn to="/teach">Open Teacher Workspace</Btn></div>
          : <div className="mt-8"><div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {!user && <Btn to="/register/teacher">{l.content.signup.teacherApplyLabel}</Btn>}
            {!standalone && <Link to="/teachers" className="inline-flex min-h-12 items-center justify-center rounded-full px-4 font-semibold text-brand-800 underline-offset-4 hover:underline">{x.ctaLabel}</Link>}</div>
            {!user && l.content.signup.teacherNote && <p className="mt-3 flex max-w-lg gap-2 text-sm text-slate-600"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden />{l.t(l.content.signup.teacherNote)}</p>}</div>}</div>
      <ClassroomVisual />
    </div>
  </section>;
}
function ClassroomVisual() {
  return <figure className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-navy-900/5" aria-label="Illustration of the teacher class view">
    <div className="flex items-center justify-between"><p className="font-bold text-navy-900">SHS 1 Science A · Biology</p><Demo>Illustration</Demo></div>
    <div className="mt-4 flex gap-2 overflow-hidden text-xs">{['Students', 'Needs support', 'Misconceptions', 'Topics', 'Assignments'].map((t, i) => <span key={t} className={`whitespace-nowrap rounded-full px-3 py-1 ${i === 2 ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{t}</span>)}</div>
    <ul className="mt-4 space-y-2">{[['Respiration releases energy only in animals', 64], ['Diffusion needs energy from the cell', 51], ['All cells have a cell wall', 43]].map(([q, v]) =>
      <li key={q as string} className="rounded-xl border border-slate-200 p-3 text-sm"><div className="flex justify-between gap-3"><span>{q}</span><span className="shrink-0 font-semibold text-red-700">{v}% wrong</span></div>
        <span className="mt-2 block h-1.5 rounded-full bg-slate-100"><span className="block h-1.5 rounded-full bg-red-400" style={{ width: `${v}%` }} /></span></li>)}</ul>
    <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-900"><GitBranch className="h-4 w-4" aria-hidden />Set remedial practice</p>
    <figcaption className="mt-3 text-xs text-slate-500">Example figures. Real reports hide groups smaller than the privacy threshold.</figcaption>
  </figure>;
}

const SCHOOL_FEATURES: [LucideIcon, string, string][] = [[BookOpen, 'Centralised curriculum resources', 'Reviewed lessons, questions and games built from approved learner manuals.'], [School, 'School and class management', 'Manage users, classes and enrolments, including list imports.'],
  [Users, 'Teacher access to approved materials', 'Teachers see published materials for the subjects they teach.'], [BarChart3, 'Student analytics', 'Completion, practice and topic reports for your school.'],
  [ClipboardCheck, 'Review before publishing', 'Every item is reviewed by a person; nobody approves their own work.'], [ShieldCheck, 'Controlled access', 'Publish to particular levels, programmes or institutions only.']];
export function SchoolFeatures({ standalone = false }: { standalone?: boolean }) {
  const l = useLanding(); const x = l.content.schools;
  return <section id="schools" aria-labelledby="schools-title" className="scroll-mt-20 bg-navy-50/60 py-20">
    <div className="mx-auto max-w-7xl px-4 sm:px-6"><SectionHeading id="schools-title" eyebrow="For schools" title={l.t(x.title)} subtitle={l.t(x.body)} />
      <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{SCHOOL_FEATURES.map(([I, t, d]) => <li key={t} className="rounded-2xl border border-slate-200 bg-white p-6"><I className="h-6 w-6 text-brand-700" aria-hidden /><h3 className="mt-3 font-bold text-navy-900">{t}</h3><p className="mt-1 text-sm text-slate-600">{d}</p></li>)}</ul>
      {!standalone && <div className="mt-8"><Btn to="/schools">{x.ctaLabel}</Btn></div>}</div>
  </section>;
}

const ICONS: Record<LandingContent['features']['items'][number]['icon'], LucideIcon> = { book: BookOpen, sparkles: Sparkles, message: MessageCircle, image: ImageIcon, puzzle: Puzzle, gamepad: Gamepad2, chart: BarChart3, smartphone: Smartphone, shield: ShieldCheck, users: Users, school: School, target: Target };
export function FeatureGrid() {
  const l = useLanding(); const f = l.content.features;
  return <section aria-labelledby="features-title" className="py-20"><div className="mx-auto max-w-7xl px-4 sm:px-6"><SectionHeading id="features-title" title={l.t(f.title)} center />
    <ul className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">{f.items.map((x) => { const I = ICONS[x.icon]; return <li key={x.title}>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-900 text-amber-300"><I className="h-6 w-6" aria-hidden /></span>
      <h3 className="mt-4 text-lg font-bold text-navy-900">{l.t(x.title)}</h3><p className="mt-1.5 text-slate-600">{l.t(x.body)}</p></li>; })}</ul></div></section>;
}
/** No genuine approved testimonials exist, so this shows learning principles instead (never invented quotes). */
export function TestimonialsOrLearningPrinciples() {
  const l = useLanding(); const p = l.content.principles;
  return <section aria-labelledby="principles-title" className="bg-navy-900 py-20"><div className="mx-auto max-w-7xl px-4 sm:px-6"><SectionHeading id="principles-title" title={l.t(p.title)} subtitle={l.t(p.subtitle)} dark center />
    <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{p.items.map((x, i) => <li key={x.title} className="rounded-2xl border border-white/10 bg-white/5 p-6"><p className="text-3xl font-extrabold text-amber-300" aria-hidden>0{i + 1}</p>
      <h3 className="mt-3 font-bold text-white">{l.t(x.title)}</h3><p className="mt-2 text-sm leading-relaxed text-slate-300">{l.t(x.body)}</p></li>)}</ul></div></section>;
}

export function FAQAccordion({ items }: { items?: { q: string; a: string }[] }) {
  const l = useLanding(); const faqs = items ?? l.content.faqs; const [open, setOpen] = useState<number | null>(0); const id = useId();
  return <section id="faq" aria-labelledby={`${id}-t`} className="scroll-mt-20 py-20"><div className="mx-auto max-w-3xl px-4 sm:px-6"><SectionHeading id={`${id}-t`} title="Frequently asked questions" center />
    <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200">{faqs.map((f, i) => { const isOpen = open === i;
      return <div key={f.q}><h3><button type="button" id={`${id}-b${i}`} aria-expanded={isOpen} aria-controls={`${id}-p${i}`} onClick={() => setOpen(isOpen ? null : i)}
        className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold text-navy-900 hover:bg-slate-50">{l.t(f.q)}<ChevronDown className={`h-5 w-5 shrink-0 transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`} aria-hidden /></button></h3>
        <div id={`${id}-p${i}`} role="region" aria-labelledby={`${id}-b${i}`} hidden={!isOpen} className="px-5 pb-5 leading-relaxed text-slate-600">{l.t(f.a)}</div></div>; })}</div>
    <p className="mt-6 text-center text-sm text-slate-600">Still have a question? <Link to="/help" className="font-semibold text-brand-800 underline">Visit the Help Centre</Link>.</p></div></section>;
}

export function FinalCTA() {
  const l = useLanding(); const f = l.content.finalCta; const c = useCtaTargets();
  return <section aria-labelledby="final-title" className="px-4 pb-20 sm:px-6"><div className="mx-auto max-w-7xl rounded-[2rem] bg-gradient-to-br from-navy-900 to-navy-700 px-6 py-14 text-center sm:px-12">
    <h2 id="final-title" className="mx-auto max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-4xl">{l.t(f.title)}</h2>
    {f.subtitle && <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-300">{l.t(f.subtitle)}</p>}
    <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><Btn to={c.start} variant="light">{c.home ? 'Continue Learning' : f.primaryLabel}</Btn>{c.home ? <Btn to={`${c.base}#subjects`} variant="outline">Explore Subjects</Btn> : <Btn to="/register/teacher" variant="outline">{f.secondaryLabel}</Btn>}</div>
  </div></section>;
}
