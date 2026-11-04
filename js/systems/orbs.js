/* ============ orbs.js — Esferas de Mundo Misterioso ============
 * Objetos de un solo uso que se encuentran durante la partida: en los cofres,
 * en los jefes y, a veces, al derrotar a un Pokémon. No se guardan: se pierden
 * al acabar la partida. Sólo se consiguen jugando.
 *
 *   contra los enemigos   Soporesfera, Ralentosfera y Rafagaesfera
 *   para el equipo        Focosfera, Luminosfera y Rapidosfera (a ti y a los
 *                         compañeros que tengas cerca: TEAM_R)
 * A los jefes y legendarios les afectan menos.
 *
 * Se llevan hasta SLOTS distintas y MAX_EACH de cada una. Cada una se queda en
 * su hueco (pl.orbs[i] = { id, n } o null), así que su tecla no cambia al gastar
 * otra: teclas 5-8, tocar su casilla encima de los ataques (hud.js) o, con mando,
 * X usa la elegida (pl.orbSel) e Y pasa a otra. Una que no te cabe se queda en el
 * suelo (pickup.js).
 *
 * Cooperativo (ver net/coop.js). Quien manda en los enemigos es el anfitrión:
 *   invitado -> anfitrión  ['ou', id, x, y, mitad del ancho y del alto de su pantalla]
 *   anfitrión -> invitados ['ou', id, x, y]   (se ve y, si es para el equipo y
 *                                              estás cerca, también es para ti)
 *   anfitrión -> invitado  ['orb', id]        (la ha cogido él)
 *   anfitrión -> invitados ['pko', pickup, id, x, y]   (una esfera en el suelo)
 * Las versiones que no conocen estos avisos los ignoran. Por eso la del suelo no va
 * como 'pk': un 'pk' de una clase que no conocen les rompía el dibujo.
 */
