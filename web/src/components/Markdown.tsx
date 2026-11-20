import { splitMath, texHtml, tidyPlain } from '../lib/math';
/** Tiny, safe markdown renderer (escapes everything; supports headings, lists, bold/italic, code, citations). */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ' };
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
const SYM: Record<string, string> = { times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈', infty: '∞', pi: 'π', theta: 'θ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', lambda: 'λ', mu: 'μ', sigma: 'σ', Sigma: 'Σ', omega: 'ω', Omega: 'Ω', degree: '°', circ: '°', rightarrow: '→', to: '→', Rightarrow: '⇒', leftarrow: '←', therefore: '∴', angle: '∠', perp: '⊥', parallel: '∥', in: '∈', sqrt: '√', ldots: '…', dots: '…', quad: ' ', qquad: '  ', percent: '%' };
const script = (t: string, map: Record<string, string>, mark: string) => ([...t].every((c) => map[c]) ? [...t].map((c) => map[c]).join('') : `${mark}(${t})`);
/** Simple LaTeX (as AI tutors often write it) -> readable text: \frac{a}{b} -> a/b, x^{2} -> x², \sqrt{x} -> √(x), \times -> ×. */
export function texToText(t: string) {
  let s = t.replace(/\\(left|right|displaystyle|,|;|!)/g, '').replace(/\\text\{([^{}]*)\}|\\mathrm\{([^{}]*)\}/g, (_m, a, b) => a ?? b);
  for (let i = 0; i < 3; i++) s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_m, a, b) => `${/^\w+$/.test(a) ? a : `(${a})`}/${/^\w+$/.test(b) ? b : `(${b})`}`)
    .replace(/\\sqrt\{([^{}]*)\}/g, (_m, a) => (/^\w+$/.test(a) ? `√${a}` : `√(${a})`));
  s = s.replace(/\^\{([^{}]*)\}|\^(\w)/g, (_m, a, b) => script(a ?? b, SUP, '^')).replace(/_\{([^{}]*)\}|_(\d)/g, (_m, a, b) => script(a ?? b, SUB, '_'));
  return s.replace(/\\([A-Za-z]+)/g, (m, w) => SYM[w] ?? w).replace(/\\([{}%$#&_])/g, '$1').replace(/[{}]/g, '').replace(/\s{2,}/g, ' ').trim();
}
function inline(s: string) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>').replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\$\\rightarrow\$/g, '→').replace(/\[S(\d+)\]/g, '<sup class="text-brand-700">[S$1]</sup>');
}
export function toHtml(md: string) {
  const out: string[] = []; let list: 'ul' | 'ol' | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  // Headings inside content sit under the page's h2 sections: the shallowest one becomes h3 and the rest keep their relative depth (axe heading-order).
  const lvls = [...(md ?? '').matchAll(/^(#{1,4})\s+/gm)].map((x) => x[1].length); const top = lvls.length ? Math.min(...lvls) : 1;
  const tex: { v: string; d: boolean }[] = [];
  const src = splitMath(md ?? '').map((p) => p.t === 'text' ? tidyPlain(p.v) : p.t === 'display' ? `\n\u0001${tex.push({ v: p.v, d: true }) - 1}\u0001\n` : `\u0001${tex.push({ v: p.v, d: false }) - 1}\u0001`).join('');
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd(); let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { close(); const n = Math.min(6, m[1].length - top + 3); out.push(`<h${n} class="font-semibold mt-3">${inline(m[2])}</h${n}>`); }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul class="list-disc pl-6 space-y-1">'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)/))) { const n = Number(m[1]); if (list !== 'ol') { close(); out.push(`<ol class="list-decimal pl-6 space-y-1"${n > 1 && n < 1000 ? ` start="${n}"` : ''}>`); list = 'ol'; } out.push(`<li>${inline(m[2])}</li>`); }
    else if (/^-{3,}$/.test(line.trim())) { close(); out.push('<hr class="my-3"/>'); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p class="my-2">${inline(line)}</p>`); }
  }
  close(); return out.join('').replace(/\u0001(\d+)\u0001/g, (_m, i) => { const t = tex[Number(i)]; return t.d ? `<span class="my-2 block overflow-x-auto">${texHtml(t.v, true)}</span>` : texHtml(t.v); });
}
export function Markdown({ text }: { text: string }) { return <div className="leading-relaxed" dangerouslySetInnerHTML={{ __html: toHtml(text) }} />; }
