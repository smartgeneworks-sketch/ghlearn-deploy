import { test, expect, type Page } from '@playwright/test';
import { login, logout, axe, apiAs, adminNav, U } from './helpers';

/** Admin Phase 2 exit criteria: per-role sidebar (spec §3 order), URL manipulation denied, top bar, axe clean. */
const ALL = ['Overview', 'Schools and Institutions', 'Users and Permissions', 'Academic Structure', 'Curriculum Management', 'Learner Manuals', 'AI Content Generation',
  'Content Review and Publishing', 'Question Bank and Assessments', 'Educational Games', 'Classes and Enrolments', 'Learning Analytics', 'AI Usage and Costs', 'Notifications', 'Audit Logs', 'System Settings', 'Public Website'];
const ROLES: { who: string; email: string; sidebar: string[]; denied: string[]; deniedApi: string[] }[] = [
  { who: 'super admin', email: U.super, sidebar: ALL, denied: [], deniedApi: [] },
  { who: 'school admin', email: U.admin, sidebar: ['Overview', 'Schools and Institutions', 'Users and Permissions', 'Academic Structure', 'Learner Manuals', 'Classes and Enrolments', 'Learning Analytics', 'AI Usage and Costs', 'Notifications', 'Audit Logs'],
    denied: ['/admin/system', '/admin/review', '/admin/lessons', '/admin/questions', '/admin/curriculum', '/admin/website'], deniedApi: ['/api/admin/system', '/api/admin/website/landing', '/api/admin/website/enquiries'] },
  { who: 'curriculum admin', email: U.curriculum, sidebar: ['Overview', 'Academic Structure', 'Curriculum Management', 'Learner Manuals', 'AI Content Generation', 'Question Bank and Assessments', 'Educational Games', 'Learning Analytics', 'AI Usage and Costs'],
    denied: ['/admin/users', '/admin/audit', '/admin/system', '/admin/review', '/admin/schools', '/admin/classes'], deniedApi: ['/api/admin/users', '/api/admin/classes', '/api/admin/audit', '/api/admin/system'] },
  { who: 'system operator', email: U.operator, sidebar: ['Overview', 'AI Usage and Costs', 'System Settings'],
    denied: ['/admin/users', '/admin/audit', '/admin/documents', '/admin/structure', '/admin/lessons', '/admin/analytics', '/admin/schools', '/admin/classes/import'], deniedApi: ['/api/admin/users', '/api/admin/imports', '/api/admin/audit', '/api/analytics', '/api/documents'] },
  { who: 'curriculum editor', email: U.editor, sidebar: ['Overview', 'Learner Manuals', 'AI Content Generation', 'Question Bank and Assessments', 'Educational Games'],
    denied: ['/admin/users', '/admin/audit', '/admin/system', '/admin/analytics', '/admin/ai-usage', '/admin/structure', '/admin/classes', '/admin/curriculum'], deniedApi: ['/api/admin/users', '/api/admin/classes', '/api/admin/system', '/api/admin/ai/usage', '/api/announcements'] },
];
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link');

for (const r of ROLES) {
  test(`${r.who}: sidebar shows exactly the permitted built sections in spec order; other URLs are denied`, async ({ page }) => {
    await login(page, r.email);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    await expect(sidebar(page)).toHaveText(r.sidebar);
    await axe(page, `${r.who} overview`);
    for (const label of r.sidebar.slice(1)) {
      await adminNav(page, label);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText('You do not have access to this page.')).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(label);
      if (r.email === U.super || label === 'System Settings') await axe(page, `${r.who} ${label}`);
    }
    for (const path of r.denied) {
      await page.goto(path);
      await expect(page.getByText('You do not have access to this page.'), path).toBeVisible();
    }
    const api = await apiAs(page);
    for (const p of r.deniedApi) expect((await api.get(p)).status(), p).toBe(403);
  });
}

