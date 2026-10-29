import { Router } from 'express';
import { z } from 'zod';
import { hasPermission, slotSchema, meetingRequestSchema, meetingRespondSchema } from '@ghlearn/shared';
import { Meeting, MeetingSlot, User } from '../models/index.js';
import { authenticate, requireAnyPermission, requirePermission, type AuthCtx } from '../middleware/index.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { notify } from '../services/notify.js';
import { studentSchoolId } from '../services/schools.js';

/**
 * Student ↔ teacher/counselor meetings, scoped to one school.
 * A student's school is their linked school (or the configured school whose name matches the one they typed).
 * Hosts are active users with meetings:host whose User.schoolId is that school.
 * Double booking: a slot can back at most one active meeting (unique partial index), and no participant can hold
 * two overlapping active meetings (host: confirmed ones; student: any active one), re-checked on every accept/reschedule.
 */
export const meetingsRouter = Router();
meetingsRouter.use(authenticate, requireAnyPermission('meetings:request', 'meetings:host'));
const isHost = (a: AuthCtx) => hasPermission(a.roles, 'meetings:host');
const HOST_ROLES: any = ['teacher', 'counselor'];
const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

async function requireStudentSchool(a: AuthCtx) {
  const s = await studentSchoolId(a.userId);
  if (!s) throw new AppError(409, 'NO_SCHOOL', 'Your school name does not match a school registered on GH Learn yet, so no teachers or counselors are available. Check the spelling in your profile or ask your school to join.');
  return s;
}
async function hostInSchool(hostId: string, schoolId: string) {
  const h = await User.findOne({ _id: hostId, schoolId, status: 'active', roles: { $in: HOST_ROLES } }).select('fullName roles schoolId').lean();
  if (!h) throw notFound('Teacher or counselor not found at your school'); return h;
}
const overlap = (start: Date, end: Date): any => ({ start: { $lt: end }, end: { $gt: start } });
async function assertFree(m: { hostId: unknown; studentId: unknown; start: Date; end: Date; _id?: unknown }) {
  const not = m._id ? { _id: { $ne: m._id } } : {};
  if (await Meeting.exists({ ...not, hostId: m.hostId, status: 'confirmed', ...overlap(m.start, m.end) })) throw conflict('That time is already booked for this teacher or counselor');
  if (await Meeting.exists({ ...not, studentId: m.studentId, active: true, ...overlap(m.start, m.end) })) throw conflict('The student already has a meeting at that time');
}

meetingsRouter.get('/hosts', requirePermission('meetings:request'), async (req, res) => {
  const schoolId = await requireStudentSchool(req.auth!);
  const hosts = await User.find({ schoolId, status: 'active', roles: { $in: HOST_ROLES } }).select('fullName roles').sort({ fullName: 1 }).lean();
  res.json({ items: hosts.map((h) => ({ _id: h._id, fullName: h.fullName, role: h.roles.includes('counselor') ? 'counselor' : 'teacher' })) });
});

meetingsRouter.get('/slots', async (req, res) => {
  const q = z.object({ hostId: z.string().regex(/^[a-f0-9]{24}$/i).optional() }).parse(req.query);
  const now = new Date();
  if (req.auth!.roles.includes('student')) {
    if (!q.hostId) throw badRequest('Choose a teacher or counselor');
    await hostInSchool(q.hostId, await requireStudentSchool(req.auth!));
    const slots = await MeetingSlot.find({ hostId: q.hostId, start: { $gt: now } }).sort({ start: 1 }).limit(100).lean();
    const taken = new Set((await Meeting.find({ slotId: { $in: slots.map((s) => s._id) }, active: true }).distinct('slotId')).map(String));
    const busy = await Meeting.find({ hostId: q.hostId, status: 'confirmed', end: { $gt: now } }).select('start end').lean();
    return res.json({ items: slots.filter((s) => !taken.has(String(s._id)) && !busy.some((b) => b.start < s.end && b.end > s.start)) });
  }
  if (!isHost(req.auth!)) throw forbidden();
  const slots = await MeetingSlot.find({ hostId: req.auth!.userId, end: { $gt: now } }).sort({ start: 1 }).limit(200).lean();
  const taken = new Set((await Meeting.find({ slotId: { $in: slots.map((s) => s._id) }, active: true }).distinct('slotId')).map(String));
  res.json({ items: slots.map((s) => ({ ...s, taken: taken.has(String(s._id)) })) });
});

