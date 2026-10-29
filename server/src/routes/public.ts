import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { z } from 'zod';
import { enquirySchema } from '@ghlearn/shared/src/landing';
import { AcademicLevel, Subject, Lesson, LearningResource, CurriculumNode, Enquiry } from '../models/index.js';
import { loadLanding } from '../services/landingContent.js';
import { ContentPage } from '../models/pages.js';
import { loadSettings } from '../services/platformSettings.js';
import { emailConfigured, sendEmail } from '../services/mailer.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { AppError, notFound } from '../lib/errors.js';

/**
 * Public (anonymous) API for the landing page and public pages (docs/LANDING_SPEC.md). Everything here is the same
 * for every caller, signed in or not, so nothing depends on the session and nothing restricted can leak:
 * - subjects: active, not archived, at an enabled level;
 * - topics: verified curriculum elements of those subjects (titles only);
 * - lessons: only published lessons an editor marked as a public preview, with no institution restriction, open to
 *   students, served from the published copy and without assessment answers or teacher notes.
 */
export const publicRouter = Router();
/**
 * Seeded demonstration data (isSample) never appears on public pages in production: no sample school, lesson or count.
 * Subjects and levels are not filtered: the real catalogue was merged into the seeded subject records, so they are real.
 * Development and the E2E suite keep it (their fixtures use it); HIDE_SAMPLE_PUBLIC=1 forces the production behaviour.
 */
export const hideSamples = () => config.NODE_ENV === 'production' || process.env.HIDE_SAMPLE_PUBLIC === '1';
export const notSample = () => (hideSamples() ? { isSample: { $ne: true } } : {});
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const cache = (res: any, s = 60) => res.set('Cache-Control', `public, max-age=${s}`);
/** Anything that lists or shows lessons is never reused from a cache, so removing a public preview takes effect at once. */
const fresh = (res: any) => res.set('Cache-Control', 'no-cache');