test('teachers and students never get the admin shell, even by URL', async ({ page }) => {
  for (const email of [U.teacher, U.kofi]) {
    await login(page, email);
    for (const path of ['/admin', '/admin/users', '/admin/system', '/admin/structure']) {
      await page.goto(path);
      await expect(page.getByText('You do not have access to this page.'), `${email} ${path}`).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0);
    }
    const api = await apiAs(page);
    for (const p of ['/api/admin/overview', '/api/admin/search?q=sample', '/api/admin/system']) expect((await api.get(p)).status(), p).toBe(403);
    expect((await api.post('/api/admin/role-assignments', { userId: '0123456789abcdef01234567', role: 'super_admin' })).status()).toBe(403);
  }
});

test('top bar: academic year, global search, notifications, profile menu, account settings; axe clean', async ({ page }) => {
  await login(page, U.super);
  await expect(page.getByText('Academic year 2026/2027')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search the admin panel' }).fill('sample');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/search\?q=sample/);
  await expect(page.getByRole('heading', { name: 'Users', level: 2 })).toBeVisible();
  await axe(page, 'search results');
  await page.getByRole('banner').getByRole('link', { name: /^Notifications/ }).click();
  await expect(page).toHaveURL(/\/admin\/notifications/);
  const menu = page.getByRole('button', { name: /Account menu/ });
  await menu.click(); await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await axe(page, 'profile menu open');
  await page.keyboard.press('Escape'); await expect(menu).toHaveAttribute('aria-expanded', 'false'); await expect(menu).toBeFocused();
  await menu.click(); await page.getByRole('link', { name: 'Account settings' }).click();
  await expect(page.getByRole('heading', { name: 'Account settings', level: 1 })).toBeVisible();
  await page.getByLabel('Current password').fill('x'); await page.getByLabel('New password', { exact: true }).fill('abc'); await page.getByLabel('Confirm new password').fill('abd');
  await page.getByRole('button', { name: 'Change password' }).click(); await expect(page.getByText('The new passwords do not match.')).toBeVisible();
  await axe(page, 'account settings');
  // Sidebar toggle collapses labels on desktop.
  const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar(page).first()).toHaveAttribute('title', 'Overview'); await toggle.click();
  for (const p of ['/admin/users', '/admin/audit', '/admin/system', '/admin/review', '/admin/structure', '/admin/schools']) { await page.goto(p); await axe(page, `super ${p}`); }
  await logout(page);
});

test('overview cards link to filtered pages; DataTable search, sort and paging use the URL', async ({ page }) => {
  await login(page, U.admin);
  const card = page.getByRole('list', { name: 'Key figures' }).getByRole('link', { name: /^Students/ });
  const n = Number((await card.locator('p').nth(1).textContent())!.replace(/\D/g, ''));
  await card.click();
  await expect(page).toHaveURL(/\/admin\/users\?role=student/);
  await expect(page.getByText(`${n} result${n === 1 ? '' : 's'}`)).toBeVisible();
  const rows = page.getByRole('table', { name: 'Users' }).locator('tbody tr');
  for (const t of await rows.allTextContents()) expect(t).toContain('Student');
  await page.getByRole('searchbox', { name: 'Search name or email' }).fill('kofi');
  await expect(page).toHaveURL(/q=kofi/); await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: 'Email' }).click(); await expect(page).toHaveURL(/sort=email/);
  await expect(page.getByRole('columnheader', { name: 'Email' })).toHaveAttribute('aria-sort', 'ascending');
  await axe(page, 'users table');
  await page.goto('/admin/audit?outcome=success&pageSize=50');
  await expect(page.getByRole('table', { name: 'Audit log entries' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Audit log entries' }).locator('tbody')).toContainText('auth.login');
});

test('phone: sidebar opens from the toggle and the admin shell has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await login(page, U.curriculum);
  await expect(page.getByRole('navigation', { name: 'Admin sections' })).toBeHidden();
  await adminNav(page, 'Academic Structure');
  await expect(page.getByRole('heading', { name: 'Academic structure', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await axe(page, 'phone structure');
});
