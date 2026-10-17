# Security & privacy checklist
- [x] Passwords: bcrypt cost 12. Policy is 10+ chars with a letter and a number. Hash excluded from queries by default.
- [x] Sessions: httpOnly cookies. Short access JWT (15 min by default, 5–60 min in System settings, issuer-checked). Refresh tokens are opaque, stored hashed, rotated, and reuse revokes the family. Logout revokes. Suspension revokes all.
- [x] Account lockout: 8 failed logins lead to a 15-min lock (both adjustable in System settings › Sessions, 3–20 attempts and 5–240 min). Auth routes rate-limited (20/15 min/IP). API is 300/min/IP.
- [x] Generic login error, plus a dummy hash compare for unknown emails (timing).
- [x] Input validation with Zod on every write. `$` and dotted keys stripped from bodies. Invalid ObjectIds give 400/404, not 500.
- [x] helmet headers, CORS allow-list with credentials, `x-powered-by` off, JSON body limit 200 kB (360 kB on `PATCH /api/admin/settings`, for the logo and legal texts), mutations must be JSON.
- [x] RBAC + resource-level checks enforced server-side, with tests for cross-subject, cross-school, escalation and suspension.
- [x] Unpublished content hidden (404) from learners.
- [x] Logs redact cookies, authorization headers and passwords. Errors never leak stack traces (requestId instead).
- [x] Secrets only via env. `.env` is gitignored, `.env.example` is provided. Server refuses to boot without 32+ char JWT secrets, and refuses in production without `MONGODB_URI`.
- [x] Audit log for registration, onboarding, config changes and user changes.
- [x] CSRF: double-submit token (`GET /api/auth/csrf` → httpOnly `gl_csrf` cookie + token in body, client sends `X-CSRF-Token`, timing-safe compare) on all unsafe requests, plus an Origin allow-list check. Designed for `SameSite=None; Secure` cross-site cookies.
- [x] Uploads: size cap, magic-byte check, encrypted PDFs rejected, filename sanitised, files never served to learners. Remote fetch is host allow-listed (SSRF).
- [ ] Email verification, password reset, guardian consent (minors)
- [ ] Data export/delete for users (Ghana Data Protection Act 2012, Act 843)
- [x] AI safety: document passages are fenced as untrusted data with markup neutralised (`‹passage›`), are never placed in system prompts, and system prompts say never to follow embedded instructions. The tutor detects canary leaks, screens input for injection, self-harm (fixed safety reply with 112 / trusted adult, no LLM call) and phone numbers, refuses outside the subject, and labels general-knowledge answers. Student essay text is fenced the same way for AI marking, and marks are clamped to rubric maxima.
- [x] Retrieval filters (subject, level, indexed, mapping-confirmed, not rejected/duplicate) are enforced in the query, not the prompt. Covered by tutor isolation tests.
- [x] AI content is never shown to learners before human approval (lessons: review → approve → publish; questions: approve = publish). AI essay marks are labelled provisional until a teacher verifies them.
- [x] Assessments: answer keys and option permutations stay server-side; time limits are enforced by the server; attempts, game sessions, progress and marking are owner-, school- and subject-scoped (others get 404/403). Covered by `assess.test.ts`.
- [x] Rewards cannot be farmed: XP is idempotent per attempt/session, replays only earn improvement, a daily cap applies, and no XP is given for time spent. Leaderboards are off by default, school-scoped and anonymised by default.
- [x] Budgets: daily LLM request/token budgets (`LLM_DAILY_*`) and a per-user tutor message limit; every call is recorded in `aiusages`.
- [ ] Output moderation classifier for minors beyond provider safety filters; human red-teaming of tutor prompts.
- [ ] Dependency scanning in CI, backups schedule, Sentry

## Phase 6
- Exports: CSV cells escaped + formula-injection prefix; PDF built server-side from stored data; all exports audited.
- Offline pack: published content only, everything escaped except server-generated SVG (itself escaped), served as attachment with `Content-Security-Policy: default-src 'none'` (also embedded as a meta tag in the file).
- Analytics scope is computed on the server from the caller's roles; client filters cannot widen it (other school/class → 403). Storage/health are super-admin only.
- Notifications never carry answer keys or other students' data; read/mark is owner-scoped.

## Phase 10 (Oct 2026): settings, route matrix, secret protection
- **System settings never hold secrets.**
  - The schema is strict, with no secret fields.
  - Any value that looks like a credential is refused with `422 SECRET_REJECTED`. This covers Google API keys, `sk-` keys, private keys, connection strings or SMTP URLs with passwords, and GitHub, Slack and Render tokens.
  - Any value that contains a configured env secret (JWT secrets, AI keys, `SMTP_URL`, `MONGODB_URI`) is refused the same way.
  - The logo must be a validated PNG, JPEG or WebP (magic bytes checked, 150 KB or less). SVG is refused.
- **High-impact settings need `confirm: true`.** Without it the server answers `409 CONFIRM_REQUIRED` with the list of effects. This covers:
  - maintenance on
  - a feature switched off
  - shorter retention, or the purge turned on
  - shorter sessions or a lockout change
  - fewer upload formats or a lower size limit
  - offline downloads off
  - new legal text
  - email off
  - a change of the current academic year
  - a manual purge run
- **Every settings change is audited.** The audit entry is `settings.update`, with a flattened before/after diff of only the changed keys, plus whether it was confirmed. Other audited actions are `settings.academic_year`, `settings.retention_run`, `retention.purge` and `ai_config.update`.
- **Maintenance mode is enforced on the server.**
  - Non-admins get `503 MAINTENANCE` on every authenticated route, on login, on token refresh and on registration. The login attempt is audited as denied.
  - Users with `admin:access` are exempt, and logout always works.
- **Feature flags are enforced before authentication** on `/api/tutor`, `/api/practice`, `/api/games`, `/api/assessments` and `/api/meetings` (`403 FEATURE_DISABLED`), as well as on registration and offline downloads.
- **Generated route-by-role matrix** (`server/test/security.test.ts`). It walks the live Express router (317 routes) and checks:
  - Anonymous callers get 401 everywhere except an explicit public allow-list.
  - Learners, parents, teachers and counselors are refused every admin-area route (`/api/admin*`, `/api/jobs`, `/api/documents`, analytics reports, the curriculum review queue).
  - Learners and parents cannot write curriculum, configuration, questions, games or announcements.
  - Platform-only routes refuse school admins, operators and editors.
  - Content staff and operators cannot manage users, schools or classes, and content staff cannot read the audit log.
  - The walk found one real gap, which is now fixed: `POST /api/config/schools/reorder` accepted school admins and let them reorder every school. It is now Super Admin only.
- **Secret scan.** Every parameter-free GET route is called as Super Admin, operator, school admin and student, with fake values set for every env secret. No response may contain the secret values, the JWT secrets, the SMTP password or a bcrypt hash. AI keys are shown only as `{name, purpose, set}`.
- **Retention.** A daily `retention.purge` job (02:30 UTC) deletes old records:
  - notifications
  - AI usage records, health checks and alerts
  - finished jobs
  - stale tutor conversations and their messages
  - audit logs, never kept for less than 365 days
  
  Each run writes its own audit entry with the counts. The audit log stays append-only for everything else.
