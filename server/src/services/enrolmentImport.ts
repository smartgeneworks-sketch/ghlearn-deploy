import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { ENROLMENT_COLUMNS, ENROLMENT_REQUIRED } from '@ghlearn/shared';
import { AcademicYear, Attempt, ClassGroup, ImportBatch, RoleAssignment, StudentProfile, Subject, User, Assessment } from '../models/index.js';
import { AppError } from '../lib/errors.js';
import { escapeRx } from '../lib/list.js';
import { hashPassword, temporaryPassword } from './auth.js';

export const MAX_ROWS = 2000;
/** RFC 4180-style CSV parser: quoted fields, escaped quotes, commas and newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"' && f === '') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else f += c;
  }
  if (q) throw new AppError(422, 'CSV_INVALID', 'The file has an unclosed quote');
  row.push(f); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
export const TEMPLATE_CSV = `${ENROLMENT_COLUMNS.join(',')}\r\nama.example@school.edu.gh,Ama Example,1 Science A,1,2026/2027\r\n`;
const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); const t = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export const toCsvRows = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const key = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export interface Options { createMissingStudents: boolean; createMissingClasses: boolean }
export type Row = { line: number; email: string; fullName: string; className: string; yearOfStudy?: number; academicYear?: string; action: 'enrol' | 'create_and_enrol' | 'skip' | 'error'; createsClass?: boolean; errors: string[]; warnings: string[]; classId?: string; userId?: string; academicYearId?: string };

/** Validates every row against the database without writing anything (preview and the re-check before commit). */
export async function validate(csv: string, schoolId: string, o: Options) {
  const table = parseCsv(csv);
  if (!table.length) throw new AppError(422, 'CSV_INVALID', 'The file is empty');
  const head = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const missing = ENROLMENT_REQUIRED.filter((c) => !head.includes(c));
  if (missing.length) throw new AppError(422, 'CSV_INVALID', `Missing required column(s): ${missing.join(', ')}. Use the template.`, { expected: ENROLMENT_COLUMNS });
  const unknown = head.filter((h) => h && !(ENROLMENT_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) throw new AppError(422, 'CSV_INVALID', `Unknown column(s): ${unknown.join(', ')}. Use the template.`, { expected: ENROLMENT_COLUMNS });
  const body = table.slice(1);
  if (!body.length) throw new AppError(422, 'CSV_INVALID', 'The file has a header but no rows');
  if (body.length > MAX_ROWS) throw new AppError(422, 'CSV_INVALID', `At most ${MAX_ROWS} rows per import`);
  const col = (r: string[], c: string) => (head.indexOf(c) >= 0 ? (r[head.indexOf(c)] ?? '').trim() : '');
  const current = await AcademicYear.findOne({ current: true, archivedAt: null }).select('label').lean();
  const years = new Map((await AcademicYear.find({ archivedAt: null }).select('label').lean()).map((y) => [y.label, String(y._id)]));
  const sid = new mongoose.Types.ObjectId(schoolId);
  const classes = await ClassGroup.find({ schoolId: sid, archived: false }).select('name academicYearId subjectId studentIds yearOfStudy').lean();
  const emails = [...new Set(body.map((r) => col(r, 'email').toLowerCase()).filter(Boolean))];
  const users = new Map((await User.find({ email: { $in: emails } }).select('email fullName roles schoolId').lean()).map((u) => [u.email, u]));
  const profiles = new Map((await StudentProfile.find({ userId: { $in: [...users.values()].map((u) => u._id) } }).select('userId schoolId subjectIds yearOfStudy').lean()).map((p) => [String(p.userId), p]));
  const subjectNames = new Map((await Subject.find({ _id: { $in: classes.map((c) => c.subjectId).filter(Boolean) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
  const seen = new Map<string, number>(); const rows: Row[] = [];
  for (const [i, r] of body.entries()) {
    const line = i + 2; const e: string[] = []; const w: string[] = [];
    const email = col(r, 'email').toLowerCase(); const fullName = col(r, 'full_name'); const className = col(r, 'class').replace(/\s+/g, ' ');
    const yRaw = col(r, 'year_of_study'); const ayGiven = col(r, 'academic_year'); const ayRaw = ayGiven || current?.label || '';
    const row: Row = { line, email, fullName, className, action: 'enrol', errors: e, warnings: w, ...(ayGiven ? { academicYear: ayGiven } : {}) };
    if (!email) e.push('Email is required'); else if (!EMAIL.test(email) || email.length > 254) e.push('Email is not valid');
    if (!className) e.push('Class is required'); else if (className.length > 80 || className.length < 2) e.push('Class name must be 2–80 characters');
    if (fullName.length > 120) e.push('Full name is longer than 120 characters');
    if (yRaw) { const y = Number(yRaw); if (!Number.isInteger(y) || y < 1 || y > 6) e.push('year_of_study must be a whole number from 1 to 6'); else row.yearOfStudy = y; }
    let ayId: string | undefined;
    if (ayRaw) { ayId = years.get(ayRaw); if (!ayId) e.push(`Academic year "${ayRaw}" does not exist`); else row.academicYearId = ayId; }
    const dupKey = `${email}|${key(className)}|${ayRaw}`;
    if (email && className) { if (seen.has(dupKey)) e.push(`Duplicate of line ${seen.get(dupKey)}`); else seen.set(dupKey, line); }
    // A blank academic_year means the current year; a class not tied to any year also matches then.
    const named = classes.filter((c) => key(c.name) === key(className));
    let matches = named.filter((c) => !ayId || String(c.academicYearId ?? '') === ayId);
    if (!ayGiven && !matches.length) matches = named.filter((c) => !c.academicYearId);
    const cls = matches.length === 1 ? matches[0] : undefined;
    if (matches.length > 1) e.push('More than one class has this name; add the academic_year column');
    else if (!cls && className) { if (o.createMissingClasses) { row.createsClass = true; w.push('A new class will be created'); } else e.push(named.length ? `Class "${className}" exists at this school, but not for ${ayRaw || 'this academic year'}; set the academic_year column` : `Class "${className}" not found at this school`); }
    if (cls) row.classId = String(cls._id);
    const u = users.get(email);
    if (u) {
      row.userId = String(u._id); const p = profiles.get(String(u._id));
      if (!u.roles.includes('student')) e.push('An account with this email exists and is not a student');
      else if (String(u.schoolId ?? '') !== schoolId && String(p?.schoolId ?? '') !== schoolId) e.push('This student belongs to another school or is not linked to this school; it was not changed');
      if (fullName && key(fullName) !== key(u.fullName)) w.push(`Name in file ("${fullName}") differs from the account ("${u.fullName}"); the account name is kept`);
      if (cls?.subjectId && !(p?.subjectIds ?? []).map(String).includes(String(cls.subjectId))) e.push(`Student does not take ${subjectNames.get(String(cls.subjectId)) ?? 'this class\'s subject'}`);
      if (row.yearOfStudy && p?.yearOfStudy && p.yearOfStudy !== row.yearOfStudy) w.push(`Student profile says year ${p.yearOfStudy}`);
      if (cls && cls.studentIds.map(String).includes(String(u._id)) && !e.length) { row.action = 'skip'; w.push('Already enrolled in this class'); }
    } else if (email && !e.some((x) => x.startsWith('Email'))) {
      if (!o.createMissingStudents) e.push('No account with this email (turn on "Create missing students" to add one)');
      else { row.action = 'create_and_enrol'; if (!fullName || fullName.length < 2) e.push('full_name is required to create a new student'); if (cls?.subjectId) e.push('New students have no subjects yet; enrol them in a subject class after they sign in'); }
    }
    if (e.length) row.action = 'error';
    rows.push(row);
  }
  // A student created by an earlier row and enrolled again later: later rows enrol the same new account.
  const summary = { rows: rows.length, enrol: rows.filter((r) => r.action === 'enrol').length, createAndEnrol: rows.filter((r) => r.action === 'create_and_enrol').length,
    skip: rows.filter((r) => r.action === 'skip').length, errors: rows.filter((r) => r.action === 'error').length, warnings: rows.reduce((n, r) => n + r.warnings.length, 0),
    newClasses: [...new Set(rows.filter((r) => r.createsClass && r.action !== 'error').map((r) => r.className))], newStudents: new Set(rows.filter((r) => r.action === 'create_and_enrol').map((r) => r.email)).size };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(rows.map((r) => [r.line, r.action, r.classId ?? '', r.userId ?? '', r.createsClass ?? false]))).digest('hex');
  return { rows, summary, fingerprint, checksum: crypto.createHash('sha256').update(csv).digest('hex') };
}

/** Applies a validated batch step by step, recording every created record first so rollback can undo a partial run. */
export async function commit(batchId: mongoose.Types.ObjectId, rows: Row[], schoolId: string, actorId: string) {
  const credentials: { email: string; fullName: string; temporaryPassword: string }[] = [];
  const classIds = new Map<string, string>(); const userIds = new Map<string, string>();
  const push = (f: Record<string, unknown>) => ImportBatch.updateOne({ _id: batchId }, { $push: f });
  for (const r of rows) {
    if (r.action === 'error' || r.action === 'skip') continue;
    let classId = r.classId;
    if (!classId) {
      const k = `${key(r.className)}|${r.academicYearId ?? ''}`; classId = classIds.get(k);
      if (!classId) {
        const c = await ClassGroup.create({ schoolId, name: r.className, yearOfStudy: r.yearOfStudy, academicYearId: r.academicYearId, teacherIds: [], studentIds: [], createdBy: actorId });
        classId = String(c._id); classIds.set(k, classId); await push({ 'created.classIds': c._id });
      }
    }
    let userId = r.userId ?? userIds.get(r.email);
    if (!userId) {
      const pw = temporaryPassword();
      const u = await User.create({ email: r.email, fullName: r.fullName, roles: ['student'], schoolId, passwordHash: await hashPassword(pw), mustChangePassword: true, createdBy: actorId });
      userId = String(u._id); userIds.set(r.email, userId); await push({ 'created.userIds': u._id });
      await RoleAssignment.updateOne({ userId: u._id, role: 'student', scopeType: 'school', scopeId: schoolId }, { $setOnInsert: { grantedBy: actorId } }, { upsert: true });
      credentials.push({ email: r.email, fullName: r.fullName, temporaryPassword: pw });
    }
    const added = await ClassGroup.updateOne({ _id: classId, studentIds: { $ne: userId } }, { $addToSet: { studentIds: userId } });
    if (added.modifiedCount) await push({ 'created.enrolments': { classId: new mongoose.Types.ObjectId(classId), userId: new mongoose.Types.ObjectId(userId) } });
  }
  return credentials;
}

/** Undoes exactly what the batch created. Accounts that were used since (signed in, onboarded, attempted work) are kept. */
export async function rollback(batch: any) {
  const report = { enrolmentsRemoved: 0, usersDeleted: 0, usersKept: [] as string[], classesDeleted: 0, classesKept: [] as string[] };
  for (const e of batch.created?.enrolments ?? []) { const r = await ClassGroup.updateOne({ _id: e.classId }, { $pull: { studentIds: e.userId } }); report.enrolmentsRemoved += r.modifiedCount; }
  for (const id of batch.created?.userIds ?? []) {
    const u = await User.findById(id).select('email lastLoginAt').lean(); if (!u) continue;
    const used = u.lastLoginAt || (await StudentProfile.exists({ userId: id })) || (await Attempt.exists({ userId: id })) || (await ClassGroup.exists({ studentIds: id }));
    if (used) { report.usersKept.push(u.email); continue; }
    await RoleAssignment.deleteMany({ userId: id }); await User.deleteOne({ _id: id }); report.usersDeleted++;
  }
  for (const id of batch.created?.classIds ?? []) {
    const c = await ClassGroup.findById(id).select('name studentIds').lean(); if (!c) continue;
    if (c.studentIds.length || (await Assessment.exists({ classId: id }))) { report.classesKept.push(c.name); continue; }
    await ClassGroup.deleteOne({ _id: id }); report.classesDeleted++;
  }
  return report;
}
export const classNameRx = (name: string) => new RegExp(`^${escapeRx(name.trim())}$`, 'i');
