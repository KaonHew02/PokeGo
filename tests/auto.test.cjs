// Modo automático (js/systems/autopilot.js): puntuación de direcciones del
// movimiento y elección de cartas, objetos y vínculos (funciones puras).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function boot() {
  const ctx = { console, Math };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/core/util.js', 'js/systems/hazards.js', 'js/data/moves.js', 'js/systems/autopilot.js']) vm.runInContext(source(f), ctx, { filename: f });
  // Lo poco del juego que mira cardInfo (una partida en solitario al minuto 1).
  Object.assign(ctx.G, { Coop: { active: false }, Game: { st: { time: 60 } } });
  return ctx.G;
}
const G = boot(), A = G.Auto, N = A.DIRS, M = G.Moves;

/** Un Pokémon en (0, 0) sin nada alrededor; `o` cambia lo que haga falta. */
function scene(o = {}) {
  return Object.assign({ x: 0, y: 0, r: 12, spd: 110, hp: 1, hx: 0, hy: 0, side: 1, close: false,
    crowd: { x: 0, y: 0 }, foes: [], shots: [], zones: [], goals: [], stays: [], avoid: [], wall: () => 0 }, o);
}
/** La mejor opción: { k, a (ángulo), stay }. */
function best(c) {
  const { s } = A.score(c);
  let k = 0;
  for (let i = 1; i <= N; i++) if (s[i] > s[k]) k = i;
  return { k, a: k < N ? k / N * Math.PI * 2 : null, stay: k === N, s };
}
const foe = (x, y, more = {}) => Object.assign({ x, y, r: 12, spd: 60, w: 1 }, more);

test('runs away from a nearby enemy and keeps away from a boss more than from a weak one', () => {
  const b = best(scene({ foes: [foe(40, 0)], crowd: { x: 1, y: 0 }, gap: 16 }));
  assert.ok(!b.stay && Math.cos(b.a) < -0.5, 'should move west, got ' + b.a);
  // A buena distancia, en vez de huir recto, la rodea de lado (en círculo).
  const far = best(scene({ foes: [foe(160, 0)], crowd: { x: 0.5, y: 0 }, gap: 136 }));
  assert.ok(Math.abs(Math.sin(far.a)) > 0.8, 'should circle around, got ' + far.a);
  // Igual de cerca, a un lado un enemigo normal y al otro un jefe: se aleja del jefe.
  const c = best(scene({ foes: [foe(0, -45), foe(0, 45, { w: 2.6, r: 30 })] }));
  assert.ok(Math.sin(c.a) < -0.3, 'should move north, away from the boss, got ' + c.a);
});

test('a wall blocks the escape: goes sideways instead of into it', () => {
  const wall = (x) => (x < -20 ? 100 : 0);
  const b = best(scene({ foes: [foe(45, 0)], crowd: { x: 1, y: 0 }, wall }));
  assert.ok(!b.stay && Math.cos(b.a) < 0.35 && Math.abs(Math.sin(b.a)) > 0.6, 'should go north or south, got ' + b.a);
  // Lava delante cuenta como peligro, pero se puede pasar (no como una pared).
  const lava = (x) => (x > 10 ? 4 : 0);
  const l = best(scene({ wall: lava, goals: [{ x: 300, y: 0, v: 1, near: 0 }] }));
  assert.ok(Math.cos(l.a) < 0.9, 'should not walk straight into lava for a small reward');
});

test('dodges an incoming shot sideways and staying still is the worst option', () => {
  const shot = { x: 0, y: -150, vx: 0, vy: 190, r: 7, life: 2, w: 3 };
  const b = best(scene({ shots: [shot] }));
  assert.ok(!b.stay && Math.abs(Math.cos(b.a)) > 0.7, 'should dodge east or west, got ' + b.a);
  const { danger } = A.score(scene({ shots: [shot] }));
  assert.ok(danger[N] > danger[0] && danger[N] > danger[N / 2], 'standing in the line of fire is dangerous');
});

