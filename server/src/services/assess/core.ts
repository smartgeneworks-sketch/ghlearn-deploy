/**
 * Pure question-bank logic: validation (answer keys), presentation (answers stripped, randomised), marking,
 * and near-duplicate detection. No I/O, fully unit-testable.
 */
import { renderDiagram, validateDiagram } from '../lessons/svg.js';

export const OBJECTIVE = ['mcq', 'true_false', 'short_answer', 'gap_fill', 'matching', 'ordering', 'diagram_labelling', 'numerical'];
// ---------- randomness ----------
export function prng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function shuffled<T>(arr: T[], rnd: () => number): T[] { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const perm = (n: number, rnd: () => number) => shuffled([...Array(n).keys()], rnd);

// ---------- text matching ----------
export const normalize = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}\s.-]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^(a|an|the) /, '').replace(/\.$/, '');
export function levenshtein(a: string, b: string) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
/** Flexible match: case/punctuation/article-insensitive; small spelling slips allowed on longer words (not on numbers). */
export function textMatches(given: unknown, accepted: string[], allowSpelling = true) {
  const g = normalize(given); if (!g) return false;
  return accepted.some((a) => { const n = normalize(a); if (n === g) return true;
    if (!allowSpelling || /\d/.test(n) || n.length < 5) return false; return levenshtein(n, g) <= Math.floor(n.length / 6); });
}
const containsFuzzy = (text: string, kw: string) => { const t = normalize(text), k = normalize(kw); if (t.includes(k)) return true; if (k.length < 5 || k.includes(' ')) return false; return t.split(' ').some((w) => levenshtein(w, k) <= Math.floor(k.length / 6)); };
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim().replace(/\s/g, ''); if (!s.includes('.') && /^-?\d+,(\d{1,2}|\d{4,})$/.test(s)) s = s.replace(',', '.'); s = s.replace(/,/g, '');
  const m = s.match(/^-?\d*\.?\d+(e-?\d+)?/i); return m ? Number(m[0]) : null;
}

