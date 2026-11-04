// Esferas de Mundo Misterioso (js/systems/orbs.js), Amuletos Iris y gacha ×100
// (js/systems/gacha.js) y lo que hace AUTO con las esferas (js/systems/autopilot.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ---------------- esferas ----------------

const emptyBag = () => [null, null, null, null];
const player = (o = {}) => Object.assign({ x: 0, y: 0, bodyH: 20, orbs: emptyBag(), orbSel: 0, orbFx: {}, orbSeen: {},
  critChance: 0.1, spdMul: 1.5 }, o);
/** Un enemigo como los de verdad en lo que tocan las esferas. */
const enemy = (x, y, o = {}) => Object.assign({ x, y, kx: 0, ky: 0, slow: 0, slowT: 0, stunT: 0,
  applySleep(d) { this.zzz = true; this.stunT = Math.max(this.stunT, d); },
  applySlow(f, d) { this.slow = Math.max(this.slow, f); this.slowT = Math.max(this.slowT, d); } }, o);

/** orbs.js de verdad con un juego de mentira. o: { coop: 'host' | 'guest', enemies }. */
function bootOrbs(o = {}) {
  const ctx = { console, Math };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/core/util.js', 'js/systems/orbs.js']) vm.runInContext(source(f), ctx, { filename: f });
  const G = ctx.G, said = [], toHost = [], sent = [];
  const pl = player();
  Object.assign(G, {
    Coop: { active: !!o.coop, isHost: o.coop === 'host', toHost: e => toHost.push(e), broadcast: e => sent.push(e) },
    Game: { player: pl, state: 'playing' }, Judgment: { cinematic: false },
    Camera: { w: 800, h: 400, zoomTo: 1, setZoom(k) { this.zoomTo = k; } },
    EnemyMgr: { all: () => o.enemies || [] },
    FX: { ring() {}, burst() {}, dmgText() {} }, Audio: { sfx() {} },
    Spawner: { say: t => said.push(t) }, Touch: { active: true }, Pad: { name: '' }, Settings: { get: () => undefined },
    T: s => s, I18n: { f: (s, x) => s.replace('{x}', x) }
  });
  return { G, O: G.Orbs, pl, said, toHost, sent };
}

test('you carry up to 4 different orbs, 3 of each; what does not fit stays out', () => {
  const { O, pl } = bootOrbs();
  const ids = O.LIST.map(o => o.id);
  assert.equal(ids.length, 6);
  for (let i = 0; i < 3; i++) assert.equal(O.take(pl, ids[0]), 0);
  assert.equal(pl.orbs[0].n, 3);
  assert.equal(O.canTake(pl, ids[0]), false);
  assert.equal(O.take(pl, ids[0]), -1);
  assert.equal(pl.orbs[0].n, 3);
  for (let i = 1; i < 4; i++) assert.equal(O.take(pl, ids[i]), i);
  assert.equal(O.canTake(pl, ids[4]), false, 'a fifth kind does not fit');
  assert.equal(O.canTake(pl, ids[1]), true, 'but more of one you carry does');
  assert.equal(O.take(pl, 'nothing'), -1);
  assert.equal(O.take(pl, '__proto__'), -1);
  // Un compañero lo mira en su ordenador: al anfitrión siempre le vale.
  assert.equal(O.canTake({ remote: true, orbs: pl.orbs }, ids[4]), true);
});

test('orbs keep their slot, so their key does not change when another one runs out', () => {
  const { O, pl } = bootOrbs();
  const [a, b, c] = O.LIST.map(o => o.id);
  O.take(pl, a); O.take(pl, b);
  assert.equal(O.use(pl, 0), true);
  assert.equal(pl.orbs[0], null);
  assert.equal(pl.orbs[1].id, b, 'still in the second slot');
  assert.equal(pl.orbSel, 1, 'the gamepad moves to one you still have');
  assert.equal(O.take(pl, c), 0, 'a new one fills the free slot');
  assert.equal(O.use(pl, 3), false, 'nothing in that slot');
});

