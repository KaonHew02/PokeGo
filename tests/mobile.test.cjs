const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = f => fs.readFileSync(path.join(root, f), 'utf8');
const json = v => JSON.parse(JSON.stringify(v));

// ---------------- joysticks (js/core/touch.js) ----------------

/** touch.js con un lienzo de mentira de 844x390. opts.pointers: navegador sin eventos touch. */
function pad(opts = {}) {
  const settings = { aimManual: false, stickMode: 'float', stick: 1, pad: null, ...opts.settings };
  const on = {}, doc = {};
  const cv = { clientWidth: 844, clientHeight: 390, addEventListener: (k, fn) => { on[k] = fn; }, setPointerCapture() {} };
  const ctx = { G: {}, Math, performance, addEventListener() {}, getComputedStyle: () => ({}),
    document: { body: { classList: { add() {} } }, addEventListener: (k, fn) => { doc[k] = fn; } } };
  ctx.window = opts.pointers ? {} : { ontouchstart: null };
  const G = ctx.G;
  G.Settings = { touch: true, get: k => settings[k] };
  G.Game = { state: 'playing' };
  G.Auto = { on: false };
  vm.createContext(ctx);
  vm.runInContext(source('js/core/touch.js'), ctx);
  G.Touch.init(cv);
  const t = (id, x, y) => ({ identifier: id, clientX: x, clientY: y });
  const fire = (k, ...list) => on[k]({ changedTouches: list, cancelable: true, preventDefault() {} });
  return { G, settings, on, doc, t,
    start: (id, x, y) => fire('touchstart', t(id, x, y)),
    drag: (id, x, y) => fire('touchmove', t(id, x, y)),
    lift: id => fire('touchend', t(id, 0, 0)),
    pointer: (k, id, x, y) => on[k]({ pointerType: 'touch', pointerId: id, clientX: x, clientY: y, preventDefault() {} }) };
}
const direction = v => (v ? [Math.sign(Math.round(v[0] * 10)), Math.sign(Math.round(v[1] * 10))] : null);

test('joystick: without manual aim the whole screen moves you, as always', () => {
  const p = pad();
  assert.equal(p.G.Touch.vector(), null);
  p.start(1, 700, 200);
  p.drag(1, 760, 200);
  assert.deepEqual(direction(p.G.Touch.vector()), [1, 0]);
  assert.equal(p.G.Touch.aim(), null);
  p.lift(1);
  assert.equal(p.G.Touch.vector(), null);
});

test('manual aim: the right half aims, the left half moves, and lifting the finger goes back to aiming on its own', () => {
  const p = pad({ settings: { aimManual: true } });
  p.start(1, 100, 200); p.drag(1, 100, 120);
  p.start(2, 650, 200);
  assert.equal(p.G.Touch.aim(), null, 'not dragged yet: it still aims on its own');
  p.drag(2, 590, 200);
  assert.deepEqual(direction(p.G.Touch.vector()), [0, -1]);
  assert.deepEqual(direction(p.G.Touch.aim()), [-1, 0]);
  // Back over the centre: the last direction stays (no twitching).
  p.drag(2, 585, 200); p.drag(2, 640, 203);
  p.drag(2, 588, 200);
  assert.deepEqual(direction(p.G.Touch.aim()), [-1, 0]);
  p.lift(2);
  assert.equal(p.G.Touch.aim(), null);
  assert.deepEqual(direction(p.G.Touch.vector()), [0, -1], 'the other finger keeps moving');
  p.lift(1);
  // A third finger on the right while aiming does not take over.
  p.start(3, 500, 100); p.drag(3, 500, 40); p.start(4, 800, 300); p.drag(4, 810, 390);
  assert.deepEqual(direction(p.G.Touch.aim()), [0, -1]);
  assert.equal(p.G.Touch.vector(), null);
});

test('manual aim: the second finger needs no pointerdown (iPhone sometimes never sends it)', () => {
  const p = pad({ settings: { aimManual: true } });
  p.pointer('pointerdown', 7, 100, 200);        // ignored: touch events carry the fingers here
  assert.equal(p.G.Touch.stick, null);
  p.start(1, 100, 200); p.start(2, 700, 200); p.drag(2, 760, 200);
  assert.ok(p.G.Touch.stick);
  assert.deepEqual(direction(p.G.Touch.aim()), [1, 0]);
});

