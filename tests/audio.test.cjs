const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = f => fs.readFileSync(path.join(root, f), 'utf8');
const CODE = ['js/core/native.js', 'js/core/audio.js'].map(f => [f, source(f)]);

// El sonido al abrir el juego en `url`, con lo que el jugador guardó (ps.audio) y, si native, dentro de la app.
function audio(url, saved = null, native = false) {
  const u = new URL(url), storage = saved ? { 'ps.audio': JSON.stringify(saved) } : {};
  const ctx = {
    G: {}, console, setInterval() {}, setTimeout() {}, location: { protocol: u.protocol, hostname: u.hostname }, addEventListener() {},
    localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
    document: { addEventListener() {} }
  };
  ctx.window = ctx;
  if (native) ctx.Capacitor = { isNativePlatform: () => true, Plugins: {} };
  vm.createContext(ctx);
  for (const [f, code] of CODE) vm.runInContext(code, ctx, { filename: f });
  return ctx.G.Audio.settings;
}

test('testing locally always starts muted, even if the sound was left on', () => {
  for (const url of ['http://localhost:8123/', 'http://127.0.0.1:8123/dev.html', 'http://[::1]:8123/',
                     'http://192.168.1.20:8123/', 'http://10.0.0.5:8123/', 'http://172.20.1.2:8123/', 'file:///C:/PokeGo/index.html']) {
    assert.equal(audio(url, { muted: false, music: 0.8 }).muted, true, url);
  }
  // Lo demás que guardó (volúmenes) se respeta.
  assert.equal(audio('http://localhost:8123/', { muted: false, music: 0.8 }).music, 0.8);
});

test('the live site and the Android app keep the player\'s sound (on by default)', () => {
  assert.equal(audio('https://kaonhew02.github.io/PokeGo/').muted, false);
  assert.equal(audio('https://kaonhew02.github.io/PokeGo/', { muted: true }).muted, true);
  assert.equal(audio('https://172.32.0.1/').muted, false);
  // La app abre el juego en https://localhost: no es una prueba.
  assert.equal(audio('https://localhost/', null, true).muted, false);
  assert.equal(audio('https://localhost/', { muted: true }, true).muted, true);
});
