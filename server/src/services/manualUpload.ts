/**
 * Streaming manual upload (spec §9). The multipart body is parsed with busboy and the file is piped straight into GridFS
 * while it is hashed (SHA-256) and sniffed, so a 60 MB upload never sits whole in memory (Render's 512 MB instance).
 * GridFS counts toward Atlas M0's 512 MB, so a byte quota (GRIDFS_QUOTA_MB) is enforced before and during the upload.
 */
import Busboy from 'busboy';
import crypto from 'node:crypto';
import type { Request } from 'express';
import { MANUAL_FORMATS, manualKindOf, type ManualKind } from '@ghlearn/shared';
import { config } from '../config.js';
import { getSettings } from './platformSettings.js';
import { AppError, badRequest } from '../lib/errors.js';
import { gridfs, StorageUnavailableError, type StoredObject } from './storage.js';
import { isDocx } from './ingest/textFormats.js';

export interface ReceivedManual { stored: StoredObject; sha256: string; size: number; filename: string; mimeType: string; kind: ManualKind; fields: Record<string, string> }
const MIME_FOR: Record<ManualKind, string> = { pdf: 'application/pdf', docx: MANUAL_FORMATS.docx.mimes[0], txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8' };
export const mimeFor = (k?: string | null) => MIME_FOR[(k ?? 'pdf') as ManualKind] ?? 'application/octet-stream';
export const sanitizeFilename = (n: string) => n.normalize('NFKC').replace(/[^\w.\- ()]+/g, '_').replace(/^\.+/, '').slice(0, 180) || 'upload';

export async function quotaLeft() { return config.GRIDFS_QUOTA_MB * 1024 * 1024 - (await gridfs.usedBytes()); }
const quotaError = () => new AppError(507, 'STORAGE_QUOTA', `Upload storage is full (limit ${config.GRIDFS_QUOTA_MB} MB, shared with the database). Archive and remove old uploads or configure external storage.`);

/** Sniffs the first bytes against the claimed kind. */
function sniff(kind: ManualKind, head: Buffer): string | null {
  if (kind === 'pdf') return head.subarray(0, 1024).includes(Buffer.from('%PDF-')) ? null : 'File content is not a PDF';
  if (kind === 'docx') return head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ? null : 'File content is not a DOCX document';
  if (head.includes(0)) return 'File content is binary, not text';
  return null;
}

export async function receiveManual(req: Request): Promise<ReceivedManual> {
  if (!/^multipart\/form-data/i.test(req.headers['content-type'] ?? '')) throw badRequest('Send the file as multipart/form-data in the "file" field');
  // §20 upload limits: the stored limit, never above the UPLOAD_MAX_MB env ceiling; only the allowed formats are accepted.
  const up = (await getSettings()).uploads; const mb = Math.min(up.maxUploadMb, config.UPLOAD_MAX_MB); const allowed = up.formats;
  const max = Math.floor(mb * 1024 * 1024); // busboy compares the byte count with ===
  const tooLarge = () => new AppError(413, 'FILE_TOO_LARGE', `Maximum file size is ${mb} MB`);
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > max + 1024 * 1024) { req.resume(); throw tooLarge(); }
  const left = await quotaLeft();
  if (left <= 0 || declared > left + 1024 * 1024) { req.resume(); throw quotaError(); }
  return new Promise<ReceivedManual>((resolve, reject) => {
    const fields: Record<string, string> = {}; let filePromise: Promise<Omit<ReceivedManual, 'fields'>> | null = null; let failed: Error | null = null;
    const fail = (e: Error) => { if (!failed) failed = e; };
    let bb: Busboy.Busboy;
    try { bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: max, fields: 30, fieldSize: 20_000, parts: 40 } }); } catch { return reject(badRequest('Malformed multipart body')); }
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('file', (name, stream, info) => {
      if (name !== 'file' || filePromise) { stream.resume(); return; }
      const filename = sanitizeFilename(info.filename ?? '');
      const kind = manualKindOf(filename);
      const mime = (info.mimeType || 'application/octet-stream').toLowerCase();
      if (!kind || !allowed.includes(kind)) { stream.resume(); return fail(new AppError(415, 'UNSUPPORTED_FILE', `Accepted formats: ${allowed.map((k) => MANUAL_FORMATS[k].label).join(', ')}`)); }
      if (mime !== 'application/octet-stream' && !(MANUAL_FORMATS[kind].mimes as readonly string[]).includes(mime)) { stream.resume(); return fail(new AppError(415, 'UNSUPPORTED_FILE', `The file type (${mime}) does not match a ${MANUAL_FORMATS[kind].label} file`)); }
      filePromise = new Promise((ok, bad) => {
        const up = gridfs.uploadStream(filename, MIME_FOR[kind]); const hash = crypto.createHash('sha256');
        let size = 0; let head = Buffer.alloc(0); let sniffed = false; let tail = Buffer.alloc(0); let encrypted = false; let stop: Error | null = null;
        const abort = (e: Error) => { if (stop) return; stop = e; stream.unpipe(); stream.resume(); up.abort().catch(() => {}).finally(() => bad(e)); };
        // after abort() the driver emits 'Stream has been aborted' for pending writes; that is expected, anything else fails the upload
        up.on('error', (e: Error) => { if (!stop) abort(e); });
        stream.on('data', (c: Buffer) => {
          if (stop) return;
          size += c.length; if (size > max) return abort(tooLarge()); if (size > left) return abort(quotaError());
          hash.update(c);
          if (!sniffed) { head = Buffer.concat([head, c]).subarray(0, 4096); if (head.length >= 1024 || size === head.length) { /* decide below on end if short */ } }
          if (!sniffed && head.length >= 1024) { sniffed = true; const err = sniff(kind, head); if (err) return abort(new AppError(415, 'UNSUPPORTED_FILE', err)); }
          if (kind === 'pdf') { const w = Buffer.concat([tail, c]); if (w.includes('/Encrypt')) encrypted = true; tail = w.subarray(Math.max(0, w.length - 16)); }
          if (!up.write(c)) { stream.pause(); up.once('drain', () => stream.resume()); }
        });
        stream.on('limit', () => { fail(tooLarge()); abort(tooLarge()); }); // busboy may emit 'limit' after 'end'; the outer failure covers that
        stream.on('error', (e) => abort(e));
        req.on('aborted', () => abort(badRequest('Upload was interrupted')));
        stream.on('end', () => {
          if (stop) return;
          if ((stream as any).truncated) return abort(tooLarge());
          if (!size) return abort(badRequest('The file is empty'));
          if (!sniffed) { const err = sniff(kind, head); if (err) return abort(new AppError(415, 'UNSUPPORTED_FILE', err)); }
          if (encrypted) return abort(new AppError(422, 'ENCRYPTED_PDF', 'Password-protected PDFs cannot be processed'));
          up.end(); up.once('finish', () => ok({ stored: { provider: 'gridfs', key: String(up.id) }, sha256: hash.digest('hex'), size, filename, mimeType: MIME_FOR[kind], kind }));
        });
      });
      filePromise.catch(() => {});
    });
    bb.on('error', () => fail(badRequest('Malformed multipart body')));
    bb.on('close', async () => {
      try {
        if (!filePromise) { throw failed ?? badRequest('Attach the file in the "file" field'); }
        const f = await filePromise; if (failed) { await gridfs.delete(f.stored.key).catch(() => {}); throw failed; }
        if (f.kind === 'docx' && !(await isDocx(await gridfs.get(f.stored.key)))) { await gridfs.delete(f.stored.key).catch(() => {}); throw new AppError(415, 'UNSUPPORTED_FILE', 'The file is not a Word document'); }
        resolve({ ...f, fields });
      } catch (e: any) { reject(e instanceof StorageUnavailableError ? new AppError(503, 'STORAGE_UNAVAILABLE', e.message) : e); }
    });
    req.pipe(bb);
  });
}
