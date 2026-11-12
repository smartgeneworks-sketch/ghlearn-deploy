import { test, expect, type Page } from '@playwright/test';
import { login, axe, apiAs, adminNav, U } from './helpers';

/** Admin Phase 4 (spec §6, §7, §8, §15): users, schools, academic structure, classes and enrolment import; isolation and denial. */
test.describe.configure({ mode: 'serial' });
const dialog = (page: Page) => page.getByRole('alertdialog');
const confirm = async (page: Page, name: string | RegExp) => { await dialog(page).getByRole('button', { name, exact: typeof name === 'string' }).click(); await expect(dialog(page)).toHaveCount(0); };
let otherSchoolId = ''; let otherClassId = ''; let classId = '';

test('users: school admin creates a teacher, the temporary password is shown once, and first sign-in forces a change', async ({ page }) => {
  await login(page, U.admin);
  await adminNav(page, 'Users and Permissions');
  await page.getByRole('button', { name: 'Add user' }).click();
  const form = page.getByRole('region', { name: 'Add a user' });
  await form.getByLabel('Full name').fill('Esi Phase Four'); await form.getByLabel('Email').fill('esi.p4@sample.ghlearn.test');
  await form.getByLabel('Role').selectOption({ label: 'Teacher' });
  await form.getByRole('button', { name: 'Create user' }).click();
  const pw = (await page.getByLabel('Temporary password').textContent())!.trim(); expect(pw).toMatch(/^[A-Za-z0-9]{14}$/);
  await axe(page, 'users with one-time secret');
  await page.getByRole('button', { name: 'Done, hide it' }).click(); await expect(page.getByLabel('Temporary password')).toHaveCount(0);
  await page.getByRole('link', { name: 'Open Esi Phase Four' }).click();
  await expect(page.getByRole('heading', { name: 'Esi Phase Four', level: 1 })).toBeVisible();
  await expect(page.getByText('must change password')).toBeVisible();
  await axe(page, 'user detail');
  // The temporary password is never returned again (detail, list or audit).
  const api = await apiAs(page); const id = page.url().split('/').pop();
  expect(JSON.stringify(await (await api.get(`/api/admin/users/${id}`)).json())).not.toContain(pw);
  expect(JSON.stringify(await (await api.get(`/api/admin/users/${id}/audit`)).json())).not.toContain(pw);

  await login(page, 'esi.p4@sample.ghlearn.test', pw);
  await expect(page).toHaveURL(/\/change-password$/); await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  expect((await (await apiAs(page)).get('/api/config/levels')).status()).toBe(403);
  await page.goto('/teach'); await expect(page).toHaveURL(/\/change-password$/);
  await axe(page, 'forced password change');
  await page.getByLabel('Temporary password').fill(pw); await page.getByLabel('New password', { exact: true }).fill('MyOwnPass2026x'); await page.getByLabel('Confirm new password').fill('MyOwnPass2026x');
  await page.getByRole('button', { name: 'Save password and continue' }).click();
  await expect(page).not.toHaveURL(/change-password/); expect((await (await apiAs(page)).get('/api/config/levels')).status()).toBe(200);
  await login(page, 'esi.p4@sample.ghlearn.test', 'MyOwnPass2026x');
});

test('schools: super admin sees detail and analytics, suspends and reactivates a school (confirmed); members are blocked while suspended', async ({ page, request }) => {
  await login(page, U.super); const api = await apiAs(page);
  const r = await api.post('/api/admin/schools', { name: 'E2E Other School', code: 'e2e-other', region: 'Ashanti', district: 'Kumasi', type: 'public', levelKinds: ['SHS'] });
  expect(r.status()).toBe(201); otherSchoolId = (await r.json()).school._id;
  const t = await api.post('/api/admin/users', { fullName: 'Other Teacher', email: 'other.t@sample.ghlearn.test', role: 'teacher', schoolId: otherSchoolId }); expect(t.status()).toBe(201);
  const tpw = (await t.json()).temporaryPassword as string;
  const memberLogin = async () => { const tok = (await (await request.get('/api/auth/csrf')).json()).csrfToken; return request.post('/api/auth/login', { data: { email: 'other.t@sample.ghlearn.test', password: tpw }, headers: { 'X-CSRF-Token': tok, Origin: 'http://localhost:4173' } }); };
  const c = await api.post('/api/admin/classes', { name: 'Other 1A', schoolId: otherSchoolId }); expect(c.status()).toBe(201); otherClassId = (await c.json()).class._id;
  await page.goto(`/admin/schools/${otherSchoolId}`);
  await expect(page.getByRole('heading', { name: 'E2E Other School', level: 1 })).toBeVisible(); await expect(page.getByText('E2E-OTHER').first()).toBeVisible();
  await axe(page, 'school detail');
  await page.getByRole('button', { name: 'Suspend school' }).click(); await expect(dialog(page)).toContainText('lose access');
  await confirm(page, 'Suspend school');
  await expect(page.getByText(/This school is suspended/)).toBeVisible();
  expect((await (await api.get(`/api/admin/schools/${otherSchoolId}`)).json()).school.status).toBe('suspended');
  const blocked = await memberLogin(); expect(blocked.status()).toBe(403); expect((await blocked.json()).error.code).toBe('SCHOOL_INACTIVE');
  await page.getByRole('button', { name: 'Reactivate school' }).click(); await confirm(page, 'Reactivate school');
  await expect(page.getByText(/This school is suspended/)).toHaveCount(0);
  expect((await memberLogin()).status()).toBe(200);
  await page.goto('/admin/schools'); await expect(page.getByRole('link', { name: 'E2E Other School' })).toBeVisible(); await axe(page, 'schools list');
});

