// La Sentencia de Arceus (js/systems/judgment.js): se le puede pegar, lleva una Tabla
// y en el minuto 35 rompe los objetos. Y los movimientos evolucionados: su nombre + « +».
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

/** Lo que no importa en estas pruebas: cualquier propiedad o llamada devuelve lo mismo. */
const any = () => { const p = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k in t ? t[k] : p), apply: () => p }); return p; };

/**
 * El juego de verdad (Sentencia, combate, jugador, tipos, movimientos y objetos)
 * con mundo, gráficos y red de mentira.
 * @param role  'solo' | 'host' | 'guest'
 */
function boot(role = 'solo') {
  const ctx = { console, Math, Intl, performance: { now: () => 1e6 }, document: { getElementById: () => null } };
  ctx.window = ctx;
  vm.createContext(ctx);
  const load = f => vm.runInContext(source(f), ctx, { filename: f });
  load('js/core/util.js');
  const G = ctx.G, sent = [], says = [], enemies = [];
  const clock = { time: 0 };
  Object.assign(G, {
    I18n: { locale: 'es', t: s => s, f: s => s, rawCanvas: () => {} },
    Coop: { active: role !== 'solo', isHost: role === 'host', ANIMS: [], broadcast: ev => sent.push(ev), scaleHp: () => 1, cast() {} },
    DB: { save: { stats: {} } },
    DEX_BY: { 493: { dex: 493, types: ['normal'], df: 120, sd: 120 }, 150: { dex: 150, leg: true, types: ['psychic'], name: 'Mewtwo', spd: 130 } },
    Enemy: function (def) { this.name = def.name; }, SPRITE_META: { 150: {} },
    Sprites: Object.assign(any(), { PX: 2, Animator: function () { return Object.assign(any(), { dir: 0 }); }, bodyRadius: () => 30, bodyHeight: () => 90,
                                    playerRadius: () => 12, playerScale: () => 1, hasShiny: () => false, dirFromAngle: () => 0, preload() {} }),
    Tiles: { T: 16, arenaBiome: () => 0 },
    Spawner: { say: t => says.push(t) },
    EnemyMgr: { all: () => enemies, add() {}, queryCircle: () => [], stash() {}, clearRemote() {} },
    Game: { st: clock, everyone: () => [G.Game.player], flash() {} },
    Auto: { axis: () => [0, 0], aimAt: () => null, on: false },
    Settings: { touch: true, get: () => false },
    Weather: Object.assign(any(), { mult: () => 1, speedFor: () => 1 }),
    World: Object.assign(any(), { collide() {}, isLiquid: () => false, projectileBlock: () => null, propsInCircle: () => [], nearestBreakable: () => null }),
    Rift: any(), Orbs: any(), Pickups: any(), Events: any(), Hazards: any(), Touch: any(), Audio: any(), Camera: any(), FX: any(), Progress: any(), Pad: any(), VFX: any()
  });
  G.DEX = [G.DEX_BY[150]];
  for (const f of ['js/data/types.js', 'js/systems/stats.js', 'js/data/moves.js', 'js/data/items.js', 'js/entities/projectile.js',
                   'js/entities/player.js', 'js/systems/combat.js', 'js/systems/judgment.js']) load(f);
  const pl = G.Game.player = new G.Player({ dex: 25, hp: 100, spd: 100, atk: 10, types: ['electric'] });
  pl.x = 0; pl.y = 0;
  return { G, pl, sent, says, enemies, clock };
}

/** Hasta el final de la animación: Arceus ya en la arena. */
function toFight(b, plate) {
  const { G } = b;
  if (G.Coop.active && !G.Coop.isHost) G.Judgment.onEvent(['jd', { tx: -6000, ty: -6000, q: [150], plate: plate || 'fire' }]);
  else {
    G.Judgment.debugStart();
    if (plate) { G.Judgment.reset(); G.Judgment.onEvent(['jd', { tx: -6000, ty: -6000, q: [150], plate }]); }
  }
  for (let i = 0; i < 120 && G.Judgment.cinematic; i++) G.Judgment.cineTick(0.1);
  assert.ok(G.Judgment.arceus, 'empieza la pelea');
  return G.Judgment.arceus;
}

/** Un disparo tuyo encima de Arceus, resuelto por combat.js. Devuelve lo que le ha hecho. */
function shoot(b, A, dmg, mtype, mcat = 'special') {
  const { G, pl } = b, before = G.Judgment.debug.dealt;
  G.Projectiles.clear();
  G.Projectiles.spawn({ x: A.x, y: A.y, dmg, r: 6, hits: new Set(), mtype, mcat, owner: pl });
  G.Combat.resolve(0.016, pl, 0);
  return G.Judgment.debug.dealt - before;
}

