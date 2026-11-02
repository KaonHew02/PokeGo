# Upstream (PokéSurvivor) review log

Upstream: https://github.com/JPTER78/pokesurvivor (git remote `upstream`, branch `main`;
its `live` branch only holds YouTube video ids and is ignored).

Since 2026-10-30 upstream publishes only built files (obfuscated `js/app.min.js`). Changes are
reimplemented in PokéGo's own source from the readable material (the `novedades/` changelog,
`js/lang/*.js` dictionaries, `css/style.css`, data pages). Upstream's deletion of its source is
not a change to port.

**Last reviewed upstream commit: `90cdd94` (2026-11-01, "Mejoras internas") — reviewed 2026-11-02.**

Previous baseline: `ce57853` (2026-10-21, "La gran actualización: Tienda Kecleon"), ported into
PokéGo on 2026-10-22 (commit 49e3cbac, see CREDITS.md).

License check (2026-11-02): `LICENSE`, `LICENSE-NONCOMMERCIAL.md` and the README's license
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

## Changelog entries (upstream `novedades/`)

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
- "Anclado" (anchored) joystick option — **pending**.
- Weak Armor / Steadfast / Rattled no longer reset Agility charges — **ported** 2026-11-02 (`Player.addBuff`).
- Assault Vest outside the 70 % Armor cap — **already in PokéGo** (`js/systems/levelup.js`, fixed earlier).
- Very wide windows: enemies circling off-screen — **pending** (spawner).
- Personality traits translated in the starting quiz — **ported** 2026-11-02 (`js/ui/test.js`, en/it dictionaries).
- Arceus damage ranking fixes, ranking upload retries — **skipped**: their ranking rewrite / servers.
- Mobile: "Cambiar opciones" picking a card by itself; bond picking the move under the finger — **pending** (touch input).
- Co-op TURN fallback from either side — **skipped**: their TURN server (PokéGo has its own TURN work).
- Co-op slow connection: wait instead of queueing minutes of lag — **pending** (PokéGo's own co-op lag fix of 10-22 may already cover it; check).

### 2026-10-26 · Halloween se acerca
- Halloween event and countdown — **skipped**: no event code in PokéGo, dates over.
- Mobile login: no autocorrect/autocapitalize on the user name — **pending** (`dev.html` / login; main checkout has uncommitted login.js work).
- Mobile: joystick stuck on level-up with two fingers — **pending** (touch input).
- Top bar fits any screen (icon-only buttons, short amounts like 10 M) — **pending**.
- Mobile back button pauses / goes back — **pending** (web side; the Android app already does it in `js/core/native.js`).
- Mobile: centre notices wrap to fit — **pending**.
- Mobile: bottom/achievement notices no longer catch taps — **ported** 2026-11-02 (CSS `pointer-events: none`).
- Pause screen Defense / Sp. Def decimals — **ported** 2026-11-02 (`js/ui/run-ui.js`).
- Mobile: stray "·" on level/item cards; title phrase covering Play — **partly ported** 2026-11-02 (the `.splash` hidden in landscape); the "·" — **pending**.

### 2026-10-25 · Tickets y Pokémon iguales en todos tus aparatos
- End-of-run damage summary per move (tabs per player in co-op) — **pending** (big feature).
- Mobile "Apuntar a mano" back with a second joystick — **pending**.
- Per-Pokémon ranking 10 min, public profile 6 h — **skipped**: their ranking/servers.
- Mobile: take the joystick outside the card box — **pending**.
- Mobile portrait top bar in two lines — **pending**.
- Gacha with gamepad: no accidental re-rolls; Skip/Continue selectable — **pending** (main checkout has uncommitted gamepad.js work).
- Orbs with gamepad hints — **pending** (needs Mystery Dungeon orbs first).
- Co-op weather abilities from guests — **pending**.
- Co-op: stuck when a "done picking" message is lost — **pending**.
- Cloud-save fixes (several) — **skipped**: their cloud-save design (PokéGo keeps its own saving).
- Music keeps playing distorted when minimised — **pending** (main checkout has uncommitted audio.js work).
- Arceus's Judgment: leaving the arena at high speed — **pending**.
- Co-op: disconnected teammate still chased — **pending**.
- Ranking fixes (several) — **skipped**: their ranking.
- Two tabs in the same browser share changes — **pending**.

### 2026-10-24 · Ataques en la colección y ventanas del menú
- Collection: bigger move icons with a tooltip — **pending** (CSS is in upstream `css/style.css`, `.move-tip`).
- Menu windows close when clicking outside — **pending**.
- Kecleon Shop / News windows start below the top bar — **ported** 2026-11-02 (CSS).

### 2026-10-23 · Ranking de daño a Arceus y Tablas
- YouTube button — **skipped**: promotion.
- Ranking split (damage to Arceus / time) — **skipped**: their ranking rewrite.
- Arceus can be hit (tiny damage share); Plates give Arceus a random type — **pending** (big gameplay change).
- Minute 35: Arceus breaks everyone's item — **pending**.
- Judgment legendaries +25 % HP / +15 % damage each instead of ×2; no 45-min ranking cap — **pending** (balance; ranking part skipped).
- Evolved moves keep their name with "+" — **pending** (touches every language's evolved names).
- Meteor Mash 34 → 24 damage, smaller area — **ported** 2026-11-02 (`js/data/moves.js`; radius 54 → 48, upstream's exact radius is not published).
- Judgment: poison/burn deal small fixed damage to legendaries — **pending**.

### 2026-10-22 · Esferas, Amuletos Iris y gacha ×100
- Mystery Dungeon Orbs (6 single-use items, keys 5-8) — **pending** (big feature).
- Iris Charms per region (shiny rate ×2 in that banner) — **pending**.
- Gacha ×100 and Skip button — **pending**.
- Co-op: "La sala se ha cerrado" for guests mid-run; 45 s pause on host drop; waiting in the room — **pending** (PokéGo has its own 20 s reconnect from 10-22; compare first).
