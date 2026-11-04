// Cooperativo con conexiones malas: js/net/coop.js, net.js, coderoom.js, social.js y social-ui.js de
// verdad, con la red, el servidor de salas y la base de datos falsos. Ninguna prueba toca la red.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fakeClock, peerServer, browser } = require('./net-peerfake.cjs');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const CLOSED = 'La sala se ha cerrado';
const LOST = 'Se ha perdido la conexión con el anfitrión.';
const WAIT_NOTE = 'Los demás siguen jugando: espera aquí y, cuando acaben, seguís juntos.';
const state = (x, y, dead = 0) => [x, y, 0, 0, dead ? 0 : 300, 300, dead, 'thundershock', 1, 78, 0, 1, 0, 0, 0];

/** Lo que coop.js necesita del juego y coop.js de verdad sobre ese G. */
function addCoop(G, clock, enemies = []) {
  const log = { said: [], lost: [], away: [], over: [] };
  G.Player = class { constructor() { this.maxHp = 300; } };
  G.DEX_BY = Object.assign({ 25: { dex: 25 } }, G.DEX_BY);
  G.baseStartOf = () => 'thundershock';
  G.Sprites = { preload() {} };
  G.U = { dist2: (x, y, a, b) => (x - a) ** 2 + (y - b) ** 2, clamp: (v, a, b) => Math.max(a, Math.min(b, v)) };
  G.EnemyMgr = { all: () => enemies, get: id => enemies.find(e => e.id === id) || null, removeRemote() {}, addRemote() {} };
  G.Judgment = { netState: () => null };
  G.Projectiles = { clearOrbs() {}, spawn() {} };
  G.Spawner = { say: t => log.said.push(t) };
  G.VFX = { forType: () => null };
  G.Flow = G.Flow || { startCoop() {} };
  G.Social = G.Social || { me: null };
  new Function('G', 'document', 'performance', source('js/net/coop.js'))(G, { addEventListener() {} }, { now: () => clock.now });
  const local = { x: 0, y: 0, moveAngle: 0, walking: false, hp: 300, maxHp: 300, dead: false, magnet: 78, aim: 0,
    xpMul: 1, reviveT: 0, activeGroup: () => [{ id: 'thundershock', lvl: 1 }] };
  const api = { specAt: () => null, choosing: () => false, syncTeam() {}, levelStart() {}, resume() {}, waiting() {},
    team: () => ({ time: 1, level: 1, xp: 0, xpNext: 9, kills: 0, bosses: 0, coins: 0, t1: 0, t10: 0 }),
    away: n => log.away.push(n), lost: m => log.lost.push(m), over: d => log.over.push(d) };
  return { log, local, api, begin: cfg => G.Coop.begin(cfg, local, api) };
}

// ---------------- coop.js con una red de mentira ----------------

/** `uid` juega en una sala de host + a + b; net.jam / net.down como en net.test.cjs. */
function sim(uid, enemies) {
  const clock = { now: 0 }, sent = [], net = { jam: {}, down: {} }, G = {};
  G.Net = { uid, on: fn => { net.msg = fn; }, onPeer: fn => { net.peer = fn; }, slow: () => false, BUF_HIGH: 65536,
    backlog: u => net.jam[u] || 0, closing: false,
    send: (to, f) => !net.down[to] && !!sent.push([to, f]), toHost: f => !net.down.host && !!sent.push(['host', f]) };
  const g = addCoop(G, clock, enemies);
  g.begin({ host: 'host', members: [{ uid: 'host', name: 'Hugo', dex: 25 }, { uid: 'a', name: 'Ana', dex: 25 }, { uid: 'b', name: 'Bea', dex: 25 }] });
  const to = u => sent.filter(([d]) => d === u).map(([, f]) => f);
  /** Anfitrión: un envío de ese invitado, confirmando el sello `an` (undefined: una versión vieja). */
  const hear = (u, an) => net.msg(u, Object.assign({ k: 'f', p: state(10, 0), ev: [] }, an === undefined ? {} : { an }));
  return Object.assign(g, { C: G.Coop, clock, sent, net, to, hear });
}
const hostFrame = (extra = {}) => Object.assign({ k: 'f', t: 1, lv: 1, xp: 0, xn: 9, ki: 0, bo: 0, co: 0, tk: [0, 0], p: {}, e: [], ev: [], ho: [] }, extra);

test('host frames carry a stamp and guests echo the last one; older versions neither need nor send it', () => {
  const h = sim('host');
  h.clock.now = 500; h.hear('a'); h.C.tick(1);
  assert.equal(h.to('a').at(-1).n, 500);
  const g = sim('a');
  assert.ok(!('an' in g.sent[0][1]));                                    // the first hello: nothing heard yet
  g.net.msg('host', hostFrame({ n: 1234 })); g.C.tick(1);
  assert.equal(g.sent.at(-1)[1].an, 1234);
  const old = sim('a');
  old.net.msg('host', hostFrame()); old.C.tick(1);                       // a host without stamps: no echo
  assert.ok(!('an' in old.sent.at(-1)[1]));
  old.net.msg('host', hostFrame({ n: 'x' })); old.C.tick(1);             // nor garbage
  assert.ok(!('an' in old.sent.at(-1)[1]));
});

