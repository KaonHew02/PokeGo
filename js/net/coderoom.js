/* ============ coderoom.js — salas con código (jugar en grupo sin nube) ============
 * El anfitrión crea una sala y pasa su código (5 letras o números, sin 0/O ni
 * 1/I/L, que se confunden) a los demás, que lo escriben para entrar.
 *
 *   - Para encontrarse se usa el servidor público y gratuito de PeerJS
 *     (librería en js/vendor/peerjs.min.js; se carga al abrir "Jugar en grupo",
 *     no con el juego). Sólo presenta a los navegadores: la partida va por el
 *     canal directo de siempre (net.js) y nunca pasa por él.
 *   - El anfitrión se registra como "pokego-<código>" (si ya existe, otro
 *     código); cada invitado con un id al azar, y llama al anfitrión.
 *   - Al abrirse el canal, el invitado se presenta (nombre, Pokémon, versión)
 *     y el anfitrión le deja entrar y manda la lista a todos, o le dice por qué
 *     no: llena (4), ya ha empezado o versión distinta del juego.
 *   - El anfitrión manda en la lista. Si un invitado pierde la conexión, se le
 *     espera GRACE_MS (vuelve a llamar solo); si sale, se le quita. Si sale el
 *     anfitrión, la sala se cierra para todos.
 *
 * La sala se ve en G.Social.room con la forma de las de amigos (más code, me y
 * net): así la pantalla de sala, el menú y el cooperativo valen para las dos.
 *
 * Mensajes (por net.js, JSON):  { k:'room', t, ... }
 *   invitado -> anfitrión  hello { name, dex, shiny, v, p } (también al volver tras un corte) · bye
 *   anfitrión -> invitado  welcome { name, members, open } · no { why } · members { members, open } · close
 */
