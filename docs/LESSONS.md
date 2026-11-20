# AI lessons (spec §7)

## Structure (A–K, confirmed against spec §7)
| Key | Section | Content / data | Notes |
|---|---|---|---|
| A | Lesson identification | `data: {level, yearOfStudy, subject, strand, subStrand, topic, subtopic, indicators[], estimatedMinutes, sources[{title, pages, approximate}]}` | Level, subject, strand, topic and sources are filled in by the **server** from lesson metadata and citations; the model supplies subtopic, indicators and time |
| B | Learning objectives | `data.objectives[]` | Must be measurable; objectives starting "understand/know/learn…" get a warning |
| C | Prior knowledge + diagnostic | content + `data.diagnostic[{question, answer}]` | |
| D | Starter activity | content (Ghanaian real-life scenario or puzzle) + `data.durationMinutes` | |
| E | Explanations | content (concepts, definitions, steps, applications, tables) + `data.{terms, examples, misconceptions, memoryAids, summary}` | |
| F | Illustrations and diagrams | `data.diagrams[{spec, svg, title, caption, alt, origin}]` | SVG is drawn by our renderer from a small JSON spec (flow, cycle, labelled, tree, table), never written by the model; alt text is derived if missing; `origin: generated` distinguishes these from future source-page images |
| G | Guided activities | `data.activities[{title, grouping, durationMinutes, steps, teacherSupport, expectedOutcome}]` | |
| H | Practical application | `data.practicals[{title, materials, instructions, expectedOutputs, safety, criteria}]` | All four lists are required; an unsafe-procedure screen (concentrated acids, mains electricity, toxic chemicals, unsupervised flames, tasting…) blocks review |
| I | Assessment and reflection | `data.{questions (MCQ), exercises, reflection}` | |
| J | Revision summary | key points + `data.{vocabulary, flashcards, conceptMap}` | The concept map is rendered as a tree SVG |
| K | Source references | `data.references[{documentId, title, pages, approvalStatus, approximate, note}]` | Built **only by the server** from the citations in A–J; `approximate` when the source is not `verified_official` or pages are missing |

## Flow
`POST /api/lessons` → job `lesson.generate` (retrieval → Gemini JSON → per-section citation mapping S# → chunk/page; invalid ids removed) → A/K assembly → validation → `draft` (version 1).
Editors can edit (versioned; `baseVersion` conflicts → 409), regenerate one section with instructions, compare any two versions (line diff) and restore.
Workflow (§12, Phase 7): generating → draft → submit (validation must pass) → in_review ("Awaiting review") → approve | request changes (comment required) → changes_requested → resubmit → resubmitted → approve → approved → publish (content:publish, with an audience) → a `LearningResource` (aiGenerated, provenance in body); unpublish hides it and returns to approved; archive withdraws it. Authors (creator and anyone who saved a version, super admin included) never decide on their own content. Publishing needs the approved version to be the current one and every source manual to still be verified official and current. Generation only uses approved manuals (no switch: always on). AI content is never visible to students before approval (rule 19). Provenance: aiModel, controls, estimate, sourceDocumentIds, indicatorSource, createdBy/submittedBy/reviewedBy/publishedBy/archivedBy, review log with who and when (rule 20). See ADMIN_PANEL.md §15.

## Validation (automatic, every generation and edit)
Missing/empty sections; citations required for source-based sections (B–D and K exempt); invalid citations removed with a warning; links/emails flagged; measurable objectives; diagnostic Q&A; worked examples, terms and misconceptions complete; diagram specs valid with alt text; guided activities have steps; practicals complete and safe; quiz options/answer key/duplicates; exercises have answers; concept map valid; references present (approximate warned); word-overlap grounding check (< 15 % warns).

## Controls
depth, readingLevel, length, numExercises, numQuizQuestions, includeGhanaContext, includeDiagrams, sections (any subset of A–K), language (en), teacherNotes (trusted editor instructions).
