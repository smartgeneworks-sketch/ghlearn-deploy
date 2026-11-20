import { test, expect, type Page } from '@playwright/test';
import { login, axe, adminNav, subjectId, apiAs, U } from './helpers';
import { manualPdf } from './pdf';

/** Phase 8: question bank (§13), assessments, and educational games (§14) in the browser. AI is the scripted test model. */
test.describe.configure({ mode: 'serial' });
const stamp = Date.now(); const topic = `Speed and energy ${stamp}`; const gameTitle = `E2E flashcards ${stamp}`;
let bio = ''; let questionUrl = ''; let gameUrl = '';
const dialog = (page: Page) => page.getByRole('alertdialog');
const confirm = async (page: Page, button: string) => { await dialog(page).getByRole('button', { name: button, exact: true }).click(); await expect(dialog(page)).toHaveCount(0); };
const pickSubject = async (page: Page, label = 'Biology') => { const subj = page.getByRole('combobox', { name: 'Subject', exact: true });
  await expect(async () => { await subj.selectOption({ label }); await expect(subj).not.toHaveValue('', { timeout: 500 }); }).toPass(); };

test.setTimeout(120_000);
test('setup: an approved manual for generation', async ({ page }) => {
  await login(page, U.super); bio = await subjectId(page, 'BIO');
  const tok = (await (await page.request.get('/api/auth/csrf')).json()).csrfToken as string;
  const r = await page.request.post('/api/documents/upload', { headers: { 'X-CSRF-Token': tok, Origin: 'http://localhost:4173' }, multipart: { subjectId: bio, title: `E2E P8 manual ${stamp}`, file: { name: 'p8.pdf', mimeType: 'application/pdf', buffer: manualPdf(`phase8 ${stamp}`) } } });
  expect(r.status(), await r.text()).toBe(201); const docId = (await r.json()).document._id;
  await expect.poll(async () => (await (await page.request.get(`/api/documents/${docId}`)).json()).document.processingStatus, { timeout: 30_000 }).toBe('indexed');
  expect((await (await apiAs(page)).patch(`/api/documents/${docId}`, { approvalStatus: 'verified_official' })).status()).toBe(200);
});

