import { expect, type Page, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
export const PW = 'SamplePass2026';
export const U = { curriculum: 'curriculum@sample.ghlearn.test', operator: 'operator@sample.ghlearn.test', super: 'super@sample.ghlearn.test', admin: 'admin@sample.ghlearn.test', editor: 'editor@sample.ghlearn.test', teacher: 'teacher@sample.ghlearn.test', ama: 'ama@sample.ghlearn.test', kofi: 'kofi@sample.ghlearn.test', counselor: 'counselor@sample.ghlearn.test' };
export async function login(page: Page, email: string, password = PW) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' }).or(page.getByRole('button', { name: /Account menu/ })).or(page.getByRole('heading', { name: 'Set up your learning space' })).first()).toBeVisible();
}
/** Signs out from either shell (app header button, or the admin profile menu). */
export async function logout(page: Page) {
  const menu = page.getByRole('button', { name: /Account menu/ });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}
/** Clicks a link in the admin sidebar (opening it first on narrow screens). */
export async function adminNav(page: Page, label: string) {
  const nav = page.getByRole('navigation', { name: 'Admin sections' });
  if (!(await nav.isVisible())) await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  await nav.getByRole('link', { name: label, exact: true }).click();
}
/** WCAG 2.1 A/AA axe scan; fails on serious/critical violations. */
export async function axe(page: Page, label: string) {
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(300); // let transitions settle
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}
/** API client in the page's cookie session, sending CSRF like the SPA. */
export async function apiAs(page: Page) {
  const req: APIRequestContext = page.request;
  const tok = (await (await req.get('/api/auth/csrf')).json()).csrfToken as string;
  const h = { 'X-CSRF-Token': tok, Origin: 'http://localhost:4173' };
  return { get: (u: string) => req.get(u), post: (u: string, data: unknown) => req.post(u, { data, headers: h }), patch: (u: string, data: unknown) => req.patch(u, { data, headers: h }), put: (u: string, data: unknown) => req.put(u, { data, headers: h }) };
}
export async function subjectId(page: Page, code: string) {
  const r = await (await page.request.get('/api/config/subjects')).json(); return r.items.find((s: any) => s.code === code)._id as string;
}
