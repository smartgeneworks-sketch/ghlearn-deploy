# Curriculum LMS: progress (updated 2026-10-22)

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

## Routes added
- `/api/curriculum-lms`: `POST /modules/materialize`, `POST /generate`, `GET /subjects/:id/overview`, `GET|PATCH /modules/:id`, `POST /modules/:id/regenerate`, `POST /modules/:id/restore`, `GET /subjects/:id/analytics`.
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
- Pending: 17 Y3 modules (strands 3:4, 4:5, 5:2, 6:6), ≈ $0.24. Resume (dry-run first): POST /api/curriculum-lms/generate {"documentId":"6ad021732b97619a4537a36b","year":3,"strand":N,"dryRun":false} for N=3,4,5,6.
