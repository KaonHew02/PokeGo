// Dobles de prueba para las salas con código: un reloj falso y un "servidor de PeerJS"
// en memoria con la misma API que usa js/net (Peer, connect, DataConnection.dataChannel).
const fs = require('node:fs');
const path = require('node:path');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

/** Deja correr las promesas pendientes (async/await de coderoom.js). */
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

/** setTimeout falso: el tiempo sólo avanza con tick(ms). */
function fakeClock() {
  let now = 0, seq = 0;
  const q = [];
  const setTimeout = (fn, ms = 0) => { const t = { fn, at: now + Math.max(0, +ms || 0), id: ++seq }; q.push(t); return t.id; };
  const clearTimeout = id => { const i = q.findIndex(t => t.id === id); if (i >= 0) q.splice(i, 1); };
  async function tick(ms) {
    const end = now + ms;
    await flush();
    for (;;) {
      q.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = q[0];
      if (!t || t.at > end) break;
      q.shift();
      now = t.at;
      t.fn();
      await flush();
    }
    now = end;
  }
  return { setTimeout, clearTimeout, tick, get now() { return now; } };
}

class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; }
  off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter(f => f !== fn); return this; }
  emit(ev, ...a) { for (const f of (this._h[ev] || []).slice()) f(...a); }
}

/**
 * Servidor de PeerJS en memoria. Opciones para las pruebas: down (no se puede
 * registrar nadie), block (los canales no llegan a abrirse, como una red que no
 * deja conectar directo). Cada canal entrega sus mensajes en orden, en el siguiente "tick".
 */
function peerServer(clock) {
  const ids = new Map();
  const server = { ids, down: false, block: false, Peer: null };

  class Channel {
    constructor() { this.readyState = 'connecting'; this.other = null; this.binaryType = 'blob'; }
    send(d) {
      if (this.readyState !== 'open') throw Error('not open');
      const o = this.other;
      clock.setTimeout(() => { if (o.readyState === 'open' && o.onmessage) o.onmessage({ data: d }); }, 0);
    }
    close() {
      for (const c of [this, this.other]) {
        if (!c || c.readyState === 'closed') continue;
        c.readyState = 'closed';
        clock.setTimeout(() => { if (c.onclose) c.onclose(); }, 0);
      }
    }
  }

  class Conn extends Emitter {
    constructor(owner, other, opts) {
      super();
      this.peer = other; this.serialization = opts.serialization; this.label = opts.label;
      this.dataChannel = new Channel(); this.open = false; this.closed = false; this.mate = null;
      owner.conns.push(this);
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      const was = this.open;
      this.open = false;
      this.dataChannel.close();
      if (was) this.emit('close');
      const m = this.mate;
      if (m && !m.closed) clock.setTimeout(() => m.close(), 0);
    }
  }

  class Peer extends Emitter {
    constructor(id, opts) {
      super();
      this.id = id; this.options = opts; this.conns = [];
      this.disconnected = false; this.destroyed = false;
      clock.setTimeout(() => {
        if (server.down) { this.emit('error', { type: 'network', message: 'Lost connection to server.' }); return; }
        if (ids.has(id)) { this.emit('error', { type: 'unavailable-id', message: 'ID "' + id + '" is taken' }); return; }
        ids.set(id, this);
        this.emit('open', id);
      }, 1);
    }
    connect(id, opts) {
      // Como PeerJS: sin conexión con el servidor no se puede llamar a nadie.
      if (this.destroyed || this.disconnected) { this.emit('error', { type: 'disconnected' }); return undefined; }
      const conn = new Conn(this, id, opts);
      clock.setTimeout(() => {
        const other = ids.get(id);
        if (!other || other.destroyed) {
          // Como el servidor de verdad: avisa a los ~5 s de que ese id no está.
          clock.setTimeout(() => this.emit('error', { type: 'peer-unavailable', message: 'Could not connect to peer ' + id }), 5000);
          return;
        }
        if (server.block || conn.closed) return;
        const back = new Conn(other, this.id, opts);
        conn.mate = back; back.mate = conn;
        conn.dataChannel.other = back.dataChannel; back.dataChannel.other = conn.dataChannel;
        other.emit('connection', back);
        clock.setTimeout(() => {
          for (const c of [conn, back]) {
            if (c.closed) continue;
            c.dataChannel.readyState = 'open'; c.open = true;
            c.emit('open');
          }
        }, 5);
      }, 5);
      return conn;
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (ids.get(this.id) === this) ids.delete(this.id);
      for (const c of this.conns) c.close();
    }
    reconnect() {}
  }
  server.Peer = Peer;
  return server;
}

/**
 * Un navegador: net.js y coderoom.js de verdad, con G.Social / G.DB mínimos.
 * @param opt { dex, version, random }  version: la huella de app.min.js (sin ella, 'dev')
 */
function browser(server, clock, opt = {}) {
  const G = { DEX_BY: { 4: {}, 7: {}, 25: {} } };
  new Function('G', source('js/net/codec.js'))(G);
  const emits = [];
  let codeRoom = null;
  G.Social = { MAX_PLAYERS: 4, setCodeRoom(r, what) { codeRoom = r; emits.push(what || 'room'); }, get room() { return codeRoom; } };
  G.DB = { save: { partner: opt.dex || 25, partnerShiny: false }, ownsShiny: () => false, onLeave() {} };
  const tag = opt.version ? { getAttribute: () => 'js/app.min.js?v=' + opt.version } : null;
  const doc = { querySelector: () => tag };
  const crypto = { getRandomValues: opt.random || (a => require('node:crypto').webcrypto.getRandomValues(a)) };
  const win = { peerjs: { Peer: server.Peer } };
  new Function('G', 'RTCPeerConnection', 'setTimeout', 'clearTimeout', source('js/net/net.js'))(G, class {}, clock.setTimeout, clock.clearTimeout);
  new Function('G', 'window', 'document', 'crypto', 'addEventListener', 'setTimeout', 'clearTimeout', source('js/net/coderoom.js'))(
    G, win, doc, crypto, () => {}, clock.setTimeout, clock.clearTimeout);
  const got = [];
  G.Net.on((from, msg) => got.push([from, msg]));
  return { G, emits, got, get room() { return codeRoom; }, get id() { return G.Net.uid; } };
}

module.exports = { fakeClock, peerServer, browser, flush };
