import mongoose, { Schema } from 'mongoose';
const { ObjectId } = Schema.Types;
const opts = { timestamps: true } as const;
const sample = { isSample: { type: Boolean, default: false, index: true } };

/** Question types (spec §9). Rubrics attach to essay/structured/case_study questions. */
export const QUESTION_TYPES = ['mcq', 'true_false', 'short_answer', 'gap_fill', 'matching', 'ordering', 'diagram_labelling', 'numerical', 'structured', 'essay', 'case_study'] as const;
export const OBJECTIVE_TYPES = ['mcq', 'true_false', 'short_answer', 'gap_fill', 'matching', 'ordering', 'diagram_labelling', 'numerical'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
/** §12/§13 statuses; `published` = approved and in the bank (usable in assessments, practice and games). */
export const QUESTION_STATUSES = ['draft', 'in_review', 'changes_requested', 'resubmitted', 'published', 'rejected', 'archived'] as const;
export const DESIGN_STATUSES = ['draft', 'in_review', 'changes_requested', 'resubmitted', 'approved', 'published', 'archived'] as const;
export const ATTEMPT_MODES = ['practice', 'timed', 'topic_revision', 'mixed', 'assigned', 'mock', 'remedial'] as const;
export const GAMES = ['quiz_challenge', 'match_terms', 'ordering', 'flashcards', 'gap_fill', 'word_search', 'label_diagram', 'classification', 'timed_revision', 'scenario'] as const;

const rubricCriterion = new Schema({ criterion: { type: String, required: true }, maxMarks: { type: Number, required: true }, descriptors: [{ marks: Number, description: String, _id: false }] }, { _id: false });
const qCitation = new Schema({ chunkId: { type: ObjectId, ref: 'Chunk' }, documentId: { type: ObjectId, ref: 'CurriculumDocument' }, pageStart: Number, pageEnd: Number }, { _id: false });

/** A bank question, traceable to subject/topic/objective/source/difficulty. Students only ever receive status=published. */
export const Question = mongoose.model('Question', new Schema({
  subjectId: { type: ObjectId, ref: 'Subject', required: true, index: true }, levelId: { type: ObjectId, ref: 'AcademicLevel' }, yearOfStudy: Number,
  strand: String, topic: { type: String, required: true, index: true }, objective: String,
  type: { type: String, enum: QUESTION_TYPES, required: true }, difficulty: { type: String, enum: DIFFICULTIES, default: 'medium' },
  stem: { type: String, required: true }, data: { type: Schema.Types.Mixed, default: {} }, rubric: [rubricCriterion],
  marks: { type: Number, default: 1 }, explanation: String, hint: String, timeLimitSec: Number,
  citations: [qCitation], sourceDocumentId: { type: ObjectId, ref: 'CurriculumDocument' }, lessonId: { type: ObjectId, ref: 'Lesson' },
  status: { type: String, enum: QUESTION_STATUSES, default: 'draft', index: true },
  validation: { ok: Boolean, errors: [String], warnings: [String], checkedAt: Date },
  normStem: { type: String, index: true }, duplicateOf: { type: ObjectId, ref: 'Question' },
  aiGenerated: { type: Boolean, default: false }, aiModel: String, generationJobId: { type: ObjectId, ref: 'Job' },
  createdBy: { type: ObjectId, ref: 'User' }, reviewedBy: { type: ObjectId, ref: 'User' }, reviewedAt: Date, reviewComment: String, ...sample,
  version: { type: Number, default: 1 }, crossCheck: { type: String, enum: ['agreed', 'disagreed', null] },
  /** A reviewer (never an author) confirmed the answer key of this exact version. */
  keyVerifiedBy: { type: ObjectId, ref: 'User' }, keyVerifiedAt: Date, keyVerifiedVersion: Number,
  submittedAt: Date, submittedBy: { type: ObjectId, ref: 'User' }, archivedAt: Date, archivedBy: { type: ObjectId, ref: 'User' },
}, opts).index({ subjectId: 1, status: 1, topic: 1, type: 1 }));

/** Authored learning game (§14): a game type of the engine, linked to subject/topic/objective, built from verified questions and/or reviewed content. */
export const GameDesign = mongoose.model('GameDesign', new Schema({
  title: { type: String, required: true }, subjectId: { type: ObjectId, ref: 'Subject', required: true, index: true }, levelId: { type: ObjectId, ref: 'AcademicLevel' }, yearOfStudy: Number,
  strand: String, topic: { type: String, required: true }, objective: { type: String, required: true },
  type: { type: String, enum: GAMES, required: true }, difficulty: { type: String, enum: DIFFICULTIES, default: 'medium' },
  settings: { pointsPerItem: { type: Number, default: 10 }, hintsEnabled: { type: Boolean, default: true }, hintCost: { type: Number, default: 3 }, timeLimitSec: Number, streakBonus: { type: Number, default: 2 }, _id: false },
  questionIds: [{ type: ObjectId, ref: 'Question' }], content: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: DESIGN_STATUSES, default: 'draft', index: true }, version: { type: Number, default: 1 },
  validation: { type: Schema.Types.Mixed },
  answersVerifiedBy: { type: ObjectId, ref: 'User' }, answersVerifiedAt: Date, answersVerifiedVersion: Number, approvedVersion: Number,
  submittedAt: Date, reviewedBy: { type: ObjectId, ref: 'User' }, reviewedAt: Date, publishedBy: { type: ObjectId, ref: 'User' }, publishedAt: Date,
  archivedBy: { type: ObjectId, ref: 'User' }, archivedAt: Date,
  audience: { levelId: { type: ObjectId, ref: 'AcademicLevel' }, yearOfStudy: Number, programmeIds: [{ type: ObjectId, ref: 'Programme' }], schoolIds: [{ type: ObjectId, ref: 'School' }], _id: false },
  source: { generated: { type: Boolean, default: false }, from: [{ kind: String, id: String, title: String, _id: false }], _id: false },
  createdBy: { type: ObjectId, ref: 'User', required: true },
}, opts).index({ subjectId: 1, status: 1, topic: 1 }));

