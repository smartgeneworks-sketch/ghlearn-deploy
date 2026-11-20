# Teacher workspace, analytics, audit, notifications (Phase 6, spec §12–13)

## Teacher workspace (`/teach`)
- **Classes / class groups** (`classgroups`): name, subject, year, teachers (co-teaching), students. A teacher can only create classes for subjects they are assigned to (TeacherAssignment) at their school; every student must be at that school and enrolled in the subject. School admins manage all classes of their school. Archive/restore.
- **Assignments with deadlines**: `POST /api/assessments` takes `classId`; only class members see/start it (also enforced in `assessmentFor`). Without `classId` it targets the whole subject year (previous behaviour). Students are notified.
- **Submissions review / subjective marking**: results per assessment (+ CSV export); written answers go to the marking queue (AI-provisional, teacher-verified) as in Phase 5; teachers are notified when written work arrives, students when final marks are in.
- **Class view** tabs: Students, Needs support, Misconceptions, Topics (+ remedial), Assignments, Members. **Individual view**: mastery by topic, attempts, repeated mistakes.
- **Needs support** (rules, shown to the teacher): overall mastery < 50% after ≥ 5 answers; last attempts averaging < 40%; an overdue assignment not submitted; no practice for 14 days.
- **Common misconceptions**: questions answered wrongly in ≥ 40% of ≥ 2 marked responses, with the most common wrong answers (MCQ answers resolved through the per-attempt option permutation back to option text; short/numerical/gap-fill answers normalized) and the correct answer.
- **Remedial recommendations**: topics where students are below 60%, with names; one click creates a remedial assignment (easiest-first published questions on that topic, 3 attempts) for the class.
- **Reports**: class CSV and PDF (`pdfkit`, A4) and assessment results CSV. CSV cells are escaped and formula-prefixed (`=`, `+`, `-`, `@`) to stop spreadsheet injection. Every export is audited (`report.export`).
- **Offline download**: `/api/offline/:subjectId` returns one self-contained HTML file with every **published** lesson/resource for a subject (drafts never included). All text is escaped; only server-rendered diagram SVG is embedded; the file carries a `default-src 'none'` CSP. Available to anyone with subject access (students too, from the subject page).

## Admin analytics (`/admin/analytics`, permission `analytics:view`)
Filters: school, level, class, subject, topic, date range (default last 30 days). Scope decided on the server:

| Role | Scope | Sections |
|---|---|---|
| super_admin | platform | users, active, enrolment, content pipeline, tutor, exercises, topics, engagement, AI usage/cost, storage, health |
| school_admin | own school (forced; other school/class → 403) | users, active, enrolment, approved content counts, tutor, exercises, topics, engagement, AI usage of own users |
| content_reviewer | content (school/class filters → 403) | content pipeline, AI usage |

Teachers use class views instead. Metrics: users by role/status, active students (practice, games, tutor in range) and teachers (login or audited action), enrolment by subject/year, manuals and processing success/failure, jobs by type/status, lessons generated, pending reviews, published resources/questions, tutor questions/users/answer types/helpful %, exercise start/completion by mode, assignments and submissions, games, performance by topic (mastery), engagement per day (XP-earning learning events, not screen time), AI requests/tokens/errors with **estimated** cost (`AI_COST_INPUT_PER_M`, `AI_COST_OUTPUT_PER_M`; free tier bills $0) and today vs `LLM_DAILY_REQUEST_BUDGET`, storage (data/index/GridFS vs 512 MB), health (DB ping, queue, dead jobs, AI errors, recent job errors).

## Audit log (`/admin/audit`)
Filter by action prefix, actor name/email, date; paginated; CSV export. School admins only see actions by users of their school.

## Notifications
In-app (`notifications`, 90-day TTL), bell with unread count in the header, `/notifications` page; owner-only read/mark. Events: new assignment / remedial practice (students), written work to mark (teachers of that subject+school), final marks (student), lesson submitted for review (reviewers), review decision (author), user-started job finished/failed (manual processing, lesson/section generation, question generation). No email/SMS provider yet.
