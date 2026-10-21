const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { frame, client } = require('./net-fixtures.cjs');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function codec() { const G = {}; new Function('G', source('js/net/codec.js'))(G); return G.NetCodec; }
const C = codec();

test('host/client frames, events, pauses and Unicode round-trip exactly', () => {
  for (const f of [client(), frame(0, 0), frame(100, 40), frame(600, 400)]) {
    const b = C.encode(f); assert.ok(b); assert.deepEqual(C.decode(b), f);
  }
});
test('integer limits and decimals retain exact JS values, including high HP', () => {
  const values = [0, 127, 128, 16383, 16384, 2 ** 32, Number.MAX_SAFE_INTEGER,
    -Number.MAX_SAFE_INTEGER, 0.01, -0.01, 1.57, 1e-100, 1e30, Math.PI, Number.MAX_VALUE];
  assert.deepEqual(C.decode(C.encode(values)), values);
});
test('unsupported values safely fall back rather than silently changing data', () => {
  const cycle = []; cycle.push(cycle);
  for (const v of [undefined, 1n, new Date(), cycle, '\ud800', '\udc00']) {
    assert.equal(C.encode(v), null);
  }
  assert.equal(C.encode('x'.repeat(C.MAX_BYTES)), null);
});
test('-0, NaN, Infinity and undefined arrive exactly as they would through JSON', () => {
  const r2 = v => Math.round(v * 100) / 100;
  for (const v of [-0, NaN, Infinity, [r2(-0.003), Math.round(-0.2)], { x: undefined, y: 1, f() {} },
    [undefined, NaN, -Infinity, () => 1], { k: 'f', p: [-0, 1], ev: [['c', 'ember', 3, r2(-0.001), undefined]] }]) {
    const b = C.encode(v); assert.ok(b);
    const got = C.decode(b);
    assert.deepEqual(got, JSON.parse(JSON.stringify(v)));
    assert.equal(JSON.stringify(got), JSON.stringify(v));
  }
});
test('object keys cannot mutate prototypes', () => {
  const value = JSON.parse('{"__proto__":{"polluted":true},"constructor":"safe"}');
  const decoded = C.decode(C.encode(value));
  assert.deepEqual(decoded, value); assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
});
test('truncation, trailing bytes, versions, tags, UTF-8 and lengths are rejected', () => {
  const b = new Uint8Array(C.encode(frame(3, 2)));
  for (let i = 0; i < b.length; i++) assert.throws(() => C.decode(b.slice(0, i).buffer));
  for (const bad of [[80, 83, 2, 0], [80, 83, 1, 255], [80, 83, 1, 8, 2, 255, 255],
    [80, 83, 1, 9, 255, 255, 255, 127], [80, 83, 1, 3, 128, 0],
    [80, 83, 1, 3, ...Array(8).fill(255)], [...b, 0]]) {
    assert.throws(() => C.decode(Uint8Array.from(bad).buffer));
  }
  assert.throws(() => C.decode(new ArrayBuffer(C.MAX_BYTES + 1)));
  assert.throws(() => C.decode('not binary'));
});
test('bounded deterministic random numeric payloads round-trip', () => {
  let seed = 1234;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 500; i++) {
    const f = frame(rand() % 8, rand() % 5, rand());
    f.ev.push(['h', rand(), (rand() - 2 ** 31) / 100, rand() / 31]);
    assert.deepEqual(C.decode(C.encode(f)), f);
  }
});