test('leaves a ground warning before it goes off, not after', () => {
  const h = { kind: 'zone', x: 0, y: 0, r: 50 };
  const b = best(scene({ zones: [{ h, left: 0.8, w: 5 }] }));
  assert.ok(!b.stay, 'should leave the zone');
  const t = 0.8, px = Math.cos(b.a) * 110 * t, py = Math.sin(b.a) * 110 * t;
  assert.ok(!G.Hazards.inside(h, px, py, 18), 'ends up outside when it explodes');
  // Un rayo con aviso que cruza de oeste a este: sale hacia el norte o el sur.
  const beam = { kind: 'beam', x: -200, y: 0, angle: 0, len: 400, w: 26 };
  const c = best(scene({ zones: [{ h: beam, left: 0.7, w: 5 }] }));
  assert.ok(Math.abs(Math.sin(c.a)) > 0.7, 'should step out of the beam, got ' + c.a);
});

test('goes for pickups when it is safe, and stays next to a locked chest', () => {
  const b = best(scene({ goals: [{ x: 0, y: -200, v: 1, near: 0 }] }));
  assert.ok(Math.sin(b.a) < -0.9, 'should go north for the gem, got ' + b.a);
  const s = best(scene({ stays: [{ x: 10, y: 0, r: 30, v: 2.2 }] }));
  assert.ok(s.stay, 'should stand still next to the chest');
  // ...pero no si se acerca un enemigo a tocarle.
  const d = best(scene({ stays: [{ x: 10, y: 0, r: 30, v: 2.2 }], foes: [foe(18, 0, { spd: 90 })] }));
  assert.ok(!d.stay, 'a monster on top beats the chest');
});

test('keeps out of a place to avoid, even with loot behind it', () => {
  const b = best(scene({ goals: [{ x: 0, y: -200, v: 3, near: 0 }], avoid: [{ x: 0, y: -45, r: 64, v: 40 }] }));
  const ny = Math.sin(b.a) * 110 * 0.6, nx = Math.cos(b.a) * 110 * 0.6;
  assert.ok(Math.hypot(nx, ny + 45) >= 64 || b.stay, 'keeps out of it');
});

test('prefers the previous heading when two ways are equally good (no jitter)', () => {
  const goals = [{ x: -300, y: 0, v: 1, near: 0 }, { x: 300, y: 0, v: 1, near: 0 }];
  assert.ok(Math.cos(best(scene({ goals, hx: 1, hy: 0 })).a) > 0.9);
  assert.ok(Math.cos(best(scene({ goals, hx: -1, hy: 0 })).a) < -0.9);
});

test('objective: one at a time, by value for the walk and the enemies on the way, and it sticks (no dithering)', () => {
  const o = (id, v, dist, risk = 0) => ({ id, v, dist, risk });
  assert.equal(A.pickObjective([o('far', 2, 800), o('near', 2, 100)], null).id, 'near');
  assert.equal(A.pickObjective([o('chest', 2.2, 300), o('locked', 3.2, 300)], null).id, 'locked', 'a locked chest is worth more');
  assert.equal(A.pickObjective([o('crowded', 2, 300, 3), o('clear', 2, 420)], null).id, 'clear', 'enemies on the way count');
  // Se sigue con el de ahora aunque otro quede algo mejor; sólo se cambia si el otro es claramente mejor.
  const a = o('a', 2, 400), b = o('b', 2, 300);
  assert.equal(A.pickObjective([a, b], null).id, 'b');
  assert.equal(A.pickObjective([a, b], 'a').id, 'a', 'keeps the current objective');
  assert.equal(A.pickObjective([a, o('b', 6, 300)], 'a').id, 'b', 'switches for something much better');
  assert.equal(A.pickObjective([o('nothing', 0, 50)], null), null);
  // Un compañero caído (v 8) va antes que un cofre, aunque esté mucho más lejos.
  assert.equal(A.pickObjective([o('chest', 2.2, 100), o('mate', 8, 1000)], null).id, 'mate');
});

