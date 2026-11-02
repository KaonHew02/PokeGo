# La app de Android

PokéGo tiene dos versiones, **web** y **app**, y las dos son el mismo juego:

| | Web | App de Android |
|---|---|---|
| Dónde | GitHub Pages (`https://kaonhew02.github.io/PokeGo/`) | Un APK que se instala en el móvil |
| Carpeta | la raíz del proyecto | `app/` (proyecto de [Capacitor](https://capacitorjs.com/)) |
| Código | `index.html` + `js/app.min.js` | **los mismos**, copiados dentro del APK |
| Actualizar | `git push` (el updater recarga a los jugadores) | instalar un APK nuevo |

Lo que sólo pasa en la app está en `js/core/native.js` (`G.Native.app`); en
la web no hace nada:

- **Atrás** del móvil: cierra la ventana abierta o pausa la partida (como B en
  el mando). En el menú, dos veces seguidas cierra la app.
- Pantalla completa siempre, en horizontal, y la pantalla no se apaga
  (`MainActivity.java`).
- Al pasar a otra app, la partida se pausa y el sonido se calla.
- Los enlaces (guía, Pokédex, Ko-fi, GitHub) se abren en el navegador.
- **Descargar partida** abre el menú de compartir de Android (Drive, Archivos,
  WhatsApp...): dentro de la app no hay descargas.
- No hay: service worker, updater, botón de pantalla completa, **Entrar con
  Google** ni **Google Drive** (Google no deja iniciar sesión desde la ventana
  de una app). Se entra con nombre y contraseña, o como invitado.
- La nube (Firebase) funciona igual: la app abre el juego en
  `https://localhost`, que ya está en `HOSTS` (`js/core/db.js`).

## Lo que hace falta (una vez)

- Node.js (ya estaba) y Python con Pillow (ya estaba).
- **JDK 21**: `winget install Microsoft.OpenJDK.21`.
- **Android SDK** en `%LOCALAPPDATA%\Android\Sdk`: las *command-line tools* de
  <https://developer.android.com/studio#command-line-tools-only> descomprimidas
  en `cmdline-tools\latest`, y luego:
  ```
  android sdk install platform-tools
  android sdk install "platforms;android-36"
  android sdk install "build-tools;36.0.0"
  ```
  (`android.exe` está en `cmdline-tools\latest\bin`.) Con Android Studio
  también vale: instala todo eso solo.
- `app/android/local.properties` con la ruta del SDK (no se sube a git):
  `sdk.dir=C:/Users/<usuario>/AppData/Local/Android/Sdk`
- `cd app && npm install`

## Sacar el APK

1. Lo de siempre para la web (ver `CLAUDE.md`):
   `node tools/build.js && node tools/export_data.js && python tools/make_seo_pages.py`
2. `cd app && npm run apk`
   - copia la web a `app/www/` (`tools/build_app.js`; se niega si `index.html`
     no es del código actual),
   - la pasa al proyecto de Android (`npx cap sync android`),
   - y compila: **`app/android/app/build/outputs/apk/debug/app-debug.apk`**.

Ese APK se instala pasándolo al móvil (por USB, Drive, WhatsApp...) y
abriéndolo: Android pide permiso para "instalar apps de origen desconocido".
Con el móvil conectado por USB y la depuración USB activada, también:
`adb install -r app/android/app/build/outputs/apk/debug/app-debug.apk`.

Para que el móvil acepte un APK nuevo encima del anterior, sube
`versionCode` (y `versionName`) en `app/android/app/build.gradle`.

**Debug y release.** El APK de debug va firmado con una clave de pruebas de
este ordenador: sirve para instalarlo a mano. Para publicarlo en Google Play
hace falta un APK/AAB *release* firmado con una clave propia (`keytool` +
`signingConfigs` en `build.gradle`) y una cuenta de Google Play Console.

## Iconos y pantalla de carga

Salen de `assets/icons/icon-512.png` y `icon-maskable-512.png`:
`python tools/make_app_icons.py` (sólo si cambian esos iconos).

## Probar la app en el navegador

`python -m http.server 8124 --directory app/www` abre lo mismo que lleva el
APK, pero como web (sin `window.Capacitor`, `G.Native.app` es `false`).
