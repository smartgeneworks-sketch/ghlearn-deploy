# Admin Panel — Phase 1 inventory and plan

Status: **Phase 1 (inspection + plan) and Phase 2 (admin routing, layout, navigation, permissions) done, Oct 2026.** The spec is `docs/ADMIN_SPEC.md`; § numbers below refer to it. No code was refactored in this phase. Every statement under "Exists" below was checked against the code at commit `8b150f2`.

## 0. Principles carried into every phase
- **Server-enforced:** every admin capability is a permission checked in Express middleware plus a resource-scope check (school, subject, ownership). The UI only hides what the server already refuses. Each new route gets a denial test.
- **No placeholders:** a screen ships only when its API, validation, audit entry and tests exist. Integrations that need credentials (OCR, image generation, email, paid Gemini) appear as **"Not configured"** status cards that show the env vars they need. They never show fake data.
- **Audited:** every mutation writes `AuditLog` (actor, action, target, before/after diff where cheap, ip, requestId).
- **Free-tier aware:** Render free (512 MB, sleeps), Atlas M0 (512 MB), and the Gemini free quota (app budget `LLM_DAILY_REQUEST_BUDGET=40`).

## 1. What exists today (reuse map)

### Backend
| Area | Exists (reuse) | Where |
|---|---|---|
| Auth | bcrypt; JWT access cookie (15 min) and rotating refresh cookie (14 d, reuse detection revokes the whole token family); lockout after 8 failures for 15 min; auth rate limit 20 per 15 min; global limit 300/min; CSRF double-submit token + Origin allow-list; `revokeAllForUser` on suspend or role change | `routes/auth.ts`, `services/auth.ts`, `middleware/csrf.ts` |
| RBAC | Role → permission matrix in `shared` (used by both server and web); `requirePermission` / `requireAnyPermission`; resource guards `canAccessSubject`, `requireSubjectAccess`, `canSeeUnpublished`; school scoping helper in `admin.ts` | `shared/src/index.ts`, `middleware/index.ts` |
| Users | list (filter by role, paginated 50), patch roles/status/school (school admin cannot grant admin roles or touch super admins; cannot remove own super admin), teacher assignments CRUD, student subjects edit, student profile view | `routes/admin.ts` |
| Config | generic CRUD for schools, levels, academic years, Learning Areas (`programmes`), subjects, combinations; subject verify; school leaderboard settings | `routes/config.ts`, `routes/practice.ts` |
| Curriculum ingestion | upload (PDF checks, encryption check, sha256 dedupe), GridFS / remote / Drive object store, Mongo job queue (lease, backoff, dead-letter handlers), extract → OCR (optional) → structure → chunk → embed, curriculum node editing, mapping and approval (`verified_official`), 2,813-entry index importer, subject catalogue seeding | `routes/documents.ts`, `services/ingest/*`, `services/importer.ts`, `services/queue.ts` |
| AI layer | provider abstraction for LLM (Gemini or test LLM), embeddings, OCR and image; retry with backoff; every call recorded in `AiUsage`; daily request/token budget; JSON parsing; health status | `services/ai.ts`, `services/usage.ts` |
| Lessons | A–K generation job, section regenerate, versions/compare/restore, validation, submit → review (approve/request changes) → publish/unpublish with **separate `content:review` and `content:publish` permissions** and a separation-of-duties test | `routes/lessons.ts`, `services/lessons/*` |
| Question bank | 11 question types, rubrics, AI generation + cross-check, duplicate detection, review workflow | `routes/questions.ts`, `services/assess/generate.ts` |
| Assessments / practice / games / rewards | attempts in 7 modes, marking queue with AI-provisional marks, 10 games, XP, rewards, leaderboard (off by default) | `routes/practice.ts`, `services/assess/*` |
| Tutor | RAG over verified chunks (Atlas vector index `chunk_vectors` or local), per-user daily cap, 180-day retention (TTL), feedback | `routes/tutor.ts`, `services/tutor.ts`, `services/retrieval.ts` |
| Teaching | classes, members, class/individual views, misconceptions, remedial assignments, CSV/PDF/offline reports | `routes/teacher.ts`, `services/teach/*` |
| Analytics | scoped analytics (`platform` / `school` / `content`) with filters for region, school, level, class, subject, topic and date; sections for users, active, enrolment, content, tutor, exercises, topics, engagement, AI cost estimate, storage, health | `services/analytics.ts`, `routes/analytics.ts` |
| Notifications | in-app, 90-day TTL, typed enum, unread count, mark read | `models/teach.ts`, `services/notify.ts` |
| Meetings | slots, requests, accept/decline/reschedule/cancel, no double booking, school-scoped, counselor role | `routes/meetings.ts`, `models/meet.ts` |
| Audit | `AuditLog` written by 35 call sites (user, config, document, lesson, question, assessment, class, meeting, report export...); list with filters and CSV export, school-scoped for school admins | `lib/audit.ts`, `routes/admin.ts` |
| Ops | `/api/health` (DB and AI providers); idempotent bootstrap (indexes, vector index, sample upgrade, profile backfill, subject seed, import); pino JSON logs with redaction; OpenAPI at `/api/docs/openapi.json` | `bootstrap.ts`, `app.ts`, `openapi.ts` |

### Frontend
| Area | Exists | Where |
|---|---|---|
| Shell | one top-bar `Layout` with a role-filtered nav (`navFor`), notification bell, route-level code splitting, `Guard` (permission / any-permission / onboarding) | `components/Layout.tsx`, `App.tsx` |
| Admin pages | `/admin/config` (tabbed generic CRUD), `/admin/users` (expandable row: roles, assignments, student subjects), `/admin/documents` (+ detail), `/admin/lessons` (+ editor), `/admin/questions`, `/admin/analytics`, `/admin/audit` | `pages/Admin.tsx`, `Documents.tsx`, `Lessons.tsx`, `QuestionBank.tsx`, `Analytics.tsx` |
| Charts | dependency-free, accessible SVG `BarChart` (each chart also renders a hidden data table). `recharts` is listed in package.json but **imported nowhere** | `components/Charts.tsx` |
| UI kit | Button, Input, Select, Card, Alert, Spinner, SampleBadge (Tailwind) | `components/ui.tsx` |

## 2. Gap analysis by spec section
Legend: **R** = reuse as is, **X** = extend, **N** = new. "Phase" is the spec §24 phase that delivers the item.

