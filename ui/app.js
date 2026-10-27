'use strict';
/* Elektron – Browser-Oberfläche */
const $ = (s) => document.querySelector(s);
/* global gx – kommt aus preload-ui.js */

const RAM_STEPS = [1024, 1536, 2048, 3072, 4096, 5120, 6144, 8192, 10240, 12288, 14336, 16384];
const NET_STEPS = [256, 512, 1024, 2048, 5120, 10240, 20480, 51200, 102400, 204800];
const ACCENTS = [
  ['#ff2b4e', 'Neon-Rot'], ['#00e5ff', 'Cyber-Cyan'], ['#a855f7', 'Ultraviolett'],
  ['#39ff88', 'Toxic-Grün'], ['#ff8a1f', 'Lava-Orange'], ['#ff3fbf', 'Synthwave-Pink'], ['#f5d90a', 'Volt-Gelb']
];

const ICONS = {
  close: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  frozen: '<svg viewBox="0 0 24 24"><path d="M12 2v20M4.9 7l14.2 10M4.9 17L19.1 7"/><path d="M9 4l3 2 3-2M9 20l3-2 3 2"/></svg>',
  sleep: '<svg viewBox="0 0 24 24"><path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/></svg>',
  splitB: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>',
  floatB: '<svg viewBox="0 0 24 24"><rect x="8" y="3" width="13" height="10" rx="2"/><path d="M5 8H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-3"/></svg>',
  crash: '<svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>'
};

let state = null;
const hist = { ram: [], cpu: [] };
const HIST_LEN = 60;

// ---------------------------------------------------------------- Hilfen
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtMB(mb) { return mb >= 1024 ? (mb / 1024).toFixed(mb >= 10240 ? 0 : 1).replace('.', ',') + ' GB' : Math.round(mb) + ' MB'; }
function fmtKBs(kb) { return kb >= 1024 ? (kb / 1024).toFixed(kb % 1024 ? 1 : 0).replace('.', ',') + ' MB/s' : kb + ' KB/s'; }
function nearestIdx(steps, v) {
  let best = 0;
  steps.forEach((s, i) => { if (Math.abs(s - v) < Math.abs(steps[best] - v)) best = i; });
  return best;
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
function setFill(range) {
  const p = (range.value - range.min) / (range.max - range.min) * 100;
  range.style.setProperty('--fill', p + '%');
}

// ---------------------------------------------------------------- Tabs
const tabsEl = $('#tabs');
let dragId = null;

function favHTML(t) {
  if (t.crashed) return ICONS.crash;
  if (t.discarded) return ICONS.sleep;
  if (t.loading && !t.frozen) return '<div class="spinner"></div>';
  if (t.frozen) return ICONS.frozen;
  if (!t.url) return '<img src="../assets/icon.png" alt="">';
  if (t.favicon) return `<img src="${esc(t.favicon)}" alt="" data-fallback="${esc((hostOf(t.url)[0] || '?').toUpperCase())}">`;
  return `<span class="letter">${esc((hostOf(t.url)[0] || '?').toUpperCase())}</span>`;
}

function renderTabs() {
  const frag = document.createDocumentFragment();
  for (const t of state.tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === state.activeId ? ' active' : '') +
      (t.frozen ? ' state-frozen' : '') + (t.discarded ? ' state-sleep' : '') +
      (t.split ? ' is-split' : '') + (t.floating ? ' is-float' : '') + (t.private ? ' is-private' : '');
    el.dataset.id = t.id;
    el.draggable = true;
    const title = t.title || t.url || 'Neuer Tab';
    let tip = title;
    if (t.frozen) tip += ' – eingefroren';
    if (t.discarded) tip += ' – schläft (klicken zum Laden)';
    if (t.floating) tip += ' – schwebendes Fenster (klicken zum Anzeigen)';
    if (t.split) tip += ' – Split-Screen';
    if (t.private) tip += ' – privat';
    el.title = tip;
    el.innerHTML =
      `<span class="fav">${favHTML(t)}</span>` +
      `<span class="title">${esc(title)}</span>` +
      (t.floating ? `<span class="badge" title="Schwebendes Fenster">${ICONS.floatB}</span>` :
        t.split ? `<span class="badge" title="Split-Screen">${ICONS.splitB}</span>` : '') +
      (t.audible || t.muted ? `<button class="audio" title="${t.muted ? 'Ton einschalten' : 'Stummschalten'}">${t.muted ? ICONS.muted : ICONS.audio}</button>` : '') +
      `<button class="close" title="Tab schließen (Strg+W)">${ICONS.close}</button>`;
    frag.appendChild(el);
  }
  tabsEl.replaceChildren(frag);
  tabsEl.querySelectorAll('img[data-fallback]').forEach(img => {
    img.addEventListener('error', () => {
      const s = document.createElement('span');
      s.className = 'letter'; s.textContent = img.dataset.fallback;
      img.replaceWith(s);
    }, { once: true });
  });
  requestAnimationFrame(markNarrow);
}