test('every type but Normal has its Plate, and the host sends the one it picks to everybody', () => {
  const b = boot('host'), { G } = b, seen = new Set();
  assert.deepEqual(Object.keys(G.Judgment.PLATES).sort(), Object.keys(G.U.TYPE_NAME).filter(t => t !== 'normal').sort());
  for (let i = 0; i < 300; i++) {
    G.Judgment.reset();
    G.Judgment.debugStart();
    const [kind, cfg] = b.sent.at(-1);
    assert.equal(kind, 'jd');
    assert.ok(G.Judgment.PLATES[cfg.plate], cfg.plate);
    assert.equal(G.Judgment.debug.plate, cfg.plate);
    seen.add(cfg.plate);
  }
  assert.equal(seen.size, 17, 'salen todas');
  const guest = boot('guest');
  const A = toFight(guest, 'dragon');
  assert.deepEqual([...A.types], ['dragon'], 'el invitado lleva la misma');
  assert.equal(guest.says[0], '¡Arceus lleva la Tabla Draco! Ahora es de tipo Dragón');
});

test('the Plate is announced and the first legendary does not cover it', () => {
  const b = boot(), { G, pl } = b;
  toFight(b, 'ghost');
  assert.equal(b.says.length, 1);
  assert.equal(b.says[0], '¡Arceus lleva la Tabla Terror! Ahora es de tipo Fantasma');
  for (let i = 0; i < 20; i++) G.Judgment.update(0.1, pl, 1800);      // 2 s: ya ha salido el primero
  assert.equal(b.says.length, 1);
  for (let i = 0; i < 60; i++) G.Judgment.update(0.1, pl, 1800);      // el siguiente, sí
  assert.ok(b.says.at(-1).includes('acude a la Sentencia'));
});

test('Arceus takes a small share of the damage, smaller over time; it never falls and ignores statuses', () => {
  const b = boot(), { G, pl } = b, A = toFight(b, 'water');
  G.Judgment.update(0.001, pl, 1800);
  const first = shoot(b, A, 1000, 'normal');
  assert.ok(first > 0 && first <= 1000 * 0.05, 'una parte pequeña: ' + first);
  for (let i = 0; i < 3000; i++) G.Judgment.update(0.1, pl, 1800);   // 5 minutos
  const later = shoot(b, A, 1000, 'normal');
  assert.ok(later < first / 4, `cada vez menos: ${first} -> ${later}`);
  assert.ok(A.hp > 0 && !A.dead);
  for (const f of ['applyBurn', 'applyPoison', 'applySlow', 'applyStun']) A[f](5);
  assert.equal(A.stunT, undefined);
  const dealt = G.Judgment.debug.dealt;
  assert.ok(Math.abs(G.Judgment.summary().dmg - dealt) < 1e-9, 'va al resumen');
  assert.ok(Math.abs(pl.dmgDealt - dealt) < 1e-9, 'lo que cuenta es lo que le llega');
  G.Judgment.reset();
  assert.equal(G.Judgment.arceus, null);
});

test('his Plate decides which attack types are best', () => {
  const dmgVs = (plate, type) => { const b = boot(), A = toFight(b, plate); b.G.Judgment.update(0.001, b.pl, 1800); return shoot(b, A, 1000, type); };
  assert.ok(dmgVs('grass', 'fire') > dmgVs('water', 'fire') * 2, 'Fuego: bien contra Planta, mal contra Agua');
  assert.ok(dmgVs('water', 'grass') > dmgVs('grass', 'grass') * 2);
});

test('with a legendary in reach attacks aim at it; with none, at Arceus', () => {
  const b = boot(), { G, pl } = b, A = toFight(b, 'fire');
  pl.addMove('thunder-shock');
  pl.x = A.x + 150; pl.y = A.y;
  pl.update(0.016);
  assert.equal(pl.target, A);
  b.enemies.push({ x: pl.x + 200, y: pl.y, r: 20, boss: true, cy() { return this.y; } });
  pl.update(0.016);
  assert.equal(pl.target, b.enemies[0]);
  assert.equal(G.Combat.seekable(), b.enemies, 'teledirigidos y torretas: el legendario');
  b.enemies.length = 0;
  assert.deepEqual([...G.Combat.seekable()], [A]);
  G.Judgment.reset();
  pl.update(0.016);
  assert.equal(pl.target, null, 'fuera de la pelea, nadie');
  assert.equal(G.Combat.seekable(), b.enemies);
});

for (const role of ['solo', 'host', 'guest']) {
  test(`minute 35 (${role}): a warning, then the item breaks and undoes what it gave; Focus Sash saves no more`, () => {
    const b = boot(role), { G, pl } = b;
    toFight(b, 'rock');
    pl.equip('choicescarf');
    const spd = pl.spdMul;
    G.Judgment.update(0.1, pl, G.Judgment.BREAK_AT - 30);
    assert.equal(pl.item, 'choicescarf');
    G.Judgment.update(0.1, pl, G.Judgment.BREAK_AT - 4);
    assert.equal(pl.item, 'choicescarf');
    assert.equal(b.says.at(-1), '¡Arceus va a romper vuestros objetos!');
    G.Judgment.update(0.1, pl, G.Judgment.BREAK_AT);
    assert.equal(pl.item, null);
    assert.ok(pl.spdMul < spd);
    assert.equal(b.says.at(-1), '¡Objeto roto: Pañuelo Elección!');

    const c = boot(role);
    toFight(c, 'rock');
    c.pl.equip('focussash');
    c.pl.hp = 1; c.pl.hurt(999, null, true);
    assert.equal(c.pl.hp, 1, 'antes del minuto 35, salva');
    c.pl.invuln = 0; c.pl.sashT = -1e9;
    c.G.Judgment.update(0.1, c.pl, c.G.Judgment.BREAK_AT);
    assert.equal(c.pl.item, null);
    c.pl.hurt(999, null, true);
    assert.ok(c.pl.dead, 'ya no');
  });
}

