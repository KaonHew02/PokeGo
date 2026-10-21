/* ============ net.js — conexión entre los jugadores de una sala ============
 * Topología en estrella: el ANFITRIÓN habla con cada invitado; los invitados
 * sólo hablan con el anfitrión (él reenvía lo que haga falta).
 *
 * Dos caminos, a la vez:
 *   directo  WebRTC (canal de datos entre navegadores, sin pasar por ningún
 *            servidor). Para encontrarse (señalización) hay dos transportes:
 *              base de datos  salas de amigos (con la nube): rooms/{sala}/q/{uid}.
 *                             Llama el anfitrión.
 *              PeerJS         salas con código (sin nube, ver coderoom.js): su
 *                             servidor público sólo presenta a los navegadores.
 *                             Llama el invitado (el anfitrión no sabe su id).
 *            Con los dos, el canal es el mismo y lo lleva este archivo (binario,
 *            envíos, estados y reintentos).
 *            Sólo con STUN gratuito de Google: si la red no deja conectar
 *            directo (algunos routers y datos móviles), esa pareja no puede
 *            jugar junta. El TURN de Cloudflare se QUITÓ el 15-10-2026 (de pago).
 *   relé     (APAGADO) los mensajes irían por la Realtime Database:
 *            rooms/{sala}/q/{destinatario}/{id}, a 1 $ el GB.
 *
 * Se envía por el canal directo si está abierto; si no, por el relé. El que
 * recibe escucha los dos, así que no hace falta ponerse de acuerdo.
 *
 * API:  open(roomId, isHost, hostUid[, via]) · close() · send(to, msg) · toHost(msg)
 *       broadcast(msg) · on(fn(from, msg)) · onPeer(fn(uid, state))
 *       peers() · mode(uid) -> 'connecting' | 'direct' | 'relay' | 'failed' | 'closed'
 *       viaPeerJS(peer) (transporte de las salas con código) · kick(uid)
 */