function markNarrow() {
  tabsEl.querySelectorAll('.tab').forEach(el => el.classList.toggle('narrow', el.offsetWidth < 90));
}

tabsEl.addEventListener('mousedown', (e) => {
  const tabEl = e.target.closest('.tab');
  if (!tabEl || e.button !== 0) return;
  if (e.target.closest('.close') || e.target.closest('.audio')) return;
  const id = Number(tabEl.dataset.id);
  if (state && id !== state.activeId) gx.cmd('activateTab', id);
});
tabsEl.addEventListener('click', (e) => {
  const tabEl = e.target.closest('.tab');
  if (!tabEl) return;
  const id = Number(tabEl.dataset.id);
  if (e.target.closest('.close')) gx.cmd('closeTab', id);
  else if (e.target.closest('.audio')) gx.cmd('toggleMute', id);
});
tabsEl.addEventListener('auxclick', (e) => {
  const tabEl = e.target.closest('.tab');
  if (tabEl && e.button === 1) { e.preventDefault(); gx.cmd('closeTab', Number(tabEl.dataset.id)); }
});
tabsEl.addEventListener('contextmenu', (e) => {
  const tabEl = e.target.closest('.tab');
  if (tabEl) { e.preventDefault(); gx.cmd('tabMenu', Number(tabEl.dataset.id)); }
});
tabsEl.addEventListener('dragstart', (e) => {
  const tabEl = e.target.closest('.tab');
  if (!tabEl) return;
  dragId = Number(tabEl.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
});
tabsEl.addEventListener('dragover', (e) => {
  const tabEl = e.target.closest('.tab');
  if (!tabEl || dragId == null) return;
  e.preventDefault();
  tabsEl.querySelectorAll('.dragover').forEach(x => x.classList.remove('dragover'));
  tabEl.classList.add('dragover');
});
tabsEl.addEventListener('drop', (e) => {
  const tabEl = e.target.closest('.tab');
  if (!tabEl || dragId == null) return;
  e.preventDefault();
  const to = state.tabs.findIndex(t => t.id === Number(tabEl.dataset.id));
  gx.cmd('moveTab', dragId, to);
  dragId = null;
});
tabsEl.addEventListener('dragend', () => {
  dragId = null;
  tabsEl.querySelectorAll('.dragover').forEach(x => x.classList.remove('dragover'));
});
$('#tabstrip').addEventListener('dblclick', (e) => {
  if (e.target === tabsEl || e.target.classList.contains('drag-fill')) gx.cmd('newTab');
});
$('#newtab').addEventListener('click', () => gx.cmd('newTab'));
window.addEventListener('resize', markNarrow);

// ---------------------------------------------------------------- Werkzeugleiste
const address = $('#address');

$('#back').addEventListener('click', () => gx.cmd('back'));
$('#forward').addEventListener('click', () => gx.cmd('forward'));
$('#reload').addEventListener('click', () => gx.cmd(state && state.nav && state.nav.loading ? 'stop' : 'reload'));
$('#home').addEventListener('click', () => gx.cmd('home'));
$('#zoom').addEventListener('click', () => gx.cmd('zoomReset'));
$('#menu').addEventListener('click', () => gx.cmd('menu'));
$('#gaming').addEventListener('click', () => gx.cmd('gamingMode'));
$('#pip').addEventListener('click', () => gx.cmd('pip'));
$('#float').addEventListener('click', () => gx.cmd('float'));
$('#split').addEventListener('click', () => gx.cmd('split'));
$('#split-swap').addEventListener('click', () => gx.cmd('splitSwap'));
$('#split-end').addEventListener('click', () => gx.cmd('splitEnd'));

// ---------------------------------------------------------------- Split-Screen: Trennlinie ziehen
const divider = $('#split-divider');
let dragging = false;
let ratioQueued = null;

function sendRatio(clientX) {
  const g = state && state.split && state.split.geo;
  if (!g) return;
  ratioQueued = (clientX - g.x - g.gap / 2) / (g.w - g.gap);
  requestAnimationFrame(() => {
    if (ratioQueued == null) return;
    gx.cmd('splitRatio', ratioQueued);
    ratioQueued = null;
  });
}
function setDragging(on) {
  dragging = on;
  document.documentElement.classList.toggle('dragging', on);
  document.body.classList.toggle('dragging', on);
  gx.cmd('splitDrag', on);
}
divider.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  divider.setPointerCapture(e.pointerId);
  setDragging(true);
});
divider.addEventListener('pointermove', (e) => { if (dragging) sendRatio(e.clientX); });
const stopDrag = () => { if (dragging) setDragging(false); };
divider.addEventListener('pointerup', stopDrag);
divider.addEventListener('pointercancel', stopDrag);
divider.addEventListener('lostpointercapture', stopDrag);
divider.addEventListener('dblclick', () => gx.cmd('splitRatio', 0.5));
const veil = $('#drag-veil');
veil.addEventListener('pointermove', (e) => { if (dragging) sendRatio(e.clientX); });
veil.addEventListener('pointerup', stopDrag);

