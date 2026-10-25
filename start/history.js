'use strict';
const { api, el, favicon, iconBtn, dayLabel, time, debounce } = window.ui;
const out = document.getElementById('out');
const q = document.getElementById('q');

async function load() {
  const items = await api.invoke('history.search', q.value.trim());
  out.replaceChildren();
  if (!items.length) {
    const e = el('div', 'list');
    const m = el('div', 'empty');
    m.append(el('b', null, q.value ? 'Nichts gefunden' : 'Der Verlauf ist leer'));
    e.appendChild(m);
    out.appendChild(e);
    return;
  }
  let curDay = null, box = null;
  for (const h of items) {
    const day = dayLabel(h.time);
    if (day !== curDay) {
      curDay = day;
      out.appendChild(el('div', 'group-title', day));
      box = el('div', 'list');
      out.appendChild(box);
    }
    const r = el('div', 'row');
    const main = el('div', 'main');
    const a = el('a', null, h.title || h.url);
    a.href = h.url;
    main.append(a, el('small', null, h.url));
    const acts = el('div', 'acts');
    acts.append(iconBtn('del', 'Aus dem Verlauf entfernen', async () => { await api.invoke('history.remove', h.id); r.remove(); }));
    r.append(el('span', 'time', time(h.time)), favicon(h.url), main, acts);
    box.appendChild(r);
  }
}

document.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', async () => {
  const ms = Number(b.dataset.clear);
  if (!ms && !confirm('Wirklich den gesamten Verlauf löschen?')) return;
  await api.invoke('history.clear', ms);
  load();
}));
q.addEventListener('input', debounce(load, 150));
load();