test('minute 35 happens once, also without an item, and nothing breaks before the fight', () => {
  const b = boot(), { G, pl } = b;
  pl.equip('leftovers');
  G.Judgment.update(0.1, pl, G.Judgment.BREAK_AT + 60);       // (sin Sentencia: el reloj no basta)
  assert.equal(pl.item, 'leftovers');
  G.Judgment.reset();
  pl.equip(null);
  toFight(b, 'ice');
  const n = b.says.length;
  G.Judgment.update(0.1, pl, G.Judgment.BREAK_AT);
  assert.equal(b.says.length, n + 1, 'sólo el aviso');
  pl.equip('leftovers');
  G.Judgment.update(0.1, pl, G.Judgment.BREAK_AT + 1);
  assert.equal(pl.item, 'leftovers');
});

// ---------------- movimientos evolucionados ----------------

test('evolved moves keep their name with " +" and do the same as before', () => {
  const { G } = boot(), M = G.Moves;
  const m = M.instance('meteor-mash', 5), dmg = m.dmg;
  const ev = M.evoInfo(m, { atk: 1 });
  assert.equal(ev.name, 'Puño Meteoro +');
  assert.equal(ev.needs, 'atk');
  assert.ok(ev.ready);
  assert.ok(M.evolve(m));
  assert.equal(m.name, 'Puño Meteoro +');
  assert.equal(m.baseName, 'Puño Meteoro');
  assert.ok(m.evolved && m.dmg > dmg);
  assert.equal(M.evolve(m), false, 'sólo una vez');
  assert.equal(M.BY_ID['meteor-mash'].name, 'Puño Meteoro', 'el catálogo no cambia');
  for (const [id, [name, need]] of Object.entries(M.EVO)) {
    assert.equal(name, M.BY_ID[id].name + ' +');
    assert.ok(M.NEED_NAME[need], id);
  }
});

const langs = require('../tools/build_langs.js');
langs.build();
/** El i18n de verdad con los diccionarios de verdad de un idioma. */
function dictionaries(lang) {
  const written = [];
  class Canvas { fillText() {} strokeText() {} measureText() { return { width: 0 }; } }
  const ctx = { G: {}, navigator: { language: lang, languages: [lang] }, location: { pathname: '/' }, console,
    localStorage: { getItem: () => lang, setItem() {} }, document: { documentElement: {}, write: h => written.push(h) }, CanvasRenderingContext2D: Canvas };
  ctx.window = ctx;
  vm.createContext(ctx);
  const load = f => vm.runInContext(source(f), ctx, { filename: f });
  load('js/core/locales.js');
  for (const html of written) load(/src="(js\/lang\/[^"?]+)/.exec(html)[1]);
  load('js/core/i18n.js');
  for (const m of source('dev.html').matchAll(/src="(js\/data\/lang-[^"]+\.js)"/g)) load(m[1]);
  return ctx.G;
}

for (const lang of ['es', 'en', 'fr', 'it', 'pt-BR', 'zh-Hans', 'zh-Hant']) {
  test(`${lang}: evolved names come from the base move; Arceus's messages are translated`, () => {
    const G = dictionaries(lang), { G: game } = boot();
    for (const [id, [evolved]] of Object.entries(game.Moves.EVO)) {
      const base = game.Moves.BY_ID[id].name;
      assert.equal(G.T(evolved, 'move'), G.T(base, 'move') + ' +', evolved);
    }
    if (lang === 'es') return;
    assert.ok(!G.T('Puño Meteoro +', 'move').includes('Puño'));
    for (const [type, plate] of Object.entries(game.Judgment.PLATES)) {
      const s = G.T('¡Arceus lleva la ' + plate + '! Ahora es de tipo ' + game.U.TYPE_NAME[type]);
      assert.ok(s.includes(G.T(plate)) && s.includes(G.T(game.U.TYPE_NAME[type])) && !s.includes('Tabla'), s);
    }
    for (const it of game.Items.LIST) assert.ok(G.T('¡Objeto roto: ' + it.name + '!').includes(G.T(it.name)), it.name);
    assert.notEqual(G.T('¡Arceus va a romper vuestros objetos!'), '¡Arceus va a romper vuestros objetos!');
    assert.ok(G.I18n.f('DAÑO A ARCEUS · {x}', '1.234').endsWith('1.234'));
    assert.notEqual(G.T('Daño a Arceus'), 'Daño a Arceus');
    if (lang.startsWith('zh')) assert.notEqual(G.T('Psíquico +', 'move'), G.T('Psíquico') + ' +', 'el del movimiento, no el del tipo');
  });
}