G.Orbs = (() => {
  const SLOTS = 4, MAX_EACH = 3;
  const DROP_RATE = 1 / 250;            // de un Pokémon normal al caer (los jefes, siempre)
  const CHEST_RATE = 0.3;               // de un cofre normal (el de candado, siempre)
  const TEAM_R = 360;                   // hasta dónde llegan a los compañeros
  const BLAST_R = 240, BLAST = 1500;    // radio de Rafagaesfera y empujón (unos 230 px; ver enemy.js: kx)
  const VIEW = 1.3;                     // cuánto se aleja la cámara con Luminosfera

  /** Jefes y legendarios: les afectan menos. */
  const tough = e => !!(e.boss || e.legend || e.judge);

  const LIST = [
    { id: 'orbSleep', name: 'Soporesfera', color: '#b48aff',
      desc: 'Duerme a los enemigos de la pantalla 4 s (a los jefes, 1 s).',
      foe: e => e.applySleep(tough(e) ? 1 : 4) },
    { id: 'orbSlow', name: 'Ralentosfera', color: '#5fe08a',
      desc: 'Los enemigos de la pantalla van un 50 % más lentos durante 8 s (los jefes, un 20 %).',
      foe: e => e.applySlow(tough(e) ? 0.2 : 0.5, 8) },
    { id: 'orbBlast', name: 'Rafagaesfera', color: '#9fd8ff', near: true,
      desc: 'Lanza lejos a los enemigos que tienes cerca (a los jefes, la mitad).',
      foe: (e, x, y) => {
        const [nx, ny] = G.U.norm(e.x - x, e.y - y), k = BLAST * (tough(e) ? 0.5 : 1);
        e.kx += nx * k; e.ky += ny * k;
        e.stunT = 0; e.zzz = false;                  // (quieto no saldría volando)
      } },
    { id: 'orbFocus', name: 'Focosfera', color: '#ff9a3d', dur: 15,
      desc: '+25 % de crítico durante 15 s, para ti y los compañeros cercanos.',
      on: p => { p.critChance += 0.25; }, off: p => { p.critChance -= 0.25; } },
    { id: 'orbLight', name: 'Luminosfera', color: '#ffe14d', dur: 15,
      desc: 'Ves más campo (la cámara se aleja) durante 15 s, tú y los compañeros cercanos.',
      on: () => G.Camera.setZoom(VIEW), off: () => G.Camera.setZoom(1) },
    { id: 'orbSpeed', name: 'Rapidosfera', color: '#7fe0ff', dur: 10,
      desc: '+40 % de velocidad durante 10 s, para ti y los compañeros cercanos.',
      on: p => { p.spdMul *= 1.4; }, off: p => { p.spdMul /= 1.4; } }
  ];
  // (Sin prototipo: los ids también llegan por la red.)
  const BY = Object.create(null);
  for (const o of LIST) BY[o.id] = o;

  // ---------------- llevarlas ----------------

  /** ¿Te cabe? Un compañero lo mira en su ordenador: al anfitrión siempre le vale. */
  function canTake(pl, id) {
    if (!pl || pl.remote || !pl.orbs) return true;
    const s = pl.orbs.find(o => o && o.id === id);
    return s ? s.n < MAX_EACH : pl.orbs.includes(null);
  }

  /** La mete en su hueco (o en el primero libre). → el hueco, o -1 si no cabe. */
  function take(pl, id) {
    if (!BY[id] || !canTake(pl, id)) return -1;
    let i = pl.orbs.findIndex(o => o && o.id === id);
    if (i >= 0) pl.orbs[i].n++;
    else { i = pl.orbs.indexOf(null); pl.orbs[i] = { id, n: 1 }; }
    if (!pl.orbs[pl.orbSel]) pl.orbSel = i;
    return i;
  }

  /** La que suelta algo: en solitario, una que te quepa (en grupo la coge cualquiera). */
  function rollDrop() {
    const pl = !G.Coop.active && G.Game.player;
    const fit = pl ? LIST.filter(o => canTake(pl, o.id)) : LIST;
    return G.U.pick(fit.length ? fit : LIST).id;
  }

  /** Cómo se usa, con lo que estés jugando. */
  function howTo(i) {
    if (G.Touch.active) return G.T('tócala encima de tus ataques');
    if (G.Pad.name && G.Settings.get('gamepad') !== false) return G.T('X para usarla');
    return G.I18n.f('tecla {x}', i + 5);
  }

  /** Has cogido una. La primera de cada clase de la partida dice qué hace y cómo se usa. */
  function got(pl, id) {
    const o = BY[id];
    if (!o || !pl) return;
    const i = take(pl, id);
    if (i < 0) { G.Spawner.say('No te caben más esferas', 2.2, true); return; }
    G.FX.dmgText(pl.x, pl.y - pl.bodyH - 8, o.name, o.color, true);
    G.FX.ring(pl.x, pl.y, 6, 50, o.color, 0.4, 3);
    if (pl.orbSeen && !pl.orbSeen[id]) {
      pl.orbSeen[id] = true;
      G.Spawner.say(G.T(o.name) + ': ' + G.T(o.desc) + ' (' + howTo(i) + ')', 4, true);
    }
  }

  // ---------------- usarlas ----------------

  const canUse = pl => !!pl && !pl.dead && !pl.frozen && G.Game.state === 'playing' && !G.Judgment.cinematic;

  /** Lo que se ve al usarla (en cada ordenador). */
  function show(o, x, y) {
    G.FX.ring(x, y, 8, o.near ? BLAST_R : 150, o.color, 0.5, 5);
    G.FX.burst(x, y - 12, o.color, 26, 220);
    G.Audio.sfx(o.dur ? 'surge' : 'confirm');
  }

  /** En quien manda en los enemigos: los de la pantalla de quien la ha usado o, con Rafagaesfera, los de su alrededor. */
  function hitFoes(o, x, y, hw, hh) {
    for (const e of G.EnemyMgr.all()) {
      if (e.dead || e.remote) continue;
      const inside = o.near ? G.U.dist2(e.x, e.y, x, y) < BLAST_R * BLAST_R : Math.abs(e.x - x) <= hw && Math.abs(e.y - y) <= hh;
      if (inside) o.foe(e, x, y);
    }
  }

  /** Efecto para el equipo: se pone, o vuelve a empezar si ya lo llevabas (no se acumula). */
  function boost(pl, o) {
    if (!(pl.orbFx[o.id] > 0)) o.on(pl);
    pl.orbFx[o.id] = o.dur;
  }

  /** Lo llama Player.update mientras haya alguno puesto. */
  function tick(pl, dt) {
    for (const id in pl.orbFx) {
      if ((pl.orbFx[id] -= dt) > 0) continue;
      delete pl.orbFx[id];
      BY[id].off(pl);
    }
  }

  /** Usa la del hueco i. → true si se ha gastado. */
  function use(pl, i) {
    const s = pl && pl.orbs && pl.orbs[i];
    if (!s || !canUse(pl)) return false;
    const o = BY[s.id];
    if (--s.n <= 0) { pl.orbs[i] = null; if (pl.orbSel === i) step(pl, 1, false); }
    const x = Math.round(pl.x), y = Math.round(pl.y), hw = Math.round(G.Camera.w / 2), hh = Math.round(G.Camera.h / 2);
    show(o, x, y);
    G.FX.dmgText(pl.x, pl.y - pl.bodyH - 8, o.name, o.color, true);
    if (o.dur) boost(pl, o);
    if (G.Coop.active && !G.Coop.isHost) G.Coop.toHost(['ou', o.id, x, y, hw, hh]);
    else {
      if (o.foe) hitFoes(o, x, y, hw, hh);
      if (G.Coop.isHost) G.Coop.broadcast(['ou', o.id, x, y]);
    }
    return true;
  }

  /** Mando: pasa a la siguiente esfera que lleves. */
  function step(pl, dir = 1, sound = true) {
    const n = pl.orbs.length;
    for (let k = 1; k <= n; k++) {
      const i = (pl.orbSel + k * dir + n * k) % n;
      if (!pl.orbs[i]) continue;
      if (sound && i !== pl.orbSel) G.Audio.sfx('select');
      pl.orbSel = i;
      return;
    }
  }

  /** Mando: usa la elegida. */
  const useSelected = pl => use(pl, pl.orbSel);

  // ---------------- cooperativo ----------------

  /** Un compañero ha usado una (en tu ordenador). Si es para el equipo y estás cerca, también te llega. */
  function heard(id, x, y) {
    const o = BY[id], pl = G.Game.player;
    if (!o || !pl) return;
    show(o, x, y);
    if (!o.dur || pl.dead || G.U.dist2(pl.x, pl.y, x, y) > TEAM_R * TEAM_R) return;
    boost(pl, o);
    G.FX.dmgText(pl.x, pl.y - pl.bodyH - 8, o.name, o.color, true);
  }

  /** Anfitrión: la ha usado un invitado. */
  function fromMate(id, x, y, hw, hh) {
    const o = BY[id];
    if (!o) return;
    if (o.foe) hitFoes(o, x, y, hw, hh);
    heard(id, x, y);
  }

  return { LIST, BY, SLOTS, MAX_EACH, DROP_RATE, CHEST_RATE, TEAM_R, BLAST_R, BLAST, VIEW,
           canTake, take, rollDrop, got, use, step, useSelected, tick, heard, fromMate };
})();
