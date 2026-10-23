import type { Model } from 'mongoose';
import * as M from '../models/index.js';
import { AppError } from '../lib/errors.js';

/** What refers to each academic-structure entity (spec §8: never delete what active resources still use). */
const REFS: Record<string, [Model<any>, string, string][]> = {
  levels: [[M.Programme, 'levelId', 'Learning Areas'], [M.Subject, 'levelId', 'subjects'], [M.StudentProfile, 'levelId', 'student profiles'], [M.CurriculumDocument, 'levelId', 'documents'], [M.Lesson, 'levelId', 'lessons']],
  programmes: [[M.Subject, 'programmeIds', 'subjects'], [M.SubjectCombination, 'programmeId', 'combinations'], [M.StudentProfile, 'programmeId', 'student profiles'], [M.CurriculumDocument, 'programmeId', 'documents'], [M.School, 'programmeIds', 'schools'], [M.ClassGroup, 'programmeId', 'classes']],
  subjects: [[M.StudentProfile, 'subjectIds', 'student profiles'], [M.TeacherAssignment, 'subjectId', 'teacher assignments'], [M.ClassGroup, 'subjectId', 'classes'], [M.CurriculumDocument, 'subjectId', 'documents'],
    [M.Lesson, 'subjectId', 'lessons'], [M.Question, 'subjectId', 'questions'], [M.Assessment, 'subjectId', 'assessments'], [M.LearningResource, 'subjectId', 'learning resources'], [M.SubjectCombination, 'subjectIds', 'combinations'], [M.Attempt, 'subjectId', 'attempts']],
  combinations: [[M.StudentProfile, 'combinationId', 'student profiles']],
  'academic-years': [[M.ClassGroup, 'academicYearId', 'classes']],
  schools: [[M.User, 'schoolId', 'users'], [M.StudentProfile, 'schoolId', 'student profiles'], [M.ClassGroup, 'schoolId', 'classes'], [M.TeacherAssignment, 'schoolId', 'teacher assignments'], [M.Assessment, 'schoolId', 'assessments'], [M.SubjectCombination, 'schoolId', 'combinations']],
  versions: [[M.Subject, 'curriculumVersionId', 'subjects'], [M.CurriculumDocument, 'curriculumVersionId', 'documents'], [M.CurriculumNode, 'curriculumVersionId', 'curriculum elements']],
  nodes: [[M.Lesson, 'nodeId', 'lessons'], [M.CurriculumNode, 'parentId', 'child elements']],
};
export interface Ref { label: string; count: number }
export async function referencesOf(kind: keyof typeof REFS | string, id: unknown): Promise<Ref[]> {
  const rows = await Promise.all((REFS[kind] ?? []).map(async ([m, field, label]) => ({ label, count: await m.countDocuments({ [field]: id }) })));
  return rows.filter((r) => r.count > 0);
}
export const refError = (refs: Ref[]) => new AppError(409, 'IN_USE', `Still in use by ${refs.map((r) => `${r.count} ${r.label}`).join(', ')}. Archive it instead, or remove those links first.`, { references: refs });