test('chests: stands where its own attack reaches them (and aims only when that helps)', () => {
  const mv = (kind, more = {}) => Object.assign({ kind, radius: 60 }, more);
  const p = A.breakSpot([mv('projectile')], 12);
  assert.ok(p.hold >= 100 && p.aim > p.hold, 'shoots from a distance');
  const aura = A.breakSpot([mv('aura', { radius: 70 })], 12);
  assert.ok(aura.hold < 70 && aura.hold >= 28 && aura.aim === 0, 'an aura has to cover the chest');
  const melee = A.breakSpot([mv('melee', { radius: 50 })], 12);
  assert.ok(melee.hold < 50 && melee.aim >= 50, 'a melee hit has to reach it, aimed');
  assert.ok(A.breakSpot([mv('nova')], 12).hold <= 30, 'a nova from right next to it');
  assert.equal(A.breakSpot([mv('orbit', { radius: 70 })], 12).ring, 70, 'the orbit passes through it');
  for (const k of ['chain', 'turret', 'meteor', 'stun', 'buff']) assert.equal(A.breakSpot([mv(k)], 12), null, k + ' cannot break a chest');
  assert.ok(A.breakSpot([mv('chain'), mv('aura', { radius: 70 })], 12), 'a bond uses the move that can');
});

/** El objetivo como lo pasa context(): dónde quedarse (hx, hy, r) y hacia dónde ir (wx, wy). */
const objAt = (x, y, more = {}) => Object.assign({ hx: x, hy: y, wx: x, wy: y, r: 0, w: 2, stay: 0 }, more);

test('goes for the objective from far away, but never through the horde', () => {
  // A 900 px al norte, aunque venga yendo hacia el este (antes, a esa distancia casi no tiraba).
  const b = best(scene({ obj: objAt(0, -900), hx: 1, hy: 0 }));
  assert.ok(!b.stay && Math.sin(b.a) < -0.7, 'should head north to the objective, got ' + b.a);
  const far = A.score(scene({ obj: objAt(0, -900) })).objp[N * 3 / 4], near = A.score(scene({ obj: objAt(0, -100) })).objp[N * 3 / 4];
  assert.ok(far > near * 0.5, 'the pull does not fade away with distance');
  // Por el camino (rodeando una pared): hacia el punto de paso, no recto.
  const w = best(scene({ obj: objAt(0, -600, { wx: 200, wy: -100 }) }));
  assert.ok(Math.cos(w.a) > 0.5, 'follows the waypoint, got ' + w.a);
  // Con un enemigo encima en esa dirección, primero sobrevivir.
  const d = best(scene({ obj: objAt(0, -900), foes: [foe(0, -30, { spd: 90 })], crowd: { x: 0, y: -1 }, gap: 6 }));
  assert.ok(Math.sin(d.a) > -0.3, 'should not walk into the enemy, got ' + d.a);
});

test('holds its spot at the objective, dodging inside it, and leaves it for real danger', () => {
  const hold = objAt(0, 0, { r: 38, stay: 3.3 });
  assert.ok(best(scene({ obj: hold })).stay, 'stands next to the locked chest');
  // Un disparo: se aparta, pero sin salir del sitio.
  const shot = { x: 0, y: -150, vx: 0, vy: 190, r: 7, life: 2, w: 3 };
  const b = best(scene({ obj: objAt(0, 0, { r: 150, stay: 2.6 }), shots: [shot] }));
  assert.ok(!b.stay && Math.abs(Math.cos(b.a)) > 0.7, 'dodges sideways, got ' + b.a);
  // Un enemigo encima pesa más que el cofre.
  assert.ok(!best(scene({ obj: hold, foes: [foe(18, 0, { spd: 90 }), foe(-10, 16, { spd: 90 })] })).stay, 'monsters on top beat the chest');
});

test('explores toward what it has not seen, around walls and away from the horde', () => {
  const ex = o => A.exploreDir(Object.assign({ x: 0, y: 0, cell: 256, seenAge: () => Infinity, open: () => 1, prev: null, crowd: null }, o));
  const westSeen = (cx) => (cx < 0 ? 10 : Infinity);
  assert.ok(Math.cos(ex({ seenAge: westSeen })) > 0.7, 'the west was just seen: goes east');
  const a = ex({ seenAge: westSeen, open: x => (x > 300 ? 0 : 1) });
  assert.ok(Math.cos(a) < 0.5 && Math.cos(a) > -0.1, 'a wall to the east: north or south, not back west, got ' + a);
  assert.ok(Math.cos(ex({ crowd: { x: 1.5, y: 0 } })) < 0, 'does not explore into the horde');
  assert.ok(Math.sin(ex({ prev: Math.PI / 2 })) > 0.9, 'keeps its way when all is the same');
});

