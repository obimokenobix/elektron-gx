'use strict';
const p = new URLSearchParams(location.search);
const url = p.get('u') || '';
const code = Number(p.get('c'));
let host = url;
try { host = new URL(url).hostname; } catch {}

const msgs = {
  '-105': `Die Adresse von ${host} wurde nicht gefunden. Stimmt die Schreibweise?`,
  '-106': 'Keine Internetverbindung. Prüfe WLAN oder Netzwerkkabel.',
  '-102': `${host} hat die Verbindung abgelehnt.`,
  '-118': `${host} antwortet nicht rechtzeitig.`,
  '-7': `${host} antwortet nicht rechtzeitig.`,
  '-201': `Das Sicherheitszertifikat von ${host} ist ungültig.`,
  '-202': `Das Sicherheitszertifikat von ${host} ist nicht vertrauenswürdig.`
};

document.getElementById('msg').textContent = msgs[String(code)] || `${host || 'Die Seite'} konnte nicht geladen werden.`;
document.getElementById('code').textContent = `${p.get('d') || ''} (${code})`;
document.title = `${host} – nicht erreichbar`;
document.getElementById('retry').addEventListener('click', () => { if (/^https?:/i.test(url)) location.href = url; });