function renderSplit() {
  const sp = state.split;
  const g = sp && sp.geo;
  document.body.classList.toggle('split', !!g && !state.immersive);
  $('#split').classList.toggle('on', !!sp);
  $('#split').title = sp ? 'Split-Screen beenden (Strg+Umschalt+S)' : 'Split-Screen (Strg+Umschalt+S)';
  if (!g) return;
  divider.style.left = (g.x + g.leftW) + 'px';
  divider.style.width = g.gap + 'px';
  const ind = $('#pane-indicator');
  if (state.activeId === sp.a) { ind.style.left = g.x + 'px'; ind.style.width = g.leftW + 'px'; }
  else { ind.style.left = (g.x + g.leftW + g.gap) + 'px'; ind.style.width = (g.w - g.leftW - g.gap) + 'px'; }
}

// ---------------------------------------------------------------- Adressleiste mit Vorschlägen
const omnibox = $('#omnibox');
let suggestOpen = false;
let typed = '';

function omniRect() {
  const r = omnibox.getBoundingClientRect();
  return { x: r.left, y: r.bottom - 1, width: r.width };
}
omnibox.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = address.value.trim();
  if (!v) return;
  gx.cmd('enter', suggestOpen ? typed : v);
  suggestOpen = false;
  address.blur();
});
address.addEventListener('focus', () => setTimeout(() => address.select(), 0));
address.addEventListener('input', () => {
  typed = address.value;
  suggestOpen = !!typed.trim();
  gx.cmd('suggest', typed, omniRect());
});
address.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!suggestOpen) return;
    e.preventDefault();
    gx.cmd('suggestMove', e.key === 'ArrowDown' ? 1 : -1);
  } else if (e.key === 'Escape') {
    if (suggestOpen) { suggestOpen = false; gx.cmd('suggestClose'); address.value = typed; return; }
    address.value = state && state.nav ? state.nav.url : '';
    address.blur();
    gx.cmd('focusPage');
  }
});
address.addEventListener('blur', () => {
  setTimeout(() => { if (document.activeElement !== address && suggestOpen) { suggestOpen = false; gx.cmd('suggestClose'); } }, 180);
});
gx.on('suggest-selected', ({ text }) => { address.value = text; });
gx.on('suggest-closed', () => { suggestOpen = false; address.blur(); });
$('#star').addEventListener('click', () => gx.cmd('bmToggle'));