// ---------- validation ----------
const strs = (v: any, min = 1) => Array.isArray(v) && v.length >= min && v.every((x) => typeof x === 'string' && x.trim());
export function validateQuestion(q: any): { ok: boolean; errors: string[]; warnings: string[]; checkedAt: Date } {
  const e: string[] = []; const w: string[] = []; const d = q.data ?? {};
  if (!q.stem || String(q.stem).trim().length < 5) e.push('Question text is too short');
  if (!q.topic) e.push('Topic is required');
  if (!(q.marks > 0)) e.push('Marks must be positive');
  const rubricOk = (r: any[], where = '') => { if (!r?.length) { e.push(`${where}Rubric required`); return 0; }
    let t = 0; r.forEach((c, i) => { if (!c.criterion || !(c.maxMarks > 0)) e.push(`${where}Rubric criterion ${i + 1} needs a name and positive marks`); t += c.maxMarks || 0; }); return t; };
  switch (q.type) {
    case 'mcq': if (!strs(d.options, 2) || d.options.length > 6) e.push('MCQ needs 2-6 options');
      else { if (!(Number.isInteger(d.correctIndex) && d.correctIndex >= 0 && d.correctIndex < d.options.length)) e.push('Answer key (correctIndex) is out of range');
        if (new Set(d.options.map(normalize)).size !== d.options.length) e.push('Options must be distinct');
        if (d.options.some((o: string) => /^(all|none) of the above$/i.test(o.trim()))) w.push('Avoid "all/none of the above"'); } break;
    case 'true_false': if (typeof d.answer !== 'boolean') e.push('True/false answer key must be true or false'); break;
    case 'short_answer': if (!strs(d.acceptedAnswers) && !strs(d.keywords)) e.push('Short answer needs accepted answers or keywords');
      if (d.minKeywords != null && d.keywords && d.minKeywords > d.keywords.length) e.push('minKeywords exceeds number of keywords'); break;
    case 'gap_fill': { const n = (String(d.text ?? '').match(/\{\{\d+\}\}/g) ?? []).length;
      if (!n) e.push('Gap-fill text needs {{1}} style blanks'); if (!Array.isArray(d.gaps) || d.gaps.length !== n) e.push(`Gap-fill needs one answer list per blank (${n})`);
      else d.gaps.forEach((g: any, i: number) => { if (!strs(g?.accepted)) e.push(`Blank ${i + 1} has no accepted answers`); }); break; }
    case 'matching': if (!Array.isArray(d.pairs) || d.pairs.length < 2 || d.pairs.length > 10 || !d.pairs.every((p: any) => p?.left && p?.right)) e.push('Matching needs 2-10 left/right pairs');
      else if (new Set(d.pairs.map((p: any) => normalize(p.right))).size !== d.pairs.length) e.push('Matching answers must be distinct'); break;
    case 'ordering': if (!strs(d.items, 2) || d.items.length > 10) e.push('Ordering needs 2-10 items in the correct order');
      else if (new Set(d.items.map(normalize)).size !== d.items.length) e.push('Ordering items must be distinct'); break;
    case 'diagram_labelling': { const err = validateDiagram({ kind: 'labelled', title: 'x', centre: d.centre, labels: (d.labels ?? []).map((l: any) => l?.accepted?.[0] ?? '') });
      if (err) e.push(`Diagram: ${err}`); if (!(d.labels ?? []).every((l: any) => strs(l?.accepted))) e.push('Every label needs accepted answers'); if (!d.alt) w.push('Diagram has no alt text (a default will be used)'); break; }
    case 'numerical': if (typeof d.value !== 'number' || !Number.isFinite(d.value)) e.push('Numerical answer must be a number');
      if (!(d.tolerance >= 0)) e.push('Tolerance must be 0 or more'); if (d.toleranceType && !['abs', 'pct'].includes(d.toleranceType)) e.push('toleranceType must be abs or pct');
      if (d.requireUnit && !d.unit) e.push('requireUnit set but no unit given'); break;
    case 'structured': case 'case_study': {
      if (q.type === 'case_study' && String(d.scenario ?? '').length < 30) e.push('Case study needs a scenario (30+ characters)');
      if (!Array.isArray(d.parts) || !d.parts.length) { e.push('Needs at least one part'); break; }
      let total = 0; d.parts.forEach((p: any, i: number) => { if (!p.prompt) e.push(`Part ${i + 1}: prompt required`);
        if (!['mcq', 'short_answer', 'numerical', 'essay'].includes(p.type)) e.push(`Part ${i + 1}: type must be mcq, short_answer, numerical or essay`);
        else if (p.type === 'essay') { total += rubricOk(p.rubric, `Part ${i + 1}: `); }
        else { const sub = validateQuestion({ ...p, stem: p.prompt, topic: q.topic, marks: p.marks ?? 1, data: p }); sub.errors.forEach((x) => e.push(`Part ${i + 1}: ${x}`)); total += p.marks ?? 1; } });
      if (total !== q.marks) w.push(`Marks (${q.marks}) differ from the sum of part marks (${total}); part marks are used`); break; }
    case 'essay': { const t = rubricOk(q.rubric); if (t && t !== q.marks) w.push(`Marks (${q.marks}) differ from rubric total (${t}); rubric total is used`); if (!d.guidance) w.push('No marking guidance / model answer points'); break; }
    default: e.push(`Unknown question type "${q.type}"`);
  }
  if (!q.explanation && OBJECTIVE.includes(q.type)) w.push('No explanation for feedback');
  if (!q.citations?.length && !q.lessonId) w.push('No source reference');
  return { ok: !e.length, errors: e, warnings: w, checkedAt: new Date() };
}
export const totalMarks = (q: any) => q.type === 'essay' ? (q.rubric ?? []).reduce((t: number, c: any) => t + c.maxMarks, 0) || q.marks
  : ['structured', 'case_study'].includes(q.type) ? (q.data?.parts ?? []).reduce((t: number, p: any) => t + (p.type === 'essay' ? (p.rubric ?? []).reduce((a: number, c: any) => a + c.maxMarks, 0) : p.marks ?? 1), 0)
  : q.type === 'gap_fill' ? (q.data?.gaps?.length ?? 1) : q.type === 'matching' ? (q.data?.pairs?.length ?? 1) : q.type === 'diagram_labelling' ? (q.data?.labels?.length ?? 1) : q.marks ?? 1;

