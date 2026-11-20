import { normalizeGhPhone } from './phone';
import { z } from 'zod';

export const ROLES = ['super_admin', 'school_admin', 'curriculum_admin', 'curriculum_editor', 'content_reviewer', 'system_operator', 'teacher', 'counselor', 'student', 'parent'] as const;
export type Role = (typeof ROLES)[number];

/** Permission strings. Kept small and explicit; see docs/PERMISSIONS.md. */
export const PERMISSIONS = [
  'platform:manage', 'school:create', 'school:manage', 'config:manage', 'users:manage',
  'documents:upload', 'documents:map', 'content:edit', 'content:review', 'content:publish',
  'class:manage', 'activity:assign', 'progress:view_class', 'progress:view_own', 'progress:view_child',
  'learn:access', 'tutor:use', 'audit:view', 'analytics:view', 'meetings:request', 'meetings:host',
  // Admin panel (Phase 2)
  'admin:access', 'roles:assign', 'curriculum:manage', 'system:health',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  school_admin: ['admin:access', 'school:manage', 'config:manage', 'users:manage', 'roles:assign', 'class:manage', 'progress:view_class', 'audit:view', 'documents:upload', 'analytics:view'],
  /** Curriculum structure, manuals, processing, mappings and generation requests (spec §4). No learner data. */
  curriculum_admin: ['admin:access', 'config:manage', 'curriculum:manage', 'documents:upload', 'documents:map', 'content:edit', 'analytics:view'],
  curriculum_editor: ['admin:access', 'documents:upload', 'documents:map', 'content:edit'],
  content_reviewer: ['admin:access', 'content:review', 'content:publish', 'content:edit', 'analytics:view'],
  /** Service health, queues and operational logs (spec §4). No learner or content data. */
  system_operator: ['admin:access', 'system:health'],
  teacher: ['class:manage', 'activity:assign', 'progress:view_class', 'learn:access', 'tutor:use', 'meetings:host'],
  counselor: ['meetings:host'],
  student: ['learn:access', 'tutor:use', 'progress:view_own', 'meetings:request'],
  parent: ['progress:view_child'],
};
/** Roles that can see and edit learning content of every subject (content staff). */
export const CONTENT_STAFF_ROLES: readonly Role[] = ['super_admin', 'curriculum_admin', 'curriculum_editor', 'content_reviewer'];
/** Platform-level roles: granted only by a super admin, with platform scope. The rest are school-scoped. */
export const PLATFORM_ROLES: readonly Role[] = ['super_admin', 'curriculum_admin', 'curriculum_editor', 'content_reviewer', 'system_operator'];
export const SCHOOL_ROLES: readonly Role[] = ['school_admin', 'teacher', 'counselor', 'student', 'parent'];
export const ROLE_LABELS: Record<Role, string> = { super_admin: 'Super Admin', school_admin: 'School Admin', curriculum_admin: 'Curriculum Admin', curriculum_editor: 'Curriculum Editor', content_reviewer: 'Content Reviewer',
  system_operator: 'System Operator', teacher: 'Teacher', counselor: 'Counselor', student: 'Student', parent: 'Parent' };
export const permissionsOf = (roles: readonly Role[]) => [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))] as Permission[];
export const hasPermission = (roles: readonly Role[], p: Permission) => roles.some((r) => ROLE_PERMISSIONS[r]?.includes(p));

export const LEVEL_KINDS = ['SHS', 'JHS'] as const;
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const password = z.string().min(10, 'At least 10 characters').max(128)
  .regex(/[A-Za-z]/, 'Must contain a letter').regex(/[0-9]/, 'Must contain a number');

