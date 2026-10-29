import { test, expect } from '@playwright/test';
import { login, axe, subjectId, U } from './helpers';

/** Admin Phase 3 (spec §5): trend charts, filters carried into links, warnings and activity feeds; axe clean with data tables open. */
test('super admin: charts render accessibly and filters flow into chart and card links', async ({ page }) => {
  await login(page, U.super);
  const trends = page.getByRole('region', { name: /Trends/ });
  for (const t of ['New registrations', 'Active users', 'Subject enrolment (top 15)', 'Manual processing status', 'Lessons generated vs published', 'Review workload', 'Exercise completion', 'AI requests', 'Estimated AI cost (USD)'])
    await expect(trends.getByRole('figure', { name: new RegExp(t.replace(/[()]/g, '\\$&')) })).toBeVisible();
  await expect(trends.getByRole('figure', { name: /Estimated AI cost/ }).getByText('Estimate', { exact: true })).toBeVisible();
  for (const s of await trends.getByText('Show data table').all()) await s.click();
  await axe(page, 'overview with charts and data tables');
  await expect(page.getByRole('navigation', { name: 'Other areas' })).toHaveCount(0); // no student/teacher-only entries for super admins
  const bio = await subjectId(page, 'BIO');
  await page.getByRole('combobox', { name: 'Subject', exact: true }).selectOption({ label: 'Biology' });
  await expect(page).toHaveURL(new RegExp(`subjectId=${bio}`));
  await expect(trends.getByRole('figure', { name: /Lessons generated vs published/ }).getByRole('link', { name: /Open/ })).toHaveAttribute('href', new RegExp(`subjectId=${bio}`));
  await page.getByRole('list', { name: 'Key figures' }).getByRole('link', { name: /^Pending reviews/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/review\\?subjectId=${bio}`));
  await expect(page.getByRole('combobox', { name: 'Subject' })).toHaveValue(bio);
});

test('curriculum admin: processing-status bars open the filtered manual list; activity and warnings are role-appropriate', async ({ page }) => {
  await login(page, U.curriculum);
  const fig = page.getByRole('figure', { name: 'Manual processing status' });
  await expect(fig.getByRole('listitem')).toHaveCount(9);
  await fig.getByRole('link', { name: 'Completed' }).click();
  await expect(page).toHaveURL(/\/admin\/documents\?processingStatus=indexed&mappingStatus=confirmed/);
  await expect(page.getByLabel('Processing', { exact: true })).toHaveValue('indexed'); await expect(page.getByLabel('Mapping', { exact: true })).toHaveValue('confirmed');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Recently generated content' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent admin actions' })).toHaveCount(0); // no audit:view
  await expect(page.getByRole('figure', { name: 'New registrations' })).toHaveCount(0);   // no learner data
  await axe(page, 'curriculum overview');
});

test('school admin: learner charts only, links stay in their school; operator sees AI charts only', async ({ page }) => {
  await login(page, U.admin);
  const trends = page.getByRole('region', { name: /Trends/ });
  await expect(trends.getByRole('figure', { name: 'New registrations' })).toBeVisible();
  await expect(trends.getByRole('figure', { name: /AI requests/ })).toHaveCount(0);
  await expect(trends.getByRole('figure', { name: 'Review workload' })).toHaveCount(0);
  await expect(page.getByLabel('School')).toHaveCount(0);
  await axe(page, 'school admin overview');
  await login(page, U.operator);
  await expect(page.getByRole('region', { name: /Trends/ }).getByRole('figure')).toHaveCount(2);
  await axe(page, 'operator overview');
});
