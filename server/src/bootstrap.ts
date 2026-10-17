/**
 * Idempotent production bootstrap (BOOTSTRAP_ON_START=true or `node dist/bootstrap.js`):
 * 1. indexes (Mongoose syncIndexes already ran in connectDb)
 * 2. Atlas Vector Search index `chunk_vectors` on chunks.embedding (768 dims, cosine) — skipped if present or not Atlas
 * 3. clearly labelled SAMPLE data (only if the sample school does not exist yet)
 * 4. subject catalogue from index.json, then the index.json document importer (upserts by source URL)
 * Runs in the background after the server starts listening, so health checks pass during the first boot.
 */
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { logger } from './lib/logger.js';
import { School, Subject, CurriculumDocument, User, StudentProfile } from './models/index.js';

export async function ensureVectorIndex(dims = Number(process.env.EMBEDDING_DIMENSIONS ?? 768)) {
  const coll = mongoose.connection.db!.collection('chunks');
  try {
    const existing = await coll.listSearchIndexes('chunk_vectors').toArray();
    if (existing.length) return { vectorIndex: 'exists', status: (existing[0] as any).status };
    await coll.createSearchIndex({ name: 'chunk_vectors', type: 'vectorSearch', definition: { fields: [
      { type: 'vector', path: 'embedding', numDimensions: dims, similarity: 'cosine' }, { type: 'filter', path: 'subjectId' }, { type: 'filter', path: 'documentId' } ] } } as any);
    return { vectorIndex: 'created' };
  } catch (e: any) { return { vectorIndex: 'unavailable', reason: String(e?.message ?? e).slice(0, 200) }; }
}

export async function bootstrap(dir = process.env.BOOTSTRAP_DATA_DIR ?? 'data') {
  const out: Record<string, unknown> = {};
  if (!(await mongoose.connection.db!.listCollections({ name: 'chunks' }).toArray()).length) await mongoose.connection.db!.createCollection('chunks');
  Object.assign(out, await ensureVectorIndex()); logger.info({ vectorIndex: out.vectorIndex, status: out.status, reason: out.reason }, 'bootstrap: vector index');
  if (!(await School.exists({ code: 'SAMPLE-01' }))) {
    const { seed } = await import('./seed.js'); const r = await seed(); out.sample = { seeded: true, users: Object.values(r.users).map((u: any) => u.email) };
  } else out.sample = { seeded: false, reason: 'already present', ...(await upgradeSample()) };
  out.profiles = await backfillProfiles();
  const file = path.join(dir, 'index.json');
  if (fs.existsSync(file)) {
    const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { seedSubjectsFromIndex } = await import('./services/subjectCatalog.js'); out.subjects = await seedSubjectsFromIndex(entries);
    const jsonl = (f: string) => { const p = path.join(dir, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
    const drive = new Map<string, string>(jsonl('uploaded.jsonl').map((r: any) => [r.url, r.driveFileId]));
    const sha = new Map<string, string>(jsonl('prefetch.jsonl').filter((r: any) => r.ok && r.sha).map((r: any) => [entries[r.i]?.url, r.sha]));
    const { importIndex } = await import('./services/importer.js'); const r: any = await importIndex(entries, { drive, sha });
    out.import = { ...r, details: undefined, items: undefined };
  } else out.subjects = { skipped: `no ${file}` };
  out.totals = { subjects: await Subject.countDocuments(), documents: await CurriculumDocument.countDocuments() };
  return out;
}

/** Adds sample records introduced after the first seed (idempotent). */
/** Sample accounts added after the first seed (idempotent; uses SEED_PASSWORD like the original seed). */
const LATER_SAMPLES = [
  { email: 'counselor@sample.ghlearn.test', fullName: 'School Counselor (Sample)', roles: ['counselor'], school: true },
  { email: 'curriculum@sample.ghlearn.test', fullName: 'Curriculum Admin (Sample)', roles: ['curriculum_admin'], school: false },
  { email: 'operator@sample.ghlearn.test', fullName: 'System Operator (Sample)', roles: ['system_operator'], school: false },
];
async function upgradeSample() {
  const school = await School.findOne({ code: 'SAMPLE-01' }).lean(); if (!school) return {};
  const { hashPassword } = await import('./services/auth.js'); const out: Record<string, string> = {}; let hash: string | undefined;
  for (const s of LATER_SAMPLES) {
    if (await User.exists({ email: s.email })) { out[s.email] = 'exists'; continue; }
    hash ??= await hashPassword(process.env.SEED_PASSWORD ?? 'SamplePass2026');
    await User.create({ email: s.email, fullName: s.fullName, roles: s.roles as any, ...(s.school ? { schoolId: school._id } : {}), passwordHash: hash, isSample: true });
    out[s.email] = 'created';
  }
  const { backfillRoleAssignments } = await import('./services/roles.js'); out.roleAssignmentsBackfilled = String(await backfillRoleAssignments());
  return out;
}
/** Profiles created before region/school-name existed: copy the linked school's name and region (idempotent). */
export async function backfillProfiles() {
  const { schoolNameKey } = await import('./services/schools.js');
  const ps = await StudentProfile.find({ $or: [{ schoolName: { $exists: false } }, { region: { $exists: false } }], schoolId: { $exists: true } }).select('schoolId schoolName region').lean();
  let n = 0;
  for (const p of ps) {
    const s = await School.findById(p.schoolId).select('name region').lean(); if (!s) continue;
    const set: any = {}; if (!p.schoolName) Object.assign(set, { schoolName: s.name, schoolNameKey: schoolNameKey(s.name) });
    if (!p.region && s.region) set.region = s.region;
    if (Object.keys(set).length) { await StudentProfile.updateOne({ _id: p._id }, set); n++; }
  }
  return { backfilled: n };
}

export function bootstrapInBackground() {
  bootstrap().then((r) => logger.info({ bootstrap: r }, 'bootstrap finished')).catch((e) => logger.error({ err: e }, 'bootstrap failed'));
}
