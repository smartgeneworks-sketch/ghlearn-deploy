# Local setup and development

## Requirements
- Node.js 20 or 22 and npm 10. The production image uses node:22-slim.
- Nothing else for local work. With no `MONGODB_URI` the API starts an in-memory MongoDB (mongodb-memory-server), and the AI features stay off until a key is set.
- Optional extras:
  - a MongoDB Atlas cluster, for persistence and Atlas Vector Search
  - a Gemini API key (free tier works)
  - Chromium for Playwright (`npx playwright install chromium`)

## First run
```bash
git clone <repo> ghlearn && cd ghlearn
npm install                                   # installs shared, server and web workspaces
cp server/.env.example server/.env            # then fill in JWT secrets (see the comments in the file)
cd server && SEED_ON_START=true npm run dev   # API on http://localhost:8080, SAMPLE data, password printed in the log
npm run dev:web                               # in another terminal, from the repo root: http://localhost:5173
```
- Vite proxies `/api` to the API, so the browser sees one origin and `COOKIE_SAMESITE=lax` works.
- Sign in as `super@sample.ghlearn.test` (Super Admin) with the password printed in the log (`SamplePass2026` in tests).
- The other sample accounts are listed in the README.
- **AI features:**
  - Set `GEMINI_API_KEY` in `server/.env` and restart. The model can then be picked in Admin › AI usage and costs.
  - Without a key, lesson generation, question generation and the tutor answer with a clear "AI unavailable" message. Nothing is faked.
- **Persistent database:** set `MONGODB_URI` (and `MONGODB_DB`). Run `npm -w server run seed` once for the SAMPLE data, or set `BOOTSTRAP_ON_START=true` for the full catalog import.

## Configuration: environment versus System settings
| Kind | Where | Examples |
|---|---|---|
| Secrets | environment only (`server/.env`, Render) | `JWT_*_SECRET`, `GEMINI_API_KEY`, `LLM_API_KEY`, `EMBEDDING_API_KEY`, `IMAGE_API_KEY`, `SMTP_URL`, `MONGODB_URI`, `SEED_PASSWORD` |
| Infrastructure and providers | environment | `CORS_ORIGINS`, cookies, `STORAGE_PROVIDER`, `VECTOR_SEARCH`, `OCR_PROVIDER`, `EMBEDDING_MODEL` |
| Hard ceilings | environment | `UPLOAD_MAX_MB`, `OCR_MAX_PAGES`, `SELF_REGISTRATION` |
| Platform settings | database (Admin › System settings) | branding, theme, review reminders, upload limit and formats, notifications, retention, sessions, offline policy, feature flags, maintenance mode, terms and privacy |
| AI limits and model | database (Admin › AI usage and costs) | budgets, per-user and per-school limits, retries, timeouts, allowed features, LLM model |

- The environment values marked `[seed]` in `.env.example` give the first values of the database settings.
- The database refuses anything that looks like a credential (`422 SECRET_REJECTED`).

## Tests
```bash
npm -w server test        # 263 API tests: vitest + supertest on in-memory MongoDB (about 5 minutes)
npm -w web test           # web component tests (vitest + Testing Library)
cd web && npx playwright install chromium && npm run e2e   # browser E2E + axe, about 8 minutes
npm run typecheck         # both workspaces
```
- **E2E setup:** the E2E run starts its own in-memory API on port 8787, using the scripted test LLM (allowed only when `NODE_ENV=test`), and a production web build under `vite preview` on port 4173.
- **Stale servers:** stop anything still listening on those ports first, for example with `fuser -k 8787/tcp 4173/tcp`.
- **Security tests:** `server/test/security.test.ts` builds the route-by-role matrix from the live Express router, so routes added later are covered automatically.

## Project layout
- `shared/src/index.ts`: Zod schemas, roles and permissions, theme presets, feature flags (used by both sides)
- `server/src`:
  - `app.ts` (middleware order, mounts) and `config.ts` (env schema)
  - `routes/`: one router per area
  - `services/`: domain logic, AI layer `ai.ts`, queue `queue.ts`, settings `platformSettings.ts`, retention `retention.ts`
  - `models/`: Mongoose models
- `web/src`:
  - `App.tsx` (routes and guards)
  - `admin/` (admin panel; `settings.tsx` is System settings)
  - `pages/` (learner and teacher app)
  - `lib/` (`api.ts`, `auth.tsx`, `platform.tsx` for branding, theme, maintenance and flags, `offline.ts`)
- `docs/`: see `ADMIN_PANEL_REPORT.md` for the full feature and endpoint list, and `DEPLOYMENT.md` for the deploy.
