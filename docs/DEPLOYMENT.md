# Deployment, backup and monitoring

## Topology
```
Browser ──> https://ghlearn.com  (Firebase Hosting site ghlearn-f31c9, Spark plan, static SPA + service worker; www and *.web.app redirect here)
   │  fetch(credentials:'include'), CSRF header
   └──> https://api.ghlearn.com = ghlearn-api.onrender.com   (Render free web service "ghlearn-api", Docker, region oregon)
            └──> MongoDB Atlas M0, database "ghlearn" (separate from the catalog DB) + Atlas Vector Search "chunk_vectors"
            └──> Gemini API (gemini-3.8-flash for text, gemini-embedding-001 at 768 dims for embeddings), free tier
```

## API on Render
- **Why a public deploy mirror:** the source repo `smartgeneworks-sketch/ghlearn` is private, and the Render GitHub app is not installed, so Render cannot fetch it. The simplest secure option is a **code-only public mirror**, `smartgeneworks-sketch/ghlearn-deploy`.
  - The mirror is published by `scripts/publish-deploy-mirror.sh`. Each publish is a history-less snapshot of HEAD.
  - `server/data/uploaded.jsonl` (private Drive file ids) and `docs/CREDENTIALS.md` are excluded.
  - No secrets exist in either repo. All runtime config lives in Render environment variables.
  - The alternative, Render image deploy, would need a container registry and credentials, which adds moving parts.
- **Service:** `ghlearn-api` (id `srv-db81vb5g1s2s738nji8g`).
  - Runtime: Docker, using the root `Dockerfile` (node:22-slim multi-stage, non-root user, HEALTHCHECK).
  - Plan: free. Health check path: `/api/health`. Builds from mirror branch `main`. autoDeploy is enabled, but without the Render GitHub app no push webhook fires, so trigger each deploy explicitly.
- **Redeploy:**
  ```bash
  git push origin main
  GIT_NAME=... GIT_EMAIL=... scripts/publish-deploy-mirror.sh
  curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" -H 'Content-Type: application/json' -d '{}' \
    https://api.render.com/v1/services/srv-db81vb5g1s2s738nji8g/deploys   # or "Manual Deploy" in the dashboard
  ```
- **Environment variables** (names only; values live in Render):
  - `NODE_ENV=production`
  - `MONGODB_URI`, with `MONGODB_DB=ghlearn`
  - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (fresh 48-byte random values)
  - `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`
  - `CORS_ORIGINS=https://ghlearn.com,https://www.ghlearn.com,https://ghlearn-f31c9.web.app,https://ghlearn-f31c9.firebaseapp.com`
  - `APP_URL=https://ghlearn.com`, `COOKIE_SAMESITE=lax`, `COOKIE_DOMAIN=.ghlearn.com` (see CUSTOM_DOMAIN.md). Change env vars **one key at a time** (`PUT /env-vars/{KEY}`); never PUT the whole array.
  - `GEMINI_API_KEY`
  - `VECTOR_SEARCH=atlas`
  - `LLM_DAILY_REQUEST_BUDGET=40` (seeds the platform daily budget in AI settings on first use; afterwards edit it in Admin › AI Usage and Costs)
  - `LLM_MONTHLY_REQUEST_BUDGET=10000`, `LLM_MONTHLY_COST_BUDGET_USD=10`: monthly hard caps, seeded the same way. Every AI call is refused once this calendar month (UTC) reaches either the request count or the estimated cost (at the AI settings token rates; 0 = no cost cap). Admin › AI Usage and Costs shows a month meter, and super admins are alerted at the threshold. These are app-side stops; a Cloud Billing budget only sends alerts.
  - optional: `AI_USER_DAILY_REQUESTS` (30), `AI_SCHOOL_DAILY_REQUESTS` (200), `SMTP_URL` + `EMAIL_FROM` (email notifications; unset = in-app only)
  - `WORKER_ENABLED=true`
  - `BOOTSTRAP_ON_START=true`
  - `SEED_PASSWORD`
  - `LOG_LEVEL=info`
  - CSRF uses a random double-submit token plus an Origin allow-list, so there is **no CSRF secret** to set or rotate.
  - **Secrets versus settings:** only the environment holds secrets.
    - Platform settings (branding, theme, uploads, retention, sessions, offline, feature flags, maintenance, terms and privacy) live in MongoDB and are edited in Admin › System settings.
    - Env values marked `[seed]` in `server/.env.example` only give the first values.
    - `UPLOAD_MAX_MB`, `OCR_MAX_PAGES` and `SELF_REGISTRATION` remain hard ceilings.
    - The full list is in `server/.env.example`.