test('host stops sending to a guest that falls LAG_MS behind and starts again when it catches up', () => {
  const h = sim('host');
  h.hear('a', 0); h.hear('b', 0);
  h.C.tick(1); const first = h.to('a').at(-1).n; h.hear('a', first);
  const frames = () => h.to('a').length;
  // Ana keeps talking, but what she confirms stays at the first frame: 1.2 s of room, then no more.
  for (let t = 100; t <= 1100; t += 100) { h.clock.now = t; h.hear('a', first); h.C.tick(1); }
  const n = frames();
  assert.ok(n >= 11);
  for (let t = 1300; t <= 2500; t += 100) { h.clock.now = t; h.hear('a', first); h.hear('b', h.to('b').at(-1).n); h.C.tick(1); }
  assert.equal(frames(), n);                                             // waits
  assert.ok(h.to('b').length > n);                                       // Bea is not affected
  // Lasting notices wait for her, what is only seen for a moment does not.
  h.C.enemyAdded({ id: 5, dex: 25, x: 1, y: 2, maxHp: 40, dmg: 3, behavior: 'chase' });
  h.C.enemyShot({ x: 0, y: 0, vx: 1, vy: 1, dmg: 1, r: 4, life: 1, cat: 'p' }, 'fire');
  h.C.hurtShown({ id: 1, x: 0, y: 0 }, 9, '#fff');
  h.clock.now = 2600; h.hear('a', h.to('a').at(-1).n); h.C.tick(1);      // everything sent has arrived
  assert.equal(frames(), n + 1);
  const ev = h.to('a').at(-1).ev.map(e => e[0]);
  assert.deepEqual(ev, ['ne']);
});

test('a guest that cannot confirm is not left without frames: background tab, older version', () => {
  const h = sim('host');
  h.hear('a', 0); h.C.tick(1);
  h.hear('a', h.to('a').at(-1).n);
  for (let t = 100; t <= 2000; t += 100) { h.clock.now = t; h.C.tick(1); }  // Ana's tab goes to the background: she says nothing
  assert.ok(h.to('a').length < 20);                                      // no news: the wait starts...
  const n = h.to('a').length;
  for (let t = 3200; t <= 4000; t += 100) { h.clock.now = t; h.C.tick(1); }
  assert.ok(h.to('a').length >= n + 9);                                  // ...and past QUIET_MS frames go on, as before
  const old = sim('host');
  for (let t = 0; t <= 5000; t += 100) { old.clock.now = t; old.hear('a'); old.C.tick(1); }
  assert.equal(old.to('a').length, 51);                                  // never confirms: never held back
});

test('frames lost with an old channel never leave the host waiting for them', () => {
  const h = sim('host');
  h.hear('a', 0); h.C.tick(1); h.hear('a', h.to('a').at(-1).n);
  for (let t = 100; t <= 900; t += 100) { h.clock.now = t; h.hear('a', 0); h.C.tick(1); }
  h.clock.now = 1000; h.net.peer('a', 'failed');
  h.clock.now = 4000; h.net.peer('a', 'direct');
  const stale = h.to('a').at(-1).n;                                      // what she last got before the cut
  h.sent.length = 0;
  h.hear('a', 0); h.C.tick(1);                                           // her first frame still echoes the old stamp
  assert.equal(h.to('a').length, 1);
  h.clock.now = 4100; h.hear('a', h.to('a').at(-1).n); h.C.tick(1);
  assert.equal(h.to('a').length, 2);
  assert.ok(stale > 0);
});

test('the wait for a dropped connection is 45 s on both sides, and what was missed fits', () => {
  const h = sim('host');
  h.hear('a'); h.hear('b'); h.C.tick(1);
  h.net.peer('a', 'failed');
  // 300 notices a second for the whole wait: she is not given up on for that.
  for (let i = 0; i < 300 * 45; i++) h.C.enemyAdded({ id: i, dex: 25, x: 1, y: 2, maxHp: 40, dmg: 3, behavior: 'chase' });
  h.clock.now = 44900; h.C.tick(1);
  assert.equal(h.C.mate('a').connected, true);
  h.clock.now = 45100; h.C.tick(1);
  assert.equal(h.C.mate('a').connected, false);
  const g = sim('a');
  g.net.msg('host', hostFrame());
  g.net.peer('host', 'failed');
  assert.deepEqual(g.log.away.at(-1), 'Hugo');                           // paused: 'esperando a Hugo (anfitrión)'
  g.clock.now = 44900; g.C.tick(1);
  assert.equal(g.C.active, true); assert.deepEqual(g.log.lost, []);
  g.clock.now = 45100; g.C.tick(1);
  assert.equal(g.C.active, false); assert.deepEqual(g.log.lost, [LOST]);
});

test('a guest that comes back just after the host gave up is told so, instead of pausing for ever', () => {
  const h = sim('host');
  h.hear('a'); h.hear('b'); h.C.tick(1);
  h.net.peer('a', 'failed');
  h.clock.now = 45100; h.C.tick(1);
  assert.equal(h.C.mate('a').connected, false);
  h.sent.length = 0;
  h.hear('a');
  assert.deepEqual(h.to('a'), [{ k: 'f', ev: [['gone', 'a']] }]);
  const g = sim('a');
  g.net.msg('host', { k: 'f', ev: [['gone', 'a']] });
  assert.equal(g.C.active, false); assert.deepEqual(g.log.lost, [LOST]);
});

