import { z } from 'zod';
/**
 * Public landing-page content (docs/LANDING_SPEC.md §10). One validated document, edited in Admin → Public Website.
 * Text is plain text (rendered as text, never HTML). `{appName}` in any string is replaced with the configured
 * product name. Links must be internal paths ("/schools", "/#how-it-works") or https URLs.
 */
const t = (max: number, min = 1) => z.string().trim().min(min).max(max);
const opt = (max: number) => z.string().trim().max(max);
export const landingHref = z.string().trim().max(300).refine((v) => /^\/(?!\/)[A-Za-z0-9/_\-#?=&.%]*$/.test(v) || /^https:\/\/[^\s<>"']+$/.test(v), 'Use an internal path such as /schools or an https:// link');
const cta = z.object({ label: t(40), href: landingHref }).strict();
const item = z.object({ title: t(80), body: t(400) }).strict();
export const LANDING_ICONS = ['book', 'sparkles', 'message', 'image', 'puzzle', 'gamepad', 'chart', 'smartphone', 'shield', 'users', 'school', 'target'] as const;
export const LEVEL_FILTERS = ['JHS', 'SHS'] as const;
export const landingSchema = z.object({
  announcement: z.object({ enabled: z.boolean(), text: opt(160), linkLabel: opt(40), linkHref: z.union([landingHref, z.literal('')]) }).strict()
    .refine((a) => !a.enabled || a.text.length > 0, { message: 'An enabled announcement needs text', path: ['text'] })
    .refine((a) => !a.linkLabel === !a.linkHref, { message: 'Give both a link label and a link, or neither', path: ['linkHref'] }),
  hero: z.object({ eyebrow: t(60), title: t(120), subtitle: t(400), primaryCta: cta, secondaryCta: cta, note: opt(160), previewSubjects: z.array(t(40)).min(2).max(6) }).strict(),
  search: z.object({ title: t(80), subtitle: opt(200), placeholder: t(80), popular: z.array(t(40)).max(12) }).strict(),
  subjects: z.object({ title: t(80), subtitle: opt(200), featuredCodes: z.array(t(20)).max(24),
    filters: z.array(z.object({ id: z.string().trim().regex(/^[a-z0-9-]{2,30}$/, 'Lower-case letters, digits and dashes'), label: t(40),
      level: z.enum(LEVEL_FILTERS).optional(), keywords: z.array(t(40)).max(30) }).strict()
      .refine((f) => !!f.level || f.keywords.length > 0, { message: 'A filter needs a level or at least one keyword' })).max(12) }).strict()
    .refine((s) => new Set(s.filters.map((f) => f.id)).size === s.filters.length, { message: 'Filter ids must be unique', path: ['filters'] }),
  howItWorks: z.object({ title: t(80), steps: z.array(item).min(2).max(6) }).strict(),
  tutor: z.object({ title: t(80), subtitle: opt(300), ctaLabel: t(40) }).strict(),
  lessons: z.object({ title: t(80), body: opt(400), ctaLabel: t(40), featuredLessonIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i, 'Lesson ids are 24-character ids')).max(6) }).strict(),
  practice: z.object({ title: t(80), subtitle: opt(300), ctaLabel: t(40) }).strict(),
  personalized: z.object({ title: t(80), subtitle: opt(300), ctaLabel: t(40) }).strict(),
  /** Student ↔ teacher/counselor meetings (an existing feature). Describe it honestly: bookings within the student's own school, external meeting links only. */
  liveSessions: z.object({ title: t(80), subtitle: opt(300), points: z.array(item).min(2).max(4), note: opt(300), ctaLabel: t(40), signedInCtaLabel: t(40) }).strict(),
  teachers: z.object({ title: t(80), body: opt(400), ctaLabel: t(40) }).strict(),
  schools: z.object({ title: t(80), body: opt(400), ctaLabel: t(40) }).strict(),
  features: z.object({ title: t(80), items: z.array(item.extend({ icon: z.enum(LANDING_ICONS) }).strict()).min(2).max(12) }).strict(),
  principles: z.object({ title: t(80), subtitle: opt(300), items: z.array(item).min(2).max(8) }).strict(),
  faqs: z.array(z.object({ q: t(160), a: t(1200) }).strict()).min(1).max(30),
  /** Final band: primary = student sign-up, secondary = teacher application (/register/teacher). */
  finalCta: z.object({ title: t(120), subtitle: opt(300), primaryLabel: t(40), secondaryLabel: t(40) }).strict(),
  /** Sign-up buttons in the header, the For Teachers section, the footer and the sign-in page. */
  signup: z.object({ headerLabel: t(24), studentLabel: t(40), studentHint: opt(80), teacherLabel: t(40), teacherHint: opt(80),
    teacherApplyLabel: t(40), teacherNote: opt(200), loginStudentLabel: t(40), loginTeacherLabel: t(40) }).strict(),
  footer: z.object({ description: opt(300), dataProtection: opt(400), languageNote: opt(160) }).strict(),
  /** Organisation (optional label before the name, e.g. "Powered by"): shown in the footer, on the Contact page and as the default enquiry address. */
  organisation: z.object({ poweredByLabel: opt(40), name: t(80), address: opt(200), email: z.union([z.email().max(200), z.literal('')]),
    phone: z.string().trim().max(30).regex(/^[+0-9 ()-]*$/, 'Digits, spaces, +, ( ) and - only'), hashtag: opt(40) }).strict(),
}).strict();
export type LandingContent = z.infer<typeof landingSchema>;

