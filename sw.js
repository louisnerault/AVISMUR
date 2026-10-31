const CACHE = 'smur-pwa-v2';
const FICHIERS = ['index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)));
  self.skipWaiting();
});

// Supprime les anciennes versions du cache.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
  );
});

// Réseau d'abord (pour récupérer les mises à jour), cache si hors ligne.
// Les appels à l'API ne passent jamais par le cache.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || e.request.url.includes('script.google.com')) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copie = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copie));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