// ---------------- una partida entera por un enlace lento ----------------

/**
 * El anfitrión manda por un enlace de `rate` bytes/s y `ms` de retraso. `hidden`: bytes de la cola
 * que el navegador ya no cuenta en bufferedAmount (salieron del canal, pero siguen por el camino).
 * Lo que devuelve cuenta los envíos que llegan a partir del segundo `warm`.
 */
function slowRun({ rate, hidden = 0, ms = 40, secs = 60, warm = 20, enemies = 100, dead }) {
  const clock = { now: 0 };
  const codec = {}; new Function('G', source('js/net/codec.js'))(codec);
  const down = [], up = [];
  let busy = 0;
  const left = () => Math.max(0, (busy - clock.now) / 1000 * rate);
  const hostNet = { uid: 'host', on: fn => { hostNet.msg = fn; }, onPeer() {}, slow: () => false, closing: false, BUF_HIGH: 65536,
    backlog: () => Math.max(0, left() - hidden),
    send(to, f) {
      if (hostNet.backlog() > 2 * 1024 * 1024) return false;
      const bytes = codec.NetCodec.encode(f).byteLength;
      busy = Math.max(busy, clock.now) + bytes / rate * 1000;
      down.push({ at: busy + ms, sent: clock.now, f });
      return true;
    } };
  const guestNet = { uid: 'a', on: fn => { guestNet.msg = fn; }, onPeer() {}, slow: () => false, closing: false, BUF_HIGH: 65536,
    backlog: () => 0, toHost(f) { up.push({ at: clock.now + ms, f }); return true; } };
  const list = Array.from({ length: enemies }, (_, i) => ({ id: i + 1, x: i * 3, y: i, hp: 50, anim: { cur: 'Walk', dir: 0 } }));
  const H = { Net: hostNet }, A = { Net: guestNet };
  const host = addCoop(H, clock, list), guest = addCoop(A, clock);
  guest.api.specAt = () => null;
  const cfg = { host: 'host', members: [{ uid: 'host', name: 'Hugo', dex: 25 }, { uid: 'a', name: 'Ana', dex: 25 }] };
  host.begin(cfg); guest.begin(cfg);
  let id = 1000, maxAge = 0, frames = 0, late = 0;
  const dt = 1 / 60;
  for (let t = 0; t < secs * 1000; t += dt * 1000) {
    clock.now = t;
    const out = dead && t >= dead[0] && t < dead[1];
    while (down.length && down[0].at <= t && !out) {
      const m = down.shift(), age = t - m.sent;
      if (t >= warm * 1000) { frames++; maxAge = Math.max(maxAge, age); if (age > 2000) late++; }
      guestNet.msg('host', m.f);
    }
    while (up.length && up[0].at <= t) hostNet.msg('a', up.shift().f);
    if (Math.floor(t / 100) !== Math.floor((t - dt * 1000) / 100)) {       // unos diez avisos por segundo
      H.Coop.enemyAdded({ id: ++id, dex: 25, x: 1, y: 2, maxHp: 40, dmg: 3, behavior: 'chase' });
      H.Coop.enemyShot({ x: 0, y: 0, vx: 1, vy: 1, dmg: 1, r: 4, life: 1, cat: 'p' }, 'fire');
    }
    H.Coop.tick(dt); A.Coop.tick(dt);
  }
  return { maxAge: Math.round(maxAge), frames, late, inRun: !!H.Coop.mate('a').connected, pauses: guest.log.away.filter(Boolean).length, queue: down.length };
}

test('on a slow link the guest stays current instead of drifting behind (8 KB/s for a 30 KB/s game)', () => {
  const r = slowRun({ rate: 8000 });
  assert.ok(r.maxAge < 2500, JSON.stringify(r));
  assert.ok(r.frames > 40, JSON.stringify(r));                           // still moving, just fewer frames
  assert.equal(r.inRun, true);
});

test('it also holds if the browser does not report what is stuck on the way (no bytes visible)', () => {
  const r = slowRun({ rate: 8000, hidden: 2 * 1024 * 1024 });
  assert.ok(r.maxAge < 2500, JSON.stringify(r));
  assert.equal(r.inRun, true);
});

test('a good link is not held back, even with a slow round trip', () => {
  for (const ms of [40, 250, 450]) {
    const r = slowRun({ rate: 200000, ms });
    assert.ok(r.frames > 40 * 11, JSON.stringify(r));                    // the usual rate (12 a second with this 60 Hz loop)
    assert.ok(r.maxAge < ms + 200, JSON.stringify(r));
    assert.equal(r.pauses, 0, JSON.stringify(r));
  }
});

test('when nothing gets through for a while the guest pauses, then goes on with the current game', () => {
  const r = slowRun({ rate: 200000, dead: [25000, 33000] });
  assert.ok(r.pauses >= 1, JSON.stringify(r));
  assert.equal(r.inRun, true);
  assert.ok(r.late <= 40, JSON.stringify(r));                            // only what was already on its way when it stopped
  assert.ok(r.maxAge < 9000, JSON.stringify(r));
});