test('in solo the drop is always one that fits; in a group it can be any', () => {
  const s = bootOrbs();
  const ids = s.O.LIST.map(o => o.id);
  for (const id of ids.slice(0, 4)) s.O.take(s.pl, id);
  for (let i = 0; i < 300; i++) assert.ok(ids.slice(0, 4).includes(s.O.rollDrop()));
  const g = bootOrbs({ coop: 'host' }), seen = new Set();
  for (const id of ids.slice(0, 4)) g.O.take(g.pl, id);
  for (let i = 0; i < 2000; i++) seen.add(g.O.rollDrop());
  assert.equal(seen.size, 6);
});

test('the first orb of each kind says what it does and how to use it, once', () => {
  const s = bootOrbs();
  s.O.got(s.pl, 'orbSleep'); s.O.got(s.pl, 'orbSleep');
  assert.equal(s.said.length, 1);
  assert.ok(s.said[0].includes('Soporesfera') && s.said[0].includes('tócala encima de tus ataques'));
  s.G.Touch.active = false; s.O.got(s.pl, 'orbSlow');
  assert.ok(s.said[1].includes('tecla 6'));
  s.G.Pad.name = 'Pad'; s.O.got(s.pl, 'orbBlast');
  assert.ok(s.said[2].includes('X para usarla'));
  for (let i = 0; i < 2; i++) s.O.take(s.pl, 'orbSlow');
  s.O.got(s.pl, 'orbSlow');
  assert.ok(s.said.at(-1).includes('No te caben'));
});

test('Soporesfera and Ralentosfera reach the enemies on screen; bosses and legendaries get less', () => {
  const on = enemy(300, 100), off = enemy(500, 0), boss = enemy(-200, 0, { boss: true }), legend = enemy(100, 100, { legend: true }), dead = enemy(0, 0, { dead: true });
  const s = bootOrbs({ enemies: [on, off, boss, legend, dead] });
  s.O.take(s.pl, 'orbSleep'); s.O.take(s.pl, 'orbSlow');
  assert.equal(s.O.use(s.pl, 0), true);
  assert.equal(on.stunT, 4); assert.equal(on.zzz, true);
  assert.equal(off.stunT, 0, 'off screen');
  assert.equal(boss.stunT, 1); assert.equal(legend.stunT, 1);
  assert.equal(dead.stunT, 0);
  s.O.use(s.pl, 1);
  assert.equal(on.slow, 0.5); assert.equal(on.slowT, 8);
  assert.equal(off.slow, 0);
  assert.equal(boss.slow, 0.2); assert.equal(boss.slowT, 8);
  assert.deepEqual(s.pl.orbs, emptyBag(), 'single use');
});

test('Rafagaesfera blows nearby enemies away, half as far for bosses, and wakes them so they fly', () => {
  const near = enemy(100, 0, { stunT: 3, zzz: true }), far = enemy(300, 0), boss = enemy(0, -100, { boss: true });
  const s = bootOrbs({ enemies: [near, far, boss] });
  s.O.take(s.pl, 'orbBlast');
  s.O.use(s.pl, 0);
  assert.equal(near.kx, s.O.BLAST); assert.equal(near.ky, 0);
  assert.equal(near.stunT, 0); assert.equal(near.zzz, false);
  assert.equal(far.kx, 0, 'too far');
  assert.equal(boss.ky, -s.O.BLAST / 2);
  assert.ok(s.O.BLAST_R >= 200);
});

test('Focosfera, Rapidosfera and Luminosfera last their time, do not stack, and undo exactly', () => {
  const s = bootOrbs(), { O, pl, G } = s;
  for (let i = 0; i < 2; i++) O.take(pl, 'orbFocus');
  O.take(pl, 'orbSpeed'); O.take(pl, 'orbLight');
  O.use(pl, 0);
  assert.ok(Math.abs(pl.critChance - 0.35) < 1e-9);
  O.tick(pl, 5);
  assert.equal(pl.orbFx.orbFocus, 10);
  O.use(pl, 0);                                    // la segunda sólo vuelve a empezar
  assert.ok(Math.abs(pl.critChance - 0.35) < 1e-9);
  assert.equal(pl.orbFx.orbFocus, 15);
  O.use(pl, 1); O.use(pl, 2);
  assert.ok(Math.abs(pl.spdMul - 2.1) < 1e-9);
  assert.equal(G.Camera.zoomTo, O.VIEW);
  O.tick(pl, 10.01);
  assert.ok(Math.abs(pl.spdMul - 1.5) < 1e-9, 'Rapidosfera lasts 10 s');
  assert.equal(pl.orbFx.orbSpeed, undefined);
  assert.equal(G.Camera.zoomTo, O.VIEW);
  O.tick(pl, 5);
  assert.ok(Math.abs(pl.critChance - 0.1) < 1e-9);
  assert.equal(G.Camera.zoomTo, 1);
  assert.deepEqual(Object.keys(pl.orbFx), []);
});

