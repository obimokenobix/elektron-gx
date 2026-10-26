'use strict';
// Bildergalerie
const shot = document.getElementById('shot');
const labels = { split: 'Split-Screen', float: 'Schwebendes Fenster', v2b: 'Adressleiste mit Vorschlägen und Verlauf', gaming: 'GX Control mit Gaming-Modus', start: 'Startseite mit Steam-Spielen', design: 'Design-Einstellungen', reader: 'Lesemodus' };
document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    shot.src = `img/${b.dataset.shot}.webp`;
    shot.alt = `Elektron GX – ${labels[b.dataset.shot]}`;
  });
});

// Download-Knöpfe direkt auf den Installer der neuesten Version zeigen lassen
(async () => {
  try {
    const res = await fetch('https://api.github.com/repos/obimokenobix/elektron-gx/releases/latest');
    if (!res.ok) return;
    const rel = await res.json();
    const exe = (rel.assets || []).find((a) => /Setup.*\.exe$/i.test(a.name));
    if (!exe) return;
    const mb = Math.round(exe.size / 1048576);
    const meta = `Version ${String(rel.tag_name || '').replace(/^v/, '')} · ${mb} MB`;
    for (const id of ['dl-main', 'dl-bottom']) document.getElementById(id).href = exe.browser_download_url;
    document.getElementById('dl-meta').textContent = meta;
    document.getElementById('dl-meta2').textContent = meta;
  } catch { /* Fallback: Link auf die Release-Seite bleibt */ }
})();

// Link kopieren (auf dem Handy: das normale Teilen-Menü)
document.getElementById('copy-link').addEventListener('click', async (e) => {
  const url = 'https://obimokenobix.github.io/elektron-gx/';
  try {
    if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      await navigator.share({ title: 'Elektron GX', text: 'Der kostenlose Gaming-Browser für Windows', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    e.target.textContent = 'Kopiert!';
    e.target.classList.add('done');
    setTimeout(() => { e.target.textContent = 'Link kopieren'; e.target.classList.remove('done'); }, 2000);
  } catch { /* abgebrochen */ }
});
