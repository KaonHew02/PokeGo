// Objetos equipables (js/data/items.js): sorteo sin repetir el que llevas y
// on/off que se deshacen bien (Chaleco Asalto con la carta Coraza).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function boot(coop = false, held = null) {
  const ctx = { console, Math };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/core/util.js', 'js/data/items.js', 'js/systems/levelup.js']) vm.runInContext(source(f), ctx, { filename: f });
  const G = ctx.G;
  G.Coop = { active: coop };
  G.Game = { player: { item: held } };
  return G;
}
const player = () => ({ dmgReduce: 0, atkMul: 1, cdMul: 1, spdMul: 1, coinMul: 1, xpMul: 1, regenFlat: 0, maxHp: 100 });

test('dropped items never repeat the held one in solo; roll honours its exception', () => {
  const G = boot(false, 'lifeorb');
  for (let i = 0; i < 400; i++) {
    assert.notEqual(G.Items.rollDrop(), 'lifeorb');
    assert.notEqual(G.Items.roll('assaultvest'), 'assaultvest');
  }
  // En grupo lo decide cada uno al cogerlo: aquí puede salir cualquiera.
  const C = boot(true, 'lifeorb'), seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(C.Items.rollDrop());
  assert.equal(seen.size, C.Items.LIST.length);
});

test('removing Assault Vest subtracts exactly what it added, even with Armor cards at the cap', () => {
  const G = boot();
  const coraza = G.LevelUp.STATS.find(s => s.id === 'def');
  const vest = G.Items.BY.assaultvest;
  const alone = player();
  for (let i = 0; i < 12; i++) coraza.apply(alone);
  for (const order of ['antes', 'después', 'en medio']) {
    const p = player();
    if (order === 'antes') vest.on(p);
    for (let i = 0; i < 12; i++) {
      if (order === 'en medio' && i === 6) vest.on(p);
      coraza.apply(p);
    }
    if (order === 'después') vest.on(p);
    assert.ok(Math.abs(p.dmgReduce - (alone.dmgReduce + 0.2)) < 1e-9, order);
    vest.off(p);
    assert.ok(Math.abs(p.dmgReduce - alone.dmgReduce) < 1e-9, order);
    vest.off(p);                                   // dos veces no resta dos veces
    assert.ok(Math.abs(p.dmgReduce - alone.dmgReduce) < 1e-9, order);
  }
});

test('equipping and removing every item restores the stats', () => {
  const G = boot();
  for (const it of G.Items.LIST) {
    const p = player(), before = JSON.stringify(player());
    it.on(p); it.off(p);
    const after = Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, Math.round(v * 1e9) / 1e9]));
    assert.equal(JSON.stringify(after), before, it.id);
  }
});