meetingsRouter.post('/slots', requirePermission('meetings:host'), async (req, res) => {
  const b = slotSchema.parse(req.body);
  if (!req.auth!.schoolId) throw badRequest('Your account is not linked to a school; ask an administrator.');
  if (b.start <= new Date()) throw badRequest('Availability must be in the future');
  if (await MeetingSlot.exists({ hostId: req.auth!.userId, ...overlap(b.start, b.end) })) throw conflict('This overlaps one of your existing slots');
  const s = await MeetingSlot.create({ ...b, hostId: req.auth!.userId, schoolId: req.auth!.schoolId });
  audit(req, 'meeting.slot.create', String(s._id)); res.status(201).json({ slot: s });
});
meetingsRouter.delete('/slots/:id', requirePermission('meetings:host'), async (req, res) => {
  const s = await MeetingSlot.findOne({ _id: req.params.id, hostId: req.auth!.userId }); if (!s) throw notFound();
  if (await Meeting.exists({ slotId: s._id, active: true })) throw conflict('A student has booked this slot. Decline or reschedule the meeting first.');
  await s.deleteOne(); audit(req, 'meeting.slot.delete', String(s._id)); res.status(204).end();
});

meetingsRouter.get('/', async (req, res) => {
  const q = z.object({ when: z.enum(['upcoming', 'past']).default('upcoming') }).parse(req.query);
  const me = req.auth!.userId; const now = new Date();
  const items = await Meeting.find({ $or: [{ studentId: me }, { hostId: me }], ...(q.when === 'upcoming' ? { end: { $gte: now } } : { end: { $lt: now } }) })
    .sort({ start: q.when === 'upcoming' ? 1 : -1 }).limit(200).populate('studentId', 'fullName').populate('hostId', 'fullName roles').select('-history').lean();
  res.json({ items: items.map((m: any) => ({ ...m, myRole: String(m.hostId?._id) === me ? 'host' : 'student' })) });
});

meetingsRouter.post('/', requirePermission('meetings:request'), async (req, res) => {
  const b = meetingRequestSchema.parse(req.body);
  const schoolId = await requireStudentSchool(req.auth!);
  const host = await hostInSchool(b.hostId, schoolId);
  let start: Date; let end: Date; let slot: any = null;
  if (b.slotId) {
    slot = await MeetingSlot.findOne({ _id: b.slotId, hostId: host._id }).lean(); if (!slot) throw notFound('Slot not found');
    if (!slot.modes.includes(b.mode)) throw badRequest(`This slot is ${slot.modes.map((m: string) => m.replace('_', '-')).join(' or ')} only`);
    if (await Meeting.exists({ slotId: slot._id, active: true })) throw conflict('This slot has just been booked. Pick another one.');
    start = slot.start; end = slot.end;
  } else { start = b.start!; end = new Date(start.getTime() + b.durationMin * 60000); }
  if (start <= new Date()) throw badRequest('Choose a time in the future');
  await assertFree({ hostId: host._id, studentId: req.auth!.userId, start, end });
  let m;
  try {
    m = await Meeting.create({ studentId: req.auth!.userId, hostId: host._id, schoolId, slotId: slot?._id, start, end, topic: b.topic, mode: b.mode,
      link: b.link ?? (b.mode === 'online' ? slot?.link : undefined), location: b.mode === 'in_person' ? slot?.location : undefined, note: b.note,
      history: [{ at: new Date(), by: req.auth!.userId, action: slot ? 'booked_slot' : 'proposed', start, end }] });
  } catch (e: any) { if (e?.code === 11000) throw conflict('This slot has just been booked. Pick another one.'); throw e; }
  const who = await User.findById(req.auth!.userId).select('fullName').lean();
  await notify([host._id], { type: 'meeting.requested', title: `Meeting request: ${b.topic}`, body: `${who?.fullName} ${slot ? 'booked' : 'proposed'} ${fmt(start)} (${b.mode.replace('_', '-')}).`, link: '/meetings', meta: { meetingId: String(m._id) } });
  audit(req, 'meeting.request', String(m._id), { hostId: String(host._id), slot: !!slot });
  res.status(201).json({ meeting: m });
});

