import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { useDb, anon, loginAs } from './setup.js';
import { config } from '../src/config.js';
import { resetMailer, sentForTest } from '../src/services/mailer.js';
import { setSmsAdapterForTest, testAdapter, testOutbox, testControl } from '../src/services/sms.js';
import { updateSettings, clearSettingsCache } from '../src/services/platformSettings.js';
import { AuditLog, Notification, PasswordReset, School, Subject, TeacherApplication, TeacherAssignment, User } from '../src/models/index.js';
import * as TA from '../src/routes/teacherApplications.js';
import { sha256 } from '../src/services/passwordReset.js';
useDb();
const settle = () => new Promise((r) => setTimeout(r, 80));
const email = (on: boolean) => { (config as any).SMTP_URL = on ? 'json' : undefined; resetMailer(); sentForTest.length = 0; };
const mailTo = (to: string) => sentForTest.filter((m) => JSON.stringify(m.to).includes(to));
const tokenFrom = (m: any) => /set-password\?token=([\w-]+)/.exec(m.text)![1];
let SCHOOL = '', OTHER = '', SUBJ: string[] = [];
const base = (o: Record<string, unknown> = {}) => ({ fullName: 'Efua Teacher', email: 'efua@apply.test', region: 'Greater Accra', schoolId: SCHOOL, subjectIds: SUBJ.slice(0, 2), levels: ['SHS 1', 'SHS 2'], consent: true, ...o });
const apply = async (o: Record<string, unknown> = {}) => { const r = await (await anon()).post('/api/public/teacher-applications').send(base(o)); await TA.lastApplicationJob; await settle(); return r; };
beforeEach(async () => {
  email(true); TA.resetTeacherAppLimits(); testOutbox.length = 0;
  if (!SCHOOL) {
    SCHOOL = String((await School.findOne({ code: 'SAMPLE-01' }).lean())!._id);
    OTHER = String((await School.create({ name: 'Other Hill SHS', code: 'OTHER-01', region: 'Ashanti', levelKinds: ['SHS'] }))._id);
    SUBJ = (await Subject.find({ active: true, archivedAt: null }).limit(3).lean()).map((s) => String(s._id));
  }
});
afterAll(() => { email(false); setSmsAdapterForTest(undefined); clearSettingsCache(); });

