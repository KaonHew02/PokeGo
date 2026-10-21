const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = f => fs.readFileSync(path.join(root, f), 'utf8');
const SCRIPTS = ['js/core/firebase-config.js', 'js/core/google-config.js', 'js/data/pokedex.js', 'js/core/db.js', 'js/core/gdrive.js'];
const CODE = SCRIPTS.map(f => [f, source(f)]);

// Un navegador de mentira por "origen" (cada uno con su localStorage, como localhost y 127.0.0.1).
function browser(origin = 'http://localhost:8123') {
  const storage = {}, scripts = [];
  const u = new URL(origin);
  const ctx = {
    G: {}, console, TextEncoder, URL, URLSearchParams, setTimeout, clearTimeout, crypto: globalThis.crypto,
    location: { protocol: u.protocol, hostname: u.hostname }, navigator: { onLine: true }, addEventListener() {},
    localStorage: {
      getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); }, removeItem: k => { delete storage[k]; },
      key: i => Object.keys(storage)[i], get length() { return Object.keys(storage).length; }
    },
    document: { addEventListener() {}, createElement: () => ({ remove() {} }), head: { appendChild: el => scripts.push(el) } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const [f, code] of CODE) vm.runInContext(code, ctx, { filename: f });
  ctx.G.Game = { state: 'ui' };
  return { ctx, G: ctx.G, storage, scripts };
}
const json = v => JSON.parse(JSON.stringify(v));
// Lo que sale del vm es de otro "realm": se compara por su contenido.
const same = (actual, expected, msg) => assert.deepEqual(json(actual), expected, msg);

/** Cuenta nueva que ya ha hecho el test (su inicial y compañero). */
async function account(b, name, starter = 4) {
  await b.G.DB.ready();
  const r = await b.G.DB.register(name, 'pass1234');
  assert.equal(r.ok, true, r.error);
  const s = b.G.DB.save;
  s.owned[starter] = { at: Date.now(), from: 'starter' }; s.partner = starter; s.starter = starter;
  b.G.DB.commit();
  return s;
}
/** Juega un poco: monedas ganadas y gastadas (pasan por la libreta), Pokémon, runs. */
function play(b, { earn = 0, spend = 0, owned = [], shiny = [], runs = 1 } = {}) {
  const s = b.G.DB.save;
  if (earn) { s.coins += earn; b.G.DB.commit(); }
  if (spend) { s.coins -= spend; b.G.DB.commit(); }
  for (const d of owned) b.G.DB.grant(d, 'gacha');
  for (const d of shiny) b.G.DB.grantShiny(d, 'wild');
  s.stats.runs += runs; s.stats.totalKills += 100 * runs;
  b.G.DB.commit();
}
const stored = (b, name) => JSON.parse(b.storage['ps.save.' + name.toLowerCase()]);

test('export/import round-trip into a fresh account replaces it (and keeps its starter)', async () => {
  const a = browser();
  await account(a, 'Ash', 1);
  play(a, { earn: 1000, spend: 200, owned: [25, 150], shiny: [25], runs: 3 });
  a.G.DB.save.profile.title = 'Maestro'; a.G.DB.save.pity = { 1: 37 };
  const file = json(a.G.DB.exportSave());
  assert.equal(file.kind, 'save'); assert.equal(file.app, 'PokeGo'); assert.equal(file.v, 3); assert.equal(file.name, 'Ash');
  assert.equal(file.save.coins, 1300);

  // Otro origen (otro aparato para la libreta): cuenta recién creada.
  const b = browser('http://127.0.0.1:8123');
  const before = await account(b, 'Misty', 7);
  const created = before.created;
  const r = b.G.DB.importSave(file);
  assert.equal(r.ok, true); assert.equal(r.mode, 'replace');
  assert.equal(r.added, 3); assert.equal(r.shiny, 1);
  const s = b.G.DB.save;
  assert.equal(s, before, 'the live save object is kept (other modules hold it)');
  same(Object.keys(s.owned).sort(), ['1', '150', '25', '7']);
  assert.equal(s.coins, 1300); assert.equal(s.stats.runs, 3);
  assert.equal(s.profile.title, 'Maestro'); same(s.pity, { 1: 37 }); assert.equal(s.partner, 1);
  assert.equal(s.name, 'Misty'); assert.equal(s.created, created);
  assert.equal(stored(b, 'Misty').coins, 1300, 'committed to localStorage');
  // Otra vez la misma copia: no cambia nada.
  const again = b.G.DB.importSave(file);
  assert.equal(again.mode, 'merge'); assert.equal(again.added, 0); assert.equal(b.G.DB.save.coins, 1300);
});