/** Version snapshots and review history for bank questions and game designs (who did what, when). */
export const ContentVersion = mongoose.model('ContentVersion', new Schema({
  kind: { type: String, enum: ['question', 'game'], required: true }, refId: { type: ObjectId, required: true }, version: { type: Number, required: true },
  snapshot: { type: Schema.Types.Mixed, required: true }, reason: String, createdBy: { type: ObjectId, ref: 'User' },
}, { timestamps: { createdAt: true, updatedAt: false } }).index({ kind: 1, refId: 1, version: 1 }, { unique: true }));
export const ContentReview = mongoose.model('ContentReview', new Schema({
  kind: { type: String, enum: ['question', 'game'], required: true }, refId: { type: ObjectId, required: true, index: true },
  action: { type: String, enum: ['create', 'edit', 'submit', 'resubmit', 'approve', 'request_changes', 'reject', 'comment', 'publish', 'unpublish', 'archive', 'restore', 'verify_key'], required: true },
  version: Number, by: { type: ObjectId, ref: 'User' }, comment: String,
}, { timestamps: { createdAt: true, updatedAt: false } }));

/** Teacher-assigned assessment or mock exam, scoped to one school (and optionally a year group). */
export const Assessment = mongoose.model('Assessment', new Schema({
  title: { type: String, required: true }, subjectId: { type: ObjectId, ref: 'Subject', required: true, index: true },
  schoolId: { type: ObjectId, ref: 'School', required: true, index: true }, yearOfStudy: Number, classGroup: String, classId: { type: ObjectId, ref: 'ClassGroup', index: true },
  mode: { type: String, enum: ['assigned', 'mock'], required: true }, questionIds: [{ type: ObjectId, ref: 'Question' }],
  timeLimitSec: Number, randomize: { type: Boolean, default: true }, maxAttempts: { type: Number, default: 1 },
  opensAt: Date, closesAt: Date, showAnswers: { type: String, enum: ['after_submit', 'after_close'], default: 'after_submit' },
  status: { type: String, enum: ['draft', 'published', 'closed'], default: 'published' }, createdBy: { type: ObjectId, ref: 'User', required: true },
}, opts));

