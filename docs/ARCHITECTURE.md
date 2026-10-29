# GH Learn: Architecture & Implementation Plan

## 1. Scope
GH Learn is an AI-assisted learning platform built on approved Ghanaian curriculum documents. It targets the SHS curriculum first, and JHS can be enabled by an administrator through `AcademicLevel.enabled`. It is a separate monorepo at `/workspace/ghlearn` (to become its own GitHub repo). The existing catalog app (`/workspace/curriculum-app`, live at gh-curriculum-f31c9.web.app plus Render `gh-curriculum-api`) is **not modified**, and later phases will import its 2,813-document index (`/workspace/curriculum/index.json`, Drive folder `1UBR5rG6EtORdYspnmk1x0l-ngq5AWq1t`) as `CurriculumDocument` records with provenance.

## 2. Repository layout
```
ghlearn/
  shared/   Zod schemas, roles, permission matrix (used by server AND web)
  server/   Node 20 + TypeScript + Express 5 + Mongoose 9
  web/      React 19 + Vite + TS + Tailwind 4 + TanStack Query + React Router + RHF/Zod
  docs/     this file, DATA_MODEL, PERMISSIONS, API, DEPLOYMENT, SECURITY, CREDENTIALS, BACKLOG
```

## 3. Tech decisions
| Concern | Choice | Reason |
|---|---|---|
| HTTP | Express 5 | Async errors propagate natively, and it is already used in the catalog app |
| Validation | Zod 4 in `@ghlearn/shared` | The same rules apply on the client and the server |
| CSRF | Double-submit token delivered in the response body (cross-site cookies can't be read by the SPA) + Origin check | Needed for SameSite=None |
| Auth | bcrypt (12 rounds, `bcryptjs`) + JWT access cookie `gl_at` (15 min) + opaque refresh cookie `gl_rt` (14 d, SHA-256 hashed in DB, rotated, reuse ⇒ family revoked) | httpOnly cookies keep tokens away from JS. Argon2 was considered, but bcryptjs needs no native build on Render free tier |
| RBAC | Role → permission matrix (shared) + resource-level guards (`canAccessSubject`) | Separates "may use the feature" from "may touch this subject/school" |
| Security middleware | helmet, CORS allow-list, express-rate-limit (global + strict on auth), body `$`/`.` key stripping, Zod on every input, 200 kB JSON limit, JSON-only mutations (CSRF mitigation) | |
| Errors | `{error:{code,message,details,requestId}}` | One consistent shape the UI can rely on |
| Logging | pino (JSON) with cookie/password redaction, `x-request-id` | Works with Render log streams |
| API docs | OpenAPI 3.1 at `GET /api/docs/openapi.json` | |
| Charts / animation | recharts / framer-motion | |

## 4. Hosting plan (free tiers, no GCP billing)
| Piece | Host | Notes |
|---|---|---|
| Web | Firebase Hosting (Spark), new site e.g. `ghlearn-<id>` in project gh-curriculum-f31c9 | Add a `/api/**` rewrite. Spark cannot rewrite to Render, so options are (a) cross-site cookies `SameSite=None; Secure`, or (b) a custom domain shared by both. See DEPLOYMENT.md |
| API + worker | Render free web service | Sleeps after 15 min idle. The worker runs in-process (below) |
| DB | MongoDB Atlas M0 (existing cluster) | 512 MB cap, which is the main scaling limit for chunks and embeddings |
| Files | Google Drive (existing) for source PDFs; generated images later in Drive or Firebase Storage (Spark has 5 GB) | Drive access goes through a server-side service credential |

## 5. Background jobs
**Choice: Agenda-style MongoDB-backed queue (`agenda` or a small custom `jobs` collection with leases)**, running in the API process.
- BullMQ needs Redis. Free Redis (Upstash) has request caps, and adding it would mean another credential.
- A Mongo queue survives the Render sleep: jobs resume on wake, and leases plus retries with backoff make work idempotent.
- When paid hosting exists, a separate worker service can run from the same image (`ROLE=worker`).
Implemented in Phase 3 as a custom `jobs` collection (`services/queue.ts`). See INGESTION.md.

## 6. Vector search / RAG
**Primary: Atlas Vector Search** on the `chunks` collection (`$vectorSearch` with filter `{subjectId, status:'indexed'}`), which M0 supports with limits. **Local/test fallback:** an in-process cosine scan over `chunks` restricted by subjectId, behind a `VectorStore` interface, so tests and dev run without Atlas. Retrieval is **always** pre-filtered to subjects the requester is authorised for, enforced by the server rather than the prompt.

## 7. AI provider layer
`server/src/services/ai.ts` defines `LlmProvider`, `EmbeddingProvider`, `OcrProvider` and `ImageProvider` interfaces, with adapters selected by environment. When a provider is unconfigured, the feature reports `disabled` (see `/api/health`) and callers return a clear 503. Nothing is faked. Planned adapters: OpenAI-compatible (also covers xAI/Groq/Together/OpenRouter), Google Gemini, and a local Ollama option for dev. OCR is pdf text layer first, then tesseract.js, then a cloud OCR adapter.

## 8. Content pipeline (Phase 3+)
`upload → store (Drive) → extract (pdf text / OCR) → segment by strand/sub-strand/indicator headings → chunk + embed → map to curriculum (human confirms) → generate drafts (notes, exercises, quizzes, games) with source page refs → review → approve → publish`. Students see only `status=published` resources of subjects in their `StudentProfile.subjectIds` (implemented and tested now).

## 9. Assumptions (rule 16)
1. Self-registration always creates a `student`. Every other role is granted by an admin.
2. Levels, Learning Areas (stored as `programmes`), subjects and suggested combinations are **global** (national curriculum). Schools pick which level kinds they offer.
3. Students pick any core and elective subjects of their level in two sections (core subjects pre-selected), with no combination or elective limits, and can change them from My profile. Combinations are kept only as optional reference data. Student profiles also store a region (16 regions of Ghana) and the school name as typed; the school is linked when the name matches a configured school.
4. After onboarding, students cannot change their own subjects. A school admin uses `PATCH /api/admin/students/:id/subjects`.
5. Seeded subject names are common SHS offerings, **labelled SAMPLE**, and are not an authoritative official list.
6. Teachers access subjects only through `TeacherAssignment`. School admins have no learner-content access by default.
7. Under-18 data minimisation: date of birth and guardian email are optional, and a guardian-consent workflow comes in a later phase.

## 10. Phased plan
1. **Phase 1 (done):** architecture, data model, permissions.
2. **Phase 2 (done):** auth, RBAC, config admin, onboarding, learning-space access control, tests.
3. **Phase 3 (done):** upload, GridFS/remote storage, Mongo queue, extraction/OCR, structure, chunking, Gemini embeddings, report + mapping UI, duplicate detection, index import, CSRF.
4. **Phase 4 (done):** Gemini LLM adapter via queue with budgets; §7 A–K lesson generation, editing, versions, review/publish; RAG retrieval; subject tutor (spec §8).
5. **Phase 5 (done):** question bank (11 types + rubrics), generation with answer-key validation, cross-check and near-duplicate detection, marking (auto + AI-provisional rubric marking verified by teachers), 7 practice modes, 10 games, rewards, leaderboard, progress dashboard and recommendations, teacher assessments.
6. **Phase 6 (done):** teacher workspace (classes, class assignments, misconceptions, support, remedial, CSV/PDF reports, offline packs), scoped analytics, audit screen, in-app notifications — see TEACHING.md. Parent view still pending.
7. **Phase 7:** accessibility audit, localisation, content operations at scale.
8. **Phase 8:** PWA/offline, CI/CD, deploy, hardening, pilot.

## LLM use (Phases 4–5)
`StreamingLlm` has a Gemini adapter (`gemini-3.8-flash` default, thinking level low, JSON mode, SSE streaming; configurable `LLM_MODEL`) using the same `withRetry` bounded backoff. Free-tier limits (requests/min and per day) mean generation runs **only** through the job queue, with one generation job at a time per worker and a per-day budget counter (`LLM_DAILY_REQUEST_BUDGET`). Prompts always pass retrieved chunk text as quoted source material, not as instructions. Outputs are stored as `draft` LearningResources with chunk/page citations and are never auto-published.

Every LLM call goes through `services/usage.ts` (budget check + `aiusages` record). Bulk generation (lessons, questions, essay marking) runs in the Mongo job queue with bounded retries; only the tutor streams synchronously. Docs: LESSONS.md, TUTOR.md, ASSESSMENT.md.
