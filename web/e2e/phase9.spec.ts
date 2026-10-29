import { test, expect, type Page } from '@playwright/test';
import { login, logout, axe, adminNav, subjectId, apiAs, U } from './helpers';

/** Phase 9: Learning Analytics (§16), AI Usage and Costs (§17), Notifications (§18), Audit Logs (§19). AI is the scripted test model. */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);
const stamp = Date.now();
const dl = async (page: Page, button: () => Promise<void>) => { const [d] = await Promise.all([page.waitForEvent('download'), button()]); return d.suggestedFilename(); };

test('student: marks a lesson as completed and sets notification preferences', async ({ page }) => {
  await login(page, U.ama); const bio = await subjectId(page, 'BIO');
  const res = await (await page.request.get(`/api/subjects/${bio}/resources`)).json().catch(() => null);
  const id = res?.items?.find((r: any) => r.title.startsWith('SAMPLE: Cells'))?._id;
  test.skip(!id, 'sample lesson not listed');
  await page.goto(`/learn/${bio}/r/${id}`);
  const done = page.getByRole('button', { name: 'Mark as completed' }); const undo = page.getByRole('button', { name: 'Mark as not completed' });
  if (await undo.isVisible().catch(() => false)) { await undo.click(); }
  await done.click(); await expect(page.getByText('You marked this lesson as completed.')).toBeVisible(); await axe(page, 'lesson completed');
  await page.goto('/notifications'); await expect(page.getByRole('heading', { name: 'Notification preferences' })).toBeVisible();
  const sec = page.getByRole('checkbox', { name: 'Account and security in the app' }); await expect(sec).toBeDisabled(); await expect(sec).toBeChecked();
  const learning = page.getByRole('checkbox', { name: 'Assignments and marking in the app' }); const before = await learning.isChecked();
  await learning.click(); await expect(learning).toBeChecked({ checked: !before }); await learning.click(); await expect(learning).toBeChecked({ checked: before });
  await axe(page, 'student notifications');
});

test('super admin: learning analytics with filters, labels, exports and student-level view on request', async ({ page }) => {
  await login(page, U.super); await adminNav(page, 'Learning Analytics');
  await expect(page.getByRole('heading', { name: 'Learning Analytics', level: 1 })).toBeVisible();
  for (const h of ['Enrolment', 'Subject selection', 'Active users', 'Lesson completion', 'Exercise completion', 'Assessment results', 'Topic performance', 'Misconceptions (most-missed questions)', 'Objectives needing remediation', 'Game participation', 'AI tutor usage', 'Content quality and review status', 'AI cost (estimate)'])
    await expect(page.getByRole('heading', { name: new RegExp(`^${h.replace(/[()]/g, '\\$&')}`) })).toBeVisible();
  await expect(page.getByRole('heading', { name: /AI cost \(estimate\)/ }).getByText('Estimate')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Objectives needing remediation/ }).getByText('Rule-based suggestion')).toBeVisible();
  for (const l of ['School', 'Academic year', 'Class', 'Level', 'Learning Area', 'Subject', 'Topic', 'From', 'To']) await expect(page.getByLabel(l, { exact: true })).toBeVisible();
  await axe(page, 'learning analytics');
  await page.getByLabel('Subject', { exact: true }).selectOption({ label: 'Biology' }); await expect(page).toHaveURL(/subjectId=/);
  const card = page.locator('div.rounded-xl').filter({ has: page.getByRole('heading', { name: /^Topic performance/ }) });
  expect(await dl(page, () => card.getByRole('button', { name: 'CSV' }).click())).toMatch(/analytics-topic_performance.*\.csv$/);
  expect(await dl(page, () => card.getByRole('button', { name: 'Excel' }).click())).toMatch(/\.xlsx$/);
  await page.getByRole('button', { name: 'Show students' }).click(); await expect(page.getByText(/Rule: average mastery below 50 %/)).toBeVisible();
  await axe(page, 'learning analytics students');
});

