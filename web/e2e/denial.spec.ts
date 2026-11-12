import { test, expect } from '@playwright/test';
import { login, apiAs, subjectId, U } from './helpers';

/** URL and API manipulation must be denied by the server, not just hidden in the UI. */
test('students cannot reach staff pages or APIs by editing URLs or calling the API directly', async ({ page }) => {
  await login(page, U.kofi); // Business student: not enrolled in Biology
  const bio = await subjectId(page, 'BIO');
  for (const path of ['/admin/users', '/admin/documents', '/admin/analytics', '/admin/audit', '/teach', '/teach/assess', '/admin/questions']) {
    await page.goto(path);
    await expect(page.getByText(/do not have access|not found|Missing permission|Forbidden/i).first(), path).toBeVisible();
  }
  await page.goto(`/learn/${bio}`); await expect(page.getByText('You are not enrolled in this subject.')).toBeVisible();
  const api = await apiAs(page);
  const deny = async (p: Promise<any>, label: string) => expect([401, 403, 404], label).toContain((await p).status());
  await deny(api.get('/api/admin/users'), 'list users');
  await deny(api.get('/api/analytics'), 'analytics');
  await deny(api.get('/api/admin/audit'), 'audit');
  await deny(api.get(`/api/subjects/${bio}/resources`), 'other subject resources');
  await deny(api.get(`/api/offline/${bio}`), 'offline pack other subject');
  await deny(api.get(`/api/questions?subjectId=${bio}`), 'question bank');
  await deny(api.post('/api/questions', { subjectId: bio, topic: 'x', type: 'true_false', stem: 'Hack question here', data: { answer: true } }), 'create question');
  await deny(api.post('/api/teacher/classes', { name: 'Hack', subjectId: bio }), 'create class');
  await deny(api.post(`/api/practice/attempts`, { subjectId: bio, mode: 'practice' }), 'practice in unenrolled subject');
  await deny(api.patch('/api/me', { roles: ['super_admin'] }), 'self role escalation');
  expect((await api.patch('/api/me/profile', { subjectIds: [bio] })).status(), 'raw subjectIds injection').toBe(422);
  await deny(api.get(`/api/subjects/${bio}/resources`), 'still not enrolled after injection attempt');
  await deny(api.post('/api/meetings/slots', { start: new Date(Date.now() + 864e5).toISOString(), end: new Date(Date.now() + 864e5 + 18e5).toISOString() }), 'student publishing availability');
  await deny(api.post('/api/meetings', { hostId: '0123456789abcdef01234567', start: new Date(Date.now() + 864e5).toISOString(), topic: 'Fake host', mode: 'in_person' }), 'meeting with unknown host');
  // forged role in body / missing CSRF / foreign origin
  const raw = await page.request.post('/api/questions', { data: { subjectId: bio }, headers: { Origin: 'https://evil.example' } });
  expect([403]).toContain(raw.status());
  const me = await (await page.request.get('/api/auth/me')).json(); expect(me.user.roles).toEqual(['student']);
  // teacher cannot open another school's/unassigned subject data
  await login(page, U.teacher); const t = await apiAs(page);
  await deny(t.get(`/api/progress/class?subjectId=${await subjectId(page, 'ECON')}`), 'teacher other subject');
  await deny(t.get('/api/admin/users'), 'teacher users');
  await login(page, U.editor); await deny((await apiAs(page)).get('/api/meetings'), 'editor meetings'); await page.goto('/meetings');
  await expect(page.getByText(/do not have access/i)).toBeVisible();
  await page.goto('/profile'); await expect(page.getByText(/do not have access/i)).toBeVisible();
});
