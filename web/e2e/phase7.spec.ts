import { test, expect, type Page } from '@playwright/test';
import { login, logout, axe, adminNav, subjectId, apiAs, U } from './helpers';
import { manualPdf } from './pdf';

/** Phase 7: AI generation workspace (§11) and review queue (§12), in the browser. AI is the scripted test model. */
test.describe.configure({ mode: 'serial' });
const stamp = Date.now(); const manual = `E2E P7 manual ${stamp}`; const topic = `Speed and energy ${stamp}`;
let docId = ''; let lessonUrl = ''; let bio = '';
const dialog = (page: Page) => page.getByRole('alertdialog');
const confirm = async (page: Page, button: string) => { await dialog(page).getByRole('button', { name: button, exact: true }).click(); await expect(dialog(page)).toHaveCount(0); };

test('setup: an approved (verified official) manual', async ({ page }) => {
  await login(page, U.super); bio = await subjectId(page, 'BIO');
  const tok = (await (await page.request.get('/api/auth/csrf')).json()).csrfToken as string;
  const r = await page.request.post('/api/documents/upload', { headers: { 'X-CSRF-Token': tok, Origin: 'http://localhost:4173' },
    multipart: { subjectId: bio, title: manual, file: { name: 'p7.pdf', mimeType: 'application/pdf', buffer: manualPdf(`phase7 ${stamp}`) } } });
  expect(r.status(), await r.text()).toBe(201); docId = (await r.json()).document._id;
  await expect.poll(async () => (await (await page.request.get(`/api/documents/${docId}`)).json()).document.processingStatus, { timeout: 30_000 }).toBe('indexed');
  const api = await apiAs(page);
  expect((await api.patch(`/api/documents/${docId}`, { approvalStatus: 'verified_official' })).status()).toBe(200);
});

test('editor: workspace options, live estimate, generate a resource, compare with sources, save draft, submit', async ({ page }) => {
  await login(page, U.editor);
  await adminNav(page, 'AI Content Generation');
  await expect(page.getByRole('heading', { name: 'AI generation workspace' })).toBeVisible();
  await page.getByLabel('Content type').selectOption({ label: 'Summary' });
  const subj = page.getByRole('combobox', { name: 'Subject', exact: true });
  await expect(async () => { await subj.selectOption({ label: 'Biology' }); await expect(subj).not.toHaveValue('', { timeout: 500 }); }).toPass();
  await page.getByLabel(manual).check();
  await page.getByLabel('Topic', { exact: true }).fill(topic);
  await expect(page.getByLabel(/Images: not configured/)).toBeDisabled();
  await expect(page.getByText(/Not available here: Infographics/)).toBeVisible();
  const est = page.getByRole('region', { name: 'Estimate' });
  await expect(est).toContainText('1 (up to 3 with retries)'); await expect(est).toContainText(/Daily quota/); await expect(est).toContainText(/from 1 manual/);
  await page.getByLabel('Easy').fill('70');
  await expect(page.getByRole('alert').filter({ hasText: 'must add up to 100' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate resource' })).toBeDisabled();
  await page.getByLabel('Easy').fill('40');
  await expect(page.getByRole('button', { name: 'Generate resource' })).toBeEnabled();
  await axe(page, 'generation workspace');
  await page.getByRole('button', { name: 'Generate resource' }).click();
  await expect(page).toHaveURL(/\/admin\/lessons\/[a-f0-9]{24}/); lessonUrl = page.url();
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Summary · v1/)).toBeVisible();
  await expect(page.getByText(manual).first()).toBeVisible();
  await axe(page, 'lesson editor');
  await page.getByRole('tab', { name: 'Compare with sources' }).click();
  await expect(page.getByRole('heading', { name: 'Cited passages' }).first()).toBeVisible();
  await expect(page.getByRole('tabpanel')).toContainText(`phase7 ${stamp}`);
  await axe(page, 'compare with sources');
  await page.getByLabel('Title', { exact: true }).fill(`Summary ${stamp}`);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Summary · v2/)).toBeVisible();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(dialog(page)).toContainText('You cannot edit it while it is being reviewed');
  await confirm(page, 'Submit');
  await expect(page.getByText('Awaiting review').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
});

