import { test, expect, type Page } from '@playwright/test';
import { login, axe, apiAs, adminNav, U } from './helpers';
import { buildPdf, manualPdf } from './pdf';

/** Phase 5: Curriculum Management (versions lifecycle) and the Learner Manuals library (§9). */
const dialog = (page: Page) => page.getByRole('alertdialog');
const confirm = (page: Page, name: string | RegExp) => dialog(page).getByRole('button', { name, exact: typeof name === 'string' }).click();
const file = (name: string, buffer: Buffer, mimeType = 'application/pdf') => ({ name, mimeType, buffer });
let docUrl = '';

test('curriculum admin manages a curriculum version through its lifecycle', async ({ page }) => {
  await login(page, U.curriculum); await adminNav(page, 'Curriculum Management');
  await expect(page.getByRole('heading', { name: 'Curriculum Management', level: 1 })).toBeVisible();
  const table = page.getByRole('table', { name: 'Curriculum versions' });
  await expect(table.getByRole('row', { name: /SHS 2023\+/ })).toContainText('active'); await axe(page, 'curriculum versions list');
  await page.getByRole('button', { name: 'New curriculum version' }).click();
  await page.getByRole('button', { name: 'Create draft' }).click(); await expect(page.getByText(/at least 2 characters|Too small/i).first()).toBeVisible(); // validated before sending
  await page.getByLabel('Code', { exact: true }).fill('E2E 2027'); await page.getByLabel('Name', { exact: true }).fill('E2E curriculum 2027 (test)');
  await page.getByLabel('Effective from').fill('2027-09-01'); await page.getByLabel('Effective to').fill('2027-01-01');
  await page.getByRole('button', { name: 'Create draft' }).click(); await expect(page.getByText('The end date must be after the start date')).toBeVisible();
  await page.getByLabel('Effective to').fill('');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('heading', { name: /E2E 2027 · E2E curriculum 2027/, level: 1 })).toBeVisible(); await expect(page.getByText('draft', { exact: true })).toBeVisible();
  await axe(page, 'curriculum version detail');
  await page.getByRole('button', { name: 'Edit details' }).click(); await page.getByLabel('Publisher').fill('E2E Publisher'); await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('E2E Publisher')).toBeVisible();
  await page.getByRole('button', { name: 'Activate' }).click(); await confirm(page, 'Activate'); await expect(page.getByText('active', { exact: true })).toBeVisible();
  // link a subject: archiving is then blocked until it moves back
  await page.getByRole('checkbox', { name: /^Chemistry/ }).check(); await page.getByRole('button', { name: 'Link 1 subject' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Chemistry (' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive' })).toBeDisabled(); await expect(page.getByText(/first link its 1 active subject/)).toBeVisible();
  const api = await apiAs(page); const versions = (await (await api.get('/api/curriculum/versions?q=SHS')).json()).items; const shs = versions.find((v: any) => v.code === 'SHS 2023+');
  const chem = (await (await api.get('/api/config/subjects')).json()).items.find((s: any) => s.name === 'Chemistry');
  expect((await api.post(`/api/curriculum/versions/${shs._id}/subjects`, { subjectIds: [chem._id] })).status()).toBe(200);
  await page.reload(); await page.getByRole('button', { name: 'Archive' }).click(); await confirm(page, 'Archive'); await expect(page.getByText('archived', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore as draft' }).click(); await confirm(page, 'Restore as draft'); await expect(page.getByText('draft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click(); await expect(dialog(page).getByRole('button', { name: 'Delete' })).toBeDisabled();
  await dialog(page).getByLabel(/Type E2E 2027 to confirm/).fill('E2E 2027'); await confirm(page, 'Delete');
  await expect(page).toHaveURL(/\/admin\/curriculum$/); await expect(table.getByRole('row', { name: /E2E 2027/ })).toHaveCount(0);
});