function renderToolbar() {
  const n = state.nav || {};
  $('#back').disabled = !n.canGoBack;
  $('#forward').disabled = !n.canGoForward;
  $('#reload').classList.toggle('loading', !!n.loading);
  $('#reload').title = n.loading ? 'Laden abbrechen' : 'Neu laden (F5)';
  if (!(document.hasFocus() && document.activeElement === address)) address.value = n.url || '';
  $('#secure').classList.toggle('on', !!n.secure && !!n.url);
  const z = $('#zoom');
  z.classList.toggle('show', n.zoom && n.zoom !== 100);
  z.textContent = (n.zoom || 100) + ' %';
  address.placeholder = `Mit ${state.settings.searchEngineName || 'Google'} suchen oder Adresse eingeben`;
  const sh = $('#shield');
  sh.classList.toggle('on', state.settings.adblock && state.adblockReady);
  sh.title = 'Schutz für diese Seite (klicken)';
  const g = $('#gaming');
  g.classList.toggle('on', state.gamingMode);
  const star = $('#star');
  star.hidden = !n.canBookmark;
  star.classList.toggle('on', !!n.bookmarked);
  star.title = n.bookmarked ? 'Lesezeichen entfernen (Strg+D)' : 'Lesezeichen hinzufügen (Strg+D)';
  document.body.classList.toggle('is-private', !!n.private);
  document.body.classList.toggle('can-read', /^https?:/i.test(n.url || '') && !n.warning);
  document.body.classList.toggle('warn-insecure', n.warning === 'insecure');
  document.body.classList.toggle('warn-danger', n.warning === 'danger');
  const ns = $('#notsecure');
  ns.classList.toggle('danger', n.warning === 'danger');
  ns.textContent = n.warning === 'danger' ? 'Gefährlich' : 'Nicht sicher';

  // Downloads-Knopf
  const d = state.downloads || {};
  const dl = $('#dl-btn');
  dl.hidden = !d.any;
  dl.classList.toggle('active', d.active > 0);
  dl.classList.toggle('indeterminate', d.active > 0 && d.progress == null);
  dl.querySelector('.prog').style.strokeDashoffset = d.progress != null ? String(100 - d.progress * 100) : '';
  dl.title = d.active ? (d.active === 1 ? '1 Download läuft – Strg+J' : `${d.active} Downloads laufen – Strg+J`) : 'Downloads (Strg+J)';

  // Erweiterungen: Symbole für den aktiven Tab anzeigen
  const acts = $('#ext-actions');
  if (acts && n.wcId && !n.private) acts.setAttribute('tab', String(n.wcId));
  if (acts) acts.style.display = n.private ? 'none' : '';

  // Update
  const u = state.update || {};
  $('#update-pill').hidden = u.state !== 'ready';
}
$('#dl-btn').addEventListener('click', () => gx.cmd('openInternal', 'downloads'));
$('#shot').addEventListener('click', () => gx.cmd('screenshot', false));
$('#shot').addEventListener('contextmenu', (e) => { e.preventDefault(); gx.cmd('screenshot', true); });
$('#reader').addEventListener('click', () => gx.cmd('reader'));
$('#backup').addEventListener('click', () => gx.cmd('backup'));
$('#restore').addEventListener('click', () => gx.cmd('restore'));
document.querySelectorAll('.bgt').forEach(b => b.addEventListener('click', () => {
  const bg = b.dataset.bg;
  if (bg === 'eigenes' && (!state.settings.hasUserBg || state.settings.background === 'eigenes')) gx.cmd('chooseBg');
  else gx.cmd('setSetting', 'background', bg);
}));
$('#ext-btn').addEventListener('click', () => gx.cmd('openInternal', 'extensions'));
$('#update-pill').addEventListener('click', () => gx.cmd('updateInstall'));

gx.on('focus-address', () => { address.focus(); address.select(); });

// ---------------------------------------------------------------- Lesezeichenleiste
const bmItems = $('#bm-items');
let bmKey = '';

function renderBookmarkBar() {
  const on = !!state.settings.showBookmarkBar && !state.immersive;
  document.body.classList.toggle('bm-on', on);
  if (!on) return;
  const list = state.bookmarks || [];
  const key = list.map(b => b.id + b.title).join('|');
  if (key === bmKey) { fitBookmarks(); return; }
  bmKey = key;
  bmItems.replaceChildren();
  if (!list.length) {
    const e = document.createElement('span');
    e.className = 'bm-empty';
    e.textContent = 'Lesezeichen erscheinen hier – klick auf den Stern in der Adressleiste.';
    bmItems.appendChild(e);
  }
  for (const b of list) {
    const btn = document.createElement('button');
    btn.className = 'bm-item';
    btn.dataset.id = b.id;
    btn.title = `${b.title}\n${b.url}`;
    const img = new Image();
    img.src = `favicon?host=${encodeURIComponent(hostOf(b.url))}`;
    img.onerror = () => { const s = document.createElement('span'); s.className = 'letter'; s.textContent = (hostOf(b.url)[0] || '?').toUpperCase(); img.replaceWith(s); requestAnimationFrame(fitBookmarks); };
    img.onload = () => requestAnimationFrame(fitBookmarks);
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = b.title || hostOf(b.url);
    btn.append(img, t);
    bmItems.appendChild(btn);
  }
  requestAnimationFrame(fitBookmarks);
}

function fitBookmarks() {
  const more = $('#bm-more');
  const btns = [...bmItems.querySelectorAll('.bm-item')];
  btns.forEach(b => b.classList.remove('hidden'));
  const avail = $('#bmbar').clientWidth - $('#bm-all').offsetWidth - 64;
  const hidden = [];
  let used = 0;
  for (const b of btns) {
    used += b.offsetWidth + 2;
    if (used > avail) { b.classList.add('hidden'); hidden.push(b.dataset.id); }
  }
  more.hidden = !hidden.length;
  more.dataset.ids = hidden.join(',');
}

