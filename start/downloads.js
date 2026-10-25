'use strict';
const { api, el, favicon, iconBtn, bytes, dayLabel, time } = window.ui;
const list = document.getElementById('list');
const q = document.getElementById('q');
let items = [];

function stateText(d) {
  if (d.state === 'progressing') {
    const pct = d.total ? Math.floor(d.received / d.total * 100) + ' % · ' : '';
    return { text: `${pct}${bytes(d.received)}${d.total ? ' von ' + bytes(d.total) : ''}${d.speed ? ' · ' + bytes(d.speed) + '/s' : ''}`, cls: '' };
  }
  if (d.state === 'completed') return { text: `${bytes(d.total || d.received)} · ${dayLabel(d.started)}, ${time(d.started)}`, cls: 'ok' };
  if (d.state === 'cancelled') return { text: 'Abgebrochen', cls: 'err' };
  if (d.state === 'missing') return { text: 'Datei wurde gelöscht oder verschoben', cls: 'err' };
  return { text: 'Fehlgeschlagen', cls: 'err' };
}

function render() {
  const s = q.value.trim().toLowerCase();
  const shown = s ? items.filter(d => d.name.toLowerCase().includes(s) || (d.url || '').toLowerCase().includes(s)) : items;
  list.replaceChildren();
  if (!shown.length) {
    const e = el('div', 'empty');
    e.append(el('b', null, s ? 'Nichts gefunden' : 'Noch keine Downloads'));
    list.appendChild(e);
    return;
  }
  for (const d of shown) {
    const r = el('div', 'row');
    const main = el('div', 'main');
    const name = el(d.state === 'completed' ? 'a' : 'span', 'name', d.name);
    if (d.state === 'completed') {
      name.href = '#';
      name.addEventListener('click', (e) => { e.preventDefault(); api.invoke('downloads.open', d.id); });
    }
    const st = stateText(d);
    main.append(name, el('small', 'state ' + st.cls, st.text));
    if (d.state === 'progressing') {
      const bar = el('div', 'bar');
      const i = el('i');
      i.style.width = d.total ? Math.floor(d.received / d.total * 100) + '%' : '30%';
      bar.appendChild(i);
      main.appendChild(bar);
    }
    const acts = el('div', 'acts');
    if (d.state === 'progressing') acts.append(iconBtn('stop', 'Abbrechen', () => api.invoke('downloads.cancel', d.id)));
    if (d.state === 'completed') {
      acts.append(iconBtn('open', 'Öffnen', () => api.invoke('downloads.open', d.id)),
        iconBtn('folder', 'Im Ordner anzeigen', () => api.invoke('downloads.show', d.id)));
    }
    if (d.state !== 'progressing' && d.state !== 'completed' && d.url) {
      acts.append(iconBtn('retry', 'Erneut herunterladen', () => api.invoke('downloads.retry', d.id)));
    }
    if (d.state !== 'progressing') acts.append(iconBtn('del', 'Aus der Liste entfernen', async () => { await api.invoke('downloads.remove', d.id); load(); }));
    if (d.state === 'progressing') acts.style.opacity = 1;
    r.append(favicon(d.url || ''), main, acts);
    list.appendChild(r);
  }
}

async function load() { items = await api.invoke('downloads.list'); render(); }
document.getElementById('folder').addEventListener('click', () => api.invoke('downloads.folder'));
document.getElementById('clear').addEventListener('click', async () => { await api.invoke('downloads.clear'); load(); });
q.addEventListener('input', render);
api.on('downloads-changed', (data) => { items = data; render(); });
load();
