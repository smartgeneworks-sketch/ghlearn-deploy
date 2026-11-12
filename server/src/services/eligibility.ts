/**
 * Who may see published content (spec §12): subject access is checked by the callers (enrolment / assignment);
 * this adds the audience chosen at publish time: roles, level, year of study, programme and institution.
 * A missing or empty restriction means "no restriction". Content staff see everything they manage.
 */
import mongoose from 'mongoose';
import { StudentProfile, TeacherAssignment, User } from '../models/index.js';
import { canSeeUnpublished, type AuthCtx } from '../middleware/index.js';

const anyOrNone = (path: string, value: unknown) => ({ $or: [{ [path]: { $exists: false } }, { [path]: { $size: 0 } }, { [path]: value }] });
const scalarOrNone = (path: string, value: unknown) => ({ $or: [{ [path]: null }, ...(value != null ? [{ [path]: value }] : [])] });
const NOTHING = { _id: { $exists: false } };

/** Mongo filter (for LearningResource) of published items this user may see. */
export async function audienceFilter(auth: AuthCtx): Promise<Record<string, unknown>> {
  if (canSeeUnpublished(auth)) return {};
  if (auth.roles.includes('student')) return studentAudience(auth.userId);
  if (auth.roles.includes('teacher')) {
    const schools = [...new Set([...(await TeacherAssignment.distinct('schoolId', { teacherId: auth.userId })).map(String), ...(auth.schoolId ? [auth.schoolId] : [])])].map((x) => new mongoose.Types.ObjectId(x));
    return { $and: [anyOrNone('audience.roles', 'teacher'), { $or: [{ 'audience.schoolIds': { $exists: false } }, { 'audience.schoolIds': { $size: 0 } }, { 'audience.schoolIds': { $in: schools } }] }] };
  }
  return NOTHING;
}
export async function studentAudience(userId: string): Promise<Record<string, unknown>> {
  // Only learners are narrowed here; staff and teachers reaching these paths are already limited by subject access.
  if (!(await User.exists({ _id: userId, roles: 'student' }))) return {};
  const p = await StudentProfile.findOne({ userId }).select('levelId yearOfStudy programmeId schoolId').lean();
  return { $and: [anyOrNone('audience.roles', 'student'), scalarOrNone('audience.levelId', p?.levelId ?? null), scalarOrNone('audience.yearOfStudy', p?.yearOfStudy ?? null),
    anyOrNone('audience.programmeIds', p?.programmeId ?? null), anyOrNone('audience.schoolIds', p?.schoolId ?? null)] };
}