test('browsers without touch events still work with pointer events', () => {
  const p = pad({ pointers: true, settings: { aimManual: true } });
  p.pointer('pointerdown', 1, 100, 200); p.pointer('pointermove', 1, 100, 260);
  p.pointer('pointerdown', 2, 700, 200); p.pointer('pointermove', 2, 760, 200);
  assert.deepEqual(direction(p.G.Touch.vector()), [0, 1]);
  assert.deepEqual(direction(p.G.Touch.aim()), [1, 0]);
  p.pointer('pointerup', 2, 0, 0);
  assert.equal(p.G.Touch.aim(), null);
  p.pointer('pointerup', 1, 0, 0);
  assert.equal(p.G.Touch.vector(), null);
});

test('manual aim with AUTO on: no second joystick, a finger on the right just moves you', () => {
  const p = pad({ settings: { aimManual: true } });
  p.G.Auto.on = true;
  p.start(1, 700, 200); p.drag(1, 760, 200);
  assert.deepEqual(direction(p.G.Touch.vector()), [1, 0]);
  assert.equal(p.G.Touch.aim(), null);
});

test('manual aim with the fixed joystick: near it you move, anywhere else you aim', () => {
  const p = pad({ settings: { aimManual: true, stickMode: 'fixed' } });
  const b = p.G.Touch.stickBase();
  p.start(1, b.x + 20, b.y); p.drag(1, b.x + 50, b.y);
  assert.deepEqual(direction(p.G.Touch.vector()), [1, 0]);
  assert.equal(p.G.Touch.aim(), null);
  p.start(2, b.x + 300, b.y); p.drag(2, b.x + 300, b.y + 60);   // left half, but far from it
  assert.deepEqual(direction(p.G.Touch.aim()), [0, 1]);
  // Without manual aim, far from it does nothing.
  p.settings.aimManual = false;
  p.lift(1); p.lift(2);
  p.start(3, 500, 100);
  assert.equal(p.G.Touch.stick, null);
});

test('with cards open a finger outside the box grabs the joystick and you walk on when they close', () => {
  const p = pad();
  let pressed = 0;
  p.G.Touch.addButton(0, 0, 200, 200, () => pressed++, 0);
  for (const state of ['levelup', 'choice']) {
    p.G.Game.state = state;
    p.start(1, 100, 100); p.drag(1, 160, 100);
    assert.equal(pressed, 0, 'the HUD under the cards is not pressed');
    assert.deepEqual(direction(p.G.Touch.vector()), [1, 0]);
    p.G.Game.state = 'playing';
    assert.deepEqual(direction(p.G.Touch.vector()), [1, 0], 'the finger is still on the joystick');
    p.lift(1);
  }
  p.G.Game.state = 'held';
  p.start(1, 300, 300);
  assert.ok(p.G.Touch.stick, 'also while someone else is choosing');
  p.lift(1);
  p.G.Game.state = 'playing';
  p.start(2, 100, 100);
  assert.equal(pressed, 1, 'in the run the HUD buttons work');
  assert.equal(p.G.Touch.stick, null);
  for (const state of ['ui', 'paused', 'over']) {
    p.G.Game.state = state;
    p.start(3, 500, 300);
    assert.equal(p.G.Touch.stick, null, state);
  }
});

test('reset and a lost touchend let go of both joysticks', () => {
  const p = pad({ settings: { aimManual: true } });
  p.start(1, 100, 200); p.start(2, 700, 200); p.drag(2, 760, 200);
  p.G.Touch.reset();
  assert.equal(p.G.Touch.vector(), null); assert.equal(p.G.Touch.aim(), null);
  p.drag(2, 700, 100);
  assert.equal(p.G.Touch.aim(), null);
  p.start(3, 100, 200); p.start(4, 700, 200); p.drag(4, 760, 200);
  p.doc.touchend({ touches: [] });
  assert.equal(p.G.Touch.vector(), null); assert.equal(p.G.Touch.aim(), null);
});