test('structure: deleting an item in use is blocked with its references; archive and restore are confirmed', async ({ page }) => {
  await login(page, U.super); await adminNav(page, 'Academic Structure');
  await page.getByRole('button', { name: 'Delete Senior High School' }).click(); await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog(page)).toContainText(/in use/i); await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('tab', { name: 'Combinations' }).click();
  await page.getByRole('button', { name: 'Archive Accounting (Econ/FAcc)' }).click(); await confirm(page, 'Archive');
  await expect(page.getByRole('button', { name: 'Archive Accounting (Econ/FAcc)' })).toHaveCount(0);
  await page.getByLabel('Show archived').check(); await page.getByRole('button', { name: 'Restore Accounting (Econ/FAcc)' }).click(); await confirm(page, 'Restore');
  await expect(page.getByRole('button', { name: 'Archive Accounting (Econ/FAcc)' })).toBeVisible();
  await axe(page, 'structure combinations');
  await page.getByRole('tab', { name: 'Curriculum elements' }).click(); await expect(page.getByRole('combobox', { name: 'Subject' })).toBeVisible(); await axe(page, 'curriculum elements');
});

test('classes: school admin creates a class, assigns a teacher, enrols, transfers and exports', async ({ page }) => {
  await login(page, U.admin); await adminNav(page, 'Classes and Enrolments');
  await expect(page.getByRole('heading', { name: 'Classes and enrolments', level: 1 })).toBeVisible(); await axe(page, 'classes list');
  const api = await apiAs(page);
  const b = await api.post('/api/admin/classes', { name: '1 Science B', yearOfStudy: 1 }); expect(b.status()).toBe(201);
  await page.getByRole('button', { name: 'Add class' }).click();
  const form = page.getByRole('region', { name: 'Add a class' });
  await form.getByLabel('Class name').fill('1 Science A'); await form.getByLabel('Academic year').selectOption({ label: '2026/2027 (current)' }); await form.getByLabel('Year of study').selectOption('1');
  await form.getByRole('button', { name: 'Add class' }).click();
  await expect(page.getByRole('heading', { name: '1 Science A', level: 1 })).toBeVisible(); classId = page.url().split('/').pop()!;
  await page.getByLabel('Add a teacher').selectOption({ label: 'Biology Teacher (Sample)' }); await page.getByRole('button', { name: 'Add teacher' }).click();
  await expect(page.getByRole('link', { name: 'Biology Teacher (Sample)' })).toBeVisible();
  await page.getByLabel(/Ama Mensah/).check(); await page.getByLabel(/Kofi Boateng/).check(); await page.getByRole('button', { name: /Enrol 2 selected/ }).click();
  await expect(page.getByText('2 enrolled.')).toBeVisible(); await expect(page.getByRole('heading', { name: 'Students (2)' })).toBeVisible();
  await axe(page, 'class detail');
  await page.getByLabel('Select Kofi Boateng (Sample Student)').check(); await page.getByLabel('Transfer 1 selected to').selectOption({ label: '1 Science B' });
  await page.getByRole('button', { name: 'Transfer', exact: true }).click(); await confirm(page, 'Transfer');
  await expect(page.getByRole('heading', { name: 'Students (1)' })).toBeVisible();
  // Delete is refused while students are enrolled (never silent).
  await page.getByRole('button', { name: 'Delete class' }).click(); await dialog(page).getByLabel(/Type 1 Science A/).fill('1 Science A');
  await dialog(page).getByRole('button', { name: 'Delete class' }).click(); await expect(dialog(page)).toContainText(/enrolled students/); await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  const csv = await (await page.request.get('/api/admin/classes/export.csv')).text();
  expect(csv).toContain('Ama Mensah (Sample Student)'); expect(csv).toContain('1 Science B'); expect(csv).not.toContain('Other 1A');
});

