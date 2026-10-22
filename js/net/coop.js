/* ============ coop.js — partida cooperativa (hasta 4 jugadores) ============
 *
 * Quién manda en qué:
 *   ANFITRIÓN   enemigos (aparición, IA, vida, muerte), objetos del suelo,
 *               experiencia y nivel del equipo, reloj, fin de la partida.
 *   CADA UNO    su propio Pokémon: posición, vida, ataques y lo que le golpea.
 *               Sus golpes a enemigos se mandan al anfitrión, que los aplica.
 *
 * Los invitados ven COPIAS de los enemigos del anfitrión (enemy.remote) y los
 * ataques de los compañeros como "fantasmas" que no hacen daño (ver combat.js).
 *
 * Quién está eligiendo (objeto o vínculo) y quién ha elegido carta de nivel va
 * además en CADA envío (no sólo en un aviso suelto): si un aviso se pierde
 * porque la conexión parpadea, el siguiente envío lo arregla y nadie se queda
 * esperando a otro para siempre (pasaba en 2026-10).
 *
 * Mensajes (por net.js, unas 15 veces por segundo; 5 si va por el relé):
 *   invitado -> anfitrión  { k:'f', p:[estado], ev:[eventos],
 *                            sp:[x,y] (caído mirando a un compañero: dónde está su cámara) }
 *   anfitrión -> invitado  { k:'f', t, lv, xp, xn, ki, bo, co, p:{uid:[estado]},
 *                            e:[[id,x,y,vida,anim,dir,estados]], ev:[eventos],
 *                            ja:[x,y,anim,dir] (Arceus, sólo en la Sentencia) }
 *   anfitrión -> todos     { k:'start', seed, host, members:[{uid,name,dex,shiny}] }
 * Las claves y los avisos que no se conocen se ignoran: versiones distintas
 * del juego pueden jugar juntas.
 *
 * Quien se va: el anfitrión avisa a todos ('gone'). Antes sólo lo sabía él y
 * los demás invitados seguían viendo a ese compañero quieto para siempre (y
 * hasta los levantaba). Por si el aviso se pierde, un compañero que el
 * anfitrión deja de mandar también se da por ido. Y quien no manda nada en
 * los primeros FIRST_MS no ha llegado a entrar: se le quita (si no, las cartas
 * de nivel le esperaban para siempre). Al que sí ha mandado algo no se le
 * quita nunca por callar (pestaña en segundo plano): sólo si se cierra la conexión.
 *
 * Cortes (22-10-2026): antes, en cuanto se cerraba el canal, el compañero salía
 * de la partida (y el canal se cerraba solo cuando la red no daba abasto: ver
 * net.js). Ahora se le espera RECONNECT_MS mientras net.js le vuelve a llamar;
 * al invitado cortado se le para la partida (como cuando el anfitrión se va de
 * la pestaña) y el anfitrión le guarda lo que no le ha llegado. Lo que sólo se
 * ve un momento (TRANSIENT) no se guarda. Si con la conexión atascada no se
 * puede mandar, se espera: los avisos no se pierden (sendTo). Y por si alguno
 * se pierde igual, el invitado pide los enemigos que no conoce ('rq') y quita
 * las copias que el anfitrión ya no tiene (GHOST_FRAMES).
 */