// ---------------- salas con código: coderoom.js + net.js + coop.js con PeerJS falso ----------------

const CODE_MEMBERS = env => env.players.map(p => ({ uid: p.id, name: p.name, dex: 25 }));

async function party(names) {
  const clock = fakeClock(), server = peerServer(clock), players = [];
  const add = b => { const g = addCoop(b.G, clock); b.G.Flow.startCoop = cfg => g.begin(cfg); return Object.assign(b, g); };
  const host = add(browser(server, clock));
  host.name = names[0];
  const made = host.G.CodeRoom.create(names[0]);
  await clock.tick(20);
  const { code } = await made;
  players.push(host);
  for (const n of names.slice(1)) {
    const g = add(browser(server, clock));
    g.name = n;
    const p = g.G.CodeRoom.join(code, n);
    await clock.tick(100);
    assert.deepEqual(await p, { ok: true });
    players.push(g);
  }
  return { clock, server, players };
}
function start(env, seed = 7) {
  const host = env.players[0], cfg = { k: 'start', seed, host: host.id, members: CODE_MEMBERS(env) };
  host.G.CodeRoom.setOpen(false);
  host.G.Net.broadcast(cfg);
  host.begin(cfg);
  return cfg;
}
/** El tiempo pasa y los que siguen en la partida van mandando sus envíos. */
async function play(env, ms) {
  for (let t = 0; t < ms; t += 100) {
    await env.clock.tick(100);
    for (const p of env.players) if (p.G.Coop.active) p.G.Coop.tick(0.1);
  }
}
const namesIn = b => b.room.members.map(m => m.name);
/** Se le cae la red al jugador: se cierra su canal y (block) no vuelve a abrirse ninguno. */
function cutOff(env, g) {
  env.server.block = true;
  env.server.ids.get(g.id).conns.find(c => c.open).close();
}

test('code room: dropped for 30 s, the guest pauses and goes on, in the run and in the room', async () => {
  const env = await party(['Ash', 'Misty']), [host, b] = env.players;
  start(env); await play(env, 1000);
  assert.equal(b.G.Coop.active, true);
  cutOff(env, b);
  await play(env, 30000);
  assert.equal(b.G.Coop.active, true); assert.deepEqual(b.log.lost, []);
  assert.ok(b.log.away.at(-1));                                          // paused, waiting for the host
  assert.equal(host.G.Coop.mate(b.id).connected, true);
  env.server.block = false;
  await play(env, 18000);
  assert.equal(b.G.Net.mode(host.id), 'direct');
  assert.equal(b.G.Coop.active, true); assert.equal(b.log.away.at(-1), null);   // playing again
  assert.ok(host.log.said.includes('Misty ha vuelto a la partida'));
  assert.deepEqual(namesIn(host), ['Ash', 'Misty']);
});

test('code room: the room server losing the host for 30 s ends nothing', async () => {
  const env = await party(['Ash', 'Misty']), [host, b] = env.players;
  start(env); await play(env, 1000);
  // Its connection to the PeerJS server drops: the server forgets it while the guest is calling back.
  const me = env.server.ids.get(host.id);
  env.server.ids.delete(host.id);
  env.server.ids.get(b.id).conns.find(c => c.open).close();
  await play(env, 30000);
  assert.ok(b.room); assert.equal(b.G.Coop.active, true);
  assert.ok(!b.emits.some(e => e && e.ended), JSON.stringify(b.emits));
  env.server.ids.set(host.id, me);
  await play(env, 10000);
  assert.equal(b.G.Net.mode(host.id), 'direct'); assert.equal(b.G.Coop.active, true);
});

test('code room: losing the connection to the room server only (channels fine) changes nothing', async () => {
  const env = await party(['Ash', 'Misty']), [host, b] = env.players;
  start(env); await play(env, 1000);
  const p = env.server.ids.get(b.id);
  p.disconnected = true; p.emit('error', { type: 'network' }); p.emit('disconnected');
  await play(env, 12000);
  assert.ok(b.room); assert.equal(b.G.Coop.active, true); assert.equal(b.G.Net.mode(host.id), 'direct');
  assert.deepEqual(b.log.lost, []); assert.ok(!b.log.away.some(Boolean));
});

test('code room: left out of the run, you wait in the room and start the next one with the others', async () => {
  const env = await party(['Ash', 'Misty', 'Brock']), [host, b, c] = env.players;
  start(env); await play(env, 1000);
  cutOff(env, b);
  await play(env, 46000);
  // Out of the run, told why, and still in the room: nobody has closed anything.
  assert.equal(b.G.Coop.active, false); assert.deepEqual(b.log.lost, [LOST]);
  assert.equal(host.G.Coop.mate(b.id).connected, false);
  assert.equal(c.G.Coop.active, true);
  assert.ok(b.room); assert.deepEqual(namesIn(host), ['Ash', 'Misty', 'Brock']);
  assert.ok(!b.emits.some(e => e && e.ended), JSON.stringify(b.emits));
  // Back on line while the others play: same seat, no "the run has already started".
  env.server.block = false;
  await play(env, 18000);
  assert.ok(b.room); assert.equal(b.room.open, false);
  assert.equal(b.G.Net.mode(host.id), 'direct');
  assert.ok(!b.emits.some(e => e && e.ended), JSON.stringify(b.emits));
  // They finish, the room reopens and the next run is for all three.
  host.G.Coop.over({ t: 90 });
  host.G.CodeRoom.setOpen(true);
  await play(env, 100);
  assert.deepEqual(c.log.over.length, 1);
  assert.equal(b.room.open, true);
  start(env, 8);
  await play(env, 100);
  assert.equal(b.G.Coop.active, true); assert.equal(c.G.Coop.active, true);
  assert.equal(host.G.Coop.mates.length, 2);
});

