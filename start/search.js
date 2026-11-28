'use strict';
/* HyperSearch X – Suchseite von Volt (elektron://start/search.html?q=…) */
{
  const { api, el } = window.ui;
  const $ = (id) => document.getElementById(id);
  const qEl = $('q');
  const query = (new URLSearchParams(location.search).get('q') || '').trim();
  const LOC = () => document.documentElement.lang || 'de-AT';

  // gleiche Regeln wie hyper.js im Hauptprozess (Seite rechnet ohne Umweg sofort)
  function calc(text) {
    let s = String(text || '').replace(/\s+/g, '').replace(/,/g, '.').replace(/[x×]/g, '*').replace(/÷/g, '/').replace(/=$/, '');
    if (s.length > 120) return null;
    if (!/^[\d.+\-*/()%^]+$/.test(s) || !/\d/.test(s) || !/[+\-*/%^]/.test(s.replace(/^-/, ''))) return null;
    if (/^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$/.test(s)) return null;
    if ((s.match(/\(/g) || []).length > 20) return null;
    try {
      const v = evalMath(s);
      return typeof v === 'number' && isFinite(v) ? Number(v.toPrecision(12)) : null;
    } catch { return null; }
  }

  // Kleiner Rechen-Parser (ohne eval – die Seite erlaubt kein eval): + - * / ^ %, Klammern, Vorzeichen
  function evalMath(src) {
    let i = 0;
    const peek = () => src[i];
    const num = () => {
      const m = /^\d+(?:\.\d+)?|^\.\d+/.exec(src.slice(i));
      if (!m) throw new Error('Zahl erwartet');
      i += m[0].length;
      let v = Number(m[0]);
      if (peek() === '%') { i++; v /= 100; }
      return v;
    };
    const atom = () => {
      if (peek() === '-') { i++; return -atom(); }
      if (peek() === '+') { i++; return atom(); }
      if (peek() === '(') { i++; const v = sum(); if (peek() !== ')') throw new Error(') erwartet'); i++; return v; }
      return num();
    };
    const pow = () => { const b = atom(); if (peek() === '^') { i++; return Math.pow(b, pow()); } return b; };
    const prod = () => {
      let v = pow();
      while (peek() === '*' || peek() === '/') { const op = src[i++]; const r = pow(); v = op === '*' ? v * r : v / r; }
      return v;
    };
    const sum = () => {
      let v = prod();
      while (peek() === '+' || peek() === '-') { const op = src[i++]; const r = prod(); v = op === '+' ? v + r : v - r; }
      return v;
    };
    const v = sum();
    if (i !== src.length) throw new Error('unerwartetes Zeichen');
    return v;
  }

  let info = { web: 'duckduckgo', engines: [], extra: [], lang: 'de' };

  function webUrl(id, q) {
    const e = info.engines.concat(info.extra).find(x => x.id === id);
    return e ? e.url + encodeURIComponent(q) : null;
  }

  function renderWeb(q) {
    const box = $('web');
    box.replaceChildren(...info.engines.concat(info.extra).map(e => {
      const a = el('a', 'chip' + (e.id === info.web ? ' def' : ''), e.name);
      a.href = q ? e.url + encodeURIComponent(q) : '#';
      a.title = info.engines.some(x => x.id === e.id) ? 'Rechtsklick: als Standard für die Websuche setzen' : '';
      a.addEventListener('click', (ev) => { if (!q) { ev.preventDefault(); qEl.focus(); } });
      a.addEventListener('contextmenu', async (ev) => {
        if (!info.engines.some(x => x.id === e.id)) return;
        ev.preventDefault();
        info = await api.invoke('hyper.setWeb', e.id);
        renderWeb(q);
      });
      return a;
    }));
  }

  function highlight(target, text, q) {
    const words = q.split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length) { target.textContent = text; return; }
    const re = new RegExp('(' + words.join('|') + ')', 'gi');
    let last = 0;
    for (const m of text.matchAll(re)) {
      target.append(text.slice(last, m.index), el('mark', null, m[0]));
      last = m.index + m[0].length;
    }
    target.append(text.slice(last));
  }

  async function showCard(title) {
    const card = $('card');
    try {
      const s = await api.invoke('hyper.summary', title);
      if (!s) { card.hidden = true; return; }
      card.replaceChildren();
      if (s.image) { const img = new Image(); img.alt = ''; img.src = s.image; img.onerror = () => img.remove(); card.append(img); }
      const inner = el('div', 'in');
      inner.append(el('h2', null, s.title));
      if (s.description) inner.append(el('div', 'd', s.description));
      inner.append(el('p', null, s.extract));
      const a = el('a', null, 'Ganzen Artikel lesen');
      a.href = s.url;
      inner.append(a);
      card.append(inner);
      card.hidden = false;
    } catch { card.hidden = true; }
  }

  async function run(q) {
    const t0 = performance.now();
    const c = calc(q);
    if (c !== null) {
      $('calc').hidden = false;
      $('calc-q').textContent = q + ' =';
      $('calc-r').textContent = c.toLocaleString(LOC(), { maximumFractionDigits: 10 });
    }
    const list = $('list');
    list.replaceChildren(el('div', 'empty', 'Suche läuft …'));
    try {
      const r = await api.invoke('hyper.wiki', q);
      $('speed').innerHTML = '';
      $('speed').append('⚡ ', el('b', null, Math.round(performance.now() - t0) + ' ms'));
      $('count').textContent = r.hits.length ? `Wissen · ${r.total.toLocaleString(LOC())} Treffer` : 'Wissen';
      if (!r.hits.length) {
        list.replaceChildren(el('div', 'empty', c !== null ? 'Ergebnis siehe oben.' : 'Keine Wissens-Treffer – probier die Websuche oben.'));
        return;
      }
      list.replaceChildren(...r.hits.map(h => {
        const d = el('div', 'hit');
        d.setAttribute('data-no-i18n', ''); // Wikipedia-Texte nie „übersetzen“
        const a = el('a', null, h.title);
        a.href = h.url;
        const u = el('div', 'u', `${r.lang}.wikipedia.org › ${h.title}`);
        const p = el('p');
        highlight(p, h.snippet + ' …', q);
        d.append(a, u, p);
        return d;
      }));
      showCard(r.hits[0].title);
    } catch {
      $('speed').textContent = 'Wissen gerade nicht erreichbar';
      list.replaceChildren(el('div', 'empty', 'Wikipedia ist gerade nicht erreichbar – nutze die Websuche oben.'));
    }
  }

  function bang(text) {
    const m = text.match(/(^|\s)!([a-z]+)(?=\s|$)/i);
    const base = m && info.bangs && info.bangs[m[2].toLowerCase()];
    if (!base) return null;
    const rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).trim();
    return rest ? base + encodeURIComponent(rest) : new URL(base).origin + '/';
  }

  function go(text) {
    const q = String(text || '').trim();
    if (!q) return;
    const b = bang(q);
    if (b) { location.href = b; return; }
    location.href = 'search.html?q=' + encodeURIComponent(q);
  }

  $('f').addEventListener('submit', (e) => { e.preventDefault(); go(qEl.value); });
  qEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const u = webUrl(info.web, qEl.value.trim());
      if (u && qEl.value.trim()) location.href = u;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== qEl) { e.preventDefault(); qEl.focus(); qEl.select(); }
  });

  (async () => {
    qEl.value = query;
    try { info = await api.invoke('hyper.info'); } catch {}
    renderWeb(query);
    if (!query) { $('home').hidden = false; qEl.focus(); return; }
    document.title = `${query} – HyperSearch X`;
    run(query);
  })();
}
