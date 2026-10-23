# GH Learn admin panel: final implementation report (spec §26)

- **Scope:** spec `docs/ADMIN_SPEC.md`, §1–§26, built in ten phases (Oct 2026), with the Phase 1 baseline at commit 8b150f2.
- **Phase detail:** `docs/ADMIN_PANEL.md` §10–§18.
- **Live:** web https://ghlearn.com, API https://api.ghlearn.com (the old web.app URL redirects).

## 1. Features completed
All 16 sidebar sections of §3 are live. Each is permission-filtered, and the server enforces the same rules.

| # | Section | Route | Main capabilities |
|---|---|---|---|
| 1 | Overview (§5) | `/admin` | live cards, zero-filled time-series charts, filters (date, level, school, subject), deep links, role-appropriate warnings and activity feeds |
| 2 | Schools (§6) | `/admin/schools` | create, edit, status (active/suspended/archived; members blocked at once), region/district/type/contact, levels and Learning Areas offered, school combinations, school admins, usage |
| 3 | Users (§7) | `/admin/users` | create with a one-time temporary password (forced change), suspend/reactivate, reset and unlock, sessions (revoke one or all), scoped role assignments with grant rules, school move, audit history |
| 4 | Academic Structure (§8) | `/admin/structure` | levels, years (one current), Learning Areas, subjects, combinations: edit, reorder, activate, archive/restore, reference-checked delete |
| 5 | Curriculum Management (§8) | `/admin/curriculum` | curriculum version records (draft → active → archived), subject links, element tree (strand → indicator) with verify, reorder and archive |
| 6 | Learner Manuals (§9) | `/admin/documents` | streamed PDF/DOCX/TXT/CSV upload with progress, validation, duplicates and quota; full metadata; approval separate from processing; preview; licensed download; replacement versions; archive; delete |
| 7 | AI Content Generation (§11) | `/admin/lessons` | 14 real content types, options, approved-sources-only grounding, estimate before generating, section regeneration, versions, compare with sources |
| 8 | Content Review and Publishing (§12) | `/admin/review` | queue, assignment, comments, approve or request changes (no self-approval), publish with an audience, unpublish, archive, publish gates |
| 9 | Question Bank and Assessments (§13) | `/admin/questions` | 11 question types, manual and AI creation, key check, student preview, review workflow, usage, versions, assessments |
| 10 | Educational Games (§14) | `/admin/games` | 10 engine types, editor, validation and dry run, preview, review and publishing, stats |
| 11 | Classes and Enrolments (§15) | `/admin/classes` | form and subject classes, teachers, enrolment, transfers, year rollover (dry run), CSV import with preview, commit and rollback |
| 12 | Learning Analytics (§16) | `/admin/analytics` | 13 labelled reports (Measured/Estimate/Suggestion/AI), small-group suppression, the audited student-level view, CSV/Excel |
| 13 | AI Usage and Costs (§17) | `/admin/ai-usage` | usage by feature, provider, school, user and day; limits stored in the database and enforced on every call; alerts; real health checks; providers and model selection; keys shown only as set or unset |
| 14 | Notifications (§18) | `/admin/notifications` | inbox, preferences, announcements (scope, audience, period, privacy check, delivery status), event notifications, daily review reminders |
| 15 | Audit Logs (§19) | `/admin/audit` | append-only log with diffs, request ids, outcomes; filters; CSV/Excel export (audited) |
| 16 | System Settings (§20) | `/admin/system` | branding, logo, theme, academic year and levels, review policy, AI defaults, uploads, notifications, retention (real daily job), sessions, offline policy, feature flags, maintenance mode (server-enforced, admins exempt), terms and privacy; confirmation for high-impact changes; audited diffs; Status tab |

- **Also built:**
  - the Document Processing Monitor (`/admin/processing`, §10), with spec statuses, measured progress, safe idempotent retry, cancel, a purge with dry run, and health
  - global search
  - account settings with own sessions
  - the shared confirmation dialog
  - DataTable (server pagination, sort, URL filters)
  - public `/terms` and `/privacy` pages
  - maintenance screen and banner