test('code room: a seat is held during the run even for someone gone for good, and freed once it reopens', async () => {
  const env = await party(['Ash', 'Misty', 'Brock']), [host, b, c] = env.players;
  start(env); await play(env, 1000);
  env.server.ids.get(c.id).destroy();
  await play(env, 60000);
  assert.deepEqual(namesIn(host), ['Ash', 'Misty', 'Brock']);
  assert.equal(host.G.Coop.mate(c.id).connected, false);
  assert.equal(b.G.Coop.active, true);
  host.G.Coop.over({ t: 90 }); host.G.CodeRoom.setOpen(true);
  await play(env, 19000);
  assert.deepEqual(namesIn(host), ['Ash', 'Misty', 'Brock']);
  await play(env, 2000);
  assert.deepEqual(namesIn(host), ['Ash', 'Misty']); assert.deepEqual(namesIn(b), ['Ash', 'Misty']);
});

test('code room: leaving the room during the run still frees the seat at once', async () => {
  const env = await party(['Ash', 'Misty', 'Brock']), [host, b, c] = env.players;
  start(env); await play(env, 1000);
  b.G.Coop.leave();
  const bye = b.G.CodeRoom.leave();
  await play(env, 500);
  await bye;
  assert.deepEqual(namesIn(host), ['Ash', 'Brock']); assert.deepEqual(namesIn(c), ['Ash', 'Brock']);
  assert.equal(c.G.Coop.active, true);
});

// ---------------- salas de amigos: social.js + social-ui.js + net.js + coop.js ----------------

/**
 * Realtime Database en memoria con las reglas de database.rules.json que tocan a las salas y lo que
 * se ha comprobado con el emulador y el SDK de verdad: al cortarse, el servidor hace los onDisconnect;
 * al volver, cada escucha se pide otra vez y, sin permiso, se cancela con PERMISSION_DENIED.
 */
function fakeDatabase(clock) {
  const data = {}, clients = new Set();
  const keys = p => p.split('/').filter(Boolean);
  const read = p => keys(p).reduce((n, k) => (n == null ? null : n[k] === undefined ? null : n[k]), data);
  function put(p, v) {
    const ks = keys(p), last = ks.pop(), chain = [];
    let n = data;
    for (const k of ks) { chain.push([n, k]); n = n[k] = n[k] || {}; }
    if (v == null) delete n[last]; else n[last] = v;
    for (const [o, k] of chain.reverse()) if (!Object.keys(o[k]).length) delete o[k];   // lo vacío no existe
  }
  const seat = (r, uid) => read(`rooms/${r}/m/${uid}`) != null;
  function canRead(uid, p) {
    const [, r, k, x] = keys(p);
    return k === 'host' || k === 'open' || (k === 'q' && x === uid) || seat(r, uid);
  }
  function canWrite(uid, p, v) {
    const [, r, k, x, y] = keys(p), host = read(`rooms/${r}/host`);
    if (host === uid || (host == null && !k && v && v.host === uid)) return true;
    if (k === 'm' && x) return x === uid && (v == null || read(p) != null || read(`rooms/${r}/open`) === true);
    if (k === 'q' && y) return x === uid || seat(r, uid);
    return false;
  }
  const changed = () => clock.setTimeout(() => clients.forEach(c => c.syncAll()), 1);

  class Client {
    constructor(uid) { this.uid = uid; this.online = true; this.listens = new Set(); this.armed = new Set(); this.waiting = []; clients.add(this); }
    goOnline() {
      if (this.online) return;
      this.online = true;
      const w = this.waiting; this.waiting = [];
      w.forEach(fn => fn());
      for (const l of this.listens) { l.seen = new Set(); this.sync(l); }
    }
    goOffline() {
      if (!this.online) return;
      this.online = false;
      for (const p of this.armed) put(p, null);                          // el servidor hace lo que le dejaste dicho
      if (this.armed.size) changed();
      this.armed.clear();
    }
    syncAll() { if (this.online) for (const l of [...this.listens]) this.sync(l); }
    sync(l) {
      if (!canRead(this.uid, l.p)) {
        this.listens.delete(l);
        if (l.cancel) l.cancel({ code: 'PERMISSION_DENIED' });
        return;
      }
      const v = read(l.p);
      if (l.ev === 'child_added') {
        for (const k of Object.keys(v || {})) {
          if (l.seen.has(k)) continue;
          l.seen.add(k);
          l.fn({ val: () => v[k], ref: this.ref(l.p + '/' + k) });
        }
      } else if (JSON.stringify(v) !== l.last) {
        l.last = JSON.stringify(v);
        l.fn({ val: () => (v == null ? v : JSON.parse(l.last)) });
      }
    }
    write(p, v) {
      return new Promise((res, rej) => {
        const go = () => {
          if (!canWrite(this.uid, p, v)) { rej({ code: 'PERMISSION_DENIED' }); return; }
          put(p, v); changed(); res();
        };
        if (this.online) go(); else this.waiting.push(go);
      });
    }
    ref(p) {
      const me = this;
      return {
        key: keys(p).pop(),
        on(ev, fn, cancel) { const l = { p, ev, fn, cancel, seen: new Set(), last: undefined }; me.listens.add(l); if (me.online) me.sync(l); return fn; },
        off() { for (const l of [...me.listens]) if (l.p === p) me.listens.delete(l); },
        set: v => me.write(p, v),
        remove: () => me.write(p, null),
        update: o => Promise.all(Object.entries(o).map(([k, v]) => me.write(p + '/' + k, v))),
        push(v) { const k = 'k' + Math.random().toString(36).slice(2); if (v === undefined) return { key: k }; return me.write(p + '/' + k, v); },
        async get() {
          if (!canRead(me.uid, p)) throw { code: 'PERMISSION_DENIED' };
          const v = read(p);
          return { val: () => v, numChildren: () => Object.keys(v || {}).length, exists: () => v != null };
        },
        onDisconnect: () => ({
          remove() { const go = () => me.armed.add(p); if (me.online) go(); else me.waiting.push(go); return Promise.resolve(); },
          cancel() { const go = () => me.armed.forEach(a => { if (a === p || a.startsWith(p + '/')) me.armed.delete(a); }); if (me.online) go(); else me.waiting.push(go); return Promise.resolve(); }
        })
      };
    }
  }
  return { read, put, changed, Client };
}