/**
 * Una partida de mentira (sin mapa ni enemigos de verdad) para mover a AUTO con
 * su bucle real: axis() → scan, objetivo, decide. o: { mates, props, specials, rift, foes, arena, move }.
 */
function sandbox(o = {}) {
  const ctx = { console, Math, performance };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/core/util.js', 'js/systems/hazards.js', 'js/data/moves.js', 'js/systems/autopilot.js']) vm.runInContext(source(f), ctx, { filename: f });
  const S = ctx.G, near = (x, y, r) => p => Math.hypot(p.x - x, p.y - y) <= r + p.r;
  const pl = { x: 0, y: 0, r: 12, hp: 80, maxHp: 80, spd: 110, magnet: 78, dmgDealt: 0, inLiquid: false, moveAngle: 0, item: null, power: null, regen: 0,
    mon: { types: ['electric'], pa: 1, sa: 0.97, atk: 1 }, slots: [[S.Moves.instance(o.move || 'thunder-shock', 1)]],
    activeGroup() { return this.slots[0]; }, activeMove() { return this.slots[0][0]; } };
  Object.assign(S, {
    Settings: { get: k => k === 'auto' }, Input: { axis: () => [0, 0] }, UI: { toast() {} },
    Game: { player: pl, state: 'playing', st: { time: 60 } }, Judgment: { active: false }, Rift: { rift: o.rift || null, inArena: !!o.arena },
    Coop: { active: !!o.mates, isHost: true, puppets: () => o.mates || [] },
    EnemyMgr: { all: () => o.foes || [], queryCircle: (x, y, r) => (o.foes || []).filter(e => Math.hypot(e.x - x, e.y - y) <= r) },
    Projectiles: { all: () => [] }, Pickups: { all: () => [] },
    World: { TS: 32, isFree: () => true, isLiquid: () => false, liquidEffect: () => ({}), walkable: () => true,
             propsInCircle: (x, y, r) => (o.props || []).filter(p => p.hp > 0 && near(x, y, r)(p)), specialsNear: (x, y, r) => (o.specials || []).filter(near(x, y, r)) },
    Path: { route: () => undefined }, Interact: { CHEST_TIME: 3.5 }
  });
  // n pasos de 1/20 s, moviendo al Pokémon con lo que diga AUTO.
  const run = n => { for (let i = 0; i < n; i++) { const [ax, ay] = S.Auto.axis(pl, 0.05); pl.x += ax * pl.spd * 0.05; pl.y += ay * pl.spd * 0.05; } };
  return { A: S.Auto, pl, run };
}

test('in the real loop: walks into an open rift, before a chest that is closer', () => {
  const rift = { x: 420, y: 60, ttl: 45, t: 0 };
  const chest = { type: 'chest', id: 7, x: -120, y: 0, r: 12, hp: 22 };
  const { A: a, pl, run } = sandbox({ rift, props: [chest] });
  run(10);
  assert.equal(a.debug.obj && a.debug.obj.kind, 'rift', 'the rift comes first');
  run(120);
  assert.ok(Math.hypot(pl.x - rift.x, pl.y - (rift.y - 10)) < 30, 'close enough to enter, at ' + Math.round(pl.x) + ',' + Math.round(pl.y));
});

test('in the real loop: gets through a few enemies to reach the rift, and goes even when hurt', () => {
  const rift = { x: 420, y: 0, ttl: 45, t: 0 };
  const foes = [{ id: 1, x: 200, y: 70, r: 12, spd: 0, dmg: 8, hp: 30 }, { id: 2, x: 260, y: -80, r: 12, spd: 0, dmg: 8, hp: 30 }];
  const { pl, run } = sandbox({ rift, foes });
  pl.hp = 12;
  run(200);
  assert.ok(Math.hypot(pl.x - rift.x, pl.y - (rift.y - 10)) < 30, 'reached it, at ' + Math.round(pl.x) + ',' + Math.round(pl.y));
});