test('editor: writes a question, checks the key, previews as a student, submits; cannot approve it', async ({ page }) => {
  await login(page, U.editor); await adminNav(page, 'Question Bank and Assessments');
  await expect(page.getByRole('heading', { name: 'Question Bank and Assessments' })).toBeVisible(); await axe(page, 'question bank list');
  await page.getByRole('navigation', { name: 'Question bank sections' }).getByRole('button', { name: 'Question types' }).click();
  await expect(page.getByRole('cell', { name: 'Teacher-marked', exact: true })).toBeVisible(); await axe(page, 'question types');
  await page.getByRole('navigation', { name: 'Question bank sections' }).getByRole('button', { name: 'New question' }).click();
  await pickSubject(page, 'Chemistry'); // keeps the Biology practice set of the scenario spec unchanged
  await page.getByLabel('Topic', { exact: true }).fill(topic); await page.getByLabel('Learning objective').fill('Define speed');
  await page.getByLabel('Time limit in seconds (optional)').fill('45');
  await page.getByLabel('Question', { exact: true }).fill(`E2E ${stamp}: which unit is used for speed?`);
  await page.getByLabel('Answer key and options (JSON)').fill(JSON.stringify({ options: ['metres per second', 'kilograms', 'newtons', 'joules'], correctIndex: 0 }));
  await page.getByLabel('Explanation (feedback after answering)').fill('Speed is distance divided by time.');
  await page.getByRole('button', { name: 'Check answer key' }).click();
  await expect(page.getByText('The answer key is consistent')).toBeVisible(); await expect(page.getByText(/scores 1\/1 \(full marks\)/)).toBeVisible();
  await axe(page, 'question editor');
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await expect(page.getByRole('heading', { name: 'Multiple choice question' })).toBeVisible(); questionUrl = new URL(page.url()).pathname;
  await page.getByLabel('A. metres per second').check(); await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByText('Preview only: nothing was saved.')).toBeVisible();
  await axe(page, 'question detail');
  await page.getByRole('button', { name: 'Submit for review' }).click(); await confirm(page, 'Submit for review');
  await expect(page.getByText('Awaiting review').first()).toBeVisible();
  await expect(page.getByText('Only Content Reviewers can approve, reject or request changes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});

test('reviewer: verifies the answer key and approves; sees assessments', async ({ page }) => {
  await login(page, U.super); await page.goto(questionUrl);
  const approve = page.getByRole('button', { name: 'Approve', exact: true }); await expect(approve).toBeDisabled();
  await page.getByLabel(/I checked the answer key/).check(); await approve.click(); await confirm(page, 'Approve');
  await expect(page.getByText('Approved (in bank)').first()).toBeVisible(); await expect(page.getByText('Answer key verified by Super Admin (Sample)')).toBeVisible();
  await expect(page.getByText(/Approved \(v1\) by Super Admin/)).toBeVisible(); await axe(page, 'approved question');
  await page.goto('/admin/questions?tab=assessments'); await expect(page.getByRole('heading', { name: 'Assessments', exact: true })).toBeVisible(); await axe(page, 'assessments tab');
  await page.goto('/admin/questions?tab=review'); await expect(page.getByText('0 question(s) awaiting review')).toBeVisible(); await axe(page, 'question review queue');
});

test('editor: generates draft questions from the approved manual, with an estimate first', async ({ page }) => {
  await login(page, U.editor); await page.goto('/admin/questions?tab=generate');
  await pickSubject(page); await page.getByLabel('Topic', { exact: true }).fill(topic);
  await expect(page.getByRole('region', { name: 'Estimate' })).toContainText('AI requests'); await axe(page, 'generate questions');
  await page.getByRole('button', { name: 'Generate drafts' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Created 1 draft/ })).toBeVisible({ timeout: 30_000 });
  await page.goto(`/admin/questions?tab=bank&status=draft&search=${encodeURIComponent('how fast an object moves')}`);
  await expect(page.getByText('(AI draft)').first()).toBeVisible();
});

test('editor: creates a game, sees validation and unverified answers, previews it and submits; a broken game cannot be submitted', async ({ page }) => {
  await login(page, U.editor); await adminNav(page, 'Educational Games');
  await expect(page.getByRole('heading', { name: 'Educational Games' })).toBeVisible(); await axe(page, 'games list');
  await page.getByRole('navigation', { name: 'Games sections' }).getByRole('button', { name: 'New game' }).click();
  await expect(page.getByRole('form', { name: 'New game' })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill(gameTitle); await pickSubject(page);
  await page.getByLabel('Topic', { exact: true }).fill('Cells'); await page.getByLabel('Learning objective').fill('Recall the parts of a cell');
  await page.getByLabel('Game content: cards (JSON)').fill(JSON.stringify([{ front: 'Nucleus', back: 'Controls the cell' }, { front: 'Membrane', back: 'Controls entry and exit' }, { front: 'Cell wall', back: 'Gives plant cells shape' }]));
  await axe(page, 'game editor');
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await expect(page.getByRole('heading', { name: gameTitle })).toBeVisible(); gameUrl = new URL(page.url()).pathname;
  await expect(page.getByText(/Validation passed: the dry run played/)).toBeVisible();
  await expect(page.getByText(/Unverified answers/)).toBeVisible();
  await page.getByRole('button', { name: 'Start preview' }).click(); await page.getByRole('button', { name: 'Flip card' }).click();
  await page.getByRole('button', { name: 'I knew it' }).click(); await expect(page.getByText(/Preview score 5/)).toBeVisible();
  await axe(page, 'game detail and preview');
  await page.getByRole('button', { name: 'Submit for review' }).click(); await confirm(page, 'Submit for review');
  await expect(page.getByText('Awaiting review').first()).toBeVisible();
  // a word that cannot be placed in the grid: validation fails, so there is nothing to submit
  const api = await apiAs(page);
  const r = await api.post('/api/game-designs', { title: `E2E broken ${stamp}`, subjectId: bio, topic: 'Cells', objective: 'Recall cell parts', type: 'word_search', content: { terms: [{ term: 'Cell wall', clue: 'Outer layer of plant cells' }, { term: 'Nucleus', clue: 'Control centre' }, { term: 'Vacuole', clue: 'Stores sap' }] } });
  expect(r.status()).toBe(201); await page.goto(`/admin/games/${(await r.json()).design._id}`);
  await expect(page.getByText('Validation failed: publishing is blocked.')).toBeVisible(); await expect(page.getByText(/must be one word/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);
});

test('reviewer: verifies the answers, approves and publishes the game', async ({ page }) => {
  await login(page, U.super); await page.goto(gameUrl);
  const approve = page.getByRole('button', { name: 'Approve', exact: true }); await expect(approve).toBeDisabled();
  await page.getByLabel('I played the preview and verified every answer in this game.').check(); await approve.click(); await confirm(page, 'Approve');
  await expect(page.getByText('Answers verified')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click(); await confirm(page, 'Publish');
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible(); await axe(page, 'published game');
});

test('student plays the published game; the reviewer sees participation', async ({ page }) => {
  await login(page, U.ama); await page.goto(`/learn/${bio}/games`);
  await expect(page.getByRole('heading', { name: 'Games for your topics' })).toBeVisible(); await axe(page, 'student games');
  await page.getByRole('button', { name: `Play ${gameTitle}` }).click();
  await expect(page.getByRole('heading', { name: gameTitle })).toBeVisible();
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Flip card' }).click(); await page.getByRole('button', { name: 'I knew it' }).click(); await page.getByRole('button', { name: i === 2 ? 'Finish' : 'Next' }).click(); }
  await expect(page.getByText('15 / 15')).toBeVisible(); await axe(page, 'game result');
  await login(page, U.super); await page.goto(gameUrl);
  await expect(page.getByText(/1 \(1 finished, 100% completion\)/)).toBeVisible();
});