G.Net = (() => {
  const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const DIRECT_TIMEOUT = 9000;     // ms para conseguir canal directo antes de usar el relé
  // Relé por la Realtime Database APAGADO (12-10-2026): a 1 $ el GB era lo que más
  // costaba del cooperativo. Sin conexión directa, esa pareja no puede jugar
  // junta ('failed') y el que llama lo reintenta cada RETRY_MS. Por la base de datos
  // sólo pasa la señalización (unos pocos mensajes pequeños para conectarse).
  const ALLOW_RELAY = false, RETRY_MS = 15000;
  // PeerJS: su servidor tarda unos 5 s en decir que un id no existe; y quien
  // llama a una sala que aún no es suya tiene este rato para entrar (coderoom.js).
  const PEER_TIMEOUT = 15000, PEER_RETRY = 5000, KNOCK_MS = 20000;


  let tr = null;                   // transporte de la sala abierta (ver abajo)
  let uid = null, roomId = null, isHost = false, hostUid = null;
  let members = [];                // los de la sala, según el último syncMembers
  const peers = new Map();         // uid -> { pc, dc, conn, mode, timer, knock }
  const handlers = new Set(), peerHandlers = new Set();
  const stats = { sent: 0, recv: 0, relaySent: 0,
    // Sólo los datos de la partida que se han mandado bien (sin ICE/SCTP/DTLS/TURN).
    sentBytes: 0, jsonBytes: 0, recvBytes: 0, binarySent: 0, binaryRecv: 0, invalidBinary: 0 };

  function emitPeer(u) {
    const p = peers.get(u);
    peerHandlers.forEach(fn => { try { fn(u, p ? p.mode : 'closed'); } catch (e) { console.warn(e); } });
  }

  // ---------------- transportes ----------------
  // Cómo se encuentran los dos navegadores. Cada uno da: uid (tu id en la sala),
  // hostDials (¿llama el anfitrión?), timeout y retry (ms), start() / stop(),
  // dial(u) (abre conexión con u) y, la base de datos, push(to, env) (señales y relé).

  /** Salas de amigos: la señalización va por la Realtime Database. */
  function viaDatabase() {
    const fb = G.DB.fb;
    // Nube sin Realtime Database (falta databaseURL en firebase-config.js): no hay por dónde.
    if (!fb || !fb.rtdb) return null;
    const rtdb = fb.rtdb;
    let qref = null;
    return {
      uid: fb.uid, hostDials: true, timeout: DIRECT_TIMEOUT, retry: RETRY_MS,
      start() {
        qref = rtdb.ref('rooms/' + roomId + '/q/' + uid);
        qref.on('child_added', s => {
          const raw = s.val();
          s.ref.remove().catch(() => {});
          let m;
          try { m = JSON.parse(raw); } catch (e) { return; }
          if (!m || !m.f) return;
          if (m.sig) onSignal(m.f, m.sig);
          else deliver(m.f, m.d);
        });
      },
      stop() { if (qref) { qref.off(); qref = null; } },
      dial: offer,
      push(to, env) {
        rtdb.ref('rooms/' + roomId + '/q/' + to).push(JSON.stringify(env)).catch(e => console.warn('[Net] relé:', e.code || e.message));
      }
    };
  }

  /**
   * Salas con código: `peer` es un Peer de PeerJS ya registrado en su servidor.
   * PeerJS sólo abre el canal (sin serializar nada: 'raw'); al abrirse, net.js
   * se queda con él. Con nuestros STUN (coderoom.js): nada de la partida pasa
   * por sus servidores.
   */
  function viaPeerJS(peer) {
    let onConn = null, onErr = null;
    return {
      uid: peer.id, hostDials: false, timeout: PEER_TIMEOUT, retry: PEER_RETRY,
      start() {
        peer.on('connection', onConn = conn => {
          if (!roomId || conn.serialization !== 'raw' || !conn.peer || conn.peer === uid) { try { conn.close(); } catch (e) { /* nada */ } return; }
          incoming(conn.peer, conn);
        });
        // Ese id no está en el servidor: la sala no existe (o el anfitrión ya se ha ido).
        peer.on('error', onErr = e => {
          if (!e || e.type !== 'peer-unavailable') return;
          const who = String(e.message || '').split(' ').pop();
          for (const [u, p] of [...peers]) if (p.conn && p.mode !== 'direct' && (u === who || !peers.has(who))) drop(u);
        });
      },
      stop() { peer.off('connection', onConn); peer.off('error', onErr); },
      dial(u) {
        const p = newPeer(u, false);
        // Sin servidor (se cortó la red un momento): se reconecta y, si no llega a tiempo, se reintenta.
        if (peer.disconnected && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* nada */ } }
        let conn = null;
        try { conn = peer.connect(u, { reliable: true, serialization: 'raw', label: 'g' }); } catch (e) { /* abajo */ }
        if (conn) attach(u, p, conn); else useRelay(u);
      }
    };
  }

  // ---------------- apertura ----------------

  function open(id, host, hostId, via) {
    if (roomId === id) return;
    close();
    const t = via || viaDatabase();
    if (!t) { console.warn('[Net] sin Realtime Database (databaseURL) no hay salas de amigos'); return; }
    tr = t; uid = t.uid;
    roomId = id; isHost = host; hostUid = hostId;
    tr.start();
    if (isHost) return;
    // PeerJS: el invitado llama al anfitrión desde ya.
    if (!tr.hostDials) { connect(hostId); return; }
    // Invitado: hueco para el anfitrión desde ya (se sustituye al llegar su
    // oferta). Así, si no llega nunca, se sigue por el relé y se sabe cuándo se va.
    const p = { pc: null, dc: null, mode: 'connecting', timer: 0 };
    p.timer = setTimeout(() => { if (p.mode === 'connecting') { p.mode = ALLOW_RELAY ? 'relay' : 'failed'; emitPeer(hostId); } }, DIRECT_TIMEOUT + 3000);
    peers.set(hostId, p);
  }

  function close() {
    for (const u of [...peers.keys()]) drop(u);
    if (tr) { tr.stop(); tr = null; }
    roomId = null; isHost = false; hostUid = null; members = [];
  }

  /** El anfitrión llama a esto cuando cambian los miembros de la sala. */
  function syncMembers(uids) {
    if (!roomId) return;
    members = uids.slice();
    if (isHost) {
      for (const u of uids) {
        const p = peers.get(u);
        if (p) p.knock = false;
        else if (u !== uid && tr.hostDials) connect(u);
      }
      // Quien aún "llama a la puerta" (PeerJS, sin presentarse) no se cuelga aquí.
      for (const u of [...peers.keys()]) if (!uids.includes(u) && !peers.get(u).knock) drop(u);
    } else if (!uids.includes(hostUid)) {
      drop(hostUid);
    }
  }

  // ---------------- WebRTC ----------------

  /** @param own  conexión WebRTC propia (base de datos); con PeerJS la abre él. */
  function newPeer(u, own = true) {
    const p = { pc: null, dc: null, conn: null, mode: 'connecting', timer: 0, knock: false };
    peers.set(u, p);
    if (own) {
      // Sin WebRTC (navegador antiguo o bloqueado): directamente por el relé.
      let pc;
      try { pc = p.pc = new RTCPeerConnection({ iceServers: ICE }); }
      catch (e) { p.mode = 'relay'; emitPeer(u); return p; }
      pc.onicecandidate = e => { if (e.candidate) signal(u, { c: e.candidate.toJSON() }); };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' && p.mode !== 'closed') useRelay(u);
      };
    }
    // Si en unos segundos no hay canal directo, se sigue por el relé.
    p.timer = setTimeout(() => { if (p.mode === 'connecting') useRelay(u); }, tr.timeout);
    emitPeer(u);
    return p;
  }

  function wireChannel(u, p, dc) {
    p.dc = dc;
    p.binaryVersion = 0;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => opened(u, p);
    dc.onclose = () => closed(u, p);
    dc.onmessage = e => {
      let m;
      if (typeof e.data === 'string') {
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m && m.k === 'net-cap') {
          p.binaryVersion = m.binary === G.NetCodec.version ? m.binary : 0;
          return;
        }
        stats.recvBytes += G.NetCodec.size(e.data);
      } else {
        try {
          if (p.binaryVersion !== G.NetCodec.version) throw Error('unnegotiated binary');
          m = G.NetCodec.decode(e.data);
          if (!m || m.k !== 'f') throw Error('not a frame');
        } catch (err) { stats.invalidBinary++; return; }
        stats.recvBytes += e.data.byteLength; stats.binaryRecv++;
      }
      // Quien aún llama a la puerta (PeerJS) sólo puede presentarse (coderoom.js).
      if (p.knock && !(m && m.k === 'room')) return;
      deliver(u, m);
    };
  }

  function opened(u, p) {
    clearTimeout(p.timer); p.mode = 'direct';
    // Aviso de que entendemos binario (las versiones viejas lo ignoran); hasta que el otro
    // mande el suyo, se le habla en JSON.
    try { p.dc.send(JSON.stringify({ k: 'net-cap', binary: G.NetCodec.version })); } catch (e) { /* el JSON sigue valiendo */ }
    // Anfitrión (PeerJS): quien llama tiene un rato para presentarse y entrar en la sala.
    if (p.knock) p.timer = setTimeout(() => { if (peers.get(u) === p && p.knock) drop(u); }, KNOCK_MS);
    emitPeer(u);
  }

  function closed(u, p) { if (p.mode === 'direct') { p.mode = 'connecting'; useRelay(u); } }

  /** PeerJS: hasta que abre, el canal es suyo; después lo lleva net.js como cualquier otro. */
  function attach(u, p, conn) {
    p.conn = conn;
    conn.on('open', () => {
      if (peers.get(u) !== p || p.mode !== 'connecting') { try { conn.close(); } catch (e) { /* nada */ } return; }
      wireChannel(u, p, conn.dataChannel);
      opened(u, p);
    });
    // PeerJS quita los avisos del canal cuando lo cierra él (se cae la conexión): por eso también aquí.
    conn.on('close', () => closed(u, p));
    conn.on('error', () => { if (peers.get(u) === p) useRelay(u); });
  }

  /** PeerJS: un invitado llama al anfitrión (también al volver tras un corte). */
  function incoming(u, conn) {
    // El canal de antes ya no vale: se avisa (el cooperativo lo da por ido) y se usa el nuevo.
    if (peers.has(u)) drop(u);
    const p = newPeer(u, false);
    p.knock = !members.includes(u);           // aún no es de la sala: coderoom.js decide
    attach(u, p, conn);
  }

  function useRelay(u) {
    const p = peers.get(u);
    if (!p || p.mode === 'direct' || p.mode === 'closed' || p.mode === 'failed') return;
    if (p.knock) { drop(u); return; }        // no era de la sala: se olvida
    if (ALLOW_RELAY) { p.mode = 'relay'; emitPeer(u); return; }
    // Sin relé: no se puede jugar con esa persona por ahora. El que llama reintenta.
    clearTimeout(p.timer);
    p.mode = 'failed';
    hangup(p);
    emitPeer(u);
    if (tr && (tr.hostDials ? isHost : !isHost)) {
      p.timer = setTimeout(() => { if (peers.get(u) === p && p.mode === 'failed' && roomId) { drop(u, true); connect(u); } }, tr.retry);
    }
  }

  function hangup(p) {
    try { if (p.pc) p.pc.close(); } catch (e) { /* nada */ }
    try { if (p.conn) p.conn.close(); } catch (e) { /* nada */ }
  }

  /** Abre conexión con `u`: llama el anfitrión (base de datos) o el invitado (PeerJS). */
  function connect(u) {
    if (!roomId || peers.has(u)) return;
    tr.dial(u);
  }

  /** Base de datos: el anfitrión abre la conexión con su oferta. */
  async function offer(u) {
    const p = newPeer(u);
    if (!p.pc) return;
    wireChannel(u, p, p.pc.createDataChannel('g', { ordered: true }));
    try {
      const sdp = await p.pc.createOffer();
      await p.pc.setLocalDescription(sdp);
      signal(u, { sdp: p.pc.localDescription.toJSON() });
    } catch (e) { useRelay(u); }
  }

  const pendingIce = new Map();     // candidatos que llegan antes que la oferta (o la respuesta)

  async function onSignal(from, sig) {
    let p = peers.get(from);
    try {
      if (sig.sdp && sig.sdp.type === 'offer') {
        if (isHost) return;
        if (p) drop(from, true);
        p = newPeer(from);
        if (!p.pc) return;
        p.pc.ondatachannel = e => wireChannel(from, p, e.channel);
        await p.pc.setRemoteDescription(sig.sdp);
        const ans = await p.pc.createAnswer();
        await p.pc.setLocalDescription(ans);
        signal(from, { sdp: p.pc.localDescription.toJSON() });
        await addPending(from, p);
      } else if (sig.sdp && sig.sdp.type === 'answer') {
        // Los candidatos del invitado que llegan mientras se aplica su respuesta
        // se guardaban y no se usaban nunca (menos conexiones salían bien).
        if (p && p.pc) { await p.pc.setRemoteDescription(sig.sdp); await addPending(from, p); }
      } else if (sig.c) {
        if (p && p.pc && p.pc.remoteDescription) await p.pc.addIceCandidate(sig.c).catch(() => {});
        else { if (!pendingIce.has(from)) pendingIce.set(from, []); pendingIce.get(from).push(sig.c); }
      }
    } catch (e) {
      console.warn('[Net] señalización:', e.message);
      useRelay(from);
    }
  }

  async function addPending(from, p) {
    for (const c of pendingIce.get(from) || []) await p.pc.addIceCandidate(c).catch(() => {});
    pendingIce.delete(from);
  }

  function signal(to, sig) { relayPush(to, { f: uid, sig }); }

  function drop(u, silent) {
    const p = peers.get(u);
    if (!p) return;
    clearTimeout(p.timer);
    p.mode = 'closed';
    try { if (p.dc) p.dc.close(); } catch (e) { /* nada */ }
    hangup(p);
    peers.delete(u);
    pendingIce.delete(u);
    if (!silent) emitPeer(u);
  }

  // ---------------- envío / recepción ----------------

  function relayPush(to, env) {
    if (!tr || !tr.push || !roomId) return false;
    tr.push(to, env);
    return true;
  }

  function send(to, msg) {
    if (!roomId) return;
    const p = peers.get(to);
    stats.sent++;
    if (p && p.dc && p.dc.readyState === 'open') {
      try {
        const json = JSON.stringify(msg), jsonBytes = G.NetCodec.size(json);
        const packed = p.binaryVersion === G.NetCodec.version && msg && msg.k === 'f'
          ? G.NetCodec.encode(msg) : null;
        const binary = packed && packed.byteLength < jsonBytes;
        p.dc.send(binary ? packed : json);
        stats.sentBytes += binary ? packed.byteLength : jsonBytes;
        stats.jsonBytes += jsonBytes;
        if (binary) stats.binarySent++;
        return;
      } catch (e) { /* cae al relé */ }
    }
    // Sin relé, los datos de la partida no van por la base de datos (se pierden: esa
    // pareja no está conectada). Sólo pasa el aviso de empezar (y nada con PeerJS).
    if (!ALLOW_RELAY && !(msg && msg.k === 'start')) return;
    if (relayPush(to, { f: uid, d: msg })) stats.relaySent++;
  }

  function toHost(msg) { if (!isHost && hostUid) send(hostUid, msg); }
  /** A todos los de la sala (no a quien aún llama a la puerta). */
  function broadcast(msg, except) { for (const [u, p] of peers) if (u !== except && !p.knock) send(u, msg); }

  function deliver(from, msg) {
    // El aviso de empezar sólo lo manda el anfitrión (con salas por código, cualquiera puede llamar).
    if (msg && msg.k === 'start' && (isHost || from !== hostUid)) return;
    stats.recv++;
    handlers.forEach(fn => { try { fn(from, msg); } catch (e) { console.error('[Net] mensaje:', e); } });
  }

  return {
    open, close, syncMembers, send, toHost, broadcast, viaPeerJS, ICE,
    on(fn) { handlers.add(fn); }, off(fn) { handlers.delete(fn); },
    onPeer(fn) { peerHandlers.add(fn); },
    /** Cuelga a uno (anfitrión: a quien no puede entrar en la sala). */
    kick(u) { drop(u); },
    mode(u) { const p = peers.get(u); return p ? p.mode : 'closed'; },
    /** ¿Va por el relé (o no hay conexión)? Entonces se manda menos a menudo. */
    slow(u) { const p = peers.get(u); return !p || p.mode !== 'direct'; },
    peers() { return [...peers.keys()]; },
    get open_() { return !!roomId; },
    /** El transporte de la sala abierta (null si no hay). */
    get via() { return tr; },
    get isHost() { return isHost; },
    get uid() { return uid; },
    get hostUid() { return hostUid; },
    stats
  };
})();
