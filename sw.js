// Offline support: pre-cache the app shell; serve network-first, falling back to cache.
// Only same-origin GETs are handled; GitHub API calls always go straight to the network.
const VERSION = 'hoop-tracker-v8'; // keep in step with js/version.js
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/dom.js', './js/ui.js', './js/court.js', './js/store.js', './js/stats.js', './js/chart.js',
  './js/settings.js', './js/voice.js', './js/sync.js', './js/crypto.js', './js/backup.js', './js/vault.js',
  './js/version.js', './js/strength.js', './js/csv.js', './js/diagram.js',
  './js/views/lock.js', './js/views/practice.js', './js/views/drills.js', './js/views/progress.js', './js/views/settings.js', './js/views/edit-session.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Network-first so updates arrive as soon as you're online; cache when offline (e.g. at the gym).
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })
      .then((hit) => hit || caches.match('./index.html'))),
  );
});
