# API
Machine-readable OpenAPI 3.1 is served at `GET /api/docs/openapi.json` (source `server/src/openapi.ts`). Paste it into https://editor.swagger.io to browse.

Conventions: JSON only, cookie auth (`credentials: 'include'`), and errors shaped as `{ "error": { "code", "message", "details?", "requestId" } }`. Codes: `VALIDATION_ERROR` 422, `BAD_REQUEST` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `LOCKED` 423, `RATE_LIMITED` 429, `INTERNAL` 500.

| Method | Path | Who |
|---|---|---|
| GET | /api/health | public (includes AI provider status) |
| POST | /api/auth/register, /login, /refresh, /logout | public |
| GET | /api/auth/me | authenticated |
| GET | /api/config/{schools,levels,academic-years,programmes,subjects,combinations} | authenticated (filters: levelId, programmeId, kind, category). `programmes` = Learning Areas |
| POST/PATCH | same | platform:manage (schools: school:create; PATCH own school: school_admin) |
| DELETE | /api/config/*/{id} | super_admin |
| POST | /api/onboarding | student, once |
| GET | /api/me/profile, /api/me/subjects | student |
| GET | /api/subjects/{subjectId}/resources | enrolled student / assigned teacher / editor / reviewer |
| GET | /api/resources/{id} | same, and published only for learners |
| GET | /api/auth/csrf | public; returns `{csrfToken}`. Send as `X-CSRF-Token` on every POST/PATCH/DELETE |
| GET | /api/documents, /stats, /{id}, /{id}/pages, /{id}/chunks, /{id}/file, /jobs/{jobId} | documents:upload / documents:map / content:review |
| POST | /api/documents/upload (multipart) | documents:upload |
| PATCH | /api/documents/{id} | mapping: documents:map; approvalStatus: content:review |
| POST | /api/documents/{id}/process | documents:upload / documents:map |
| POST/PATCH/DELETE | /api/documents/{id}/nodes[/{nodeId}] | documents:map |
| GET/DELETE | /api/admin/teacher-assignments[/{id}] | users:manage |
| GET | /api/admin/students/{userId}/profile | users:manage |
| GET/PATCH | /api/admin/users, /api/admin/users/{id} | users:manage (school-scoped) |
| POST | /api/admin/teacher-assignments | users:manage |
| PATCH | /api/admin/students/{userId}/subjects | users:manage |
| GET | /api/admin/audit | audit:view |
| GET | /api/lessons/budget | content:edit / content:review: today's AI requests and tokens vs budget |
| GET | /api/lessons/options | §11 option set: content types (sections, audience), unavailable types with reasons (infographics: no image provider; games: Educational Games), illustrations (images not configured), languages (English), defaults, provider |
| GET | /api/lessons/scope?subjectId&documentIds&curriculumVersionId&pageFrom&pageTo | content:edit: approved (verified official, indexed, current) manuals, the ones not approved, passage count, curriculum elements (with `verified`) |
| POST | /api/lessons/estimate | content:edit, same body as create; no provider call: `{scope, mapping, sections, estimate{provider, requests, maxRequestsWithRetries, embeddingCalls, inputTokens, outputTokens, outputBasis, costUsd, costBasis, budget}, problems[], canGenerate}` |
| POST | /api/lessons | content:edit `{contentType, subjectId, topic, subtopic?, nodeId? \| strand/subStrand/indicator?, yearOfStudy?, programmeId?, curriculumVersionId?, documentIds?, pageFrom?, pageTo? (one manual), controls{depth, readingLevel, length, durationMinutes, numActivities, numExercises, numQuizQuestions, difficulty{easy,medium,hard}=100, illustrations: none\|diagrams, numDiagrams, includeGhanaContext, language: en, sections (lesson only), teacherNotes}}` → 202. 422 `NO_APPROVED_SOURCES` (no provider call), 429 `AI_BUDGET`, 503 `AI_UNAVAILABLE`. `nodeId` sets the mapping from the manual (`indicatorSource: curriculum_node`); typed text is `editor`; indicators suggested by the model are dropped |
| GET | /api/lessons | content:edit / content:review; `q, status (repeatable), subjectId, contentType, assigned=me\|none\|id, review=queue` (awaiting review + resubmitted unless `status` is given), sort incl. `submittedAt` |
| GET | /api/lessons/reviewers | content:review or curriculum:manage: active reviewers |
| GET | /api/lessons/{id} | lesson + versions + reviews (who/when) + job + source docs + `permissions{edit, submit, decide{allowed,reason}, requestChanges, publish{allowed,reason}, unpublish, archive, assign, assignOthers, comment, cancel, retry, delete}` + content type |
| GET | /api/lessons/{id}/sources | each section with the full text of the passages it cites, manual, pages, approval and whether the manual is still current |
| PATCH | /api/lessons/{id} | content:edit; only draft / changes requested ("Save draft"); `baseVersion` mismatch → 409 `VERSION_CONFLICT`. A and K are rebuilt server-side |
| POST | /api/lessons/{id}/sections/{key}/regenerate | content:edit, editable statuses, budget checked → 202 (K is rebuilt from citations without AI) |
| GET | /api/lessons/{id}/versions/{v}, /compare?a&b | staff |
| POST | /api/lessons/{id}/versions/{v}/restore | content:edit, editable statuses |
| POST | /api/lessons/{id}/cancel, /retry; DELETE /api/lessons/{id} | content:edit. Cancel: queued jobs only (running → 409). Retry: failed only (scope + budget checked) → 202. Delete: failed (creator or curriculum:manage) or archived (platform:manage; its withdrawn resource is removed too) → 204 (versions, history and finished jobs removed, audited) |
| POST | /api/lessons/{id}/submit | content:edit, validation ok: draft → in_review, changes_requested → resubmitted |
| POST | /api/lessons/{id}/assign | content:review (self) or curriculum:manage / super (anyone) `{reviewerId \| null}`; assignee must hold content:review and must not be an author |
| POST | /api/lessons/{id}/comments | any lesson-area user `{comment, sectionKey?}` → 201 |
| POST | /api/lessons/{id}/review | content:review `{action: approve\|request_changes\|comment, comment}`. Authors (creator and anyone who saved a version, super admin included) cannot decide; an assigned review can only be decided by its reviewer (or super). request_changes needs a comment and also works on approved items |
| POST | /api/lessons/{id}/publish | content:publish `{audience{levelId?, yearOfStudy?, programmeIds?, schoolIds?}}`. 422 `REVIEW_INCOMPLETE` (approved version ≠ current), `SOURCE_NOT_CURRENT` (manual no longer verified official, archived or replaced), `VALIDATION_FAILED`. Teacher-preparation resources are teacher-only |
| POST | /api/lessons/{id}/unpublish, /archive | unpublish: content:publish (back to approved, resource hidden). Archive: content:publish, or curriculum:manage for unpublished items |
| GET/POST/DELETE | /api/tutor/conversations[/{id}] | tutor:use (own conversations only; subject access checked) |
| GET | /api/tutor/conversations/{id}/messages | tutor:use |
| POST | /api/tutor/conversations/{id}/messages | tutor:use; **SSE** events `meta`, `delta`, `done`, `error`; 429 `TUTOR_LIMIT` |
| POST | /api/tutor/messages/{id}/feedback | tutor:use (own messages) `{rating: up\|down, comment?}` |
| POST | /api/config/subjects/{id}/verify | config:manage (mark a seeded subject verified) |
| GET | /api/questions/types | staff and teachers: the 11 types with `marking: auto\|teacher\|mixed` and notes (essay = teacher-marked; structured/case study = essay parts teacher-marked) |
| GET | /api/questions?subjectId&status&review=queue&type&topic&difficulty&search&verified=true&page | staff: all; teachers: approved (`published`) questions of subjects they teach only. Items carry `teacherMarked`, `keyVerified` |
| GET | /api/questions/{id} | as above; student preview (answers stripped). Staff also get `answer` (the full-marks response), `usage` (assessments, responses, average %, games), `versions`, `reviews` (who/when) and `permissions` |
| GET | /api/questions/{id}/versions/{v} | staff: a version snapshot (for compare) |
| POST | /api/questions/validate | content:edit: check an answer key without saving → `{validation, preview, answer, selfCheck, teacherMarked}` |
| POST | /api/questions | content:edit; `timeLimitSec?`; near-duplicate → 409 `NEAR_DUPLICATE` (`?allowDuplicate=1` overrides) |
| PATCH | /api/questions/{id} | content:edit; only Draft, Changes requested or Rejected (409 otherwise); new version, clears key verification |
| POST | /api/questions/{id}/submit | content:edit: Draft → Awaiting review, Changes requested → Resubmitted (validation must pass) |
| POST | /api/questions/{id}/review | content:review `{action: approve\|request_changes\|reject\|comment, comment?, answerKeyVerified?}`. Approve needs `answerKeyVerified: true` (422 `KEY_NOT_VERIFIED`) and a comment when the AI cross-check disagreed (422 `CROSSCHECK_DISAGREED`); authors (creator or anyone who saved a version, super admin included) get 403 `REVIEW_BLOCKED` |
| POST | /api/questions/{id}/archive, /restore | content:publish or curriculum:manage; archive → 409 `IN_USE` while an open assessment or a live game uses it; restore → Draft |
| POST | /api/questions/{id}/revise, /duplicate | content:edit; revise takes an unused approved question back to Draft (409 `IN_USE` otherwise); duplicate makes a new draft |
| DELETE | /api/questions/{id} | author or curriculum:manage; never-approved, unused drafts only |
| POST | /api/questions/{id}/preview-mark | `{response}` → `{mark, teacherMarked, note}`; nothing is saved |
| POST | /api/questions/estimate | content:edit: approved-manual scope, requests (generation + cross-check), tokens, cost, quota, `problems`, `canGenerate` (no provider call) |
| POST | /api/questions/generate | content:edit `{subjectId, topic, objective?, types[], count≤15, difficulty, documentIds?}` → 202 `{jobId, estimate}`; 422 `NO_APPROVED_SOURCES` (no verified-official manual), 429 `BUDGET_EXCEEDED`, 503 `AI_UNAVAILABLE`. Retrieval uses approved manuals only |
| GET | /api/questions/jobs/{jobId} | staff; result `{created, duplicatesSkipped, duplicates[], invalid, questionIds}` |
| POST | /api/practice/attempts | learn:access + enrolled `{subjectId, mode, topic?, types?, difficulty?, count?, timeLimitSec?, assessmentId?}`; 422 `NO_QUESTIONS` |
| GET | /api/practice/attempts[?subjectId&mode], /attempts/{id} | own attempts only (others → 404) |
| PUT | /api/practice/attempts/{id}/responses/{questionId} | own, in progress; after deadline → 409 `TIME_UP` + auto-submit |
| POST | /api/practice/attempts/{id}/submit | own; idempotent |
| GET | /api/practice/assigned | student: published assessments for own school/year/subjects with own attempts |
| GET | /api/games | learn:access: the 10 games |
| GET | /api/games/designs?subjectId | learn:access + enrolled: published games (§14) the learner is eligible for (audience), with own plays and best score |
| POST | /api/games/sessions | learn:access + enrolled `{subjectId, game, topic?}` (quick play) or `{designId}` (a published game; 404 when unpublished or not in the audience); 422 `NO_CONTENT` |
| GET | /api/games/sessions, /sessions/{id} | own only |
| POST | /api/games/sessions/{id}/answer, /hint, /finish | own only; design sessions use the design's points per item, hint cost and streak bonus; hint → 409 `HINTS_OFF` when hints are disabled |

**Game designs (§14)**, `/api/game-designs`, content:edit or content:review:

| Method | Path | Notes |
|---|---|---|
| GET | /meta | the 10 game types with what they are built from (question types and/or content kind) and item limits |
| GET | / ?subjectId&status&type&review=queue&search | list with plays and players |
| GET | /{id} | design, fresh `validation`, linked questions (approval and key status), versions, reviews (who/when), `permissions` incl. `publishBlock` |
| POST | / | content:edit `{title, subjectId, topic, objective, type, difficulty, settings{pointsPerItem, hintsEnabled, hintCost, timeLimitSec?, streakBonus}, questionIds[], content{pairs\|cards\|terms\|sequences\|diagrams\|groups}}`; topic and objective are required |
| PATCH | /{id} | content:edit; Draft or Changes requested only; new version, clears answer verification |
| POST | /generate | content:edit `{subjectId, type, topic, objective, title?, difficulty?}`: a draft from approved, key-verified questions and published lessons only (no AI call); 422 `NOT_ENOUGH_CONTENT` |
| POST | /{id}/validate | rerun the checks: links, item counts, content rules, question approval and key verification, and a dry run that plays every item (correct answer must score full marks, a wrong one must not, hints must work) |
| POST | /{id}/preview, /{id}/preview/check | play as a student `{seed}` / `{seed, itemId, answer \| hint:true}`; no session, XP or mastery |
| POST | /{id}/submit | content:edit; validation must pass (422 `INVALID_GAME`) |
| POST | /{id}/review | content:review `{action: approve\|request_changes\|comment, answersVerified?, comment?}`; approve needs `answersVerified: true` (422 `ANSWERS_NOT_VERIFIED`) and every question approved with a verified key (422 `UNVERIFIED_ANSWERS`); authors → 403 `REVIEW_BLOCKED` |
| POST | /{id}/publish | content:publish `{audience{levelId?, yearOfStudy?, programmeIds?, schoolIds?}}`; 409 `PUBLISH_BLOCKED` unless approved for the current version, validation passes and no answer is unverified |
| POST | /{id}/unpublish, /archive, /restore | unpublish: content:publish (→ Approved); archive/restore: content:publish or curriculum:manage |
| DELETE | /{id} | author or curriculum:manage; never-published, unplayed drafts only |
| GET | /{id}/stats | sessions, finished, players, completion %, average score % and accuracy, hints, XP, last played, per-item correct % (students only; previews are not recorded) |
| GET | /api/rewards/me | learn:access: XP, level, streak, badges, recent XP events, rules |
| GET | /api/rewards/leaderboard[?subjectId] | learn:access; 404 `LEADERBOARD_DISABLED` unless school enabled it |
| GET/PUT | /api/rewards/schools/{schoolId}/leaderboard | school:manage (own school) `{enabled, anonymized, scope: year\|school}` |
| GET | /api/progress/me[?subjectId] | progress:view_own (enrolled subjects only) |
| GET | /api/progress/class?subjectId | progress:view_class; teacher's assigned subject, own school (and year) only |
| POST | /api/assessments | activity:assign; teacher's assigned subject; published questions only |
| GET/PATCH | /api/assessments, /api/assessments/{id} | own school + subject assignment (others → 404) |
| GET | /api/assessments/{id}/results, /{id}/attempts/{attemptId} | as above |
| GET | /api/assessments/marking/queue, /marking/{attemptId} | attempts of the teacher's school + subjects |
| POST | /api/assessments/marking/{attemptId}/responses/{questionId}/verify | `{score?, criteria?[], partScores?[], comment?}`; finalises AI-provisional/unmarked written answers |

## Phase 6
- `GET /api/teacher/subjects` · `GET|POST /api/teacher/classes` · `PATCH /api/teacher/classes/:id` (name, yearOfStudy, archived, add/removeStudents, add/removeTeachers) · `GET /api/teacher/classes/:id` (overview: students, support, misconceptions, topics, remedial, assignments) · `GET /api/teacher/classes/:id/candidates` · `GET /api/teacher/classes/:id/students/:userId` · `GET /api/teacher/classes/:id/report.csv|report.pdf` · `POST /api/teacher/classes/:id/remedial {topic,count?,closesAt?}` — permission `class:manage`, class-scoped.
- `POST /api/assessments` accepts `classId`. `GET /api/assessments/:id/results.csv`.
- `GET /api/offline/:subjectId` — HTML offline pack (subject access).
- `GET /api/analytics?schoolId&levelId&classId&subjectId&topic&from&to` · `GET /api/analytics/filters` — `analytics:view`, scoped (see TEACHING.md).
- `GET /api/admin/audit?action&actor&target&from&to&page&limit` · `GET /api/admin/audit.csv` — `audit:view`.
- `GET /api/notifications?unread&limit` · `POST /api/notifications/read {ids?|all}` — own only.

## Profile and meetings (Oct 2026)
| Method | Path | Who |
|---|---|---|
| POST | /api/onboarding | student, once: `{region, schoolName, schoolId?, levelId, yearOfStudy, programmeId?, coreSubjectIds[], electiveSubjectIds[]}` |
| PATCH | /api/me/profile | student: any of `region, schoolName, yearOfStudy, programmeId, coreSubjectIds+electiveSubjectIds` |
| GET | /api/analytics?region=… | analytics:view (super, school admin); `/api/analytics/filters` lists the 16 regions |
| GET | /api/meetings/hosts | student: teachers/counselors of own school |
| GET/POST/DELETE | /api/meetings/slots[/:id] | host: own availability; student: `?hostId=` open slots |
| GET | /api/meetings?when=upcoming\|past | participants |
| POST | /api/meetings | student: `{hostId, slotId \| start+durationMin, topic, mode, link?, note?}` |
| POST | /api/meetings/:id/respond | participants: `{action: accept\|decline\|reschedule\|cancel, start?, link?, location?, note?}` |

## Admin panel (Phase 2, Oct 2026)
- `GET /api/admin/overview?from&to&levelId&subjectId&schoolId` (admin:access): `{scope, filters, cards[{key,label,value,hint?,link?,estimate?}], activity{manuals?,generated?,approvals?,failedJobs?,audit?}, links{…}, warnings[{level,text,link?}]}`. Cards and activity are filtered by permission. School admins are pinned to their school (another `schoolId` returns 403). Unknown query keys return 422. Card, activity and warning links carry the active filters, but only those the target page supports.
- `GET /api/admin/overview/charts?from&to&levelId&subjectId&schoolId` (admin:access): `{unit: day|week|month, buckets[], from, to, scope, charts{key:{title,type:line|bar,series[{name,data[]}] | bars[{label,value,link?}],note?,estimate?,link?}}}`. Buckets are in UTC (weeks start Monday): day for ranges up to 62 days, week up to 366, month beyond. Ranges longer than 731 days, or with from>to, return 422. Each chart appears only for permitted roles: registrations/activeUsers/enrolment (users:manage); processing/uploads (documents); lessons (content:edit/review); review (content:review); exercises/performance (users:manage + analytics:view; performance is omitted when there are no attempts); aiRequests/aiCost (system:health, or analytics:view when not school-pinned; aiCost is marked `estimate:true`).
- `GET /api/documents` also accepts `processingStatus` as a comma list, `mappingStatus=unconfirmed`, and `levelId`.
- `GET /api/admin/search?q=` (admin:access, at least 2 characters): `{q, groups[{type,label,items[{id,title,subtitle,link}]}]}`. Only users, schools, manuals, lessons and questions the caller may open.
- `GET /api/admin/system` (system:health): db ping, uptime, memory, job counts by type and status, oldest queued job, last 10 failures, AI configured (boolean only) and 24-hour call counts. No secrets.
- `GET /api/admin/users/:id/roles`, `POST /api/admin/role-assignments {userId, role, schoolId?}`, `DELETE /api/admin/role-assignments/:id` (roles:assign). Rules are in PERMISSIONS.md.
- `GET /api/admin/users?q&role&status&schoolId&page&pageSize&sort`. This is the shared list contract (`lib/list.ts`): `{items,total,page,pageSize,pages}`. `sort` is an allow-listed field, optionally prefixed with `-`; anything else returns 422. `pageSize` is at most 100.
- `GET /api/lessons` now follows the same contract (`q`, `status` single or repeated, `subjectId`, `sort`; pageSize defaults to and caps at 200).
- `GET /api/admin/audit` accepts `outcome`, `entityType`, `requestId` and `pageSize` (or the older `limit`). The CSV adds Outcome, Entity, Request id, Before and After.
- `POST /api/auth/change-password {currentPassword,newPassword}`: a wrong current password returns 422. On success every other session is revoked and the caller gets a fresh session.
- `POST /api/auth/logout-all`: revokes every session, including the caller's.
- Audit events: `auth.login`, `auth.login.failure` (an unknown account is logged without the submitted email), `auth.login.locked`, `auth.lockout`, `auth.logout`, `auth.logout_all`, `auth.password.change`, `role.grant`, `role.revoke`, `role.set`, `user.suspend`, `user.activate`, and `<config>.create/update/delete` with diffs.

## Admin panel (Phase 4, Oct 2026)
- Users (users:manage; school admins only within their school):
  - `POST /api/admin/users {fullName,email,role,schoolId?}` → `{user, temporaryPassword}`, sent with no-store.
  - `GET /api/admin/users/:id` returns the detail with student/teacher blocks and `canManage`.
  - `POST /:id/reset-password` → `{temporaryPassword}`, and every session is revoked.
  - `POST /:id/unlock`.
  - `GET /:id/sessions`, `DELETE /:id/sessions/:sid`, `POST /:id/sessions/revoke-all`.
  - `GET /:id/audit`.
  - `POST /:id/transfer-school {schoolId}` (super only).
  - `PATCH /api/admin/users/:id` takes `updateUserSchema` (strict). A cross-school `schoolId` returns 403; use transfer-school.
- Own sessions: `GET /api/auth/sessions` lists them, with `current` marking this one; `DELETE /api/auth/sessions/:sid` revokes one.
  - `POST /api/auth/change-password` now returns `{ok, user}` and clears `mustChangePassword`.
  - Errors: 403 `PASSWORD_CHANGE_REQUIRED` (any non-auth API while a change is pending) and 403 `SCHOOL_INACTIVE` (login, refresh or any request from a member of a suspended or archived school).
- Schools:
  - `GET/POST /api/admin/schools`. The list supports `q,status,region,type`, paging and counts.
  - `GET /api/admin/schools/:id` returns the counts, admins, usage and links.
  - `PATCH /:id`. School admins are limited to region, district, type, contact, levelKinds, programmeIds and settings.
  - `POST /:id/status {status,reason?}` (super).
  - `POST /:id/admins {userId}` and `DELETE /:id/admins/:userId`.
  - `GET/POST /:id/combinations`, `PATCH|DELETE /:id/combinations/:cid` and `POST …/:cid/archive|restore`.
- Structure, for `/api/config/{levels,academic-years,programmes,subjects,combinations}`:
  - `?archived=include|only`, `POST /reorder {ids}`, `POST /:id/archive|restore` and `GET /:id/references`.
  - `DELETE` needs platform:manage and returns 409 `IN_USE` with `details.references` while anything is referenced.
- Curriculum elements (documents:map or curriculum:manage):
  - `GET /api/curriculum/documents?subjectId`.
  - `GET /api/curriculum/nodes?documentId&archived&type` returns a depth-ordered tree with lesson counts.
  - `PATCH /nodes/:id {title,code,type,verified}`, `POST /nodes/reorder {ids}` (siblings only), `POST /nodes/:id/archive|restore` (cascading) and `DELETE /nodes/:id` (reference-checked).
  - `GET /versions` (replaced in Phase 5; see below).
- Classes (users:manage + class:manage; scoped to the caller's school):
  - `GET/POST /api/admin/classes` and `GET /classes/export.csv` (same filters).
  - `POST /classes/rollover {fromAcademicYearId,toAcademicYearId,dryRun}`.
  - `GET|PATCH|DELETE /classes/:id`. PATCH takes `archived` to archive or restore; DELETE returns 409 IN_USE while students or assessments exist.
  - `POST /classes/:id/teachers {teacherId}` and `DELETE /classes/:id/teachers/:teacherId`.
  - `GET /classes/:id/candidates?q`, `POST /classes/:id/students {userIds}`, `DELETE /classes/:id/students/:userId` and `POST /classes/:id/transfer {userIds,toClassId}`.
- Enrolment import:
  - `GET /api/admin/imports/enrolments/template.csv`.
  - `POST /api/admin/imports/enrolments {csv,filename?,schoolId?,createMissingStudents?,createMissingClasses?}` creates a preview batch.
  - `GET /api/admin/imports` and `GET /imports/:id`; `GET /imports/:id/errors.csv`.
  - `POST /imports/:id/commit {skipErrors?}` → `{batch, credentials}`, sent with no-store. Possible errors: 409 PREVIEW_STALE, 422 IMPORT_HAS_ERRORS, 422 NOTHING_TO_IMPORT.
  - `POST /imports/:id/rollback` and `POST /imports/:id/cancel`.

## Curriculum Management and Learner Manuals (Phase 5, Oct 2026)
- Curriculum versions (`/api/curriculum/versions`):
  - Reads: `GET /` (list with `q,status,levelId`, paging and counts) is open to documents:map, curriculum:manage, documents:upload and content:review. `GET /:id` returns `{version, subjects, documents, counts, documentsByStatus, elementsByType}`.
  - Writes need curriculum:manage:
    - `POST /` creates a draft (409 duplicate code; 422 validation).
    - `PATCH /:id` returns 409 if the version is archived. A code change is mirrored to linked subjects and documents.
    - `POST /:id/activate|archive|restore`. Archive returns 409 IN_USE while active subjects use the version.
    - `POST /:id/subjects {subjectIds}`.
    - `DELETE /:id` works for drafts only and is reference-checked.
  - `GET /api/curriculum/documents?subjectId|curriculumVersionId`.
  - `/api/config/subjects` accepts `curriculumVersionId`; archived versions give 409.
- Documents (`/api/documents`):
  - `GET /` takes `q,sort,page,pageSize` plus `processingStatus` (comma list), `mappingStatus`, `approvalStatus`, `docType`, `subjectId`, `levelId`, `curriculumVersionId`, `licensingStatus`, `ocrStatus`, `fileKind`, `tag`, `archived=false|true|all`, `versions=current|all` and `duplicates=hide|include|only`.
  - `GET /upload-limits` → `{maxMB, quotaMB, leftMB, formats}`; `POST /check-duplicate {sha256}` → `{duplicate}`. Both need documents:upload.
  - `POST /upload` (multipart, documents:upload). Fields come from `manualMetaSchema`, plus `allowDuplicate`. Errors: 413 FILE_TOO_LARGE, 415 UNSUPPORTED_FILE, 422 ENCRYPTED_PDF, 409 DUPLICATE_DOCUMENT `{existingId}`, 507 STORAGE_QUOTA.
  - `GET /:id` → `{document, nodes, jobs, duplicates, chunkStats, pageStats, versions[{…, current, generated}], generated, permissions}`.
  - `GET /:id/extraction` → `{unit, ocrStatus, processingStatus, report, pages[{page, method, charCount, figures, ocrConfidence}]}`.
  - `GET /:id/file` serves the file inline. `?download=1` needs an open licence or curriculum:manage (otherwise 403 DOWNLOAD_NOT_PERMITTED) and is audited.
  - `PATCH /:id`: metadata needs documents:map and `approvalStatus` needs content:review. Archived documents give 409.
  - `POST /:id/process` gives 409 when the document is archived, a duplicate, superseded (SUPERSEDED) or already queued.
  - `POST /:id/archive|restore {reason?}` (documents:map).
  - `DELETE /:id` (platform:manage) → 204. It is refused with 409 for a superseded version, while the document is processing, or while lessons, resources, questions or duplicates refer to it (IN_USE). It frees the GridFS file when nothing else shares it, and deleting a current replacement makes the previous version current again.
  - `POST /:id/replace` (multipart, documents:upload) → 201 `{document, previousId, jobId}`; 409 SAME_FILE or DUPLICATE_DOCUMENT.

## Document Processing Monitor (Phase 6 admin, Oct 2026)

All under `/api/jobs`, authenticated. View, inspect, retry and cancel need `system:health` or `curriculum:manage`; purge needs `system:health`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/jobs` | `document.process` jobs. Query: `page`, `pageSize` (≤100), `sort` (`createdAt`, `finishedAt`, `attempts`, `-` for descending), `status` (`queued`, `extracting`, `ocr`, `mapping`, `indexing`, `awaiting_validation`, `completed`, `failed`, `cancelled`), `subjectId`, `documentId`, `q` (title terms or a job id), `from`, `to` (a date-only `to` includes that day), `retries=only`. Returns `{ items, total, page, pageSize, pages, counts, statuses }`. Items: `id, status, label, queueStatus, step, progress ({current,total,unit} or null), waitingForRetry, nextAttemptAt, stalled, document {id,title,subject,approvalStatus,mappingStatus,...}, uploader, createdAt, startedAt, finishedAt, pagesProcessed, stageStatus {extraction, ocr, indexing}, error {message, stage, at}, attempts, maxAttempts, retries, retryOf`. |
| GET | `/api/jobs/health` | db, counts, oldestQueued, stalledRunning, last24h, lastSuccessAt, worker heartbeat (answering instance), providers, storage, warnings |
| GET | `/api/jobs/:id` | Inspector: `job` (row plus `stages`, full `errorLog`, `result`, `failedStage`, `lease`), `retryChain {previous, next}`, `storedOutput {pages, passages, embeddings}`, `documentReport`, `actions {retry, cancel}` with reasons |
| POST | `/api/jobs/:id/retry` | 202 `{ jobId, documentId }`. 409 `NOT_RETRYABLE` unless the job is failed or cancelled, is the manual's current job, no other run is queued or running, and the manual is not archived, superseded or a duplicate. Audited (`job.retry`). |
| POST | `/api/jobs/:id/cancel` | Queued jobs only (409 `NOT_CANCELLABLE` otherwise). Returns `{ cancelled, documentStatus }`. Audited. |
| POST | `/api/jobs/purge` | `{ olderThanDays: 1..3650, dryRun?: true }` returns `{ matched, deleted, dryRun, cutoff }`. Never deletes a manual's or lesson's current job. Audited when not a dry run. |

## Phase 9 (Oct 2026): analytics, AI usage, notifications, audit

**Learning Analytics** (`analytics:view`; scope enforced on the server)
- `GET /api/analytics/filters`: filter options for your scope, the reports you can see, and `canSeeStudents`.
- `GET /api/analytics/reports?schoolId&academicYearId&classId&levelId&programmeId&subjectId&topic&from&to&showSmallGroups&reports=a,b`
  - Returns `{ scope, filters, minGroup, reports: [{ key, title, kind: measured|estimate|suggestion|ai, description, method, columns, rows, summary?, chart?, suppressedRows? }] }`.
  - `reports=students_support` is the student-level report: Super/School Admin only, and audited.
  - `showSmallGroups` is for Super/School Admin only.
- `GET /api/analytics/reports/:key/export?format=csv|xlsx&…filters`: audited as `report.export`.
- `POST /api/analytics/recommendations` (body: the same filters): an AI recommendation from aggregated data. Costs 1 AI request and is subject to AI limits.
- `POST /api/resources/:id/complete` `{ completed?: boolean }` (learner): mark a lesson as completed. `GET /api/resources/:id` now also returns `progress` for learners.

**AI Usage and Costs** (`/api/admin/ai`)
- `GET /usage?from&to&schoolId&provider&feature&status` and `GET /usage/export?report=byFeature|byProvider|bySchool|byUser|daily|failures&format=csv|xlsx`: `analytics:view` or `system:health`, scoped by role. Exports are audited.
- `GET /settings` (`platform:manage` or `system:health`): settings, defaults, features, providers and secrets (set or not set only). `PATCH /settings` (`platform:manage`, strict): only the keys you send are changed. Audited as `ai_config.update`.
- `GET /health`, `POST /health { capabilities?: [llm|embeddings|ocr|image|vector_search|object_storage] }`: real checks, stored and audited.

**Notifications**
- `GET /api/notifications`, `POST /api/notifications/read`.
- `GET|PUT /api/notifications/preferences` `{ categories: { <category>: { inApp, email } } }`: partial updates are allowed; security in-app is mandatory.
- `/api/announcements` (`users:manage`):
  - `GET /` (status filter, paged), `POST /preview-audience`, `POST /`, `GET /:id` (with delivery stats), `GET /:id/recipients`, `PATCH /:id`, `POST /:id/publish` (202; scheduled when `publishAt` is in the future), `POST /:id/withdraw`, `DELETE /:id` (drafts only).
  - `POST /review-reminders` requires `content:review`.
  - Errors: 422 `PERSONAL_DATA` for personal data in the text; 403 when a school admin targets system scope or another school.

**Audit**
- `GET /api/admin/audit?action&actor&outcome&entityType&target&from&to&requestId&page&pageSize` (`audit:view`) also returns `actions` and `entityTypes`.
- `GET /api/admin/audit/export?format=csv|xlsx&…filters`: audited. `GET /api/admin/audit.csv` remains available as an alias.

## Phase 10 (Oct 2026): System settings, retention, AI model selection
- **Public:**
  - `GET /api/settings/public` returns branding (appName, tagline, logo, supportEmail), theme (preset and colours), maintenance (`enabled`, message, until), effective feature flags, the offline policy and the legal status (version, updatedAt, terms/privacy present).
  - `GET /api/settings/legal/:kind` (`terms` or `privacy`) returns `{ text, version, updatedAt, appName }`.
- **`/api/admin/settings`** (read: `platform:manage` or `system:health`; write: `platform:manage`):
  - `GET /` returns:
    - `settings` (the 11 stored sections), `defaults`, `version`, `updatedAt`, `updatedBy`, `legal`
    - `limits` (env ceilings, email configured), `themes`, `features`
    - `academic` (years and levels), `review` (fixed rules)
    - an `ai` summary, the `retention` preview and `canEdit`
  - `PATCH /` takes `{ <section>: { partial fields }, confirm? }`. The schema is strict, and errors return 422.
    - High-impact changes without `confirm` return `409 CONFIRM_REQUIRED` with `details.changes[{key, reason}]`.
    - Credential-like values return `422 SECRET_REJECTED`.
    - Success returns `{ settings, changed, version }`.
  - `POST /check` takes the same body and returns `{ changes, changed }` without saving.
  - `POST /academic-year` takes `{ yearId, confirm? }` and makes that year current (confirmation required).
  - `GET /retention` returns `{ preview: { notifications|aiUsage|aiHealthChecks|aiAlerts|jobs|tutorConversations|auditLogs: { days, due } } }`.
  - `POST /retention/run` takes `{ confirm? }`, runs the purge now and returns `{ deleted }`.
- **Sections and their limits:**

  | Section | Fields and limits |
  |---|---|
  | branding | appName (2–40), tagline (0–120), logo (PNG/JPEG/WebP data URI up to 150 KB, or null), supportEmail |
  | theme | preset: green, blue, teal, purple or maroon |
  | review | remindersEnabled, reminderAfterHours (4–336) |
  | uploads | maxUploadMb (1–`UPLOAD_MAX_MB`), formats (subset of pdf, docx, txt, csv), ocrEnabled, ocrMaxPages (1–`OCR_MAX_PAGES`) |
  | notifications | emailEnabled, announcementMaxDays (1–365) |
  | retention | notificationDays (30–1825), aiUsageDays (90–1825), jobDays (7–730), auditDays (365–3650), tutorDays (7–730), purgeEnabled |
  | sessions | accessMinutes (5–60), sessionDays (1–60), lockoutAttempts (3–20), lockoutMinutes (5–240) |
  | offline | bundleEnabled, saveLessonsEnabled, bundleMaxResources (5–500) |
  | features | selfRegistration, tutor, practice, games, meetings, assessments |
  | maintenance | enabled, message (0–300), until (date or null) |
  | legal | terms, privacy (up to 30,000 characters each) |

- **New errors:**
  - `503 MAINTENANCE` (with `details.until`)
  - `403 FEATURE_DISABLED`
  - `409 CONFIRM_REQUIRED`
  - `422 SECRET_REJECTED`
- **AI (§17):**
  - `GET /api/admin/ai/models` returns `{ provider, available, models[{id,label}], selected, defaultModel }`. The list is read from the provider's own model list (Gemini ListModels, which uses no generation quota).
  - `PATCH /api/admin/ai/settings` accepts `llmModel` (an id from that list, or null for the env/default model).
  - `GET /api/admin/ai/settings` adds `providerConfig[]`, one entry per capability (llm, embeddings, ocr, image, vector, storage), each with `{ provider, envVar, model, modelSource, modelEditable, note, keyVars }`.
- **Changed behaviour:**
  - `GET /api/documents/upload-limits` returns the stored limit and only the allowed formats, plus `ocr`.
  - The announcement period limit comes from `notifications.announcementMaxDays` (default 180).
  - Notification email delivery is recorded as `disabled` when email is switched off.
