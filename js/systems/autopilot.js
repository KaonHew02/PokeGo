/* ============ autopilot.js — modo automático (AUTO) ============
 * Con AUTO encendido el juego mueve a tu Pokémon y elige por ti (cartas de
 * nivel, objetos y vínculos): se puede dejar jugando solo y mirarlo. Los
 * ataques ya se lanzan solos; aquí sólo se decide hacia dónde ir.
 *
 *   Se enciende con el botón AUTO del HUD (ratón o toque), la tecla T o el
 *   botón X del mando, y se recuerda en este aparato (ajuste 'auto').
 *   Si te mueves tú (teclas, joystick o stick), mandas tú al momento; AUTO
 *   vuelve a los MANUAL_S segundos de soltar (sigue encendido).
 *   Mientras está encendido se apunta solo, aunque esté "Apuntar a mano".
 *
 * Movimiento ("steering"): cada STEP s se puntúan DIRS direcciones (y quedarse
 * quieto) mirando dónde estaría tu Pokémon dentro de T1 y T2 segundos:
 *   peligro   enemigos cerca (más los jefes y los que pegan fuerte; las
 *             embestidas a punto de salir), disparos que te van a dar, avisos
 *             en el suelo (hazards.js) que estallan antes de que salgas,
 *             paredes y objetos que cortan el paso, lava, trampas, la grieta
 *             (nunca entra sola: eso lo decide el jugador) y Arceus
 *   interés   experiencia, monedas, bayas (más con poca vida), tickets y
 *             objetos; en grupo, no alejarse del grupo; si no hay nadie a
 *             tiro, acercarse a pelear
 *   objetivo  además, cada SCAN s se elige UNO de lo que hay hasta OBJ_R (casi
 *             dos pantallas): un compañero caído (lo primero; se queda a su
 *             lado para levantarlo, si no es muy peligroso), cofres que romper,
 *             cofres con candado (se queda al lado hasta que se abre), altares,
 *             manantiales (con poca vida) y, del suelo, objetos, tickets e
 *             imanes. Gana el que más vale para lo que cuesta llegar (lo que hay
 *             que andar, rodeando paredes con el campo de pathing.js, y los
 *             enemigos del camino) y se sigue con él hasta acabarlo: no se cambia
 *             por poco (STICK) y tira de lejos casi igual que de cerca, pero el
 *             peligro manda siempre (primero sobrevivir). Si no se avanza hacia
 *             él, se deja un rato (BAN_S). Los cofres se rompen de verdad: se
 *             pone a tiro según su ataque (breakSpot) y, si nada le toca, le
 *             apunta (aimAt, lo usa player.js). Sin nada que hacer, en
 *             solitario, explora: va hacia lo que hace más que no ve (exploreDir).
 *             En el suelo, un anillo suave marca el objetivo (drawMark).
 * Se rodea a la horda de lado (en círculos) en vez de huir en línea recta y,
 * al verse rodeado, se sale por el hueco más grande, lejos de rincones y
 * pasillos. Se prefiere seguir la dirección de antes y el giro se suaviza (sin
 * tirones); sin prisa, anda despacio (la horda no se queda atrás). Si lleva un
 * rato sin avanzar (atascado), prueba otra dirección.
 * En la Sentencia de Arceus sólo huye; en la arena de una grieta, sólo aguanta.
 *
 * Elecciones (con el juego parado, a los CHOICE_S s para que se vea qué elige, y
 * con un aviso que lo dice): cartas de nivel (cardScore), objetos (itemKeep) y
 * vínculos (bondPick), con las mismas funciones que el ratón (en grupo, las
 * cartas se resuelven igual que siempre). Sólo se lanza el ataque activo, así
 * que AUTO arma la partida alrededor de uno, el más fuerte con tu Pokémon
 * (movePower: su lado físico o especial, el monotipo, cómo va con AUTO): lo
 * sube al máximo y lo evoluciona (cogiendo a tiempo la mejora que pide) y tras
 * cada carta pasa al más fuerte (bestSlot). Si ninguna carta vale la pena,
 * las cambia (si quedan cambios).
 * Coste: los enemigos salen de la rejilla (EnemyMgr.queryCircle) y como mucho
 * se miran los NEAR_MAX más cercanos; lo del suelo y del mapa (y el objetivo),
 * cada SCAN s.
 *
 * Ranking: una partida en la que se ha encendido AUTO (aunque sea un momento)
 * no sube a la clasificación; monedas, estadísticas, misiones y logros cuentan
 * igual. En grupo la sube el anfitrión: el invitado que enciende AUTO se lo
 * dice con el aviso 'au' (las versiones que no lo conocen lo ignoran).
 */
