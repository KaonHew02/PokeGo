/* ============ awake.js — que la pantalla no se apague en partida ============
 * Jugando con el dedo, el móvil ve que lo tocas y sigue encendido. Con AUTO (o
 * con mando) nadie lo toca: a los pocos segundos se apaga y la partida se para.
 * Aquí se pide a la web que no se apague (Screen Wake Lock) mientras dura la
 * partida. En pausa y en el menú, el móvil vuelve a apagarse como siempre.
 *
 *   - El sistema suelta el permiso al salir de la pestaña o al bloquear: al
 *     volver se pide otra vez (como mucho cada RETRY ms).
 *   - Safari sólo lo da justo después de un toque: por eso también se pide en
 *     cada toque, y se suelta a los MENU_MS del último si no hay partida (el
 *     último toque antes de empezar es el de Jugar).
 *   - La app de Android no lo necesita: lo hace MainActivity.java.
 *   - Navegadores sin esta función: no hace nada (iPhone: desde iOS 16.4; en la
 *     pantalla de inicio, desde iOS 18.4).
 */
G.Awake = (() => {
  const RETRY = 5000, MENU_MS = 30000;
  const api = G.Native.app ? null : navigator.wakeLock;
  let lock = null, asking = false, triedAt = 0, tapAt = 0;

  async function grab() {
    if (!api || lock || asking || document.visibilityState !== 'visible') return;
    asking = true;
    triedAt = Date.now();
    try {
      const l = await api.request('screen');
      lock = l;
      l.addEventListener('release', () => { if (lock === l) lock = null; });
    } catch (e) { /* sin permiso o con poca batería: se vuelve a intentar */ }
    asking = false;
  }

  function free() {
    const l = lock;
    lock = null;
    if (l) l.release().catch(() => {});
  }

  /** En cada fotograma (game.js). run: hay una partida en marcha (ni en pausa ni acabada). */
  function tick(run) {
    if (!api) return;
    const now = Date.now();
    if (run) { if (!lock && now - triedAt > RETRY) grab(); }
    else if (lock && now - tapAt > MENU_MS) free();
  }

  if (api) for (const ev of ['pointerup', 'keydown']) addEventListener(ev, () => { tapAt = Date.now(); grab(); }, true);

  return { tick, get held() { return !!lock; } };
})();
