import { test, expect } from '@playwright/test';
import { login, axe, U } from './helpers';

/** Meetings + self-service subjects: counselor availability → student books → counselor accepts; student edits subjects in profile. */
test.describe.configure({ mode: 'serial' });
const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const day = new Date(); day.setDate(day.getDate() + 3); day.setHours(10, 0, 0, 0);
const end = new Date(day.getTime() + 30 * 60000);

test('counselor publishes an online availability slot', async ({ page }) => {
  await login(page, U.counselor);
  await expect(page.getByRole('heading', { name: 'Meetings' })).toBeVisible(); // counselor lands on Meetings
  await page.getByLabel('From').fill(local(day)); await page.getByLabel('To').fill(local(end));
  await page.getByLabel('In person').uncheck();
  await page.getByLabel('Online link (optional)').fill('https://meet.example.org/ghlearn-e2e');
  await page.getByRole('button', { name: 'Add slot' }).click();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await axe(page, 'meetings host');
});

test('student edits subjects from My profile; access follows the new choice', async ({ page }) => {
  await login(page, U.ama);
  await page.getByRole('link', { name: 'My profile' }).click();
  await expect(page.getByLabel('Region')).toHaveValue('Greater Accra');
  await axe(page, 'profile');
  await page.getByRole('group', { name: /Elective subjects/ }).getByLabel('Economics').check();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved. Your subjects are updated.')).toBeVisible();
  await page.getByRole('link', { name: 'My subjects' }).click();
  await expect(page.getByRole('heading', { name: 'Economics' })).toBeVisible();
});

test('student books the slot, counselor accepts, both see it confirmed', async ({ page }) => {
  await login(page, U.ama);
  await page.getByRole('link', { name: 'Meetings' }).click();
  await page.getByLabel('Teacher or counselor').selectOption({ label: 'School Counselor (Sample) (counselor)' });
  await page.getByRole('radio').first().check();
  await page.getByLabel('Topic').fill('Choosing electives for Year 2');
  await page.getByLabel('Mode').selectOption('online');
  await axe(page, 'meetings student');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Request sent.')).toBeVisible();
  await expect(page.getByText('Waiting for teacher/counselor')).toBeVisible();

  await login(page, U.counselor);
  const item = page.getByRole('listitem').filter({ hasText: 'Choosing electives for Year 2' });
  await expect(item.getByText('Ama Mensah (Sample Student)', { exact: false })).toBeVisible();
  await item.getByRole('button', { name: 'Accept' }).click();
  await expect(item.getByText('Confirmed')).toBeVisible();
  await expect(page.getByText('Booked')).toBeVisible();

  await login(page, U.ama);
  await expect(page.getByRole('link', { name: /Notifications, \d+ unread/ })).toBeVisible();
  await page.getByRole('link', { name: 'Meetings' }).click();
  const mine = page.getByRole('listitem').filter({ hasText: 'Choosing electives for Year 2' });
  await expect(mine.getByText('Confirmed')).toBeVisible();
  await expect(mine.getByRole('link', { name: 'Join online meeting' })).toHaveAttribute('href', 'https://meet.example.org/ghlearn-e2e');
});
