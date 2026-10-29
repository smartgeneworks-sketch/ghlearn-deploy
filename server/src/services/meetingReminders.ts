import { Job, Meeting } from '../models/index.js';
import { registerJob, enqueue } from './queue.js';
import { notify } from './notify.js';
import { logger } from '../lib/logger.js';

/**
 * Meeting reminders: every 15 minutes, confirmed meetings starting within the next hour get one reminder to both people
 * (in the app, plus SMS for those who opted in and verified a number). Each meeting is claimed atomically through
 * reminderSentAt, so overlapping runs never send twice; rescheduling clears reminderSentAt.
 */
export const REMINDER_LEAD_MIN = 60; export const REMINDER_EVERY_MIN = 15;
const ghTime = (d: Date) => d.toISOString().slice(11, 16); // Ghana uses GMT (UTC+0) all year
const ghDay = (d: Date) => d.toISOString().slice(0, 10);
export async function sendDueReminders(now = new Date()) {
  const due = await Meeting.find({ status: 'confirmed', active: true, reminderSentAt: null, start: { $gt: now, $lte: new Date(now.getTime() + REMINDER_LEAD_MIN * 60_000) } }).select('_id').limit(500).lean();
  let sent = 0;
  for (const { _id } of due) {
    const m = await Meeting.findOneAndUpdate({ _id, reminderSentAt: null, status: 'confirmed' }, { reminderSentAt: new Date() }, { new: true }).populate('hostId', 'fullName').populate('studentId', 'fullName').lean() as any;
    if (!m) continue;
    const where = m.mode === 'online' ? 'online (link in GH Learn)' : m.location ? `at ${m.location}` : 'in person';
    const mins = Math.max(1, Math.round((new Date(m.start).getTime() - now.getTime()) / 60_000));
    const body = (other: string) => `With ${other} at ${ghTime(new Date(m.start))} GMT (${ghDay(new Date(m.start))}), ${where}. Starts in about ${mins} min.`;
    await notify([m.studentId?._id], { type: 'meeting.reminder', title: `Meeting reminder: ${m.topic}`, body: body(m.hostId?.fullName ?? 'your teacher'), link: '/meetings', meta: { meetingId: String(m._id) } });
    await notify([m.hostId?._id], { type: 'meeting.reminder', title: `Meeting reminder: ${m.topic}`, body: body(m.studentId?.fullName ?? 'your student'), link: '/meetings', meta: { meetingId: String(m._id) } });
    sent++;
  }
  return { due: due.length, reminded: sent };
}
registerJob('meeting.reminders', async () => {
  // Never throws: a retry would fork a second self-rescheduling chain.
  let r: unknown; try { r = await sendDueReminders(); } catch (e) { logger.warn({ e }, 'meeting reminders failed'); r = { error: String((e as Error)?.message ?? e) }; }
  { await enqueue('meeting.reminders', {}, { maxAttempts: 2, delayMs: REMINDER_EVERY_MIN * 60_000 }).catch((e) => logger.warn({ e }, 'reminder reschedule')); }
  return r;
});
export async function ensureReminderJob() {
  if (!(await Job.exists({ type: 'meeting.reminders', status: { $in: ['queued', 'running'] } }))) await enqueue('meeting.reminders', {}, { maxAttempts: 2, delayMs: 60_000 });
}