/** WebRTC falso: dos RTCPeerConnection se emparejan por la oferta y su canal entrega en orden. */
function fakeWebRTC(clock) {
  let seq = 0;
  const answerers = new Map(), all = [];
  class Channel {
    constructor(state) { this.readyState = state; this.bufferedAmount = 0; this.other = null; }
    send(d) { const o = this.other; clock.setTimeout(() => { if (o.readyState === 'open' && o.onmessage) o.onmessage({ data: d }); }, 1); }
    close() {
      for (const c of [this, this.other]) {
        if (!c || c.readyState === 'closed') continue;
        c.readyState = 'closed';
        clock.setTimeout(() => { if (c.onclose) c.onclose(); }, 1);
      }
    }
  }
  return class PC {
    /** Se caen todos los canales abiertos. */
    static cut() { all.forEach(pc => pc.close()); all.length = 0; }
    constructor() { this.remoteDescription = null; all.push(this); }
    createDataChannel() { return this.dc = new Channel('connecting'); }
    async createOffer() { return { type: 'offer', sdp: String(++seq) }; }
    async createAnswer() { return { type: 'answer', sdp: this.remoteDescription.sdp }; }
    async setLocalDescription(d) { this.localDescription = { toJSON: () => d }; }
    async setRemoteDescription(d) {
      this.remoteDescription = d;
      if (d.type === 'offer') { answerers.set(d.sdp, this); return; }
      const b = answerers.get(d.sdp), c = new Channel('connecting');
      c.other = this.dc; this.dc.other = c; b.dc = c;
      b.ondatachannel({ channel: c });
      clock.setTimeout(() => { for (const x of [this.dc, c]) { x.readyState = 'open'; x.onopen(); } }, 1);
    }
    addIceCandidate() { return Promise.resolve(); }
    close() { if (this.dc) this.dc.close(); }
  };
}

/** Un navegador con cuenta: social.js, social-ui.js, net.js y coop.js de verdad, y el final de partida de game.js. */
function friend(env, uid, name) {
  const { clock, db, PC } = env, els = {}, toasts = [], screens = new Set();
  const el = id => els[id] || (els[id] = { textContent: '', innerHTML: '', className: '', dataset: {}, style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {} }, appendChild() {}, insertAdjacentHTML() {}, querySelectorAll: () => [] });
  const G = { DEX_BY: { 25: { name: 'Pikachu' } } };
  new Function('G', source('js/net/codec.js'))(G);
  const rtdb = new db.Client(uid);
  const fsDoc = { set: async () => {}, get: async () => ({ exists: false }), delete: async () => {} };
  const fsCol = { doc: () => fsDoc, where: () => fsCol, onSnapshot: () => () => {} };
  G.DB = { online: true, user: name, save: { partner: 25, name }, ownsShiny: () => false, onLeave() {}, setName() {},
    fb: { uid, rtdb, fs: { collection: () => fsCol } } };
  G.UI = { $: el, toast: t => toasts.push(t), isOpen: id => screens.has(id), show: id => screens.add(id), hide: id => screens.delete(id), spriteCanvas: () => ({}) };
  G.MenuUI = { open() { screens.delete('scr-lobby'); } };
  G.Audio = { sfx() {} }; G.Game = { state: 'ui' }; G.CodeRoom = { busy: false };
  const doc = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', createElement: () => el('new') };
  new Function('G', 'RTCPeerConnection', 'setTimeout', 'clearTimeout', source('js/net/net.js'))(G, PC, clock.setTimeout, clock.clearTimeout);
  new Function('G', 'firebase', 'document', 'window', 'localStorage', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', source('js/net/social.js'))(
    G, { database: { ServerValue: { TIMESTAMP: 1 } }, firestore: { FieldValue: { serverTimestamp: () => 0 } } }, doc, { addEventListener() {} },
    { getItem: k => (k.startsWith('ps.nick.') ? name : null), setItem() {}, removeItem() {} },
    async () => ({ headers: { get: () => '' } }), clock.setTimeout, clock.clearTimeout, () => 1, () => {});
  const g = addCoop(G, clock);
  new Function('G', 'document', source('js/ui/social-ui.js'))(G, doc);
  G.LobbyUI.init();
  // Como game.js: empezar, acabar (endRun) y cerrar el resumen (G.Flow.afterRun).
  const finish = () => G.Social.setPlaying(false);
  G.Flow = { startCoop: cfg => { screens.delete('scr-lobby'); g.begin(cfg); G.Social.setPlaying(true); } };
  g.api.lost = m => { g.log.lost.push(m); toasts.push(m); finish(); };
  g.api.over = d => { g.log.over.push(d); finish(); };
  const afterRun = () => { if (!G.Social.room) return; if (G.Social.room.isHost) G.Social.setOpen(true); G.LobbyUI.open(); };
  return Object.defineProperty(Object.assign(g, { G, uid, name, rtdb, els, toasts, screens, finish, afterRun }), 'room', { get: () => G.Social.room });
}

