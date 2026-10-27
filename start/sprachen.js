'use strict';
const api = window.elektron;
const $ = (id) => document.getElementById(id);
let data = null;

function card(l) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lang';
  b.dataset.code = l.code;
  b.dataset.search = [l.name, l.en, l.code, ...l.flags].join(' ').toLowerCase();
  const flags = document.createElement('span');
  flags.className = 'flags';
  const max = 8;
  for (const f of l.flags.slice(0, max)) {
    const img = document.createElement('img');
    img.src = `flags/${f}.svg`; img.alt = f.toUpperCase(); img.title = f.toUpperCase(); img.loading = 'lazy';
    flags.append(img);
  }
  if (l.flags.length > max) { const m = document.createElement('span'); m.className = 'more'; m.textContent = '+' + (l.flags.length - max); flags.append(m); }
  const names = document.createElement('span');
  names.className = 'names';
  const n = document.createElement('b'); n.textContent = l.name; n.dir = l.dir || 'ltr'; n.dataset.noI18n = '';
  const e = document.createElement('small'); e.textContent = l.en; e.dataset.noI18n = '';
  names.append(n, e);
  const c = document.createElement('i'); c.className = 'check'; c.textContent = '✓';
  b.append(flags, names, c);
  b.addEventListener('click', () => choose(l.code));
  return b;
}

async function choose(code) {
  document.querySelectorAll('.lang').forEach(x => x.classList.toggle('on', x.dataset.code === code || (code === 'auto' && x.id === 'auto')));
  await api.invoke('lang.set', code);
}

async function load() {
  data = await api.invoke('lang.list');
  const sys = data.languages.find(l => l.code === data.system);
  $('auto-sub').textContent = sys ? `Sprache von Windows: ${sys.name}` : 'Sprache von Windows';
  const grid = $('grid');
  grid.replaceChildren(...data.languages.map(card));
  const on = data.setting === 'auto' ? null : data.setting;
  $('auto').classList.toggle('on', !on);
  document.querySelectorAll('#grid .lang').forEach(x => x.classList.toggle('on', x.dataset.code === on));
}

$('auto').addEventListener('click', () => choose('auto'));
$('q').addEventListener('input', () => {
  const q = $('q').value.trim().toLowerCase();
  document.querySelectorAll('#grid .lang').forEach(b => { b.hidden = !!q && !b.dataset.search.includes(q); });
});
load();
