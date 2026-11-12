import { getSettings } from './platformSettings.js';
import { Notification, User, NotificationPreference, categoryOf, NOTIFICATION_CATEGORIES, type NotificationCategory } from '../models/index.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import { emailConfigured, sendEmail } from './mailer.js';
import { sendSms, smsText } from './sms.js';
/**
 * In-app notifications plus optional email (§18). Each recipient's preferences decide the channels; security alerts are
 * always delivered in the app. Delivery status is recorded on every notification (in app: delivered / opted out; email:
 * sent / failed / not configured / opted out / no address / not requested). Never throws into the caller.
 */
export type N = { type: string; title: string; body?: string; link?: string; meta?: unknown; announcementId?: unknown; visibleUntil?: Date; expiresAt?: Date;
  /** true = the sender asks for email too (announcements); undefined = follow the recipient's email preference. */ email?: boolean };
export type Prefs = Record<NotificationCategory, { inApp: boolean; email: boolean; sms: boolean }>;
/** Categories that can go out by SMS (opt-in, verified numbers only). SMS costs money, so it is kept to time-sensitive meeting news. */
export const SMS_CATEGORIES: NotificationCategory[] = ['meetings' as NotificationCategory];
/** Within those categories, the events that are worth a text: request, accept, decline, reschedule and the 1-hour reminder. */
export const SMS_TYPES = ['meeting.requested', 'meeting.accept', 'meeting.decline', 'meeting.reschedule', 'meeting.reminder'];
export const MANDATORY: NotificationCategory[] = ['security'];
export const DEFAULT_PREFS = (): Prefs => Object.fromEntries(Object.keys(NOTIFICATION_CATEGORIES).map((k) => [k, { inApp: true, email: k === 'security' || k === 'announcements', sms: false }])) as Prefs;
export async function prefsOf(userIds: string[]) {
  const rows = await NotificationPreference.find({ userId: { $in: userIds } }).lean();
  const by = new Map(rows.map((r) => [String(r.userId), r.categories as Partial<Prefs>]));
  return (id: string): Prefs => { const d = DEFAULT_PREFS(); const p = by.get(id) ?? {}; for (const k of Object.keys(d) as NotificationCategory[]) d[k] = { ...d[k], ...(p[k] ?? {}) }; for (const k of MANDATORY) d[k].inApp = true; return d; };
}
const webUrl = () => config.appUrl ?? config.corsOrigins.find((o) => o.startsWith('https://')) ?? config.corsOrigins[0] ?? '';
export async function notify(userIds: unknown[], n: N) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))]; if (!ids.length) return 0;
  try {
    const category = categoryOf(n.type); const pref = await prefsOf(ids); const emailOn = (await getSettings()).notifications.emailEnabled; const mail = emailConfigured();
    const { email: wantEmail, ...rest } = n;
    const docs = ids.map((userId) => {
      const p = pref(userId)[category];
      const email = wantEmail === false ? 'not_requested' : !p.email ? (wantEmail ? 'opted_out' : 'not_requested') : !emailOn ? 'disabled' : mail ? 'pending' : 'not_configured';
      const sms = !SMS_CATEGORIES.includes(category) || !SMS_TYPES.includes(n.type) ? undefined : p.sms ? 'pending' : 'opted_out';
      return { userId, ...rest, category, delivery: { inApp: p.inApp ? 'delivered' : 'opted_out', email, ...(sms ? { sms } : {}) } };
    });
    const created = await Notification.insertMany(docs.map((d) => ({ ...d, delivery: { ...d.delivery, email: d.delivery.email === 'pending' ? undefined : d.delivery.email, sms: (d.delivery as any).sms === 'pending' ? undefined : (d.delivery as any).sms } })));
    const toMail = created.filter((_, i) => docs[i].delivery.email === 'pending');
    if (toMail.length) { const p = deliverEmails(toMail.map((c) => ({ id: String(c._id), userId: String(c.userId) })), n).catch((e) => logger.warn({ e }, 'email delivery')).finally(() => pending.delete(p)); pending.add(p); }
    const toSms = created.filter((_, i) => (docs[i].delivery as any).sms === 'pending');
    if (toSms.length) { const p = deliverSms(toSms.map((c) => ({ id: String(c._id), userId: String(c.userId) })), n).catch((e) => logger.warn({ e }, 'sms delivery')).finally(() => pending.delete(p)); pending.add(p); }
    return ids.length;
  } catch (e) { logger.warn({ err: e, type: n.type }, 'notify failed'); return 0; }
}
const pending = new Set<Promise<unknown>>();
/** Waits for queued email deliveries (tests, and the announcement job so its delivery counts are final). */
export const flushEmails = async () => { while (pending.size) await Promise.all([...pending]); };
async function deliverEmails(items: { id: string; userId: string }[], n: N) {
  const users = new Map((await User.find({ _id: { $in: items.map((i) => i.userId) } }).select('email status').lean()).map((u) => [String(u._id), u]));
  for (const it of items) {
    const u = users.get(it.userId); const r = !u?.email || u.status !== 'active' ? { status: 'no_address' as const } : await sendEmail(u.email, n.title, `${n.title}\n\n${n.body ?? ''}${n.link ? `\n\nOpen: ${webUrl()}${n.link}` : ''}\n\nYou can change which emails you get under Notifications > Preferences.`);
    await Notification.updateOne({ _id: it.id }, { 'delivery.email': r.status, 'delivery.emailAt': new Date(), ...('error' in r ? { 'delivery.emailError': r.error } : {}) });
  }
}
/** "GH Learn: <title>. <body>" cut to one 160-character SMS. Links are left out (they cost characters and invite phishing look-alikes). */
export const smsNotificationText = (n: { title: string; body?: string }) => smsText(`GH Learn: ${n.title.replace(/[.\s]+$/, '')}.${n.body ? ` ${n.body}` : ''}`, 160);
async function deliverSms(items: { id: string; userId: string }[], n: N) {
  const users = new Map((await User.find({ _id: { $in: items.map((i) => i.userId) } }).select('phone phoneVerifiedAt status').lean()).map((u) => [String(u._id), u]));
  for (const it of items) {
    const u = users.get(it.userId);
    const st = !u?.phone || !u.phoneVerifiedAt || u.status !== 'active' ? 'no_number' : (await sendSms({ to: u.phone, kind: 'notification', userId: it.userId, ref: it.id, message: smsNotificationText(n) })).status;
    await Notification.updateOne({ _id: it.id }, { 'delivery.sms': st === 'no_sender' ? 'not_configured' : st === 'invalid_number' ? 'failed' : st, 'delivery.smsAt': new Date() });
  }
}
export async function notifyRoles(roles: string[], n: N, filter: Record<string, unknown> = {}) {
  return notify(await User.find({ roles: { $in: roles as any }, status: 'active', ...filter } as any).distinct('_id'), n);
}
/** What a user sees in their inbox: delivered in the app, not withdrawn, still within the announcement period. */
export const inboxFilter = (userId: string): any => ({ userId, 'delivery.inApp': { $nin: ['opted_out', 'withdrawn'] }, $or: [{ visibleUntil: null }, { visibleUntil: { $gt: new Date() } }] });
