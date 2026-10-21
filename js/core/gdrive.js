/* ============ gdrive.js — copia de la partida en Google Drive ============
 * Botones de Ajustes > Cuenta: no se sincroniza solo, sólo cuando los pulsas.
 * Hace falta un ID de cliente en js/core/google-config.js (docs/GOOGLE_DRIVE.md).
 *
 *   - Permiso: Google Identity Services (la ventana de Google) con drive.file:
 *     el juego sólo ve los archivos que crea él, nada más de tu Drive. El token
 *     dura ~1 h y sólo se guarda en memoria.
 *   - Un archivo que SE VE en tu Drive: carpeta "PokéGo" > "pokego-<cuenta>.json".
 *     Se encuentra por sus appProperties aunque lo muevas o le cambies el nombre.
 *   - Guardar: baja la copia que haya, la junta con la de aquí (G.DB.importSave,
 *     sin perder nada), sube lo juntado y se queda también aquí.
 *     Cargar: baja la copia; la importa quien llama, tras confirmarlo.
 *
 * requestAccessToken abre una ventana y tiene que llamarse dentro del clic (si
 * no, el navegador la bloquea): por eso el script de Google se carga antes, al
 * abrir la pestaña Cuenta (preload), y save()/load() piden el permiso antes de
 * su primer await. Los errores vuelven como { ok: false, why } (ver settings-ui.js).
 */
