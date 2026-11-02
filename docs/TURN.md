# Puente TURN para jugar en grupo

Las partidas en grupo van **directas** de un navegador a otro (WebRTC). Para
encontrarse se usan los STUN gratuitos de Google, pero algunas redes (datos
móviles, routers con NAT estricta) no dejan conectar así: la sala se queda en
«Conectando…» y luego «No se pudo conectar (reintentando…)».

Con un servidor **TURN** esas parejas también pueden jugar: la partida pasa por
él, cifrada de navegador a navegador (el TURN no puede leerla). Si se puede
conectar directo, el navegador sigue yendo directo y el TURN no gasta nada.

PokéGo usa el plan gratuito de **Metered** (Open Relay, 20 GB al mes).
Los TURN públicos sin cuenta (los de PeerJS y el `staticauth` de Open Relay)
ya no funcionan (comprobado el 23-10-2026).

## Pasos

1. Crea una cuenta gratuita en <https://www.metered.ca/tools/openrelay/>
   y quédate en el plan gratuito (sin añadir tarjeta).
2. Crea una app (por ejemplo `pokego`): su dirección será `pokego.metered.live`.
3. En el panel, en el apartado del servidor TURN, copia la dirección del ejemplo
   para pedir las credenciales, con tu clave:
   `https://pokego.metered.live/api/v1/turn/credentials?apiKey=TU_CLAVE`
4. Ponla en `js/core/turn-config.js` (`G.TURN_URL = '…'`) y vuelve a generar el
   juego (`node tools/build.js && node tools/export_data.js && python tools/make_seo_pages.py`).

La clave va en la web (como la de Firebase): quien la vea podría gastar los GB
del mes. Por eso, mejor el plan gratuito sin tarjeta.

## Cómo funciona (js/net/net.js)

- Al abrir una sala se piden las credenciales a esa dirección (una vez; se
  renuevan a las 12 h). Si no llegan en 4 s, se juega sólo con STUN y se vuelve
  a probar al minuto.
- Las dos salas las usan: las de amigos (cada `RTCPeerConnection`) y las de
  código (la config del `Peer` de PeerJS).
- Se acepta sólo lo que parece un servidor `stun:`, `turn:` o `turns:` (con
  usuario y clave), como mucho 8.
- En la sala, el anfitrión ve «Conectado (por servidor)» cuando una conexión va
  por el TURN.
