// À incrémenter à chaque mise à jour, avec les ?v= de index.html.
const CACHE = 'smur-pwa-v35';
const FICHIERS = [
  './', 'index.html', 'style.css?v=19', 'app.js?v=18', 'config.js?v=5', 'checklists.js?v=9', 'ambulancier.js?v=16', 'actions.js?v=1', 'config-admin.js?v=3', 'compteur.js?v=5',
  'manifest.webmanifest',
  'img/logo-smur.png', 'img/logo-cha.png', 'img/icon-192.png', 'img/icon-512.png', 'img/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)));
  self.skipWaiting();
});

// Supprime les anciennes versions du cache et prend la main sur les pages ouvertes.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c.startsWith('smur-pwa-') && c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

// Réseau d'abord, en revalidant toujours auprès du serveur (pas de copie périmée du navigateur).
// Hors ligne : la dernière version en cache. Les appels à l'API ne passent jamais par le cache.
self.addEventListener('fetch', (e) => {
  // Seuls les fichiers de l'application passent par le cache ; le reste (API, polices,
  // moteur de lecture du compteur) va directement au réseau.
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((r) => {
        if (r.ok) {
          const copie = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copie));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