test('cards let touches through outside their box, and the Accessibility tab is back on touch screens', () => {
  const css = source('css/style.css');
  assert.ok(/#scr-levelup, #scr-bond, #scr-item \{ pointer-events: none; \}/.test(css));
  assert.ok(/#scr-levelup \.box, #scr-bond \.box, #scr-item \.box \{ pointer-events: auto; \}/.test(css));
  assert.ok(!source('js/ui/settings-ui.js').includes('[data-t="a11y"]'));
});

test('a double tap does not zoom: touch-action is on every element, not only on body', () => {
  // WebKit empieza de cero en cada elemento con scroll, y .box tiene overflow: auto.
  assert.ok(/^\* \{ touch-action: manipulation; \}/m.test(source('css/style.css')));
});

// ---------------- Atrás en la web (js/core/native.js) ----------------

/** native.js con un historial de mentira: `prev` entradas antes de la página (fuera del juego). */
function web({ touch = true, app = false, prev = 1, navigator = {} } = {}) {
  const on = {}, log = [];
  const stack = [...Array(prev).fill('other'), null];
  let i = prev, gone = false;
  const pop = () => setImmediate(() => { if (stack[i] === 'other') gone = true; else on.popstate({ state: stack[i] }); });
  const history = {
    get state() { return stack[i] === 'other' ? null : stack[i]; },
    pushState(s) { stack.length = i + 1; stack.push(s); i++; },
    back() { this.go(-1); },
    go(n) { if (i + n < 0 || i + n >= stack.length) return; i += n; pop(); }
  };
  const ctx = { G: {}, console, history, navigator, document: { addEventListener() {}, getElementById: () => ({ click: () => log.push('again') }) },
    addEventListener: (k, fn) => { (on[k] = on[k] || fn); } };
  ctx.window = ctx;
  if (app) ctx.Capacitor = { isNativePlatform: () => true, Plugins: { App: { addListener() {} } } };
  const G = ctx.G, st = { top: 'scr-menu' };
  G.Settings = { touch };
  G.Pad = { topScreen: () => (st.top ? { id: st.top } : null), back: () => log.push('pad.back') };
  G.Game = { state: 'ui', togglePause() { log.push('pause'); G.Game.state = 'paused'; st.top = 'scr-pause'; } };
  G.UI = { isOpen: id => id === st.top, toast() {} };
  G.GachaUI = { open_: false, escape: () => log.push('gacha') };
  vm.createContext(ctx);
  vm.runInContext(source('js/core/native.js'), ctx);
  return { G, on, log, st, history, stack,
    tap() { on.touchend && on.touchend({}); },
    async press() { history.back(); for (let n = 0; n < 6; n++) await new Promise(r => setImmediate(r)); },
    get gone() { return gone; } };
}

test('web back: in a run it pauses and stays paused, with cards open it does nothing', async () => {
  const w = web();
  w.tap();
  w.G.Game.state = 'playing'; w.st.top = null;
  await w.press();
  assert.deepEqual(w.log, ['pause']);
  await w.press();
  await w.press();
  assert.deepEqual(w.log, ['pause'], 'a second press does not resume the run');
  assert.equal(w.gone, false);
  w.log.length = 0;
  w.tap();
  for (const [state, top] of [['levelup', 'scr-levelup'], ['choice', 'scr-item'], ['choice', 'scr-bond']]) {
    w.G.Game.state = state; w.st.top = top;
    await w.press();
    assert.deepEqual(w.log, [], top);
  }
  assert.equal(w.gone, false);
});

test('web back: a menu screen goes back to the menu, windows close, the summary leaves, and only the main menu leaves the site', async () => {
  const w = web();
  w.tap();
  w.st.top = 'scr-shop';
  await w.press();
  assert.deepEqual(w.log, ['pad.back']);
  w.G.Game.state = 'paused'; w.st.top = 'scr-settings';
  await w.press();
  assert.deepEqual(w.log, ['pad.back', 'pad.back'], 'settings over the pause close');
  w.log.length = 0;
  w.G.Game.state = 'over'; w.st.top = 'scr-over';
  await w.press();
  assert.deepEqual(w.log, ['again']);
  w.log.length = 0;
  w.G.Game.state = 'ui'; w.st.top = 'scr-gacha'; w.G.GachaUI.open_ = true;
  await w.press();
  assert.deepEqual(w.log, ['gacha']);
  w.G.GachaUI.open_ = false; w.st.top = 'scr-menu';
  assert.equal(w.gone, false);
  await w.press();
  assert.equal(w.gone, true, 'one press on the main menu leaves');
  assert.deepEqual(w.log, ['gacha']);
});

test('web back: with nothing before the game it stays, and the next touch sets everything up again', async () => {
  const w = web({ prev: 0 });
  w.tap();
  await w.press();
  assert.equal(w.gone, false);
  assert.equal(w.history.state, null);
  w.tap();
  w.G.Game.state = 'playing'; w.st.top = null;
  await w.press();
  assert.deepEqual(w.log, ['pause']);
});

test('web back: entries are added only after a touch, only on touch screens and never in the app', () => {
  const w = web();
  assert.equal(w.stack.length, 2, 'not on load: Chrome would skip them');
  w.tap();
  assert.equal(w.stack.length, 7);
  w.tap();
  assert.equal(w.stack.length, 7, 'no more than needed');
  const pc = web({ touch: false });
  pc.tap();
  assert.equal(pc.stack.length, 2);
  // iPhone from the Home Screen: no back button, and history would wake up the edge swipe in the middle of a run.
  const home = web({ navigator: { standalone: true } });
  home.tap();
  assert.equal(home.stack.length, 2);
  const app = web({ app: true });
  assert.equal(app.on.popstate, undefined);
  assert.equal(app.on.touchend, undefined);
});

// ---------------- resumen de cada uno (js/net/coop.js) ----------------

function coopRoom(uid) {
  const sent = [], clock = { now: 0 }, net = {}, G = {};
  G.Net = { uid, on: fn => { net.msg = fn; }, onPeer() {}, slow: () => false, BUF_HIGH: 65536, backlog: () => 0,
    send: (to, f) => !!sent.push([to, f]), toHost: f => !!sent.push(['host', f]) };
  G.Player = class { constructor() { this.maxHp = 300; } };
  G.DEX_BY = { 25: { dex: 25 } }; G.baseStartOf = () => 'tackle';
  G.Sprites = { preload() {} }; G.Social = { me: null };
  G.U = { dist2: () => 0 };
  G.EnemyMgr = { all: () => [], get: () => null };
  G.Judgment = { netState: () => null }; G.Projectiles = { clearOrbs() {} }; G.Spawner = { say() {} };
  G.Moves = { BY_ID: { tackle: { name: 'Placaje', type: 'normal', cat: 'physical' }, 'swords-dance': { name: 'Danza Espada', type: 'normal', cat: null },
    ember: { name: 'Ascuas', type: 'fire', cat: 'special' } }, EVO: { ember: ['Infierno'] } };
  G.Items = { BY: { leftovers: { name: 'Restos' } } };
  new Function('G', 'document', 'performance', source('js/net/coop.js'))(G, { addEventListener() {} }, { now: () => clock.now });
  const local = { x: 0, y: 0, moveAngle: 0, walking: false, hp: 300, maxHp: 300, dead: false, magnet: 78, aim: 0, xpMul: 1, reviveT: 0,
    activeGroup: () => [], item: 'leftovers', moves: [{ id: 'tackle', lvl: 3, dealt: 1234.6, since: 2.4 }, { id: 'ember', lvl: 5, dealt: 50, since: 40, evolved: true }] };
  const api = { specAt: () => null, choosing: () => false, syncTeam() {}, levelStart() {}, resume() {}, waiting() {}, lost() {},
    over() {}, summary: () => ({ t: 9 }), team: () => ({ time: 1, level: 1, xp: 0, xpNext: 9, kills: 0, bosses: 0, coins: 0, t1: 0, t10: 0 }) };
  const members = [{ uid: 'host', name: 'Hugo', dex: 25 }, { uid: 'a', name: 'Ana', dex: 25 }, { uid: 'b', name: '<b>Bea', dex: 25 }];
  G.Coop.begin({ host: 'host', members }, local, api);
  sent.length = 0;
  const events = () => sent.flatMap(([to, f]) => (f.ev || []).map(e => [to, json(e)])).filter(([, e]) => e[0] === 'rs');
  return { C: G.Coop, sent, net, local, clock, events };
}
const hostFrame = ev => ({ k: 'f', t: 1, lv: 1, xp: 0, xn: 9, ki: 0, bo: 0, co: 0, tk: [0, 0], p: {}, e: [], ev, ho: [] });

test('co-op summary: everyone sends theirs during the run, only when it changes, and the host passes it on', () => {
  const guest = coopRoom('a');
  guest.C.tick(1); assert.deepEqual(guest.events(), [], 'not every frame');
  guest.C.tick(1);
  assert.deepEqual(guest.events(), [['host', ['rs', ['leftovers', [['tackle', 3, 1235, 2, 0], ['ember', 5, 50, 40, 1]]]]]]);
  guest.sent.length = 0;
  guest.C.tick(2); guest.C.tick(2);
  assert.deepEqual(guest.events(), [], 'nothing new, nothing sent');
  guest.local.moves[0].dealt = 2000;
  guest.C.tick(2);
  assert.equal(guest.events().length, 1);

  const host = coopRoom('host');
  host.net.msg('a', { k: 'f', p: [], ev: [['rs', ['leftovers', [['tackle', 3, 1235, 2, 0]]]]] });
  host.C.tick(1 / 15);
  const passed = host.events();
  assert.deepEqual(passed.map(([to]) => to), ['b'], 'to the others, not back to its owner');
  assert.deepEqual(passed[0][1], ['rs', 'a', ['leftovers', [['tackle', 3, 1235, 2, 0]]]]);
  host.sent.length = 0;
  host.C.tick(3);
  assert.deepEqual(host.events().map(([to]) => to).sort(), ['a', 'b'], "and its own to everyone");
});

test('co-op summary: what arrives over the network is checked, and it survives the end of the run', () => {
  const c = coopRoom('a');
  c.net.msg('host', hostFrame([
    ['rs', 'host', ['nope', [['tackle', 1e99, -5, 'x', 0], ['constructor', 1, 1, 1, 0], 'x', ['ember', 2, 9000, 30, 1], ['<img>', 1, 1, 1, 0]]]],
    ['rs', 'b', ['leftovers', [['swords-dance', 2, 0, 0, 0]]]],
    ['rs', 'stranger', ['', []]],
    ['rs', 'b2'], ['rs']
  ]));
  c.C.end();
  const list = json(c.C.summaries());
  assert.deepEqual(list.map(p => p.uid), ['host', 'b']);
  assert.equal(list[0].item, '');
  assert.deepEqual(list[0].moves, [
    { id: 'tackle', lvl: 99, dealt: 0, since: 0, name: 'Placaje', type: 'normal', cat: 'physical' },
    { id: 'ember', lvl: 2, dealt: 9000, since: 30, name: 'Infierno', type: 'fire', cat: 'special' }]);
  assert.equal(list[1].item, 'leftovers'); assert.equal(list[1].name, '<b>Bea'); assert.equal(list[1].moves[0].cat, null);
});

test('co-op summary: leaving or ending sends yours first, and older clients are not bothered', () => {
  const guest = coopRoom('a');
  guest.C.leave();
  const ev = guest.sent.flatMap(([, f]) => f.ev).map(e => e[0]);
  assert.ok(ev.indexOf('rs') >= 0 && ev.indexOf('rs') < ev.indexOf('bye'));
  const host = coopRoom('host');
  host.C.over({ t: 9 });
  const hv = host.sent.filter(([to]) => to === 'a').flatMap(([, f]) => f.ev).map(e => e[0]);
  assert.ok(hv.indexOf('rs') >= 0 && hv.indexOf('rs') < hv.indexOf('ov'));
  // A player without `moves` (test doubles, or nothing to tell): nothing is sent and nothing breaks.
  const quiet = coopRoom('a');
  delete quiet.local.moves;
  quiet.C.tick(5); quiet.C.tick(5);
  assert.deepEqual(quiet.events(), []);
  // Older versions treat 'rs' like any event they do not know: skipped, and the frame goes on.
  const old = coopRoom('a');
  old.net.msg('host', hostFrame([['zz', 1, [2]], ['rs', 'b', ['leftovers', []]]]));
  assert.deepEqual(json(old.C.summaries()).map(p => p.uid), ['b']);
  const oldHost = coopRoom('host');
  oldHost.net.msg('a', { k: 'f', p: [], ev: [['zz', 1], ['rs', ['', []]]] });
  assert.deepEqual(json(oldHost.C.summaries()).map(p => p.uid), ['a']);
});

// ---------------- dos pestañas (js/core/db.js) ----------------

/** Una nube de mentira en memoria con lo que usa db.js de Firebase (nunca el proyecto de verdad). */
function fakeCloud() {
  const cloud = { doc: null, writes: 0 }, user = { uid: 'u1', displayName: 'Ash', email: '', providerData: [] };
  const ref = { get: async () => ({ exists: !!cloud.doc, data: () => json(cloud.doc) }) };
  const tx = { get: r => r.get(), set: (r, d) => { cloud.doc = json(d); cloud.writes++; } };
  const auth = { setPersistence: async () => {}, onAuthStateChanged: fn => { setImmediate(() => fn(user)); return () => {}; }, currentUser: user };
  const fsDb = { settings() {}, collection: () => ({ doc: () => ref }), runTransaction: fn => fn(tx) };
  cloud.firebase = { initializeApp() {}, auth: Object.assign(() => auth, { Auth: { Persistence: { LOCAL: 1 } } }),
    firestore: Object.assign(() => fsDb, { FieldValue: { serverTimestamp: () => 0 } }) };
  return cloud;
}

/** Pestañas del mismo navegador: un solo localStorage y cada una con su partida en memoria. */
function browserTabs(cloud = null) {
  const storage = {}, tabs = [];
  const CODE = ['js/data/pokedex.js', 'js/core/db.js'].map(f => [f, source(f)]);
  function open() {
    const on = {}, doc = {};
    const ctx = { G: {}, console, TextEncoder, URL, clearTimeout, crypto: globalThis.crypto,
      // (Las subidas se programan a 30 min: esos relojes no deben dejar la prueba abierta.)
      setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (ms > 1000) t.unref(); return t; },
      location: { protocol: 'http:', hostname: 'localhost' }, navigator: { onLine: true },
      addEventListener: (k, fn) => { on[k] = fn; },
      localStorage: {
        getItem: k => (k in storage ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); tabs.filter(t => t !== tab).forEach(t => t.inbox.push(k)); },
        removeItem: k => { delete storage[k]; }, key: i => Object.keys(storage)[i], get length() { return Object.keys(storage).length; }
      },
      document: { addEventListener: (k, fn) => { doc[k] = fn; }, createElement: () => ({ remove() {} }), head: { appendChild: el => setImmediate(el.onload) }, hidden: false } };
    ctx.window = ctx;
    ctx.G.FIREBASE_CONFIG = cloud ? { apiKey: 'x', projectId: 'y' } : null;
    if (cloud) ctx.firebase = cloud.firebase;
    vm.createContext(ctx);
    for (const [f, code] of CODE) vm.runInContext(code, ctx, { filename: f });
    ctx.G.Game = { state: 'ui' };
    const refreshed = [];
    ctx.G.UI = { refreshCoins: () => refreshed.push(1) };
    const tab = { G: ctx.G, on, doc, inbox: [], refreshed, get s() { return ctx.G.DB.save; },
      // Lo que el navegador le entrega ahora (una pestaña dormida se queda con la bandeja llena).
      deliver() { for (const key of tab.inbox.splice(0)) on.storage({ key }); } };
    tabs.push(tab);
    return tab;
  }
  return { storage, open };
}
async function twoTabs() {
  const b = browserTabs(), a = b.open(), c = b.open();
  await a.G.DB.ready();
  assert.equal((await a.G.DB.register('Ash', 'pass1234')).ok, true);
  a.s.owned[4] = { at: 1, from: 'starter' }; a.s.partner = 4; a.s.starter = 4;
  a.G.DB.commit();
  await c.G.DB.ready();
  assert.equal((await c.G.DB.login('Ash', 'pass1234')).ok, true);
  a.inbox.length = 0; c.inbox.length = 0;
  return { ...b, a, c, disk: () => JSON.parse(b.storage['ps.save.ash']) };
}
const earn = (t, n) => { t.s.coins += n; t.G.DB.commit(); };