test('curriculum admin assigns a reviewer but cannot approve or publish', async ({ page }) => {
  await login(page, U.curriculum); await page.goto(lessonUrl);
  await page.getByLabel('Assign reviewer').selectOption({ label: 'Super Admin (Sample)' });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByText('Reviewer: Super Admin (Sample)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  const api = await apiAs(page); const id = lessonUrl.split('/').pop();
  expect((await api.post(`/api/lessons/${id}/review`, { action: 'approve' })).status()).toBe(403);
  expect((await api.post(`/api/lessons/${id}/publish`, {})).status()).toBe(403);
});

test('reviewer: §12 queue, request changes; editor resubmits; reviewer approves, publishes to an audience, unpublishes', async ({ page }) => {
  await login(page, U.super);
  await adminNav(page, 'Content Review and Publishing');
  const table = page.getByRole('table', { name: 'Review queue' });
  const row = table.getByRole('row', { name: new RegExp(`Summary ${stamp}`) });
  for (const t of ['Awaiting review', 'Super Admin (Sample)', 'Biology', topic, manual, 'Curriculum Editor']) await expect(row).toContainText(t);
  await axe(page, 'review queue');
  await row.getByRole('link', { name: `Summary ${stamp}` }).click();
  await expect(page.getByRole('button', { name: 'Request changes' })).toBeDisabled();
  await page.getByLabel('Review comment').fill('Add one more key point');
  await page.getByRole('button', { name: 'Request changes' }).click(); await confirm(page, 'Request changes');
  await expect(page.getByText('Changes requested').first()).toBeVisible();
  await expect(page.getByText(/Requested changes.*Add one more key point/)).toBeVisible();

  await logout(page); await login(page, U.editor); await page.goto(lessonUrl);
  await page.getByRole('button', { name: 'Resubmit for review' }).click(); await confirm(page, 'Submit');
  await expect(page.getByText('Resubmitted').first()).toBeVisible();

  await logout(page); await login(page, U.super);
  await page.goto('/admin/review?status=resubmitted');
  await page.getByRole('table', { name: 'Review queue' }).getByRole('link', { name: `Summary ${stamp}` }).click();
  await page.getByRole('button', { name: 'Approve' }).click(); await confirm(page, 'Approve');
  await expect(page.getByText('Approved').first()).toBeVisible();
  await page.getByLabel('Year', { exact: true }).selectOption({ label: 'Year 2' });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(dialog(page)).toContainText('Year 2');
  await axe(page, 'publish confirm dialog');
  await confirm(page, 'Publish');
  await expect(page.getByText('Published').first()).toBeVisible();
  // eligibility: Ama is in year 1, so the year-2 resource is not visible to her
  const id = lessonUrl.split('/').pop();
  const resourceId = (await (await page.request.get(`/api/lessons/${id}`)).json()).lesson.resourceId as string;
  await logout(page); await login(page, U.ama);
  expect((await page.request.get(`/api/resources/${resourceId}`)).status()).toBe(404);
  const listed = (await (await page.request.get(`/api/subjects/${bio}/resources`)).json()).items.map((x: any) => x._id);
  expect(listed).not.toContain(resourceId);

  await logout(page); await login(page, U.super); await page.goto(lessonUrl);
  await page.getByRole('button', { name: 'Unpublish' }).click(); await confirm(page, 'Unpublish');
  await expect(page.getByText('Approved').first()).toBeVisible();
  await expect(page.getByText(/Unpublished/).first()).toBeVisible();
});

test('a failed generation shows the provider error; it can be retried and deleted', async ({ page }) => {
  await login(page, U.editor);
  const api = await apiAs(page);
  const r = await api.post('/api/lessons', { subjectId: bio, topic: 'Speed and distance E2E rejected request', contentType: 'summary', documentIds: [docId] });
  expect(r.status(), await r.text()).toBe(202); const id = (await r.json()).lesson._id;
  await page.goto(`/admin/lessons/${id}`);
  await expect(page.getByText(/Generation failed: .*HTTP 400 request rejected/)).toBeVisible({ timeout: 30_000 });
  await axe(page, 'failed generation');
  await page.getByRole('button', { name: 'Retry generation' }).click(); await confirm(page, 'Retry');
  await expect(page.getByText(/Generation failed: .*HTTP 400/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Retried generation/)).toBeVisible();
  await page.getByRole('button', { name: 'Delete failed generation' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Delete failed generation' })).toBeDisabled();
  await dialog(page).getByLabel(/Type DELETE/).fill('DELETE');
  await confirm(page, 'Delete failed generation');
  await expect(page).toHaveURL(/\/admin\/lessons$/);
  expect((await page.request.get(`/api/lessons/${id}`)).status()).toBe(404);
});

test('denied: roles without content rights cannot reach the workspace, queue or actions', async ({ page }) => {
  await login(page, U.editor);
  await page.goto('/admin/review'); await expect(page.getByText('You do not have access to this page.')).toBeVisible();
  for (const who of [U.teacher, U.admin, U.ama]) {
    await logout(page).catch(() => undefined); await login(page, who);
    for (const p of ['/api/lessons/options', '/api/lessons?review=queue']) expect((await page.request.get(p)).status(), `${who} ${p}`).toBe(403);
    const api = await apiAs(page);
    expect((await api.post('/api/lessons', { subjectId: bio, topic: 'Nope' })).status(), who).toBe(403);
  }
});
