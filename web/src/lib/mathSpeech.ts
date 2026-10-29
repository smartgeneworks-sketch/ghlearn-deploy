import { inlineMathSpans } from './currency';
/**
 * Maths text -> words for speech synthesis. Handles LaTeX ($…$ content) and the Unicode symbols lessons use
 * (°, ², ³, π, ×, ÷, √, ≤, ≥, ∠ABC, fractions such as 3/4).
 */
const N = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const DEN: Record<number, [string, string]> = { 2: ['half', 'halves'], 3: ['third', 'thirds'], 4: ['quarter', 'quarters'], 5: ['fifth', 'fifths'], 6: ['sixth', 'sixths'],
  7: ['seventh', 'sevenths'], 8: ['eighth', 'eighths'], 9: ['ninth', 'ninths'], 10: ['tenth', 'tenths'], 12: ['twelfth', 'twelfths'] };
const word = (s: string) => (/^\d+$/.test(s) && Number(s) <= 12 ? N[Number(s)] : s);
/** 3/4 -> "three quarters", 1/2 -> "one half", 7/15 -> "7 over 15", a/b -> "a over b". */
export function fractionWords(a: string, b: string) {
  a = a.trim(); b = b.trim();
  if (/^\d+$/.test(a) && /^\d+$/.test(b) && DEN[Number(b)] && Number(a) > 0) return `${word(a)} ${DEN[Number(b)][Number(a) === 1 ? 0 : 1]}`;
  return `${a} over ${b}`;
}
/* ---------- science notation: chemical formulas, °C, SI units ---------- */
const SUB: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const ELEMENTS = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Fe Cu Zn Ag Au Pb Sn Hg Mn Cr Ni Co Ba I Br'.split(' '));
const GROUPS = /([A-Z][a-z]?)(\d*)/g;
/** "H2O" or "CaCO3" if the token is made only of element symbols and digits (at least one digit, or two elements with a subscript). */
const NODIGIT = new Set(['NaCl', 'KCl', 'HCl', 'NaOH', 'KOH', 'MgO', 'CaO', 'CuO', 'ZnO', 'FeS', 'NaBr', 'KBr', 'AgCl']);
const isFormula = (tok: string) => { if (NODIGIT.has(tok)) return true; if (!/^(?:[A-Z][a-z]?\d*|\((?:[A-Z][a-z]?\d*)+\)\d*)+$/.test(tok) || !/\d/.test(tok)) return false;
  const els = [...tok.replace(/[()]/g, '').matchAll(GROUPS)].filter((m) => m[0]); if (!els.every((m) => ELEMENTS.has(m[1]))) return false;
  return els.length >= 2 || ['H2', 'O2', 'N2', 'Cl2', 'O3'].includes(tok); };
/** H₂O -> "H 2 O", CO₂ -> "C O 2", Ca(OH)₂ -> "C A, O H, 2", Na⁺ -> "N A plus". Letters are spelt so the voice does not read "co" or "nacl" as words. */
export function formulaToSpeech(tok: string): string {
  return tok.replace(/[()]/g, ' ').replace(/([A-Z])([a-z]?)/g, (_m, a, b) => ` ${a}${b ? ` ${b.toUpperCase()}` : ''} `).replace(/(\d+)/g, ' $1 ').replace(/\s+/g, ' ').trim();
}
const U: Record<string, [string, string]> = { m: ['metre', 'metres'], cm: ['centimetre', 'centimetres'], mm: ['millimetre', 'millimetres'], km: ['kilometre', 'kilometres'], nm: ['nanometre', 'nanometres'], 'µm': ['micrometre', 'micrometres'], 'μm': ['micrometre', 'micrometres'],
  g: ['gram', 'grams'], kg: ['kilogram', 'kilograms'], mg: ['milligram', 'milligrams'], s: ['second', 'seconds'], min: ['minute', 'minutes'], h: ['hour', 'hours'], hr: ['hour', 'hours'],
  ml: ['millilitre', 'millilitres'], mL: ['millilitre', 'millilitres'], l: ['litre', 'litres'], L: ['litre', 'litres'], N: ['newton', 'newtons'], J: ['joule', 'joules'], kJ: ['kilojoule', 'kilojoules'],
  W: ['watt', 'watts'], kW: ['kilowatt', 'kilowatts'], kWh: ['kilowatt hour', 'kilowatt hours'], V: ['volt', 'volts'], A: ['ampere', 'amperes'], mA: ['milliampere', 'milliamperes'], 'Ω': ['ohm', 'ohms'],
  Hz: ['hertz', 'hertz'], Pa: ['pascal', 'pascals'], kPa: ['kilopascal', 'kilopascals'], mol: ['mole', 'moles'], K: ['kelvin', 'kelvin'] };
