/* =====================================================================
   sw.js — Service worker de la App Monitoreo Tucuras
   Guarda la app completa en cache para que abra sin senal en el campo.
   Estrategia: cache primero para los archivos propios, red como respaldo.
   ===================================================================== */

var CACHE = 'tucuras-v1';

var ARCHIVOS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './datos.js',
  './exif.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ARCHIVOS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (claves) {
      return Promise.all(claves.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return; // recursos externos: sin cache

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // Guardamos una copia para la proxima salida a campo.
        if (res && res.status === 200 && res.type === 'basic') {
          var copia = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copia); });
        }
        return res;
      }).catch(function () {
        // Sin red y sin cache: si pedian una pagina, devolvemos la principal.
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('Sin conexion', { status: 503, statusText: 'Sin conexion' });
      });
    })
  );
});