export * from './phone';
export const PHONE_HINT = 'Ghana mobile (MTN, Telecel or AirtelTigo), e.g. 024 123 4567';
/** Optional Ghana mobile number: empty, or a valid number (normalised to 0XXXXXXXXX by the server). */
const optionalPhone = z.string().trim().max(30).refine((v) => v === '' || !!normalizeGhPhone(v), { message: `Enter a ${PHONE_HINT}` }).optional();
export const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.email().max(254).transform((s) => s.toLowerCase()),
  phone: optionalPhone,
  password,
  dateOfBirth: z.iso.date().optional(),
  guardianEmail: z.email().optional().or(z.literal('')),
  acceptTerms: z.literal(true, { message: 'You must accept the terms' }),
});
/** Sign in with an email address or a verified Ghana phone number (sent in `email` for compatibility). */
export const loginSchema = z.object({ email: z.string().trim().min(3, 'Enter your email or phone number').max(254), password: z.string().min(1).max(128) });

/** The 16 administrative regions of Ghana (since 2019). */
export const GHANA_REGIONS = ['Ahafo', 'Ashanti', 'Bono', 'Bono East', 'Central', 'Eastern', 'Greater Accra', 'North East', 'Northern', 'Oti', 'Savannah', 'Upper East', 'Upper West', 'Volta', 'Western', 'Western North'] as const;
export type GhanaRegion = (typeof GHANA_REGIONS)[number];
/** "Learning Area" in the UI; stored as programmeId (DB name kept for compatibility). */
export const LEARNING_AREA = 'Learning Area';
const subjectList = z.array(objectId).max(40);
export const onboardingSchema = z.object({
  region: z.enum(GHANA_REGIONS, { message: 'Choose your region' }),
  /** Free text. Linked to a configured school when the name matches (or schoolId is given). */
  schoolName: z.string().trim().min(2, 'Enter your school name').max(160),
  schoolId: objectId.optional(),
  levelId: objectId,
  programmeId: objectId.optional(),
  yearOfStudy: z.number().int().min(1).max(3),
  coreSubjectIds: subjectList.default([]),
  electiveSubjectIds: subjectList.default([]),
  preferredLanguage: z.string().max(40).optional(),
  learningPreferences: z.array(z.enum(['visual', 'reading', 'practice', 'audio'])).max(4).default([]),
}).refine((v) => v.coreSubjectIds.length + v.electiveSubjectIds.length > 0, { message: 'Choose at least one subject', path: ['coreSubjectIds'] });
/** Student self-service profile edit (all optional). Subjects: both lists replace the current choice. */
export const profileUpdateSchema = z.object({
  region: z.enum(GHANA_REGIONS).optional(), schoolName: z.string().trim().min(2).max(160).optional(),
  yearOfStudy: z.number().int().min(1).max(3).optional(), programmeId: objectId.nullable().optional(),
  coreSubjectIds: subjectList.optional(), electiveSubjectIds: subjectList.optional(),
}).strict().refine((v) => (v.coreSubjectIds === undefined) === (v.electiveSubjectIds === undefined), { message: 'Send both coreSubjectIds and electiveSubjectIds', path: ['coreSubjectIds'] })
  .refine((v) => v.coreSubjectIds === undefined || v.coreSubjectIds.length + (v.electiveSubjectIds?.length ?? 0) > 0, { message: 'Choose at least one subject', path: ['coreSubjectIds'] });

export const MEETING_MODES = ['in_person', 'online'] as const;
export const MEETING_STATUSES = ['pending', 'awaiting_student', 'confirmed', 'declined', 'cancelled'] as const;
const httpsUrl = z.url({ protocol: /^https$/, message: 'Use an https:// meeting link' }).max(500);
export const slotSchema = z.object({
  start: z.coerce.date(), end: z.coerce.date(), modes: z.array(z.enum(MEETING_MODES)).min(1).default(['in_person', 'online']),
  location: z.string().trim().max(200).optional(), link: httpsUrl.optional(),
}).strict().refine((v) => v.end > v.start, { message: 'End must be after start', path: ['end'] })
  .refine((v) => v.end.getTime() - v.start.getTime() <= 4 * 3600_000, { message: 'A slot can be at most 4 hours', path: ['end'] });