test('importing into a played account merges: no owned Pokémon or coins are lost, and it is idempotent', async () => {
  // Las dos cuentas en el MISMO navegador: apuntan en el mismo aparato de la libreta.
  const b = browser();
  await account(b, 'Ash', 1);
  play(b, { earn: 1000, spend: 200, owned: [25], runs: 2 });
  const ash = json(b.G.DB.exportSave());
  await b.G.DB.logout();
  await account(b, 'Misty', 7);
  play(b, { earn: 300, spend: 600, owned: [133, 25], shiny: [133], runs: 5 });
  b.G.DB.save.stats.bestTime = 900;
  assert.equal(b.G.DB.save.coins, 200);
  const r = b.G.DB.importSave(ash);
  assert.equal(r.ok, true); assert.equal(r.mode, 'merge'); assert.equal(r.added, 1); assert.equal(r.coins, 1300);
  const s = b.G.DB.save;
  same(Object.keys(s.owned).sort(), ['1', '133', '25', '7']);
  assert.ok(s.shiny[133]);
  assert.equal(s.coins, 1500, 'both balances are kept');
  assert.equal(s.stats.runs, 5); assert.equal(s.stats.bestTime, 900);
  assert.equal(s.partner, 7); assert.equal(s.name, 'Misty');
  for (let i = 0; i < 3; i++) assert.equal(b.G.DB.importSave(ash).coins, 0);
  assert.equal(b.G.DB.save.coins, 1500);
  // Lo de después sigue contando, y volver a importar la copia no lo pisa.
  play(b, { earn: 50, spend: 20 });
  b.G.DB.importSave(ash);
  assert.equal(b.G.DB.save.coins, 1530);
  // Y al revés (Misty → Ash) no se cuenta dos veces lo de Ash.
  const misty = json(b.G.DB.exportSave());
  await b.G.DB.logout();
  assert.equal((await b.G.DB.login('Ash', 'pass1234')).ok, true);
  b.G.DB.importSave(misty);
  assert.equal(b.G.DB.save.coins, 1530);
  same(Object.keys(b.G.DB.save.owned).sort(), ['1', '133', '25', '7']);
});

test('restoring your own older backup keeps everything earned since', async () => {
  const b = browser();
  await account(b, 'Ash');
  play(b, { earn: 400, owned: [25] });
  const old = json(b.G.DB.exportSave());
  play(b, { earn: 100, spend: 300, owned: [26] });
  const r = b.G.DB.importSave(old);
  assert.equal(r.mode, 'merge'); assert.equal(r.added, 0); assert.equal(r.coins, 0);
  assert.equal(b.G.DB.save.coins, 700);
  assert.ok(b.G.DB.save.owned[26]);
});