test('no orbs while down, frozen, in a menu or during the Arceus cinematic', () => {
  for (const change of [s => { s.pl.dead = true; }, s => { s.pl.frozen = true; }, s => { s.G.Game.state = 'paused'; }, s => { s.G.Judgment.cinematic = true; }]) {
    const s = bootOrbs();
    s.O.take(s.pl, 'orbFocus');
    change(s);
    assert.equal(s.O.use(s.pl, 0), false);
    assert.equal(s.pl.orbs[0].n, 1, 'not spent');
  }
});

test('gamepad: Y moves to the next orb you carry, X uses the selected one', () => {
  const { O, pl } = bootOrbs();
  O.take(pl, 'orbFocus'); O.take(pl, 'orbSpeed'); O.take(pl, 'orbLight');
  pl.orbs[1] = null;
  O.step(pl);
  assert.equal(pl.orbSel, 2, 'skips the empty slot');
  O.step(pl); assert.equal(pl.orbSel, 0, 'wraps around');
  O.step(pl, -1); assert.equal(pl.orbSel, 2);
  assert.equal(O.useSelected(pl), true);
  assert.equal(pl.orbs[2], null);
});

test('co-op guest: enemy orbs go to the host (nothing happens to the copies here); buffs are yours at once', () => {
  const copy = enemy(50, 0, { remote: true });
  const s = bootOrbs({ coop: 'guest', enemies: [copy] });
  s.O.take(s.pl, 'orbSleep'); s.O.take(s.pl, 'orbFocus');
  s.O.use(s.pl, 0);
  assert.equal(copy.stunT, 0);
  assert.deepEqual([...s.toHost[0]], ['ou', 'orbSleep', 0, 0, 400, 200]);
  s.O.use(s.pl, 1);
  assert.ok(Math.abs(s.pl.critChance - 0.35) < 1e-9);
  assert.equal(s.toHost[1][1], 'orbFocus');
});

test('co-op host: enemy orbs of a guest reach the enemies on its screen; team orbs reach whoever is near', () => {
  const near = enemy(900, 0), far = enemy(100, 0);
  const s = bootOrbs({ coop: 'host', enemies: [near, far] });
  s.O.fromMate('orbSleep', 1000, 0, 400, 200);
  assert.equal(near.stunT, 4); assert.equal(far.stunT, 0);
  s.O.fromMate('orbFocus', 200, 0, 400, 200);
  assert.ok(s.pl.orbFx.orbFocus > 0, 'the host is near');
  s.O.fromMate('orbSpeed', 2000, 0, 400, 200);
  assert.equal(s.pl.orbFx.orbSpeed, undefined, 'too far');
  s.O.fromMate('constructor', 0, 0, 400, 200);        // lo que llega por la red no se cree a ciegas
  s.O.heard('__proto__', 0, 0);
  s.pl.dead = true;
  s.O.heard('orbLight', 0, 0);
  assert.equal(s.pl.orbFx.orbLight, undefined, 'not while down');
  // Su propia esfera también la ven los demás.
  s.pl.dead = false;
  s.O.take(s.pl, 'orbBlast');
  s.O.use(s.pl, 0);
  assert.deepEqual([...s.sent[0]], ['ou', 'orbBlast', 0, 0]);
});