function network() {
  const pcs = [], relay = [], G = { NetCodec: codec(), DB: { fb: { uid: 'host', rtdb: {
    ref: p => ({ on() {}, off() {}, push: s => { relay.push([p, s]); return Promise.resolve(); } })
  } } } };
  class PC {
    constructor() { pcs.push(this); }
    createDataChannel() {
      return this.dc = { readyState: 'open', sent: [], send(data) { if (this.fail) throw Error('closed'); this.sent.push(data); }, close() {} };
    }
    createOffer() { return Promise.resolve({ type: 'offer' }); }
    setLocalDescription() { this.localDescription = { toJSON: () => ({ type: 'offer' }) }; return Promise.resolve(); }
    close() {}
  }
  new Function('G', 'RTCPeerConnection', 'setTimeout', 'clearTimeout', source('js/net/net.js'))(G, PC, () => 1, () => {});
  G.Net.open('test', true, 'host'); G.Net.syncMembers(['host', 'a', 'b']);
  for (const pc of pcs) pc.dc.onopen();
  const cap = dc => dc.onmessage({ data: JSON.stringify({ k: 'net-cap', binary: 1 }) });
  return { N: G.Net, pcs, relay, cap };
}
test('negotiation is per peer; old clients and unknown versions keep JSON', () => {
  const { N, pcs, cap } = network(), [a, b] = pcs.map(p => p.dc), f = frame();
  assert.equal(a.binaryType, 'arraybuffer');
  N.send('a', f); assert.equal(typeof a.sent.at(-1), 'string');
  cap(a); b.onmessage({ data: '{"k":"net-cap","binary":99}' });
  N.broadcast(f);
  assert.ok(a.sent.at(-1) instanceof ArrayBuffer); assert.deepEqual(C.decode(a.sent.at(-1)), f);
  assert.deepEqual(JSON.parse(b.sent.at(-1)), f);
  N.send('a', { k: 'start', seed: 12 }); assert.equal(typeof a.sent.at(-1), 'string');
  N.send('a', { k: 'f' }); assert.equal(typeof a.sent.at(-1), 'string'); // binary would be larger
  N.send('a', { k: 'f', ev: [undefined] }); assert.deepEqual(C.decode(a.sent.at(-1)), { k: 'f', ev: [null] });
});
test('mixed formats arrive unchanged; capabilities and corrupt packets never reach gameplay', () => {
  const { N, pcs, cap } = network(), dc = pcs[0].dc, got = [];
  N.on((from, msg) => got.push([from, msg]));
  dc.onmessage({ data: C.encode(frame()) }); assert.equal(got.length, 0);
  cap(dc); assert.equal(got.length, 0);
  dc.onmessage({ data: C.encode(frame()) });
  dc.onmessage({ data: JSON.stringify(client()) });
  dc.onmessage({ data: C.encode({ k: 'start' }) });
  dc.onmessage({ data: new ArrayBuffer(0) });
  assert.deepEqual(got, [['a', frame()], ['a', client()]]);
  assert.equal(N.stats.binaryRecv, 1); assert.equal(N.stats.invalidBinary, 3);
});
test('byte counters count successful payloads; failed frames never enable database relay', () => {
  const { N, pcs, cap, relay } = network(), dc = pcs[0].dc, f = frame(); cap(dc);
  N.send('a', f);
  assert.equal(N.stats.sentBytes, C.encode(f).byteLength);
  assert.equal(N.stats.jsonBytes, Buffer.byteLength(JSON.stringify(f)));
  assert.equal(N.stats.binarySent, 1);
  const before = N.stats.sentBytes; dc.fail = true; N.send('a', f);
  assert.equal(N.stats.sentBytes, before); assert.equal(relay.length, 0);
  N.send('a', { k: 'start', seed: 1 }); assert.equal(relay.length, 1);
});
test('reconnect resets capability, so a replaced/old peer never receives binary', () => {
  const { N, pcs, cap } = network(); cap(pcs[0].dc);
  N.close(); N.open('next', true, 'host'); N.syncMembers(['host', 'a']);
  const dc = pcs.at(-1).dc; dc.onopen(); N.send('a', frame());
  assert.equal(typeof dc.sent.at(-1), 'string');
});
test('representative busy host payload saves at least 30%; all savings are lossless', () => {
  for (const n of [30, 100, 300, 600]) {
    const f = frame(n), b = C.encode(f), json = Buffer.byteLength(JSON.stringify(f));
    assert.ok(b.byteLength < json * 0.7, `${n}: ${b.byteLength}/${json}`);
    assert.deepEqual(C.decode(b), f);
  }
});

