/* GH Learn service worker.
 * - App shell: network-first for navigations (falls back to cached index.html offline).
 * - Hashed static assets: cache-first (immutable).
 * - Lessons saved for offline: the page asks us to cache specific approved-resource API URLs
 *   ("lessons" cache). Those URLs are then served network-first with cache fallback.
 * - Nothing else from the API is cached (no answer keys, attempts, tutor, admin data).
 * - On logout the page sends CLEAR_USER_DATA and the lessons cache is deleted. */
const VERSION = 'v3';
const SHELL = `shell-${VERSION}`, ASSETS = `assets-${VERSION}`, LESSONS = 'lessons';
self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([
    caches.open(SHELL).then((c) => c.addAll(['/index.html', '/manifest.webmanifest', '/icon-192.png'])),
    fetch('/asset-manifest.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then((list) => caches.open(ASSETS).then((c) => c.addAll(list))).catch(() => undefined),
  ]));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![SHELL, ASSETS, LESSONS].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
const isLessonApi = (u) => /\/api\/resources\/[a-f0-9]{24}$/.test(u.pathname);
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(SHELL).then((s) => s.put('/index.html', c)); return r; }).catch(() => caches.match('/index.html', { ignoreVary: true })));
    return;
  }
  if (u.origin === location.origin && u.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req, { ignoreVary: true, ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(ASSETS).then((s) => s.put(req, c)); } return r; })));
    return;
  }
  if (isLessonApi(u)) {
    e.respondWith(caches.open(LESSONS).then(async (cache) => {
      const saved = await cache.match(u.href, { ignoreVary: true });
      try { const r = await fetch(req); if (r.ok && saved) cache.put(u.href, r.clone()); return r; }
      catch (err) { if (saved) return saved; throw err; }
    }));
  }
});
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'SAVE_LESSON' && typeof d.url === 'string') {
    e.waitUntil(fetch(d.url, { credentials: 'include' }).then(async (r) => {
      if (!r.ok) throw new Error(String(r.status)); const body = await r.clone().json();
      if (body?.resource?.status !== 'published') throw new Error('not published');
      await (await caches.open(LESSONS)).put(d.url, r); e.source?.postMessage({ type: 'SAVED', url: d.url, ok: true });
    }).catch((err) => e.source?.postMessage({ type: 'SAVED', url: d.url, ok: false, error: String(err.message || err) })));
  }
  if (d.type === 'REMOVE_LESSON') e.waitUntil(caches.open(LESSONS).then((c) => c.delete(d.url)));
  if (d.type === 'CLEAR_USER_DATA') e.waitUntil(caches.delete(LESSONS));
});