/** coop.js de verdad con orbs.js de verdad y una red de mentira. */
function coopOrbs(uid, enemies = []) {
  const sent = [], net = {}, G = {}, pl = player({ moveAngle: 0, walking: false, hp: 300, maxHp: 300, dead: false, magnet: 78, aim: 0, xpMul: 1, reviveT: 0, activeGroup: () => [] });
  const ctx = { console, Math };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/core/util.js', 'js/systems/orbs.js']) vm.runInContext(source(f), ctx, { filename: f });
  const added = [];
  Object.assign(ctx.G, {
    Net: { uid, on: fn => { net.msg = fn; }, onPeer() {}, slow: () => false, BUF_HIGH: 65536, backlog: () => 0, closing: false,
           send: (to, f) => !!sent.push([to, f]), toHost: f => !!sent.push(['host', f]) },
    Player: class { constructor() { this.maxHp = 300; } }, DEX_BY: { 25: { dex: 25 } }, baseStartOf: () => 'thundershock',
    Sprites: { preload() {} }, Social: { me: null }, Judgment: { netState: () => null, cinematic: false }, Projectiles: { clearOrbs() {} },
    EnemyMgr: { all: () => enemies, get: () => null }, Game: { player: pl, state: 'playing' },
    Camera: { w: 800, h: 400, setZoom() {} }, FX: { ring() {}, burst() {}, dmgText() {} }, Audio: { sfx() {} },
    Spawner: { say() {} }, Touch: { active: true }, Pad: { name: '' }, Settings: { get: () => undefined }, T: s => s, I18n: { f: s => s },
    Pickups: { addRemote: (...a) => added.push(a) }
  });
  vm.runInContext(`new Function('G', 'document', 'performance', ${JSON.stringify(source('js/net/coop.js'))})(G, { addEventListener() {} }, { now: () => 0 })`, ctx);
  const C = ctx.G.Coop;
  C.begin({ host: 'host', members: [{ uid: 'host', name: 'Hugo', dex: 25 }, { uid: 'a', name: 'Ana', dex: 25 }, { uid: 'b', name: 'Bea', dex: 25 }] }, pl,
    { team: () => ({ time: 1, level: 1, xp: 0, xpNext: 9, kills: 0, bosses: 0, coins: 0, t1: 0, t10: 0 }), choosing: () => false, syncTeam() {}, levelStart() {}, resume() {} });
  const state = (x, y) => [x, y, 0, 0, 300, 300, 0, 'thundershock', 1, 78, 0, 1, 0, 0, 0];
  const hostFrame = ev => ({ k: 'f', t: 1, lv: 1, xp: 0, xn: 9, ki: 0, bo: 0, co: 0, tk: [0, 0], p: {}, e: [], ev, ho: [] });
  return { G: ctx.G, C, O: ctx.G.Orbs, pl, net, sent, state, hostFrame, added, to: u => sent.filter(([d]) => d === u).map(([, f]) => f) };
}

test('real coop.js: a guest uses an orb, the host applies it and tells the others (not the guest again)', () => {
  const foe = enemy(900, 0, { id: 1, hp: 50, anim: { cur: 'Walk', dir: 0 } });
  const h = coopOrbs('host', [foe]);
  h.net.msg('a', { k: 'f', p: h.state(1000, 0), ev: [['ou', 'orbSleep', 1000, 0, 400, 200]] });
  h.net.msg('b', { k: 'f', p: h.state(20, 0), ev: [] });
  assert.equal(foe.stunT, 4);
  h.C.tick(1);
  const toB = h.to('b').at(-1), toA = h.to('a').at(-1);
  assert.deepEqual([...toB.ev.find(e => e[0] === 'ou')], ['ou', 'orbSleep', 1000, 0]);
  assert.equal(toA.ev.find(e => e[0] === 'ou'), undefined);
  // En el estado del enemigo: 16 quieto, 32 dormido.
  assert.equal(toA.e[0][6] & 48, 48);
  // Basura: ni id que no existe ni números raros rompen nada.
  h.net.msg('a', { k: 'f', p: h.state(1000, 0), ev: [['ou', 'nothing', 0, 0, 1, 1], ['ou', 'orbSlow', 'x', null, 1e99, -5]] });
  assert.equal(foe.slow, 0.5, 'bad numbers fall back to where the guest is');
});