test('bad, foreign and newer files are rejected without touching the save', async () => {
  const b = browser();
  await account(b, 'Ash');
  play(b, { earn: 100, owned: [25] });
  const good = json(b.G.DB.exportSave()), snap = JSON.stringify(b.G.DB.save);
  for (const bad of [null, 42, 'x', [], {}, { kind: 'save' }, { kind: 'save', save: {} }, { kind: 'save', save: { owned: [] } },
    { ...good, kind: 'settings' }, { ...good, app: 'OtroJuego' }]) {
    same(b.G.DB.importSave(bad), { ok: false, why: 'bad' });
  }
  assert.equal(b.G.DB.importSave({ ...good, v: 4 }).why, 'newer');
  assert.equal(b.G.DB.importSave({ ...good, save: { ...good.save, v: 99 } }).why, 'newer');
  assert.equal(JSON.stringify(b.G.DB.save), snap);
  // Datos raros dentro de una copia válida: se limpian, no rompen nada.
  const odd = json(good);
  Object.assign(odd.save, { owned: { 25: null, 9999: { at: 1 }, 6: { at: 5, from: 'gacha' } }, shiny: 'x', stats: { runs: 'NaN', totalKills: -5 },
    coins: -50, tickets: 7, pity: 3, led: 'x', profile: [] });
  const r = b.G.DB.importSave(odd);
  assert.equal(r.ok, true);
  const s = b.G.DB.save;
  assert.ok(s.owned[6] && s.owned[25] && !s.owned[9999]);
  assert.ok(Number.isFinite(s.coins) && s.coins >= 100);
  assert.equal(typeof s.stats.runs, 'number'); same(s.tickets, { t1: 0, t10: 0 });
  assert.ok(Array.isArray(s.profile.favs));
});

test('guests can export but not import; nothing is imported in the middle of a run', async () => {
  const b = browser();
  await b.G.DB.ready();
  b.G.DB.playAsGuest();
  b.G.DB.save.owned[4] = { at: 1, from: 'starter' }; b.G.DB.save.partner = 4;
  b.G.DB.save.coins = 2500; b.G.DB.save.stats.runs = 4;
  const file = json(b.G.DB.exportSave());
  assert.equal(file.name, 'Invitado'); assert.equal(file.save.coins, 2500);
  same(b.G.DB.importSave(file), { ok: false, why: 'guest' });
  await b.G.DB.logout();
  // Al crear la cuenta, se trae lo del invitado.
  await account(b, 'Brock', 1);
  b.G.Game.state = 'playing';
  same(b.G.DB.importSave(file), { ok: false, why: 'run' });
  b.G.Game.state = 'ui';
  const r = b.G.DB.importSave(file);
  assert.equal(r.mode, 'replace'); assert.equal(b.G.DB.save.coins, 2500); assert.equal(b.G.DB.save.stats.runs, 4);
  assert.ok(b.G.DB.save.owned[1] && b.G.DB.save.owned[4]);
});

test('dry run returns the merged copy without changing anything', async () => {
  const b = browser();
  await account(b, 'Ash');
  play(b, { earn: 100 });
  const other = browser('http://127.0.0.1:8123');
  await account(other, 'Ash2');
  play(other, { earn: 900, owned: [150] });
  const snap = JSON.stringify(b.G.DB.save);
  const r = b.G.DB.importSave(json(other.G.DB.exportSave()), { dry: true });
  assert.equal(r.ok, true); assert.equal(r.added, 1);
  assert.equal(JSON.stringify(b.G.DB.save), snap);
  assert.equal(r.data.kind, 'save'); assert.equal(r.data.name, 'Ash'); assert.equal(r.data.save.coins, 2000);   // las dos cuentas, enteras
  // Aplicarla después da lo mismo que importar directamente.
  b.G.DB.importSave(r.data);
  assert.equal(b.G.DB.save.coins, 2000);
});

// ---------------- Google Drive (fetch y Google Identity Services de mentira) ----------------

