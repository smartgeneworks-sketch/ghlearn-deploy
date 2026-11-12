/** PWA helpers: service worker registration and "save lesson for offline". */
const KEY = 'gl_offline_lessons';
export type Saved = { id: string; subjectId: string; title: string; savedAt: string; url: string };
import { apiBase } from './apiBase';
const BASE = apiBase();
export const lessonUrl = (id: string) => new URL(`${BASE}/api/resources/${id}`, location.href).href;
export const listSaved = (): Saved[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const store = (xs: Saved[]) => localStorage.setItem(KEY, JSON.stringify(xs));
export const isSaved = (id: string) => listSaved().some((s) => s.id === id);
export const offlineSupported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof caches !== 'undefined';

export function registerSW() {
  if (!offlineSupported() || !import.meta.env.PROD) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}
async function worker() { const r = await navigator.serviceWorker.ready; if (!r.active) throw new Error('Offline support is not ready yet; reload and try again.'); return r.active; }
/** Ask the service worker to fetch and cache one approved lesson. Resolves when cached. */
export async function saveLesson(r: { _id: string; subjectId: string; title: string }) {
  if (!offlineSupported()) throw new Error('This browser does not support offline lessons.');
  const url = lessonUrl(r._id); const w = await worker();
  await new Promise<void>((resolve, reject) => {
    const on = (e: MessageEvent) => { if (e.data?.type !== 'SAVED' || e.data.url !== url) return; navigator.serviceWorker.removeEventListener('message', on); e.data.ok ? resolve() : reject(new Error(`Could not save (${e.data.error})`)); };
    navigator.serviceWorker.addEventListener('message', on); w.postMessage({ type: 'SAVE_LESSON', url });
    setTimeout(() => { navigator.serviceWorker.removeEventListener('message', on); reject(new Error('Timed out saving lesson')); }, 30000);
  });
  store([...listSaved().filter((s) => s.id !== r._id), { id: r._id, subjectId: String(r.subjectId), title: r.title, savedAt: new Date().toISOString(), url }]);
}
export async function removeLesson(id: string) {
  const s = listSaved().find((x) => x.id === id); store(listSaved().filter((x) => x.id !== id));
  if (s && offlineSupported()) (await worker().catch(() => null))?.postMessage({ type: 'REMOVE_LESSON', url: s.url });
}
/** §20 offline policy: when saving lessons is switched off, copies already on this device are removed. */
export async function clearSavedLessons() { for (const s of listSaved()) await removeLesson(s.id).catch(() => undefined); }
/** Called on sign-out: saved lessons are per-user, so they are removed from this device. */
export function clearOffline() {
  localStorage.removeItem(KEY);
  if (offlineSupported()) navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_USER_DATA' });
}
