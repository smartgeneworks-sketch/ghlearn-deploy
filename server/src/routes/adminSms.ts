import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { SmsLog } from '../models/index.js';
import { authenticate, requirePermission } from '../middleware/index.js';
import { AppError, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { getSettings } from '../services/platformSettings.js';
import { normalizeGhPhone, maskPhone } from '../services/phone.js';
import { sendSms, smsAdapter, smsSender, sentToday, smsAvailable } from '../services/sms.js';
import { emailProvider, sendMail } from '../services/mailer.js';

/**
 * SMS status and tools (super admins: platform:manage). Settings (on/off, sender ID, daily cap) are saved through
 * PATCH /api/admin/settings { sms } and audited there. The API key is only ever an environment variable; nothing here
 * returns it, only whether it is present.
 */
export const adminSmsRouter = Router();
adminSmsRouter.use(authenticate, requirePermission('platform:manage'));
let cache: { at: number; key: string; v: any } | null = null;
export const clearSmsStatusCache = () => { cache = null; };

adminSmsRouter.get('/status', async (req, res) => {
  const a = smsAdapter(); const st = (await getSettings()).sms; const sender = await smsSender();
  const key = `${a?.name}:${sender}`; let live: any = null;
  if (a && (req.query.refresh === '1' || !cache || cache.key !== key || Date.now() - cache.at > 60_000)) {
    const [balance, senderStatus] = await Promise.all([a.balance(), sender ? a.senderStatus(sender) : Promise.resolve(null)]);
    live = { balance, senderStatus, checkedAt: new Date() }; cache = { at: Date.now(), key, v: live };
  } else live = cache?.v ?? null;
  res.set('Cache-Control', 'no-store').json({
    configured: !!a, provider: a?.name ?? null, keyPresent: !!config.BMS_API_KEY, available: await smsAvailable(),
    settings: st, senderId: sender || null, senderSource: st.senderId ? 'settings' : config.SMS_SENDER_ID ? 'environment' : 'none',
    sentToday: await sentToday(), dailyCap: st.dailyCap, live,
  });
});
adminSmsRouter.post('/test', async (req, res) => {
  const b = z.object({ phone: z.string().trim().min(9).max(30), message: z.string().trim().min(1).max(160).optional() }).strict().parse(req.body);
  const ph = normalizeGhPhone(b.phone); if (!ph) throw new AppError(422, 'VALIDATION', 'Enter a Ghana mobile number (MTN, Telecel or AirtelTigo)');
  const r = await sendSms({ to: ph.local, kind: 'test', by: req.auth!.userId, message: b.message ?? 'GH Learn SMS test' });
  audit(req, 'sms.test', undefined, { to: maskPhone(ph.local), network: ph.network, status: r.status }, { entityType: 'sms', outcome: r.status === 'sent' ? 'success' : 'failure' });
  res.json({ ...r, to: maskPhone(ph.local), network: ph.network });
});
adminSmsRouter.get('/log', async (req, res) => {
  const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), status: z.string().max(20).optional() }).parse(req.query);
  const items = await SmsLog.find((q.status ? { status: q.status } : {}) as any).sort({ createdAt: -1 }).limit(q.limit).populate('userId', 'fullName').populate('by', 'fullName').lean();
  res.set('Cache-Control', 'no-store').json({ items });
});
/** Fetches the provider's delivery report for one logged send (there is no SMS delivery webhook in the v2 API). */
adminSmsRouter.post('/log/:id/delivery', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Not found');
  const l = await SmsLog.findById(req.params.id); if (!l) throw notFound('Not found');
  if (!l.campaignId) throw new AppError(409, 'CONFLICT', 'This message has no provider id to check');
  const a = smsAdapter(); if (!a) throw new AppError(503, 'SMS_UNAVAILABLE', 'SMS is not configured');
  const r = await a.report(l.campaignId); if (!r.ok) throw new AppError(502, 'SMS_PROVIDER', r.error);
  l.delivery = r.statuses[0] ?? 'unknown'; l.deliveryCheckedAt = new Date(); await l.save(); res.json({ log: l });
});
/** Submits a sender ID for approval by the provider (BMS/mNotify review it; usually a few working days). */
adminSmsRouter.post('/sender/register', async (req, res) => {
  const b = z.object({ name: z.string().trim().regex(/^[A-Za-z0-9 ]{3,11}$/, '3 to 11 letters, digits or spaces'), purpose: z.string().trim().min(10).max(300) }).strict().parse(req.body);
  const a = smsAdapter(); if (!a) throw new AppError(503, 'SMS_UNAVAILABLE', 'SMS is not configured');
  const r = await a.registerSender(b.name, b.purpose); clearSmsStatusCache();
  audit(req, 'sms.sender.register', b.name, { status: r.ok ? r.status : 'error', error: r.ok ? undefined : r.error }, { entityType: 'sms', outcome: r.ok ? 'success' : 'failure' });
  if (!r.ok) throw new AppError(502, 'SMS_PROVIDER', r.error); res.json(r);
});

/**
 * Email test send (super admins), mounted at /api/admin/email. One message to an address the admin types; audited with the
 * provider's message id. The provider key is never returned.
 */
export const adminEmailRouter = Router();
adminEmailRouter.use(authenticate, requirePermission('platform:manage'));
const maskEmail = (e: string) => e.replace(/^(.)(.*?)(.)?@/, (_m, a, _b, c) => `${a}***${c ?? ''}@`);
adminEmailRouter.get('/status', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ configured: !!emailProvider(), provider: emailProvider(), from: config.EMAIL_FROM ?? null });
});
adminEmailRouter.post('/test', async (req, res) => {
  const b = z.object({ to: z.email().max(254) }).strict().parse(req.body);
  if (!emailProvider()) throw new AppError(503, 'EMAIL_UNAVAILABLE', 'Email is not configured on the server');
  const r = await sendMail({ to: b.to, subject: 'GH Learn test email', text: 'This is a test email from GH Learn (System settings). If you received it, email delivery works.\n\nGH Learn' });
  audit(req, 'email.test', undefined, { to: maskEmail(b.to), provider: emailProvider(), status: r.status, ...(r.status === 'sent' && r.messageId ? { messageId: r.messageId } : {}), ...(r.status === 'failed' ? { error: r.error } : {}) },
    { entityType: 'email', outcome: r.status === 'sent' ? 'success' : 'failure' });
  res.json({ ...r, to: maskEmail(b.to), provider: emailProvider() });
});
