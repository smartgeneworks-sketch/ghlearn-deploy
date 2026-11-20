import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { useDb, anon, loginAs } from './setup.js';
import { config } from '../src/config.js';
import { AuditLog, Chunk, RefreshToken, User } from '../src/models/index.js';
// @ts-expect-error plain ESM script without types
import { decryptBackup, readPlain, restorePlain } from '../scripts/backup-restore.mjs';

useDb();
const PASS = 'test-backup-passphrase-0123456789';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glbk-test-'));
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); (config as any).BACKUP_PASSPHRASE = undefined; });
const binary = (res: any, cb: any) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); };

describe('POST /api/admin/system/backup', () => {
  it('is super-admin only and needs BACKUP_PASSPHRASE', async () => {
    expect((await (await anon()).post('/api/admin/system/backup')).status).toBe(401);
    expect((await (await loginAs('admin@sample.ghlearn.test')).post('/api/admin/system/backup')).status).toBe(403);
    expect((await (await loginAs('teacher@sample.ghlearn.test')).post('/api/admin/system/backup')).status).toBe(403);
    (config as any).BACKUP_PASSPHRASE = undefined;
    const r = await (await loginAs('super@sample.ghlearn.test')).post('/api/admin/system/backup');
    expect(r.status).toBe(503); expect(r.body.error.code).toBe('BACKUP_NOT_CONFIGURED');
  });

  it('exports an encrypted, verifiable stream that round-trips into an empty database', async () => {
    (config as any).BACKUP_PASSPHRASE = PASS;
    const u = await User.findOne({ email: 'ama@sample.ghlearn.test' }).lean();
    await RefreshToken.create({ userId: u!._id, tokenHash: 'x'.repeat(64), expiresAt: new Date(Date.now() + 1e6) } as any).catch(() => {});
    await Chunk.create({ documentId: new mongoose.Types.ObjectId(), text: 'chunk text', embedding: [0.5, 0.25] } as any).catch(() => {});
    const sup = await loginAs('super@sample.ghlearn.test');
    const r = await sup.post('/api/admin/system/backup').send({}).buffer(true).parse(binary);
    expect(r.status).toBe(200); expect(r.headers['content-type']).toMatch(/octet-stream/); expect(r.headers['content-disposition']).toMatch(/ghlearn-.*\.glbk/);
    const body: Buffer = r.body; expect(body.subarray(0, 5).toString()).toBe('GLBK1');
    expect(body.includes(Buffer.from('ama@sample'))).toBe(false); // encrypted, not just gzipped
    const f = path.join(dir, 'b.glbk'), plain = path.join(dir, 'b.jsonl.gz'); fs.writeFileSync(f, body);

    await expect(decryptBackup(f, 'wrong-passphrase-xxxxxxxx', plain)).rejects.toThrow(/integrity/); expect(fs.existsSync(plain)).toBe(false);
    const t = Buffer.from(body); t[t.length - 40] ^= 1; fs.writeFileSync(path.join(dir, 't.glbk'), t);
    await expect(decryptBackup(path.join(dir, 't.glbk'), PASS, path.join(dir, 't.gz'))).rejects.toThrow(/integrity/);
    fs.writeFileSync(path.join(dir, 'short.glbk'), body.subarray(0, body.length - 100));
    await expect(decryptBackup(path.join(dir, 'short.glbk'), PASS, path.join(dir, 's.gz'))).rejects.toThrow(/integrity/);

    await decryptBackup(f, PASS, plain);
    const { header, counts } = await readPlain(plain, null);
    for (const x of ['refreshtokens', 'phoneotps', 'passwordresets', 'errorevents']) { expect(header.collections).not.toContain(x); expect(counts[x]).toBeUndefined(); }
    expect(header.collections).toContain('chunks'); expect(counts.chunks).toBeGreaterThan(0);
    const db = mongoose.connection.db!;
    // the export is not a point-in-time snapshot: the completion audit row lands after it, so auditlogs may be one ahead
    for (const c of header.collections) if (c !== 'auditlogs') expect(counts[c] ?? 0, c).toBe(await db.collection(c).countDocuments());
    expect(await db.collection('auditlogs').countDocuments()).toBeGreaterThanOrEqual(counts.auditlogs);

    // round trip into a separate, empty database on the temp local mongod
    const target = mongoose.connection.getClient().db(`restore_${Date.now()}`);
    const res = await restorePlain(plain, target);
    for (const c of header.collections) expect(await target.collection(c).countDocuments(), c).toBe(counts[c] ?? 0);
    const orig = await db.collection('users').findOne({ email: 'ama@sample.ghlearn.test' });
    const back = await target.collection('users').findOne({ _id: orig!._id }); // ObjectId type preserved
    expect(back).toEqual(orig); expect(back!.createdAt).toBeInstanceOf(Date);
    await expect(restorePlain(plain, target)).rejects.toThrow(/not empty/); // refuses to merge into existing data
    await restorePlain(plain, target, { drop: true }); expect(await target.collection('users').countDocuments()).toBe(counts.users);
    for (const [c, n] of Object.entries(res.trailer.counts)) expect(counts[c] ?? 0, c).toBe(n);
    await target.dropDatabase();

    await new Promise((ok) => setTimeout(ok, 200));
    const logs = await AuditLog.find({ action: /^system\.backup_export/ }).lean();
    expect(logs.map((l) => l.action).sort()).toEqual(['system.backup_export', 'system.backup_export.complete']);
    const done = logs.find((l) => l.action === 'system.backup_export.complete') as any;
    expect(done.outcome).toBe('success'); expect(done.meta.bytes).toBe(body.length);
    expect(JSON.stringify(logs)).not.toContain(PASS);
  });

  it('excludeChunks skips embedding chunks', async () => {
    const sup = await loginAs('super@sample.ghlearn.test');
    const r = await sup.post('/api/admin/system/backup?excludeChunks=true').buffer(true).parse(binary);
    expect(r.headers['content-disposition']).toMatch(/nochunks/);
    const f = path.join(dir, 'n.glbk'), plain = path.join(dir, 'n.gz'); fs.writeFileSync(f, r.body); await decryptBackup(f, PASS, plain);
    const { header, counts } = await readPlain(plain, null);
    expect(header.collections).not.toContain('chunks'); expect(header.excluded).toContain('chunks'); expect(counts.chunks).toBeUndefined(); expect(counts.users).toBeGreaterThan(0);
  });
});
