import { test, expect } from '@playwright/test';
import { login, logout, axe, U, PW } from './helpers';
/** Idle sign-out with shortened limits (seconds) set through the E2E server's local test port (never in production). */
const KNOB = 'http://127.0.0.1:8788/idle';
test.beforeAll(async ({ request }) => { await request.put(KNOB, { data: { userSeconds: 20, adminSeconds: 14, warnSeconds: 8 } }); });
test.afterAll(async ({ request }) => { await request.delete(KNOB); });

test('warning dialog (axe), stay signed in, then sign-out and return after signing in again', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'ama@sample.ghlearn.test');
  await page.goto('/progress');
  const dlg = page.getByRole('alertdialog', { name: 'Are you still there?' });
  await expect(dlg).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('timer')).toHaveText(/0:0\d/);
  await expect(page.getByRole('button', { name: 'Stay signed in' })).toBeFocused();
  await axe(page, 'idle warning');
  await page.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(dlg).toBeHidden();
  await expect(dlg).toBeVisible({ timeout: 25_000 });
  await expect(page).toHaveURL(/\/login\?reason=idle&next=%2Fprogress$/, { timeout: 15_000 });
  await expect(page.getByText('You were signed out after a period of inactivity.')).toBeVisible();
  // The server ended the session as well.
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await page.getByLabel('Email').fill('ama@sample.ghlearn.test'); await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/progress$/);
});

test('activity in one tab keeps the other alive; signing out in one signs out both', async ({ page, context }) => {
  test.setTimeout(120_000);
  await login(page, 'ama@sample.ghlearn.test'); await page.goto('/progress');
  const other = await context.newPage(); await other.goto('/learn');
  for (let i = 0; i < 7; i++) { await other.mouse.move(100 + i * 10, 200 + i * 5); await page.waitForTimeout(4000); }
  await expect(page.getByRole('alertdialog')).toBeHidden(); await expect(page).toHaveURL(/\/progress$/);
  await logout(other);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 10_000 });
});

test('super admin sees both idle limits under Security and sign-in', async ({ page, request }) => {
  await request.delete(KNOB); // normal limits for this test
  try {
    await login(page, U.super); await page.goto('/admin/system');
    await expect(page.getByRole('heading', { name: 'Security and sign-in' })).toBeVisible();
    await expect(page.getByLabel(/Idle sign-out for students, parents, teachers and counselors/)).toHaveValue('30');
    await expect(page.getByLabel(/Idle sign-out for administrator roles/)).toHaveValue('15');
  } finally { await request.put(KNOB, { data: { userSeconds: 20, adminSeconds: 14, warnSeconds: 8 } }); }
});