bmItems.addEventListener('click', (e) => {
  const b = e.target.closest('.bm-item');
  if (b) gx.cmd('bmOpen', b.dataset.id, e.ctrlKey ? 'tab' : 'same');
});
bmItems.addEventListener('auxclick', (e) => {
  const b = e.target.closest('.bm-item');
  if (b && e.button === 1) { e.preventDefault(); gx.cmd('bmOpen', b.dataset.id, 'tab'); }
});
bmItems.addEventListener('contextmenu', (e) => {
  const b = e.target.closest('.bm-item');
  if (b) { e.preventDefault(); gx.cmd('bmMenu', b.dataset.id); }
});
$('#bm-more').addEventListener('click', () => gx.cmd('bmOverflow', ($('#bm-more').dataset.ids || '').split(',').filter(Boolean)));
$('#bm-all').addEventListener('click', () => gx.cmd('openInternal', 'bookmarks'));
window.addEventListener('resize', () => requestAnimationFrame(fitBookmarks));

// ---------------------------------------------------------------- Suchen auf der Seite
const findInput = $('#find-input');
let findTimer = null;

function openFindBar() {
  document.body.classList.add('finding');
  findInput.focus();
  findInput.select();
  if (findInput.value) gx.cmd('find', findInput.value, { forward: true });
}
function closeFindBar() {
  if (!document.body.classList.contains('finding')) return;
  document.body.classList.remove('finding');
  $('#find-count').textContent = '';
  gx.cmd('findStop');
  gx.cmd('focusPage');
}
function findStep(forward) {
  if (findInput.value) gx.cmd('find', findInput.value, { forward, findNext: true });
}
findInput.addEventListener('input', () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => gx.cmd('find', findInput.value, { forward: true }), 120);
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); findStep(!e.shiftKey); }
  if (e.key === 'Escape') { e.preventDefault(); closeFindBar(); }
});
$('#find-next').addEventListener('click', () => findStep(true));
$('#find-prev').addEventListener('click', () => findStep(false));
$('#find-close').addEventListener('click', closeFindBar);
gx.on('find-open', openFindBar);
gx.on('find-close', () => { document.body.classList.remove('finding'); $('#find-count').textContent = ''; });
gx.on('find-next', ({ forward }) => {
  if (!document.body.classList.contains('finding')) openFindBar();
  else findStep(forward);
});
gx.on('find-result', ({ active, matches }) => {
  const c = $('#find-count');
  c.textContent = findInput.value ? `${matches ? active : 0}/${matches}` : '';
  c.classList.toggle('none', !!findInput.value && !matches);
});

// ---------------------------------------------------------------- Toast
let toastTimer = null;
gx.on('toast', ({ text, action, cmd, arg }) => {
  const el = $('#toast');
  $('#toast-text').textContent = text;
  const btn = $('#toast-action');
  btn.classList.toggle('show', !!action);
  btn.textContent = action || '';
  btn.onclick = action && cmd ? () => { gx.cmd(cmd, arg); el.classList.remove('show'); } : null;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 7000 : 3500);
});

// ---------------------------------------------------------------- Seitenleiste
document.querySelectorAll('.rail-btn.site').forEach(btn => {
  const img = new Image();
  img.alt = '';
  img.src = `favicon?host=${encodeURIComponent(btn.dataset.domain)}`;
  img.onerror = () => { btn.innerHTML = `<span class="letter">${btn.dataset.letter}</span>`; };
  btn.appendChild(img);
});
document.querySelectorAll('.rail-btn[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => gx.cmd('togglePanel', btn.dataset.panel));
});
$('#rail-settings').addEventListener('click', () => {
  if (!state || state.panel !== 'gx') gx.cmd('togglePanel', 'gx');
  setTimeout(() => $('#settings-anchor').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
});
$('#panel-close').addEventListener('click', () => gx.cmd('togglePanel', 'gx'));

function renderRail() {
  document.querySelectorAll('.rail-btn[data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === state.panel));
  document.body.classList.toggle('panel-gx', state.panel === 'gx');
}

// ---------------------------------------------------------------- GX Control
const rRam = $('#r-ram'), rCpu = $('#r-cpu'), rNet = $('#r-net');

document.querySelectorAll('input[data-setting]').forEach(inp => {
  inp.addEventListener('change', () => gx.cmd('setSetting', inp.dataset.setting, inp.checked));
});
document.querySelectorAll('.seg[data-setting]').forEach(seg => {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) gx.cmd('setSetting', seg.dataset.setting, b.dataset.v);
  });
});
$('#s-gaming').addEventListener('change', () => gx.cmd('gamingMode'));

