import { describe, it, expect, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { useDb, ctx, loginAs } from './setup.js';
import { User, Lesson, LessonReview, CurriculumDocument, AiUsage, StudentProfile, Question } from '../src/models/index.js';
import { Attempt, XpEvent } from '../src/models/assess.js';
import { bucketKeys, unitFor } from '../src/services/adminCharts.js';
import { estCost } from '../src/services/adminOverview.js';
useDb();
const id = (x: any) => String(x._id);
const E = { super: 'super@sample.ghlearn.test', school: 'admin@sample.ghlearn.test', curriculum: 'curriculum@sample.ghlearn.test', operator: 'operator@sample.ghlearn.test', editor: 'editor@sample.ghlearn.test', reviewer: 'rev3@t.gh' };
const days = (n: number) => new Date(Date.now() - n * 86400_000);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const charts = async (email: string, qs = '') => { const r = await (await loginAs(email)).get(`/api/admin/overview/charts${qs}`); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body; };
const chart = (b: any, k: string) => b.charts.find((c: any) => c.key === k);
const ser = (c: any, name: string) => c.series.find((s: any) => s.name === name).values as number[];
const range30 = { $gte: days(30.01), $lte: new Date(Date.now() + 60_000) };

beforeAll(async () => {
  const { hashPassword } = await import('../src/services/auth.js');
  await User.create({ email: E.reviewer, fullName: 'Rev Three', roles: ['content_reviewer'], passwordHash: await hashPassword('SamplePass2026') });
  const { kofi, ama, editor } = ctx.data.users as any; const school = ctx.data.school._id;
  // Attempts: Ama (Biology) 80 and 60, Kofi (Economics) 50, one unfinished; one old attempt outside the window.
  await Attempt.create([
    { userId: ama._id, subjectId: ctx.data.bio._id, schoolId: school, mode: 'practice', status: 'marked', pct: 80, startedAt: days(2), submittedAt: days(2) },
    { userId: ama._id, subjectId: ctx.data.bio._id, schoolId: school, mode: 'timed', status: 'submitted', pct: 60, startedAt: days(3), submittedAt: days(3) },
    { userId: kofi._id, subjectId: ctx.data.econ._id, schoolId: school, mode: 'practice', status: 'marked', pct: 50, startedAt: days(5), submittedAt: days(5) },
    { userId: kofi._id, subjectId: ctx.data.econ._id, schoolId: school, mode: 'practice', status: 'in_progress', startedAt: days(1) },
    { userId: kofi._id, subjectId: ctx.data.econ._id, schoolId: school, mode: 'practice', status: 'marked', pct: 10, startedAt: days(90), submittedAt: days(90) }]);
  await XpEvent.create([{ userId: ama._id, source: 't', refId: 'a1', xp: 5, createdAt: days(4) }, { userId: kofi._id, source: 't', refId: 'k1', xp: 5, createdAt: days(4) }, { userId: ama._id, source: 't', refId: 'a2', xp: 5, createdAt: days(4) }]);
  await AiUsage.create([{ day: 'x', purpose: 'lesson', status: 'ok', inputTokens: 1000, outputTokens: 500, createdAt: days(1) }, { day: 'x', purpose: 'tutor', status: 'error', inputTokens: 200, outputTokens: 0, createdAt: days(2) }]);
  const l1 = await Lesson.create({ title: 'Chart lesson A', subjectId: ctx.data.bio._id, status: 'published', publishedAt: days(1), createdBy: editor._id, createdAt: days(6) });
  const l2 = await Lesson.create({ title: 'Chart lesson B', subjectId: ctx.data.econ._id, status: 'in_review', createdBy: editor._id });
  await Lesson.collection.updateOne({ _id: l2._id }, { $set: { updatedAt: days(10) } }); // waiting > 7 days
  await LessonReview.create([{ lessonId: l1._id, action: 'submit', createdAt: days(3) }, { lessonId: l1._id, action: 'approve', createdAt: days(2) }, { lessonId: l1._id, action: 'publish', createdAt: days(1) }, { lessonId: l2._id, action: 'submit' }]);
  await CurriculumDocument.create({ title: 'Failed manual', processingStatus: 'failed', docType: 'learner_manual', subjectId: ctx.data.bio._id });
});

describe('bucketing', () => {
  it('uses day/week/month buckets with zero-filled UTC keys', () => {
    expect(bucketKeys(new Date('2026-09-01T10:00:00Z'), new Date('2026-09-10T23:59:59Z'), 'day')).toHaveLength(10);
    expect(unitFor(days(30), new Date())).toBe('day'); expect(unitFor(days(120), new Date())).toBe('week'); expect(unitFor(days(400), new Date())).toBe('month');
    expect(bucketKeys(new Date('2026-09-02T00:00:00Z'), new Date('2026-09-20T00:00:00Z'), 'week')).toEqual(['2026-08-31', '2026-09-07', '2026-09-14']);
    expect(bucketKeys(new Date('2026-01-15T00:00:00Z'), new Date('2026-03-01T00:00:00Z'), 'month')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });
  it('validates ranges', async () => {
    const s = await loginAs(E.super);
    expect((await s.get('/api/admin/overview/charts?from=2026-05-01&to=2026-04-01')).status).toBe(422);
    expect((await s.get('/api/admin/overview/charts?from=2020-01-01&to=2026-04-01')).status).toBe(422);
    const b = (await s.get('/api/admin/overview/charts?from=2026-09-01&to=2026-09-10')).body; expect(b.unit).toBe('day'); expect(b.buckets).toHaveLength(10); // date-only "to" covers the whole day
    expect((await (await loginAs('kofi@sample.ghlearn.test')).get('/api/admin/overview/charts')).status).toBe(403);
  });
});

describe('charts match direct database counts', () => {
  it('super admin: every series equals the raw query', async () => {
    const b = await charts(E.super);
    expect(sum(ser(chart(b, 'registrations'), 'Students'))).toBe(await User.countDocuments({ roles: 'student', createdAt: range30 }));
    expect(sum(ser(chart(b, 'registrations'), 'Staff'))).toBe(await User.countDocuments({ roles: { $ne: 'student' }, createdAt: range30 }));
    expect(sum(chart(b, 'processing').items.map((i: any) => i.value))).toBe(await CurriculumDocument.countDocuments({ duplicateOf: null }));
    expect(chart(b, 'processing').items.find((i: any) => i.label === 'Failed').value).toBe(await CurriculumDocument.countDocuments({ duplicateOf: null, processingStatus: 'failed' }));
    expect(chart(b, 'processing').items.map((i: any) => i.label)).toEqual(['Not processed', 'Queued', 'Extracting', 'OCR processing', 'Mapping curriculum', 'Indexing', 'Awaiting validation', 'Completed', 'Failed']);
    expect(sum(ser(chart(b, 'uploads'), 'Uploaded or imported'))).toBe(await CurriculumDocument.countDocuments({ duplicateOf: null, createdAt: range30 }));
    expect(sum(ser(chart(b, 'lessons'), 'Generated'))).toBe(await Lesson.countDocuments({ createdAt: range30 }));
    expect(sum(ser(chart(b, 'lessons'), 'Published'))).toBe(await Lesson.countDocuments({ publishedAt: range30 }));
    expect(sum(ser(chart(b, 'review'), 'Submitted for review'))).toBe(await LessonReview.countDocuments({ action: 'submit', createdAt: range30 }));
    expect(sum(ser(chart(b, 'review'), 'Reviewed'))).toBe(await LessonReview.countDocuments({ action: { $in: ['approve', 'request_changes'] }, createdAt: range30 }));
    expect(chart(b, 'review').note).toContain(`${await Lesson.countDocuments({ status: 'in_review' })} lesson(s) and ${await Question.countDocuments({ status: 'in_review' })} question(s)`);
    expect(sum(ser(chart(b, 'exercises'), 'Started'))).toBe(await Attempt.countDocuments({ startedAt: range30 }));
    expect(sum(ser(chart(b, 'exercises'), 'Completed'))).toBe(await Attempt.countDocuments({ startedAt: range30, status: { $ne: 'in_progress' } }));
    const perf = chart(b, 'performance').items;
    const bio = await Attempt.aggregate([{ $match: { subjectId: ctx.data.bio._id, status: { $in: ['submitted', 'marked'] }, submittedAt: range30 } }, { $group: { _id: null, a: { $avg: '$pct' }, n: { $sum: 1 } } }]);
    expect(perf.find((i: any) => i.label === 'Biology')).toMatchObject({ value: Math.round(bio[0].a), n: bio[0].n });
    expect(sum(ser(chart(b, 'aiRequests'), 'Requests'))).toBe(await AiUsage.countDocuments({ createdAt: range30 }));
    expect(sum(ser(chart(b, 'aiRequests'), 'Errors'))).toBe(await AiUsage.countDocuments({ createdAt: range30, status: { $ne: 'ok' } }));
    const tok = await AiUsage.aggregate([{ $match: { createdAt: range30 } }, { $group: { _id: null, i: { $sum: '$inputTokens' }, o: { $sum: '$outputTokens' } } }]);
    expect(sum(ser(chart(b, 'aiCost'), 'Estimated cost'))).toBeCloseTo(estCost(tok[0].i, tok[0].o), 3);
    expect(chart(b, 'aiCost').estimate).toBe(true); expect(chart(b, 'aiCost').title).toMatch(/Estimated/); expect(chart(b, 'aiCost').note).toMatch(/Estimate, not a bill/);
    const enrol = chart(b, 'enrolment').items;
    for (const it of enrol.slice(0, 3)) { const s = await (await import('../src/models/index.js')).Subject.findOne({ name: it.label }); expect(it.value).toBe(await StudentProfile.countDocuments({ subjectIds: s!._id })); }
    // Active users: 4 days ago, exactly Ama and Kofi earned XP (no sign-ins recorded that day).
    const k = new Date(days(4)).toISOString().slice(0, 10); expect(ser(chart(b, 'activeUsers'), 'Distinct active users')[b.buckets.indexOf(k)]).toBe(2);
  });
  it('school admin: pinned to own school, learner charts only for that school, no AI or review charts', async () => {
    const b = await charts(E.school);
    expect(b.scope).toBe('school');
    expect(b.charts.map((c: any) => c.key)).toEqual(['registrations', 'activeUsers', 'enrolment', 'processing', 'uploads', 'exercises', 'performance']);
    expect(sum(ser(chart(b, 'registrations'), 'Students'))).toBe(await User.countDocuments({ roles: 'student', schoolId: ctx.data.school._id, createdAt: range30 }));
    expect(sum(ser(chart(b, 'exercises'), 'Started'))).toBe(await Attempt.countDocuments({ schoolId: ctx.data.school._id, startedAt: range30 }));
    expect(chart(b, 'registrations').link).not.toContain('schoolId');
    expect((await (await loginAs(E.school)).get(`/api/admin/overview/charts?schoolId=${new mongoose.Types.ObjectId()}`)).status).toBe(403);
  });
  it('subject filter narrows content and learner charts; performance only appears with real data', async () => {
    const b = await charts(E.super, `?subjectId=${id(ctx.data.bio)}`);
    expect(sum(ser(chart(b, 'lessons'), 'Generated'))).toBe(await Lesson.countDocuments({ subjectId: ctx.data.bio._id, createdAt: range30 }));
    expect(sum(ser(chart(b, 'exercises'), 'Started'))).toBe(await Attempt.countDocuments({ subjectId: ctx.data.bio._id, startedAt: range30, userId: { $in: await StudentProfile.find({ subjectIds: ctx.data.bio._id }).distinct('userId') } }));
    expect(chart(b, 'lessons').link).toContain(`subjectId=${id(ctx.data.bio)}`);
    expect(chart(b, 'processing').items[0].link).toContain(`subjectId=${id(ctx.data.bio)}`);
    expect(chart(b, 'registrations').series.map((s: any) => s.name)).toEqual(['Students']);
    const chem = await charts(E.super, `?subjectId=${id(ctx.data.chem)}`); expect(chart(chem, 'performance')).toBeUndefined();
  });
  it('permission-filtered chart sets', async () => {
    const keys = async (e: string) => (await charts(e)).charts.map((c: any) => c.key);
    expect(await keys(E.operator)).toEqual(['aiRequests', 'aiCost']);
    expect(await keys(E.curriculum)).toEqual(['processing', 'uploads', 'lessons', 'aiRequests', 'aiCost']);
    expect(await keys(E.editor)).toEqual(['processing', 'uploads', 'lessons']);
    expect(await keys(E.reviewer)).toEqual(['processing', 'uploads', 'lessons', 'review', 'aiRequests', 'aiCost']);
  });
});

describe('links, feeds and warnings', () => {
  it('cards and activity links carry the current filters to pages that support them', async () => {
    const s = await loginAs(E.super);
    const o = (await s.get(`/api/admin/overview?subjectId=${id(ctx.data.bio)}&schoolId=${id(ctx.data.school)}&from=2026-09-01&to=2026-10-30`)).body;
    const card = (k: string) => o.cards.find((c: any) => c.key === k).link as string;
    expect(card('students')).toBe(`/admin/users?role=student&schoolId=${id(ctx.data.school)}`);
    expect(card('pendingReviews')).toBe(`/admin/review?subjectId=${id(ctx.data.bio)}`);
    expect(card('manuals')).toContain(`subjectId=${id(ctx.data.bio)}`);
    expect(card('aiRequests')).toBe('/admin/analytics?from=2026-09-01&to=2026-10-30');
    expect(o.links.audit).toBe('/admin/audit?from=2026-09-01&to=2026-10-30');
    const ca = (await (await loginAs(E.curriculum)).get('/api/admin/overview')).body;
    expect(ca.cards.find((c: any) => c.key === 'failedJobs').link).toBe('/admin/documents?processingStatus=failed');
    expect(ca.cards.find((c: any) => c.key === 'published').link).toBe('/admin/lessons?status=published');
  });
  it('activity feeds: generated content includes lessons and AI questions, approvals oldest first, admin actions exclude sign-ins', async () => {
    const o = (await (await loginAs(E.super)).get('/api/admin/overview')).body;
    expect(o.activity.generated.some((g: any) => g.kind === 'lesson' && g.title === 'Chart lesson B')).toBe(true);
    expect(o.activity.approvals[0].title).toBe('Chart lesson B');
    expect(o.activity.audit.every((x: any) => !x.action.startsWith('auth.login'))).toBe(true);
    const sa = (await (await loginAs(E.school)).get('/api/admin/overview')).body;
    expect(sa.activity.generated).toBeUndefined(); expect(sa.activity.approvals).toBeUndefined();
  });
  it('warnings are computed from data and shown only to roles that can act', async () => {
    const texts = async (e: string) => (await (await loginAs(e)).get('/api/admin/overview')).body.warnings.map((w: any) => w.text).join(' | ');
    const failed = await CurriculumDocument.countDocuments({ processingStatus: 'failed', duplicateOf: null });
    expect(await texts(E.curriculum)).toContain(`${failed} document(s) failed processing`);
    expect(await texts(E.school)).not.toContain('failed processing');
    expect(await texts(E.reviewer)).toContain('waited more than 7 days for review');
    expect(await texts(E.operator)).not.toContain('waited more than 7 days');
    const notOnb = (await User.countDocuments({ roles: 'student', status: 'active', schoolId: ctx.data.school._id })) - (await StudentProfile.countDocuments({ userId: { $in: await User.find({ roles: 'student', status: 'active', schoolId: ctx.data.school._id }).distinct('_id') } }));
    if (notOnb > 0) expect(await texts(E.school)).toContain(`${notOnb} student account(s) have not finished onboarding`);
    const w = (await (await loginAs(E.curriculum)).get('/api/admin/overview')).body.warnings;
    expect(w.every((x: any) => ['warning', 'info'].includes(x.level))).toBe(true);
  });
});