test('in a rift arena: gets within reach of the boss with a close-range attack, and keeps away with a ranged one', () => {
  const boss = () => ({ id: 9, boss: true, legend: true, x: 0, y: -260, r: 16, spd: 70, dmg: 40, hp: 4000, behavior: 'ranged' });
  const near = sandbox({ arena: true, foes: [boss()], move: 'vine-whip' });
  near.run(160);
  const m = near.pl.activeMove(), e = near.A.debug.obj;
  assert.equal(e && e.kind, 'boss', 'goes for the boss');
  const d = Math.hypot(near.pl.x, near.pl.y + 260);
  assert.ok(d <= m.radius + 30, 'in reach of ' + m.kind + ' (' + (m.radius + 30) + '), at ' + Math.round(d));
  assert.ok(d > 16 + near.pl.r, 'without standing on it, at ' + Math.round(d));
  const far = sandbox({ arena: true, foes: [boss()] });
  far.run(160);
  const f = Math.hypot(far.pl.x, far.pl.y + 260);
  assert.ok(f > 100 && f < 330, 'ranged: from a distance, in aim range, at ' + Math.round(f));
});

test('in a rift arena: nearly dead, stops going for the boss', () => {
  const b = { id: 9, boss: true, legend: true, x: 0, y: -100, r: 16, spd: 70, dmg: 40, hp: 4000, behavior: 'ranged' };
  const { A: a, pl, run } = sandbox({ arena: true, foes: [b] });
  run(10);
  assert.equal(a.debug.obj && a.debug.obj.kind, 'boss');
  pl.hp = 8;
  run(10);
  assert.equal(a.debug.obj, null, 'survives first');
});

test('in the real loop: walks to a downed teammate and stays to revive them (before a chest)', () => {
  const mate = { uid: 'b', x: 520, y: 40, dead: true };
  const chest = { type: 'chest', id: 7, x: -260, y: 0, r: 12, hp: 22 };
  const { A: a, pl, run } = sandbox({ mates: [mate], props: [chest] });
  run(10);
  assert.equal(a.debug.obj && a.debug.obj.kind, 'mate', 'the teammate comes first');
  run(140);
  assert.ok(Math.hypot(pl.x - mate.x, pl.y - mate.y) < 40, 'got next to them, at ' + Math.round(pl.x) + ',' + Math.round(pl.y));
  assert.ok(a.debug.want.stay, 'and stays there while they get up');
  mate.dead = false;
  run(10);
  assert.notEqual(a.debug.obj && a.debug.obj.kind, 'mate', 'once revived, on to something else');
});

test('in the real loop: goes to a far chest, gets within reach and aims at it', () => {
  const chest = { type: 'chest', id: 7, x: 700, y: -120, r: 12, hp: 22 };
  const { A: a, pl, run } = sandbox({ props: [chest] });
  run(10);
  assert.equal(a.debug.obj && a.debug.obj.kind, 'chest');
  assert.equal(a.aimAt(pl), null, 'too far to aim yet');
  run(160);
  const d = Math.hypot(pl.x - chest.x, pl.y - chest.y);
  assert.ok(d < 160, 'within reach of its shots, at ' + Math.round(d));
  assert.equal(a.aimAt(pl), chest, 'aims at the chest');
  chest.hp = 0;
  run(10);
  assert.notEqual(a.debug.obj && a.debug.obj.kind, 'chest', 'broken: on to something else');
});

// ---------------- elecciones: cartas, objetos y vínculos ----------------

