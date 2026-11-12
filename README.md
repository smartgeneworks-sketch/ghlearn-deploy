# GH Learn: AI-powered learning platform for Ghana SHS/JHS

A monorepo with three workspaces:
- `shared`: Zod schemas and the permission matrix
- `server`: Express 5, TypeScript and Mongoose, with a job worker
- `web`: React 19, Vite, Tailwind, TanStack Query, plus a PWA

It is separate from the existing catalog app (`gh-curriculum-f31c9.web.app` and Render `gh-curriculum-api`) and leaves that app untouched.

## Live (free tiers)
| | URL |
|---|---|
| Web (Firebase Hosting site `ghlearn-f31c9`) | https://ghlearn.com (www and ghlearn-f31c9.web.app redirect here) |
| API (Render free web service `ghlearn-api`) | https://api.ghlearn.com (also ghlearn-api.onrender.com; health: `/api/health`) |

Sample accounts are all clearly marked SAMPLE and use `@sample.ghlearn.test`: `super@`, `admin@` (school admin), `curriculum@` (curriculum admin), `operator@` (system operator), `editor@`, `teacher@`, `counselor@`, `ama@` (student), `kofi@` (student). Staff accounts land in the admin panel at `/admin`.
- **Locally**, the password is `SamplePass2026`.
- **On the live deploy**, the password is the `SEED_PASSWORD` set in the Render environment. It is not stored in this repo.

## Quick start (no database or keys needed)
```bash
npm install
cd server && JWT_ACCESS_SECRET=$(openssl rand -hex 32) JWT_REFRESH_SECRET=$(openssl rand -hex 32) SEED_ON_START=true npm run dev
npm run dev:web    # http://localhost:5173
```

## Tests
- `npm test`: server API tests (vitest + supertest, in-memory MongoDB) and web component tests.
- `cd web && npx playwright install chromium && npm run e2e`: browser E2E. The API runs in-memory with the scripted test LLM (allowed only when `NODE_ENV=test`), and the web runs as a production build under `vite preview`. It covers:
  - `scenario.spec.ts`: the 12-step end-to-end scenario
  - `denial.spec.ts`: URL and API manipulation is refused
  - `meetings.spec.ts`: counselor availability → student books → counselor accepts; subject edit in My profile
  - `responsive.spec.ts`: 360/768/1366 px viewports for learner, teacher and every admin page, plus the PWA manifest and service worker
  - `phase10.spec.ts`: System settings (branding and theme, terms text, feature flags, maintenance mode, read-only operator view)
  - axe checks (WCAG 2.1 A/AA, failing on serious or critical) on every key screen

## Docs
`docs/SETUP.md` (local setup) · `ADMIN_PANEL_REPORT.md` (final admin panel report) · `ARCHITECTURE.md` · `INGESTION.md` · `DATA_MODEL.md` · `PERMISSIONS.md` · `LESSONS.md` · `TUTOR.md` · `ASSESSMENT.md` · `TEACHING.md` · `API.md` (+ `/api/docs/openapi.json`) · `DEPLOYMENT.md` (deploy, backup, monitoring, limitations, costs) · `SECURITY.md` · `CREDENTIALS.md` · `BACKLOG.md`. The env template is `server/.env.example`.

## Status
The admin panel (spec phases 1–10) is complete; see `docs/ADMIN_PANEL_REPORT.md`. Earlier platform phases 1–7:
- architecture, auth/RBAC/CSRF, configuration and onboarding
- ingestion and embeddings
- AI lessons with review and publish
- RAG tutor
- question bank, marking, practice, games and rewards
- teacher workspace, analytics, audit and notifications
- Oct 2026 changes: region + free-text school name at onboarding, unrestricted core/elective subject choice editable from My profile, "Learning Area" wording, region analytics filter, counselor role and Meetings
- Phase 7: browser E2E, PWA with offline saved lessons, code-splitting, Dockerfile, and the production deploy

The CI workflow is parked at `docs/ci.workflow.yml`, because the GitHub token lacks the `workflow` scope.