test('two tabs: what is earned or spent in one reaches the other at once and is never lost', async () => {
  const { a, c, disk } = await twoTabs();
  earn(a, 100); c.deliver();
  assert.equal(c.s.coins, 600);
  assert.ok(c.refreshed.length > 0, 'the coins on screen change too');
  earn(c, -250); a.deliver();
  assert.equal(a.s.coins, 350);
  a.G.DB.grant(25, 'gacha'); a.G.DB.commit(); c.deliver();
  c.G.DB.grantShiny(133, 'wild'); c.G.DB.commit(); a.deliver();
  for (const t of [a, c]) { assert.ok(t.s.owned[25] && t.s.owned[133] && t.s.shiny[133]); assert.equal(t.s.coins, 350); }
  assert.equal(disk().coins, 350);
});

test('two tabs: a tab that was asleep adds what it earned to what the other saved', async () => {
  const { a, c, disk } = await twoTabs();
  earn(a, 100);                     // c no se ha enterado
  a.s.tickets.t1 += 3; a.G.DB.commit();
  a.s.stats.runs = 9; a.G.DB.grant(25, 'gacha'); a.G.DB.commit();
  assert.equal(c.s.coins, 500);
  c.s.coins += 30; c.s.tickets.t1 += 1; c.G.DB.grant(133, 'gacha');
  c.G.DB.commit();
  assert.equal(c.s.coins, 630, '+100 and +30, not the larger of the two');
  assert.equal(c.s.tickets.t1, 4);
  assert.equal(c.s.stats.runs, 9);
  assert.ok(c.s.owned[25] && c.s.owned[133]);
  assert.equal(disk().coins, 630);
  a.deliver();
  assert.equal(a.s.coins, 630); assert.equal(a.s.tickets.t1, 4); assert.ok(a.s.owned[133]);
});

