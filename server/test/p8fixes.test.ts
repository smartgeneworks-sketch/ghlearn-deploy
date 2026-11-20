import { describe, it, expect } from 'vitest';
import { normalizeSpec, prepareDiagram } from '../src/services/lessons/generator.js';
import { checkLayout, learnerCopy, scoreCheck } from '../src/services/lessons/progression.js';

describe('diagram specs nested under their kind', () => {
  it('lifts table and flow fields to the top level and renders', () => {
    const t = prepareDiagram({ title: 'T', alt: 'a', kind: 'table', table: { headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] } });
    expect(t.error).toBeUndefined(); expect(t.svg).toMatch(/^<svg/);
    const f = prepareDiagram({ title: 'F', alt: 'a', kind: 'flow', flow: { steps: ['x', 'y', 'z'] } });
    expect(f.error).toBeUndefined(); expect(normalizeSpec({ kind: 'flow', flow: { steps: ['x', 'y'] } }).flow).toBeUndefined();
  });
});
describe('knowledge check layout', () => {
  const body = { sections: [{ key: 'D', title: 'Step-by-step explanation', content: 'Complementary angles add to ninety degrees', citations: [{ pageStart: 13 }] },
    { key: 'L', data: { questions: [0, 1, 2, 3, 4].map((i) => ({ question: `Q${i} complementary angles`, options: ['w', 'x', 'y', 'z'], correctIndex: i % 4, explanation: 'e' })) } }] };
  it('is stable per seed, changes between attempts, and scores by displayed order', () => {
    expect(checkLayout(body, 'u:r:0')).toEqual(checkLayout(body, 'u:r:0'));
    const seeds = Array.from({ length: 6 }, (_, k) => JSON.stringify(checkLayout(body, `u:r:${k}`).order)); expect(new Set(seeds).size).toBeGreaterThan(1);
    const L = checkLayout(body, 'u:r:1'); const shown = learnerCopy(body, L).sections[1].data.questions;
    const right = L.order.map((qi, i) => shown[i].options.indexOf(['w', 'x', 'y', 'z'][qi % 4]));
    expect(scoreCheck(body, right, L, 60)).toMatchObject({ pct: 100, passed: true });
    const bad = scoreCheck(body, right.map((a) => (a + 1) % 4), L, 60); expect(bad.passed).toBe(false);
    expect(bad.results.every((r: any) => r.correctIndex === undefined && r.explanation === undefined)).toBe(true);
    expect((bad.results[0] as any).hint).toBe('Review section D. Step-by-step explanation (learner manual p. 13).');
  });
});

import { featureOf } from '../src/models/ops.js';
describe('phase 8 fix: usage label', () => {
  it('module generation is counted as lesson generation, not other', () => { expect(featureOf('module.generate')).toBe('lesson_generation'); });
});