export const meetingRequestSchema = z.object({
  hostId: objectId, slotId: objectId.optional(), start: z.coerce.date().optional(), durationMin: z.number().int().min(10).max(120).default(30),
  topic: z.string().trim().min(3).max(200), mode: z.enum(MEETING_MODES), link: httpsUrl.optional(), note: z.string().trim().max(1000).optional(),
}).strict().refine((v) => !!v.slotId !== !!v.start, { message: 'Pick a slot or propose a time (not both)', path: ['slotId'] });
export const meetingRespondSchema = z.object({
  action: z.enum(['accept', 'decline', 'reschedule', 'cancel']), start: z.coerce.date().optional(), durationMin: z.number().int().min(10).max(120).optional(),
  link: httpsUrl.optional(), location: z.string().trim().max(200).optional(), note: z.string().trim().max(1000).optional(),
}).strict().refine((v) => v.action !== 'reschedule' || !!v.start, { message: 'A new time is required to reschedule', path: ['start'] });

export const SCHOOL_STATUSES = ['active', 'suspended', 'archived'] as const;
export const SCHOOL_TYPES = ['public', 'private', 'mission', 'technical_vocational', 'other'] as const;
export type SchoolType = (typeof SCHOOL_TYPES)[number];
export const SCHOOL_TYPE_LABELS: Record<(typeof SCHOOL_TYPES)[number], string> = { public: 'Public', private: 'Private', mission: 'Mission', technical_vocational: 'Technical / vocational', other: 'Other' };
const phone = z.string().trim().max(30).regex(/^[+0-9 ()-]*$/, 'Use digits, spaces, +, - or brackets');
export const schoolContactSchema = z.object({
  email: z.email().max(254).optional().or(z.literal('')), phone: phone.optional(), address: z.string().trim().max(300).optional(), headName: z.string().trim().max(120).optional(),
}).strict();
/** Unique identifier: 2–20 letters, digits or hyphens; stored upper-case (e.g. GES-0123). */
export const schoolCodeSchema = z.string().trim().min(2).max(20).regex(/^[A-Z0-9-]+$/i, 'Use letters, digits and hyphens only').transform((s) => s.toUpperCase());
export const schoolSchema = z.object({
  name: z.string().trim().min(2).max(160), code: schoolCodeSchema,
  region: z.enum(GHANA_REGIONS).optional(), district: z.string().trim().max(80).optional(),
  type: z.enum(SCHOOL_TYPES).optional(), contact: schoolContactSchema.optional(),
  levelKinds: z.array(z.enum(LEVEL_KINDS)).min(1).default(['SHS']), programmeIds: z.array(objectId).max(30).optional(),
  active: z.boolean().default(true),
});
/** Fields a School Admin may change on their own school (name, identifier and status stay with the super admin). */
export const SCHOOL_ADMIN_EDITABLE = ['region', 'district', 'type', 'contact', 'levelKinds', 'programmeIds', 'settings'] as const;
export const schoolStatusSchema = z.object({ status: z.enum(SCHOOL_STATUSES), reason: z.string().trim().max(300).optional() }).strict();
export const levelSchema = z.object({ kind: z.enum(LEVEL_KINDS), name: z.string().trim().min(2).max(60), years: z.number().int().min(1).max(6), enabled: z.boolean().default(true), order: z.number().int().min(0).max(10_000).optional() });
export const programmeSchema = z.object({ name: z.string().trim().min(2).max(120), code: z.string().trim().min(2).max(20), levelId: objectId, description: z.string().max(500).optional(), active: z.boolean().default(true), order: z.number().int().min(0).max(10_000).optional() });
export const subjectSchema = z.object({
  name: z.string().trim().min(2).max(120), code: z.string().trim().min(2).max(20), levelId: objectId,
  category: z.enum(['core', 'elective']), programmeIds: z.array(objectId).default([]), curriculumVersion: z.string().max(40).optional(), curriculumVersionId: objectId.nullable().optional(), active: z.boolean().default(true), /** Extra names that find this subject in search (e.g. 'Computer Science' on Computing); stored as provenance.aliases. */ aliases: z.array(z.string().trim().min(2).max(80)).max(20).optional(), order: z.number().int().min(0).max(10_000).optional(),
});
export const combinationSchema = z.object({
  name: z.string().trim().min(2).max(120), programmeId: objectId, subjectIds: z.array(objectId).min(1).max(12),
  minElectives: z.number().int().min(0).max(8).default(0), maxElectives: z.number().int().min(0).max(8).default(4),
  /** Combinations are per Learning Area and, optionally, per year of study and per school (spec §8, not one universal set). */
  yearOfStudy: z.number().int().min(1).max(6).nullable().optional(), schoolId: objectId.nullable().optional(), active: z.boolean().default(true), order: z.number().int().min(0).max(10_000).optional(),
});
export const academicYearSchema = z.object({ label: z.string().regex(/^\d{4}\/\d{4}$/), startDate: z.iso.date(), endDate: z.iso.date(), current: z.boolean().default(false), order: z.number().int().min(0).max(10_000).optional() });

