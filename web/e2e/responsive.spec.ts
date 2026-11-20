import { test, expect } from '@playwright/test';
import { login, axe, U } from './helpers';
const VIEWPORTS = { phone: { width: 360, height: 740 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1366, height: 800 } };
for (const [name, vp] of Object.entries(VIEWPORTS)) {
  test(`layout works on ${name} (${vp.width}px): no horizontal scroll, nav reachable, axe clean`, async ({ page }) => {
    await page.setViewportSize(vp);
    await login(page, U.ama);
    for (const path of ['/learn', '/progress', '/meetings', '/profile', '/notifications']) {
      await page.goto(path); await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} horizontal overflow at ${vp.width}px`).toBeLessThanOrEqual(1);
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await axe(page, `${name} ${path}`);
    }
    await page.screenshot({ path: `test-results/viewport-${name}.png`, fullPage: true });
  });
}
/** Every admin page on phone and tablet: no page-level horizontal scroll, the sidebar is reachable, axe clean (§25). */
const ADMIN = ['/admin', '/admin/schools', '/admin/users', '/admin/classes', '/admin/structure', '/admin/curriculum', '/admin/documents', '/admin/lessons', '/admin/review', '/admin/questions',
  '/admin/games', '/admin/analytics', '/admin/ai-usage', '/admin/notifications', '/admin/audit', '/admin/system', '/admin/system?tab=status', '/admin/processing', '/admin/account'];
for (const name of ['phone', 'tablet'] as const) {
  test(`admin panel on ${name}: every page fits, sidebar reachable, axe clean`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(VIEWPORTS[name]); await login(page, U.super);
    for (const path of ADMIN) {
      await page.goto(path); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} horizontal overflow at ${VIEWPORTS[name].width}px`).toBeLessThanOrEqual(1);
      await axe(page, `${name} ${path}`);
    }
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect(page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'System Settings', exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/admin-${name}.png`, fullPage: true });
  });
  test(`teacher pages on ${name}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[name]); await login(page, U.teacher);
    for (const path of ['/teach', '/teach/assess', '/meetings', '/notifications']) {
      await page.goto(path); await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1); await axe(page, `${name} teacher ${path}`);
    }
  });
}
test('overview on phone: long unbroken warning and job error text wraps instead of widening the page', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.phone); await login(page, U.super);
  await page.route('**/api/admin/overview**', async (route) => { const r = await route.fetch(); const j = await r.json();
    j.warnings = [...(j.warnings ?? []), { level: 'warn', text: 'Job failed: ' + 'unbrokenlongidentifier'.repeat(6) }];
    if (j.activity?.failedJobs) j.activity.failedJobs = [{ _id: 'x', type: 'document.ingest', status: 'failed', attempts: 3, updatedAt: new Date().toISOString(), error: 'Provider error ' + 'averylongunbrokentoken'.repeat(8) }];
    await route.fulfill({ response: r, json: j }); });
  await page.goto('/admin'); await expect(page.getByText(/unbrokenlongidentifier/)).toBeVisible(); await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
test('PWA: manifest and service worker are served', async ({ page, request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json(); expect(m.short_name).toBe('GH Learn'); expect(m.icons.length).toBeGreaterThan(1);
  await page.goto('/login'); expect(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active)).toBe(true);
});
