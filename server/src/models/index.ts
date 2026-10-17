import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { ROLES, LEVEL_KINDS, SCHOOL_STATUSES, SCHOOL_TYPES, DOC_TYPES, LICENSING_STATUSES, OCR_STATUSES, MANUAL_KINDS, CURRICULUM_VERSION_STATUSES } from '@ghlearn/shared';
const { ObjectId } = Schema.Types;
const opts = { timestamps: true } as const;
/** isSample marks seeded demonstration data so it can be listed/removed and is labelled in the UI. */
const sample = { isSample: { type: Boolean, default: false, index: true } };

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  fullName: { type: String, required: true },
  roles: { type: [String], enum: ROLES, default: ['student'] },
  schoolId: { type: ObjectId, ref: 'School', index: true },
  status: { type: String, enum: ['active', 'suspended', 'pending'], default: 'active' },
  dateOfBirth: Date, guardianEmail: String,
  /** Ghana mobile in national form (0XXXXXXXXX), set only once verified by SMS code; used for SMS reset and opted-in alerts. */
  phone: String, phoneVerifiedAt: Date,
  failedLogins: { type: Number, default: 0 }, lockedUntil: Date, lastLoginAt: Date, sessionsRevokedAt: Date,
  /** Set for admin-created accounts and admin resets: every API call except auth is refused until the user picks a password. */
  mustChangePassword: { type: Boolean, default: false }, passwordChangedAt: Date, createdBy: { type: ObjectId, ref: 'User' },
  /** Individually revoked sessions (refresh-token families); access tokens carrying these ids are refused. Pruned after a day. */
  revokedSessions: { type: [{ sid: String, at: Date, _id: false }], default: undefined, select: false },
  consent: { termsAcceptedAt: Date, guardianConsentAt: Date },
  ...sample,
}, opts);
// A verified number belongs to one account, so "forgot password" by phone is unambiguous.
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phoneVerifiedAt: { $type: 'date' } }, name: 'phone_verified_unique' });
export const User = mongoose.model('User', userSchema);
export type UserDoc = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };

const refreshTokenSchema = new Schema({
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  family: { type: String, required: true, index: true }, // rotation family for reuse detection
  expiresAt: { type: Date, required: true },
  revokedAt: Date, replacedBy: String, userAgent: String, ip: String,
}, opts);
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);

/**
 * Password reset grants (self-service email link, or staff-issued link/code). Only SHA-256 hashes are stored; the raw
 * token/code exists once, in the email or on the issuing staff member's screen. Single use: usedAt is set atomically.
 */
const passwordResetSchema = new Schema({
  userId: { type: ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  /** Short code for typing on another device (staff-issued only); attempts are capped. */
  codeHash: { type: String, select: false }, attempts: { type: Number, default: 0 },
  kind: { type: String, enum: ['self', 'staff'], required: true },
  /** How a self-service grant was delivered (a link by email, or a code by SMS to the verified phone). */
  channel: { type: String, enum: ['email', 'sms'] },
  createdBy: { type: ObjectId, ref: 'User' }, ip: String,
  expiresAt: { type: Date, required: true }, usedAt: Date, invalidatedAt: Date,
}, opts);
passwordResetSchema.index({ userId: 1, kind: 1, createdAt: -1 });
// Records stay a week after expiry (rate limits and support questions), then MongoDB removes them.
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 });
export const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema);

/** Phone verification codes (6 digits), stored only as an HMAC; 10-minute life, 5 attempts, single use. */
const phoneOtpSchema = new Schema({
  userId: { type: ObjectId, ref: 'User', required: true, index: true }, phone: { type: String, required: true, index: true },
  codeHash: { type: String, required: true, select: false }, attempts: { type: Number, default: 0 }, ip: String,
  expiresAt: { type: Date, required: true }, usedAt: Date, invalidatedAt: Date,
}, opts);
phoneOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
export const PhoneOtp = mongoose.model('PhoneOtp', phoneOtpSchema);