test('two tabs: the bag and TMs, spending in both, and what is still unsaved in memory', async () => {
  const { a, c, disk } = await twoTabs();
  a.s.bag.mint = 5; a.s.tms.tackle = 2; a.G.DB.commit(); c.deliver();
  assert.equal(c.s.bag.mint, 5); assert.equal(c.s.tms.tackle, 2);
  a.s.bag.mint -= 1; a.G.DB.commit();
  c.s.bag.mint -= 2; c.s.tms.tackle -= 1; c.G.DB.commit();
  a.deliver();
  for (const t of [a, c]) { assert.equal(t.s.bag.mint, 2); assert.equal(t.s.tms.tackle, 1); }
  // Con cambios aún sin guardar en memoria, lo que llega de la otra no los pisa.
  a.s.coins += 40;
  earn(c, 7); a.deliver();
  assert.equal(a.s.coins, 547);
  a.G.DB.commit(); c.deliver();
  assert.equal(c.s.coins, 547); assert.equal(disk().coins, 547);
});

test('two tabs: passing changes does not write, repeat or inflate anything', async () => {
  const { a, c, storage } = await twoTabs();
  earn(a, 100);
  const before = storage['ps.save.ash'];
  c.deliver();
  assert.equal(storage['ps.save.ash'], before, 'the tab that receives does not write: they do not answer each other');
  assert.equal(a.inbox.length, 0);
  const ledger = JSON.stringify(c.s.led);
  for (let i = 0; i < 5; i++) { c.on.storage({ key: 'ps.save.ash' }); c.doc.visibilitychange(); c.on.focus(); c.on.pageshow(); }
  assert.equal(JSON.stringify(c.s.led), ledger);
  for (let i = 0; i < 6; i++) { earn(a, 1); c.deliver(); earn(c, 1); a.deliver(); }
  assert.equal(a.s.coins, 612); assert.equal(c.s.coins, 612);
  c.on.storage({ key: 'ps.settings' }); c.on.storage({ key: null });
  assert.equal(c.s.coins, 612);
});

