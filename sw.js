/* Hanasu Cards service worker: network first, cache fallback, so the app works offline after one online visit. */
const CACHE = 'hanasu-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'kana.js', 'kanji-data.js', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png', 'icon-512.png', 'decks/index.json'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    try { const decks = await (await fetch('decks/index.json', { cache: 'no-cache' })).json(); await cache.addAll(decks.map(f => 'decks/' + f)); } catch {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;
  const qrLib = url.hostname === 'cdnjs.cloudflare.com';
  if (!sameOrigin && !qrLib) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      if (e.request.mode === 'navigate') return cache.match('index.html');
      throw new Error('offline');
    }
  })());
});
