/* ============ sw.js — para poder instalar el juego como app ============
 * - Código del juego (html, js, css): primero la red, así cada actualización
 *   llega al momento; si no hay conexión, la última copia guardada. La página
 *   del juego se pregunta siempre al servidor: GitHub Pages deja guardarla 10
 *   minutos, y al abrir el juego salía la versión de antes (el iPhone, desde la
 *   pantalla de inicio, se quedaba con ella toda la partida).
 * - version.json no pasa por aquí (lo mira updater.js, siempre de la red).
 * - Sprites, iconos y fuente: no cambian nunca, se sirven de la caché
 *   (se van guardando según se usan: no se descarga todo de golpe).
 * - Firebase y demás servicios de fuera no se tocan.
 */
const CODE = 'ps-code-v1', ART = 'ps-art-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CODE).then(c => c.addAll(['./', './index.html', './css/style.css', './manifest.webmanifest'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CODE && k !== ART).map(k => caches.delete(k))))
    // (Antes se guardaba una copia de cada consulta de version.json: fuera.)
    .then(() => caches.open(CODE)).then(c => c.keys().then(rs => Promise.all(rs.filter(r => /\/version\.json/.test(r.url)).map(r => c.delete(r)))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.endsWith('/version.json')) return;
  const art = /\/assets\/(pokemon|icons|fonts)\//.test(url.pathname);
  if (art) {
    e.respondWith(caches.open(ART).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // La página del juego ("/" o "/index.html", con o sin ?...) se guarda también como
  // ./index.html: sin conexión se abre la última que se usó, no la de cuando se
  // instaló el service worker (2-11-2026, de PokéSurvivor).
  const scope = new URL(self.registration.scope).pathname;
  const game = req.mode === 'navigate' && (url.pathname === scope || url.pathname === scope + 'index.html');
  e.respondWith((game ? fetch(url.href, { cache: 'no-cache' }) : fetch(req)).then(res => {
    if (res.ok && !res.redirected) {
      const copy = res.clone(), copy2 = game ? res.clone() : null;
      caches.open(CODE).then(c => { c.put(req, copy); if (copy2) c.put('./index.html', copy2); });
    }
    return res;
  }).catch(async () => {
    // Sin red: la copia guardada. La página de inicio sólo sirve de respaldo
    // al abrir la web (nunca en lugar de un script o una imagen).
    if (game) { const page = await caches.match('./index.html'); if (page) return page; }
    const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
    return Response.error();
  }));
});