const pika = { name: 'Pikachu', types: ['electric'], pa: 1.0, sa: 0.97, atk: 1.0 };
const brute = { name: 'Machop', types: ['fighting'], pa: 1.3, sa: 0.7, atk: 1.3 };
/** Un Pokémon de mentira para cardInfo: slots = [[[id, nivel, evolucionado?], ...], ...] (cada lista, un hueco). */
function player(mon, slots, o = {}) {
  const moves = [];
  const sl = slots.map(s => s.map(([id, lvl, evo]) => { const m = M.instance(id, lvl); if (evo) M.evolve(m); moves.push(m); return m; }));
  return Object.assign({ mon, moves, slots: sl, active: 0, maxMoves: 4, bonds: 0, statsTaken: {}, hp: 80, maxHp: 80, dmgReduce: 0,
    hasItem: () => false, activeGroup() { return this.slots[this.active] || []; } }, o);
}
const card = (type, key) => ({ type, key: type + ':' + key });
const choose = (pl, list) => list[A.pickCard(list, A.cardInfo(pl, list))].key;

test('expected damage: mono-type, physical/special side, level, evolution and how the kind suits AUTO', () => {
  const ts = l => M.instance('thunder-shock', l);
  const dual = { types: ['electric', 'flying'], pa: 1, sa: 0.97, atk: 1 };
  assert.ok(Math.abs(A.movePower(ts(1), pika) / A.movePower(ts(1), dual) - 1.2) < 1e-9, 'mono-type +20%');
  assert.ok(A.movePower(M.instance('karate-chop', 1), brute) > A.movePower(M.instance('confusion', 1), brute) * 2, 'its strong side hits harder');
  assert.ok(A.movePower(ts(3), pika) > A.movePower(ts(2), pika) && A.movePower(ts(2), pika) > A.movePower(ts(1), pika), 'levels add up');
  const evo = ts(5);
  M.evolve(evo);
  assert.ok(A.movePower(evo, pika) > A.movePower(ts(5), pika) * 1.6, 'evolving nearly doubles it');
  assert.equal(A.movePower(M.instance('nasty-plot', 1), pika), 0, 'a buff alone does no damage');
  // Iguales sobre el papel: uno de cerca rinde menos con AUTO, que rodea a la horda a distancia.
  const near = { kind: 'melee', dmg: 10, cd: 0.5, arc: 0.01, cat: 'special', type: 'normal' }, far = Object.assign({}, near, { kind: 'projectile', count: 1 });
  assert.ok(A.movePower(far, pika) > A.movePower(near, pika));
});

test('main attack: the strongest slot (a bond counts all its moves) and no switching for a near tie', () => {
  const shot = dmg => ({ kind: 'projectile', dmg, cd: 1, count: 1, cat: 'special', type: 'normal' });
  assert.equal(A.bestSlot([[shot(10)], [shot(14)]], 0, pika), 1);
  assert.equal(A.bestSlot([[shot(10)], [shot(10.4)]], 0, pika), 0, 'a near tie keeps the current slot');
  assert.equal(A.bestSlot([[shot(14)], [shot(10), shot(10)]], 0, pika), 1, 'a bond fires all its moves');
  const ts = M.instance('thunder-shock', 1);
  assert.ok(A.groupPower([ts, M.instance('nasty-plot', 1)], pika) > A.groupPower([ts], pika), 'Nasty Plot boosts a special move');
  assert.equal(A.groupPower([ts, M.instance('swords-dance', 1)], pika), A.groupPower([ts], pika), 'Swords Dance does not');
});