const response = new Schema({
  questionId: { type: ObjectId, ref: 'Question', required: true }, response: Schema.Types.Mixed, answeredAt: Date,
  score: Number, maxScore: Number, correct: Boolean, feedback: String, explanation: String, improvement: String, revisionTopic: String,
  parts: Schema.Types.Mixed, criteria: [{ criterion: String, marks: Number, maxMarks: Number, comment: String, _id: false }],
  markedBy: { type: String, enum: ['auto', 'ai_provisional', 'teacher', 'pending'] }, needsReview: Boolean,
  verifiedBy: { type: ObjectId, ref: 'User' }, verifiedAt: Date, teacherComment: String,
}, { _id: false });
/** One sitting. Server holds the presentation permutation so answers are never sent to the client before submission. */
export const Attempt = mongoose.model('Attempt', new Schema({
  userId: { type: ObjectId, ref: 'User', required: true, index: true }, subjectId: { type: ObjectId, ref: 'Subject', required: true, index: true },
  schoolId: { type: ObjectId, ref: 'School', index: true }, assessmentId: { type: ObjectId, ref: 'Assessment', index: true },
  mode: { type: String, enum: ATTEMPT_MODES, required: true }, topic: String, seed: Number,
  items: [{ questionId: { type: ObjectId, ref: 'Question' }, perm: Schema.Types.Mixed, _id: false }],
  responses: [response], startedAt: { type: Date, default: () => new Date() }, deadline: Date, submittedAt: Date,
  status: { type: String, enum: ['in_progress', 'submitted', 'pending_review', 'marked'], default: 'in_progress', index: true },
  score: Number, maxScore: Number, pct: Number, provisional: Boolean, revisionTopics: [String], autoSubmitted: Boolean,
}, opts));

/** Game play session: answer keys stay server-side in items; client gets the presented view. */
export const GameSession = mongoose.model('GameSession', new Schema({
  userId: { type: ObjectId, ref: 'User', required: true, index: true }, subjectId: { type: ObjectId, ref: 'Subject', required: true },
  game: { type: String, enum: GAMES, required: true }, topic: String, objective: String, seed: Number,
  designId: { type: ObjectId, ref: 'GameDesign', index: true }, designVersion: Number, title: String,
  settings: { pointsPerItem: Number, hintsEnabled: Boolean, hintCost: Number, streakBonus: Number, _id: false },
  items: [Schema.Types.Mixed], answers: [Schema.Types.Mixed], hintsUsed: { type: Number, default: 0 },
  startedAt: { type: Date, default: () => new Date() }, deadline: Date, finishedAt: Date,
  score: { type: Number, default: 0 }, maxScore: Number, accuracy: Number, xpAwarded: Number, status: { type: String, enum: ['active', 'finished'], default: 'active' },
}, opts));

/** Idempotent XP ledger: one row per (user, source, refId). */
export const XpEvent = mongoose.model('XpEvent', new Schema({
  userId: { type: ObjectId, ref: 'User', required: true }, subjectId: { type: ObjectId, ref: 'Subject' }, schoolId: { type: ObjectId, ref: 'School' },
  source: { type: String, required: true }, refId: { type: String, required: true }, xp: { type: Number, required: true }, reason: String, day: String,
}, { timestamps: { createdAt: true, updatedAt: false } }).index({ userId: 1, source: 1, refId: 1 }, { unique: true }).index({ schoolId: 1, day: 1 }));

export const UserReward = mongoose.model('UserReward', new Schema({
  userId: { type: ObjectId, ref: 'User', required: true, unique: true }, xp: { type: Number, default: 0 }, level: { type: Number, default: 1 },
  streak: { current: { type: Number, default: 0 }, longest: { type: Number, default: 0 }, lastDay: String },
  badges: [{ key: String, at: Date, _id: false }],
}, opts));

/** Per-topic mastery estimate (exponentially weighted), the basis of explainable recommendations. */
export const Mastery = mongoose.model('Mastery', new Schema({
  userId: { type: ObjectId, ref: 'User', required: true }, subjectId: { type: ObjectId, ref: 'Subject', required: true }, topic: { type: String, required: true },
  score: { type: Number, default: 0 }, answered: { type: Number, default: 0 }, correct: { type: Number, default: 0 }, lastAt: Date,
  history: [{ at: Date, frac: Number, _id: false }],
}, opts).index({ userId: 1, subjectId: 1, topic: 1 }, { unique: true }));
