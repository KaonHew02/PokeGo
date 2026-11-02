/* ============ turn-config.js — puente (TURN) para jugar en grupo ============
 * Si vuestras redes no dejan conectar directamente (datos móviles, algunos
 * routers), los navegadores no se ven y la sala se queda en "Conectando…" /
 * "No se pudo conectar". Con un servidor TURN la partida pasa por él en esos
 * casos (cifrada de navegador a navegador: el TURN no puede leerla). Cuando se
 * puede conectar directo, el navegador sigue yendo directo.
 *
 * Dirección de credenciales de tu cuenta gratuita de Metered (metered.ca,
 * 20 GB al mes): en su panel, TURN Server → la del ejemplo de "Fetch
 * credentials", con tu clave. Los pasos están en docs/TURN.md.
 *
 * No es secreto (va en la web, como el de Firebase): quien la vea podría gastar
 * tus GB del mes. Por eso, mejor el plan gratuito sin añadir tarjeta.
 *
 * Con '' sólo se conecta directo (como antes).
 */
G.TURN_URL = '';

/* Ejemplo de cómo debe quedar:
G.TURN_URL = 'https://pokego.metered.live/api/v1/turn/credentials?apiKey=0123456789abcdef0123456789abcdef';
*/
