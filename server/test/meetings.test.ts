import { describe, it, expect, beforeAll } from 'vitest';
import { useDb, ctx, loginAs, anon } from './setup.js';
import { School, User, Notification, Meeting } from '../src/models/index.js';
import { hashPassword } from '../src/services/auth.js';
useDb();
const id = (x: any) => String(x._id);
const at = (days: number, h = 10) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(h, 0, 0, 0); return d; };
let other: any; let otherTeacher: any;
beforeAll(async () => {
  other = await School.create({ name: 'Other High (Test)', code: 'OTHER-01' });
  otherTeacher = await User.create({ email: 'ot@t.gh', fullName: 'Other Teacher', roles: ['teacher'], schoolId: other._id, passwordHash: await hashPassword('SamplePass2026') });
});
describe('meetings', () => {
  let slotId = ''; let meetingId = ''; let kofiMeeting = '';
  it('school admin can assign the counselor role (not admin roles)', async () => {
    const adm = await loginAs('admin@sample.ghlearn.test');
    const u = await User.create({ email: 'c2@t.gh', fullName: 'New Counselor', roles: ['teacher'], schoolId: ctx.data.school._id, passwordHash: 'x' });
    const r = await adm.patch(`/api/admin/users/${id(u)}`).send({ roles: ['counselor'] }); expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await User.findById(u._id))!.roles).toEqual(['counselor']);
    expect((await adm.patch(`/api/admin/users/${id(u)}`).send({ roles: ['school_admin'] })).status).toBe(403);
    await User.deleteOne({ _id: u._id });
  });
  it('hosts publish availability; validation, overlap and permission checks', async () => {
    const c = await loginAs('counselor@sample.ghlearn.test');
    let r = await c.post('/api/meetings/slots').send({ start: at(2, 10), end: at(2, 11), modes: ['online'], link: 'https://meet.example.org/abc' });
    expect(r.status, JSON.stringify(r.body)).toBe(201); slotId = r.body.slot._id;
    expect((await c.post('/api/meetings/slots').send({ start: at(2, 10), end: at(2, 12) })).status).toBe(409);
    expect((await c.post('/api/meetings/slots').send({ start: at(-1, 10), end: at(-1, 11) })).status).toBe(400);
    expect((await c.post('/api/meetings/slots').send({ start: at(3, 11), end: at(3, 10) })).status).toBe(422);
    expect((await c.post('/api/meetings/slots').send({ start: at(3, 10), end: at(3, 11), link: 'http://insecure.example.org' })).status).toBe(422);
    const kofi = await loginAs('kofi@sample.ghlearn.test');
    expect((await kofi.post('/api/meetings/slots').send({ start: at(3, 10), end: at(3, 11) })).status).toBe(403);
    expect((await (await loginAs('editor@sample.ghlearn.test')).get('/api/meetings')).status).toBe(403);
  });
  it('students see only hosts of their school; unlinked students get a clear NO_SCHOOL error', async () => {
    const ama = await loginAs('ama@sample.ghlearn.test');
    const h = (await ama.get('/api/meetings/hosts')).body.items;
    expect(h.map((x: any) => x.role).sort()).toEqual(['counselor', 'teacher']); expect(h.some((x: any) => x._id === id(otherTeacher))).toBe(false);
    expect((await ama.get(`/api/meetings/slots?hostId=${id(otherTeacher)}`)).status).toBe(404);
    expect((await ama.post('/api/meetings').send({ hostId: id(otherTeacher), start: at(4), topic: 'Careers', mode: 'in_person' })).status).toBe(404);
    const a = await anon();
    await a.post('/api/auth/register').send({ fullName: 'Lone Student', email: 'lone@t.gh', password: 'GoodPass123', acceptTerms: true });
    await a.post('/api/onboarding').send({ region: 'Oti', schoolName: 'Nowhere SHS', levelId: id(ctx.data.shs), yearOfStudy: 1, coreSubjectIds: [id(ctx.data.core[0])] });
    const r = await a.get('/api/meetings/hosts'); expect(r.status).toBe(409); expect(r.body.error.code).toBe('NO_SCHOOL');
  });
  it('booking a slot: one active booking per slot, even under concurrency', async () => {
    const [ama, kofi] = await Promise.all([loginAs('ama@sample.ghlearn.test'), loginAs('kofi@sample.ghlearn.test')]);
    const host = (await ama.get('/api/meetings/hosts')).body.items.find((x: any) => x.role === 'counselor')._id;
    expect((await ama.get(`/api/meetings/slots?hostId=${host}`)).body.items.map((s: any) => s._id)).toContain(slotId);
    expect((await ama.post('/api/meetings').send({ hostId: host, slotId, topic: 'Subject choices', mode: 'in_person' })).status).toBe(400); // slot is online-only
    expect((await ama.post('/api/meetings').send({ hostId: host, slotId, start: at(2), topic: 'x y z', mode: 'online' })).status).toBe(422); // slot AND time
    const [r1, r2] = await Promise.all([ama.post('/api/meetings').send({ hostId: host, slotId, topic: 'Subject choices', mode: 'online' }), kofi.post('/api/meetings').send({ hostId: host, slotId, topic: 'Stress', mode: 'online' })]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const winner = r1.status === 201 ? r1 : r2; meetingId = winner.body.meeting._id;
    expect(winner.body.meeting).toMatchObject({ status: 'pending', link: 'https://meet.example.org/abc' });
    expect((await kofi.get(`/api/meetings/slots?hostId=${host}`)).body.items.map((s: any) => s._id)).not.toContain(slotId);
    const c = await User.findOne({ email: 'counselor@sample.ghlearn.test' });
    expect(await Notification.countDocuments({ userId: c!._id, type: 'meeting.requested' })).toBe(1);
    // normalise for later steps: make Ama the booker
    if (r2.status === 201) await Meeting.updateOne({ _id: meetingId }, { studentId: ctx.data.users.ama._id });
  });
  it('host accepts; outsiders and wrong-role actions are refused; both sides are notified', async () => {
    const c = await loginAs('counselor@sample.ghlearn.test'); const ama = await loginAs('ama@sample.ghlearn.test');
    const ot = await loginAs('ot@t.gh');
    expect((await ot.post(`/api/meetings/${meetingId}/respond`).send({ action: 'accept' })).status).toBe(404);
    expect((await (await loginAs('kofi@sample.ghlearn.test')).post(`/api/meetings/${meetingId}/respond`).send({ action: 'cancel' })).status).toBe(404);
    expect((await ama.post(`/api/meetings/${meetingId}/respond`).send({ action: 'accept' })).status).toBe(409); // student can't accept own pending request
    expect((await ama.post(`/api/meetings/${meetingId}/respond`).send({ action: 'reschedule', start: at(5) })).status).toBe(403);
    const r = await c.post(`/api/meetings/${meetingId}/respond`).send({ action: 'accept', note: 'See you then' });
    expect(r.status, JSON.stringify(r.body)).toBe(200); expect(r.body.meeting.status).toBe('confirmed');
    expect(await Notification.countDocuments({ userId: ctx.data.users.ama._id, type: 'meeting.accept' })).toBe(1);
    const up = (await ama.get('/api/meetings?when=upcoming')).body.items; expect(up).toHaveLength(1); expect(up[0]).toMatchObject({ status: 'confirmed', myRole: 'student' });
    expect((await c.get('/api/meetings')).body.items[0].myRole).toBe('host');
    expect((await ama.get('/api/meetings?when=past')).body.items).toHaveLength(0);
  });
  it('proposed times: no double booking; reschedule needs the student to confirm', async () => {
    const kofi = await loginAs('kofi@sample.ghlearn.test'); const c = await loginAs('counselor@sample.ghlearn.test');
    const host = id(ctx.data.users.counselor);
    const clash = new Date(at(2, 10).getTime() + 15 * 60000);
    expect((await kofi.post('/api/meetings').send({ hostId: host, start: clash, durationMin: 30, topic: 'Clash', mode: 'in_person' })).status).toBe(409);
    expect((await kofi.post('/api/meetings').send({ hostId: host, start: at(-1), topic: 'Past', mode: 'in_person' })).status).toBe(400);
    let r = await kofi.post('/api/meetings').send({ hostId: host, start: at(3, 14), durationMin: 30, topic: 'Career guidance', mode: 'online' });
    expect(r.status).toBe(201); kofiMeeting = r.body.meeting._id;
    expect((await c.post(`/api/meetings/${kofiMeeting}/respond`).send({ action: 'accept' })).status).toBe(400); // online without link
    expect((await c.post(`/api/meetings/${kofiMeeting}/respond`).send({ action: 'reschedule', start: clash })).status).toBe(409); // onto own confirmed meeting
    r = await c.post(`/api/meetings/${kofiMeeting}/respond`).send({ action: 'reschedule', start: at(4, 9), link: 'https://meet.example.org/k' });
    expect(r.body.meeting.status).toBe('awaiting_student');
    expect((await c.post(`/api/meetings/${kofiMeeting}/respond`).send({ action: 'accept' })).status).toBe(409); // waiting for the student
    r = await kofi.post(`/api/meetings/${kofiMeeting}/respond`).send({ action: 'accept' }); expect(r.body.meeting.status).toBe('confirmed');
    expect(await Notification.countDocuments({ userId: ctx.data.users.kofi._id, type: 'meeting.reschedule' })).toBe(1);
  });
  it('cancelling frees the slot; booked slots cannot be deleted', async () => {
    const c = await loginAs('counselor@sample.ghlearn.test'); const ama = await loginAs('ama@sample.ghlearn.test'); const kofi = await loginAs('kofi@sample.ghlearn.test');
    expect((await c.delete(`/api/meetings/slots/${slotId}`)).status).toBe(409);
    expect((await ama.post(`/api/meetings/${meetingId}/respond`).send({ action: 'cancel' })).body.meeting.status).toBe('cancelled');
    expect(await Notification.countDocuments({ userId: ctx.data.users.counselor._id, type: 'meeting.cancel' })).toBe(1);
    expect((await kofi.post('/api/meetings').send({ hostId: id(ctx.data.users.counselor), slotId, topic: 'Now free', mode: 'online' })).status).toBe(201);
    expect((await (await loginAs('teacher@sample.ghlearn.test')).delete(`/api/meetings/slots/${slotId}`)).status).toBe(404); // not their slot
  });
});