/** Every SMS attempt: masked number only, never the message body (codes must not be stored). Kept 180 days. */
const smsLogSchema = new Schema({
  kind: { type: String, enum: ['otp', 'reset', 'notification', 'test'], required: true },
  to: { type: String, required: true }, network: String, userId: { type: ObjectId, ref: 'User', index: true },
  status: { type: String, enum: ['sent', 'failed', 'not_configured', 'disabled', 'cap_reached', 'no_sender'], required: true },
  provider: String, senderId: String, chars: Number, campaignId: String, providerCode: String, error: String, credits: Number,
  delivery: String, deliveryCheckedAt: Date, by: { type: ObjectId, ref: 'User' }, ref: String,
}, opts);
smsLogSchema.index({ createdAt: -1 }); smsLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86400 });
export const SmsLog = mongoose.model('SmsLog', smsLogSchema);
/** Per-UTC-day count of messages handed to the provider (atomic $inc), enforcing the daily cap. */
export const SmsCounter = mongoose.model('SmsCounter', new Schema({ day: { type: String, required: true, unique: true }, n: { type: Number, default: 0 } }, opts));

export const School = mongoose.model('School', new Schema({
  name: { type: String, required: true }, code: { type: String, required: true, unique: true, uppercase: true },
  region: { type: String, index: true }, district: String, levelKinds: { type: [String], enum: LEVEL_KINDS, default: ['SHS'] },
  /** status is the source of truth (spec §6); `active` mirrors status === 'active' for older readers. */
  status: { type: String, enum: SCHOOL_STATUSES, default: 'active', index: true }, statusReason: String, statusChangedAt: Date,
  active: { type: Boolean, default: true },
  type: { type: String, enum: SCHOOL_TYPES }, contact: { email: String, phone: String, address: String, headName: String },
  /** Learning Areas this school offers (empty = not configured yet). */
  programmeIds: [{ type: ObjectId, ref: 'Programme' }],
  /** School-configurable features. Leaderboards are OFF by default and anonymised by default. */
  settings: { leaderboard: { enabled: { type: Boolean, default: false }, anonymized: { type: Boolean, default: true }, scope: { type: String, enum: ['school', 'year'], default: 'year' } } },
  ...sample,
}, opts));

/** Ordering, deactivation and archiving shared by academic-structure records (spec §8). */
const lifecycle = { order: { type: Number, default: 0 }, archivedAt: Date, archivedBy: { type: ObjectId, ref: 'User' } };
export const AcademicLevel = mongoose.model('AcademicLevel', new Schema({
  kind: { type: String, enum: LEVEL_KINDS, required: true }, name: { type: String, required: true, unique: true },
  years: { type: Number, required: true }, enabled: { type: Boolean, default: true }, ...lifecycle, ...sample,
}, opts));

export const AcademicYear = mongoose.model('AcademicYear', new Schema({
  label: { type: String, required: true, unique: true }, startDate: Date, endDate: Date, current: { type: Boolean, default: false }, ...lifecycle, ...sample,
}, opts));

export const Programme = mongoose.model('Programme', new Schema({
  name: { type: String, required: true }, code: { type: String, required: true, unique: true, uppercase: true },
  levelId: { type: ObjectId, ref: 'AcademicLevel', required: true }, description: String, active: { type: Boolean, default: true }, ...lifecycle, ...sample,
}, opts));

export const Subject = mongoose.model('Subject', new Schema({
  name: { type: String, required: true }, code: { type: String, required: true, unique: true, uppercase: true },
  levelId: { type: ObjectId, ref: 'AcademicLevel', required: true, index: true },
  category: { type: String, enum: ['core', 'elective'], required: true },
  programmeIds: [{ type: ObjectId, ref: 'Programme' }], curriculumVersion: String, curriculumVersionId: { type: ObjectId, ref: 'CurriculumVersion', index: true },
  active: { type: Boolean, default: true },
  /** Where this subject definition came from; imported names are unverified until an admin confirms. */
  provenance: { source: String, verified: { type: Boolean, default: true }, categoryInferred: Boolean, aliases: [String], documentCount: Number }, ...lifecycle, ...sample,
}, opts));

export const SubjectCombination = mongoose.model('SubjectCombination', new Schema({
  name: { type: String, required: true }, programmeId: { type: ObjectId, ref: 'Programme', required: true, index: true },
  subjectIds: [{ type: ObjectId, ref: 'Subject' }], minElectives: { type: Number, default: 0 }, maxElectives: { type: Number, default: 4 },
  yearOfStudy: Number, schoolId: { type: ObjectId, ref: 'School', index: true }, active: { type: Boolean, default: true }, ...lifecycle, ...sample,
}, opts));

