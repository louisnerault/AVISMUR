const CACHE = 'smur-pwa-v1';
const FICHIERS = ['index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)));
});

// Le cache ne sert que l'interface. Les appels à l'API ne sont jamais mis en cache.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || e.request.url.includes('script.google.com')) return;
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
