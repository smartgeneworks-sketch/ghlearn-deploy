import type { ZodObject } from 'zod';
/**
 * Parses a partial update. Zod's .partial() still fills in .default() values, which would silently reset fields
 * the caller never sent (e.g. reactivating a subject); only keys present in the request body are kept.
 */
export function parsePatch<T extends ZodObject<any>>(schema: T, body: unknown, strict = false): Record<string, any> {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const p = schema.partial(); const out = (strict ? p.strict() : p).parse(raw) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(out).filter(([k]) => k in raw));
}
