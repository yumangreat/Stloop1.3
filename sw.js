const CACHE_NAME = 'studyloop-v2.1.0';
const APP_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './css/tokens.css',
  './css/base.css',
  './css/home.css',
  './css/deck.css',
  './css/study.css',
  './css/stats.css',
  './css/cloud.css',
  './js/main.js',
  './js/icons.js',
  './js/store.js',
  './js/image-db.js',
  './js/math-renderer.js',
  './js/study-engine.js',
  './js/swipe.js',
  './js/speech.js',
  './js/backup.js',
  './js/share-service.js',
  './js/gist-sync.js',
  './js/views/modal.js',
  './js/views/home-view.js',
  './js/views/deck-view.js',
  './js/views/study-view.js',
  './js/views/stats-view.js',
  './js/views/share-view.js',
  './js/views/sync-view.js'
];

const CDN_CACHE_PREFIXES = [
  'https://cdn.jsdelivr.net/npm/katex@'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCdnAsset = CDN_CACHE_PREFIXES.some((p) => req.url.startsWith(p));

  if (!isSameOrigin && !isCdnAsset) return;

  if (isCdnAsset) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Strip query strings like ?share=... when falling back to index.html offline
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
