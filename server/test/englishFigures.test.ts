import { describe, it, expect } from 'vitest';
import { validateDiagram, renderDiagram } from '../src/services/lessons/svg.js';
import { prepareDiagram } from '../src/services/lessons/generator.js';
import { validateModule, isEnglish, moduleSectionsFor } from '../src/services/lessons/modules.js';

const sentence = { kind: 'sentence', title: 'Subject and predicate', sentence: 'The boy kicked the ball.', parts: [{ text: 'The boy', role: 'subject' }, { text: 'kicked the ball', role: 'predicate' }], groups: [{ label: 'Subject', from: 0, to: 0 }, { label: 'Predicate', from: 1, to: 1 }], caption: 'c', alt: 'a' };
const specs: any[] = [sentence,
  { kind: 'soundchart', title: 'Short vowels', sounds: [{ symbol: '/ɪ/', label: 'short vowel', examples: ['ship', 'sit'] }, { symbol: 'e', examples: ['bed'] }] },
  { kind: 'wordmap', title: 'Register', word: 'Register', branches: [{ label: 'Formal', items: ['Good morning, sir'] }, { label: 'Informal', items: ['Hi'] }] },
  { kind: 'timeline', title: 'Events', events: [{ label: 'First', detail: 'Kofi wakes up' }, { label: 'Then' }] },
  { kind: 'plot', title: 'Story map', stages: [{ stage: 'Exposition', text: 'a' }, { stage: 'climax', text: 'b' }, { stage: 'resolution', text: 'c' }] },
  { kind: 'dialogue', title: 'At the office', setting: 'Headteacher’s office', register: 'formal', turns: [{ speaker: 'Ama', line: 'Good morning, sir.' }, { speaker: 'Headteacher', line: 'Good morning. Come in.' }] },
  { kind: 'venn', title: 'Formal vs informal', left: 'Formal', right: 'Informal', leftItems: ['Full forms'], rightItems: ['Slang'], both: ['Clear meaning'] }];

describe('English figures', () => {
  it('validate and render as safe accessible SVG', () => {
    for (const s of specs) { expect(validateDiagram(s), s.kind).toBeNull(); const svg = renderDiagram(s); expect(svg.startsWith('<svg')).toBe(true); expect(svg).toContain('role="img"'); expect(svg).not.toMatch(/NaN|undefined|<script/); }
  });
  it('rejects inconsistent specs', () => {
    expect(validateDiagram({ ...sentence, parts: [{ text: 'The girl', role: 'subject' }, { text: 'kicked the ball', role: 'predicate' }] })).toMatch(/exactly the sentence/);
    expect(validateDiagram({ ...sentence, parts: [{ text: 'The boy', role: 'thing' }, { text: 'kicked the ball', role: 'verb' }] })).toMatch(/unknown role/);
    expect(validateDiagram({ kind: 'plot', title: 't', stages: [{ stage: 'climax', text: 'a' }, { stage: 'exposition', text: 'b' }, { stage: 'resolution', text: 'c' }] })).toMatch(/story order/);
    expect(validateDiagram({ kind: 'dialogue', title: 't', setting: 's', turns: [{ speaker: 'A', line: 'x' }, { speaker: 'A', line: 'y' }] })).toMatch(/2-3 different speakers/);
    expect(validateDiagram({ kind: 'soundchart', title: 't', sounds: [{ symbol: '/ɪ/', examples: ['sh1p'] }] })).toMatch(/letters only/);
    expect(validateDiagram({ kind: 'sentence', title: 't', sentence: 'A b.', parts: [{ text: 'A b', role: 'noun' }], groups: [] })).toMatch(/2-12/);
  });
  it('escapes text', () => { const svg = renderDiagram({ ...sentence, sentence: 'Ama <b> sang.', parts: [{ text: 'Ama <b>', role: 'subject' }, { text: 'sang', role: 'verb' }], groups: undefined } as any); expect(svg).toContain('&lt;b&gt;'); expect(svg).not.toContain('<b>'); });
  it('sound chart words become pronounceable', () => { expect(prepareDiagram(specs[1]).say).toEqual(['ship', 'sit', 'bed']); });
});

describe('English module checks', () => {
  const sec = (key: string, extra: any = {}) => ({ key, content: 'x', data: {}, citations: [{ chunkId: 'c1', documentId: 'd', pageStart: 2, pageEnd: 2 }], sourceSupport: 'source', ...extra });
  const base = () => [sec('A'), sec('B', { data: { objectives: ['Identify the subject'] } }), sec('C', { content: 'The boy kicked the ball.' }), sec('D'),
    sec('K', { data: { exercises: [{ question: 'q', answer: 'a' }] } }), sec('E', { data: { examples: [{ problem: 'p', steps: ['s'], answer: 'a' }, { problem: 'p2', steps: ['s'], answer: 'a' }] } }), sec('I'), sec('J', { data: { terms: [{ term: 'Subject', definition: 'd' }] } }),
    sec('L', { data: { questions: [0, 1, 2].map((i) => ({ question: `q${i}`, options: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: 'e' })) } })];
  const passages = [{ chunkId: 'c1', documentId: 'd', pageStart: 2, pageEnd: 2, text: 'Good morning, sir. Good morning. Come in.' }] as any;
  it('detects the subject', () => { expect(isEnglish({ code: 'ENG', name: 'English Language' })).toBe(true); expect(isEnglish({ code: 'S-LITENG', name: 'Literature in English' })).toBe(false); });
  it('uses English guides (no maths checks)', () => { const F = moduleSectionsFor(true).find((s) => s.key === 'F')!; expect(F.guide).toMatch(/soundchart/); expect(moduleSectionsFor(true).find((s) => s.key === 'D')!.guide).not.toMatch(/\$/); });
  it('passes when figure language is in the notes or LM', () => {
    const v = validateModule([...base(), sec('F', { data: { diagrams: [prepareDiagram(sentence), prepareDiagram(specs[5])] } })], passages, { english: true });
    expect(v.errors).toEqual([]); expect(v.checks.find((c: any) => c.id === 'language_grounding')?.ok).toBe(true); expect(v.checks.some((c: any) => c.id === 'maths')).toBe(false);
  });
  it('blocks invented example sentences', () => {
    const made = { ...sentence, sentence: 'The cat chased the rat.', parts: [{ text: 'The cat', role: 'subject' }, { text: 'chased the rat', role: 'predicate' }], groups: undefined };
    const v = validateModule([...base(), sec('F', { data: { diagrams: [prepareDiagram(made)] } })], passages, { english: true });
    expect(v.ok).toBe(false); expect(v.errors.join(' ')).toMatch(/not in the notes or the learner manual/);
  });
});

import { tidySoundchart } from '../src/services/lessons/generator.js';
describe('tidySoundchart', () => {
  it('keeps 3 examples and shortens long labels', () => {
    const t = tidySoundchart({ kind: 'soundchart', sounds: [{ symbol: '/ʃ/', label: 'voiceless palato-alveolar fricative sound', examples: ['ship', 'shoe', 'fish', 'wash'] }] });
    expect(t.sounds[0].examples).toEqual(['ship', 'shoe', 'fish']);
    expect(t.sounds[0].label.length).toBeLessThanOrEqual(30);
  });
});