test('real coop.js: orbs on the ground never go as pk (old clients crash drawing an unknown kind)', () => {
  const h = coopOrbs('host');
  h.net.msg('a', { k: 'f', p: h.state(10, 0), ev: [] });
  h.net.msg('b', { k: 'f', p: h.state(20, 0), ev: [] });
  h.C.pickupAdded({ id: 7, kind: 'orb', x: 10.4, y: 20.6, value: 'orbFocus' });
  h.C.pickupAdded({ id: 8, kind: 'coin', x: 1, y: 2, value: 3 });
  h.C.collected({ id: 7, kind: 'orb', value: 'orbFocus' }, h.C.mate('a').pl);
  h.C.tick(1);
  const ev = [...h.to('a').at(-1).ev].map(e => [...e]);
  assert.deepEqual(ev.find(e => e[0] === 'pko'), ['pko', 7, 'orbFocus', 10, 21]);
  assert.deepEqual(ev.filter(e => e[0] === 'pk').map(e => e[2]), ['coin']);
  assert.deepEqual(ev.find(e => e[0] === 'orb'), ['orb', 'orbFocus'], 'only to who picked it up');
  assert.equal(h.to('b').at(-1).ev.find(e => e[0] === 'orb'), undefined);
});

test('real coop.js: a guest gets the orb, sees the one on the ground and hears the team orb', () => {
  const g = coopOrbs('a');
  g.net.msg('host', g.hostFrame([['pko', 7, 'orbFocus', 10, 20], ['pko', 8, 'nothing', 0, 0], ['orb', 'orbSpeed'], ['ou', 'orbFocus', 50, 0]]));
  assert.deepEqual(g.added.map(a => [...a]), [[7, 'orb', 10, 20, 'orbFocus']]);
  assert.equal(g.pl.orbs[0].id, 'orbSpeed');
  assert.ok(g.pl.orbFx.orbFocus > 0);
});

// ---------------- gacha ----------------

function bootGacha(dex) {
  const ctx = { console, Math };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source('js/core/util.js'), ctx, { filename: 'js/core/util.js' });
  const G = ctx.G;
  G.DEX = dex;
  G.SPRITE_META = Object.fromEntries(dex.map(p => [p.dex, {}]));
  G.Sprites = { hasShiny: () => true };
  vm.runInContext(source('js/systems/gacha.js'), ctx, { filename: 'js/systems/gacha.js' });
  return G;
}
/** Una región con muchos de cada rareza (y otra aparte). */
function dex() {
  const out = [];
  let n = 1;
  for (const gen of [1, 2]) for (const rarity of [1, 2, 3, 4, 5]) for (let i = 0; i < 30; i++) out.push({ dex: n++, gen, rarity, bst: n });
  return out;
}
const save = (t1 = 0, t10 = 0) => ({ tickets: { t1, t10 }, owned: {}, shiny: {}, pity: {}, coins: 0, stats: {} });

test('×100 costs 100 normal tickets or 10 ×10 tickets; ×10 stays as it was', () => {
  const G = bootGacha(dex()), Ga = G.Gacha;
  assert.equal(Ga.costOf(save(99, 9), 100), null);
  assert.equal(Ga.costOf(save(99, 9), 100, 't10'), null);
  assert.deepEqual({ ...Ga.costOf(save(100), 100) }, { t1: 100, t10: 0 });
  assert.deepEqual({ ...Ga.costOf(save(0, 10), 100, 't10') }, { t1: 0, t10: 10 });
  assert.deepEqual({ ...Ga.costOf(save(0, 1), 10, 't10') }, { t1: 0, t10: 1 });
  assert.deepEqual({ ...Ga.costOf(save(10), 10) }, { t1: 10, t10: 0 });
  const a = save(150, 12);
  assert.equal(Ga.pull(a, 100, 1, 't1').length, 100);
  assert.deepEqual({ ...a.tickets }, { t1: 50, t10: 12 });
  assert.equal(Ga.pull(a, 100, 1, 't10').length, 100);
  assert.deepEqual({ ...a.tickets }, { t1: 50, t10: 2 });
  assert.equal(a.stats.pulls, 200);
  assert.equal(Ga.pull(a, 100, 1, 't10'), null, 'not enough left');
  assert.deepEqual({ ...a.tickets }, { t1: 50, t10: 2 });
});

