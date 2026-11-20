/** Usage: MONGODB_URI=... npx tsx scripts/seed-subjects.ts [/workspace/curriculum]  (or --memory for a dry run) */
import fs from 'node:fs';
import path from 'node:path';
import { connectDb, disconnectDb } from '../src/db.js';
import { seedSubjectsFromIndex } from '../src/services/subjectCatalog.js';
import { Subject } from '../src/models/index.js';
const dir = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? '/workspace/curriculum';
if (!process.env.MONGODB_URI && !process.argv.includes('--memory')) { console.error('Set MONGODB_URI or pass --memory'); process.exit(1); }
await connectDb(process.env.MONGODB_URI || undefined);
const r = await seedSubjectsFromIndex(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')));
console.log(JSON.stringify(r));
if (process.argv.includes('--list')) for (const s of await Subject.find().populate('levelId', 'kind').sort({ name: 1 }).lean()) console.log(`${(s.levelId as any).kind}\t${s.code}\t${s.category}${s.provenance?.categoryInferred ? '*' : ''}\t${s.name}`);
await disconnectDb();
