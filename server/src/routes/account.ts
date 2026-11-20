import { Router } from 'express';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { z } from 'zod';
import { User, PhoneOtp } from '../models/index.js';
import { authenticate } from '../middleware/index.js';
import { AppError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { maskPhone } from '../services/phone.js';
import { smsAvailable } from '../services/sms.js';
import { startPhoneVerification, confirmPhone } from '../services/phoneVerify.js';

/** Own account: phone number (verified by SMS code). */
export const accountRouter = Router();
accountRouter.use(authenticate);
export const PHONE_IP_LIMIT = { n: config.NODE_ENV === 'test' ? 1000 : 10 };
export const phoneStore = new MemoryStore();
const phoneLimiter = rateLimit({ windowMs: 15 * 60_000, store: phoneStore, limit: () => PHONE_IP_LIMIT.n, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_q, _r, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many attempts, try again later')) });

accountRouter.get('/phone', async (req, res) => {
  const u = await User.findById(req.auth!.userId).select('phone phoneVerifiedAt').lean();
  const p = await PhoneOtp.findOne({ userId: req.auth!.userId, usedAt: null, invalidatedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).lean();
  res.set('Cache-Control', 'no-store').json({ phone: u?.phoneVerifiedAt ? u.phone : null, verifiedAt: u?.phoneVerifiedAt ?? null, unverifiedPhone: !u?.phoneVerifiedAt && u?.phone ? u.phone : null, smsAvailable: await smsAvailable(),
    pending: p ? { phoneMasked: maskPhone(p.phone), expiresAt: p.expiresAt } : null });
});
accountRouter.post('/phone', phoneLimiter, async (req, res) => {
  const b = z.object({ phone: z.string().trim().min(9).max(30) }).strict().parse(req.body);
  res.json(await startPhoneVerification(req, req.auth!.userId, b.phone));
});
accountRouter.post('/phone/verify', phoneLimiter, async (req, res) => {
  const b = z.object({ code: z.string().trim().min(1).max(10) }).strict().parse(req.body);
  res.json(await confirmPhone(req, req.auth!.userId, b.code));
});
accountRouter.delete('/phone', async (req, res) => {
  const u = await User.findById(req.auth!.userId).select('phone').lean();
  await User.updateOne({ _id: req.auth!.userId }, { $unset: { phone: 1, phoneVerifiedAt: 1 } });
  await PhoneOtp.updateMany({ userId: req.auth!.userId, usedAt: null, invalidatedAt: null }, { invalidatedAt: new Date() });
  audit(req, 'user.phone.remove', req.auth!.userId, { to: maskPhone(u?.phone) }, { entityType: 'user' }); res.status(204).end();
});
