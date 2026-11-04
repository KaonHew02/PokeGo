# Jugar en grupo con código de sala (sin nube)

Sin Firebase (modo local) o jugando como invitado, el botón **Amigos** del menú
abre **Jugar en grupo**: un jugador crea una sala y pasa su código (5 letras o
números) a los demás, que lo escriben en **Unirse**. Hasta 4 jugadores. Con
cuenta en la nube, la pantalla de Amigos tiene además el botón **Jugar con código**.

Archivos: `js/net/coderoom.js` (salas), `js/net/net.js` (conexiones),
`js/ui/group-ui.js` (pantalla), `js/vendor/peerjs.min.js` (PeerJS 1.5.4, MIT).

## Cómo se conectan

- **PeerJS sólo presenta a los navegadores.** Su servidor público y gratuito
  (`0.peerjs.com`) reparte la negociación WebRTC (oferta, respuesta y
  candidatos). Después, PeerJS entrega el canal de datos (`serialization: 'raw'`)
  y `net.js` lo lleva como cualquier otro: negociación del binario (`net-cap`),
  envíos, estados (`connecting` / `direct` / `failed` / `closed`) y reintentos.
  `coop.js` no sabe por dónde ha llegado el canal.
- **Nada de la partida pasa por PeerJS.** Se usan sólo los STUN de Google de
  `net.js`; los TURN de PeerJS (que sí reenviarían datos) no se configuran. Igual
  que en las salas de amigos: si la red de alguno no deja conectar directo, esa
  pareja no puede jugar junta.
- La librería se carga sólo al abrir **Jugar en grupo** (la CSP `script-src
  'self'` ya la permite); no va en `app.min.js`.
- Ids en el servidor: el anfitrión `pokego-<código en minúsculas>` (si ya existe,
  se prueba otro código); cada invitado `pokego-g<12 al azar>`. Los códigos usan
  `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sin 0/O ni 1/I/L).
- Llama el invitado (el anfitrión no conoce su id). Si un canal se cae, el
  invitado vuelve a llamar enseguida durante 45 s (después, cada 5 s), también
  si el servidor dice que el id del anfitrión no existe: puede que sólo se haya
  cortado un momento. Pasados los 45 s, eso quiere decir que la sala se ha cerrado.

## Mensajes de la sala

Por el mismo canal, en JSON, `{ k: 'room', t, ... }`:

| De | `t` | Contenido |
| --- | --- | --- |
| invitado | `hello` | `name, dex, shiny, v` (huella de `app.min.js`, `'dev'` en dev.html), `p` (versión del protocolo). También al volver tras un corte y al cambiar de compañero. |
| anfitrión | `welcome` | `name` (el que te queda: si se repite, con un número), `members`, `open` |
| anfitrión | `no` | `why`: `full` (4), `started` (partida empezada) o `version` |
| anfitrión | `members` | la lista nueva, a todos, cada vez que cambia |
| invitado | `bye` | sale de la sala |
| anfitrión | `close` | cierra la sala (los invitados vuelven al menú con aviso) |

- El anfitrión manda en la lista. Quien llama y no se presenta no recibe nada
  de la partida y se le cuelga a los 20 s; a quien no puede entrar, al segundo
  de decirle por qué.
- Un invitado que pierde la conexión conserva su sitio 20 s (vuelve a llamar
  solo); después se le quita. Mientras se juega (sala cerrada) no se le quita: en
  la partida se le espera 45 s y, si se queda fuera, espera en la sala a que acaben
  los demás. Sólo al reabrir la sala se le vuelven a contar los 20 s.
- El aviso de empezar (`k: 'start'`) y la partida son los de siempre
  (`social-ui.js`, `coop.js`). `net.js` sólo acepta el `start` del anfitrión.
- La sala se ve en `G.Social.room` con la forma de las de amigos (más `code`,
  `me` y `net`), así la pantalla de sala, el menú y la vuelta a la sala al acabar
  son los mismos. Las partidas de estas salas no suben al ranking.

## Salas de amigos: cortes con la base de datos

Las salas de amigos también viven en la Realtime Database, y las reglas no dejan
volver a escribir tu plaza con la sala cerrada. Por eso el borrado automático de la
plaza (y de la sala, si eres el anfitrión) sólo está armado con la sala abierta
(`watchRoomDisconnect` en `social.js`). Si no, cortarse un momento con la base de
datos en plena partida borraba la plaza, se perdía el permiso de leer la sala y
salía «La sala se ha cerrado» aunque el canal directo fuera bien.

A cambio, quien cierra el navegador en plena partida deja atrás lo suyo:

- Invitado: su plaza se libera 20 s después de reabrir la sala (`freeSeats`).
- Anfitrión: la sala se queda en la base de datos (unos cientos de bytes). Sus
  invitados pierden la partida a los 45 s y vuelven a la sala, que avisa de que no
  puede conectar con el anfitrión; salen con **Salir de la sala**.

## Pruebas

`node --test tests/net.test.cjs` incluye las salas con un PeerJS falso
(`tests/net-peerfake.cjs`): entrar, lista, sala llena, partida empezada,
versión distinta, código equivocado, servidor caído, código ocupado, salir,
cortes de conexión y el anfitrión que desaparece.

`node --test tests/coop.test.cjs` juega partidas con cortes en las dos clases de
sala: `coop.js`, `net.js`, `coderoom.js`, `social.js` y `social-ui.js` de verdad,
con PeerJS, WebRTC y Realtime Database falsos.