/** Student academic profile; subjectIds is THE authorisation list for learning content. */
export const StudentProfile = mongoose.model('StudentProfile', new Schema({
  userId: { type: ObjectId, ref: 'User', required: true, unique: true },
  /** Linked configured school (optional: only when the typed school name matches one). */
  schoolId: { type: ObjectId, ref: 'School', index: true }, levelId: { type: ObjectId, ref: 'AcademicLevel', required: true },
  /** Free-text school name as typed by the student; schoolNameKey is its normalised form (matching + scoping). */
  schoolName: String, schoolNameKey: { type: String, index: true }, region: { type: String, index: true },
  /** programmeId = "Learning Area" in the UI (field name kept). */
  programmeId: { type: ObjectId, ref: 'Programme' }, combinationId: { type: ObjectId, ref: 'SubjectCombination' },
  yearOfStudy: { type: Number, required: true }, subjectIds: [{ type: ObjectId, ref: 'Subject', index: true }],
  preferredLanguage: String, learningPreferences: [String], onboardedAt: Date, ...sample,
}, opts));

export const TeacherAssignment = mongoose.model('TeacherAssignment', new Schema({
  teacherId: { type: ObjectId, ref: 'User', required: true, index: true }, schoolId: { type: ObjectId, ref: 'School', required: true },
  subjectId: { type: ObjectId, ref: 'Subject', required: true }, classGroup: String, yearOfStudy: Number, ...sample,
}, opts));

/** A source document (learner manual, curriculum, etc). Provenance + approval are always recorded (rule 20). */
export { DOC_TYPES } from '@ghlearn/shared';

/** A curriculum version (e.g. "SHS 2023"): draft -> active -> archived. Subjects, manuals and curriculum elements link to it. */
export const CurriculumVersion = mongoose.model('CurriculumVersion', new Schema({
  code: { type: String, required: true, unique: true }, name: { type: String, required: true }, levelId: { type: ObjectId, ref: 'AcademicLevel' },
  status: { type: String, enum: CURRICULUM_VERSION_STATUSES, default: 'draft', index: true },
  effectiveFrom: Date, effectiveTo: Date, publisher: String, description: String,
  activatedAt: Date, activatedBy: { type: ObjectId, ref: 'User' }, archivedAt: Date, archivedBy: { type: ObjectId, ref: 'User' }, createdBy: { type: ObjectId, ref: 'User' }, ...sample,
}, opts));
export const PROCESSING = ['not_processed', 'queued', 'extracting', 'ocr', 'structuring', 'chunking', 'embedding', 'indexed', 'failed'] as const;
const documentSchema = new Schema({
  title: { type: String, required: true }, originalFilename: String, mimeType: String, sizeBytes: Number, pageCount: Number,
  subjectId: { type: ObjectId, ref: 'Subject', index: true }, levelId: { type: ObjectId, ref: 'AcademicLevel' }, programmeId: { type: ObjectId, ref: 'Programme' },
  yearOfStudy: Number, docType: { type: String, enum: DOC_TYPES, default: 'learner_manual' }, audience: { type: String, enum: ['learner', 'teacher', 'both', 'unknown'], default: 'unknown' },
  /** curriculumVersion mirrors the linked CurriculumVersion.code (kept for older readers). */
  curriculumVersion: String, curriculumVersionId: { type: ObjectId, ref: 'CurriculumVersion', index: true }, language: { type: String, default: 'en' },
  fileKind: { type: String, enum: MANUAL_KINDS }, publicationYear: Number, documentVersion: String,
  licensingStatus: { type: String, enum: LICENSING_STATUSES, default: 'unknown' }, tags: { type: [String], index: true },
  /** OCR need is detected from the text layer; never faked. */
  ocrStatus: { type: String, enum: OCR_STATUSES }, pageUnit: { type: String, enum: ['page', 'segment'], default: 'page' },
  archivedAt: { type: Date, index: true }, archivedBy: { type: ObjectId, ref: 'User' },
  /** Replacement versions: every version shares versionGroupId (the first version's id); older ones keep their links to generated resources. */
  versionGroupId: { type: ObjectId, index: true }, versionNumber: { type: Number, default: 1 },
  supersedes: { type: ObjectId, ref: 'CurriculumDocument' }, supersededBy: { type: ObjectId, ref: 'CurriculumDocument', index: true }, supersededAt: Date,
  /** Metadata as supplied by the source/importer, kept verbatim for traceability. */
  sourceMeta: Schema.Types.Mixed,
  provenance: { sourceUrl: { type: String, index: true }, publisher: String, retrievedAt: Date, checksum: { type: String, index: true }, driveFileId: String, importBatch: String, uploadedVia: { type: String, enum: ['upload', 'import', 'seed'] } },
  /** Where bytes live. gridfs = stored by us; drive = server-side Drive; remote = fetch from provenance.sourceUrl on demand. */
  storage: { provider: { type: String, enum: ['gridfs', 'drive', 'remote', 'none'], default: 'none' }, key: String },
  duplicateOf: { type: ObjectId, ref: 'CurriculumDocument', index: true },
  approvalStatus: { type: String, enum: ['unverified', 'verified_official', 'rejected'], default: 'unverified', index: true },
  /** Reviewer's note on the approval decision (e.g. how it was checked) and open review flags such as needs_ocr. */
  approvalNote: String, reviewFlags: { type: [String], index: true },
  mappingStatus: { type: String, enum: ['unmapped', 'suggested', 'confirmed'], default: 'unmapped', index: true },
  processingStatus: { type: String, enum: PROCESSING, default: 'not_processed', index: true },
  processingReport: Schema.Types.Mixed, lastJobId: { type: ObjectId, ref: 'Job' },
  uploadedBy: { type: ObjectId, ref: 'User' }, mappedBy: { type: ObjectId, ref: 'User' }, approvedBy: { type: ObjectId, ref: 'User' }, ...sample,
}, opts);
documentSchema.index({ title: 'text', originalFilename: 'text' });
export const CurriculumDocument = mongoose.model('CurriculumDocument', documentSchema);

