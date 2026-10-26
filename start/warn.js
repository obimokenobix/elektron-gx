'use strict';
const api = window.elektron;
const q = new URLSearchParams(location.search);
const url = q.get('u') || '';
const kind = q.get('k');
const isBlocked = document.body.classList.contains('danger');
let host = url;
try { host = new URL(url).hostname; } catch {}
document.getElementById('host').textContent = host;

const meant = q.get('m');
if (isBlocked && kind === 'lookalike' && meant) {
  document.title = 'Gefälschte Adresse?';
  document.getElementById('title').textContent = 'Diese Adresse sieht aus wie ' + meant;
  document.getElementById('text').textContent = `Die Adresse ist der echten Seite ${meant} zum Verwechseln ähnlich – ein typischer Trick von Betrügern. Schau genau hin: Ein Buchstabe ist vertauscht, ersetzt oder stammt aus einem anderen Alphabet.`;
  const ul = document.getElementById('list');
  for (const t of ['Gib hier keine Passwörter, Codes oder Kartendaten ein.', `Wenn du zu ${meant} willst, nimm den Knopf unten.`, 'Kam der Link per E-Mail, SMS oder Discord? Dann war es vermutlich Betrug.']) {
    const li = document.createElement('li'); li.textContent = t; ul.appendChild(li);
  }
  document.getElementById('detail').textContent = `Adresse: ${url}`;
  const src = document.querySelector('.src'); if (src) src.textContent = 'Elektron GX Schutz · Doppelgänger-Erkennung direkt auf deinem PC';
  const go = document.getElementById('back');
  go.textContent = `Zur echten Seite: ${meant}`;
  go.addEventListener('click', (e) => { e.stopImmediatePropagation(); location.href = 'https://' + meant + '/'; }, true);
} else if (isBlocked) {
  const malware = kind === 'malware';
  document.title = malware ? 'Schadsoftware blockiert' : 'Betrugsseite blockiert';
  document.getElementById('title').textContent = malware ? 'Diese Seite verteilt Schadsoftware' : 'Betrugsseite blockiert';
  document.getElementById('text').textContent = malware
    ? 'Von dieser Seite wurden Viren oder andere Schadprogramme verbreitet. Elektron GX hat sie gestoppt, bevor etwas auf deinen PC gelangt.'
    : 'Diese Seite steht auf einer Liste bekannter Phishing-Seiten. Solche Seiten sehen oft echt aus, wollen aber deine Passwörter oder Bankdaten stehlen.';
  const tips = malware
    ? ['Lade von hier nichts herunter.', 'Öffne keine Dateien, die du von dieser Seite schon hast.', 'Lass deinen Virenscanner laufen, falls du unsicher bist.']
    : ['Gib hier keine Passwörter, Codes oder Kartendaten ein.', 'Kam der Link per E-Mail, SMS oder Discord? Dann war es vermutlich Betrug.', 'Öffne Banken, Steam, Discord & Co. lieber direkt über die Adressleiste oder ein Lesezeichen.'];
  const ul = document.getElementById('list');
  for (const t of tips) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
  document.getElementById('detail').textContent = `Adresse: ${url}`;
}

document.getElementById('back').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.href = 'elektron://start/';
});

document.getElementById('proceed').addEventListener('click', async () => {
  if (!/^https?:\/\//i.test(url)) return;
  if (isBlocked) {
    if (!confirm('Wirklich öffnen? Diese Seite ist als gefährlich bekannt.')) return;
    await api.invoke('protect.allow', url);
  } else {
    await api.invoke('protect.allowHttp', url);
  }
  location.href = url;
});