// ---------- presentation ----------
/** Make a per-attempt permutation. Stored server-side on the attempt item. */
export function makePerm(q: any, rnd: () => number, randomize = true) {
  const d = q.data ?? {}; const id = (n: number) => [...Array(n).keys()];
  const p = (n: number) => (randomize ? perm(n, rnd) : id(n));
  if (q.type === 'mcq') return { options: p(d.options.length) };
  if (q.type === 'matching') return { rights: perm(d.pairs.length, rnd) }; // always shuffled, else trivially solvable
  if (q.type === 'ordering') { let o = perm(d.items.length, rnd); if (o.every((x, i) => x === i) && o.length > 1) o = [...o.slice(1), o[0]]; return { items: o }; }
  if (['structured', 'case_study'].includes(q.type)) return { parts: (d.parts ?? []).map((pt: any) => (pt.type === 'mcq' ? p(pt.options.length) : null)) };
  return {};
}
/** Client view of a question: no answer keys. */
export function presentQuestion(q: any, pm: any = {}) {
  const d = q.data ?? {}; const base = { id: String(q._id), type: q.type, stem: q.stem, topic: q.topic, difficulty: q.difficulty, marks: totalMarks(q) };
  switch (q.type) {
    case 'mcq': return { ...base, options: (pm.options ?? d.options.map((_: any, i: number) => i)).map((i: number) => d.options[i]) };
    case 'true_false': case 'short_answer': case 'essay': return { ...base, ...(q.type === 'essay' ? { wordLimit: d.wordLimit, rubric: (q.rubric ?? []).map((c: any) => ({ criterion: c.criterion, maxMarks: c.maxMarks })) } : {}), ...(d.unitHint ? { unitHint: d.unitHint } : {}) };
    case 'gap_fill': return { ...base, text: d.text, blanks: d.gaps.length, ...(d.wordBank ? { wordBank: d.wordBank } : {}) };
    case 'matching': return { ...base, left: d.pairs.map((x: any) => x.left), right: (pm.rights ?? d.pairs.map((_: any, i: number) => i)).map((i: number) => d.pairs[i].right) };
    case 'ordering': return { ...base, items: (pm.items ?? d.items.map((_: any, i: number) => i)).map((i: number) => d.items[i]) };
    case 'diagram_labelling': return { ...base, svg: labelSvg(d), alt: d.alt || `Diagram of ${d.centre} with ${d.labels.length} numbered labels to name`, labels: d.labels.map((_: any, i: number) => i + 1) };
    case 'numerical': return { ...base, unit: d.requireUnit ? undefined : d.unit, requireUnit: !!d.requireUnit };
    case 'structured': case 'case_study': return { ...base, scenario: d.scenario, parts: d.parts.map((p: any, i: number) => ({ prompt: p.prompt, type: p.type, marks: p.type === 'essay' ? (p.rubric ?? []).reduce((a: number, c: any) => a + c.maxMarks, 0) : p.marks ?? 1,
      ...(p.type === 'mcq' ? { options: (pm.parts?.[i] ?? p.options.map((_: any, j: number) => j)).map((j: number) => p.options[j]) } : {}), ...(p.type === 'numerical' && !p.requireUnit ? { unit: p.unit } : {}) })) };
  }
  return base;
}
export const labelSvg = (d: any) => renderDiagram({ kind: 'labelled', title: d.title ?? 'Label the diagram', centre: d.centre, labels: d.labels.map((_: any, i: number) => `(${i + 1}) ?`) } as any);

