# Phase 3: Document ingestion

## Flow
`upload (or import) → job "document.process" → fetch bytes → validate PDF + SHA-256 → per-page text (pdf.js) → OCR for pages with <25 chars (provider) → structure detection (unverified) → boilerplate removal + chunking → embeddings (provider) → processingReport`

- **Upload** `POST /api/documents/upload` (multipart, field `file`, plus the §9 metadata fields). Accepts PDF, DOCX, TXT and CSV. The body is **streamed** with busboy straight into GridFS while it is hashed: no whole-file buffer and no temporary disk file. Checks: max `UPLOAD_MAX_MB` (60) (Content-Length pre-check plus a streaming limit), extension plus mime type, content sniffing (`%PDF-`, DOCX zip with `word/document.xml`, UTF-8 text without NUL bytes), encrypted PDFs rejected (422), empty files rejected (400), a GridFS quota (`GRIDFS_QUOTA_MB`, default 150, 507 STORAGE_QUOTA), filename sanitised, CSRF required. A failed upload deletes its partial file. New documents are always `approvalStatus=unverified`.
- **Formats:** DOCX text comes from `word/document.xml` (yauzl, 40 MB uncompressed cap). Explicit or last-rendered page breaks become pages, otherwise text is split into ~3,000-character segments (`pageUnit=segment`). TXT is split on form feeds, otherwise into segments. CSV becomes 50 rows per segment as `header: value` lines. Figures are counted per page (PDF image paint operators; DOCX drawings).
- **Scanned PDFs:** `ocrStatus` is `not_needed`, `needed_not_configured` (pages without a text layer and no OCR provider; shown as "OCR needed / not configured"), `partial` or `done`. The report adds `scanned` and `pagesWithoutTextLayer`.
- **Versions:** `POST /api/documents/:id/replace` stores a new current version (`versionGroupId`, `versionNumber`, `supersedes`). The previous version keeps its pages and chunks, so generated content keeps its citations. Retrieval uses only current, non-archived versions.
- **Duplicates:** if the SHA-256 matches an existing canonical document, the upload is rejected with 409 `DUPLICATE_DOCUMENT {existingId}`. Sending `allowDuplicate=true` stores it with `duplicateOf` and no processing. The import marks identical-checksum entries the same way (1,248 of 2,813 in the real index). Lists hide duplicates by default.
- **Queue** (`services/queue.ts`): jobs live in Mongo, are claimed atomically with a 10-min lease, retried with backoff of 15 s × 4^(n-1) up to `maxAttempts` (3), then marked `dead`. `PermanentJobError` (corrupt PDF, missing doc) skips retries. Expired leases are reclaimed after a crash or Render sleep. The worker runs in-process (`WORKER_ENABLED`, `WORKER_POLL_MS`). Document `processingStatus` moves through queued → extracting → ocr → structuring → chunking → embedding → indexed | failed.
- **OCR:** `OcrProvider` interface. `OCR_PROVIDER=tesseract` uses tesseract.js locally (free; pages rendered with @napi-rs/canvas), capped at `OCR_MAX_PAGES`. When OCR is disabled, the affected pages are reported as `ocr_unavailable`, never silently skipped.
- **Structure:** only explicit labels (STRAND, SUB-STRAND, SECTION n, CONTENT STANDARD, LEARNING INDICATOR) or Basic/JHS indicator codes (`B7.1.2.1.1`). Every node is stored `verified:false` with its rule, confidence and source line, and editors verify, edit, add or remove nodes. Manual nodes survive re-processing.
- **Chunks:** about 1,400 chars with 200 overlap, paragraph-aware. Each chunk keeps its page range, structure path and subjectId (updated when the mapping changes). Lines repeated on more than 40% of pages, plus bare page numbers, are dropped.
- **Embeddings:** `EmbeddingProvider`. In production it's Gemini `gemini-embedding-001` at 768 dims (picked automatically when `GEMINI_API_KEY` is set), with bounded retries on 429/5xx that honour Retry-After, batches of 50 and an 8k-char cap per text. An `openai-compatible` adapter is also available. `test-hash` exists **only** under NODE_ENV=test, and its chunks are marked `test_only` (the UI says so). With no provider, chunks are `disabled`.
- **Import:** `MONGODB_URI=... npx tsx scripts/import-index.ts /workspace/curriculum` reads `index.json` + `uploaded.jsonl` (Drive ids) + `prefetch.jsonl` (sha256). It is idempotent (upsert by source URL) and sets `storage.provider=remote`, `approvalStatus=unverified`, and `mappingStatus=suggested` only when level and subject match a configured Subject (otherwise `unmapped`). Original metadata is kept in `sourceMeta`. A dry run with `--memory` gave: total 2813, created 2812 (one URL is listed twice), duplicates 1248, subject matches 338 (against the sample subject list only).
- **Processing an imported doc** downloads it on demand from the allow-listed source host, falling back to the public Drive copy (`drive.usercontent.google.com`). Hosts are set in `REMOTE_FETCH_HOSTS` (SSRF guard).

