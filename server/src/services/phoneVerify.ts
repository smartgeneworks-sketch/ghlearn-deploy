import crypto from 'node:crypto';
import type { Request } from 'express';
import { PhoneOtp, User } from '../models/index.js';
import { config } from '../config.js';
import { AppError, conflict } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { maskPhone, normalizeGhPhone } from './phone.js';
import { sendSms, smsAvailable } from './sms.js';

/**
 * Phone verification by SMS (6-digit code). The code is stored only as an HMAC keyed with a server secret (a bare SHA-256 of
 * six digits could be reversed by brute force). 10-minute life, 5 attempts, single use. Limits: 3 codes per user per hour,
 * 3 per number per hour (any account), plus the per-IP limiter on the route.
 */
export const OTP_MINUTES = 10; export const OTP_ATTEMPTS = 5;
export const OTP_LIMITS = { perUserPerHour: 3, perNumberPerHour: 3 };
const mac = (userId: string, phone: string, code: string) => crypto.createHmac('sha256', config.JWT_ACCESS_SECRET).update(`phone-otp:${userId}:${phone}:${code}`).digest('hex');
const live = () => ({ usedAt: null, invalidatedAt: null, expiresAt: { $gt: new Date() } });
const hourAgo = () => new Date(Date.now() - 3600_000);

export async function startPhoneVerification(req: Request, userId: string, raw: string) {
  const ph = normalizeGhPhone(raw); if (!ph) throw new AppError(422, 'VALIDATION', 'Enter a Ghana mobile number, e.g. 024 123 4567 (MTN, Telecel or AirtelTigo)');
  if (!(await smsAvailable())) throw new AppError(503, 'SMS_UNAVAILABLE', 'SMS is not available on GH Learn yet, so phone numbers cannot be verified right now.');
  const u = await User.findById(userId).select('phone phoneVerifiedAt').lean();
  if (u?.phone === ph.local && u.phoneVerifiedAt) throw conflict('This number is already verified on your account');
  if (await User.exists({ _id: { $ne: userId }, phone: ph.local, phoneVerifiedAt: { $type: 'date' } })) throw conflict('This number is already verified on another account. Remove it there first, or use a different number.');
  const [byUser, byNumber] = await Promise.all([PhoneOtp.countDocuments({ userId, createdAt: { $gt: hourAgo() } }), PhoneOtp.countDocuments({ phone: ph.local, createdAt: { $gt: hourAgo() } })]);
  if (byUser >= OTP_LIMITS.perUserPerHour || byNumber >= OTP_LIMITS.perNumberPerHour) {
    audit(req, 'user.phone.otp', userId, { to: maskPhone(ph.local), reason: 'rate_limited' }, { entityType: 'user', outcome: 'denied' });
    throw new AppError(429, 'RATE_LIMITED', 'Too many codes requested. Wait an hour and try again.');
  }
  await PhoneOtp.updateMany({ userId, ...live() }, { invalidatedAt: new Date() });
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const otp = await PhoneOtp.create({ userId, phone: ph.local, codeHash: mac(userId, ph.local, code), ip: req.ip, expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000) });
  const r = await sendSms({ to: ph.local, kind: 'otp', userId, ref: String(otp._id), message: `GH Learn code: ${code}. Use it to verify your phone number. It expires in ${OTP_MINUTES} minutes. Do not share it.` });
  audit(req, 'user.phone.otp', userId, { to: maskPhone(ph.local), network: ph.network, delivery: r.status }, { entityType: 'user', outcome: r.status === 'sent' ? 'success' : 'failure' });
  if (r.status !== 'sent') {
    await PhoneOtp.updateOne({ _id: otp._id }, { invalidatedAt: new Date() });
    if (r.status === 'cap_reached') throw new AppError(503, 'SMS_UNAVAILABLE', "Today's SMS limit has been reached. Try again tomorrow.");
    throw new AppError(502, 'SMS_FAILED', 'The code could not be sent by SMS. Check the number and try again later.');
  }
  return { phoneMasked: maskPhone(ph.local), network: ph.network, expiresAt: otp.expiresAt };
}
export async function confirmPhone(req: Request, userId: string, code: string) {
  if (!/^\d{6}$/.test(code)) throw new AppError(422, 'VALIDATION', 'Enter the 6-digit code');
  const otp = await PhoneOtp.findOne({ userId, ...live() }).select('+codeHash').sort({ createdAt: -1 });
  if (!otp) throw new AppError(400, 'OTP_INVALID', 'This code has expired or was replaced. Request a new code.');
  const a = Buffer.from(otp.codeHash, 'hex'), b = Buffer.from(mac(userId, otp.phone, code), 'hex');
  if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) {
    const n = (await PhoneOtp.findOneAndUpdate({ _id: otp._id }, { $inc: { attempts: 1 } }, { new: true }))!.attempts;
    if (n >= OTP_ATTEMPTS) await PhoneOtp.updateOne({ _id: otp._id }, { invalidatedAt: new Date() });
    audit(req, 'user.phone.verify', userId, { to: maskPhone(otp.phone), reason: 'wrong_code', attempt: n }, { entityType: 'user', outcome: 'failure' });
    throw new AppError(400, 'OTP_INVALID', n >= OTP_ATTEMPTS ? 'Too many wrong codes. Request a new code.' : `That code is not right. ${OTP_ATTEMPTS - n} ${OTP_ATTEMPTS - n === 1 ? 'try' : 'tries'} left.`);
  }
  const claimed = await PhoneOtp.findOneAndUpdate({ _id: otp._id, usedAt: null }, { usedAt: new Date() }); if (!claimed) throw new AppError(400, 'OTP_INVALID', 'This code was already used.');
  try { await User.updateOne({ _id: userId }, { phone: otp.phone, phoneVerifiedAt: new Date() }); }
  catch (e: any) { if (e?.code === 11000) throw conflict('This number was just verified on another account.'); throw e; }
  audit(req, 'user.phone.verify', userId, { to: maskPhone(otp.phone) }, { entityType: 'user' });
  return { phone: otp.phone, verified: true };
}
