import { test, expect, type Page } from '@playwright/test';
import { login, logout, axe, adminNav, apiAs, subjectId, U } from './helpers';
/** Phase 10 (§20 System settings): branding and theme, legal text, feature flags and maintenance mode, end to end. */
const restore = async (page: Page) => {
  await login(page, U.super); const api = await apiAs(page);
  const r = await api.patch('/api/admin/settings', { branding: { appName: 'GH Learn', tagline: 'Ghana curriculum learning for students and teachers', logo: null, supportEmail: '' }, theme: { preset: 'green' },
    features: { games: true, tutor: true }, maintenance: { enabled: false, message: '', until: null }, legal: { terms: '', privacy: '' }, confirm: true });
  expect(r.status()).toBe(200);
};
test.afterAll(async ({ browser }) => { const page = await browser.newPage(); await restore(page); await page.close(); });

test('super admin changes branding and theme; the whole app follows', async ({ page }) => {
  await login(page, U.super); await adminNav(page, 'System Settings');
  await expect(page.getByRole('heading', { name: 'System settings', level: 1 })).toBeVisible();
  const branding = page.locator('#set-branding');
  await branding.getByLabel('App name').fill('Volta Learn'); await branding.getByRole('button', { name: 'Save' }).click();
  await expect(branding.getByText('Saved.')).toBeVisible();
  const theme = page.locator('#set-theme'); await theme.getByLabel('Royal blue').check(); await theme.getByRole('button', { name: 'Save' }).click();
  await expect(theme.getByText('Saved.')).toBeVisible();
  await expect(page.getByRole('banner').getByText('Volta Learn')).toBeVisible();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-brand-900').trim())).toBe('#1e3a8a');
  await axe(page, 'system settings (blue theme)');
  await page.getByRole('tab', { name: 'Status' }).click(); await expect(page.getByText('Database')).toBeVisible(); await axe(page, 'system status tab');
  await logout(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Volta Learn'); await expect(page).toHaveTitle('Volta Learn');
  await axe(page, 'login (blue theme)');
});

test('terms and privacy text is published to users; a high-impact change asks for confirmation', async ({ page }) => {
  await login(page, U.super); await page.goto('/admin/system');
  const legal = page.locator('#set-legal');
  await legal.getByLabel('Terms of use').fill('Use GH Learn kindly.\n\nDo not share your password.'); await legal.getByRole('button', { name: 'Save' }).click();
  const dlg = page.getByRole('alertdialog', { name: 'Confirm high-impact change' });
  await expect(dlg.getByText('Publishes new terms or privacy text to every user')).toBeVisible(); await axe(page, 'confirm dialog');
  await dlg.getByRole('button', { name: 'Confirm and save' }).click(); await expect(dlg).toBeHidden();
  await logout(page);
  await page.getByRole('link', { name: 'Terms of use' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Terms of use'); await expect(page.getByText('Do not share your password.')).toBeVisible();
  await axe(page, 'terms page');
  await page.goto('/privacy'); await expect(page.getByText('This text has not been published yet.')).toBeVisible();
});

test('feature flags hide switched-off features and the server refuses them', async ({ page }) => {
  await login(page, U.super); const sup = await apiAs(page);
  expect((await sup.patch('/api/admin/settings', { features: { games: false } })).status()).toBe(409);
  expect((await sup.patch('/api/admin/settings', { features: { games: false }, confirm: true })).status()).toBe(200);
  await login(page, U.ama); const bio = await subjectId(page, 'BIO');
  await page.goto(`/learn/${bio}`); await expect(page.getByRole('link', { name: 'Practice & tests' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Games', exact: true })).toHaveCount(0);
  expect((await (await apiAs(page)).get('/api/games')).status()).toBe(403);
  await login(page, U.super); expect((await (await apiAs(page)).patch('/api/admin/settings', { features: { games: true } })).status()).toBe(200);
});

test('maintenance mode: learners see the message and cannot sign in; administrators keep working', async ({ page }) => {
  await login(page, U.super); await page.goto('/admin/system');
  const m = page.locator('#set-maintenance');
  await m.getByLabel('Message shown to users').fill('Back after the exam upgrade.'); await m.getByLabel('Maintenance mode on').check();
  await m.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm and save' }).click();
  await expect(page.getByText('Maintenance mode is on.')).toBeVisible();
  await page.goto('/admin/users'); await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible(); // admins are exempt
  await page.context().clearCookies(); await page.goto('/login');
  await page.getByLabel('Email').fill(U.ama); await page.getByLabel('Password').fill('SamplePass2026'); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /is under maintenance/ })).toBeVisible(); await expect(page.getByText('Back after the exam upgrade.')).toBeVisible();
  await axe(page, 'maintenance screen');
  await login(page, U.super); expect((await (await apiAs(page)).patch('/api/admin/settings', { maintenance: { enabled: false } })).status()).toBe(200);
  await login(page, U.ama); await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});

test('system operator sees the settings read-only and the AI providers panel shows keys only as set or unset', async ({ page }) => {
  await login(page, U.operator); await adminNav(page, 'System Settings');
  await expect(page.getByText('You can view these settings. Only a Super Admin can change them.')).toBeVisible();
  await expect(page.locator('#set-branding').getByLabel('App name')).toBeDisabled();
  expect((await (await apiAs(page)).patch('/api/admin/settings', { branding: { appName: 'Operator Learn' } })).status()).toBe(403);
  await adminNav(page, 'AI Usage and Costs');
  await expect(page.getByRole('heading', { name: 'AI providers and models' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'AI providers' }).getByText('Text generation (LLM)')).toBeVisible();
  await axe(page, 'AI providers (operator)');
});