function commitRange(range, key, mapFn) {
  range.addEventListener('input', () => { setFill(range); updateRangeLabels(); });
  range.addEventListener('change', () => gx.cmd('setSetting', key, mapFn(Number(range.value))));
}
commitRange(rRam, 'ramLimit.mb', i => RAM_STEPS[i]);
commitRange(rCpu, 'cpuLimit.percent', v => v);
commitRange(rNet, 'netLimit.kbs', i => NET_STEPS[i]);

function updateRangeLabels() {
  $('#o-ram').textContent = fmtMB(RAM_STEPS[rRam.value]);
  $('#o-cpu').textContent = rCpu.value + ' %';
  $('#o-net').textContent = fmtKBs(NET_STEPS[rNet.value]);
}

$('#clear-now').addEventListener('click', () => gx.cmd('clearData'));
$('#update-check').addEventListener('click', () => gx.cmd('updateCheck'));
$('#update-install').addEventListener('click', () => gx.cmd('updateInstall'));
$('#update-url-save').addEventListener('click', () => gx.cmd('setSetting', 'updateUrl', $('#update-url').value.trim()));
$('#update-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') gx.cmd('setSetting', 'updateUrl', $('#update-url').value.trim()); });

function renderStyle() {
  const normal = state.settings.style === 'normal';
  document.body.classList.toggle('style-normal', normal);
  $('.panel-head h1').textContent = normal ? 'Einstellungen' : 'GX Control';
  $('.panel-head p').textContent = normal ? 'Alles, was du an Elektron einstellen kannst.' : 'Halte den Browser klein, damit dein Spiel die Leistung bekommt.';
  const gxBtn = document.querySelector('.rail-btn[data-panel="gx"]');
  if (gxBtn) gxBtn.title = normal ? 'Einstellungen' : 'GX Control';
  document.querySelectorAll('.bgt').forEach(b => b.classList.toggle('active', b.dataset.bg === state.settings.background));
}

function renderProtect() {
  const p = state.protect || {};
  const l = p.lists || {};
  const n = (l.phishing ? l.phishing.count : 0) + (l.malware ? l.malware.count : 0);
  $('#protect-info').textContent = n
    ? `Blockiert ${n.toLocaleString('de-AT')} bekannte Betrugs- und Virenseiten. Die Liste wird alle 6 Stunden aktualisiert.`
    : 'Blockiert bekannte Betrugsseiten und Seiten, die Viren verteilen. Die Liste wird gerade geladen …';
  // Sicherheits-Check
  const st = state.settings || {};
  const u = state.update || {};
  const checks = [
    ['Browser aktuell', !['ready', 'error'].includes(u.state), u.state === 'ready' ? 'Update bereit – Browser neu starten' : `Chromium ${state.versions.chrome}`],
    ['Werbe- und Tracker-Blocker', !!st.adblock],
    ['Phishing- und Malware-Schutz', !!st.phishingProtect],
    ['Nur HTTPS', !!st.httpsOnly],
    ['Sicheres DNS', !!st.secureDns],
    ['Fremd-Cookies blockiert', !!st.blockThirdPartyCookies, p.cookiesBlocked ? `${p.cookiesBlocked.toLocaleString('de-AT')} Tracking-Cookies abgewehrt` : ''],
    ['Fingerprint-Schutz', !!st.fingerprintProtect],
    ['Links werden gesäubert', !!st.cleanLinks, p.linksCleaned ? `${p.linksCleaned.toLocaleString('de-AT')} Tracking-Links entschärft` : ''],
    ['IP-Adresse bei WebRTC versteckt', !!st.webrtcProtect],
    ['„Nicht verkaufen“-Signal (GPC)', !!st.gpc],
    ['Warnung vor gefälschten Adressen', !!st.phishingProtect],
    ['Private Suchmaschine', st.searchEngine && st.searchEngine !== 'google', st.searchEngine === 'google' ? 'Google erstellt Profile – DuckDuckGo, Brave oder Startpage nicht' : ''],
    ['Downloads werden geprüft', !!st.scanDownloads && !!p.defender, p.defender ? '' : 'Windows Defender nicht gefunden'],
    ['Programm gehärtet', !!p.hardened, p.hardened ? '' : 'nur in der installierten Version']
  ];
  const ok = checks.filter(c => c[1]).length;
  const pct = Math.round(ok / checks.length * 100);
  $('#sec-score').textContent = pct + ' %';
  $('#sec-score').dataset.level = pct >= 90 ? 'good' : pct >= 60 ? 'mid' : 'bad';
  $('#sec-bar').style.width = pct + '%';
  $('#sec-bar').dataset.level = $('#sec-score').dataset.level;
  $('#sec-sum').textContent = ok === checks.length ? 'Alle Schutzfunktionen sind aktiv.' : `${ok} von ${checks.length} Schutzfunktionen aktiv.`;
  $('#sec-list').replaceChildren(...checks.map(([name, on, note]) => {
    const li = document.createElement('li');
    li.className = on ? 'on' : 'off';
    const t = document.createElement('span'); t.textContent = name;
    li.appendChild(t);
    if (note) { const n = document.createElement('small'); n.textContent = note; li.appendChild(n); }
    return li;
  }));
  $('#scan-info').textContent = p.defender
    ? 'Jede heruntergeladene Datei wird mit dem Windows Defender geprüft.'
    : 'Prüft Downloads mit dem Windows Defender (auf diesem PC nicht verfügbar).';
}

