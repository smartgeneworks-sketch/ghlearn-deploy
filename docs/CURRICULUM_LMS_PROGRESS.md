# Curriculum LMS: progress (updated 2026-10-29)

Spec: [CURRICULUM_LMS_SPEC.md](CURRICULUM_LMS_SPEC.md). Plan and gap analysis: [CURRICULUM_LMS_PLAN.md](CURRICULUM_LMS_PLAN.md).

| Phase | Status | Commit |
|---|---|---|
| 1 Inspect and plan | done | CURRICULUM_LMS_PLAN.md |
| 2 Curriculum parser and audited, idempotent import (strands, sub-strands, outcomes, standards, indicators, page refs, LM per sub-strand) | done, live | 8533298 |
| 3 My Subject cards, topic/module records, SVG thumbnails, Learning Resources grid | built, tested | d9470fd |
| 4 Module notes A–M grounded in the mapped learner manual, with sourceMap and flagged gaps | built, tested | d9470fd |
| 5 Validation (structure, citations, mathjs maths checks, knowledge-check integrity) and AI-Approved auto-publish; failures withheld as needs_attention | built, tested | d9470fd |
| 6 Reading time (configurable wpm), ModuleProgress, locking (sequential/free/prerequisite) | built, tested | d9470fd |
| 7 Admin "Curriculum LMS Modules" page: overview, generate, edit, regenerate, restore, analytics | built, tested | d9470fd, 1e8d17c |
| 8 Live acceptance: Mathematics Year 1 Strand 3 (Geometry Around Us) | done 2026-10-22, with issues below | live API 11ddb1e |

## Coverage and human approval (updated 2026-10-29 ~09:00 UTC; strands with no generated lesson are omitted)

Source of truth: `GET /api/curriculum-lms/coverage` (admin). **AI-Approved** means only that the automated checks passed. A lesson counts as finished only when a person signs it off in **Admin › Curriculum LMS Modules › (subject) › (module) › Human approval**. An approval applies to one version, so any later edit sets the lesson back to pending.

| Subject | Year | Strand | Lessons | Published (AI-Approved) | Human-approved | Held | Source missing |
|---|---|---|---|---|---|---|---|
| Biology | 1 | 1 | 8 | 8 | 8 | 0 | 0 |
| Biology | 1 | 2 | 3 | 3 | 3 | 0 | 0 |
| Biology | 1 | 3 | 11 | 11 | 11 | 0 | 0 |
| Biology | 1 | 4 | 5 | 5 | 5 | 0 | 0 |
| Biology | 2 | 1 | 4 | 4 | 4 | 0 | 0 |
| Biology | 2 | 2 | 5 | 5 | 5 | 0 | 0 |
| Biology | 2 | 3 | 5 | 5 | 5 | 0 | 0 |
| Biology | 2 | 4 | 4 | 4 | 4 | 0 | 0 |
| Biology | 3 | 1 | 4 | 4 | 4 | 0 | 0 |
| Biology | 3 | 2 | 7 | 7 | 7 | 0 | 0 |
| Biology | 3 | 3 | 8 | 8 | 8 | 0 | 0 |
| Biology | 3 | 4 | 7 | 7 | 7 | 0 | 0 |
| English Language | 1 | 1 | 7 | 7 | 7 | 0 | 0 |
| English Language | 1 | 2 | 5 | 5 | 0 | 0 | 0 |
| English Language | 1 | 3 | 12 | 11 | 0 | 0 | 1 |
| English Language | 1 | 4 | 10 | 9 | 0 | 0 | 1 |
| English Language | 1 | 5 | 6 | 6 | 0 | 0 | 0 |
| English Language | 2 | 1 | 9 | 9 | 0 | 0 | 0 |
| English Language | 2 | 2 | 6 | 6 | 0 | 0 | 0 |
| English Language | 2 | 3 | 7 | 7 | 0 | 0 | 0 |
| English Language | 2 | 4 | 8 | 8 | 0 | 0 | 0 |
| English Language | 2 | 5 | 3 | 3 | 0 | 0 | 0 |
| English Language | 3 | 1 | 6 | 6 | 0 | 0 | 0 |
| English Language | 3 | 2 | 5 | 5 | 0 | 0 | 0 |
| English Language | 3 | 3 | 7 | 7 | 0 | 0 | 0 |
| English Language | 3 | 4 | 5 | 5 | 0 | 0 | 0 |
| English Language | 3 | 5 | 2 | 2 | 0 | 0 | 0 |
| General Science | 1 | 1 | 6 | 6 | 6 | 0 | 0 |
| General Science | 1 | 2 | 4 | 4 | 4 | 0 | 0 |
| General Science | 1 | 3 | 4 | 4 | 4 | 0 | 0 |
| General Science | 1 | 4 | 5 | 5 | 5 | 0 | 0 |
| General Science | 2 | 1 | 3 | 3 | 3 | 0 | 0 |
| General Science | 2 | 2 | 6 | 6 | 6 | 0 | 0 |
| General Science | 2 | 3 | 5 | 5 | 5 | 0 | 0 |
| General Science | 2 | 4 | 4 | 4 | 4 | 0 | 0 |
| General Science | 3 | 1 | 4 | 3 | 3 | 0 | 0 |
| General Science | 3 | 2 | 6 | 6 | 6 | 0 | 0 |
| General Science | 3 | 3 | 6 | 6 | 6 | 0 | 0 |
| General Science | 3 | 4 | 5 | 5 | 5 | 0 | 0 |
| Mathematics | 1 | 1 | 10 | 4 | 4 | 0 | 6 |
| Mathematics | 1 | 2 | 10 | 6 | 6 | 0 | 4 |
| Mathematics | 1 | 3 | 14 | 14 | 14 | 0 | 0 |
| Mathematics | 1 | 4 | 10 | 10 | 10 | 0 | 0 |
| Mathematics | 2 | 1 | 11 | 11 | 10 | 0 | 0 |
| Mathematics | 2 | 2 | 8 | 8 | 7 | 0 | 0 |
| Mathematics | 2 | 3 | 12 | 12 | 12 | 0 | 0 |
| Mathematics | 2 | 4 | 9 | 9 | 9 | 0 | 0 |
| Mathematics | 3 | 1 | 5 | 5 | 5 | 0 | 0 |
| Mathematics | 3 | 2 | 4 | 4 | 4 | 0 | 0 |
| Mathematics | 3 | 3 | 9 | 9 | 9 | 0 | 0 |
| Mathematics | 3 | 4 | 6 | 6 | 6 | 0 | 0 |
| Social Studies | 1 | 1 | 3 | 3 | 3 | 0 | 0 |
| Social Studies | 1 | 3 | 4 | 4 | 4 | 0 | 0 |
| Social Studies | 1 | 5 | 6 | 6 | 6 | 0 | 0 |
| Social Studies | 1 | 6 | 8 | 8 | 8 | 0 | 0 |
| Social Studies | 2 | 1 | 3 | 3 | 3 | 0 | 0 |
| Social Studies | 2 | 3 | 4 | 4 | 4 | 0 | 0 |
| Social Studies | 2 | 4 | 5 | 5 | 5 | 0 | 0 |
| Social Studies | 2 | 5 | 7 | 7 | 7 | 0 | 0 |
| Social Studies | 2 | 6 | 9 | 9 | 9 | 0 | 0 |
| Social Studies | 3 | 2 | 3 | 3 | 3 | 0 | 0 |
| Social Studies | 3 | 3 | 4 | 4 | 4 | 0 | 0 |
| Social Studies | 3 | 4 | 5 | 5 | 5 | 0 | 0 |
| Social Studies | 3 | 5 | 2 | 2 | 2 | 0 | 0 |
| Social Studies | 3 | 6 | 6 | 6 | 6 | 0 | 0 |
| **Total** | | | **404** | **391** | **300** | **0** | **12** |

