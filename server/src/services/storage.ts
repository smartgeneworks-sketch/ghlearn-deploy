/**
 * Object storage abstraction. Providers:
 *  - gridfs  (default, free): bytes stored in MongoDB GridFS bucket `uploads`. Counts against Atlas M0's 512 MB!
 *  - drive   : server-side Google Drive. Requires GOOGLE_DRIVE_* credentials (not available yet) -> throws StorageUnavailable.
 *  - remote  : read-only; fetches a public URL (used for imported curriculumresources.edu.gh documents).
 */
import mongoose from 'mongoose';
import { Readable } from 'node:stream';
import { config } from '../config.js';
export interface StoredObject { provider: 'gridfs' | 'drive' | 'remote'; key: string }
export interface ObjectStore {
  readonly name: StoredObject['provider'];
  put(buf: Buffer, meta: { filename: string; contentType: string }): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
export class StorageUnavailableError extends Error {}

class GridFsStore implements ObjectStore {
  readonly name = 'gridfs' as const;
  private bucket() { return new mongoose.mongo.GridFSBucket(mongoose.connection.db!, { bucketName: 'uploads' }); }
  async put(buf: Buffer, meta: { filename: string; contentType: string }) {
    const up = this.bucket().openUploadStream(meta.filename, { metadata: { contentType: meta.contentType } });
    await new Promise<void>((ok, bad) => Readable.from(buf).pipe(up).on('finish', () => ok()).on('error', bad));
    return { provider: this.name, key: String(up.id) };
  }
  async get(key: string) {
    const chunks: Buffer[] = [];
    for await (const c of this.bucket().openDownloadStream(new mongoose.Types.ObjectId(key))) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }
  async delete(key: string) { await this.bucket().delete(new mongoose.Types.ObjectId(key)); }
  /** Streaming write (uploads never sit whole in memory). Call abort() on the returned stream to discard partial data. */
  uploadStream(filename: string, contentType: string) { return this.bucket().openUploadStream(filename, { metadata: { contentType } }); }
  downloadStream(key: string, range?: { start: number; end: number }) { return this.bucket().openDownloadStream(new mongoose.Types.ObjectId(key), range ? { start: range.start, end: range.end + 1 } : undefined); }
  async stat(key: string) { return mongoose.connection.db!.collection('uploads.files').findOne({ _id: new mongoose.Types.ObjectId(key) }, { projection: { length: 1 } }) as Promise<{ length: number } | null>; }
  /** Total bytes held in GridFS (all uploads). */
  async usedBytes() { const r = await mongoose.connection.db!.collection('uploads.files').aggregate([{ $group: { _id: null, n: { $sum: '$length' } } }]).toArray(); return Number(r[0]?.n ?? 0); }
}

class DriveStore implements ObjectStore {
  readonly name = 'drive' as const;
  private fail(): never { throw new StorageUnavailableError('Google Drive storage is not configured (set GOOGLE_DRIVE_CREDENTIALS + GOOGLE_DRIVE_FOLDER_ID). See docs/STORAGE.md'); }
  async put(): Promise<StoredObject> { this.fail(); }
  async get(_key?: string): Promise<Buffer> { this.fail(); }
  async delete() { this.fail(); }
}

/**
 * Public fetch with size cap; only http(s) to an allow-listed host set to avoid SSRF (checked on every redirect hop).
 * Uses node:http(s) rather than global fetch because fetch gives up on a slow TCP/TLS handshake after 10 s and reports
 * only "fetch failed"; curriculumresources.edu.gh often takes longer than that to accept a connection. Errors name the cause.
 */
export async function fetchRemote(url: string, maxBytes = config.UPLOAD_MAX_MB * 1024 * 1024, o: { connectMs?: number; totalMs?: number; hops?: number } = {}): Promise<Buffer> {
  const connectMs = o.connectMs ?? 60_000; const totalMs = o.totalMs ?? 240_000; const hops = o.hops ?? 5;
  const u = new URL(url);
  if (!['https:', 'http:'].includes(u.protocol) || !config.remoteHosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) throw new Error(`Remote host not allowed: ${u.hostname}`);
  const mod = u.protocol === 'https:' ? await import('node:https') : await import('node:http');
  return new Promise<Buffer>((resolve, reject) => {
    let done = false; const finish = (e: Error | null, b?: Buffer) => { if (done) return; done = true; clearTimeout(total); clearTimeout(connect); e ? reject(e) : resolve(b!); };
    const req = mod.get(u, { headers: { 'User-Agent': 'GHLearn/1.0 (+https://ghlearn-f31c9.web.app; curriculum indexing)', Accept: 'application/pdf,application/octet-stream,*/*' } }, (r) => {
      clearTimeout(connect);
      const code = r.statusCode ?? 0;
      if (code >= 300 && code < 400 && r.headers.location) {
        r.resume(); if (hops <= 0) return finish(new Error('Download failed: too many redirects'));
        return fetchRemote(new URL(r.headers.location, u).toString(), maxBytes, { connectMs, totalMs, hops: hops - 1 }).then((b) => finish(null, b), (e) => finish(e));
      }
      if (code < 200 || code >= 300) { r.resume(); return finish(new Error(`Download failed: HTTP ${code}`)); }
      if (Number(r.headers['content-length'] ?? 0) > maxBytes) { r.destroy(); return finish(new Error('Remote file exceeds size limit')); }
      const parts: Buffer[] = []; let n = 0;
      r.on('data', (c: Buffer) => { n += c.length; if (n > maxBytes) { r.destroy(); finish(new Error('Remote file exceeds size limit')); } else parts.push(c); });
      r.on('end', () => finish(null, Buffer.concat(parts)));
      r.on('error', (e: any) => finish(new Error(`Download failed: ${e.code ?? e.message}`)));
    });
    const connect = setTimeout(() => { req.destroy(); finish(new Error(`Download failed: no response from ${u.hostname} within ${Math.round(connectMs / 1000)} s`)); }, connectMs);
    const total = setTimeout(() => { req.destroy(); finish(new Error(`Download failed: not complete within ${Math.round(totalMs / 1000)} s`)); }, totalMs);
    req.on('error', (e: any) => finish(new Error(`Download failed: ${e.code ?? e.message}`)));
  });
}

export const gridfs = new GridFsStore();
const stores = { gridfs, drive: new DriveStore() };
export const uploadStore = (): ObjectStore => (config.STORAGE_PROVIDER === 'drive' ? stores.drive : stores.gridfs);
export async function readObject(storage: { provider?: string | null; key?: string | null }, sourceUrl?: string | null, driveFileId?: string | null): Promise<Buffer> {
  if (storage.provider === 'gridfs' && storage.key) return stores.gridfs.get(storage.key);
  if (storage.provider === 'drive' && storage.key) return stores.drive.get(storage.key);
  if (storage.provider === 'remote' && (sourceUrl || driveFileId)) {
    try { if (sourceUrl) return await fetchRemote(sourceUrl); } catch (e) { if (!driveFileId) throw e; }
    // Fallback: the public copy in the project's Drive folder ("anyone with link") - no credential needed.
    return fetchRemote(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveFileId!)}&export=download&confirm=t`);
  }
  throw new StorageUnavailableError('Document has no retrievable file');
}