G.Drive = (() => {
  const GSI = 'https://accounts.google.com/gsi/client';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3/files', UP = 'https://www.googleapis.com/upload/drive/v3/files';
  const FOLDER = 'PokéGo', K_AT = 'ps.drive.';
  let client = null, loadP = null, token = '', exp = 0, pend = null;

  const configured = () => !!G.GOOGLE_CLIENT_ID;
  const enabled = () => configured() && /^https?:$/.test(location.protocol);
  const fail = why => ({ ok: false, why });
  const hasToken = () => !!token && Date.now() < exp;
  const account = () => String(G.DB.user || '').toLowerCase();
  // Al cerrar sesión se olvida el permiso: la siguiente cuenta puede usar otro Google.
  G.DB.onLeave(() => { token = ''; exp = 0; });

  /** Carga el script de Google (una vez) y prepara el cliente del permiso. → Promise<bool> */
  function preload() {
    if (!enabled()) return Promise.resolve(false);
    if (loadP) return loadP;
    loadP = new Promise(res => {
      const ok = () => { try { init(); res(true); } catch (e) { console.warn('[Drive]', e.message); loadP = null; res(false); } };
      if (window.google && window.google.accounts && window.google.accounts.oauth2) { ok(); return; }
      const el = document.createElement('script');
      el.src = GSI; el.async = true;
      el.onload = ok;
      el.onerror = () => { loadP = null; el.remove(); res(false); };     // se reintenta la próxima vez
      document.head.appendChild(el);
    });
    return loadP;
  }

  function init() {
    const o = window.google.accounts.oauth2;
    const answer = r => { const p = pend; pend = null; if (p) p(r); };
    client = o.initTokenClient({
      client_id: G.GOOGLE_CLIENT_ID, scope: SCOPE,
      callback: r => {
        if (!r || r.error || !r.access_token) { answer(fail(r && r.error === 'access_denied' ? 'denied' : r && r.error ? 'api' : 'closed')); return; }
        // Con el permiso de Drive desmarcado en la ventana, el token no sirve.
        if (o.hasGrantedAllScopes && !o.hasGrantedAllScopes(r, SCOPE)) { answer(fail('denied')); return; }
        token = r.access_token; exp = Date.now() + ((+r.expires_in || 3600) - 60) * 1000;
        answer(null);
      },
      error_callback: e => answer(fail(e && e.type === 'popup_failed_to_open' ? 'blocked' : 'closed'))
    });
  }

  /** El permiso. Sin token válido abre la ventana de Google (llamar dentro del clic). → Promise<null | error> */
  function auth() {
    if (hasToken()) return Promise.resolve(null);
    if (!client) return Promise.resolve(fail('load'));
    if (pend) pend(fail('closed'));             // una ventana anterior que no llegó a contestar
    return new Promise(res => {
      pend = res;
      try { client.requestAccessToken({ prompt: '' }); } catch (e) { pend = null; res(fail('load')); }
    });
  }

  /** Petición a Drive con el token. Los fallos se lanzan como { ok: false, why }. */
  async function call(url, opts = {}) {
    let r;
    try { r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + token }, opts.headers) })); }
    catch (e) { throw fail('net'); }
    if (r.ok) return r;
    if (r.status === 401) { token = ''; exp = 0; throw fail('expired'); }
    if (r.status === 404) throw fail('none');
    if (r.status === 429 || r.status >= 500) throw fail('net');
    let txt = '';
    try { txt = await r.text(); } catch (e) { /* nada */ }
    if (/rateLimit/i.test(txt)) throw fail('net');
    // Sin el permiso de Drive: hay que volver a pedirlo.
    if (r.status === 403 && /insufficient|SCOPE/i.test(txt)) { token = ''; exp = 0; throw fail('denied'); }
    console.warn('[Drive]', r.status, txt.slice(0, 300));
    throw fail('api');                           // p. ej. la API de Drive sin activar en Google Cloud
  }

  const quote = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  async function list(q) {
    const u = API + '?' + new URLSearchParams({ q: q + ' and trashed = false', spaces: 'drive', orderBy: 'modifiedTime desc',
      pageSize: '10', fields: 'files(id,name,modifiedTime)' });
    return (await (await call(u)).json()).files || [];
  }
  async function findFile() {
    const l = await list(`appProperties has { key='pokego' and value='save' } and appProperties has { key='account' and value=${quote(account())} }`);
    return l[0] || null;
  }
  /** La carpeta PokéGo de Mi unidad (se crea la primera vez). */
  async function folder() {
    const l = await list("mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='pokego' and value='folder' }");
    if (l[0]) return l[0].id;
    const r = await call(API + '?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder', parents: ['root'], appProperties: { pokego: 'folder' } }) });
    return (await r.json()).id;
  }
  async function download(id) {
    let r;
    try { r = await call(API + '/' + encodeURIComponent(id) + '?alt=media'); }
    catch (e) { if (e.why === 'none') return null; throw e; }      // borrado justo ahora
    let d = null;
    try { d = JSON.parse(await r.text()); } catch (e) { /* abajo */ }
    if (!d || typeof d !== 'object') throw fail('damaged');
    return d;
  }
  async function upload(file, data) {
    const json = JSON.stringify(data), F = '&fields=id,modifiedTime';
    if (file) return (await call(UP + '/' + encodeURIComponent(file.id) + '?uploadType=media' + F,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json })).json();
    const meta = { name: 'pokego-' + G.DB.user + '.json', parents: [await folder()], mimeType: 'application/json',
                   appProperties: { pokego: 'save', account: account() } };
    const b = 'pokego' + Math.random().toString(36).slice(2);
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
      + `--${b}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${b}--`;
    return (await call(UP + '?uploadType=multipart' + F, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body })).json();
  }

  function check() {
    if (!enabled()) return fail('load');
    if (G.DB.guest || !G.DB.save) return fail('guest');
    if (G.Game && G.Game.state && G.Game.state !== 'ui') return fail('run');
    return null;
  }
  function caught(e) {
    if (e && e.why) return fail(e.why);
    console.warn('[Drive]', e);
    return fail('net');
  }

  /** Guardar en Google Drive: lo de Drive + lo de aquí, sin perder nada. → { ok, why?, added, created } */
  async function save() {
    const pre = check(); if (pre) return pre;
    const a = auth();                            // antes del primer await: dentro del clic
    try {
      const no = await a; if (no) return no;
      let file = await findFile();
      const remote = file && await download(file.id);
      if (!remote) file = null;                  // (si lo acaban de borrar, se crea otro)
      let data = G.DB.exportSave();
      if (remote) {
        const m = G.DB.importSave(remote, { dry: true });
        if (!m.ok) return fail(m.why === 'bad' ? 'damaged' : m.why);
        data = m.data;
      }
      const meta = await upload(file, data);
      const r = remote ? G.DB.importSave(data) : { added: 0 };   // lo juntado, también en este aparato
      stamp(meta && meta.modifiedTime);
      return { ok: true, added: r.added || 0, created: !remote };
    } catch (e) { return caught(e); }
  }

  /** Cargar de Google Drive: baja la copia y comprueba que se puede importar. → { ok, why?, data, added } */
  async function load() {
    const pre = check(); if (pre) return pre;
    const a = auth();
    try {
      const no = await a; if (no) return no;
      const file = await findFile();
      const data = file && await download(file.id);
      if (!data) return fail('none');
      const m = G.DB.importSave(data, { dry: true });
      if (!m.ok) return fail(m.why === 'bad' ? 'damaged' : m.why);
      stamp(file.modifiedTime);
      return { ok: true, data, added: m.added };
    } catch (e) { return caught(e); }
  }

  // Fecha de la última copia en Drive, guardada en este aparato (ps.drive.<cuenta>).
  function stamp(t) { try { localStorage.setItem(K_AT + account(), JSON.stringify({ at: Date.parse(t) || Date.now() })); } catch (e) { /* nada */ } }
  function lastAt() { try { return (JSON.parse(localStorage.getItem(K_AT + account())) || {}).at || 0; } catch (e) { return 0; } }

  return {
    preload, save, load, lastAt,
    get configured() { return configured(); },
    get enabled() { return enabled(); },
    /** ¿Hará falta abrir la ventana de Google (sin permiso todavía, o caducado)? */
    get needsPopup() { return !hasToken(); }
  };
})();
