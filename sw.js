// Fediv — service worker : l'app s'ouvre vite et reste consultable hors ligne.
// Fichiers du site : servis depuis le cache puis rafraîchis en arrière-plan.
// Page d'accueil : réseau d'abord (pour recevoir les mises à jour), cache en secours.

const CACHE = 'fediv-v3';
// Bibliothèque de carte et polices : gardées pour ouvrir l'app plus vite.
const CDN = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png?v=2',
  'icons/favicon-32.png?v=2',
  'data/histoire.json',
  'data/local.json',
  'data/quiz.json',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (CDN.includes(url.hostname)) {
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }
  // Autres services extérieurs (tuiles IGN, Wikidata…) : le navigateur s'en charge.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Toujours la dernière version publiée (sans passer par le cache HTTP du navigateur).
    event.respondWith(
      fetch(request.url, { cache: 'no-store' })
        .then(response => { caches.open(CACHE).then(c => c.put('index.html', response.clone())); return response; })
        .catch(() => caches.match('index.html')),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then(response => { if (response.ok) cache.put(request, response.clone()); return response; })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
