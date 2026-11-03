// Fediv — service worker : l'app s'ouvre vite et reste consultable hors ligne.
// Fichiers du site : servis depuis le cache puis rafraîchis en arrière-plan.
// Page d'accueil : réseau d'abord (pour recevoir les mises à jour), cache en secours.

const CACHE = 'fediv-v1';
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
  // Services extérieurs (tuiles IGN, Wikidata…) : le navigateur s'en charge.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
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
