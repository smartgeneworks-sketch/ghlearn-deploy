import type { DetectedNode } from './structure.js';
export interface ChunkDraft { ordinal: number; text: string; pageStart: number; pageEnd: number; nodeIdx: number[] }
/**
 * Paragraph-aware chunking (~target chars, with overlap), carrying page ranges and the active structure path.
 * Pure page-number lines and boilerplate are dropped.
 */
export function chunkPages(pages: { page: number; text: string }[], nodes: DetectedNode[], parents: number[], boiler: Set<string>, target = 1400, overlap = 200): ChunkDraft[] {
  const out: ChunkDraft[] = []; let buf = ''; let start = 0; let end = 0; let active = -1;
  const path = (i: number) => { const p: number[] = []; while (i >= 0) { p.unshift(i); i = parents[i]; } return p; };
  const flush = () => {
    const t = buf.trim(); if (t.length >= 40) out.push({ ordinal: out.length, text: t, pageStart: start, pageEnd: end, nodeIdx: path(active) });
    buf = t.length > overlap ? t.slice(-overlap).replace(/^\S*\s/, '') : ''; start = end;
  };
  for (const p of pages) {
    const lines = p.text.split('\n').map((l) => l.trim()).filter((l) => l && !boiler.has(l) && !/^\d{1,4}$/.test(l));
    for (const line of lines) {
      const ni = nodes.findIndex((n) => n.page === p.page && n.line.trim() === line);
      if (ni >= 0 && ni !== active) { if (buf.trim().length > overlap + 40) flush(); else buf = ''; active = ni; start = p.page; }
      if (!buf) start = p.page;
      buf += (buf ? (/[.!?:]$/.test(buf.trimEnd()) ? '\n' : ' ') : '') + line; end = p.page;
      if (buf.length >= target) flush();
    }
  }
  if (buf.trim().length >= 40) { end = pages.at(-1)?.page ?? end; flush(); }
  return out;
}