test('two tabs: what you just chose in a tab wins, and a change in the other one arrives', async () => {
  const { a, c } = await twoTabs();
  a.G.DB.grant(25, 'gacha'); a.G.DB.grant(133, 'gacha'); a.G.DB.commit(); c.deliver();
  await new Promise(r => setTimeout(r, 3));
  a.s.partner = 25; a.G.DB.commit(); c.deliver();
  assert.equal(c.s.partner, 25);
  // c cambia de compañero sin haberse enterado de lo último de a: gana lo que se acaba de hacer.
  await new Promise(r => setTimeout(r, 3));
  a.s.profile.title = 'Maestro'; a.G.DB.commit();
  await new Promise(r => setTimeout(r, 3));
  c.s.partner = 133; c.G.DB.commit();
  assert.equal(c.s.partner, 133);
  a.deliver();
  assert.equal(a.s.partner, 133);
});

test('two tabs: coming back to a tab catches up; a broken copy is kept aside, guests and other accounts stay out', async () => {
  const { a, c, storage } = await twoTabs();
  earn(a, 100);
  c.inbox.length = 0;                     // el aviso se ha perdido
  c.doc.visibilitychange();
  assert.equal(c.s.coins, 600);
  // Copia que no se puede leer: no se toca nada y se aparta.
  a.inbox.length = 0;
  const good = storage['ps.save.ash'];
  storage['ps.save.ash'] = '{roto';
  c.on.storage({ key: 'ps.save.ash' });
  assert.equal(c.s.coins, 600);
  assert.equal(storage['ps.rescue.ps.save.ash'], '{roto');
  earn(c, 5);
  assert.equal(JSON.parse(storage['ps.save.ash']).coins, 605);
  delete storage['ps.rescue.ps.save.ash'];
  assert.ok(good);
  // Invitado: su partida es sólo de memoria.
  await c.G.DB.logout();
  c.G.DB.playAsGuest();
  c.s.coins = 1;
  earn(a, 10); c.deliver();
  assert.equal(c.s.coins, 1);
});