// ---------- marking ----------
export interface Mark { score: number; maxScore: number; correct: boolean; feedback: string; explanation?: string; improvement?: string; needsAi?: boolean; parts?: any[]; correctAnswer?: any }
const TIPS: Record<string, string> = {
  mcq: 'Eliminate options you know are wrong, then compare the remaining ones with the key idea.', true_false: 'Look for absolute words (always, never) and check each part of the statement.',
  short_answer: 'Use the precise subject term from your notes.', gap_fill: 'Re-read the whole sentence and check each word fits the meaning and grammar.',
  matching: 'Start with the pairs you are sure of, then match the rest.', ordering: 'Find the first and last steps first, then fill in the middle.',
  diagram_labelling: 'Learn the position and function of each part together.', numerical: 'Write the formula, substitute with units, and check your arithmetic and rounding.',
};
const fb = (q: any, score: number, max: number, correctAnswer: any, shown: string): Mark => ({ score, maxScore: max, correct: score === max,
  feedback: score === max ? 'Correct.' : score > 0 ? `Partly correct (${score}/${max}). ${shown}` : `Not correct. ${shown}`,
  explanation: q.explanation, improvement: score === max ? undefined : TIPS[q.type], correctAnswer });
function markPart(p: any, r: any, topicQ: any): Mark { return markResponse({ ...p, stem: p.prompt, explanation: p.explanation, data: p, marks: p.marks ?? 1, rubric: p.rubric, topic: topicQ.topic }, r, null); }
export function markResponse(q: any, r: any, pm: any): Mark {
  const d = q.data ?? {}; const max = totalMarks(q);
  if (r == null || r === '' || (Array.isArray(r) && !r.length)) {
    if (q.type === 'essay') return { score: 0, maxScore: max, correct: false, feedback: 'No answer given.', improvement: 'Attempt every question; plan the key points first.' };
    const m = markResponse(q, q.type === 'mcq' ? -1 : '\u0000', pm); return { ...m, score: 0, correct: false, feedback: `No answer given. ${m.feedback.replace(/^Not correct\. /, '')}` };
  }
  switch (q.type) {
    case 'mcq': { const canon = pm?.options ? pm.options[Number(r)] : Number(r); const ok = canon === d.correctIndex;
      return fb(q, ok ? max : 0, max, d.options[d.correctIndex], `The correct answer is "${d.options[d.correctIndex]}".`); }
    case 'true_false': { const v = typeof r === 'boolean' ? r : /^(true|t|yes)$/i.test(String(r)); const ok = String(r) !== '\u0000' && v === d.answer; return fb(q, ok ? max : 0, max, d.answer, `The statement is ${d.answer ? 'true' : 'false'}.`); }
    case 'short_answer': {
      if (strs(d.acceptedAnswers) && textMatches(r, d.acceptedAnswers, d.allowSpelling !== false)) return fb(q, max, max, d.acceptedAnswers[0], '');
      if (strs(d.keywords)) { const need = d.minKeywords ?? d.keywords.length; const hit = d.keywords.filter((k: string) => containsFuzzy(String(r), k)).length;
        const sc = hit >= need ? max : Math.floor((max * hit) / need); return fb(q, sc, max, d.acceptedAnswers?.[0] ?? d.keywords.join(', '), `Key points expected: ${d.keywords.join(', ')}.`); }
      return fb(q, 0, max, d.acceptedAnswers[0], `An acceptable answer is "${d.acceptedAnswers[0]}".`); }
    case 'gap_fill': { const arr = Array.isArray(r) ? r : [r]; const res = d.gaps.map((g: any, i: number) => textMatches(arr[i], g.accepted, d.allowSpelling !== false));
      const sc = res.filter(Boolean).length; return { ...fb(q, sc, max, d.gaps.map((g: any) => g.accepted[0]), `Answers: ${d.gaps.map((g: any, i: number) => `(${i + 1}) ${g.accepted[0]}`).join(', ')}.`), parts: res }; }
    case 'matching': { // r: array, r[leftIndex] = presented right index
      const arr = Array.isArray(r) ? r : []; const res = d.pairs.map((_: any, i: number) => arr[i] != null && (pm?.rights ? pm.rights[Number(arr[i])] : Number(arr[i])) === i);
      const sc = res.filter(Boolean).length; return { ...fb(q, sc, max, d.pairs, `Correct pairs: ${d.pairs.map((p: any) => `${p.left} → ${p.right}`).join('; ')}.`), parts: res }; }
    case 'ordering': { // r: presented indexes in learner's order; full marks only for exact order, partial = items in correct position
      const arr = Array.isArray(r) ? r.map(Number) : []; const canon = arr.map((x) => (pm?.items ? pm.items[x] : x));
      const pos = d.items.filter((_: any, i: number) => canon[i] === i).length; const sc = pos === d.items.length ? max : Math.floor((max * pos) / d.items.length);
      return fb(q, sc, max, d.items, `Correct order: ${d.items.join(' → ')}.`); }
    case 'diagram_labelling': { const arr = Array.isArray(r) ? r : []; const res = d.labels.map((l: any, i: number) => textMatches(arr[i], l.accepted, d.allowSpelling !== false));
      const sc = res.filter(Boolean).length; return { ...fb(q, sc, max, d.labels.map((l: any) => l.accepted[0]), `Labels: ${d.labels.map((l: any, i: number) => `(${i + 1}) ${l.accepted[0]}`).join(', ')}.`), parts: res }; }
    case 'numerical': { const val = typeof r === 'object' && r ? r.value : r; const unit = typeof r === 'object' && r ? r.unit : String(r ?? '').replace(/^[\s\d.,eE+-]+/, '');
      const n = parseNumber(val); const tol = d.toleranceType === 'pct' ? Math.abs(d.value) * (d.tolerance / 100) : d.tolerance;
      const numOk = n != null && Math.abs(n - d.value) <= tol + 1e-12; const unitOk = !d.requireUnit || normalize(unit).replace(/\s/g, '') === normalize(d.unit).replace(/\s/g, '');
      const sc = numOk && unitOk ? max : numOk && max > 1 ? max - 1 : 0;
      return fb(q, sc, max, { value: d.value, unit: d.unit }, `Expected ${d.value}${d.unit ? ' ' + d.unit : ''}${tol ? ` (±${d.toleranceType === 'pct' ? d.tolerance + '%' : d.tolerance})` : ''}.${numOk && !unitOk ? ' Your number is right but the unit is missing or wrong.' : ''}`); }
    case 'structured': case 'case_study': { const arr = Array.isArray(r) ? r : [];
      const parts = d.parts.map((p: any, i: number) => p.type === 'essay' ? { score: 0, maxScore: (p.rubric ?? []).reduce((a: number, c: any) => a + c.maxMarks, 0), needsAi: true, correct: false, feedback: 'Awaiting marking' } as Mark
        : markPart(p, p.type === 'mcq' && arr[i] != null && pm?.parts?.[i] ? pm.parts[i][Number(arr[i])] : arr[i], q));
      const sc = parts.reduce((t: number, p: Mark) => t + p.score, 0); const needsAi = parts.some((p: Mark) => p.needsAi);
      return { score: sc, maxScore: max, correct: !needsAi && sc === max, needsAi, parts, feedback: needsAi ? 'Objective parts marked; written parts awaiting marking.' : sc === max ? 'Correct.' : `You scored ${sc}/${max}. See each part.`, explanation: q.explanation,
        improvement: sc === max ? undefined : 'Answer each part fully and use the marks as a guide to how much detail is needed.' }; }
    case 'essay': return { score: 0, maxScore: max, correct: false, needsAi: true, feedback: 'Awaiting marking.' };
  }
  return { score: 0, maxScore: max, correct: false, feedback: 'Cannot be marked' };
}

