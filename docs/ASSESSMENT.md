# Assessment, games, rewards and progress (spec §9–11)

## Question bank
Every question records `subjectId, levelId, yearOfStudy, strand, topic, objective, difficulty, citations (document + pages), lessonId?, aiGenerated, aiModel, createdBy, reviewedBy, status`. Students only receive `published` questions, and only inside an attempt or game with answer keys stripped.

| Type | `data` (answer key) | Marking |
|---|---|---|
| mcq | `options[2-6], correctIndex` | exact (options shuffled per attempt) |
| true_false | `answer: boolean` | exact |
| short_answer | `acceptedAnswers[]`, optional `keywords[] + minKeywords`, `allowSpelling` | case/punctuation/article-insensitive; small spelling slips allowed on words ≥ 5 letters (never on numbers); keyword mode gives partial credit |
| gap_fill | `text` with `{{1}}…`, `gaps[{accepted[]}]`, optional `wordBank` | one mark per blank, flexible text |
| matching | `pairs[{left, right}]` | one mark per pair (right side always shuffled) |
| ordering | `items[]` in correct order | full marks for exact order, otherwise proportional to items in the right position |
| diagram_labelling | `centre, labels[{accepted[]}], alt` | one mark per label; the SVG shows numbered blanks only |
| numerical | `value, tolerance, toleranceType abs\|pct, unit, requireUnit, workedSolution?` | within tolerance; with a required unit, a right number with a wrong/missing unit loses one mark |
| structured | `parts[{prompt, type mcq\|short_answer\|numerical\|essay, marks, …}]` | per part; essay parts → AI-provisional |
| essay | `guidance, wordLimit` + top-level `rubric[{criterion, maxMarks, descriptors}]` | AI-provisional rubric marking, teacher verifies |
| case_study | `scenario, parts[…]` | as structured |

**Validation** (`validateQuestion`) checks every answer key (index range, distinct options, blank/answer counts, numeric values, tolerance, rubric totals, part types). Invalid questions cannot be submitted or approved.
**Generation** (`POST /api/questions/generate`, job `questions.generate`): retrieval → Gemini JSON (types/count/difficulty) → citations mapped to pages → validation → **independent AI cross-check** (a second call answers MCQ/TF/numerical without the key; disagreements are flagged to reviewers) → **near-duplicate detection** (max of word-trigram Jaccard and 0.9 × word-set Jaccard ≥ 0.7, against the subject bank and the batch) → stored as `draft`. Manual creation runs the same duplicate check (409 `NEAR_DUPLICATE`).
**Review (§13, Phase 8):** Draft → Awaiting review → Approved (stored as `published`: in the bank) | Changes requested → Resubmitted | Rejected; Archived. Authors (the creator and anyone who saved a version) can never approve, the super admin included. Approving requires the reviewer to confirm they verified the answer key (`keyVerifiedBy/At/Version`), plus a comment if the AI cross-check disagreed. Approved questions are not edited in place: *Revise* (only when no open assessment or live game uses it) or *Duplicate*. Every save is a version (`ContentVersion`), every action is logged (`ContentReview`). Archive is refused while an open assessment or a live game uses the question. Questions may carry `timeLimitSec`; an assessment without an explicit time limit uses the sum when every question has one.

**Marking by type:** essays are teacher-marked (AI-provisional first when AI is configured, teacher verifies); structured and case-study questions are auto-marked except their essay parts; every other type is auto-marked. `GET /api/questions/types` reports this per type.

## Marking & feedback
Each response gets `score/maxScore, correct, feedback, explanation, improvement (type-specific tip), revisionTopic`; attempts list `revisionTopics` (< 60 %). Essays and essay parts: job `attempt.aiMark` sends the rubric, guidance and the fenced student response to Gemini (instructions in the response are ignored; marks clamped to each criterion maximum). The result is `markedBy: ai_provisional, needsReview: true` and the attempt stays `pending_review` (`provisional`) until a teacher of that school and subject verifies it (`/api/assessments/marking/...`). Without an LLM, written answers wait for the teacher.

