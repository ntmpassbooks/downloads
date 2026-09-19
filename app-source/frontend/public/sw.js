// Service Worker for NTM Passbook PWA
// Cache static assets and serve them offline. Do NOT cache private API responses.
const CACHE_NAME = 'ntm-passbook-static-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/NTM_Passbook_Logo.png',
  '/NTM_Passbook_Splash.png',
];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter(n => n !== CACHE_NAME).map(caches.delete)))
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) { return; }
  event.respondWith(caches.match(event.request).then(r => r || fetch(event.request)));
});
