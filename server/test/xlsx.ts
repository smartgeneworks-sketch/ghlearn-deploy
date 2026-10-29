import yauzl from 'yauzl';
/** Reads an .xlsx produced by the exporter with a real zip reader; returns the sheet XML and all cell texts. */
export function readXlsx(buf: Buffer): Promise<{ files: string[]; sheet: string; texts: string[] }> {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buf, { lazyEntries: true }, (e, zf) => {
    if (e || !zf) return reject(e); const files: string[] = []; let sheet = '';
    zf.on('entry', (en) => { files.push(en.fileName); zf.openReadStream(en, (er, st) => { if (er || !st) return reject(er); const ch: Buffer[] = []; st.on('data', (c) => ch.push(c)); st.on('end', () => { if (en.fileName === 'xl/worksheets/sheet1.xml') sheet = Buffer.concat(ch).toString('utf8'); zf.readEntry(); }); }); });
    zf.on('end', () => resolve({ files, sheet, texts: [...sheet.matchAll(/<t[^>]*>([^<]*)<\/t>|<v>([^<]*)<\/v>/g)].map((m) => m[1] ?? m[2]) })); zf.readEntry();
  }));
}
export const binary = (res: any, cb: any) => { const ch: Buffer[] = []; res.on('data', (c: Buffer) => ch.push(c)); res.on('end', () => cb(null, Buffer.concat(ch))); };