// ---------- near-duplicates ----------
const shingles = (s: string) => { const w = normalize(s).split(' ').filter((x) => x.length > 1); const out = new Set<string>(); if (w.length < 3) { out.add(w.join(' ')); return out; } for (let i = 0; i + 2 < w.length; i++) out.add(w.slice(i, i + 3).join(' ')); return out; };
const jac = (A: Set<string>, B: Set<string>) => { let i = 0; for (const x of A) if (B.has(x)) i++; return A.size + B.size ? i / (A.size + B.size - i) : 0; };
/** max(word-trigram Jaccard, 0.9 × word-set Jaccard): catches reworded copies and small insertions. */
export function similarity(a: string, b: string) { const words = (s: string) => new Set(normalize(s).split(' ').filter(Boolean)); return Math.max(jac(shingles(a), shingles(b)), 0.9 * jac(words(a), words(b))); }
export const questionText = (q: any) => [q.stem, q.data?.text, q.data?.scenario, ...(q.data?.parts ?? []).map((p: any) => p.prompt)].filter(Boolean).join(' ');
export function findNearDuplicate(q: any, pool: { _id?: any; type: string; text: string }[], threshold = 0.7) {
  const t = questionText(q); let best: { id: any; sim: number } | null = null;
  for (const p of pool) { const sim = normalize(t) === normalize(p.text) ? 1 : similarity(t, p.text); if (sim >= threshold && (!best || sim > best.sim)) best = { id: p._id, sim }; }
  return best;
}

