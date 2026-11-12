# Curriculum-to-Learning System: plan (Phase 1, 2026-10-22)

Spec: `docs/CURRICULUM_LMS_SPEC.md`. Principle: extend the existing models and workflow; no parallel app, no duplicate subjects, no invented content.

## What already exists (inspected)
| Area | Existing | Location |
|---|---|---|
| Subjects / levels / versions | `Subject` (level, category, `curriculumVersionId`, `active`, `provenance.aliases`), `CurriculumVersion` (draft→active→archived), audited CRUD | `models/index.ts`, `routes/config.ts`, `routes/curriculum.ts` |
| Source documents | `CurriculumDocument` (docType curriculum / learner_manual / teacher_manual, approvalStatus, mapping, versions, checksum provenance), GridFS storage, ingest pipeline (extract → OCR → structure → chunk → embed) | `routes/documents.ts`, `services/ingest/*` |
| Curriculum structure | `CurriculumNode` (section, strand, subStrand, contentStandard, indicator, topic; page, order, parent, detection rule, verified) + manual node create/patch/reorder routes | `models/index.ts`, `routes/documents.ts`, `routes/curriculum.ts` |
| RAG | `Chunk` with page ranges + embeddings, `services/retrieval.ts`, `sourceScope()` (document ids, page range) | `services/lessons/generator.ts` |
| Lessons | `Lesson` with sections A–K, citations (chunk, doc, pages, quote), `sourceSupport`, `validation`, `LessonVersion` snapshots, restore, compare, section regenerate, cost estimate, AI budget caps | `routes/lessons.ts`, `services/lessons/generator.ts` |
| Review / publish | statuses draft → in_review → approved → published (+changes_requested, archived); publish creates a `LearningResource` (audience-scoped) that students read; unpublish/archive; `LessonReview` log; `AuditLog` (append-only) | `routes/lessons.ts` |
| Student portal | My subjects (`/api/me/subjects` from `StudentProfile.subjectIds`), subject resource list, lesson reader (`LessonView`), completion button, offline save | `web/src/pages/Learn.tsx` |
| Tracking | `ResourceProgress` (opened, opens, completed), `Mastery`, `Attempt`, learning analytics service | `models/ops.ts`, `services/learningAnalytics.ts` |
| Diagrams | code-generated SVG diagrams from validated specs | `services/lessons/svg.ts` |
| Settings | `PlatformSettings` (strict Zod, audited), `AiSettings` (provider, caps) | `services/platformSettings.ts` |