function renderUpdates() {
  const u = state.update || {};
  const v = state.versions;
  const texts = {
    idle: `Version ${v.app} · Chromium ${v.chrome}`,
    dev: `Version ${v.app} · Updates gibt es in der installierten Windows-Version.`,
    store: `Version ${v.app} · Updates kommen automatisch über den Microsoft Store.`,
    nourl: `Version ${v.app} · Noch keine Update-Adresse eingetragen.`,
    checking: 'Suche nach Updates …',
    current: `Version ${v.app} ist aktuell.`,
    downloading: `Version ${u.version} wird geladen … ${u.percent || 0} %`,
    ready: `Version ${u.version} ist bereit – wird beim nächsten Start installiert.`,
    error: `Update-Suche fehlgeschlagen: ${u.message || 'unbekannter Fehler'}`
  };
  $('#update-status').textContent = texts[u.state] || texts.idle;
  $('#update-bar').hidden = u.state !== 'downloading';
  $('#update-bar').querySelector('i').style.width = (u.percent || 0) + '%';
  $('#update-install').hidden = u.state !== 'ready';
  const inp = $('#update-url');
  if (document.activeElement !== inp) inp.value = state.settings.updateUrl || '';
}
$('#restart').addEventListener('click', () => gx.cmd('restart'));

const sw = $('#swatches');
ACCENTS.forEach(([color, name]) => {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.title = name;
  b.style.background = color;
  b.style.color = color;
  b.dataset.color = color;
  b.addEventListener('click', () => gx.cmd('setSetting', 'accent', color));
  sw.appendChild(b);
});

function renderPanel() {
  const s = state.settings;
  document.querySelectorAll('input[data-setting]').forEach(inp => {
    const val = inp.dataset.setting.split('.').reduce((o, k) => o && o[k], s);
    inp.checked = !!val;
    const card = inp.closest('.card');
    if (card && card.querySelector('.slider')) card.classList.toggle('off', !val);
  });
  document.querySelectorAll('.seg[data-setting]').forEach(seg => {
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === s[seg.dataset.setting]));
  });
  $('#s-gaming').checked = state.gamingMode;
  $('#gaming-card').classList.toggle('on', state.gamingMode);
  if (document.activeElement !== rRam) rRam.value = nearestIdx(RAM_STEPS, s.ramLimit.mb);
  if (document.activeElement !== rCpu) rCpu.value = s.cpuLimit.percent;
  if (document.activeElement !== rNet) rNet.value = nearestIdx(NET_STEPS, s.netLimit.kbs);
  [rRam, rCpu, rNet].forEach(setFill);
  updateRangeLabels();
  const ramL = $('#m-ram-limit'), cpuL = $('#m-cpu-limit');
  ramL.textContent = s.ramLimit.enabled ? 'Limit ' + fmtMB(s.ramLimit.mb) : 'kein Limit';
  ramL.classList.toggle('on', s.ramLimit.enabled);
  cpuL.textContent = s.cpuLimit.enabled ? 'Limit ' + s.cpuLimit.percent + ' %' : 'kein Limit';
  cpuL.classList.toggle('on', s.cpuLimit.enabled);
  $('#restart').hidden = !state.needsRestart;
  sw.querySelectorAll('.swatch').forEach(b => b.classList.toggle('active', b.dataset.color.toLowerCase() === s.accent.toLowerCase()));
  const v = state.versions;
  $('#about').textContent = `Elektron ${v.app} · Chromium ${v.chrome}`;
}