G.CodeRoom = (() => {
  const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const PREFIX = 'pokego-', PROTO = 1, MAX = G.Social.MAX_PLAYERS;
  const LIB = 'js/vendor/peerjs.min.js';
  const SERVER_MS = 12000;      // para registrarse en el servidor de salas
  const JOIN_MS = 25000;        // para entrar: encontrar al anfitrión, conectar y que conteste
  const GRACE_MS = 20000;       // anfitrión: lo que se espera a un invitado sin conexión
  const BYE_MS = 300;           // al salir: que el aviso salga antes de cerrar el canal
  // Versión del juego: la huella de app.min.js (en dev.html, 'dev'). Si no es la
  // misma, los mensajes de la partida podrían no entenderse: no se juega junto.
  const VERSION = (() => {
    const tag = document.querySelector('script[src*="app.min.js?v="]');
    return (tag && (tag.getAttribute('src').match(/v=([0-9a-f]+)/) || [])[1]) || 'dev';
  })();
  const ERR = {
    server: 'No se pudo conectar con el servidor de salas. Revisa tu conexión a internet e inténtalo otra vez.',
    webrtc: 'Este navegador no permite jugar en grupo.',
    code: 'El código de la sala tiene 5 letras o números.',
    missing: 'No hay ninguna sala con ese código. Revisa que esté bien escrito.',
    failed: 'No se pudo conectar con el anfitrión: algunas redes no dejan conectar directamente. Probad con otra wifi o con datos móviles.',
    full: 'La sala está llena (máximo ' + MAX + ').',
    started: 'La partida de esa sala ya ha empezado.',
    version: 'Esa sala tiene otra versión del juego: recargad la página e intentadlo otra vez.',
    left: 'El anfitrión ha cerrado la sala.'
  };

  let lib = null;               // promesa de la librería
  let peer = null, room = null;
  let joining = null;           // invitado entrando: { code, host, net, done, timer }
  let job = 0;                  // cada crear / unirse / salir lo cambia: lo que llega tarde se descarta
  let wanted = '';              // el nombre que pediste (el anfitrión le añade un número si se repite)
  const lost = new Map();       // anfitrión: invitado sin conexión -> temporizador

  const errOf = e => (e && e.type === 'browser-incompatible' ? ERR.webrtc : ERR.server);
  const cleanName = s => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  /** Lo escrito, en mayúsculas y sólo letras y números (como mucho 5). */
  const normal = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

  function rand(n, abc) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return [...a].map(b => abc[b % abc.length]).join('');
  }

  // ---------------- PeerJS ----------------

  /** Carga la librería (una vez). */
  function load() {
    if (window.peerjs && window.peerjs.Peer) return Promise.resolve();
    if (!lib) lib = new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = LIB; el.async = true;
      el.onload = () => (window.peerjs ? res() : rej(Error('peerjs')));
      el.onerror = () => { lib = null; el.remove(); rej(Error('peerjs')); };
      document.head.appendChild(el);
    });
    return lib;
  }

  /** Se registra en el servidor de salas con ese id. → Promise(peer); el error lleva .type. */
  function register(id) {
    return new Promise((res, rej) => {
      let p;
      // Sólo nuestros STUN: sin los TURN de PeerJS, nada de la partida pasa por sus servidores.
      try { p = new window.peerjs.Peer(id, { config: { iceServers: G.Net.ICE }, debug: 0 }); }
      catch (e) { rej(e); return; }
      const t = setTimeout(() => fail({ type: 'timeout' }), SERVER_MS);
      function done() { clearTimeout(t); p.off('open', ok); p.off('error', fail); }
      function ok() { done(); res(p); }
      function fail(e) { done(); try { p.destroy(); } catch (x) { /* nada */ } rej(e); }
      p.on('open', ok);
      p.on('error', fail);
    });
  }

  /** Si se corta la conexión con el servidor de salas, se vuelve a conectar (los canales abiertos siguen). */
  function watch(p) {
    p.on('disconnected', () => setTimeout(() => {
      if (p === peer && p.disconnected && !p.destroyed) { try { p.reconnect(); } catch (e) { /* al llamar se reintenta */ } }
    }, 5000));
  }

  /** Cierra la red y el Peer (sin avisar a nadie). */
  function shutdown() {
    for (const t of lost.values()) clearTimeout(t);
    lost.clear();
    const p = peer;
    peer = null;
    if (!p) return;
    if (G.Net.via && G.Net.via.uid === p.id) G.Net.close();
    try { p.destroy(); } catch (e) { /* nada */ }
  }

  function reset(name) {
    ++job;
    if (joining) endJoin({ ok: false });
    room = null;
    shutdown();
    wanted = cleanName(name) || 'Jugador';
    return job;
  }

  // ---------------- crear / unirse / salir ----------------

  function mine(uid, name) {
    const s = G.DB.save;
    return { uid, name, dex: s.partner, shiny: !!s.partnerShiny && G.DB.ownsShiny(s.partner), at: Date.now() };
  }

  /** Crea una sala. → { ok, code } | { ok:false, error } (sin error: se ha cancelado) */
  async function create(name) {
    const my = reset(name);
    try { await load(); } catch (e) { return { ok: false, error: my === job ? ERR.server : '' }; }
    for (let i = 0; i < 6 && my === job; i++) {
      const code = rand(5, LETTERS);
      let p;
      try { p = await register(PREFIX + code.toLowerCase()); }
      catch (e) {
        if (e && e.type === 'unavailable-id') continue;            // código ocupado: otro
        return { ok: false, error: my === job ? errOf(e) : '' };
      }
      if (my !== job) { try { p.destroy(); } catch (e) { /* nada */ } break; }
      peer = p; watch(p);
      const me = mine(p.id, wanted);
      room = { id: code, code, host: p.id, isHost: true, open: true, members: [me], me: { uid: p.id, name: me.name }, net: G.Net.viaPeerJS(p) };
      G.Net.open(code, true, p.id, room.net);
      G.Net.syncMembers([p.id]);
      G.Social.setCodeRoom(room);
      return { ok: true, code };
    }
    return { ok: false, error: my === job ? ERR.server : '' };
  }

  /** Entra en la sala de ese código. → { ok } | { ok:false, error } (sin error: se ha cancelado) */
  async function join(code, name) {
    code = normal(code);
    if (code.length !== 5) return { ok: false, error: ERR.code };
    if ([...code].some(c => !LETTERS.includes(c))) return { ok: false, error: ERR.missing };
    const my = reset(name);
    try { await load(); } catch (e) { return { ok: false, error: my === job ? ERR.server : '' }; }
    if (my !== job) return { ok: false };
    let p;
    try { p = await register(PREFIX + 'g' + rand(12, 'abcdefghijklmnopqrstuvwxyz0123456789')); }
    catch (e) { return { ok: false, error: my === job ? errOf(e) : '' }; }
    if (my !== job) { try { p.destroy(); } catch (e) { /* nada */ } return { ok: false }; }
    peer = p; watch(p);
    const host = PREFIX + code.toLowerCase(), net = G.Net.viaPeerJS(p);
    return new Promise(done => {
      joining = { code, host, net, done, timer: setTimeout(() => endJoin({ ok: false, error: ERR.failed }), JOIN_MS) };
      // Llama al anfitrión; al abrirse el canal se presenta (abajo, onPeer).
      G.Net.open(code, false, host, net);
    });
  }

  function endJoin(res) {
    const j = joining;
    if (!j) return;
    joining = null;
    clearTimeout(j.timer);
    if (!res.ok) shutdown();
    j.done(res);
  }

  /** Sales de la sala (si eres el anfitrión, se cierra para todos). También cancela crear o unirse. */
  async function leave() {
    const r = room, my = ++job;
    if (joining) endJoin({ ok: false });
    room = null;
    if (r) {
      if (r.isHost) G.Net.broadcast({ k: 'room', t: 'close' }); else G.Net.toHost({ k: 'room', t: 'bye' });
      await new Promise(res => setTimeout(res, BYE_MS));
    }
    if (my === job) shutdown();
    if (r && G.Social.room === r) G.Social.setCodeRoom(null);
  }

  /** Invitado: la sala se ha acabado sin que salieras tú. */
  function end(msg) {
    if (!room) return;
    room = null;
    ++job;
    shutdown();
    G.Social.setCodeRoom(null, { ended: msg });
  }

  // ---------------- anfitrión ----------------

  const list = () => room.members.map(m => ({ uid: m.uid, name: m.name, dex: m.dex, shiny: !!m.shiny }));

  /** Anfitrión: la sala ha cambiado: la red, los demás y la pantalla. */
  function changed(except) {
    G.Net.syncMembers(room.members.map(m => m.uid));
    G.Net.broadcast({ k: 'room', t: 'members', members: list(), open: room.open }, except);
    G.Social.setCodeRoom(room);
  }

  /** Un nombre que no tenga ya otro de la sala ("Invitado", "Invitado 2"...). */
  function unique(name) {
    const taken = new Set(room.members.map(m => m.name.toLowerCase()).concat(['tú']));
    let out = name;
    for (let i = 2; taken.has(out.toLowerCase()); i++) out = name.slice(0, 13) + ' ' + i;
    return out;
  }

  function admit(from, m) {
    const dex = G.DEX_BY[m.dex] ? +m.dex : 25, shiny = m.shiny === true;
    let me = room.members.find(x => x.uid === from);
    if (!me) {
      const why = m.p !== PROTO || m.v !== VERSION ? 'version' : !room.open ? 'started' : room.members.length >= MAX ? 'full' : '';
      if (why) { refuse(from, why); return; }
      me = { uid: from, name: unique(cleanName(m.name) || 'Jugador'), dex, shiny, at: Date.now() };
      room.members.push(me);
    } else Object.assign(me, { dex, shiny });
    changed(from);
    G.Net.send(from, { k: 'room', t: 'welcome', name: me.name, members: list(), open: room.open });
  }

  function refuse(from, why) {
    G.Net.send(from, { k: 'room', t: 'no', why });
    // Un momento para que le llegue el porqué; después se le cuelga.
    const r = room;
    setTimeout(() => { if (room === r && !r.members.some(m => m.uid === from)) G.Net.kick(from); }, 1000);
  }

  function remove(u) {
    if (!room || u === room.host || !room.members.some(m => m.uid === u)) return;
    room.members = room.members.filter(m => m.uid !== u);
    clearTimeout(lost.get(u)); lost.delete(u);
    changed();
  }

  // ---------------- invitado ----------------

  function hello() {
    const s = G.DB.save;
    G.Net.toHost({ k: 'room', t: 'hello', name: wanted, dex: s.partner, shiny: !!s.partnerShiny && G.DB.ownsShiny(s.partner), v: VERSION, p: PROTO });
  }

  /** La lista que manda el anfitrión, limpia (sólo lo que la sala sabe pintar). */
  function cleanList(a) {
    if (!Array.isArray(a) || !a.length || a.length > MAX) return null;
    const out = [];
    for (const m of a) {
      if (!m || typeof m.uid !== 'string' || !m.uid || m.uid.length > 64 || out.some(o => o.uid === m.uid)) return null;
      out.push({ uid: m.uid, name: cleanName(m.name) || 'Jugador', dex: G.DEX_BY[m.dex] ? +m.dex : 25, shiny: m.shiny === true });
    }
    return out;
  }

  function fromHost(m) {
    if (m.t === 'members' || m.t === 'welcome') {
      const ms = cleanList(m.members);
      if (!ms) return;
      room.members = ms;
      room.open = m.open !== false;
      const me = ms.find(x => x.uid === room.me.uid);
      if (me) room.me.name = me.name;
      else hello();               // te ha quitado (se cortó tu conexión un rato): te presentas otra vez
      G.Social.setCodeRoom(room);
    } else if (m.t === 'no') end(ERR[m.why] || ERR.failed);
    else if (m.t === 'close') end(ERR.left);
  }

  function joinReply(m) {
    if (m.t === 'welcome') {
      const ms = cleanList(m.members), j = joining;
      if (!ms || ms[0].uid !== j.host) return;
      const me = ms.find(x => x.uid === peer.id);
      room = { id: j.code, code: j.code, host: j.host, isHost: false, open: m.open !== false, members: ms,
               me: { uid: peer.id, name: me ? me.name : wanted }, net: j.net };
      G.Social.setCodeRoom(room);
      endJoin({ ok: true });
    } else if (m.t === 'no') endJoin({ ok: false, error: ERR[m.why] || ERR.failed });
  }

  // ---------------- red ----------------

  G.Net.on((from, m) => {
    if (!m || m.k !== 'room') return;
    if (joining) { if (from === joining.host) joinReply(m); return; }
    if (!room || G.Net.via !== room.net) return;
    if (room.isHost) { if (m.t === 'hello') admit(from, m); else if (m.t === 'bye') remove(from); }
    else if (from === room.host) fromHost(m);
  });

  G.Net.onPeer((u, mode) => {
    if (joining) {
      if (u !== joining.host) return;
      if (mode === 'direct') hello();
      else if (mode === 'closed') endJoin({ ok: false, error: ERR.missing });    // ese id no está en el servidor
      else if (mode === 'failed') endJoin({ ok: false, error: ERR.failed });
      return;
    }
    if (!room || G.Net.via !== room.net) return;
    if (room.isHost) {
      if (u === room.host || !room.members.some(m => m.uid === u)) return;
      if (mode === 'direct') { clearTimeout(lost.get(u)); lost.delete(u); }
      else if ((mode === 'failed' || mode === 'closed') && !lost.has(u)) {
        lost.set(u, setTimeout(() => { lost.delete(u); if (room && room.isHost && G.Net.mode(u) !== 'direct') remove(u); }, GRACE_MS));
      }
    } else if (u === room.host) {
      if (mode === 'direct') hello();              // canal nuevo tras un corte: te presentas otra vez
      else if (mode === 'closed') end(ERR.left);   // el anfitrión ya no está en el servidor
    }
  });

  // Al cerrar la pestaña: se avisa (si da tiempo). Al cerrar sesión, se sale de la sala.
  addEventListener('pagehide', () => {
    if (!room) return;
    if (room.isHost) G.Net.broadcast({ k: 'room', t: 'close' }); else G.Net.toHost({ k: 'room', t: 'bye' });
  });
  G.DB.onLeave(() => leave());

  return {
    load, create, join, leave, normal, VERSION,
    /** Volver sin haber entrado: cancela crear o unirse (si ya estás en una sala, sigues en ella). */
    cancel() { if (!room) leave(); },
    /** Anfitrión: la sala admite gente nueva (no mientras se juega). */
    setOpen(open) { if (room && room.isHost) { room.open = !!open; changed(); } },
    /** Has cambiado de compañero: los demás lo ven en la sala. */
    refreshMember() {
      if (!room) return;
      if (!room.isHost) { hello(); return; }
      Object.assign(room.members[0], mine(room.host, room.members[0].name));
      changed();
    },
    /** ¿Entrando en una sala? (la red está abierta pero aún no hay sala) */
    get busy() { return !!joining; },
    get room() { return room; }
  };
})();
