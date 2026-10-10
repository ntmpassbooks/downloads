// Service Worker for NTM Passbook PWA App (V2.0.0 Build 4)
// Cache static app shell + Vite JS/CSS bundles for offline launch. Never cache private API/auth responses.
const CACHE_NAME = 'ntm-passbook-app-v2.0.0-b4';
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

function isCapacitorWebView() {
  return self.location.origin === 'https://localhost';
}

self.addEventListener('install', (event) => {
  if (!isCapacitorWebView()) {
    event.waitUntil(
      caches.open(CACHE_NAME).then(async (cache) => {
        await cache.addAll(STATIC_ASSETS);
        try {
          const indexRes = await fetch('./index.html', { cache: 'no-cache' });
          if (indexRes && indexRes.ok) {
            await cache.put('./index.html', indexRes.clone());
            const html = await indexRes.text();
            const assetMatches = Array.from(
              html.matchAll(/(?:src|href)=["'](\.?\/?assets\/[^"']+)["']/g),
              (m) => (m[1].startsWith('./') || m[1].startsWith('/') ? m[1] : `./${m[1]}`)
            );
            if (assetMatches.length > 0) {
              await Promise.allSettled(
                assetMatches.map((assetUrl) => cache.add(assetUrl))
              );
            }
          }
        } catch {
          // Best-effort bundle discovery during install
        }
      })
    );
  }
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => isCapacitorWebView() || n !== CACHE_NAME)
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
  if (isCapacitorWebView()) return;
  // Only handle same-origin requests or Google Fonts for UI typography
  if (url.origin !== self.location.origin && !url.hostname.endsWith('googleapis.com') && !url.hostname.endsWith('gstatic.com')) {
    return;
  }
  // Never intercept backend API or auth calls
  if (url.pathname.includes('/api/') || url.pathname.includes('/auth/')) return;
  // Never intercept binary packages
  if (url.pathname.endsWith('.apk') || url.pathname.endsWith('.enc')) return;

  // Network-first for navigation requests, fallback to cached index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkRes) => {
          if (networkRes && networkRes.ok) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return networkRes;
        })
        .catch(async () => {
          const cachedIndex = await caches.match('./index.html');
          if (cachedIndex) return cachedIndex;
          const cachedRoot = await caches.match('./');
          return cachedRoot || Response.error();
        })
    );
    return;
  }

  // Cache-first with runtime cache population for static bundles, stylesheets, icons, and fonts
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((networkRes) => {
        if (
          networkRes &&
          networkRes.status === 200 &&
          (networkRes.type === 'basic' || networkRes.type === 'cors')
        ) {
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkRes;
      });
    })
  );
});

