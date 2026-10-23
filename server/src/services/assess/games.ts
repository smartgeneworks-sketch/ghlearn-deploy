import { studentAudience } from '../eligibility.js';
import { Question, LearningResource, GameSession, GameDesign } from '../../models/index.js';
import { prng, shuffled, makePerm, presentQuestion, markResponse, normalize, textMatches, validateQuestion, solveResponse } from './core.js';
import { renderDiagram } from '../lessons/svg.js';
import { awardXp, grantBadges, updateMastery } from './rewards.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';

/** The ten learning games (spec §10). Every game is built from APPROVED content only (published questions and published lessons). */
export const GAME_INFO: Record<string, { name: string; description: string; timeLimitSec?: number }> = {
  quiz_challenge: { name: 'Quiz challenge', description: 'Answer multiple-choice and true/false questions; build a streak of correct answers.' },
  match_terms: { name: 'Match the term', description: 'Match each key term to its definition.' },
  ordering: { name: 'Put it in order', description: 'Arrange the steps of a process in the right order.' },
  flashcards: { name: 'Flashcards', description: 'Recall the answer, flip the card, and rate yourself honestly. Cards you miss come back.' },
  gap_fill: { name: 'Fill the gaps', description: 'Complete sentences with the missing key words.' },
  word_search: { name: 'Word search', description: 'Find the key terms hidden in the grid using their definitions as clues.' },
  label_diagram: { name: 'Label the diagram', description: 'Name the numbered parts of a diagram.' },
  classification: { name: 'Sort it out', description: 'Classify each item into the correct group.' },
  timed_revision: { name: 'Timed revision', description: 'Answer as many revision questions as you can in 2 minutes.', timeLimitSec: 120 },
  scenario: { name: 'Solve the scenario', description: 'Work through a real-life Ghanaian problem step by step.' },
};
export const ITEM_POINTS = 10, HINT_COST = 3;

export async function pool(subjectId: string, topic?: string, audience: Record<string, unknown> = {}) {
  const qf: any = { subjectId, status: 'published' }; if (topic) qf.topic = topic;
  const [questions, lessons] = await Promise.all([Question.find(qf).limit(400).lean(), LearningResource.find({ subjectId, status: 'published', ...(topic ? { topic } : {}), 'body.sections': { $exists: true }, ...audience }).limit(30).lean()]);
  const sec = (k: string) => lessons.flatMap((l: any) => (l.body.sections ?? []).filter((s: any) => s.key === k).map((s: any) => ({ s, l })));
  const terms = [...sec('E').flatMap(({ s, l }) => (s.data?.terms ?? []).map((t: any) => ({ ...t, topic: l.topic }))), ...sec('J').flatMap(({ s, l }) => (s.data?.vocabulary ?? []).map((t: any) => ({ ...t, topic: l.topic })))]
    .filter((t) => t.term && t.definition);
  const uniqTerms = [...new Map(terms.map((t) => [normalize(t.term), t])).values()];
  return { questions, lessons, terms: uniqTerms, sec };
}
const qItem = (q: any, rnd: () => number) => ({ id: `q:${q._id}`, source: 'question', questionId: String(q._id), topic: q.topic, objective: q.objective, q, perm: makePerm(q, rnd), hint: q.hint });

