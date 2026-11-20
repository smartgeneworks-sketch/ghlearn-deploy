# Roles & permissions. Source of truth: `shared/src/index.ts` (`ROLE_PERMISSIONS`)

| Permission | super_admin | school_admin | curriculum_admin | curriculum_editor | content_reviewer | system_operator | teacher | counselor | student | parent |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| platform:manage | ✔ |  |  |  |  |  |  |  |  |  |
| school:create | ✔ |  |  |  |  |  |  |  |  |  |
| school:manage | ✔ | ✔ |  |  |  |  |  |  |  |  |
| config:manage | ✔ | ✔ | ✔ |  |  |  |  |  |  |  |
| users:manage | ✔ | ✔ |  |  |  |  |  |  |  |  |
| documents:upload | ✔ | ✔ | ✔ | ✔ |  |  |  |  |  |  |
| documents:map | ✔ |  | ✔ | ✔ |  |  |  |  |  |  |
| content:edit | ✔ |  | ✔ | ✔ | ✔ |  |  |  |  |  |
| content:review | ✔ |  |  |  | ✔ |  |  |  |  |  |
| content:publish | ✔ |  |  |  | ✔ |  |  |  |  |  |
| class:manage | ✔ | ✔ |  |  |  |  | ✔ |  |  |  |
| activity:assign | ✔ |  |  |  |  |  | ✔ |  |  |  |
| progress:view_class | ✔ | ✔ |  |  |  |  | ✔ |  |  |  |
| progress:view_own | ✔ |  |  |  |  |  |  |  | ✔ |  |
| progress:view_child | ✔ |  |  |  |  |  |  |  |  | ✔ |
| learn:access | ✔ |  |  |  |  |  | ✔ |  | ✔ |  |
| tutor:use | ✔ |  |  |  |  |  | ✔ |  | ✔ |  |
| audit:view | ✔ | ✔ |  |  |  |  |  |  |  |  |
| analytics:view | ✔ | ✔ | ✔ |  | ✔ |  |  |  |  |  |
| meetings:request | ✔ |  |  |  |  |  |  |  | ✔ |  |
| meetings:host | ✔ |  |  |  |  |  | ✔ | ✔ |  |  |
| admin:access | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |  |  |  |  |
| roles:assign | ✔ | ✔ |  |  |  |  |  |  |  |  |
| curriculum:manage | ✔ |  | ✔ |  |  |  |  |  |  |  |
| system:health | ✔ |  |  |  |  | ✔ |  |  |  |  |

Generated from `ROLE_PERMISSIONS` (Admin Phase 2). Notes:
- **platform:manage**: deleting levels, Learning Areas, subjects, combinations and years (super only; prefer disabling).
- **curriculum:manage**: creating/editing levels, academic years, Learning Areas, subjects, combinations and verifying subjects (was `platform:manage`).
- **config:manage**: open the setup screens (read-only without `curriculum:manage`).
- **admin:access**: the admin panel shell and `GET /api/admin/overview` / `search`. Every section and endpoint still checks its own permission.
- **roles:assign**: scoped role grants (below). **system:health**: `GET /api/admin/system`.
- **curriculum_admin**: curriculum structure, manuals, mapping and generation; no learner data, users or audit. **system_operator**: health, queues and job failures only.

## Scoped role assignments (`RoleAssignment`, services/roles.ts)
- Platform roles (super_admin, curriculum_admin, curriculum_editor, content_reviewer, system_operator) have platform scope; school roles (school_admin, teacher, counselor, student, parent) are scoped to the user's school.
- Granting or revoking needs `roles:assign`. Nobody can change their own roles.
- Only a super admin grants or revokes platform roles or `school_admin`.
- A school admin grants or revokes teacher, counselor, student and parent, and only for users of their own school. No grant may carry an administrative permission the granter lacks.
- The last active super admin cannot be removed, and every user keeps at least one role.
- Each change rewrites the `User.roles` cache, revokes all of the user's sessions (refresh tokens plus `sessionsRevokedAt`, checked on every request), and writes an audit entry with the before and after roles.
- `PATCH /api/admin/users/:id {roles}` applies the same rules to each added or removed role.

