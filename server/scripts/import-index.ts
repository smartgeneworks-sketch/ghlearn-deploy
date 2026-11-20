/** Usage: MONGODB_URI=... npx tsx scripts/import-index.ts [/workspace/curriculum] */
import fs from 'node:fs';
import path from 'node:path';
import { connectDb, disconnectDb } from '../src/db.js';
import { importIndex } from '../src/services/importer.js';
const dir = process.argv[2] ?? '/workspace/curriculum';
const entries = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const jsonl = (f: string) => { const p = path.join(dir, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const drive = new Map<string, string>(jsonl('uploaded.jsonl').map((r) => [r.url, r.driveFileId]));
const sha = new Map<string, string>(jsonl('prefetch.jsonl').filter((r) => r.ok && r.sha).map((r) => [entries[r.i]?.url, r.sha]));
if (!process.env.MONGODB_URI && !process.argv.includes('--memory')) { console.error('Set MONGODB_URI (or pass --memory for a dry run)'); process.exit(1); }
await connectDb(process.env.MONGODB_URI || undefined);
if (process.argv.includes('--memory')) { const { seed } = await import('../src/seed.js'); await seed(); }
console.log(JSON.stringify(await importIndex(entries, { drive, sha }), null, 1));
await disconnectDb();
