/**
 * Module card art (CURRICULUM_LMS_SPEC §5): small, deterministic SVGs generated in code from the topic text.
 * No stock or external images; a motif is chosen from keywords, coloured by strand. Alt text describes the motif.
 */
const PALETTES = [['#0b6e4f', '#e8f5ee'], ['#1d4e89', '#e7eef8'], ['#8a3b12', '#fbeee6'], ['#5b2a86', '#f1e9f8'], ['#7a5c00', '#fbf4dd'], ['#0f5f6e', '#e4f4f6']];
type Motif = { id: string; alt: string; test: RegExp; draw: (c: string) => string };
const L = (x1: number, y1: number, x2: number, y2: number, c: string, w = 4) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
const MOTIFS: Motif[] = [
  { id: 'angles', alt: 'two rays meeting at a point with the angle between them marked', test: /\bangle|parallel|bearing|perpendicular|transversal/i,
    draw: (c) => `${L(90, 140, 240, 140, c)}${L(90, 140, 200, 50, c)}<path d="M140 140 A50 50 0 0 0 129 108" fill="none" stroke="${c}" stroke-width="3"/>` },
  { id: 'triangle', alt: 'a right-angled triangle with its sides labelled a, b and c', test: /triangle|pythag|trigonometr|sine|cosine|tangent|congruen|similar/i,
    draw: (c) => `<path d="M90 140 L230 140 L90 45 Z" fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round"/><path d="M90 125 h15 v15" fill="none" stroke="${c}" stroke-width="2"/><text x="70" y="98" font-size="16" fill="${c}">a</text><text x="155" y="160" font-size="16" fill="${c}">b</text><text x="168" y="85" font-size="16" fill="${c}">c</text>` },
  { id: 'vector', alt: 'arrows on a grid showing vectors and their sum', test: /vector|displacement|translation/i,
    draw: (c) => `${L(80, 140, 170, 90, c)}${L(170, 90, 240, 120, c)}${L(80, 140, 240, 120, c, 2)}<circle cx="240" cy="120" r="5" fill="${c}"/><circle cx="170" cy="90" r="5" fill="${c}"/>` },
  { id: 'circle', alt: 'a circle with its centre, radius and a chord', test: /circle|circumference|radius|arc|sector|chord|loci|locus/i,
    draw: (c) => `<circle cx="160" cy="95" r="55" fill="none" stroke="${c}" stroke-width="4"/>${L(160, 95, 215, 95, c, 3)}${L(118, 60, 200, 130, c, 2)}<circle cx="160" cy="95" r="4" fill="${c}"/>` },
  { id: 'solid', alt: 'a cuboid drawn in three dimensions', test: /volume|surface area|prism|cylinder|cone|pyramid|solid|cuboid|net/i,
    draw: (c) => `<path d="M100 70 h100 v70 h-100 Z M100 70 l30 -25 h100 l-30 25 M200 140 l30 -25 v-70" fill="none" stroke="${c}" stroke-width="4" stroke-linejoin="round"/>` },
  { id: 'area', alt: 'a rectangle divided into unit squares to show area', test: /area|perimeter|measure|length|mass|capacity|unit|scale/i,
    draw: (c) => `<rect x="95" y="50" width="130" height="90" fill="none" stroke="${c}" stroke-width="4"/>${[0, 1, 2, 3, 4].map((i) => L(95 + i * 26, 50, 95 + i * 26, 140, c, 1)).join('')}${[1, 2].map((i) => L(95, 50 + i * 30, 225, 50 + i * 30, c, 1)).join('')}` },
  { id: 'chart', alt: 'a bar chart with four bars of different heights', test: /data|statistic|graph of data|chart|histogram|mean|median|mode|frequency|survey|sampl/i,
    draw: (c) => `${L(80, 145, 240, 145, c, 3)}${[[100, 60], [135, 95], [170, 40], [205, 75]].map(([x, h]) => `<rect x="${x}" y="${145 - h}" width="24" height="${h}" fill="${c}" opacity=".85"/>`).join('')}` },
  { id: 'probability', alt: 'a die and a coin representing chance', test: /probabil|chance|outcome|event|random/i,
    draw: (c) => `<rect x="95" y="60" width="70" height="70" rx="10" fill="none" stroke="${c}" stroke-width="4"/>${[[115, 80], [145, 110], [130, 95]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="${c}"/>`).join('')}<circle cx="210" cy="95" r="32" fill="none" stroke="${c}" stroke-width="4"/><circle cx="210" cy="95" r="20" fill="none" stroke="${c}" stroke-width="2"/>` },
  { id: 'line_graph', alt: 'coordinate axes with a straight line graph', test: /function|relation|mapping|linear|gradient|slope|coordinate|graph|equation of a line|plot/i,
    draw: (c) => `${L(80, 145, 240, 145, c, 3)}${L(100, 160, 100, 35, c, 3)}${L(85, 150, 230, 50, c)}<circle cx="157" cy="110" r="5" fill="${c}"/>` },
  { id: 'sets', alt: 'two overlapping circles in a Venn diagram', test: /\bsets?\b|venn|subset|union|intersection/i,
    draw: (c) => `<rect x="70" y="35" width="180" height="120" fill="none" stroke="${c}" stroke-width="2"/><circle cx="135" cy="95" r="40" fill="${c}" fill-opacity=".2" stroke="${c}" stroke-width="3"/><circle cx="185" cy="95" r="40" fill="${c}" fill-opacity=".2" stroke="${c}" stroke-width="3"/>` },
  { id: 'ratio', alt: 'a bar split into parts to show a ratio', test: /ratio|proportion|percent|rate|fraction|share|interest|profit|discount|exchange|tax/i,
    draw: (c) => `<rect x="70" y="75" width="180" height="40" fill="none" stroke="${c}" stroke-width="3"/><rect x="70" y="75" width="72" height="40" fill="${c}" opacity=".8"/>${L(142, 75, 142, 115, c, 3)}${L(196, 75, 196, 115, c, 2)}` },
  { id: 'sequence', alt: 'a growing pattern of dots representing a sequence', test: /pattern|sequence|series|progression|term/i,
    draw: (c) => [1, 2, 3, 4].map((n, i) => Array.from({ length: n }, (_, k) => `<circle cx="${90 + i * 45}" cy="${140 - k * 22}" r="8" fill="${c}"/>`).join('')).join('') },
  { id: 'algebra', alt: 'a balance scale representing an equation', test: /express|equation|inequalit|algebra|variable|formula|solve|simplif|factor|indices|logarithm|surd|polynomial|quadratic/i,
    draw: (c) => `${L(160, 50, 160, 145, c)}${L(90, 70, 230, 70, c)}${L(120, 150, 200, 150, c)}<path d="M75 110 h50 l-25 -40 Z M195 110 h50 l-25 -40 Z" fill="none" stroke="${c}" stroke-width="3"/>` },
  { id: 'number', alt: 'a number line with marked points', test: /./,
    draw: (c) => `${L(70, 100, 250, 100, c)}${[0, 1, 2, 3, 4, 5, 6].map((i) => L(80 + i * 27, 90, 80 + i * 27, 110, c, 2)).join('')}<circle cx="161" cy="100" r="7" fill="${c}"/>` },
];
export function moduleThumbnail(o: { topic: string; subStrand?: string; strandNo?: number }) {
  const text = `${o.topic} ${o.subStrand ?? ''}`;
  const m = MOTIFS.find((x) => x.test.test(o.topic)) ?? MOTIFS.find((x) => x.test.test(text))!;
  const [fg, bg] = PALETTES[((o.strandNo ?? 1) - 1 + PALETTES.length) % PALETTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" role="img" font-family="sans-serif"><rect width="320" height="180" fill="${bg}"/>${m.draw(fg)}</svg>`;
  return { svg, motif: m.id, alt: `Illustration: ${m.alt}` };
}
