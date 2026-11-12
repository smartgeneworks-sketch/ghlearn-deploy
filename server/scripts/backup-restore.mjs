#!/usr/bin/env node
/**
 * Decrypt / verify / restore a GH Learn backup export (POST /api/admin/system/backup, scripts/backup/pull-backup.sh).
 *   node server/scripts/backup-restore.mjs verify  <file.glbk>
 *   node server/scripts/backup-restore.mjs decrypt <file.glbk> <out.jsonl.gz>
 *   node server/scripts/backup-restore.mjs restore <file.glbk> <mongodb-uri> [--drop]
 * Passphrase: env BACKUP_PASSPHRASE, else BACKUP_PASSPHRASE= in $SECRETS_ENV (default /home/box/.ghlearn-deploy/secrets.env). Never printed.
 * The GCM tag is verified over the whole file BEFORE anything is restored; a truncated or tampered file is rejected.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';

const { EJSON } = mongoose.mongo.BSON;
const MAGIC = Buffer.from('GLBK1'); const HEAD = MAGIC.length + 16 + 12; const TAG = 16;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function passphraseFromEnv() {
  if (process.env.BACKUP_PASSPHRASE) return process.env.BACKUP_PASSPHRASE;
  const f = process.env.SECRETS_ENV ?? '/home/box/.ghlearn-deploy/secrets.env';
  const l = fs.existsSync(f) && fs.readFileSync(f, 'utf8').split('\n').find((x) => x.startsWith('BACKUP_PASSPHRASE='));
  if (!l) throw new Error('BACKUP_PASSPHRASE not set (env or secrets.env)');
  return l.slice('BACKUP_PASSPHRASE='.length).trim().replace(/^['"]|['"]$/g, '');
}

/** Decrypts `file` to `out` (gzip of EJSON lines). Throws (and removes `out`) unless the GCM tag verifies. */
export async function decryptBackup(file, passphrase, out) {
  const size = fs.statSync(file).size; if (size < HEAD + TAG) throw new Error('Not a GH Learn backup (too short)');
  const fd = fs.openSync(file, 'r'); const head = Buffer.alloc(HEAD); const tag = Buffer.alloc(TAG);
  fs.readSync(fd, head, 0, HEAD, 0); fs.readSync(fd, tag, 0, TAG, size - TAG); fs.closeSync(fd);
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not a GH Learn backup (bad magic)');
  const salt = head.subarray(MAGIC.length, MAGIC.length + 16), iv = head.subarray(MAGIC.length + 16);
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(passphrase, salt, 32, SCRYPT), iv); d.setAuthTag(tag);
  try { await pipeline(fs.createReadStream(file, { start: HEAD, end: size - TAG - 1 }), d, fs.createWriteStream(out, { mode: 0o600 })); }
  catch (e) { fs.rmSync(out, { force: true }); throw new Error(`Backup failed integrity check (wrong passphrase, truncated or tampered): ${e.message}`); }
}

/** Reads a decrypted .jsonl.gz: calls onDoc(collection, doc) per document; returns { header, trailer, counts }. */
export async function readPlain(plainGz, onDoc) {
  const rl = readline.createInterface({ input: fs.createReadStream(plainGz).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let header = null, trailer = null; const counts = {};
  for await (const line of rl) {
    if (!line) continue;
    if (!header) { header = JSON.parse(line); if (header.format !== 'ghlearn-backup') throw new Error('Unknown backup format'); continue; }
    if (line.startsWith('{"end":')) { trailer = JSON.parse(line); continue; }
    const { c, d } = EJSON.parse(line, { relaxed: false }); counts[c] = (counts[c] ?? 0) + 1; if (onDoc) await onDoc(c, d);
  }
  if (!trailer) throw new Error('Backup has no trailer (incomplete export)');
  for (const [c, n] of Object.entries(trailer.counts)) if ((counts[c] ?? 0) !== n) throw new Error(`Count mismatch in ${c}: ${counts[c] ?? 0} vs ${n}`);
  return { header, trailer, counts };
}

/** Restores a decrypted .jsonl.gz into `db` (a mongodb Db). Refuses non-empty collections unless drop. */
export async function restorePlain(plainGz, db, { drop = false } = {}) {
  const { header } = await readPlain(plainGz, null); // validates fully before writing
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((x) => x.name));
  for (const c of header.collections) if (existing.has(c)) {
    if (drop) await db.collection(c).drop(); else if (await db.collection(c).estimatedDocumentCount()) throw new Error(`Target collection ${c} is not empty (use --drop)`);
  }
  const buf = new Map(); const flush = async (c) => { const b = buf.get(c); if (b?.length) { await db.collection(c).insertMany(b, { ordered: false }); buf.set(c, []); } };
  const res = await readPlain(plainGz, async (c, d) => { (buf.get(c) ?? buf.set(c, []).get(c)).push(d); if (buf.get(c).length >= 1000) await flush(c); });
  for (const c of buf.keys()) await flush(c);
  for (const c of header.collections) if (!res.counts[c]) await db.createCollection(c).catch(() => {}); // keep empty collections
  return res;
}

async function main() {
  const [cmd, file, arg, ...rest] = process.argv.slice(2);
  if (!cmd || !file || !['verify', 'decrypt', 'restore'].includes(cmd)) { console.error('usage: backup-restore.mjs verify|decrypt|restore <file.glbk> [out|uri] [--drop]'); process.exit(2); }
  const pass = passphraseFromEnv();
  const tmp = cmd === 'decrypt' ? arg : path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glbk-')), 'plain.jsonl.gz');
  if (!tmp) throw new Error('decrypt needs an output path');
  try {
    await decryptBackup(file, pass, tmp); console.log('integrity: OK (AES-256-GCM tag verified)');
    if (cmd === 'restore') {
      if (!arg) throw new Error('restore needs a mongodb uri');
      const conn = await mongoose.createConnection(arg).asPromise();
      try { const r = await restorePlain(tmp, conn.db, { drop: rest.includes('--drop') }); report(r); } finally { await conn.close(); }
    } else report(await readPlain(tmp, null));
  } finally { if (cmd !== 'decrypt') fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); }
}
function report({ header, counts }) {
  console.log(`created ${header.createdAt} db=${header.db} excluded=${header.excluded.join(',')}`);
  for (const c of header.collections) console.log(`${String(counts[c] ?? 0).padStart(9)}  ${c}`);
  console.log(`${String(Object.values(counts).reduce((a, b) => a + b, 0)).padStart(9)}  total documents`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
