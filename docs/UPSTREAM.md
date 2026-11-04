# Upstream (PokéSurvivor) review log

Upstream: https://github.com/JPTER78/pokesurvivor (git remote `upstream`, branch `main`;
its `live` branch only holds YouTube video ids and is ignored).

Since 2026-10-30 upstream publishes only built files (obfuscated `js/app.min.js`). Changes are
reimplemented in PokéGo's own source from the readable material (the `novedades/` changelog,
`js/lang/*.js` dictionaries, `css/style.css`, data pages). Upstream's deletion of its source is
not a change to port.

**Last reviewed upstream commit: `c121040` (2026-11-02, "Ajuste interno") — reviewed 2026-11-03;
no new upstream commits on 2026-11-04 (that run worked through the `pending` backlog below).**

Previous baseline: `ce57853` (2026-10-21, "La gran actualización: Tienda Kecleon"), ported into
PokéGo on 2026-10-22 (commit 49e3cbac, see CREDITS.md).

License check (2026-11-04): `LICENSE`, `LICENSE-NONCOMMERCIAL.md` and the README's license
section are unchanged since `ce57853`.

## Commits ce57853..90cdd94

| Commit | Date | Subject | Decision |
|---|---|---|---|
| 2cb52db3 | 2026-10-30 | PokéSurvivor (history squashed, source deleted) | Reviewed through its changelog entries 10-22 … 10-28 below |
| 2f2c1899 | 2026-10-30 | Banner de novedades: Discord y último vídeo | Skipped: promotion (Discord / YouTube) |
| c3a32fa3 | 2026-10-30 | Banner de novedades más pequeño | Skipped: promotion |
| 2ee6f79d | 2026-10-30 | Banner con flechas y vídeos a YouTube | Skipped: promotion |
| d2bf542d | 2026-10-30 | Enlace nuevo del Discord | Skipped: promotion |
| e5997d56 | 2026-10-31 | Mejoras de estabilidad | Skipped: only obfuscated code changed, nothing readable to port |
| 4018c949 | 2026-11-01 | Mejoras de estabilidad | Skipped: only obfuscated code changed, nothing readable to port |
| b742e437 | 2026-11-01 | Mejoras de estabilidad | Skipped: only obfuscated code changed, nothing readable to port |
| 90cdd941 | 2026-11-01 | Mejoras internas | Skipped: only obfuscated code changed, nothing readable to port |

## Commits 90cdd94..c121040

| Commit | Date | Subject | Decision |
|---|---|---|---|
| 23c0d653 | 2026-11-02 | Arreglo: el progreso guardado en el navegador ya no se pierde al actualizar | Ported 2026-11-03 (see changelog entry below) |
| ad6c0259 | 2026-11-02 | Aviso de directo y último vídeo: nueva fuente de datos | Skipped: promotion (live/video notice) and a deleted GitHub workflow |
| c121040f | 2026-11-02 | Ajuste interno | Skipped: only obfuscated code changed, nothing readable to port |

## Changelog entries (upstream `novedades/`)

