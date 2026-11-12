# Curriculum-to-Learning System spec (owner brief, 2026-10-22, condensed faithfully)

Role: AI Curriculum Manager, Instructional Designer, Subject Teacher, Content Developer and LMS Admin for ghlearn.com. Turn a selected subject's curriculum + learner's manual (LM) into a structured, engaging, curriculum-aligned self-paced learning experience. Admin keeps full control (review, edit, unpublish, remove later). "Act on those that are necessary": reuse what exists.

## 2 Curriculum & LM management
When admin selects/adds a subject: identify the right curriculum + LM for subject, class/year, version; search uploaded docs/approved repository; if missing, notify admin and request it — never invent or pretend. Read/analyse before generating. Extract: subject name/description, class/year, academic year & version, strands, sub-strands, topics/subtopics, indicators/objectives, concepts/skills/competencies, suggested activities/exercises/examples/assessments. Preserve sequence, terminology, expectations. Map every topic/note to curriculum ref + LM section. LM is the primary instructional reference; supplementary explanation must not contradict it or add requirements.

## 3 Automatic subject creation (student "My Subject")
Each subject: title, thumbnail/cover, short description, class/year, curriculum version, # strands & topics, # modules, progress indicator, estimated total learning time, "Continue Learning". Clicking opens a subject dashboard with topics in curriculum order. Students see only subjects for their class/curriculum/enrolment unless admin changes permissions.

## 4 Topic extraction
Hierarchy: Subject → Strand → Sub-strand → Topic → Learning Module → Lesson Notes → Activities & Assessment. Use the actual curriculum (examples are not exhaustive). Topic record: title, number/sequence, parent strand/sub-strand, objectives, indicators, LM chapter/page/section where available, notes, thumbnail, reading time, prerequisites, completion requirements, knowledge-check questions. No duplicates; no silent omissions.

## 5 Thumbnail module cards ("Learning Resources" grid)
Card: relevant educational thumbnail, title, short intro, strand/sub-strand label, reading time, objective/outcome, status (Not Started / In Progress / Completed), Start/Continue button linking to content. Age-appropriate, relevant (no irrelevant stock), consistent dimensions, alt text, optimized images, responsive.

## 6 Teachers' notes per topic (student-friendly, detailed enough for independent study)
Sections as appropriate: A Introduction; B Objectives; C Key concepts & definitions; D Detailed step-by-step explanations; E Worked examples (maths: full working, formulas, substitutions, answers); F Illustrations/visuals (diagrams, charts, tables, maps); G Practical applications (Ghanaian context); H Common mistakes; I Summary; J Key terms; K Practice activities; L Knowledge check with answers/explanations; M Further learning. Adapt to subject.

## 7 Strict LM alignment (mandatory)
Identify the LM section first; use it as the source of concepts, scope, terminology, sequence. Per note: record source doc + chapter/page range/section; align to objectives; preserve definitions; only accurate consistent examples; never invent facts, formulas, indicators, references or page numbers; flag gaps/ambiguities/contradictions for admin; flag insufficient source rather than fabricate. Keep a source-mapping record per lesson.

## 8 Reading time
Configurable wpm (start ~150–180 wpm prose) plus extra for worked examples, diagrams, formulas, activities; computed from actual content. Show e.g. "Reading time: 8 min", "Reading and examples: 12 min", "Lesson and practice: 20 min". Distinguish reading vs total learning time. No uniform arbitrary values.

## 9 Progression & completion
Flow: My Subject → subject → module → read notes → examples → knowledge check/activity (if enabled) → mark complete / auto-record → next topic. Configurable rules: default sequential lock; admin can switch to free navigation or prerequisite-based. Track: opened, time spent, reading progress, check score, status, completion date, last accessed module, overall subject progress — from real interactions (opening ≠ read). Reading time guides, never forces dwell; combine completion with a short comprehension check where appropriate.

