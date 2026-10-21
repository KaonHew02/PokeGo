# PokéGo · Mystery Dungeon

A Pokémon "bullet heaven" survival game in the style of Survivor.io: pick a
partner, survive endless hordes, level up and evolve your moves. It has 966
Pokémon from all 9 generations with *Pokémon Mystery Dungeon* sprites, a
roguelike upgrade layer, shinies, legendary rifts and a gacha. It's plain
HTML, CSS and JavaScript on Canvas 2D: no install, and it plays offline.

PokéGo is based on **PokéSurvivor by JPTER78**
(<https://github.com/JPTER78/pokesurvivor>), imported at upstream commit
`018e986` (19 October 2026).

## Play

- **Quickest:** double-click `index.html`. Your progress is saved in that browser.
- **Recommended:** serve the folder and open it in a browser:

  ```bash
  python -m http.server 8123
  ```

  Then go to <http://localhost:8123>.

| Key | Action |
|---|---|
| `W` `A` `S` `D` / arrow keys | Move |
| `1` `2` `3` `4` | Choose the active move |
| `Q` / `E` | Cycle moves |
| `Esc` / `P` | Pause |

On a phone or tablet (landscape), drag anywhere to move, tap an attack at the
bottom to switch to it, and use the top-right button to pause. The game can be
played in English, Spanish, French, Italian, Brazilian Portuguese and Simplified
or Traditional Chinese (Settings > Graphics > Language).

## Develop

1. Edit `dev.html` and the files in `js/`, `css/` and `tools/`. Don't edit
   `index.html`: it's generated. To test without minifying, open
   <http://localhost:8123/dev.html>.
2. Rebuild:

   ```bash
   node tools/build.js && node tools/export_data.js && python tools/make_seo_pages.py
   ```

3. Run the tests:

   ```bash
   node --test tests/i18n.test.cjs tests/net.test.cjs
   ```

The source language is Spanish and every on-screen string is a dictionary key.
When you add or change Spanish text, add the English in `js/data/lang-en.js` and
the other languages as a row in `js/data/lang-updates.js`.
`node tools/build_langs.js --faltan` lists anything missing.

## How PokéGo differs from PokéSurvivor

- **Name:** PokéGo is used in the game, the web pages and all 7 languages. The
  news screen keeps PokéSurvivor's history under its original name.
- **Its own Firebase project** (`pokego-ec220`, free Spark plan) for accounts,
  Google sign-in, cloud saves, friends, leaderboards and co-op rooms, instead of
  the original author's. The config is in `js/core/firebase-config.js`. Any new
  web address must be added to `HOSTS` in `js/core/db.js` and to Firebase
  Authentication's authorized domains. Security rules:
  `npx firebase-tools deploy --only firestore,database`.
- **No donation or contact links.** The Ko-fi/GitHub Sponsors buttons and pages
  are gone, and so are the original author's contact email and page. To add
  your own, set `kofi` in `js/data/funding.js` and `CONTACT` in `js/ui/ui.js`.
- **Website:** published on GitHub Pages at <https://kaonhew02.github.io/PokeGo/>
  (`dev.html` meta tags and `SITE` in `tools/make_seo_pages.py`).
- **New link-preview image:** `assets/og-image.jpg`.
- `docs/`, `infra/` and `GDD.md` are PokéSurvivor's notes (in Spanish). They
  still describe its servers and domain.

## License and credits

The code is licensed under **PolyForm Noncommercial 1.0.0**, inherited from
PokéSurvivor (see `LICENSE` and `LICENSE-NONCOMMERCIAL.md`). You may use,
change and share it, but not commercially: no selling it, no charging for it or
for anything in it, and no ads.

Required Notice: Copyright 2026 JPTER78 (https://github.com/JPTER78/pokesurvivor)

The sprites come from PMD SpriteCollab under CC BY-NC 4.0 (full credits in
`CREDITS.md`), and the Pokédex data comes from PokéAPI. PokéGo is a non-profit
fan project, not affiliated with Nintendo, Creatures, GAME FREAK or The Pokémon
Company. Pokémon and all related names are the property of their owners.