Biology: all 71 modules published by 2026-10-28 evening (the 17 held lessons were fixed without AI; see "Fix run 2026-10-28 (evening)").

### Not built yet (sub-strands without modules)

- **General Science Y3:** 6 sub-strands. The Y3 learner manual (`General-Science_LM_Y3_Online_LV.pdf`, 272 pp, verified_official) is in the library but not mapped yet. Y3.S4.SS2 is not imported because the parser could not find its title.
- **Mathematics:** 20 sub-strands (Y1: S1.SS1–2, S2.SS1–2, S4.SS1–2; Y2: all 8; Y3: S1.SS2, S2.SS2, S3.SS1–2, S4.SS1–2). Y1.S1.SS1 *Real Number System* has no learner manual, so it stays flagged 'source missing'. Y3.S1.SS1 and Y3.S2.SS1 are not in the imported structure and need checking against the curriculum PDF.
- **English Language:** all imported modules generated 2026-10-29 (96 of 98 published). `ENG-Y1.S3.SS3.CS1.LI1` and `ENG-Y1.S4.SS3.CS3.LI1` have no learner manual mapped (source missing) and are not generated from guesses.

> **Human approval note (2026-10-25):** all 127 lessons published as of 2026-10-25 were marked human-approved by a delegated bulk owner approval (requested via Alfred, 08:46–08:47 UTC), reviewer "Owner (via Alfred, no separate review), 2026-10-25". This was **not** a teacher or lesson-by-lesson review. Nothing was skipped (no held, unpublished or draft lessons existed). Lessons published in future batches start as pending human approval and stay pending until separately approved.

### Pending human approval

**91** as of 2026-10-29 ~09:00 UTC (read live from `/api/curriculum-lms/coverage`): English Language 89 (published 2026-10-29), Mathematics 2 (`MATH-Y2.S1.SS1.CS3.LI2` regenerated 2026-10-29; `MATH-Y2.S2.SS1.CS1.LI3` edited after the 2026-10-28 approval). The 2026-10-28 bulk owner approval does **not** cover these.

### Bulk owner approval 2026-10-28

On 2026-10-28 (22:47 UTC) the owner instructed in chat: "174 lessons are waiting for my approval and should be approved. Kindly do the approval". The live pending list actually held **175** published lessons, and all 175 were approved via `POST /api/curriculum-lms/modules/:id/human-approve` (their current version), reviewer "Owner (direct instruction in chat, no separate review)", role "owner/admin", comment "Bulk owner approval requested 2026-10-28, no separate review". This was **not** a teacher or lesson-by-lesson review. Held, unpublished and source-missing modules were not touched.

| Subject | Approved 2026-10-28 |
|---|---|
| Biology | 71 |
| Mathematics | 84 |
| General Science (Y3) | 20 |
| **Total** | **175** |

Human-approved totals after this: Mathematics 97, Biology 71, Social Studies 69, General Science 57, English Language 7, **total 301 of 301 published**. Snapshots: `/workspace/bio/cov_pre_appr.json`, `/workspace/bio/cov_post_appr.json`.

Housekeeping done the same night: the 3 throwaway Maths students `test-math-fix1028-y{1,2,3}-*@example.com` were suspended and `/workspace/bio/math1028/stu{1,2,3}.json` shredded.

### Bulk owner approval 2026-10-29

On 2026-10-29 (20:47 UTC) the owner instructed in chat: "Kindly do the approval". All **113** published lessons on the live pending list were approved via `POST /api/curriculum-lms/modules/:id/human-approve` (current version), reviewer "Owner (direct instruction in chat, no separate review)", role "owner/admin", comment "Bulk owner approval requested 2026-10-29, no separate review". This was **not** a teacher or lesson-by-lesson review. Held, unpublished, failed and source-missing modules were not touched.

| Subject | Approved 2026-10-29 |
|---|---|
| English Language | 89 |
| Additional Mathematics | 22 |
| Mathematics | 2 |
| **Total** | **113** |

Human-approved totals after this: Mathematics 98, English Language 96, Biology 71, Social Studies 69, General Science 57, Additional Mathematics 22, **total 413 of 413 published**; 0 pending. Snapshots: `/workspace/bio/cov_pre_appr1029.json`, `/workspace/bio/cov_post_appr1029.json`.

### Work order (approved by the user via Alfred, 2026-10-25)
1. General Science Y2 (**done 2026-10-25**, 18/18 published) → Y3 (next).
2. Mathematics: all remaining strands for Y1–3. Topics that have only a teacher's manual stay 'source missing' and are not generated from guesses.
3. English Language: the remaining strands, after their learner manuals are fetched and mapped.
4. List any other curriculum subjects that are not imported yet, and ask the user before starting them.

Daily batches run within the 120 AI requests/day per-user limit and the $10/month cap; neither is raised.

**Next run resumes at (2026-10-30 07:00 GMT):**
1. English, Maths, Biology, Social Studies and General Science Y1–2 are fully generated. Nothing left to generate in imported subjects except source-missing items.
2. General Science Y3 `S1.SS1.CS1.LI3` (id 6adefcc20c1e3b2e895633da) stays held: provider SAFETY block on 3 tries (last with a reworded, manual-grounded instruction 2026-10-29). Needs a hand-written module (no AI) or a human decision; do not retry automatically.
3. Optional: Maths screenshots of `MATH-Y2.S2.SS1.CS1.LI3` and `MATH-Y2.S2.SS2.CS1.LI4` (carried over from 2026-10-28, not done).
4. Not-imported subjects (57) were listed to the user 2026-10-29; **do not start any until the user chooses**.

## Routes added
- `/api/curriculum-lms`: `POST /modules/materialize`, `POST /generate`, `GET /subjects/:id/overview`, `GET|PATCH /modules/:id`, `POST /modules/:id/regenerate`, `POST /modules/:id/restore`, `POST /modules/:id/human-approve`, `POST /modules/:id/human-revoke`, `GET /coverage`, `GET /subjects/:id/analytics`.
- Student routes (mounted at `/api`): `GET /me/subjects`, `GET /subjects/:id/resources`, `GET /subjects/:id/modules`, `GET /resources/:id`, `POST /resources/:id/{progress,check,complete}`.

## Tests
- Server: 368/368. Web unit: 80/80.
- E2E (Playwright + axe), 2026-10-22: 105/108 at first. The 3 failures were the admin sidebar spec, which didn't yet expect the new "Curriculum LMS Modules" section. After updating the spec (423224e), admin.spec passes 9/9.

## Known source gaps (Mathematics)
- Year 1 Sections 1 and 3 have only teacher-version manuals, so those topics are recorded as "source missing" and aren't generated.

## Phase 8 log
Deployed 2026-10-22: Render dep-dbd9hn29lscs73ang5gg (11ddb1e) is live; /api/health returns db:true; the new routes answer 401 without a session. The web app was deployed to Firebase ghlearn-f31c9, and ghlearn.com serves the new build.

