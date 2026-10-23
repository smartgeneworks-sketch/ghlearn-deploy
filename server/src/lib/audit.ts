import type { Request } from 'express';
import { AuditLog } from '../models/index.js';

/** Keys whose values are never written to the audit log (spec §19: no passwords, tokens or keys). */
const SENSITIVE = /pass(word)?|secret|token|api[-_]?key|^key$|hash|cookie|authori[sz]ation|credential|otp|refresh/i;
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 6 || v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => redact(x, depth + 1));
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (typeof (v as any).toHexString === 'function') return String(v);
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as object)) o[k] = SENSITIVE.test(k) ? '[redacted]' : redact(x, depth + 1);
    return o;
  }
  return typeof v === 'string' && v.length > 2000 ? v.slice(0, 2000) + '…' : v;
}
const norm = (v: unknown) => JSON.stringify(v instanceof Date ? v.toISOString() : v ?? null);
/** Only the changed keys of two plain objects, as { before, after } (both redacted). */
export function diff(before: Record<string, any> | null | undefined, after: Record<string, any> | null | undefined, keys?: string[]) {
  const b = before ?? {}, a = after ?? {};
  const ks = keys ?? [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !['_id', '__v', 'createdAt', 'updatedAt'].includes(k));
  const B: Record<string, unknown> = {}, A: Record<string, unknown> = {};
  for (const k of ks) if (norm(b[k]) !== norm(a[k])) { B[k] = b[k]; A[k] = a[k]; }
  return { before: redact(B) as Record<string, unknown>, after: redact(A) as Record<string, unknown> };
}
export interface AuditExtra { entityType?: string; outcome?: 'success' | 'failure' | 'denied'; before?: unknown; after?: unknown; actorId?: string; schoolId?: string }
/** Fire-and-forget audit write; never throws into the request. */
export const audit = (req: Request, action: string, target?: string, meta?: unknown, x: AuditExtra = {}) =>
  AuditLog.create({
    actorId: x.actorId ?? req.auth?.userId, action, target, meta: redact(meta), ip: req.ip, requestId: req.id,
    entityType: x.entityType ?? action.split('.')[0], outcome: x.outcome ?? 'success', schoolId: x.schoolId ?? req.auth?.schoolId,
    before: redact(x.before), after: redact(x.after),
  }).catch(() => undefined);