## Storage
`ObjectStore` interface (`services/storage.ts`):
| provider | status |
|---|---|
| `gridfs` (default) | Implemented and streamed. Free, but **counts toward Atlas M0's 512 MB**, so uploads are capped by `GRIDFS_QUOTA_MB` (150 by default; `GET /api/documents/upload-limits` reports what is left). An allowed duplicate shares the original's file. Use it for admin uploads only. |
| `drive` | Interface only. It needs a server-side credential (service account with access to the folder, or an OAuth refresh token) in `GOOGLE_DRIVE_CREDENTIALS` + `GOOGLE_DRIVE_FOLDER_ID`. Until then it returns 503 STORAGE_UNAVAILABLE. |
| `remote` | Implemented and read-only. Used for the 2,813 imported documents, so no bytes are stored by us. |

Extracted text (`documentpages`) and chunks also take Atlas space. Since 16 Oct 2026 embeddings are stored as **float32 BSON vectors** (binData subtype 9, `lib/vector.ts`): about 3 KB per passage instead of ~10 KB for an array of doubles, so a passage is ~4–5 kB with its text and a page ~1.4 kB. Atlas Vector Search indexes both forms, and older array vectors keep working. `GET /api/analytics` → `storage.collectionSizes` reports the real size per collection.

## Bulk processing (paced)
`POST /api/documents/bulk-process {documentIds, dailyEmbedRequests?=800, maxInFlight?=2, maxTries?=2, monthCostShare?=0.9}` (Curriculum Editor/Admin or Super Admin, audited `document.bulk_process`) starts one run; `GET /api/documents/bulk-process` shows it; `POST /api/documents/bulk-process/cancel` stops it (manuals already queued finish).
A run is a chain of short `ingest.bulk` jobs (every minute while manuals are in flight) that queue normal `document.process` jobs:
- at most `maxInFlight` of the run's manuals are queued/running; indexed manuals are skipped and a manual is tried at most `maxTries` times, so re-running is safe;
- it stops queuing for the day when today's embedding requests (AiUsage `embedding.index`, one per batch of 50 passages) reach `dailyEmbedRequests` and resumes after midnight UTC; after a provider 429 it waits an hour;
- it stops for the month when the estimated month cost (LLM + embeddings at `AI_COST_EMBED_PER_M`, default $0.15/M tokens, ~4 chars/token) reaches `monthCostShare` of the platform monthly cost cap;
- each manual pauses `throttleMs` (default 150 ms) after every page and always yields to the event loop, so the API keeps answering on the 0.1-CPU free instance; `activeHoursUtc: [start, end]` optionally limits queuing to quiet hours;
- while a run is active it requests its own `RENDER_EXTERNAL_URL/api/health` each tick so the free Render instance does not sleep and the queue keeps moving. When the run finishes, the instance sleeps again as usual.

## Job stages, progress and retry safety (Phase 6)

- Each job records a stage timeline (`stages`: queued, running, extracting, ocr, structuring, chunking, embedding, done / retry_wait / failed / cancelled, with the attempt), the stage it failed in (`failedStage`, also on each `errorLog` entry), its `documentId` and `retryOf`.
- `ctx.progress(step, pct?, {current,total,unit})`: the measure is passed only where work is counted (pages extracted, pages OCR'd, passages embedded). Stages without a measure are shown as indeterminate.
- `queueProcessing` points the manual's `lastJobId` at the job id before the job is created. The pipeline's fence checks it is still the current job with its lease before replacing output and before finishing; otherwise it stops without writing (`PermanentJobError`).
- Passages have a unique `(documentId, ordinal)` index. Re-processing deletes the previous pages, unverified detected nodes and passages, then inserts, so a retry never duplicates passages or their embeddings.
- The job result summarises the run for the monitor: pages, passages, page unit, file kind, OCR status, page method counts, detected headings, embedding status, warning count.
