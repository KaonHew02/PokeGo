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
  for (const f of ['js/core/util.js', 'js/systems/hazards.js', 'js/systems/autopilot.js']) vm.runInContext(source(f), ctx, { filename: f });
  return ctx.G;
}
const G = boot(), A = G.Auto, N = A.DIRS;

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

test('never walks into the rift on purpose, even with loot behind it', () => {
  const b = best(scene({ goals: [{ x: 0, y: -200, v: 3, near: 0 }], avoid: [{ x: 0, y: -45, r: 64, v: 40 }] }));
  const ny = Math.sin(b.a) * 110 * 0.6, nx = Math.cos(b.a) * 110 * 0.6;
  assert.ok(Math.hypot(nx, ny + 45) >= 64 || b.stay, 'keeps out of the rift');
});

test('prefers the previous heading when two ways are equally good (no jitter)', () => {
  const goals = [{ x: -300, y: 0, v: 1, near: 0 }, { x: 300, y: 0, v: 1, near: 0 }];
  assert.ok(Math.cos(best(scene({ goals, hx: 1, hy: 0 })).a) > 0.9);
  assert.ok(Math.cos(best(scene({ goals, hx: -1, hy: 0 })).a) < -0.9);
});

test('card priority: evolution > active upgrade > the stat an evolution needs > damage stats > new move > other upgrades > stats', () => {
  const s = { hp: 1, free: 2, moves: { ember: { lvl: 2, kind: 'projectile', active: true }, growl: { lvl: 1, kind: 'projectile', active: false },
              swords: { lvl: 1, kind: 'buff', active: false } }, kinds: { tackle: 'melee', dance: 'buff' }, weak: {}, evoStat: new Map([['cd', false]]) };
  const card = (type, key) => ({ type, key: type + ':' + key });
  const evo = card('evo', 'ember'), nw = card('new', 'tackle'), upA = card('up', 'ember'), upB = card('up', 'growl');
  const atk = card('stat', 'atk'), hp = card('stat', 'hp'), cd = card('stat', 'cd'), heal = card('stat', 'heal');
  assert.equal(A.pickCard([atk, upB, nw, evo], s), 3);
  assert.equal(A.pickCard([hp, upB, nw], s), 2, 'a new move while slots are free, before other upgrades and plain stats');
  assert.equal(A.pickCard([nw, atk], s), 1, 'more damage for the active move before a new one (only the active fires)');
  assert.equal(A.pickCard([nw, upA, atk], s), 1, 'only the active move fires: upgrading it comes first');
  assert.equal(A.pickCard([atk, upB, cd], s), 2, 'the stat that unlocks an evolution');
  assert.equal(A.pickCard([nw, cd], Object.assign({}, s, { evoStat: new Map([['cd', true]]) })), 1, 'evolving the active move beats a new one');
  assert.equal(A.pickCard([upB, upA, atk], s), 1, 'the move in the active slot');
  assert.equal(A.pickCard([hp, upB], s), 1, 'upgrading an unused move before a plain stat');
  assert.equal(A.pickCard([upB, atk], s), 1, 'more damage for the active move before upgrading an unused one');
  // Mejorar uno que con eso pasa al activo (y AUTO se cambia a él) es casi como mejorar el activo.
  assert.equal(A.pickCard([nw, upB], Object.assign({}, s, { top: 1 })), 1);
  assert.equal(A.bestSlot([[{ lvl: 2, kind: 'projectile' }], [{ lvl: 3, kind: 'melee' }], [{ lvl: 5, kind: 'buff' }]], 0), 1);
  assert.equal(A.bestSlot([[{ lvl: 2, kind: 'projectile' }], [{ lvl: 2, kind: 'melee' }]], 0), 0, 'a tie keeps the current slot');
  assert.equal(A.bestSlot([[{ lvl: 3, kind: 'projectile' }], [{ lvl: 2, kind: 'melee' }, { lvl: 2, kind: 'beam' }]], 0), 1, 'a bond counts all its moves');
  assert.equal(A.pickCard([card('up', 'swords'), upB], s), 1, 'an attack before a buff');
  assert.equal(A.pickCard([card('new', 'dance'), nw], s), 1, 'a new attack before a new buff');
  // Sin huecos libres, un movimiento nuevo no sirve.
  assert.equal(A.pickCard([nw, upB], Object.assign({}, s, { free: 0 })), 1);
  // Con poca vida: vida y defensa antes que daño; casi KO, la Baya Zidra.
  const low = Object.assign({}, s, { hp: 0.3, evoStat: new Map() });
  assert.equal(A.pickCard([atk, hp], low), 1);
  assert.equal(A.pickCard([atk, card('stat', 'def')], low), 1);
  assert.equal(A.pickCard([hp, heal], low), 1);
  assert.equal(A.pickCard([atk, heal], Object.assign({}, low, { hp: 0.9 })), 0);
});

test('items: keeps the held one, takes a free one unless it has a drawback; bonds join the strongest', () => {
  assert.equal(A.itemKeep(null, 'leftovers'), 'leftovers');
  assert.equal(A.itemKeep(null, 'lifeorb'), null);
  assert.equal(A.itemKeep(null, 'choiceband'), null);
  assert.equal(A.itemKeep('quickclaw', 'leftovers'), 'quickclaw');
  assert.equal(A.itemKeep('quickclaw', 'lifeorb'), 'quickclaw');
  const m = (lvl, kind = 'projectile', evolved = false) => ({ lvl, kind, evolved });
  assert.equal(A.bondBest([m(2), m(5), m(3)]), 1);
  assert.equal(A.bondBest([m(4, 'buff'), m(4)]), 1);
  assert.equal(A.bondBest([m(5), m(5, 'melee', true)]), 1);
});
