# Upstream (PokéSurvivor) review log

Upstream: https://github.com/JPTER78/pokesurvivor (git remote `upstream`, branch `main`;
its `live` branch only holds YouTube video ids and is ignored).

Since 2026-10-30 upstream publishes only built files (obfuscated `js/app.min.js`). Changes are
reimplemented in PokéGo's own source from the readable material (the `novedades/` changelog,
`js/lang/*.js` dictionaries, `css/style.css`, data pages). Upstream's deletion of its source is
not a change to port.

**Last reviewed upstream commit: `7fdffe6` (2026-11-04, "Mantenimiento") — reviewed 2026-11-04.
The whole `pending` backlog below was ported the same day.**

Previous baseline: `ce57853` (2026-10-21, "La gran actualización: Tienda Kecleon"), ported into
PokéGo on 2026-10-22 (commit 49e3cbac, see CREDITS.md).

License check (2026-11-04): `LICENSE`, `LICENSE-NONCOMMERCIAL.md` and the README's license
section are unchanged since `ce57853`.

**Upstream unreachable since 2026-11-05.** `git fetch upstream` fails with "Repository not found",
and github.com and the GitHub API both answer 404 for `JPTER78/pokesurvivor`. The account still
exists and lists two public repos, neither of them the game: `pokesurvivor-live` (created
2026-11-02, YouTube channel status only) and a portfolio. The repo was deleted or made private;
GitHub would redirect a rename. `upstream/main` here is the last fetched copy (`7fdffe6`), so no
commits after 2026-11-04 could be reviewed, and the license could not be rechecked. Nothing was
ported on 2026-11-05. The local objects are kept: do not prune the `upstream` refs.

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

## Commits c121040..7fdffe6

| Commit | Date | Subject | Decision |
|---|---|---|---|
| 7fdffe6c | 2026-11-04 | Mantenimiento | Skipped: only obfuscated code, version numbers and sitemap dates changed, no changelog entry, nothing readable to port |

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
- Co-op slow connection: wait instead of queueing minutes of lag — **ported** 2026-11-04 (host holds frames when a guest lags over `LAG_MS` (`js/net/coop.js`)).