describe('public teacher application', () => {
  it('validates the form (no password field; school or free-text name; subjects; forms; consent)', async () => {
    const a = await anon();
    expect((await a.post('/api/public/teacher-applications').send(base({ consent: false }))).status).toBe(422);
    expect((await a.post('/api/public/teacher-applications').send(base({ subjectIds: [] }))).status).toBe(422);
    expect((await a.post('/api/public/teacher-applications').send(base({ levels: ['SHS 9'] }))).status).toBe(422);
    expect((await a.post('/api/public/teacher-applications').send(base({ schoolId: '', schoolName: '' }))).status).toBe(422);
    expect((await a.post('/api/public/teacher-applications').send(base({ phone: '0302123456' }))).status).toBe(422);
    expect((await a.post('/api/public/teacher-applications').send(base({ password: 'Password2027' }))).status).toBe(422);
    expect((await a.post('/api/public/teacher-applications').send(base({ region: 'Atlantis' }))).status).toBe(422);
    const opts = await a.get('/api/public/teacher-applications/options');
    expect(opts.body.regions).toHaveLength(16); expect(opts.body.levels).toContain('SHS 2'); expect(opts.body.subjects.length).toBeGreaterThan(0); expect(opts.body.schools[0]).toEqual({ id: expect.any(String), name: expect.any(String), region: expect.anything() });
    expect(await TeacherApplication.countDocuments()).toBe(0);
  });
  it('stores the application, confirms by email and SMS, and notifies the reviewers of that school', async () => {
    setSmsAdapterForTest(testAdapter()); testControl.fail = null;
    await updateSettings({ sms: { enabled: true, senderId: 'GHLearn', dailyCap: 300 } }, String((await User.findOne({ email: 'super@sample.ghlearn.test' }).lean())!._id), true);
    const r = await apply({ phone: '024 123 4567', staffId: 'ST-9', ntcNumber: 'NTC/123', note: 'I teach biology' });
    expect(r.status).toBe(202); expect(r.body.message).toBe(TA.RECEIVED);
    const a = (await TeacherApplication.findOne({ email: 'efua@apply.test' }).lean())!;
    expect(a).toMatchObject({ status: 'pending', phone: '0241234567', region: 'Greater Accra', staffId: 'ST-9', ntcNumber: 'NTC/123', levels: ['SHS 1', 'SHS 2'] }); expect(String(a.schoolId)).toBe(SCHOOL);
    expect(mailTo('efua@apply.test')[0].subject).toMatch(/received your .* teacher application/);
    expect(testOutbox.at(-1)!.message).toMatch(/received your teacher application/); expect(testOutbox).toHaveLength(1);
    const admin = await User.findOne({ email: 'admin@sample.ghlearn.test' }).lean(); const sup = await User.findOne({ email: 'super@sample.ghlearn.test' }).lean();
    expect(await Notification.countDocuments({ userId: admin!._id, type: 'review.teacher_application' })).toBe(1);
    expect(await Notification.countDocuments({ userId: sup!._id, type: 'review.teacher_application' })).toBeGreaterThan(0);
    expect(await AuditLog.countDocuments({ action: 'teacher_application.submit' })).toBe(1);
    setSmsAdapterForTest(null);
  });
  it('is enumeration-safe: an existing account or a pending application gets the same reply and no new application', async () => {
    const before = await TeacherApplication.countDocuments();
    const dup = await apply(); const known = await apply({ email: 'ama@sample.ghlearn.test' }); const fresh = await apply({ email: 'kwame@apply.test' });
    for (const r of [dup, known, fresh]) { expect(r.status).toBe(202); expect(r.body).toEqual(fresh.body); }
    expect(await TeacherApplication.countDocuments()).toBe(before + 1);
    expect(mailTo('ama@sample.ghlearn.test')[0].subject).toMatch(/About your .* teacher application/);
    expect(mailTo('efua@apply.test')[0].text).toMatch(/still waiting for review/);
    expect(await AuditLog.countDocuments({ action: 'teacher_application.existing_account' })).toBe(1);
  });
  it('honeypot: same reply, nothing stored or sent', async () => {
    const r = await apply({ email: 'bot@apply.test', website: 'http://spam.test' });
    expect(r.status).toBe(202); expect(r.body.message).toBe(TA.RECEIVED);
    expect(await TeacherApplication.exists({ email: 'bot@apply.test' })).toBeNull(); expect(mailTo('bot@apply.test')).toHaveLength(0);
  });
  it('rate limits per IP (429) and per email (silently: same reply, nothing sent)', async () => {
    for (let i = 0; i < 4; i++) await apply({ email: 'repeat@apply.test' });
    expect(mailTo('repeat@apply.test')).toHaveLength(TA.TEACHER_APP_LIMITS.emailPerDay);
    TA.resetTeacherAppLimits(); const was = TA.TEACHER_APP_LIMITS.ipPerHour; TA.TEACHER_APP_LIMITS.ipPerHour = 2;
    try {
      expect((await apply({ email: 'ip1@apply.test' })).status).toBe(202); expect((await apply({ email: 'ip2@apply.test' })).status).toBe(202);
      expect((await apply({ email: 'ip3@apply.test' })).status).toBe(429);
    } finally { TA.TEACHER_APP_LIMITS.ipPerHour = was; TA.resetTeacherAppLimits(); }
  });
});