/** Un Google Drive en memoria con la parte de la API v3 que usa gdrive.js. */
function fakeDrive() {
  const files = new Map(), log = [];
  let n = 0, fail = null;
  const now = () => new Date(Date.UTC(2026, 9, 21, 10, 0, n++)).toISOString();
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  async function fetch(url, opts = {}) {
    const u = new URL(url), method = opts.method || 'GET';
    log.push([method, u.pathname, u.searchParams.toString(), opts.headers || {}]);
    if (fail) { const f = fail; fail = null; return f(); }
    if (!/^Bearer tok\d+$/.test((opts.headers || {}).Authorization || '')) return res(401, { error: { code: 401 } });
    const id = u.pathname.split('/files/')[1];
    if (method === 'GET' && !id) {
      const q = u.searchParams.get('q');
      assert.ok(q.includes('trashed = false'));
      const acc = /key='account' and value='([^']*)'/.exec(q);
      const list = [...files.values()].filter(f => !f.trashed && (q.includes("value='folder'")
        ? f.mimeType === 'application/vnd.google-apps.folder' && f.appProperties.pokego === 'folder'
        : f.appProperties.pokego === 'save' && f.appProperties.account === (acc && acc[1])));
      return res(200, { files: list.map(f => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime })) });
    }
    if (method === 'GET') {
      const f = files.get(id);
      return f && !f.trashed ? res(200, f.content) : res(404, { error: { code: 404 } });
    }
    if (method === 'POST' && u.pathname === '/drive/v3/files') {
      const meta = JSON.parse(opts.body), f = { ...meta, id: 'folder' + ++n, modifiedTime: now() };
      files.set(f.id, f);
      return res(200, { id: f.id });
    }
    if (method === 'POST') {
      assert.equal(u.searchParams.get('uploadType'), 'multipart');
      const b = /boundary=(\S+)/.exec(opts.headers['Content-Type'])[1];
      const parts = opts.body.split('--' + b).slice(1, -1).map(p => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
      const f = { ...JSON.parse(parts[0]), content: parts[1], id: 'file' + ++n, modifiedTime: now() };
      files.set(f.id, f);
      return res(200, { id: f.id, modifiedTime: f.modifiedTime });
    }
    if (method === 'PATCH') {
      const f = files.get(id);
      if (!f) return res(404, {});
      f.content = opts.body; f.modifiedTime = now();
      return res(200, { id, modifiedTime: f.modifiedTime });
    }
    return res(400, {});
  }
  return { files, log, fetch, failNext(f) { fail = f; }, res };
}

/** La ventana de Google: answer(cfg) decide qué contesta (por defecto, da el permiso). */
function fakeGoogle(b, drive) {
  const g = { requests: [], answer: null, tokens: 0 };
  b.ctx.fetch = drive.fetch;
  b.G.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  const oauth2 = {
    initTokenClient(cfg) {
      g.cfg = cfg;
      return { requestAccessToken(o) {
        g.requests.push(o);
        // Como la de verdad: contesta más tarde, cuando el jugador acepta en la ventana.
        setTimeout(() => (g.answer || (c => c.callback({ access_token: 'tok' + ++g.tokens, expires_in: 3599, scope: c.scope })))(cfg), 0);
      } };
    },
    hasGrantedAllScopes: (r, s) => (r.scope || '').split(' ').includes(s)
  };
  const ready = b.G.Drive.preload();
  // El script de Google llega por su etiqueta <script> (accounts.google.com/gsi/client).
  const el = b.scripts.at(-1);
  assert.equal(el.src, 'https://accounts.google.com/gsi/client');
  b.ctx.google = { accounts: { oauth2 } };
  el.onload();
  return ready.then(ok => { assert.equal(ok, true); return g; });
}