- **Roles:** Super Admin, School Admin, Curriculum Admin, Curriculum Editor, Content Reviewer, System Operator, Teacher, Counselor, Student and Parent.

## 2. Files and modules created or changed
Against the baseline there are 168 files changed, about 13,900 lines added and 1,130 removed.

**Server (`server/src`).**
- **Routes, new:** `adminPanel.ts` (overview, search, system), `adminUsers.ts`, `adminSchools.ts`, `adminClasses.ts`, `curriculum.ts`, `jobs.ts`, `gameDesigns.ts`, `aiAdmin.ts`, `announcements.ts`, `settings.ts`.
- **Routes, extended:** `admin.ts`, `analytics.ts`, `auth.ts`, `config.ts`, `documents.ts`, `lessons.ts`, `practice.ts`, `questions.ts`, `students.ts`, `teacher.ts`, `tutor.ts`.
- **Services, new:**
  - overview and analytics: `adminOverview`, `adminCharts`, `learningAnalytics`
  - AI: `aiSettings`, `aiHealth`, `aiUsageReport`
  - notifications and email: `announcements`, `eventNotifications`, `mailer`
  - exports and jobs: `exporter` (CSV and a self-written XLSX), `jobMonitor`
  - uploads and imports: `manualUpload`, `ingest/textFormats`, `enrolmentImport`
  - roles, eligibility and references: `roles`, `eligibility`, `references`, `assess/review`
  - start-up and settings: `migrations`, `platformSettings`, `retention`
- **Services, extended:** `ai`, `usage`, `notify`, `queue`, `auth`, `analytics`, `ingest/pipeline`, `ingest/pdf`, `lessons/generator`, `assess/*`, `teach/classes`, `retrieval`, `schools`, `storage`.
- **Libraries and middleware:** `lib/list.ts`, `lib/patch.ts` and `lib/audit.ts` (diff, redaction, append-only). `middleware/index.ts` adds `requireAnyPermission`, the school-status check, the forced password change, maintenance and `requireFeature`.
- **Models:** `models/ops.ts` is new; `index.ts`, `teach.ts` and `assess.ts` are extended.

**Shared.** `shared/src/index.ts`: roles and permissions, schemas, manual formats, theme presets, feature flags.

**Web (`web/src`).**
- **Admin, new:** `AdminLayout`, `nav`, `DataTable`, `common`, `pages`, `users`, `schools`, `structure`, `classes`, `curriculum`, `jobs`, `insights`, `settings` and `OverviewCharts`.
- **Shared parts, new:** `components/ConfirmDialog`, `lib/platform.tsx` (branding, theme, maintenance, flags), `lib/lessonStatus.ts`, `manuals/shared.tsx`.
- **Pages, extended:** `Auth` (legal pages), `Documents`, `Lessons`, `QuestionBank`, `GameDesigns`, `Learn`, `Teach`, `Analytics`; `pages/Admin.tsx` was removed.

**Tests.** The server, web unit and E2E files are listed in §5.

**Docs.** `ADMIN_PANEL.md`, `ADMIN_PANEL_REPORT.md`, `SETUP.md` and `API_ROUTES.md` (generated) are new. `API.md`, `DEPLOYMENT.md`, `SECURITY.md`, `README.md` and `server/.env.example` were updated. `server/scripts/list-routes.ts` is a new script.

## 3. Database changes
- **New collections:**
  - `RoleAssignment`: scoped roles
  - `ImportBatch`: CSV enrolment previews and rollback records
  - `CurriculumVersion`
  - `ContentReview`, `ContentVersion`: question and game review history and versions
  - `GameDesign`
  - `AiSettings`: §17 limits and the LLM model
  - `AiHealthCheck`, `AiAlert`
  - `Announcement`, `NotificationPreference`
  - `ResourceProgress`: lesson opens and completion
  - `PlatformSettings`: §20, one document with `data`, `version` and `legalVersion`
