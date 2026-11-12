import { describe, it, expect } from 'vitest';
import { moneyToSpeech, notMath } from './currency';
import { speakable } from '../components/Listen';
import { splitMath } from './math';
import { mathTextToSpeech } from './mathSpeech';
describe('currency', () => {
  it('reads dollar amounts as words', () => {
    expect(moneyToSpeech('a combined economy of $3.4 trillion')).toBe('a combined economy of 3.4 trillion dollars');
    expect(moneyToSpeech('exports worth $400,000.')).toBe('exports worth 400,000 dollars.');
    expect(moneyToSpeech('It costs $1 or $5')).toBe('It costs 1 dollar or 5 dollars');
    expect(moneyToSpeech('a US$918 million programme and US$ 3 billion')).toBe('a 918 million US dollars programme and 3 billion US dollars');
    expect(moneyToSpeech('$2bn')).toBe('2 billion dollars');
  });
  it('reads Ghana cedis and pesewas', () => {
    expect(moneyToSpeech('GH₵50 and GH¢1')).toBe('50 Ghana cedis and 1 Ghana cedi');
    expect(moneyToSpeech('GH₵ 2.50')).toBe('2 Ghana cedis 50 pesewas');
    expect(moneyToSpeech('GH¢0.50 and GH₵0.01')).toBe('50 pesewas and 1 pesewa');
    expect(moneyToSpeech('GH¢1,200 and GHS 3 million')).toBe('1,200 Ghana cedis and 3 million Ghana cedis');
    expect(moneyToSpeech('GHc40 school materials')).toBe('40 Ghana cedis school materials');
  });
  it('leaves real maths alone and never typesets money', () => {
    expect(moneyToSpeech('Solve $3 + 4 = x$ and pay $5')).toBe('Solve $3 + 4 = x$ and pay 5 dollars');
    expect(notMath('3.4 trillion and ', 'economy of ')).toBe(true);
    expect(notMath('x + 1')).toBe(false);
    expect(splitMath('East is $090^circ$ here').map((p) => p.t)).toEqual(['text', 'inline', 'text']);
    expect(splitMath('From $3.4 trillion to US$400,000 today')).toEqual([{ t: 'text', v: 'From $3.4 trillion to US$400,000 today' }]);
    expect(splitMath('Costs $5, or US$6 each')).toEqual([{ t: 'text', v: 'Costs $5, or US$6 each' }]);
    expect(splitMath('Earned $5 each, then solve $2x = 4$').map((p) => p.t)).toEqual(['text', 'inline']);
    expect(splitMath('Solve $3 + 4$.').map((p) => p.t)).toEqual(['text', 'inline', 'text']);
    expect(mathTextToSpeech('Costs $5, or US$6 each')).toBe('Costs $5, or US$6 each');
  });
  it('is used by the Listen buttons', () => {
    expect(speakable('AfCFTA: 1.3 billion people and $3.4 trillion.')).toBe('A f C F T A: 1.3 billion people and 3.4 trillion dollars.');
    expect(speakable('Kwame saved GH¢165 of GH¢200')).toBe('Kwame saved 165 Ghana cedis of 200 Ghana cedis');
    expect(speakable('Find $x$ if $2x = 6$')).toBe('Find x if 2x equals 6');
  });
});
