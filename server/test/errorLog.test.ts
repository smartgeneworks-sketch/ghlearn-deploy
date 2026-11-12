import { describe, it, expect } from 'vitest';
import { useDb, loginAs } from './setup.js';
import { errorHandler } from '../src/lib/errors.js';
import { ErrorEvent } from '../src/models/errorEvent.js';
import { scrub, routeShape } from '../src/services/errorLog.js';
useDb();
const fakeRes = () => { const r: any = { statusCode: 0, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };

describe('structured server error log and System Status', () => {
  it('scrubs secrets and groups ids out of paths', () => {
    expect(scrub('failed mongodb+srv://admin:hunter2@cluster0.x.net/db')).toBe('failed mongodb+srv://***@cluster0.x.net/db');
    expect(scrub('Authorization: Bearer abc.def.ghijklmnop')).toContain('Bearer ***');
    expect(scrub('GET /x?api_key=SECRET123&b=1')).toContain('api_key=***');
    expect(scrub('token AIzaSyD1234567890abcdefghijklmnopqrstuv')).not.toContain('AIzaSy');
    expect(routeShape('/api/documents/6ad022662b97619a4537a6c0/process?x=1')).toBe('/api/documents/:id/process');
  });
  it('unexpected errors become one counted record, shown to system operators without secrets; 4xx are not recorded', async () => {
    const req: any = { id: 'req-1', method: 'GET', path: '/api/x/6ad022662b97619a4537a6c0', originalUrl: '/api/x/6ad022662b97619a4537a6c0?token=abc' };
    for (let i = 0; i < 2; i++) { const res = fakeRes(); errorHandler(new Error('db failed at mongodb://u:pw@h/db'), req, res, () => {}); expect(res.statusCode).toBe(500); expect(res.body.error.message).toBe('Something went wrong'); }
    const res4 = fakeRes(); errorHandler(new SyntaxError('x'), { ...req, path: '/api/y', originalUrl: '/api/y' } as any, res4, () => {}); // also 500
    await new Promise((r) => setTimeout(r, 200));
    const evs = await ErrorEvent.find().lean();
    const ev = evs.find((e: any) => e.path === '/api/x/:id')!;
    expect(ev).toMatchObject({ kind: 'http', method: 'GET', status: 500, count: 2, message: 'db failed at mongodb://***@h/db', requestId: 'req-1' });
    const op = await loginAs('operator@sample.ghlearn.test');
    const sys = await op.get('/api/admin/system');
    expect(sys.status).toBe(200);
    expect(sys.body.recentErrors.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(sys.body.recentErrors)).not.toMatch(/pw@|token=abc|fingerprint/);
    const stu = await loginAs('ama@sample.ghlearn.test'); expect((await stu.get('/api/admin/system')).status).toBe(403);
    const before = await ErrorEvent.countDocuments(); await op.get('/api/documents/not-an-id'); await new Promise((r) => setTimeout(r, 100));
    expect(await ErrorEvent.countDocuments()).toBe(before);
  });
});
