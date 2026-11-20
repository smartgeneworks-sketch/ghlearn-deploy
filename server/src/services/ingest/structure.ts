/**
 * Heuristic curriculum-structure detection. Only explicitly labelled headings (STRAND, SUB-STRAND, SECTION,
 * CONTENT STANDARD, LEARNING INDICATOR) or official-looking indicator codes are recorded, and ALL results are
 * verified=false until a curriculum editor confirms them.
 */
export type NodeType = 'section' | 'strand' | 'subStrand' | 'contentStandard' | 'indicator';
export interface DetectedNode { type: NodeType; code?: string; title: string; page: number; rule: string; confidence: 'explicit_label' | 'pattern'; line: string }
const RANK: Record<NodeType, number> = { section: 0, strand: 0, subStrand: 1, contentStandard: 2, indicator: 3 };
const RULES: { type: NodeType; re: RegExp; rule: string; confidence: DetectedNode['confidence'] }[] = [
  { type: 'subStrand', re: /^\s*SUB[-\s]?STRAND\s*(\d+(?:\.\d+)*)?\s*[:.\-–]\s*(.{3,160})$/i, rule: 'label:sub-strand', confidence: 'explicit_label' },
  { type: 'strand', re: /^\s*STRAND\s*(\d+(?:\.\d+)*)?\s*[:.\-–]\s*(.{3,160})$/i, rule: 'label:strand', confidence: 'explicit_label' },
  { type: 'section', re: /^\s*SECTION\s+(\d{1,2})\s*[:.\-–]?\s+([A-Z][^\n]{3,160})$/i, rule: 'label:section', confidence: 'explicit_label' },
  { type: 'contentStandard', re: /^\s*CONTENT\s+STANDARDS?\s*(\S*\d\S*)?\s*[:.\-–]\s*(.{5,200})$/i, rule: 'label:content-standard', confidence: 'explicit_label' },
  { type: 'indicator', re: /^\s*LEARNING\s+INDICATORS?\s*(\S*\d\S*)?\s*[:.\-–]\s*(.{5,200})$/i, rule: 'label:learning-indicator', confidence: 'explicit_label' },
  // Ghana basic/JHS indicator codes e.g. B7.1.2.1.1 ; SHS-style e.g. 1.1.1.LI.1 (pattern only)
  { type: 'indicator', re: /^\s*((?:B\d{1,2}|JHS\d)\.\d+\.\d+\.\d+\.\d+)\s*[:.\-–]?\s+(.{5,200})$/, rule: 'pattern:basic-indicator-code', confidence: 'pattern' },
];
export function detectStructure(pages: { page: number; text: string }[]): DetectedNode[] {
  const seen = new Set<string>(); const out: DetectedNode[] = [];
  for (const p of pages) for (const line of p.text.split('\n')) {
    for (const r of RULES) {
      const m = line.match(r.re); if (!m) continue;
      const title = m[2].trim().replace(/\s+/g, ' ');
      const key = `${r.type}|${(m[1] ?? '').toLowerCase()}|${title.toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); out.push({ type: r.type, code: m[1] || undefined, title, page: p.page, rule: r.rule, confidence: r.confidence, line: line.slice(0, 300) }); }
      break;
    }
  }
  return out;
}
/** Index of parent for each node (nearest preceding node of lower rank), or -1. */
export function parentIndexes(nodes: DetectedNode[]) {
  return nodes.map((n, i) => { for (let j = i - 1; j >= 0; j--) if (RANK[nodes[j].type] < RANK[n.type]) return j; return -1; });
}
/** Lines appearing on > 40% of pages (running headers/footers, page numbers). */
export function boilerplateLines(pages: { text: string }[]) {
  if (pages.length < 4) return new Set<string>();
  const counts = new Map<string, number>();
  for (const p of pages) for (const l of new Set(p.text.split('\n').map((x) => x.trim()).filter(Boolean))) counts.set(l, (counts.get(l) ?? 0) + 1);
  const s = new Set<string>(); for (const [l, c] of counts) if (c / pages.length > 0.4) s.add(l);
  return s;
}