describe('review', () => {
  it('school admins see only their school; super admins see all, including free-text schools; others are refused', async () => {
    await apply({ email: 'free@apply.test', schoolId: '', schoolName: 'Brand New Hills College' });
    await apply({ email: 'other@apply.test', schoolId: OTHER });
    const sa = await loginAs('admin@sample.ghlearn.test'); const su = await loginAs('super@sample.ghlearn.test');
    const mine = (await sa.get('/api/admin/teacher-applications')).body.items.map((x: any) => x.email);
    expect(mine).toContain('efua@apply.test'); expect(mine).not.toContain('free@apply.test'); expect(mine).not.toContain('other@apply.test');
    const all = (await su.get('/api/admin/teacher-applications')).body.items.map((x: any) => x.email);
    expect(all).toEqual(expect.arrayContaining(['efua@apply.test', 'free@apply.test', 'other@apply.test']));
    const other = await TeacherApplication.findOne({ email: 'other@apply.test' }).lean();
    expect((await sa.get(`/api/admin/teacher-applications/${other!._id}`)).status).toBe(404);
    expect((await sa.post(`/api/admin/teacher-applications/${other!._id}/approve`).send({ schoolId: OTHER, subjectIds: SUBJ.slice(0, 1), levels: ['SHS 1'] })).status).toBe(404);
    expect((await sa.get('/api/admin/teacher-applications/count')).body.pending).toBe(mine.length);
    for (const who of ['teacher@sample.ghlearn.test', 'ama@sample.ghlearn.test', 'editor@sample.ghlearn.test']) expect((await (await loginAs(who)).get('/api/admin/teacher-applications')).status).toBe(403);
  });
  it('a school admin cannot approve into another school or escalate the role', async () => {
    const sa = await loginAs('admin@sample.ghlearn.test'); const a = await TeacherApplication.findOne({ email: 'efua@apply.test' }).lean();
    expect((await sa.post(`/api/admin/teacher-applications/${a!._id}/approve`).send({ schoolId: OTHER, subjectIds: SUBJ.slice(0, 1), levels: ['SHS 1'] })).status).toBe(403);
    expect((await sa.post(`/api/admin/teacher-applications/${a!._id}/approve`).send({ schoolId: SCHOOL, subjectIds: SUBJ.slice(0, 1), levels: ['SHS 1'], role: 'school_admin' })).status).toBe(422);
    expect(await User.exists({ email: 'efua@apply.test' })).toBeNull();
  });
  it('approve: teacher in the school, subject assignments, unverified phone, emailed single-use 72 h link; set password signs in', async () => {
    const sa = await loginAs('admin@sample.ghlearn.test'); const a = await TeacherApplication.findOne({ email: 'efua@apply.test' }).lean();
    const r = await sa.post(`/api/admin/teacher-applications/${a!._id}/approve`).send({ schoolId: SCHOOL, subjectIds: SUBJ.slice(0, 2), levels: ['SHS 2'] });
    expect(r.status).toBe(200); expect(r.body.invite.email).toBe('sent');
    const u = (await User.findOne({ email: 'efua@apply.test' }).lean())!;
    expect(u.roles).toEqual(['teacher']); expect(String(u.schoolId)).toBe(SCHOOL); expect(u.phone).toBe('0241234567'); expect(u.phoneVerifiedAt).toBeUndefined(); expect(u.mustChangePassword).toBe(true);
    const ta = await TeacherAssignment.find({ teacherId: u._id }).lean(); expect(ta.length).toBeGreaterThanOrEqual(2); expect(ta.every((t) => String(t.schoolId) === SCHOOL)).toBe(true);
    const mail = mailTo('efua@apply.test').at(-1)!; expect(mail.subject).toMatch(/teacher account is approved/); expect(mail.text).toContain('efua@apply.test'); expect(mail.html).toContain('Set your password');
    const token = tokenFrom(mail); const g = (await PasswordReset.findOne({ userId: u._id, kind: 'invite' }).lean())!;
    expect(g.tokenHash).toBe(sha256(token)); expect(JSON.stringify(g)).not.toContain(token);
    expect(Math.round((+g.expiresAt - +g.createdAt!) / 3600_000)).toBe(72);
    expect((await (await anon()).post('/api/auth/login').send({ email: 'efua@apply.test', password: 'Whatever2027' })).status).toBe(401);
    const c = await (await anon()).post('/api/auth/set-password/check').send({ token }); expect(c.body).toMatchObject({ valid: true, email: 'efua@apply.test' });
    expect((await (await anon()).post('/api/auth/set-password').send({ token, newPassword: 'short' })).status).toBe(422);
    const agent = await anon(); const s = await agent.post('/api/auth/set-password').send({ token, newPassword: 'MyTeaching2027' });
    expect(s.status).toBe(200); expect(s.body).toMatchObject({ signedIn: true, user: { roles: ['teacher'], email: 'efua@apply.test' } }); expect(s.body.user.mustChangePassword).toBeUndefined();
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    // Single use.
    expect((await (await anon()).post('/api/auth/set-password').send({ token, newPassword: 'Another2027x' })).status).toBe(400);
    expect((await (await anon()).post('/api/auth/set-password/check').send({ token })).body.valid).toBe(false);
    expect((await (await anon()).post('/api/auth/login').send({ email: 'efua@apply.test', password: 'MyTeaching2027' })).status).toBe(200);
    expect((await TeacherApplication.findById(a!._id).lean())!.passwordSetAt).toBeTruthy();
    expect(await AuditLog.countDocuments({ action: 'teacher_application.approve' })).toBe(1);
    // Already approved; resend refused once a password is set.
    expect((await sa.post(`/api/admin/teacher-applications/${a!._id}/approve`).send({ schoolId: SCHOOL, subjectIds: SUBJ.slice(0, 1), levels: ['SHS 1'] })).status).toBe(409);
    expect((await sa.post(`/api/admin/teacher-applications/${a!._id}/resend`)).status).toBe(409);
  });
  it('resend voids the old link; expired links are refused; a request for a new link notifies the admins once', async () => {
    const su = await loginAs('super@sample.ghlearn.test'); const a = await TeacherApplication.findOne({ email: 'free@apply.test' }).lean();
    const r = await su.post(`/api/admin/teacher-applications/${a!._id}/approve`).send({ schoolId: OTHER, subjectIds: SUBJ.slice(0, 1), levels: ['SHS 3'] }); expect(r.status).toBe(200);
    const t1 = tokenFrom(mailTo('free@apply.test').at(-1));
    expect((await su.post(`/api/admin/teacher-applications/${a!._id}/resend`)).status).toBe(200);
    const t2 = tokenFrom(mailTo('free@apply.test').at(-1)); expect(t2).not.toBe(t1);
    expect((await (await anon()).post('/api/auth/set-password/check').send({ token: t1 })).body.valid).toBe(false);
    expect((await (await anon()).post('/api/auth/set-password').send({ token: t1, newPassword: 'Teacher2027ok' })).status).toBe(400);
    await PasswordReset.updateOne({ tokenHash: sha256(t2) }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await (await anon()).post('/api/auth/set-password').send({ token: t2, newPassword: 'Teacher2027ok' })).status).toBe(400);
    const u = await User.findOne({ email: 'free@apply.test' }).lean(); const sup = await User.findOne({ email: 'super@sample.ghlearn.test' }).lean();
    const n0 = await Notification.countDocuments({ userId: sup!._id, title: /needs a new set-password link/ });
    const q1 = await (await anon()).post('/api/auth/set-password/request-new').send({ token: t2 }); await settle();
    const q2 = await (await anon()).post('/api/auth/set-password/request-new').send({ token: t2 }); await settle();
    const q3 = await (await anon()).post('/api/auth/set-password/request-new').send({ token: 'x'.repeat(43) }); await settle();
    expect(q1.body).toEqual(q2.body); expect(q1.body).toEqual(q3.body);
    expect(await Notification.countDocuments({ userId: sup!._id, title: /needs a new set-password link/ })).toBe(n0 + 1);
    expect(u!.schoolId && String(u!.schoolId)).toBe(OTHER);
    expect(await AuditLog.countDocuments({ action: 'teacher_application.resend' })).toBe(1);
  });
  it('reject needs a reason and sends a polite email', async () => {
    const su = await loginAs('super@sample.ghlearn.test'); const a = await TeacherApplication.findOne({ email: 'other@apply.test' }).lean();
    expect((await su.post(`/api/admin/teacher-applications/${a!._id}/reject`).send({ reason: '' })).status).toBe(422);
    expect((await su.post(`/api/admin/teacher-applications/${a!._id}/reject`).send({ reason: 'We could not confirm your staff ID with the school.' })).status).toBe(200);
    const m = mailTo('other@apply.test').at(-1)!; expect(m.text).toMatch(/could not approve/); expect(m.text).toContain('We could not confirm your staff ID');
    expect((await TeacherApplication.findById(a!._id).lean())!.status).toBe('rejected'); expect(await User.exists({ email: 'other@apply.test' })).toBeNull();
    expect(await AuditLog.countDocuments({ action: 'teacher_application.reject' })).toBe(1);
  });
  it('approving into an existing account is refused', async () => {
    await apply({ email: 'late@apply.test' }); const a = await TeacherApplication.findOne({ email: 'late@apply.test' }).lean();
    await User.create({ email: 'late@apply.test', fullName: 'Late', passwordHash: 'x', roles: ['student'] });
    const su = await loginAs('super@sample.ghlearn.test');
    expect((await su.post(`/api/admin/teacher-applications/${a!._id}/approve`).send({ schoolId: SCHOOL, subjectIds: SUBJ.slice(0, 1), levels: ['SHS 1'] })).status).toBe(409);
  });
});

