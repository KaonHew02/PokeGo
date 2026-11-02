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
 */
G.Native = (() => {
  const cap = window.Capacitor;
  const app = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const SITE = 'https://kaonhew02.github.io/PokeGo/';
  const plugin = name => (app && cap.Plugins && cap.Plugins[name]) || null;

  let backAt = 0;
  function back() {
    const top = G.Pad && G.Game ? G.Pad.topScreen() : null;
    const home = !G.Game || (G.Game.state === 'ui' && (!top || ['scr-menu', 'scr-login', 'scr-test'].includes(top.id)));
    if (!home) { G.Pad.back(); return; }
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
  }

  return { app, SITE, shareFile };
})();
