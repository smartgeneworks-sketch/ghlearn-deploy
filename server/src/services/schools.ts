import { School, StudentProfile, User } from '../models/index.js';

/** Normalised school name used to match free-text names: drops "(…)" notes, punctuation, case and "senior high school" wording. */
export function schoolNameKey(name: string) {
  return name.normalize('NFKC').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\bsenior high (technical )?school\b/g, (_m, t) => (t ? 'shts' : 'shs'))
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** Active configured school whose name matches the typed one, or null. */
export async function matchSchool(name: string) {
  const key = schoolNameKey(name); if (!key) return null;
  const all = await School.find({ status: 'active' }).select('name').lean();
  return all.find((s) => schoolNameKey(s.name) === key) ?? null;
}
/**
 * The configured school a student belongs to: the linked one, else one whose name now matches the typed name
 * (linked lazily so scoping is stable afterwards). null = not linked to any configured school.
 */
export async function studentSchoolId(userId: string): Promise<string | null> {
  const p = await StudentProfile.findOne({ userId }).select('schoolId schoolName').lean();
  if (!p) return null;
  if (p.schoolId) return String(p.schoolId);
  const s = p.schoolName ? await matchSchool(p.schoolName) : null;
  if (!s) return null;
  await StudentProfile.updateOne({ userId }, { schoolId: s._id }); await User.updateOne({ _id: userId }, { schoolId: s._id });
  return String(s._id);
}

/** School status with a short cache (checked on every authenticated request). Unknown school = 'missing'. */
const statusCache = new Map<string, { v: string; at: number }>();
export async function schoolStatus(id: string): Promise<string> {
  const hit = statusCache.get(id); if (hit && Date.now() - hit.at < 30_000) return hit.v;
  const s = await School.findById(id).select('status').lean();
  const v = s ? (s as any).status ?? 'active' : 'missing'; statusCache.set(id, { v, at: Date.now() }); return v;
}
export const invalidateSchoolStatus = (id?: string) => (id ? statusCache.delete(id) : statusCache.clear());
/** True when the school is suspended or archived (a deleted school does not lock its former members out). */
export const schoolBlocked = async (id: string) => ['suspended', 'archived'].includes(await schoolStatus(id));