## Resource-level rules (server-enforced, `middleware/index.ts`)
- **Subject content:** students need the subject in `StudentProfile.subjectIds`, teachers need a `TeacherAssignment`, and editors, reviewers and super admins always have access. Everyone else gets **403**. A nonexistent or malformed subject gives **404**.
- **Unpublished content:** visible only to editor, reviewer and super_admin. For other users, an unpublished resource returns **404**, which hides that it exists.
- **School scope:** school admins list and modify only users and students where `schoolId` matches their own. A user from another school returns 404. They cannot assign `super_admin`/`school_admin` and cannot move users across schools.
- **Suspension:** status is re-checked on every request, so a suspended user's access cookie stops working at once and all their refresh tokens are revoked.
- **Self-registration** always produces `student`, and any `roles` sent in the body are ignored.
- **Onboarding** runs once per student: required region (one of the 16 regions of Ghana), free-text school name (linked to a configured school when its normalised name matches), enabled level, optional Learning Area ∈ level, year range, and at least one subject. Students choose **any** core and elective subjects of their level (core ids must be core subjects, elective ids electives); there are no combination or elective-count limits. Students edit region, school name, year, Learning Area and subjects later via `PATCH /api/me/profile`; the new list is the authorisation list immediately (dropped subjects are denied again). Raw `subjectIds` or unknown keys are rejected (422).
- **Meetings:** a student's school = linked school, or the configured school whose normalised name matches the typed one (linked lazily). Students only see and book teachers/counselors whose `User.schoolId` is that school (others 404; unlinked students get 409 `NO_SCHOOL`). Only the two participants can read or act on a meeting (others 404). Hosts accept/decline/reschedule/cancel; students accept/decline a rescheduled time and cancel; students cannot reschedule (403). No double booking: a slot backs at most one active meeting (unique partial index, safe under concurrency), a host cannot hold overlapping confirmed meetings and a student cannot hold overlapping active ones (checked on request, accept and reschedule). Online meetings need an https link before confirmation. Both sides get in-app notifications. The `counselor` role is assignable by school admins (admin roles remain super-admin only).

- **Lessons:** staff only (content:edit / content:review); publishing needs content:publish and a different reviewer than the creator.
- **Tutor:** a student's own conversations only; subject access is re-checked on every message (403 after unenrolment).
- **Question bank:** staff see all statuses; teachers (activity:assign) read only *published* questions of subjects they are assigned to; students never call it (they get questions only inside attempts/games, without keys).
- **Attempts / game sessions:** owner only (404 for anyone else). Creating one needs enrolment in the subject.
- **Assessments, results, marking:** the teacher needs a `TeacherAssignment` for the same school *and* subject (404 otherwise). Students see assessments for their own school, year and subjects only.
- **Progress:** students see their own (enrolled subjects only); teachers see students of their own school and assigned subject/year; super_admin can pass `schoolId`.
- **Leaderboard settings:** school:manage for one's own school only.

Covered by `server/test/access.test.ts`, `onboarding.test.ts`, `tutor.test.ts`, `lessons.test.ts` and `assess.test.ts`.

## Phase 6
- New permission `analytics:view`: super_admin (platform), school_admin (own school, forced), content_reviewer (content/AI only; no learner data).
- Classes: teacher sees/edits only classes where they are a teacher; must be assigned to the class subject at that school; members must be students of the school enrolled in the subject. School admin: all classes of own school. Others: 404.
- Class-targeted assessments are invisible/unstartable for non-members (404).
- Reports/exports follow the same class/assessment scoping and are audited.
- Offline pack: subject access rule; published content only.
- Notifications: owner only. Audit log: school admins see their school's actors only.
