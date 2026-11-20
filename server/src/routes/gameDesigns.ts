import { notifyPublished } from '../services/eventNotifications.js';
import { Router, type Request } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { GameDesign, GameSession, Question, Subject, ContentVersion } from '../models/index.js';
import { GAMES, DESIGN_STATUSES } from '../models/assess.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middleware/index.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { GAME_INFO, GAME_RULES, validateGame, designItems, presentItem, checkItem, hintFor, pool, itemMax, ITEM_POINTS, HINT_COST } from '../services/assess/games.js';
import { normalize, shuffled, prng, validateQuestion } from '../services/assess/core.js';
import { can, snapshot, log, authorsOf, history, IN_REVIEW } from '../services/assess/review.js';

/**
 * Authored educational games (§14). Authors (content:edit) create or generate designs from approved content; Content Reviewers verify
 * the answers and approve (never their own work); publishing (content:publish) is blocked while any answer is unverified or the
 * dry-run validation finds a broken interaction.
 */
export const gameDesignsRouter = Router();
gameDesignsRouter.use(authenticate, requireAnyPermission('content:edit', 'content:review'));
const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const EDITABLE = ['draft', 'changes_requested'];
const label = (s: string) => s.replace(/_/g, ' ');
const str = (n: number) => z.string().trim().max(n);
const content = z.object({
  pairs: z.array(z.object({ term: str(120), definition: str(400), hint: str(300).optional() }).strict()).max(8).optional(),
  cards: z.array(z.object({ front: str(300), back: str(600), hint: str(300).optional() }).strict()).max(30).optional(),
  terms: z.array(z.object({ term: str(30), clue: str(300), hint: str(300).optional() }).strict()).max(10).optional(),
  sequences: z.array(z.object({ title: str(200).optional(), steps: z.array(str(200)).max(8), hint: str(300).optional() }).strict()).max(8).optional(),
  diagrams: z.array(z.object({ title: str(200).optional(), centre: str(80), labels: z.array(z.union([str(60), z.array(str(60)).min(1).max(5)])).max(8), alt: str(400).optional(), hint: str(300).optional() }).strict()).max(6).optional(),
  groups: z.array(z.object({ title: str(200).optional(), categories: z.array(z.object({ name: str(80), items: z.array(str(120)).max(8) }).strict()).max(4), hint: str(300).optional() }).strict()).max(4).optional(),
}).strict();
const settings = z.object({ pointsPerItem: z.number().int().min(1).max(100).default(ITEM_POINTS), hintsEnabled: z.boolean().default(true), hintCost: z.number().int().min(0).max(99).default(HINT_COST),
  timeLimitSec: z.number().int().min(30).max(3600).nullable().optional(), streakBonus: z.number().int().min(0).max(20).default(2) }).strict();
