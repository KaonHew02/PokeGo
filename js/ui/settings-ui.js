/* ============ settings-ui.js — pantalla de Ajustes (PC y móvil) ============
 * Se abre por encima de lo que haya (menú o pausa) y al cerrar vuelve ahí.
 * Pestañas: Sonido · Gráficos · Controles · Accesibilidad · Cuenta · Acerca de.
 * Los ajustes son de este dispositivo (G.Settings / G.Audio en el navegador).
 * En Cuenta, la copia de seguridad de la partida (archivo y Google Drive).
 */
G.SettingsUI = (() => {
  const $ = G.UI.$;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VERSION = '1.2 · 2026-10-09';
  const REPO = 'https://github.com/JPTER78/pokesurvivor';
  let tab = 'sound';

  function init() {
    document.querySelectorAll('#set-tabs .gen-tab').forEach(b => { b.onclick = () => { tab = b.dataset.t; render(); }; });
    // En el móvil no hay apuntado a mano (siempre apunta solo): fuera la pestaña, que sólo tenía eso.
    if (G.Settings.touch) document.querySelector('#set-tabs [data-t="a11y"]').classList.add('hidden');
    // Al conectar o quitar un mando con Controles abierto, se ve al momento.
    for (const ev of ['gamepadconnected', 'gamepaddisconnected']) addEventListener(ev, () => { if (isOpen() && tab === 'ctl') render(); });
    $('set-close').onclick = close;
    $('btn-settings').innerHTML = G.Icons.html('gear', 20);
    $('btn-settings').onclick = () => open();
    $('btn-pause-settings').onclick = () => open('sound');
    // Pantalla completa (si el navegador la permite; en iPhone, cómo conseguirla).
    if (canFull() || iosTip()) {
      $('btn-full').classList.remove('hidden');
      $('btn-full').innerHTML = G.Icons.html('full', 20);
      $('btn-full').onclick = toggleFull;
    }
  }

  function open(t) {
    if (t) tab = t;
    $('scr-settings').classList.remove('hidden');
    render();
  }
  function close() { $('scr-settings').classList.add('hidden'); if (askEnd) askEnd(false); }
  const isOpen = () => !$('scr-settings').classList.contains('hidden');

  // ---------------- pantalla completa ----------------
  function canFull() { return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled); }
  function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  // iPhone: Safari no deja poner una web a pantalla completa (por eso a veces
  // no salía la opción). Sí se puede abriéndola desde la pantalla de inicio.
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => !!navigator.standalone || (window.matchMedia && matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches);
  function iosTip() { return IOS && !canFull() && !standalone(); }
  const IOS_TIP = 'En iPhone, Safari no deja poner las webs a pantalla completa. Pulsa Compartir y luego "Añadir a pantalla de inicio": abriendo el juego desde ese icono se juega a pantalla completa.';
  function toggleFull() {
    if (!canFull()) { if (iosTip()) G.UI.toast(IOS_TIP, 9000); return; }
    if (isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const el = document.documentElement;
      const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      // En móvil, además se intenta fijar la pantalla en horizontal.
      if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* nada */ } }).catch(() => {});
    }
    setTimeout(() => { if (isOpen()) render(); }, 300);
  }

  // ---------------- piezas ----------------
  function section(title, sub) { return `<h3 class="set-h">${esc(title)}</h3>${sub ? `<p class="sub">${sub}</p>` : ''}`; }
  function toggle(key, label, desc) {
    const on = !!G.Settings.get(key);
    return `<div class="set-row"><div class="grow"><b>${esc(label)}</b><small>${esc(desc)}</small></div>
      <button class="btn small switch ${on ? 'gold' : ''}" data-k="${key}">${on ? 'Sí' : 'No'}</button></div>`;
  }
  function choice(key, opts) {
    const cur = G.Settings.get(key);
    return `<div class="chips set-chips">${opts.map(([v, l]) => `<button class="chip ${v === cur ? 'on' : ''}" data-k="${key}" data-v="${v}">${esc(l)}</button>`).join('')}</div>`;
  }

  function render() {
    document.querySelectorAll('#set-tabs .gen-tab').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    const box = $('set-body');
    box.scrollTop = 0;
    if (tab === 'sound') {
      box.innerHTML = section('Sonido') + '<div id="set-sound" class="sound-inline"></div>';
      G.UI.soundControls($('set-sound'));
    } else if (tab === 'gfx') {
      const auto = ['baja', 'media', 'alta'][G.Settings.autoLevel];
      box.innerHTML = section('Idioma', 'El juego se recarga al cambiarlo.')
        + `<div class="chips set-chips" translate="no">${G.I18n.choices.map(([v, l]) =>
             `<button class="chip ${G.I18n.lang === v ? 'on' : ''}" data-lang="${v}">${l}</button>`).join('')}</div>`
        + section('Calidad', 'Cuántos efectos y partículas se dibujan. <b>Auto</b> la baja sola si el juego va a tirones (ahora: ' + auto + ').')
        + choice('quality', [['auto', 'Auto'], ['high', 'Alta'], ['mid', 'Media'], ['low', 'Baja']])
        + section('Pantalla')
        + toggle('dmgNumbers', 'Números de daño', 'Los números que salen al golpear y al recibir daño.')
        + toggle('calm', 'Menos sacudidas y destellos', 'La cámara tiembla menos y los fogonazos son suaves.')
        + toggle('fps', 'Mostrar FPS', 'Fotogramas por segundo, en la esquina de abajo.')
        + (canFull() ? `<div class="set-row"><div class="grow"><b>Pantalla completa</b><small>Sin barras del navegador.</small></div>
             <button class="btn small" id="set-full">${isFull() ? 'Salir' : 'Activar'}</button></div>`
           : iosTip() ? `<div class="set-row"><div class="grow"><b>Pantalla completa</b><small>${esc(IOS_TIP)}</small></div></div>` : '');
    } else if (tab === 'ctl') {
      const pn = G.Pad.name;
      box.innerHTML = section('Con mando', pn
          ? 'Mando conectado: <b translate="no">' + esc(pn.replace(/\s*\(.*$/, '')) + '</b>'
          : 'Xbox, PlayStation, Switch y la mayoría de mandos USB o Bluetooth. Conéctalo y pulsa cualquier botón.')
        + toggle('gamepad', 'Usar mando', 'Moverte, cambiar de ataque y manejar los menús con el mando.')
        + toggle('padRumble', 'Vibración', 'El mando vibra al recibir daño (si el mando y el navegador lo permiten).')
        + `<div class="keys">
             <div><span class="padkey">Stick izq.</span> o <span class="padkey">Cruceta</span></div><span>moverse · elegir en los menús</span>
             <div><span class="padkey">LB</span> / <span class="padkey">RB</span></div><span>ataque anterior / siguiente</span>
             <div><span class="padkey">Start</span></div><span>pausa</span>
             <div><span class="padkey">A</span></div><span>pulsar (en los menús) · saltar la animación de Arceus</span>
             <div><span class="padkey">B</span></div><span>atrás / cerrar</span>
             <div><span class="padkey">Y</span></div><span>cambiar las cartas al subir de nivel</span>
             <div><span class="padkey">X</span></div><span>modo automático (AUTO)</span>
             <div><span class="padkey">Stick der.</span></div><span>desplazar las listas · apuntar (si activas Apuntar a mano en Accesibilidad)</span>
           </div>`
        + section('En móvil o tablet')
        + `<p class="sub">Pon el dedo en cualquier parte y arrastra para moverte: el joystick aparece donde tocas. Toca un ataque de abajo para cambiarlo y el botón de arriba a la derecha para pausar. Se juega en horizontal.</p>`
        + `<p class="sub">El botón AUTO, arriba a la derecha, hace que tu Pokémon se mueva y elija solo; si te mueves tú, mandas tú. Las partidas con AUTO no van al ranking.</p>`
        + `<div class="set-row"><div class="grow"><b>Tamaño del joystick</b><small>Cuánto hay que arrastrar el dedo.</small></div></div>`
        + choice('stick', [[0.8, 'Pequeño'], [1, 'Normal'], [1.25, 'Grande']])
        + `<div class="set-row"><div class="grow"><b>Colocar los botones</b><small>Pon los ataques, la pausa y el joystick (fijo, si quieres) donde quieras de la pantalla.</small></div>
             <button class="btn small" id="set-layout">Colocar</button></div>`
        + section('En PC')
        + `<div class="keys">
             <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> o flechas</div><span>moverse</span>
             <div><kbd>1</kbd>–<kbd>4</kbd> o clic en el icono</div><span>elegir ataque</span>
             <div><kbd>Q</kbd> / <kbd>E</kbd></div><span>ataque anterior / siguiente</span>
             <div><kbd>Esc</kbd> o <kbd>P</kbd></div><span>pausa</span>
             <div><kbd>T</kbd></div><span>modo automático (AUTO)</span>
             <div><kbd>1</kbd>–<kbd>3</kbd></div><span>elegir carta al subir de nivel</span>
           </div>`;
    } else if (tab === 'a11y') {
      box.innerHTML = section('Apuntado')
        + toggle('aimManual', 'Apuntar a mano', 'Tus ataques van hacia el ratón (o hacia donde empujes el stick derecho del mando) en vez de al enemigo más cercano. Si sueltas el stick y no mueves el ratón, vuelve a apuntar solo. La cadena y los meteoros siguen buscando a los enemigos solos.');
    } else if (tab === 'acc') {
      renderAccount(box);
    } else {
      box.innerHTML = `<div class="about-logo">PokéGo</div><p class="sub center">Versión ${esc(VERSION)}</p>`
        + `<p class="sub center">Basado en PokéSurvivor, de JPTER78.</p>`
        + `<p class="sub">Juego de fans <b>gratuito y sin ánimo de lucro</b>: sin anuncios ni compras. Pokémon y sus personajes son propiedad de Nintendo, Creatures y GAME FREAK; este proyecto no está afiliado a ellos.</p>`
        + section('Créditos')
        + `<ul class="credits">
             <li><b>Sprites:</b> PMD SpriteCollab y sus artistas (CC BY-NC 4.0).</li>
             <li><b>Datos de los Pokémon:</b> PokéAPI.</li>
             <li><b>Música y sonidos:</b> originales, generados por el propio juego.</li>
             <li><b>Fuente:</b> Pixelify Sans (OFL).</li>
           </ul>`
        + `<div class="row wrap" style="justify-content:center;gap:8px">
             ${window.PS_PAGES ? `<a class="btn small" href="${G.I18n.lang === 'en' ? 'en/guide/' : 'guia/'}" target="_blank">Guía y preguntas</a>
             <a class="btn small" href="${G.I18n.lang === 'en' ? 'en/pokedex/' : 'pokedex/'}" target="_blank">Pokédex</a>` : ''}
             <button class="btn small" data-legal>Aviso legal y privacidad</button>
             <a class="btn small" href="${REPO}" target="_blank" rel="noopener">Código (GitHub)</a>
           </div>`;
    }
    wire(box);
  }

  function renderAccount(box) {
    const st = G.DB.guest ? 'guest' : G.DB.syncState;
    const SYNC = { ok: 'Guardado en la nube', syncing: 'Guardando…', pending: 'Pendiente de subir (se sube al salir del juego)',
                   offline: 'Sin conexión: se subirá al volver', local: 'Guardado sólo en este navegador', guest: 'Invitado: no se guarda' };
    if (G.DB.guest) {
      box.innerHTML = section('Cuenta', 'Estás jugando como <b>invitado</b>: tu progreso no se guarda al salir.')
        + `<button class="btn gold" id="set-login">Crear cuenta o entrar</button>`
        + section('Copia de seguridad', 'Como invitado, descarga tu partida y luego impórtala al crear una cuenta.')
        + backupHtml(false);
      return;
    }
    const nick = G.Social.me ? G.Social.me.name : (G.DB.user || '');
    const kind = G.DB.mode === 'local' ? 'Cuenta de este navegador' : G.DB.nameAccount ? 'Nombre y contraseña' : 'Google';
    box.innerHTML = section('Cuenta')
      + `<div class="set-row"><div class="grow"><b>Apodo</b><small>Es único y no se puede cambiar.</small></div><span class="gold" translate="no">${esc(nick)}</span></div>`
      + `<div class="set-row"><div class="grow"><b>Tipo de cuenta</b></div><span>${esc(kind)}</span></div>`
      + `<div class="set-row"><div class="grow"><b>Partida</b></div><span>${esc(SYNC[st] || st)}</span></div>`
      + `<div class="row wrap" style="gap:8px;margin-top:12px">
           <button class="btn" id="set-logout">Cerrar sesión</button>
           <button class="btn danger" id="set-delete">Borrar cuenta</button>
         </div><p class="note" id="set-msg"></p>`
      + section('Copia de seguridad', 'Descarga tu partida en un archivo y guárdalo donde quieras (por ejemplo, en Google Drive). Para recuperarla, impórtala aquí, en este u otro navegador.')
      + backupHtml(true) + driveHtml();
    G.Drive.preload();       // el script de Google, ya: al pulsar, la ventana tiene que abrirse al momento
  }

  // ---------------- copia de seguridad (archivo y Google Drive) ----------------
  const inRun = () => G.Game.state !== 'ui';
  const RUN_MSG = 'Vuelve al menú para importar o usar Google Drive.';
  // Lo que puede salir mal al importar o con Drive (why de G.DB.importSave y G.Drive).
  const BK_ERR = {
    bad: 'Ese archivo no es una partida de PokéGo.',
    newer: 'Ese archivo es de una versión más nueva del juego: actualiza antes de importarlo.',
    run: RUN_MSG, guest: 'Inicia sesión primero.',
    none: 'No hay ninguna partida tuya en Google Drive.',
    damaged: 'La copia de Google Drive está dañada: bórrala de tu Drive y vuelve a guardar.',
    net: 'Google Drive no respondió. Vuelve a probar en un momento.',
    closed: 'Has cerrado la ventana de Google sin dar permiso.',
    blocked: 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes.',
    expired: 'La sesión de Google ha caducado: pulsa el botón otra vez.',
    denied: 'Hace falta dar permiso a PokéGo para guardar en tu Google Drive.',
    load: 'No se pudo conectar con Google. Comprueba tu conexión o el bloqueador de anuncios.',
    api: 'Google Drive rechazó la petición (mira docs/GOOGLE_DRIVE.md).'
  };
  const bkErr = r => G.UI.toast(BK_ERR[r.why] || BK_ERR.bad, 5000);

  function backupHtml(full) {
    const off = full && inRun() ? 'disabled' : '';
    return `<div class="row wrap" style="gap:8px">
        <button class="btn" id="set-export">Descargar partida</button>
        ${shareFile('{}', 'x.json') ? '<button class="btn" id="set-share">Compartir archivo</button>' : ''}
        ${full ? `<button class="btn" id="set-import" ${off}>Importar partida</button>` : ''}
      </div>${full ? '<input type="file" id="set-import-file" accept=".json,.txt,application/json,text/plain" hidden>' : ''}
      ${off ? `<p class="note">${RUN_MSG}</p>` : ''}`;
  }

  function driveHtml() {
    if (!G.Drive.enabled) {
      // Sin ID de cliente (google-config.js) no sale nada: configurarlo es cosa de quien publica el juego.
      return G.Drive.configured
        ? section('Google Drive') + '<p class="note">Google Drive sólo funciona con el juego abierto desde una web, no con doble clic.</p>' : '';
    }
    const at = G.Drive.lastAt(), off = inRun() ? 'disabled' : '';
    return section('Google Drive', 'Guarda tu partida en tu propio Google Drive (carpeta PokéGo) y cárgala en otro aparato. Sólo se conecta cuando pulsas estos botones.')
      + `<div class="row wrap" style="gap:8px">
           <button class="btn" id="set-drive-save" ${off}>Guardar en Google Drive</button>
           <button class="btn" id="set-drive-load" ${off}>Cargar de Google Drive</button>
         </div>`
      + (at ? `<div class="set-row"><div class="grow"><b>Última copia en Drive</b></div><span translate="no">${esc(when(at))}</span></div>` : '')
      + `<p class="note" id="set-drive-msg"></p>`;
  }

  const when = t => new Date(t).toLocaleString(G.I18n.locale, { dateStyle: 'medium', timeStyle: 'short' });

  /** La partida como archivo: { json, name } (pokego-<nombre>-<fecha>.json). */
  function backupFile() {
    const d = G.DB.exportSave();
    if (!d) return null;
    const t = new Date(), p = n => String(n).padStart(2, '0');
    const who = String(d.name || '').replace(/[^\p{L}\p{N}_-]/gu, '') || 'partida';
    return { json: JSON.stringify(d), name: `pokego-${who}-${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}.json` };
  }
  // Compartir (en el móvil, "Guardar en Drive" desde el menú de compartir). Chrome no
  // deja compartir .json: entonces va como .txt (Importar partida también los acepta).
  function shareFile(json, name) {
    if (!navigator.canShare || typeof File !== 'function') return null;
    for (const [n, type] of [[name, 'application/json'], [name.replace(/\.json$/, '.txt'), 'text/plain']]) {
      try { const f = new File([json], n, { type }); if (navigator.canShare({ files: [f] })) return f; } catch (e) { /* nada */ }
    }
    return null;
  }
  // El selector de archivos, compartir y la ventana de Google sólo se abren tras un clic,
  // un toque o una tecla de verdad: el mando no cuenta (gamepad.js simula el clic).
  function gesture() {
    const u = navigator.userActivation;
    if (!u || u.isActive) return true;
    G.UI.toast('Esto abre una ventana del navegador: púlsalo con el ratón, el teclado o la pantalla táctil.', 4000);
    return false;
  }

  /*
   * Ventana "¿Seguro?" dentro del juego (no confirm(): con el mando no se puede
   * contestar). Como confirmDelete (ui.js). "Cancelar" acaba en -back para que el
   * botón B del mando lo pulse; Esc cierra Ajustes y, con ellos, esta ventana.
   */
  let askEnd = null;
  function ask(title, html, yes) {
    if (askEnd) askEnd(false);
    return new Promise(done => {
      const el = document.createElement('section');
      el.className = 'scr dim';
      el.style.zIndex = 70;
      el.innerHTML = `<div class="box center" style="max-width:420px">
        <h3>${esc(title)}</h3>${html}
        <div style="display:flex;gap:8px;margin-top:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn ghost" id="set-ask-back">Cancelar</button>
          <button class="btn gold" data-a="yes">${esc(yes)}</button>
        </div></div>`;
      document.body.appendChild(el);
      const end = v => { if (askEnd !== end) return; askEnd = null; el.remove(); done(v); };
      askEnd = end;
      el.querySelector('#set-ask-back').onclick = () => end(false);
      el.querySelector('[data-a=yes]').onclick = () => end(true);
      setTimeout(() => { if (el.isConnected) el.querySelector('[data-a=yes]').focus(); }, 50);
    });
  }

  /** Importa una copia (archivo o Drive) tras confirmarlo; después, al menú con la partida nueva. */
  async function restore(data) {
    const r = G.DB.importSave(data, { dry: true });
    if (!r.ok) { bkErr(r); return; }
    const at = data.at ? when(data.at) : '';
    const ok = await ask('Importar partida',
      `<p class="sub">${r.mode === 'replace' ? 'Tu cuenta es nueva: se quedará con la partida de la copia.'
        : '¿Importar esta partida? Se juntará con la tuya: no perderás nada de lo que ya tienes.'}</p>
       <p translate="no"><b class="gold">${esc(data.name || '')}</b>${at ? ' · ' + esc(at) : ''}</p>
       ${r.added ? `<p class="sub">Trae ${r.added} Pokémon que no tienes.</p>` : ''}`, 'Importar');
    if (!ok) return;
    const res = G.DB.importSave(data);
    if (!res.ok) { bkErr(res); return; }
    close();
    G.UI.toast(res.added > 1 ? `Partida importada: ${res.added} Pokémon nuevos.` : res.added ? 'Partida importada: 1 Pokémon nuevo.' : 'Partida importada.', 4000);
    G.Flow.afterLogin();
  }

  function wireBackup() {
    const ex = $('set-export');
    if (ex) ex.onclick = () => {
      const d = backupFile();
      if (!d) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([d.json], { type: 'application/json' }));
      a.download = d.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      G.UI.toast('Partida descargada');
    };
    const sh = $('set-share');
    if (sh) sh.onclick = async () => {
      const d = backupFile(), f = d && shareFile(d.json, d.name);
      if (!f || !gesture()) return;
      try { await navigator.share({ files: [f], title: 'PokéGo' }); }
      catch (e) { if (!e || e.name !== 'AbortError') G.UI.toast('No se pudo compartir el archivo.'); }
    };
    const im = $('set-import'), file = $('set-import-file');
    if (im) im.onclick = () => {
      if (inRun()) { G.UI.toast(RUN_MSG); return; }
      if (!gesture()) return;
      file.value = '';
      file.click();
    };
    if (file) file.onchange = async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      let data = null;
      try { if (f.size < 5e6) data = JSON.parse(await f.text()); } catch (e) { /* no es un JSON */ }
      restore(data);
    };
    // Google Drive: el permiso se pide en el mismo clic (G.Drive.save/load, antes de esperar nada).
    const ds = $('set-drive-save'), dl = $('set-drive-load');
    const busy = on => {
      for (const b of [ds, dl]) if (b) b.disabled = on;
      const m = $('set-drive-msg'); if (m) m.textContent = on ? 'Conectando con Google Drive…' : '';
    };
    const drive = async (op, then) => {
      if (inRun()) { G.UI.toast(RUN_MSG); return; }
      if (G.Drive.needsPopup && !gesture()) return;
      const p = G.Drive[op]();
      busy(true);
      const r = await p;
      busy(false);
      if (!r.ok) { bkErr(r); return; }
      if (isOpen() && tab === 'acc') render();      // la fecha de la última copia
      then(r);
    };
    if (ds) ds.onclick = () => drive('save', () => {
      G.UI.toast('Partida guardada en Google Drive', 3000);
      G.UI.refreshCoins();
      if (G.UI.isOpen('scr-menu')) G.MenuUI.open();   // lo que traía la copia de Drive, ya en el menú
    });
    if (dl) dl.onclick = () => drive('load', r => restore(r.data));
  }

  function wire(box) {
    box.querySelectorAll('.switch[data-k]').forEach(b => { b.onclick = () => { G.Settings.set(b.dataset.k, !G.Settings.get(b.dataset.k)); render(); }; });
    box.querySelectorAll('.chip[data-k]').forEach(b => {
      b.onclick = () => { const v = b.dataset.v; G.Settings.set(b.dataset.k, isNaN(+v) ? v : +v); render(); };
    });
    const full = $('set-full'); if (full) full.onclick = toggleFull;
    const lay = $('set-layout'); if (lay) lay.onclick = () => G.LayoutUI.open();
    box.querySelectorAll('[data-lang]').forEach(b => { b.onclick = () => { if (b.dataset.lang !== G.I18n.lang) G.I18n.set(b.dataset.lang); }; });
    const lo = $('set-login'); if (lo) lo.onclick = () => { close(); leave(); };
    const out = $('set-logout'); if (out) out.onclick = () => { close(); leave(); };
    const del = $('set-delete');
    if (del) del.onclick = async () => {
      const ok = await G.UI.confirmDelete();
      if (!ok) return;
      del.disabled = true;
      const r = await G.DB.deleteAccount(ok.pass);
      if (!r.ok) { $('set-msg').textContent = r.error; del.disabled = false; return; }
      close();
      G.UI.toast('Cuenta borrada');
      G.Audio.music(null);
      G.Flow.toLogin();
    };
    wireBackup();
  }

  /** Cerrar sesión (si estás en una partida, se abandona). */
  function leave() {
    if (G.DB.guest && !confirm('Eres invitado: se perderá todo el progreso. ¿Salir?')) return;
    if (G.Game.state !== 'ui') G.Game.quit && G.Game.quit();
    G.Audio.music(null);
    G.DB.logout().then(() => G.Flow.toLogin());
  }

  return { init, open, close, get isOpen() { return isOpen(); } };
})();