## Gaps and the safest path, per spec section
| § | Gap | Path |
|---|---|---|
| 2 Curriculum & LM | Curriculum PDFs are stored but not parsed into codes; no "missing source" report | Phase 2: deterministic parser for the Ghana SHS curriculum layout (codes `Y.S.SS.CS/LO/LI.n`) → admin import route (dry-run preview, idempotent upsert, audited) into `CurriculumNode` with page refs; add node type `learningOutcome`, `yearOfStudy`, `meta` (source notes). LM↔sub-strand mapping recorded per node (`lmDocumentIds`). A per-subject "source status" endpoint reports missing curriculum/LM instead of inventing. |
| 3 My Subject | Cards show name only | Phase 3: `/api/learn/subjects` returns counts (strands, topics, modules, published), estimated time, progress %, continue target. |
| 4 Topics | Nodes exist but no topic/module records | Phase 3: topic = curriculum Learning Indicator (the unit the curriculum prescribes; order preserved); module = one `Lesson` per topic (`contentType: 'module'`, stable `moduleKey` e.g. `MATH-Y1-1.3.1-CS1-LI2`, `nodeId`, order). Omitted topics get a recorded reason (`meta.omitted`). |
| 5 Learning Resources grid | No thumbnails | Phase 3: deterministic SVG thumbnail per module (strand colour + topic-keyword maths motif), generated server-side, alt text, fixed 16:9, cached. No stock or paid images. |
| 6 Notes A–M | Existing sections A–K are a teacher-lesson layout | Phase 4: new content type `module` with spec sections A–M (Introduction … Further learning); keep the old types untouched. |
| 7 LM alignment | Citations exist; no per-lesson mapping record | Phase 4: retrieval is scoped to the LM mapped to the topic's sub-strand; `sourceMap` per module (curriculum node + page, LM document + page range, chunk ids per section, gaps flagged); sections without source support are flagged, never filled. |
| 8 Reading time | `estimate` only for cost | Phase 6: computed from content (configurable wpm, default 160; extra per worked example, diagram, formula, practice item) → reading / reading+examples / lesson+practice minutes. |
| 9 Progression | Completion only; no locks | Phase 6: `ModuleProgress` (opened, active seconds from visible-time heartbeats, scroll depth, check score, status, completedAt); lock modes `sequential` (default) / `free` / `prerequisite` in platform settings (per subject override); completion requires reaching the end + passing the knowledge check when present. |
| 10 AI review & auto-publish | Human review required before publish | Phase 5: see "Auto-publish" below. CAS checks with mathjs on worked examples / answer keys. |
| 11 Admin dashboard | Pieces exist across Documents, Lessons, Structure | Phase 7: one "Curriculum LMS" admin page (RBAC): subject source status, curriculum import preview, generation (topic / strand / subject) with progress, publishing states, QA report, analytics. |
| 12 Data | — | All additions are fields on existing models plus `ModuleProgress`; indexes added; covered by existing backups. |
| 13 Student portal | — | Phase 3/6: My Subject cards → subject dashboard (strand → sub-strand → topic) → Learning Resources grid → module reader (existing `LessonView` + A–M renderer) with prev/next, times, knowledge check, progress. |
| 14 Ops rules | — | Enforced in code: generation refuses without an indexed LM in scope; versions snapshot before every overwrite; failed validation never publishes; failures recorded on the lesson with actionable messages. |

## Auto-publish ("AI-Approved") and the existing review workflow
- New platform setting `curriculumLms.autoPublish` (default **on**, per owner brief), changeable only by super admin (audited). When off, passing modules stop at `approved`-ready (`in_review`) and follow the normal human workflow.
- After generation, validation runs: structure/completeness vs objectives, every section's citations resolve to chunks of an approved, current LM in scope, source-unsupported sections, CAS checks of worked examples and answer keys, knowledge-check integrity (one correct option, explanation present), reading-level heuristic, duplicates (same node / near-identical text), SVG/diagram validity, reading time present.
- **Pass** (no critical failure): status `published` via the same publish code path (LearningResource created, audience = subject level + year), `aiReview = { status: 'ai_approved', checks: [...], at, version }`, `LessonReview` action `ai_publish`, audit `lesson.ai_publish` (actor = the admin who started the run). The student and admin UI label it **"AI-Approved — passed automated checks; not reviewed by a person"**.
- **Fail**: status `in_review` with `aiReview.status = 'needs_attention'` and the failure list; never shown to students.
- Admin keeps every existing action (edit → new version, unpublish, archive, restore version, regenerate, publish revision). A later human approval sets `aiReview.humanReviewedBy`.

## Phase order and acceptance
Phases 2–8 as in the owner brief; Mathematics (SHS core, `6ad0200733e70788b3fb54ea`) first. Live run: one full strand, measure cost per module, then the rest only within the caps ($10/month, 1,500 requests/day).

## Source status (Mathematics) found during inspection
- Curriculum: "Mathematics Curriculum" (`6ad0216e2b97619a4537a35a`, 385 pages, SHS 1–3), present but unverified and not indexed.
- Year 1 learner manuals (learner versions, indexed): Sections 2, 4, 5, 6, 7, 8, 9. Sections 1 (Number Sets) and 3 (Algebraic Expressions & Factorisation) exist only as teacher versions (flagged `teacher_version`, not indexed). Year 2: "LM maths Book 2 LVersion" (indexed). Year 3: "Mathematics_LM_Y3 – FINAL – LEARNERS' VERSION" (indexed).
- Therefore fully LM-backed in Year 1: Strand 3 Geometry Around Us (Sections 5–7) and Strand 4 Making Sense of and Using Data (Sections 8–9); Strands 1 and 2 are partly backed (Sections 2 and 4). Topics without an indexed learner LM are recorded as "source missing", not generated.
