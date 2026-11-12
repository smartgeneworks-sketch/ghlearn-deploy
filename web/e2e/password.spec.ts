import { test, expect, type Page } from '@playwright/test';
import { PW, U, login, logout, axe, apiAs } from './helpers';

/** Password self-service and staff-assisted recovery. The E2E API has no email provider configured. */
const KOFI = 'kofi@sample.ghlearn.test', AMA = 'ama@sample.ghlearn.test';
async function setBack(page: Page, email: string, current: string) { // restore the sample password for later specs
  await login(page, email, current); const a = await apiAs(page);
  const r = await a.post('/api/auth/change-password', { currentPassword: current, newPassword: PW }); expect(r.status()).toBe(200);
}
const confirm = (page: Page, name: string) => page.getByRole('alertdialog').getByRole('button', { name, exact: true }).click();

test('signed-in change password from the Account page signs out other sessions', async ({ page, browser }) => {
  const other = await browser.newContext(); const op = await other.newPage(); await login(op, KOFI);
  await login(page, KOFI);
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account and security' })).toBeVisible();
  await page.getByLabel('Current password').fill(PW); await page.getByLabel('New password', { exact: true }).fill('KofiE2eChange27'); await page.getByLabel('Confirm new password').fill('KofiE2eChange27');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. Your other sessions were signed out.')).toBeVisible();
  await axe(page, 'account page');
  expect((await op.request.get('/api/auth/me')).status()).toBe(401); await other.close();
  await setBack(page, KOFI, 'KofiE2eChange27');
});

test('forgot password without an email provider says so honestly and offers the code route', async ({ page }) => {
  await page.context().clearCookies(); await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByText('Password reset by email is not available yet.')).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await axe(page, 'forgot (email off)');
  await page.getByRole('link', { name: 'Enter your reset code' }).click();
  await expect(page.getByRole('heading', { name: 'Reset with a code' })).toBeVisible();
  await axe(page, 'reset with code');
});

test('forgot password with a (mocked) configured provider shows the generic confirmation', async ({ page }) => {
  await page.route('**/api/settings/public', async (route) => { const r = await route.fetch(); const j = await r.json(); await route.fulfill({ response: r, json: { ...j, passwordReset: { email: true, staffAssisted: true } } }); });
  let sent: any = null;
  await page.route('**/api/auth/forgot-password', async (route) => { sent = route.request().postDataJSON(); await route.fulfill({ json: { ok: true, emailAvailable: true, message: 'If an account uses that email address, we have sent it a reset link. The link works once and expires in 30 minutes.' } }); });
  await page.context().clearCookies(); await page.goto('/forgot-password');
  await page.getByLabel('Email').fill('someone@example.com'); await axe(page, 'forgot (email on)');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByText(/If an account uses that email address/)).toBeVisible();
  expect(sent).toEqual({ identifier: 'someone@example.com' });
});

test('school admin creates a one-time code; the student resets with it, once', async ({ page }) => {
  await login(page, U.admin); const a = await apiAs(page);
  const list = await (await a.get(`/api/admin/users?q=${encodeURIComponent(KOFI)}`)).json(); const kofi = list.items.find((x: any) => x.email === KOFI);
  await page.goto(`/admin/users/${kofi._id}`);
  await page.getByRole('button', { name: 'Create reset link' }).click(); await confirm(page, 'Create reset link');
  const code = (await page.getByLabel('Reset code', { exact: true }).textContent())!.trim(); expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await expect(page.getByLabel('Reset link', { exact: true })).toContainText('/reset-password?token=');
  await axe(page, 'admin reset secret');
  await page.getByRole('button', { name: 'Done, hide it' }).click(); await expect(page.getByLabel('Reset code', { exact: true })).toHaveCount(0);
  await logout(page);
  await page.goto('/reset-password');
  await page.getByLabel('Email').fill(KOFI); await page.getByLabel('Reset code').fill(code.toLowerCase());
  await page.getByLabel('New password', { exact: true }).fill('KofiE2eCode2027'); await page.getByLabel('Confirm new password').fill('KofiE2eCode2027');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByText(/signed out everywhere/)).toBeVisible(); await axe(page, 'reset done');
  await page.goto('/reset-password'); // the same code cannot be used again
  await page.getByLabel('Email').fill(KOFI); await page.getByLabel('Reset code').fill(code);
  await page.getByLabel('New password', { exact: true }).fill('KofiE2eCode2028'); await page.getByLabel('Confirm new password').fill('KofiE2eCode2028');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByText(/not valid/)).toBeVisible();
  await setBack(page, KOFI, 'KofiE2eCode2027');
});

test('teacher sets a temporary password for a class student, who must change it at sign-in', async ({ page }) => {
  await login(page, U.teacher); const a = await apiAs(page);
  const subj = (await (await a.get('/api/teacher/subjects')).json()).items.find((t: any) => t.subjectId?.code === 'BIO').subjectId._id;
  const cand = await a.post('/api/teacher/classes', { name: 'E2E Password Class', subjectId: subj, studentIds: [] }); expect(cand.status()).toBe(201);
  const cid = (await cand.json()).class._id;
  const people = (await (await a.get(`/api/teacher/classes/${cid}/candidates`)).json()).items; const ama = people.find((p: any) => /Ama/.test(p.name));
  expect((await a.patch(`/api/teacher/classes/${cid}`, { addStudents: [ama.userId] })).status()).toBe(200);
  await page.goto(`/teach/classes/${cid}/students/${ama.userId}`);
  await expect(page.getByRole('heading', { name: 'Password help' })).toBeVisible(); await axe(page, 'teacher student password help');
  await page.getByRole('button', { name: 'Set temporary password' }).click(); await confirm(page, 'Set temporary password');
  const temp = (await page.getByLabel('Temporary password', { exact: true }).textContent())!.trim(); expect(temp).toMatch(/^[A-Za-z2-9]{14}$/);
  await logout(page);
  await page.goto('/login'); await page.getByLabel('Email').fill(AMA); await page.getByLabel('Password').fill(temp); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible(); await axe(page, 'forced change');
  await page.getByLabel('Temporary password').fill(temp); await page.getByLabel('New password', { exact: true }).fill('AmaE2eForced2027'); await page.getByLabel('Confirm new password').fill('AmaE2eForced2027');
  await page.getByRole('button', { name: 'Save password and continue' }).click();
  await expect(page).not.toHaveURL(/change-password/); await expect(page.getByRole('heading', { name: 'Choose a new password' })).toHaveCount(0);
  expect((await page.request.get('/api/me/subjects')).status()).toBe(200); // no longer blocked
  await setBack(page, AMA, 'AmaE2eForced2027');
});
