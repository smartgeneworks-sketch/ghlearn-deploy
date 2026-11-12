/**
 * Double-submit CSRF protection, built for cross-site cookies (Firebase Hosting → Render, SameSite=None; Secure).
 * GET /api/auth/csrf sets an httpOnly `gl_csrf` cookie and returns the same random token in the JSON body.
 * The SPA keeps it in memory and sends `X-CSRF-Token` on every unsafe request; the server requires header === cookie.
 * Because the frontend runs on another origin it cannot read the API's cookies, so the token is delivered in the
 * body; only CORS-allowed origins can read that response. An Origin allow-list check runs as defence in depth.
 */
import type { RequestHandler, Response } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_COOKIE = 'gl_csrf';
export function issueCsrf(res: Response) {
  const token = crypto.randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: config.COOKIE_SAMESITE, ...(config.cookieDomain ? { domain: config.cookieDomain } : {}), path: '/', maxAge: config.REFRESH_TTL_DAYS * 864e5 });
  return token;
}
const eq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const csrfProtect: RequestHandler = (req, _res, next) => {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !config.corsOrigins.includes(origin)) return next(new AppError(403, 'CSRF_ORIGIN', 'Origin not allowed'));
  const cookie = req.cookies?.[CSRF_COOKIE]; const header = req.get('x-csrf-token');
  if (!cookie || !header || !eq(String(cookie), String(header))) return next(new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token. Refresh and try again.'));
  next();
};