test('AI usage and costs: estimates labelled, health check without the LLM, settings saved and audited', async ({ page }) => {
  await login(page, U.super); await adminNav(page, 'AI Usage and Costs');
  await expect(page.getByRole('heading', { name: 'AI Usage and Costs', level: 1 })).toBeVisible();
  await expect(page.getByText(/Estimated cost, not a bill/)).toBeVisible(); await expect(page.getByRole('heading', { name: 'By feature' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'By school' })).toBeVisible(); await expect(page.getByRole('heading', { name: 'By user' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Language model \(LLM\)/ })).not.toBeChecked(); // opt-in: costs a request
  await page.getByRole('button', { name: 'Run health check' }).click();
  const list = page.locator('li').filter({ hasText: 'Object storage' }); await expect(list.getByText('OK', { exact: true })).toBeVisible();
  await expect(page.locator('li').filter({ hasText: 'Illustration' }).getByText(/Not configured|Failed/)).toBeVisible();
  await expect(page.getByText('GEMINI_API_KEY', { exact: true })).toBeVisible(); await expect(page.getByText(/Values are never shown/)).toBeVisible();
  const f = page.getByLabel('Requests per user per day'); const old = await f.inputValue();
  await f.fill(String(Number(old) + 1)); await page.getByRole('button', { name: 'Save settings' }).click(); await expect(page.getByText(/Saved: perUserDailyRequests/)).toBeVisible();
  await f.fill(old); await page.getByRole('button', { name: 'Save settings' }).click(); await expect(page.getByText(/Saved: perUserDailyRequests/)).toBeVisible();
  expect(await dl(page, () => page.locator('div.rounded-xl').filter({ has: page.getByRole('heading', { name: 'By feature' }) }).getByRole('button', { name: 'Excel' }).click())).toMatch(/\.xlsx$/);
  await axe(page, 'ai usage');
  await logout(page); await login(page, U.operator); await adminNav(page, 'AI Usage and Costs');
  await expect(page.getByText(/Read-only: only a Super Admin/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'By user' })).toHaveCount(0); // operators see no per-user figures
});

test('school admin: announcement with audience and period, privacy check, delivery, withdraw', async ({ page, browser }) => {
  const title = `Sports day ${stamp}`;
  await login(page, U.admin); await adminNav(page, 'Notifications'); await page.getByRole('tab', { name: 'Announcements' }).click();
  await expect(page.getByRole('heading', { name: 'New announcement' })).toBeVisible(); await axe(page, 'announcements');
  await page.getByLabel('Title').fill(title); await page.getByLabel('Message').fill('Congratulations to Ama Mensah on winning the race.');
  await page.getByRole('button', { name: 'Save draft' }).click(); await expect(page.getByText(/contains the name of a student/)).toBeVisible();
  await page.getByLabel('Message').fill('Sports day is on Friday. Bring your house colours.');
  await page.getByRole('checkbox', { name: 'Teacher', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Count recipients' }).click(); await expect(page.getByText(/\d+ recipient\(s\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click(); await expect(page.getByText('Draft saved.')).toBeVisible();
  const row = page.locator('li').filter({ hasText: title }); await row.getByRole('button', { name: 'Details' }).click();
  await row.getByRole('button', { name: 'Publish now' }).click();
  await expect(async () => { await page.reload(); await page.getByRole('tab', { name: 'Announcements' }).click(); const r = page.locator('li').filter({ hasText: title });
    await r.getByRole('button', { name: 'Details' }).click(); await expect(r.getByRole('cell', { name: 'delivered' }).first()).toBeVisible({ timeout: 2000 }); }).toPass({ timeout: 30_000 });
  await axe(page, 'announcement detail');
  const s = await browser.newPage(); await login(s, U.ama); await s.goto('/notifications'); await expect(s.getByText(title)).toBeVisible(); await s.close();
  const r2 = page.locator('li').filter({ hasText: title }); await r2.getByRole('button', { name: 'Withdraw' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Withdraw', exact: true }).click(); await expect(r2.getByText(/Withdrawn/).first()).toBeVisible();
});

test('audit logs: resource-type filter and audited Excel export; restricted to admins', async ({ page }) => {
  await login(page, U.super); await adminNav(page, 'Audit Logs');
  await page.getByLabel('Resource type').selectOption('announcement'); await expect(page.getByRole('cell', { name: /announcement\.(withdraw|publish|create)/ }).first()).toBeVisible();
  expect(await dl(page, () => page.getByRole('button', { name: 'Export Excel' }).click())).toMatch(/audit-.*\.xlsx$/);
  await axe(page, 'audit logs');
  const api = await apiAs(page); const r = await (await api.get('/api/admin/audit?action=report.export&pageSize=5')).json();
  expect(r.items.some((i: any) => i.meta?.report === 'audit' && i.meta?.format === 'xlsx')).toBe(true);
  await logout(page); await login(page, U.editor);
  expect((await page.request.get('/api/admin/audit')).status()).toBe(403); expect((await page.request.get('/api/admin/audit/export?format=csv')).status()).toBe(403);
});