export type RegisterInput = z.input<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type OnboardingInput = z.input<typeof onboardingSchema>;
export type ProfileUpdate = z.input<typeof profileUpdateSchema>;
export interface ApiError { error: { code: string; message: string; details?: unknown; requestId?: string } }
export interface PublicUser { id: string; email: string; phone?: string | null; phoneVerified?: boolean; fullName: string; roles: Role[]; schoolId?: string; onboarded: boolean; isSample?: boolean; lastLoginAt?: string; mustChangePassword?: boolean }

/** Role grant request (scope is implied: platform roles → platform, school roles → the target's school). */
export const roleGrantSchema = z.object({ userId: objectId, role: z.enum(ROLES), schoolId: objectId.optional() }).strict();
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict();
/** Self-service "forgot password": the account email. Login is by email; there are no separate usernames. */
export const forgotPasswordSchema = z.object({ identifier: z.string().trim().min(3, 'Enter your email address or phone number').max(254) }).strict();
/** Completing a reset: the link token, or the account email / verified phone plus the 12-character code (staff-issued or sent by SMS). */
export const resetPasswordSchema = z.union([
  z.object({ token: z.string().min(40).max(100), newPassword: password }).strict(),
  z.object({ email: z.email().transform((s) => s.toLowerCase()), code: z.string().trim().min(12).max(20), newPassword: password }).strict(),
  z.object({ phone: z.string().trim().min(9).max(30), code: z.string().trim().min(12).max(20), newPassword: password }).strict(),
]);
export const PASSWORD_HINT = 'At least 10 characters with a letter and a number.';

/** Forms a teacher can teach (teacher applications); "SHS 2" maps to a SHS subject with yearOfStudy 2. */
export const TEACHING_LEVELS = ['JHS 1', 'JHS 2', 'JHS 3', 'SHS 1', 'SHS 2', 'SHS 3'] as const;
/**
 * Public teacher application (no password: one is chosen after an admin approves). `website` is a honeypot that people
 * never see or fill. School: an existing schoolId, or free text when the school is not listed.
 */
