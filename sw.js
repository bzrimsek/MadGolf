// madgolf — Service Worker vtouch
const CACHE_NAME = 'madgolf-v0.90.50';
const ASSETS = ['./', './index.html', './manifest.json', './logo.webp'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  // Do NOT call skipWaiting() automatically — wait for page to signal it's safe
});

// Page sends {type:'SKIP_WAITING'} when safe to activate new SW
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