export const DocumentPage = mongoose.model('DocumentPage', new Schema({
  documentId: { type: ObjectId, ref: 'CurriculumDocument', required: true }, page: { type: Number, required: true },
  text: String, method: { type: String, enum: ['text', 'ocr', 'empty', 'ocr_unavailable'], required: true }, charCount: Number, ocrConfidence: Number,
  /** Embedded images/drawings detected on the page (counted, not extracted). */
  figures: { type: Number, default: 0 },
}, opts).index({ documentId: 1, page: 1 }, { unique: true }));

/** Detected curriculum structure. verified=false until a human confirms (never assumed). */
export const CurriculumNode = mongoose.model('CurriculumNode', new Schema({
  documentId: { type: ObjectId, ref: 'CurriculumDocument', required: true, index: true }, subjectId: { type: ObjectId, ref: 'Subject', index: true },
  type: { type: String, enum: ['section', 'strand', 'subStrand', 'contentStandard', 'indicator', 'topic'], required: true },
  code: String, title: { type: String, required: true }, page: Number, order: Number, parentId: { type: ObjectId, ref: 'CurriculumNode' },
  detection: { rule: String, confidence: { type: String, enum: ['explicit_label', 'pattern', 'manual'] }, line: String },
  verified: { type: Boolean, default: false }, verifiedBy: { type: ObjectId, ref: 'User' }, archivedAt: Date,
  curriculumVersionId: { type: ObjectId, ref: 'CurriculumVersion', index: true },
}, opts));

export const Chunk = mongoose.model('Chunk', new Schema({
  documentId: { type: ObjectId, ref: 'CurriculumDocument', required: true, index: true }, subjectId: { type: ObjectId, ref: 'Subject', index: true },
  ordinal: Number, pageStart: Number, pageEnd: Number, nodeIds: [{ type: ObjectId, ref: 'CurriculumNode' }], headingPath: [String],
  text: { type: String, required: true }, charCount: Number,
  /** float32 BSON vector (lib/vector.ts); older passages may hold a number array. */
  embedding: { type: Schema.Types.Mixed, select: false }, embeddingModel: String,
  embeddingStatus: { type: String, enum: ['pending', 'disabled', 'done', 'failed', 'test_only'], default: 'pending' },
  // Unique per document: a retried or overlapping processing run can never leave duplicate passages (and so duplicate embeddings).
}, opts).index({ documentId: 1, ordinal: 1 }, { unique: true }));

