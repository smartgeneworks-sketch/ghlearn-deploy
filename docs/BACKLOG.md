# Remaining tasks & technical debt (prioritised)
1. **Done (Phases 4–5):** AI lessons + review/publish, RAG tutor, question bank, marking, modes, games, rewards, progress.
2. **P0 (before deploy):** run the importer against Atlas; create Atlas Vector Search index on `chunks.embedding` (768, cosine, filter `subjectId`); seed the real SHS subject list (the import matched only 338 docs against sample subjects); decide on Atlas capacity (M0 512 MB holds ~2,000 processed manuals at most) or selective processing.
3. **P1:** password reset and email verification (needs email provider). Guardian consent flow for under-18s.
4. **P1:** Drive ObjectStore implementation once a server-side Drive credential exists; full config row edit form (only activate/deactivate/delete are in the UI now).
5. **P1:** OCR runs inside the API process on Render free (512 MB RAM). Large scanned PDFs may need a cap or a separate worker. The tesseract language data downloads on first use (or set `OCR_LANG_PATH`).
11. **P2:** more structure heuristics (SHS learner manuals use unlabelled ALL-CAPS strand headings; they are deliberately not auto-promoted now).
12. **P2:** the audit log has no UI yet (API exists, and it is school-scoped now).
6. **P1:** CI (GitHub Actions: typecheck, tests, build), Dockerfile, Sentry adapter.
7. **P2:** the web bundle is 600 kB+ (recharts/framer). Code-split admin routes.
8. **P2:** Playwright E2E for register → onboarding → learn. Only API and component tests exist now.
9. **P2:** PWA/offline (Phase 8).
10. **P2:** `express-rate-limit` uses an in-memory store, which resets on restart and is per instance. Fine on single-instance Render.

## After Phase 5
- Spec §7 A–K mapping confirmed and implemented (Oct 2026).
- Image-based illustrations (F) from source pages are not extracted yet; all diagrams are system-generated SVG and labelled as such.
- Mastery is per topic string; move to curriculum-node ids once mapping coverage is high.
- Game content depends on published lessons (terms, flashcards, concept maps) and published questions; word search / classification / flashcards return `NO_CONTENT` until a lesson with that data is published.
- Leaderboard aggregation reads `xpevents` per request; add a weekly rollup if schools get large.
- Create Atlas vector index `chunk_vectors` (768 dims, cosine) then set VECTOR_SEARCH=atlas.
- Run import-index + seed-subjects against Atlas; verify subjects (POST /api/config/subjects/:id/verify).
- Browser E2E tests for lesson editor and tutor. Add CI workflow (token needs workflow scope).

## Phase 6 — done
Teacher workspace (classes, class-targeted assignments, class/individual views, needs-support rules, misconceptions, remedial assignments, CSV/PDF reports, offline packs), permission-scoped analytics, audit log screen with filters/CSV, in-app notifications. `LLM_DAILY_REQUEST_BUDGET` default lowered to 40.

## Still open
- Live re-check of section F diagram normalization once Gemini quota resets (not run this phase on purpose).
- Email/SMS delivery for notifications; due-soon reminders (needs a scheduler job).
- Parent view (`progress:view_child`).
- Analytics caching/pre-aggregation if Atlas M0 gets slow (queries are live today).
- Image extraction for illustrations; mastery on curriculum-node ids; Atlas vector index; importer + subject seed on Atlas; CI workflow (token scope); browser E2E tests.

## Phase 7 — done (Oct 2026)
- Playwright E2E (12-step scenario, URL/API denial, axe, 360/768/1366 viewports), PWA with offline saved lessons, route code-splitting (largest chunk 263 kB), Dockerfiles, live deploy (Render `ghlearn-api` via public code-only mirror, Firebase site `ghlearn-f31c9`), idempotent production bootstrap (vector index, sample seed, 73 subjects, 2,813-entry import).
- Found live and fixed: `POST /api/lessons` without `controls` failed (`Cannot read properties of undefined (reading 'sections')`) because Zod 4 `.default()` does not parse the default; it now uses `.prefault({})`, with a regression test. Embedding progress could show over 100%.

## Still open after Phase 7
- P0 for real users: a custom domain (same-site cookies), or this deploy breaks for browsers that block third-party cookies.
- P1: move CI into `.github/workflows` (needs a token with `workflow` scope); scheduled mongodump; uptime pinger.
- P1: run the worker separately from the web instance, or on a paid instance, so jobs survive sleep.
- P1: email (reset/verification/consent), Drive credential for private source PDFs, OCR on a worker.
- P2: E2E against a real LLM in a nightly job with a small budget; parent view; analytics pre-aggregation.

## Live verification (15 Oct 2026, 00:40–01:00 UTC)
- Health ok (db true, Gemini LLM and embeddings configured). Atlas vector index `chunk_vectors` is READY. The bootstrap imported 2,813 documents (302 marked duplicates) and 75 subjects (73 from the index plus 2 sample subjects).
- Browser: sample student login, 7 subjects, onboarding of a new registered student, and service worker active. Staff URLs are blocked in the UI and `/api/admin/users` returns 403.
- One real Gemini lesson generation from the processed Biology learner manual (38 pages, 30 chunks, embedded live) succeeded:
  - all sections A–K, validation ok, 44 page citations
  - section F gave 2 normalized, script-free, system-generated SVG diagrams (the diagram fix holds)
  - the model followed the manual's microscopy pages more than the requested topic wording
- Tutor: Atlas vector retrieval returned 6 verified sources, but Gemini answered HTTP 429 (free-tier quota) on both attempts. The UI showed the friendly error. Re-test after the quota resets.