/** Word search grid: deterministic placement from the seed; horizontal, vertical and diagonal (no backwards, easier to read). */
export function buildWordSearch(words: string[], rnd: () => number, size = 12) {
  const g: string[][] = Array.from({ length: size }, () => Array(size).fill('')); const placed: { word: string; start: [number, number]; end: [number, number] }[] = [];
  const dirs = [[0, 1], [1, 0], [1, 1]];
  for (const w of words) { for (let t = 0; t < 200; t++) { const [dr, dc] = dirs[Math.floor(rnd() * dirs.length)]; const r = Math.floor(rnd() * (size - (dr ? w.length : 0) + (dr ? 0 : 0))), c = Math.floor(rnd() * (size - (dc ? w.length : 0)));
      if (r + dr * (w.length - 1) >= size || c + dc * (w.length - 1) >= size || r < 0 || c < 0) continue;
      if ([...w].every((ch, i) => !g[r + dr * i][c + dc * i] || g[r + dr * i][c + dc * i] === ch)) { [...w].forEach((ch, i) => (g[r + dr * i][c + dc * i] = ch)); placed.push({ word: w, start: [r, c], end: [r + dr * (w.length - 1), c + dc * (w.length - 1)] }); break; } } }
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; for (const row of g) for (let i = 0; i < size; i++) if (!row[i]) row[i] = A[Math.floor(rnd() * 26)];
  return { grid: g.map((r) => r.join('')), placed };
}
export async function buildGame(game: string, subjectId: string, topic: string | undefined, seed: number, audience: Record<string, unknown> = {}) {
  const rnd = prng(seed); const P = await pool(subjectId, topic, audience); const items: any[] = [];
  const qs = (types: string[], n: number) => shuffled(P.questions.filter((q) => types.includes(q.type)), rnd).slice(0, n).map((q) => qItem(q, rnd));
  switch (game) {
    case 'quiz_challenge': items.push(...qs(['mcq', 'true_false'], 10)); break;
    case 'timed_revision': items.push(...qs(['mcq', 'true_false', 'short_answer', 'numerical', 'gap_fill'], 25)); break;
    case 'gap_fill': items.push(...qs(['gap_fill'], 8)); break;
    case 'ordering': items.push(...qs(['ordering'], 6));
      for (const { s, l } of P.sec('F')) for (const d of s.data?.diagrams ?? []) if (['flow', 'cycle'].includes(d.spec?.kind) && items.length < 6)
        items.push({ id: `l:${l._id}:${normalize(d.spec.title).slice(0, 30)}`, source: 'lesson', topic: l.topic, q: { type: 'ordering', stem: `Put in order: ${d.spec.title}`, topic: l.topic, marks: 1, data: { items: d.spec.steps } }, perm: null });
      items.forEach((it) => { if (!it.perm) it.perm = makePerm(it.q, rnd); }); break;
    case 'label_diagram': items.push(...qs(['diagram_labelling'], 5));
      for (const { s, l } of P.sec('F')) for (const d of s.data?.diagrams ?? []) if (d.spec?.kind === 'labelled' && items.length < 5)
        items.push({ id: `l:${l._id}:${normalize(d.spec.title).slice(0, 30)}`, source: 'lesson', topic: l.topic, q: { type: 'diagram_labelling', stem: `Label: ${d.spec.title}`, topic: l.topic, marks: 1, data: { centre: d.spec.centre, title: d.spec.title, labels: d.spec.labels.map((x: string) => ({ accepted: [x] })), alt: d.alt } }, perm: {} }); break;
    case 'scenario': items.push(...shuffled(P.questions.filter((q) => q.type === 'case_study' && (q.data as any)?.parts?.some((p: any) => p.type !== 'essay')), rnd).slice(0, 3).map((q) => {
      const parts = (q.data as any).parts.filter((p: any) => p.type !== 'essay'); const q2 = { ...q, data: { ...(q.data as any), parts } }; return qItem(q2, rnd); })); break;
    case 'match_terms': { let ts = shuffled(P.terms, rnd).slice(0, 6);
      if (ts.length < 3) ts = shuffled(P.questions.filter((q) => q.type === 'matching').flatMap((q) => (q.data as any).pairs.map((p: any) => ({ term: p.left, definition: p.right, topic: q.topic }))), rnd).slice(0, 6);
      if (ts.length >= 3) { const q = { type: 'matching', stem: 'Match each term to its definition', topic: topic ?? ts[0].topic, marks: ts.length, data: { pairs: ts.map((t) => ({ left: t.term, right: t.definition })) } };
        items.push({ id: 'match', source: 'terms', topic: q.topic, q, perm: makePerm(q, rnd) }); } break; }
    case 'flashcards': { const cards = [...P.sec('J').flatMap(({ s, l }) => (s.data?.flashcards ?? []).map((f: any) => ({ front: f.front, back: f.back, topic: l.topic }))), ...P.terms.map((t) => ({ front: t.term, back: t.definition, topic: t.topic }))];
      shuffled([...new Map(cards.filter((c) => c.front && c.back).map((c) => [normalize(c.front), c])).values()], rnd).slice(0, 15).forEach((c, i) => items.push({ id: `c${i}`, source: 'flashcard', topic: c.topic, card: c })); break; }
    case 'word_search': { const ws = shuffled(P.terms.filter((t) => /^[A-Za-z]{3,10}$/.test(t.term.trim())), rnd).slice(0, 8);
      if (ws.length >= 3) { const { grid, placed } = buildWordSearch(ws.map((t) => t.term.trim().toUpperCase()), rnd);
        placed.forEach((p, i) => items.push({ id: `w${i}`, source: 'terms', topic: ws.find((t) => t.term.trim().toUpperCase() === p.word)!.topic, word: p.word, start: p.start, end: p.end, clue: ws.find((t) => t.term.trim().toUpperCase() === p.word)!.definition }));
        if (items.length) items[0].grid = grid; } break; }
    case 'classification': { const groups: any[] = [];
      for (const { s, l } of [...P.sec('J'), ...P.sec('F')]) { const maps = s.key === 'J' ? [s.data?.conceptMap] : (s.data?.diagrams ?? []).map((d: any) => d.spec);
        for (const m of maps) if (m?.children?.length >= 2 && m.children.filter((c: any) => c.children?.length).length >= 2) groups.push({ m, topic: l.topic }); }
      for (const { m, topic: t } of shuffled(groups, rnd).slice(0, 3)) { const cats = m.children.filter((c: any) => c.children?.length).slice(0, 4).map((c: any) => c.label);
        const its = shuffled(m.children.filter((c: any) => cats.includes(c.label)).flatMap((c: any) => c.children.slice(0, 4).map((x: string) => ({ text: x, cat: c.label }))), rnd);
        items.push({ id: `k:${normalize(m.root).slice(0, 30)}`, source: 'lesson', topic: t, title: `Sort: ${m.root}`, categories: cats, things: its }); } break; }
    default: throw badRequest('Unknown game');
  }
  return items;
}
/** Client view: never includes answer keys. */
export function presentItem(game: string, it: any) {
  if (it.q) return { ...presentQuestion({ ...it.q, _id: it.id }, it.perm), id: it.id, topic: it.topic };
  if (game === 'flashcards') return { id: it.id, topic: it.topic, front: it.card.front };
  if (game === 'word_search') return { id: it.id, topic: it.topic, clue: it.clue, length: it.word.length, ...(it.grid ? { grid: it.grid } : {}) };
  if (game === 'classification') return { id: it.id, topic: it.topic, title: it.title, categories: it.categories, things: it.things.map((x: any) => x.text) };
  return { id: it.id };
}
export const itemMax = (game: string, points = ITEM_POINTS) => (game === 'flashcards' ? Math.max(1, Math.round(points / 2)) : points);
export function checkItem(game: string, it: any, answer: any, points = ITEM_POINTS): { score: number; max: number; correct: boolean; feedback: string; reveal?: any; parts?: any } {
  const ITEM_POINTS = points;
  if (it.q) { const m = markResponse(it.q, answer, it.perm); const max = ITEM_POINTS; const sc = Math.round((max * m.score) / (m.maxScore || 1));
    return { score: sc, max, correct: m.correct, feedback: [m.feedback, m.explanation].filter(Boolean).join(' '), reveal: m.correctAnswer, parts: m.parts }; }
  if (game === 'flashcards') { const knew = !!answer?.knew; const fm = itemMax(game, points); return { score: knew ? fm : Math.round(fm * 0.4), max: fm, correct: knew, feedback: knew ? 'Nice recall.' : 'This card will come back: say the answer aloud before flipping next time.', reveal: it.card.back }; }
  if (game === 'word_search') { const same = (a: any, b: any) => Array.isArray(a) && a[0] === b[0] && a[1] === b[1];
    const okWord = textMatches(answer?.word, [it.word], false); const okPos = answer?.start ? (same(answer.start, it.start) && same(answer.end, it.end)) || (same(answer.start, it.end) && same(answer.end, it.start)) : true;
    const ok = okWord && okPos; return { score: ok ? ITEM_POINTS : 0, max: ITEM_POINTS, correct: ok, feedback: ok ? `Found ${it.word}: ${it.clue}` : okWord ? 'Right word, but that is not where it is in the grid.' : 'Not this one: read the clue again.', reveal: ok ? { start: it.start, end: it.end } : undefined }; }
  if (game === 'classification') { const a = answer && typeof answer === 'object' ? answer : {}; const res = it.things.map((x: any) => a[x.text] === x.cat);
    const n = res.filter(Boolean).length; return { score: Math.round((ITEM_POINTS * n) / it.things.length), max: ITEM_POINTS, correct: n === it.things.length, feedback: `${n}/${it.things.length} sorted correctly.`, reveal: Object.fromEntries(it.things.map((x: any) => [x.text, x.cat])), parts: res }; }
  return { score: 0, max: ITEM_POINTS, correct: false, feedback: '' };
}
export function hintFor(game: string, it: any) {
  if (it.hint) return it.hint;
  const q = it.q; const d = q?.data ?? {};
  if (q?.type === 'mcq') { const wrong = (it.perm?.options ?? d.options.map((_: any, i: number) => i)).map((c: number, p: number) => ({ c, p })).filter((x: any) => x.c !== d.correctIndex); return { eliminate: wrong[0]?.p, text: `Option ${String.fromCharCode(65 + wrong[0]?.p)} is not correct.` }; }
  if (q?.type === 'true_false') return 'Check every part of the statement: if any part is wrong, the whole statement is false.';
  if (q?.type === 'short_answer') { const a = String(d.acceptedAnswers?.[0] ?? d.keywords?.[0] ?? ''); return `Starts with "${a[0] ?? '?'}" (${a.length} characters).`; }
  if (q?.type === 'gap_fill') return `First blank starts with "${String(d.gaps?.[0]?.accepted?.[0] ?? '?')[0]}".`;
  if (q?.type === 'ordering') return `The first step is "${d.items[0]}".`;
  if (q?.type === 'matching') return `"${d.pairs[0].left}" matches "${d.pairs[0].right}".`;
  if (q?.type === 'diagram_labelling') return `Label 1 starts with "${String(d.labels[0].accepted[0])[0]}".`;
  if (q?.type === 'numerical') return d.workedSolution ? `First step: ${String(d.workedSolution).split(/[.\n]/)[0]}` : 'Write down the formula and the values you know, with units.';
  if (q) return 'Re-read the scenario and pick out the key facts first.';
  if (game === 'word_search') return `Starts with ${it.word[0]} (row ${it.start[0] + 1}).`;
  if (game === 'classification') return `"${it.things[0].text}" belongs in "${it.things[0].cat}".`;
  if (game === 'flashcards') return `Starts with "${String(it.card.back)[0]}".`;
  return 'No hint available.';
}
/** Start a game: a free-play game built from all approved content of a subject, or a published game design (§14). */
export async function startGame(o: { userId: string; subjectId?: string; game?: string; topic?: string; designId?: string }) {
  const seed = Math.floor(Math.random() * 2 ** 31); const audience = await studentAudience(String(o.userId));
  if (o.designId) {
    const d = await GameDesign.findOne({ _id: o.designId, status: 'published', ...audience }).lean(); if (!d) throw notFound('Game not found');
    const items = await designItems(d, seed); if (!items.length) throw new AppError(422, 'NO_CONTENT', 'This game has no playable items right now.');
    const st = d.settings ?? ({} as any); const tl = st.timeLimitSec ?? GAME_INFO[d.type].timeLimitSec;
    return GameSession.create({ userId: o.userId, subjectId: d.subjectId, game: d.type, topic: d.topic, objective: d.objective, designId: d._id, designVersion: d.version, title: d.title, seed, items, answers: [],
      settings: { pointsPerItem: st.pointsPerItem ?? ITEM_POINTS, hintsEnabled: st.hintsEnabled !== false, hintCost: st.hintCost ?? HINT_COST, streakBonus: st.streakBonus ?? 2 },
      maxScore: items.length * itemMax(d.type, st.pointsPerItem ?? ITEM_POINTS), deadline: tl ? new Date(Date.now() + tl * 1000 + 3000) : undefined });
  }
  const items = await buildGame(o.game!, o.subjectId!, o.topic, seed, audience);
  if (!items.length) throw new AppError(422, 'NO_CONTENT', 'Not enough approved content for this game yet. Try another game or topic.');
  const tl = GAME_INFO[o.game!].timeLimitSec;
  return GameSession.create({ ...o, game: o.game as any, seed, items, answers: [], maxScore: items.reduce((t) => t + itemMax(o.game!), 0), deadline: tl ? new Date(Date.now() + tl * 1000 + 3000) : undefined,
    objective: items.find((i) => i.objective)?.objective });
}
const pts = (s: any) => s.settings?.pointsPerItem ?? ITEM_POINTS;
export async function answerItem(s: any, itemId: string, answer: any) {
  if (s.status !== 'active') throw conflict('Game already finished');
  if (s.deadline && Date.now() > s.deadline.getTime()) throw new AppError(409, 'TIME_UP', 'Time is up');
  const it = s.items.find((x: any) => x.id === itemId); if (!it) throw notFound('Item not found');
  if (s.answers.some((a: any) => a.itemId === itemId && !a.hint && s.game !== 'flashcards')) throw conflict('Already answered: replay the game to try again');
  const r = checkItem(s.game, it, answer, pts(s)); const hinted = s.answers.some((a: any) => a.itemId === itemId && a.hint);
  const score = Math.max(0, r.score - (hinted && r.score ? s.settings?.hintCost ?? HINT_COST : 0));
  const streak = (() => { let n = 0; for (let i = s.answers.length - 1; i >= 0 && s.answers[i].correct; i--) n++; return n; })();
  const bonus = s.game === 'quiz_challenge' && r.correct && streak >= 2 ? s.settings?.streakBonus ?? 2 : 0;
  s.answers.push({ itemId, correct: r.correct, score: score + bonus, at: new Date() }); s.score += score + bonus; s.markModified('answers'); await s.save();
  return { ...r, score: score + bonus, bonus, total: s.score };
}
export async function hint(s: any, itemId: string) {
  if (s.status !== 'active') throw conflict('Game already finished'); const it = s.items.find((x: any) => x.id === itemId); if (!it) throw notFound('Item not found');
  if (s.settings?.hintsEnabled === false) throw new AppError(409, 'HINTS_OFF', 'Hints are turned off for this game');
  if (!s.answers.some((a: any) => a.itemId === itemId && a.hint)) { s.answers.push({ itemId, hint: true, at: new Date() }); s.hintsUsed += 1; s.markModified('answers'); await s.save(); }
  return { hint: hintFor(s.game, it), cost: s.settings?.hintCost ?? HINT_COST };
}