### 2026-11-02 · Tu progreso, a salvo
- An older cached version not recognising the browser's save copy and going back to the cloud one — **not applicable as such**: PokéGo always merges the device copy with the cloud (`merge` in `js/core/db.js`), it never just takes the cloud one.
- An unreadable save copy is no longer deleted: kept aside and recovered later — **ported** 2026-11-03 (`read`/`rescue` in `js/core/db.js`, key `ps.rescue.<key>`, merged back in `loadLocal`/`beginLocal` and `openCloud`; test in `tests/save.test.cjs`).
- Offline, the installed app opens the last version used — **ported** 2026-11-03 (`sw.js`, upstream's readable code).

### 2026-10-31 · Novedades también en el móvil
- Menu news banner on mobile landscape — **skipped**: promotion banner.

### 2026-10-30 · Discord oficial y contra las trampas
- News banner (Discord, latest video) — **skipped**: promotion.
- New-video notice opens YouTube — **skipped**: promotion (PokéGo has no video notice).
- Discord link fix — **skipped**: promotion.
- Local-save tampering ignored, cloud copy wins — **skipped**: their cloud-save anti-cheat.

### 2026-10-28 · Halloween, un día más
- Halloween 30-10 … 02-11 and its menu-closing fix — **skipped**: PokéGo has no Halloween event code and the dates are over.

### 2026-10-27 · Cooperativo más estable
- "Anclado" (anchored) joystick option — **ported** 2026-11-04 (`js/core/touch.js`, `js/ui/layout-ui.js`; translations from upstream's dictionaries).
- Weak Armor / Steadfast / Rattled no longer reset Agility charges — **ported** 2026-11-02 (`Player.addBuff`).
- Assault Vest outside the 70 % Armor cap — **already in PokéGo** (`js/systems/levelup.js`, fixed earlier).
- Very wide windows: enemies circling off-screen — **ported** 2026-11-04 (`ringPoint` in `js/systems/spawner.js`, straggler limit in `js/entities/enemy.js`).
- Personality traits translated in the starting quiz — **ported** 2026-11-02 (`js/ui/test.js`, en/it dictionaries).
- Arceus damage ranking fixes, ranking upload retries — **skipped**: their ranking rewrite / servers.
- Mobile: "Cambiar opciones" picking a card by itself; bond picking the move under the finger — **ported** 2026-11-04 (`tapCards` in `js/ui/run-ui.js`).
- Co-op TURN fallback from either side — **skipped**: their TURN server (PokéGo has its own TURN work).
- Co-op slow connection: wait instead of queueing minutes of lag — **pending** (PokéGo's own co-op lag fix of 10-22 may already cover it; check).

### 2026-10-26 · Halloween se acerca
- Halloween event and countdown — **skipped**: no event code in PokéGo, dates over.
- Mobile login: no autocorrect/autocapitalize on the user name — **ported** 2026-11-04 (`dev.html`, also the nickname and friend fields).
- Mobile: joystick stuck on level-up with two fingers — **ported** 2026-11-04 (`tapCards`; `js/core/touch.js` releases the stick when no finger is left).
- Top bar fits any screen (icon-only buttons, short amounts like 10 M) — **ported** 2026-11-04 (upstream's CSS, `shortNum` in `js/ui/ui.js`). Not checked in a browser: the preview was declined during the unattended run.
- Mobile back button pauses / goes back — **pending** (web side; the Android app already does it in `js/core/native.js`).
- Mobile: centre notices wrap to fit — **ported** 2026-11-04 (`js/ui/hud.js`).
- Mobile: bottom/achievement notices no longer catch taps — **ported** 2026-11-02 (CSS `pointer-events: none`).
- Pause screen Defense / Sp. Def decimals — **ported** 2026-11-02 (`js/ui/run-ui.js`).
- Mobile: stray "·" on level/item cards; title phrase covering Play — **ported** (the `.splash` hidden in landscape 2026-11-02; the "·" 2026-11-04, inside `.kbd-hint` in `dev.html`).

### 2026-10-25 · Tickets y Pokémon iguales en todos tus aparatos
- End-of-run damage summary per move (tabs per player in co-op) — **pending** (big feature).
- Mobile "Apuntar a mano" back with a second joystick — **pending**.
- Per-Pokémon ranking 10 min, public profile 6 h — **skipped**: their ranking/servers.
- Mobile: take the joystick outside the card box — **pending**.
- Mobile portrait top bar in two lines — **ported** 2026-11-04 (upstream's CSS).
- Gacha with gamepad: no accidental re-rolls; Skip/Continue selectable — **ported** 2026-11-04 (`js/core/gamepad.js`, `data-nofocus`).
- Orbs with gamepad hints — **pending** (needs Mystery Dungeon orbs first).
- Co-op weather abilities from guests — **ported** 2026-11-04 (`wq` event in `js/net/coop.js`).
- Co-op: stuck when a "done picking" message is lost — **already in PokéGo** (`reconcile` in `js/net/coop.js` checks it in every frame).
- Cloud-save fixes (several) — **skipped**: their cloud-save design (PokéGo keeps its own saving).
- Music keeps playing distorted when minimised — **ported** 2026-11-04 (`js/core/audio.js`, touch devices on the web; the Android app already did it).
- Arceus's Judgment: leaving the arena at high speed — **ported** 2026-11-04 (`clampIn` in `js/systems/judgment.js`).
- Co-op: disconnected teammate still chased — **ported** 2026-11-04 (`absent` after `QUIET_MS` in `js/net/coop.js`; enemies and Arceus skip them).
- Ranking fixes (several) — **skipped**: their ranking.
- Two tabs in the same browser share changes — **pending**.

### 2026-10-24 · Ataques en la colección y ventanas del menú
- Collection: bigger move icons with a tooltip — **pending** (CSS is in upstream `css/style.css`, `.move-tip`).
- Menu windows close when clicking outside — **ported** 2026-11-04 (`js/ui/ui.js`).
- Kecleon Shop / News windows start below the top bar — **ported** 2026-11-02 (CSS).

### 2026-10-23 · Ranking de daño a Arceus y Tablas
- YouTube button — **skipped**: promotion.
- Ranking split (damage to Arceus / time) — **skipped**: their ranking rewrite.
- Arceus can be hit (tiny damage share); Plates give Arceus a random type — **pending** (big gameplay change).
- Minute 35: Arceus breaks everyone's item — **pending**.
- Judgment legendaries +25 % HP / +15 % damage each instead of ×2 — **ported** 2026-11-04 (`js/systems/judgment.js`); no 45-min ranking cap — **skipped**: their ranking.
- Evolved moves keep their name with "+" — **pending** (touches every language's evolved names).
- Meteor Mash 34 → 24 damage, smaller area — **ported** 2026-11-02 (`js/data/moves.js`; radius 54 → 48, upstream's exact radius is not published).
- Judgment: poison/burn deal small fixed damage to legendaries — **ported** 2026-11-04 (2 per stack per tick, `js/entities/enemy.js`; upstream's number is not published).

### 2026-10-22 · Esferas, Amuletos Iris y gacha ×100
- Mystery Dungeon Orbs (6 single-use items, keys 5-8) — **pending** (big feature).
- Iris Charms per region (shiny rate ×2 in that banner) — **pending**.
- Gacha ×100 — **pending** (needs the slot machine and a summary screen; upstream also removed the ×1 pull to make room, decide whether to keep it). Skip button — **already in PokéGo**.
- Co-op: "La sala se ha cerrado" for guests mid-run; 45 s pause on host drop; waiting in the room — **pending** (PokéGo has its own 20 s reconnect from 10-22; compare first).
