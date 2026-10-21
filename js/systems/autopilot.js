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
 *             objetos; cofres que romper, altares y cofres con candado (se
 *             queda al lado hasta que se abre); en grupo, un compañero caído
 *             (se queda a su lado para levantarlo, si no es muy peligroso) y no
 *             alejarse del grupo; si no hay nadie a tiro, acercarse a pelear
 * Se rodea a la horda de lado (en círculos) en vez de huir en línea recta y,
 * al verse rodeado, se sale por el hueco más grande, lejos de rincones y
 * pasillos. Se prefiere seguir la dirección de antes y el giro se suaviza (sin
 * tirones); sin prisa, anda despacio (la horda no se queda atrás). Si lleva un
 * rato sin avanzar (atascado), prueba otra dirección.
 * En la Sentencia de Arceus sólo huye; en la arena de una grieta, sólo aguanta.
 *
 * Elecciones (con el juego parado, a los CHOICE_S s para que se vea qué elige, y
 * con un aviso que lo dice): cartas de nivel (cardScore), objetos (itemKeep) y
 * vínculos (bondBest), con las mismas funciones que el ratón (en grupo, las
 * cartas se resuelven igual que siempre). Sólo se lanza el ataque activo: tras
 * cada carta AUTO pasa al más fuerte (bestSlot).
 * Coste: los enemigos salen de la rejilla (EnemyMgr.queryCircle) y como mucho
 * se miran los NEAR_MAX más cercanos; lo del suelo y del mapa, cada SCAN s.
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
  // Objetos con pega: si no llevas nada, AUTO no se los pone (data/items.js).
  const DRAWBACK = new Set(['lifeorb', 'choiceband']);
  const TRAP_V = [5, 2.5, 8];     // trampas (interact.js): veneno, pegajosa, explosiva
  // Ataques que hay que lanzar de cerca: con ellos se arrima más a los enemigos.
  const CLOSE = new Set(['melee', 'nova', 'aura', 'orbit', 'spin', 'shove', 'trail', 'dash']);
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
    if (!netOn && G.Net) { netOn = true; G.Net.on(onNet); }
    if (on()) markUsed();
  }

  // ---------------- movimiento ----------------

  /**
   * Lo que mueve a tu Pokémon (Player.update lo usa en vez de G.Input.axis):
   * lo tuyo si te mueves; si no, con AUTO encendido, lo que decide aquí.
   */
  function axis(pl, dt) {
    const man = G.Input.axis();
    const now = performance.now();
    if (man[0] || man[1]) { manualAt = now; mag = 0; hx = man[0]; hy = man[1]; return man; }
    if (!on() || now - manualAt < MANUAL_S * 1000) { mag = 0; return man; }
    steer(pl, dt);
    return [hx * mag, hy * mag];
  }

  function steer(pl, dt) {
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
      if (++s.n >= 2) { s.n = 0; s.avoid = Math.atan2(hy, hx); s.avoidT = 0.9; side = -side; s.count++; }
    } else s.n = 0;
  }

  /** Qué hay alrededor y adónde ir (cada STEP s). */
  function decide(pl) {
    const c = context(pl), r = score(c);
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
    const speed = stuck.avoidT > 0 ? 1 : clamp(0.45 + urgency * 2 + r.pull[best] * 1.5, 0.45, 1);
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
      engage = { x: nearest.x, y: nearest.y, v: 0.9 * light * Math.min(1, (nd - reach) / 160 + 0.3), near: 0 };
    }
    // Con poca vida, lo que no cura (ni es volver con el grupo) atrae menos.
    const gk = 0.4 + 0.6 * hp;
    const gs = goals.map(g => (g.vital ? g : Object.assign({}, g, { v: g.v * gk })));
    if (engage) gs.push(engage);
    return {
      // (spd: en tierra firme; si ahora vas por el agua, sin lo que frena.)
      x: pl.x, y: pl.y, r: pl.r, mag: pl.magnet, spd: pl.spd / (pl.inLiquid ? G.World.liquidEffect(pl.mon.types).slow || 1 : 1), hp, hx: hx * mag, hy: hy * mag, side, close,
      crowd: { x: cx, y: cy }, gap: nearest ? nd : null, ring, foes, shots, zones, goals: judge ? [] : gs, stays: judge ? [] : stays, avoid: avoids,
      wall: terrainCost(pl), slow: slowAt(pl)
    };
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

  /** Lo que atrae y lo que hay que evitar alrededor (cada SCAN s: objetos del suelo, del mapa, compañeros). */
  function scan(pl) {
    const hp = pl.hp / pl.maxHp, gs = [], st = [], av = [];
    const dist = (x, y) => Math.hypot(x - pl.x, y - pl.y);
    if (!G.Judgment.active) {
      for (const p of G.Pickups.all()) {
        // Lo que ya vuela hacia ti (imán) llega solo.
        if (p.pulled || Math.abs(p.x - pl.x) > PICK_R || Math.abs(p.y - pl.y) > PICK_R) continue;
        const v = pickValue(p, pl, hp);
        if (v > 0) gs.push({ x: p.x, y: p.y, v, vital: p.kind === 'heal', near: 0, pick: true });
      }
      // Cofres que romper: tus ataques les apuntan cuando no hay enemigos cerca. Basta acercarse.
      for (const p of G.World.propsInCircle(pl.x, pl.y, 380)) {
        if (p.type === 'chest') gs.push({ x: p.x, y: p.y, v: 1.6, near: 110 });
        else if (p.type === 'rock') gs.push({ x: p.x, y: p.y, v: 0.2, near: 110 });
      }
      for (const p of G.World.specialsNear(pl.x, pl.y, 420)) {
        if (p.type === 'bigchest') st.push({ x: p.x, y: p.y, r: Math.max(46, p.r + pl.r + 24) - 12, v: 2.2 });
        else if (p.type === 'altar' && !p.used) gs.push({ x: p.x, y: p.y, v: 1.8, near: 0 });
        else if (p.type === 'spring' && p.charge > 0.2 && hp < 0.7) st.push({ x: p.x, y: p.y - 8, r: 18, v: (1 - hp) * 4 });
      }
      // Duendes del tesoro (Meowth, Gholdengo): no pegan, sueltan monedas.
      for (const e of G.EnemyMgr.all()) if (e.behavior === 'thief' && !e.dead && dist(e.x, e.y) < 500) gs.push({ x: e.x, y: e.y, v: 1.4, near: 0 });
    }
    // Trampas: no pisarlas (saltan al pisarlas).
    for (const p of G.World.specialsNear(pl.x, pl.y, 160)) if (p.type === 'trap') av.push({ x: p.x, y: p.y - 8, r: 24, v: TRAP_V[p.kind] || 5 });
    // La grieta: nunca entrar sola (eso lo decide el jugador).
    const rf = G.Rift.rift;
    if (rf && !G.Rift.inArena) av.push({ x: rf.x, y: rf.y - 10, r: 64, v: 40 });
    // Cooperativo: levantar a un compañero caído (si no es muy peligroso) y no alejarse del grupo.
    if (G.Coop.active && !G.Judgment.active) {
      let mate = null, md = Infinity;
      for (const o of G.Coop.puppets()) {
        const d = dist(o.x, o.y);
        if (o.dead) {
          const crowd = G.EnemyMgr.queryCircle(o.x, o.y, 130).filter(e => !e.dead && e.behavior !== 'thief');
          const risky = hp < 0.25 || crowd.length > 5 || crowd.some(e => e.boss);
          if (!risky && d < 1400) st.push({ x: o.x, y: o.y, r: 34, v: 3.2 });
        } else if (d < md) { md = d; mate = o; }
      }
      if (mate && md > 380) gs.push({ x: mate.x, y: mate.y, v: Math.min(3, (md - 380) / 200 + 0.5), vital: true, near: 0 });
    }
    // Los que más atraen (cerca y valiosos), como mucho 40.
    if (gs.length > 40) {
      const k = g => g.v / (1 + dist(g.x, g.y) / 140);
      gs.sort((a, b) => k(b) - k(a)).length = 40;
    }
    goals = gs; stays = st; avoids = av;
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
   *         wall(x, y) → coste del terreno (100 = no se pasa), slow(x, y)? → lo que frena (1 = nada) }
   */
  function score(c) {
    const s = new Float64Array(DIRS + 1), danger = new Float64Array(DIRS + 1), pull = new Float64Array(DIRS + 1);
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
        // Lo que hay en una dirección peligrosa atrae menos (no meterse en la horda por una gema).
        v = Math.min(4, v) / (1 + 0.3 * d);
        pull[k] = v;
        v += 0.6 * cm * Math.max(0, fx * ux + fy * uy);
        v += 0.7 * (c.hx * ux + c.hy * uy);       // seguir por donde iba
      } else v = stayV - 0.4;                       // quedarse quieto, sólo si hay algo que hacer aquí
      s[k] = v - d * hpK;
    }
    return { s, danger, pull };
  }

  // ---------------- elecciones (cartas, objetos, vínculos) ----------------

  /** Lo que mira cardScore de tu Pokémon (aparte, para que cardScore sea pura). */
  function cardInfo(pl, list) {
    const act = new Set(pl.activeGroup().map(m => m.id));
    const moves = {}, kinds = {}, weak = {}, evoStat = new Map();
    for (const m of pl.moves) {
      moves[m.id] = { lvl: m.lvl, kind: m.kind, active: act.has(m.id) };
      const ev = G.Moves.evoInfo(m, pl.statsTaken);
      if (ev && !ev.ready) evoStat.set(ev.needs, evoStat.get(ev.needs) || act.has(m.id));
    }
    for (const c of list) {
      if (c.type !== 'new') continue;
      const id = c.key.slice(4), d = G.Moves.BY_ID[id];
      if (!d) continue;
      kinds[id] = d.kind;
      weak[id] = !!d.cat && G.Stats.fit(pl.mon, d.cat) < 0.95;
    }
    // Lo fuerte que es el hueco activo (como en bestSlot): mejorar otro que lo pase lo hace el activo.
    const top = slotPow(pl.activeGroup());
    return { hp: pl.hp / pl.maxHp, free: pl.maxMoves - pl.slots.length, moves, kinds, weak, evoStat, top };
  }

  // Cartas de mejora: las de ataque y recarga primero; con poca vida, vida y defensa.
  const STAT_PTS = { atk: 150, cd: 145, def: 125, hp: 120, spd: 115, rgn: 110, mag: 105, xp: 100, heal: 40 };

  /**
   * Puntos de una carta de nivel (más = mejor). Pura. Orden: evolución >
   * mejorar el ataque activo (o el que con la mejora lo pasa) > la mejora que le
   * falta a un movimiento para evolucionar > Potencia y Reflejos > movimiento
   * nuevo (si hay hueco) > mejorar otro que ya tienes > las demás cartas de
   * mejora (con poca vida, antes Vigor, Coraza y Síntesis, y casi KO, la Baya
   * Zidra). Sólo se lanza el ataque activo: uno nuevo, o mejorar otro, no pega
   * más hasta que se elige (AUTO pasa al más fuerte tras cada carta, ver
   * bestSlot) o se une con un vínculo; con lo que pega ya se aguanta más.
   */
  function cardScore(c, s) {
    const id = c.key.slice(c.key.indexOf(':') + 1);
    if (c.type === 'evo') return 1000;
    if (c.type === 'new') return s.free > 0 ? 142 - (s.kinds[id] === 'buff' ? 30 : 0) - (s.weak[id] ? 10 : 0) : 0;   // (después de Potencia y Reflejos)
    if (c.type === 'up') {
      const m = s.moves[id] || {};
      if (m.active && m.kind !== 'buff') return 700 - (m.lvl || 1) * 5;
      // El que con esta mejora pasa al activo será el nuevo activo (ver bestSlot): casi igual de bueno.
      if (m.kind !== 'buff' && s.top != null && ((m.lvl || 1) + 1) * (KIND_K[m.kind] ?? 1) > s.top) return 650 - (m.lvl || 1) * 5;
      // Mejorar otro que se queda sin lanzar no pega más (salvo con un vínculo): antes, más daño o menos recarga.
      return (m.kind === 'buff' ? 120 : 140) - (m.lvl || 1);
    }
    if (s.evoStat.has(id)) return s.evoStat.get(id) ? 720 : 450;
    let p = STAT_PTS[id] || 100;
    if (s.hp < 0.5 && (id === 'hp' || id === 'def' || id === 'rgn')) p += 100;
    if (id === 'heal' && s.hp < 0.4) p += 220;
    return p;
  }

  /** La mejor carta de la lista (su índice). */
  function pickCard(list, s) {
    let best = 0, bs = -Infinity;
    list.forEach((c, i) => { const p = cardScore(c, s); if (p > bs) { bs = p; best = i; } });
    return best;
  }

  // Cuánto vale cada familia para AUTO: las de cerca le obligan a meterse entre los enemigos
  // y la embestida (dash) le lanza contra ellos; las mejoras (buff) no pegan.
  const KIND_K = { buff: 0, dash: 0.5, melee: 0.8, spin: 0.8, shove: 0.8, charge: 0.8, trail: 0.8 };

  /** Lo fuerte que es un hueco: el nivel de sus ataques (un evolucionado, +3), según su familia. */
  function slotPow(g) {
    return g.reduce((a, m) => a + (m.lvl + (m.evolved ? 3 : 0)) * (KIND_K[m.kind] ?? 1), 0);
  }

  /**
   * El hueco que conviene tener activo (sólo se lanza ése): el más fuerte
   * (slotPow). Si empata con el que llevas, el que llevas. Pura: slots es
   * pl.slots y cur el hueco activo.
   */
  function bestSlot(slots, cur) {
    let best = cur, bp = slots[cur] ? slotPow(slots[cur]) : -1;
    slots.forEach((g, i) => { const p = slotPow(g); if (p > bp + 1e-9) { bp = p; best = i; } });
    return best;
  }

  /** Objeto: con cuál te quedas (null = ninguno). Si llevas uno, ése; si no, el nuevo salvo que tenga pega. */
  function itemKeep(cur, next) {
    if (cur) return cur;
    return DRAWBACK.has(next) ? null : next;
  }

  /** Vínculo: el movimiento suelto que mejor va (el de más nivel; mejor uno de ataque que una mejora). */
  function bondBest(list) {
    let best = 0, bs = -Infinity;
    list.forEach((m, i) => { const p = m.lvl * 10 + (m.evolved ? 30 : 0) + (m.kind === 'buff' ? 0 : 5); if (p > bs) { bs = p; best = i; } });
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
      const i = pickCard(p.list, cardInfo(pl, p.list)), c = p.list[i];
      G.RunUI.pick(i);
      if (!done()) return;
      G.UI.toast(cardText(c), 2200);
      // Con la carta ya puesta: si otro ataque ha quedado más fuerte que el activo, se pasa a él
      // (con la Cinta Elección no se puede cambiar).
      const k = bestSlot(pl.slots, pl.active);
      if (k !== pl.active && !pl.hasItem('choiceband')) pl.setActive(k, pl.dead);
    } else if (p.kind === 'item') {
      const keep = itemKeep(p.cur, p.next);
      const nm = id => G.Items.BY[id] ? G.Items.BY[id].name : '';
      G.RunUI.chooseItem(keep);
      if (!done()) return;
      G.UI.toast(keep && keep === p.cur ? 'AUTO se queda con ' + nm(p.cur) : keep ? 'AUTO se pone ' + nm(keep) : 'AUTO no se pone ' + nm(p.next), 2400);
    } else if (p.kind === 'bond') {
      const i = bondBest(p.list), m = p.list[i];
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
    /** Para las pruebas (tests/auto.test.cjs) y para depurar. */
    score, cardScore, pickCard, bestSlot, itemKeep, bondBest, DIRS, MANUAL_S, CHOICE_S,
    get debug() { return { want, mag, hx, hy, side, stuck: stuck.count, goals: goals.length, stays: stays.length }; },
    /** Para depurar: lo que ve y puntúa ahora mismo (puntos y peligro de cada dirección). */
    inspect() {
      const pl = G.Game.player;
      if (!pl) return null;
      const c = context(pl), r = score(c);
      return { s: [...r.s], danger: [...r.danger], foes: c.foes.length, goals: c.goals.length, crowd: c.crowd, shots: c.shots.length, zones: c.zones.length, hp: c.hp };
    }
  };
})();