- **Estimate:** 14 modules (14 indicators), upper bound $0.5155; day 0/1500, month $0.05/$10. No sub-strands are missing a source.
- **Actual cost:** 14 requests and $0.2184 (78,174 input, 77,977 output tokens), so **about $0.0156 per module**. Month to date: $0.27 of $10.
- **Grounding:** every module cites only its mapped learner-version LM. SS1 uses "LM maths section 5 Lversion"; SS2 uses sections 6 and 7 (all verified_official). sourceMap lists page refs per section A–M.
- **Maths checks (mathjs):** all 14 ran, with 0 failures (for example 10 pass and 2 not checkable on LI1).
- **Auto-publish:** 9 published as AI-Approved. 5 were withheld as `in_review/needs_attention`, all because of invalid diagram specs in section F ("table: a row has more cells than there are headers", "flow: steps must be 2-8 strings"): S3.SS1.CS1.LI3, SS2.CS1.LI2, SS2.CS2.LI3, SS2.CS3.LI1, SS2.CS3.LI2. Students don't see them.
- **Test student** (phase8.lms.student@example.com):
  - My Subject, then the dashboard: 9 modules, 4.8 h, 110 min reading, 9 SVG thumbnails, AI-Approved labels.
  - Module 2 is locked and returns MODULE_LOCKED; the UI shows "Complete the previous module first."
  - Completing too early is refused (scroll and check required).
  - The knowledge check is scored on the server, and answers are hidden before the first attempt.
  - Passing and completing gives 1/9 (11%) progress and unlocks module 2.
  - axe: subject page clean; reader has heading-order (2 nodes).
  - The account was then suspended (API returns 401).
- **Admin:** on S3.SS2.CS3.LI4:
  - Edit: v2, re-checked, stays published, and the student sees the new title.
  - Unpublish: the student sees 8.
  - Restore v1: v3, re-checked, re-published, and the student sees 9 with the original title.

### Issues found
1. The diagram generator often produces table/flow specs that fail validation (5 of 14). Fix the prompt or schema, or auto-repair, then regenerate those 5 (about $0.08).
2. The knowledge check returns `correctIndex` after any attempt, so a learner can fail once and then pass with the revealed answers. Consider revealing answers only after a pass or after N attempts.
3. The strand title is empty on module cards ("Year 1 · "): `LearningResource.strand` isn't set for modules.
4. The /learn "My subjects" card still shows only the name and code. Counts, progress and time appear only on the subject page.
5. The curriculum import turns degree signs into "0" in indicator text (for example "30°, 45°" shows as "300, 450" in S3.SS2.CS2.LI2).
6. AI usage shows module generation under "other" (no feature label for `module.generate`).
7. Reader axe: heading-order (moderate).


### Phase 8 fixes (2026-10-23, commits c87d3b3, 0b2912d)
1. **Diagram specs:** fields nested under the kind (spec.table.rows) are lifted; the prompt now gives one cell per header and a flow of 2–8 steps.
2. **Knowledge check:** answers and explanations are returned only after a pass. A failed attempt shows only which questions were wrong, plus a "Review section X (learner manual p. …)" hint. The question and option order is reshuffled for each attempt (seeded by user, resource and attempt), and a stale attempt gets a 409.
3. **Strand title:** the materialize prefix now includes the strand node, and existing lessons and resources are backfilled (live: "Geometry Around Us").
4. **/learn card:** shows a thumbnail, strands/modules/hours, a progress bar, Continue/Start, and code · Year · version.
5. **Degree signs:** the PDF typesets ° as a 7pt superscript "0". `parse-maths-curriculum.py` now restores it with PyMuPDF span flags (80 restored; only element 1.3.2.LI.2 differed from the stored import). Live repair: the node title was edited (audited), and module 6ada99934a495112caec8512 got a versioned indicator edit (v1→v2, still published).
6. **AI usage:** `module.generate` now counts under "Lesson and resource generation", and the old rows are relabelled at bootstrap.
7. **Reader heading-order:** in content markdown the shallowest heading becomes h3. Live axe on the reader: 0 violations.

Live: the 5 held-back modules were regenerated, all v2 and published, so **14 of 14 are published**. Cost was $0.0966 (UTC day total); the month is at about $0.36 of $10. Tests: server 371/371, web unit 81, E2E 105 passed (3 phase5 tests flaked under load, then 6/6 on rerun). Four throwaway test students were used for live quiz verification and then suspended.

## Lesson visuals (2026-10-23)
- Cause: section F renderer only supported schematic kinds (table/flow/tree/labelled), so Geometry lessons showed only text tables/flow charts (truncated text), no drawings.
- Fix: `server/src/services/lessons/figures.ts` — code-drawn accessible inline SVG (role=img, title, caption, alt) for angle (arcs+labels), polygon (labelled sides/angles, right-angle marks), solid (cuboid/cube/prism/cylinder + nets), coordinate grid, number line, bar chart; table/flow redesigned for mobile (wrapping, vertical numbered flow). Validation: renders without NaN, angle sums, polygon angle sum, triangle inequality, Pythagoras, equal sides by shape, grid/line ranges, and `example` cross-check against section E worked examples (0 ignored).
- Regenerated F for all 14 Geometry modules: 14/14 published with drawn figures, 38 drawn figures + 2 tables. Day AI spend 2026-10-23: $0.1771 total (includes earlier Phase 8 work).
- Note: diagrams are stored as SVG at generation; renderer fixes after ac3919e apply to future regenerations.

## English Language, Year 1 Strand 1 (Oral Language), 2026-10-23
- **Import:** "English Language Curriculum" (doc 6ad021442b97619a4537a2bd), parser `ghana-shs-english-2024` (parse-maths-curriculum.py with a subject argument). Created 229 items: 15 strands, 32 sub-strands, 55 LOs, 40 CSs, 87 indicators.
  - Manuals mapped for Y1 Strand 1 only: SS1 → LM sections 1, 7, 9, 11; SS2 → 3, 13, 22; SS3 → 5, 17 (all verified_official LV). All other sub-strands are reported as source missing.
  - Parser issues: 1.3.2.LI.1, 1.4.1.LI.2, 1.5.1.LO.1 may be cut at a page break; Y2 2.1.1.LI.1–4 appear before any CS (not imported); 3.3.1.CS.4 has no indicators.
- **Code:** English figure kinds (sentence, soundchart, wordmap, timeline, plot, dialogue, venn) with validators; English section guides; `language_grounding` check (figure sentences/dialogue must appear in the notes or LM); Listen buttons (speechSynthesis, en-GB preferred, rate 0.9 sections / 0.75 words, hidden when unsupported, aria-pressed/aria-label). Commits c84f690, 64afbf6 (soundchart tidy: keep 3 example words, shorten labels to 30 chars).
- **AI settings:** perUserDailyRequests raised from 30 to 60 (stored setting, user-approved); the first run hit the 30/day cap with no spend.
- **Generation:** 7 modules, all **published as AI-Approved** after one round of regeneration. The first pass had 4 published and 3 held (SS1 LI1–LI3: soundchart had 4 example words or a long label; two figure sentences not in the notes/LM). LI2 needed a second retry because the first retry ran on the old instance during the deploy.
- **Diagrams (16):** dialogue 7, table 5, soundchart 3, sentence 1.
- **Cost:** 11 module generations, about $0.16; month to date about $0.61 of $10.
- **Live check:** throwaway student eng.y1.listen.test@example.com (onboarded Y1, English). Dashboard shows 1 strand, 7 modules, about 3.3 h. Module 1 renders the soundchart, "Hear the words" row, and 46 Listen/Pronounce buttons. Headless Chromium has no voices, so playback ends immediately (aria-pressed returns to false) without errors. The account was then suspended (login returns 403).
- **Screenshots:** /workspace/lesson-shots/english/ (desktop-* and mobile-*: dashboard, lesson-top, soundchart, hear-the-words, figure3, listen-pressed, lesson-full).
- **Known content issues:** LI1 uses "/^/" for /ʌ/ in the soundchart and an example; SS3 LI1 and LI2 have the same generated title ("Formal and Informal Language in Speech Situations").