| Spec § | Area | R/X/N | Gap to close | Phase |
|---|---|---|---|---|
| §3A | Sidebar: 16 sections in spec order (1 Overview, 2 Schools and Institutions, 3 Users and Permissions, 4 Academic Structure, 5 Curriculum Management, 6 Learner Manuals, 7 AI Content Generation, 8 Content Review and Publishing, 9 Question Bank and Assessments, 10 Educational Games, 11 Classes and Enrolments, 12 Learning Analytics, 13 AI Usage and Costs, 14 Notifications, 15 Audit Logs, 16 System Settings) | N | Permission-filtered sidebar. A section appears only when it is built **and** the user holds its permission (no dead buttons). | 2 (done), then each section appears in its phase |
| §3B | Top bar: sidebar toggle, global search, notifications, **current academic year**, profile menu, account settings, secure logout | N | All seven pieces | 2 (done) |
| §3C | Workspace: title + description, breadcrumbs, actions, filters/search, paginated tables, forms + confirm dialogs, loading/success/empty/error states, responsive | N | `AdminPage` header, `Breadcrumbs`, `DataTable` (server pagination), `ConfirmDialog`, state components | 2 (done for title/breadcrumbs/DataTable); ConfirmDialog in 4 |
| §4 | RBAC + permissions; Super, School, Curriculum Admin, Content Reviewer (review ≠ publish), System Operator | X | New roles and permissions, scoped `RoleAssignment` and grant rules. See §3 | 2 (done) |
| §5 | Overview: 10 live cards, 9 charts, filters (date, level, school, subject), activity feeds, cards linking to filtered pages | X | Phase 2: cards + activity + filters on real data. Phase 3: charts (time series), deep links with filters, system warnings feed | 2 (v1), 3 (full) |
| §6 | Schools: add/edit, activate/suspend/archive, assign school admins, levels, Learning Areas, combinations, school permissions, counts, usage; fields incl. unique identifier, region + district, **institution type, contact, status** | X | School `status` (active/suspended/archived), `type`, `contact`, region enum; school detail page; school-admin assignment through RoleAssignment | 4 |
| §7 | Users: tables per role type, create (invitation), edit, roles, school membership, classes/subjects, activate/deactivate, **secure recovery**, **revoke sessions**, created/last login, audit history; student/teacher detail columns | X | Create/invite (temporary password + forced change until email exists), recovery, session list/revoke, per-user audit tab | 4 |
| §8 | Academic structure: levels, years, classes/grades, Learning Areas, subjects, categories, combinations **per programme and class**, curriculum versions, strands, sub-strands, indicators, topics; create/edit/**reorder**/deactivate/**archive**; block deleting referenced items | X/N | Edit forms, `order` + `archivedAt` on config rows, reference checks before delete, new `CurriculumElement` (version → strand → sub-strand → indicator → topic) | 4 |
| §5 (sidebar), §8 | Curriculum Management | N | Curriculum versions and element tree with mapping to documents (reuses `CurriculumNode` detections as suggestions) | 5 |
| §9 | Manual library: **PDF, DOCX, TXT, CSV**, scanned PDF (OCR), drag and drop, progress, duplicates, retry, rich metadata (licensing, tags, document version), preview/download, inspect pages, archive, **replacement versions preserving links** | X | Only PDF today. Add DOCX/TXT/CSV extractors, `documentVersion` chain (`replacesId`), licensing/tags, archive, page/figure inspector | 5 |
| §10 | Processing monitor with statuses **Queued, Extracting, OCR processing, Mapping curriculum, Indexing, Awaiting validation, Completed, Failed**, stages, pages processed, retry count, safe retry without duplicates | X | Map the internal `processingStatus` (queued/extracting/ocr/structuring/chunking/embedding/indexed/failed) to the spec labels; add `awaiting_validation` (indexed but mapping/approval pending); job console with retry (idempotent: chunks/embeddings are replaced per document) | 6 |
| §11 | AI generation workspace: extra options (curriculum version, page range, duration, difficulty distribution, illustrations, language) and **resource types** beyond the A–K lesson (summaries, revision cards, games, teacher prep...), cancel/retry, usage estimates | X | Extend controls; per-type generators reuse the job queue | 7 |
| §12 | Review queue with statuses **Draft, Generating, Awaiting review, Changes requested, Resubmitted, Approved, Published, Archived**, assigned reviewer, comments, compare with source, confirm publish/archive, who and when | X | Add `resubmitted` (submit after changes_requested), `assignedReviewerId`, comments thread (reuse `LessonReview`). Phase 2 adds a read-only queue page (§8 in sidebar) on real data | 2 (queue list), 7 |
| §13 | Question bank: time limits, preview as student, versions and usage, assemble assessments, answer verification | X | Versions + usage counts, preview, assessment assembly from approved questions | 8 |
| §14 | Games: create, generate, preview, edit, difficulty/scoring/hints, approve/publish/archive, participation | N | `GameSet` model (today games are assembled on the fly from published content), review workflow | 8 |
| §15 | Classes and enrolments: assign teachers, enrol, **CSV import with validated template, duplicate detection, preview, error report and safe rollback**, review subject selections, transfers, academic-year change, enrolment export | X | Reuse `ClassGroup`. Add `ImportBatch` (rows, errors, created ids → rollback deletes exactly those), transfers, year rollover | 4 |
| §16 | Analytics: more filters (academic year, programme), lesson completion, misconceptions, remediation, **CSV/Excel export** by permission, measured vs estimated labels | X | Excel export (xlsx writer such as `exceljs`, streamed), new metrics, filters | 9 |
| §17 | AI config: providers/models for LLM, embeddings, OCR, illustration, vector search, storage; limits, budgets per school, timeouts, health checks; usage by provider/feature/school; costs labelled as estimates; secrets never returned | X | Settings-backed AI config, health checks that report real failures, usage breakdowns (from `AiUsage`) | 9 (usage), 10 (config) |
| §18 | Notifications: announcements with audience and period, publication/failure/review/security alerts, email if configured, **delivery status** | X | `Announcement` + per-user delivery records; email adapter (inactive until credentials exist) | 9 |
| §19 | Append-only audit: login/failed login, role changes, activation, uploads, curriculum, approvals, AI config, exports, deletion; actor, action, resource type + id, outcome, non-sensitive meta; restricted; no modification | X | Phase 2: request ids, entity type/id, outcome, before/after diffs, auth events, sensitive-key redaction, append-only guard. Later phases add their events | 2 (done), each later phase |
| §20 | Settings: branding, app name + logo, theme, academic year, levels, default review policy, AI defaults, upload limits, allowed formats, notification settings, data retention, session settings, offline-download policy, feature availability, **maintenance mode**, terms/privacy; validation + confirmations; no secrets in DB | N | Typed `Setting` store (Zod per key, versioned, audited), maintenance mode middleware | 10 |
| §21–22 | Backend and performance rules (pagination, debounced search, lazy pages, no hard-coded stats) | X | `lib/list.ts` helper + `DataTable` (Phase 2) applied to every list | 2 onward |
| §23 | Tests: admin auth, RBAC, school isolation, uploads, curriculum CRUD, AI jobs, review, publishing restrictions, question bank, game publishing, CSV import, analytics auth, secret protection, audit, settings | X | Each phase adds allowed/denied API tests and browser tests | all |
| §25–26 | Definition of done, final report | — | Tracked per phase | 10 |
| (not in spec) | Tutor oversight, meetings oversight | — | Kept as optional extras; not scheduled unless asked | — |

## 3. Roles and permissions plan

### Mapping
| Spec role | Existing role | Decision |
|---|---|---|
| Super Admin | `super_admin` | Same. Keeps every permission. |
| School Admin | `school_admin` | Same, scoped to `User.schoolId`. Gains school settings and announcements; still cannot grant admin roles. |
| Curriculum Admin | (part of `curriculum_editor`) | **New role `curriculum_admin`**: manages structure (levels, Learning Areas, subjects, combinations), documents, mapping and verification. `curriculum_editor` stays as the authoring role (documents upload/map, content edit). |
| Content Reviewer | `content_reviewer` | Same role. Review and publish are **already separate permissions** (`content:review`, `content:publish`); the role keeps both by default. A school or platform can split them by granting a reviewer-only assignment (below). Separation of duties stays: the author cannot approve their own content. |
| System Operator | — | **New role `system_operator`**: jobs, health, maintenance, AI provider status and budget visibility, storage. No learner data, no content approval. |
| (others) | `teacher`, `counselor`, `student`, `parent` | Unchanged; they are not admin-panel users (teachers and counselors keep their workspaces). |

### Permission model
- Permissions stay code-defined strings in `shared` (one source of truth, typed, tested). New ones:
  - `admin:access` (enter /admin)
  - `users:create`, `users:import`, `users:security` (reset, unlock, force logout)
  - `roles:assign`
  - `schools:settings`
  - `curriculum:manage`
  - `content:review` and `content:publish` (existing, kept separate)
  - `questions:import`
  - `announcements:send`
  - `settings:manage`, `settings:view`
  - `ai:manage`
  - `jobs:manage`
  - `system:health`, `system:maintenance`
  - `audit:view` (existing), `audit:export`
  - `tutor:oversight`
  - `reports:export`
- **Role assignments with scope** (Phase 2/3): a new `RoleAssignment {userId, role, scope: {type: 'platform' | 'school' | 'subject', id}, grantedBy, expiresAt?}` replaces direct `User.roles` writes. `User.roles` stays as a denormalised cache, so the existing middleware and tests keep working; this is a non-breaking migration. Effective permissions = union over assignments. The scope is checked by `requireScoped(permission, resolver)`.
- **Grant rules:** nobody can grant a permission they don't hold, or a scope wider than their own. Only super admin grants `super_admin`, `system_operator` and `curriculum_admin`. Every grant/revoke is audited and revokes the target's sessions.
- The UI gets a read-only matrix generated from `ROLE_PERMISSIONS`, plus a "why can/can't X do Y" checker that calls a server explain endpoint.

## 4. Planned models and indexes
| Model | Fields (key) | Indexes |
|---|---|---|
| RoleAssignment | userId, role, scopeType, scopeId, grantedBy, expiresAt | {userId}, {scopeType, scopeId, role}, unique {userId, role, scopeType, scopeId} |
| Setting | key, scope (platform/school), scopeId, value (Mixed, Zod per key), version, updatedBy | unique {key, scope, scopeId} |
| SettingHistory | settingId, version, value, by, at | {settingId, version} |
| Announcement | title, body (markdown, sanitised), audience {type: platform/school/role/class, ids, roles}, publishAt, expiresAt, createdBy, status | {status, publishAt}, {audience.type, audience.ids} |
| AnnouncementRead | announcementId, userId, readAt | unique {announcementId, userId} |
| UserImport | file checksum, rows, dryRun result, status, createdBy | {createdBy, createdAt} |
| Session view | reuse `RefreshToken` (userAgent, ip, family) | add {userId, revokedAt} |
| AuditLog (extend) | requestId, before/after (size-capped), entityType, entityId, outcome | {entityType, entityId, createdAt}, {actorId, createdAt}, {action, createdAt}; TTL configurable (default keep 2 years) |
| User (extend) | mustChangePassword, deletedAt (soft delete), totpSecret (encrypted, optional), lastActiveAt | {deletedAt}, {schoolId, roles} |
| School (extend) | region (enum), settings (feature flags), status | {region}, {status} |
| Job (extend) | cancelledBy, purgedAt | {type, status, createdAt} |
| Meeting (extend) | attended / no_show outcome | {schoolId, start} |
| DailyMetric (optional, Phase 8) | day, scope, metric, value | unique {day, scopeType, scopeId, metric} |

## 5. Route and layout plan
- **Web:** `/admin` is a nested layout (`AdminLayout`) behind `Guard any=[admin:access]`. It is code-split, so student bundles don't grow.
  - **Sidebar** is generated from one `ADMIN_NAV` config. Each item declares its required permissions, so items are hidden when the server would refuse them. Groups:
    - Overview
    - People (Users, Roles, Schools)
    - Curriculum (Structure, Documents)
    - Content (Lessons, Questions, Review queue)
    - Learning (Assessments, Games & rewards, Tutor oversight, Meetings)
    - Insights (Analytics, Reports)
    - Communication (Announcements, Notifications)
    - System (Settings, AI & budgets, Jobs, Health, Audit log, Security)
  - **Top bar:** global search (users, schools, documents, lessons, questions; a server endpoint permission-filters the results), school switcher (super admin), AI budget pill, notification bell, account menu.
  - **Breadcrumbs:** from route `handle.crumb` (React Router data), e.g. *Admin › Schools › Sample Academy › Staff*.
  - Existing `/admin/*` URLs keep working (redirects or nested), so the E2E tests and bookmarks don't break.
  - Shared building blocks:
    - `DataTable`: server pagination, sort, filters in the URL query, CSV export, keyboard accessible
    - `EntityHeader`, `ConfirmDialog` (type-to-confirm for destructive actions)
    - `EmptyState`, `StatusCard` ("Not configured" with the env vars needed)
- **Server:** `/api/admin/*` grows by resource: `users`, `roles`, `schools`, `settings`, `announcements`, `jobs`, `system`, `security`, `search`. Shared pieces:
  - a list helper: Zod query → filter, sort allow-list, cursor/page, projection
  - `auditDiff` middleware
  - `requireScoped`
- **Chart library decision:** keep the **in-house accessible SVG charts**. Extend `Charts.tsx` with Line/Area (time series), Donut and Sparkline, each with an `aria-label` summary and a hidden data table, and remove the unused `recharts` dependency. Reasons:
  - accessibility is already proven by axe in E2E
  - no bundle growth (recharts plus d3 would add ~100 kB gzipped to the admin chunk)
  - the dashboards need only simple series
  - Revisit only if interactive zoom/brush is required.

## 6. Phase plan (aligned with spec §24)
| Phase | Spec scope | Exit criteria |
|---|---|---|
| 1 | Inspect | this document ✔ |
| 2 | Admin routing, layout, navigation, auth, permissions (+ Overview v1, audit extension, list helper) | ✔ done; see §10 |
| 3 | Dashboard and activity (§5): time-series charts, filtered deep links, system warnings, recent-activity feeds per permission | numbers cross-checked against raw queries in tests; axe clean |
| 4 | Users, schools, classes, subjects, academic structure (§6, §7, §8, §15): user create/recovery/sessions, school status/type/contact, ConfirmDialog, edit/reorder/archive config, reference-safe delete, classes + CSV enrolment import with rollback | isolation + no-escalation + import rollback tests |
| 5 | Curriculum and manuals (§5 sidebar, §8 elements, §9): curriculum versions/elements, DOCX/TXT/CSV, versions/replacement, metadata, archive | format + version-link tests |
| 6 | Processing monitor (§10) for System Operator / Curriculum Admin: spec statuses, retry without duplicates | idempotent retry tests |
| 7 | AI generation and review (§11, §12): resource types, resubmitted, assigned reviewer, comments, compare with source | review ≠ publish, publish-gate tests |
| 8 | Question bank, assessments, games (§13, §14) | game publishing tests |
| 9 | Analytics, AI usage, notifications, audit (§16, §17 usage, §18, §19 UI): Excel export, announcements with delivery status | analytics authorisation, export permission tests |
| 10 | Settings, security tests, responsive polish, deploy docs (§17 config, §20, §23, §25, §26) | full acceptance checklist |

## 7. Integrations needing credentials or paid services
| Capability | Status | Needed |
|---|---|---|
| OCR for scanned PDFs | Disabled in production (`OCR_PROVIDER` unset; tesseract.js too heavy for Render free RAM) | either a paid/managed OCR API key (e.g. Google Vision, which needs GCP billing) or a separate worker with more RAM |
| Illustration / image generation | Not configured (`IMAGE_PROVIDER`, `IMAGE_API_KEY`) | a provider key, usually paid. Diagrams remain sanitised LLM SVG |
| Email (invites, password reset, announcements, meeting reminders) | Not configured | `SMTP_URL` or a provider key (Brevo/Resend free tiers exist) plus a verified sender domain |
| SMS | Not configured | provider key (paid per message) |
| Gemini billing | Free tier, quota exhausted after ~25–40 requests/day in practice; app cap 40/day | the user must enable billing on the Gemini API project to raise quotas. The app then needs only budget changes in Settings (Phase 7) |
| Server-side Google Drive storage | Not configured | service credential (no cost) |
| Error monitoring | Not configured | `SENTRY_DSN` (free developer tier) |
| CI | Workflow parked in `docs/ci.workflow.yml` | GitHub token with `workflow` scope |

## 8. Risks and limitations
- **Hosting limits:** Render free has 512 MB RAM and sleeps; heavy admin exports or reports should stream and be capped, and big imports run as jobs.
- **Atlas M0:** 512 MB and a shared tier; analytics run as live aggregations, so Phase 8 may need the DailyMetric rollup. Index growth must be watched (the storage card exists).
- **Cookies** are first-party on ghlearn.com and api.ghlearn.com (since 15 Oct 2026), so admin sessions survive third-party-cookie blocking.
- **Hard-coded roles to scoped assignments:** the migration is the riskiest change. `User.roles` is kept as a cache and existing tests are kept, so it stays non-breaking.
- **Rate limiter:** in memory, per instance; fine on one instance.
- **No email:** invites and resets have to use admin-set temporary passwords until a provider exists.
- **Spec text:** this plan is organised by topic because the spec numbering was not available here; reconcile it at Phase 2 kickoff.

## 9. Baseline tests (Phase 1, commit 8b150f2)
Run on 15 Oct 2026 before any admin-panel change:
- Server (vitest + supertest, in-memory MongoDB): **85/85 passed** (12 files).
- Web unit (vitest + Testing Library): **14/14 passed** (4 files).
- Browser E2E (Playwright, production build + in-memory API + scripted test LLM): **20/20 passed**. This covers the 12-step scenario, URL/API denial, meetings, and responsive + PWA, with axe on each screen.

Every later phase must keep these green and add its own allowed/denied tests.

## 10. Phase 2 delivered (admin routing, layout, navigation, auth, permissions)
- **Shell** (`web/src/admin`):
  - `/admin/*` routes render inside `AdminLayout`. Users without `admin:access` get the normal app shell and a denial.
  - The sidebar follows the 16 sections of §3 (`ADMIN_SECTIONS`). It shows only sections that are built and permitted. Unbuilt so far: 5, 10, 11, 13, 14.
  - Top bar: sidebar toggle (collapse on desktop, drawer on phone), global search, current academic year, notifications, and a profile menu with Account settings, Sign out and Sign out of all devices.
  - Breadcrumbs and an `AdminPage` header.
  - `DataTable`: server pagination, debounced search, sortable headers with `aria-sort`, URL-synced filters, and loading, empty and error states.
- **Sections now live:**

  | # | Section | Route |
  |---|---|---|
  | 1 | Overview (v1: live cards, activity, warnings, filters) | `/admin` |
  | 2 | Schools | `/admin/schools` |
  | 3 | Users (DataTable, scoped role assignments) | `/admin/users` |
  | 4 | Academic Structure | `/admin/structure` (`/admin/config` redirects here) |
  | 6 | Learner Manuals | `/admin/documents` |
  | 7 | AI Content Generation | `/admin/lessons` |
  | 8 | Content Review queue | `/admin/review` |
  | 9 | Question Bank | `/admin/questions` |
  | 12 | Analytics | `/admin/analytics` |
  | 15 | Audit Logs (DataTable with outcome and request-id filters and diffs) | `/admin/audit` |
  | 16 | System Settings → status | `/admin/system` |

  Editable settings for section 16 arrive in Phase 10.
- **Extra pages:** `/admin/account`, `/admin/search` and `/admin/notifications`.
- **Server:**
  - New permissions `admin:access`, `roles:assign`, `curriculum:manage` and `system:health`.
  - New roles `curriculum_admin` and `system_operator`.
  - `RoleAssignment` with grant rules.
  - `lib/list.ts`.
  - Append-only audit with request ids, diffs, outcome and auth events.
  - `/api/admin/overview`, `/api/admin/search` and `/api/admin/system`.
  - Change-password and logout-all.
  - Sample accounts `curriculum@` and `operator@`, created by bootstrap with `SEED_PASSWORD`.
- **Tests:**
  - Server `test/adminpanel.test.ts` (22 tests): an allowed and a denied case for every new permission, the grant rules, audit events, append-only behaviour and redaction, the list helper, search scoping, and account security.
  - Web unit tests: sidebar order and filtering per role, breadcrumbs.
  - E2E `e2e/admin.spec.ts` (9 tests): the sidebar for each of five admin roles, URL and API manipulation, teacher/student denial, the top bar, Overview deep links, DataTable URL state, phone drawer, and axe on every admin page.

## 11. Phase 3 delivered (overview analytics, §5)

- **Charts** (`services/adminCharts.ts`, `GET /api/admin/overview/charts`): time series with zero-filled UTC buckets via `$dateTrunc` (day, week or month chosen from the range).
  - Registrations, active users (sign-ins since Phase 2 plus XP activity), current enrolment by subject, processing status (9 labels, each linking to filtered Documents), uploads, generated vs published lessons, review workload, exercise attempts started and completed, performance by subject (only when real attempts exist), AI requests, and estimated AI cost (labelled "Estimate, not a bill").
  - Each chart is gated by permission. School admins are pinned to their school and do not see AI charts.
- **Filters:** date range, level, school and subject apply to cards, charts and feeds. Links carry only the filters the target page supports. Documents, Lessons, Review queue, Question bank, Analytics and Users now read their initial filters from the URL.
- **Feeds:** a warnings feed (stuck or failed documents, failed jobs, AI budget over 80%, AI errors, no AI key, reviews waiting more than 7 days, students not onboarded, no current academic year), shown only to roles that can act on each warning. Activity lists: recent manuals, generated content, pending approvals (oldest first), failed jobs, recent admin actions.
- **Accessibility:**
  - Each chart is a labelled `figure`.
  - Line charts: the SVG has `role=img` with a text summary, series use dash patterns plus a legend, and a "Show data table" disclosure holds a captioned table in a focusable region.
  - Bar charts: HTML lists with text values.
  - axe-clean in e2e.
- **Nav fix:** super admins no longer see the learner-only "My progress" and "Assessments" items.
- **Tests:** `server/test/admincharts.test.ts` checks every figure against direct DB counts, plus per-role chart sets, links and warnings. `web/src/admin/OverviewCharts.test.tsx` and `web/e2e/overview.spec.ts` cover rendering, axe, filter-to-URL-to-link behaviour, and drilldowns.

## 12. Phase 4 delivered (users §7, schools §6, academic structure §8, classes and enrolments §15)

- **Shared confirmation dialog** (`web/src/components/ConfirmDialog.tsx`): every risky action goes through it. It is a modal `alertdialog`: labelled and described, focus trapped, Escape cancels, focus returns to the trigger. It supports type-to-confirm (school archive, class delete). Server errors such as 409 IN_USE stay visible in the dialog.
- **Users (§7):**
  - Admins create accounts with a server-generated 14-character temporary password. It is shown once with `Cache-Control: no-store` and is never stored, logged or audited.
  - `mustChangePassword` then blocks every API except `/api/auth/*` (403 PASSWORD_CHANGE_REQUIRED). The web app routes the user to `/change-password`.
  - Recovery: an administrator reset (a new temporary password, all sessions revoked) and unlock. Self-service email reset waits on email configuration.
  - Sessions are listed per refresh family and can be revoked one at a time with immediate effect via the `sid` claim, or all at once. Users can also manage their own sessions in Account settings.
  - Other features: suspend and reactivate, per-role detail (student profile and subjects, teacher assignments), the user's audit history, and a super-admin-only move to another school.
- **Schools (§6):**
  - Status (active, suspended or archived, with a reason). Members of a blocked school cannot sign in or refresh, and existing tokens are refused (403 SCHOOL_INACTIVE). Super admins are exempt.
  - Unique uppercase identifier, region (the 16 regions), district, type, contact, levels and Learning Areas offered.
  - School-specific combinations, assignment and removal of school admins, member counts, and usage analytics.
  - School admins can edit only `SCHOOL_ADMIN_EDITABLE` fields.
- **Academic structure (§8):**
  - Levels, academic years, Learning Areas, subjects and combinations support edit, reorder (`order`), activate/deactivate, archive/restore, and reference-checked delete (409 IN_USE with the references; delete requires platform:manage).
  - Only one academic year can be current. Archived or inactive items are refused for new student choices.
  - Curriculum elements (strand, sub-strand, content standard, indicator, topic) support edit, verify, sibling reorder, cascading archive/restore, and delete that is blocked while lessons or children use them.
  - Curriculum versions were labels in Phase 4; Phase 5 replaced them with version records (see §13). Sub-topics are not modelled.
  - Categories are the core/elective enum.
- **Classes and enrolments (§15):**
  - Form and subject classes with academic year, year of study and Learning Area. Duplicate names per year are refused.
  - Teacher assignment: the matching subject assignment is created and reported. Enrolment from eligible students, with removal.
  - Transfers within a school (target first, then source), and an academic-year rollover with a dry-run preview and an apply step: promote, graduate or skip; idempotent through `rolledFromId`.
  - Enrolment CSV export (formula-guarded, audited).
- **CSV import:**
  - Template, paste or upload (1 MB limit), and a stored preview (`ImportBatch`). The raw CSV is not kept.
  - Per-row actions: enrol, create_and_enrol, skip (already enrolled) or error. Duplicates in the file and against the database are detected.
  - Existing names, schools and classes are never overwritten; a mismatch is an error. A blank academic_year means the current year and also matches a class that has no academic year.
  - Downloadable error report. Commit re-validates against the database and refuses a stale preview (409 PREVIEW_STALE); errors block commit unless "valid rows only" is chosen.
  - New-student credentials are returned once and downloadable as CSV.
  - Rollback undoes exactly what the batch recorded, keeping accounts and classes used since.
- **Isolation:** school admins are pinned to their school for every user, school, class and import endpoint (other schools return 403/404). Teachers, curriculum roles and students get 403.
- **Tests:**
  - `server/test/adminusers.test.ts`, `adminstructure.test.ts` and `adminclasses.test.ts` (39 tests, allowed and denied cases).
  - `web/src/components/ConfirmDialog.test.tsx`.
  - `web/e2e/phase4.spec.ts` (6 flows with axe on every new page); `admin.spec.ts` updated for the new sidebar item.

## 13. Phase 5 delivered (Curriculum Management, Learner Manuals §9)

- **Curriculum versions** (`CurriculumVersion`):
  - Each version is a record: code (unique, case-insensitive), name, level, effective dates, publisher, description, and a lifecycle of draft → active → archived (an archived version can be restored as a draft).
  - Subjects, documents and curriculum elements link to it through `curriculumVersionId`. The older `curriculumVersion` label is kept as a mirror of the code.
  - The migration turns every distinct label into an active record and links subjects, documents and their elements. It is idempotent.
  - Archiving is refused (409 IN_USE) while active subjects still use the version. Archived versions keep their links but cannot take new ones.
  - Only unreferenced drafts can be deleted.
  - Page: `/admin/curriculum`, which needs curriculum:manage. It has the list, create, detail/edit, lifecycle actions through confirm dialogs (delete is type-to-confirm), linking subjects, counts, manuals by processing status, and elements by type and verification.
  - The Academic Structure "Curriculum versions" tab is gone (old links redirect here). The subject form now picks a version record.
- **Learner Manuals** (`/admin/documents`):
  - **Upload:**
    - A drag-and-drop zone around a labelled file input. Accepts PDF, DOCX, TXT and CSV, up to `UPLOAD_MAX_MB`.
    - The browser validates first. It also computes the SHA-256 with `crypto.subtle` and calls `check-duplicate` to warn before sending.
    - The upload is an XHR with real progress and can be cancelled. All §9 metadata can be set at upload time.
  - **Server checks while streaming** (busboy into GridFS, never buffered whole):
    - extension and mime type (415), and content sniffing (`%PDF-`; DOCX zip with `word/document.xml`; text without NUL bytes and valid UTF-8);
    - encrypted PDF (422), empty file (400), size (413) and the GridFS quota `GRIDFS_QUOTA_MB` (507 STORAGE_QUOTA);
    - SHA-256 duplicates (409). An allowed duplicate shares the original's stored file, so no second copy is kept.
    - Partial files are deleted on any failure.
  - **Extraction:**
    - PDF uses pdf.js. Figures are counted per page from image paint operators.
    - DOCX: `word/document.xml`. Page breaks become pages, otherwise text is split into segments; drawings count as figures.
    - TXT: form feeds become pages, otherwise segments.
    - CSV: 50 rows per segment, written as `header: value`.
    - Text formats report `ocrStatus=not_needed`.
  - **Scanned PDFs:**
    - Pages without a text layer go to OCR only when a provider is configured. Otherwise the document is marked `ocrStatus=needed_not_configured`, shown as "OCR needed / not configured".
    - Those pages are marked `ocr_unavailable` with no text. The report includes `scanned` (≥50% of pages without a text layer) and `pagesWithoutTextLayer`.
  - **Metadata (§9):**
    - Fields: title, subject, level, Learning Area, class/year, curriculum version, document type, audience, source/publisher, source URL, publication year, language, document version, licensing status and tags.
    - Uploader and upload date are recorded. Processing and approval statuses are separate.
    - Editors (documents:map) edit metadata. Only reviewers (content:review) change approval. Permission is checked before validation.
  - **Detail page actions:**
    - Preview of the original: PDF in a frame from a session-fetched blob; TXT/CSV as text; DOCX cannot be previewed.
    - Download only when licensing is open licence, public domain or permission granted, or for curriculum:manage (otherwise 403 DOWNLOAD_NOT_PERMITTED). Downloads are audited.
    - Reprocess (confirmed), archive/restore (confirmed; hidden from the library, retrieval and the tutor), the processing report with warnings and job errors, and the extraction inspector (method, characters and figures per page; the text of each page).
    - Detected structure, and version history with counts of the lessons, resources and questions generated from each version.
  - **Replacement versions:**
    - `POST /:id/replace` uploads a new current version, which inherits the metadata. Approval resets to unverified and a confirmed mapping becomes suggested.
    - The earlier version keeps its pages, chunks and citations, gets `supersededBy`, and can no longer be reprocessed or replaced.
    - The library and retrieval show only current versions.
  - **Permanent delete** (super admin, type-to-confirm): reference-checked, never for superseded versions, and frees the stored file. Other roles archive.
  - **No auto-publish:** approval never publishes anything, and processing never changes approval.
- **Sidebar:** Curriculum Management is shown to curriculum:manage holders (super admin and curriculum admin). Learner Manuals is unchanged.
- **Tests:**
  - `server/test/manuals.test.ts` (15 tests: validation and denials, the four formats, duplicates, quota, scanned/OCR status, metadata and approval permissions, download licensing, replacement, archive, the version lifecycle and the migration).
  - `adminstructure` and `documents` tests updated.
  - `web/e2e/phase5.spec.ts` (5 flows with axe), plus updates to `admin`, `phase4` and `scenario`.
- **Limits:**
  - Uploaded files are stored in GridFS inside Atlas M0 (512 MB in total), guarded by `GRIDFS_QUOTA_MB` (150 by default). External object storage needs credentials (see INGESTION.md).
  - OCR is disabled live, so scanned manuals stay "OCR needed / not configured".

## 14. Phase 6 delivered (Document Processing Monitor, §10)

**Where:** `/admin/processing` (list, health, purge) and `/admin/processing/:id` (inspector). It is not a 17th sidebar section (spec §3 lists 16); it opens from Learner Manuals, System status and a manual's Processing card. Access: `system:health` or `curriculum:manage` (System Operator, Curriculum Admin, Super Admin). Purge needs `system:health`. Everyone else gets 403 from the API and "no access" in the UI.

**Status mapping (real pipeline → §10):**

| Queue / pipeline state | §10 status |
|---|---|
| `queued` (including waiting for an automatic retry, shown as "Retry n of m at …") | Queued |
| running, step `running`/`extracting` (reading the file, text layer per page) | Extracting |
| running, step `ocr` (only when OCR is configured and pages lack a text layer) | OCR processing |
| running, step `structuring` (heading/curriculum structure detection) | Mapping curriculum |
| running, step `chunking`/`embedding` | Indexing |
| `succeeded`, is the manual's current run, mapping not confirmed or approval undecided | Awaiting validation |
| `succeeded` and validated, or an older superseded run | Completed |
| `dead` | Failed |
| `cancelled` | Cancelled (extra, needed for cancel) |

**Progress:** a bar with numbers only where the pipeline counts work: pages extracted (every 5 pages), pages OCR'd, passages embedded (per 50-passage batch). Every other stage shows an indeterminate bar labelled "not measured". The invented percentages on the manual's Processing card and the lesson "Generating…" note were removed.

**Row fields:** job id, manual, subject, uploader, status with step, progress, started/ended, pages processed, extraction/OCR/indexing status (from the job's stage timeline and result), error summary with failing stage, retries (automatic attempts beyond the first plus manual retries). Filters: status, subject, created from/to, "only retried", text (title or job id); server pagination and sort.

**Safe retry (no duplicate passages or embeddings):** a retry is a new job (`retryOf`) that re-runs the whole pipeline, which replaces the manual's pages, detected structure and passages. Guarantees: (1) only the manual's current job can be retried, swapped with a compare-and-set on `lastJobId`, so concurrent retries cannot both queue; (2) a run checks a fence before writing and before finishing: if it is no longer the current job or lost its lease it stops without writing; (3) a unique index on passages `(documentId, ordinal)` makes a second copy impossible at the database level (a start-up migration removes any legacy duplicates first; index-sync failures no longer stop start-up). Tested by crashing a run mid-write, retrying, and checking counts, unique ordinals and embedding counts.

**Cancel:** queued jobs only (running jobs are not interrupted mid-stage). The manual returns to the state its stored output really has: indexed if the previous run succeeded; failed with a note if an earlier attempt had already replaced output.

**Purge:** deletes finished, failed and cancelled processing jobs older than N days (1–3650), with a dry-run preview first; never deletes a manual's or lesson's current job; audited.

**Health:** database ping, counts per status, oldest queued wait, stalled running jobs (expired lease), last-24h finished/failed, last success, the answering instance's worker heartbeat, OCR and embedding provider state, upload storage against its quota, and warnings computed from these.

**Live failed job explained:** `lesson.generate` 6ad0224333e70788b3fb55c1 died on 15 Oct 00:45 UTC with "Cannot read properties of undefined (reading 'sections')". Its lesson was created without `controls`, a bug (Zod 4 `default` vs `prefault`) fixed in 3e1007a and deployed at 00:53. The generator now also applies the default controls to such legacy lessons instead of crashing (test added).

## 15. Phase 7 delivered (AI generation workspace §11, review queue §12)

**Generation workspace (`/admin/lessons`).**
- **Content types the pipeline really produces:** full lesson (sections A–J plus K), learner notes, summary, worked examples, labelled diagrams, concept map, real-life scenarios, activities, practical, research project, formative questions, revision cards, vocabulary list, and teacher preparation (section T, visible to teachers only).
- **Shown as unavailable, with the reason:** infographics (no image provider) and games (built in Educational Games). Image illustrations are "not configured". Diagrams and concept maps are generated as data and drawn by the server.
- **Options:** subject, topic, subtopic, year, programme, curriculum version, source manuals (approved only), page range (one manual), and curriculum element from the manual (strand, sub-strand, indicator taken from the record). Also depth, reading level, length, lesson duration, activities, exercises, quiz questions, difficulty mix (must total 100), illustrations, diagrams, Ghanaian context, language (English only), lesson sections and editor instructions.
- **Grounding:** only manuals verified as official, indexed, and not archived or replaced. Otherwise the request gets 422 `NO_APPROVED_SOURCES` and no provider call is made.
  - Model-suggested "official" indicators are dropped (with a warning).
  - Typed mapping is labelled "entered by editor".
  - Pedagogy checks warn about a missing collaborative activity, the activity count, remedial and extension tasks, and the difficulty mix.
- **Estimate (no provider call):** requests (and the maximum with retries), input and output tokens with their basis, cost (or "not configured"), daily quota and source passages. Generate is disabled when the estimate says it cannot run.
- **Provider errors** are shown on the item with each attempt. Non-retryable provider errors (HTTP 4xx other than 429, safety blocks) fail at once instead of spending quota on retries.
- **Item controls:**
  - cancel a queued generation;
  - retry or delete a failed one (delete: creator or Curriculum Admin; type DELETE);
  - regenerate a section (confirm);
  - edit and Save draft;
  - compare versions and restore;
  - compare with sources (generated text next to the cited passages);
  - submit or resubmit.

**Review queue (`/admin/review`).**
- **Default view:** items waiting (Awaiting review plus Resubmitted), oldest first.
- **Columns:** title, subject, topic, source manual, generation date, creator, curriculum mapping, status, assigned reviewer, revisions and submitted date.
- **Filters:** status, assigned (me or none) and subject.
- **Statuses:** Generating, Draft, Awaiting review, Changes requested, Resubmitted, Approved, Published, Archived, Generation failed.
- **Separation of duties:**
  - Authors can't approve or request changes on their own work. Authors are the creator and anyone who saved a version, the super admin included.
  - An assigned review can only be decided by its reviewer.
  - Reviewers can assign only themselves; Curriculum Admins can assign anyone except an author.
- **Publishing:** Approve, Request changes (comment required; also for approved items), Publish (with audience: level, year, programmes, institutions), Unpublish (back to Approved) and Archive, all behind confirm dialogs.
- **Publishing is blocked** while the approved version differs from the current one (`REVIEW_INCOMPLETE`), or a source manual is no longer verified and current (`SOURCE_NOT_CURRENT`).
- **Eligibility:** published resources are visible only to eligible users. That means subject access plus the audience chosen at publish time (role, level, year, programme, institution). This applies to resource lists and details, offline packs, practice progress and games.
- **History:** every action (submit, resubmit, assign, comment, decision, publish, unpublish, archive, cancel, retry) records who and when in the item history and the audit log.

## 16. Phase 8 delivered (Question Bank and Assessments §13, Educational Games §14)

**Question Bank and Assessments (`/admin/questions`).** Tabs: Questions, Review queue (reviewers), Generate and New question (authors), Assessments (activity:assign or platform:manage), Question types.
- **Types:** all 11 the platform renders and marks: multiple choice, true/false, short answer, gap fill, matching, ordering, diagram labelling, numerical, structured, essay, case study. **Teacher-marked:** essays, and the essay parts of structured and case-study questions (AI-provisional mark first when AI is configured; the teacher verifies in Teach › Assessments). Everything else is auto-marked.
- **Manual creation and editing:** subject, topic, objective, strand, year, difficulty, marks, time limit, stem, answer key (per-type template and help), rubric for essays, explanation, hint. *Check answer key* validates without saving, shows the student view and marks the key as a student answer.
- **Generation:** approved (verified official, current) manuals only (422 `NO_APPROVED_SOURCES`), live estimate (requests incl. the answer-key cross-check, tokens, cost, quota), budget check (429), approved-only retrieval. Results are drafts marked "AI draft".
- **Detail page (`/admin/questions/:id`):** preview as a student (answer it and *Check answer*; nothing is saved), answer key and sources, checks and cross-check result, workflow, usage (assessments, responses and average score, games), versions with compare, review log.
- **Workflow:** submit/resubmit, approve (checkbox: answer key verified; comment required when the cross-check disagreed), request changes and reject (comment required), archive (blocked while an open assessment or live game uses it), restore to draft, revise, duplicate, delete unused drafts. All with confirmation dialogs; authors cannot decide on their own work (super admin included).
- **Assessments:** teachers assemble them from approved questions only, schedule (opens/closes, time limit, attempts, answer release), deliver, mark and see results in Teach › Assessments (unchanged flow). The Assessments tab lists them with results and CSV.

**Educational Games (`/admin/games`), now in the sidebar.** Tabs: Games, Review queue, New game, Generate from content.
- All 10 engine types: quiz challenge, match the term, put it in order, flashcards, fill the gaps, word search, label the diagram, sort it out, timed revision, solve the scenario. Each links to a subject, topic and objective (required).
- **Editor:** title, links, difficulty, points per item, hints on/off and cost, time limit, streak bonus; pick approved questions with a verified key; type-specific content as JSON with templates.
- **Validation panel:** errors (publishing blocked), unverified answers (publishing blocked), warnings, and the dry-run result (every item played with the correct answer).
- **Preview as a student** with the same build, marking and hints, with no session or XP. **Workflow:** submit, approve (checkbox: answers verified), request changes, publish (optional year audience), unpublish, archive, restore, delete unplayed drafts. **Stats:** participation and performance.
- Students: "Games for your topics" on the subject's games page, above quick play.

## 17. Phase 9 delivered (Learning Analytics §16, AI Usage and Costs §17, Notifications §18, Audit Logs §19)

**Learning Analytics (`/admin/analytics`).** Super Admin (platform), School Admin (own school, enforced on the server), Curriculum Admin and Content Reviewer (content scope: content quality and AI cost only, with no learner data and no school, class or year filters).
- **Filters:** school, academic year, class, level, Learning Area, subject, topic and date range (default: the last 30 days). They are kept in the URL.
- **Reports, each labelled Measured, Estimate, Rule-based suggestion or AI recommendation**, with a "How this is calculated" note: enrolment, subject selection, active users, lesson completion, exercise completion, assessment results, topic performance, misconceptions (most-missed questions), objectives needing remediation (rule: under 60 % correct over at least 10 answers), game participation, AI tutor usage, content quality and review status, and AI cost (estimate). Each report has cards, a chart and a searchable, sortable table.
- **Lesson completion** is now tracked. A learner opening a published lesson is recorded, and the lesson page has a *Mark as completed* button. Staff previews are not counted.
- **Privacy defaults:**
  - Figures for groups of fewer than 5 learners are hidden. Super and School Admins can choose to show them.
  - Aggregate reports never contain names.
  - "Students needing support" is the only student-level report. It is for Super and School Admins only, loads only when asked for, and each view is audited (`analytics.student_view`).
- **Exports:** CSV and Excel for every report. They are permission-checked like the page and audited as `report.export`, with the report, format, row count and filters. The Excel sheet starts with the label and the method.
- **AI recommendation (optional):** sends aggregated, small-group-suppressed figures only, costs 1 AI request (feature `analytics_summary`) and is labelled as an AI recommendation.

**AI Usage and Costs (`/admin/ai-usage`).** Super Admin (everything), School Admin (own school; no platform budget), System Operator (by school; no per-user figures), Curriculum Admin and Reviewer (platform totals only).
- **Usage:**
  - Requests, successes, failures, refusals by limits, input and output tokens, rate-limit responses, retries and latency.
  - Broken down by feature, by provider and model, by school, by user and by day.
  - The latest failed and refused requests.
  - Today's budgets and the threshold alerts sent today.
- **Estimated cost** is always labelled as an estimate. It is tokens × the per-million rates set in AI settings.
- **Exports:** CSV and Excel, audited.
- **Limits are stored in the database and enforced by the server on every AI call:**
  - platform requests and tokens per day;
  - requests per user per day;
  - requests per school per day, with per-school overrides;
  - maximum input size and output tokens;
  - retries and timeout;
  - allowed features;
  - alert threshold.
- **Refusals:**
  - A refused call never reaches the provider. It is recorded (`limit_exceeded`, `feature_disabled`, `input_too_large`) and is not counted against budgets.
  - HTTP responses: 403 `FEATURE_DISABLED`, 413 `INPUT_TOO_LARGE`, 429 `USER_LIMIT` / `SCHOOL_LIMIT` / `AI_BUDGET`.
  - At the threshold and at 100 %, super admins (platform) or the school's admins (school) are notified once a day.
- **Health checks** make real round trips:
  - an LLM generate, which is opt-in because it costs 1 request;
  - an embedding vector;
  - OCR of a rendered image;
  - an illustration adapter check;
  - a vector search query;
  - an object storage write, read and delete.
- **Health results:** a check shows OK only if it succeeded; any error is *Failed* and an unset provider is *Not configured*. Runs are stored and audited (`ai.health_check`, with outcome failure if anything failed).
- **Settings:** Super Admins edit them; Operators see them read-only. Changes are audited with a diff (`ai_config.update`).
- **Secrets** are shown only as Set or Not set.

**Notifications (`/admin/notifications`).** Every admin user gets their inbox and preferences there. Users with `users:manage` also get **Announcements**:
- **Scope and audience:** system scope (Super Admin) or school scope (the School Admin's own school only), with an audience of roles and an optional level or year.
- **Publication period:** start (or publish now) and end, at most 180 days. Delivery is scheduled through the job queue. Items disappear from inboxes after the end or when withdrawn, and the delivery records are kept.
- **Privacy check:** text containing an email address, a phone number or a student's name is refused (422 `PERSONAL_DATA`).
- **Delivery status** is recorded per recipient and channel: in-app delivered, opted out or withdrawn; email sent, failed, not configured, opted out or no address.
- **Email** is used only when `SMTP_URL` is set. Otherwise every email is recorded as `not_configured` and nothing pretends to be sent.

**Event notifications:**
- **Publication:** content published (to the author; for lessons, also to the subject's teachers).
- **Processing failures:** manual processing failed (to curriculum admins and operators).
- **Review reminders:** for items waiting more than 24 h, sent daily at 08:00 UTC and on demand.
- **Security:** lockout (also to super admins for staff accounts), password changed or reset, roles changed, all sessions revoked.
- **AI budgets:** threshold and full.

**Preferences:** in-app and email per category, also available to learners on `/notifications`. Security alerts cannot be switched off in the app.

**Audit Logs (`/admin/audit`).**
- **Filters:** action, resource type, resource id, actor, outcome, date range and request id.
- **Exports:** CSV and Excel, up to 5,000 rows. Each export is itself audited.
- **Access:** Super Admin sees everything; School Admins see actions by users of their school; everyone else gets 403.
- **Coverage tests** (`server/test/auditcoverage.test.ts`): one test per §19 category (login and failed login, role changes, activation/suspension, manual upload/replacement, curriculum changes, approval/publication, AI config changes, exports, deletion/archival), plus checks that the log holds no secrets and is append-only.

**New environment variables:** `AI_USER_DAILY_REQUESTS` (30) and `AI_SCHOOL_DAILY_REQUESTS` (200) are the initial per-user and per-school limits; after that, the values in the database apply. `SMTP_URL` and `EMAIL_FROM` are optional email settings.

## 18. Phase 10 delivered (System Settings §20, AI provider configuration §17, security tests §23, responsive and accessibility, docs)

**System Settings (`/admin/system`, tabs Settings and Status).** Super Admin edits; System Operator reads. Stored in `PlatformSettings` (one document, 10 s cache per instance), validated by a strict Zod schema with no secret fields, and enforced on the server:

| Setting | Enforced where |
|---|---|
| Branding: app name, tagline, logo (PNG/JPEG/WebP ≤150 KB), support email | `GET /api/settings/public`; app header, admin top bar, sign-in, page title, footer |
| Theme: 5 AA-contrast presets | CSS variables `--color-brand-*` set at runtime |
| Academic year (current) | `POST /api/admin/settings/academic-year` (confirmation required); levels are listed, managed in Academic Structure |
| Review policy: reminders on/off, threshold hours (fixed: mandatory review, no self-approval) | daily `review.reminders` job |
| AI defaults | summary; edited in AI Usage and Costs (§17) |
| Uploads: max MB (≤ `UPLOAD_MAX_MB`), formats, OCR on/off, OCR pages (≤ `OCR_MAX_PAGES`) | manual upload stream (413/415), upload limits endpoint, ingestion OCR stage |
| Notifications: email on/off, longest announcement period | `notify` (email recorded `disabled`), announcement validation |
| Data retention: notifications, AI usage, jobs, tutor, audit (≥365 days), purge on/off | daily `retention.purge` job (02:30 UTC), preview and confirmed "run now" |
| Sessions: access minutes, stay-signed-in days, lockout attempts and minutes | token signing, cookie lifetimes, refresh-token expiry, login lockout |
| Offline: subject downloads, saving lessons on devices, lessons per download | `/api/offline/:subjectId` (403 when off, capped); app hides buttons and clears saved copies |
| Feature flags: self-registration, tutor, practice, games, meetings, assessments | `requireFeature` middleware before auth on those routers (403 FEATURE_DISABLED); registration; app nav and links |
| Maintenance mode: on/off, message, expected end | `authenticate`, login, refresh, register → 503 MAINTENANCE for non-admins; `admin:access` exempt; banner and maintenance screen |
| Terms and privacy text (versioned) | public `/terms` and `/privacy`, linked from sign-in, registration and the app footer |

- High-impact changes need confirmation. Without `confirm: true` the server answers `409 CONFIRM_REQUIRED` with the effects, which the UI shows in a confirm dialog before re-sending.
- Every change is audited as `settings.update`, with a flattened before/after diff of the changed keys only.
- Credential-looking values are refused with `422 SECRET_REJECTED`.

**AI provider configuration (§17).**
- **Providers table:** text generation, embeddings, OCR, illustrations, vector search and storage. For each it shows the provider, the model and where the model comes from, plus notes. Keys appear only as set or unset.
- **LLM model:** chosen in AI Usage and Costs from the provider's own model list (Gemini ListModels; no generation quota is used) and validated on save. The adapter uses it immediately, and the choice is audited.
- **Embedding model:** stays in the environment, because changing it needs a full re-index.

**Security tests (§23).**
- `server/test/security.test.ts` walks the live Express router (317 routes) and checks:
  - anonymous → 401 everywhere except the public allow-list;
  - learners, parents, teachers and counselors are refused every admin-area route;
  - learners and parents are refused content writes;
  - school admins, operators and editors are refused platform-only routes;
  - staff stay inside their areas;
  - no GET response leaks a secret, with fake values set for every env secret;
  - errors carry no stack traces;
  - mutations require CSRF.
- **Fixed:** the matrix found that school admins could reorder every school (`POST /api/config/schools/reorder`). That route is now Super Admin only.
- `server/test/phase10.test.ts` (15 tests) covers settings validation, secret rejection, confirmation, audit diffs, the academic year, the public endpoints, and enforcement of maintenance, feature flags, uploads, offline, sessions, reviews, email and announcements. It also covers the retention job and model selection.

**Responsive and accessibility.**
- `responsive.spec.ts` runs every admin page (19 views) and the teacher pages at 360 px and 768 px. Each page must have no horizontal overflow, a reachable sidebar and a clean axe scan, alongside the earlier learner pages and desktop runs.
- **Fixes:**
  - Every horizontally scrolling table and diagram is now a focusable, labelled region and a positioning context, so screen-reader-only header text cannot widen the page.
  - Grid children may shrink (`min-w-0`) and long unbroken text (job errors, warnings) wraps, so wide tables scroll inside their card instead of widening the phone layout. A regression test covers this.
  - The learner header hides the user's name on phones.
  - The admin top bar truncates long app names.
  - The previously missing `brand-100` and `brand-800` colours are now defined.

**Docs.**
- New: `SETUP.md` (local setup, environment versus settings, tests, layout) and `API_ROUTES.md` (generated).
- Updated: `DEPLOYMENT.md` (release checklist, maintenance window, retention), `server/.env.example` (complete and annotated), `API.md` and `SECURITY.md`.
- The final report is `ADMIN_PANEL_REPORT.md`.
