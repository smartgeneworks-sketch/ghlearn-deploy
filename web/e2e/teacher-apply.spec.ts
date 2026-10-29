import { test, expect } from '@playwright/test';
import { axe, login, logout, U } from './helpers';
/** Teacher application → school admin approves → set password → teaching dashboard. Email is mocked by the E2E server's test port. */
const MAIL = 'http://127.0.0.1:8788/mail';
const who = `e2e.teacher.${Date.now()}@apply.test`;
test.beforeAll(async ({ request }) => { await request.put(MAIL); });
test.afterAll(async ({ request }) => { await request.delete(MAIL); });

test('apply, approve, set password, land on the teaching dashboard', async ({ page, request }) => {
  test.setTimeout(150_000);
  await page.goto('/register');
  await page.getByRole('link', { name: 'Apply for a teacher account' }).click();
  await expect(page).toHaveURL(/\/register\/teacher$/);
  await expect(page.getByRole('heading', { name: 'Apply for a teacher account' })).toBeVisible();
  await expect(page.getByLabel(/password/i)).toHaveCount(0);
  await axe(page, 'teacher application');
  await page.getByLabel('Full name').fill('Efua E2E Teacher');
  await page.getByLabel('Email').fill(who);
  await page.getByLabel('Region').selectOption('Greater Accra');
  await page.getByLabel('School', { exact: true }).selectOption({ label: 'Sample Academy (Sample)' });
  await page.getByRole('group', { name: 'Subjects you teach' }).getByRole('checkbox').first().check();
  await page.getByLabel('SHS 2').check();
  await page.getByLabel(/I confirm these details/).check();
  await page.getByRole('button', { name: 'Send application' }).click();
  await expect(page.getByText(/Your application has been received/)).toBeVisible();
  await axe(page, 'application received');
  await expect.poll(async () => (await (await request.get(MAIL)).json()).filter((m: any) => JSON.stringify(m.to).includes(who)).length).toBe(1);

  await login(page, U.admin); await page.goto('/admin/users');
  const tab = page.getByRole('tab', { name: /Teacher applications/ });
  await expect(tab).toContainText(/\d/); await tab.click();
  const row = page.getByRole('listitem').filter({ hasText: who });
  await row.getByRole('button', { name: 'Review' }).click();
  await expect(row.getByText('Subjects to assign')).toBeVisible();
  await axe(page, 'teacher application review');
  await row.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve and send invite' }).click();
  await expect(page.getByText(/Approved Efua E2E Teacher\. A set-password link was emailed/)).toBeVisible();
  await logout(page);

  const mails = (await (await request.get(MAIL)).json()).filter((m: any) => JSON.stringify(m.to).includes(who));
  const welcome = mails.find((m: any) => /approved/.test(m.subject)); expect(welcome).toBeTruthy();
  const token = /set-password\?token=([\w-]+)/.exec(welcome.text)![1];
  await page.goto(`/set-password?token=${token}`);
  await expect(page.getByText(who)).toBeVisible(); await expect(page).toHaveURL(/\/set-password$/);
  await axe(page, 'set password');
  await page.getByLabel('New password', { exact: true }).fill('MyTeaching2027');
  await page.getByLabel('Confirm new password').fill('MyTeaching2027');
  await page.getByRole('button', { name: 'Save password and sign in' }).click();
  await expect(page.getByText(/Welcome to GH Learn, Efua\. Your password is set/)).toBeVisible();
  await expect(page.getByText(/This is your teaching dashboard/)).toBeVisible();
  await axe(page, 'teacher dashboard welcome');
  // The link works once.
  await logout(page); await page.goto(`/set-password?token=${token}`);
  await expect(page.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request a new link' })).toBeVisible();
  // And the new password signs in.
  await login(page, who, 'MyTeaching2027');
});
