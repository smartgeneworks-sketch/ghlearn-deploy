/** Minimal hand-built PDFs for tests (text pages and image-only "scanned" pages). */
import { createCanvas } from '@napi-rs/canvas';
type Page = { lines?: string[]; jpeg?: { data: Buffer; w: number; h: number } };
export function buildPdf(pages: Page[]): Buffer {
  const objs: (string | Buffer)[] = [];
  const add = (o: string | Buffer) => (objs.push(o), objs.length);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds: number[] = []; const kids: number[] = [];
  const parentRef = 1000; // placeholder replaced below
  for (const p of pages) {
    let content = ''; let res = `/Font << /F1 ${font} 0 R >>`;
    if (p.lines) content = 'BT /F1 11 Tf 50 780 Td 14 TL\n' + p.lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) Tj T*`).join('\n') + '\nET';
    if (p.jpeg) {
      const img = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${p.jpeg.w} /Height ${p.jpeg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.data.length} >>\nstream\n`), p.jpeg.data, Buffer.from('\nendstream')]));
      res += ` /XObject << /Im1 ${img} 0 R >>`; content = `q 595 0 0 842 0 0 cm /Im1 Do Q`;
    }
    const c = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    const pg = add(`<< /Type /Page /Parent PARENT 0 R /MediaBox [0 0 595 842] /Resources << ${res} >> /Contents ${c} 0 R >>`);
    pageIds.push(pg); kids.push(pg);
  }
  const pagesId = add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  void parentRef;
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')]; const offsets: number[] = [];
  let len = parts[0].length;
  objs.forEach((o, i) => {
    const body = typeof o === 'string' ? Buffer.from(o.replace('PARENT', String(pagesId))) : o;
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    offsets.push(len); parts.push(b); len += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}
export function scannedPage(lines: string[]) {
  const w = 1240, h = 1754; const c = createCanvas(w, h); const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#000'; ctx.font = '48px sans-serif';
  lines.forEach((l, i) => ctx.fillText(l, 100, 200 + i * 90));
  return { jpeg: { data: c.toBuffer('image/jpeg', 92), w, h } };
}
export const curriculumPdf = () => buildPdf([
  { lines: ['SAMPLE TEST CURRICULUM - NOT OFFICIAL', 'STRAND 1: Diversity of Living Things', 'SUB-STRAND 1: Cells and Cell Structure',
    'CONTENT STANDARD: Demonstrate understanding of cell structure.', 'LEARNING INDICATOR: Describe the parts of a plant cell and an animal cell.',
    ...Array.from({ length: 30 }, (_, i) => `The cell membrane controls what enters and leaves the cell, sentence number ${i} about cells and organelles.`)] },
  { lines: ['SAMPLE TEST CURRICULUM - NOT OFFICIAL', 'SUB-STRAND 2: Microscopy',
    ...Array.from({ length: 30 }, (_, i) => `A light microscope uses lenses to magnify specimens; line ${i} covers slide preparation and focusing.`)] },
  { lines: [] },
]);

// ---- DOCX fixture: a "stored" (uncompressed) zip with a hand-written CRC32 (Node 20 has no zlib.crc32) ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(b: Buffer) { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function buildZip(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = []; const central: Buffer[] = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'); const nm = Buffer.from(name); const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    locals.push(lh, nm, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
/** A minimal Word document: paragraphs per page, explicit page breaks between pages, optional drawing per page. */
export function buildDocx(pages: { paras: string[]; drawing?: boolean }[]) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = pages.map((p, i) => (i ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '') + p.paras.map((t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`).join('') +
    (p.drawing ? '<w:p><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>' : '')).join('');
  return buildZip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="x"><w:body>${body}</w:body></w:document>`,
  });
}