export const LANDING_DEFAULTS: LandingContent = {
  announcement: { enabled: true, text: 'Your curriculum. Your learning journey. Powered by AI.', linkLabel: 'Start learning', linkHref: '/register' },
  hero: {
    eyebrow: 'THE FUTURE OF LEARNING IS PERSONAL',
    title: 'Your Curriculum. Your AI Tutor. Your Path to Success.',
    subtitle: 'Turn your school subjects into an engaging learning experience with clear notes, interactive illustrations, personalized AI tutoring, practice questions and educational games—all aligned with your curriculum.',
    primaryCta: { label: 'Sign up free', href: '/register' }, secondaryCta: { label: 'I\u2019m a teacher \u2014 apply', href: '/register/teacher' },
    note: 'Built around approved curriculum materials. Designed for active learning.',
    previewSubjects: ['Mathematics', 'General Science', 'English Language', 'Social Studies'],
  },
  search: { title: 'What do you want to learn today?', subtitle: 'Discover subjects, topics, lessons and practice activities.', placeholder: 'Search a subject, topic or concept...',
    popular: ['Algebra', 'Photosynthesis', 'Chemical bonding', 'Essay writing', 'Fractions', 'Environmental protection'] },
  subjects: {
    title: 'Explore your subjects', subtitle: 'Find the topics you study in school and explore a better way to understand them.',
    featuredCodes: ['MATH', 'S-GENSCI', 'ENG', 'SOC', 'BIO', 'CHEM', 'PHY', 'ECON', 'AMATH', 'S-COM', 'S-GEO', 'S-HIS'],
    filters: [
      { id: 'jhs', label: 'JHS', level: 'JHS', keywords: [] },
      { id: 'shs', label: 'SHS', level: 'SHS', keywords: [] },
      { id: 'languages', label: 'Languages', keywords: ['English', 'French', 'Arabic', 'Spanish', 'Ghanaian Language', 'Literature'] },
      { id: 'math-science', label: 'Mathematics and Sciences', keywords: ['Mathematics', 'Science', 'Biology', 'Chemistry', 'Physics', 'Agricultur'] },
      { id: 'humanities', label: 'Humanities', keywords: ['Social Studies', 'History', 'Geography', 'Government', 'Religious', 'Economics', 'Music', 'Arts'] },
      { id: 'business', label: 'Business', keywords: ['Business', 'Accounting', 'Economics'] },
      { id: 'computing', label: 'Computing and Technology', keywords: ['Computing', 'ICT', 'Information And Communication', 'Technology', 'Robotics', 'Engineering'] },
    ],
  },
  howItWorks: { title: 'A smarter way to learn, step by step', steps: [
    { title: 'Choose your subjects', body: 'Tell us your school level, programme and the subjects you study.' },
    { title: 'Explore your learning materials', body: 'Access structured notes and illustrations generated from approved curriculum resources.' },
    { title: 'Ask your AI tutor', body: 'Get explanations, examples and guided help when a concept is difficult.' },
    { title: 'Practise and improve', body: 'Strengthen your understanding through quizzes, interactive games and personalized revision.' },
  ] },
  tutor: { title: 'Meet your personal AI learning companion', subtitle: 'Ask questions in your own words. Explore difficult concepts. Get explanations grounded in your learning materials.', ctaLabel: 'Explore AI-Powered Learning' },
  lessons: { title: 'Go beyond reading. See how ideas work.', body: 'Learner manuals become structured lessons: clear objectives, step-by-step explanations, labelled diagrams, real-life Ghanaian scenarios, activities and a short check at the end. Each one is reviewed by a person before students see it.', ctaLabel: 'Explore Interactive Lessons', featuredLessonIds: [] },
  practice: { title: 'Make every minute of practice count', subtitle: 'Test your understanding, learn from mistakes and build confidence with interactive activities designed around what you study.', ctaLabel: 'Start Practising' },
  liveSessions: {
    title: 'Learn live with your teachers',
    subtitle: 'Book a one-to-one session with a teacher or counselor at your school. Pick a time they have opened, or suggest your own, and tell them what you want to work on.',
    points: [
      { title: 'Book a time that suits you', body: 'Choose one of your teacher\u2019s or counselor\u2019s published slots, or propose a time. They can accept it, decline it or suggest another.' },
      { title: 'In person or online', body: 'Meet at school, or online through the meeting link your teacher adds to the booking. The link opens in the video service they use.' },
      { title: 'Come with a clear topic', body: 'Add the topic you need help with, from a tricky concept to exam revision, so the session starts in the right place.' },
      { title: 'Both of you stay informed', body: 'You and your teacher are notified when a session is requested, confirmed, declined or moved.' },
    ],
    note: 'Sessions are with teachers and counselors at your own school, once your school and its staff use {appName}.',
    ctaLabel: 'Sign up to book a session', signedInCtaLabel: 'Book a live session',
  },
  personalized: { title: 'Your subjects. Your goals. Your learning space.', subtitle: 'Every student follows a different learning journey. Choose your subjects and access the materials relevant to your studies.', ctaLabel: 'Create My Learning Space' },
  teachers: { title: 'Give every lesson a stronger foundation', body: 'Teachers get the same reviewed, curriculum-aligned materials their students use, plus tools to set work and see where a class needs help.', ctaLabel: 'Explore Teacher Tools' },
  schools: { title: 'Bring smarter learning to your school', body: 'One place for approved curriculum resources, classes and enrolments, teacher access and learning analytics, with your school in control of who sees what.', ctaLabel: 'Discover Learning for Schools' },
  features: { title: 'Why students and teachers choose {appName}', items: [
    { icon: 'book', title: 'Grounded in the curriculum', body: 'Lessons are drafted from approved learner manuals and cite the pages they come from.' },
    { icon: 'target', title: 'Only your subjects', body: 'Your space shows the subjects you chose, and the server enforces it.' },
    { icon: 'message', title: 'AI explanations', body: 'Ask in your own words and get answers based on your subject materials, with sources.' },
    { icon: 'image', title: 'Illustrated notes', body: 'Diagrams, concept maps and worked examples make ideas easier to see.' },
    { icon: 'puzzle', title: 'Interactive practice', body: 'Questions mark themselves and explain why an answer is right or wrong.' },
    { icon: 'gamepad', title: 'Learning games', body: 'Reviewed word games and challenges turn revision into play.' },
    { icon: 'chart', title: 'Progress you can see', body: 'Track completed lessons, practice scores and topics to revisit.' },
    { icon: 'smartphone', title: 'Learn on any device', body: 'Works in the browser on phones, tablets and computers. Save lessons to read offline when allowed.' },
  ] },
  principles: { title: 'Designed around the way students learn', subtitle: 'We have not collected testimonials yet. Here are the learning principles the platform is built on.', items: [
    { title: 'Understanding before memorising', body: 'Explanations build from what you already know, with examples from everyday life in Ghana.' },
    { title: 'Active practice', body: 'Short, frequent questions with immediate feedback strengthen memory more than rereading.' },
    { title: 'Learning from mistakes', body: 'Every answer comes with the reasoning, so a wrong answer becomes a lesson.' },
    { title: 'Competency and application', body: 'Activities and practical tasks ask you to use ideas, not just recall them.' },
  ] },
  faqs: [
    { q: 'What is this learning platform?', a: '{appName} is a learning platform for Ghanaian Junior and Senior High School students and their teachers. It turns approved learner manuals into structured lessons, practice questions and games, and it has an AI tutor that answers from those materials.' },
    { q: 'Which educational levels does it support?', a: 'It is built for the Senior High School (SHS) and Junior High School (JHS) curricula. Administrators choose which levels are open; a level that is not open yet is not offered when you sign up.' },
    { q: 'How are the learning notes generated?', a: 'Curriculum staff upload approved learner manuals. The AI drafts lessons from those manuals and records the pages it used. A person reviews every lesson before it is published, and nobody can approve their own work.' },
    { q: 'Does the AI tutor use approved learner manuals?', a: 'Yes. The tutor searches the manuals indexed for your subject and bases its answers on them, showing the sources it used. When the manuals do not cover a question, it says so and labels any general explanation.' },
    { q: 'Can I select only the subjects I study?', a: 'Yes. When you sign up you choose your level, class, learning area and subjects. Your learning space shows only those subjects, and the server refuses access to any others.' },
    { q: 'How do the quizzes and games work?', a: 'Practice questions and games come from reviewed, published content. Auto-marked questions give instant feedback with an explanation, written answers can be marked by a teacher, and your results feed your progress page.' },
    { q: 'Can I meet my teachers live?', a: 'Yes, if your school uses {appName}. Under Meetings you can book a published slot with one of your school\u2019s teachers or counselors, or propose a time, and choose to meet in person or online. For online sessions the teacher adds a meeting link, which opens in their video service; {appName} does not host the video call itself. You can only book staff at your own school.' },
    { q: 'Can teachers use the platform?', a: 'Yes. Teachers with an account linked to their school can see their classes, assign practice and assessments, mark written answers and follow class progress.' },
    { q: 'Can schools manage their students?', a: 'Yes. School administrators manage their school\u2019s users, classes and enrolments (including importing enrolment lists) and see analytics for their school. School accounts are set up by the platform team, so please get in touch through the For Schools page.' },
    { q: 'Can I access lessons on my phone?', a: 'Yes. {appName} runs in the web browser on phones, tablets and computers. There is no app to install.' },
    { q: 'Can I use learning materials offline?', a: 'Partly. When it is allowed, you can save published lessons on your device and read them without a connection. The AI tutor, practice and games need an internet connection.' },
    { q: 'Is the platform free?', a: 'Creating a student account costs nothing, and there is no payment step in the app today. Pricing for schools has not been published; ask through the For Schools page.' },
    { q: 'How does the platform protect student information?', a: 'Passwords are stored as salted hashes, sessions use secure cookies, and the server checks every request against your role and subjects. Administrative actions are recorded in an audit log, and tutor conversations are deleted after the retention period set by the platform.' },
  ],
  finalCta: { title: 'Your next breakthrough starts with understanding.', subtitle: 'Choose your subjects, explore your learning materials and take the next step in your learning journey.', primaryLabel: 'Sign up free', secondaryLabel: 'I\u2019m a teacher \u2014 apply' },
  signup: { headerLabel: 'Sign up', studentLabel: 'I\u2019m a student', studentHint: 'Free student account', teacherLabel: 'I\u2019m a teacher', teacherHint: 'Apply; an administrator approves it',
    teacherApplyLabel: 'Apply for a teacher account', teacherNote: 'An administrator checks your school and subjects, then we email you a link to choose your password.',
    loginStudentLabel: 'Create a student account', loginTeacherLabel: 'Teacher? Apply here' },
  footer: { description: 'Curriculum-aligned learning for Ghanaian students and teachers: reviewed notes, an AI tutor, practice and games built from approved learner manuals.',
    dataProtection: 'We are committed to handling personal data in line with Ghana\u2019s Data Protection Act, 2012 (Act 843). This is our commitment, not a certification.',
    languageNote: 'Learning content is currently in English.' },
  organisation: { poweredByLabel: '', name: 'SmartGene Solutions', address: 'P. O. Box AH1237, Achimota, Accra, Ghana', email: 'info@smartgenesolutions.com', phone: '+233 53 050 6573', hashtag: '#smartgene' },
};
/**
 * Earlier built-in sign-up labels. Stored content that still carries one of them unchanged gets the current default
 * (an admin who wrote their own text keeps it).
 */
