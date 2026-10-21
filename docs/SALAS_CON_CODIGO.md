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
  invitado vuelve a llamar cada 5 s; si el servidor dice que el id del
  anfitrión ya no existe, la sala se ha cerrado.

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
  solo); después se le quita.
- El aviso de empezar (`k: 'start'`) y la partida son los de siempre
  (`social-ui.js`, `coop.js`). `net.js` sólo acepta el `start` del anfitrión.
- La sala se ve en `G.Social.room` con la forma de las de amigos (más `code`,
  `me` y `net`), así la pantalla de sala, el menú y la vuelta a la sala al acabar
  son los mismos. Las partidas de estas salas no suben al ranking.

## Pruebas

`node --test tests/net.test.cjs` incluye las salas con un PeerJS falso
(`tests/net-peerfake.cjs`): entrar, lista, sala llena, partida empezada,
versión distinta, código equivocado, servidor caído, código ocupado, salir,
cortes de conexión y el anfitrión que desaparece.