## Maths voice and maths typesetting, 2026-10-23 (web only, AI cost $0)
- **Problem:** raw LaTeX showed in plain lesson fields (worked-example steps, answers, concept explanations, quiz questions/options, captions). The notes converted LaTeX to approximate text ("90^°"). The speech helper dropped `$…$` maths entirely.
- **Typesetting:** KaTeX (`web/src/lib/math.tsx`).
  - `$…$`, `\(…\)` inline; `$$…$$`, `\[…\]` display. Prices such as "$5 and $10" and GH¢ stay text.
  - Answers written as bare LaTeX (no `$`) and short bare fragments (`\sqrt{45}`) are typeset too.
  - Plain `a^2` becomes a², and `12 * 8` becomes 12 × 8.
  - Used in Markdown notes (tutor too), all LessonView fields, the knowledge check (questions, options, explanations, hints) and figure captions.
  - KaTeX runs with trust off; text parts stay escaped.
  - CSP: added `font-src 'self' data:` (KaTeX fonts).
- **Speech:** `web/src/lib/mathSpeech.ts`.
  - LaTeX handled: \circ, ^2/^3, \frac (3/4 → "three quarters"), \sqrt, \times, \div, \pi, \theta, \sin/\cos/\tan, \angle ABC, \vec, ≤/≥, and pmatrix as "column …".
  - Unicode handled: °, cm²/m³ → square/cubic units, π, ×, ÷, =, √, ≤, ≥, ∠ABC → "angle A B C", and ± between terms. Dates and hyphenated words are not changed.
  - Each figure gets a "Listen to figure N description" button (title plus caption, or the alt text).
  - Key terms and concepts keep their Pronounce buttons.
- **Tests:** web 91/91 (new `mathSpeech.test.ts`, `math.test.tsx`); server unchanged.
- **Stored lessons:** a render audit of all 14 Maths and 7 English lessons found no raw `$` or LaTeX and 0 KaTeX errors. One English lesson (SS1 LI2) shows `**` in a plain field, which is plain text and not rendered as markdown.
- **Live:** throwaway student maths.voice.test@example.com, lesson 1 "Angles: Types, Referents, and Angle Problems".
  - 43 KaTeX nodes, 0 raw markup.
  - 12 section Listen, 2 figure-description Listen and 17 Pronounce buttons, on desktop and mobile.
  - The account was then suspended.
- **Screenshots:** /workspace/lesson-shots/maths-voice/ (before-*/after-*, desktop and mobile: top, concepts, steps, examples, figure, terms, quiz, full).

## General Science (S-GENSCI, 2026-10-23)
- Curriculum imported (dry run, then applied): 145 items (12 strands, 20 sub-strands, 30 LOs, 27 CS, 56 indicators). Learner manual §1–2 (verified_official) mapped to Y1 Strand 1.
- Y1 S1 materialised: 6 modules, all generated, validated and published.
- New figure kinds (server/src/services/lessons/scienceFigures.ts): structure, circuit, cyclediagram, foodweb, process, datagraph, datatable. They are validated (circuit topology, food-web direction, graph units) and their labels are grounded in the manual (science_grounding check).
- Diagrams in Y1S1: process 4, circuit 2, structure 1, flow 1, table 1. Module CS1.LI1 has only flow/table figures (warning only).
- Voice/typesetting: scienceToSpeech/formulaToSpeech (H₂O, CO₂, ions, °C, compound units); KaTeX mhchem.
- Tests: server 389/389, web 96/96. Commits 336ff28, b3c9384, 7d6b481 deployed.
- Live check: throwaway student (suspended afterwards) opened module 1. It showed 4 SVG figures, 0 raw-markup hits, 17 KaTeX nodes and working Listen/describe buttons. Shots are in /workspace/lesson-shots/science/.
- Gaps: Y3 S4 SS2 not imported (parser could not find the title); 5 items may be cut at page breaks (none in Y1S1); Y1 strands 2–4 have no manual mapped.
- AI cost: month estimate $0.72 (was $0.61 before Science). Platform requests today: 54 of the per-user cap of 60; the limit was not raised.

### General Science live figure check, lessons 2–6 (2026-10-23)
- A throwaway student (test-sci2-…@example.com, suspended afterwards) completed lessons 1–5 in order through the student API. Reading was recorded with progress pings (≥90% scroll) and every quiz was passed at 100%, which unlocked lessons 2–6. The global lock setting was not changed.
- Checked on desktop (1280px) and mobile (390px): every figure renders, there is no raw markup, no SVG labels overlap, and every figure Listen button speaks the title and description.
- Fixed (commit 4a857b4, deployed):
  - The process "In:" box overflowed its border (L2 solar oven). In/out labels now wrap at 44 characters and step labels wrap too.
  - The two LED arrows merged into a blob. They are now thin arrows with small heads, pointing outward.
  - Desktop figures were left-aligned. They are now centred.
  - PATCHing an F section now re-renders each figure from its spec on the server, so client SVG is never stored. L2, L4 and L5 were re-rendered this way at no AI cost.
- Circuit symbols checked: a battery is two cells, the open switch, the resistor rectangle and the LED (diode in a circle with outward arrows) are all correct.
- Open content note (not changed): the L4 and L5 captions say the circuit tests solid materials ("open gap to introduce test materials"), but there is no test-gap component, so the open switch stands in for it.
- Shots: /workspace/lesson-shots/science/live/ (L2–L6 desktop/mobile per figure plus full page; before-fix/ holds the originals).

## Year 1 General Science strands 2–4 (2026-10-23)
- Learner manual mapping (curriculumresources.edu.gh, verified_official): S2.SS1 → LM sec 3 (Diffusion and Osmosis) + sec 4 (Reproduction in Plants and Humans); S3.SS1 → sec 5 (Solar Panels); S3.SS2 → sec 6 (Force); S3.SS3 → sec 7 (Basic Electronics); S4.SS1 → sec 8 (Promoting Health and Safety); S4.SS2 → sec 9 (Production in Local Industry).
- 13 modules materialised, generated and published (21 figures). Five failed checks at first. Fixed in code (82c1579: flower template, longer cycle labels, phrase outputs are warnings, "…" rather than truncation) and re-rendered from stored specs through PATCH F at no AI cost.
- perUserDailyRequests raised to 120 (stored admin setting, approved). Month: 102 requests, about $0.90 of $10.
- Live check by a throwaway student (suspended afterwards): all 19 Y1 modules completed in sequence, with 0 text overlaps or clipped labels on desktop and mobile. Shots: /workspace/lesson-shots/science/s2-4/.

## Science figure fixes (2026-10-23, no AI)
- Renderer (4e94e6a): new circuit `test_gap` component: two terminals, labelled "Test material". The flower ovary leader now points at the ovary body.
- Versioned admin edits of the F section (re-rendered on the server, re-validated, still published):
  - S2 reproduction lesson (v3): labelled Style added, grounded in LM section 4.
  - L4 (v5) and L5 (v4) conductivity circuits: now battery + LED + test gap, as in LM section 2, Activity 13. L5's switch and resistor are not in the source, so they were removed; captions and alt text match the drawing.
- Live check by a throwaway student (suspended afterwards): 0 overlaps or clipped labels. Shots: /workspace/lesson-shots/science/fixes/.