test('Drive: save creates a visible PokéGo folder and file, load imports it on another device', async () => {
  const drive = fakeDrive();
  const a = browser();
  await account(a, 'Ash', 1);
  play(a, { earn: 1000, spend: 200, owned: [25, 150], runs: 3 });
  const ga = await fakeGoogle(a, drive);
  assert.equal(ga.cfg.client_id, 'test-client.apps.googleusercontent.com');
  assert.equal(ga.cfg.scope, 'https://www.googleapis.com/auth/drive.file');
  assert.equal(a.G.Drive.enabled, true); assert.equal(a.G.Drive.needsPopup, true);
  const p = a.G.Drive.save();
  assert.equal(ga.requests.length, 1, 'the token is requested synchronously, inside the click');
  same(ga.requests[0], { prompt: '' });
  const r = await p;
  assert.equal(r.ok, true, r.why); assert.equal(r.created, true);
  const folder = [...drive.files.values()].find(f => f.mimeType === 'application/vnd.google-apps.folder');
  assert.equal(folder.name, 'PokéGo'); same(folder.parents, ['root']);
  const file = [...drive.files.values()].find(f => f.appProperties.pokego === 'save');
  assert.equal(file.name, 'pokego-Ash.json'); same(file.parents, [folder.id]);
  same(file.appProperties, { pokego: 'save', account: 'ash' });
  assert.equal(JSON.parse(file.content).save.coins, 1300);
  assert.equal(a.G.Drive.lastAt(), Date.parse(file.modifiedTime));
  assert.equal(a.G.Drive.needsPopup, false);
  // Segunda vez: el mismo archivo (PATCH) y sin volver a abrir la ventana.
  play(a, { earn: 10 });
  assert.equal((await a.G.Drive.save()).ok, true);
  assert.equal(ga.requests.length, 1);
  assert.equal([...drive.files.values()].length, 2);
  assert.ok(drive.log.some(([m]) => m === 'PATCH'));
  assert.equal(JSON.parse(file.content).save.coins, 1310);

  // Otro aparato, cuenta nueva con el mismo nombre: Cargar de Google Drive.
  const b = browser('http://127.0.0.1:8123');
  await account(b, 'ash', 7);
  const gb = await fakeGoogle(b, drive);
  const l = await b.G.Drive.load();
  assert.equal(l.ok, true, l.why); assert.equal(l.added, 3);
  assert.equal(b.G.DB.save.coins, 500, 'load only downloads; the UI imports after confirming');
  assert.equal(b.G.DB.importSave(l.data).mode, 'replace');
  assert.equal(b.G.DB.save.coins, 1310);
  assert.equal(gb.requests.length, 1);

  // Los dos juegan y guardan: al final los dos tienen lo de los dos.
  play(b, { earn: 500, owned: [133] });
  const rb = await b.G.Drive.save();
  assert.equal(rb.ok, true); assert.equal(rb.created, false);
  play(a, { earn: 40, spend: 30, owned: [6] });
  const ra = await a.G.Drive.save();
  assert.equal(ra.ok, true); assert.equal(ra.added, 2);   // el 133 y el inicial de b
  assert.equal((await b.G.Drive.save()).ok, true);
  for (const x of [a, b]) same(Object.keys(x.G.DB.save.owned).sort(), ['1', '133', '150', '25', '6', '7']);
  assert.equal(a.G.DB.save.coins, 1310 + 500 + 10);
  assert.equal(b.G.DB.save.coins, a.G.DB.save.coins);
  assert.equal(JSON.parse(file.content).save.coins, a.G.DB.save.coins);
  // Volver a guardar sin cambios no inventa monedas.
  await a.G.Drive.save(); await b.G.Drive.save(); await a.G.Drive.save();
  assert.equal(a.G.DB.save.coins, 1820); assert.equal(b.G.DB.save.coins, 1820);
});

