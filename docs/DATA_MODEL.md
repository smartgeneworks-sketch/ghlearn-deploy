# Data model (MongoDB / Mongoose). Source: `server/src/models/index.ts`
All collections have `createdAt/updatedAt`. Seeded rows carry `isSample: true` (indexed) and "(Sample)" names, and can be removed with `npm run seed -- --reset-sample`.

| Collection | Key fields | Indexes / notes |
|---|---|---|
| users | email (unique, lowercase), passwordHash (select:false), fullName, roles[], schoolId, status(active/suspended/pending), failedLogins, lockedUntil, consent{termsAcceptedAt, guardianConsentAt}, dateOfBirth?, guardianEmail? | email unique, schoolId |
| refreshtokens | userId, tokenHash (sha256, unique), family, expiresAt, revokedAt, replacedBy, userAgent, ip | TTL on expiresAt |
| schools | name, code (unique), region, district, levelKinds[SHS/JHS], active | |
| academiclevels | kind (SHS/JHS), name (unique), years, enabled | JHS seeded disabled |
| academicyears | label (YYYY/YYYY, unique), startDate, endDate, current | |
| programmes (UI: **Learning Areas**) | name, code (unique), levelId | |
| subjects | name, code (unique), levelId, category(core/elective), programmeIds[], curriculumVersion, active | levelId |
| subjectcombinations (UI: suggested combinations; not enforced) | name, programmeId, subjectIds[], minElectives, maxElectives | programmeId |
| studentprofiles | userId (unique), schoolId (optional link), schoolName (as typed), schoolNameKey (normalised), region (16 regions), levelId, programmeId (Learning Area), combinationId (legacy), yearOfStudy, **subjectIds[] (the authorisation list)**, preferredLanguage, learningPreferences[], onboardedAt | subjectIds |
| teacherassignments | teacherId, schoolId, subjectId, classGroup, yearOfStudy | teacherId |
| curriculumdocuments | title, subjectId, levelId, yearOfStudy, docType, provenance{sourceUrl, publisher, retrievedAt, checksum, driveFileId}, approvalStatus(unverified/verified_official/rejected), processingStatus | rule 20: provenance and approval are recorded |
| learningresources | title, kind(notes/exercise/quiz/game/revision), subjectId, yearOfStudy, strand, subStrand, indicator, topic, sourceDocumentId, sourcePages[], status(draft/in_review/approved/published/archived), aiGenerated, body | subjectId, status |
| auditlogs | actorId, action, target, meta, ip, createdAt | |

## Phase 3 collections
| Collection | Key fields |
|---|---|
| curriculumdocuments (extended) | originalFilename, sizeBytes, pageCount, docType, audience, programmeId, curriculumVersion, sourceMeta, provenance{sourceUrl, publisher, retrievedAt, checksum(sha256, indexed), driveFileId, importBatch, uploadedVia}, storage{provider gridfs/drive/remote, key}, duplicateOf, approvalStatus, mappingStatus(unmapped/suggested/confirmed), processingStatus, processingReport, lastJobId, mappedBy, approvedBy |
| documentpages | documentId+page (unique), text, method(text/ocr/empty/ocr_unavailable), charCount, ocrConfidence |
| curriculumnodes | documentId, subjectId, type(section/strand/subStrand/contentStandard/indicator/topic), code, title, page, order, parentId, detection{rule, confidence explicit_label/pattern/manual, line}, verified, verifiedBy |
| chunks | documentId, subjectId, ordinal, pageStart, pageEnd, nodeIds, headingPath, text, charCount, embedding (select:false), embeddingModel, embeddingStatus(pending/disabled/done/failed/test_only) |
| jobs | type, payload, status(queued/running/succeeded/failed/dead/cancelled), attempts, maxAttempts, runAt, lockedUntil, lockedBy, progress{step,pct}, result, errorLog[], createdBy |
| uploads.files / uploads.chunks | GridFS bucket for uploaded PDFs |

Atlas Vector Search index (to be created at deploy): `{ "fields": [{ "type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine" }, { "type": "filter", "path": "subjectId" }] }` on `chunks`.