test('real Coop.tick frames pass through the codec without changing gameplay fields', () => {
  for (const host of [true, false]) {
    const sent = [], G = {};
    G.Net = { uid: host ? 'host' : 'guest', on() {}, onPeer() {}, slow: () => false,
      send: (uid, f) => sent.push(f), toHost: f => sent.push(f) };
    G.Player = class { constructor() { this.maxHp = 300; } };
    G.DEX_BY = { 25: { dex: 25 } }; G.baseStartOf = () => 'thundershock';
    G.Sprites = { preload() {} }; G.U = { dist2: (x, y, a, b) => (x - a) ** 2 + (y - b) ** 2 };
    G.EnemyMgr = { all: () => [{ id: 123, x: 50, y: -10, hp: 125.1, anim: { cur: 'Walk', dir: 3 }, burn: 1 }] };
    G.Judgment = { netState: () => [12, -23, 1, 4] };
    new Function('G', 'document', source('js/net/coop.js'))(G, { addEventListener() {} });
    const local = { x: 0, y: 0, moveAngle: 1.234, walking: true, hp: 234, maxHp: 300,
      magnet: 78, aim: -1.43, xpMul: 1.2, reviveT: 0, activeGroup: () => [{ id: 'thundershock', lvl: 3 }] };
    G.Coop.begin({ host: 'host', members: [{ uid: 'host', name: 'Aarón', dex: 25 }, { uid: 'guest', name: '皮卡丘', dex: 25 }] }, local,
      { team: () => ({ time: 145.12, level: 7, xp: 123.45, xpNext: 300, kills: 52, bosses: 2, coins: 40, t1: 1, t10: 0 }), choosing: () => false });
    // The guest says hello from begin() (even with its tab in the background); the host waits for its tick.
    const hello = sent.splice(0);
    assert.equal(hello.length, host ? 0 : 1);
    if (!host) assert.equal(hello[0].p.length, 15);
    G.Coop.tick(1 / 15);
    assert.equal(sent.length, 1);
    assert.deepEqual(C.decode(C.encode(sent[0])), sent[0]);
    if (host) { assert.deepEqual(sent[0].e, [[123, 50, -10, 126, 1, 3, 1]]); assert.ok('ho' in sent[0]); }
    else { assert.equal(sent[0].p.length, 15); }
  }
});

// Real js/net/coop.js with a fake network, clock and game: `uid` plays in a room of host + a + b.
function coopSim(uid) {
  const sent = [], said = [], lost = [], waits = [], clock = { now: 0 }, net = {}, G = {};
  G.Net = { uid, on: fn => { net.msg = fn; }, onPeer: fn => { net.peer = fn; }, slow: () => false,
    send: (to, f) => sent.push([to, f]), toHost: f => sent.push(['host', f]) };
  G.Player = class { constructor() { this.maxHp = 300; } };
  G.DEX_BY = { 25: { dex: 25 } }; G.baseStartOf = () => 'thundershock';
  G.Sprites = { preload() {} }; G.Social = { me: null };
  G.U = { dist2: (x, y, a, b) => (x - a) ** 2 + (y - b) ** 2, clamp: (v, a, b) => Math.max(a, Math.min(b, v)) };
  const enemy = (id, x, y) => ({ id, x, y, hp: 50, anim: { cur: 'Walk', dir: 0 } });
  G.EnemyMgr = { all: () => [enemy(1, 0, 0), enemy(2, 3000, 0)], get: () => null };
  G.Judgment = { netState: () => null }; G.Projectiles = { clearOrbs() {} };
  G.Spawner = { say: t => said.push(t) };
  new Function('G', 'document', 'performance', source('js/net/coop.js'))(G, { addEventListener() {} }, { now: () => clock.now });
  const local = { x: 0, y: 0, moveAngle: 0, walking: false, hp: 300, maxHp: 300, dead: false, magnet: 78, aim: 0,
    xpMul: 1, reviveT: 0, activeGroup: () => [{ id: 'thundershock', lvl: 1 }] };
  const api = { spec: null, specAt() { return this.spec; }, choosing: () => false, syncTeam() {}, levelStart() {}, resume() {},
    team: () => ({ time: 1, level: 1, xp: 0, xpNext: 9, kills: 0, bosses: 0, coins: 0, t1: 0, t10: 0 }),
    waiting: n => waits.push(n), lost: m => lost.push(m) };
  G.Coop.begin({ host: 'host', members: [{ uid: 'host', name: 'Hugo', dex: 25 }, { uid: 'a', name: 'Ana', dex: 25 }, { uid: 'b', name: 'Bea', dex: 25 }] }, local, api);
  // A 15-entry state like myState() makes: [x, y, ..., dead (6), ...].
  const state = (x, y, dead = 0) => [x, y, 0, 0, dead ? 0 : 300, 300, dead, 'thundershock', 1, 78, 0, 1, 0, 0, 0];
  const hostFrame = (p, ev = []) => ({ k: 'f', t: 1, lv: 1, xp: 0, xn: 9, ki: 0, bo: 0, co: 0, tk: [0, 0], p, e: [], ev, ho: [] });
  const to = u => sent.filter(([d]) => d === u).map(([, f]) => f);
  return { C: G.Coop, sent, to, said, lost, waits, clock, net, api, local, state, hostFrame };
}