test('cards: push the main attack, plan its evolution, and new moves only when they help', () => {
  const pl = player(pika, [[['thunder-shock', 2]], [['tackle', 1]]]);
  assert.equal(choose(pl, [card('new', 'thunderbolt'), card('up', 'thunder-shock'), card('stat', 'atk')]), 'up:thunder-shock');
  assert.equal(choose(pl, [card('up', 'tackle'), card('stat', 'cd')]), 'stat:cd', 'without a bond, upgrading an unused move adds no damage');
  // Llenar un hueco libre vale algo (después salen más mejoras y menos movimientos), pero menos que subir el principal.
  assert.equal(choose(pl, [card('stat', 'mag'), card('new', 'quick-attack')]), 'new:quick-attack');
  assert.equal(choose(pl, [card('new', 'quick-attack'), card('up', 'thunder-shock')]), 'up:thunder-shock');
  // La mejora que pide su evolución (Impactrueno → Trueno: Potencia), antes de llegar al máximo.
  const pl4 = player(pika, [[['thunder-shock', 4]]]);
  assert.equal(choose(pl4, [card('stat', 'cd'), card('stat', 'hp'), card('stat', 'atk')]), 'stat:atk');
  pl4.statsTaken.atk = 1;
  assert.equal(choose(pl4, [card('stat', 'hp'), card('stat', 'cd'), card('stat', 'mag')]), 'stat:cd', 'once taken, Reflejos is worth its own');
  const max = player(pika, [[['thunder-shock', 5]]], { statsTaken: { atk: 1 } });
  assert.equal(choose(max, [card('stat', 'atk'), card('evo', 'thunder-shock'), card('stat', 'cd')]), 'evo:thunder-shock');
  // Uno nuevo que pega mucho más que el principal (su lado bueno, su tipo): se aprende (y AUTO se pasa a él).
  const bp = player(brute, [[['confusion', 1]]]);
  assert.equal(choose(bp, [card('stat', 'atk'), card('new', 'karate-chop'), card('stat', 'cd')]), 'new:karate-chop');
  // Con un vínculo por usar, uno que se une bien al principal sí vale.
  const bond = player(pika, [[['thunder-shock', 3]], [['tackle', 1]]], { bonds: 1 });
  assert.equal(choose(bond, [card('stat', 'mag'), card('new', 'discharge'), card('stat', 'xp')]), 'new:discharge');
});

test('stat cards follow the moment: damage when healthy, survival when hurt, nothing past a cap', () => {
  const pl = player(pika, [[['thunder-shock', 3]]], { statsTaken: { atk: 1 } });
  assert.equal(choose(pl, [card('stat', 'hp'), card('stat', 'atk')]), 'stat:atk', 'healthy: damage first');
  pl.hp = 30;
  assert.equal(choose(pl, [card('stat', 'atk'), card('stat', 'hp')]), 'stat:hp', 'hurt: more life');
  pl.hp = 18;
  assert.equal(choose(pl, [card('stat', 'hp'), card('stat', 'atk'), card('stat', 'heal')]), 'stat:heal', 'almost KO: the berry');
  const capped = player(pika, [[['thunder-shock', 3]]], { dmgReduce: 0.7, statsTaken: { atk: 1 } });
  assert.ok(A.cardScore(card('stat', 'def'), A.cardInfo(capped, [card('stat', 'def')])) < 1, 'Coraza past its 70% cap is worth nothing');
  // Ya tarde y nada que valga la pena: por debajo de REROLL_BELOW (AUTO cambia las cartas si puede).
  const t = G.Game.st.time;
  G.Game.st.time = 900;
  const list = [card('up', 'tackle'), card('stat', 'mag'), card('stat', 'xp')];
  const s = A.cardInfo(player(pika, [[['thunder-shock', 5]], [['tackle', 1]]], { statsTaken: { atk: 1 } }), list);
  G.Game.st.time = t;
  assert.ok(Math.max(...list.map(c => A.cardScore(c, s))) < A.REROLL_BELOW);
});

test('items: judged by the build and compared with the one held', () => {
  const s = o => Object.assign({ hp: 1, hurt: 0, maxHp: 80, time: 60, casts: 2.5, regen: 0, dealt: 40, reduce: 0, close: false, oneSlot: true }, o);
  assert.equal(A.itemKeep(null, 'choiceband', s()), 'choiceband', 'one main slot: the Choice Band is free damage');
  assert.ok(A.itemValue('choiceband', s({ oneSlot: false })) < A.itemValue('choiceband', s()));
  assert.equal(A.itemKeep(null, 'lifeorb', s()), null, 'a Life Orb with nothing to heal it drains you');
  assert.equal(A.itemKeep(null, 'lifeorb', s({ regen: 3 })), 'lifeorb', 'with regeneration that covers it, yes');
  assert.ok(A.itemValue('luckyegg', s({ time: 30 })) > A.itemValue('luckyegg', s({ time: 600 })), 'the Lucky Egg, early');
  assert.equal(A.itemKeep('quickclaw', 'amuletcoin', s()), 'quickclaw', 'keeps the better one');
  assert.equal(A.itemKeep('amuletcoin', 'quickclaw', s()), 'quickclaw', 'swaps for a clearly better one');
  assert.ok(A.itemValue('leftovers', s({ hp: 0.3, hurt: 0.6 })) > A.itemValue('leftovers', s()), 'healing counts more when hurt');
});