// ===================== Authored game designs (§14) =====================
/** What each game type is built from, and how many items it needs. Content-based types carry reviewed content in the design itself. */
export const GAME_RULES: Record<string, { questionTypes: string[]; content?: 'pairs' | 'cards' | 'terms' | 'sequences' | 'diagrams' | 'groups'; min: number; max: number; help: string }> = {
  quiz_challenge: { questionTypes: ['mcq', 'true_false'], min: 3, max: 20, help: '3 to 20 approved multiple-choice or true/false questions.' },
  timed_revision: { questionTypes: ['mcq', 'true_false', 'short_answer', 'numerical', 'gap_fill'], min: 5, max: 40, help: '5 to 40 approved quick questions; default time limit 2 minutes.' },
  gap_fill: { questionTypes: ['gap_fill'], min: 2, max: 15, help: '2 to 15 approved gap-fill questions.' },
  scenario: { questionTypes: ['case_study', 'structured'], min: 1, max: 5, help: '1 to 5 approved case studies; only their auto-marked parts are played (written parts are left to teachers).' },
  ordering: { questionTypes: ['ordering'], content: 'sequences', min: 1, max: 8, help: 'Approved ordering questions and/or sequences of 3 to 8 steps.' },
  label_diagram: { questionTypes: ['diagram_labelling'], content: 'diagrams', min: 1, max: 6, help: 'Approved labelling questions and/or diagrams (a centre and 2 to 8 labels).' },
  match_terms: { questionTypes: ['matching'], content: 'pairs', min: 1, max: 4, help: 'One round of 3 to 8 term/definition pairs, and/or approved matching questions.' },
  flashcards: { questionTypes: [], content: 'cards', min: 3, max: 30, help: '3 to 30 cards (front and back).' },
  word_search: { questionTypes: [], content: 'terms', min: 3, max: 10, help: '3 to 10 single-word terms of 3 to 10 letters, each with a clue.' },
  classification: { questionTypes: [], content: 'groups', min: 1, max: 4, help: '1 to 4 sorting rounds, each with 2 to 4 categories and 2 or more items per category.' },
};
const scenarioQ = (q: any) => ({ ...q, data: { ...(q.data ?? {}), parts: (q.data?.parts ?? []).filter((p: any) => p.type !== 'essay') } });
/** Deterministic items of a design for a seed. Questions are loaded live, so archived or changed questions are noticed. */
export async function designItems(d: any, seed: number, questions?: any[]) {
  const rnd = prng(seed); const c = d.content ?? {}; const items: any[] = [];
  const qs = questions ?? (await Question.find({ _id: { $in: d.questionIds ?? [] } }).lean());
  const byId = new Map(qs.map((q: any) => [String(q._id), q]));
  for (const id of d.questionIds ?? []) { const q = byId.get(String(id)); if (!q) continue; items.push(qItem(d.type === 'scenario' ? scenarioQ(q) : q, rnd)); }
  const extra = (x: any, i: number) => ({ id: `d${i}`, source: 'design', topic: d.topic, objective: d.objective, hint: x.hint || undefined });
  switch (d.type) {
    case 'ordering': (c.sequences ?? []).forEach((x: any, i: number) => { const q = { type: 'ordering', stem: x.title ? `Put in order: ${x.title}` : 'Put these steps in order', topic: d.topic, marks: 1, data: { items: x.steps ?? [] } }; items.push({ ...extra(x, i), q, perm: makePerm(q, rnd) }); }); break;
    case 'label_diagram': (c.diagrams ?? []).forEach((x: any, i: number) => { const q = { type: 'diagram_labelling', stem: `Label: ${x.title ?? x.centre}`, topic: d.topic, marks: 1, data: { centre: x.centre, title: x.title, labels: (x.labels ?? []).map((l: any) => ({ accepted: Array.isArray(l) ? l : [l] })), alt: x.alt } };
      items.push({ ...extra(x, i), q, perm: {} }); }); break;
    case 'match_terms': if ((c.pairs ?? []).length) { const q = { type: 'matching', stem: 'Match each term to its definition', topic: d.topic, marks: c.pairs.length, data: { pairs: c.pairs.map((p: any) => ({ left: p.term, right: p.definition })) } };
      items.push({ ...extra({}, 0), id: 'match', q, perm: makePerm(q, rnd) }); } break;
    case 'flashcards': shuffled((c.cards ?? []).map((x: any, i: number) => ({ x, i })), rnd).forEach(({ x, i }: any) => items.push({ ...extra(x, i), id: `c${i}`, card: { front: x.front, back: x.back } })); break;
    case 'word_search': { const ts = (c.terms ?? []).map((t: any) => ({ ...t, w: String(t.term ?? '').trim().toUpperCase() }));
      const { grid, placed } = buildWordSearch(ts.map((t: any) => t.w), rnd);
      placed.forEach((p) => { const t = ts.find((x: any) => x.w === p.word); const i = ts.indexOf(t); items.push({ ...extra(t, i), id: `w${i}`, word: p.word, start: p.start, end: p.end, clue: t.clue }); });
      if (items.length) items[0].grid = grid; break; }
    case 'classification': (c.groups ?? []).forEach((g: any, i: number) => items.push({ ...extra(g, i), id: `k${i}`, title: g.title ? `Sort: ${g.title}` : 'Sort these items', categories: (g.categories ?? []).map((x: any) => x.name),
      things: shuffled((g.categories ?? []).flatMap((x: any) => (x.items ?? []).map((t: string) => ({ text: t, cat: x.name }))), rnd) })); break;
  }
  return items;
}
/** The answer a learner would give to score full marks on an item (for the dry run). */
export function solveItem(game: string, it: any) {
  if (it.q) return solveResponse(it.q, it.perm);
  if (game === 'flashcards') return { knew: true };
  if (game === 'word_search') return { word: it.word, start: it.start, end: it.end };
  if (game === 'classification') return Object.fromEntries(it.things.map((x: any) => [x.text, x.cat]));
  return null;
}
const wrongAnswer = (game: string, it: any) => (it.q ? (it.q.type === 'true_false' ? !it.q.data?.answer : it.q.type === 'numerical' ? { value: Number(it.q.data?.value ?? 0) * 7 + 913, unit: 'zz' } : null)
  : game === 'word_search' ? { word: 'ZZZQ' } : game === 'classification' ? {} : null);