export const teacherApplicationSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  email: z.email('Enter a valid email address').max(254).transform((s) => s.toLowerCase()),
  phone: optionalPhone,
  region: z.enum(GHANA_REGIONS, { message: 'Choose your region' }),
  schoolId: objectId.optional().or(z.literal('')),
  schoolName: z.string().trim().max(160).optional().or(z.literal('')),
  subjectIds: z.array(objectId).min(1, 'Choose at least one subject').max(12),
  levels: z.array(z.enum(TEACHING_LEVELS)).min(1, 'Choose the forms you teach').max(6),
  staffId: z.string().trim().max(40).optional().or(z.literal('')),
  ntcNumber: z.string().trim().max(40).optional().or(z.literal('')),
  note: z.string().trim().max(500).optional().or(z.literal('')),
  consent: z.literal(true, { message: 'Please confirm the details and accept the terms' }),
  website: z.string().max(200).optional(),
}).strict().refine((v) => !!v.schoolId || (v.schoolName ?? '').trim().length >= 3, { message: 'Choose your school, or type its name if it is not listed', path: ['schoolName'] });
/** Admin decision on a teacher application. */
export const approveTeacherSchema = z.object({
  schoolId: objectId, subjectIds: z.array(objectId).min(1).max(12), levels: z.array(z.enum(TEACHING_LEVELS)).min(1).max(6),
  fullName: z.string().trim().min(2).max(120).optional(),
}).strict();
export const rejectTeacherSchema = z.object({ reason: z.string().trim().min(5, 'Give a short reason (at least 5 characters)').max(500) }).strict();
/** Choosing a password from an invitation (set-password) link. */
export const setPasswordSchema = z.object({ token: z.string().min(40).max(100), newPassword: password }).strict();

/** Admin-created account (spec §7). The server generates a temporary password; the user must change it at first sign-in. */
export const createUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120), email: z.email().max(254).transform((s) => s.toLowerCase()),
  role: z.enum(ROLES), schoolId: objectId.optional(),
  /** Optional Ghana mobile number, stored unverified (the person verifies it on their Account page). */
  phone: optionalPhone,
}).strict();
export const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(), email: z.email().max(254).transform((s) => s.toLowerCase()).optional(),
  roles: z.array(z.enum(ROLES)).min(1).optional(), status: z.enum(['active', 'suspended']).optional(), schoolId: objectId.optional(),
}).strict();
export const classSchema = z.object({
  name: z.string().trim().min(2).max(80), schoolId: objectId.optional(), subjectId: objectId.nullable().optional(), yearOfStudy: z.number().int().min(1).max(6).nullable().optional(),
  academicYearId: objectId.nullable().optional(), programmeId: objectId.nullable().optional(), teacherIds: z.array(objectId).max(10).default([]),
}).strict();
/** Enrolment CSV template (spec §15). Header names are matched case-insensitively. */
export const ENROLMENT_COLUMNS = ['email', 'full_name', 'class', 'year_of_study', 'academic_year'] as const;
export const ENROLMENT_REQUIRED = ['email', 'class'] as const;