## AI content (Phase 4)
- `aiusages`: one row per LLM/embedding call `{day, provider, model, purpose, userId, jobId, refId, inputTokens, outputTokens, thoughtTokens, latencyMs, status}`; daily budgets are computed from it.
- `lessons`: `{title, subjectId, levelId, yearOfStudy, topic, strand, subStrand, indicator, controls, sections[A-K]{key, kind, title, content(markdown), data, citations[{chunkId, documentId, pageStart, pageEnd}], sourceSupport}, validation{ok, errors, warnings}, status (generating|draft|in_review|changes_requested|approved|published|archived|failed), version, aiModel, sourceDocumentIds, createdBy, reviewedBy, publishedBy, resourceId}`. A (identification) and K (source references) are assembled by the server.
- `lessonversions` (`{lessonId, version}` unique snapshot of title + sections, reason, createdBy), `lessonreviews` (submit/approve/request_changes/publish/unpublish/comment log).
- Publishing upserts a `learningresources` row (`kind: notes`, `aiGenerated: true`, `body: {lessonId, version, sections, sourceDocuments}`).
- `tutorconversations` / `tutormessages`: `{role, content, mode, answerType (source|general|mixed|refusal|error), citations, aiModel, flags, feedback, expiresAt}`; TTL indexes delete them after `TUTOR_RETENTION_DAYS`.
- `subjects.provenance`: `{source, verified, categoryInferred, aliases, documentCount}` for subjects seeded from the curriculum index.

## Assessment, games, rewards (Phase 5)
- `questions`: `{subjectId, levelId, yearOfStudy, strand, topic, objective, type, difficulty, stem, data (type-specific answer key), rubric[{criterion, maxMarks, descriptors}], marks, explanation, hint, citations, sourceDocumentId, lessonId, status (draft|in_review|published|rejected|archived), validation, normStem, aiGenerated, aiModel, generationJobId, createdBy, reviewedBy}`. Index `{subjectId, status, topic, type}`. See ASSESSMENT.md for each type's `data`.
- `assessments`: teacher-set work or mock exams scoped to `{schoolId, subjectId, yearOfStudy?}` with `questionIds, timeLimitSec, randomize, maxAttempts, opensAt, closesAt, showAnswers`.
- `attempts`: `{userId, subjectId, schoolId, assessmentId?, mode, topic, seed, items[{questionId, perm}], responses[{response, score, maxScore, correct, feedback, explanation, improvement, revisionTopic, parts, criteria, markedBy (auto|ai_provisional|teacher|pending), needsReview, verifiedBy}], deadline, status (in_progress|submitted|pending_review|marked), score, maxScore, pct, provisional, revisionTopics}`. `perm` (option/order shuffles) stays server-side.
- `gamesessions`: `{userId, subjectId, game, topic, objective, items (with answer keys, never sent), answers, hintsUsed, deadline, score, maxScore, accuracy, xpAwarded, status}`.
- `xpevents`: idempotent XP ledger, unique `{userId, source, refId}`; `userrewards`: `{xp, level, streak{current, longest, lastDay}, badges[]}`; `masteries`: unique `{userId, subjectId, topic}` with EWMA `score`, counts and the last 20 results.
- `schools.settings.leaderboard`: `{enabled=false, anonymized=true, scope=year|school}`.

## Planned
- `classes` (teacher class groups beyond `TeacherAssignment.classGroup`), `guardianlinks`, per-curriculum-node mastery.

## Setup
- Dev and tests: no DB needed. With `MONGODB_URI` unset, the server starts an in-memory MongoDB (`mongodb-memory-server`, cached binary 8.2.6), and `SEED_ON_START=true` loads sample data.
- Real DB: `MONGODB_URI=... npm run seed`. Indexes are synced on boot (`syncIndexes`).
- Backups: Atlas M0 has no automated backups. Run `mongodump --uri "$MONGODB_URI" --archive=ghlearn-$(date +%F).gz --gzip` on a schedule (see DEPLOYMENT.md).

## Phase 6
- **classgroups**: schoolId, subjectId?, name, yearOfStudy?, teacherIds[], studentIds[], archived, createdBy.
- **assessments.classId** (optional): restricts an assignment to class members.
- **notifications**: userId, type (assignment.new, attempt.marked, marking.pending, review.requested, review.decision, job.finished, job.failed, system), title, body, link, readAt, meta, expiresAt (TTL 90 days).
| meetingslots | hostId, schoolId, start, end, modes[in_person/online], location, link | hostId+start |
| meetings | studentId, hostId, schoolId, slotId?, start, end, topic, mode, link, location, note, status(pending/awaiting_student/confirmed/declined/cancelled), active, history[] | unique slotId where active; hostId+start; studentId+start |

## Admin panel (Phase 2)
- **AuditLog** (append-only) adds `requestId`, `entityType`, `outcome` (success/failure/denied), `schoolId`, `before`, `after` (changed keys only) and indexes on `createdAt`, `action+createdAt` and `actorId+createdAt`. Query and document update/delete hooks throw unless `{ maintenance: true }` is passed (used only by test resets and `seed --reset-sample`). `lib/audit.ts` redacts keys that look like passwords, tokens, secrets, keys, hashes or cookies.
- **RoleAssignment** `{userId, role, scopeType: platform|school, scopeId?, grantedBy}`, unique on `userId+role+scopeType+scopeId`. `User.roles` is the cache read on each request. Bootstrap backfills assignments idempotently.
- **User.sessionsRevokedAt**: access tokens issued before this time are rejected.
