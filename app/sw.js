// Service Worker for NTM Passbook PWA App
// Cache static assets and serve them offline. Do NOT cache private API responses.
const CACHE_NAME = 'ntm-passbook-app-v2.0.1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './NTM_Passbook_Logo.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  if (self.location.hostname !== 'localhost') {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
    );
  }
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => self.location.hostname === 'localhost' || n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Native Capacitor WebView serves directly from APK assets via WebViewAssetLoader
  if (url.hostname === 'localhost') return;
  // Never intercept backend API or auth calls
  if (url.pathname.includes('/api/') || url.pathname.includes('/auth/')) return;
  // Never intercept binary packages
  if (url.pathname.endsWith('.apk') || url.pathname.endsWith('.enc')) return;

  // Network-first for navigation requests, fallback to cached index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
