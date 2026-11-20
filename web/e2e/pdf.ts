/** Tiny hand-built PDFs for browser tests: text pages, and image-only pages that stand in for scans. */
export function buildPdf(pages: ({ lines: string[] } | { image: true })[]): Buffer {
  const objs: (string | Buffer)[] = []; const add = (o: string | Buffer) => (objs.push(o), objs.length);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); const kids: number[] = [];
  for (const p of pages) {
    let content: string; let res = `/Font << /F1 ${font} 0 R >>`;
    if ('lines' in p) content = 'BT /F1 11 Tf 50 780 Td 14 TL\n' + p.lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) Tj T*`).join('\n') + '\nET';
    else { const px = Buffer.alloc(64 * 64, 0x80); const img = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${px.length} >>\nstream\n`), px, Buffer.from('\nendstream')]));
      res += ` /XObject << /Im1 ${img} 0 R >>`; content = 'q 595 0 0 842 0 0 cm /Im1 Do Q'; }
    const c = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent PARENT 0 R /MediaBox [0 0 595 842] /Resources << ${res} >> /Contents ${c} 0 R >>`));
  }
  const pagesId = add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`); const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')]; const offsets: number[] = []; let len = parts[0].length;
  objs.forEach((o, i) => { const body = typeof o === 'string' ? Buffer.from(o.replace('PARENT', String(pagesId))) : o; const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]); offsets.push(len); parts.push(b); len += b.length; });
  parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${len}\n%%EOF\n`));
  return Buffer.concat(parts);
}
export const manualPdf = (tag: string) => buildPdf([{ lines: [`SAMPLE E2E MANUAL ${tag}`, 'STRAND 1: Forces and Motion', 'SUB-STRAND 1: Speed', ...Array.from({ length: 25 }, (_, i) => `Speed is distance travelled per unit time; example ${i} for ${tag}.`)] },
  { lines: ['SUB-STRAND 2: Energy', ...Array.from({ length: 20 }, (_, i) => `Energy is the capacity to do work, line ${i} of ${tag}.`)] }]);
