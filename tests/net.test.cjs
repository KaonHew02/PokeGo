const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { frame, client } = require('./net-fixtures.cjs');
const { fakeClock, peerServer, browser, flush } = require('./net-peerfake.cjs');
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
  const pcs = [], relay = [], queues = {}, G = { NetCodec: codec(), DB: { fb: { uid: 'host', rtdb: {
    ref: p => ({ on: (ev, fn) => { queues[p] = fn; }, off() {}, push: s => { relay.push([p, s]); return Promise.resolve(); } })
  } } } };
  class PC {
    constructor() { pcs.push(this); this.ice = []; this.remoteDescription = null; }
    createDataChannel() {
      return this.dc = { readyState: 'open', sent: [], send(data) { if (this.fail) throw Error('closed'); this.sent.push(data); }, close() {} };
    }
    createOffer() { return Promise.resolve({ type: 'offer' }); }
    setLocalDescription() { this.localDescription = { toJSON: () => ({ type: 'offer' }) }; return Promise.resolve(); }
    setRemoteDescription(d) { return Promise.resolve().then(() => { this.remoteDescription = d; }); }
    addIceCandidate(c) { this.ice.push(c); return Promise.resolve(); }
    close() {}
  }
  new Function('G', 'RTCPeerConnection', 'setTimeout', 'clearTimeout', source('js/net/net.js'))(G, PC, () => 1, () => {});
  G.Net.open('test', true, 'host'); G.Net.syncMembers(['host', 'a', 'b']);
  for (const pc of pcs) pc.dc.onopen();
  const cap = dc => dc.onmessage({ data: JSON.stringify({ k: 'net-cap', binary: 1 }) });
  // Un mensaje de señalización que llega por la base de datos (rooms/test/q/host).
  const signal = (f, sig) => queues['rooms/test/q/host']({ val: () => JSON.stringify({ f, sig }), ref: { remove: () => Promise.resolve() } });
  return { N: G.Net, G, pcs, relay, cap, signal };
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
test('host applies ICE candidates that arrive while the answer is applied; drop() forgets queued ones', async () => {
  const { N, pcs, signal } = network(), [a, b] = pcs;
  // Un candidato del invitado que llega antes que su respuesta (o mientras se aplica) se guarda...
  signal('a', { c: { candidate: 'c-early' } });
  signal('a', { sdp: { type: 'answer', sdp: 'v=0' } });
  signal('a', { c: { candidate: 'c-during' } });
  await flush();
  // ...y se usa al aplicar la respuesta (antes se quedaba sin usar).
  assert.deepEqual(a.ice.map(c => c.candidate).sort(), ['c-during', 'c-early']);
  // Los guardados de alguien que sale de la sala no pasan a su próxima conexión.
  signal('b', { c: { candidate: 'stale' } });
  N.syncMembers(['host', 'a']); N.syncMembers(['host', 'a', 'b']);
  const b2 = pcs.at(-1); assert.notEqual(b2, b);
  signal('b', { sdp: { type: 'answer', sdp: 'v=0' } });
  await flush();
  assert.deepEqual(b2.ice, []);
});
test('cloud without Realtime Database (no databaseURL): opening a room does nothing instead of throwing', () => {
  const G = { NetCodec: codec(), DB: { fb: { uid: 'u', rtdb: null } } };
  new Function('G', 'RTCPeerConnection', 'setTimeout', 'clearTimeout', source('js/net/net.js'))(G, class {}, () => 1, () => {});
  assert.doesNotThrow(() => G.Net.open('room', false, 'host'));
  assert.equal(G.Net.open_, false);
  G.DB.fb = null;
  assert.doesNotThrow(() => { G.Net.open('room', true, 'u'); G.Net.syncMembers(['u', 'x']); G.Net.send('x', { k: 'start' }); });
});

// ---------------- salas con código (coderoom.js + net.js con un PeerJS falso) ----------------

const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
async function codeRoom(names = ['Ash']) {
  const clock = fakeClock(), server = peerServer(clock);
  const host = browser(server, clock);
  const made = host.G.CodeRoom.create(names[0]);
  await clock.tick(20);
  const r = await made;
  assert.ok(r.ok && CODE.test(r.code), JSON.stringify(r));
  return { clock, server, host, code: r.code };
}
async function join(env, name, opt) {
  const g = browser(env.server, env.clock, opt);
  const p = g.G.CodeRoom.join(env.code.toLowerCase(), name);
  await env.clock.tick(100);
  g.res = await Promise.race([p, Promise.resolve('pending')]);
  return g;
}
const namesOf = b => b.room.members.map(m => m.name);