/** MongoDB-backed job queue (see services/queue.ts). */
export const Job = mongoose.model('Job', new Schema({
  type: { type: String, required: true }, payload: Schema.Types.Mixed,
  status: { type: String, enum: ['queued', 'running', 'succeeded', 'failed', 'dead', 'cancelled'], default: 'queued' },
  attempts: { type: Number, default: 0 }, maxAttempts: { type: Number, default: 3 }, runAt: { type: Date, default: () => new Date() },
  lockedUntil: Date, lockedBy: String,
  // progress.current/total are set only when the stage really measures them (pages, OCR pages, embedded passages); otherwise the UI is indeterminate.
  progress: { step: String, pct: Number, current: Number, total: Number, unit: String }, result: Schema.Types.Mixed,
  stages: [{ _id: false, stage: String, at: Date, attempt: Number }], failedStage: String,
  errorLog: [{ at: Date, message: String, attempt: Number, stage: String }], startedAt: Date, finishedAt: Date, createdBy: { type: ObjectId, ref: 'User' },
  documentId: { type: ObjectId, ref: 'CurriculumDocument', index: true }, retryOf: { type: ObjectId, ref: 'Job', index: true },
  cancelledAt: Date, cancelledBy: { type: ObjectId, ref: 'User' },
}, opts).index({ status: 1, runAt: 1 }).index({ type: 1, createdAt: -1 }));

/** Generic learning resource (notes, quiz, game...). Students only ever see status=published for their subjects. */
export const LearningResource = mongoose.model('LearningResource', new Schema({
  title: { type: String, required: true }, kind: { type: String, enum: ['notes', 'exercise', 'quiz', 'game', 'revision', 'activity', 'diagram', 'teacher_prep'], required: true },
  contentType: String,
  /** Who may see it once published (§12): roles, plus optional level / year / programme / institution restrictions. Empty = no restriction. */
  audience: { roles: { type: [String], default: ['student', 'teacher'] }, levelId: { type: ObjectId, ref: 'AcademicLevel' }, yearOfStudy: Number,
    programmeIds: [{ type: ObjectId, ref: 'Programme' }], schoolIds: [{ type: ObjectId, ref: 'School' }] },
  subjectId: { type: ObjectId, ref: 'Subject', required: true, index: true }, yearOfStudy: Number,
  strand: String, subStrand: String, indicator: String, topic: String,
  sourceDocumentId: { type: ObjectId, ref: 'CurriculumDocument' }, sourcePages: [Number],
  status: { type: String, enum: ['draft', 'in_review', 'approved', 'published', 'archived'], default: 'draft', index: true },
  aiGenerated: { type: Boolean, default: false }, body: Schema.Types.Mixed, ...sample,
}, opts));

/**
 * Append-only audit trail (spec §19). Updates and deletes are refused unless the query carries
 * `{ maintenance: true }` (test resets and the documented retention job only). Never stores secrets:
 * lib/audit.ts redacts sensitive keys before writing.
 */
const auditSchema = new Schema({
  actorId: { type: ObjectId, ref: 'User' }, action: { type: String, required: true }, target: String, meta: Schema.Types.Mixed, ip: String,
  requestId: String, entityType: String, outcome: { type: String, enum: ['success', 'failure', 'denied'], default: 'success' },
  schoolId: { type: ObjectId, ref: 'School' }, before: Schema.Types.Mixed, after: Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false } });
auditSchema.index({ createdAt: -1 }); auditSchema.index({ action: 1, createdAt: -1 }); auditSchema.index({ actorId: 1, createdAt: -1 });
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  auditSchema.pre(op, function (this: any) { if (!this.getOptions?.().maintenance) throw new Error('AuditLog is append-only'); });
}
auditSchema.pre('save', function () { if (!this.isNew) throw new Error('AuditLog is append-only'); });
auditSchema.pre(['deleteOne'], { document: true, query: false }, function () { throw new Error('AuditLog is append-only'); });
export const AuditLog = mongoose.model('AuditLog', auditSchema);

/**
 * Scoped role grants (spec §4). `User.roles` remains the fast cache read by `authenticate`;
 * every change goes through services/roles.ts, which keeps both in sync and audits it.
 */
export const RoleAssignment = mongoose.model('RoleAssignment', new Schema({
  userId: { type: ObjectId, ref: 'User', required: true, index: true }, role: { type: String, enum: ROLES, required: true },
  scopeType: { type: String, enum: ['platform', 'school'], required: true }, scopeId: { type: ObjectId, ref: 'School' },
  grantedBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true }).index({ userId: 1, role: 1, scopeType: 1, scopeId: 1 }, { unique: true }));

