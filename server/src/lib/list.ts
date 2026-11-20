import { z } from 'zod';
import type { Model } from 'mongoose';

/** Escapes user input for a literal, case-insensitive regex search. */
export const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Shared server-side list contract (spec §21): validated page / pageSize / sort / q.
 * `sort` is `field` or `-field` and must be in the allow-list; anything else is a 422.
 */
export function listQuery<S extends readonly [string, ...string[]]>(sortable: S, opts: { defaultSort?: string; maxPageSize?: number; defaultPageSize?: number } = {}) {
  const sortRx = new RegExp(`^-?(${sortable.map(escapeRx).join('|')})$`);
  return z.object({
    page: z.coerce.number().int().min(1).max(10_000).prefault(1),
    pageSize: z.coerce.number().int().min(1).max(opts.maxPageSize ?? 100).prefault(opts.defaultPageSize ?? 25),
    sort: z.string().regex(sortRx, `sort must be one of: ${sortable.join(', ')} (prefix - for descending)`).prefault(opts.defaultSort ?? `-${sortable[0]}`),
    q: z.string().trim().max(120).optional(),
  });
}
export type ListParams = { page: number; pageSize: number; sort: string; q?: string };
export const sortSpec = (s: string) => ({ [s.replace(/^-/, '')]: s.startsWith('-') ? -1 : 1 }) as Record<string, 1 | -1>;
/** Text search across fields: every whitespace-separated term must match one of them. */
export function searchFilter(q: string | undefined, fields: string[]) {
  const terms = (q ?? '').split(/\s+/).filter(Boolean).slice(0, 5);
  if (!terms.length) return {};
  return { $and: terms.map((t) => ({ $or: fields.map((f) => ({ [f]: { $regex: escapeRx(t), $options: 'i' } })) })) };
}
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number; pages: number }
export async function paginate<T = any>(model: Model<any>, filter: Record<string, unknown>, p: ListParams,
  shape: (q: any) => any = (q) => q): Promise<Page<T>> {
  const [items, total] = await Promise.all([
    shape(model.find(filter).sort({ ...sortSpec(p.sort), _id: -1 }).skip((p.page - 1) * p.pageSize).limit(p.pageSize)).lean(),
    model.countDocuments(filter),
  ]);
  return { items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}
