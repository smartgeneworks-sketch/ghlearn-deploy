import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { ErrorEvent } from '../models/errorEvent.js';
import { logger } from '../lib/logger.js';

/** Strip credentials and tokens that can appear in error text (connection strings, bearer tokens, key=value secrets, long hex/base64 runs). */
export function scrub(s: string) {
  return s.replace(/\b(mongodb(?:\+srv)?|postgres(?:ql)?|redis|amqps?|https?):\/\/[^\s/@]+@/gi, '$1://***@')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***')
    .replace(/\b(api[_-]?key|key|token|secret|password|passwd|pwd|auth|signature|sig)=([^&\s"']+)/gi, '$1=***')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '***');
}
/** Route shape without ids or query strings, so the same error on different records is grouped. */
export const routeShape = (p: string) => p.split('?')[0].replace(/\/[a-f0-9]{24}(?=\/|$)/gi, '/:id').replace(/\/\d+(?=\/|$)/g, '/:n').slice(0, 200);

export async function recordError(o: { kind: 'http' | 'process'; err: unknown; method?: string; path?: string; status?: number; requestId?: string }) {
  try {
    if (mongoose.connection.readyState !== 1) return;
    const e = o.err instanceof Error ? o.err : new Error(String(o.err));
    const message = scrub(String(e.message ?? '')).slice(0, 400); const path = o.path ? routeShape(o.path) : undefined;
    const stack = scrub((e.stack ?? '').split('\n').slice(1, 7).map((l) => l.trim()).join('\n')).slice(0, 1500);
    const fingerprint = crypto.createHash('sha1').update([o.kind, o.method, path, e.name, message.replace(/\d+/g, 'N')].join('|')).digest('hex');
    const write = () => ErrorEvent.updateOne({ fingerprint }, { $inc: { count: 1 }, $set: { lastAt: new Date(), requestId: o.requestId, status: o.status, commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) },
      $setOnInsert: { fingerprint, kind: o.kind, method: o.method, path, name: e.name, message, stack, firstAt: new Date() } }, { upsert: true });
    await write().catch((x: any) => (x?.code === 11000 ? write() : Promise.reject(x))); // two first-time inserts can race
  } catch (x) { logger.warn({ err: x }, 'could not record error event'); }
}
export const recentErrors = (limit = 20) => ErrorEvent.find().sort({ lastAt: -1 }).limit(limit).select('-_id -__v -fingerprint').lean();