- **Extended:**
  - `User`: mustChangePassword, revoked sessions, sessionsRevokedAt, createdBy
  - `School`: status replaces `active`; adds type, contact, district and offerings
  - `AuditLog`: requestId, entityType, outcome, before/after, schoolId; append-only, with deletion only through the maintenance option used by the retention job
  - `Job`: stages, failedStage, retryOf, documentId, cancellation
  - `CurriculumDocument`: §9 metadata, kind, version group, supersededBy, approval, ocrStatus
  - `Lesson` and `LearningResource`: review assignment, history, audience
  - `Notification`: delivery status per channel, including `disabled`
  - `AcademicYear` and `AcademicLevel`: order and archive fields
- **Indexes:**
  - unique `(documentId, ordinal)` on passages
  - TTL on tutor conversations, tutor messages and refresh tokens
  - the analytics and monitor indexes listed in `ADMIN_PANEL.md` §4
- **Migrations:** `services/migrations.ts` runs at start-up and is idempotent:
  - school status
  - manual version groups and kinds
  - job documentId
  - removal of duplicate passages before the unique index is built
  - curriculum version labels turned into version records
- **Secrets:** none are stored in the database. The settings schema has no secret fields, and credential-like values are refused.

## 4. API endpoints
- **Inventory:** 317 routes; the generated list is in `docs/API_ROUTES.md` and the payloads and errors are in `docs/API.md`.
- **Main admin groups:**
  - `/api/admin/{overview,search,system}`
  - `/api/admin/users*` (12), `/api/admin/schools*` (13), `/api/admin/classes*` (13), `/api/admin/imports*` (8)
  - `/api/admin/role-assignments`, `/api/admin/teacher-assignments`
  - `/api/admin/audit*`
  - `/api/admin/ai/{usage,usage/export,settings,models,health}`
  - `/api/admin/settings{,/check,/academic-year,/retention,/retention/run}`
  - `/api/config/*` (structure CRUD), `/api/curriculum/*` (versions and elements), `/api/documents/*` (manuals), `/api/jobs/*` (monitor)
  - `/api/lessons/*`, `/api/questions/*`, `/api/game-designs/*`, `/api/announcements/*`
  - `/api/analytics/{reports,reports/:key/export,recommendations,filters}`
- **Public:** `/api/settings/public` and `/api/settings/legal/:kind`.
- **Error contract:** `{ error: { code, message, details?, requestId } }` with:

  | Status | Codes |
  |---|---|
  | 401 | UNAUTHENTICATED |
  | 403 | FORBIDDEN, FEATURE_DISABLED, SCHOOL_INACTIVE, PASSWORD_CHANGE_REQUIRED |
  | 404 | not found |
  | 409 | CONFIRM_REQUIRED, IN_USE, PREVIEW_STALE |
  | 413 | FILE_TOO_LARGE, INPUT_TOO_LARGE |
  | 415 | UNSUPPORTED_FILE |
  | 422 | VALIDATION, SECRET_REJECTED, NO_APPROVED_SOURCES |
  | 429 | budgets and limits |
  | 503 | MAINTENANCE, AI_UNAVAILABLE |
  | 507 | STORAGE_QUOTA |

## 5. Tests and results (final run, 15 Oct 2026)
| Suite | Result |
|---|---|
| Server API (vitest + supertest, in-memory MongoDB): 26 files | **263 / 263 passed** (baseline 85) |
| Web unit (vitest + Testing Library): 7 files | **24 / 24 passed** (baseline 14) |
| Browser E2E (Playwright + axe, production build, in-memory API, scripted test LLM) | **76 / 76 passed** (baseline 20) |
| Type checks (server, web) | clean |