const body = z.object({ title: str(200).min(3), subjectId: oid, topic: str(200).min(2), objective: str(500).min(5), strand: str(200).optional(), yearOfStudy: z.number().int().min(1).max(6).optional(),
  type: z.enum(GAMES), difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'), settings: settings.prefault({}), questionIds: z.array(oid).max(40).default([]), content: content.prefault({}) }).strict();
const load = async (id: string) => { if (!mongoose.isValidObjectId(id)) throw notFound('Game not found'); const d = await GameDesign.findById(id); if (!d) throw notFound('Game not found'); return d; };
const revalidate = async (d: any) => { const v = await validateGame(d.toObject ? d.toObject() : d); d.validation = v; return v; };

async function decideBlock(req: Request, d: any) {
  if (!can(req, 'content:review')) return 'Only Content Reviewers can approve or request changes';
  if (!IN_REVIEW.includes(d.status) && !(d.status === 'approved')) return `Only games awaiting review can be decided (this one is ${label(d.status)})`;
  if ((await authorsOf('game', d)).has(req.auth!.userId)) return 'You created or edited this game, so you cannot review it (separation of duties)';
  return null;
}
function publishBlock(d: any, v: any) {
  if (d.status !== 'approved') return 'Only approved games can be published';
  if (d.approvedVersion !== d.version) return `Approval was for version ${d.approvedVersion ?? '–'}; the game is now version ${d.version}`;
  if (!v.ok) return `The validation check failed: ${v.errors[0]}`;
  if (v.unverified.length) return `Unverified answers: ${v.unverified[0]}`;
  return null;
}

gameDesignsRouter.get('/meta', (_req, res) => res.json({ types: GAMES.map((g) => ({ key: g, ...GAME_INFO[g], ...GAME_RULES[g] })), statuses: DESIGN_STATUSES,
  marking: 'Every game item is auto-marked. Written (essay) answers are never used in games: they are teacher-marked in assessments.' }));
gameDesignsRouter.get('/', async (req, res) => {
  const q = z.object({ subjectId: oid.optional(), status: z.string().optional(), type: z.string().optional(), review: z.enum(['queue']).optional(), search: z.string().max(100).optional() }).parse(req.query);
  const f: any = {}; if (q.subjectId) f.subjectId = q.subjectId; if (q.type) f.type = q.type; if (q.review) f.status = { $in: IN_REVIEW }; else if (q.status) f.status = q.status;
  if (q.search) f.title = { $regex: q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const items = await GameDesign.find(f).populate('subjectId', 'name').populate('createdBy', 'fullName').sort({ updatedAt: -1 }).limit(200).lean();
  const plays = await GameSession.aggregate([{ $match: { designId: { $in: items.map((i) => i._id) } } }, { $group: { _id: '$designId', n: { $sum: 1 }, players: { $addToSet: '$userId' } } }]);
  res.json({ items: items.map((d: any) => { const p = plays.find((x) => String(x._id) === String(d._id)); return { ...d, info: GAME_INFO[d.type], sessions: p?.n ?? 0, players: p?.players.length ?? 0 }; }) });
});
gameDesignsRouter.get('/:id', async (req, res) => {
  const d = await load(String(req.params.id)); const v = await revalidate(d); await GameDesign.updateOne({ _id: d._id }, { validation: v });
  const [block, h, qs, subject] = await Promise.all([decideBlock(req, d), history('game', d._id), Question.find({ _id: { $in: d.questionIds } }).select('stem type status topic keyVerifiedAt keyVerifiedVersion version').lean(), Subject.findById(d.subjectId).select('name').lean()]);
  const pb = publishBlock(d, v); const sessions = await GameSession.countDocuments({ designId: d._id });
  res.json({ design: d, subject, info: GAME_INFO[d.type], rules: GAME_RULES[d.type], validation: v, questions: qs.map((q: any) => ({ ...q, keyVerified: !!q.keyVerifiedAt && q.keyVerifiedVersion === (q.version ?? 1) })), ...h, sessions,
    permissions: { edit: can(req, 'content:edit') && EDITABLE.includes(d.status), submit: can(req, 'content:edit') && EDITABLE.includes(d.status) && v.ok, decide: !block, decideBlock: block,
      publish: can(req, 'content:publish') && !pb, publishBlock: pb, unpublish: can(req, 'content:publish') && d.status === 'published',
      archive: (can(req, 'content:publish') || can(req, 'curriculum:manage')) && d.status !== 'archived', restore: (can(req, 'content:publish') || can(req, 'curriculum:manage')) && d.status === 'archived',
      delete: EDITABLE.includes(d.status) && !d.publishedAt && !sessions && (String(d.createdBy) === req.auth!.userId || can(req, 'curriculum:manage')) } });
});
gameDesignsRouter.get('/:id/versions/:v', async (req, res) => { const d = await load(String(req.params.id));
  const v = await ContentVersion.findOne({ kind: 'game', refId: d._id, version: Number(req.params.v) }).populate('createdBy', 'fullName').lean(); if (!v) throw notFound('Version not found'); res.json({ version: v }); });
async function checkQuestions(b: { subjectId: string; questionIds: string[] }) {
  if (!b.questionIds.length) return; const n = await Question.countDocuments({ _id: { $in: b.questionIds }, subjectId: b.subjectId });
  if (n !== new Set(b.questionIds).size) throw badRequest('Every question must exist and belong to the game\'s subject');
}
gameDesignsRouter.post('/', requirePermission('content:edit'), async (req, res) => {
  const b = body.parse(req.body); const s = await Subject.findById(b.subjectId).lean(); if (!s) throw badRequest('Unknown subject'); await checkQuestions(b);
  const d = new GameDesign({ ...b, levelId: s.levelId, createdBy: req.auth!.userId, status: 'draft', version: 1 }); await revalidate(d); await d.save();
  await snapshot('game', d, 'Created manually', req.auth!.userId); await log('game', d, req, 'create'); audit(req, 'game.create', String(d._id)); res.status(201).json({ design: d, validation: d.validation });
});
gameDesignsRouter.patch('/:id', requirePermission('content:edit'), async (req, res) => {
  const d = await load(String(req.params.id));
  if (!EDITABLE.includes(d.status)) throw conflict(`A game that is ${label(d.status)} cannot be edited${d.status === 'published' ? '. Unpublish it first' : IN_REVIEW.includes(d.status) ? ' while it is being reviewed (a reviewer can request changes)' : d.status === 'approved' ? '. Ask a reviewer to send it back' : ''}.`);
  const raw = body.partial().omit({ subjectId: true, type: true }).strict().parse(req.body); const b = Object.fromEntries(Object.entries(raw).filter(([k]) => k in (req.body ?? {}))) as typeof raw; await checkQuestions({ subjectId: String(d.subjectId), questionIds: b.questionIds ?? d.questionIds.map(String) });
  Object.assign(d, b); if (b.settings) d.settings = { ...b.settings } as any; if (b.content) { d.content = b.content; d.markModified('content'); }
  Object.assign(d, { version: d.version + 1, answersVerifiedAt: undefined, answersVerifiedBy: undefined, answersVerifiedVersion: undefined });
  await revalidate(d); await d.save(); await snapshot('game', d, 'Edited', req.auth!.userId); await log('game', d, req, 'edit'); audit(req, 'game.edit', String(d._id)); res.json({ design: d, validation: d.validation });
});
gameDesignsRouter.post('/:id/validate', async (req, res) => { const d = await load(String(req.params.id)); const v = await revalidate(d); await GameDesign.updateOne({ _id: d._id }, { validation: v }); res.json({ validation: v }); });

/** Generate a draft game from APPROVED content only: verified bank questions and published lessons of the subject/topic. Deterministic, no AI call. */
gameDesignsRouter.post('/generate', requirePermission('content:edit'), async (req, res) => {
  const b = z.object({ subjectId: oid, type: z.enum(GAMES), topic: str(200).min(2), objective: str(500).min(5), title: str(200).min(3).optional(), difficulty: z.enum(['easy', 'medium', 'hard']).default('medium') }).strict().parse(req.body);
  const s = await Subject.findById(b.subjectId).lean(); if (!s) throw badRequest('Unknown subject');
  const P = await pool(b.subjectId, b.topic); const rule = GAME_RULES[b.type]; const rnd = prng(Date.now() % 2 ** 31);
  const verified = P.questions.filter((q: any) => q.keyVerifiedAt && q.keyVerifiedVersion === (q.version ?? 1) && validateQuestion(q).ok);
  const from: any[] = []; const c: any = {}; const useLesson = (l: any) => { if (!from.some((f) => f.id === String(l._id))) from.push({ kind: 'lesson', id: String(l._id), title: l.title }); };
  let qs = shuffled(verified.filter((q: any) => rule.questionTypes.includes(q.type) && (b.type !== 'scenario' || (q.data?.parts ?? []).some((p: any) => p.type !== 'essay'))), rnd);
  const termsWithLesson = [...P.sec('E').flatMap(({ s: x, l }: any) => (x.data?.terms ?? []).map((t: any) => ({ ...t, l }))), ...P.sec('J').flatMap(({ s: x, l }: any) => (x.data?.vocabulary ?? []).map((t: any) => ({ ...t, l })))]
    .filter((t: any) => t.term && t.definition).filter((t: any, i: number, a: any[]) => a.findIndex((y) => normalize(y.term) === normalize(t.term)) === i);
  switch (b.type) {
    case 'match_terms': { const ts = shuffled(termsWithLesson, rnd).slice(0, 8); if (ts.length >= 3) { c.pairs = ts.map((t: any) => ({ term: t.term, definition: t.definition })); ts.forEach((t: any) => useLesson(t.l)); qs = []; } else qs = qs.slice(0, 4); break; }
    case 'flashcards': { const cards = [...P.sec('J').flatMap(({ s: x, l }: any) => (x.data?.flashcards ?? []).map((f: any) => ({ front: f.front, back: f.back, l }))), ...termsWithLesson.map((t: any) => ({ front: t.term, back: t.definition, l: t.l }))]
        .filter((x: any) => x.front && x.back).filter((x: any, i: number, a: any[]) => a.findIndex((y) => normalize(y.front) === normalize(x.front)) === i).slice(0, 20);
      c.cards = cards.map((x: any) => ({ front: x.front, back: x.back })); cards.forEach((x: any) => useLesson(x.l)); break; }
    case 'word_search': { const ts = shuffled(termsWithLesson.filter((t: any) => /^[A-Za-z]{3,10}$/.test(String(t.term).trim()) && !normalize(t.definition).includes(normalize(t.term))), rnd).slice(0, 8);
      c.terms = ts.map((t: any) => ({ term: String(t.term).trim(), clue: t.definition })); ts.forEach((t: any) => useLesson(t.l)); break; }
    case 'classification': { const groups: any[] = [];
      for (const { s: x, l } of [...P.sec('J'), ...P.sec('F')] as any[]) { const maps = x.key === 'J' ? [x.data?.conceptMap] : (x.data?.diagrams ?? []).map((d: any) => d.spec);
        for (const m of maps) { const cats = (m?.children ?? []).filter((ch: any) => ch.children?.length >= 2).slice(0, 4); if (cats.length >= 2 && groups.length < 3) { groups.push({ title: m.root, categories: cats.map((ch: any) => ({ name: ch.label, items: ch.children.slice(0, 4) })) }); useLesson(l); } } }
      c.groups = groups; break; }
    case 'ordering': { qs = qs.slice(0, 4); const seqs: any[] = [];
      for (const { s: x, l } of P.sec('F') as any[]) for (const d of x.data?.diagrams ?? []) if (['flow', 'cycle'].includes(d.spec?.kind) && (d.spec.steps ?? []).length >= 3 && seqs.length < 4) { seqs.push({ title: d.spec.title, steps: d.spec.steps.slice(0, 8) }); useLesson(l); }
      c.sequences = seqs; break; }
    case 'label_diagram': { qs = qs.slice(0, 3); const ds: any[] = [];
      for (const { s: x, l } of P.sec('F') as any[]) for (const d of x.data?.diagrams ?? []) if (d.spec?.kind === 'labelled' && (d.spec.labels ?? []).length >= 2 && ds.length < 3) { ds.push({ title: d.spec.title, centre: d.spec.centre, labels: d.spec.labels.slice(0, 8), alt: d.alt }); useLesson(l); }
      c.diagrams = ds; break; }
    default: qs = qs.slice(0, Math.min(rule.max, b.type === 'timed_revision' ? 20 : 10));
  }
  const n = qs.length + (rule.content ? (c[rule.content]?.length ?? 0) : 0);
  if (n < rule.min) throw new AppError(422, 'NOT_ENOUGH_CONTENT', `Not enough approved content for ${GAME_INFO[b.type].name} on "${b.topic}": found ${n}, needs ${rule.min}. ${rule.help} Only approved questions with a verified answer key and published lessons are used.`);
  qs.forEach((q: any) => from.push({ kind: 'question', id: String(q._id), title: String(q.stem).slice(0, 80) }));
  const d = new GameDesign({ title: b.title ?? `${GAME_INFO[b.type].name}: ${b.topic}`, subjectId: b.subjectId, levelId: s.levelId, topic: b.topic, objective: b.objective, type: b.type, difficulty: b.difficulty,
    settings: { pointsPerItem: ITEM_POINTS, hintsEnabled: true, hintCost: HINT_COST, streakBonus: 2 }, questionIds: qs.map((q: any) => q._id), content: c, status: 'draft', version: 1, createdBy: req.auth!.userId, source: { generated: true, from } });
  await revalidate(d); await d.save(); await snapshot('game', d, `Generated from approved content (${from.length} source item(s))`, req.auth!.userId); await log('game', d, req, 'create', 'Generated from approved content');
  audit(req, 'game.generate', String(d._id), { type: b.type, topic: b.topic, sources: from.length }); res.status(201).json({ design: d, validation: d.validation });
});

/** Preview exactly as a student plays it (same build and marking), without a session, XP or mastery. */
gameDesignsRouter.post('/:id/preview', async (req, res) => {
  const d = await load(String(req.params.id)); const { seed } = z.object({ seed: z.number().int().min(1).max(2 ** 31).optional() }).strict().parse(req.body ?? {});
  const sd = seed ?? Math.floor(Math.random() * 2 ** 31) + 1; const items = await designItems(d.toObject(), sd);
  res.json({ seed: sd, game: d.type, info: GAME_INFO[d.type], title: d.title, settings: d.settings, maxScore: items.length * itemMax(d.type, d.settings?.pointsPerItem ?? ITEM_POINTS), items: items.map((it) => presentItem(d.type, it)) });
});
gameDesignsRouter.post('/:id/preview/check', async (req, res) => {
  const d = await load(String(req.params.id)); const b = z.object({ seed: z.number().int().min(1), itemId: z.string().max(100), answer: z.any().optional(), hint: z.boolean().optional() }).strict().parse(req.body);
  const it = (await designItems(d.toObject(), b.seed)).find((x) => x.id === b.itemId); if (!it) throw notFound('Item not found');
  if (b.hint) { if (d.settings?.hintsEnabled === false) throw new AppError(409, 'HINTS_OFF', 'Hints are turned off for this game'); return res.json({ hint: hintFor(d.type, it), cost: d.settings?.hintCost ?? HINT_COST }); }
  res.json(checkItem(d.type, it, b.answer, d.settings?.pointsPerItem ?? ITEM_POINTS));
});
gameDesignsRouter.post('/:id/submit', requirePermission('content:edit'), async (req, res) => {
  const d = await load(String(req.params.id)); if (!EDITABLE.includes(d.status)) throw conflict(`Cannot submit a ${label(d.status)} game`);
  const v = await revalidate(d); if (!v.ok) throw new AppError(422, 'INVALID_GAME', 'Fix the validation errors first', v.errors);
  const again = d.status === 'changes_requested'; Object.assign(d, { status: again ? 'resubmitted' : 'in_review', submittedAt: new Date() }); await d.save();
  await snapshot('game', d, 'Submitted', req.auth!.userId); await log('game', d, req, again ? 'resubmit' : 'submit'); audit(req, 'game.submit', String(d._id)); res.json({ design: d });
});
gameDesignsRouter.post('/:id/review', requirePermission('content:review'), async (req, res) => {
  const b = z.object({ action: z.enum(['approve', 'request_changes', 'comment']), comment: z.string().trim().max(1000).optional(), answersVerified: z.boolean().optional() }).strict().parse(req.body);
  const d = await load(String(req.params.id));
  if (b.action === 'comment') { if (!b.comment) throw badRequest('Write a comment'); await log('game', d, req, 'comment', b.comment); return res.json({ design: d }); }
  const block = await decideBlock(req, d); if (block) throw new AppError(403, 'REVIEW_BLOCKED', block);
  if (b.action === 'approve') {
    if (d.status === 'approved') throw conflict('Already approved');
    if (b.answersVerified !== true) throw new AppError(422, 'ANSWERS_NOT_VERIFIED', 'Confirm that you checked every answer in this game (play the preview) before approving');
    const v = await revalidate(d); if (!v.ok) throw new AppError(422, 'INVALID_GAME', 'The validation check failed', v.errors);
    Object.assign(d, { answersVerifiedBy: req.auth!.userId, answersVerifiedAt: new Date(), answersVerifiedVersion: d.version }); const v2 = await revalidate(d);
    if (v2.unverified.length) throw new AppError(422, 'UNVERIFIED_ANSWERS', `Approve the questions first: ${v2.unverified.join(' ')}`, v2.unverified);
    Object.assign(d, { status: 'approved', approvedVersion: d.version });
  } else { if (!b.comment) throw badRequest('Say what needs changing'); d.status = 'changes_requested'; }
  Object.assign(d, { reviewedBy: req.auth!.userId, reviewedAt: new Date() }); await d.save(); await log('game', d, req, b.action, b.comment);
  audit(req, `game.${b.action}`, String(d._id)); res.json({ design: d, validation: d.validation });
});
const audienceBody = z.object({ levelId: oid.optional(), yearOfStudy: z.number().int().min(1).max(6).optional(), programmeIds: z.array(oid).max(20).optional(), schoolIds: z.array(oid).max(50).optional() }).strict();
gameDesignsRouter.post('/:id/publish', requirePermission('content:publish'), async (req, res) => {
  const b = z.object({ audience: audienceBody.prefault({}) }).strict().parse(req.body ?? {}); const d = await load(String(req.params.id));
  const v = await revalidate(d); const pb = publishBlock(d, v); if (pb) { await GameDesign.updateOne({ _id: d._id }, { validation: v }); throw new AppError(409, 'PUBLISH_BLOCKED', pb, { errors: v.errors, unverified: v.unverified }); }
  Object.assign(d, { status: 'published', publishedBy: req.auth!.userId, publishedAt: new Date(), audience: { levelId: b.audience.levelId, yearOfStudy: b.audience.yearOfStudy, programmeIds: b.audience.programmeIds ?? [], schoolIds: b.audience.schoolIds ?? [] } });
  await d.save(); await log('game', d, req, 'publish'); audit(req, 'game.publish', String(d._id), { audience: b.audience }); notifyPublished('game', d, req.auth!.userId).catch(() => undefined); res.json({ design: d });
});
gameDesignsRouter.post('/:id/unpublish', requirePermission('content:publish'), async (req, res) => {
  const d = await load(String(req.params.id)); if (d.status !== 'published') throw conflict('Not published'); const { comment } = z.object({ comment: z.string().max(1000).optional() }).strict().parse(req.body ?? {});
  d.status = 'approved'; await d.save(); await log('game', d, req, 'unpublish', comment); audit(req, 'game.unpublish', String(d._id)); res.json({ design: d });
});
const archiver = (req: Request) => { if (!can(req, 'content:publish') && !can(req, 'curriculum:manage')) throw forbidden('Only Content Reviewers or Curriculum Admins can archive or restore'); };
gameDesignsRouter.post('/:id/archive', async (req, res) => { archiver(req); const d = await load(String(req.params.id)); if (d.status === 'archived') throw conflict('Already archived');
  if (d.status === 'published' && !can(req, 'content:publish')) throw forbidden('Only a Content Reviewer can archive a published game');
  const { comment } = z.object({ comment: z.string().max(1000).optional() }).strict().parse(req.body ?? {});
  Object.assign(d, { status: 'archived', archivedAt: new Date(), archivedBy: req.auth!.userId }); await d.save(); await log('game', d, req, 'archive', comment); audit(req, 'game.archive', String(d._id)); res.json({ design: d }); });
gameDesignsRouter.post('/:id/restore', async (req, res) => { archiver(req); const d = await load(String(req.params.id)); if (d.status !== 'archived') throw conflict('Only archived games can be restored');
  Object.assign(d, { status: 'draft', archivedAt: undefined, archivedBy: undefined, answersVerifiedAt: undefined, answersVerifiedBy: undefined, answersVerifiedVersion: undefined }); await d.save();
  await log('game', d, req, 'restore', 'Restored to draft: needs review again'); audit(req, 'game.restore', String(d._id)); res.json({ design: d }); });
gameDesignsRouter.delete('/:id', requirePermission('content:edit'), async (req, res) => { const d = await load(String(req.params.id));
  if (!EDITABLE.includes(d.status) || d.publishedAt) throw conflict('Only unpublished drafts can be deleted; archive the game instead');
  if (String(d.createdBy) !== req.auth!.userId && !can(req, 'curriculum:manage')) throw forbidden('Only the author or a Curriculum Admin can delete a draft');
  if (await GameSession.exists({ designId: d._id })) throw new AppError(409, 'IN_USE', 'This game has been played; archive it instead');
  await d.deleteOne(); audit(req, 'game.delete', String(d._id)); res.status(204).end(); });
/** Participation and performance (§14). Counts real student sessions only; staff previews create no sessions. */
gameDesignsRouter.get('/:id/stats', async (req, res) => {
  const d = await load(String(req.params.id)); const m = { designId: d._id };
  const [tot] = await GameSession.aggregate([{ $match: m }, { $group: { _id: null, sessions: { $sum: 1 }, finished: { $sum: { $cond: [{ $eq: ['$status', 'finished'] }, 1, 0] } }, players: { $addToSet: '$userId' }, hints: { $sum: '$hintsUsed' },
    pct: { $avg: { $cond: [{ $and: [{ $eq: ['$status', 'finished'] }, { $gt: ['$maxScore', 0] }] }, { $multiply: [100, { $divide: ['$score', '$maxScore'] }] }, null] } }, acc: { $avg: { $cond: [{ $eq: ['$status', 'finished'] }, '$accuracy', null] } }, xp: { $sum: { $ifNull: ['$xpAwarded', 0] } }, last: { $max: '$createdAt' } } }]);
  const per = await GameSession.aggregate([{ $match: m }, { $unwind: '$answers' }, { $match: { 'answers.hint': { $ne: true } } }, { $group: { _id: '$answers.itemId', n: { $sum: 1 }, correct: { $sum: { $cond: ['$answers.correct', 1, 0] } } } }]);
  const labels = new Map((await designItems(d.toObject(), 1)).map((it: any) => [it.id, it.q ? String(it.q.stem).slice(0, 80) : it.card ? it.card.front : it.word ?? it.title]));
  res.json({ sessions: tot?.sessions ?? 0, finished: tot?.finished ?? 0, players: tot?.players.length ?? 0, completionPct: tot?.sessions ? Math.round((100 * tot.finished) / tot.sessions) : null,
    averageScorePct: tot?.pct != null ? Math.round(tot.pct) : null, averageAccuracy: tot?.acc != null ? Math.round(tot.acc) : null, hintsUsed: tot?.hints ?? 0, xpAwarded: tot?.xp ?? 0, lastPlayed: tot?.last ?? null,
    items: per.map((x) => ({ itemId: x._id, label: labels.get(x._id) ?? x._id, answers: x.n, correctPct: Math.round((100 * x.correct) / x.n) })).sort((a, b) => a.correctPct - b.correctPct) });
});
