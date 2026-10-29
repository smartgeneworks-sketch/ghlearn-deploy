import mongoose from 'mongoose';
import { Announcement, Notification, User, StudentProfile } from '../models/index.js';
import { notify, flushEmails } from './notify.js';
import { registerJob, enqueue } from './queue.js';
import { AppError } from '../lib/errors.js';
/**
 * §18 announcements. A system announcement (Super Admin) reaches the chosen roles on the whole platform; a school
 * announcement reaches the chosen roles of one school. Optional level / year narrow the student part of the audience.
 * Delivery runs as a job at the publish time; each recipient gets one notification whose delivery status is recorded.
 */
export const SCHOOL_AUDIENCE_ROLES = ['student', 'teacher', 'counselor', 'parent', 'school_admin'] as const;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/; const PHONE = /(?:\+?233|\b0)[\s-]?[235]\d(?:[\s-]?\d){7}\b/;
/** Broad announcements must not carry learners' personal data: no email addresses, phone numbers or names of students. */
export async function privacyProblems(text: string) {
  const out: string[] = [];
  if (EMAIL.test(text)) out.push('Remove the email address: announcements go to many people.');
  if (PHONE.test(text)) out.push('Remove the phone number: announcements go to many people.');
  const runs = text.match(/\b[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+)+/g) ?? []; const set = new Set<string>();
  for (const r of runs) { const w = r.split(/\s+/); for (let i = 0; i + 1 < w.length; i++) { set.add(`${w[i]} ${w[i + 1]}`); if (i + 2 < w.length) set.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`); } }
  const cands = [...set].slice(0, 80);
  if (cands.length) {
    const rx = cands.map((c) => new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(\\s|$)`, 'i'));
    const hit = await User.findOne({ roles: 'student', fullName: { $in: rx } }).select('_id').lean();
    if (hit) out.push('The text contains the name of a student. Do not name individual learners in an announcement.');
  }
  return out;
}
export async function audienceIds(a: any): Promise<mongoose.Types.ObjectId[]> {
  const roles: string[] = a.audience?.roles ?? []; if (!roles.length) return [];
  const base: any = { status: 'active', ...(a.scope === 'school' ? { schoolId: a.schoolId } : {}) };
  const others = roles.filter((r) => r !== 'student');
  const ids: mongoose.Types.ObjectId[] = others.length ? await User.find({ ...base, roles: { $in: others } }).distinct('_id') : [];
  if (roles.includes('student')) {
    const students: mongoose.Types.ObjectId[] = await User.find({ ...base, roles: 'student' }).distinct('_id');
    const narrow = a.audience?.levelId || a.audience?.yearOfStudy;
    const keep = narrow ? new Set((await StudentProfile.find({ userId: { $in: students }, ...(a.audience.levelId ? { levelId: a.audience.levelId } : {}), ...(a.audience.yearOfStudy ? { yearOfStudy: a.audience.yearOfStudy } : {}) }).distinct('userId')).map(String)) : null;
    ids.push(...students.filter((s) => !keep || keep.has(String(s))));
  }
  return [...new Map(ids.map((i) => [String(i), i])).values()];
}
export async function deliveryStats(id: unknown) {
  const rows = await Notification.aggregate([{ $match: { announcementId: new mongoose.Types.ObjectId(String(id)) } }, { $group: { _id: { i: '$delivery.inApp', e: '$delivery.email', r: { $cond: [{ $ifNull: ['$readAt', false] }, 1, 0] } }, n: { $sum: 1 } } }]);
  const s = { recipients: 0, inApp: { delivered: 0, opted_out: 0, withdrawn: 0 } as Record<string, number>, read: 0, email: {} as Record<string, number> };
  for (const r of rows) { s.recipients += r.n; s.inApp[r._id.i ?? 'delivered'] = (s.inApp[r._id.i ?? 'delivered'] ?? 0) + r.n; if (r._id.r) s.read += r.n; const e = r._id.e ?? 'pending'; s.email[e] = (s.email[e] ?? 0) + r.n; }
  return s;
}
export const effectiveStatus = (a: any) => (a.status === 'published' && a.expiresAt && new Date(a.expiresAt) < new Date() ? 'expired' : a.status);

registerJob('announcement.publish', async ({ id }: { id: string }) => {
  const a = await Announcement.findById(id); if (!a) return { skipped: 'deleted' };
  if (!['scheduled', 'published'].includes(a.status)) return { skipped: a.status };
  if (await Notification.exists({ announcementId: a._id })) return { skipped: 'already delivered' }; // idempotent on retry
  if (a.expiresAt < new Date()) { a.status = 'expired'; await a.save(); return { skipped: 'expired before delivery' }; }
  const ids = await audienceIds(a);
  // Insert in batches so large audiences stay within memory on small instances.
  for (let i = 0; i < ids.length; i += 500) await notify(ids.slice(i, i + 500), { type: 'announcement', title: a.title, body: a.body, link: a.link ?? undefined, announcementId: a._id, visibleUntil: a.expiresAt, expiresAt: new Date(a.expiresAt.getTime() + 90 * 86400000), email: a.email, meta: { scope: a.scope } });
  await flushEmails();
  a.status = 'published'; a.delivery = { ...(await deliveryStats(a._id)), deliveredAt: new Date() } as any; await a.save();
  return { recipients: ids.length };
});
export async function schedule(a: any) {
  const delayMs = a.publishAt ? Math.max(0, new Date(a.publishAt).getTime() - Date.now()) : 0;
  const job = await enqueue('announcement.publish', { id: String(a._id) }, { maxAttempts: 3, delayMs, createdBy: String(a.publishedBy ?? a.createdBy) });
  return job;
}
export function assertEditable(a: any) { if (!['draft', 'scheduled'].includes(a.status)) throw new AppError(409, 'NOT_EDITABLE', `A ${effectiveStatus(a)} announcement cannot be changed; withdraw it and create a new one.`); }