- **§23 coverage:**
  - **Admin auth and RBAC:** `adminpanel`, `adminusers`, `access`
  - **School isolation:** `adminusers`, `adminclasses`, `learninganalytics`
  - **Manual upload and management:** `manuals`, `documents`
  - **Curriculum CRUD:** `adminstructure`
  - **AI job handling:** `jobs`, `queue`, `phase7`
  - **Review workflow and publishing restrictions:** `phase7`, `lessons`
  - **Question bank and game publishing:** `phase8`, `assess`
  - **CSV import validation:** `adminclasses`
  - **Analytics authorisation:** `learninganalytics`, `admincharts`
  - **Secret protection:** `security`, `auditcoverage`, `phase9`
  - **Audit creation:** `auditcoverage`
  - **Settings validation:** `phase10`
  - **Direct-API denial for every route:** the generated route-by-role matrix in `security.test.ts`
  - **Frontend authorisation:** `admin.spec`, `denial.spec`, App unit tests
- **Accessibility:** WCAG 2.1 A/AA axe scans, failing on serious or critical issues, run on every admin page:
  - desktop, phone (360 px) and tablet (768 px)
  - the learner and teacher pages
  - dialogs, the maintenance screen and the legal pages

### Live verification (15 Oct 2026, commit 89fffd4)
- **Deployed build:**
  - Render serves deploy snapshot 89fffd4.
  - Firebase serves the web build of the latest web code (`index-9fQMpAFA.js`); 89fffd4 changed server code only.
- **Route-matrix denial on the live API:**
  - Every `/api/admin/*` route and method (73) was called as anonymous (401 ×73), and as a student, a teacher and a counselor (403 ×73 each), with **0 successes**.
  - Platform-only writes were refused (403) for a school admin, an operator and an editor: settings PATCH, retention run, academic year, AI settings and school reorder.
- **Settings:**
  - Super Admin reads all 11 sections (`canEdit` true).
  - A credential-like value is refused (422 SECRET_REJECTED).
  - A tagline change shows on `/api/settings/public` and was reverted.
  - Every change appears in the audit log as `settings.update` with the changed keys.
- **Maintenance:**
  - Without `confirm` the server answers 409 CONFIRM_REQUIRED, with the reason.
  - When on, the Super Admin keeps working (200), while a signed-in student and a fresh student sign-in both get 503 MAINTENANCE.
  - When off, the student is back (200) and public settings show `enabled: false`.
- **AI providers:**
  - Keys are shown only as set or unset (GEMINI_API_KEY set; the others unset).
  - The OCR row reads "Not configured".
  - The model list comes from the provider (34 models) and uses no generation quota; no Gemini generation calls were made in Phase 10 verification.
- **Browser check (live site, Playwright + axe):** for Super Admin, School Admin, Curriculum Admin, System Operator and a student:
  - sidebars match their roles;
  - 30 admin pages render with a clean axe scan, including System settings and its Status tab;
  - direct URLs outside each role are denied.
  - Result: **ALL OK**.
- **Live state afterwards:** settings were restored to their defaults (maintenance off, original tagline), and temporary files were removed.