test('every ×10 of a ×100 has its guaranteed Epic and the pity keeps counting', () => {
  const G = bootGacha(dex()), Ga = G.Gacha;
  const real = Math.random;
  // Peor suerte posible para las rarezas: sin la garantía saldrían todas comunes.
  let k = 0;
  G.U.pick = l => l[k++ % l.length];
  const ctxMath = Math;
  ctxMath.random = () => 0.001;
  try {
    const a = save(100);
    const res = Ga.pull(a, 100, 1);
    for (let i = 0; i < 100; i += 10) {
      const part = res.slice(i, i + 10);
      assert.ok(part.some(r => r.rarity >= 4), 'the ×10 number ' + i / 10);
      assert.equal(part.slice(0, 9).filter(r => r.rarity >= 4).length, 0);
      if (i < 60) assert.ok(part[9].rarity >= 4);
    }
    assert.equal(res[69].rarity, 5, 'pity at 70 pulls');
    assert.equal(a.pity[1], 30);
  } finally { ctxMath.random = real; }
});

test('the best of each ×10, the order from best to worst and the summary', () => {
  const { Gacha: Ga } = bootGacha(dex());
  const r = (rarity, o = {}) => Object.assign({ rarity, shiny: false, isNew: false, refund: 15 }, o);
  const ten = [r(1), r(4), r(2), r(1), r(1), r(1), r(3), r(1), r(1), r(1)];
  const shiny = r(1, { shiny: true, isNew: true, refund: 0 }), fresh = r(4, { isNew: true, refund: 0 });
  const res = [...ten, ...ten.slice(0, 9), fresh, ...ten.slice(0, 9), shiny];
  const best = Ga.bestOfTens(res);
  assert.equal(best.length, 3);
  assert.equal(best[0].rarity, 4);
  assert.equal(best[1], fresh, 'at the same rarity, the new one');
  assert.equal(best[2], shiny, 'a shiny beats any rarity');
  const sorted = Ga.bestFirst(res);
  assert.equal(sorted[0], shiny); assert.equal(sorted[1], fresh);
  assert.equal(sorted.length, res.length); assert.equal(res[0], ten[0], 'the list itself is left alone');
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1].shiny || sorted[i - 1].rarity >= sorted[i].rarity);
  const s = Ga.summary(res);
  assert.equal(s.fresh, 2); assert.equal(s.shiny, 1); assert.equal(s.coins, 15 * 28);
});

// ---------------- Amuletos Iris ----------------

test('Iris Charms come from what you own: nothing is stored, and complete regions count at once', () => {
  const d = dex(), { Gacha: Ga } = bootGacha(d);
  const s = save();
  const kanto = d.filter(p => p.gen === 1);
  assert.equal(Ga.hasCharm(s, 1), false);
  assert.equal(Ga.shinyRate(s, 1), 0.01);
  for (const p of kanto.slice(1)) s.owned[p.dex] = { at: 1 };
  assert.equal(Ga.hasCharm(s, 1), false, 'one missing');
  const before = JSON.stringify(s);
  const c = Ga.charms(s);
  assert.equal(c.length, 9);
  assert.deepEqual([c[0].have, c[0].total, c[0].on, c[0].missing.length, c[0].missing[0].dex], [kanto.length - 1, kanto.length, false, 1, kanto[0].dex]);
  s.owned[kanto[0].dex] = { at: 1 };
  assert.equal(Ga.hasCharm(s, 1), true);
  assert.equal(Ga.shinyRate(s, 1), 0.02);
  assert.equal(Ga.shinyRate(s, 2), 0.01, 'only in its own banner');
  assert.equal(Ga.charms(s)[0].on, true);
  assert.equal(Ga.charms(s)[2].on, false, 'a region with no Pokémon here has no charm');
  assert.equal(JSON.stringify(s).length > before.length, true);
  assert.deepEqual(Object.keys(s).sort(), Object.keys(save()).sort(), 'nothing new in the save');
});

