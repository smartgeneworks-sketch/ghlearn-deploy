import { getSettings } from './platformSettings.js';
import { Lesson, Question, GameDesign, User, Notification, TeacherAssignment, ClassGroup, Job } from '../models/index.js';
import { notify, notifyRoles } from './notify.js';
import { registerJob, enqueue } from './queue.js';
/**
 * §18 event notifications: publication, processing failures, review reminders and account/security alerts.
 * All go through notify(), so preferences and delivery status apply (security is always shown in the app).
 */
export const today = () => new Date().toISOString().slice(0, 10);

/** Published content: tell the author (unless they published it) and, for lessons, the teachers of that subject. */
export async function notifyPublished(kind: 'lesson' | 'question' | 'game', item: any, publisherId: string, resourceId?: string) {
  const label = kind === 'lesson' ? 'Lesson' : kind === 'question' ? 'Question' : 'Game'; const title = item.title ?? (item.stem ? String(item.stem).slice(0, 80) : label);
  const authorLink = kind === 'lesson' ? `/admin/lessons/${item._id}` : kind === 'question' ? `/admin/questions/${item._id}` : `/admin/games/${item._id}`;
  if (item.createdBy && String(item.createdBy) !== publisherId) await notify([item.createdBy], { type: 'content.published', title: `${label} published: ${title}`, link: authorLink, meta: { kind, id: String(item._id) } });
  if (kind === 'lesson' && resourceId) {
    const teachers = [...(await TeacherAssignment.find({ subjectId: item.subjectId }).distinct('teacherId')), ...(await ClassGroup.find({ subjectId: item.subjectId, archived: false }).distinct('teacherIds'))];
    await notify(teachers.filter((t) => String(t) !== publisherId), { type: 'content.published', title: `New lesson for your subject: ${title}`, link: `/learn/${item.subjectId}/r/${resourceId}`, meta: { kind, id: String(item._id) } });
  }
}
/** Dead processing job: the uploader already hears from the queue; curriculum admins and operators get an alert. */
export async function notifyProcessingFailed(job: any, message: string) {
  const docId = job.payload?.documentId ?? job.documentId;
  await notifyRoles(['curriculum_admin'], { type: 'processing.failed', title: 'Manual processing failed', body: message.slice(0, 300), link: docId ? `/admin/documents/${docId}` : '/admin/processing', meta: { jobId: String(job._id) } });
  await notifyRoles(['system_operator'], { type: 'processing.failed', title: `Job failed: ${job.type}`, body: message.slice(0, 300), link: `/admin/processing/${job._id}`, meta: { jobId: String(job._id) } });
}
/** Account and security alerts to the account owner. */
export const notifySecurity = (userId: unknown, type: 'security.lockout' | 'security.password' | 'security.roles' | 'security.sessions', title: string, body?: string) =>
  notify([userId], { type, title, body, link: '/notifications' });

/** Reviewers hear about items waiting longer than the review-policy threshold (24 h by default): assigned items go to the assignee, the rest to all Content Reviewers (Super Admins if there are none). Once per reviewer per day. */
export async function sendReviewReminders(o: { force?: boolean } = {}) {
  const rv = (await getSettings()).review; // §20 review policy: reminders can be switched off and their threshold changed
  if (!rv.remindersEnabled && !o.force) return { skipped: 'Review reminders are switched off in System settings', waiting: null, notified: 0 };
  const REMINDER_AFTER_H = rv.reminderAfterHours;
  const cutoff = new Date(Date.now() - REMINDER_AFTER_H * 3600_000); const waiting = { submittedAt: { $lt: cutoff } };
  const [lessons, questions, games] = await Promise.all([
    Lesson.find({ status: { $in: ['in_review', 'resubmitted'] }, ...waiting }).select('assignedReviewerId').lean(),
    Question.countDocuments({ status: { $in: ['in_review', 'resubmitted'] }, ...waiting }), GameDesign.countDocuments({ status: { $in: ['in_review', 'resubmitted'] }, ...waiting })]);
  const perReviewer = new Map<string, number>(); let unassigned = questions + games;
  for (const l of lessons) { if (l.assignedReviewerId) perReviewer.set(String(l.assignedReviewerId), (perReviewer.get(String(l.assignedReviewerId)) ?? 0) + 1); else unassigned++; }
  if (unassigned) {
    let pool = await User.find({ roles: 'content_reviewer', status: 'active' }).distinct('_id'); if (!pool.length) pool = await User.find({ roles: 'super_admin', status: 'active' }).distinct('_id');
    for (const r of pool) perReviewer.set(String(r), (perReviewer.get(String(r)) ?? 0) + unassigned);
  }
  let notified = 0;
  for (const [userId, n] of perReviewer) {
    if (!o.force && (await Notification.exists({ userId, type: 'review.reminder', 'meta.day': today() }))) continue;
    notified += await notify([userId], { type: 'review.reminder', title: `${n} item${n === 1 ? '' : 's'} waiting for review over ${REMINDER_AFTER_H} hours`, body: 'Open the review queues: lessons in Content Review and Publishing, questions and games in their review queues.', link: '/admin/review', meta: { day: today(), waiting: n } });
  }
  return { waiting: { lessons: lessons.length, questions, games }, notified };
}
const next8am = () => { const d = new Date(); d.setUTCHours(8, 0, 0, 0); if (d <= new Date()) d.setUTCDate(d.getUTCDate() + 1); return d; };
registerJob('review.reminders', async () => { const r = await sendReviewReminders(); await enqueue('review.reminders', {}, { maxAttempts: 2, delayMs: next8am().getTime() - Date.now() }); return r; });
/** Keeps exactly one future daily reminder job queued (called when the worker starts). */
export async function ensureRecurringJobs() {
  if (!(await Job.exists({ type: 'review.reminders', status: { $in: ['queued', 'running'] } }))) await enqueue('review.reminders', {}, { maxAttempts: 2, delayMs: next8am().getTime() - Date.now() });
}