async function friends(names) {
  const clock = fakeClock(), env = { clock, db: fakeDatabase(clock), PC: fakeWebRTC(clock), players: [] };
  const [host, ...guests] = names.map((n, i) => friend(env, 'u' + i, n));
  env.players = [host, ...guests];
  for (const p of env.players) await p.G.Social.start();
  await host.G.Social.createRoom();
  await clock.tick(5);
  for (const g of guests) {
    assert.deepEqual(await g.G.Social.joinRoom(host.room.id), { ok: true });
    await clock.tick(50);
  }
  for (const g of guests) { assert.equal(host.G.Net.mode(g.uid), 'direct'); assert.equal(g.G.Net.mode(host.uid), 'direct'); }
  for (const p of env.players) p.G.LobbyUI.open();
  env.seatOf = p => env.db.read(`rooms/${host.room.id}/m/${p.uid}`);
  return env;
}
const startFriends = async env => { env.players[0].els['lobby-start'].onclick(); await play(env, 200); };

test('friends room: the guest losing the room server mid-run keeps the run and the room', async () => {
  const env = await friends(['Ash', 'Misty']), [host, a] = env.players;
  await startFriends(env);
  assert.equal(a.G.Coop.active, true);
  a.rtdb.goOffline();
  await play(env, 3000);
  a.rtdb.goOnline();
  await play(env, 3000);
  assert.ok(env.seatOf(a), 'the seat is still there');
  assert.ok(a.room); assert.equal(a.G.Coop.active, true); assert.equal(a.G.Net.open_, true);
  assert.deepEqual(a.toasts, []);
  assert.equal(host.G.Net.mode(a.uid), 'direct'); assert.equal(a.G.Net.mode(host.uid), 'direct');
  assert.equal(host.room.members.length, 2);
  assert.ok(!a.log.away.some(Boolean));                                  // not even a pause: the game does not go through it
});

test('friends room: the host losing the room server mid-run closes nothing for anyone', async () => {
  const env = await friends(['Ash', 'Misty']), [host, a] = env.players;
  await startFriends(env);
  host.rtdb.goOffline();
  await play(env, 3000);
  assert.ok(env.db.read('rooms/' + host.room.id + '/host'));
  host.rtdb.goOnline();
  await play(env, 3000);
  assert.ok(a.room); assert.ok(host.room);
  assert.equal(a.G.Coop.active, true); assert.equal(host.G.Coop.active, true);
  assert.deepEqual(a.toasts, []); assert.deepEqual(host.toasts, []);
});

test('friends room: in the lobby, a closed browser still frees the seat or the whole room by itself', async () => {
  const env = await friends(['Ash', 'Misty', 'Brock']), [host, a, b] = env.players, id = host.room.id;
  a.rtdb.goOffline();
  await play(env, 100);
  assert.equal(env.db.read(`rooms/${id}/m/${a.uid}`), null);
  assert.equal(host.room.members.length, 2);
  host.rtdb.goOffline();
  await play(env, 100);
  assert.equal(env.db.read('rooms/' + id), null);
  assert.equal(b.room, null); assert.ok(b.toasts.includes(CLOSED));
});

test('friends room: cut from everything for 30 s, the seat lets the guest reconnect and go on', async () => {
  const env = await friends(['Ash', 'Misty']), [host, a] = env.players;
  await startFriends(env);
  a.rtdb.goOffline(); env.PC.cut();
  await play(env, 30000);
  assert.equal(a.G.Coop.active, true); assert.ok(a.log.away.at(-1));     // paused
  assert.notEqual(host.G.Net.mode(a.uid), 'direct');
  a.rtdb.goOnline();                                                     // its answer goes through the room: it needs the seat
  await play(env, 12000);
  assert.equal(host.G.Net.mode(a.uid), 'direct'); assert.equal(a.G.Net.mode(host.uid), 'direct');
  assert.equal(a.G.Coop.active, true); assert.equal(a.log.away.at(-1), null);
  assert.ok(host.log.said.includes('Misty ha vuelto a la partida'));
  assert.deepEqual(a.toasts, []);
});