test('editor uploads a manual with real progress, edits metadata, inspects extraction, previews and downloads', async ({ page }) => {
  await login(page, U.editor); await adminNav(page, 'Learner Manuals');
  await expect(page.getByRole('heading', { name: 'Learner Manuals', level: 1 })).toBeVisible(); await axe(page, 'manuals library');
  const up = page.getByRole('region', { name: 'Upload a learner manual' }); const input = up.getByLabel(/^File \(PDF, DOCX, TXT or CSV/);
  // client-side validation
  await input.setInputFiles(file('virus.exe', Buffer.from('MZ'), 'application/octet-stream')); await expect(page.getByText(/not a supported format/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload & process' })).toBeDisabled();
  // real progress: throttle the upload so the progress bar is observable
  const big = Buffer.from(Array.from({ length: 9000 }, (_, i) => `Line ${i}: Forces and motion notes for the E2E large text upload.`).join('\n'));
  await input.setInputFiles(file('e2e-large-notes.txt', big, 'text/plain'));
  await up.getByLabel('Title (optional)').fill('E2E large notes');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: -1, uploadThroughput: 150 * 1024 });
  await page.getByRole('button', { name: 'Upload & process' }).click();
  const bar = page.getByRole('progressbar');
  await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow').catch(() => '0')), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(page.getByText(/Uploaded\. Processing has been queued/)).toBeVisible({ timeout: 30_000 });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  // a PDF with metadata
  await input.setInputFiles(file('e2e-physics.pdf', manualPdf('physics')));
  await up.getByLabel('Title (optional)').fill('E2E Physics manual');
  await up.getByLabel('Subject (optional)').selectOption({ label: 'Physics (PHY)' });
  await up.getByLabel('Curriculum version').selectOption({ label: 'SHS 2023+ · SHS curriculum 2023 (sample)' });
  await up.getByLabel('Licensing status').selectOption('open_licence'); await up.getByLabel('Publication year').fill('2024'); await up.getByLabel('Tags').fill('physics, e2e');
  await page.getByRole('button', { name: 'Upload & process' }).click();
  await page.getByRole('link', { name: 'Open E2E Physics manual' }).click(); await expect(page).toHaveURL(/\/admin\/documents\/[a-f0-9]{24}$/); docUrl = page.url();
  await expect(page.getByText('processing: indexed').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('approval: unverified').first()).toBeVisible(); await expect(page.getByText('Only Content Reviewers can change approval.')).toBeVisible();
  await axe(page, 'manual detail');
  // extraction inspector: page-level text
  await page.getByRole('button', { name: 'Show page 2' }).click(); await expect(page.getByLabel('Page 2 text')).toContainText('SUB-STRAND 2: Energy');
  // metadata edit
  await page.getByLabel('Document version').fill('1.1'); await page.getByRole('button', { name: 'Save details' }).click(); await expect(page.getByText('Saved.')).toBeVisible();
  // preview + download (open licence)
  await page.getByRole('button', { name: 'Preview original' }).click(); await expect(page.locator('iframe[title^="Original file"]')).toBeVisible();
  const dl = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download original' }).click(); expect((await dl).suggestedFilename()).toBe('e2e-physics.pdf');
  await axe(page, 'manual detail with preview');
});

test('duplicates are detected before upload; scanned PDFs are flagged "OCR needed / not configured"', async ({ page }) => {
  await login(page, U.editor); await adminNav(page, 'Learner Manuals');
  const up = page.getByRole('region', { name: 'Upload a learner manual' }); const input = up.getByLabel(/^File \(PDF, DOCX, TXT or CSV/);
  await input.setInputFiles(file('copy.pdf', manualPdf('physics')));
  await expect(page.getByText(/An identical file is already in the library/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Upload & process' })).toBeDisabled();
  await axe(page, 'duplicate warning');
  await input.setInputFiles(file('e2e-scanned.pdf', buildPdf([{ image: true }, { image: true }])));
  await up.getByLabel('Title (optional)').fill('E2E scanned manual'); await page.getByRole('button', { name: 'Upload & process' }).click();
  await page.getByRole('link', { name: 'Open E2E scanned manual' }).click();
  await expect(page.getByText('processing: indexed').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('OCR needed / not configured').first()).toBeVisible();
  await expect(page.getByRole('table', { name: 'Pages' }).getByText('no text layer').first()).toBeVisible();
  await expect(page.getByLabel('Page 1 text')).toContainText('OCR is not configured');
  await axe(page, 'scanned manual');
});

test('a replacement keeps the earlier version; archive and restore are confirmed', async ({ page }) => {
  await login(page, U.editor); await page.goto(docUrl);
  await page.getByRole('button', { name: 'Upload replacement version' }).click();
  await page.getByLabel(/^Replacement file/).setInputFiles(file('e2e-physics-v2.pdf', manualPdf('physics v2')));
  await page.getByLabel('Document version (optional)').fill('2.0'); await page.getByRole('button', { name: 'Upload replacement' }).click();
  await expect(page).not.toHaveURL(docUrl);
  const versions = page.getByRole('table', { name: 'Document versions' });
  await expect(versions.getByRole('row')).toHaveCount(3); await expect(versions).toContainText('current'); await expect(versions).toContainText(/superseded/);
  await versions.getByRole('link', { name: /v1/ }).click(); await expect(page.getByText('This is an earlier version')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reprocess' })).toHaveCount(0);
  await page.getByRole('link', { name: /Open the current version \(v2\)/ }).click();
  await page.getByRole('button', { name: 'Archive' }).click(); await confirm(page, 'Archive');
  await expect(page.getByText(/It is hidden from the library, search and the tutor/)).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).click(); await confirm(page, 'Restore'); await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();
  await axe(page, 'replaced manual');
});

test('denied: editors cannot manage curriculum versions; teachers and students cannot reach the library; school admins cannot archive', async ({ page }) => {
  await login(page, U.editor);
  await page.goto('/admin/curriculum'); await expect(page.getByText('You do not have access to this page.')).toBeVisible();
  let api = await apiAs(page);
  expect((await api.post('/api/curriculum/versions', { code: 'HACK-1', name: 'Hack' })).status()).toBe(403);
  for (const who of [U.teacher, U.ama]) {
    await login(page, who); await page.goto('/admin/documents'); await expect(page.getByText(/do not have access|not found/i).first()).toBeVisible();
    api = await apiAs(page); expect((await api.get('/api/documents')).status(), who).toBe(403);
  }
  await login(page, U.admin); await page.goto(docUrl);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
  api = await apiAs(page); const id = docUrl.split('/').pop();
  expect((await api.post(`/api/documents/${id}/archive`, {})).status()).toBe(403);
  expect((await api.patch(`/api/documents/${id}`, { approvalStatus: 'verified_official' })).status()).toBe(403);
});

test('super admin deletes a manual permanently (type-to-confirm); earlier versions are protected', async ({ page }) => {
  await login(page, U.super); await page.goto('/admin/documents?q=E2E%20scanned');
  await page.getByRole('link', { name: 'E2E scanned manual' }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click(); await expect(dialog(page).getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
  await axe(page, 'delete dialog');
  await dialog(page).getByLabel(/Type DELETE to confirm/).fill('DELETE'); await confirm(page, 'Delete permanently');
  await expect(page).toHaveURL(/\/admin\/documents$/);
  const api = await apiAs(page); const list = await (await api.get('/api/documents?q=E2E%20scanned')).json(); expect(list.total).toBe(0);
  await page.goto(docUrl); await expect(page.getByText('This is an earlier version')).toBeVisible(); await expect(page.getByRole('button', { name: 'Delete permanently' })).toHaveCount(0);
});
