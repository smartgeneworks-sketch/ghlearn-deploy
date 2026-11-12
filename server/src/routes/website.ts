import { Router } from 'express';
import { z } from 'zod';
import { LANDING_DEFAULTS, landingSchema, ENQUIRY_STATUSES } from '@ghlearn/shared/src/landing';
import { authenticate, requirePermission } from '../middleware/index.js';
import { Enquiry, Lesson, User } from '../models/index.js';
import { loadLanding, saveLanding, resetLanding } from '../services/landingContent.js';
import { assertNoSecrets } from '../services/platformSettings.js';
import { audit, diff } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { pageInputSchema, pageUpdateSchema } from '@ghlearn/shared/src/pages';
import { ContentPage } from '../models/pages.js';
import { emailConfigured } from '../services/mailer.js';

/** Admin → Public Website: landing content (validated, versioned, audited) and public enquiries. Super Admin (platform:manage). */
export const websiteAdminRouter = Router();
websiteAdminRouter.use(authenticate, requirePermission('platform:manage'));
websiteAdminRouter.get('/landing', async (_req, res) => {
  const l = await loadLanding(); const by = l.updatedBy ? await User.findById(l.updatedBy).select('fullName').lean() : null;
  const ids = l.content.lessons.featuredLessonIds;
  const featured = ids.length ? await Lesson.find({ _id: { $in: ids } }).select('title status publicPreview').lean() : [];
  res.json({ content: l.content, defaults: LANDING_DEFAULTS, version: l.version, updatedAt: l.updatedAt ?? null, updatedBy: by?.fullName ?? null, customised: l.customised,
    featuredLessons: ids.map((id) => { const x = featured.find((f) => String(f._id) === id); return { id, title: x?.title ?? null, public: !!x && x.status === 'published' && !!(x as any).publicPreview }; }),
    emailConfigured: emailConfigured() });
});
/** Validates without saving: returns every issue with its path so the editor can show them. */
websiteAdminRouter.post('/landing/check', async (req, res) => {
  try { assertNoSecrets(req.body); } catch (e: any) { return res.json({ ok: false, issues: [{ path: '', message: e.message }] }); }
  const r = landingSchema.safeParse(req.body);
  res.json(r.success ? { ok: true, issues: [] } : { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
});
websiteAdminRouter.put('/landing', async (req, res) => {
  const { before, after, stored } = await saveLanding(req.body, req.auth!.userId);
  const d = diff(before as any, after as any);
  audit(req, 'landing.update', 'landing', { sections: Object.keys(d.after), version: stored.version }, { entityType: 'settings', ...d });
  res.json({ content: after, version: stored.version, changed: Object.keys(d.after) });
});
websiteAdminRouter.post('/landing/reset', async (req, res) => {
  const before = (await loadLanding()).content; const s = await resetLanding();
  audit(req, 'landing.reset', 'landing', undefined, { entityType: 'settings', ...diff(before as any, s.content as any) });
  res.json({ content: s.content, version: s.version });
});

websiteAdminRouter.get('/enquiries', async (req, res) => {
  const q = z.object({ status: z.enum(ENQUIRY_STATUSES).optional(), kind: z.enum(['school', 'contact']).optional(), page: z.coerce.number().int().min(1).max(1000).default(1) }).loose().parse(req.query);
  const f: Record<string, unknown> = {}; if (q.status) f.status = q.status; if (q.kind) f.kind = q.kind;
  const [items, total, open] = await Promise.all([Enquiry.find(f).select('-ip').sort({ createdAt: -1 }).skip((q.page - 1) * 50).limit(50).lean(), Enquiry.countDocuments(f), Enquiry.countDocuments({ status: 'new' })]);
  res.json({ items, total, page: q.page, pageSize: 50, newCount: open });
});
websiteAdminRouter.patch('/enquiries/:id', async (req, res) => {
  const b = z.object({ status: z.enum(ENQUIRY_STATUSES).optional(), adminNote: z.string().trim().max(2000).optional() }).strict().parse(req.body);
  if (!/^[a-f0-9]{24}$/i.test(String(req.params.id))) throw notFound('Enquiry not found');
  const before = await Enquiry.findById(req.params.id).lean(); if (!before) throw notFound('Enquiry not found');
  const doc = await Enquiry.findByIdAndUpdate(req.params.id, { ...b, updatedBy: req.auth!.userId }, { returnDocument: 'after' }).select('-ip').lean();
  audit(req, 'enquiry.update', String(req.params.id), undefined, { entityType: 'enquiry', ...diff(before as any, doc as any, Object.keys(b)) });
  res.json(doc);
});

/** Pages (help articles, legal drafts). New pages start as drafts; nothing is deleted (archive instead). */
const pageView = (p: any) => ({ id: String(p._id), slug: p.slug, title: p.title, kind: p.kind, audience: p.audience, summary: p.summary, body: p.body, order: p.order, status: p.status,
  reviewNote: p.reviewNote, version: p.version, publishedAt: p.publishedAt ?? null, updatedAt: p.updatedAt });
const PAGE_KEYS = ['slug', 'title', 'kind', 'audience', 'summary', 'body', 'order', 'status', 'reviewNote'];
websiteAdminRouter.get('/pages', async (req, res) => {
  const q: Record<string, unknown> = {}; if (typeof req.query.kind === 'string') q.kind = req.query.kind; if (req.query.archived !== 'true') q.status = { $ne: 'archived' };
  res.json({ items: (await ContentPage.find(q).sort({ kind: 1, audience: 1, order: 1, title: 1 }).lean()).map(pageView) });
});
websiteAdminRouter.get('/pages/:id', async (req, res) => {
  const p = await ContentPage.findById(req.params.id).lean().catch(() => null); if (!p) throw notFound('Page'); res.json({ page: pageView(p) });
});
websiteAdminRouter.post('/pages', async (req, res) => {
  const b = pageInputSchema.parse(req.body); assertNoSecrets(b);
  if (await ContentPage.exists({ slug: b.slug })) throw conflict('A page with that address already exists');
  const p = await ContentPage.create({ ...b, status: 'draft', updatedBy: req.auth!.userId });
  audit(req, 'page.create', String(p._id), { slug: p.slug, kind: p.kind, status: 'draft' }, { entityType: 'page' }); res.status(201).json({ page: pageView(p) });
});
websiteAdminRouter.patch('/pages/:id', async (req, res) => {
  const b = pageUpdateSchema.parse(req.body); assertNoSecrets(b);
  const p = await ContentPage.findById(req.params.id).catch(() => null); if (!p) throw notFound('Page');
  if (p.status === 'archived') throw conflict('Restore this page before editing it');
  if (b.slug && b.slug !== p.slug && (await ContentPage.exists({ slug: b.slug }))) throw conflict('A page with that address already exists');
  const before = p.toObject(); p.set({ ...b, updatedBy: req.auth!.userId, version: (p.version ?? 1) + 1 }); await p.save();
  audit(req, 'page.update', String(p._id), { slug: p.slug, fields: Object.keys(b) }, { entityType: 'page', ...diff(before, p.toObject(), PAGE_KEYS) }); res.json({ page: pageView(p) });
});
const STATUS_OPS = { publish: 'published', unpublish: 'draft', archive: 'archived', restore: 'draft' } as const;
websiteAdminRouter.post('/pages/:id/:op', async (req, res) => {
  const op = req.params.op as keyof typeof STATUS_OPS; if (!Object.hasOwn(STATUS_OPS, op)) throw notFound('Action'); const p = await ContentPage.findById(req.params.id).catch(() => null); if (!p) throw notFound('Page');
  const from = p.status;
  if (op === 'publish' && p.kind === 'legal') throw conflict('Legal pages are drafts only here. After owner and legal review, publish the approved text in System Settings → Legal, which versions it.');
  if (op === 'publish' && from !== 'draft') throw conflict('Only drafts can be published'); if (op === 'unpublish' && from !== 'published') throw conflict('This page is not published');
  if (op === 'archive' && from === 'archived') throw conflict('Already archived'); if (op === 'restore' && from !== 'archived') throw conflict('This page is not archived');
  p.status = STATUS_OPS[op]; if (op === 'publish') { p.publishedAt = new Date(); p.publishedBy = req.auth!.userId as any; } await p.save();
  audit(req, `page.${op}`, String(p._id), { slug: p.slug }, { entityType: 'page', before: { status: from }, after: { status: p.status } }); res.json({ page: pageView(p) });
});
