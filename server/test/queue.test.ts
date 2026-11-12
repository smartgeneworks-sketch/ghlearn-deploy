import { describe, it, expect } from 'vitest';
import { useDb } from './setup.js';
import { Job } from '../src/models/index.js';
import { registerJob, enqueue, runOnce, PermanentJobError, backoffMs } from '../src/services/queue.js';
useDb();
describe('mongo job queue', () => {
  it('runs jobs, retries with backoff, then marks dead', async () => {
    let calls = 0;
    registerJob('t.flaky', async () => { calls++; if (calls < 2) throw new Error('transient'); return { ok: true }; });
    registerJob('t.broken', async () => { throw new Error('always'); });
    const a = await enqueue('t.flaky', {}); const b = await enqueue('t.broken', {}, { maxAttempts: 2 });
    await runOnce(); await runOnce();
    let ja = await Job.findById(a._id).lean();
    expect(ja!.status).toBe('queued'); expect(ja!.errorLog).toHaveLength(1);
    expect(ja!.runAt.getTime()).toBeGreaterThan(Date.now() + backoffMs(1) - 2000);
    await Job.updateMany({}, { runAt: new Date(0) }); // fast-forward
    await runOnce(); await runOnce();
    ja = await Job.findById(a._id).lean(); const jb = await Job.findById(b._id).lean();
    expect(ja).toMatchObject({ status: 'succeeded', attempts: 2, result: { ok: true } });
    expect(jb).toMatchObject({ status: 'dead', attempts: 2 });
  });
  it('permanent errors are not retried; expired leases are reclaimed', async () => {
    registerJob('t.perm', async () => { throw new PermanentJobError('bad input'); });
    const p = await enqueue('t.perm', {}, { maxAttempts: 5 }); await runOnce();
    expect((await Job.findById(p._id).lean())!.status).toBe('dead');
    registerJob('t.ok', async () => 'done');
    const s = await Job.create({ type: 't.ok', status: 'running', lockedUntil: new Date(Date.now() - 1000), attempts: 1 }); // crashed worker
    await runOnce();
    expect((await Job.findById(s._id).lean())!.status).toBe('succeeded');
    expect(await runOnce()).toBe(false);
  });
});