## Social Studies (SHS) Year 1 — 2026-10-23
- Curriculum: Social-Studies-Curriculum.pdf (doc 6ad021732b97619a4537a36b), parser `ghana-shs-social-studies-2024` (Subject regex case-insensitive, generic LI split; 13 Y1 LI texts re-joined verbatim). 175 nodes imported. Approval status still *unverified*.
- Learner manuals: Y1 Sections 1–10 (official, curriculumresources.edu.gh) mapped one-to-one to the 10 Y1 sub-strands. Y2/Y3 have no LM mapped.
- 21 Y1 modules generated (21 AI requests, about $0.30) and all published. 14 failed validation at first (schema shape or ungrounded labels); they passed after server fixes plus a no-AI F re-render.
- Figures (socialFigures.ts): history_timeline (date-order check), conceptmap, causeeffect, orgchart, comparison (+venn), locationtable (maps deliberately not drawn), scene (road crossing template, fixed part list). Grounding: short labels and all numbers/dates must be in the notes/LM.
- Voice: web/src/lib/socialSpeech.ts (cedis, circa, ranges, acronyms such as AU/GES/ECOWAS, Ghanaian names).
- Live check: throwaway student completed all 21 in order (100%), then suspended. Shots: /workspace/lesson-shots/social-studies/.
- Known: edit-path re-render can't re-check the LM, so 8 modules keep wording warnings for heading-style labels (e.g. "Action Taken", "Vehicle registration"); no unsupported numbers or dates.

## Social Studies Years 2–3 (2026-10-23)

- Sources (official, curriculumresources.edu.gh; sizes match Content-Length):
  - Y2 LM `SOCIAL-STUDIES-Y2-LM_LEARNERS-VERSION.pdf` (315 pp, doc 6ad023062b97619a4537a912), 12 sections = 12 Y2 sub-strands.
  - Y3 LM `Social-Studies_LM_Y3_Online_LV.pdf` (220 pp, doc 6ad023542b97619a4537aa36), 10 sections = 9 Y3 sub-strands (3.4.2 spans 5–6). The teacher-tagged `Social-Studies_LM_Y3_Online.pdf` (aa35) is not used.
- Curriculum text fixes (verbatim from layout text/page images): 19 re-joined indicators/LOs; trailing heading bleed trimmed; added 2.4.1.CS.1 (source prints "2.4.1CS.1"); budget indicator printed "3.6.6.LI.2" on p.111 moved to 3.6.4.LI.2; 3.4.2 CS.2's indicator is numbered LI.1 in the source. Import: create 5 / update 22 / unchanged 153, no duplicates (69 indicators).
- Materialised 48 modules (Y2 28, Y3 20). Dry run ≈ $0.683.
- Generated 31 (all Y2 + Y3 strand 2) within the 120/day per-user limit (119 used). 18 published first pass; 13 in review fixed with no-AI F PATCHes (3 schema fixes: comparison heading length, concept-map centre length, process inputs/outputs as lists; 10 grounding misses → edit-path warnings). All 31 published.
- Figures (31 modules): conceptmap 27, comparison 14, process 5, causeeffect 4, locationtable 3, orgchart 2, history_timeline 2 (57 total).
- Cost: month $1.1955 → $1.6273 (+$0.432, ≈ $0.014/module).
- Live check: throwaway students (Y2 and Y3) completed all 31 at 100%, then suspended; creds shredded. Screenshots: /workspace/lesson-shots/social-studies/y2-3/ (box).
- ~~Pending: 17 Y3 modules (strands 3:4, 4:5, 5:2, 6:6)~~ Done 2026-10-24, see "Social Studies Year 3 strands 3–6" below.

## Social Studies: figure label fixes (2026-10-23)
- 19 lessons (8 Y1, 11 Y2/Y3). Paraphrased figure labels were replaced with Learner Manual or notes wording through versioned admin PATCH (redrawn from the stored spec, no AI, $0). All 19 are still published with 0 "is not in the notes" warnings. Plan and log: /workspace/ss/lfplan.json and lf_log.json (box).
- Fabricated cells removed: Y2.S1.SS2.LI1 "Beadwork and pottery" (Ga-Dangme; the LM names no Ga craft) is now "Not stated in the learner manual". In Y1.S6.SS3.LI1 the invented redress conditions were replaced with the LM condition (faulty, during the warranty period), and the caption was updated to match.
- Road-crossing scene (commit b168d64): leader lines are now assigned to rows by anchor height, so they no longer cross or pass through other parts. A test was added, and Y1.S3.SS4.LI3 was re-rendered after the deploy.
- 103 "uses words not in the sources" phrase warnings remain in figure detail text (out of scope).
- Live check: 3 throwaway students (Y1, Y2, Y3), suspended afterwards; creds shredded. Screenshots: /workspace/lesson-shots/social-studies/label-fixes/ (box).

## Social Studies Year 3 strands 3–6 (2026-10-24)
- Source: Y3 LM `Social-Studies_LM_Y3_Online_LV.pdf` (doc 6ad023542b97619a4537aa36); curriculum doc 6ad021732b97619a4537a36b.
- Dry run: 17 modules (S3 4, S4 5, S5 2, S6 6), about $0.233, none skipped. Generated one strand at a time. The per-user limit stayed at 120 (17 used today).
- First pass: 10 published and 7 in review (6 ungrounded figure labels, 1 org chart with a single child). All 7 were fixed through versioned admin PATCH F (redrawn from the spec, no AI, $0). Every replacement label was checked against both the notes and the LM. All 17 are now published as AI-Approved, with 0 errors.
  - S3.SS3.LI1: removed the invented Court of Appeal sub-unit "Appellate bench".
  - S3.SS3.LI2: "Discretionary fairness orders" → "Court orders: injunctions and declarations".
  - S4.SS1.LI1: "Visibility" → "Nature of control".
  - S4.SS1.LI2: "Primary Scope" → "Focus".
  - S4.SS2.CS1.LI1: rebuilt the tax org chart from the LM (Parliament / Article 174, Act 915, GRA → direct and indirect taxes).
  - S4.SS2.CS2.LI2: "Core Focus" → "Meaning" and "LM Example" → "Example".
  - S6.SS4.LI1: the budgeting table repeated the approach as a column; it is now "How it works / Example".
  - Log: /workspace/ss/y3/fix_log.json (box).
- Figures (29): conceptmap 12, comparison 7, orgchart 3, process 3, history_timeline 2, causeeffect 2. Every number in the figures appears in the LM.
- Cost: 17 lesson-generation requests. Lesson generation went from $1.5968 to $1.8436 (+$0.2468); the 30-day platform total is $1.8742 of the $10 cap.
- Live check:
  - A throwaway Y3 student completed all 20 Y3 modules in order at 100%, then was suspended (sign-in now returns 401); creds shredded.
  - On desktop and mobile, the 58 figure renders showed 0 overlaps and 0 clipped labels. Every figure Listen button speaks its title and caption. Each lesson has 13–14 section Listen buttons and Pronounce buttons.
  - Screenshots: /workspace/lesson-shots/social-studies/y3/ (box).
- Open:
  - The two globalisation lessons show US-dollar amounts as text ("$3.4 trillion" is from the LM; $400,000 and $15 billion are hypothetical worked-example values). socialSpeech has no dollar rule, so the browser engine reads them as written.
  - The edit path only checks the notes, so some phrase-level "uses words not in the sources" warnings remain in figure detail text.

## Currency / invented figures fix (2026-10-24)
- Y3.S6.SS6.LI1 (…3868): E0 invented "$400,000 cooperative" rewritten without numbers (LM p181); E1 "$15 billion × 20%" → cocoa ≈ 20% of export earnings (LM p183); K2 invented shea tonnes → 1.3 billion AfCFTA market (LM p182); F.2 aspect renamed "Development Benefits".
- Y3.S6.SS6.LI2 (…3869): figures (54 countries, 1.3 billion, $3.4 trillion) all in LM p182 — unchanged.
- Y3.S6.SS2.LI1 (…3864) 35% → LM range 25–40% (p148); Y1 ec3d IR date → 18th century; Y1 ec2f hypothetical peak; "Hypothetical example:" labels added to word-problem data across ec44/45/46, 3840, 384a, 384f, 3850, 3858, 3859, 385d, 3849, 3862, 3865, 3866.
- Speech: web/src/lib/currency.ts ($, US$, GH₵/GH¢ → words; pesewas); maths typesetting skips money (commit d9a3ce6). Tests: server 397/397, web 102/102, e2e 108/108 (in two runs).
- Live check with throwaway Y3 student (suspended, creds shredded). Screenshots: /workspace/lesson-shots/social-studies/currency-fix/. AI cost $0.
- Open: MATH-Y1.S3.SS2.CS1.LI2 D has `$090^circ$` (missing backslash), not fixed.

