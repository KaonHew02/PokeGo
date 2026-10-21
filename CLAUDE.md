# PokéGo — working notes

PokéGo is this user's own version of PokéSurvivor (JPTER78/pokesurvivor, imported at
upstream commit 018e986). Code comments, docs and the source-language UI text are in Spanish.

## Build
1. Edit `dev.html` (never `index.html`, which is generated) and the files under `js/`, `css/` and `tools/`.
2. `node tools/build.js && node tools/export_data.js && python tools/make_seo_pages.py`
   - `build.js` writes `index.html`, `js/app.min.js`, `js/lang/*.js` and `version.json`.
     `js/core/updater.js` reloads players when `version.json` changes, so keep both.
   - `make_seo_pages.py` writes `en/`, the guide/data pages, `404.html`, `robots.txt` and `sitemap.xml`.
3. `node --test tests/i18n.test.cjs tests/net.test.cjs` (all must pass).
4. Run locally: `python -m http.server 8123` → http://localhost:8123 (`/dev.html` for unminified code).

## Text and translations
- Spanish strings are the dictionary keys. Changing Spanish text means changing the same key in
  `js/data/lang-en.js`, `lang-fr.js`, `lang-it.js`, `lang-pt.js`, `lang-zh-cn.js`, `lang-zh-hant.js`
  and `lang-updates.js`. New text: add it to `lang-en.js` plus a row in `lang-updates.js`.
  `node tools/build_langs.js --faltan` lists gaps.
- Gameplay changes and fixes go in `js/data/changelog.js` (Spanish + English, today's date).
  Entries before 2026-10-20 are PokéSurvivor's history: keep its name there and in their translations.

## Independence from the original game
- Firebase: the user's own project **`pokego-ec220`** (free Spark plan) in `js/core/firebase-config.js`.
  Never restore the original `pokesurvivor-free` config, and never upgrade the project to Blaze or
  Identity Platform (they bill). Rules deploy with `npx firebase-tools deploy --only firestore,database`.
- New hostnames must go in `HOSTS` (`js/core/db.js`) and in Firebase Authentication's authorized domains.
- Published on GitHub Pages: repo `KaonHew02/PokeGo`, site `https://kaonhew02.github.io/PokeGo/`
  (`dev.html` meta tags, `SITE` in `tools/make_seo_pages.py`). Push only when the user asks.
- Keep `LICENSE`, `LICENSE-NONCOMMERCIAL.md`, `CREDITS.md` and the "Basado en PokéSurvivor, de JPTER78"
  credits: the license requires the notice. No commercial use (no ads, sales or paid items).
