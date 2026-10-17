import mongoose, { Schema } from 'mongoose';
const { ObjectId } = Schema.Types;
/** A teacher's class group (e.g. "1 Science A — Biology"). Scoped to one school; optionally one subject. */
export const ClassGroup = mongoose.model('ClassGroup', new Schema({
  schoolId: { type: ObjectId, ref: 'School', required: true, index: true }, subjectId: { type: ObjectId, ref: 'Subject', index: true },
  name: { type: String, required: true }, yearOfStudy: Number, teacherIds: [{ type: ObjectId, ref: 'User', index: true }], studentIds: [{ type: ObjectId, ref: 'User', index: true }],
  archived: { type: Boolean, default: false }, createdBy: { type: ObjectId, ref: 'User' }, isSample: { type: Boolean, default: false },
  /** Spec §15: the academic year and Learning Area a class belongs to; rolledFromId links a class to the one it was promoted from. */
  academicYearId: { type: ObjectId, ref: 'AcademicYear', index: true }, programmeId: { type: ObjectId, ref: 'Programme' }, rolledFromId: { type: ObjectId, ref: 'ClassGroup', index: true },
}, { timestamps: true }));
export const NOTIFICATION_TYPES = ['assignment.new', 'assignment.due', 'attempt.marked', 'marking.pending', 'review.requested', 'review.assigned', 'review.decision', 'review.reminder', 'job.finished', 'job.failed', 'system',
  'meeting.requested', 'meeting.accept', 'meeting.decline', 'meeting.reschedule', 'meeting.cancel', 'meeting.reminder', 'announcement', 'content.published', 'processing.failed', 'security.lockout', 'security.password', 'security.roles', 'security.sessions', 'ai.budget'] as const;
/** Preference categories (§18). Security is always delivered in the app. */
export const NOTIFICATION_CATEGORIES = { announcements: 'Announcements', publication: 'Publication', processing: 'Processing failures', review: 'Review requests and reminders', security: 'Account and security', learning: 'Assignments and marking', meetings: 'Meetings', system: 'System and AI budget' } as const;
export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;
export const categoryOf = (type: string): NotificationCategory => type === 'announcement' ? 'announcements' : type === 'content.published' ? 'publication' : type === 'processing.failed' || type.startsWith('job.') ? 'processing'
  : type.startsWith('review.') ? 'review' : type.startsWith('security.') ? 'security' : type.startsWith('meeting.') ? 'meetings' : ['assignment.new', 'assignment.due', 'attempt.marked', 'marking.pending'].includes(type) ? 'learning' : 'system';
/** In-app notifications, plus email when a provider is configured. Delivery status is recorded per channel. Retained 90 days (or until an announcement expires). */
const n = new Schema({
  userId: { type: ObjectId, ref: 'User', required: true, index: true }, type: { type: String, enum: NOTIFICATION_TYPES, required: true },
  title: { type: String, required: true }, body: String, link: String, readAt: Date, meta: Schema.Types.Mixed,
  category: String, announcementId: { type: ObjectId, ref: 'Announcement', index: true },
  visibleUntil: Date,
  delivery: { inApp: { type: String, enum: ['delivered', 'opted_out', 'withdrawn'] }, email: { type: String, enum: ['sent', 'failed', 'not_configured', 'disabled', 'opted_out', 'no_address', 'not_requested'] }, emailError: String, emailAt: Date,
    sms: { type: String, enum: ['sent', 'failed', 'not_configured', 'disabled', 'opted_out', 'no_number', 'not_requested', 'cap_reached'] }, smsAt: Date },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 90 * 86400000) },
}, { timestamps: { createdAt: true, updatedAt: false } });
n.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); n.index({ userId: 1, readAt: 1, createdAt: -1 });
export const Notification = mongoose.model('Notification', n);