## Human approval feature (2026-10-25, commit e28a7d7)
- Lesson field `humanReview` is kept separate from `aiReview`. Approval records the reviewer's name (defaults to the account name), role, timestamp, optional comment and the approved version. Revoking requires a reason. Both actions write a LessonReview history entry (`human_approve`/`human_revoke`) and an AuditLog entry (`curriculum_lms.module.human_approve`/`human_revoke`, with before and after).
- Approval is valid only while `humanReview.version === lesson.version`. Any edit, regeneration or restore sets the lesson back to pending.
- Admin: the subject page shows Human-approved and Pending counts, a "Pending human approval" list, a filter, and a badge on each module. The module page has a "Human approval" panel (approve / revoke). Permission needed: content:review or content:publish.
- All 127 published lessons start as pending. Tests: server 398/398 (a new human-approval test), web 102/102.

## General Science Year 2 (2026-10-25)
- Source: `General-science-LM-book-2-LVersion-1.pdf` (doc 6ad022e72b97619a4537a8a1, 280 pp, verified_official, curriculumresources.edu.gh). Re-downloaded on 2026-10-25; its SHA-256 matches the stored checksum. Its 8 sections cover all 7 Y2 sub-strands (S2.SS1 = sections 2 and 3). The book is mapped to every Y2 sub-strand. Curriculum text fix: 2.4.2.LI.1 had a stray leading "n". 2.2.1.LO.2 is cut off in the source PDF itself, at a page break.
- 18 modules materialised and generated (18 AI requests, about $0.26). 15 passed first time. 3 were held and fixed through a no-AI F PATCH:
  - S1.SS1.CS1.LI1: table cell "None in excess" → "Neutral" (LM: "Water is neutral").
  - S2.SS1.CS2.LI1: the breathing cycle's arrow label was over 40 characters; arrow labels removed.
  - S4.SS1.CS1.LI2: "Infectious pathogen / Susceptible host" → "Pathogen / Host" (LM wording).
- Number audit against the LM text: 57 word problems in E/K with invented data are now labelled "Hypothetical example:". The KOH dilution example follows the LM, which itself prints 250 cm³ for a stated 240 cm³. It now uses 240 + 70 = 310 cm³ → 0.62 mol/dm³, with a note about the LM misprint. All 18 are published as AI-Approved and pending human approval.
- Figures: 30 (process 17, structure 7, circuit 3, datatable 2, cyclediagram 1).
- Live check: a throwaway student (test-sci-y2-…@example.com) completed all 18 in order at 100%, then was suspended; creds shredded. 60 figure renders on desktop and mobile had 0 overlaps, 0 clipped labels and 0 raw markup. Each figure's Listen button speaks its title and caption. Lessons have 14 section Listen buttons and Pronounce buttons. Shots: /workspace/lesson-shots/science/y2/ (box), including admin-pending-*.png and admin-human-approval-*.png.
- Cost: 18 requests today (limit 120). The month went from $1.88 to $2.14 of the $10 cap.

## Biology (BIO, 2026-10-26)
- Curriculum: Biology-Curriculum.pdf (doc `6ad0213f2b97619a4537a2ac`), imported as 12 strands, 24 sub-strands, 37 LOs, 38 CSs and 71 indicators. Source misprints were fixed in the import with notes: 3.2.2→3.2.1, p78 Ecology sub-strand, Y3 S2 numbering.
- Learner manuals (curriculumresources.edu.gh, verified_official): Year 1 sections 1–8 (LM-Biology-section-N-LVersion.pdf), Year 2 LM-Biology-book-2-learner-version.pdf, Year 3 Biology-Year-3-LM-LV.pdf. 71/71 modules materialised with a source.
- Code 6a16685: Biology gets the science figure kinds (isScience). Speech now reads µm as micrometre, ×400 as "times 400" and F1 as "F 1".
- Batch 1: Y1 Strand 1, 8/8 published (AI-Approved), 0 held, 9 figures. All 8 are pending human approval. Live-checked with a throwaway student, which was then suspended and its credentials shredded. Shots are in /workspace/lesson-shots/biology/.
- Live check (2026-10-26, throwaway student test.bio2…@example.com, Y1 elective Biology). The student took all 8 modules in order, passed each knowledge check at 100% (answered from the lesson and the manual) and completed each one. Results:
  - 9 figures rendered on desktop and mobile with 0 label overlaps, 0 clipped labels and 0 raw markup.
  - Every figure's Listen button spoke.
  - Both test accounts are suspended and the credentials file was shredded.
  - Note: the web shows "Resource not found" for a sequentially locked module. The API returns 403 MODULE_LOCKED, so the UI should say "Complete the previous module first".
  - Note: the section-F Listen selector in the shot script did not match. Each figure's Listen button works.

## QA catch-up and Biology Y1 S2 (2026-10-27, run interrupted)
- Locked-module bug fixed (169ac62, deployed, Render dep-dbg5652fngtc738nki1g): a sequentially locked module now shows the server's "Complete the previous module first" message with a link to the previous module, not "Resource not found". MODULE_LOCKED now returns `requires`. Shots: /workspace/lesson-shots/locked-fix/ (before/after, desktop and mobile).
- Number and label audit of the 2026-10-26 batch (104 modules incl. Y1 S3 maths) against the LM text: 61 word problems with invented data labelled "Hypothetical example:"; prose examples in 8 modules labelled; `$090^circ$` fixed; `\\sum f` fixed; 5 figure fixes (3 clipped titles shortened, raw `$\Delta$` concept name, un-sourced table column removed and 34.1% → 34% as in the LM). All no-AI versioned PATCHes, $0. Logs: /workspace/run1027/ (box).
- Live check: throwaway students took Maths Y1 (30), Y2 (34), Y3 (23) and Sci Y3 (20) in order, each knowledge check passed and each module completed; the next module unlocked every time. Maths desktop and phone shots: /workspace/lesson-shots/maths/qa1027/ (51 lessons, 0 overlaps, 0 clipped labels).
- Biology Y1 S2: 3/3 published (AI-Approved), pending human approval. Live check of these 3 was started but not finished.
- From 07:49 UTC every Gemini call failed with HTTP 402 (prepaid credits depleted): 45 Biology modules (Y1 S3–4, Y2 S1–4, Y3 S1) are `failed`, nothing published, cost $0. The run stopped there, leaving 5 test students active (fixed 2026-10-28).

