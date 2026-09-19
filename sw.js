// NTM Passbook Downloads Service Worker
const CACHE_NAME = 'ntm-downloads-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/NTM_Passbook_Logo.png',
  './assets/NTM_Passbook_Splash.png',
  './assets/hero_banner.jpg',
  './assets/promo_banner.jpg',
  './assets/iphone_pwa_mockup.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.includes('/api/') || url.pathname.includes('/auth/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