test('a downed guest sends the spectated view as a separate sp key; its state stays 15 entries', () => {
  const s = coopSim('a');
  assert.equal(s.sent.length, 1);                          // hello from begin(), before any tick
  assert.equal(s.sent[0][1].p.length, 15); assert.ok(!('sp' in s.sent[0][1]));
  s.sent.length = 0; s.local.dead = true; s.api.spec = [400, -300];
  s.C.tick(1 / 15);
  const f = s.sent[0][1];
  assert.equal(f.p.length, 15); assert.equal(f.p[6], 1); assert.deepEqual(f.sp, [400, -300]);
  assert.deepEqual(C.decode(C.encode(f)), f);
  s.api.spec = null; s.C.toHost(['re']);                   // watching your own Pokémon again: no sp
  assert.ok(!('sp' in s.sent[1][1])); assert.deepEqual(s.sent[1][1].ev, [['re']]);
});

test('host lists enemies and damage numbers around the point a downed guest is watching', () => {
  const s = coopSim('host');
  const frame = (dead, sp) => s.net.msg('a', Object.assign({ k: 'f', p: s.state(34, 0, dead), ev: [] }, sp === undefined ? {} : { sp }));
  const tick = () => { s.C.tick(1); return s.to('a').at(-1); };
  frame(1, [3000, 10]);
  assert.deepEqual(tick().e.map(e => e[0]), [2]);         // only the enemies by the teammate being watched
  s.C.hurtShown({ id: 2, x: 3000, y: 0 }, 12, '#fff'); s.C.hurtShown({ id: 1, x: 0, y: 0 }, 7, '#fff');
  assert.deepEqual(tick().ev, [['hn', 2, 12, '#fff']]);
  frame(0, [3000, 10]);
  assert.deepEqual(tick().e.map(e => e[0]), [1]);         // standing: always around its own Pokémon
  frame(1);
  assert.deepEqual(tick().e.map(e => e[0]), [1]);         // older clients send no sp
  for (const bad of [[null, 2], [1], ['1', 2], 'x', [1, 2, 3]]) { frame(1, bad); assert.deepEqual(tick().e.map(e => e[0]), [1]); }
});