## QA catch-up, part 2 (2026-10-28, no AI, $0)
- Gemini still returns HTTP 402 (one probe regenerate of BIO-Y1.S3.SS1.CS1.LI1, failed, $0), so no lessons were generated.
- Raw `$…$` in C concept names and J vocabulary terms (21 terms in 11 maths lessons, e.g. "General term ($U_n$)") now typeset as maths (LessonView, commit after 169ac62, web deployed). Checked live in 5 lessons on desktop and phone: 0 raw `$`. Shots: /workspace/lesson-shots/maths/qa1028/.
- Walk-flagged `\\begin{pmatrix}`/`cases` hits in Y2 S3 and Y3 S2 were checked: they are `\\` row separators, not errors.
- Sci Y3: a new throwaway Y3 student (qa-sci3-1028@example.com) took all 20 in order, passed each check and completed each; then suspended, creds shredded. 56 figure renders (desktop and phone) had 0 overlaps, 0 clipped labels, 0 raw markup, no page errors; figure Listen buttons spoke. Shots: /workspace/lesson-shots/science/y3-qa1028/.
- Leftover 2026-10-27 test students (5) suspended; all creds files shredded.
- QA of the 2026-10-26 batch (Sci Y3 20, Maths 87) is complete: nothing needed unpublishing.
- Biology Y1 S2 live check finished: a throwaway Y1 Biology student (qa-bio1-1028@example.com) took all 11 Y1 S1–S2 modules in order at 100% and completed each; 10 figure renders for the 3 S2 lessons (desktop and phone) had 0 overlaps, 0 clipped labels and no page errors. Suspended, creds shredded. Shots: /workspace/lesson-shots/biology/y1s2/. Number audit of these 3 against the LM is still to do.

