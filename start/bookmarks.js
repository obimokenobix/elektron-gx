'use strict';
const { api, el, favicon, iconBtn, host } = window.ui;
const list = document.getElementById('list');
const q = document.getElementById('q');
let items = [];
let dragId = null;

async function load() {
  items = await api.invoke('bookmarks.list');
  render();
}

function render() {
  const s = q.value.trim().toLowerCase();
  const shown = s ? items.filter(b => b.title.toLowerCase().includes(s) || b.url.toLowerCase().includes(s)) : items;
  list.replaceChildren();
  if (!shown.length) {
    const e = el('div', 'empty');
    e.append(el('b', null, s ? 'Nichts gefunden' : 'Noch keine Lesezeichen'),
      s ? '' : 'Klick auf den Stern in der Adressleiste oder drück Strg+D.');
    list.appendChild(e);
    return;
  }
  for (const b of shown) list.appendChild(row(b, !s));
}

function row(b, draggable) {
  const r = el('div', 'row');
  r.draggable = draggable;
  r.dataset.id = b.id;
  const main = el('div', 'main');
  const a = el('a', null, b.title);
  a.href = b.url;
  main.append(a, el('small', null, b.url));
  const acts = el('div', 'acts');
  acts.append(
    iconBtn('edit', 'Bearbeiten', () => edit(r, b)),
    iconBtn('del', 'Löschen', async () => { await api.invoke('bookmarks.remove', b.id); load(); })
  );
  r.append(favicon(b.url), main, acts);

  r.addEventListener('dragstart', () => { dragId = b.id; r.classList.add('dragging'); });
  r.addEventListener('dragend', () => { dragId = null; r.classList.remove('dragging'); list.querySelectorAll('.drop-before').forEach(x => x.classList.remove('drop-before')); });
  r.addEventListener('dragover', (e) => { if (!dragId) return; e.preventDefault(); list.querySelectorAll('.drop-before').forEach(x => x.classList.remove('drop-before')); r.classList.add('drop-before'); });
  r.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!dragId || dragId === b.id) return;
    await api.invoke('bookmarks.move', dragId, items.findIndex(x => x.id === b.id));
    load();
  });
  return r;
}

function edit(r, b) {
  const main = r.querySelector('.main');
  const t = el('input', 'edit'); t.value = b.title; t.placeholder = 'Name';
  const u = el('input', 'edit'); u.value = b.url; u.placeholder = 'Adresse';
  main.replaceChildren(t, u);
  t.focus(); t.select();
  const save = async () => {
    await api.invoke('bookmarks.update', b.id, { title: t.value.trim() || host(u.value), url: u.value.trim() });
    load();
  };
  for (const inp of [t, u]) {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') render();
    });
  }
}

async function doImport(source, label) {
  const n = document.getElementById('notice');
  const res = await api.invoke('bookmarks.import', source);
  n.hidden = false;
  n.textContent = res.error ? `${label}: ${res.error}` : `${res.added} Lesezeichen aus ${label} übernommen.`;
  load();
}
document.getElementById('imp-edge').addEventListener('click', () => doImport('edge', 'Edge'));
document.getElementById('imp-chrome').addEventListener('click', () => doImport('chrome', 'Chrome'));
document.getElementById('imp-opera').addEventListener('click', () => doImport('operagx', 'Opera GX'));
q.addEventListener('input', render);
api.on('bookmarks-changed', load);
load();
