import zlib from 'node:zlib';
import type { Request, Response } from 'express';
import { toCsv } from './teach/reports.js';
import { audit } from '../lib/audit.js';
/**
 * Report exports (§16, §17, §19): CSV and Excel (.xlsx). Every export is audited (`report.export`, with the report,
 * format, filters and row count). The .xlsx writer is a minimal, dependency-free Office Open XML package: one sheet,
 * inline strings, numbers as numbers, a bold header row. Text cells are never interpreted as formulas.
 */
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files: [string, string][]): Buffer {
  const parts: Buffer[] = []; const central: Buffer[] = []; let off = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text, 'utf8'); const data = zlib.deflateRawSync(raw); const nm = Buffer.from(name); const crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const cellText = (v: unknown) => (v == null ? '' : Array.isArray(v) ? v.join('; ') : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v));
export function toXlsx(sheet: string, header: string[], rows: unknown[][], note?: string): Buffer {
  const all: { v: unknown; bold?: boolean }[][] = [...(note ? [[{ v: note }], []] : []), header.map((h) => ({ v: h, bold: true })), ...rows.map((r) => r.map((v) => ({ v })))];
  const xmlRows = all.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
    const ref = `${col(ci)}${ri + 1}`; const st = c.bold ? ' s="1"' : '';
    if (typeof c.v === 'number' && Number.isFinite(c.v)) return `<c r="${ref}"${st}><v>${c.v}</v></c>`;
    if (typeof c.v === 'boolean') return `<c r="${ref}" t="b"${st}><v>${c.v ? 1 : 0}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(cellText(c.v))}</t></is></c>`;
  }).join('')}</row>`).join('');
  const name = esc(sheet.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report');
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`],
  ]);
}
export type ExportFormat = 'csv' | 'xlsx';
/** Sends a report as CSV or Excel and writes the audit entry. `note` (e.g. "Estimated cost") is the first line of the Excel sheet. */
export function sendExport(req: Request, res: Response, o: { report: string; format: ExportFormat; header: string[]; rows: unknown[][]; filters?: unknown; note?: string; target?: string }) {
  const stamp = new Date().toISOString().slice(0, 10); const base = `${o.report.replace(/[^\w-]+/g, '-')}-${stamp}`;
  audit(req, 'report.export', o.target ?? o.report, { report: o.report, format: o.format, rows: o.rows.length, filters: o.filters }, { entityType: 'report' });
  if (o.format === 'xlsx') return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`${base}.xlsx`).send(toXlsx(o.report, o.header, o.rows, o.note));
  return res.type('text/csv').attachment(`${base}.csv`).send(toCsv(o.header, o.rows));
}