test('room code: host registers pokego-<code>; hello gets welcome and every member gets the list', async () => {
  const env = await codeRoom(), { host, server } = env;
  assert.ok(server.ids.has('pokego-' + env.code.toLowerCase()));
  assert.equal(host.room.isHost, true); assert.equal(host.room.code, env.code);
  const misty = await join(env, 'Misty', { dex: 4 });
  assert.deepEqual(misty.res, { ok: true });
  assert.equal(misty.room.host, 'pokego-' + env.code.toLowerCase());
  assert.deepEqual(namesOf(misty), ['Ash', 'Misty']); assert.deepEqual(namesOf(host), ['Ash', 'Misty']);
  assert.equal(host.room.members[1].dex, 4);
  // Los dos con canal directo de net.js (y binario negociado).
  assert.equal(host.G.Net.mode(misty.id), 'direct'); assert.equal(misty.G.Net.mode(host.id), 'direct');
  // Otro con el mismo nombre que el anfitrión: el anfitrión le pone un número.
  const ash = await join(env, 'Ash');
  assert.deepEqual(namesOf(host), ['Ash', 'Misty', 'Ash 2']);
  assert.equal(ash.room.me.name, 'Ash 2');
  await env.clock.tick(20);
  assert.deepEqual(namesOf(misty), ['Ash', 'Misty', 'Ash 2']);       // la lista nueva llega a los demás
  // Lo de la partida va por el mismo canal: el aviso de empezar llega a todos los de la sala.
  host.G.CodeRoom.setOpen(false);
  host.G.Net.broadcast({ k: 'start', seed: 7, host: host.id });
  await env.clock.tick(20);
  for (const g of [misty, ash]) {
    assert.equal(g.room.open, false);
    assert.ok(g.got.some(([from, m]) => from === host.id && m.k === 'start' && m.seed === 7));
  }
  // Y los envíos de la partida, en binario.
  misty.G.Net.toHost({ k: 'f', p: [1, 2, 3], ev: [] });
  await env.clock.tick(20);
  assert.ok(host.got.some(([from, m]) => from === misty.id && m.k === 'f'));
  assert.ok(misty.G.Net.stats.binarySent >= 1);
});

test('room code: refused when full, already started or another game version; refused callers are hung up', async () => {
  const env = await codeRoom(), { host } = env;
  for (const n of ['B', 'C', 'D']) assert.deepEqual((await join(env, n)).res, { ok: true });
  assert.equal(host.room.members.length, 4);
  const fifth = await join(env, 'E');
  assert.equal(fifth.res.ok, false); assert.match(fifth.res.error, /llena \(máximo 4\)/);
  assert.equal(fifth.room, null); assert.equal(fifth.G.Net.open_, false);
  await env.clock.tick(1500);
  assert.equal(host.G.Net.peers().length, 3);
  assert.equal(host.room.members.length, 4);
  // Con la partida empezada (sala cerrada) y otra versión del juego.
  const env2 = await codeRoom();
  const other = await join(env2, 'Old', { version: '0123abcd' });
  assert.equal(other.res.ok, false); assert.match(other.res.error, /otra versión/);
  env2.host.G.CodeRoom.setOpen(false);
  const late = await join(env2, 'Late');
  assert.equal(late.res.ok, false); assert.match(late.res.error, /ya ha empezado/);
  env2.host.G.CodeRoom.setOpen(true);
  assert.deepEqual((await join(env2, 'OnTime')).res, { ok: true });
});

test('room code: wrong or malformed codes, unreachable server and taken codes', async () => {
  const env = await codeRoom();
  const g = browser(env.server, env.clock);
  const wrong = g.G.CodeRoom.join(env.code === 'ZZZZZ' ? 'YYYYY' : 'zzzzz', 'X');
  await env.clock.tick(6000);
  const r = await wrong;
  assert.equal(r.ok, false); assert.match(r.error, /No hay ninguna sala/);
  assert.equal(g.G.Net.open_, false);
  assert.match((await g.G.CodeRoom.join('ab', 'X')).error, /5 letras/);
  assert.match((await g.G.CodeRoom.join('AB0DE', 'X')).error, /No hay ninguna sala/);   // sin 0/O/1/I/L: no existe
  // Servidor de salas caído.
  env.server.down = true;
  const made = g.G.CodeRoom.create('X');
  await env.clock.tick(50);
  const down = await made;
  assert.equal(down.ok, false); assert.match(down.error, /servidor de salas/);
  env.server.down = false;
  // Código ya cogido: se prueba otro.
  const clock = fakeClock(), server = peerServer(clock);
  new server.Peer('pokego-aaaaa');
  await clock.tick(5);
  let calls = 0;
  const zeros = a => { if (calls++ < 1) a.fill(0); else require('node:crypto').webcrypto.getRandomValues(a); return a; };
  const h = browser(server, clock, { random: zeros });
  const p = h.G.CodeRoom.create('H');
  await clock.tick(50);
  const res = await p;
  assert.ok(res.ok && CODE.test(res.code) && res.code !== 'AAAAA', JSON.stringify(res));
});