/** Every LLM/embedding call is recorded (budgets, cost tracking, audit). */
export const AiUsage = mongoose.model('AiUsage', new Schema({
  day: { type: String, required: true, index: true }, provider: String, model: String, purpose: { type: String, required: true },
  userId: { type: ObjectId, ref: 'User', index: true }, jobId: { type: ObjectId, ref: 'Job' }, refId: String,
  inputTokens: Number, outputTokens: Number, thoughtTokens: Number, latencyMs: Number,
  /** Embedding calls: characters sent (the cost estimate uses ~4 characters per token). */
  chars: Number,
  /** ok | error (provider failure) | blocked (safety) | budget_exceeded / limit_exceeded / feature_disabled / input_too_large (refused before calling) | timeout | rate_limited (429 after retries). */
  status: { type: String, enum: ['ok', 'error', 'blocked', 'budget_exceeded', 'limit_exceeded', 'feature_disabled', 'input_too_large', 'timeout', 'rate_limited'] }, error: String,
  // Phase 9 (§17)
  schoolId: { type: ObjectId, ref: 'School', index: true }, feature: { type: String, index: true },
  /** Provider 429 responses seen during this request (retried or final) and total retries. */
  rateLimitHits: Number, retries: Number, units: Number, httpStatus: Number,
}, { timestamps: { createdAt: true, updatedAt: false } }).index({ createdAt: -1 }));

const citation = new Schema({ chunkId: { type: ObjectId, ref: 'Chunk' }, documentId: { type: ObjectId, ref: 'CurriculumDocument' }, pageStart: Number, pageEnd: Number, quote: String }, { _id: false });
const lessonSection = new Schema({
  key: { type: String, required: true }, title: String, kind: String,
  /** Markdown body; structured payloads (exercises, quiz, diagrams, vocabulary) live in data. */
  content: String, data: Schema.Types.Mixed, citations: [citation],
  sourceSupport: { type: String, enum: ['source', 'general', 'mixed', 'none'], default: 'source' },
  generatedAt: Date, editedBy: { type: ObjectId, ref: 'User' }, editedAt: Date,
}, { _id: false });
/** §12 statuses (in_review = Awaiting review; resubmitted = submitted again after changes were requested) plus failed (generation failed). */
export const LESSON_STATUSES = ['generating', 'draft', 'in_review', 'changes_requested', 'resubmitted', 'approved', 'published', 'archived', 'failed'] as const;
export const Lesson = mongoose.model('Lesson', new Schema({
  title: { type: String, required: true }, subjectId: { type: ObjectId, ref: 'Subject', required: true, index: true }, levelId: { type: ObjectId, ref: 'AcademicLevel' },
  yearOfStudy: Number, topic: String, strand: String, subStrand: String, indicator: String,
  nodeId: { type: ObjectId, ref: 'CurriculumNode' }, sourceDocumentIds: [{ type: ObjectId, ref: 'CurriculumDocument' }],
  controls: Schema.Types.Mixed, sections: [lessonSection],
  validation: { ok: Boolean, errors: [String], warnings: [String], checkedAt: Date },
  status: { type: String, enum: LESSON_STATUSES, default: 'generating', index: true }, version: { type: Number, default: 0 },
  aiGenerated: { type: Boolean, default: true }, aiModel: String, lastJobId: { type: ObjectId, ref: 'Job' }, generationError: String,
  createdBy: { type: ObjectId, ref: 'User' }, reviewedBy: { type: ObjectId, ref: 'User' }, publishedBy: { type: ObjectId, ref: 'User' }, publishedAt: Date,
  resourceId: { type: ObjectId, ref: 'LearningResource' },
  // Phase 7 (§11/§12)
  contentType: { type: String, default: 'lesson', index: true }, subtopic: String, programmeId: { type: ObjectId, ref: 'Programme' },
  curriculumVersionId: { type: ObjectId, ref: 'CurriculumVersion' }, pageFrom: Number, pageTo: Number,
  /** Where the indicator came from: a curriculum element (node) of a source manual, or text typed by the editor. Never the model. */
  indicatorSource: { type: String, enum: ['curriculum_node', 'editor', null] },
  estimate: Schema.Types.Mixed,
  assignedReviewerId: { type: ObjectId, ref: 'User', index: true }, assignedAt: Date, assignedBy: { type: ObjectId, ref: 'User' },
  submittedAt: Date, submittedBy: { type: ObjectId, ref: 'User' }, reviewedAt: Date, approvedVersion: Number,
  archivedAt: Date, archivedBy: { type: ObjectId, ref: 'User' },
  audience: { levelId: { type: ObjectId, ref: 'AcademicLevel' }, yearOfStudy: Number, programmeIds: [{ type: ObjectId, ref: 'Programme' }], schoolIds: [{ type: ObjectId, ref: 'School' }] },
  /** Shown to anonymous visitors as a preview on the public site (only while published, open to students and not institution-restricted). */
  publicPreview: { type: Boolean, default: false, index: true }, publicPreviewBy: { type: ObjectId, ref: 'User' }, publicPreviewAt: Date,
  ...sample,
}, opts));
export const LessonVersion = mongoose.model('LessonVersion', new Schema({
  lessonId: { type: ObjectId, ref: 'Lesson', required: true, index: true }, version: { type: Number, required: true },
  title: String, sections: [lessonSection], reason: String, createdBy: { type: ObjectId, ref: 'User' },
}, opts).index({ lessonId: 1, version: 1 }, { unique: true }));
export const LessonReview = mongoose.model('LessonReview', new Schema({
  lessonId: { type: ObjectId, ref: 'Lesson', required: true, index: true }, action: { type: String, enum: ['submit', 'resubmit', 'approve', 'request_changes', 'publish', 'unpublish', 'comment', 'assign', 'unassign', 'archive', 'retry', 'cancel'], required: true },
  comment: String, version: Number, by: { type: ObjectId, ref: 'User' }, sectionKey: String, assigneeId: { type: ObjectId, ref: 'User' },
}, { timestamps: { createdAt: true, updatedAt: false } }));