describe('delete', () => {
  it('super admins only; an approved application only after its account is suspended', async () => {
    const sa = await loginAs('admin@sample.ghlearn.test'); const su = await loginAs('super@sample.ghlearn.test');
    const rej = await TeacherApplication.findOne({ email: 'other@apply.test' }).lean(); const ok = await TeacherApplication.findOne({ email: 'efua@apply.test' }).lean();
    expect((await sa.delete(`/api/admin/teacher-applications/${ok!._id}`)).status).toBe(403);
    expect((await su.delete(`/api/admin/teacher-applications/${ok!._id}`)).status).toBe(409);
    expect((await su.delete(`/api/admin/teacher-applications/${rej!._id}`)).status).toBe(204);
    await User.updateOne({ _id: ok!.userId }, { status: 'suspended' });
    expect((await su.delete(`/api/admin/teacher-applications/${ok!._id}`)).status).toBe(204);
    expect(await AuditLog.countDocuments({ action: 'teacher_application.delete' })).toBe(2);
  });
});

describe('admin-created accounts', () => {
  it('with email: no temporary password, an emailed set-password link instead', async () => {
    const su = await loginAs('super@sample.ghlearn.test');
    const r = await su.post('/api/admin/users').send({ fullName: 'Invited Counselor', email: 'invited@apply.test', role: 'counselor', schoolId: SCHOOL });
    expect(r.status).toBe(201); expect(r.body.delivery).toBe('email'); expect(r.body.temporaryPassword).toBeUndefined();
    const m = mailTo('invited@apply.test').at(-1)!; expect(m.subject).toMatch(/account is ready/);
    const s = await (await anon()).post('/api/auth/set-password').send({ token: tokenFrom(m), newPassword: 'Counsel2027ok' }); expect(s.body.signedIn).toBe(true);
    expect((await su.post(`/api/admin/users/${r.body.user._id}/resend-invite`)).status).toBe(409);
  });
  it('without email (or if sending fails): the temporary password is shown once, as before', async () => {
    email(false); const su = await loginAs('super@sample.ghlearn.test');
    const r = await su.post('/api/admin/users').send({ fullName: 'Fallback Teacher', email: 'fallback@apply.test', role: 'teacher', schoolId: SCHOOL });
    expect(r.status).toBe(201); expect(r.body.delivery).toBe('shown_once'); expect(r.body.temporaryPassword).toEqual(expect.any(String));
    expect((await (await anon()).post('/api/auth/login').send({ email: 'fallback@apply.test', password: r.body.temporaryPassword })).body.user.mustChangePassword).toBe(true);
  });
  it('a super admin can be created with an optional phone, stored unverified; a bad number is refused', async () => {
    const su = await loginAs('super@sample.ghlearn.test');
    const r = await su.post('/api/admin/users').send({ fullName: 'Owner Admin', email: 'owner@apply.test', role: 'super_admin', phone: '0530506573' });
    expect(r.status).toBe(201); expect(r.body.user.phone).toBe('0530506573'); expect(r.body.user.phoneVerifiedAt).toBeUndefined(); expect(r.body.user.schoolId).toBeUndefined();
    expect((await su.post('/api/admin/users').send({ fullName: 'Bad Phone', email: 'badphone@apply.test', role: 'teacher', schoolId: SCHOOL, phone: '12345' })).status).toBe(422);
  });
  it('self-registration still yields students only', async () => {
    const r = await (await anon()).post('/api/auth/register').send({ fullName: 'New Student', email: 'stud@apply.test', password: 'NewStudent2027', acceptTerms: true, roles: ['teacher'] });
    expect([201, 422]).toContain(r.status); if (r.status === 201) expect(r.body.user.roles).toEqual(['student']);
  });
});
