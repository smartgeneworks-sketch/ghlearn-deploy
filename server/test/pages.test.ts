import { describe, it, expect } from 'vitest';
import { useDb, loginAs, anon as anonAgent } from './setup.js';
import { AuditLog } from '../src/models/index.js';
import { ContentPage } from '../src/models/pages.js';
useDb();

describe('Pages CMS: help articles and legal drafts', () => {
  it('drafts stay private, help publishes, legal cannot be published here, nothing is deleted, everything is audited', async () => {
    const anon = await anonAgent();
    const ed = await loginAs('editor@sample.ghlearn.test');
    expect((await ed.post('/api/admin/website/pages').send({ slug: 'x-page', title: 'X page', kind: 'help', body: 'Hi' })).status).toBe(403);
    const su = await loginAs('super@sample.ghlearn.test');
    const h = await su.post('/api/admin/website/pages').send({ slug: 'teachers-apply', title: 'How to apply as a teacher', kind: 'help', audience: 'teachers', summary: 'Apply', body: '## Steps\n\n1. Open the form' });
    expect(h.status, JSON.stringify(h.body)).toBe(201); expect(h.body.page.status).toBe('draft');
    expect((await su.post('/api/admin/website/pages').send({ slug: 'teachers-apply', title: 'Again', kind: 'help', body: '' })).status).toBe(409);
    expect((await su.post('/api/admin/website/pages').send({ slug: 'Bad Slug!', title: 'Bad', kind: 'help', body: '' })).status).toBe(422);
    const l = await su.post('/api/admin/website/pages').send({ slug: 'terms-draft', title: 'Terms of Use (draft)', kind: 'legal', body: 'Draft text', reviewNote: 'Draft — awaiting owner and legal review' });
    expect(l.status).toBe(201);
    expect((await anon.get('/api/public/pages')).body.items).toEqual([]);
    expect((await anon.get('/api/public/pages/teachers-apply')).status).toBe(404);
    expect((await su.post(`/api/admin/website/pages/${l.body.page.id}/publish`)).status).toBe(409);
    expect((await su.post(`/api/admin/website/pages/${h.body.page.id}/delete`)).status).toBe(404);
    expect((await su.post(`/api/admin/website/pages/${h.body.page.id}/publish`)).body.page.status).toBe('published');
    const pub = (await anon.get('/api/public/pages')).body.items;
    expect(pub).toEqual([{ slug: 'teachers-apply', title: 'How to apply as a teacher', audience: 'teachers', summary: 'Apply' }]);
    expect((await anon.get('/api/public/pages/teachers-apply')).body.page.body).toContain('Open the form');
    expect((await anon.get('/api/public/pages/terms-draft')).status).toBe(404);
    const up = await su.patch(`/api/admin/website/pages/${h.body.page.id}`).send({ title: 'Applying as a teacher' });
    expect(up.body.page).toMatchObject({ title: 'Applying as a teacher', version: 2 });
    await su.post(`/api/admin/website/pages/${h.body.page.id}/archive`);
    expect((await anon.get('/api/public/pages')).body.items).toEqual([]);
    expect((await su.patch(`/api/admin/website/pages/${h.body.page.id}`).send({ title: 'Nope title' })).status).toBe(409);
    expect((await su.get('/api/admin/website/pages')).body.items.map((p: any) => p.slug)).toEqual(['terms-draft']);
    expect((await su.get('/api/admin/website/pages?archived=true')).body.items).toHaveLength(2);
    expect(await ContentPage.countDocuments()).toBe(2);
    const acts = (await AuditLog.find({ entityType: 'page' }).lean()).map((a: any) => a.action).sort();
    expect(acts).toEqual(['page.archive', 'page.create', 'page.create', 'page.publish', 'page.update']);
  });
});