test('Drive: clear errors for a closed or blocked window, denied permission, no file, network, expired token and API problems', async () => {
  const drive = fakeDrive();
  const b = browser();
  await account(b, 'Ash');
  const g = await fakeGoogle(b, drive);
  g.answer = c => c.error_callback({ type: 'popup_closed' });
  assert.equal((await b.G.Drive.save()).why, 'closed');
  g.answer = c => c.error_callback({ type: 'popup_failed_to_open' });
  assert.equal((await b.G.Drive.save()).why, 'blocked');
  g.answer = c => c.callback({ error: 'access_denied' });
  assert.equal((await b.G.Drive.load()).why, 'denied');
  g.answer = c => c.callback({ access_token: 'tok1', expires_in: 3599, scope: 'email' });   // Drive desmarcado
  assert.equal((await b.G.Drive.save()).why, 'denied');
  assert.equal(b.G.Drive.needsPopup, true);
  g.answer = null;
  assert.equal((await b.G.Drive.load()).why, 'none');
  assert.equal(b.G.Drive.needsPopup, false);
  drive.failNext(() => { throw new TypeError('Failed to fetch'); });
  assert.equal((await b.G.Drive.save()).why, 'net');
  drive.failNext(() => drive.res(503, 'busy'));
  assert.equal((await b.G.Drive.save()).why, 'net');
  drive.failNext(() => drive.res(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } }));
  assert.equal((await b.G.Drive.save()).why, 'api');
  drive.failNext(() => drive.res(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }));
  assert.equal((await b.G.Drive.save()).why, 'denied');
  assert.equal(b.G.Drive.needsPopup, true);
  // Token caducado (401): se olvida, y el siguiente clic vuelve a pedir el permiso.
  assert.equal((await b.G.Drive.save()).ok, true);
  const asked = g.requests.length;
  drive.failNext(() => drive.res(401, { error: { code: 401 } }));
  assert.equal((await b.G.Drive.save()).why, 'expired');
  assert.equal(b.G.Drive.needsPopup, true);
  assert.equal((await b.G.Drive.save()).ok, true);
  assert.equal(g.requests.length, asked + 1);
  // Copia dañada o de una versión más nueva: no se pisa ni se importa.
  const file = [...drive.files.values()].find(f => f.appProperties.pokego === 'save');
  const good = file.content;
  file.content = '{not json';
  assert.equal((await b.G.Drive.save()).why, 'damaged');
  assert.equal((await b.G.Drive.load()).why, 'damaged');
  assert.equal(file.content, '{not json');
  file.content = JSON.stringify({ ...JSON.parse(good), v: 9 });
  assert.equal((await b.G.Drive.save()).why, 'newer');
  // En plena partida o como invitado, ni se abre la ventana.
  const n = g.requests.length;
  b.G.Game.state = 'playing';
  assert.equal((await b.G.Drive.save()).why, 'run');
  b.G.Game.state = 'ui';
  await b.G.DB.logout();
  assert.equal(b.G.Drive.needsPopup, true, 'logging out forgets the token');
  b.G.DB.playAsGuest();
  assert.equal((await b.G.Drive.load()).why, 'guest');
  assert.equal(g.requests.length, n);
});

test('Drive is off without a client id or outside http(s)', () => {
  const b = browser();
  assert.equal(b.G.GOOGLE_CLIENT_ID, null);
  assert.equal(b.G.Drive.enabled, false); assert.equal(b.G.Drive.configured, false);
  b.G.GOOGLE_CLIENT_ID = 'x.apps.googleusercontent.com';
  assert.equal(b.G.Drive.enabled, true);
  const f = browser('file:///C:/PokeGo/index.html');
  f.G.GOOGLE_CLIENT_ID = 'x.apps.googleusercontent.com';
  assert.equal(f.G.Drive.configured, true); assert.equal(f.G.Drive.enabled, false);
  return f.G.Drive.preload().then(ok => { assert.equal(ok, false); assert.equal(f.scripts.length, 0); });
});

test('dev.html loads the backup scripts in order and allows only the Google Identity script origin', () => {
  const html = source('dev.html');
  const at = f => html.indexOf(`src="${f}"`);
  assert.ok(at('js/core/google-config.js') > 0 && at('js/core/google-config.js') < at('js/core/db.js'));
  assert.ok(at('js/core/db.js') < at('js/core/gdrive.js') && at('js/core/gdrive.js') < at('js/ui/settings-ui.js'));
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.ok(/script-src 'self'[^;]* https:\/\/accounts\.google\.com[ ;]/.test(csp));
  assert.ok(!/connect-src|default-src|frame-src/.test(csp), 'Drive API calls and the Google window need no other directive');
  assert.ok(fs.existsSync(path.join(root, 'docs', 'GOOGLE_DRIVE.md')));
});
