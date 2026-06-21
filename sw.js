// madgolf — Service Worker v0.12
// Cache name updated automatically by bump.py on every version bump.
const CACHE_NAME = 'madgolf-v0.12';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './logo.webp'
];

// Install: pre-cache app shell assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS.filter(a => a !== './logo.webp'))) // logo may not exist yet
      .then(() => self.skipWaiting())
  );
});

// Activate: delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: pass-through Firebase, auth, GHIN proxy, fonts — never cache
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept — Firebase, Google Auth, GHIN proxy, Google APIs
  if (
    url.hostname.includes('firebaseio.com')      ||
    url.hostname.includes('firebase.google.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com')     ||
    url.hostname.includes('accounts.google.com')            ||
    url.hostname.includes('www.googleapis.com')             ||
    url.hostname.includes('gstatic.com')                    ||
    url.hostname.includes('googleapis.com')                 ||
    url.hostname.includes('workers.dev')
  ) {
    return; // let browser handle; no e.respondWith()
  }

  // Only cache http/https — never chrome-extension:// or other schemes
  if (!e.request.url.startsWith('http')) return;

  // Cache-first for app shell assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback — return cached index.html for navigation requests
      if (e.request.mode === 'navigate') return caches.match('./index.html');
    })
  );
});