// ---- Phase 5: curriculum versions and the learner-manual library (spec §9, Curriculum Management) ----
export const CURRICULUM_VERSION_STATUSES = ['draft', 'active', 'archived'] as const;
export type CurriculumVersionStatus = (typeof CURRICULUM_VERSION_STATUSES)[number];
export const curriculumVersionSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9][\w .\/-]*$/, 'Use letters, digits, spaces, dots, slashes and hyphens'),
  name: z.string().trim().min(2).max(160),
  levelId: objectId.nullable().optional(),
  effectiveFrom: z.iso.date().nullable().optional(), effectiveTo: z.iso.date().nullable().optional(),
  publisher: z.string().trim().max(200).optional(), description: z.string().trim().max(2000).optional(),
}).strict();
export const DOC_TYPES = ['learner_manual', 'teacher_manual', 'curriculum', 'assessment', 'guide', 'other'] as const;
export const DOC_TYPE_LABELS: Record<(typeof DOC_TYPES)[number], string> = { learner_manual: 'Learner manual', teacher_manual: 'Teacher manual', curriculum: 'Curriculum', assessment: 'Assessment', guide: 'Guide', other: 'Other' };
/** Accepted upload formats. `ext` and `mimes` are both checked, then the content is sniffed on the server. */
export const MANUAL_FORMATS = {
  pdf: { label: 'PDF', ext: ['.pdf'], mimes: ['application/pdf', 'application/x-pdf'] },
  docx: { label: 'Word (DOCX)', ext: ['.docx'], mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  txt: { label: 'Plain text', ext: ['.txt'], mimes: ['text/plain'] },
  csv: { label: 'CSV', ext: ['.csv'], mimes: ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'] },
} as const;
export type ManualKind = keyof typeof MANUAL_FORMATS;
export const MANUAL_KINDS = Object.keys(MANUAL_FORMATS) as ManualKind[];
/** Detects the kind from a file name; the server re-checks the bytes. */
export const manualKindOf = (filename: string): ManualKind | null => { const n = filename.toLowerCase(); return MANUAL_KINDS.find((k) => MANUAL_FORMATS[k].ext.some((e) => n.endsWith(e))) ?? null; };
export const LICENSING_STATUSES = ['unknown', 'open_licence', 'public_domain', 'permission_granted', 'restricted'] as const;
export const LICENSING_LABELS: Record<(typeof LICENSING_STATUSES)[number], string> = { unknown: 'Unknown', open_licence: 'Open licence', public_domain: 'Public domain', permission_granted: 'Permission granted', restricted: 'Restricted (no redistribution)' };
/** Licensing statuses that allow downloading the original; Curriculum Admins and Super Admins may always download. */
export const DOWNLOADABLE_LICENSING = ['open_licence', 'public_domain', 'permission_granted'] as const;
export const OCR_STATUSES = ['not_needed', 'needed_not_configured', 'partial', 'done'] as const;
export const OCR_STATUS_LABELS: Record<(typeof OCR_STATUSES)[number], string> = { not_needed: 'Text layer present', needed_not_configured: 'OCR needed / not configured', partial: 'OCR partial', done: 'OCR done' };
export const APPROVAL_STATUSES = ['unverified', 'verified_official', 'rejected'] as const;
export const manualMetaSchema = z.object({
  title: z.string().trim().min(3).max(200), subjectId: objectId.nullable(), levelId: objectId.nullable(), programmeId: objectId.nullable(),
  yearOfStudy: z.number().int().min(1).max(6).nullable(), curriculumVersionId: objectId.nullable(), docType: z.enum(DOC_TYPES),
  audience: z.enum(['learner', 'teacher', 'both', 'unknown']), publisher: z.string().trim().max(200), sourceUrl: z.union([z.url().max(500), z.literal('')]),
  publicationYear: z.number().int().min(1950).max(2100).nullable(), language: z.string().trim().min(2).max(20), documentVersion: z.string().trim().max(40),
  licensingStatus: z.enum(LICENSING_STATUSES), tags: z.array(z.string().trim().min(1).max(40)).max(20),
}).partial().strict();
export type ManualMeta = z.infer<typeof manualMetaSchema>;

// ---------------- §20 platform settings (shared by the server schema and the web app) ----------------
/** Colour presets for the brand palette. Every 700/800/900 shade meets WCAG AA (4.5:1) for white text and on white. */
export const THEME_PRESETS = {
  green: { label: 'Forest green (default)', 50: '#ecfdf5', 100: '#d1fae5', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b' },
  blue: { label: 'Royal blue', 50: '#eff6ff', 100: '#dbeafe', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a' },
  teal: { label: 'Teal', 50: '#f0fdfa', 100: '#ccfbf1', 600: '#0d9488', 700: '#0f766e', 800: '#115e59', 900: '#134e4a' },
  purple: { label: 'Purple', 50: '#f5f3ff', 100: '#ede9fe', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95' },
  maroon: { label: 'Maroon', 50: '#fff1f2', 100: '#ffe4e6', 600: '#e11d48', 700: '#be123c', 800: '#9f1239', 900: '#881337' },
} as const;
export type ThemePreset = keyof typeof THEME_PRESETS;
export const THEME_KEYS = Object.keys(THEME_PRESETS) as ThemePreset[];
/** Feature flags (§20). Each one is enforced on the server routes of that feature; the app hides switched-off features. */
export const FEATURE_FLAGS = {
  selfRegistration: 'Self-registration (sign up without an invitation)',
  tutor: 'AI tutor', practice: 'Practice and quizzes', games: 'Learning games', meetings: 'Meetings', assessments: 'Teacher assessments',
} as const;
export type FeatureFlag = keyof typeof FEATURE_FLAGS;