## 10 AI review & automatic publication
Workflow: Select Subject → Load Curriculum & Manual → Extract Topics → Generate Modules → Write Notes → Validate → Publish to Student Portal → Admin Review Later.
Validate: curriculum alignment, LM fidelity, completeness vs objectives, factual/conceptual accuracy, maths correctness (verify programmatically where possible), language/reading level, example quality, formulas/calcs/diagrams/answer keys, duplicates, broken images/links, reading time, source traceability, activities/assessment quality.
Pass → mark "AI-Approved" and publish automatically WITHOUT owner manual approval. Critical failure / unresolved contradiction / missing source / low confidence → do not publish; flag. "AI-Approved" means configured checks passed — never presented as human expert review.
Admin can: edit notes, correct errors, replace thumbnails, change reading time, reorder topics, unpublish/archive, restore earlier version, regenerate from updated source, publish revision, view sources, see generated/validated/published timestamps. Version history + audit log of AI and admin actions.

## 11 Admin dashboard (RBAC protected)
Subject Management (add/edit/activate/deactivate/archive; assign to classes/years; select curriculum & LM; update versions). Curriculum Import (upload PDF/DOCX; upload LM; preview extraction; inspect errors and mappings). AI Content Generation (generate topics; notes for one topic / strand / whole subject; regenerate single lessons; progress & validation results). Content Publishing (AI-approved, published/unpublished, needs attention, publish/edit/unpublish/restore, dates, versions). Quality Assurance (validation reports, missing topics, unsupported claims, indicator coverage, sources, flags). Student Analytics (enrolment, completion, progress by subject/topic, difficult topics from assessments, participation/completion reports). Only authorized admins alter sources, approve exceptions, change publication/progression settings.

## 12 Data
Extend existing models (no disconnected app): subjects, curriculum versions, curriculum documents, LMs, strands/sub-strands, topics/objectives, modules, lesson notes, source references, thumbnails/resources, validation reports, publication status, version history, enrolment, progress, knowledge checks/results, audit logs. Stable module ids linked to subject, topic, curriculum source, LM. Indexes, access controls, validation, backups. Inspect and reuse existing models/auth/roles/design/publishing first. Never overwrite production content or duplicate an existing subject.

## 13 Student portal
Existing design system. "My Subject" dashboard, subject cards, strand/topic navigation, thumbnail modules, clean reading view, good typography, tables/formulas/diagrams, progress indicators, reading & learning times, knowledge checks, prev/next, subject completion indicator, mobile-friendly, low-bandwidth friendly, alt text.

## 14 Operational rules
1 Never generate a full lesson from a title alone when the LM is available. 2 Never invent missing curriculum/LM. 3 Never omit a topic without recording/reporting why. 4 Never silently change sequence. 5 Never publish content failing critical checks. 6 Never require owner approval for lessons passing validation. 7 AI-published content always editable/unpublishable/restorable. 8 Never overwrite a lesson without keeping the prior version. 9 Never expose unpublished sources or admin functions to students. 10 Never claim publication unless it succeeded. 11 Record generation failures with actionable errors. 12 Simple for students, full control for admin.

## 15 Implementation order
Inspect existing stack, DB, auth, student portal, admin, CMS → identify reusable parts → propose changes → curriculum import & analysis → topic extraction & modules → LM-grounded note generation → thumbnails & reading time → validation, auto-publish, rollback → progression & analytics → test end to end with a real subject → verify My Subject and Learning Resources → AI-approved lessons visible to correct students → admin edit/unpublish/restore → test auth, permissions, performance, errors, integrity. Don't rebuild the site. No secrets client-side; AI/doc/validation/publication server-side.

## 16 Acceptance test (Mathematics first, if real curriculum + LM available)
Admin selects/adds Mathematics → correct curriculum & LM identified → topics extracted in prescribed order → topics under My Subject → each topic a thumbnail module under Learning Resources → detailed accurate LM-grounded notes → objectives, explanations, examples, illustrations, summaries, practice → realistic reading time → validation + source refs recorded → passing lessons AI-Approved and auto-published → failing ones withheld/flagged → students read, do activities, progress per rules → progress recorded accurately → admin can review/edit/unpublish/regenerate/restore → existing functionality and data intact.
