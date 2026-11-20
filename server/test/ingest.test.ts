import { describe, it, expect } from 'vitest';
import { detectStructure, parentIndexes, boilerplateLines } from '../src/services/ingest/structure.js';
import { chunkPages } from '../src/services/ingest/chunker.js';
import { openPdf, itemsToText, isPdf } from '../src/services/ingest/pdf.js';
import { curriculumPdf } from './fixtures.js';

describe('structure detection', () => {
  it('detects only explicitly labelled headings, builds hierarchy, de-duplicates running headers', () => {
    const pages = [
      { page: 1, text: 'SECTION 1 Introduction to Biology, the Scientific Method\nSTRAND 1: Diversity of Matter\nSUB-STRAND 2: Cells\nLEARNING INDICATOR: Describe cells\nEXPLORING BIOLOGY IN THE SOCIETY' },
      { page: 2, text: 'SECTION 1 Introduction to Biology, the Scientific Method\nB7.1.2.1.1 Identify parts of a microscope\nThe strand of DNA is long.' },
    ];
    const n = detectStructure(pages);
    expect(n.map((x) => x.type)).toEqual(['section', 'strand', 'subStrand', 'indicator', 'indicator']);
    expect(n[0].title).toBe('Introduction to Biology, the Scientific Method');
    expect(n[4]).toMatchObject({ code: 'B7.1.2.1.1', confidence: 'pattern' });
    expect(n.filter((x) => x.type === 'section')).toHaveLength(1); // repeated header counted once
    expect(n.some((x) => /EXPLORING/.test(x.title))).toBe(false); // unlabelled caps heading NOT promoted
    const p = parentIndexes(n);
    expect(p[2]).toBe(1); expect(p[3]).toBe(2);
  });
  it('finds boilerplate lines and chunks with page ranges + heading path', () => {
    const pages = Array.from({ length: 6 }, (_, i) => ({ page: i + 1, text: `Biology Year 1\n${i === 0 ? 'STRAND 1: Living Things\n' : ''}${`Page ${i} says cells are the basic unit of life and have organelles. `.repeat(12)}\n${i + 1}` }));
    const nodes = detectStructure(pages); const boiler = boilerplateLines(pages);
    expect(boiler.has('Biology Year 1')).toBe(true);
    const chunks = chunkPages(pages, nodes, parentIndexes(nodes), boiler, 1000, 100);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => !c.text.includes('Biology Year 1'))).toBe(true);
    expect(chunks[0].nodeIdx).toEqual([0]);
    expect(chunks.at(-1)!.pageEnd).toBe(6);
    expect(chunks.every((c) => c.pageStart <= c.pageEnd)).toBe(true);
  });
  it('extracts per-page text from a PDF', async () => {
    const buf = curriculumPdf(); expect(isPdf(buf)).toBe(true);
    const pdf = await openPdf(buf); expect(pdf.numPages).toBe(3);
    const t = itemsToText((await (await pdf.getPage(1)).getTextContent()).items as any);
    expect(t.split('\n')[1]).toBe('STRAND 1: Diversity of Living Things');
  });
});

import { useDb } from './setup.js';
import { seedSubjectsFromIndex } from '../src/services/subjectCatalog.js';
import { Subject } from '../src/models/index.js';
describe('subject catalogue seeding from index', () => {
  useDb();
  it('creates unverified subjects with inferred categories, reusing existing ones', async () => {
    const e = (level: string, subject: string) => ({ url: `https://x/${level}/${subject}`, filename: 'f.pdf', level, subject });
    const r = await seedSubjectsFromIndex([e('SHS Year 1', 'Biology'), e('SHS Year 2', 'Biology'), e('SHS Year 1', 'Robotics'), e('SHS Year 1', 'General Science'), e('JHS 1', 'Science'), e('Basic 4', 'Computing')]);
    expect(r).toMatchObject({ distinct: 4, created: 2, existing: 2 }) // General Science is a seeded core subject (it replaced Integrated Science);
    const rob = await Subject.findOne({ name: 'Robotics' }).lean();
    expect(rob).toMatchObject({ category: 'elective', code: 'S-ROB', provenance: { verified: false, categoryInferred: true, documentCount: 1 } });
    expect((await Subject.findOne({ name: 'General Science' }).lean())!.category).toBe('core');
    expect((await Subject.findOne({ code: 'BIO' }).lean())!.provenance?.documentCount).toBe(2);
  });
});
