import { test, expect, type Page } from '@playwright/test';
import { U, login, axe, apiAs } from './helpers';

/** Phone at sign-up and sign-in by phone, with the E2E server's fake SMS provider (outbox on the side port). */
const OUTBOX = 'http://127.0.0.1:8788';
const outbox = async (page: Page) => (await (await page.request.get(OUTBOX)).json()) as { to: string[]; message: string; otp: boolean }[];
const setSender = async (page: Page, senderId: string) => { await login(page, U.super); const a = await apiAs(page); expect((await a.patch('/api/admin/settings', { sms: { senderId } })).status()).toBe(200); };
test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => { const p = await browser.newPage(); await setSender(p, 'GHLearn'); await p.close(); });
test.afterAll(async ({ browser }) => { const p = await browser.newPage(); await setSender(p, ''); await p.close(); });
const EMAIL = 'phone.signup@e2e.test', PASS = 'PhoneSignup2027';

test('sign up with a phone number, verify it by SMS code, then sign in with the phone', async ({ page }) => {
  await page.context().clearCookies(); await page.request.delete(OUTBOX);
  await page.goto('/register'); await expect(page.getByLabel('Mobile number (optional)')).toBeVisible(); await axe(page, 'register with phone');
  await page.getByLabel('Full name').fill('Phone Signup Student'); await page.getByLabel('Email', { exact: true }).fill(EMAIL);
  await page.getByLabel('Mobile number (optional)').fill('0302123456'); await page.getByLabel('Password').fill(PASS); await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click(); await expect(page.getByText(/Enter a Ghana mobile/)).toBeVisible();
  await page.getByLabel('Mobile number (optional)').fill('+233 24 333 0001'); await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Verify your phone' })).toBeVisible(); await axe(page, 'verify phone step');
  await expect.poll(async () => (await outbox(page)).length).toBe(1);
  const m = (await outbox(page))[0]; expect(m.to).toEqual(['0243330001']); expect(m.otp).toBe(true);
  await page.getByLabel('6-digit code').fill(/\b(\d{6})\b/.exec(m.message)![1]); await page.getByRole('button', { name: 'Verify phone' }).click();
  await expect(page.getByText('Your phone number is verified.')).toBeVisible(); await expect(page).toHaveURL(/\/onboarding/);
  await page.context().clearCookies(); await page.goto('/login'); await axe(page, 'login email or phone');
  await page.getByLabel('Email or phone number').fill('0243330001'); await page.getByLabel('Password').fill(PASS); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
});

test('unverified and unknown numbers get the same generic error as a wrong email', async ({ page }) => {
  await page.context().clearCookies(); await page.goto('/register');
  await page.getByLabel('Full name').fill('Skip Student'); await page.getByLabel('Email', { exact: true }).fill('phone.skip@e2e.test');
  await page.getByLabel('Mobile number (optional)').fill('0203330002'); await page.getByLabel('Password').fill(PASS); await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click(); await page.getByRole('button', { name: 'Skip for now' }).click(); await expect(page).toHaveURL(/\/onboarding/);
  const msgs: string[] = [];
  for (const id of ['0203330002', '0249990000', 'nobody@e2e.test']) {
    await page.context().clearCookies(); await page.goto('/login');
    await page.getByLabel('Email or phone number').fill(id); await page.getByLabel('Password').fill(PASS); await page.getByRole('button', { name: 'Sign in' }).click();
    const a = page.getByRole('alert').first(); await expect(a).toBeVisible(); msgs.push((await a.textContent())!.trim());
  }
  expect(new Set(msgs).size).toBe(1); expect(msgs[0]).toBe('Invalid email, phone number or password');
});

test('admins see the phone masked in the users list; super admin clears a verification', async ({ page }) => {
  await login(page, U.super); await page.goto('/admin/users?q=phone.signup');
  const row = page.getByRole('row').filter({ hasText: EMAIL }); await expect(row).toContainText('024****001'); await expect(row).toContainText('verified');
  await row.getByRole('link', { name: 'Phone Signup Student' }).click();
  await expect(page.getByText('0243330001')).toBeVisible(); await axe(page, 'user detail with phone');
  await page.getByRole('button', { name: 'Clear phone verification for Phone Signup Student' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Clear verification', exact: true }).click().catch(async () => page.getByRole('alertdialog').getByRole('button').last().click());
  await expect(page.getByText('not verified')).toBeVisible();
});
