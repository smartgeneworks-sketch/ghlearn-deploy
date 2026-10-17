import mongoose, { Schema } from 'mongoose';
const { ObjectId } = Schema.Types;
/**
 * Phase 9 operational models: AI settings (§17), provider health checks (§17), announcements and notification
 * preferences (§18), and lesson completion (§16).
 */

/** AI features that can be switched on or off (§17 "allowed features"). Each maps to the AiUsage purposes it covers. */
export const AI_FEATURES = {
  tutor: { label: 'AI tutor', purposes: ['tutor'] },
  lesson_generation: { label: 'Lesson and resource generation', purposes: ['lesson.generate', 'lesson.regenerateSection'] },
  question_generation: { label: 'Question generation and answer cross-check', purposes: ['questions.generate', 'questions.crosscheck'] },
  ai_marking: { label: 'AI-assisted marking of written answers', purposes: ['attempt.aiMark'] },
  analytics_summary: { label: 'AI recommendations in Learning Analytics', purposes: ['analytics.summary'] },
} as const;
export type AiFeature = keyof typeof AI_FEATURES;
export const featureOf = (purpose: string): AiFeature | 'embeddings' | 'health_check' | 'other' => {
  if (purpose.startsWith('embedding')) return 'embeddings';
  if (purpose === 'health_check') return 'health_check';
  for (const [k, v] of Object.entries(AI_FEATURES)) if ((v.purposes as readonly string[]).includes(purpose)) return k as AiFeature;
  return 'other';
};

/** Singleton (key 'ai'). Every field is enforced on the server in services/usage.ts; env values are only the first-run defaults. */
export const AiSettings = mongoose.model('AiSettings', new Schema({
  key: { type: String, default: 'ai', unique: true },
  platformDailyRequests: Number, platformDailyTokens: Number, platformMonthlyRequests: Number, platformMonthlyCostUsd: Number,
  perUserDailyRequests: Number, schoolDailyRequests: Number,
  schoolBudgets: [{ _id: false, schoolId: { type: ObjectId, ref: 'School' }, dailyRequests: Number }],
  maxInputChars: Number, maxOutputTokens: Number, maxRetries: Number, timeoutSec: Number,
  allowedFeatures: [String], alertThresholdPct: Number,
  costInputPerM: Number, costOutputPerM: Number, llmModel: String,
  updatedBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true }));

/** One run of the real provider checks. A capability that is not configured is `not_configured`, never `ok`. */
export const AiHealthCheck = mongoose.model('AiHealthCheck', new Schema({
  ranBy: { type: ObjectId, ref: 'User' }, ok: Boolean,
  results: [{ _id: false, capability: String, provider: String, model: String, status: { type: String, enum: ['ok', 'failed', 'not_configured'] }, latencyMs: Number, detail: String }],
}, { timestamps: { createdAt: true, updatedAt: false } }).index({ createdAt: -1 }));

/** Budget-threshold alerts already sent (one per scope, level and day). */
export const AiAlert = mongoose.model('AiAlert', new Schema({
  day: { type: String, required: true }, scope: { type: String, required: true }, level: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } }).index({ day: 1, scope: 1, level: 1 }, { unique: true }));

export const ANNOUNCEMENT_STATUSES = ['draft', 'scheduled', 'published', 'expired', 'withdrawn'] as const;
/** §18 announcement: system-wide (super admin) or for one school. Audience by role, optionally level and year of study. */
export const Announcement = mongoose.model('Announcement', new Schema({
  scope: { type: String, enum: ['system', 'school'], required: true }, schoolId: { type: ObjectId, ref: 'School', index: true },
  title: { type: String, required: true }, body: { type: String, required: true }, link: String,
  audience: { roles: [String], levelId: { type: ObjectId, ref: 'AcademicLevel' }, yearOfStudy: Number },
  publishAt: Date, expiresAt: { type: Date, required: true },
  status: { type: String, enum: ANNOUNCEMENT_STATUSES, default: 'draft', index: true },
  email: { type: Boolean, default: false },
  delivery: { recipients: Number, inApp: Number, read: Number, email: Schema.Types.Mixed, deliveredAt: Date },
  createdBy: { type: ObjectId, ref: 'User', required: true }, publishedBy: { type: ObjectId, ref: 'User' }, publishedAt: Date,
  withdrawnBy: { type: ObjectId, ref: 'User' }, withdrawnAt: Date, jobId: { type: ObjectId, ref: 'Job' },
}, { timestamps: true }).index({ createdAt: -1 }));

/** Per-user channel choices by category. Security alerts are always delivered in the app. */
export const NotificationPreference = mongoose.model('NotificationPreference', new Schema({
  userId: { type: ObjectId, ref: 'User', required: true, unique: true },
  categories: Schema.Types.Mixed,
}, { timestamps: true }));

/** A learner opening and completing a published lesson or resource (§16 lesson completion). Measured, never inferred. */
export const ResourceProgress = mongoose.model('ResourceProgress', new Schema({
  userId: { type: ObjectId, ref: 'User', required: true }, resourceId: { type: ObjectId, ref: 'LearningResource', required: true },
  subjectId: { type: ObjectId, ref: 'Subject', index: true }, schoolId: { type: ObjectId, ref: 'School', index: true }, topic: String,
  openedAt: Date, lastOpenedAt: Date, opens: { type: Number, default: 0 }, completedAt: Date,
}, { timestamps: true }).index({ userId: 1, resourceId: 1 }, { unique: true }).index({ subjectId: 1, completedAt: 1 }));

/**
 * §20 platform settings: one document (key 'platform'). `data` is validated by services/platformSettings.ts (strict
 * Zod schema with no secret fields; strings that look like credentials are refused). Secrets stay in the environment.
 */
export const PlatformSettings = mongoose.model('PlatformSettings', new Schema({
  key: { type: String, default: 'platform', unique: true }, data: { type: Schema.Types.Mixed, default: {} },
  version: { type: Number, default: 0 }, legalVersion: { type: Number, default: 0 }, legalUpdatedAt: Date,
  updatedBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true, minimize: false }));

/** Public enquiries from the For Schools and Contact pages (docs/LANDING_SPEC.md). Viewable in Admin → Public Website. */
export const Enquiry = mongoose.model('Enquiry', new Schema({
  kind: { type: String, enum: ['school', 'contact'], required: true, index: true },
  name: { type: String, required: true }, email: { type: String, required: true }, phone: String, organisation: String, role: String, region: String,
  learners: Number, topic: String, message: { type: String, required: true },
  status: { type: String, enum: ['new', 'in_progress', 'closed'], default: 'new', index: true }, adminNote: String,
  /** Outcome of the optional notification email to the organisation address: sent | failed | not_configured | no_address. */
  emailStatus: String, userId: { type: ObjectId, ref: 'User' }, ip: String, updatedBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true }).index({ createdAt: -1 }));
