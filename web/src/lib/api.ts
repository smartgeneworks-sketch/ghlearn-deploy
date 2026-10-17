import type { ApiError, PublicUser } from '@ghlearn/shared';
export class HttpError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); } }
import { apiBase } from './apiBase';
const BASE = apiBase();
let refreshing: Promise<boolean> | null = null;
/** CSRF token (double-submit). Kept in memory only; fetched from the API because cross-site cookies are unreadable. */
let csrf: Promise<string> | null = null;
const getCsrf = (force = false) => { if (force || !csrf) csrf = fetch(BASE + '/api/auth/csrf', { credentials: 'include' }).then((r) => r.json()).then((j) => { if (!j?.csrfToken) throw new Error('Could not get CSRF token'); return j.csrfToken as string; }).catch((e) => { csrf = null; throw e; }); return csrf; };
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
async function raw(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const headers: Record<string, string> = { ...(init.body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(init.headers as Record<string, string>) };
  if (UNSAFE.has(method)) headers['X-CSRF-Token'] = await getCsrf();
  const res = await fetch(BASE + path, { ...init, credentials: 'include', headers });
  if (res.status === 403 && UNSAFE.has(method) && retry) {
    const code = await res.clone().json().then((j) => j?.error?.code).catch(() => null);
    if (code === 'CSRF_INVALID') { await getCsrf(true); return raw(path, init, false); }
  }
  return res;
}
/** fetch wrapper: JSON, cookie auth, one silent refresh on 401, typed errors. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init);
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    refreshing ??= raw('/api/auth/refresh', { method: 'POST' }).then((r) => r.ok).finally(() => { refreshing = null; });
    if (await refreshing) res = await raw(path, init);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (res.status === 503 && (data as ApiError).error?.code === 'MAINTENANCE' && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gl:maintenance', { detail: (data as ApiError).error?.message }));
  if (!res.ok) { const e = (data as ApiError).error; throw new HttpError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Request failed', e?.details); }
  return data as T;
}
export const post = <T>(p: string, body: unknown) => api<T>(p, { method: 'POST', body: JSON.stringify(body) });
export const upload = <T>(p: string, form: FormData) => api<T>(p, { method: 'POST', body: form });
export const del = (p: string) => api<void>(p, { method: 'DELETE' });
export const patch = <T>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body: JSON.stringify(body) });
export type { PublicUser };

/** POST that consumes a Server-Sent Events response (used by the tutor). */
export async function streamPost(path: string, body: unknown, onEvent: (event: string, data: any) => void) {
  const res = await raw(path, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new HttpError(res.status, j?.error?.code ?? 'ERROR', j?.error?.message ?? 'Request failed'); }
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = block.match(/^event: (.*)$/m)?.[1] ?? 'message'; const data = block.match(/^data: (.*)$/m)?.[1];
      if (data) onEvent(ev, JSON.parse(data));
    }
  }
}
export const put = <T>(p: string, body: unknown) => api<T>(p, { method: 'PUT', body: JSON.stringify(body) });

/** Download a file from the API (cookie auth, one refresh on 401) and save it with the server-supplied name. */
export async function download(path: string, fallbackName = 'download') {
  let res = await raw(path);
  if (res.status === 401) { if (await raw('/api/auth/refresh', { method: 'POST' }).then((r) => r.ok)) res = await raw(path); }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new HttpError(res.status, e?.error?.code ?? 'ERROR', e?.error?.message ?? 'Download failed'); }
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = decodeURIComponent(name);
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Multipart upload with real progress (XMLHttpRequest exposes upload progress; fetch does not).
 * Same cookie auth and CSRF header as `api`; one CSRF refresh and one session refresh are retried.
 * Returns an abort handle together with the result promise.
 */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress: (sent: number, total: number) => void): { promise: Promise<T>; abort: () => void } {
  let xhr: XMLHttpRequest | null = null; let aborted = false;
  const once = (token: string) => new Promise<{ status: number; body: any }>((resolve, reject) => {
    const x = new XMLHttpRequest(); xhr = x;
    x.open('POST', BASE + path); x.withCredentials = true; x.setRequestHeader('X-CSRF-Token', token); x.responseType = 'json';
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    x.onload = () => resolve({ status: x.status, body: x.response ?? {} });
    x.onerror = () => reject(new HttpError(0, 'NETWORK', 'The upload failed because of a network error. Check your connection and try again.'));
    x.onabort = () => reject(new HttpError(0, 'ABORTED', 'Upload cancelled'));
    x.send(form);
  });
  const promise = (async () => {
    let r = await once(await getCsrf());
    if (r.status === 403 && r.body?.error?.code === 'CSRF_INVALID' && !aborted) r = await once(await getCsrf(true));
    if (r.status === 401 && !aborted && (await raw('/api/auth/refresh', { method: 'POST' }).then((x) => x.ok))) r = await once(await getCsrf());
    if (r.status < 200 || r.status >= 300) { const e = r.body?.error; throw new HttpError(r.status, e?.code ?? 'ERROR', e?.message ?? (r.status === 413 ? 'The file is too large' : 'Upload failed'), e?.details); }
    return r.body as T;
  })();
  return { promise, abort: () => { aborted = true; xhr?.abort(); } };
}
/** Fetch a protected file as a Blob (for in-page previews; the API is on another origin so it cannot be framed directly). */
export async function fetchBlob(path: string): Promise<Blob> {
  let res = await raw(path);
  if (res.status === 401) { if (await raw('/api/auth/refresh', { method: 'POST' }).then((r) => r.ok)) res = await raw(path); }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new HttpError(res.status, e?.error?.code ?? 'ERROR', e?.error?.message ?? 'Could not load the file'); }
  return res.blob();
}
/** SHA-256 of a file in the browser (hex), used to warn about duplicates before uploading. */
export async function sha256Hex(file: Blob): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null; // insecure context: the server still checks
  const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
