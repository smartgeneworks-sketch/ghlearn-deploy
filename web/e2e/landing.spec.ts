import { test, expect, type Page } from '@playwright/test';
import { login, axe, apiAs, U } from './helpers';

/** Public landing page and public website (docs/LANDING_SPEC.md): links, search, filters, demo quiz, FAQ, auth-aware nav, enquiries, admin editor, access protection, viewports. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  return errors;
}
const visitor = async (page: Page) => { await page.context().clearCookies(); await page.goto('/'); await page.evaluate(() => localStorage.clear()); };
const header = (page: Page) => page.getByRole('banner');

test('visitor: hero copy is verbatim, CTAs and nav anchors work, no console errors, axe clean', async ({ page }) => {
  const errors = watchConsole(page); await visitor(page); await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your Curriculum. Your AI Tutor. Your Path to Success.');
  await expect(page.getByText('Built around approved curriculum materials. Designed for active learning.')).toBeVisible();
  await expect(page).toHaveTitle(/GH Learn/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://ghlearn.com/og-image.png');
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Sign up free' }).first()).toHaveAttribute('href', '/register');
  await expect(header(page).getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/login');
  for (const [label, id] of [['Explore Subjects', 'subjects'], ['How It Works', 'how-it-works'], ['AI Tutor', 'ai-tutor'], ['Practice & Games', 'practice'], ['Live Sessions', 'live-sessions']]) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label }).click();
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'For Teachers' }).click();
  await expect(page).toHaveURL(/\/teachers$/); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('region', { name: 'Announcement' }).getByRole('button', { name: 'Dismiss announcement' }).click().catch(() => {});
  await axe(page, 'landing');
  expect(errors).toEqual([]);
});

test('live sessions: honest copy, example booking, lazy responsive photo, role-aware CTA', async ({ page }) => {
  const errors = watchConsole(page); await visitor(page); await page.goto('/');
  const sec = page.locator('#live-sessions');
  await expect(sec.getByRole('heading', { level: 2 })).toHaveText('Learn live with your teachers');
  await expect(sec.getByRole('heading', { level: 3 })).toHaveCount(4);
  await expect(sec).toContainText('at your own school'); await expect(sec).toContainText('Example booking');
  const img = sec.getByRole('img', { name: /student wearing glasses/ });
  await expect(img).toHaveAttribute('loading', 'lazy');
  await sec.scrollIntoViewIfNeeded(); await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  expect(await img.evaluate((i: HTMLImageElement) => i.currentSrc)).toMatch(/student-live-\d+\.(avif|webp)$/);
  await sec.getByRole('link', { name: 'Sign up to book a session' }).click(); await expect(page).toHaveURL(/\/register$/);
  await page.goto('/#faq'); await page.getByRole('button', { name: 'Can I meet my teachers live?' }).click();
  await expect(page.getByRole('region', { name: 'Can I meet my teachers live?' })).toContainText('does not host the video call');
  await axe(page, 'live sessions');
  expect(errors).toEqual([]);
  await login(page, U.ama); await page.goto('/welcome');
  await page.locator('#live-sessions').getByRole('link', { name: 'Book a live session' }).click();
  await expect(page).toHaveURL(/\/meetings$/); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await login(page, U.teacher); await page.goto('/welcome');
  await expect(page.locator('#live-sessions').getByRole('link', { name: 'Manage your sessions' })).toHaveAttribute('href', '/meetings');
});

test('every internal link on the public pages leads to a real page (no dead links)', async ({ page }) => {
  const errors = watchConsole(page); await visitor(page);
  const seen = new Set<string>(); const queue = ['/', '/subjects', '/teachers', '/schools', '/help', '/contact', '/accessibility'];
  const pages = new Set(queue);
  for (const p of queue) {
    await page.goto(p); await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const href of await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!))) {
      if (href.startsWith('mailto:')) { expect(href).toMatch(/^mailto:[^@\s]+@[^@\s]+$/); continue; }
      if (href.startsWith('tel:')) { expect(href).toBe('tel:+233530506573'); continue; }
      if (/^https?:/.test(href)) { expect(href, `external link on ${p}`).toMatch(/^https:\/\//); continue; }
      if (href.startsWith('#')) { const id = href.slice(1); if (id) expect(await page.locator(`[id="${id}"]`).count(), `${href} on ${p}`).toBeGreaterThan(0); continue; }
      seen.add(href);
    }
  }
  for (const href of seen) {
    const [path, hash] = href.split('#'); await page.goto(href);
    await expect(page.getByText('Page not found.'), href).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 }).first(), href).toBeVisible();
    if (hash && pages.has(path || '/')) await expect(page.locator(`[id="${hash}"]`), href).toHaveCount(1);
  }
  expect(seen.size).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('footer: SmartGene Solutions details, data protection commitment, language note, get help, back to top', async ({ page }) => {
  await visitor(page); await page.goto('/');
  const f = page.getByRole('contentinfo'); const org = f.getByRole('region', { name: 'SmartGene Solutions', exact: true });
  await expect(org).toContainText('P. O. Box AH1237, Achimota, Accra, Ghana');
  await expect(org.getByRole('link', { name: 'info@smartgenesolutions.com' })).toHaveAttribute('href', 'mailto:info@smartgenesolutions.com');
  await expect(f).not.toContainText('Powered by'); await expect(page.locator('body')).not.toContainText('smartgeneworks@gmail.com');
  await expect(org.getByRole('link', { name: '+233 53 050 6573' })).toHaveAttribute('href', 'tel:+233530506573');
  await expect(org).toContainText('#smartgene');
  await expect(f).toContainText('Data Protection Act, 2012 (Act 843)'); await expect(f).toContainText('not a certification');
  await expect(f).toContainText('Learning content is currently in English.');
  await expect(f.getByRole('link', { name: /facebook|twitter|instagram|linkedin|youtube|tiktok/i })).toHaveCount(0);
  await f.getByRole('link', { name: 'Back to top' }).click(); await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
  await f.getByRole('link', { name: /Get help/ }).click(); await expect(page).toHaveURL(/\/help$/);
  await page.goto('/contact'); await expect(page.getByRole('main')).toContainText('+233 53 050 6573'); await expect(page.getByRole('main')).toContainText('P. O. Box AH1237, Achimota, Accra, Ghana');
});

test('search: debounced public search finds subjects and verified topics; restricted lessons never appear', async ({ page }) => {
  const errors = watchConsole(page); await visitor(page); await page.goto('/');
  let calls = 0; page.on('request', (r) => { if (r.url().includes('/api/public/search')) calls++; });
  const box = page.getByRole('searchbox'); await box.pressSequentially('Biolo', { delay: 30 });
  const res = page.getByTestId('search-results');
  await expect(res.getByRole('link', { name: /Biology/ }).first()).toBeVisible();
  expect(calls).toBeLessThanOrEqual(2); // debounced: not one request per keystroke
  await res.getByRole('link', { name: /Biology/ }).first().click();
  await expect(page).toHaveURL(/\/subjects\/[a-f0-9]{24}/); await expect(page.getByRole('heading', { level: 1 })).toContainText('Biology');
  await page.goto('/'); await box.fill('zzzqqq'); await expect(page.locator('#search')).toContainText('No public results');
  await page.getByRole('button', { name: 'Clear search' }).click(); await expect(box).toHaveValue('');
  // Seeded published resources and unpublished drafts are not public previews, so they never surface; each lesson hit is open to visitors.
  const r = await (await page.request.get('/api/public/search?q=SAMPLE')).json();
  for (const l of r.lessons) expect((await page.request.get(`/api/public/lessons/${l.id}`)).status()).toBe(200);
  expect(JSON.stringify(r)).not.toMatch(/Sample content|markdown/);
  expect((await page.request.get('/api/public/search?q=(.*)')).status()).toBe(200); // regex is escaped
  expect((await page.request.get('/api/public/search?q=a')).status()).toBe(422);
  expect(errors).toEqual([]);
});

test('subject filters show real subjects with real counts', async ({ page }) => {
  await visitor(page); await page.goto('/');
  const sec = page.locator('#subjects'); const group = sec.getByRole('group', { name: 'Filter subjects' });
  const featured = await (await page.request.get('/api/public/subjects?featured=1')).json();
  await expect(sec.getByRole('link', { name: /^Explore Subject:/ })).toHaveCount(featured.items.length);
  for (const f of ['shs', 'math-science', 'languages']) {
    const label = { shs: 'SHS', 'math-science': 'Mathematics and Sciences', languages: 'Languages' }[f]!;
    const api = await (await page.request.get(`/api/public/subjects?filter=${f}`)).json();
    await group.getByRole('button', { name: label, exact: true }).click();
    await expect(group.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    if (api.levelClosed) await expect(sec).toContainText('subjects are not open on the platform yet');
    else { await expect(sec.getByRole('link', { name: /^Explore Subject:/ })).toHaveCount(api.items.length);
      for (const s of api.items.slice(0, 3)) await expect(sec.getByRole('link', { name: `Explore Subject: ${s.name}` })).toHaveAttribute('href', `/subjects/${s.id}`); }
  }
  await sec.getByRole('link', { name: 'View all subjects' }).click(); await expect(page).toHaveURL(/\/subjects$/);
  const all = await (await page.request.get('/api/public/subjects')).json();
  await expect(page.getByRole('link', { name: /^Explore Subject:/ })).toHaveCount(all.items.length);
  await axe(page, 'subjects page');
});

test('demo quiz and FAQ accordion work by keyboard', async ({ page }) => {
  await visitor(page); await page.goto('/#sample-quiz');
  const quiz = page.locator('#sample-quiz'); await expect(quiz).toContainText('Demo question');
  await quiz.getByRole('button', { name: 'Oxygen' }).click(); await expect(quiz).toContainText('Not quite'); await expect(quiz).toContainText('Why:');
  await quiz.getByRole('button', { name: 'Next question' }).click(); await quiz.getByRole('button', { name: '15', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(quiz).toContainText('Correct!');
  await quiz.getByRole('button', { name: 'Next question' }).click(); await quiz.getByRole('button', { name: /Planting trees/ }).click();
  await expect(quiz.getByRole('status')).toContainText('You scored 2 of 3.');
  await quiz.getByRole('button', { name: 'Try again' }).click(); await expect(quiz).toContainText('Question 1 of 3');
  const faq = page.locator('#faq'); const q = faq.getByRole('button', { name: 'Is the platform free?' });
  await q.focus(); await page.keyboard.press('Enter'); await expect(q).toHaveAttribute('aria-expanded', 'true');
  await expect(faq.getByRole('region', { name: 'Is the platform free?' })).toBeVisible();
  await page.keyboard.press('Space'); await expect(q).toHaveAttribute('aria-expanded', 'false');
  await axe(page, 'quiz and faq');
});

test('auth-aware navigation: students, teachers and admins get Continue Learning to their own home', async ({ page }) => {
  const errors = watchConsole(page);
  for (const [email, home, admin, teach] of [[U.ama, /\/learn$/, false, false], [U.teacher, /\/teach$/, false, false], [U.super, /\/admin$/, false, false]] as const) {
    await login(page, email); await page.waitForLoadState('networkidle');
    errors.length = 0; // login() clears cookies under the previous user's open dashboard; its polling 401s are not part of this check
    await page.goto('/'); await expect(page).not.toHaveURL(/\/welcome/); await expect(page.getByRole('heading', { name: 'Your Curriculum. Your AI Tutor. Your Path to Success.' })).toHaveCount(0); // "/" is the dashboard
    await page.goto('/welcome'); const h = header(page);
    await expect(h.getByRole('link', { name: 'Log In' })).toHaveCount(0);
    const cont = h.getByRole('link', { name: 'Continue Learning' }); await expect(cont).toBeVisible();
    expect(await h.getByRole('link', { name: /Admin panel/ }).count() > 0).toBe(admin);
    expect(await h.getByRole('link', { name: /Teacher workspace/ }).count() > 0).toBe(teach);
    await cont.click(); await expect(page).toHaveURL(home);
    await page.goto('/schools'); await header(page).getByRole('link', { name: /go to your dashboard/ }).click(); await expect(page).toHaveURL(home);
    await page.waitForLoadState('networkidle'); expect(errors, email).toEqual([]);
  }
  await login(page, U.admin); await page.goto('/welcome'); // school admin who is not a teacher: home is the admin panel
  await expect(header(page).getByRole('link', { name: 'Continue Learning' })).toHaveAttribute('href', '/admin');
  expect(errors).toEqual([]);
});

test('access protection: private routes need sign-in; students cannot reach admin content; public lesson endpoint hides everything else', async ({ page }) => {
  await visitor(page);
  for (const p of ['/learn', '/progress', '/teach', '/admin', '/admin/website']) { await page.goto(p); await expect(page.getByRole('heading', { name: 'Sign in' }), p).toBeVisible(); }
  for (const p of ['/api/admin/website/landing', '/api/admin/website/enquiries']) expect((await page.request.get(p)).status(), p).toBe(401);
  expect((await page.request.get('/api/public/lessons/0123456789abcdef01234567')).status()).toBe(404);
  expect((await page.request.get('/api/public/lessons/not-an-id')).status()).toBe(404);
  await page.goto('/preview/0123456789abcdef01234567'); await expect(page.getByRole('main')).toContainText(/not available/i);
  await login(page, U.ama); await page.goto('/admin/website'); await expect(page.getByText('You do not have access to this page.')).toBeVisible();
  const api = await apiAs(page);
  expect((await api.get('/api/admin/website/enquiries')).status()).toBe(403);
  expect((await api.put('/api/admin/website/landing', { content: {} })).status()).toBe(403);
});

test('school enquiry and contact message are saved and managed in the admin panel', async ({ page }) => {
  const errors = watchConsole(page); await visitor(page); const org = `E2E Academy ${Date.now()}`;
  await page.goto('/schools'); const form = page.getByRole('form', { name: 'School enquiry form' });
  await form.getByRole('button', { name: 'Send enquiry' }).click();
  await expect(form.getByLabel(/^Your name/)).toBeFocused(); await expect(form.getByText(/agree/).first()).toBeVisible();
  await form.getByLabel(/^Your name/).fill('Esi Mensah'); await form.getByLabel(/^Email/).fill('esi@e2e.test');
  await form.getByLabel(/^School or organisation/).fill(org); await form.getByLabel(/^Number of learners/).fill('420');
  await form.getByLabel(/^What would you like to know/).fill('We would like a pilot for our SHS 1 classes.');
  await form.getByRole('checkbox').check(); await axe(page, 'school enquiry form');
  await form.getByRole('button', { name: 'Send enquiry' }).click();
  await expect(page.getByRole('status')).toContainText('Thank you, your message has been received.');
  await page.goto('/help#contact'); const c = page.getByRole('form', { name: 'Contact form' });
  await c.getByLabel(/^Your name/).fill('Kwame'); await c.getByLabel(/^Email/).fill('kwame@e2e.test'); await c.getByLabel('Topic').selectOption('Accessibility');
  await c.getByLabel(/^Message/).fill('The diagrams are great with a screen reader.'); await c.getByRole('checkbox').check();
  await c.getByRole('button', { name: 'Send message' }).click(); await expect(page.getByRole('status')).toContainText('Thank you');
  // honeypot: bots filling the hidden field are refused
  expect((await (await apiAs(page)).post('/api/public/enquiries', { kind: 'contact', name: 'Bot', email: 'b@b.co', message: 'spam spam', consent: true, website: 'x' })).status()).toBe(422);
  expect(errors).toEqual([]);
  await login(page, U.super); await page.goto('/admin/website'); await page.getByRole('tab', { name: 'Enquiries' }).click();
  const card = page.getByRole('listitem').filter({ hasText: org });
  await expect(card).toContainText('School enquiry'); await expect(card).toContainText('420 learners'); await expect(card).toContainText(/email not configured|notification/);
  await card.getByLabel('Status').selectOption('in_progress'); await expect(card.getByLabel('Status')).toHaveValue('in_progress');
  await card.getByLabel('Internal note').fill('Called back'); await card.getByRole('button', { name: 'Save note' }).click();
  await expect(card.getByRole('button', { name: 'Save note' })).toBeDisabled();
  await expect(page.getByRole('listitem').filter({ hasText: 'The diagrams are great' })).toContainText('Contact: Accessibility');
  await axe(page, 'admin enquiries');
});

test('admin edits landing content: validated, audited, shown live, restorable', async ({ page }) => {
  await login(page, U.super); await page.goto('/admin/website');
  await expect(page.getByRole('heading', { name: 'Public Website', level: 1 })).toBeVisible();
  await page.getByLabel('Show the announcement bar').check(); const ann = page.getByLabel('Announcement text'); await ann.fill('E2E open day on Saturday');
  await page.getByLabel('Phone (as displayed)').fill('call me maybe');
  await page.getByRole('button', { name: 'Save landing content' }).click();
  await expect(page.getByText(/organisation\.phone/).first()).toBeVisible(); // validation issue with its path; nothing saved
  await page.getByLabel('Phone (as displayed)').fill('+233 53 050 6573');
  await page.getByRole('button', { name: 'Save landing content' }).click(); await expect(page.getByRole('status').filter({ hasText: /Saved/ })).toBeVisible();
  await axe(page, 'admin website editor');
  const ctx = await page.context().browser()!.newContext(); const v = await ctx.newPage();
  await expect(async () => { await v.goto('/'); await expect(v.getByRole('region', { name: 'Announcement' })).toContainText('E2E open day on Saturday', { timeout: 2000 }); }).toPass({ timeout: 30_000 });
  await ctx.close();
  const api = await apiAs(page); const audit = await (await api.get('/api/admin/audit?action=landing.update')).json();
  expect(JSON.stringify(audit)).toContain('landing.update');
  await page.getByRole('button', { name: 'Restore defaults' }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Restore defaults' }).click();
  await expect(page.getByLabel('Announcement text')).not.toHaveValue('E2E open day on Saturday');
});

for (const [name, vp] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 768, height: 1024 }], ['desktop', { width: 1440, height: 900 }]] as const) {
  test(`landing on ${name}: no horizontal scroll, menu reachable, axe clean, no console errors`, async ({ page }) => {
    const errors = watchConsole(page); await page.setViewportSize(vp); await visitor(page);
    for (const p of ['/', '/schools', '/help', '/accessibility']) {
      await page.goto(p); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.scrollWidth), p).toBeLessThanOrEqual(vp.width);
    }
    await page.goto('/');
    if (vp.width < 1280) {
      await page.getByRole('button', { name: 'Open menu' }).click();
      const m = page.getByRole('navigation', { name: 'Mobile' }); await expect(m.getByRole('link').first()).toBeFocused();
      await page.keyboard.press('Escape'); await expect(m).toBeHidden();
      await page.getByRole('button', { name: 'Open menu' }).click(); await m.getByRole('link', { name: 'For Schools' }).click(); await expect(page).toHaveURL(/\/schools$/);
    } else await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await page.goto('/'); await axe(page, `landing ${name}`);
    expect(errors).toEqual([]);
  });
}

/** Sign-up is easy to find: header button (in the bar on phones too), both hero CTAs above the fold, teacher section, final band, footer, sign-in and register pages. */
for (const vp of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'phone', width: 390, height: 844 }]) {
  test(`sign-up is prominent on ${vp.name}`, async ({ page }) => {
    const errors = watchConsole(page); await page.setViewportSize({ width: vp.width, height: vp.height }); await visitor(page); await page.goto('/');
    const signUp = header(page).getByRole('button', { name: 'Sign up' });
    await expect(signUp).toBeVisible(); await expect(signUp).toBeInViewport();
    const hero = page.getByRole('region', { name: /Your Curriculum/ });
    const student = hero.getByRole('link', { name: 'Sign up free' }); const teacher = hero.getByRole('link', { name: 'I’m a teacher — apply' });
    for (const l of [student, teacher]) { const b = (await l.boundingBox())!; expect(b.y + b.height, 'above the fold').toBeLessThanOrEqual(vp.height); }
    await expect(teacher).toHaveAttribute('href', '/register/teacher');
    // the header stays visible while scrolling
    await page.mouse.wheel(0, 2500); await expect(signUp).toBeInViewport();
    await signUp.click(); await expect(signUp).toHaveAttribute('aria-expanded', 'true');
    await axe(page, `sign-up menu ${vp.name}`);
    await header(page).getByRole('link', { name: /I’m a teacher/ }).click(); await expect(page).toHaveURL(/\/register\/teacher$/);
    await page.goto('/'); const ts = page.locator('#teachers');
    await expect(ts.getByRole('link', { name: 'Apply for a teacher account' })).toHaveAttribute('href', '/register/teacher');
    await expect(ts).toContainText('An administrator checks your school and subjects');
    await expect(page.getByRole('region', { name: /next breakthrough/ }).getByRole('link', { name: 'I’m a teacher — apply' })).toHaveAttribute('href', '/register/teacher');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Teacher application' })).toHaveAttribute('href', '/register/teacher');
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Create a student account' })).toBeVisible(); await expect(page.getByRole('link', { name: 'Teacher? Apply here' })).toBeVisible();
    await axe(page, `login ${vp.name}`);
    await page.goto('/register'); await expect(page.getByRole('link', { name: 'Apply for a teacher account' })).toBeInViewport();
    await axe(page, `register ${vp.name}`);
    expect(errors).toEqual([]);
  });
}
