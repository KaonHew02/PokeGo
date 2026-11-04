/* ============ native.js — la app para Android (Capacitor) ============
 * La app (carpeta app/, ver docs/APP.md) lleva dentro este mismo juego. En la
 * web esto no hace nada; en la app:
 *   - Atrás del móvil: como B en el mando (cierra la ventana abierta o pausa
 *     la partida). En el menú (o al entrar, o en el test), dos veces seguidas
 *     cierra la app.
 *   - Los enlaces se abren en el navegador; los de la guía y la Pokédex, en la
 *     web publicada (no van dentro de la app).
 *   - Al pasar a otra app, la partida se pausa y el sonido se calla.
 *   - Copia de seguridad: el archivo se comparte (Drive, WhatsApp, Archivos...)
 *     porque dentro de la app no hay descargas.
 * El resto del código mira G.Native.app para lo que la app no usa: service
 * worker, updater (la app se actualiza instalando otra), pantalla completa
 * (ya lo es), y entrar con Google o Google Drive (Google no lo deja desde una
 * app así).
 *
 * Y en la web del móvil (26-10-2026), el Atrás o el gesto de volver ya no sacan
 * del juego: en la partida la pausa, en una pantalla del menú vuelve al menú y
 * sólo en el menú principal sale de la web (ver webBack).
 */
G.Native = (() => {
  const cap = window.Capacitor;
  const app = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const SITE = 'https://kaonhew02.github.io/PokeGo/';
  const plugin = name => (app && cap.Plugins && cap.Plugins[name]) || null;

  /** ¿En el menú principal (o al entrar, o en el test)? Ahí Atrás sale. */
  function atHome() {
    const top = G.Pad && G.Game ? G.Pad.topScreen() : null;
    return !G.Game || (G.Game.state === 'ui' && (!top || ['scr-menu', 'scr-login', 'scr-test'].includes(top.id)));
  }

  let backAt = 0;
  function back() {
    if (!atHome()) { G.Pad.back(); return; }
    if (Date.now() - backAt < 2500) { plugin('App').exitApp(); return; }
    backAt = Date.now();
    if (G.UI) G.UI.toast('Pulsa Atrás otra vez para salir', 2500);
  }

  // Un enlace nunca cambia la página de la app (se perdería la partida): se abre
  // fuera. Capacitor manda al navegador cualquier dirección que no sea la suya.
  function link(e) {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href || href[0] === '#' || /^(javascript|blob|data):/i.test(href)) return;
    e.preventDefault();
    location.href = new URL(href, SITE).href;
  }

  /*
   * Web: el Atrás del móvil se recoge con el historial (History API). Encima de la
   * página se dejan CUSHION entradas nuestras: Atrás gasta una, llega 'popstate' y
   * se hace lo que toque. Se reponen en el siguiente toque y no antes: Chrome se
   * salta al ir atrás las entradas que una web añade sin que nadie la haya tocado.
   * Por eso son varias: si no, el segundo Atrás seguido ya saldría del juego.
   * En el iPhone, abierto desde la pantalla de inicio, no hay Atrás que recoger: sólo
   * el gesto de deslizar desde el borde, que sin historial no hace nada. Con estas
   * entradas se activaría, y al coger el joystick pegado al borde pausaría la partida.
   */
  const CUSHION = 5;
  const depth = s => (s && s.psBack) | 0;
  let at = 0, leaving = false;

  function cushion() {
    if (!G.Settings.touch || navigator.standalone) return;       // (en el ordenador, Atrás sigue siendo el del navegador)
    try { for (let n = depth(history.state); n < CUSHION;) { history.pushState({ psBack: ++n }, ''); at = n; } }
    catch (e) { /* Safari limita las llamadas seguidas: ya se repondrá */ }
  }

  /** Lo que hace Atrás fuera del menú principal. */
  function webBack() {
    const g = G.Game, top = G.Pad.topScreen();
    if (G.GachaUI.open_) { G.GachaUI.escape(); return; }        // la tirada: salta la animación o cierra los premios
    if (top && top.id === 'scr-over') { document.getElementById('btn-again').click(); return; }
    // En la partida: la pausa (y ahí se queda). Con cartas abiertas, nada: hay que elegir.
    if (g.state !== 'ui' && (!top || ['scr-pause', 'scr-levelup', 'scr-bond', 'scr-item'].includes(top.id))) {
      if (g.state === 'playing' && !G.UI.isOpen('scr-pause')) g.togglePause();
      return;
    }
    G.Pad.back();
  }

  function onPop(e) {
    const n = depth(e.state), wentBack = n < at;
    at = n;
    // Para salir se baja hasta la página y de ahí a lo de antes (si no hay nada antes, se queda).
    if (leaving) { if (!n) { leaving = false; history.back(); } return; }
    if (!wentBack) return;
    if (!atHome()) { webBack(); return; }
    if (n) { leaving = true; history.go(-n); } else history.back();
  }

  /** Guarda el texto en un archivo y abre el menú de compartir de Android. */
  async function shareFile(name, text) {
    const r = await plugin('Filesystem').writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
    await plugin('Share').share({ title: 'PokéGo', files: [r.uri] });
  }

  if (app) {
    document.addEventListener('click', link);
    const App = plugin('App');
    if (App) {
      App.addListener('backButton', back);
      App.addListener('appStateChange', s => {
        if (G.Audio) G.Audio.sleep(!s.isActive);
        if (!s.isActive && G.Game) G.Game.autoPause();
      });
    }
  } else if (window.history && history.pushState) {
    at = depth(history.state);
    addEventListener('popstate', onPop);
    // (touchend y pointerup: en el móvil, pointerdown no cuenta como que te han tocado.)
    for (const ev of ['touchend', 'pointerup', 'keydown']) addEventListener(ev, cushion, true);
  }

  return { app, SITE, shareFile };
})();
