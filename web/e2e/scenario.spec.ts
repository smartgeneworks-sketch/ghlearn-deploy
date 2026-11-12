import { test, expect } from '@playwright/test';
import { login, logout, axe, apiAs, subjectId, adminNav, U } from './helpers';

/**
 * Acceptance scenario (spec §20, 12 steps) end-to-end in a real browser against the production build.
 * AI is the scripted test model (no external calls); everything else is the real stack.
 */
test.describe.configure({ mode: 'serial' });
const student = { name: 'Abena Owusu', email: `abena${Date.now()}@e2e.test`, pw: 'StudyHard2026' };
let bio = ''; let docUrl = ''; let lessonUrl = '';

test('1. super admin signs in and sees schools in the admin panel', async ({ page }) => {
  await login(page, U.super);
  await expect(page).toHaveURL(/\/admin$/);
  await adminNav(page, 'Schools and Institutions');
  await expect(page.getByText('Sample Academy (Sample)').first()).toBeVisible();
  await axe(page, 'admin config');
});

test('2. curriculum editor uploads a learner manual and it is processed', async ({ page }) => {
  await login(page, U.editor); bio = await subjectId(page, 'BIO');
  await adminNav(page, 'Learner Manuals');
  await page.getByLabel(/^File \(PDF, DOCX, TXT or CSV/).setInputFiles(process.env.E2E_PDF ?? '/tmp/e2e-manual.pdf');
  await page.getByLabel('Title (optional)').fill('E2E Biology learner manual');
  await page.getByLabel('Subject (optional)').selectOption({ label: 'Biology (BIO)' });
  await page.getByRole('button', { name: 'Upload & process' }).click();
  await page.getByRole('link', { name: /E2E Biology learner manual/ }).first().click();
  docUrl = page.url();
  await expect(page.getByText(/indexed/i).first()).toBeVisible({ timeout: 60_000 });
  await axe(page, 'document detail');
});

test('3. editor confirms mapping; super admin verifies the source as official', async ({ page }) => {
  await login(page, U.editor); await page.goto(docUrl);
  await page.getByRole('button', { name: 'Save & confirm mapping' }).click();
  await expect(page.getByText(/confirmed/i).first()).toBeVisible();
  await logout(page); await login(page, U.super); await page.goto(docUrl);
  await page.getByRole('button', { name: 'Mark verified official' }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Mark verified official' }).click();
  await expect(page.getByText(/verified.official/i).first()).toBeVisible();
});

test('4. editor generates a structured A–K lesson draft from the manual', async ({ page }) => {
  await login(page, U.editor);
  await adminNav(page, 'AI Content Generation'); await page.waitForLoadState('networkidle');
  const subj = page.getByRole('combobox', { name: 'Subject', exact: true });
  await expect(async () => { await subj.selectOption({ label: 'Biology' }); await expect(subj).not.toHaveValue('', { timeout: 500 }); }).toPass();
  await page.getByLabel('Topic', { exact: true }).fill('Cells and organelles');
  await expect(page.getByRole('button', { name: 'Generate lesson' })).toBeEnabled(); // estimate says it can run
  await page.getByRole('button', { name: 'Generate lesson' }).click();
  await expect(page).toHaveURL(/\/admin\/lessons\/[a-f0-9]{24}/); lessonUrl = page.url();
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeEnabled({ timeout: 60_000 });
  for (const t of ['A. Lesson identification', 'B. Learning objectives', 'K. Source references']) await expect(page.getByRole('heading', { name: t })).toBeVisible();
});

test('5. editor submits the lesson for review', async ({ page }) => {
  await login(page, U.editor); await page.goto(lessonUrl);
  await page.getByRole('button', { name: 'Submit for review' }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Awaiting review').first()).toBeVisible();
});

test('6. reviewer approves and publishes; approved questions are published too', async ({ page }) => {
  await login(page, U.super); await page.goto(lessonUrl);
  await page.getByRole('button', { name: 'Approve' }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('button', { name: 'Publish', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published').first()).toBeVisible();
  // question bank: approved MCQs for practice (the authoring UI is covered in phase8.spec; created here via API).
  // The editor writes and submits; a different person (the reviewer) verifies the key and approves.
  await login(page, U.editor); const ed = await apiAs(page); const ids: string[] = [];
  for (const [i, stem] of ['Which part of the cell controls what enters and leaves?', 'Which organelle contains the genetic material of a cell?'].entries()) {
    const q = await ed.post('/api/questions', { subjectId: bio, topic: 'Cells', type: 'mcq', stem, data: { options: i ? ['Nucleus', 'Ribosome', 'Vacuole'] : ['Cell membrane', 'Cell wall', 'Nucleus'], correctIndex: 0 }, explanation: 'From the manual' });
    expect(q.status(), await q.text()).toBe(201); const id = (await q.json()).question._id; ids.push(id);
    expect((await ed.post(`/api/questions/${id}/submit`, {})).status()).toBe(200);
  }
  await login(page, U.super); const api = await apiAs(page);
  for (const id of ids) expect((await api.post(`/api/questions/${id}/review`, { action: 'approve', answerKeyVerified: true })).status()).toBe(200);
});

test('6b. reviewer shows the published lesson as a public preview; visitors find and read it without answers', async ({ page, browser }) => {
  await login(page, U.super); await page.goto(lessonUrl);
  await page.getByRole('button', { name: 'Show as public preview' }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Show as public preview' }).click();
  await expect(page.getByText(/Visitors can read it at/)).toBeVisible();
  const id = lessonUrl.match(/[a-f0-9]{24}/)![0];
  const anon = await browser.newContext({ reducedMotion: 'reduce' }); const v = await anon.newPage();
  await v.goto('/'); await v.getByRole('searchbox').fill('organelles');
  const hit = v.getByTestId('search-results').getByRole('link', { name: /Cells and organelles/ });
  await expect(hit).toHaveAttribute('href', `/preview/${id}`); await hit.click();
  await expect(v).toHaveURL(new RegExp(`/preview/${id}`)); await expect(v.getByText('Learning objectives').first()).toBeVisible();
  await expect(v.getByRole('heading', { name: /^(C|I|T)\. / })).toHaveCount(0);
  const pub = await (await v.request.get(`/api/public/lessons/${id}`)).json();
  expect(pub.lesson.sections.map((x: any) => x.key).filter((k: string) => ['C', 'I', 'T'].includes(k))).toEqual([]);
  expect(JSON.stringify(pub)).not.toMatch(/correctIndex|answerKey|teacherNotes/);
  await axe(v, 'public lesson preview');
  // Turning the preview off removes it from search and the public endpoint at once.
  await page.getByRole('button', { name: 'Remove public preview' }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Remove public preview' }).click();
  await expect(page.getByText(/Public preview:.*off/)).toBeVisible();
  expect((await v.request.get(`/api/public/lessons/${id}`)).status()).toBe(404);
  expect((await (await v.request.get('/api/public/search?q=organelles')).json()).lessons).toEqual([]);
  // ...and on again, so the rest of the scenario keeps a public example.
  await page.getByRole('button', { name: 'Show as public preview' }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Show as public preview' }).click();
  await expect(page.getByText(/Visitors can read it at/)).toBeVisible(); await anon.close();
});

test('7. a new student registers', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(student.name); await page.getByLabel('Email', { exact: true }).fill(student.email);
  await page.getByLabel('Password', { exact: true }).fill(student.pw); await page.getByLabel('I agree to the terms of use and privacy notice.').check();
  await axe(page, 'register');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your learning space' })).toBeVisible();
});

test('8. onboarding: region, typed school name, level, Learning Area and core + elective subjects', async ({ page }) => {
  await login(page, student.email, student.pw);
  await page.getByLabel('Region').selectOption('Ashanti');
  await page.getByLabel('School name').fill('Sample Academy'); // free text, linked automatically when it matches
  await axe(page, 'onboarding region & school');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Level').selectOption({ label: 'Senior High School' });
  await page.getByLabel('Learning Area (optional)').selectOption({ label: 'General Science' });
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('group', { name: /Core subjects/ }).getByLabel('Mathematics')).toBeChecked(); // core pre-selected, can be unticked
  const el = page.getByRole('group', { name: /Elective subjects/ });
  await el.getByLabel('Biology').check(); await el.getByLabel('Economics').check(); // science + business mix: no combination limits
  await axe(page, 'onboarding subjects');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Ashanti')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'My subjects' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Biology' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Economics' })).toBeVisible();
});

test('9. student opens the published lesson and saves it for offline', async ({ page }) => {
  await login(page, student.email, student.pw);
  await page.getByRole('heading', { name: 'Biology' }).click();
  await page.getByRole('link', { name: 'Cells and organelles' }).click();
  await expect(page.getByText('Learning objectives').first()).toBeVisible();
  await expect(page.getByText(/checked by a reviewer/)).toBeVisible();
  await axe(page, 'lesson view');
  const save = page.getByRole('button', { name: 'Save for offline' });
  await page.evaluate(() => navigator.serviceWorker.ready); await page.reload();
  await save.click(); await expect(page.getByText(/Saved\. Open it any time/)).toBeVisible();
  const ctx = page.context(); await ctx.setOffline(true);
  await page.goto('/saved'); await page.getByRole('link', { name: 'Cells and organelles' }).click();
  await expect(page.getByText('Learning objectives').first()).toBeVisible();
  await ctx.setOffline(false);
});

test('10. student asks the subject tutor and gets a cited, source-labelled answer', async ({ page }) => {
  await login(page, student.email, student.pw);
  await page.goto(`/learn/${bio}/tutor`);
  await page.getByPlaceholder('Ask about this subject…').fill('What does the cell membrane do?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('main').getByRole('paragraph').filter({ hasText: 'controls what enters and leaves' }).first()).toBeVisible();
  await expect(page.getByRole('main').getByRole('paragraph').filter({ hasText: 'General knowledge (not from your curriculum materials)' })).toBeVisible();
  await expect(page.getByText('Sources (1)')).toBeVisible();
  await axe(page, 'tutor');
});

test('11. student practises (auto-marked) and plays a game', async ({ page }) => {
  await login(page, student.email, student.pw);
  await page.goto(`/learn/${bio}/practice`);
  await page.getByRole('button', { name: 'Start' }).first().click();
  await expect(page.getByRole('radiogroup')).toHaveCount(2);
  for (const item of await page.getByRole('main').getByRole('listitem').all()) {
    const stem = await item.getByRole('paragraph').first().innerText();
    await item.getByRole('radio', { name: stem.includes('genetic') ? /Nucleus/ : /Cell membrane/ }).check();
  }
  await expect(page.getByText(/unanswered/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page.getByText('2/2 (100%)')).toBeVisible();
  await axe(page, 'practice result');
  await page.goto(`/learn/${bio}/games`);
  await page.getByRole('button', { name: 'Play' }).first().click();
  await expect(page.getByRole('button', { name: /End game|Finish|Check|Flip card/ }).first()).toBeVisible();
  await axe(page, 'game');
});

test('12. teacher builds a class, sees the student and exports a report; admin sees analytics', async ({ page }) => {
  await login(page, U.teacher);
  await page.getByRole('link', { name: 'Teaching' }).click();
  await page.getByLabel('Class name').fill('1 Science E2E'); await page.getByLabel('Subject').selectOption({ label: 'Biology' });
  await page.getByRole('button', { name: 'Create class' }).click();
  await page.getByRole('link', { name: '1 Science E2E' }).click();
  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByLabel(student.name).check(); await page.getByRole('button', { name: /Add 1 student/ }).click();
  await page.getByRole('tab', { name: 'Students' }).click();
  await expect(page.getByRole('link', { name: student.name })).toBeVisible();
  await axe(page, 'class view');
  const dl = page.waitForEvent('download'); await page.getByRole('button', { name: 'PDF report' }).click();
  expect((await dl).suggestedFilename()).toMatch(/^class-report-.*\.pdf$/);
  await logout(page); await login(page, U.admin);
  await adminNav(page, 'Learning Analytics');
  await expect(page.getByText(/Learning figures for your school/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Active users/ })).toBeVisible();
  await axe(page, 'analytics');
});
