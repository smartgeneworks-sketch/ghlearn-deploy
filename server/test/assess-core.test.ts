import { describe, it, expect } from 'vitest';
import { validateQuestion, markResponse, presentQuestion, makePerm, prng, textMatches, parseNumber, findNearDuplicate, similarity, totalMarks } from '../src/services/assess/core.js';
import { buildWordSearch } from '../src/services/assess/games.js';
import { assembleDerived, validateLesson, buildSection, controlsSchema } from '../src/services/lessons/generator.js';

import { SAMPLES } from './questionSamples.js';
const Q = (type: string, data: any, extra: any = {}) => ({ _id: 'x', type, stem: 'A question stem here', topic: 'Cells', marks: 1, explanation: 'Because.', citations: [{}], data, ...extra });
describe('question validation (answer keys)', () => {
  it('accepts a valid sample of every type', () => { for (const [t, q] of Object.entries(SAMPLES)) expect(validateQuestion(q).errors, t).toEqual([]); });
  it('rejects broken answer keys', () => {
    expect(validateQuestion({ ...SAMPLES.mcq, data: { options: ['a', 'b'], correctIndex: 5 } }).errors.join()).toMatch(/out of range/);
    expect(validateQuestion({ ...SAMPLES.mcq, data: { options: ['a', 'A '], correctIndex: 0 } }).errors.join()).toMatch(/distinct/);
    expect(validateQuestion({ ...SAMPLES.true_false, data: { answer: 'yes' } }).ok).toBe(false);
    expect(validateQuestion({ ...SAMPLES.gap_fill, data: { text: 'x {{1}} {{2}}', gaps: [{ accepted: ['a'] }] } }).errors.join()).toMatch(/one answer list per blank/);
    expect(validateQuestion({ ...SAMPLES.numerical, data: { value: 'ten', tolerance: -1 } }).errors.length).toBe(2);
    expect(validateQuestion({ ...SAMPLES.essay, rubric: [] }).errors.join()).toMatch(/Rubric required/);
    expect(validateQuestion({ ...SAMPLES.case_study, data: { scenario: 'short', parts: [] } }).errors.length).toBe(2);
    expect(validateQuestion({ ...SAMPLES.mcq, type: 'riddle' }).ok).toBe(false);
  });
});
describe('marking', () => {
  it('auto-marks objective types with flexible criteria', () => {
    const pm = makePerm(SAMPLES.mcq, prng(3)); const shown = presentQuestion(SAMPLES.mcq, pm) as any;
    expect(shown).not.toHaveProperty('data'); expect(JSON.stringify(shown)).not.toMatch(/correctIndex/);
    expect(markResponse(SAMPLES.mcq, shown.options.indexOf('Membrane'), pm).correct).toBe(true);
    expect(markResponse(SAMPLES.mcq, shown.options.indexOf('Wall'), pm)).toMatchObject({ correct: false, feedback: expect.stringMatching(/Membrane/), improvement: expect.any(String) });
    expect(markResponse(SAMPLES.true_false, false, null).correct).toBe(true); expect(markResponse(SAMPLES.true_false, 'True', null).correct).toBe(false);
    expect(markResponse(SAMPLES.short_answer, '  Photosynthesis. ', null).correct).toBe(true);
    expect(markResponse(SAMPLES.short_answer, 'photosinthesis', null).correct).toBe(true); // small spelling slip
    expect(markResponse(SAMPLES.short_answer, 'respiration', null).correct).toBe(false);
    expect(markResponse(SAMPLES.gap_fill, ['Sugar', 'heat'], null)).toMatchObject({ score: 1, maxScore: 2, parts: [true, false] });
    const mp = makePerm(SAMPLES.matching, prng(9)); const mv = presentQuestion(SAMPLES.matching, mp) as any;
    const right = SAMPLES.matching.data.pairs.map((p: any) => mv.right.indexOf(p.right));
    expect(markResponse(SAMPLES.matching, right, mp).score).toBe(3); expect(markResponse(SAMPLES.matching, [right[1], right[0], right[2]], mp).score).toBe(1);
    const op = makePerm(SAMPLES.ordering, prng(5)); const ov = presentQuestion(SAMPLES.ordering, op) as any;
    expect(ov.items).not.toEqual(SAMPLES.ordering.data.items);
    expect(markResponse(SAMPLES.ordering, SAMPLES.ordering.data.items.map((x: string) => ov.items.indexOf(x)), op).correct).toBe(true);
    expect(markResponse(SAMPLES.diagram_labelling, ['Cell wall', 'nucleus', 'chlorophyll'], null).score).toBe(2);
    expect((presentQuestion(SAMPLES.diagram_labelling) as any).svg).not.toMatch(/nucleus/i);
    expect(markResponse(SAMPLES.numerical, { value: '9.7', unit: 'm/s²' }, null).score).toBe(2); // within 2%
    expect(markResponse(SAMPLES.numerical, { value: '9.7' }, null)).toMatchObject({ score: 1, feedback: expect.stringMatching(/unit/) }); // number right, unit missing
    expect(markResponse(SAMPLES.numerical, { value: 12, unit: 'm/s²' }, null).score).toBe(0);
    expect(parseNumber('3,5')).toBe(3.5); expect(parseNumber('1,200')).toBe(1200);
    expect(markResponse(SAMPLES.mcq, undefined, pm)).toMatchObject({ score: 0, feedback: expect.stringMatching(/^No answer given/) });
  });
  it('structured and case study: objective parts auto-marked, essay parts flagged for AI/teacher', () => {
    expect(markResponse(SAMPLES.structured, ['Nucleus', 0], null)).toMatchObject({ score: 2, maxScore: 2, correct: true });
    const cs = markResponse(SAMPLES.case_study, [0, 'Because prices...'], null); expect(cs).toMatchObject({ score: 1, maxScore: 4, needsAi: true });
    expect(markResponse(SAMPLES.essay, 'text', null)).toMatchObject({ needsAi: true, maxScore: 6 }); expect(totalMarks(SAMPLES.essay)).toBe(6);
  });
  it('flexible matching edge cases', () => {
    expect(textMatches('The Mitochondrion', ['mitochondrion'])).toBe(true); expect(textMatches('12', ['13'])).toBe(false); expect(textMatches('cat', ['car'])).toBe(false);
    expect(markResponse(Q('short_answer', { keywords: ['sunlight', 'chlorophyll', 'carbon dioxide'], minKeywords: 2 }, { marks: 2 }), 'Plants use sunlight and chlorophyl', null).score).toBe(2);
  });
});
describe('near-duplicate detection', () => {
  it('flags reworded copies but not different questions', () => {
    const pool = [{ _id: 'a', type: 'mcq', text: 'Which organelle controls the activities of the cell?' }];
    expect(findNearDuplicate({ stem: 'Which organelle controls the activities of the cell ?' }, pool)?.id).toBe('a');
    expect(findNearDuplicate({ stem: 'Which organelle controls all the activities of the cell?' }, pool, 0.6)).toBeTruthy();
    expect(findNearDuplicate({ stem: 'What is the function of the cell wall in plants?' }, pool)).toBeNull();
    expect(similarity('a b c d', 'a b c d')).toBe(1);
  });
});
describe('word search builder', () => {
  it('places all words deterministically', () => {
    const a = buildWordSearch(['CELL', 'NUCLEUS', 'OSMOSIS'], prng(1)); const b = buildWordSearch(['CELL', 'NUCLEUS', 'OSMOSIS'], prng(1));
    expect(a).toEqual(b); expect(a.placed).toHaveLength(3);
    for (const p of a.placed) { const dr = Math.sign(p.end[0] - p.start[0]), dc = Math.sign(p.end[1] - p.start[1]); expect([...p.word].map((_, i) => a.grid[p.start[0] + dr * i][p.start[1] + dc * i]).join('')).toBe(p.word); }
  });
});
describe('lesson structure (spec §7 A-K)', () => {
  it('normalises real Gemini diagram specs (object children, ragged tables)', async () => {
    const { prepareDiagram } = await import('../src/services/lessons/generator.js');
    const tree = prepareDiagram({ title: 'Branches', kind: 'tree', root: { label: 'Biology' }, children: [{ label: 'Botany', children: [{ label: 'Study of plants' }] }, 'Zoology'] });
    expect(tree.svg).toMatch(/^<svg/); expect(tree.alt).toMatch(/Biology branching into Botany, Zoology/);
    const table = prepareDiagram({ title: 'T', kind: 'table', caption: 'c', headers: ['A', 'B'], rows: [['1', '2', '3'], ['x']] });
    expect(table.svg).toMatch(/Column 3/); expect(table.error).toBeUndefined();
    // Live Gemini shape (15 Oct 2026): the tree wrapped in { tree: { root, children } } with the diagram title as root
    const wrapped = prepareDiagram({ title: 'Two traffic lights', kind: 'tree', root: 'Two traffic lights', tree: { root: 'Start', children: [{ label: 'Light 1 Green (0.3)', children: [{ label: 'G, G = 0.12', children: [] }] }, { label: 'Light 1 Not Green (0.7)', children: [] }] } });
    expect(wrapped.error).toBeUndefined(); expect(wrapped.svg).toMatch(/Light 1 Green/); expect(wrapped.svg).toMatch(/G, G = 0.12/); expect(wrapped.alt).toMatch(/Start branching into Light 1 Green/);
    const rootObj = prepareDiagram({ title: 'R', kind: 'tree', root: { label: 'Energy', children: ['Solar', 'Wind'] } });
    expect(rootObj.error).toBeUndefined(); expect(rootObj.alt).toMatch(/Energy branching into Solar, Wind/);
  });
  it('assembles A identification and K references; flags unsafe practicals and vague objectives', () => {
    const controls = controlsSchema.parse({});
    const secs = [buildSection({ key: 'A', content: 'x', data: { estimatedMinutes: 45 } }, []), buildSection({ key: 'B', content: '', data: { objectives: ['Understand cells', 'Describe the cell membrane'] } }, []),
      buildSection({ key: 'H', content: 'Practical', data: { practicals: [{ title: 'Acid test', materials: ['concentrated sulphuric acid'], instructions: ['Pour'], safety: ['Gloves'], criteria: ['Works'] }] }, citations: [] }, []),
      { key: 'E', content: 'Notes', data: {}, citations: [{ documentId: 'd1', pageStart: 3, pageEnd: 4 }, { documentId: 'd1', pageStart: 6, pageEnd: 6 }], sourceSupport: 'source' }];
    const full = assembleDerived(secs, { subject: 'Biology', level: 'SHS', topic: 'Cells', controls }, [{ id: 'd1', title: 'LM Biology', approvalStatus: 'unverified' }]);
    expect(full.find((s) => s.key === 'A')!.data).toMatchObject({ subject: 'Biology', topic: 'Cells', estimatedMinutes: 45, sources: [{ title: 'LM Biology', pages: '3–4, 6', approximate: true }] });
    expect(full.find((s) => s.key === 'K')!.data.references[0]).toMatchObject({ pages: '3–4, 6', approximate: true });
    const v = validateLesson(full, { ...controls, sections: ['A', 'B', 'E', 'H', 'K'] });
    expect(v.errors.join()).toMatch(/H.1: possibly unsafe/); expect(v.warnings.join()).toMatch(/B.1: objective is not measurable/); expect(v.warnings.join()).toMatch(/K: some references are approximate/);
  });
});
