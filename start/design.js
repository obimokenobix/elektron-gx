'use strict';
/* Volt – eigene Designs für Webseiten und die Browser-Oberfläche (elektron://start/design.html) */
{
  const { api, el, favicon } = window.ui;
  const $ = (id) => document.getElementById(id);
  const ta = $('css');

  const SITE_PRESETS = [
    ['Dunkelmodus erzwingen', '/* Dunkelmodus erzwingen */\nhtml { filter: invert(1) hue-rotate(180deg) !important; background: #fff !important; }\nimg, video, picture, canvas, iframe, svg image, [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }'],
    ['Größere Schrift', '/* Größere Schrift */\nhtml { font-size: 118% !important; }\np, li, td { line-height: 1.7 !important; }'],
    ['Lese-Breite', '/* Text nicht zu breit */\nmain, article, #content, .content { max-width: 900px !important; margin-left: auto !important; margin-right: auto !important; }'],
    ['Animationen aus', '/* Keine Animationen */\n*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }'],
    ['Bilder ausblenden', '/* Bilder ausblenden (spart Daten) */\nimg, picture, video { visibility: hidden !important; }'],
    ['Eigene Schriftart', '/* Eigene Schriftart */\nbody, body * { font-family: Bahnschrift, "Segoe UI", sans-serif !important; }'],
    ['Akzentfarbe Links', '/* Links in Neon-Gelb */\na, a * { color: #f2ff3d !important; }']
  ];
  const UI_PRESETS = [
    ['Mitternacht', '/* Farben: Mitternacht */\n:root { --bg-0: #05070f; --bg-1: #0a0f1f; --bg-2: #111a33; --bg-3: #18244a; --line: #22305a; }'],
    ['OLED-Schwarz', '/* Farben: reines Schwarz */\n:root { --bg-0: #000; --bg-1: #050505; --bg-2: #0d0d0d; --bg-3: #161616; --line: #1f1f1f; }'],
    ['Volt-Gelb', '/* Akzent: Volt-Gelb */\n:root { --accent: #e6f53a !important; }'],
    ['Schrift Bahnschrift', '/* Schrift der Oberfläche */\nhtml, body { font-family: Bahnschrift, "Segoe UI", sans-serif !important; }'],
    ['Kein Leuchten', '/* Kein Leuchten */\n* { box-shadow: none !important; text-shadow: none !important; }']
  ];

  let data = { sites: {}, ui: '' };
  let mode = 'sites';
  let host = (new URLSearchParams(location.search).get('host') || '').toLowerCase().replace(/^www\./, '');
  let dirty = false;

  function setStatus(t) { $('status').textContent = t; }

  function renderSites() {
    const box = $('sites');
    const hosts = Object.keys(data.sites).sort();
    if (host && !hosts.includes(host)) hosts.unshift(host);
    box.replaceChildren(...(hosts.length ? hosts.map(h => {
      const r = el('div', 'row' + (h === host ? ' sel' : ''));
      const main = el('div', 'main');
      main.append(el('span', 'name', h), el('small', null, data.sites[h] ? 'eigenes Design aktiv' : 'noch kein Design'));
      r.append(favicon('https://' + h), main);
      r.addEventListener('click', () => { if (confirmLeave()) { host = h; load(); } });
      return r;
    }) : [el('div', 'empty', 'Noch keine Seite')]));
  }

  function renderPresets() {
    const list = mode === 'ui' ? UI_PRESETS : SITE_PRESETS;
    $('presets').replaceChildren(...list.map(([name, css]) => {
      const b = el('button', 'btn', '+ ' + name);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (ta.disabled) return;
        ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + css + '\n';
        dirty = true; setStatus('nicht gespeichert');
      });
      return b;
    }));
  }

  function load() {
    dirty = false; setStatus('');
    document.querySelector('.dsg').classList.toggle('ui-mode', mode === 'ui');
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    if (mode === 'ui') {
      $('intro').textContent = 'Verändere Farben und Schrift von Volt selbst. Höhen und Abstände der Leisten bitte nicht ändern. Falls etwas schiefgeht: Design entfernen – oder Volt mit „--ohne-design“ starten.';
      $('title').textContent = 'Browser-Oberfläche';
      ta.disabled = false; ta.value = data.ui || '';
      $('remove').disabled = !data.ui;
      $('hint').textContent = 'Wirkt sofort nach dem Speichern.';
    } else {
      $('intro').textContent = 'Gib jeder Webseite dein eigenes Aussehen – mit Vorlagen oder eigenem CSS. Ein Design für youtube.com gilt auch für m.youtube.com. Alles bleibt auf deinem PC.';
      $('title').textContent = host || 'Wähle links eine Seite oder füge eine hinzu';
      ta.disabled = !host; ta.value = host ? (data.sites[host] || '') : '';
      $('remove').disabled = !host || !data.sites[host];
      $('hint').textContent = host ? 'Offene Tabs dieser Seite ändern sich sofort.' : '';
      renderSites();
    }
    renderPresets();
  }

  function confirmLeave() {
    if (!dirty) return true;
    setStatus('Bitte zuerst speichern oder entfernen');
    return false;
  }

  async function save() {
    if (ta.disabled) return;
    if (mode === 'ui') { await api.invoke('design.ui', ta.value); data.ui = ta.value.trim() ? ta.value : ''; }
    else {
      const ok = await api.invoke('design.save', host, ta.value);
      if (!ok) { setStatus('Ungültige Adresse'); return; }
      if (ta.value.trim()) data.sites[host] = ta.value; else delete data.sites[host];
    }
    dirty = false;
    setStatus('Gespeichert – ist sofort aktiv');
    $('remove').disabled = mode === 'ui' ? !data.ui : !data.sites[host];
    if (mode === 'sites') renderSites();
  }

  $('save').addEventListener('click', save);
  $('remove').addEventListener('click', async () => { ta.value = ''; dirty = true; await save(); setStatus('Design entfernt'); });
  ta.addEventListener('input', () => { dirty = true; setStatus('nicht gespeichert'); });
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    if (e.key === 'Tab') { e.preventDefault(); const p = ta.selectionStart; ta.setRangeText('  ', p, ta.selectionEnd, 'end'); dirty = true; }
  });
  $('add').addEventListener('submit', (e) => {
    e.preventDefault();
    const h = $('newHost').value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#:].*$/, '').replace(/^www\./, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) { setStatus('Bitte eine Adresse wie youtube.com eingeben'); return; }
    if (!confirmLeave()) return;
    host = h; $('newHost').value = ''; load(); ta.focus();
  });
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.mode === mode || !confirmLeave()) return;
    mode = b.dataset.mode; load();
  }));

  (async () => {
    try { data = await api.invoke('design.get'); } catch {}
    if (new URLSearchParams(location.search).get('ui')) mode = 'ui';
    load();
  })();
}