test('room code: a guest leaving is removed for everyone; the host leaving closes the room', async () => {
  const env = await codeRoom(), { host, clock } = env;
  const b = await join(env, 'B'), c = await join(env, 'C');
  const leaving = b.G.CodeRoom.leave();
  await clock.tick(500);
  await leaving;
  assert.equal(b.room, null); assert.equal(b.G.Net.open_, false);
  assert.deepEqual(namesOf(host), ['Ash', 'C']); assert.deepEqual(namesOf(c), ['Ash', 'C']);
  assert.equal(host.G.Net.peers().length, 1);
  const closing = host.G.CodeRoom.leave();
  await clock.tick(500);
  await closing;
  assert.equal(host.room, null); assert.equal(host.G.Net.open_, false);
  assert.equal(c.room, null); assert.equal(c.G.Net.open_, false);
  assert.deepEqual(c.emits.at(-1), { ended: 'El anfitrión ha cerrado la sala.' });
  assert.equal(env.server.ids.size, 0);                                 // nadie sigue registrado
});

test('room code: a dropped guest calls back and keeps its place; one that never returns is removed after the wait', async () => {
  const env = await codeRoom(), { host, clock, server } = env;
  const b = await join(env, 'B'), c = await join(env, 'C');
  // Se corta el canal de B (red que parpadea): los dos lo ven caído y B vuelve a llamar.
  server.ids.get(b.id).conns.find(x => x.open).close();
  await clock.tick(50);
  assert.equal(host.G.Net.mode(b.id), 'failed'); assert.equal(b.G.Net.mode(host.id), 'failed');
  await clock.tick(6000);
  assert.equal(b.G.Net.mode(host.id), 'direct'); assert.equal(host.G.Net.mode(b.id), 'direct');
  assert.deepEqual(namesOf(host), ['Ash', 'B', 'C']); assert.ok(b.room);
  // C desaparece sin despedirse (pestaña cerrada de golpe): se le espera y después se le quita.
  server.ids.get(c.id).destroy();
  await clock.tick(5000);
  assert.deepEqual(namesOf(host), ['Ash', 'B', 'C']);
  await clock.tick(20000);
  assert.deepEqual(namesOf(host), ['Ash', 'B']); assert.deepEqual(namesOf(b), ['Ash', 'B']);
});

test('room code: if the host vanishes, guests find out and leave the room', async () => {
  const env = await codeRoom(), { clock, server } = env;
  const b = await join(env, 'B');
  server.ids.get(env.host.id).destroy();                                // sin avisar
  await clock.tick(30000);
  assert.equal(b.room, null); assert.equal(b.G.Net.open_, false);
  assert.deepEqual(b.emits.at(-1), { ended: 'El anfitrión ha cerrado la sala.' });
});

test('room code: callers that never present themselves are hung up; joining can be cancelled', async () => {
  const env = await codeRoom(), { host, clock, server } = env;
  const stranger = new server.Peer('pokego-gstranger');
  await clock.tick(5);
  const call = stranger.connect(host.id, { reliable: true, serialization: 'raw' });
  await clock.tick(50);
  assert.equal(host.G.Net.peers().length, 1);
  assert.equal(host.room.members.length, 1);
  // Sin presentarse no llega nada a la partida (ni un aviso de empezar falso).
  call.dataChannel.send(JSON.stringify({ k: 'start', seed: 1, host: 'pokego-gstranger', members: [] }));
  call.dataChannel.send(JSON.stringify({ k: 'f', p: [0, 0] }));
  await clock.tick(20);
  assert.deepEqual(host.got.filter(([from]) => from === 'pokego-gstranger'), []);
  // Y de un invitado de la sala, tampoco un 'start': sólo lo manda el anfitrión.
  const b = await join(env, 'B');
  b.G.Net.toHost({ k: 'start', seed: 2, host: b.id, members: [] });
  await clock.tick(20);
  assert.ok(!host.got.some(([, m]) => m.k === 'start'));
  const bye = b.G.CodeRoom.leave();
  await clock.tick(500);
  await bye;
  await clock.tick(21000);
  assert.equal(host.G.Net.peers().length, 0);
  // Otro formato (no 'raw'): ni se acepta.
  stranger.connect(host.id, { reliable: true, serialization: 'binary' });
  await clock.tick(50);
  assert.equal(host.G.Net.peers().length, 0);
  // Cancelar mientras se entra (sin red que deje conectar).
  server.block = true;
  const g = browser(server, clock);
  const p = g.G.CodeRoom.join(env.code, 'G');
  await clock.tick(100);
  assert.equal(g.G.CodeRoom.busy, true);
  g.G.CodeRoom.cancel();
  await clock.tick(10);
  assert.deepEqual(await p, { ok: false });
  assert.equal(g.G.Net.open_, false); assert.equal(g.G.CodeRoom.busy, false);
  // Y sin cancelar: aviso de que la red no deja conectar.
  const g2 = browser(server, clock);
  const p2 = g2.G.CodeRoom.join(env.code, 'G2');
  await clock.tick(16000);
  const r2 = await p2;
  assert.equal(r2.ok, false); assert.match(r2.error, /algunas redes no dejan conectar/);
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
    G.Coop.tick(1 / 15);
    assert.equal(sent.length, 1);
    assert.deepEqual(C.decode(C.encode(sent[0])), sent[0]);
    if (host) { assert.deepEqual(sent[0].e, [[123, 50, -10, 126, 1, 3, 1]]); assert.ok('ho' in sent[0]); }
    else { assert.equal(sent[0].p.length, 15); }
  }
});
