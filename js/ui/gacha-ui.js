/* ============ gacha-ui.js — banners por generación y animación de tirada ============
 * La lógica (probabilidades, pity, shiny, repetidos) está en systems/gacha.js.
 */
G.GachaUI = (() => {
  const $ = G.UI.$;
  let busy = false, skipping = false;
  let gen = 1;

  function init() {
    $('pull-10').onclick = () => pull(10, 't1');
    $('pull-10b').onclick = () => pull(10, 't10');
    $('pull-100').onclick = () => pull(100, 't1');
    $('pull-100b').onclick = () => pull(100, 't10');
    $('pull-close').onclick = close;
    $('pull-skip').onclick = skip;

    const tabs = $('gacha-gens');
    G.Gacha.BANNERS.forEach(b => {
      const t = document.createElement('button');
      t.className = 'gen-tab';
      t.dataset.gen = b.gen;
      t.innerHTML = `<b>${b.name}</b><small>Gen ${b.gen}</small>`;
      t.onclick = () => { gen = b.gen; refresh(); };
      tabs.appendChild(t);
    });
  }

  function open() {
    G.UI.show('scr-gacha', true);
    refresh();
  }

  function refresh() {
    const s = G.DB.save;
    const banner = G.Gacha.BANNERS[gen - 1];
    document.querySelectorAll('#gacha-gens .gen-tab').forEach(t => t.classList.toggle('on', +t.dataset.gen === gen));

    const all = G.DEX.filter(p => p.gen === gen);
    const owned = all.filter(p => s.owned[p.dex]).length;
    const shinies = all.filter(p => s.shiny && s.shiny[p.dex]).length;
    const [c1, c2, c3] = banner.color;
    $('banner').style.background =
      `radial-gradient(circle at 80% 30%, rgba(255,210,63,.3), transparent 45%),
       radial-gradient(circle at 15% 80%, rgba(196,123,255,.3), transparent 50%),
       linear-gradient(135deg, ${c1}, ${c2} 55%, ${c3})`;
    $('banner-title').textContent = banner.name + ' Misterioso';
    $('banner-desc').textContent = `Los ${all.length} Pokémon de la generación ${gen}. ¡Los legendarios esperan!`;
    const charm = G.Gacha.hasCharm(s, gen), rate = Math.round(G.Gacha.shinyRate(s, gen) * 100);
    $('gacha-owned').innerHTML = `Tienes ${owned} de ${all.length}` +
      (shinies ? ` · ${G.Icons.html('shiny', 12)} ${shinies} shiny` : '') +
      (charm ? ` · ${G.Icons.html('charm', 12)} <span class="gold">${G.I18n.f('Shiny al 2 % en el banner de {x}', banner.name)}</span>` : '');

    const feat = $('gacha-feat');
    feat.innerHTML = '';
    for (const dex of G.Gacha.featured(gen)) {
      feat.appendChild(G.UI.spriteCanvas(dex, 170, 190, { lively: true, scale: 2, dir: 1 }));
    }

    const pity = (s.pity && s.pity[gen]) || 0;
    $('gacha-pity').textContent = `Tiradas sin legendaria en ${banner.name}: ${pity} / ${G.Gacha.PITY_5}`;

    $('gacha-rates').innerHTML = '<h3>Probabilidades</h3>' + G.Gacha.RATES.slice().reverse().map(([r, w]) => `
      <div><span style="color:${G.Gacha.RARITY_COLOR[r]}">${G.UI.stars(r, 10)} ${G.Gacha.RARITY_NAME[r]}</span>
      <span>${w}% · ${G.Gacha.pool(r, gen).length}</span></div>`).join('') +
      `<div><span>${G.Icons.html('shiny', 12)} Shiny${charm ? ' ' + G.Icons.html('charm', 12) : ''}</span><span class="${charm ? 'gold' : ''}">${rate}%</span></div>
       <p class="note">· La tirada ×10 garantiza al menos una Épica.<br>
       · A las ${G.Gacha.PITY_5} tiradas sin Legendaria en un banner, la siguiente lo es.<br>
       · Los repetidos dan Pokémonedas. Los shiny no se repiten.<br>
       · Los tickets se consiguen jugando: algunos Pokémon los sueltan al caer, y
         los jefes y los legendarios de las grietas, a veces, tickets ×10.<br>
       · Completa la Pokédex de una región (legendarios incluidos) y te dan su Amuleto Iris: en su banner, los shiny salen el doble (del 1 % al 2 %).</p>`;

    const t = s.tickets;
    $('cost-10').innerHTML = `${G.Icons.html('ticket', 18)} 10`;
    $('cost-10b').innerHTML = `${G.Icons.html('ticket10', 18)} 1`;
    $('cost-100').innerHTML = `${G.Icons.html('ticket', 18)} 100`;
    $('cost-100b').innerHTML = `${G.Icons.html('ticket10', 18)} 10`;
    $('gacha-tickets').innerHTML = `Tienes ${G.Icons.html('ticket', 18)} <b>${t.t1}</b> tickets y ${G.Icons.html('ticket10', 18)} <b>${t.t10}</b> tickets ×10`;
    $('pull-10').disabled = !G.Gacha.costOf(s, 10, 't1');
    $('pull-10b').disabled = !G.Gacha.costOf(s, 10, 't10');
    $('pull-100').disabled = !G.Gacha.costOf(s, 100, 't1');
    $('pull-100b').disabled = !G.Gacha.costOf(s, 100, 't10');
    G.UI.refreshCoins();
  }

  const wait = ms => new Promise(r => setTimeout(r, ms));

  /** La carta de un premio. @param many  en la ×100 sólo se mueven las mejores */
  function card(r, many) {
    const mon = G.DEX_BY[r.dex];
    const c = document.createElement('div');
    c.className = 'pcard r' + r.rarity + (r.shiny ? ' shiny' : '');
    c.style.setProperty('--rc', r.shiny ? '#9ae6ff' : G.Gacha.RARITY_COLOR[r.rarity]);
    c.innerHTML = `<div class="stars">${G.UI.stars(r.rarity, many ? 14 : 24)}</div>`;
    c.appendChild(G.UI.spriteCanvas(r.dex, 132, 120, { lively: r.shiny || r.rarity >= (many ? 5 : 4), scale: 2, shiny: r.shiny }));
    const tag = r.isNew
      ? `<span class="new">${r.shiny ? '¡SHINY NUEVO!' : '¡NUEVO!'}</span>`
      : `Repetido · <span class="coin"></span> +${r.refund}`;
    // Nuevo: con qué naturaleza y habilidad te ha tocado (la oculta, en dorado).
    const ab = r.isNew ? G.Mons.abilityOf(r.dex) : null;
    const who = ab ? `<div class="pmon" translate="no">${G.Mons.name(G.Mons.natureOf(r.dex).n)} · <span class="${ab.slot === 2 ? 'gold' : ''}">${G.Mons.abilityName(ab.id)}</span></div>` : '';
    c.insertAdjacentHTML('beforeend', `<b>${r.shiny ? G.Icons.html('shiny', 12) + ' ' : ''}${mon.name}</b>${who}<div class="tag">${tag}</div>`);
    return c;
  }

  /** La región se acaba de completar: su Amuleto Iris, encima de las cartas. */
  function charmBox() {
    const name = G.Gacha.BANNERS[gen - 1].name, box = document.createElement('div');
    box.className = 'iris-get';
    box.innerHTML = `${G.Icons.html('charm', 36)}<div><b>${G.I18n.f('¡Amuleto Iris de {x}!', name)}</b><br>
      ${G.I18n.f('Has completado la Pokédex de {x}: en su banner, los shiny salen el doble (2 %). Lo tienes en la Mochila.', name)}</div>`;
    return box;
  }

  async function pull(n, use = 't1') {
    if (busy) return;
    const hadCharm = G.Gacha.hasCharm(G.DB.save, gen);
    const res = G.Gacha.pull(G.DB.save, n, gen, use);
    if (!res) { G.Audio.sfx('error'); G.UI.toast('No tienes tickets suficientes: consíguelos jugando'); return; }
    G.Progress.checkAch();
    G.DB.commit(true);
    busy = true; skipping = false;

    const best = Math.max(...res.map(r => r.rarity)), many = res.length > 10;
    const fx = $('pull-fx'), slot = $('slot'), out = $('pull-results');
    out.innerHTML = '';
    out.classList.toggle('many', many);
    $('pull-close').classList.add('hidden');
    $('pull-skip').classList.remove('hidden');
    slot.style.display = '';
    fx.classList.remove('hidden');

    // La tragaperras (ui/slots.js) y luego las cartas. En la ×100, gira 10 veces con lo mejor de cada ×10.
    await G.Slots.play(slot, many ? G.Gacha.bestOfTens(res) : res, many ? 'TIRADA ×100' : '');
    G.Audio.sfx('burst', { rarity: best });
    slot.style.display = 'none';
    if (!hadCharm && G.Gacha.hasCharm(G.DB.save, gen)) { out.appendChild(charmBox()); G.Audio.sfx('legend'); }

    if (many) {
      // El resumen y las 100 cartas de golpe, de mejor a peor.
      const sum = G.Gacha.summary(res), box = document.createElement('div');
      box.className = 'pull-sum';
      box.innerHTML = `${G.I18n.f('Nuevos: {x}', sum.fresh)} · ${G.I18n.f('Shiny: {x}', sum.shiny)} · <span class="coin"></span> +${sum.coins.toLocaleString(G.I18n.locale)}`;
      out.appendChild(box);
      for (const r of G.Gacha.bestFirst(res)) out.appendChild(card(r, true));
      G.Audio.sfx('reveal', { rarity: best });
    } else {
      for (const r of res) {
        out.appendChild(card(r, false));
        if (skipping) continue;              // saltando: todas a la vez, con un solo sonido (abajo)
        G.Audio.sfx('reveal', { rarity: r.rarity });
        await wait(150);
      }
      if (skipping) G.Audio.sfx('reveal', { rarity: best });
    }
    $('pull-skip').classList.add('hidden');
    $('pull-close').classList.remove('hidden');
    busy = false;
  }

  /** "Saltar": sin tragaperras ni cartas una a una; los premios salen ya. */
  function skip() {
    if (!busy || skipping) return;
    skipping = true;
    G.Slots.skip();
  }

  /** Esc (y B en el mando) con la tirada abierta: salta la animación o, al final, cierra. */
  function escape() { if (busy) skip(); else close(); }

  function close() {
    $('pull-fx').classList.add('hidden');
    refresh();
  }

  return { init, open, escape, get open_() { return !$('pull-fx').classList.contains('hidden'); } };
})();
