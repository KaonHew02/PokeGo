/* Prepara la app de Android (carpeta app/, Capacitor) con la web ya empaquetada.
 *   node tools/build.js && node tools/build_app.js
 *   (o, para sacar el APK: cd app && npm run apk; ver docs/APP.md)
 *
 * - La web (GitHub Pages) y la app son el MISMO juego: la app lleva dentro el
 *   index.html y el js/app.min.js que genera build.js. Aquí no se empaqueta
 *   nada: se copia a app/www/ lo que la página carga y se quita lo que en la
 *   app no sirve (el manifest de la web).
 * - Lo propio de la app va en js/core/native.js (G.Native), dentro del mismo
 *   app.min.js: en la web no hace nada.
 * - app/www/ se genera entero cada vez (no se sube a git).
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'app', 'www');
const read = f => fs.readFileSync(path.join(ROOT, f));

let html = read('index.html').toString('utf8');
// index.html tiene que ser el del código actual: la misma huella que calcula build.js.
const hash = crypto.createHash('sha1').update(read('js/app.min.js')).update(read('css/style.css')).digest('hex').slice(0, 10);
if (!html.includes(`js/app.min.js?v=${hash}`)) {
  console.error('index.html no es de este código: ejecuta antes node tools/build.js');
  process.exit(1);
}

// La app ya es una app: sin el manifest de la web. Y sin viewport-fit=cover:
// el juego no se aparta del recorte de la cámara, así Android lo deja libre.
const MANIFEST = /<link rel="manifest"[^>]*>\s*/, COVER = ',viewport-fit=cover';
if (!MANIFEST.test(html) || !html.includes(COVER)) throw new Error('index.html ha cambiado: revisa build_app.js');
html = html.replace(MANIFEST, '').replace(COVER, '');

// Lo que carga la página (scripts, estilos, iconos, fuentes)...
const files = new Set(['favicon.ico', 'version.json']);
for (const m of html.matchAll(/(?:src|href)="([^"#:?]+\.[a-z0-9]+)(?:\?[^"]*)?"/g)) files.add(m[1]);
// ...y lo que se pide luego: los idiomas (locales.js) y los sprites de los Pokémon.
const dirs = ['css', 'js/lang', 'assets/fonts', 'assets/icons', 'assets/pokemon'];

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });
fs.writeFileSync(path.join(WWW, 'index.html'), html);
for (const f of files) {
  if (!fs.existsSync(path.join(ROOT, f))) throw new Error('index.html carga ' + f + ', que no existe');
  fs.mkdirSync(path.dirname(path.join(WWW, f)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), path.join(WWW, f));
}
for (const d of dirs) fs.cpSync(path.join(ROOT, d), path.join(WWW, d), { recursive: true });

let n = 0, bytes = 0;
(function count(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) count(p); else { n++; bytes += fs.statSync(p).size; }
  }
})(WWW);
console.log(`app/www: ${n} archivos, ${(bytes / 1048576).toFixed(1)} MB (versión ${hash})`);
