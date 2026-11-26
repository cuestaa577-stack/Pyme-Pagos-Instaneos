/* RemesaYa — Service Worker
 * Estrategia:
 *  - Shell de la app (HTML/CSS/JS/iconos): cache-first con revalidación en segundo plano.
 *  - Llamadas /api/*: SIEMPRE red (nunca se cachean datos financieros).
 *  - Navegación offline: se sirve el shell cacheado y la app avisa que no hay conexión.
 */
'use strict';

const VERSION = 'remesaya-v1';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/admin.html',
  '/styles.css',
  '/icons.js',
  '/app.js',
  '/admin.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.png',
  '/img/hero-ve.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApi(url) {
  return url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return; // red directa, sin caché

  // Navegación (SPA): red primero, y si falla, shell cacheado.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL);
          return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error();
        })
    );
    return;
  }

  // Estáticos: cache-first + actualización en segundo plano.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
