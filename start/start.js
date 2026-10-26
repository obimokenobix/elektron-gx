'use strict';
const KEY = 'elektron.dials.v1';
const DEFAULT_DIALS = [
  { name: 'GeForce NOW', url: 'https://play.geforcenow.com/' },
  { name: 'Xbox Cloud Gaming', url: 'https://www.xbox.com/de-DE/play' },
  { name: 'Steam', url: 'https://store.steampowered.com/' },
  { name: 'Epic Gratis-Spiele', url: 'https://store.epicgames.com/de/free-games' },
  { name: 'Twitch', url: 'https://www.twitch.tv/' },
  { name: 'YouTube Gaming', url: 'https://www.youtube.com/gaming' },
  { name: 'Roblox', url: 'https://www.roblox.com/' },
  { name: 'Discord', url: 'https://discord.com/app' },
  { name: 'itch.io', url: 'https://itch.io/' },
  { name: 'Reddit Gaming', url: 'https://www.reddit.com/r/gaming/' }
];

const $ = (s) => document.querySelector(s);

function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(d)) return d; } catch {}
  return DEFAULT_DIALS.slice();
}
function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} }
function host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }

let dials = load();

function render() {
  const wrap = $('#dials');
  wrap.replaceChildren();
  dials.forEach((d, i) => {
    const a = document.createElement('a');
    a.className = 'dial';
    a.href = d.url;
    const ico = document.createElement('span');
    ico.className = 'ico';
    const img = new Image();
    img.alt = '';
    img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host(d.url))}&sz=64`;
    img.onerror = () => { ico.textContent = (d.name[0] || '?').toUpperCase(); };
    ico.appendChild(img);
    const txt = document.createElement('span');
    txt.className = 'txt';
    const b = document.createElement('b'); b.textContent = d.name;
    const sm = document.createElement('small'); sm.textContent = host(d.url);
    txt.append(b, sm);
    const del = document.createElement('button');
    del.className = 'del'; del.type = 'button'; del.title = 'Entfernen'; del.textContent = '×';
    del.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dials.splice(i, 1); save(dials); render(); });
    a.append(ico, txt, del);
    a.addEventListener('click', (e) => { if (document.body.classList.contains('editing')) e.preventDefault(); });
    wrap.appendChild(a);
  });
}

$('#edit').addEventListener('click', () => {
  const on = document.body.classList.toggle('editing');
  $('#add').hidden = !on;
  $('#edit').textContent = on ? 'Fertig' : 'Bearbeiten';
  if (on) $('#add-name').focus();
});

$('#add').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#add-name').value.trim();
  let url = $('#add-url').value.trim();
  if (!name || !url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { $('#add-url').focus(); return; }
  dials.push({ name, url });
  save(dials);
  $('#add-name').value = ''; $('#add-url').value = '';
  render();
});

$('#reset').addEventListener('click', () => { dials = DEFAULT_DIALS.slice(); save(dials); render(); });

function tick() {
  const now = new Date();
  $('#time').textContent = now.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  $('#date').textContent = now.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' });
  const h = now.getHours();
  if (document.body.classList.contains('private')) return;
  const normal = document.body.classList.contains('style-normal');
  $('#greeting').textContent = normal
    ? (h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Schönen Tag' : 'Guten Abend')
    : (h < 5 ? 'Noch eine Runde? Es ist mitten in der Nacht.' :
      h < 11 ? 'Guten Morgen – bereit zum Zocken?' :
      h < 18 ? 'Bereit zum Zocken?' :
      'Guten Abend – Zeit für eine Session.');
}

// ---------------------------------------------------------------- Aussehen (Stil, Farbe, Hintergrund)
const api = window.elektron;
const BG_IMAGES = ['nebel', 'galaxie', 'berge', 'aurora', 'wellen'];
function applyLook(look) {
  if (!look) return;
  const b = document.body;
  document.documentElement.style.setProperty('--accent', look.accent);
  b.classList.toggle('style-normal', look.style === 'normal');
  for (const c of [...b.classList]) if (c.startsWith('bg-')) b.classList.remove(c);
  b.classList.add('bg-' + look.background);
  let img = '';
  if (BG_IMAGES.includes(look.background)) img = `url(bg/${look.background}.webp)`;
  if (look.background === 'eigenes') img = `url(user-bg?v=${look.bgVersion || 0})`;
  b.style.setProperty('--bg-image', img || 'none');
  $('#foot').textContent = look.style === 'normal'
    ? 'Strg+T neuer Tab · Strg+D Lesezeichen · Strg+H Verlauf · F11 Vollbild'
    : 'Strg+Umschalt+G startet den Gaming-Modus · Strg+T neuer Tab · F11 Vollbild';
  if (!b.classList.contains('private')) document.title = look.style === 'normal' ? 'Neuer Tab' : 'Neuer Tab';
  tick();
  loadGames(look.style);
}

// ---------------------------------------------------------------- Steam-Spiele
let gamesLoaded = false, allGames = [], showAll = false;
async function loadGames(style) {
  const wrap = $('#games-wrap');
  if (style === 'normal' || document.body.classList.contains('private') || !api) { wrap.hidden = true; return; }
  if (!gamesLoaded) {
    gamesLoaded = true;
    try { allGames = await api.invoke('steam.games'); } catch { allGames = []; }
  }
  wrap.hidden = !allGames.length;
  renderGames();
}
function renderGames() {
  const box = $('#games');
  box.replaceChildren();
  const list = showAll ? allGames : allGames.slice(0, 6);
  for (const g of list) {
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'game';
    let h = 0; for (const c of g.name) h = (h * 31 + c.charCodeAt(0)) % 360;
    a.style.setProperty('--hue', h);
    a.dataset.initial = (g.name.match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase();
    a.title = `${g.name} starten`;
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.src = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`;
    img.onerror = () => img.remove();
    const name = document.createElement('span');
    name.textContent = g.name;
    const play = document.createElement('i');
    play.textContent = '▶';
    a.append(img, name, play);
    a.addEventListener('click', () => api.invoke('steam.play', g.appid));
    box.appendChild(a);
  }
  const more = $('#games-more');
  more.hidden = allGames.length <= 6;
  more.textContent = showAll ? 'Weniger anzeigen' : `Alle ${allGames.length} anzeigen`;
}
$('#games-more').addEventListener('click', () => { showAll = !showAll; renderGames(); });

if (api) {
  api.invoke('look').then(applyLook).catch(() => {});
  api.on('look-changed', applyLook);
}

render();
tick();
setInterval(tick, 10000);

// Privater Tab: Hinweis anzeigen
if (new URLSearchParams(location.search).get('private')) {
  document.body.classList.add('private');
  document.title = 'Privater Tab';
  const g = document.getElementById('greeting');
  g.textContent = 'Privater Tab – Verlauf, Cookies und Logins verschwinden, sobald du alle privaten Tabs schließt.';
  clearInterval(window.__greetTimer);
}