const TRANSITIONS: Record<'host' | 'student', Record<string, string[]>> = {
  host: { accept: ['pending'], decline: ['pending', 'awaiting_student', 'confirmed'], reschedule: ['pending', 'awaiting_student', 'confirmed'], cancel: ['confirmed', 'awaiting_student'] },
  student: { accept: ['awaiting_student'], decline: ['awaiting_student'], cancel: ['pending', 'awaiting_student', 'confirmed'] },
};
meetingsRouter.post('/:id/respond', async (req, res) => {
  const b = meetingRespondSchema.parse(req.body); const me = req.auth!.userId;
  const m = await Meeting.findOne({ _id: req.params.id, $or: [{ studentId: me }, { hostId: me }] }); if (!m) throw notFound('Meeting not found');
  const as = String(m.hostId) === me ? 'host' : 'student';
  if (as === 'host' && !isHost(req.auth!)) throw forbidden();
  const allowed = TRANSITIONS[as][b.action];
  if (!allowed) throw forbidden(as === 'student' ? 'Students cannot reschedule; cancel and request a new time instead.' : 'Not allowed');
  if (!allowed.includes(m.status)) throw conflict(`Cannot ${b.action} a meeting that is ${m.status.replace('_', ' ')}`);
  if (m.end <= new Date() && b.action !== 'cancel' && b.action !== 'decline') throw conflict('This meeting is in the past');
  if (b.link) m.link = b.link; if (b.location) m.location = b.location;
  let status = m.status;
  if (b.action === 'accept') {
    if (m.mode === 'online' && !m.link) throw badRequest('Add an online meeting link (https://…) before confirming');
    await assertFree({ hostId: m.hostId, studentId: m.studentId, start: m.start, end: m.end, _id: m._id }); status = 'confirmed';
  } else if (b.action === 'reschedule') {
    const start = b.start!; const end = new Date(start.getTime() + (b.durationMin ?? Math.round((m.end.getTime() - m.start.getTime()) / 60000)) * 60000);
    if (start <= new Date()) throw badRequest('Choose a time in the future');
    await assertFree({ hostId: m.hostId, studentId: m.studentId, start, end, _id: m._id });
    m.start = start; m.end = end; m.slotId = undefined as any; m.reminderSentAt = undefined as any; status = 'awaiting_student';
  } else status = b.action === 'decline' ? 'declined' : 'cancelled';
  m.status = status as any; m.active = ['pending', 'awaiting_student', 'confirmed'].includes(status);
  m.history.push({ at: new Date(), by: me as any, action: b.action, note: b.note, start: m.start, end: m.end } as any);
  await m.save();
  const other = as === 'host' ? m.studentId : m.hostId;
  const who = await User.findById(me).select('fullName').lean();
  const verb = { accept: 'confirmed', decline: 'declined', reschedule: 'proposed a new time for', cancel: 'cancelled' }[b.action];
  await notify([other], { type: `meeting.${b.action}`, title: `Meeting ${status === 'awaiting_student' ? 'rescheduled' : status}: ${m.topic}`,
    body: `${who?.fullName} ${verb} the meeting (${fmt(m.start)}).${b.note ? ` Note: ${b.note}` : ''}`, link: '/meetings', meta: { meetingId: String(m._id) } });
  audit(req, `meeting.${b.action}`, String(m._id));
  res.json({ meeting: m });
});