test('CSV import: template, preview with duplicates and errors, error report, commit valid rows, rollback', async ({ page }) => {
  await login(page, U.admin); await page.goto('/admin/classes/import');
  expect(await (await page.request.get('/api/admin/imports/enrolments/template.csv')).text()).toMatch(/^email,full_name,class,year_of_study,academic_year/);
  const csv = ['email,full_name,class,year_of_study,academic_year', 'ama@sample.ghlearn.test,Ama Mensah (Sample Student),1 Science A,1,2026/2027',
    'yaw.new@sample.ghlearn.test,Yaw New,1 Science A,1,2026/2027', 'not-an-email,Bad Row,1 Science A,1,2026/2027', 'yaw.new@sample.ghlearn.test,Yaw New,1 Science A,1,2026/2027'].join('\n');
  await page.getByLabel('Or paste CSV').fill(csv); await page.getByLabel(/Create accounts for students/).check();
  await page.getByRole('button', { name: 'Preview import' }).click();
  const rows = page.getByRole('table', { name: 'Import rows' }); await expect(rows).toBeVisible();
  await expect(rows).toContainText('Skip (already enrolled)'); await expect(rows).toContainText('Create account and enrol'); await expect(rows).toContainText('Error');
  await expect(page.getByRole('button', { name: 'Download error report' })).toBeVisible();
  await axe(page, 'import preview');
  await expect(page.getByRole('button', { name: 'Commit import' })).toBeDisabled();
  await page.getByLabel('Import only the valid rows').check(); await page.getByRole('button', { name: 'Commit import' }).click(); await confirm(page, 'Commit import');
  await expect(page.getByText(/new student accounts\./)).toBeVisible(); await expect(page.getByRole('button', { name: 'Download credentials CSV' })).toBeVisible();
  const api = await apiAs(page);
  const cls = await (await api.get(`/api/admin/classes/${classId}`)).json(); expect(cls.students.map((s: any) => s.email)).toContain('yaw.new@sample.ghlearn.test');
  await page.getByRole('button', { name: 'Done, hide them' }).click();
  await page.getByRole('button', { name: 'Roll back import' }).click(); await confirm(page, 'Roll back import');
  await expect(page.getByText(/Rolled back:/)).toBeVisible();
  const after = await (await api.get(`/api/admin/classes/${classId}`)).json(); expect(after.students.map((s: any) => s.email)).not.toContain('yaw.new@sample.ghlearn.test');
  expect(after.students.map((s: any) => s.email)).toContain('ama@sample.ghlearn.test');
  await expect(page.getByRole('table', { name: 'Enrolment imports' })).toContainText('rolled back');
});

test('isolation and denial: school admins cannot reach another school; teachers and other roles cannot use these endpoints', async ({ page }) => {
  await login(page, U.admin); const a = await apiAs(page);
  expect((await a.get(`/api/admin/classes/${otherClassId}`)).status()).toBe(404);
  expect([403, 404]).toContain((await a.get(`/api/admin/schools/${otherSchoolId}`)).status());
  expect((await a.get(`/api/admin/classes?schoolId=${otherSchoolId}`)).status()).toBe(403);
  expect((await a.post('/api/admin/classes', { name: 'Sneaky', schoolId: otherSchoolId })).status()).toBe(403);
  expect((await a.post('/api/admin/imports/enrolments', { csv: 'email,full_name,class\nx@y.z,X Y,Z', schoolId: otherSchoolId })).status()).toBe(403);
  expect((await a.post(`/api/admin/schools/${otherSchoolId}/status`, { status: 'suspended' })).status()).toBe(403);
  const others = await (await a.get('/api/admin/users?q=other.t')).json(); expect(others.items).toHaveLength(0);
  await page.goto(`/admin/classes/${otherClassId}`); await expect(page.getByText('Class not found')).toBeVisible();
  for (const email of [U.teacher, U.curriculum, U.kofi]) {
    await login(page, email); const x = await apiAs(page);
    for (const p of ['/api/admin/classes', '/api/admin/imports', `/api/admin/classes/${classId}`]) expect((await x.get(p)).status(), `${email} ${p}`).toBe(403);
    expect((await x.post('/api/admin/imports/enrolments', { csv: 'a' })).status(), email).toBe(403);
    expect((await x.post('/api/admin/users', { fullName: 'Nope Nope', email: 'nope@x.test', role: 'student' })).status(), email).toBe(403);
  }
  await login(page, U.kofi); await page.goto('/change-password'); await expect(page).not.toHaveURL(/change-password/);
});
