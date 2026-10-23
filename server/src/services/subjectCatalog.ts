/**
 * Seeds the subject list from the crawled curriculumresources.edu.gh index.
 * Names come from the source site; core/elective category is INFERRED (provenance.categoryInferred=true)
 * and every imported subject is provenance.verified=false until an administrator confirms it.
 */
import { AcademicLevel, Subject } from '../models/index.js';
import type { IndexEntry } from './importer.js';
import { parseLevel } from './importer.js';
const CORE: Record<'SHS' | 'JHS', string[]> = {
  SHS: ['english language', 'mathematics', 'general science', 'social studies', 'physical education and health core'],
  JHS: ['english language', 'mathematics', 'science', 'social studies', 'religious and moral education', 'computing', 'career technology', 'creative arts and design', 'physical education and health'],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SUPPORT = /^intervention /i; // remedial support programmes, kept as electives but flagged
function codeFor(kind: string, name: string, used: Set<string>) {
  const base = `${kind[0]}-` + name.replace(/\(.*?\)/g, (m) => ' ' + m.slice(1, -1)).split(/[^A-Za-z0-9]+/).filter((w) => w && !/^(and|in|of|the)$/i.test(w)).map((w) => w.slice(0, w.length > 4 ? 3 : 4)).join('').toUpperCase().slice(0, 14);
  let c = base, i = 2; while (used.has(c)) c = `${base}${i++}`; used.add(c); return c;
}
export async function seedSubjectsFromIndex(entries: IndexEntry[]) {
  const levels: Record<string, any> = {};
  for (const [kind, name, enabled] of [['SHS', 'Senior High School', true], ['JHS', 'Junior High School', false]] as const)
    levels[kind] = (await AcademicLevel.findOne({ kind })) ?? (await AcademicLevel.create({ kind, name, years: 3, enabled }));
  const counts = new Map<string, { kind: 'SHS' | 'JHS'; name: string; n: number }>();
  for (const e of entries) {
    const lv = parseLevel(e.level ?? e.inferredLevel); const name = (e.subject ?? e.inferredSubject ?? '').trim();
    if (!lv.kind || !name) continue;
    const k = `${lv.kind}|${norm(name)}`; const c = counts.get(k) ?? { kind: lv.kind, name, n: 0 }; c.n++; counts.set(k, c);
  }
  const used = new Set((await Subject.find().select('code').lean()).map((s) => s.code));
  let created = 0, existing = 0;
  for (const { kind, name, n } of counts.values()) {
    const level = levels[kind];
    const all = await Subject.find({ levelId: level._id }).lean();
    const match = all.find((s) => norm(s.name) === norm(name));
    if (match) { existing++; await Subject.updateOne({ _id: match._id }, { $set: { 'provenance.documentCount': n }, $addToSet: { 'provenance.aliases': name } }); continue; }
    const core = CORE[kind].includes(norm(name));
    await Subject.create({ name, code: codeFor(kind, name, used), levelId: level._id, category: core ? 'core' : 'elective', curriculumVersion: kind === 'SHS' ? 'SHS 2023+ (source site)' : undefined,
      provenance: { source: 'curriculumresources.edu.gh index', verified: false, categoryInferred: true, documentCount: n, ...(SUPPORT.test(name) ? { aliases: ['support programme'] } : {}) } });
    created++;
  }
  return { distinct: counts.size, created, existing };
}