// ---------- marking info and answer solver ----------
/** How each type is marked (§13). Essays are teacher-marked; structured / case study are auto-marked except essay parts. */
export const TYPE_INFO: Record<string, { label: string; marking: 'auto' | 'teacher' | 'mixed'; note: string }> = {
  mcq: { label: 'Multiple choice', marking: 'auto', note: 'Auto-marked; options shuffled per attempt.' },
  true_false: { label: 'True / false', marking: 'auto', note: 'Auto-marked.' },
  short_answer: { label: 'Short answer', marking: 'auto', note: 'Auto-marked against accepted answers or key words (small spelling slips allowed on long words).' },
  gap_fill: { label: 'Fill in the gaps', marking: 'auto', note: 'Auto-marked, one mark per blank.' },
  matching: { label: 'Matching', marking: 'auto', note: 'Auto-marked, one mark per pair.' },
  ordering: { label: 'Ordering / sequencing', marking: 'auto', note: 'Auto-marked; partial credit for items in the right position.' },
  diagram_labelling: { label: 'Diagram labelling', marking: 'auto', note: 'Auto-marked, one mark per label.' },
  numerical: { label: 'Calculation / numerical', marking: 'auto', note: 'Auto-marked within tolerance; a required unit costs one mark if wrong.' },
  structured: { label: 'Structured (parts)', marking: 'mixed', note: 'Objective parts auto-marked; essay parts are teacher-marked (AI-provisional mark first when AI is configured).' },
  essay: { label: 'Essay / extended response', marking: 'teacher', note: 'Teacher-marked against the rubric (AI-provisional mark first when AI is configured; the teacher verifies).' },
  case_study: { label: 'Case study / scenario', marking: 'mixed', note: 'Objective parts auto-marked; essay parts are teacher-marked.' },
};
/** True when a teacher has to mark (part of) this question. */
export const teacherMarked = (q: any) => q.type === 'essay' || (['structured', 'case_study'].includes(q.type) && (q.data?.parts ?? []).some((p: any) => p.type === 'essay'));
/** The correct response in the presented (permuted) form, as a learner would submit it. Null for written (teacher-marked) answers. */
export function solveResponse(q: any, pm: any = {}): any {
  const d = q.data ?? {}; const pos = (permArr: number[] | undefined, canon: number) => (permArr ? permArr.indexOf(canon) : canon);
  switch (q.type) {
    case 'mcq': return pos(pm?.options, d.correctIndex);
    case 'true_false': return d.answer;
    case 'short_answer': return d.acceptedAnswers?.[0] ?? (d.keywords ?? []).join(' ');
    case 'gap_fill': return (d.gaps ?? []).map((g: any) => g.accepted?.[0]);
    case 'matching': return (d.pairs ?? []).map((_: any, i: number) => pos(pm?.rights, i));
    case 'ordering': return (d.items ?? []).map((_: any, i: number) => pos(pm?.items, i));
    case 'diagram_labelling': return (d.labels ?? []).map((l: any) => l.accepted?.[0]);
    case 'numerical': return { value: d.value, unit: d.unit ?? '' };
    case 'structured': case 'case_study': return (d.parts ?? []).map((p: any, i: number) => p.type === 'essay' ? null : p.type === 'mcq' ? pos(pm?.parts?.[i] ?? undefined, p.correctIndex) : solveResponse({ type: p.type, data: p }, {}));
  }
  return null;
}
