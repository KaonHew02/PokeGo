/* ============ firebase-config.js — conexión con tu proyecto de Firebase ============
 * Pega aquí la configuración de tu app web de Firebase (Consola de Firebase >
 * Configuración del proyecto > Tus apps > SDK setup and configuration > Config).
 * Los pasos completos están en docs/FIREBASE.md.
 *
 * Estos datos NO son secretos: Firebase los diseña para ir en la web. Lo que
 * protege las partidas son las reglas de Firestore (firestore.rules).
 *
 * Si se pone a null, el juego funciona en modo local (sólo en el navegador).
 */
// Proyecto de PokéGo: pokego-ec220 (plan gratuito Spark, creado el 21-10-2026).
// ¡No pulsar nunca "Upgrade/Blaze" ni "Identity Platform" en su consola: cobran!
// Las webs desde las que se usa van en HOSTS (js/core/db.js) y en los dominios
// autorizados de Authentication.
G.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAJ2r6KaDCdwTzb6nv3HalDNxTl85BH4Ng',
  authDomain: 'pokego-ec220.firebaseapp.com',
  databaseURL: 'https://pokego-ec220-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'pokego-ec220',
  storageBucket: 'pokego-ec220.firebasestorage.app',
  messagingSenderId: '604225746330',
  appId: '1:604225746330:web:a457f85248ef10724b7623'
};

/* Ejemplo de cómo debe quedar:
G.FIREBASE_CONFIG = {
  apiKey: 'AIza...',
  authDomain: 'tu-proyecto.firebaseapp.com',
  projectId: 'tu-proyecto',
  storageBucket: 'tu-proyecto.firebasestorage.app',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abc123',
  // Realtime Database (amigos en línea, invitaciones y salas): sin esto no hay salas de amigos.
  databaseURL: 'https://tu-proyecto-default-rtdb.europe-west1.firebasedatabase.app'
};
*/
