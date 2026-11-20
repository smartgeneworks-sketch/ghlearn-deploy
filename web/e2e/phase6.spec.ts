import { test, expect, type Page } from '@playwright/test';
import { login, axe, adminNav, subjectId, U } from './helpers';
import { manualPdf } from './pdf';

/** Phase 6: Document Processing Monitor (§10): statuses, failed-job inspector, safe retry, purge, access. */
const dialog = (page: Page) => page.getByRole('alertdialog');
async function uploadApi(page: Page, title: string, buffer: Buffer) {
  const tok = (await (await page.request.get('/api/auth/csrf')).json()).csrfToken as string;
  const r = await page.request.post('/api/documents/upload', { headers: { 'X-CSRF-Token': tok, Origin: 'http://localhost:4173' },
    multipart: { subjectId: await subjectId(page, 'BIO'), title, file: { name: `${title}.pdf`, mimeType: 'application/pdf', buffer } } });
  expect(r.status(), await r.text()).toBe(201); return (await r.json()) as { document: { _id: string }; jobId: string };
}
async function settled(page: Page, docId: string) {
  await expect.poll(async () => (await (await page.request.get(`/api/jobs?documentId=${docId}`)).json()).items[0]?.status, { timeout: 30_000 }).toMatch(/^(failed|awaiting_validation|completed)$/);
}

test('curriculum admin finds a failed job, inspects it and retries it safely', async ({ page }) => {
  await login(page, U.curriculum);
  const stamp = Date.now();
  const broken = await uploadApi(page, `E2E broken ${stamp}`, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(`this is not really a PDF body ${stamp}`)]));
  const good = await uploadApi(page, `E2E good ${stamp}`, manualPdf(`monitor ${stamp}`));
  await settled(page, broken.document._id); await settled(page, good.document._id);

  await adminNav(page, 'Learner Manuals'); await page.getByRole('link', { name: 'Document processing monitor' }).click();
  await expect(page.getByRole('heading', { name: 'Document processing monitor', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Processing health' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Document processing jobs' });
  const goodRow = table.getByRole('row', { name: new RegExp(`E2E good ${stamp}`) });
  await expect(goodRow).toContainText('Awaiting validation'); await expect(goodRow).toContainText('Text only (no embedding provider)'); await expect(goodRow).toContainText('Curriculum Admin');
  await axe(page, 'processing monitor');

  await page.getByLabel('Status', { exact: true }).selectOption('failed');
  await expect(page).toHaveURL(/status=failed/);
  const row = table.getByRole('row', { name: new RegExp(`E2E broken ${stamp}`) });
  await expect(row).toContainText('Failed'); await expect(row).toContainText(/PDF could not be parsed/); await expect(goodRow).toHaveCount(0);
  await row.getByRole('link', { name: /Inspect job/ }).click();

  await expect(page.getByRole('heading', { name: /Processing job/, level: 1 })).toBeVisible();
  await expect(page.getByText(/Failed while extracting/)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Errors by attempt' })).toContainText('PDF could not be parsed');
  await expect(page.getByRole('navigation', { name: /breadcrumb/i }).getByRole('link', { name: 'Document processing monitor' })).toBeVisible();
  await axe(page, 'failed-job inspector');
  await expect(page.getByRole('button', { name: 'Cancel job' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog(page)).toContainText('no duplicates are created');
  await dialog(page).getByRole('button', { name: 'Queue retry' }).click();
  await expect(page).not.toHaveURL(new RegExp(broken.jobId));
  // the stored file is still broken, so the retry fails again, permanently, and is linked to the original
  await expect(page.getByText(/Failed while extracting/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Retry of')).toBeVisible();
  await page.getByRole('link', { name: broken.jobId.slice(-8) }).click();
  await expect(page.getByText('Retried as')).toBeVisible();
  await expect(page.getByText(/Retry is not available: A newer processing run exists/)).toBeVisible();
});

test('system operator reaches the monitor from System status and previews a purge', async ({ page }) => {
  await login(page, U.operator); await adminNav(page, 'System Settings');
  await page.getByRole('tab', { name: 'Status' }).click();
  await page.getByRole('link', { name: 'Document processing monitor' }).click();
  await expect(page.getByRole('heading', { name: 'Document processing monitor', level: 1 })).toBeVisible();
  await expect(page.getByText(/Worker \(this instance\)/)).toBeVisible();
  // operators have no manuals access: titles are shown as text, not links
  await expect(page.getByRole('table', { name: 'Document processing jobs' }).getByRole('link', { name: /E2E good/ })).toHaveCount(0);
  await page.getByLabel('Older than (days)').fill('0'); await expect(page.getByText('Enter 1 to 3650')).toBeVisible();
  await page.getByLabel('Older than (days)').fill('30'); await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('No jobs match.')).toBeVisible();
  await axe(page, 'processing monitor (operator)');
});

test('editors, teachers and school admins cannot open the monitor (UI and API)', async ({ page }) => {
  for (const who of [U.editor, U.teacher, U.admin]) {
    await login(page, who);
    expect((await page.request.get('/api/jobs')).status(), who).toBe(403);
    if (who === U.teacher) continue; // teachers have no admin shell
    await page.goto('/admin/processing'); await expect(page.getByText('You do not have access to this page.')).toBeVisible();
  }
});

test('monitor and inspector work at phone width (no page-level horizontal scroll, axe clean)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await login(page, U.curriculum);
  await page.goto('/admin/processing'); await expect(page.getByRole('heading', { name: 'Document processing monitor', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await axe(page, 'monitor 360px');
  await page.getByRole('link', { name: /Inspect job/ }).first().click();
  await expect(page.getByRole('heading', { name: /Processing job/, level: 1 })).toBeVisible(); await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await axe(page, 'inspector 360px');
});
