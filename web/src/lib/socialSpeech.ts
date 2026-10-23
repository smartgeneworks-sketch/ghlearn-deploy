/**
 * Social Studies text -> words for the Listen buttons: Ghana cedi amounts, year and century ranges, "c. 1500",
 * and well-known abbreviations (spelled out as letters, or read as a word where that is how Ghanaians say it).
 * Years themselves ("1957") are left as digits: speech engines read four-digit years as years.
 * Place names are kept as written, except a short list that engines reliably mispronounce.
 */
const LETTERS = ['AU', 'GES', 'NCCE', 'MTTD', 'NRSA', 'DVLA', 'UN', 'WHO', 'FDA', 'GSA', 'GRA', 'NHIS', 'EPA', 'ECG', 'BoG', 'NaCCA', 'SHS', 'JHS', 'BECE', 'WASSCE', 'NGO', 'NGOs', 'GDP', 'ICT', 'SME', 'SMEs', 'PPA', 'CHRAJ', 'GNFS', 'NADMO', 'NDPC', 'IMF'];
const WORDS: Record<string, string> = { ECOWAS: 'Ecowas', SSNIT: 'Snit', UNESCO: 'Unesco', UNICEF: 'Unicef', NaCCA: 'Nacca', WASSCE: 'Wassce', NADMO: 'Nadmo', CHRAJ: 'Chraj', AfCFTA: 'A f C F T A' };
const SAY: Record<string, string> = { Tamale: 'Tah-mah-leh', Nkrumah: 'N-krumah' };
const spell = (w: string) => w.replace(/s$/, (m) => (w.length > 2 && /[A-Z]{2}s$/.test(w) ? '\u0000' : m)).split('').filter((c) => c !== '\u0000').join(' ') + (/[A-Z]{2}s$/.test(w) ? "'s" : '');
export function socialToSpeech(t: string): string {
  let s = String(t ?? '');
  s = s.replace(/\b(?:GH\s?[₵¢]|GH[Cc]|GHS|Ghs|GH¢|₵)\s?(\d[\d,]*(?:\.\d+)?)/g, (_m, n) => `${n} Ghana ${n === '1' ? 'cedi' : 'cedis'}`);
  s = s.replace(/\bc\.\s?(\d{3,4})\b/g, 'circa $1');
  s = s.replace(/\b(\d{3,4})\s?[–—-]\s?(\d{2,4})\b(?!\s?[-–]\s?\d)/g, '$1 to $2').replace(/\b(\d{1,2}(?:st|nd|rd|th))\s?[–—-]\s?(\d{1,2}(?:st|nd|rd|th))\b/g, '$1 to $2');
  s = s.replace(/\b([A-Za-z]{2,7})\b/g, (m, w: string, at: number, all: string) => {
    // An all-capitals heading ("WHO WE ARE") is ordinary words, not abbreviations.
    const around = `${all.slice(Math.max(0, at - 12), at)} ${all.slice(at + w.length, at + w.length + 12)}`;
    if (/\b[A-Z]{3,}\b/.test(around.replace(new RegExp(`\\b(${[...LETTERS, ...Object.keys(WORDS)].join('|')})\\b`, 'g'), ''))) return m;
    if (WORDS[w]) return WORDS[w]; if (LETTERS.includes(w)) return spell(w); return SAY[w] ?? m; });
  return s;
}
