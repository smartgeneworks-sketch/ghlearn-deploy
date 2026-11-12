import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Readable, Transform, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';
const { EJSON } = mongoose.mongo.BSON;

/**
 * Encrypted backup export (admin → System → backup; scripts/backup/pull-backup.sh downloads it).
 * File: "GLBK1" | salt(16) | iv(12) | AES-256-GCM( gzip( EJSON lines ) ) | tag(16).  Key = scrypt(BACKUP_PASSPHRASE, salt, 32).
 * Lines: {"format":"ghlearn-backup",...header}, then {"c":collection,"d":document} per document, then {"end":true,"counts":{...}}.
 * Decrypt/restore: server/scripts/backup-restore.mjs (verifies the tag before restoring anything).
 */
export const BACKUP_MAGIC = Buffer.from('GLBK1');
export const BACKUP_EXCLUDED = ['refreshtokens', 'phoneotps', 'passwordresets', 'errorevents'] as const;
export const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const deriveKey = (passphrase: string, salt: Buffer) => crypto.scryptSync(passphrase, salt, 32, SCRYPT);

export async function backupCollections(o: { excludeChunks: boolean }) {
  const db = mongoose.connection.db!;
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)
    .filter((n) => !n.startsWith('system.') && !(BACKUP_EXCLUDED as readonly string[]).includes(n) && !(o.excludeChunks && n === 'chunks')).sort();
  return names;
}

/** Streams the encrypted export into `out`. Returns per-collection document counts. */
export async function writeBackup(out: Writable, o: { passphrase: string; excludeChunks: boolean; meta?: Record<string, unknown> }) {
  const db = mongoose.connection.db!; const names = await backupCollections(o); const counts: Record<string, number> = {};
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(o.passphrase, salt), iv);
  async function* lines() {
    yield JSON.stringify({ format: 'ghlearn-backup', version: 1, createdAt: new Date().toISOString(), db: db.databaseName, collections: names,
      excluded: [...BACKUP_EXCLUDED, ...(o.excludeChunks ? ['chunks'] : [])], ...(o.meta ?? {}) }) + '\n';
    for (const c of names) {
      counts[c] = 0; let buf = '';
      for await (const d of db.collection(c).find({}, { batchSize: 500 })) {
        buf += EJSON.stringify({ c, d }, { relaxed: false }) + '\n'; counts[c]++;
        if (buf.length > 1 << 20) { yield buf; buf = ''; }
      }
      if (buf) yield buf;
    }
    yield JSON.stringify({ end: true, counts }) + '\n';
  }
  out.write(Buffer.concat([BACKUP_MAGIC, salt, iv]));
  const tagger = new Transform({ transform(ch, _e, cb) { cb(null, ch); }, flush(cb) { this.push(cipher.getAuthTag()); cb(); } });
  // cipher.getAuthTag() is valid only after the cipher has flushed; the tagger flushes after it, so order is guaranteed by pipeline.
  await pipeline(Readable.from(lines()), zlib.createGzip({ level: 6 }), cipher, tagger, out);
  return counts;
}