- **Bootstrap** (`server/src/bootstrap.ts`) is idempotent. It runs in the background after `listen` when `BOOTSTRAP_ON_START=true`, or once by hand with `node dist/bootstrap-cli.js` in a Render shell. It:
  1. syncs the Mongoose indexes
  2. creates the Atlas Vector Search index `chunk_vectors` on `chunks.embedding` (768 dims, cosine, filters `subjectId`/`documentId`) through the driver's `createSearchIndex`, which works on M0
  3. seeds the clearly labelled SAMPLE school and users, only if school `SAMPLE-01` is absent
  4. seeds the 73 subjects found in `data/index.json`
  5. imports all 2,813 catalog entries as `CurriculumDocument` records (by remote URL, upserted, with duplicates marked by checksum)
  - The "bootstrap finished" log line carries the totals.
  - A full re-run takes about 15 minutes on the free instance. If the instance sleeps mid-run, the next boot resumes the work.
- **Processing documents:** imported documents are `not_processed`. An editor processes them on demand (Documents → Process), which fetches the PDF from its allow-listed public URL, extracts it, chunks it and embeds it.
  - Do this selectively, because Atlas M0 has 512 MB.

## Web on Firebase Hosting
- This is a **new site**, `ghlearn-f31c9`, in project `gh-curriculum-f31c9`. The catalog site `gh-curriculum-f31c9` is not touched.
- Config is in `web/firebase.json`:
  - SPA rewrite
  - immutable `/assets/**`
  - `no-cache` for `sw.js` and `asset-manifest.json`
  - CSP with `connect-src` limited to the API, HSTS, nosniff
- **Deploy:**
  ```bash
  cd web && VITE_API_URL=https://ghlearn-api.onrender.com npm run build
  GOOGLE_CLOUD_QUOTA_PROJECT=gh-curriculum-f31c9 firebase deploy --only hosting:ghlearn-f31c9 --project gh-curriculum-f31c9
  ```
- An optional `web/Dockerfile` (nginx) exists for hosts other than Firebase.

## Release checklist
1. `npm run typecheck`, `npm -w server test`, `npm -w web test`, `cd web && npm run e2e` all green.
2. `git push origin main`, then publish the mirror and trigger the Render deploy (see above). Poll `GET /v1/services/<id>/deploys?limit=1` until `status` is `live`.
3. Build and deploy the web app (see below). The service worker picks up the new build on the next visit.
4. Smoke test:
   - `GET /api/health` returns `db:true`.
   - `GET /api/settings/public` shows the expected app name.
   - Sign in as the sample Super Admin and open Admin › System settings, and its Status tab.
5. **Maintenance window (optional):** before a risky change, turn on System settings › Maintenance mode with a message.
   - Learners and teachers see it and are refused with 503. Admins keep working.
   - Turn it off afterwards. Both changes are in the audit log.

## Data retention
- The `retention.purge` job runs daily at 02:30 UTC inside the API process, when `WORKER_ENABLED=true`. It deletes:
  - notifications
  - AI usage records, health checks and alerts
  - finished jobs
  - stale tutor conversations and their messages
  - audit logs older than the System settings › Data retention periods (audit logs are always kept at least 365 days)
- Each run is audited as `retention.purge` with the counts. A Super Admin can preview what is due, and run it now (with confirmation), from the same page.
- **On the free Render instance** the job runs when the instance is awake. If it sleeps through 02:30, the job runs at the next wake-up.
- **Backups** (below) are not affected by retention. Delete old dumps separately if records must be erased everywhere.

## Backups
- **Daily logical backup** of the `ghlearn` database only:
  ```bash
  mongodump --uri "$MONGODB_URI" --db ghlearn --gzip --archive=ghlearn-$(date +%F).gz
  ```
  Run it from a machine whose DNS resolves Atlas SRV records (the agent box cannot) or from a scheduled GitHub Action. Keep 14 daily and 8 weekly copies outside Atlas, for example in Drive.
- **Restore:**
  ```bash
  mongorestore --uri "$MONGODB_URI" --gzip --archive=ghlearn-YYYY-MM-DD.gz --nsInclude 'ghlearn.*' --drop
  ```
  Then restart the service. The vector index is recreated by bootstrap if it is missing.
- **Exclusions:** M0 has no point-in-time or snapshot backups, so mongodump is the only copy. Uploaded PDFs are stored in MongoDB when `STORAGE_PROVIDER` is the default, so they are included in the dump. Imported documents point at public URLs.

