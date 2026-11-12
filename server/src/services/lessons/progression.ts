/** Curriculum LMS progression (§9): lock rules, completion rule, answer-free copies for learners. */
export type LockMode = 'sequential' | 'free' | 'prerequisite';
/** Group within which order applies: sequential = the strand (year + strand), prerequisite = the content standard. */
const group = (key: string, mode: LockMode) => { const m = String(key).match(/-(Y\d+\.S\d+)(\.SS\d+)?(\.CS\d+)?/); return !m ? key : mode === 'sequential' ? m[1] : `${m[1]}${m[2] ?? ''}${m[3] ?? ''}`; };
export function computeLocks(mods: { _id: any; moduleKey?: string | null; order?: number | null }[], done: Set<string>, mode: LockMode) {
  const out = new Map<string, { locked: boolean; reason?: string; requires?: string }>();
  const prevInGroup = new Map<string, any>();
  for (const m of [...mods].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const g = group(String(m.moduleKey ?? ''), mode); const prev = prevInGroup.get(g);
    if (mode === 'free' || !prev) out.set(String(m._id), { locked: false });
    else { const prevOpen = !out.get(String(prev._id))!.locked; const ok = done.has(String(prev._id));
      out.set(String(m._id), ok && prevOpen ? { locked: false } : { locked: true, requires: String(prev._id), reason: 'Complete the previous module first' }); }
    prevInGroup.set(g, m);
  }
  return out;
}
/** Seeded shuffle so a learner sees one stable question/option order per attempt, and a fresh order after each attempt. */
function rng(seed: string) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; }; }
function perm(n: number, r: () => number) { const a = Array.from({ length: n }, (_, i) => i); for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const questionsOf = (body: any) => body?.sections?.find((s: any) => s.key === 'L')?.data?.questions ?? [];
export type CheckLayout = { order: number[]; opts: number[][] };
/** Display layout for attempt N: order[i] = original question index shown at position i; opts[i][j] = original option index shown at j. */
export function checkLayout(body: any, seed: string): CheckLayout {
  const qs = questionsOf(body); const r = rng(seed); const order = perm(qs.length, r);
  return { order, opts: order.map((qi) => perm((qs[qi]?.options ?? []).length, r)) };
}
/** Answer-free learner copy; with a layout, the knowledge check is shown in that order. */
export function learnerCopy(body: any, layout?: CheckLayout) {
  if (!body?.sections) return body;
  const strip = (qs: any[]) => layout ? layout.order.map((qi, i) => ({ question: qs[qi].question, options: layout.opts[i].map((oj) => qs[qi].options[oj]) })) : qs.map((q: any) => ({ question: q.question, options: q.options }));
  return { ...body, sourceMap: undefined, sections: body.sections.map((s: any) => s.key !== 'L' ? s : { ...s, data: { ...s.data, questions: strip(s.data?.questions ?? []) } }) };
}
const words = (t: string) => new Set(String(t ?? '').toLowerCase().replace(/\$[^$]*\$/g, ' ').match(/[a-z]{4,}/g) ?? []);
/** Point a learner back to the notes section (and manual pages) that best covers a question, without giving the answer. */
export function reviewHint(body: any, q: any) {
  const qw = words(`${q?.question ?? ''} ${(q?.options ?? []).join(' ')}`); let best: any = null; let score = 0;
  for (const s of body?.sections ?? []) { if (!['C', 'D', 'E', 'G', 'H', 'I', 'J'].includes(s.key)) continue;
    const sw = words(`${s.content ?? ''} ${JSON.stringify(s.data ?? '')}`); let n = 0; for (const w of qw) if (sw.has(w)) n++; if (n > score) { score = n; best = s; } }
  best ??= (body?.sections ?? []).find((s: any) => s.key === 'D');
  if (!best) return 'Review the notes above and try again.';
  const pages = [...new Set((best.citations ?? []).flatMap((c: any) => c.pageStart ? [c.pageStart] : []))].sort((a: any, b: any) => a - b).slice(0, 3);
  return `Review section ${best.key}. ${best.title}${pages.length ? ` (learner manual p. ${pages.join(', ')})` : ''}.`;
}
/** Score a learner attempt. Answers follow the displayed layout. Correct answers and explanations are returned only on a pass; otherwise only which questions were wrong, with a hint. */
export function scoreCheck(body: any, answers: number[], layout?: CheckLayout, passMarkPct = 0) {
  const qs = questionsOf(body); const L: CheckLayout = layout ?? { order: qs.map((_: any, i: number) => i), opts: qs.map((q: any) => (q.options ?? []).map((_: any, j: number) => j)) };
  const marks = L.order.map((qi, i) => answers[i] != null && answers[i] >= 0 && L.opts[i][answers[i]] === qs[qi].correctIndex);
  const correct = marks.filter(Boolean).length; const pct = qs.length ? Math.round((correct / qs.length) * 100) : 100; const passed = pct >= passMarkPct;
  const results = L.order.map((qi, i) => passed
    ? { correct: marks[i], correctIndex: L.opts[i].indexOf(qs[qi].correctIndex), explanation: qs[qi].explanation ?? '' }
    : { correct: marks[i], question: qs[qi].question, ...(marks[i] ? {} : { hint: reviewHint(body, qs[qi]) }) });
  return { total: qs.length, correct, pct, passed, results };
}