// ---------------------------------------------------------------- Statistik & Diagramme
function drawSpark(canvas, data, max, limit) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff2b4e';
  const top = Math.max(max, limit || 0) * 1.15 || 1;
  const step = w / (HIST_LEN - 1);
  const x0 = w - (data.length - 1) * step;
  const y = v => h - 2 - (v / top) * (h - 6);

  if (limit) {
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y(limit)); ctx.lineTo(w, y(limit)); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (data.length < 2) return;
  ctx.beginPath();
  data.forEach((v, i) => { const px = x0 + i * step; i ? ctx.lineTo(px, y(v)) : ctx.moveTo(px, y(v)); });
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineTo(x0 + (data.length - 1) * step, h);
  ctx.lineTo(x0, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, accent + '55');
  grad.addColorStop(1, accent + '00');
  ctx.fillStyle = grad;
  ctx.fill();
}

gx.on('stats', (st) => {
  hist.ram.push(st.ram); hist.cpu.push(st.cpu);
  if (hist.ram.length > HIST_LEN) hist.ram.shift();
  if (hist.cpu.length > HIST_LEN) hist.cpu.shift();
  $('#hud-cpu').textContent = st.cpu.toFixed(st.cpu < 10 ? 1 : 0).replace('.', ',') + ' %';
  $('#hud-ram').textContent = fmtMB(st.ram);
  $('#shield-count').textContent = st.tabBlocked ? (st.tabBlocked > 999 ? Math.round(st.tabBlocked / 1000) + 'k' : st.tabBlocked) : '';
  $('#shield').classList.toggle('off-site', !!st.shieldOff);
  $('#adblock-info').textContent = st.blocked
    ? `Blockiert Werbung, Tracker, Popups und Cookie-Banner – bisher ${st.blocked.toLocaleString('de-AT')} Anfragen gestoppt.`
    : 'Blockiert Werbung, Tracker, Werbe-Popups und Cookie-Banner.';
  if (!state || state.panel !== 'gx') return;
  renderHw(st.hw);
  $('#m-ram').textContent = fmtMB(st.ram);
  $('#m-cpu').textContent = st.cpu.toFixed(1).replace('.', ',') + ' %';
  $('#n-tabs').textContent = st.tabs;
  $('#n-frozen').textContent = st.frozen;
  $('#n-sleep').textContent = st.sleeping;
  const s = state.settings;
  drawSpark($('#c-ram'), hist.ram, Math.max(...hist.ram, 256), s.ramLimit.enabled ? s.ramLimit.mb : 0);
  drawSpark($('#c-cpu'), hist.cpu, Math.max(...hist.cpu, 10), s.cpuLimit.enabled ? s.cpuLimit.percent : 0);
});

// ---------------------------------------------------------------- Hardware
function renderHw(hw) {
  const box = $('#hwcards');
  box.hidden = !hw;
  if (!hw) return;
  const g = hw.gpu;
  $('#hw-gpu').hidden = !g;
  if (g) {
    $('#gpu-util').textContent = g.util != null ? Math.round(g.util) + ' %' : '–';
    $('#gpu-name').textContent = (g.name || '').replace(/^NVIDIA\s+/, '');
    $('#gpu-bar').style.width = (g.util || 0) + '%';
    const t = $('#gpu-temp');
    t.textContent = g.temp != null ? Math.round(g.temp) + ' °C' : '';
    t.classList.toggle('hot', g.temp >= 80);
    $('#gpu-mem').textContent = g.memUsed != null ? `${(g.memUsed / 1024).toFixed(1).replace('.', ',')}/${(g.memTotal / 1024).toFixed(0)} GB VRAM` : '';
    $('#gpu-power').textContent = g.power != null ? Math.round(g.power) + ' W' : '';
  }
  $('#pc-cpu').textContent = hw.cpu != null ? Math.round(hw.cpu) + ' %' : '–';
  $('#pc-name').textContent = (hw.cpuName || '').replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').replace(/\s+/g, ' ').trim();
  $('#pc-bar').style.width = (hw.cpu || 0) + '%';
  $('#pc-ram').textContent = `RAM ${fmtMB(hw.ramUsed)} von ${fmtMB(hw.ramTotal)}`;
}

// ---------------------------------------------------------------- Zustand
gx.on('state', (s) => {
  state = s;
  document.documentElement.style.setProperty('--accent', s.settings.accent);
  document.body.classList.toggle('immersive', s.immersive);
  renderTabs();
  renderToolbar();
  renderRail();
  renderPanel();
  renderSplit();
  renderBookmarkBar();
  renderUpdates();
  renderProtect();
  renderStyle();
});

$('#shield').addEventListener('click', () => gx.cmd('shieldMenu'));
