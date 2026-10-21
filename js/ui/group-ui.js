/* ============ group-ui.js — "Jugar en grupo" con código de sala ============
 * Sin nube (y como invitado), el botón Amigos del menú abre esta pantalla:
 * crear una sala (sale su código en la sala, con un botón para copiarlo) o
 * unirse a la de un amigo escribiendo su código. Lo demás (la sala, empezar,
 * volver a ella al acabar) es lo mismo que con las salas de amigos (social-ui.js).
 * La red está en js/net/coderoom.js.
 */
G.GroupUI = (() => {
  const $ = G.UI.$;
  const NAME = 'ps.roomName';           // el último nombre que usaste en una sala (en este navegador)
  let busy = false;

  function init() {
    $('grp-create').onclick = create;
    $('grp-join').onsubmit = e => { e.preventDefault(); join(); };
    // El código se escribe siempre en mayúsculas y sin espacios ni guiones.
    $('grp-code').oninput = () => {
      const el = $('grp-code'), v = G.CodeRoom.normal(el.value);
      if (v === el.value) return;
      const at = Math.min(el.selectionStart || v.length, v.length);
      el.value = v;
      try { el.setSelectionRange(at, at); } catch (e) { /* nada */ }
    };
    $('grp-back').onclick = () => { G.CodeRoom.cancel(); busy = false; G.MenuUI.open(); };
    $('lobby-copy').onclick = copy;
  }

  function open() {
    // Ya en una sala (de código o de amigos): a ella.
    if (G.Social.room) { G.LobbyUI.open(); return; }
    G.UI.show('scr-group', true);
    $('grp-name').value = savedName();
    if (!busy) { msg(''); setBusy(false); }
    // La librería de PeerJS se pide ahora (no con el juego): al pulsar, ya está.
    G.CodeRoom.load().catch(() => {});
  }

  function savedName() {
    let n = '';
    try { n = localStorage.getItem(NAME) || ''; } catch (e) { /* nada */ }
    return n || (G.Social.me && G.Social.me.name) || G.DB.user || '';
  }

  /** Tu nombre en la sala (se recuerda para la próxima). */
  function myName() {
    const n = $('grp-name').value.replace(/\s+/g, ' ').trim();
    if (!n) { msg('Escribe tu nombre para la sala.', true); $('grp-name').focus(); return null; }
    try { localStorage.setItem(NAME, n); } catch (e) { /* nada */ }
    return n;
  }

  function msg(t, bad) {
    $('grp-msg').textContent = t || '';
    $('grp-msg').classList.toggle('ok', !!t && !bad);
    if (t && bad) G.Audio.sfx('error');
  }

  function setBusy(b) {
    busy = b;
    $('grp-create').disabled = b;
    $('grp-join-btn').disabled = b;
  }

  async function create() {
    if (busy) return;
    const name = myName();
    if (!name) return;
    setBusy(true);
    msg('Creando la sala…');
    const r = await G.CodeRoom.create(name);
    done(r);
  }

  async function join() {
    if (busy) return;
    const code = G.CodeRoom.normal($('grp-code').value);
    if (code.length !== 5) { msg('El código de la sala tiene 5 letras o números.', true); $('grp-code').focus(); return; }
    const name = myName();
    if (!name) return;
    setBusy(true);
    msg('Buscando la sala ' + code + '…');
    const r = await G.CodeRoom.join(code, name);
    done(r);
  }

  function done(r) {
    if (!busy) return;                    // se ha vuelto atrás mientras tanto
    setBusy(false);
    if (!r.ok) { msg(r.error || '', !!r.error); return; }
    msg('');
    G.Audio.sfx('confirm');
    if (G.UI.isOpen('scr-group')) G.LobbyUI.open();
  }

  /** Sala: copia el código para pasárselo a los amigos. */
  function copy() {
    const room = G.Social.room;
    if (!room || !room.code) return;
    const ok = () => G.UI.toast('Código copiado: ' + room.code, 2400);
    const old = () => {
      // Sin permiso para el portapapeles: a la antigua (y si tampoco, se selecciona para copiarlo a mano).
      const t = document.createElement('textarea');
      t.value = room.code; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      let done = false;
      try { done = document.execCommand('copy'); } catch (e) { /* nada */ }
      t.remove();
      if (done) { ok(); return; }
      const sel = getSelection(), range = document.createRange();
      range.selectNodeContents($('lobby-code-val'));
      sel.removeAllRanges(); sel.addRange(range);
      G.UI.toast('No se pudo copiar: cópialo a mano.', 2600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(room.code).then(ok, old);
    else old();
  }

  return { init, open };
})();
