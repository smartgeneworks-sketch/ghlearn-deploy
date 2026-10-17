import { test, expect, type Page } from '@playwright/test';
import { PW, U, login, axe, apiAs } from './helpers';

/** SMS with the E2E server's fake provider (no real texts). The outbox is read from the E2E server's local side port. */
const OUTBOX = 'http://127.0.0.1:8788';
const outbox = async (page: Page) => (await (await page.request.get(OUTBOX)).json()) as { to: string[]; message: string; otp: boolean; sender: string }[];
const clearOutbox = (page: Page) => page.request.delete(OUTBOX);
const setSender = async (page: Page, senderId: string) => { await login(page, U.super); const a = await apiAs(page); expect((await a.patch('/api/admin/settings', { sms: { senderId } })).status()).toBe(200); };
test.describe.configure({ mode: 'serial' });
test.afterAll(async ({ browser }) => { const p = await browser.newPage(); await setSender(p, ''); await p.close(); }); // SMS off again for other specs

test('super admin: SMS tab shows status and balance, saves the sender ID, sends a test and logs it masked', async ({ page }) => {
  await login(page, U.super); await page.goto('/admin/system?tab=sms');
  await expect(page.getByRole('heading', { name: 'SMS status' })).toBeVisible();
  await expect(page.getByText(/configured but not in use: no sender ID is set/)).toBeVisible(); await axe(page, 'sms tab (no sender)');
  await page.getByRole('textbox', { name: 'Sender ID' }).fill('GHLearn'); await page.getByRole('button', { name: 'Save SMS settings' }).click();
  await expect(page.getByText('Saved. The change is in the audit log.')).toBeVisible();
  await expect(page.getByText('120 SMS credits')).toBeVisible(); await expect(page.locator('dd').filter({ hasText: 'GHLearn' })).toContainText('approved');
  await clearOutbox(page);
  await page.getByLabel('Phone number').fill('055 111 0005'); await page.getByRole('button', { name: 'Send test' }).click();
  await expect(page.getByText('Sent to 055****005 (MTN).')).toBeVisible();
  const table = page.getByRole('table', { name: 'Recent SMS' }); await expect(table).toContainText('055****005'); await expect(table).not.toContainText('0551110005');
  await table.getByRole('button', { name: 'Check' }).first().click(); await expect(table).toContainText('delivered');
  expect((await outbox(page)).at(-1)).toMatchObject({ to: ['0551110005'], message: 'GH Learn SMS test', sender: 'GHLearn', otp: false });
  await axe(page, 'sms tab');
});

test('student verifies a phone number by SMS code and opts in to meeting texts', async ({ page }) => {
  await login(page, U.ama); await clearOutbox(page);
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByLabel('Mobile number').fill('024 111 0001'); await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText(/We texted a 6-digit code to 024\*\*\*\*001/)).toBeVisible();
  const m = (await outbox(page)).at(-1)!; expect(m.otp).toBe(true); const code = /\b(\d{6})\b/.exec(m.message)![1];
  await axe(page, 'phone code entry');
  await page.getByLabel('6-digit code').fill(code === '000000' ? '111111' : '000000'); await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText(/That code is not right. 4 tries left./)).toBeVisible();
  await page.getByLabel('6-digit code').fill(code); await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Verified', { exact: true })).toBeVisible();
  const box = page.getByLabel(/Text me about meetings/); await expect(box).not.toBeChecked(); await box.check(); await expect(box).toBeChecked();
  await page.reload(); await expect(page.getByLabel(/Text me about meetings/)).toBeChecked(); await axe(page, 'account with phone');
});

test('forgot password by SMS: code to the verified phone, reset, sign in; unknown numbers get the same answer', async ({ page }) => {
  await page.context().clearCookies(); await clearOutbox(page);
  await page.goto('/forgot-password'); await page.getByLabel('Phone number').fill('0249999999'); await page.getByRole('button', { name: 'Send reset code' }).click();
  await expect(page.getByRole('heading', { name: 'Check your phone' })).toBeVisible(); const unknownMsg = await page.getByRole('status').first().textContent();
  await page.goto('/forgot-password'); await axe(page, 'forgot (sms on)');
  await page.getByLabel('Phone number').fill('+233 24 111 0001'); await page.getByRole('button', { name: 'Send reset code' }).click();
  await expect(page.getByRole('heading', { name: 'Check your phone' })).toBeVisible(); expect(await page.getByRole('status').first().textContent()).toBe(unknownMsg);
  await expect.poll(async () => (await outbox(page)).length).toBe(1);
  const m = (await outbox(page))[0]; expect(m.to).toEqual(['0241110001']); expect(m.otp).toBe(true); expect(m.message.length).toBeLessThanOrEqual(160);
  const code = /code: ([A-Z0-9-]{14})/.exec(m.message)![1];
  await page.getByRole('link', { name: 'Enter the code' }).click(); await expect(page.getByLabel('Email or phone number')).toHaveValue('+233 24 111 0001');
  await page.getByLabel('Reset code').fill(code); await page.getByLabel('New password', { exact: true }).fill('AmaSmsReset27'); await page.getByLabel('Confirm new password').fill('AmaSmsReset27');
  await axe(page, 'reset by sms code');
  await page.getByRole('button', { name: 'Set new password' }).click(); await expect(page.getByText(/Your password was changed/)).toBeVisible();
  await login(page, U.ama, 'AmaSmsReset27'); const a = await apiAs(page);
  expect((await a.post('/api/auth/change-password', { currentPassword: 'AmaSmsReset27', newPassword: PW })).status()).toBe(200);
  await login(page, U.ama); const api = await apiAs(page); // tidy: remove the number again
  expect((await page.request.delete('/api/account/phone', { headers: { 'X-CSRF-Token': (await (await page.request.get('/api/auth/csrf')).json()).csrfToken, Origin: 'http://localhost:4173' } })).status()).toBe(204); void api;
});