## Monitoring
- **Health:** `GET /api/health` returns `{ok, db, ai:{llm, embeddings, ocr, image}}`. It is Render's health check. Add a free uptime pinger (UptimeRobot or cron-job.org, every 10 minutes); this also limits cold starts.
- **Analytics** (super admin → Analytics) shows the platform health section: AI usage per day against the budget, failed jobs, and content pipeline counts. `GET /api/lessons/budget` gives today's LLM requests and tokens against the budget.
- **Logs:** JSON pino logs in the Render dashboard, or through the Render API (`GET /v1/logs?ownerId=...&resource=srv-db81vb5g1s2s738nji8g`). Watch for `job failed`, `bootstrap failed`, and HTTP 5xx.
- **Audit:** the audit log (admin → Audit, CSV export) records every privileged action.

## Limitations (current deploy)
- **Cookies:** first-party since 15 Oct 2026 (ghlearn.com and api.ghlearn.com are the same site, so `SameSite=Lax`), so browsers that block third-party cookies keep the session. See CUSTOM_DOMAIN.md.
- **Free Render instance:** it sleeps after about 15 minutes idle, cold starts take 30–60 s, it has 512 MB RAM and runs a single instance. The in-memory rate limiter resets on restart. The job worker runs inside the web process, so jobs pause while the instance sleeps.
- **Gemini free tier:** the daily quota for gemini-3.8-flash ran out after about 25 requests in testing, so `LLM_DAILY_REQUEST_BUDGET=40` is the app-side cap. When quota is hit, generation and the tutor return a clear "AI unavailable / budget reached" error. Embeddings are counted separately.
- **Atlas M0** has 512 MB, enough for about 2,000 processed manuals at most. Process documents selectively, and consider M2/M10 before a real rollout.
- **Source PDFs:** the private Drive file ids (`uploaded.jsonl`) are not in the public mirror, so imported documents are fetched from their public `curriculumresources.edu.gh` URLs. There is no server-side Drive credential.
- **OCR:** none in production (`OCR_PROVIDER` is disabled on Render, for RAM). Scanned PDFs without a text layer give empty chunks.
- **No image generation.** Diagrams are LLM-drawn SVG, sanitised and labelled as system-generated.
- **No email or SMS on the live deploy** (`SMTP_URL` unset): notifications are in-app only. There is no password reset, email verification or guardian consent yet.
- **CI is parked** in `docs/ci.workflow.yml`, because the token lacks the `workflow` scope.
- **The E2E suite uses the scripted test LLM,** not Gemini. Live Gemini behaviour is only spot-checked.
- **The 12-step E2E scenario** follows my reading of spec §20, because the original §20 text was not available in the repo.

## Costs
| Item | Plan | Cost now | When it starts costing |
|---|---|---|---|
| Render web service | Free | $0 | Starter is $7/month (no sleep, more RAM) |
| MongoDB Atlas | M0 | $0 | Flex/M10 from about $8–57/month when data passes 512 MB |
| Firebase Hosting | Spark | $0 | over 10 GB storage or 360 MB/day transfer |
| Gemini API | Free tier | $0 | Paid tier: set `AI_COST_INPUT_PER_M`/`AI_COST_OUTPUT_PER_M` so Analytics shows cost estimates |
| GitHub (private repo + public mirror) | Free | $0 | |

## Custom domain (ghlearn.com)

See [CUSTOM_DOMAIN.md](CUSTOM_DOMAIN.md) for the Namecheap DNS table, Firebase/Render setup, and the cookie flip after TLS is active.

## Operator notes (keep current)
- **Canonical URLs:** https://ghlearn.com (app) and https://api.ghlearn.com (API). The `*.web.app` hosts redirect through `web/public/host-redirect.js`; don't delete it without reading CUSTOM_DOMAIN.md §4.
- **Render env vars:** change them only with `PUT /env-vars/{KEY}` and `{"value":…}`. An array `PUT /env-vars` wipes every key. As of 15 Oct 2026 there are 17 keys: the original 15 plus `APP_URL` and `COOKIE_DOMAIN`.
- **CSP `connect-src`** in `web/firebase.json` must list every API origin the SPA calls. A missing origin breaks the app silently in the browser while curl still works.
- **DNS checks from the box:** use DoH (`https://dns.google/resolve?name=…&type=…`). Plain port-53 lookups on the box are intercepted.
- **Cookies:** `SameSite=Lax` with `Domain=.ghlearn.com`. Logging in on any non-ghlearn.com origin (such as web.app against onrender) no longer keeps a session, which is why web.app redirects.