async function publicLevels() {
  const lv = await AcademicLevel.find({ archivedAt: null }).sort({ order: 1, name: 1 }).select('name kind enabled').lean();
  return lv.map((l) => ({ id: String(l._id), name: l.name, kind: l.kind as string, enabled: l.enabled !== false }));
}
async function publicSubjects() {
  const levels = await publicLevels(); const open = levels.filter((l) => l.enabled); const byId = new Map(open.map((l) => [l.id, l]));
  const subs = await Subject.find({ active: true, archivedAt: null, levelId: { $in: open.map((l) => l.id) } }).select('name code levelId category provenance.documentCount provenance.aliases').sort({ name: 1 }).lean();
  return { levels, subjects: subs.map((s: any) => ({ s, level: byId.get(String(s.levelId))! })) };
}
/** Published lessons per subject (not institution-restricted, open to students): a real count, shown only when > 0. */
async function publishedCounts(ids: mongoose.Types.ObjectId[]) {
  const rows = await LearningResource.aggregate([{ $match: { subjectId: { $in: ids }, status: 'published', ...notSample(), $and: [{ $or: [{ 'audience.schoolIds': { $exists: false } }, { 'audience.schoolIds': { $size: 0 } }] }, { $or: [{ 'audience.roles': { $exists: false } }, { 'audience.roles': { $size: 0 } }, { 'audience.roles': 'student' }] }] } }, { $group: { _id: '$subjectId', n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [String(r._id), r.n as number]));
}
/** Public-preview lessons (see header). */
async function previewLessons(filter: Record<string, unknown>, limit: number) {
  const ls = await Lesson.find({ ...filter, ...notSample(), status: 'published', publicPreview: true, resourceId: { $ne: null }, $or: [{ 'audience.schoolIds': { $exists: false } }, { 'audience.schoolIds': { $size: 0 } }] })
    .select('title subjectId topic yearOfStudy resourceId publishedAt').sort({ publishedAt: -1 }).limit(limit * 2).lean();
  if (!ls.length) return [];
  const live = new Set((await LearningResource.find({ _id: { $in: ls.map((l) => l.resourceId) }, ...notSample(), status: 'published', 'audience.roles': 'student', $or: [{ 'audience.schoolIds': { $exists: false } }, { 'audience.schoolIds': { $size: 0 } }] }).select('_id').lean()).map((r) => String(r._id)));
  return ls.filter((l) => live.has(String(l.resourceId))).slice(0, limit);
}
const subjectCard = (x: { s: any; level: { name: string; kind: string } }, counts: Map<string, number>) => ({
  id: String(x.s._id), name: x.s.name, code: x.s.code, category: x.s.category, level: { name: x.level.name, kind: x.level.kind },
  documents: x.s.provenance?.documentCount ?? null, publishedLessons: counts.get(String(x.s._id)) ?? 0 });

publicRouter.get('/landing', async (_req, res) => {
  const [l, st, levels] = await Promise.all([loadLanding(), loadSettings(), publicLevels()]); const s = st.settings;
  cache(res, 30).json({ content: l.content, version: l.version, branding: s.branding, levels,
    features: { selfRegistration: s.features.selfRegistration && config.selfRegistration, tutor: s.features.tutor, practice: s.features.practice, games: s.features.games, assessments: s.features.assessments, meetings: s.features.meetings !== false },
    legal: { terms: !!s.legal.terms.trim(), privacy: !!s.legal.privacy.trim() } });
});

/** Help Centre: published help articles only (drafts and legal drafts are never public). */
publicRouter.get('/pages', async (_req, res) => {
  const items = await ContentPage.find({ kind: 'help', status: 'published' }).select('slug title audience summary order').sort({ order: 1, title: 1 }).lean();
  res.json({ items: items.map((p) => ({ slug: p.slug, title: p.title, audience: p.audience, summary: p.summary })) });
});
publicRouter.get('/pages/:slug', async (req, res) => {
  const p = await ContentPage.findOne({ slug: String(req.params.slug).toLowerCase(), kind: 'help', status: 'published' }).lean();
  if (!p) throw notFound('Page');
  res.json({ page: { slug: p.slug, title: p.title, audience: p.audience, summary: p.summary, body: p.body, updatedAt: p.updatedAt } });
});
publicRouter.get('/subjects', async (req, res) => {
  const q = z.object({ filter: z.string().max(30).optional(), featured: z.enum(['1']).optional() }).loose().parse(req.query);
  const [{ subjects, levels }, landing] = await Promise.all([publicSubjects(), loadLanding()]);
  let list = subjects; const f = q.filter ? landing.content.subjects.filters.find((x) => x.id === q.filter) : undefined;
  if (q.filter && !f) throw new AppError(422, 'VALIDATION', 'Unknown filter');
  if (f) list = list.filter((x) => (!f.level || x.level.kind === f.level) && (!f.keywords.length || f.keywords.some((k) => x.s.name.toLowerCase().includes(k.toLowerCase()))));
  const order = landing.content.subjects.featuredCodes.map((c) => c.toUpperCase());
  if (q.featured) list = order.map((c) => list.find((x) => x.s.code === c)).filter(Boolean) as typeof list;
  else list = [...list].sort((a, b) => ((order.indexOf(a.s.code) + 1 || 999) - (order.indexOf(b.s.code) + 1 || 999)) || a.s.name.localeCompare(b.s.name));
  const counts = await publishedCounts(list.map((x) => x.s._id));
  const closed = f?.level && !levels.some((l) => l.kind === f.level && l.enabled) ? levels.find((l) => l.kind === f.level)?.name ?? f.level : null;
  cache(res).json({ items: list.map((x) => subjectCard(x, counts)), filter: f ? { id: f.id, label: f.label } : null, levelClosed: closed });
});

publicRouter.get('/subjects/:id', async (req, res) => {
  const id = oid.safeParse(req.params.id); if (!id.success) throw notFound('Subject not found');
  const { subjects } = await publicSubjects(); const x = subjects.find((s) => String(s.s._id) === id.data); if (!x) throw notFound('Subject not found');
  const [counts, nodes, lessons] = await Promise.all([publishedCounts([x.s._id]),
    CurriculumNode.find({ subjectId: x.s._id, verified: true, archivedAt: null, type: { $in: ['strand', 'subStrand', 'topic'] } }).select('title type order').sort({ order: 1 }).limit(300).lean(),
    previewLessons({ subjectId: x.s._id }, 12)]);
  const seen = new Set<string>(); const topics = nodes.filter((n) => { const k = n.title.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 60).map((n) => ({ title: n.title, type: n.type }));
  fresh(res).json({ subject: subjectCard(x, counts), topics, previews: lessons.map((l) => ({ id: String(l._id), title: l.title, topic: l.topic ?? null })) });
});

publicRouter.get('/search', async (req, res) => {
  const q = z.object({ q: z.string().trim().min(2, 'Type at least 2 characters').max(80) }).loose().parse(req.query).q;
  const rx = new RegExp(esc(q), 'i');
  const { subjects } = await publicSubjects(); const ids = subjects.map((x) => x.s._id); const byId = new Map(subjects.map((x) => [String(x.s._id), x]));
  const levelHit = subjects.filter((x) => rx.test(x.level.name) || rx.test(x.level.kind));
  const subjectHits = subjects.filter((x) => rx.test(x.s.name) || rx.test(x.s.code) || (x.s.provenance?.aliases ?? []).some((a: string) => rx.test(a)));
  const subjAll = [...new Map([...subjectHits, ...levelHit].map((x) => [String(x.s._id), x])).values()].slice(0, 8);
  const [nodes, lessons] = await Promise.all([
    CurriculumNode.find({ subjectId: { $in: ids }, verified: true, archivedAt: null, type: { $in: ['strand', 'subStrand', 'topic'] }, title: rx }).select('title subjectId').limit(60).lean(),
    previewLessons({ subjectId: { $in: ids }, $and: [{ $or: [{ title: rx }, { topic: rx }, { strand: rx }, { subStrand: rx }] }] }, 8)]);
  const seen = new Set<string>(); const topics: { title: string; subject: { id: string; name: string; level: string } }[] = [];
  for (const n of nodes) { const k = `${n.subjectId}|${n.title.trim().toLowerCase()}`; const sx = byId.get(String(n.subjectId)); if (!sx || seen.has(k)) continue; seen.add(k);
    topics.push({ title: n.title.trim(), subject: { id: String(sx.s._id), name: sx.s.name, level: sx.level.kind } }); if (topics.length >= 8) break; }
  const counts = await publishedCounts(subjAll.map((x) => x.s._id));
  fresh(res).json({ q, subjects: subjAll.map((x) => subjectCard(x, counts)), topics,
    lessons: lessons.map((l) => { const sx = byId.get(String(l.subjectId))!; return { id: String(l._id), title: l.title, topic: l.topic ?? null, subject: { id: String(sx.s._id), name: sx.s.name, level: sx.level.kind } }; }) });
});

/** Sections a visitor may read in a preview: overview, objectives, starter, explanation, diagrams, activities, revision, references. Never assessment answers (I), diagnostic answers (C) or teacher notes (T). */
const PREVIEW_SECTIONS = new Set(['A', 'B', 'D', 'E', 'F', 'G', 'J', 'K']);
publicRouter.get('/lessons/:id', async (req, res) => {
  const id = oid.safeParse(req.params.id); if (!id.success) throw notFound('Lesson not found');
  const { subjects } = await publicSubjects(); const [l] = await previewLessons({ _id: id.data, subjectId: { $in: subjects.map((x) => x.s._id) } }, 1);
  if (!l) throw notFound('Lesson not found'); // same answer for missing, unpublished, not a preview and restricted
  const r: any = await LearningResource.findById(l.resourceId).select('body title topic yearOfStudy').lean(); const sx = subjects.find((x) => String(x.s._id) === String(l.subjectId))!;
  const sections = (r?.body?.sections ?? []).filter((s: any) => PREVIEW_SECTIONS.has(s.key)).map((s: any) => ({ key: s.key, kind: s.kind, title: s.title, content: s.content ?? '', data: s.data ?? {} }));
  fresh(res).json({ lesson: { id: String(l._id), title: r?.title ?? l.title, topic: l.topic ?? null, yearOfStudy: l.yearOfStudy ?? null, subject: { id: String(sx.s._id), name: sx.s.name, level: sx.level.name }, sections,
    sources: (r?.body?.sourceDocuments ?? []).map((d: any) => ({ title: d.title, approvalStatus: d.approvalStatus })) } });
});

const enquiryLimiter = rateLimit({ windowMs: 60 * 60_000, limit: config.NODE_ENV === 'test' ? 1000 : 5, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_q, _r, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many messages from this connection. Please try again later or email us.')) });
publicRouter.post('/enquiries', enquiryLimiter, async (req: Request, res) => {
  const b = enquirySchema.parse(req.body);
  const doc = await Enquiry.create({ kind: b.kind, name: b.name, email: b.email.toLowerCase(), phone: b.phone || undefined, organisation: b.organisation || undefined, role: b.role || undefined,
    region: b.region || undefined, learners: b.learners, topic: b.topic || undefined, message: b.message, ip: req.ip });
  // Optional notification to the organisation address, only when email is configured and switched on (never pretends).
  const [landing, st] = await Promise.all([loadLanding(), loadSettings()]); const to = landing.content.organisation.email || st.settings.branding.supportEmail;
  let emailStatus: string = 'not_configured';
  if (emailConfigured() && st.settings.notifications.emailEnabled) {
    emailStatus = !to ? 'no_address' : (await sendEmail(to, `${b.kind === 'school' ? 'School enquiry' : 'Contact message'}: ${b.organisation || b.name}`,
      `${b.kind === 'school' ? 'New school enquiry' : 'New contact message'} (reference ${doc._id})\n\nName: ${b.name}\nEmail: ${b.email}\n${b.phone ? `Phone: ${b.phone}\n` : ''}${b.organisation ? `Organisation: ${b.organisation}\n` : ''}${b.role ? `Role: ${b.role}\n` : ''}${b.region ? `Region: ${b.region}\n` : ''}${b.learners ? `Learners: ${b.learners}\n` : ''}${b.topic ? `Topic: ${b.topic}\n` : ''}\n${b.message}\n\nOpen it in Admin → Public Website → Enquiries.`)).status;
  }
  doc.emailStatus = emailStatus; await doc.save();
  audit(req, 'enquiry.create', String(doc._id), { kind: b.kind, emailStatus }, { entityType: 'enquiry', actorId: req.auth?.userId });
  res.status(201).json({ reference: String(doc._id).slice(-8).toUpperCase(), received: true });
});
