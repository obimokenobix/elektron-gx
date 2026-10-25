'use strict';
const { api, el, favicon } = window.ui;

// Beliebte Erweiterungen – Klick öffnet die Suche im Chrome Web Store
const POPULAR = [
  { name: 'Bitwarden', cat: 'Passwort-Manager', q: 'Bitwarden Password Manager', domain: 'bitwarden.com', text: 'Speichert deine Passwörter sicher und füllt sie automatisch aus.' },
  { name: 'Avast Online Security', cat: 'Sicherheit', q: 'Avast Online Security & Privacy', domain: 'avast.com', text: 'Warnt vor gefährlichen Seiten und Phishing.' },
  { name: 'ChatGPT', cat: 'KI', q: 'ChatGPT', domain: 'chatgpt.com', text: 'ChatGPT direkt im Browser nutzen.' },
  { name: 'Claude', cat: 'KI', q: 'Claude', domain: 'claude.ai', text: 'Claude als Erweiterung – oder einfach über die Seitenleiste.' },
  { name: 'Dark Reader', cat: 'Design', q: 'Dark Reader', domain: 'darkreader.org', text: 'Dunkles Design für jede Webseite.' },
  { name: 'Google Übersetzer', cat: 'Werkzeuge', q: 'Google Translate', domain: 'translate.google.com', text: 'Markierten Text oder ganze Seiten übersetzen.' },
  { name: 'Return YouTube Dislike', cat: 'YouTube', q: 'Return YouTube Dislike', domain: 'returnyoutubedislike.com', text: 'Zeigt wieder die Dislikes unter YouTube-Videos.' },
  { name: 'SponsorBlock', cat: 'YouTube', q: 'SponsorBlock', domain: 'sponsor.ajay.app', text: 'Überspringt Sponsor-Teile in YouTube-Videos.' }
];

function notice(text) {
  const n = document.getElementById('notice');
  n.hidden = !text;
  n.textContent = text || '';
}

function logo(icon, name) {
  const box = el('span', 'logo');
  if (icon) { const img = new Image(); img.src = icon; img.alt = ''; box.appendChild(img); }
  else box.textContent = (name[0] || '?').toUpperCase();
  return box;
}

async function load() {
  const list = await api.invoke('ext.list');
  const box = document.getElementById('installed');
  box.replaceChildren();
  if (!list.length) {
    box.appendChild(el('div', 'empty-card', 'Noch keine Erweiterungen installiert. Öffne den Chrome Web Store und klick dort auf „Hinzufügen“.'));
  }
  for (const e of list) {
    const card = el('div', 'ext');
    const top = el('div', 'top');
    const info = el('div');
    const h = el('h3', null, e.name);
    if (e.unpacked) h.appendChild(el('span', 'tag', 'entpackt'));
    info.append(h, el('div', 'ver', 'Version ' + e.version));
    top.append(logo(e.icon, e.name), info);
    card.append(top);
    if (e.description) card.append(el('p', null, e.description));
    if (e.permissions && e.permissions.length) card.append(el('div', 'perms', 'Darf: ' + e.permissions.join(' · ')));
    const acts = el('div', 'acts');
    if (e.options) {
      const o = el('button', 'btn', 'Optionen');
      o.type = 'button';
      o.addEventListener('click', () => api.invoke('ext.options', e.options));
      acts.append(o);
    }
    const r = el('button', 'btn danger', 'Entfernen');
    r.type = 'button';
    r.addEventListener('click', async () => {
      if (!confirm(`„${e.name}“ entfernen?`)) return;
      await api.invoke('ext.remove', e.id);
      load();
    });
    acts.append(r);
    card.append(acts);
    box.appendChild(card);
  }
}

function renderPopular() {
  const box = document.getElementById('popular');
  for (const p of POPULAR) {
    const card = el('div', 'ext');
    const top = el('div', 'top');
    const info = el('div');
    info.append(el('div', 'cat', p.cat), el('h3', null, p.name));
    const fav = favicon('https://' + p.domain);
    fav.className = 'logo';
    top.append(fav, info);
    card.append(top, el('p', null, p.text));
    card.addEventListener('click', () => api.invoke('ext.store', p.q));
    box.appendChild(card);
  }
}

document.getElementById('store').addEventListener('click', () => api.invoke('ext.store', ''));
document.getElementById('update').addEventListener('click', async () => { notice('Suche nach Updates …'); await api.invoke('ext.update'); notice(''); load(); });
document.getElementById('unpacked').addEventListener('click', async () => {
  const r = await api.invoke('ext.loadUnpacked');
  if (!r) return;
  notice(r.error ? 'Konnte nicht geladen werden: ' + r.error : `„${r.name}“ wurde geladen.`);
  load();
});
api.on('extensions-changed', load);
renderPopular();
load();
