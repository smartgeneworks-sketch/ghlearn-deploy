import { getSettings, settingsNow } from '../services/platformSettings.js';
import { Router } from 'express';
import { z } from 'zod';
import { Subject, StudentProfile, AcademicLevel, TutorConversation, TutorMessage } from '../models/index.js';
import { authenticate, requirePermission, canAccessSubject } from '../middleware/index.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { getLlm } from '../services/ai.js';
import { retrieve } from '../services/retrieval.js';
import { stream, BudgetExceededError } from '../services/usage.js';
import { tutorSystem, tutorUserTurn, screenInput, analyseAnswer, SAFETY_REPLY } from '../services/tutor.js';

export const tutorRouter = Router();
tutorRouter.use(authenticate, requirePermission('tutor:use'));
const oid = z.string().regex(/^[a-f0-9]{24}$/i);
const expiry = () => new Date(Date.now() + settingsNow().retention.tutorDays * 864e5); // §20 retention (new and active conversations)
const own = async (userId: string, id: string) => { const c = await TutorConversation.findOne({ _id: oid.safeParse(id).success ? id : null, userId }); if (!c) throw notFound('Conversation not found'); return c; };

tutorRouter.get('/conversations', async (req, res) => {
  const q: any = { userId: req.auth!.userId }; if (typeof req.query.subjectId === 'string' && oid.safeParse(req.query.subjectId).success) q.subjectId = req.query.subjectId;
  res.json({ items: await TutorConversation.find(q).sort({ lastMessageAt: -1, createdAt: -1 }).limit(50).lean(), retentionDays: (await getSettings()).retention.tutorDays });
});
tutorRouter.post('/conversations', async (req, res) => {
  const { subjectId } = z.object({ subjectId: oid }).parse(req.body);
  if (!(await Subject.exists({ _id: subjectId }))) throw notFound('Subject not found');
  if (!(await canAccessSubject(req.auth!, subjectId))) throw forbidden('You are not enrolled in this subject');
  res.status(201).json({ conversation: await TutorConversation.create({ userId: req.auth!.userId, subjectId, title: 'New conversation', expiresAt: expiry() }) });
});
tutorRouter.get('/conversations/:id/messages', async (req, res) => {
  const c = await own(req.auth!.userId, String(req.params.id));
  res.json({ conversation: c, items: await TutorMessage.find({ conversationId: c._id }).sort({ createdAt: 1 }).limit(200).lean() });
});
tutorRouter.delete('/conversations/:id', async (req, res) => {
  const c = await own(req.auth!.userId, String(req.params.id)); await TutorMessage.deleteMany({ conversationId: c._id }); await c.deleteOne(); res.status(204).end();
});
tutorRouter.post('/messages/:id/feedback', async (req, res) => {
  const b = z.object({ rating: z.enum(['up', 'down']), comment: z.string().max(500).optional() }).parse(req.body);
  const m = await TutorMessage.findOneAndUpdate({ _id: oid.safeParse(req.params.id).success ? req.params.id : null, userId: req.auth!.userId, role: 'assistant' }, { feedback: { ...b, at: new Date() } }, { returnDocument: 'after' });
  if (!m) throw notFound('Message not found'); res.json({ ok: true });
});

/** Streams the answer as Server-Sent Events: meta → delta* → done | error. */
tutorRouter.post('/conversations/:id/messages', async (req, res) => {
  const b = z.object({ content: z.string().trim().min(1).max(2000), mode: z.enum(['hint', 'explain', 'check']).default('hint') }).parse(req.body);
  const conv = await own(req.auth!.userId, String(req.params.id));
  const subjectId = String(conv.subjectId);
  if (!(await canAccessSubject(req.auth!, subjectId))) throw forbidden('You are no longer enrolled in this subject');
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  if ((await TutorMessage.countDocuments({ userId: req.auth!.userId, role: 'user', createdAt: { $gte: since } })) >= config.TUTOR_DAILY_MESSAGES_PER_USER) throw new AppError(429, 'TUTOR_LIMIT', 'You have reached today\'s tutor limit. Try again tomorrow.');
  const content = b.content.replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
  const flags = screenInput(content);
  const userMsg = await TutorMessage.create({ conversationId: conv._id, userId: req.auth!.userId, role: 'user', content, mode: b.mode, flags, expiresAt: expiry() });
  if (conv.title === 'New conversation') conv.title = content.slice(0, 60);
  conv.lastMessageAt = new Date(); conv.expiresAt = expiry(); await conv.save();

  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const finish = async (text: string, answerType: any, citations: any[], extra: string[] = [], model?: string) => {
    const m = await TutorMessage.create({ conversationId: conv._id, userId: req.auth!.userId, role: 'assistant', content: text, answerType, citations, aiModel: model, flags: extra, expiresAt: expiry() });
    send('done', { messageId: String(m._id), userMessageId: String(userMsg._id), answerType, text, citations }); res.end();
  };
  if (flags.includes('self_harm')) return finish(SAFETY_REPLY, 'refusal', [], ['safety_response']);
  if (!getLlm()) { send('error', { code: 'AI_UNAVAILABLE', message: 'The tutor is not available right now.' }); return res.end(); }
  try {
    const subject = await Subject.findById(subjectId).lean();
    const prof = await StudentProfile.findOne({ userId: req.auth!.userId }).lean();
    const level = prof ? await AcademicLevel.findById(prof.levelId).lean() : null;
    const passages = await retrieve(req.auth!, { subjectId, query: content, k: 6 });
    send('meta', { sources: passages.map((p, i) => ({ id: `S${i + 1}`, documentTitle: p.documentTitle, pageStart: p.pageStart, pageEnd: p.pageEnd, approvalStatus: p.approvalStatus })) });
    const history = (await TutorMessage.find({ conversationId: conv._id, _id: { $ne: userMsg._id } }).sort({ createdAt: -1 }).limit(8).lean()).reverse()
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 1500) }));
    let full = ''; let model: string | undefined; let ac = false;
    req.on('close', () => { ac = true; });
    for await (const ev of stream({ system: tutorSystem(subject?.name ?? 'this subject', `${level?.name ?? 'secondary school'}${prof ? ` Year ${prof.yearOfStudy}` : ''}`, b.mode),
      messages: [...history, { role: 'user', content: tutorUserTurn(content, passages) }], maxTokens: 1500, temperature: 0.3 }, { purpose: 'tutor', userId: req.auth!.userId, refId: String(conv._id) })) {
      if (ev.delta) { full += ev.delta; if (!ac) send('delta', { text: ev.delta }); }
      if (ev.done) model = ev.done.model;
    }
    const a = analyseAnswer(full, passages);
    await finish(a.text, a.answerType, a.used.map((p) => ({ chunkId: p.chunkId, documentId: p.documentId, pageStart: p.pageStart, pageEnd: p.pageEnd, quote: p.text.slice(0, 240) })), [...flags, ...a.flags], model);
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'tutor failed');
    const msg = e instanceof BudgetExceededError ? 'The tutor has reached its daily limit. Please try again tomorrow.' : e?.reason ? 'I can\'t help with that request. Let\'s get back to your studies.' : 'The tutor had a problem answering. Please try again.';
    await TutorMessage.create({ conversationId: conv._id, userId: req.auth!.userId, role: 'assistant', content: msg, answerType: 'error', flags: [String(e?.message ?? e).slice(0, 200)], expiresAt: expiry() });
    send('error', { code: e instanceof BudgetExceededError ? 'BUDGET' : 'TUTOR_FAILED', message: msg }); res.end();
  }
});