## Modes
| Mode | Selection | Time |
|---|---|---|
| practice | objective types, random | none |
| timed | objective types | `timeLimitSec` (default 1 min per question) |
| topic_revision | one topic (required) | none |
| mixed | round-robin across topics | none |
| remedial | previously wrong questions first, then weakest topics (mastery < 70 %) | none |
| mock | all types incl. essays, 20 questions, or a teacher-set mock | 60 min default |
| assigned | teacher's fixed question list; school/year/subject eligibility; window; `maxAttempts` | teacher-set |

Attempts store a random seed and per-question permutations, deadlines are enforced server-side (a grace of `ATTEMPT_GRACE_SEC`; late saves → 409 `TIME_UP` and auto-submit), and history is listed per subject. `showAnswers: after_close` hides correct answers until the assessment closes.

## Games (spec §10)
quiz_challenge (MCQ/TF with streak bonus), match_terms (lesson vocabulary or matching questions), ordering (ordering questions + lesson flow/cycle diagrams), flashcards (lesson cards + terms; "not yet" cards come back), gap_fill, word_search (deterministic grid; clues are definitions; cell-by-cell keyboard selection or type-the-word accessible mode), label_diagram (labelling questions + lesson labelled diagrams), classification (lesson concept maps/tree diagrams), timed_revision (2-minute mixed set, server deadline), scenario (case studies, objective steps). All are built from **approved** content linked to subject/topic/objective; answer keys stay on the server; hints cost 3 points; every item gets feedback; replay starts a new session.


### Authored games (§14, Phase 8)
Content staff build **game designs** in Admin › Educational Games: one of the 10 engine types, linked to a subject, topic and objective, with difficulty, points per item, hints on/off and their cost, an optional time limit and a streak bonus. Items come from approved bank questions with a verified key (quiz, timed revision, gap fill, scenario, ordering, labelling, matching) and/or the design's own content (term pairs, flashcards, word-search terms with clues, sequences, labelled diagrams, sorting rounds). *Generate from content* assembles a draft from approved questions and published lessons on the topic, without AI.

`validateGame` blocks submission and publishing on: missing links; wrong item counts; questions of a type the game cannot play; content that would be ambiguous (duplicate terms, an item in two categories, repeated steps or labels); words that do not fit the 12 × 12 grid; and a **dry run** that builds the game with two seeds and plays every item: the correct answer must score full marks, a wrong answer must not, and hints must work when enabled. Publishing additionally needs a reviewer (not an author) to have verified the answers of the current version, and every question to be approved with a verified key; anything unverified is listed and blocks publishing. Students see published games they are eligible for (audience) under "Games for your topics"; staff previews use the same build and marking without creating sessions. Stats per game: sessions, players, completion, average score and accuracy, hints, XP and per-item correct rates.
## Rewards (learning, not screen time)
- XP: attempts give 2 per answered objective item + 3 per fully correct + improvement bonus; teacher-verified written answers 5–15; games score/10 (max 30) on first play, then only the improvement over your best. Fewer than 3 answers earns nothing. Daily cap 300. Each award is idempotent (`xpevents` unique per source/ref).
- Levels: `floor(sqrt(xp/50)) + 1`. Streak: consecutive days with a *qualifying* learning activity (≥ 3 answers / half the attempt), not logins.
- Badges: first_steps, perfect_score (≥ 5 questions, 100 %), streak_3, streak_7, topic_master (≥ 80 % with ≥ 10 answers), improver (+20 points on a retry), game_explorer (5 game kinds), reviewer (remedial set).
- Leaderboard: weekly XP, **off by default**, enabled per school by its admin; **anonymised by default** ("Learner 3FA2", stable per school); scope year group or school; never shows other schools.

## Progress & recommendations (spec §11)
Mastery per topic = exponentially weighted average of results (new = 0.7 × old + 0.3 × latest). The dashboard shows XP/level/streak/badges, mastery by subject and topic (bar charts), scores over time (line), accuracy by question type, and the leaderboard if enabled. Charts are plain SVG with text alternatives.
Recommendations are explainable rules, each with a reason string: (1) open teacher-set work; (2) topics below 60 % (lesson first, then topic revision); (3) topics ≥ 60 % not practised for 7 days (spaced review via flashcards); (4) topics with approved questions not yet tried; else mixed practice. Teachers see a class view (mastery, attempts, pending marking, weak topics, class average by topic) for their own school and assigned subject/year.