const convSchema = new Schema({
  userId: { type: ObjectId, ref: 'User', required: true, index: true }, subjectId: { type: ObjectId, ref: 'Subject', required: true },
  title: String, lastMessageAt: Date, expiresAt: { type: Date, required: true },
}, opts);
convSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const TutorConversation = mongoose.model('TutorConversation', convSchema);
const msgSchema = new Schema({
  conversationId: { type: ObjectId, ref: 'TutorConversation', required: true, index: true }, userId: { type: ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['user', 'assistant'], required: true }, content: { type: String, required: true },
  mode: { type: String, enum: ['hint', 'explain', 'check'] },
  answerType: { type: String, enum: ['source', 'general', 'mixed', 'refusal', 'error'] },
  citations: [citation], aiModel: String, flags: [String],
  feedback: { rating: { type: String, enum: ['up', 'down'] }, comment: String, at: Date }, expiresAt: { type: Date, required: true },
}, opts);
msgSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const TutorMessage = mongoose.model('TutorMessage', msgSchema);

/**
 * CSV enrolment import (spec §15). A preview stores the validated rows; commit records exactly what it created so
 * rollback removes only those records. Temporary passwords are never stored.
 */
export const ImportBatch = mongoose.model('ImportBatch', new Schema({
  kind: { type: String, enum: ['enrolments'], required: true }, schoolId: { type: ObjectId, ref: 'School', required: true, index: true },
  status: { type: String, enum: ['preview', 'committing', 'committed', 'rolled_back', 'cancelled', 'failed'], default: 'preview', index: true },
  filename: String, checksum: String, options: { createMissingStudents: Boolean, createMissingClasses: Boolean },
  rows: [{ _id: false, line: Number, email: String, fullName: String, className: String, yearOfStudy: Number, academicYear: String,
    action: { type: String, enum: ['enrol', 'create_and_enrol', 'skip', 'error'] }, createsClass: Boolean, errors: [String], warnings: [String] }],
  summary: Schema.Types.Mixed,
  created: { userIds: [{ type: ObjectId, ref: 'User' }], classIds: [{ type: ObjectId, ref: 'ClassGroup' }], enrolments: [{ _id: false, classId: ObjectId, userId: ObjectId }] },
  rollbackReport: Schema.Types.Mixed, error: String,
  createdBy: { type: ObjectId, ref: 'User', required: true }, committedAt: Date, committedBy: { type: ObjectId, ref: 'User' }, rolledBackAt: Date, rolledBackBy: { type: ObjectId, ref: 'User' },
}, opts).index({ createdAt: -1 }));

export * from './assess.js';
export * from './teach.js';
export * from './meet.js';
export * from './ops.js';
