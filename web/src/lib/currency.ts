/**
 * Money in lesson text. "$3.4 trillion", "US$918 million", "GH₵2.50" are prices, not maths: maths typesetting and
 * speech both use notMath() so a pair of prices is never read as a $…$ formula, and moneyToSpeech() reads amounts
 * as words ("3.4 trillion dollars", "2 Ghana cedis 50 pesewas").
 */
const SMALL = /\b(and|or|to|per|each|for|of|the|in|is|at|from|than|thousand|million|billion|trillion|bn)\b/;
/** True when a $…$ candidate (inner text, plus the text before its opening $) is really money, not a formula. */
export function notMath(inner: string, before = ''): boolean {
  if (/[A-Za-z]$/.test(before) && /(US|GH|NZ|AU|CA|HK)$/.test(before)) return true; // "US$5 … $"
  if (/(US|GH)$/.test(inner)) return true; // "$5, or US$6": the closing $ belongs to the next price
  if (!/^\d/.test(inner) || /[\\^_{}=<>]/.test(inner)) return false; // maths markers: always a formula
  const plain = inner.replace(/\\[A-Za-z]+(\{[^{}]*\})?/g, ' ');
  return SMALL.test(plain) || /\b[A-Za-z]{3,}\b/.test(plain);
}
/** Inline $…$ spans that are real maths (start, end, inner), skipping money. */
export function inlineMathSpans(s: string): { start: number; end: number; inner: string }[] {
  const re = /\$(?!\s)([^$\n]{1,300}?)(?<!\s)\$(?!\d)/g; const out: { start: number; end: number; inner: string }[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (s[m.index - 1] === '$' || s[m.index + m[0].length] === '$') { re.lastIndex = m.index + 1; continue; } // part of $$…$$
    if (notMath(m[1], s.slice(0, m.index))) { re.lastIndex = m.index + 1 + m[1].length; continue; }
    out.push({ start: m.index, end: m.index + m[0].length, inner: m[1] });
  }
  return out;
}
const SCALE = '(?:\\s?(thousand|million|billion|trillion|bn)\\b)?';
const DOLLAR = new RegExp(`(\\bUS\\s?\\$|\\$)\\s?(\\d[\\d,]*(?:\\.\\d+)?)(?![\\d$])${SCALE}`, 'g');
const CEDI = new RegExp(`(?:\\bGH\\s?[₵¢]|\\bGH[Cc](?=\\s?\\d)|\\bGHS|\\bGhs|₵)\\s?(\\d[\\d,]*(?:\\.\\d+)?)(?![\\d])${SCALE}`, 'g');
const scaleWord = (x?: string) => (x ? ` ${x === 'bn' ? 'billion' : x}` : '');
function cedis(n: string, scale?: string) {
  if (scale) return `${n}${scaleWord(scale)} Ghana cedis`;
  const p = n.match(/^([\d,]+)\.(\d{2})$/);
  if (p) { const c = p[1].replace(/,/g, ''), pes = Number(p[2]); const cw = Number(c) === 0 ? '' : `${p[1]} Ghana ${c === '1' ? 'cedi' : 'cedis'}`;
    const pw = pes ? `${pes} ${pes === 1 ? 'pesewa' : 'pesewas'}` : ''; return [cw, pw].filter(Boolean).join(' ') || '0 Ghana cedis'; }
  return `${n} Ghana ${n === '1' ? 'cedi' : 'cedis'}`;
}
/** Prices -> words, outside real maths. */
export function moneyToSpeech(t: string): string {
  const s = String(t ?? ''); const keep = inlineMathSpans(s); const parts: string[] = []; let last = 0;
  const conv = (x: string) => x.replace(CEDI, (_m, n, sc) => cedis(n, sc))
    .replace(DOLLAR, (_m, cur: string, n: string, sc?: string) => `${n}${scaleWord(sc)} ${/US/.test(cur) ? 'US ' : ''}${n === '1' && !sc ? 'dollar' : 'dollars'}`);
  // Display maths ($$…$$) is left alone too.
  const disp = [...s.matchAll(/\$\$[\s\S]+?\$\$/g)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  for (const r of [...keep, ...disp].sort((a, b) => a.start - b.start)) { if (r.start < last) continue; parts.push(conv(s.slice(last, r.start)), s.slice(r.start, r.end)); last = r.end; }
  parts.push(conv(s.slice(last))); return parts.join('');
}
