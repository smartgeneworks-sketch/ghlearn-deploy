import { z } from 'zod';
const env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  MONGODB_URI: z.string().optional(), MONGODB_DB: z.string().optional(),
  BOOTSTRAP_ON_START: z.string().default('false'), BOOTSTRAP_DATA_DIR: z.string().default('data'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
  ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().default(14),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: z.string().optional(),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  /** Shared cookie Domain (e.g. .ghlearn.com). Empty = host-only cookies on the API host. */
  COOKIE_DOMAIN: z.string().optional(),
  APP_URL: z.string().optional(),
  SELF_REGISTRATION: z.string().default('true'),
  LOG_LEVEL: z.string().default('info'),
  STORAGE_PROVIDER: z.enum(['gridfs', 'drive']).default('gridfs'),
  UPLOAD_MAX_MB: z.coerce.number().default(60),
  /** Cap on bytes we keep in GridFS (it counts toward Atlas M0's 512 MB). Uploads beyond it are refused with 507. */
  GRIDFS_QUOTA_MB: z.coerce.number().default(150),
  REMOTE_FETCH_HOSTS: z.string().default('curriculumresources.edu.gh,drive.usercontent.google.com'),
  WORKER_ENABLED: z.string().default('true'), WORKER_POLL_MS: z.coerce.number().default(3000),
  OCR_LANG: z.string().default('eng'), OCR_MAX_PAGES: z.coerce.number().default(40),
  EMBEDDING_BASE_URL: z.string().optional(), EMBEDDING_DIMENSIONS: z.coerce.number().optional(),
  GEMINI_API_KEY: z.string().optional(),
  LLM_DAILY_REQUEST_BUDGET: z.coerce.number().default(40), LLM_DAILY_TOKEN_BUDGET: z.coerce.number().default(2_000_000),
  /** Monthly hard caps (first-run defaults; live values are in AI settings). Cost is the app's estimate from the configured token rates; 0 = no cost cap. */
  LLM_MONTHLY_REQUEST_BUDGET: z.coerce.number().int().min(0).default(10_000), LLM_MONTHLY_COST_BUDGET_USD: z.coerce.number().min(0).default(10),
  /** First-run defaults only: the live values are stored in the AI settings record (§17) and edited in the admin panel. */
  AI_USER_DAILY_REQUESTS: z.coerce.number().default(30), AI_SCHOOL_DAILY_REQUESTS: z.coerce.number().default(200),
  /** Email for notifications (§18). Unset = email is "not configured" and only in-app delivery happens. `json` = test transport (NODE_ENV=test only). */
  SMTP_URL: z.string().optional(), EMAIL_FROM: z.string().optional(),
  /** Alternative to SMTP_URL: discrete SMTP settings (e.g. Brevo smtp-relay.brevo.com:587 with its SMTP login/key). */
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(), SMTP_USER: z.string().optional(), SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  /** HTTP email API instead of SMTP: brevo or resend, with EMAIL_API_KEY. SMTP wins when both are set. */
  EMAIL_API_PROVIDER: z.enum(['brevo', 'resend']).optional(), EMAIL_API_KEY: z.string().optional(),
  /** SMS (BMS Africa / mNotify v2). The key lives only in the environment. SMS_PROVIDER=test is an in-memory fake for NODE_ENV=test. */
  SMS_PROVIDER: z.enum(['mnotify', 'test']).optional(), BMS_API_KEY: z.string().optional(), SMS_SENDER_ID: z.string().max(11).optional(),
  SMS_API_BASE: z.string().default('https://api.mnotify.com/api'),
  /** 'true' sends codes with sms_type "otp" (BMS OTP routing, charged in GHS from the main wallet, not SMS credits). Off by default: codes go as normal SMS on credits. */
  SMS_OTP_ROUTE: z.enum(['true', 'false']).default('false'),
  /** Encrypts POST /api/admin/system/backup exports (scripts/backup). Unset = endpoint answers 503. Never logged. */
  BACKUP_PASSPHRASE: z.string().optional(),
  /** Self-service reset link lifetime (minutes) and staff-issued link/code lifetime (hours). */
  PASSWORD_RESET_MINUTES: z.coerce.number().int().min(5).max(120).default(30), STAFF_RESET_HOURS: z.coerce.number().int().min(1).max(72).default(24),
  TUTOR_DAILY_MESSAGES_PER_USER: z.coerce.number().default(60), TUTOR_RETENTION_DAYS: z.coerce.number().default(180),
  VECTOR_SEARCH: z.enum(['local', 'atlas']).default('local'), QUESTION_CROSSCHECK: z.string().default('true'), ATTEMPT_GRACE_SEC: z.coerce.number().default(10),
  // Cost estimate only (USD per 1M tokens); free tier is billed $0. Embeddings counted at input rate.
  AI_COST_INPUT_PER_M: z.coerce.number().default(0.3), AI_COST_EMBED_PER_M: z.coerce.number().default(0.15), RENDER_EXTERNAL_URL: z.string().optional(), AI_COST_OUTPUT_PER_M: z.coerce.number().default(2.5),
  // AI provider layer (Phase 3+). Unset = feature disabled, never faked.
  LLM_PROVIDER: z.string().optional(), LLM_API_KEY: z.string().optional(), LLM_MODEL: z.string().optional(),
  EMBEDDING_PROVIDER: z.string().optional(), EMBEDDING_API_KEY: z.string().optional(), EMBEDDING_MODEL: z.string().optional(),
  OCR_PROVIDER: z.string().optional(), IMAGE_PROVIDER: z.string().optional(), IMAGE_API_KEY: z.string().optional(),
});
const parsed = env.safeParse(process.env);
if (!parsed.success) { console.error('Invalid environment:', parsed.error.issues.map((i) => `${i.path}: ${i.message}`).join('; ')); process.exit(1); }
const e = parsed.data;
export const config = {
  ...e,
  isProd: e.NODE_ENV === 'production',
  corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : e.NODE_ENV === 'production',
  cookieDomain: e.COOKIE_DOMAIN?.trim() || undefined,
    appUrl: e.APP_URL?.trim().replace(/\/+$/, '') || undefined,
  remoteHosts: e.REMOTE_FETCH_HOSTS.split(',').map((s) => s.trim()).filter(Boolean),
  selfRegistration: e.SELF_REGISTRATION === 'true',
};