G.Auto = (() => {
  const DIRS = 16, STEP = 1 / 20, SCAN = 0.2;
  const MANUAL_S = 1.5;          // s sin tocar nada para que AUTO vuelva a mandar
  const CHOICE_S = 0.8;          // s que se ven las cartas antes de que AUTO elija (más que su bloqueo de 0,6 s)
  const NEAR_R = 460, NEAR_MAX = 48, PICK_R = 520;
  const T1 = 0.25, T2 = 0.6, T3 = 1.1;   // dentro de cuánto (s) se mira dónde estarías
  const SHOT_H = 0.9;            // s hacia delante que se miran los disparos
  // Se mira el terreno delante: a qué distancia, cuánto pesa (lava, agua) y lo que frena el agua.
  const RAY = [14, 30, 56, 90, 140, 200], RAY_W = [1, 0.8, 0.5, 0.3, 0.2, 0.1], SLOW_W = [0.5, 0.3, 0.2];
  const TRAP_V = [5, 2.5, 8];     // trampas (interact.js): veneno, pegajosa, explosiva
  // Ataques que hay que lanzar de cerca: con ellos se arrima más a los enemigos.
  const CLOSE = new Set(['melee', 'nova', 'aura', 'orbit', 'spin', 'shove', 'trail', 'dash']);
  // Objetivo: hasta dónde se busca (un compañero caído, más lejos), cuándo se deja de lejos,
  // cuánto más cuenta el que ya se lleva y cuántos s no se vuelve a intentar uno al que no se llega.
  const OBJ_R = 880, MATE_R = 1400, OBJ_DROP = 1300, STICK = 1.6, BAN_S = 25;
  // Explorar: rejilla de lo visto (casillas de CELL px, vistas hasta SEEN_R), a qué distancia se
  // pone el punto al que ir y a qué distancias (y con qué peso) se mira lo que falta por ver.
  const CELL = 256, SEEN_R = 760, EXP_GO = 640, EXP_D = [500, 800, 1100, 1400], EXP_W = [0.6, 1, 0.8, 0.5];
  const ANG = Array.from({ length: DIRS }, (_, i) => i / DIRS * Math.PI * 2);
  const CS = ANG.map(Math.cos), SN = ANG.map(Math.sin);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  let used = false, mateUsed = false, netOn = false;
  let manualAt = -1e9;           // última vez que te moviste tú (performance.now)
  let hx = 0, hy = 1, mag = 0;   // dirección suavizada (unitaria) y fuerza 0..1
  let side = 1, sideT = 0;       // hacia qué lado se rodea a la horda (y cuándo puede volver a cambiar)
  let stepT = 0, scanT = 0, want = { a: 0, stay: true, urgency: 0, speed: 1 };
  let goals = [], stays = [], avoids = [];
  let stuck = { t: 0, x: 0, y: 0, n: 0, avoid: 0, avoidT: 0, count: 0 };
  let choice = { key: null, t: 0 };
  let obj = null;                // objetivo actual (ver objective)
  const ban = new Map();         // id de un objetivo → hasta cuándo (clock) no se vuelve a intentar
  const seen = new Map();        // casilla de la rejilla → clock de la última vez que se vio
  let clock = 0, crowd = null;   // s con AUTO al mando; hacia dónde estaba la horda ({ x, y })
  // Daño recibido hace poco (vida perdida, en partes de la máxima, que se olvida en ~20 s) y daño por segundo que haces.
  let hurtAcc = 0, lastHp = null, dealt = 0, lastDealt = null;

  const on = () => !!(G.Settings && G.Settings.get('auto'));
  const inRun = () => !!G.Game.player && G.Game.state !== 'ui' && G.Game.state !== 'over';

  // ---------------- encender / apagar ----------------

  function setOn(v) {
    v = !!v;
    if (v === on()) return;
    G.Settings.set('auto', v);
    if (!inRun()) return;
    G.Audio.sfx(v ? 'confirm' : 'back');
    const first = v && !used;                  // la primera vez en la partida, el aviso es el del ranking
    if (v) markUsed();
    if (!first) G.UI.toast(v ? 'Modo automático activado' : 'Modo automático desactivado', 1800);
    // Al encenderlo, sale en la dirección en la que ya ibas.
    const pl = G.Game.player;
    if (v && pl) { hx = Math.cos(pl.moveAngle); hy = Math.sin(pl.moveAngle); mag = 0; }
  }
  function toggle() { setOn(!on()); }

  /** Esta partida ha tenido AUTO: no irá al ranking (y en grupo se avisa al anfitrión). */
  function markUsed() {
    if (!used) G.UI.toast('Modo automático: esta partida no irá al ranking', 3400);
    used = true;
    if (G.Coop.active && !G.Coop.isHost) G.Coop.toHost(['au']);
  }

  /** Anfitrión: un invitado ha encendido AUTO en esta partida. */
  function onNet(from, msg) {
    if (!G.Coop.isHost || !msg || msg.k !== 'f' || !Array.isArray(msg.ev) || !G.Coop.mate(from)) return;
    if (msg.ev.some(e => Array.isArray(e) && e[0] === 'au')) mateUsed = true;
  }

  /** Al empezar cada partida (game.js, ya con el cooperativo en marcha). */
  function reset() {
    used = mateUsed = false;
    manualAt = -1e9; hx = 0; hy = 1; mag = 0; side = 1; sideT = 0;
    stepT = scanT = 0; want = { a: Math.PI / 2, stay: true, urgency: 0, speed: 1 };
    goals = []; stays = []; avoids = [];
    stuck = { t: 0, x: 0, y: 0, n: 0, avoid: 0, avoidT: 0, count: 0 };
    choice = { key: null, t: 0 };
    obj = null; ban.clear(); seen.clear(); clock = 0; crowd = null;
    hurtAcc = 0; lastHp = null; dealt = 0; lastDealt = null;
    if (!netOn && G.Net) { netOn = true; G.Net.on(onNet); }
    if (on()) markUsed();
  }

  // ---------------- movimiento ----------------

  /**
   * Lo que mueve a tu Pokémon (Player.update lo usa en vez de G.Input.axis):
   * lo tuyo si te mueves; si no, con AUTO encendido, lo que decide aquí.
   */
  function axis(pl, dt) {
    track(pl, dt);
    const man = G.Input.axis();
    const now = performance.now();
    if (man[0] || man[1]) { manualAt = now; mag = 0; hx = man[0]; hy = man[1]; return man; }
    if (!on() || now - manualAt < MANUAL_S * 1000) { mag = 0; return man; }
    steer(pl, dt);
    return [hx * mag, hy * mag];
  }

  /** Lo que te han quitado hace poco y el daño que haces (para las cartas y los objetos). */
  function track(pl, dt) {
    if (lastHp != null && pl.hp < lastHp) hurtAcc += (lastHp - pl.hp) / pl.maxHp;
    lastHp = pl.hp;
    hurtAcc *= Math.exp(-dt / 20);
    if (lastDealt != null && dt > 0) dealt += ((pl.dmgDealt - lastDealt) / dt - dealt) * Math.min(1, dt / 5);
    lastDealt = pl.dmgDealt;
  }

  function steer(pl, dt) {
    clock += dt;
    if ((scanT -= dt) <= 0) { scanT = SCAN; scan(pl); }
    if ((stepT -= dt) <= 0) { stepT = STEP; want = decide(pl); }
    if (sideT > 0) sideT -= dt;
    stuckTick(pl, dt);
    // Giro suave hacia la dirección elegida: más rápido cuanto más urge (un disparo encima).
    if (!want.stay) {
      const ca = Math.atan2(hy, hx);
      if (mag < 0.05) { hx = Math.cos(want.a); hy = Math.sin(want.a); }
      else {
        const da = ((want.a - ca) % 6.2832 + 9.4248) % 6.2832 - 3.1416;
        const rate = (5 + 12 * want.urgency) * dt;
        const a = ca + clamp(da, -rate, rate);
        hx = Math.cos(a); hy = Math.sin(a);
      }
    }
    mag = G.U.damp(mag, want.stay ? 0 : want.speed, 9, dt);
  }

  /**
   * Atascado: si casi no avanza lo que debería (contra una pared o entre
   * objetos), deja de lado esa dirección un momento y rodea por el otro lado.
   */
  function stuckTick(pl, dt) {
    const s = stuck;
    if (s.avoidT > 0) s.avoidT -= dt;
    if ((s.t += dt) < 0.35) return;
    const moved = Math.hypot(pl.x - s.x, pl.y - s.y), expect = pl.spd * s.t * mag;
    s.x = pl.x; s.y = pl.y; s.t = 0;
    if (mag > 0.3 && expect > 8 && moved < expect * 0.3) {
      if (++s.n >= 2) {
        s.n = 0; s.avoid = Math.atan2(hy, hx); s.avoidT = 0.9; side = -side; s.count++;
        // Explorando, mejor otro sitio (el siguiente se elige en el próximo scan).
        if (obj && obj.kind === 'explore') obj = null;
      }
    } else s.n = 0;
  }

  /** Qué hay alrededor y adónde ir (cada STEP s). */
  function decide(pl) {
    const c = context(pl), r = score(c);
    crowd = c.crowd.x || c.crowd.y ? c.crowd : null;
    // Se rodea siempre hacia el mismo lado (así se vuelve a pasar por la experiencia que dejan);
    // si por ese lado hay mucho más peligro que por el otro, se cambia (como mucho cada 2 s).
    if (sideT <= 0 && (c.crowd.x || c.crowd.y)) {
      const base = Math.atan2(-c.crowd.y, -c.crowd.x), off = kiteOff(c);
      const at = a => Math.round(a / (6.2832 / DIRS) + DIRS * 4) % DIRS;
      if (r.danger[at(base + side * off)] > r.danger[at(base - side * off)] + 2) { side = -side; sideT = 2; }
    }
    let best = DIRS, bs = r.s[DIRS];
    for (let k = 0; k < DIRS; k++) {
      // Recién atascado: nada a menos de ~55° de la dirección que no avanzaba.
      if (stuck.avoidT > 0 && Math.cos(ANG[k] - stuck.avoid) > 0.57) continue;
      if (r.s[k] > bs) { bs = r.s[k]; best = k; }
    }
    if (best === DIRS) return { a: want.a, stay: true, urgency: 0, speed: 0 };
    // Ángulo fino entre las dos vecinas (parábola por los tres puntos).
    const l = r.s[(best + DIRS - 1) % DIRS], m = r.s[best], n = r.s[(best + 1) % DIRS];
    const den = l - 2 * m + n;
    const off = den < -1e-9 ? clamp(0.5 * (l - n) / den, -0.5, 0.5) : 0;
    const cur = Math.round(Math.atan2(hy, hx) / (6.2832 / DIRS) + DIRS) % DIRS;
    // Sin prisa (nada cerca ni nada que coger), andando despacio: así la horda no se queda
    // atrás fuera de la vista (los rezagados vuelven a salir por delante) y llega a tiro.
    const urgency = clamp(r.danger[cur] / 5, 0, 1);
    // (Explorando, sin tanta prisa: que la horda siga a tiro.)
    const pull = r.pull[best] - (obj && obj.kind === 'explore' ? r.objp[best] * 0.6 : 0);
    const speed = stuck.avoidT > 0 ? 1 : clamp(0.45 + urgency * 2 + pull * 1.5, 0.45, 1);
    return { a: (best + off) * 6.2832 / DIRS, stay: false, urgency, speed };
  }

  /** Alcance del ataque activo: hasta dónde hay que acercarse para pegar. */
  function reachOf(pl) {
    const m = pl.activeMove();
    if (!m) return 220;
    return CLOSE.has(m.kind) ? Math.max(40, (m.radius || 50) * 0.9) : 240;
  }

  /** Coste del terreno en un punto: 100 = no se puede pasar (pared u objeto sólido). */
  function terrainCost(pl) {
    const r = pl.r * 0.8, types = pl.mon.types;
    return (x, y) => {
      if (!G.World.isFree(x, y, r, true)) return 100;
      if (!G.World.isLiquid(x, y)) return 0;
      const le = G.World.liquidEffect(types);
      // La lava, el veneno y la descarga queman; el agua frena (eso lo mira slowAt).
      return le.dmg ? 5 : le.slide ? 0.4 : le.slow ? 0.6 : 0;
    };
  }

  /** Cuánto frena el terreno en un punto (1 = nada; el agua, 0,6): en el agua te alcanzan. */
  function slowAt(pl) {
    const types = pl.mon.types;
    return (x, y) => (G.World.isLiquid(x, y) ? G.World.liquidEffect(types).slow || 1 : 1);
  }

  /** Todo lo que necesita score(), sacado del juego. */
  function context(pl) {
    const hp = pl.hp / pl.maxHp, maxHp = pl.maxHp;
    const judge = G.Judgment.active;
    const reach = reachOf(pl), close = CLOSE.has((pl.activeMove() || {}).kind);
    let near = G.EnemyMgr.queryCircle(pl.x, pl.y, NEAR_R);
    const d2 = e => (e.x - pl.x) * (e.x - pl.x) + (e.y - pl.y) * (e.y - pl.y);
    if (near.length > NEAR_MAX) near = near.sort((a, b) => d2(a) - d2(b)).slice(0, NEAR_MAX);
    const foes = [], ring = [];
    let cx = 0, cy = 0, nearest = null, nd = Infinity;
    for (const e of near) {
      if (e.dead || e.behavior === 'thief') continue;
      const d = Math.sqrt(d2(e)) || 1;
      // Horda: hacia dónde están (los de cerca cuentan más).
      const k = (e.boss ? 2 : 1) / (1 + Math.max(0, d - e.r - pl.r) / 70);
      if (d < 260) { cx += (e.x - pl.x) / d * k; cy += (e.y - pl.y) / d * k; }
      const gap = d - e.r - pl.r;
      if (gap < nd) { nd = gap; nearest = e; }
      const w = (e.boss ? 2.6 : 1) * clamp(e.dmg / (maxHp * 0.08), 0.6, 3) * (e.stunT > 0 ? 0.4 : 1);
      // Todos los de alrededor, para saber hacia dónde hay hueco (aunque estén rodeándote por igual).
      ring.push([(e.x - pl.x) / d, (e.y - pl.y) / d, w / (1 + Math.max(0, gap) / 110)]);
      if (d > 300) continue;
      const f = { x: e.x, y: e.y, r: e.r, spd: e.spd * (1 - (e.slow || 0)), w };
      // Embestida: apuntando o ya lanzada, peligro en su línea.
      if (e.behavior === 'charger' && (e.phase === 'aim' || e.phase === 'dash')) {
        const [ux, uy] = e.phase === 'dash' ? [e.dx, e.dy] : G.U.norm(pl.x - e.x, pl.y - e.y);
        f.dash = [ux, uy, e.spd * 3.4 * 0.42 + e.r];
      }
      foes.push(f);
    }
    // Arceus en la Sentencia: invencible y quita mucho al tocarlo. Sólo huir.
    const A = judge && G.Judgment.arceus;
    if (A) foes.push({ x: A.x, y: A.y, r: A.r || 30, spd: 140, w: 12, K: 110 });
    const shots = [];
    for (const p of G.Projectiles.all()) {
      if (p.friendly || p.orb) continue;
      if (Math.abs(p.x - pl.x) > 320 || Math.abs(p.y - pl.y) > 320) continue;
      shots.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, r: p.r, life: p.life - p.t, w: 3 * clamp(p.dmg / (maxHp * 0.1), 0.5, 3) });
    }
    const zones = [];
    for (const h of G.Hazards.all) {
      if (h.hit) continue;
      const far = h.kind === 'zone' ? h.r + 140 : h.len + 140;
      if (Math.abs(h.x - pl.x) > far || Math.abs(h.y - pl.y) > far) continue;
      zones.push({ h, left: h.delay - h.t, w: h.pct ? 14 : 5 * clamp(h.dmg / (maxHp * 0.1), 0.6, 3) });
    }
    // Acercarse a pelear: si no hay nadie a tiro y vas bien de vida (en la Sentencia, no).
    let engage = null;
    // (Con la horda ya encima, no: primero salir.)
    const light = clamp(1 - Math.hypot(cx, cy) / 1.2, 0, 1);
    if (nearest && !judge && hp > 0.35 && nd > reach + 20 && light > 0) {
      // (Yendo a por un objetivo, menos: primero eso.)
      const k = obj && obj.kind !== 'explore' ? 0.35 : 1;
      engage = { x: nearest.x, y: nearest.y, v: 0.9 * k * light * Math.min(1, (nd - reach) / 160 + 0.3), near: 0 };
    }
    // Con poca vida, lo que no cura (ni es volver con el grupo) atrae menos.
    const gk = 0.4 + 0.6 * hp;
    const gs = goals.map(g => (g.vital ? g : Object.assign({}, g, { v: g.v * gk })));
    if (engage) gs.push(engage);
    return {
      // (spd: en tierra firme; si ahora vas por el agua, sin lo que frena.)
      x: pl.x, y: pl.y, r: pl.r, mag: pl.magnet, spd: pl.spd / (pl.inLiquid ? G.World.liquidEffect(pl.mon.types).slow || 1 : 1), hp, hx: hx * mag, hy: hy * mag, side, close,
      crowd: { x: cx, y: cy }, gap: nearest ? nd : null, ring, foes, shots, zones, goals: judge ? [] : gs, stays: judge ? [] : stays, avoid: avoids,
      obj: judge ? null : objCtx(pl, hp, gk), wall: terrainCost(pl), slow: slowAt(pl)
    };
  }

  /** ¿Está ya en el sitio del objetivo? (para depurar) */
  function holding() {
    const pl = G.Game.player;
    if (!obj || !pl) return false;
    const h = holdOf(obj, pl);
    return Math.hypot(h.x - pl.x, h.y - pl.y) <= h.r + 6;
  }

  /** Dónde hay que estar para el objetivo: { x, y, r } (con la órbita, a su distancia del cofre). */
  function holdOf(o, pl) {
    if (!o.ring) return { x: o.x, y: o.y, r: o.r };
    const dx = pl.x - o.x, dy = pl.y - o.y, d = Math.hypot(dx, dy) || 1;
    return { x: o.x + dx / d * o.ring, y: o.y + dy / d * o.ring, r: 12 };
  }

  /** El objetivo, como lo mira score(): dónde quedarse, hacia dónde ir ahora y cuánto tira. */
  function objCtx(pl, hp, gk) {
    if (!obj) return null;
    const h = holdOf(obj, pl);
    // Con poca vida, lo que no cura tira menos (como el resto).
    const k = obj.heal ? 1 : gk;
    return { hx: h.x, hy: h.y, r: h.r, wx: obj.direct ? h.x : obj.wx, wy: obj.direct ? h.y : obj.wy, w: obj.w * k, stay: obj.stay * k };
  }

  /** Lo que atrae un objeto del suelo (0 = nada). */
  function pickValue(p, pl, hp) {
    switch (p.kind) {
      case 'xp': return 0.3 + Math.min(0.6, p.value / 60);
      case 'xpBig': return 0.9 + Math.min(1.5, p.value / 120);
      case 'coin': return 0.45;
      case 'heal': return hp < 0.97 ? 0.4 + (1 - hp) * 7 : 0;
      case 'magnet': return 2.2;
      case 'bomb': return 1.4;
      case 'ticket': return 3;
      case 'ticket10': return 5;
      case 'item': return pl.item ? 0.6 : 2.4;
    }
    return 0.3;
  }

  /** Lo que atrae y lo que hay que evitar alrededor (cada SCAN s: objetos del suelo, del mapa, compañeros), y el objetivo. */
  function scan(pl) {
    const hp = pl.hp / pl.maxHp, gs = [], av = [];
    const dist = (x, y) => Math.hypot(x - pl.x, y - pl.y);
    if (!G.Judgment.active) {
      for (const p of G.Pickups.all()) {
        // Lo que ya vuela hacia ti (imán) llega solo.
        if (p.pulled || Math.abs(p.x - pl.x) > PICK_R || Math.abs(p.y - pl.y) > PICK_R) continue;
        const v = pickValue(p, pl, hp);
        if (v > 0) gs.push({ x: p.x, y: p.y, v, vital: p.kind === 'heal', near: 0, pick: true });
      }
      // Rocas: poca cosa, sólo si pillan cerca (los cofres, altares y demás son objetivos: ver objective).
      for (const p of G.World.propsInCircle(pl.x, pl.y, 380)) if (p.type === 'rock') gs.push({ x: p.x, y: p.y, v: 0.2, near: 110 });
      // Duendes del tesoro (Meowth, Gholdengo): no pegan, sueltan monedas.
      for (const e of G.EnemyMgr.all()) if (e.behavior === 'thief' && !e.dead && dist(e.x, e.y) < 500) gs.push({ x: e.x, y: e.y, v: 1.4, near: 0 });
    }
    // Trampas: no pisarlas (saltan al pisarlas).
    for (const p of G.World.specialsNear(pl.x, pl.y, 160)) if (p.type === 'trap') av.push({ x: p.x, y: p.y - 8, r: 24, v: TRAP_V[p.kind] || 5 });
    // La grieta: nunca entrar sola (eso lo decide el jugador).
    const rf = G.Rift.rift;
    if (rf && !G.Rift.inArena) av.push({ x: rf.x, y: rf.y - 10, r: 64, v: 40 });
    // Cooperativo: no alejarse del grupo (a los caídos se les levanta: son objetivos).
    if (G.Coop.active && !G.Judgment.active) {
      let mate = null, md = Infinity;
      for (const o of G.Coop.puppets()) {
        const d = dist(o.x, o.y);
        if (!o.dead && d < md) { md = d; mate = o; }
      }
      if (mate && md > 380) gs.push({ x: mate.x, y: mate.y, v: Math.min(3, (md - 380) / 200 + 0.5), vital: true, near: 0 });
    }
    // Los que más atraen (cerca y valiosos), como mucho 40.
    if (gs.length > 40) {
      const k = g => g.v / (1 + dist(g.x, g.y) / 140);
      gs.sort((a, b) => k(b) - k(a)).length = 40;
    }
    goals = gs; avoids = av;
    markSeen(pl);
    objective(pl, hp);
  }

  // ---------------- objetivo (cofres, altares...) y explorar ----------------

  /** Lo que vale ir a por algo del suelo como objetivo (0 = no merece el viaje: lo de cerca ya atrae solo). */
  function objPick(p, pl, hp, xpLeft) {
    if (p.pulled) return 0;
    switch (p.kind) {
      case 'item': {
        // Sólo si es mejor que el que llevas (o bueno, si no llevas ninguno): ver itemKeep.
        const s = itemInfo(pl);
        return itemValue(p.value, s) > (pl.item ? itemValue(pl.item, s) + 4 : 0) ? 2.6 : 0;
      }
      case 'ticket': return 2.6;
      case 'ticket10': return 4;
      case 'magnet': return xpLeft >= 12 ? 2 : 0;                    // sólo si hay experiencia que traer
      case 'heal': return hp < 0.5 ? (1 - hp) * 4 : 0;
    }
    return 0;
  }

  /**
   * Una cosa como objetivo (o null si ahora no vale): v (lo que vale, para
   * elegir), w (lo que tira al ir), r (radio en el que ya se ha llegado) y
   * stay (lo que vale quedarse dentro). cur: es el de ahora (aguanta un poco
   * más antes de dejarlo).
   */
  function cand(kind, ref, pl, hp, brk, xpLeft, cur) {
    const low = cur ? 0.22 : 0.3;                    // con menos vida, sólo lo que cura
    switch (kind) {
      case 'mate': {
        // Levantar a un compañero caído, si no es muy peligroso.
        if (!ref.dead || hp < 0.25) return null;
        const near = G.EnemyMgr.queryCircle(ref.x, ref.y, 130).filter(e => !e.dead && e.behavior !== 'thief');
        return near.length > 5 || near.some(e => e.boss) ? null : { v: 8, w: 2.6, r: 34, stay: 4.8, heal: true };
      }
      case 'chest': return brk && hp > low ? { v: 2.2, w: 2, r: brk.hold, stay: 2.6, aimR: brk.aim, ring: brk.ring || 0 } : null;
      // Con candado: quedarse al lado CHEST_TIME s (cuanto más abierto, más vale seguir).
      case 'big': return hp > low ? { v: 3.2, w: 2.2, r: Math.max(46, ref.r + pl.r + 24) - 12, stay: 3.3 + 3 * ref.open / G.Interact.CHEST_TIME } : null;
      case 'altar':
        // Con otro poder aún largo, se deja para luego (el nuevo quita el de ahora).
        return ref.used || hp < low - 0.05 ? null : { v: pl.power && pl.power.t > 6 ? 0.6 : 2.4, w: 2.2, r: 0, stay: 0 };
      case 'spring': {
        // Manantial: con poca vida y si le queda agua; ya en él, hasta curarse casi del todo.
        const ok = ref.charge > (cur ? 0.05 : 0.25) && hp < (cur ? 0.92 : 0.6);
        return ok ? { v: (1 - hp) * 7 + (cur ? 1 : 0), w: 1.2 + (1 - hp) * 3, r: 16, stay: 2 + (1 - hp) * 4, dy: -8, heal: true } : null;
      }
      case 'pick': {
        const v = objPick(ref, pl, hp, xpLeft);
        return v ? { v, w: Math.min(2.4, v), r: (pl.magnet || 0) * 0.8, stay: 0, heal: ref.kind === 'heal' } : null;
      }
    }
    return null;
  }

  /** ¿Sigue ahí? (no se ha roto, abierto ni cogido) */
  function exists(o) {
    const p = o.ref;
    switch (o.kind) {
      case 'mate': return G.Coop.active && G.Coop.puppets().includes(p);
      case 'chest': return p.hp > 0 && G.World.propsInCircle(p.x, p.y, 1).includes(p);
      case 'pick': return G.Pickups.all().includes(p);
    }
    return G.World.specialsNear(p.x, p.y, 1).includes(p);
  }

  /** Peligro de ir hasta (x, y): enemigos cerca de la línea (los del final, y los jefes, más). */
  function riskTo(pl, x, y, foes) {
    const dx = x - pl.x, dy = y - pl.y, L2 = dx * dx + dy * dy || 1;
    let r = 0;
    for (const e of foes) {
      const ex = e.x - pl.x, ey = e.y - pl.y, t = clamp((ex * dx + ey * dy) / L2, 0, 1);
      if (t < 0.08) continue;                      // los de tu lado ya los esquiva el movimiento
      const d = Math.hypot(ex - dx * t, ey - dy * t);
      if (d < 150) r += (e.boss ? 3 : 1) * (1 - d / 150) * (t > 0.8 ? 1.5 : 1);
    }
    return r * 0.3;
  }

  /**
   * Elige o sigue el objetivo (cada SCAN s). El de ahora sigue mientras valga
   * (no se ha roto, abierto, usado ni cogido, no queda lejísimos) y se avance
   * hacia él; si no, se deja BAN_S s. Sin nada, en solitario, explorar.
   */
  function objective(pl, hp) {
    if (G.Judgment.active) { obj = null; return; }
    const coop = G.Coop.active, arena = G.Rift.inArena;
    const foes = [];
    for (const e of G.EnemyMgr.all()) if (!e.dead && e.behavior !== 'thief') foes.push(e);
    let xpLeft = 0;
    const picks = G.Pickups.all();
    for (const p of picks) if (!p.pulled && (p.kind === 'xp' || p.kind === 'xpBig')) xpLeft++;
    const brk = breakSpot(pl.activeGroup(), pl.r);
    const mates = coop ? G.Coop.puppets().filter(o => !o.dead) : [];
    // En grupo, sólo lo que queda cerca de algún compañero (no alejarse del grupo).
    const grouped = (x, y) => !mates.length || mates.some(o => (o.x - x) ** 2 + (o.y - y) ** 2 < 600 * 600);
    const cands = [];
    const add = (kind, ref, id, x, y, max, isCur) => {
      if (!isCur && ((obj && obj.id === id) || (ban.get(id) || 0) > clock)) return;
      const d = Math.hypot(x - pl.x, y - pl.y);
      if (d > max || (kind !== 'mate' && !grouped(x, y))) return;
      const c = cand(kind, ref, pl, hp, brk, xpLeft, isCur);
      if (c) cands.push(Object.assign(c, { id, kind, ref, x, y: y + (c.dy || 0), d }));
    };
    if (coop) for (const o of G.Coop.puppets()) if (o.dead) add('mate', o, 'm' + o.uid, o.x, o.y, MATE_R);
    if (!arena) {
      if (brk) for (const p of G.World.propsInCircle(pl.x, pl.y, OBJ_R)) if (p.type === 'chest') add('chest', p, 'p' + p.id, p.x, p.y, OBJ_R);
      for (const p of G.World.specialsNear(pl.x, pl.y, OBJ_R)) {
        const kind = p.type === 'bigchest' ? 'big' : p.type === 'altar' || p.type === 'spring' ? p.type : null;
        if (kind) add(kind, p, 'p' + p.id, p.x, p.y, OBJ_R);
      }
    }
    for (const p of picks) {
      if (Math.abs(p.x - pl.x) < OBJ_R && Math.abs(p.y - pl.y) < OBJ_R && objPick(p, pl, hp, xpLeft)) add('pick', p, 'k' + p.id, p.x, p.y, OBJ_R);
    }
    // El de ahora (aunque ya quede algo más lejos), si sigue ahí.
    if (obj && obj.kind !== 'explore' && exists(obj)) add(obj.kind, obj.ref, obj.id, obj.ref.x, obj.ref.y, obj.kind === 'mate' ? MATE_R : OBJ_DROP, true);
    // Lo que hay que andar (rodeando paredes) y el peligro del camino.
    for (const o of cands) {
      const rt = G.Path.route(pl, o.x, o.y);
      if (rt === null) { ban.set(o.id, clock + 8); o.v = 0; continue; }     // no se llega andando
      o.dist = rt ? rt.len : o.d * 1.15;
      o.risk = riskTo(pl, o.x, o.y, foes);
    }
    const best = pickObjective(cands, obj && obj.id);
    if (best) {
      if (!obj || obj.id !== best.id) obj = Object.assign(best, { best: Infinity, bestT: clock, inT: 0 });
      else Object.assign(obj, best, { best: obj.best, bestT: obj.bestT, inT: obj.inT });
    } else obj = !coop && !arena ? exploreObj(pl, obj && obj.kind === 'explore' ? obj : null) : null;
    if (!obj) return;
    // Si no se avanza (o se lleva demasiado rato en el sitio sin acabarlo), se deja un rato.
    const h = holdOf(obj, pl), dh = Math.hypot(h.x - pl.x, h.y - pl.y);
    if (dh <= h.r + 6) obj.inT += SCAN;
    else if (dh < obj.best - 30) { obj.best = dh; obj.bestT = clock; }
    const slow = obj.kind === 'explore' ? 5 : 8;
    const long = obj.kind === 'chest' ? 9 : obj.kind === 'big' ? 14 : Infinity;
    if (clock - obj.bestT > slow + obj.inT || obj.inT > long) {
      ban.set(obj.id, clock + (obj.kind === 'mate' ? 6 : BAN_S));      // (a un compañero, se vuelve pronto)
      obj = null;
      return;
    }
    // Por dónde ir: el camino andando (o recto, si se ve o no se sabe).
    const rt = G.Path.route(pl, obj.x, obj.y, true);
    if (rt === null) { ban.set(obj.id, clock + 8); obj = null; return; }
    obj.direct = !rt || (rt.wx === obj.x && rt.wy === obj.y);
    obj.wx = rt ? rt.wx : obj.x; obj.wy = rt ? rt.wy : obj.y;
  }

  /** Apunta en la rejilla lo que se ve ahora (hasta SEEN_R): explorar es ir a lo que no. */
  function markSeen(pl) {
    const c0x = Math.floor((pl.x - SEEN_R) / CELL), c1x = Math.floor((pl.x + SEEN_R) / CELL);
    const c0y = Math.floor((pl.y - SEEN_R) / CELL), c1y = Math.floor((pl.y + SEEN_R) / CELL);
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const x = (cx + 0.5) * CELL - pl.x, y = (cy + 0.5) * CELL - pl.y;
      if (x * x + y * y <= SEEN_R * SEEN_R) seen.set(cellKey(cx, cy), clock);
    }
    // (Partidas larguísimas: se olvida lo visto hace mucho.)
    if (seen.size > 6000) for (const [k, t] of seen) if (clock - t > 300) seen.delete(k);
  }
  const cellKey = (cx, cy) => (cx + 32768) * 65536 + cy + 32768;

  /**
   * Explorar: un punto a EXP_GO px hacia lo que hace más que no se ve (ver
   * exploreDir). Se sigue con él hasta llegar (o 12 s, o si no se avanza).
   */
  function exploreObj(pl, prev) {
    if (prev && clock - prev.t0 < 12 && Math.hypot(prev.x - pl.x, prev.y - pl.y) > 200) return prev;
    const TS = G.World.TS;
    const seenAge = (cx, cy) => { const t = seen.get(cellKey(cx, cy)); return t == null ? Infinity : clock - t; };
    // Lo que se llega andando (el campo de pathing.js); fuera de él, si la casilla se pisa.
    const open = (x, y) => {
      const rt = G.Path.route(pl, x, y);
      if (rt === undefined) return G.World.walkable(Math.floor(x / TS), Math.floor(y / TS)) ? 0.6 : 0.1;
      return rt ? Math.min(1, EXP_GO / rt.len) : 0;
    };
    const a = exploreDir({ x: pl.x, y: pl.y, cell: CELL, seenAge, open, prev: prev ? prev.a : null, crowd });
    return { id: 'x', kind: 'explore', x: pl.x + Math.cos(a) * EXP_GO, y: pl.y + Math.sin(a) * EXP_GO, a, w: 1, r: 60, stay: 0,
             t0: clock, best: Infinity, bestT: clock, inT: 0 };
  }

  // ---------------- objetivo: partes puras (las pruebas las llaman con datos inventados) ----------------

  /**
   * El objetivo que conviene: de los candidatos [{ id, v, dist, risk }], el de
   * más v / (1 + dist / 500) / (1 + risk) (dist: lo que hay que andar; risk:
   * enemigos en el camino). El que ya se lleva (cur, su id) cuenta ×STICK: no
   * se cambia por poco. → el elegido o null.
   */
  function pickObjective(cands, cur) {
    let best = null, bs = 0;
    for (const o of cands) {
      if (!(o.v > 0)) continue;
      const s = o.v / (1 + o.dist / 500) / (1 + o.risk) * (o.id === cur ? STICK : 1);
      if (s > bs) { bs = s; best = o; }
    }
    return best;
  }

  /**
   * Cómo romper un cofre con un ataque (m, de Moves.instance; r: radio de tu
   * Pokémon): hold = a cuánto ponerse del cofre, aim = hasta dónde se le apunta
   * (0: no hace falta, pega alrededor), ring = la órbita (el cofre, a esa
   * distancia). null si no le hace daño: la cadena y lo que va a por enemigos
   * (torreta, meteoros, aturdir) y las mejoras.
   */
  function spotOf(m, r) {
    const R = m.radius || 50, near = r + 16;
    switch (m.kind) {
      case 'projectile': case 'bounce': return { hold: 150, aim: 260 };
      case 'homing': return { hold: 70, aim: 160 };                     // (se tuercen hacia los enemigos: de cerca)
      case 'boomerang': return { hold: clamp(R * 0.7, near, 150), aim: R + 30 };
      case 'cone': { const L = (m.speed || 200) * (m.life || 0.5); return { hold: clamp(L * 0.6, near, 130), aim: L }; }
      case 'beam': case 'charge': return { hold: clamp(R * 0.6, near, 150), aim: R };
      case 'melee': return { hold: Math.max(near, R * 0.7), aim: R + 20 };
      case 'dash': return { hold: clamp(R * 0.6, near, 120), aim: R + 40 };
      case 'quake': { const L = (m.count | 0) * 34 + R; return { hold: clamp(L * 0.5, near, 140), aim: L }; }
      case 'vortex': return { hold: 110, aim: 140 };                    // sin enemigos cerca sale delante (a 120)
      case 'aura': case 'spin': case 'shove': return { hold: Math.max(near, R * 0.7), aim: 0 };
      case 'nova': case 'trail': case 'mine': return { hold: near, aim: 0 };
      case 'orbit': return R > near ? { hold: near, aim: 0, ring: R } : { hold: near, aim: 0 };
    }
    return null;
  }

  /** Con lo que se lanza (el hueco activo: con un vínculo, varios), la mejor forma de romper un cofre (ver spotOf), o null. */
  function breakSpot(moves, r) {
    let best = null;
    for (const m of moves) {
      const s = spotOf(m, r);
      if (s && (!best || s.hold > best.hold)) best = s;
    }
    return best;
  }

  /**
   * Hacia dónde explorar: de DIRS direcciones, la que lleva a lo que hace más
   * que no se ve. o = { x, y, cell, seenAge(cx, cy) → s desde que se vio esa
   * casilla (Infinity: nunca), open(x, y) → 0..1 lo que se llega andando a ese
   * punto (0: no hay camino), prev (la de antes: se prefiere un poco, para no
   * cambiar a cada momento), crowd ({ x, y }: hacia la horda; no se explora
   * hacia ella) }. → ángulo (radianes).
   */
  function exploreDir(o) {
    let best = 0, bs = -Infinity;
    const cm = o.crowd ? Math.min(2, Math.hypot(o.crowd.x, o.crowd.y)) : 0, ca = cm ? Math.atan2(o.crowd.y, o.crowd.x) : 0;
    for (let k = 0; k < DIRS; k++) {
      let s = 0;
      for (let j = 0; j < EXP_D.length; j++) {
        const age = o.seenAge(Math.floor((o.x + CS[k] * EXP_D[j]) / o.cell), Math.floor((o.y + SN[k] * EXP_D[j]) / o.cell));
        s += EXP_W[j] * Math.min(1, age / 90);
      }
      s *= 0.15 + 0.85 * o.open(o.x + CS[k] * EXP_GO, o.y + SN[k] * EXP_GO);
      if (o.prev != null) s += 0.3 * Math.cos(ANG[k] - o.prev);
      if (cm) s -= 0.4 * cm * Math.cos(ANG[k] - ca);               // mejor lejos de la horda
      if (s > bs) { bs = s; best = k; }
    }
    return ANG[best];
  }

  /**
   * Lo que apunta tu Pokémon (player.js, si nada le toca ni hay un jefe a
   * tiro): con AUTO al mando y un cofre de objetivo a su alcance, el cofre;
   * si no, null (lo de siempre).
   */
  function aimAt(pl) {
    if (!obj || obj.kind !== 'chest' || !obj.aimR || pl !== G.Game.player || !on() || performance.now() - manualAt < MANUAL_S * 1000) return null;
    const p = obj.ref;
    return p.hp > 0 && (p.x - pl.x) ** 2 + (p.y - pl.y) ** 2 <= obj.aimR * obj.aimR ? p : null;
  }

  /** Marca suave del objetivo (game.js, en el suelo): un anillo que late; si no se ve, una flechita junto a tu Pokémon. */
  function drawMark(ctx) {
    const pl = G.Game.player;
    if (!obj || obj.kind === 'explore' || !on() || !pl || pl.dead || G.Judgment.active || performance.now() - manualAt < MANUAL_S * 1000) return;
    const t = performance.now() / 1000, x = obj.x, y = obj.y;
    ctx.save();
    ctx.strokeStyle = '#ffd23f'; ctx.fillStyle = '#ffd23f'; ctx.lineWidth = 1.5;
    if (G.Camera.sees(x, y, 20)) {
      ctx.globalAlpha = 0.3 + 0.15 * Math.sin(t * 4);
      ctx.setLineDash([5, 5]); ctx.lineDashOffset = -t * 14;
      ctx.beginPath(); ctx.ellipse(x, y, 22, 9, 0, 0, 6.2832); ctx.stroke();
    } else {
      const a = Math.atan2(y - pl.y, x - pl.x), ax = pl.x + Math.cos(a) * 34, ay = pl.y + Math.sin(a) * 26;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(ax + Math.cos(a) * 6, ay + Math.sin(a) * 6);
      ctx.lineTo(ax + Math.cos(a + 2.5) * 5, ay + Math.sin(a + 2.5) * 5);
      ctx.lineTo(ax + Math.cos(a - 2.5) * 5, ay + Math.sin(a - 2.5) * 5);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // ---------------- puntuación (pura) ----------------

  const insideHz = (h, x, y, r) => {
    if (G.Hazards) return G.Hazards.inside(h, x, y, r);
    if (h.kind === 'zone') return (x - h.x) ** 2 + (y - h.y) ** 2 < (h.r + r * 0.6) ** 2;
    const ca = Math.cos(h.angle), sa = Math.sin(h.angle), px = x - h.x, py = y - h.y, along = px * ca + py * sa;
    return along >= -r && along <= h.len + r && Math.abs(-px * sa + py * ca) <= h.w / 2 + r * 0.6;
  };

  /**
   * Cuánto se sale de lado al rodear a la horda (radianes desde "huir recto"):
   * con uno encima, casi recto hacia atrás; a buena distancia, de lado (en círculo).
   */
  const kiteOff = c => 0.5 + 1.1 * clamp((c.gap == null ? Infinity : c.gap) / (c.close ? 30 : 90), 0, 1);

  /** Peligro de estar en (px, py) dentro de t s por los enemigos (kk: lo lejos que se nota cada uno). */
  function foeDanger(c, px, py, t, kk = 1) {
    let d = 0;
    const K0 = (c.close ? 14 : 24) * kk;
    for (const e of c.foes) {
      // Los enemigos van hacia ti: dentro de t s estarán más cerca. Pesa sobre todo tocarlos
      // (y lo que falta para eso); lejos, casi nada (si no, no se acercaría nunca a la experiencia).
      const gap = Math.hypot(px - e.x, py - e.y) - e.r - c.r - e.spd * t * 0.7;
      const K = (e.K || 0) * kk || K0;
      d += e.w * (gap <= 0 ? 4 - gap / 10 : Math.exp(-gap / K));
      if (e.dash) {
        // Embestida: rectángulo desde el enemigo en su dirección.
        const ax = px - e.x, ay = py - e.y, along = ax * e.dash[0] + ay * e.dash[1];
        if (along > -e.r && along < e.dash[2] && Math.abs(ax * e.dash[1] - ay * e.dash[0]) < e.r + c.r + 6) d += e.w * 3;
      }
    }
    return d;
  }

  /**
   * Puntos de cada dirección (0..DIRS-1) y de quedarse quieto (DIRS); más es
   * mejor. Pura: todo lo que mira va en c (las pruebas la llaman con datos
   * inventados). Devuelve { s, danger, pull }: los puntos, sólo el peligro y
   * sólo lo que atrae (experiencia, cofres...) de cada una.
   *   c = { x, y, r, spd (en tierra firme), mag (radio del imán), hp (0..1),
   *         hx, hy (dirección de antes × fuerza), side (lado al rodear), close (ataque de cerca),
   *         crowd: { x, y } (hacia la horda), gap (al más cercano, o null),
   *         ring: [[ux, uy, peso]] (todos los de alrededor), foes: [{ x, y, r, spd, w, K?, dash? }],
   *         shots: [{ x, y, vx, vy, r, life, w }], zones: [{ h, left, w }],
   *         goals: [{ x, y, v, near, pick? }], stays: [{ x, y, r, v }], avoid: [{ x, y, r, v }],
   *         obj?: { hx, hy, r (dónde quedarse), wx, wy (hacia dónde ir ahora), w (lo que tira), stay (lo que vale quedarse) },
   *         wall(x, y) → coste del terreno (100 = no se pasa), slow(x, y)? → lo que frena (1 = nada) }
   * (Y objp: de pull, lo que es del objetivo.)
   */
  function score(c) {
    const s = new Float64Array(DIRS + 1), danger = new Float64Array(DIRS + 1), pull = new Float64Array(DIRS + 1), objp = new Float64Array(DIRS + 1);
    const hpK = 2 - clamp(c.hp, 0, 1);                  // con poca vida, el peligro pesa más (hasta el doble)
    // Lo que atrae, ya con su ángulo y su peso (una vez, no en cada dirección).
    const pulls = [];
    let stayV = 0;
    for (const g of c.goals) {
      const dx = g.x - c.x, dy = g.y - c.y, d = Math.hypot(dx, dy);
      if (d < Math.max(10, g.near || 0)) continue;
      // Lo del suelo vuela hacia ti en cuanto entras en el radio del imán: basta llegar ahí.
      const left = g.pick ? Math.max(0, d - (c.mag || 0) * 0.85) : d;
      pulls.push([dx / d, dy / d, g.v / (1 + left / 120)]);
    }
    for (const g of c.stays) {
      const dx = g.x - c.x, dy = g.y - c.y, d = Math.hypot(dx, dy);
      if (d <= g.r) stayV += g.v * 1.5;
      else pulls.push([dx / d, dy / d, g.v * 1.4 / (1 + d / 200)]);
    }
    // El objetivo: de lejos tira algo menos, pero nunca casi nada (a 900 px, más de la mitad);
    // ya en su sitio, quedarse (o apartarse sin salir de él, si hay algo que esquivar).
    const o = c.obj;
    let ox = 0, oy = 0, ow = 0, oin = false;
    if (o) {
      const hd = Math.hypot(o.hx - c.x, o.hy - c.y);
      if (hd <= o.r) { oin = true; stayV += o.stay; }
      else {
        const dx = o.wx - c.x, dy = o.wy - c.y, d = Math.hypot(dx, dy) || 1;
        ox = dx / d; oy = dy / d; ow = o.w / (1 + hd / 1200);
      }
    }
    // Rodear la horda: hacia atrás y de lado (en círculos, no en línea recta).
    const cm = Math.min(2.5, Math.hypot(c.crowd.x, c.crowd.y));
    // Hacia dónde hay menos enemigos (a lo lejos): al verse rodeado, por el hueco más grande.
    const open = new Float64Array(DIRS);
    let openMax = 0;
    for (const [ex, ey, w] of c.ring || []) {
      for (let k = 0; k < DIRS; k++) {
        const cos = ex * CS[k] + ey * SN[k];
        if (cos > 0) { const c2 = cos * cos; open[k] += w * c2 * c2; }
      }
    }
    for (let k = 0; k < DIRS; k++) openMax = Math.max(openMax, open[k]);
    const flee = Math.atan2(-c.crowd.y, -c.crowd.x) + c.side * kiteOff(c);
    const fx = Math.cos(flee), fy = Math.sin(flee);
    // Terreno de cada dirección: hasta dónde se puede ir (una pared u objeto sólido para en
    // seco: ir contra ella es como quedarse quieto, y lo de detrás ya no cuenta), lo que
    // cuesta (lava, agua) y cuánto frena.
    const RMAX = RAY[RAY.length - 1], frees = new Float64Array(DIRS), costs = new Float64Array(DIRS), slows = new Float64Array(DIRS);
    let shut = 0;
    for (let k = 0; k < DIRS; k++) {
      let free = RMAX, cost = 0, slow = 0;
      for (let j = 0; j < RAY.length; j++) {
        const x = c.x + CS[k] * RAY[j], y = c.y + SN[k] * RAY[j], w = c.wall(x, y);
        if (w >= 100) { free = j ? RAY[j - 1] : 0; break; }
        cost += w * RAY_W[j];
        if (j < SLOW_W.length) slow += (c.slow ? c.slow(x, y) : 1) * SLOW_W[j];
      }
      frees[k] = free; costs[k] = cost; slows[k] = free >= RAY[2] ? slow : 1;
      if (free < RAY[3]) shut++;
    }
    // Con enemigos cerca, no meterse en rincones ni pasillos (sin salida te acaban rodeando).
    const threat = Math.min(1, cm);

    for (let k = 0; k <= DIRS; k++) {
      const move = k < DIRS, ux = move ? CS[k] : 0, uy = move ? SN[k] : 0;
      let d = 0, free = 0, spd = c.spd;
      if (move) {
        free = frees[k]; spd *= slows[k];                          // por el agua se avanza menos
        d += costs[k] + 1.5 * threat * (1 - free / RMAX);
        if (free < spd * T1) d += free < RAY[0] ? 3 : 1.5;        // contra la pared no se va a ningún sitio
      } else {
        const w0 = c.wall(c.x, c.y);
        d += (w0 >= 100 ? 0 : w0) * 2 + 1.5 * threat * shut / DIRS;
      }
      const at = t => Math.min(spd * t, free);                  // lo que habrás andado dentro de t s
      const vx = ux * Math.min(spd, free / SHOT_H), vy = uy * Math.min(spd, free / SHOT_H);
      // Enemigos (dentro de T1 y de T2 s) y, más lejos, hacia dónde hay sitio libre.
      d += foeDanger(c, c.x + ux * at(T1), c.y + uy * at(T1), T1);
      d += 0.55 * foeDanger(c, c.x + ux * at(T2), c.y + uy * at(T2), T2);
      d += 0.2 * foeDanger(c, c.x + ux * at(T3), c.y + uy * at(T3), T3, 2);
      // Disparos: la distancia mínima entre tu camino y el suyo.
      for (const q of c.shots) {
        const rx = q.x - c.x, ry = q.y - c.y, rvx = q.vx - vx, rvy = q.vy - vy, rv2 = rvx * rvx + rvy * rvy;
        const H = Math.min(SHOT_H, Math.max(0, q.life));
        const tc = rv2 > 1 ? clamp(-(rx * rvx + ry * rvy) / rv2, 0, H) : 0;
        const gap = Math.hypot(rx + rvx * tc, ry + rvy * tc) - q.r - c.r;
        const hit = gap < 6 ? 1 : gap < 20 ? (20 - gap) / 14 : 0;
        if (hit) d += q.w * hit * (1 - 0.5 * tc / SHOT_H);
      }
      // Avisos en el suelo: ¿estarás dentro cuando estalle? (O justo en el borde: mejor salir con margen.)
      for (const z of c.zones) {
        const t = clamp(z.left, 0, 1.2), px = c.x + ux * at(t), py = c.y + uy * at(t);
        if (insideHz(z.h, px, py, c.r + 6)) d += z.w * (z.left < 0.6 ? 1.6 : 1);
        else if (insideHz(z.h, px, py, c.r + 26)) d += z.w * 0.3;
      }
      // Sitios que evitar (trampas, la grieta).
      for (const a of c.avoid) {
        if (Math.hypot(c.x + ux * at(T1) - a.x, c.y + uy * at(T1) - a.y) < a.r || Math.hypot(c.x + ux * at(T2) - a.x, c.y + uy * at(T2) - a.y) < a.r) d += a.v;
      }
      d += 0.5 * (move ? open[k] : openMax * 0.5);
      danger[k] = d;

      // Interés.
      let v = 0;
      if (move) {
        for (const [px, py, w] of pulls) { const cos = px * ux + py * uy; if (cos > 0) v += w * cos * cos; }
        let ov = 0;
        if (ow) { const cos = ox * ux + oy * uy; if (cos > 0) ov = ow * cos * cos; }
        // Lo que hay en una dirección peligrosa atrae menos (no meterse en la horda por una gema).
        v = (Math.min(4, v) + ov) / (1 + 0.3 * d);
        pull[k] = v; objp[k] = ov / (1 + 0.3 * d);
        if (oin && Math.hypot(c.x + ux * at(T1) - o.hx, c.y + uy * at(T1) - o.hy) <= o.r) v += o.stay * 0.7;
        v += 0.6 * cm * Math.max(0, fx * ux + fy * uy);
        v += 0.7 * (c.hx * ux + c.hy * uy);       // seguir por donde iba
      } else v = stayV - 0.4;                       // quedarse quieto, sólo si hay algo que hacer aquí
      s[k] = v - d * hpK;
    }
    return { s, danger, pull, objp };
  }

  // ---------------- elecciones (cartas, objetos, vínculos) ----------------
  /*
   * AUTO piensa la partida como un buen jugador: sólo se lanza el hueco activo
   * (con un vínculo, todos sus ataques a la vez), así que lo que cuenta es lo
   * fuerte que es ése. movePower da el daño por segundo que se espera de un
   * ataque con TU Pokémon: sus números (ya con las mejoras y la evolución),
   * cuántos golpes da cada vez según la familia (HITS), si es de su lado bueno
   * (físico o especial: G.Stats.fit), el +20 % del monotipo con los de su tipo
   * y lo que rinde con AUTO, que rodea a la horda a distancia (KIND_FIT). Cada
   * carta vale lo que sube el mejor hueco (cardInfo) más, para el futuro, lo que
   * aportaría con un vínculo y lo que acerca la evolución del principal; las de
   * mejora, según la partida (vida, daño recibido hace poco, topes).
   */

  // Golpes que da cada lanzamiento, más o menos, según la familia (con los números de la instancia: suben con el nivel).
  const HITS = {
    projectile: m => (m.count || 1) * (1 + 0.2 * (m.pierce || 0)),
    homing: m => m.count || 1,
    bounce: m => (m.count || 1) * (1 + 0.45 * (m.bounce || 0)),
    cone: m => (m.count || 2) * 0.5 * (1 + 0.2 * (m.pierce || 0)),
    boomerang: m => (m.count || 1) * 1.4,
    nova: m => (m.count || 3) * 0.3 * (1 + 0.2 * (m.pierce || 0)),
    beam: () => 1.8, charge: () => 1.8, dash: () => 1.3, shove: () => 2, aura: () => 2, stun: () => 1.8,
    chain: m => { let s = 0, k = 1; for (let i = 0; i < (m.count || 1); i++) { s += k; k *= 0.85; } return s * 0.6; },
    melee: m => 1 + 0.5 * Math.min(m.arc || 1.5, 6.2832) / Math.PI,
    spin: m => (m.count || 1) * 0.9,
    orbit: m => (m.count || 1) * 0.22,
    mine: m => (m.count || 1) * 0.9,
    meteor: m => (m.count || 1) * 0.75,
    quake: m => (m.count || 1) * 0.3,
    vortex: m => (m.dur || 2.6) / 0.4 * 1.1,
    trail: m => (m.dur || 3) / 0.5 * 0.15
  };
  // Lo que rinde cada familia con AUTO, que rodea a la horda a distancia: las de cerca pegan menos
  // y la embestida le lanza contra ellos. (Las que no salen aquí, enteras.)
  const KIND_FIT = { melee: 0.7, spin: 0.75, shove: 0.75, aura: 0.75, orbit: 0.75, dash: 0.6, trail: 0.85, mine: 0.8, cone: 0.9, turret: 0.9, charge: 0.9 };
  const AREA = new Set(['nova', 'aura', 'orbit', 'spin', 'shove', 'quake', 'meteor', 'mine', 'vortex', 'trail', 'stun']);
  const REROLL_BELOW = 6;        // si ninguna carta llega a esto, se cambian (si quedan cambios)
  // Que otro ataque pase a ser el principal sólo cuenta si lo pasa de verdad: cambiar deja a medias
  // lo invertido en el de ahora (y su evolución).
  const COMMIT = 0.15;
  const FILL = 8;                // lo que vale llenar un hueco libre (ver cardScore)

  /**
   * Daño por segundo que se espera de un ataque (m: instancia de G.Moves) con
   * este Pokémon (mon: entrada de G.DEX, con types, pa, sa). Pura. Las mejoras
   * (buff) no pegan: 0.
   */
  function movePower(m, mon) {
    if (!m || m.kind === 'buff' || !m.dmg) return 0;
    const cd = Math.max(0.05, m.cd || 1);
    // La torreta dispara sola cada `rate` s mientras dura (una a la vez por cada `count`).
    const dps = m.kind === 'turret' ? m.dmg * 0.9 / Math.max(0.1, m.rate || 0.6) * (m.count || 1) * Math.min(1, (m.dur || 6) / cd)
              : m.dmg * (HITS[m.kind] ? HITS[m.kind](m) : 1) / cd;
    const top = mon ? mon.atk || Math.max(mon.pa || 0, mon.sa || 0) : 0;
    const fit = mon && m.cat && mon.pa != null && top ? (m.cat === 'special' ? mon.sa : mon.pa) / top : 1;
    const mono = mon && mon.types && mon.types.length === 1 && mon.types[0] === m.type ? 1.2 : 1;    // (Player.MONO_K)
    return dps * fit * mono * (KIND_FIT[m.kind] ?? 1);
  }

  /**
   * Lo fuerte que es un hueco (sus ataques se lanzan a la vez). Pura. Las danzas
   * del mismo grupo suben los de su lado (físico o especial) y uno de zona con
   * uno de un blanco se complementan.
   */
  function groupPower(g, mon) {
    let p = 0, phys = 0, spec = 0;
    for (const m of g) {
      const v = movePower(m, mon);
      p += v;
      if (m.cat === 'physical') phys += v; else if (m.cat === 'special') spec += v;
    }
    for (const m of g) {
      if (m.kind !== 'buff') continue;
      const k = (m.amount || 0) * (m.stacks || 1) * 0.7;
      p += m.stat === 'patk' ? phys * k : m.stat === 'satk' ? spec * k : m.stat === 'atk' ? (phys + spec) * k : 0;
    }
    if (g.some(m => AREA.has(m.kind)) && g.some(m => m.cat && !AREA.has(m.kind))) p *= 1.08;
    return p;
  }

  /**
   * El hueco que conviene tener activo (sólo se lanza ése): el más fuerte
   * (groupPower). Pura: slots es pl.slots, cur el hueco activo y mon tu
   * Pokémon. Para cambiar, el otro tiene que ser algo más fuerte (no se cambia
   * por un empate ni casi).
   */
  function bestSlot(slots, cur, mon) {
    const pc = slots[cur] ? groupPower(slots[cur], mon) : -1;
    let best = cur, bp = pc;
    slots.forEach((g, i) => { const p = groupPower(g, mon); if (p > bp + 1e-9) { bp = p; best = i; } });
    return best !== cur && bp < pc * 1.08 ? cur : best;
  }

  /** Lo que mira cardScore (aparte, para que cardScore sea pura): lo que sube cada carta de movimiento y la partida. */
  function cardInfo(pl, list) {
    const mon = pl.mon, band = pl.hasItem('choiceband');
    const pow = g => groupPower(g, mon);
    // Lo fuerte que es lo mejor que se puede lanzar (con la Cinta Elección, sólo lo que llevas).
    const top = slots => (band ? pow(slots[pl.active] || []) : slots.reduce((a, g) => Math.max(a, pow(g)), 0));
    const base = Math.max(1e-6, top(pl.slots)), main = pl.activeGroup();
    // Vínculos: tenerlos (o, en grupo, que alguien entre en una grieta) hace que valgan los demás ataques.
    const bondP = pl.bonds > 0 ? 1 : G.Coop.active ? 0.25 : 0.05;
    const swap = (m, next) => pl.slots.map(g => (g.includes(m) ? g.map(x => (x === m ? next : x)) : g));
    const gain = {};
    for (const c of list) {
      const id = c.key.slice(c.key.indexOf(':') + 1);
      let now = 0, later = 0;
      if (c.type === 'up' || c.type === 'evo') {
        const m = pl.moves.find(x => x.id === id);
        if (!m) continue;
        const next = G.Moves.instance(id, c.type === 'up' ? m.lvl + 1 : m.lvl);
        if (c.type === 'evo' || m.evolved) G.Moves.evolve(next);
        now = top(swap(m, next)) / base - 1;
        // Subir el principal acerca su evolución (casi el doble de daño); otro, sólo con un vínculo
        // (o si con esto pasa claramente al principal).
        if (main.includes(m)) later = c.type === 'up' ? (G.Moves.EVO[id] ? 0.12 : 0.04) : 0;
        else { now = Math.max(0, now - COMMIT); later = bondP * (pow([...main, next]) - pow([...main, m])) / base; }
      } else if (c.type === 'new') {
        if (!G.Moves.BY_ID[id]) continue;
        const next = G.Moves.instance(id, 1);
        now = pl.slots.length < pl.maxMoves ? Math.max(0, top([...pl.slots, [next]]) / base - 1 - COMMIT) : 0;
        later = bondP * (pow([...main, next]) - pow(main)) / base;
      }
      gain[c.key] = { now, later };
    }
    // La mejora que pide la evolución de cada movimiento: la del principal ya al máximo vale casi la
    // evolución; antes, un poco (cogerla cuando sale, sin dejar por ella una mejora del principal).
    const need = {};
    for (const m of pl.moves) {
      const e = G.Moves.EVO[m.id];
      if (!e || m.evolved || (pl.statsTaken[e[1]] || 0) > 0) continue;
      const w = !main.includes(m) ? 0.02 : m.lvl >= m.def.maxLvl ? 0.8 : 0.15 * m.lvl / m.def.maxLvl;
      need[e[1]] = Math.max(need[e[1]] || 0, w);
    }
    return { hp: pl.hp / pl.maxHp, hurt: hurtAcc, maxHp: pl.maxHp, reduce: pl.dmgReduce, vest: pl._vest || 0, time: G.Game.st.time,
             free: pl.maxMoves - pl.slots.length, gain, need };
  }

  /** Cuánto pesa aguantar frente a pegar: más con poca vida o si te han dado mucho hace poco (hurt: vida perdida en ~20 s). */
  const defWeight = s => 0.3 + 1.4 * (1 - clamp(s.hp, 0, 1)) + 1.2 * Math.min(1, s.hurt || 0);

  /**
   * Puntos de una carta de nivel (más = mejor; 100 = un hueco principal el
   * doble de fuerte). Pura. Movimientos (nuevo, mejora, evolución): lo que sube
   * el mejor hueco ahora y luego (s.gain, de cardInfo); llenar un hueco libre
   * también vale (FILL): con huecos libres, la mayoría de las cartas que salen
   * son movimientos nuevos; con los huecos llenos salen más mejoras del
   * principal y de stats. Mejoras: daño
   * (Potencia, Reflejos) o aguante (Vigor, Coraza, Síntesis, Baya Zidra, que
   * pesa más con poca vida: defWeight), sin pasar de los topes (Coraza: 70 %),
   * y la que pide la evolución de un movimiento (s.need).
   */
  function cardScore(c, s) {
    const id = c.key.slice(c.key.indexOf(':') + 1);
    if (c.type !== 'stat') {
      const g = (s.gain || {})[c.key] || { now: 0, later: 0 };
      return 100 * (g.now + g.later) + (c.type === 'new' && s.free > 0 ? FILL : 0) + (c.type === 'evo' ? 5 : 0);
    }
    const hp = clamp(s.hp, 0, 1), early = clamp(1 - (s.time || 0) / 360, 0.2, 1);
    let off = 0, def = 0;
    switch (id) {
      case 'atk': off = 0.1; break;
      case 'cd': off = 1 / 0.92 - 1; break;
      case 'spd': off = 0.01; def = 0.07; break;                    // rodear mejor y llegar antes a lo del suelo
      case 'def': {
        // Coraza: +6 % hasta el 70 % (más lo del Chaleco Asalto); vale más cuanta más llevas.
        const cap = 0.7 + (s.vest || 0), r = Math.min(s.reduce || 0, cap), r2 = Math.min(cap, r + 0.06);
        def = (1 - r) / (1 - r2) - 1;
        break;
      }
      case 'hp': def = 20 / s.maxHp + Math.min(20, (1 - hp) * s.maxHp) / s.maxHp * 0.5; break;
      case 'rgn': def = 0.9 * 20 / s.maxHp; break;
      case 'mag': off = 0.025; break;
      case 'xp': off = 0.06 * early; break;                         // al principio, más niveles; luego, poco
      case 'heal': def = Math.min(0.45, 1 - hp) * 1.5; break;
    }
    return 100 * (off + defWeight(s) * def) + 100 * ((s.need || {})[id] || 0);
  }

  /** La mejor carta de la lista (su índice). */
  function pickCard(list, s) {
    let best = 0, bs = -Infinity;
    list.forEach((c, i) => { const p = cardScore(c, s); if (p > bs) { bs = p; best = i; } });
    return best;
  }

  /** Lo que mira itemValue: la partida y lo que se lanza. */
  function itemInfo(pl) {
    const g = pl.activeGroup();
    let casts = 0;
    for (const m of g) if (m.kind !== 'buff' && m.kind !== 'trail' && m.kind !== 'orbit') casts += 1 / Math.max(0.12, m.cd * pl.cdMul);
    const pows = pl.slots.map(x => groupPower(x, pl.mon)).sort((a, b) => b - a);
    // (Sin el regenerar de los Restos: si se cambian, se pierde.)
    return { hp: pl.hp / pl.maxHp, hurt: hurtAcc, maxHp: pl.maxHp, time: G.Game.st.time, casts, regen: pl.regen - (pl.item === 'leftovers' ? pl._itemRegen || 0 : 0),
             dealt, reduce: pl.dmgReduce - (pl._vest || 0), close: g.some(m => KIND_FIT[m.kind] < 0.8),
             oneSlot: pows.length < 2 || pows[0] >= pows[1] * 1.3 };
  }

  /**
   * Lo que vale llevar un objeto (más = mejor; como cardScore). Pura. Cinta
   * Elección: bien si se juega con un solo hueco (no deja cambiar). Vidasfera:
   * cada ataque con enemigos cerca cuesta un 1 % de la vida, así que sólo si la
   * regeneración lo cubre. Huevo Suerte: al principio. s: de itemInfo.
   */
  function itemValue(id, s) {
    const defW = defWeight(s), early = clamp(1 - (s.time || 0) / 360, 0.2, 1);
    switch (id) {
      case 'leftovers': return 100 * defW * 0.015 * 20;
      case 'choiceband': return 40 * (s.oneSlot ? 1 : 0.4);
      case 'quickclaw': return 100 * (1 / 0.8 - 1);
      case 'focussash': return 100 * defW * 0.25;
      case 'shellbell': return 100 * defW * Math.min(4, (s.dealt || 0) * 0.04) * 20 / s.maxHp;
      case 'amuletcoin': return 6;                                  // más monedas al acabar (en la partida, nada)
      case 'luckyegg': return 30 * early;
      case 'lifeorb': {
        const net = Math.max(0, (s.casts || 0) * 0.01 - (s.regen || 0) / s.maxHp);
        return 30 - 100 * Math.max(0.6, defW) * Math.min(1, net / 0.02);
      }
      case 'choicescarf': return 100 * defW * 0.2 + 3;
      case 'rockyhelmet': return s.close ? 12 : 6;
      case 'assaultvest': { const r = Math.min(0.8, s.reduce || 0), r2 = Math.min(0.8, r + 0.2); return 100 * defW * ((1 - r) / (1 - r2) - 1); }
    }
    return 0;
  }

  /** Objeto: con cuál te quedas (null = ninguno). El que más vale (itemValue); para cambiar, claramente mejor. */
  function itemKeep(cur, next, s) {
    const vn = itemValue(next, s);
    if (cur) return vn > itemValue(cur, s) + 4 ? next : cur;
    return vn > 0 ? next : null;
  }

  /**
   * Vínculo: el movimiento suelto que más sube el grupo que se va a lanzar
   * (groupPower: su lado, el monotipo, danzas, zona + un blanco). Pura.
   * opt: pl.bondOptions() ('add': uno al grupo; 'pair': dos sueltos, en dos
   * pasos, first = el primero ya elegido). → índice en list.
   */
  function bondPick(list, opt, first, mon) {
    const pow = g => groupPower(g, mon);
    let best = 0, bs = -Infinity;
    list.forEach((m, i) => {
      const v = opt.mode === 'add' ? pow([...opt.group, m]) : first ? pow([first, m])
              : list.reduce((a, x) => (x === m ? a : Math.max(a, pow([m, x]))), 0);    // la mejor pareja con él
      if (v > bs + 1e-9) { bs = v; best = i; }
    });
    return best;
  }

  const plain = s => String(s || '').replace(/<[^>]*>/g, '').trim();

  /** El nombre de lo elegido en un aviso, para que se vea qué ha hecho. */
  function cardText(c) {
    const t = plain(c.title);
    return c.type === 'evo' ? 'AUTO evoluciona ' + t : c.type === 'new' ? 'AUTO aprende ' + t
         : c.type === 'up' ? 'AUTO mejora ' + t : 'AUTO elige ' + t;
  }

  /** Cada fotograma (también con el juego parado por las cartas): elige lo que haya abierto. */
  function frame(dt) {
    const p = on() && inRun() && G.RunUI.pending ? G.RunUI.pending() : null;
    if (!p || G.SettingsUI.isOpen) { choice.key = null; return; }
    const key = p.kind === 'item' ? p.cur + '>' + p.next : p.list;
    if (key !== choice.key) { choice.key = key; choice.t = 0; return; }
    // El 2.º paso del vínculo, algo antes (ya se ha visto el primero).
    if ((choice.t += Math.min(dt, 0.1)) < (p.kind === 'bond' && p.first ? 0.45 : CHOICE_S)) return;
    choice.key = null;
    const pl = G.Game.player;
    // ¿Se ha elegido de verdad? (Si las cartas aún no se podían pulsar, sigue abierto: se vuelve a intentar.)
    const done = () => { const q = G.RunUI.pending(); return !q || (q.kind === 'item' ? q.cur + '>' + q.next : q.list) !== key; };
    if (p.kind === 'level') {
      const s = cardInfo(pl, p.list), i = pickCard(p.list, s), c = p.list[i];
      // Ninguna vale la pena (y quedan cambios): se cambian las cartas. (En grupo, no: se eligen a la vez.)
      if (!G.Coop.active && cardScore(c, s) < REROLL_BELOW && G.RunUI.rerollsLeft() > 0) {
        G.RunUI.reroll();
        if (done()) G.UI.toast('AUTO cambia las cartas', 1800);
        return;
      }
      G.RunUI.pick(i);
      if (!done()) return;
      G.UI.toast(cardText(c), 2200);
      // Con la carta ya puesta: si otro ataque ha quedado más fuerte que el activo, se pasa a él
      // (con la Cinta Elección no se puede cambiar).
      const k = bestSlot(pl.slots, pl.active, pl.mon);
      if (k !== pl.active && !pl.hasItem('choiceband')) pl.setActive(k, pl.dead);
    } else if (p.kind === 'item') {
      const keep = itemKeep(p.cur, p.next, itemInfo(pl));
      const nm = id => G.Items.BY[id] ? G.Items.BY[id].name : '';
      G.RunUI.chooseItem(keep);
      if (!done()) return;
      G.UI.toast(keep && keep === p.cur ? 'AUTO se queda con ' + nm(p.cur) : keep ? 'AUTO se pone ' + nm(keep) : 'AUTO no se pone ' + nm(p.next), 2400);
    } else if (p.kind === 'bond') {
      const i = bondPick(p.list, p.opt, p.first, pl.mon), m = p.list[i];
      const group = p.opt.mode === 'add' ? [...p.opt.group, m] : p.first ? [p.first, m] : null;
      G.RunUI.pickBond(i);
      if (group && done()) G.UI.toast('AUTO une ' + group.map(x => G.T(x.name, 'move')).join(' + '), 2400);
    }
  }

  return {
    reset, axis, frame, toggle, setOn,
    /** ¿Está encendido? (se recuerda en este aparato). */
    get on() { return on(); },
    /** ¿Se ha encendido en esta partida? (no va al ranking) */
    get used() { return used; },
    /** Anfitrión: ¿lo ha encendido algún compañero en esta partida? */
    get mateUsed() { return mateUsed; },
    /** Mandas tú: 0..1 de lo que falta para que AUTO vuelva (0 = manda AUTO). */
    get manual() { return on() ? clamp(1 - (performance.now() - manualAt) / (MANUAL_S * 1000), 0, 1) : 0; },
    /** player.js: a qué apuntar (un cofre que es el objetivo), o null. game.js: la marca del objetivo. */
    aimAt, drawMark,
    /** Para las pruebas (tests/auto.test.cjs) y para depurar. */
    score, cardScore, cardInfo, pickCard, bestSlot, movePower, groupPower, itemValue, itemKeep, bondPick, pickObjective, breakSpot, exploreDir,
    DIRS, MANUAL_S, CHOICE_S, STICK, REROLL_BELOW,
    get debug() {
      return { want, mag, hx, hy, side, stuck: stuck.count, goals: goals.length, stays: stays.length,
               obj: obj ? { kind: obj.kind, id: obj.id, x: obj.x, y: obj.y, inT: obj.inT, hold: holding() } : null, bans: ban.size, seen: seen.size };
    },
    /** Para depurar: lo que ve y puntúa ahora mismo (puntos y peligro de cada dirección). */
    inspect() {
      const pl = G.Game.player;
      if (!pl) return null;
      const c = context(pl), r = score(c);
      return { s: [...r.s], danger: [...r.danger], foes: c.foes.length, goals: c.goals.length, crowd: c.crowd, shots: c.shots.length, zones: c.zones.length, hp: c.hp };
    }
  };
})();
