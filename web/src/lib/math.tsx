import katex from 'katex';
import 'katex/dist/katex.min.css';
import 'katex/contrib/mhchem';
/** Maths in lesson text: $…$ inline, $$…$$ (or \[…\]) display. A price such as "$5" or "$5 and $10" is not maths. */
export type Piece = { t: 'text' | 'inline' | 'display'; v: string };
const RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\((.+?)\\\)|\$(?!\s)([^$\n]{1,300}?)(?<!\s)\$(?!\d)/g;
const TEXISH = /\\(frac|sqrt|sin|cos|tan|theta|circ|times|vec|angle|begin|pi|div|approx|le|leq|ge|geq|neq|triangle|cdot|pm)\b/;
export function splitMath(text: string): Piece[] {
  const s = String(text ?? ''); const out: Piece[] = []; let last = 0;
  for (const m of s.matchAll(RE)) {
    if (m.index! > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    out.push(m[1] != null || m[2] != null ? { t: 'display', v: (m[1] ?? m[2]).trim() } : { t: 'inline', v: (m[3] ?? m[4]).trim() }); last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  // Bare LaTeX with no delimiters (some answers are written that way): typeset the whole string when it is mostly maths.
  if (out.length === 1 && out[0].t === 'text' && TEXISH.test(s) && !/[A-Za-z]{5,}/.test(s.replace(/\\[A-Za-z]+(\{[^{}]*\})?/g, ' '))) return [{ t: 'inline', v: s.trim() }];
  // Short bare LaTeX fragments inside ordinary text ("Length: \\sqrt{45} units") are typeset on their own.
  return out.flatMap((p) => p.t !== 'text' || !TEXISH.test(p.v) ? [p] : p.v.split(FRAG).filter((x) => x !== '').map((v): Piece => (FRAG1.test(v) ? { t: 'inline', v } : { t: 'text', v })));
}
const FRAG = /(\d*\\(?:sqrt|frac)(?:\{[^{}]*\}){1,2}|\\(?:theta|pi|circ|times|div|angle\s*[A-Z]{1,3}|approx|leq?|geq?|neq)\b)/;
const FRAG1 = new RegExp(`^${FRAG.source}$`);
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
/** Outside maths: "a^2" -> "a²" and "12 * 8" -> "12 × 8", so plain answers read like maths too. */
export const tidyPlain = (s: string) => s.replace(/(\w|\))\^(\d{1,2})(?!\d)/g, (_m, a, n) => a + [...n].map((c) => SUP[c]).join('')).replace(/(\w|\)) \* (\w|\()/g, '$1 × $2');
export function texHtml(tex: string, display = false) {
  return katex.renderToString(tex, { throwOnError: false, displayMode: display, output: 'htmlAndMathml', trust: false, strict: 'ignore', maxSize: 20, maxExpand: 200 });
}
/** Inline text with maths typeset. Text parts are rendered as React text (escaped); maths is KaTeX output (trust off). */
export function MathText({ text }: { text: any }) {
  if (text == null) return null; const s = String(text); if (!/[$\\^*]/.test(s)) return <>{s}</>;
  return <>{splitMath(s).map((p, i) => p.t === 'text' ? <span key={i}>{tidyPlain(p.v)}</span>
    : <span key={i} className={p.t === 'display' ? 'my-2 block overflow-x-auto' : 'math-inline'} dangerouslySetInnerHTML={{ __html: texHtml(p.v, p.t === 'display') }} />)}</>;
}