## Biology batch 2026-10-28 (new Gemini key)
- Key swap: the old project's prepaid credit was depleted (HTTP 402). The server reads the key only from the env (`config.GEMINI_API_KEY`; the DB settings refuse secrets). Updated only `GEMINI_API_KEY` on Render ghlearn-api with the single-var endpoint and redeployed (dep-dbh3qa0u01pc73fgt76g, live 18:23 UTC). Rollback: the old value is still `GEMINI_API_KEY_PAID` in the deploy secrets file. AI health: LLM and embeddings OK. Probe regenerate of BIO-Y1.S3.SS1.CS1.LI1: published.
- Generated the 59 remaining Biology modules (Y1 S3–4, Y2 S1–4, Y3 S1–4): 54/71 now published (AI-Approved, pending human approval) and 17 held (in_review), none failed. Requests today: 63 of 120. Month estimate $4.86 of $10, about $0.90 this batch (billed to the new project).
- Number audit, all 54 published (including Y1 S2): 80 practice items and prose passages with numbers not in the LM are labelled "Hypothetical example". The remaining audit hits are LM page or activity references. 0 left unlabelled.
- Live check: 3 throwaway students (Y1, Y2, Y3 elective Biology) took all 54 published lessons in order, passed at 100% and completed each; 77 diagrams, no raw markup and no lock errors. Figure and Listen checks on 6 lessons, desktop and phone: 0 overlaps, 0 clipped labels, 0 page errors, and Listen spoke on every figure. All suspended, creds shredded. Shots: /workspace/lesson-shots/biology/batch1028/.
- Held (17), with reasons:
  - BIO-Y1.S3.SS3.CS1.LI1: F.1: "Secondary Transmission" is not in the notes or the learner manual; F.1: "Inoculation of parasite" is not in the notes or the learner manual; F.1: "Blood meal ingestion" is not in the notes or the learner manual
  - BIO-Y1.S4.SS2.CS1.LI2: F.1: invalid diagram (structure: epidermis, cortex, endodermis, pericycle, xylem, phloem, pith are not parts of a flowering plant (use flower, petal, bud, leaf, stem, node, internode, fruit, tap root, lateral root, root 
  - BIO-Y2.S1.SS1.CS1.LI1: F.2: "Gamete fusion" is not in the notes or the learner manual; F.2: "Embryo development" is not in the notes or the learner manual
  - BIO-Y2.S2.SS1.CS1.LI1: F.2: invalid diagram (structure: lysosome is not a part of a animal cell (use cell membrane, cytoplasm, nucleus, nucleolus, mitochondrion, ribosome, vacuole, golgi body, endoplasmic reticulum))
  - BIO-Y2.S3.SS1.CS1.LI1: F.1: "pupation" is not in the notes or the learner manual; F.1: "oviposition" is not in the notes or the learner manual; F.2: "cocoon formation" is not in the notes or the learner manual; F.2: "oviposition" is not in the
  - BIO-Y2.S3.SS2.CS1.LI1: F.1: invalid diagram (structure: subject is required (animal cell, plant cell, flowering plant, apparatus, organ system or other))
  - BIO-Y2.S3.SS2.CS1.LI2: F.1: invalid diagram (structure: buttress roots is not a part of a flowering plant (use flower, petal, bud, leaf, stem, node, internode, fruit, tap root, lateral root, root hair, root, shoot))
  - BIO-Y2.S4.SS1.CS1.LI1: F.3: invalid diagram (datatable: each row has one value per column)
  - BIO-Y2.S4.SS2.CS1.LI1: F.1: invalid diagram (structure: Tracheids, Xylem Vessels, Xylem Parenchyma, Xylem Fibres are not parts of a flowering plant (use flower, petal, bud, leaf, stem, node, internode, fruit, tap root, lateral root, root hair,
  - BIO-Y2.S4.SS2.CS1.LI2: F.1: invalid diagram (datatable: each column needs a label (unit optional, e.g. "°C"))
  - BIO-Y3.S1.SS2.CS1.LI4: F.2: "Glycerol" is not in the notes or the learner manual
  - BIO-Y3.S3.SS1.CS1.LI1: F.2: "Absorbed nutrients" is not in the notes or the learner manual
  - BIO-Y3.S3.SS2.CS1.LI1: F.1: "atmospheric cooling" is not in the notes or the learner manual; F.1: "drainage and absorption" is not in the notes or the learner manual; F.1: "solar heating" is not in the notes or the learner manual
  - BIO-Y3.S3.SS3.CS1.LI1: F.1: "Interrupted transmission" is not in the notes or the learner manual; F.1: "Controlled outbreak" is not in the notes or the learner manual
  - BIO-Y3.S3.SS3.CS1.LI2: F.1: "Healthy seeds" is not in the notes or the learner manual; F.2: "Shedding in Birth Fluids" is not in the notes or the learner manual; F.2: "Exposure and Infection" is not in the notes or the learner manual; F.2: "ab
  - BIO-Y3.S4.SS1.CS1.LI2: F.2: "Viable offspring" is not in the notes or the learner manual
  - BIO-Y3.S4.SS2.CS1.LI3: F.1: invalid diagram (structure: Stomata, Lenticels, Leaf fall (abscission), Old bark are not parts of a flowering plant (use flower, petal, bud, leaf, stem, node, internode, fruit, tap root, lateral root, root hair, roo

## Fix run 2026-10-28 (evening)

AI use: 2 requests, both failed (General Science SAFETY block, Maths invalid JSON), cost about $0. Month to date about $4.86 of the $10 cap. Neither limit was changed.

**Biology: 17 held lessons fixed without AI and published.** Figures were cut back to what the learner manual says. Arrow labels or stages that were not in the manual were removed. Parts that the tool cannot draw accurately are now labelled lists.
- Lessons: Y1.S3.SS3.CS1.LI1, Y1.S4.SS2.CS1.LI2, Y2.S1.SS1.CS1.LI1, Y2.S2.SS1.CS1.LI1, Y2.S3.SS1.CS1.LI1, Y2.S3.SS2.CS1.LI1, Y2.S3.SS2.CS1.LI2, Y2.S4.SS1.CS1.LI1, Y2.S4.SS2.CS1.LI1, Y2.S4.SS2.CS1.LI2, Y3.S1.SS2.CS1.LI4, Y3.S3.SS1.CS1.LI1, Y3.S3.SS2.CS1.LI1, Y3.S3.SS3.CS1.LI1, Y3.S3.SS3.CS1.LI2, Y3.S4.SS1.CS1.LI2, Y3.S4.SS2.CS1.LI3.
- The number audit added 20 "Hypothetical example" labels across 9 of these lessons.
- Renderer fix (commit 19cf304): long structure labels now wrap. Lessons published before that fix keep their old SVGs, which is a follow-up.
- Live check: 3 throwaway students walked all 71 Biology lessons in order, with 0 failures. They were then suspended and their credentials shredded.
- Screenshots of 7 lessons are in `/workspace/lesson-shots/biology/fix1028/`, with 0 overlaps, 0 clipped labels and 0 page errors. Listen works on every figure.

**Maths: 10 held lessons fixed without AI and published.**
- Y1.S2.SS1.CS2.LI1, Y1.S2.SS2.CS1.LI1, Y1.S4.SS2.CS1.LI1, Y1.S4.SS2.CS1.LI2, Y2.S1.SS1.CS2.LI1, Y2.S1.SS2.CS2.LI1, Y2.S2.SS1.CS1.LI1 (wrong K.4 answer corrected to x = 2, y = 1), Y2.S2.SS2.CS1.LI4, Y3.S2.SS2.CS1.LI2.
- Y2.S2.SS1.CS1.LI3: E.3 now shows the axis intercepts that the graph uses.
- The number audit added 1 label (Y1.S2.SS1.CS2.LI1 K.2).
- Live check: 3 throwaway students walked all 97 published Maths lessons in order, with 0 failures. The "bad markup" hits were only pmatrix `\\` row breaks and the word "undefined" in answer options.
- The students were **not yet suspended**. See the resume point.

**Still held**
- General Science Y3 S1.SS1.CS1.LI3: SAFETY block.
- MATH-Y2.S1.SS1.CS3.LI2: invalid JSON.
- 10 Maths lessons: source missing (they have only a teacher's manual).

**Not done:** English generation (0 of 91 modules). Late in the run, the safety check on tool actions failed on every live API call, so no further live work, deploy or push was possible.

## English generation run 2026-10-29

- Generated the remaining 89 English modules (batches of 8, `/workspace/eng1029/engrun.py`). One `POST /generate` timed out client-side at ~07:55 UTC but ran on the server (checked live before resuming; no duplicates). Result: 96 of 98 English modules published; 2 source missing (no LM mapped).
- Held after generation: 9 in total (earlier held lessons from the morning had already passed), all fixed without AI (`efix1029.py`, `efix1029b.py`): ungrounded or invalid section-F figures removed (dialogues/sentences not in the notes or LM, broken sentence/dialogue specs) for ENG-Y2.S4.SS1.CS1.LI2, Y2.S4.SS2.CS1.LI3, Y3.S1.SS2.CS1.LI1, Y3.S1.SS3.CS1.LI1, Y3.S1.SS3.CS1.LI2, Y3.S2.SS1.CS1.LI3, Y3.S3.SS1.CS1.LI2, Y3.S4.SS1.CS1.LI1; ENG-Y3.S4.SS3.CS1.LI1 had a live web link (now "[full website address]") and a duplicate-option quiz item (replaced with an LM-grounded APA initials question). All 9 now published, held 0.
- QA (`qafix1029.py`): number audit vs LM text: two invented-date examples tagged "Hypothetical example" (ENG-Y1.S4.SS2.CS2.LI2 memo, ENG-Y3.S4.SS2.CS2.LI1 CV); activity numbers not found in LM text removed (ENG-Y3.S3.SS1.CS2.LI1, Y3.S3.SS1.CS4.LI1). Label audit (`figaudit.py`) flags only paraphrased headings, no invented facts. Live walk: 3 throwaway students (`test-eng1029-y{1,2,3}-*@example.com`) opened all 96 lessons in order, 96/96 quizzes passed, each next lesson unlocked; suspended and credentials shredded. Screenshots (5 lessons, desktop + mobile, 0 raw markup): `/workspace/lesson-shots/english/1029/`.
- Retries: `MATH-Y2.S1.SS1.CS3.LI2` regenerated with a strict-JSON instruction, **published** v1 (pending human approval). General Science Y3 S1.SS1.CS1.LI3 blocked again (SAFETY), held.
- AI use 2026-10-29: 94 of 120 requests; month to date $6.19 of $10. No code changes, no deploy.

## Additional Mathematics (AMATH) — started 2026-10-29 09:02 GMT
- **Sources:** curriculum `6ad021372b97619a4537a28e` (564 pp). Learner manuals (all verified_official): Y1 Sections 1–10 (10 docs), Y2 book `6ad022fa2b97619a4537a8e5`, Y3 book `6ad0231f2b97619a4537a972`. The learner manual is the primary source.
- **Import:** 283 items (12 strands, 22 sub-strands, 54 LOs, 34 CSs, 161 indicators). Subject id `6ad0200833e70788b3fb54f0`; maths validator and figure kinds apply (name matches /math/).
  - Parser misprint fixes (source typos): "L1"→"LI", "1.1.1.CS2"→"1.1.1.CS.2", p.350 "1.2.1.LI.1/AS.1"→"2.2.1". Y3 LO 3.2.1.LO.1/2 retyped from garbled glyphs as "y = ax² + bx + c" and "y² = 4ax". 8 LO/CS/LI texts may be cut at page breaks (parser warning).
  - Y1 manual mapping: 1.1→S1+S2, 1.2→S3+S4, 2.1→S5+S6, 2.2→S7, 3.1/3.2→S8, 4.1→S9, 4.2→S10.
  - **Y2 S4.SS1 (research/data collection) = source missing:** the Y2 manual's data section covers correlation only. LI1, LI2 not generated.
- **Modules:** 161 (Y1 69, Y2 49, Y3 43).

| Year | Strand | Lessons | Published | Held | Source missing |
|---|---|---|---|---|---|
| 1 | 1 | 32 | 22 | 0 | 0 |
| 1 | 2 | 15 | 0 | 0 | 0 |
| 1 | 3 | 8 | 0 | 0 | 0 |
| 1 | 4 | 14 | 0 | 0 | 0 |
| 2 | 1 | 22 | 0 | 0 | 0 |
| 2 | 2 | 10 | 0 | 0 | 0 |
| 2 | 3 | 11 | 0 | 0 | 0 |
| 2 | 4 | 6 | 0 | 0 | 2 |
| 3 | 1 | 8 | 0 | 0 | 0 |
| 3 | 2 | 15 | 0 | 0 | 0 |
| 3 | 3 | 8 | 0 | 0 | 0 |
| 3 | 4 | 12 | 0 | 0 | 0 |

- **Totals:** 22 published (all AI-approved, pending human approval), 2 failed generation, 2 source missing, 135 draft.
- **Failed (retry needed, AI):** AMATH-Y1.S1.SS2.CS1.LI3, LI6 — "Model returned invalid JSON".
- **Fixed without AI:** LI8 (wrong CAS check value on K.4 → 4; published v2); LI11 coordinate figure (points relabelled P/A/B, caption "Example 2…", title shortened to "Lines meeting at P" because it clipped on phone). "Hypothetical example" labels added to 9 items in 6 modules.
- **Speech:** `mathSpeech.ts` extended (matrices row by row, log base/ln, limits, integrals, dy/dx, nCr/nPr/binom, inverse, vectors, set and logic symbols, sec/csc/cot, ∘). Web deployed.
- **QA:** number/label audit 0 flags (35 figures, 0 unmatched labels). Throwaway Y1 student walked all 22 in order (all passed, each unlocked the next), then suspended; credentials shredded. Shots: /workspace/lesson-shots/addmaths/ (0 raw markup, 0 overlaps).
- **AI:** 26 requests today (day total 120/120), month to date ~$6.62 of $10.
- **Resume:** retry AMATH-Y1.S1.SS2.CS1.LI3 and LI6, then continue from AMATH-Y1.S1.SS2.CS1.LI13 in natural curriculum order.
