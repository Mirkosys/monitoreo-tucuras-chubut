/* =====================================================================
   sw.js — Service worker de la App Monitoreo Tucuras
   Guarda la app completa en cache para que abra sin senal en el campo.
   Estrategia: cache primero para los archivos propios, red como respaldo.
   ===================================================================== */

var CACHE = 'tucuras-v3';

var ARCHIVOS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './datos.js',
  './exif.js',
  './instalar.js',
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

function guardarCopia(req, res) {
  if (res && res.status === 200 && res.type === 'basic') {
    var copia = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copia); });
  }
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return; // recursos externos: sin cache

  // La pagina y los archivos de la app van por RED PRIMERO, con la cache
  // como respaldo. Asi el tecnico recibe las correcciones apenas tiene
  // senal, en vez de quedarse con una version vieja para siempre.
  var esDocumento = req.mode === 'navigate';
  var esCodigo = /\.(js|css|webmanifest)$/.test(url.pathname);

  if (esDocumento || esCodigo) {
    e.respondWith(
      fetch(req)
        .then(function (res) { return guardarCopia(req, res); })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            if (hit) return hit;
            if (esDocumento) return caches.match('./index.html');
            return new Response('Sin conexion', { status: 503, statusText: 'Sin conexion' });
          });
        })
    );
    return;
  }

  // Iconos y demas recursos estables: cache primero, que es mas rapido.
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req)
        .then(function (res) { return guardarCopia(req, res); })
        .catch(function () {
          return new Response('Sin conexion', { status: 503, statusText: 'Sin conexion' });
        });
    })
  );
});