const unitWords = (u: string, plural: boolean) => { const p = u.match(/^(.+?)(²|³|\^2|\^3)?$/)!; const w = U[p[1]]; if (!w) return null; const base = w[plural ? 1 : 0];
  return p[2] ? `${/[²2]/.test(p[2]) ? 'square' : 'cubic'} ${base}` : base; };
const UNIT_RE = '(?:µm|μm|kWh|kPa|kJ|kW|kg|km|cm|mm|nm|mg|mL|ml|mA|min|mol|hr|Hz|Pa|Ω|[mgslLNJWVAhK])(?:²|³|\\^2|\\^3)?';
const LABEL = /\b(section|activity|year|grade|table|figure|fig\.|question|step|part|box|paper|class|form|level|unit|lesson|chapter|page|exercise|strand|example|group|no\.|number)\s*$/i;
/** Science notation in plain text -> words: formulas (H₂O, CO2), temperatures (25 °C), units after numbers (5 m/s, 2 kg, 10 cm³, 9.8 m/s²). */
export function scienceToSpeech(t: string): string {
  let s = String(t ?? '').replace(/[₀-₉]/g, (c) => SUB[c]);
  s = s.replace(/(?<![\w])((?:[A-Z][a-z]?\d*)+)([²³]?)([⁺⁻])/g, (m, f0, q, c) => ([...f0.matchAll(GROUPS)].filter((x) => x[0]).every((x) => ELEMENTS.has(x[1])) ? `${formulaToSpeech(f0)}${q ? ` ${q === '²' ? 2 : 3}` : ''} ${c === '⁺' ? 'plus' : 'minus'}` : m));
  s = s.replace(/(?<![\w])((?:[A-Z][a-z]?\d*|\([A-Za-z\d]+\)\d*)+)(?![\w])/g, (m) => (isFormula(m) ? formulaToSpeech(m) : m));
  // Biology: magnification "×400" / "x 40" -> "times 400"; filial generations F1, F₂ -> "F 1".
  s = s.replace(/(^|[\s(])[×x]\s?(\d+)(?![\w])/g, '$1times $2').replace(/\bF([12])\b/g, 'F $1');
  s = s.replace(/°\s?C\b|\bdegrees\s+C\b/g, ' degrees Celsius').replace(/°\s?F\b/g, ' degrees Fahrenheit');
  s = s.replace(new RegExp(`(\\d(?:[\\d.,]*\\d)?)\\s?(${UNIT_RE})\\s?/\\s?(${UNIT_RE})(?![\\w])`, 'g'), (m, n, a, b) => { const x = unitWords(a, n !== '1'), y = /^(s|min|h|hr)(²|\^2)$/.test(b) ? `${unitWords(b.replace(/²|\^2/, ''), false)} squared` : unitWords(b, false); return x && y ? `${n} ${x} per ${y}` : m; });
  s = s.replace(new RegExp(`(\\d(?:[\\d.,]*\\d)?)\\s?(${UNIT_RE})(?![\\w/])`, 'g'), (m, n, u, at: number, all: string) => {
    // "Section 2 A", "Activity 1 B": a capital letter after a numbered label is a label, not a unit.
    if (/^[A-Z]$/.test(u) && LABEL.test(all.slice(Math.max(0, at - 14), at))) return m; const w = unitWords(u, n !== '1'); return w ? `${n} ${w}` : m; });
  return s;
}
const UNIT: Record<string, string> = { mm: 'millimetres', cm: 'centimetres', m: 'metres', km: 'kilometres', in: 'inches', ft: 'feet' };
const GREEK: Record<string, string> = { pi: 'pi', theta: 'theta', alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', Delta: 'delta', lambda: 'lambda', mu: 'mu', sigma: 'sigma', phi: 'phi', omega: 'omega' };
const OPS: Record<string, string> = { times: ' times ', cdot: ' times ', div: ' divided by ', pm: ' plus or minus ', approx: ' is approximately ', neq: ' is not equal to ', ne: ' is not equal to ',
  le: ' is less than or equal to ', leq: ' is less than or equal to ', ge: ' is greater than or equal to ', geq: ' is greater than or equal to ', lt: ' is less than ', gt: ' is greater than ',
  sin: ' sine ', cos: ' cosine ', tan: ' tangent ', triangle: ' triangle ', parallel: ' is parallel to ', perp: ' is perpendicular to ', rightarrow: ' gives ', implies: ' which gives ', Rightarrow: ' which gives ',
  therefore: ' therefore ', infty: ' infinity ', degree: ' degrees ', quad: ' ', qquad: ' ', ldots: ' and so on ', dots: ' and so on ', cdots: ' and so on ',
  cup: ' union ', cap: ' intersection ', in: ' is an element of ', notin: ' is not an element of ', subset: ' is a subset of ', subseteq: ' is a subset of ', emptyset: ' the empty set ', varnothing: ' the empty set ',
  land: ' and ', wedge: ' and ', lor: ' or ', vee: ' or ', neg: ' not ', lnot: ' not ', to: ' tends to ', leftrightarrow: ' if and only if ', Leftrightarrow: ' if and only if ', iff: ' if and only if ',
  sec: ' secant ', csc: ' cosecant ', cosec: ' cosecant ', cot: ' cotangent ', sum: ' the sum of ', prod: ' the product of ', circ: ' composed with ', mid: ' given ' };
const letters = (s: string) => s.split('').join(' ');
const B = '\\{([^{}]*)\\}';
/** LaTeX source (without the $ delimiters) -> words. */
export function texToSpeech(tex: string): string {
  let s = ` ${tex} `.replace(/\\ce\{([^{}]*)\}/g, (_m, x) => ` ${x.replace(/->/g, ' gives ')} `)
    .replace(/(?:\\(?:text|mathrm)\{[A-Z][a-z]?\}(?:_\{?\d+\}?)?){2,}/g, (m) => ` ${m.replace(/\\(?:text|mathrm)\{([A-Za-z]+)\}/g, '$1').replace(/_\{?(\d+)\}?/g, '$1')} `)
    .replace(/\\(?:text|mathrm)\{((?:[A-Z][a-z]?(?:_\{?\d+\}?)?)+)\}/g, (_m, x) => ` ${x.replace(/_\{?(\d+)\}?/g, '$1')} `).replace(/\\(left|right|displaystyle|,|;|!|:)/g, ' ').replace(new RegExp(`\\\\(?:text|mathrm|textbf|mathbf|operatorname)${B}`, 'g'), ' $1 ');
  // Additional Mathematics: a matrix with several columns is read row by row; a single column stays "column".
  s = s.replace(/\\begin\{[pbvB]?matrix\}([\s\S]*?)\\end\{[pbvB]?matrix\}/g, (_m, x) => { const rows = x.split(/\\\\/).map((r: string) => r.trim()).filter(Boolean);
    return rows.some((r: string) => r.includes('&')) ? ` the matrix with rows ${rows.map((r: string) => r.split('&').map((c) => c.trim()).join(', ')).join('; ')} ` : ` column ${rows.join(', ')} `; });
  s = s.replace(new RegExp(`\\\\log_${B}`, 'g'), ' log base $1 of ').replace(/\\log_(\w)/g, ' log base $1 of ').replace(/\\ln\b/g, ' natural log of ').replace(/\\log\b/g, ' log of ')
    .replace(new RegExp(`\\\\lim_${B}`, 'g'), (_m, x) => ` the limit as ${x.replace(/\\to/g, ' tends to ')} of `)
    .replace(new RegExp(`\\\\int_${B}\\^${B}`, 'g'), ' the integral from $1 to $2 of ').replace(/\\int_(\w)\^(\w)/g, ' the integral from $1 to $2 of ').replace(/\\int\b/g, ' the integral of ')
    .replace(/\\[dt]?frac\{d\s*([a-z])\}\{d\s*([a-z])\}/g, ' d $1 by d $2 ').replace(/\\[dt]?frac\{d\^2\s*([a-z])\}\{d\s*([a-z])\^2\}/g, ' d 2 $1 by d $2 squared ')
    .replace(new RegExp(`\\\\binom${B}${B}`, 'g'), ' $1 choose $2 ').replace(new RegExp(`\\^\\{?(\\w)\\}?\\s*C_${B}`, 'g'), ' $1 choose $2 ').replace(/\^\{?(\w)\}?\s*C_(\w)/g, ' $1 choose $2 ')
    .replace(new RegExp(`\\^\\{?(\\w)\\}?\\s*P_${B}`, 'g'), ' $1 P $2 ').replace(/\^\{?(\w)\}?\s*P_(\w)/g, ' $1 P $2 ')
    .replace(/\^\s*\{\s*-1\s*\}/g, ' inverse ').replace(new RegExp(`\\\\(?:hat|mathbf|boldsymbol)${B}`, 'g'), ' vector $1 ');
  s = s.replace(/\\angle\s*([A-Z]{1,3})/g, (_m, x) => ` angle ${letters(x)} `).replace(new RegExp(`\\\\(?:vec|overrightarrow)${B}`, 'g'), (_m, x) => ` vector ${letters(x.trim())} `)
    .replace(/\\vec\s*([A-Za-z])/g, ' vector $1 ').replace(new RegExp(`\\\\overline${B}`, 'g'), (_m, x) => ` line ${letters(x.trim())} `);
  for (let i = 0; i < 3; i++) s = s.replace(new RegExp(`\\\\[dt]?frac${B}${B}`, 'g'), (_m, a, b) => ` ${fractionWords(texToSpeech(a), texToSpeech(b))} `)
    .replace(new RegExp(`\\\\sqrt${B}`, 'g'), (_m, a) => ` the square root of ${texToSpeech(a)} `);
  s = s.replace(/\^\s*\{?\\circ\}?/g, ' degrees ').replace(/\^\s*\{\s*2\s*\}|\^2(?!\d)/g, ' squared ').replace(/\^\s*\{\s*3\s*\}|\^3(?!\d)/g, ' cubed ')
    .replace(new RegExp(`\\^${B}`, 'g'), ' to the power of $1 ').replace(/\^(\w)/g, ' to the power of $1 ')
    .replace(new RegExp(`_${B}`, 'g'), ' $1 ').replace(/_(\w)/g, ' $1 ');
  s = s.replace(/\\([A-Za-z]+)/g, (_m, w) => GREEK[w] ? ` ${GREEK[w]} ` : OPS[w] ?? ` ${w} `).replace(/\\\\/g, ', ').replace(/\\([{}%$#&_])/g, '$1');
  s = s.replace(/\|([^|]+)\|/g, ' the magnitude of $1 ').replace(/<=/g, ' is less than or equal to ').replace(/>=/g, ' is greater than or equal to ')
    .replace(/</g, ' is less than ').replace(/>/g, ' is greater than ').replace(/=/g, ' equals ').replace(/\+/g, ' plus ')
    .replace(/(^|[\s(=])[-−]\s*(?=\d|[a-z]\b)/gi, '$1 negative ').replace(/\s[-−]\s/g, ' minus ').replace(/(\w)\s*[-−]\s*(\w)/g, '$1 minus $2').replace(/\*/g, ' times ').replace(/\//g, ' over ');
  return unicodeToSpeech(s.replace(/[{}]/g, ' ')).replace(/\s+/g, ' ').trim();
}
/** Unicode maths in ordinary text -> words. Plain text keeps hyphens (only LaTeX treats "-" as minus). */
export function unicodeToSpeech(t: string): string {
  let s = scienceToSpeech(String(t ?? ''));
  s = s.replace(/\b(mm|cm|km|m|in|ft)\s?(?:²|\^2)/g, (_m, u) => `square ${UNIT[u]}`).replace(/\b(mm|cm|km|m|in|ft)\s?(?:³|\^3)/g, (_m, u) => `cubic ${UNIT[u]}`);
  s = s.replace(/∠\s*([A-Z]{1,3})\b/g, (_m, x) => `angle ${letters(x)}`).replace(/△\s*([A-Z]{3})\b/g, (_m, x) => `triangle ${letters(x)}`);
  s = s.replace(/√\s*\(([^()]+)\)/g, 'the square root of $1').replace(/√\s*(\w+)/g, 'the square root of $1');
  s = s.replace(/(\d)\s*°\s*([NSEW])\b/g, '$1 degrees $2').replace(/°/g, ' degrees').replace(/²/g, ' squared').replace(/³/g, ' cubed')
    .replace(/(\w)\^2\b/g, '$1 squared').replace(/(\w)\^3\b/g, '$1 cubed').replace(/(\w)\^(\d+)/g, '$1 to the power of $2');
  s = s.replace(/(?<![\d/])(\d{1,3})\s?\/\s?(\d{1,3})(?![\d/])/g, (_m, a, b) => fractionWords(a, b));
  s = s.replace(/π/g, ' pi ').replace(/θ/g, ' theta ').replace(/α/g, ' alpha ').replace(/β/g, ' beta ').replace(/×/g, ' times ').replace(/÷/g, ' divided by ').replace(/·/g, ' times ')
    .replace(/≤/g, ' is less than or equal to ').replace(/≥/g, ' is greater than or equal to ').replace(/≈/g, ' is approximately ').replace(/≠/g, ' is not equal to ')
    .replace(/∪/g, ' union ').replace(/∩/g, ' intersection ').replace(/∉/g, ' is not an element of ').replace(/∈/g, ' is an element of ').replace(/[⊂⊆]/g, ' is a subset of ').replace(/∅/g, ' the empty set ')
    .replace(/∧/g, ' and ').replace(/∨/g, ' or ').replace(/¬/g, ' not ').replace(/[⇔↔]/g, ' if and only if ').replace(/⇒/g, ' implies ').replace(/\blog_?([0-9a-z])\s*(?=\(|\w)/g, 'log base $1 of ')
    .replace(/±/g, ' plus or minus ').replace(/∥/g, ' is parallel to ').replace(/⊥/g, ' is perpendicular to ').replace(/→/g, ' to ').replace(/−/g, ' minus ')
    .replace(/(\S)\s*=\s*(\S)/g, '$1 equals $2').replace(/\s\+\s/g, ' plus ').replace(/(\d|degrees|squared|cubed|\b[a-z]|\))\s[-–]\s(?=\(|\d|[a-z]\b)/gi, '$1 minus ').replace(/(\w|\))\s\*\s(\w|\()/g, '$1 times $2');
  return s.replace(/\s+/g, ' ').replace(/ ([.,;:!?])(?=\s|$)/g, '$1').trim();
}
/** Text that may contain $…$, $$…$$, \(…\) and \[…\] maths -> words. A price such as "$5" or "GH¢5" is left as text. */
export function mathTextToSpeech(t: string): string {
  const s0 = String(t ?? '').replace(/\$\$([\s\S]+?)\$\$/g, (_m, x) => ` ${texToSpeech(x)}. `).replace(/\\\[([\s\S]+?)\\\]/g, (_m, x) => ` ${texToSpeech(x)}. `)
    .replace(/\\\((.+?)\\\)/g, (_m, x) => ` ${texToSpeech(x)} `);
  const s = inlineMathSpans(s0).reduceRight((a, r) => `${a.slice(0, r.start)} ${texToSpeech(r.inner)} ${a.slice(r.end)}`, s0);
  const bare = !/\$/.test(t ?? '') && /\\(frac|sqrt|sin|cos|tan|theta|circ|times|vec|angle|begin|pi|div|approx|le|ge|neq)\b/.test(s);
  return unicodeToSpeech(bare ? texToSpeech(s) : s);
}