const dupes = (xs: string[]) => xs.map((x) => normalize(String(x ?? ''))).filter((x, i, a) => x && a.indexOf(x) !== i);

export interface GameValidation { ok: boolean; errors: string[]; warnings: string[]; unverified: string[]; itemCount: number; checkedAt: Date; dryRun: { seeds: number[]; items: number; passed: number } }
/**
 * Publish gate for a game design. `errors` = broken links, structure or interactions (a dry run plays every item twice with the correct
 * answer, which must score full marks, and once with nothing, which must not; hints must work when enabled). `unverified` = answers no
 * reviewer has verified (unapproved or unverified questions, or design content changed since a reviewer verified it).
 */
export async function validateGame(d: any): Promise<GameValidation> {
  const errors: string[] = [], warnings: string[] = [], unverified: string[] = []; const rule = GAME_RULES[d.type]; const c = d.content ?? {};
  if (!rule) return { ok: false, errors: ['Unknown game type'], warnings, unverified, itemCount: 0, checkedAt: new Date(), dryRun: { seeds: [], items: 0, passed: 0 } };
  if (!d.subjectId) errors.push('Link the game to a subject.'); if (!String(d.topic ?? '').trim()) errors.push('Link the game to a topic.'); if (!String(d.objective ?? '').trim()) errors.push('Link the game to a learning objective.');
  const qs = await Question.find({ _id: { $in: d.questionIds ?? [] } }).lean(); const byId = new Map(qs.map((q: any) => [String(q._id), q]));
  if (new Set((d.questionIds ?? []).map(String)).size !== (d.questionIds ?? []).length) errors.push('The same question is included twice.');
  (d.questionIds ?? []).forEach((id: any, i: number) => { const q: any = byId.get(String(id)); const n = `Question ${i + 1}`;
    if (!q) return errors.push(`${n} no longer exists.`);
    if (String(q.subjectId) !== String(d.subjectId)) errors.push(`${n} belongs to a different subject.`);
    if (!rule.questionTypes.includes(q.type)) errors.push(`${n} is a ${q.type.replace(/_/g, ' ')} question, which ${GAME_INFO[d.type].name} cannot play.`);
    if (q.status !== 'published') unverified.push(`${n} ("${String(q.stem).slice(0, 60)}") is not approved (${q.status.replace(/_/g, ' ')}).`);
    else if (!q.keyVerifiedAt || q.keyVerifiedVersion !== (q.version ?? 1)) unverified.push(`${n} ("${String(q.stem).slice(0, 60)}") has no reviewer-verified answer key for its current version.`);
    if (d.type === 'scenario' && !(q.data?.parts ?? []).some((p: any) => p.type !== 'essay')) errors.push(`${n} has only written parts; the game needs auto-marked parts.`);
    const v = validateQuestion(q); if (v.errors.length) errors.push(`${n}: ${v.errors[0]}`); });
  const list = rule.content ? (c[rule.content] ?? []) : []; if (!Array.isArray(list)) errors.push(`Content "${rule.content}" must be a list.`);
  const n = (d.questionIds ?? []).length + (Array.isArray(list) ? list.length : 0);
  if (n < rule.min) errors.push(`${GAME_INFO[d.type].name} needs at least ${rule.min} ${rule.content && !rule.questionTypes.length ? rule.content : 'items'} (has ${n}). ${rule.help}`);
  if (n > rule.max) errors.push(`${GAME_INFO[d.type].name} allows at most ${rule.max} items (has ${n}).`);
  if (Array.isArray(list)) switch (rule.content) {
    case 'pairs': if (list.length && (list.length < 3 || list.length > 8)) errors.push('Matching needs 3 to 8 pairs.');
      list.forEach((p: any, i: number) => { if (!String(p.term ?? '').trim() || !String(p.definition ?? '').trim()) errors.push(`Pair ${i + 1} needs a term and a definition.`); });
      if (dupes(list.map((p: any) => p.term)).length || dupes(list.map((p: any) => p.definition)).length) errors.push('Two pairs share a term or definition, so the matching would be ambiguous.'); break;
    case 'cards': list.forEach((x: any, i: number) => { if (!String(x.front ?? '').trim() || !String(x.back ?? '').trim()) errors.push(`Card ${i + 1} needs a front and a back.`); });
      if (dupes(list.map((x: any) => x.front)).length) errors.push('Two cards have the same front.'); break;
    case 'terms': list.forEach((x: any, i: number) => { const t = String(x.term ?? '').trim(); if (!/^[A-Za-z]{3,10}$/.test(t)) errors.push(`Term ${i + 1} ("${t}") must be one word of 3 to 10 letters (A to Z) to fit the grid.`);
        if (!String(x.clue ?? '').trim()) errors.push(`Term ${i + 1} needs a clue.`); else if (t && normalize(x.clue).includes(normalize(t))) warnings.push(`The clue for "${t}" gives the word away.`); });
      if (dupes(list.map((x: any) => x.term)).length) errors.push('A term is listed twice.'); break;
    case 'sequences': list.forEach((x: any, i: number) => { const st = x.steps ?? []; if (!Array.isArray(st) || st.length < 3 || st.length > 8) errors.push(`Sequence ${i + 1} needs 3 to 8 steps.`);
        else if (dupes(st).length) errors.push(`Sequence ${i + 1} repeats a step, so more than one order would be correct.`); }); break;
    case 'diagrams': list.forEach((x: any, i: number) => { if (!String(x.centre ?? '').trim()) errors.push(`Diagram ${i + 1} needs a centre (the thing being labelled).`);
        const ls = x.labels ?? []; if (!Array.isArray(ls) || ls.length < 2 || ls.length > 8) errors.push(`Diagram ${i + 1} needs 2 to 8 labels.`);
        else if (dupes(ls.map((l: any) => (Array.isArray(l) ? l[0] : l))).length) errors.push(`Diagram ${i + 1} repeats a label.`); }); break;
    case 'groups': list.forEach((g: any, i: number) => { const cats = g.categories ?? []; if (!Array.isArray(cats) || cats.length < 2 || cats.length > 4) return errors.push(`Round ${i + 1} needs 2 to 4 categories.`);
        cats.forEach((x: any) => { if (!String(x.name ?? '').trim()) errors.push(`Round ${i + 1}: every category needs a name.`); if (!Array.isArray(x.items) || x.items.length < 2) errors.push(`Round ${i + 1}: category "${x.name ?? ''}" needs at least 2 items.`); });
        if (dupes(cats.map((x: any) => x.name)).length) errors.push(`Round ${i + 1} repeats a category.`);
        if (dupes(cats.flatMap((x: any) => x.items ?? [])).length) errors.push(`Round ${i + 1}: an item appears in more than one place, so it cannot be sorted unambiguously.`); }); break;
  }
  const st = d.settings ?? {}; const points = st.pointsPerItem ?? ITEM_POINTS;
  if (st.hintsEnabled !== false && (st.hintCost ?? HINT_COST) >= points) errors.push('The hint cost must be lower than the points per item.');
  // Dry run: every item must accept its correct answer (full marks), reject an empty/wrong answer, present without leaking answers, and give a hint.
  const seeds = [1, 7919]; let items = 0, passed = 0; const broken = new Set<string>();
  if (!errors.length) for (const seed of seeds) {
    let built: any[] = []; try { built = await designItems(d, seed, qs); } catch (e: any) { errors.push(`The game could not be built: ${e.message}`); break; }
    const expected = d.type === 'word_search' ? (list as any[]).length : d.type === 'match_terms' ? (d.questionIds ?? []).length + ((list as any[]).length ? 1 : 0) : n;
    if (built.length !== expected) { errors.push(d.type === 'word_search' ? `Only ${built.length} of ${expected} words fit in the 12 × 12 grid; use shorter or fewer words.` : `Only ${built.length} of ${expected} items could be built.`); break; }
    for (const it of built) { items++; const label = it.q ? `"${String(it.q.stem ?? '').slice(0, 50)}"` : it.card ? `card "${it.card.front}"` : it.word ? `word ${it.word}` : `"${it.title}"`;
      try { const view = JSON.stringify(presentItem(d.type, it)); const sol = solveItem(d.type, it); const r = checkItem(d.type, it, sol, points);
        if (!r.correct || r.score !== r.max) { broken.add(`Item ${label}: the correct answer is not accepted, so the interaction is broken.`); continue; }
        const w = checkItem(d.type, it, wrongAnswer(d.type, it), points); if (d.type !== 'flashcards' && w.correct) { broken.add(`Item ${label}: a wrong or empty answer is marked correct.`); continue; }
        if (it.q && it.q.type === 'mcq' && view.includes('correctIndex')) { broken.add(`Item ${label}: the answer key would be shown to learners.`); continue; }
        if (st.hintsEnabled !== false) { const h = hintFor(d.type, it); const ht = typeof h === 'string' ? h : h?.text; if (!ht || ht === 'No hint available.') { broken.add(`Item ${label}: no hint is available but hints are on.`); continue; } }
        passed++; } catch (e: any) { broken.add(`Item ${label}: ${e.message}`); } }
  }
  errors.push(...broken);
  if (rule.content && (list as any[]).length && !(d.answersVerifiedVersion && d.answersVerifiedVersion === d.version)) unverified.push('The answers in this game\'s own content have not been verified by a reviewer for this version.');
  if (d.settings?.timeLimitSec && d.settings.timeLimitSec < 10 * Math.max(1, n)) warnings.push('The time limit allows less than 10 seconds per item.');
  return { ok: !errors.length, errors, warnings, unverified, itemCount: n, checkedAt: new Date(), dryRun: { seeds, items, passed } };
}
/** XP = score/10 for a first play; replays only earn the improvement over your best score for this game/topic. Fewer than 3 answers earns nothing. */
export async function finishGame(s: any, schoolId?: string) {
  if (s.status === 'finished') return s;
  const answered = s.answers.filter((a: any) => !a.hint); const correct = answered.filter((a: any) => a.correct).length;
  s.status = 'finished'; s.finishedAt = new Date(); s.accuracy = answered.length ? Math.round((100 * correct) / answered.length) : 0;
  const best = await GameSession.findOne({ userId: s.userId, subjectId: s.subjectId, game: s.game, topic: s.topic ?? null, designId: s.designId ?? null, status: 'finished', _id: { $ne: s._id } }).sort({ score: -1 }).lean();
  const qualifies = answered.length >= 3;
  const xp = !qualifies ? 0 : best ? Math.max(0, Math.round((s.score - (best.score ?? 0)) / 10)) : Math.round(s.score / 10);
  const r = await awardXp({ userId: String(s.userId), schoolId, subjectId: String(s.subjectId), source: 'game', refId: String(s._id), xp: Math.min(xp, 30), reason: `${s.title ?? GAME_INFO[s.game].name}: ${correct}/${answered.length}`, qualifies });
  s.xpAwarded = r.xp; await s.save();
  for (const a of answered) { const it = s.items.find((x: any) => x.id === a.itemId); if ((it?.questionId || it?.source === 'design') && s.game !== 'flashcards') await updateMastery(String(s.userId), String(s.subjectId), it.topic, a.correct ? 1 : 0); }
  const kinds = await GameSession.distinct('game', { userId: s.userId, status: 'finished' });
  const nb = kinds.length >= 5 ? await grantBadges(String(s.userId), ['game_explorer']) : [];
  s.$locals.reward = { xp: r.xp, newBadges: [...r.newBadges, ...nb], replay: !!best, previousBest: best?.score };
  return s;
}
export const sessionView = (s: any) => ({ _id: s._id, game: s.game, info: GAME_INFO[s.game], designId: s.designId, title: s.title, hintsEnabled: s.settings?.hintsEnabled !== false, hintCost: s.settings?.hintCost ?? HINT_COST, subjectId: s.subjectId, topic: s.topic, objective: s.objective, status: s.status, deadline: s.deadline,
  score: s.score, maxScore: s.maxScore, accuracy: s.accuracy, hintsUsed: s.hintsUsed, xpAwarded: s.xpAwarded, reward: s.$locals?.reward,
  answered: s.answers.filter((a: any) => !a.hint).map((a: any) => ({ itemId: a.itemId, correct: a.correct, score: a.score })), items: s.items.map((it: any) => presentItem(s.game, it)) });
export { renderDiagram };