test('two tabs with the cloud: the browser copy is what they share, everything is uploaded once and they do not keep waking each other', async () => {
  const cloud = fakeCloud(), b = browserTabs(cloud);
  const a = b.open(), c = b.open();
  const KEY = 'ps.cloud.u1', disk = () => JSON.parse(b.storage[KEY]);
  assert.equal(await a.G.DB.ready(), true);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(cloud.writes, 1, 'the new account goes up');
  assert.equal(await c.G.DB.ready(), true);
  a.inbox.length = 0; c.inbox.length = 0;
  assert.equal(a.G.DB.mode, 'cloud');
  a.s.owned[4] = { at: 1, from: 'starter' }; a.s.partner = 4;
  earn(a, 100); c.deliver();
  assert.equal(c.s.coins, 600); assert.ok(c.s.owned[4]);
  assert.equal(c.G.DB.syncState, 'pending', 'it can also be uploaded from here, in case the other tab closes first');
  earn(c, 30); a.deliver();
  assert.equal(a.s.coins, 630);
  // Una pestaña dormida que sube: se junta antes, y su copia no pisa a la otra.
  earn(a, 7);
  b.storage['ps.cloudok.u1'] = '0';
  await c.G.DB.flush();
  assert.equal(cloud.doc.save.coins, 637);
  assert.equal(disk().coins, 637);
  a.deliver();
  assert.equal(a.s.coins, 637);
  // La copia que escribe al acabar la subida no es un cambio nuevo: la otra no vuelve a subir por ella.
  b.storage['ps.cloudok.u1'] = '0';
  await a.G.DB.flush();
  const writes = cloud.writes;
  c.deliver();
  assert.equal(c.G.DB.syncState, 'ok');
  a.deliver();
  assert.equal(a.G.DB.syncState, 'ok');
  assert.equal(cloud.writes, writes);
  assert.equal(cloud.doc.save.coins, 637);
});

test('two tabs: exporting and importing start from what the other tab saved', async () => {
  const { a, c } = await twoTabs();
  earn(a, 100); a.G.DB.grant(25, 'gacha'); a.G.DB.commit();
  const file = json(c.G.DB.exportSave());
  assert.equal(file.save.coins, 600); assert.ok(file.save.owned[25]);
  earn(a, 11);
  assert.equal(c.G.DB.importSave(file).ok, true);
  assert.equal(c.s.coins, 611);
});