test('the charm doubles shinies in its banner, from the next ×10 on if a pull completes the region', () => {
  const d = dex(), G = bootGacha(d), Ga = G.Gacha, real = Math.random;
  const rate = (s, gen) => {
    let shiny = 0;
    Math.random = (() => { let i = 0; return () => (i++ % 5 === 0 ? 0.015 : 0.5); })();   // los shiny, justo entre el 1 % y el 2 %
    s.tickets.t1 = 2000;
    for (let i = 0; i < 20; i++) shiny += Ga.pull(s, 100, gen).filter(r => r.shiny).length;
    Math.random = real;
    return shiny;
  };
  const plain = save(), charmed = save();
  for (const p of d.filter(x => x.gen === 1)) charmed.owned[p.dex] = { at: 1 };
  try {
    assert.equal(rate(plain, 2), 0);
    assert.ok(rate(charmed, 1) > 0);
  } finally { Math.random = real; }
  // Una ×100 que completa la región: la ×10 siguiente ya va al 2 %.
  const s = save(100);
  for (const p of d.filter(x => x.gen === 1).slice(1)) s.owned[p.dex] = { at: 1 };
  G.U.pick = l => l[0];
  assert.equal(Ga.hasCharm(s, 1), false);
  Ga.pull(s, 100, 1);
  assert.equal(Ga.hasCharm(s, 1), true);
});

// ---------------- AUTO ----------------

function bootAuto() {
  const ctx = { console, Math };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/core/util.js', 'js/systems/hazards.js', 'js/data/moves.js', 'js/systems/autopilot.js']) vm.runInContext(source(f), ctx, { filename: f });
  return ctx.G;
}
const calm = (o = {}) => Object.assign({ hp: 1, close: 0, screen: 0, boss: false, bossNear: false, fx: {} }, o);
const bag = (...ids) => { const b = emptyBag(); ids.forEach((id, i) => { b[i] = { id, n: 1 }; }); return b; };

test('AUTO keeps its orbs while nothing is going on', () => {
  const { orbPick } = bootAuto().Auto;
  assert.equal(orbPick(bag('orbSleep', 'orbFocus', 'orbBlast'), calm({ screen: 3, close: 1 })), -1);
  assert.equal(orbPick(emptyBag(), calm({ close: 9, hp: 0.1, boss: true })), -1);
});

test('AUTO uses them when surrounded, in danger, against a boss or a big crowd', () => {
  const { orbPick } = bootAuto().Auto;
  // Rodeado: Rafagaesfera antes que dormirlos.
  assert.equal(orbPick(bag('orbSleep', 'orbBlast'), calm({ close: 6, screen: 10 })), 1);
  assert.equal(orbPick(bag('orbSleep', 'orbFocus'), calm({ close: 6, screen: 10 })), 0);
  assert.equal(orbPick(bag('orbSlow'), calm({ close: 3, hp: 0.4 })), 0);
  // Poca vida: correr.
  assert.equal(orbPick(bag('orbFocus', 'orbSpeed'), calm({ close: 1, hp: 0.2 })), 1);
  // Jefe: crítico; encima, además, frenarlo.
  assert.equal(orbPick(bag('orbFocus'), calm({ boss: true })), 0);
  assert.equal(orbPick(bag('orbSlow'), calm({ boss: true })), -1);
  assert.equal(orbPick(bag('orbSlow'), calm({ boss: true, bossNear: true })), 0);
  // Mucha gente en pantalla.
  assert.equal(orbPick(bag('orbLight'), calm({ screen: 14 })), 0);
});

test('AUTO does not waste a team orb that is already on, and spends one it has too many of', () => {
  const { orbPick } = bootAuto().Auto;
  assert.equal(orbPick(bag('orbFocus'), calm({ boss: true, fx: { orbFocus: 9 } })), -1);
  const full = bag('orbSpeed'); full[0].n = 3;
  assert.equal(orbPick(full, calm({ screen: 7 })), 0);
  assert.equal(orbPick(full, calm({ screen: 3 })), -1, 'not with nobody around');
  assert.equal(orbPick(full, calm({ screen: 7, fx: { orbSpeed: 5 } })), -1);
});