test("host tells everyone when a teammate leaves ('gone'); guests drop it, also if that notice is lost", () => {
  const h = coopSim('host');
  h.net.msg('a', { k: 'f', p: h.state(10, 0), ev: [] }); h.net.msg('b', { k: 'f', p: h.state(20, 0), ev: [] });
  h.net.peer('a', 'closed');
  assert.equal(h.C.mate('a').connected, false); assert.equal(h.C.players().length, 2);
  assert.deepEqual(h.to('a').at(-1).ev.at(-1), ['gone', 'a']);        // also to the one who left, in case it is still there
  h.C.tick(1);
  const fb = h.to('b').at(-1);
  assert.ok(fb.ev.some(e => e[0] === 'gone' && e[1] === 'a')); assert.deepEqual(Object.keys(fb.p), ['host']);
  assert.ok(h.said.includes('Ana ha dejado la partida'));

  const g = coopSim('b');
  assert.equal(g.C.fresh(g.C.mate('a')), false);                       // nothing heard of Ana yet
  g.net.msg('host', g.hostFrame({ host: g.state(0, 0), a: g.state(10, 0) }));
  assert.equal(g.C.fresh(g.C.mate('a')), true); assert.equal(g.C.players().length, 3);
  g.net.msg('host', g.hostFrame({ host: g.state(0, 0) }, [['zz', 1], ['gone', 'a']]));    // unknown events are ignored
  assert.equal(g.C.mate('a').connected, false); assert.equal(g.C.fresh(g.C.mate('a')), false);
  assert.deepEqual(g.C.puppets(), [g.C.mate('host').pl]);

  // The notice got lost: a teammate the host stops sending is gone after 3 s of host frames without it...
  const n = coopSim('b');
  n.net.msg('host', n.hostFrame({ host: n.state(0, 0), a: n.state(10, 0) }));
  for (const t of [1000, 2000, 2900]) { n.clock.now = t; n.net.msg('host', n.hostFrame({ host: n.state(0, 0) })); }
  assert.equal(n.C.mate('a').connected, true);
  n.clock.now = 3100; n.net.msg('host', n.hostFrame({ host: n.state(0, 0) }));
  assert.equal(n.C.mate('a').connected, false); assert.equal(n.C.mate('host').connected, true);
  // ...but a host that goes quiet (its tab in the background) drops nobody.
  const q = coopSim('b');
  q.net.msg('host', q.hostFrame({ host: q.state(0, 0), a: q.state(10, 0) }));
  q.clock.now = 20000; assert.equal(q.C.fresh(q.C.mate('a')), false);
  q.net.msg('host', q.hostFrame({ host: q.state(0, 0), a: q.state(10, 0) }));
  assert.equal(q.C.mate('a').connected, true); assert.equal(q.C.fresh(q.C.mate('a')), true);

  // 'gone' about yourself: the host was getting nothing from you, so your run ends (and nothing after it runs).
  const me = coopSim('b');
  me.net.msg('host', me.hostFrame({ host: me.state(0, 0) }, [['gone', 'b'], ['heal', 0.3]]));
  assert.equal(me.C.active, false); assert.deepEqual(me.lost, ['Se ha perdido la conexión con el anfitrión.']);
});

test('host drops a teammate with no first frame after 10 s, never one whose tab merely went quiet', () => {
  const s = coopSim('host');
  s.clock.now = 500; s.net.msg('a', { k: 'f', p: s.state(10, 0), ev: [] });
  assert.equal(s.C.fresh(s.C.mate('a')), true); assert.equal(s.C.fresh(s.C.mate('b')), false);
  s.C.levelStart(2);
  assert.deepEqual(s.waits.at(-1), ['Tú', 'Ana', 'Bea']);
  s.clock.now = 9900; s.C.tick(1);
  assert.equal(s.C.mate('b').connected, true);
  s.clock.now = 10100; s.C.tick(1);
  assert.equal(s.C.mate('b').connected, false); assert.equal(s.C.mate('a').connected, true);
  assert.deepEqual(s.waits.at(-1), ['Tú', 'Ana']);                     // the level-up cards stop waiting for Bea
  assert.ok(s.said.includes('Bea no ha podido entrar en la partida'));
  s.C.tick(1); assert.ok(s.to('a').some(f => f.ev.some(e => e[0] === 'gone' && e[1] === 'b')));
  s.clock.now = 600000; s.C.tick(1);                                     // Ana sent once, then went quiet
  assert.equal(s.C.mate('a').connected, true);
});