## 6. Required environment variables
- **Required in production:**
  - `NODE_ENV=production`
  - `MONGODB_URI` and `MONGODB_DB`
  - `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (at least 32 characters each)
  - `CORS_ORIGINS`
  - `COOKIE_SECURE=true` and `COOKIE_SAMESITE=none` (cross-site deploy)
  - `WORKER_ENABLED=true`
- **For AI:** `GEMINI_API_KEY`, or `LLM_PROVIDER` plus `LLM_API_KEY`, `EMBEDDING_*` and `VECTOR_SEARCH=atlas`.
- **Optional:**
  - `SMTP_URL` and `EMAIL_FROM` (email)
  - `OCR_PROVIDER=tesseract` (needs RAM)
  - `IMAGE_PROVIDER` and `IMAGE_API_KEY` (no adapter built in)
  - `BOOTSTRAP_ON_START`, `SEED_PASSWORD`, `LOG_LEVEL`
- **Ceilings and first values:**
  - Ceilings: `UPLOAD_MAX_MB`, `OCR_MAX_PAGES`, `SELF_REGISTRATION`.
  - Seeds for the stored settings: `ACCESS_TTL_SECONDS`, `REFRESH_TTL_DAYS`, `TUTOR_RETENTION_DAYS`, `LLM_DAILY_*`, `AI_USER_DAILY_REQUESTS`, `AI_SCHOOL_DAILY_REQUESTS`, `AI_COST_*`.
  - Everything else is edited in System settings or AI Usage and Costs.
- **Full annotated list:** `server/.env.example`.
- **Web:** `VITE_API_URL` at build time.

## 7. Integrations that need credentials or paid services
| Capability | Status now | What it needs |
|---|---|---|
| More Gemini quota | free tier; app cap 40 requests/day | billing on the Gemini API project, then raise the limits in AI Usage and Costs |
| Email (notifications, announcements, future password reset) | not configured: in-app only, recorded as `not_configured` | `SMTP_URL` (a free tier such as Brevo or Resend) and a verified sender domain |
| OCR for scanned manuals in production | off on Render free (RAM) | a larger instance (Render Starter, $7/month) with `OCR_PROVIDER=tesseract`, or a managed OCR API (paid, needs GCP billing) |
| Illustration and image generation | not configured | a provider key (usually paid) and an adapter; diagrams are sanitised LLM SVG |
| SMS | none | a paid provider |
| Larger database | Atlas M0 (512 MB) | M2/M10 or Flex (about $8–57/month) before a real rollout |
| Always-on API | Render free (sleeps, 512 MB) | Render Starter or higher |
| First-party cookies | cross-site cookies (`web.app` and `onrender.com`) | a custom domain with `app.` and `api.` subdomains |
| Error monitoring, CI | none / workflow parked | a `SENTRY_DSN` (free tier) and a GitHub token with the `workflow` scope |

## 8. Remaining limitations
- **Cookies:** cross-site cookies fail in browsers that block third-party cookies until a custom domain is used.
- **Free hosting:**
  - The free Render instance sleeps, so jobs (processing, reminders, the retention purge) run only while it is awake.
  - There is one instance, and the rate limiter is in memory.
- **Settings cache:** settings are cached for 10 s per instance, so on more than one instance a change takes up to 10 s to reach all of them.
- **Not built:**
  - no email-based password reset, email verification or guardian consent;
  - no user data export or delete (Data Protection Act 843);
  - no output-moderation classifier beyond provider safety filters.
- **Saving lessons offline:** the policy is enforced in the app (it hides the button and clears saved copies). A determined user could still cache a lesson they can already read online, because the server cannot see device storage. Subject downloads are enforced on the server.
- **Maintenance mode** stops all non-admin API use, but background jobs keep running.
- **Lockout settings** apply to new failed attempts. Session lifetimes apply to new sign-ins and refreshes, not to tokens already issued.
- **Theme presets are fixed** (5 AA-checked palettes); free colour choice is not offered, to keep contrast guaranteed.
- **The embedding model is environment-only,** because a change needs a full re-index.
- **Live Gemini behaviour is spot-checked only.** E2E uses the scripted test LLM, to protect the free quota.

## 9. Run and deploy
- **Local:** see `docs/SETUP.md`:
  ```bash
  npm install
  cd server && SEED_ON_START=true JWT_ACCESS_SECRET=… JWT_REFRESH_SECRET=… npm run dev
  npm run dev:web
  ```
- **Tests:**
  ```bash
  npm -w server test
  npm -w web test
  cd web && npm run e2e
  ```
- **Deploy:** see `docs/DEPLOYMENT.md`:
  1. Push `main`.
  2. Run `scripts/publish-deploy-mirror.sh` (a code-only public mirror).
  3. Trigger the Render deploy through the API and wait for `live`.
  4. Build and deploy the web app:
     ```bash
     cd web && VITE_API_URL=https://ghlearn-api.onrender.com npm run build
     firebase deploy --only hosting:ghlearn-f31c9 --project gh-curriculum-f31c9
     ```
  5. Smoke test: `/api/health`, `/api/settings/public`, then sign in as an admin and open System settings.
