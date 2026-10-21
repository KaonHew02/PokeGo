/* ============ google-config.js — Google Drive (copia de la partida) ============
 * ID de cliente OAuth (tipo "Aplicación web") de tu proyecto de Google Cloud,
 * para los botones "Guardar en Google Drive" y "Cargar de Google Drive" de
 * Ajustes > Cuenta (js/core/gdrive.js). Los pasos están en docs/GOOGLE_DRIVE.md.
 *
 * No es secreto: va en la web, como el de Firebase. NUNCA pongas aquí el
 * "secreto de cliente" (no hace falta).
 *
 * Con null no salen los botones de Drive (la copia en archivo funciona igual).
 */
G.GOOGLE_CLIENT_ID = null;

/* Ejemplo de cómo debe quedar:
G.GOOGLE_CLIENT_ID = '1234567890-abcdefghijklmnop.apps.googleusercontent.com';
*/