G.Coop = (() => {
  const ANIMS = ['Idle', 'Walk', 'Attack', 'Shoot', 'Charge', 'Hurt', 'Faint'];
  const COLORS = ['#ffcb3d', '#5fc8ff', '#7ee07a', '#ff8ad8'];
  // Mensajes por segundo: 15 por la conexión directa y 3 por el relé de la
  // Realtime Database (apagado: 1 $ el GB).
  const RATE_FAST = 1 / 15, RATE_SLOW = 1 / 3;
  const rateFor = u => (G.Net.slow(u) ? RATE_SLOW : RATE_FAST);
  const NEAR = 950;                     // radio de enemigos que se mandan a cada uno
  const FIRST_MS = 10000;               // anfitrión: quien no ha mandado nada en este tiempo no ha entrado
  const GONE_MS = 3000;                 // invitado: compañero que el anfitrión ya no manda = se ha ido
  const RECONNECT_MS = 20000;           // lo que se espera a quien se ha cortado (ver arriba)
  const MAX_EV = 400;                   // avisos por envío como mucho (el resto, en el siguiente)
  const MAX_Q = 6000;                   // avisos guardados para uno que no recibe: más, y se le da por ido
  // Avisos que sólo se ven un momento: a quien está cortado o atascado no se le guardan.
  const TRANSIENT = new Set(['c', 'es', 'hn', 'fxr', 'say', 'bomb', 'mag', 'hz']);
  const ASK_MS = 2000;                  // invitado: cada cuánto se puede volver a pedir el mismo enemigo
  const GHOST_FRAMES = 30, GHOST_R = 520;   // invitado: copia cercana que falta en tantos envíos seguidos = ya no existe

  let active = false, host = false, me = null, hostUid = null;
  let local = null;                     // tu Player
  let startAt = 0;                      // cuándo empezó la partida (performance.now)
  const mates = new Map();              // uid -> { uid, name, color, pl, connected, q:[], flushT, xpMul, state, sp, seenAt, lostAt (null = conectado) }
  let outEv = [];                       // invitado: eventos para el anfitrión
  let flushT = 0;
  let hitFrom = null;                   // invitado cuyo golpe se está aplicando (no repetirle el número)
  let api = {};                         // callbacks del juego (game.js)
  let waiting = new Set();              // subida de nivel: quién falta por elegir
  let holds = new Set();                // quién está eligiendo una fusión (la partida se para para todos)
  // El anfitrión mueve a los enemigos: si cambia de pestaña (o se le congela),
  // todo se para para todos. Antes los enemigos se quedaban quietos y los demás
  // seguían jugando con una ventaja enorme.
  let hostAway = false, stalled = false, lastHostAt = 0;
  let hostLostAt = null;                // invitado: cuándo se cortó el canal con el anfitrión (null = no)
  const asked = new Map();              // invitado: enemigo pedido con 'rq' -> cuándo
  // Cartas de nivel: número de la ronda (anfitrión), la última que te ha llegado
  // y la última que has elegido (invitado). Y el último "quién elige" aplicado.
  let levelSeq = 0, levelNow = 1, seenSeq = 0, doneSeq = 0, lastHo = '';
  const STALL_MS = 2500;
  let members = [];

  // ---------------- escalado de dificultad ----------------

  const scaleRate = n => 1 + 0.75 * Math.max(0, n - 1);
  const scaleHp = n => 1 + 0.3 * Math.max(0, n - 1);

  // ---------------- arranque / fin ----------------

  /**
   * @param cfg   { seed, host, members }
   * @param pl    tu Player (ya creado)
   * @param cb    { levelStart(lv), resume(), waiting(names), over(data), lost(msg), team(t), shiny(dex), specAt() }
   */
  function begin(cfg, pl, cb) {
    active = true;
    me = G.Net.uid; hostUid = cfg.host;
    host = me === hostUid;
    local = pl;
    api = cb;
    members = cfg.members;
    mates.clear();
    outEv = []; flushT = 0; waiting = new Set(); holds = new Set();
    hostAway = false; stalled = false; lastHostAt = startAt = performance.now(); hostLostAt = null; asked.clear();
    levelSeq = 0; levelNow = 1; seenSeq = 0; doneSeq = 0; lastHo = '';
    cfg.members.forEach((m, i) => {
      const x = (i - (cfg.members.length - 1) / 2) * 34, y = 0;
      if (m.uid === me) { pl.x = x; pl.y = y; pl.uid = me; pl.coopHost = host; pl.tagColor = COLORS[i]; return; }
      const mon = G.DEX_BY[m.dex] || G.DEX_BY[25];
      const p = new G.Player(mon, {}, !!m.shiny);
      p.remote = true; p.uid = m.uid; p.tag = m.name; p.tagColor = COLORS[i]; p.revLabel = 'Quédate a su lado';
      p.x = x; p.y = y;
      p.net = { x, y, ang: Math.PI / 2, walk: 0, hp: p.maxHp, maxHp: p.maxHp, dead: 0, mv: G.baseStartOf(mon.dex), ml: 1, mag: 78, aim: Math.PI / 2, rev: 0 };
      G.Sprites.preload([mon.dex], 8000, p.shiny);
      mates.set(m.uid, { uid: m.uid, name: m.name, color: COLORS[i], pl: p, connected: true, q: [], flushT: 0, xpMul: 1, lostAt: null });
    });
    // Invitado: el primer envío, ya (aunque la pestaña esté en segundo plano y
    // el bucle del juego no corra): así el anfitrión sabe que has entrado.
    if (!host) flushClient(true);
  }

  function end() {
    active = false; host = false; local = null;
    mates.clear(); outEv = []; waiting = new Set(); holds = new Set(); asked.clear(); hostLostAt = null;
  }

  /** Te vas de la partida (los demás siguen). */
  function leave() {
    if (!active) return;
    if (host) {
      // Si se va el anfitrión, la partida termina para todos.
      emit(['ov', Object.assign(api.summary ? api.summary() : {}, { why: 'host' })]);
      flushAll();
    } else {
      outEv.push(['bye']);
      flushClient(true);
    }
    end();
  }

  // ---------------- lista de jugadores ----------------

  function players() {
    const out = [local];
    for (const m of mates.values()) if (m.connected) out.push(m.pl);
    return out;
  }
  function puppets() { const out = []; for (const m of mates.values()) if (m.connected) out.push(m.pl); return out; }

  /**
   * ¿Llegan datos de este compañero? Al anfitrión, desde su primer envío; al
   * invitado, si sale en los envíos recientes del anfitrión. (Para mirarle al caer.)
   */
  function fresh(m) {
    return !!m && m.connected && (host ? !!m.state : m.seenAt != null && performance.now() - m.seenAt < GONE_MS);
  }

  /** Anfitrión: dónde mira un invitado (su Pokémon o, caído, el compañero al que mira). */
  const focusOf = m => (m.sp && m.pl.net && m.pl.net.dead ? { x: m.sp[0], y: m.sp[1] } : m.pl);

  /**
   * Multiplicador de la experiencia del equipo: la media de los bonus de
   * cada uno, y repartida entre los que sois (en grupo cae mucho más, y si no
   * se subiría de nivel el triple de rápido que en solitario).
   */
  function xpFactor() {
    let s = local.xpMul, n = 1;
    for (const m of mates.values()) if (m.connected) { s += m.xpMul || 1; n++; }
    return (s / n) / local.xpMul / (1 + 0.6 * (n - 1));
  }

  // ---------------- estado de un jugador ----------------

  const r1 = v => Math.round(v), r2 = v => Math.round(v * 100) / 100;

  function myState() {
    // Con un vínculo se manda la órbita si la hay (es lo único que los demás no ven por los 'c').
    const g = local.activeGroup();
    const m = g.find(x => x.kind === 'orbit') || g[0];
    return [r1(local.x), r1(local.y), r2(local.moveAngle), local.walking ? 1 : 0, r1(local.hp), r1(local.maxHp),
            local.dead ? 1 : 0, m ? m.id : '', m ? m.lvl : 1, r1(local.magnet), r2(local.aim), r2(local.xpMul),
            r2(local.reviveT || 0), api.choosing && api.choosing() ? 1 : 0, doneSeq];
  }

  /** Número que llega por la red: si no es un número de verdad vale `def`, y si se pasa se queda en el tope. */
  const num = (v, def, lo, hi) => typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;

  // Lo que manda otro jugador no se cree a ciegas: un xpMul de 1e309 colgaba al anfitrión al subir de nivel.
  function readState(a) {
    if (!Array.isArray(a)) a = [];
    return { x: num(a[0], 0, -1e6, 1e6), y: num(a[1], 0, -1e6, 1e6), ang: num(a[2], 0, -10, 10), walk: a[3] ? 1 : 0,
             hp: num(a[4], 0, 0, 1e6), maxHp: num(a[5], 1, 1, 1e6), dead: a[6] ? 1 : 0,
             mv: typeof a[7] === 'string' ? a[7].slice(0, 40) : '', ml: num(a[8], 1, 1, 99),
             mag: num(a[9], 0, 0, 5000), aim: num(a[10], 0, -10, 10), xpMul: num(a[11], 1, 0.1, 20),
             rev: num(a[12], 0, 0, 60), ch: a[13] === undefined ? undefined : a[13] ? 1 : 0, ld: num(a[14], 0, 0, 1e9) };
  }

  // ---------------- envío ----------------

  /** Anfitrión: evento para todos los invitados (menos `except`). */
  function emit(ev, except) {
    if (!host) return;
    for (const m of mates.values()) {
      if (!m.connected || m.uid === except) continue;
      if (m.lostAt != null && TRANSIENT.has(ev[0])) continue;
      m.q.push(ev);
    }
  }

  /** Anfitrión: ¿no le llega nada ahora (cortado o con la conexión atascada)? */
  const stuck = m => m.lostAt != null || G.Net.backlog(m.uid) > G.Net.BUF_HIGH;

  /** Anfitrión: evento sólo para los que lo ven cerca (números de daño). */
  function emitNear(ev, x, y, except) {
    for (const m of mates.values()) {
      if (!m.connected || m.uid === except) continue;
      const f = focusOf(m);
      if (G.U.dist2(f.x, f.y, x, y) > 700 * 700) continue;
      if (m.q.length > 400 || stuck(m)) continue;        // (sólo son números de daño)
      m.q.push(ev);
    }
  }

  function enemyList(near) {
    const out = [];
    const r2n = NEAR * NEAR;
    for (const e of G.EnemyMgr.all()) {
      if (e.dead || G.U.dist2(e.x, e.y, near.x, near.y) > r2n) continue;
      const a = ANIMS.indexOf(e.anim.cur);
      out.push([e.id, r1(e.x), r1(e.y), Math.ceil(e.hp), a < 0 ? 0 : a, e.anim.dir,
                (e.burn > 0 ? 1 : 0) | (e.poison > 0 ? 2 : 0) | (e.shield > 0 ? 4 : 0) | (e.slow > 0 ? 8 : 0)]);
    }
    return out;
  }

  function hostFrame(m) {
    const st = api.team();
    const p = { [me]: myState() };
    for (const o of mates.values()) {
      if (o.connected && o.uid !== m.uid && o.state) p[o.uid] = o.state;
    }
    // Como mucho MAX_EV avisos: tras un corte puede haber muchos y un envío enorme no saldría.
    const ev = m.q.length > MAX_EV ? m.q.splice(0, MAX_EV) : m.q;
    if (ev === m.q) m.q = [];
    // Enemigos alrededor de lo que ve: si está caído mirando a otro, los de allí (si no, se le quedaban quietos).
    const f = { k: 'f', t: r2(st.time), lv: st.level, xp: r2(st.xp), xn: st.xpNext, ki: st.kills, bo: st.bosses, co: st.coins, tk: [st.t1, st.t10],
                p, e: enemyList(focusOf(m)), ev };
    const ja = G.Judgment.netState();       // Arceus en la Sentencia
    if (ja) f.ja = ja;
    // Siempre: quién está eligiendo y, si hay cartas de nivel, cuáles (ver arriba).
    f.ho = holdNames();
    if (waiting.size) f.lu = [levelSeq, levelNow];
    return f;
  }

  /**
   * Anfitrión: manda su envío a `m`. Si no sale (sin canal o atascado), sus
   * avisos vuelven a la cola para el siguiente: antes se perdían.
   */
  function sendTo(m) {
    const f = hostFrame(m);
    if (G.Net.send(m.uid, f)) return true;
    m.q = f.ev.filter(ev => !TRANSIENT.has(ev[0])).concat(m.q);
    return false;
  }

  function flushAll() { for (const m of mates.values()) if (m.connected && m.lostAt == null) sendTo(m); }

  /** Invitado: el envío al anfitrión. `sp` va aparte del estado (que sigue con sus 15 datos). */
  function clientFrame() {
    const f = { k: 'f', p: myState(), ev: outEv };
    const sp = api.specAt && api.specAt();
    if (sp) f.sp = sp;
    outEv = [];
    return f;
  }

  function flushClient(force) {
    if (!force && !outEv.length && flushT > 0) return;
    const f = clientFrame();
    // No ha salido (cortado o atascado): lo que importa (golpes, cartas, elecciones) espera al siguiente.
    if (!G.Net.toHost(f)) outEv = f.ev.filter(ev => !TRANSIENT.has(ev[0])).concat(outEv);
  }

  /** Cada fotograma (también en la pantalla de subida de nivel). */
  function tick(dt) {
    if (!active) return;
    const now = performance.now();
    if (host) {
      for (const m of mates.values()) {
        if (!m.connected) continue;
        if (!m.state && now - startAt > FIRST_MS) { mateGone(m.uid, true); continue; }
        // Cortado: se le espera (net.js le vuelve a llamar) con lo que no le ha llegado guardado.
        if (m.lostAt != null) { if (now - m.lostAt > RECONNECT_MS || m.q.length > MAX_Q) mateGone(m.uid); continue; }
        m.flushT -= dt;
        if (m.flushT > 0) continue;
        // Atascado (su red no da abasto): no se le añade otra foto hasta que salga lo que espera.
        if (G.Net.backlog(m.uid) > G.Net.BUF_HIGH) { if (m.q.length > MAX_Q) mateGone(m.uid); continue; }
        m.flushT = rateFor(m.uid);
        sendTo(m);
      }
    } else {
      if (hostLostAt != null && now - hostLostAt > RECONNECT_MS) { const cb = api.lost; end(); if (cb) cb('Se ha perdido la conexión con el anfitrión.'); return; }
      if (!stalled && now - lastHostAt > STALL_MS) { stalled = true; updateAway(); }
      flushT -= dt;
      if (flushT <= 0 && hostLostAt == null && G.Net.backlog(hostUid) <= G.Net.BUF_HIGH) {
        flushT = rateFor(hostUid);
        flushClient(true);
      }
    }
  }

  // ---------------- recepción ----------------

  G.Net.on((from, msg) => {
    if (!msg) return;
    if (msg.k === 'start') { if (G.Flow.startCoop) G.Flow.startCoop(msg); return; }
    if (!active || msg.k !== 'f') return;
    if (host) onClientFrame(from, msg); else if (from === hostUid) onHostFrame(msg);
  });

  G.Net.onPeer((u, mode) => {
    if (!active) return;
    if (mode === 'direct') { back(u); return; }
    if (mode !== 'closed' && mode !== 'failed') return;
    // Te vas tú (la sala se cierra): no hay a quién esperar.
    if (G.Net.closing) {
      if (host) mateGone(u);
      else if (u === hostUid) { const cb = api.lost; end(); if (cb) cb('Se ha perdido la conexión con el anfitrión.'); }
      return;
    }
    cut(u);
  });

  /** Se ha cortado el canal con `u`: se le espera RECONNECT_MS (tick). */
  function cut(u) {
    const now = performance.now();
    if (host) {
      const m = mates.get(u);
      if (!m || !m.connected || m.lostAt != null) return;
      m.lostAt = now;
      m.q = m.q.filter(ev => !TRANSIENT.has(ev[0]));
      G.Spawner.say(m.name + ' ha perdido la conexión: esperando a que vuelva…', 4, true);
    } else if (u === hostUid && hostLostAt == null) {
      hostLostAt = now;
      stalled = true; updateAway();
    }
  }

  /** El canal con `u` vuelve a estar abierto (tras un corte). */
  function back(u) {
    if (host) {
      const m = mates.get(u);
      if (!m || !m.connected || m.lostAt == null) return;
      m.lostAt = null; m.flushT = 0;
      G.Spawner.say(m.name + ' ha vuelto a la partida', 2.6, true);
    } else if (u === hostUid && hostLostAt != null) {
      hostLostAt = null;
      flushClient(true);              // que el anfitrión sepa ya que sigues ahí
    }
  }

  /**
   * Anfitrión: `u` se ha ido (o, con `never`, no ha llegado a entrar). Se avisa
   * a todos ('gone') y a él también, por si sigue ahí y sólo fallaba su envío.
   */
  function mateGone(u, never = false) {
    const m = mates.get(u);
    if (!m || !m.connected) return;
    dropMate(m);
    m.q.push(['gone', u]);
    G.Net.send(u, hostFrame(m));
    emit(['gone', u]);
    G.Spawner.say(m.name + (never ? ' no ha podido entrar en la partida' : ' ha dejado la partida'), 2.6);
    if (waiting.has(u)) picked(u);
    if (holds.has(u)) holdOff(u);
  }

  /** En cada ordenador: ese compañero ya no está (no se dibuja ni cuenta para nada). */
  function dropMate(m) {
    m.connected = false; m.sp = null;
    G.Projectiles.clearOrbs(m.pl);
    if (api.mateLeft) api.mateLeft(m);
  }

  // --- en el anfitrión ---

  function onClientFrame(from, msg) {
    const m = mates.get(from);
    if (!m || !m.connected) return;
    if (m.lostAt != null) back(from);         // si llega algo suyo, el canal funciona
    if (msg.p) { m.state = msg.p; m.pl.net = readState(msg.p); m.xpMul = m.pl.net.xpMul || 1; reconcile(from, m.pl.net); }
    m.sp = Array.isArray(msg.sp) && msg.sp.length === 2 && msg.sp.every(Number.isFinite) ? msg.sp : null;
    for (const ev of msg.ev || []) {
      switch (ev[0]) {
        case 'h': {
          const e = G.EnemyMgr.get(ev[1]);
          if (!e || e.dead || e.remote) break;
          hitFrom = from;
          e.hurt(ev[2], ev[3], ev[4], ev[5], ev[6]);
          hitFrom = null;
          break;
        }
        case 's': {
          const e = G.EnemyMgr.get(ev[1]);
          if (!e || e.dead) break;
          if (ev[2] === 'b') e.applyBurn(ev[3]);
          else if (ev[2] === 'p') e.applyPoison(ev[3]);
          else if (ev[2] === 's') e.applySlow(ev[3]);
          else if (ev[2] === 't') e.applyStun(ev[3]);
          break;
        }
        case 'c':
          G.Combat.ghostCast(m.pl, ev[1], ev[2], ev[3], ev[4]);
          emit(['c', from, ev[1], ev[2], ev[3], ev[4]], from);
          break;
        case 'pb':
          G.World.breakAt(ev[1], ev[2]);
          emit(['pb', ev[1], ev[2]], from);
          break;
        case 'lp': picked(from); break;
        case 'hs': holdOn(from); break;
        case 'he': holdOff(from); break;
        case 're': G.Rift.enterRequest(); break;
        case 'bye': mateGone(from); break;
        case 'rq':                    // enemigos que no le llegaron (se perdió su 'ne')
          for (const id of (Array.isArray(ev[1]) ? ev[1] : []).slice(0, 60)) {
            const e = G.EnemyMgr.get(id);
            if (e && !e.dead && !e.remote) m.q.push(neEv(e));
          }
          break;
      }
    }
  }

  /** Anfitrión: lo que dice cada envío del invitado manda sobre avisos que se hayan perdido. */
  function reconcile(from, n) {
    if (n.ch === undefined) return;                        // versión vieja del juego
    if (n.ch && !holds.has(from)) holdOn(from);
    else if (!n.ch && holds.has(from)) holdOff(from);
    if (waiting.has(from) && n.ld >= levelSeq) picked(from);
  }

  // --- en el invitado ---

  /** Invitado: se para (o sigue) según si el anfitrión está. */
  function updateAway() { if (api.away) api.away(hostAway || stalled ? nameOf(hostUid) : null); }

  // Anfitrión: al irse de la pestaña avisa a todos al momento (después ya no
  // podrá mandar nada) y al volver, que sigue.
  document.addEventListener('visibilitychange', () => {
    if (!active || !host) return;
    emit(['ha', document.hidden ? 1 : 0]);
    flushAll();
  });

  function onHostFrame(msg) {
    lastHostAt = performance.now();
    if (stalled) { stalled = false; updateAway(); }
    for (const ev of msg.ev || []) { applyHostEvent(ev); if (!active) return; }     // 'ov' o 'gone' (tú): se acabó
    if (msg.ja) G.Judgment.netApply(msg.ja);
    // Quién elige y las cartas de nivel, aunque se haya perdido algún aviso.
    if (msg.ho) {
      const k = msg.ho.join('|');
      if (k !== lastHo) { lastHo = k; api.hold && api.hold(msg.ho); }
      // Hay cartas abiertas que aún no has elegido y no las tienes delante (eran
      // nuevas, o algo te las cerró al elegir muy deprisa): se abren otra vez.
      // Antes sólo se miraba si eran nuevas y te podías quedar fuera de la ronda
      // con los demás esperándote.
      const showing = api.inLevelUp && api.inLevelUp();
      if (msg.lu && msg.lu[0] > doneSeq && (msg.lu[0] > seenSeq || !showing)) { seenSeq = msg.lu[0]; api.levelStart(msg.lu[1]); }
      else if (!msg.lu && showing) api.resume();
    }
    api.syncTeam({ time: msg.t, level: msg.lv, xp: msg.xp, xpNext: msg.xn, kills: msg.ki, bosses: msg.bo, coins: msg.co,
                   t1: (msg.tk || [])[0], t10: (msg.tk || [])[1] });
    const now = performance.now();
    for (const u in msg.p || {}) {
      const m = mates.get(u);
      if (m && m.connected) { m.pl.net = readState(msg.p[u]); m.seenAt = now; }
    }
    // Por si se pierde el aviso 'gone': el que el anfitrión mandaba y ya no manda, se ha ido.
    for (const m of mates.values()) if (m.connected && m.seenAt != null && now - m.seenAt > GONE_MS) dropMate(m);
    if (!Array.isArray(msg.e)) return;
    const unknown = [], here = new Set();
    for (const a of msg.e) {
      if (!Array.isArray(a)) continue;
      here.add(a[0]);
      const e = G.EnemyMgr.get(a[0]);
      // No lo conoces (se perdió su 'ne' en un corte): se le pide al anfitrión.
      if (!e) {
        if (unknown.length < 40 && !(now - asked.get(a[0]) < ASK_MS)) { asked.set(a[0], now); unknown.push(a[0]); }
        continue;
      }
      if (!e.remote || e.dead) continue;
      const n = e.net;
      const dts = (now - (n.last || now)) / 1000;
      if (dts > 0.02 && dts < 1) {
        n.vx = G.U.clamp((a[1] - n.x) / dts, -600, 600);
        n.vy = G.U.clamp((a[2] - n.y) / dts, -600, 600);
      } else { n.vx = 0; n.vy = 0; }
      n.x = a[1]; n.y = a[2]; n.age = 0; n.last = now;
      e.hp = Math.min(e.maxHp, a[3]);
      n.anim = a[4]; n.dir = a[5]; n.st = a[6];
    }
    if (unknown.length) outEv.push(['rq', unknown]);
    if (asked.size > 500) for (const [id, t] of asked) if (now - t > ASK_MS) asked.delete(id);
    // Copias que el anfitrión ya no tiene (se perdió su 'ed'): las que están cerca
    // de lo que ves siempre vienen en 'e'; si faltan GHOST_FRAMES envíos seguidos, fuera.
    const [fx, fy] = (api.specAt && api.specAt()) || [local.x, local.y];
    const ghosts = [];
    for (const e of G.EnemyMgr.all()) {
      if (!e.remote || e.dead || !e.net) continue;
      if (here.has(e.id) || G.U.dist2(e.x, e.y, fx, fy) > GHOST_R * GHOST_R) e.net.miss = 0;
      else if ((e.net.miss = (e.net.miss || 0) + 1) >= GHOST_FRAMES) ghosts.push(e.id);
    }
    for (const id of ghosts) G.EnemyMgr.removeRemote(id, false);
  }

  function applyHostEvent(ev) {
    switch (ev[0]) {
      case 'ne':
        G.EnemyMgr.addRemote({ id: ev[1], dex: ev[2], x: ev[3], y: ev[4], boss: !!ev[5], shiny: !!ev[6], hp: ev[7], dmg: ev[8], beh: ev[9] });
        break;
      case 'ed': G.EnemyMgr.removeRemote(ev[1], true); break;
      case 'eg': G.EnemyMgr.removeRemote(ev[1], false); break;
      case 'hn': { const e = G.EnemyMgr.get(ev[1]); if (e && !e.dead) e.showHurt(ev[2], ev[3]); break; }
      case 'es':
        G.Projectiles.spawn({ x: ev[1], y: ev[2], vx: ev[3], vy: ev[4], dmg: ev[5], r: ev[6], life: ev[7],
                              friendly: false, color: '#ff7a9e', vis: G.VFX.forType(ev[8]), mtype: ev[8], cat: ev[9] });
        break;
      case 'c': { const m = mates.get(ev[1]); if (m) G.Combat.ghostCast(m.pl, ev[2], ev[3], ev[4], ev[5]); break; }
      case 'item': api.item(ev[1]); break;
      case 'pk': G.Pickups.addRemote(ev[1], ev[2], ev[3], ev[4], ev[5]); break;
      case 'pc': G.Pickups.removeId(ev[1]); break;
      case 'mag': G.Pickups.pullAll(); G.FX.ring(local.x, local.y, 10, 420, '#ff9ed8', 0.6, 4); break;
      case 'bomb':
        G.FX.ring(ev[1], ev[2], 20, G.Camera.outerRadius(), '#ff7b3d', 0.5, 6);
        if (G.U.dist2(ev[1], ev[2], G.Camera.x, G.Camera.y) < 500 * 500) G.Camera.kick(0.8);     // si se ve cerca
        G.Audio.sfx('break');
        break;
      case 'pb': G.World.breakAt(ev[1], ev[2]); break;
      case 'say': G.Spawner.say(ev[1], ev[2]); break;
      case 'heal': if (!local.dead) { local.heal(local.maxHp * ev[1]); G.FX.ring(local.x, local.y, 6, 60, '#5fe08a', 0.4, 3); } break;
      case 'lu': if (!ev[2] || ev[2] > seenSeq) { seenSeq = ev[2] || seenSeq; api.levelStart(ev[1]); } break;
      case 'lw': api.waiting(ev[1]); break;
      case 'lr': api.resume(); break;
      case 'hp': lastHo = (ev[1] || []).join('|'); api.hold && api.hold(ev[1]); break;
      case 'ha': hostAway = !!ev[1]; updateAway(); break;
      case 'sh': api.shiny(ev[1]); break;
      case 'ov': { const cb = api.over; const d = ev[1]; end(); cb(d); break; }
      case 'gone': {
        // Un compañero se ha ido. Si eres tú, el anfitrión no recibía nada tuyo: fuera.
        if (ev[1] === me) { const cb = api.lost; end(); if (cb) cb('Se ha perdido la conexión con el anfitrión.'); break; }
        const m = mates.get(ev[1]);
        if (m && m.connected) dropMate(m);
        break;
      }
      case 'rift': case 'riftx': case 'arena': case 'aw': case 'al': G.Rift.onEvent(ev); break;
      case 'jd': case 'jk': G.Judgment.onEvent(ev); break;
      case 'wx': G.Weather.onEvent(ev); break;
      case 'ev': G.Events.onNet(ev); break;
      case 'hz': G.Hazards.add(ev[1], true); break;
      case 'fxr':
        if (typeof ev[4] === 'string') G.FX.ring(num(ev[1], 0, -1e6, 1e6), num(ev[2], 0, -1e6, 1e6), 8, num(ev[3], 8, 0, 2000), ev[4], 0.5, 3);
        break;
    }
  }

  // ---------------- ganchos que llaman los módulos del juego ----------------

  /** Tu ataque: los demás lo repiten como fantasma. */
  function cast(pl, m) {
    if (!active || pl !== local) return;
    if (host) emit(['c', me, m.id, m.lvl, r2(pl.aim), m.evolved ? 1 : 0]);
    else outEv.push(['c', m.id, m.lvl, r2(pl.aim), m.evolved ? 1 : 0]);
  }

  // invitado
  function hit(e, d, color, dx, dy, knock) { outEv.push(['h', e.id, d, color, r1(dx), r1(dy), knock || 0]); }
  function status(e, kind, val) { outEv.push(['s', e.id, kind, val]); }

  // anfitrión
  function hurtShown(e, d, color) { emitNear(['hn', e.id, d, color], e.x, e.y, hitFrom); }
  const neEv = e => ['ne', e.id, e.dex, r1(e.x), r1(e.y), e.boss ? 1 : 0, e.shiny ? 1 : 0, Math.ceil(e.maxHp), r2(e.dmg), e.behavior];
  function enemyAdded(e) { emit(neEv(e)); }
  function enemyGone(e, died) { emit([died ? 'ed' : 'eg', e.id]); }
  function enemyShot(p, type) { emit(['es', r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), r2(p.dmg), p.r, p.life, type, p.cat]); }
  function pickupAdded(o) { emit(['pk', o.id, o.kind, r1(o.x), r1(o.y), o.value]); }
  function pickupGone(id) { emit(['pc', id]); }
  function say(text, secs) { emit(['say', text, secs]); }

  function propBroken(p) {
    if (host) emit(['pb', p.tx, p.ty]);
    else outEv.push(['pb', p.tx, p.ty]);
  }

  /** Anfitrión: alguien ha cogido un objeto. Devuelve true si es para ti. */
  function collected(p, who) {
    emit(['pc', p.id]);
    if (p.kind === 'magnet') emit(['mag']);
    if (p.kind === 'bomb') emit(['bomb', r1(who.x), r1(who.y)]);
    if ((p.kind === 'heal' || p.kind === 'item') && who !== local) {
      const m = mates.get(who.uid);
      if (m) m.q.push(p.kind === 'heal' ? ['heal', 0.3] : ['item', p.value]);
    }
  }

  function shinyCaught(e) { emit(['sh', e.dex]); }

  // ---------------- subida de nivel compartida ----------------

  function levelStart(level) {
    waiting = new Set([me]);
    for (const m of mates.values()) if (m.connected) waiting.add(m.uid);
    levelSeq++; levelNow = level;
    emit(['lu', level, levelSeq]);
    flushAll();
    api.levelStart(level);
    sendWaiting();
  }

  function nameOf(u) { return u === me ? (G.Social.me ? G.Social.me.name : 'Tú') : (mates.get(u) || {}).name || '?'; }

  function sendWaiting() {
    const names = [...waiting].map(nameOf);
    emit(['lw', names]);
    api.waiting(names);
  }

  /** Alguien ha elegido carta (anfitrión). */
  function picked(u) {
    if (!waiting.delete(u)) return;
    if (waiting.size) { sendWaiting(); return; }
    emit(['lr']);
    flushAll();
    api.resume();
  }

  // ---------------- fusiones: pausa para todos ----------------
  // Mientras alguien elige qué movimientos fusiona (vínculo de un legendario),
  // la partida se para para todos, como con las cartas de nivel.

  function holdNames() { return [...holds].map(nameOf); }

  /** Anfitrión: `u` empieza a elegir. */
  function holdOn(u) {
    holds.add(u);
    emit(['hp', holdNames()]); flushAll();
    api.hold && api.hold(holdNames());
  }

  /** Anfitrión: `u` ha terminado (o se ha ido). */
  function holdOff(u) {
    if (!holds.delete(u)) return;
    emit(['hp', holdNames()]); flushAll();
    api.hold && api.hold(holdNames());
  }

  /** Tú empiezas / terminas de elegir fusión. */
  function holdStart() { if (host) holdOn(me); else { outEv.push(['hs']); flushClient(true); } }
  function holdEnd() { if (host) holdOff(me); else { outEv.push(['he']); flushClient(true); } }

  /** Has elegido tu carta. */
  function localPicked() {
    if (host) picked(me);
    else { doneSeq = seenSeq; outEv.push(['lp']); flushClient(true); }
  }

  /** Anfitrión: se acabó para todos. */
  function over(data) {
    emit(['ov', data]);
    flushAll();
    end();
  }

  return {
    ANIMS, COLORS, begin, end, leave, tick, players, puppets, fresh, xpFactor, scaleRate, scaleHp,
    cast, hit, status, hurtShown, enemyAdded, enemyGone, enemyShot, pickupAdded, pickupGone, say,
    propBroken, collected, shinyCaught, levelStart, localPicked, over, holdStart, holdEnd,
    /** Anfitrión: evento para todos. Invitado: evento para el anfitrión. */
    broadcast(ev) { emit(ev); },
    toHost(ev) { if (active && !host) { outEv.push(ev); flushClient(true); } },
    mate(u) { return mates.get(u); },
    get mates() { return [...mates.values()]; },
    get members() { return members; },
    get active() { return active; },
    get isHost() { return active && host; },
    /** En grupo, pero ya sin nadie más en la partida (se han ido todos): la pausa vuelve a parar el juego. */
    get alone() { return active && ![...mates.values()].some(m => m.connected); },
    get local() { return local; }
  };
})();