export function upgradeLandingDefaults(c: LandingContent): LandingContent {
  const h = c.hero; const f = c.finalCta; const D = LANDING_DEFAULTS;
  const same = (a: { label: string; href: string }, label: string, href: string) => a.label === label && a.href === href;
  return { ...c,
    hero: { ...h, primaryCta: same(h.primaryCta, 'Start Learning Free', '/register') ? D.hero.primaryCta : h.primaryCta, secondaryCta: same(h.secondaryCta, 'Explore Subjects', '/#subjects') ? D.hero.secondaryCta : h.secondaryCta },
    finalCta: { ...f, primaryLabel: f.primaryLabel === 'Start Learning Free' ? D.finalCta.primaryLabel : f.primaryLabel, secondaryLabel: f.secondaryLabel === 'Explore Subjects' ? D.finalCta.secondaryLabel : f.secondaryLabel } };
}
/** Replaces {appName} in a configured string. */
export const withName = (s: string, appName: string) => s.replace(/\{appName\}/g, appName);

/** Public school/contact enquiry (stored, viewable in Admin → Public Website). */
export const ENQUIRY_KINDS = ['school', 'contact'] as const;
export const ENQUIRY_STATUSES = ['new', 'in_progress', 'closed'] as const;
export const enquirySchema = z.object({
  kind: z.enum(ENQUIRY_KINDS), name: t(120, 2), email: z.email().max(200), phone: opt(40).default(''), organisation: opt(160).default(''), role: opt(80).default(''), region: opt(80).default(''),
  learners: z.number().int().min(1).max(100_000).optional(), topic: opt(80).default(''), message: t(3000, 10),
  consent: z.literal(true, { message: 'Please agree so we can reply to you' }),
  /** Honeypot: must stay empty. */
  website: z.string().max(0).optional(),
}).strict().refine((e) => e.kind !== 'school' || e.organisation.length >= 2, { message: 'Enter the school or organisation name', path: ['organisation'] });
export type EnquiryInput = z.infer<typeof enquirySchema>;
