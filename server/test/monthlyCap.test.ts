import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { useDb, ctx, loginAs } from './setup.js';
import { AiUsage, AiAlert, AuditLog, Notification } from '../src/models/index.js';
import { useTestLlm, testLlm } from './llmfake.js';
import { updateAiSettings, getAiSettings, clearAiSettingsCache } from '../src/services/aiSettings.js';
import { generate, monthStatus, thisMonth, today } from '../src/services/usage.js';
useDb();
/** Monthly hard caps (requests and estimated cost), enforced on the server before any provider call. */
const id = (x: any) => String(x._id);
const SUPER = () => id(ctx.data.users.superAdmin);
const gen = (userId: string) => generate({ system: 's', messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 }, { purpose: 'tutor', userId });
const settle = () => new Promise((r) => setTimeout(r, 80));
const prevMonthDay = () => { const d = new Date(); d.setUTCDate(1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
let defaults: any;
beforeAll(async () => { useTestLlm(); defaults = await getAiSettings(); });
afterEach(async () => {
  await AiUsage.deleteMany({ refId: 'monthly-cap-test' });
  await updateAiSettings({ platformMonthlyRequests: defaults.platformMonthlyRequests, platformMonthlyCostUsd: defaults.platformMonthlyCostUsd, platformDailyRequests: defaults.platformDailyRequests, alertThresholdPct: defaults.alertThresholdPct, perUserDailyRequests: defaults.perUserDailyRequests }, SUPER());
});

describe('monthly AI caps', () => {
  it('defaults come from LLM_MONTHLY_REQUEST_BUDGET / LLM_MONTHLY_COST_BUDGET_USD', () => {
    expect(defaults.platformMonthlyRequests).toBe(10_000); expect(defaults.platformMonthlyCostUsd).toBe(10);
  });
  it('request cap: the call that would pass the monthly limit is refused before the provider and recorded', async () => {
    const used = (await monthStatus()).requests;
    await updateAiSettings({ platformMonthlyRequests: used + 1, platformDailyRequests: 10_000, perUserDailyRequests: 1000 }, SUPER());
    const ama = id(ctx.data.users.ama); testLlm.calls.length = 0;
    await gen(ama);
    await expect(gen(ama)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED', message: expect.stringMatching(/^Monthly AI budget reached/) });
    expect(testLlm.calls.length).toBe(1);
    expect(await AiUsage.countDocuments({ userId: ctx.data.users.ama._id, status: 'budget_exceeded', error: /Monthly AI budget/ })).toBe(1);
  });
  it('cost cap: estimated spend this month at or over the cap refuses new calls; 0 turns the cost cap off; last month does not count', async () => {
    const s = await getAiSettings(); await updateAiSettings({ platformDailyRequests: 10_000, perUserDailyRequests: 1000 }, SUPER());
    // last month: a huge (expensive) call that must not count towards this month
    await AiUsage.create({ day: prevMonthDay(), purpose: 'lesson.generate', feature: 'lessons', status: 'ok', inputTokens: 50_000_000, outputTokens: 50_000_000, refId: 'monthly-cap-test' });
    const before = await monthStatus(); expect(before.month).toBe(thisMonth());
    await updateAiSettings({ platformMonthlyCostUsd: before.estCostUsd + 1 }, SUPER());
    const ama = id(ctx.data.users.ama); await gen(ama); // under the cap
    // this month: about $3.30 at the configured rates pushes spend past the cap
    const needed = Math.ceil(((before.estCostUsd + 1.5 - (await monthStatus()).estCostUsd) * 1e6) / Math.max(s.costOutputPerM, 0.01));
    await AiUsage.create({ day: today(), purpose: 'lesson.generate', feature: 'lessons', status: 'ok', inputTokens: 0, outputTokens: needed, refId: 'monthly-cap-test' });
    testLlm.calls.length = 0;
    await expect(gen(ama)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED', message: expect.stringMatching(/Monthly AI cost cap reached \(about \$[\d.]+ of \$[\d.]+ estimated/) });
    expect(testLlm.calls.length).toBe(0);
    await updateAiSettings({ platformMonthlyCostUsd: 0 }, SUPER());
    await expect(gen(ama)).resolves.toBeTruthy();
  });
  it('alerts super admins when the month passes the threshold', async () => {
    const used = (await monthStatus()).requests; await AiAlert.deleteMany({});
    await updateAiSettings({ platformMonthlyRequests: used + 2, platformDailyRequests: 10_000, perUserDailyRequests: 1000, alertThresholdPct: 50 }, SUPER());
    await gen(id(ctx.data.users.ama)); await settle();
    expect(await AiAlert.countDocuments({ scope: 'platform-month' })).toBeGreaterThan(0);
    expect(await Notification.countDocuments({ userId: ctx.data.users.superAdmin._id, title: /^Monthly AI budget/ })).toBeGreaterThan(0);
  });
  it('admin API: caps are validated, audited and shown with a month meter in the usage report', async () => {
    const s = await loginAs('super@sample.ghlearn.test');
    expect((await s.patch('/api/admin/ai/settings').send({ platformMonthlyRequests: -1 })).status).toBe(422);
    expect((await s.patch('/api/admin/ai/settings').send({ platformMonthlyCostUsd: 'ten' })).status).toBe(422);
    const p = await s.patch('/api/admin/ai/settings').send({ platformMonthlyRequests: 1234, platformMonthlyCostUsd: 7.5 });
    expect(p.status).toBe(200); expect(p.body.changed.sort()).toEqual(['platformMonthlyCostUsd', 'platformMonthlyRequests']);
    await settle(); expect(await AuditLog.countDocuments({ action: 'ai_config.update' })).toBeGreaterThan(0);
    clearAiSettingsCache();
    const u = await s.get('/api/admin/ai/usage'); expect(u.status).toBe(200);
    expect(u.body.budgets.month).toMatchObject({ month: thisMonth(), requestBudget: 1234, costBudgetUsd: 7.5 });
    expect(typeof u.body.budgets.month.estCostUsd).toBe('number'); expect(typeof u.body.budgets.month.pct).toBe('number');
    const op = await loginAs('operator@sample.ghlearn.test'); expect((await op.patch('/api/admin/ai/settings').send({ platformMonthlyRequests: 1 })).status).toBe(403);
  });
});