test('friends room: left out of the run, you wait in the room and start the next one with the others', async () => {
  const env = await friends(['Ash', 'Misty', 'Brock']), [host, a, b] = env.players;
  await startFriends(env);
  a.rtdb.goOffline(); env.PC.cut();
  // Only Misty's network is down, but cut() took Brock's channel with it: he comes back in a moment.
  await play(env, 46000);
  assert.equal(a.G.Coop.active, false); assert.deepEqual(a.log.lost, [LOST]);
  assert.equal(host.G.Coop.mate(a.uid).connected, false);
  assert.equal(b.G.Coop.active, true);
  assert.ok(a.room); assert.ok(!a.toasts.includes(CLOSED));
  a.rtdb.goOnline();
  a.afterRun();                                                          // closes the summary: back to the room
  await play(env, 20000);
  assert.ok(a.screens.has('scr-lobby'));
  assert.equal(a.G.Net.mode(host.uid), 'direct');
  assert.equal(a.room.open, false); assert.equal(a.els['lobby-note'].textContent, WAIT_NOTE);
  assert.ok(env.seatOf(a)); assert.ok(!a.toasts.includes(CLOSED));
  // Waiting there, another break changes nothing: the room is still closed.
  a.rtdb.goOffline(); await play(env, 2000); a.rtdb.goOnline(); await play(env, 2000);
  assert.ok(env.seatOf(a)); assert.ok(a.room);
  // They finish: the room reopens and the next run is for the three of them.
  host.G.Coop.over({ t: 90 }); host.finish(); host.afterRun();
  await play(env, 200);
  assert.equal(a.room.open, true);
  assert.equal(a.els['lobby-note'].textContent, 'Cuando el anfitrión empiece, entraréis todos a la vez.');
  b.afterRun();
  await startFriends(env);
  assert.equal(a.G.Coop.active, true); assert.equal(b.G.Coop.active, true);
  assert.equal(host.G.Coop.mates.length, 2);
});

test('friends room: back in the open room a closed browser frees the seat by itself again', async () => {
  const env = await friends(['Ash', 'Misty']), [host, a] = env.players;
  await startFriends(env);
  await play(env, 500);
  host.G.Coop.over({ t: 90 }); host.finish(); host.afterRun();
  await play(env, 200);
  a.afterRun();
  await play(env, 200);
  assert.equal(a.G.Coop.active, false); assert.equal(a.room.open, true);
  a.rtdb.goOffline();
  await play(env, 100);
  assert.equal(env.seatOf(a), null);
});

test('friends room: the seat of someone gone for good is freed after the run, not during it', async () => {
  const env = await friends(['Ash', 'Misty', 'Brock']), [host, a, b] = env.players;
  await startFriends(env);
  a.rtdb.goOffline(); env.PC.cut();                                      // Misty closes the browser mid-run
  await play(env, 60000);
  assert.equal(host.G.Coop.mate(a.uid).connected, false);
  assert.ok(env.seatOf(a));
  assert.equal(b.G.Coop.active, true); assert.equal(b.G.Net.mode(host.uid), 'direct');
  host.G.Coop.over({ t: 90 }); host.finish(); host.afterRun();
  await play(env, 19000);
  assert.ok(env.seatOf(a));
  await play(env, 2000);
  assert.equal(env.seatOf(a), null);
  assert.deepEqual(host.room.members.map(m => m.name), ['Ash', 'Brock']);
  assert.deepEqual(b.room.members.map(m => m.name), ['Ash', 'Brock']);
  assert.ok(!b.toasts.includes(CLOSED));
});

test('friends room: if the room really goes away mid-run, the run goes on and the notice waits for its end', async () => {
  const env = await friends(['Ash', 'Misty']), [host, a] = env.players, id = host.room.id;
  await startFriends(env);
  env.db.put('rooms/' + id, null); env.db.changed();
  await play(env, 3000);
  assert.ok(a.room); assert.equal(a.G.Coop.active, true); assert.equal(a.G.Net.open_, true);
  assert.equal(host.G.Net.mode(a.uid), 'direct');                        // nobody is hung up either
  assert.deepEqual(a.toasts, []); assert.ok(!a.log.away.some(Boolean));
  host.G.Coop.over({ t: 90 }); host.finish();
  await play(env, 1000);
  assert.equal(a.log.over.length, 1);
  assert.equal(a.room, null); assert.ok(a.toasts.includes(CLOSED));
  assert.equal(host.room, null);
});

test('friends room: a seat lost mid-run (an older client, a badly timed break) does not hang up that teammate', async () => {
  const env = await friends(['Ash', 'Misty']), [host, a] = env.players, id = host.room.id;
  await startFriends(env);
  env.db.put(`rooms/${id}/m/${a.uid}`, null); env.db.changed();
  await play(env, 3000);
  assert.equal(host.room.members.length, 1);
  assert.equal(host.G.Net.mode(a.uid), 'direct'); assert.equal(host.G.Coop.mate(a.uid).connected, true);
  assert.equal(a.G.Coop.active, true); assert.ok(a.room); assert.deepEqual(a.toasts, []);
});
