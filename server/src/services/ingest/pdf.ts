import { createCanvas, Path2D as NPath2D, ImageData as NImageData, DOMMatrix as NDOMMatrix } from '@napi-rs/canvas';
const g = globalThis as any; g.Path2D ??= NPath2D; g.ImageData ??= NImageData; g.DOMMatrix ??= NDOMMatrix;
class CanvasFactory {
  create(w: number, h: number) { const canvas = createCanvas(Math.max(1, w), Math.max(1, h)); return { canvas, context: canvas.getContext('2d') }; }
  reset(cc: any, w: number, h: number) { cc.canvas.width = w; cc.canvas.height = h; }
  destroy(cc: any) { cc.canvas.width = 0; cc.canvas.height = 0; }
}
export const isPdf = (buf: Buffer) => buf.subarray(0, 1024).includes(Buffer.from('%PDF-'));
export interface ExtractedPage { page: number; text: string; method: 'text' | 'ocr' | 'empty' | 'ocr_unavailable'; ocrConfidence?: number; figures?: number }
export async function openPdf(buf: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, verbosity: 0, CanvasFactory } as any).promise;
}
/** Rebuild reading-order lines from positioned text items (y desc, then x). */
export function itemsToText(items: { str: string; transform: number[]; hasEOL?: boolean }[]) {
  const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = it.transform[5], x = it.transform[4];
    let row = rows.find((r) => Math.abs(r.y - y) < 3); if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim()).join('\n');
}
export async function renderPagePng(page: any, scale = 2.5): Promise<Buffer> {
  const vp = page.getViewport({ scale }); const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height)); const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx as any, viewport: vp }).promise;
  return c.toBuffer('image/png');
}
/** Number of images drawn on a page (figures, photos, scans). Counted from the operator list; nothing is extracted. */
export async function countFigures(page: any): Promise<number> {
  const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const img = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObjectGroup].filter((x) => x != null));
  try { const ops = await page.getOperatorList(); return ops.fnArray.reduce((n: number, f: number) => n + (img.has(f) ? 1 : 0), 0); } catch { return 0; }
}
