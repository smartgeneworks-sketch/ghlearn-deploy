import { z } from 'zod';

/**
 * Admin → Public Website → Pages: help articles and legal drafts. Drafts are never public. Published help
 * articles appear in the Help Centre. Legal pages stay drafts here; the live terms and privacy notice are
 * published (and versioned) in System Settings → Legal once the owner and a lawyer have approved the text.
 */
export const PAGE_KINDS = ['help', 'legal'] as const;
export const PAGE_STATUSES = ['draft', 'published', 'archived'] as const;
export const PAGE_AUDIENCES = ['everyone', 'students', 'teachers', 'school_admins'] as const;
export const PAGE_AUDIENCE_LABELS: Record<(typeof PAGE_AUDIENCES)[number], string> = { everyone: 'Everyone', students: 'Students', teachers: 'Teachers', school_admins: 'School admins' };
export const pageInputSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and hyphens').min(2).max(80),
  title: z.string().trim().min(3).max(140),
  kind: z.enum(PAGE_KINDS),
  audience: z.enum(PAGE_AUDIENCES).default('everyone'),
  summary: z.string().trim().max(300).default(''),
  body: z.string().max(60_000),
  order: z.number().int().min(0).max(999).default(100),
  reviewNote: z.string().trim().max(300).default(''),
}).strict();
export type PageInput = z.infer<typeof pageInputSchema>;
export const pageUpdateSchema = pageInputSchema.partial().strict();
