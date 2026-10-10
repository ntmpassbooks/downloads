// NTM Passbook Downloads Service Worker
// Version: 2.0.0 (Build 20261010.4)
const CACHE_NAME = 'ntm-passbook-site-v2.0.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/NTM_Passbook_Logo.png',
  './assets/NTM_Passbook_Splash.png',
  './assets/hero_banner.jpg',
  './assets/promo_banner.jpg',
  './assets/iphone_pwa_mockup.jpg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-192.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png'
];

// 1. Install: Pre-cache core shell & assets, then immediately skip waiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// 2. Activate: Clear obsolete caches from prior versions, then claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// 3. Message: Enable manual skipWaiting trigger from client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 4. Fetch: Safe update-aware routing strategy
self.addEventListener('fetch', (event) => {
  // Financial Safety: Only intercept GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Financial Safety & Backend Authoritativeness:
  // Never intercept or cache API endpoints, auth endpoints, or financial transactions
  if (url.pathname.includes('/api/') || url.pathname.includes('/auth/')) return;

  // App isolation: Let the PWA application service worker handle /downloads/app/
  if (url.pathname.includes('/app/') || url.pathname.endsWith('/app')) return;

  // Binary Package Safety: Never cache APK/ENC binaries in Service Worker cache (11+ MB)
  if (url.pathname.endsWith('.apk') || url.pathname.endsWith('.enc')) return;

  // Live Update Manifest: Never cache version.json to ensure live update detection
  if (url.pathname.endsWith('version.json')) return;

  // Navigation requests (index.html / root / downloads directory):
  // Network-First with cache fallback to ensure users receive latest HTML on deployment
  if (
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname === '/' ||
    url.pathname.endsWith('/downloads/') ||
    url.pathname.endsWith('/downloads')
  ) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request, { ignoreSearch: true })
            .then((cached) => cached || caches.match('./index.html', { ignoreSearch: true }));
        })
    );
    return;
  }

  // Static Assets: Stale-While-Revalidate with search query tolerance (?v=...)
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