### 2026-10-26 · Halloween se acerca
- Halloween event and countdown — **skipped**: no event code in PokéGo, dates over.
- Mobile login: no autocorrect/autocapitalize on the user name — **ported** 2026-11-04 (`dev.html`, also the nickname and friend fields).
- Mobile: joystick stuck on level-up with two fingers — **ported** 2026-11-04 (`tapCards`; `js/core/touch.js` releases the stick when no finger is left).
- Top bar fits any screen (icon-only buttons, short amounts like 10 M) — **ported** 2026-11-04 (upstream's CSS, `shortNum` in `js/ui/ui.js`). Not checked in a browser: the preview was declined during the unattended run.
- Mobile back button pauses / goes back — **ported** 2026-11-04 (`js/core/native.js`; no history entries on an iPhone Home Screen install).
- Mobile: centre notices wrap to fit — **ported** 2026-11-04 (`js/ui/hud.js`).
- Mobile: bottom/achievement notices no longer catch taps — **ported** 2026-11-02 (CSS `pointer-events: none`).
- Pause screen Defense / Sp. Def decimals — **ported** 2026-11-02 (`js/ui/run-ui.js`).
- Mobile: stray "·" on level/item cards; title phrase covering Play — **ported** (the `.splash` hidden in landscape 2026-11-02; the "·" 2026-11-04, inside `.kbd-hint` in `dev.html`).

### 2026-10-25 · Tickets y Pokémon iguales en todos tus aparatos
- End-of-run damage summary per move (tabs per player in co-op) — **ported** 2026-11-04 (`movesTable` in `js/ui/run-ui.js`, `rs` event in `js/net/coop.js`).
- Mobile "Apuntar a mano" back with a second joystick — **ported** 2026-11-04 (`js/core/touch.js`, `handAim` in `js/entities/player.js`).
- Per-Pokémon ranking 10 min, public profile 6 h — **skipped**: their ranking/servers.
- Mobile: take the joystick outside the card box — **ported** 2026-11-04 (`js/core/touch.js`, `css/style.css`).
- Mobile portrait top bar in two lines — **ported** 2026-11-04 (upstream's CSS).
- Gacha with gamepad: no accidental re-rolls; Skip/Continue selectable — **ported** 2026-11-04 (`js/core/gamepad.js`, `data-nofocus`).
- Orbs with gamepad hints — **ported** 2026-11-04 (X uses, Y switches; AUTO moved from X to Select (`js/core/gamepad.js`)).
- Co-op weather abilities from guests — **ported** 2026-11-04 (`wq` event in `js/net/coop.js`).
- Co-op: stuck when a "done picking" message is lost — **already in PokéGo** (`reconcile` in `js/net/coop.js` checks it in every frame).
- Cloud save: spending what was already spent on another device made tickets grow and then drop — **ported** 2026-11-04 (`forgive` in `js/core/db.js`: the debt is written off once in the shared `led.fix` entry, so the balance always equals the ledger sum; tests in `tests/save.test.cjs`). Upstream's code is not readable, so this is PokéGo's own design.
- Cloud save: Save soon after another Save said "in X s" and was never uploaded if you left first — **ported** 2026-11-04 (`SAVE_GAP` 10 s and `wanted` in `js/core/db.js`, upstream's wait is not published; leaving uploads at once: `pagehide`, going to the Home Screen with a Save pending, logout, and `flush` before an update reload).
- Cloud save: earned on one device while saving on another, then "everything is saved" and no upload — **ported** 2026-11-04 (`openCloud` compares the content with `sameSave` instead of the dates).
- Cloud save: opening with no connection played with the old copy until Save — **already in PokéGo** (`openCloud` leaves `pending` set; the `online` event and `scheduleRetry` run `pushNow`, which merges with the cloud; test in `tests/save.test.cjs`).
- Music keeps playing distorted when minimised — **ported** 2026-11-04 (`js/core/audio.js`, touch devices on the web; the Android app already did it).
- Arceus's Judgment: leaving the arena at high speed — **ported** 2026-11-04 (`clampIn` in `js/systems/judgment.js`).
- Co-op: disconnected teammate still chased — **ported** 2026-11-04 (`absent` after `QUIET_MS` in `js/net/coop.js`; enemies and Arceus skip them).
- Ranking fixes (several) — **skipped**: their ranking.
- Two tabs in the same browser share changes — **ported** 2026-11-04 (`storage` event and merge in `js/core/db.js`).

### 2026-10-24 · Ataques en la colección y ventanas del menú
- Collection: bigger move icons with a tooltip — **ported** 2026-11-04 (`js/ui/menu.js`, upstream's `.move-tip` CSS).
- Menu windows close when clicking outside — **ported** 2026-11-04 (`js/ui/ui.js`).
- Kecleon Shop / News windows start below the top bar — **ported** 2026-11-02 (CSS).

### 2026-10-23 · Ranking de daño a Arceus y Tablas
- YouTube button — **skipped**: promotion.
- Ranking split (damage to Arceus / time) — **skipped**: their ranking rewrite.
- Arceus can be hit (tiny damage share); Plates give Arceus a random type — **ported** 2026-11-04 (`js/systems/judgment.js`, `js/systems/combat.js`; share 5 % falling with time, upstream's number is not published).
- Minute 35: Arceus breaks everyone's item — **ported** 2026-11-04 (`js/systems/judgment.js`).
- Judgment legendaries +25 % HP / +15 % damage each instead of ×2 — **ported** 2026-11-04 (`js/systems/judgment.js`); no 45-min ranking cap — **skipped**: their ranking.
- Evolved moves keep their name with "+" — **ported** 2026-11-04 (names derived in `js/data/moves.js` and `G.T` in `js/core/i18n.js`).
- Meteor Mash 34 → 24 damage, smaller area — **ported** 2026-11-02 (`js/data/moves.js`; radius 54 → 48, upstream's exact radius is not published).
- Judgment: poison/burn deal small fixed damage to legendaries — **ported** 2026-11-04 (2 per stack per tick, `js/entities/enemy.js`; upstream's number is not published).

### 2026-10-22 · Esferas, Amuletos Iris y gacha ×100
- Mystery Dungeon Orbs (6 single-use items, keys 5-8) — **ported** 2026-11-04 (`js/systems/orbs.js`; drop rates are PokéGo's own, upstream's are not published).
- Iris Charms per region (shiny rate ×2 in that banner) — **ported** 2026-11-04 (derived from `save.owned` in `js/systems/gacha.js`).
- Gacha ×100 — **ported** 2026-11-04 (the ×1 pull is gone, as upstream (`js/systems/gacha.js`, `js/ui/gacha-ui.js`)). Skip button — **already in PokéGo**.
- Co-op: "La sala se ha cerrado" for guests mid-run; 45 s pause on host drop; waiting in the room — **ported** 2026-11-04 (`js/net/coop.js`, `net.js`, `coderoom.js`, `social.js`; host closing the browser leaves guests a 45 s wait and a lobby note).
