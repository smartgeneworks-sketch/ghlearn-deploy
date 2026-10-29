import { describe, it, expect, afterAll } from 'vitest';
import { useDb, loginAs } from './setup.js';
import { config } from '../src/config.js';
import { setFetchForTest, resetMailer } from '../src/services/mailer.js';
import { AuditLog } from '../src/models/index.js';
useDb();
const KEY = 'xkeysib-test-SECRET';
const brevo = (on: boolean) => { Object.assign(config as any, on ? { EMAIL_API_PROVIDER: 'brevo', EMAIL_API_KEY: KEY, EMAIL_FROM: 'GH Learn <no-reply@ghlearn.com>' } : { EMAIL_API_PROVIDER: undefined, EMAIL_API_KEY: undefined, EMAIL_FROM: undefined }); resetMailer(); };
afterAll(() => { brevo(false); setFetchForTest(null); });

describe('admin email test send', () => {
  it('super admins only; 503 when email is not configured', async () => {
    brevo(false);
    for (const u of ['admin', 'operator', 'teacher']) expect((await (await loginAs(`${u}@sample.ghlearn.test`)).post('/api/admin/email/test').send({ to: 'a@b.test' })).status).toBe(403);
    const sa = await loginAs('super@sample.ghlearn.test');
    expect((await sa.get('/api/admin/email/status')).body).toEqual({ configured: false, provider: null, from: null });
    expect((await sa.post('/api/admin/email/test').send({ to: 'a@b.test' })).status).toBe(503);
  });
  it('sends one Brevo message, returns the message id, audits a masked address, never exposes the key', async () => {
    const calls: any[] = [];
    setFetchForTest((async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ messageId: '<abc@smtp-relay.mailin.fr>' }), { status: 201 }); }) as any); brevo(true);
    const sa = await loginAs('super@sample.ghlearn.test');
    const st = await sa.get('/api/admin/email/status'); expect(st.body).toEqual({ configured: true, provider: 'brevo', from: 'GH Learn <no-reply@ghlearn.com>' }); expect(JSON.stringify(st.body)).not.toContain(KEY);
    const r = await sa.post('/api/admin/email/test').send({ to: 'smartgeneworks@gmail.com' });
    expect(r.body).toEqual({ status: 'sent', messageId: '<abc@smtp-relay.mailin.fr>', to: 's***s@gmail.com', provider: 'brevo' });
    expect(calls).toHaveLength(1); expect(calls[0].url).toBe('https://api.brevo.com/v3/smtp/email'); expect(calls[0].init.headers['api-key']).toBe(KEY);
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ sender: { name: 'GH Learn', email: 'no-reply@ghlearn.com' }, to: [{ email: 'smartgeneworks@gmail.com' }], subject: 'GH Learn test email' });
    expect((await sa.post('/api/admin/email/test').send({ to: 'not-an-email' })).status).toBe(422);
    await new Promise((x) => setTimeout(x, 60));
    const a = await AuditLog.findOne({ action: 'email.test' }).lean(); expect(a!.meta).toMatchObject({ to: 's***s@gmail.com', status: 'sent', provider: 'brevo' });
    expect(JSON.stringify(a)).not.toContain('smartgeneworks@gmail.com'); expect(JSON.stringify(a)).not.toContain(KEY);
  });
  it('reports a provider rejection honestly', async () => {
    setFetchForTest((async () => new Response(JSON.stringify({ code: 'unauthorized', message: 'Key not found' }), { status: 401 })) as any); brevo(true);
    const r = await (await loginAs('super@sample.ghlearn.test')).post('/api/admin/email/test').send({ to: 'x@y.test' });
    expect(r.body.status).toBe('failed'); expect(r.body.error).toMatch(/brevo HTTP 401/);
  });
});