test('bonds: the move that adds most to the group that will fire', () => {
  const ts = M.instance('thunder-shock', 3), tb = M.instance('thunderbolt', 1), qa = M.instance('quick-attack', 3);
  const np = M.instance('nasty-plot', 1), sd = M.instance('swords-dance', 2);
  assert.equal(A.bondPick([sd, np], { mode: 'add', group: [ts] }, null, pika), 1, 'Nasty Plot boosts the special group, Swords Dance does not');
  // Dos sueltos: la pareja más fuerte (Impactrueno con Rayo: su lado y su tipo), no el de más nivel sin más.
  const loose = [qa, ts, tb];
  const first = loose[A.bondPick(loose, { mode: 'pair' }, null, pika)];
  assert.ok(first === ts || first === tb, 'first: one of the best pair');
  const rest = loose.filter(m => m !== first);
  assert.ok([ts, tb].includes(rest[A.bondPick(rest, { mode: 'pair' }, first, pika)]), 'then its partner');
});

// La pantalla (js/core/awake.js): sin tocarla, con AUTO, el móvil se apagaba y la partida se paraba.
function awake(o = {}) {
  const locks = [], taps = {};
  const wakeLock = { request: async () => {
    if (o.refuse) throw new Error('NotAllowedError');
    const l = { on: true, addEventListener(_, f) { this.drop = f; }, async release() { this.on = false; this.drop(); } };
    locks.push(l);
    return l;
  } };
  const ctx = { console, Date: o.Date || Date, navigator: { wakeLock }, document: { visibilityState: o.hidden ? 'hidden' : 'visible' },
    addEventListener: (ev, f) => { taps[ev] = f; }, G: { Native: { app: !!o.app } } };
  vm.createContext(ctx);
  vm.runInContext(source('js/core/awake.js'), ctx);
  return { W: ctx.G.Awake, locks, taps };
}
const settle = () => new Promise(r => setImmediate(r));

test('screen: stays on during a run and is let go in the pause', async () => {
  const { W, locks } = awake();
  W.tick(true);
  await settle();
  assert.ok(W.held, 'on during the run');
  W.tick(true);
  await settle();
  assert.equal(locks.length, 1, 'asks only once');
  W.tick(false);
  await settle();
  assert.ok(!W.held && !locks[0].on, 'let go when paused or back at the menu');
});

test('screen: the first tap counts (Safari only allows it after a touch), and nothing happens in the app', async () => {
  const { W, taps } = awake();
  taps.pointerup();
  await settle();
  assert.ok(W.held, 'held from the tap that starts the run');
  W.tick(false);
  assert.ok(W.held, 'not dropped right after the tap');
  const app = awake({ app: true });
  app.W.tick(true);
  await settle();
  assert.equal(app.locks.length, 0, 'the Android app keeps the screen on by itself');
  assert.deepEqual(Object.keys(app.taps), []);
});

test('screen: asks again after the system lets go, without asking on every frame', async () => {
  let now = 1e6;
  const Clock = { now: () => now };
  const { W, locks } = awake({ Date: Clock });
  W.tick(true);
  await settle();
  locks[0].drop();                  // el sistema lo suelta (al salir de la pestaña, por ejemplo)
  assert.ok(!W.held);
  now += 1000; W.tick(true);
  await settle();
  assert.ok(!W.held, 'waits a moment');
  now += 5000; W.tick(true);
  await settle();
  assert.ok(W.held && locks.length === 2, 'and asks again');
  const no = awake({ refuse: true });
  no.W.tick(true);
  await settle();
  assert.ok(!no.W.held, 'a refusal is not an error');
});
