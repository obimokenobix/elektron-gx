'use strict';
/* Elektron Studio – verbindet Node-Editor, Shader-Vorschau und Abläufe mit dem Browser. */
const api = window.elektron;
const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
};
const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function pickFile(input) {
  return new Promise((resolve) => {
    input.value = '';
    input.onchange = () => resolve(input.files && input.files[0] || null);
    input.click();
  });
}

// ================================================================ Modus umschalten
let mode = 'shader';
function setMode(m) {
  mode = m;
  document.querySelectorAll('.st-tabs button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('mode-shader').hidden = m !== 'shader';
  $('mode-flows').hidden = m !== 'flows';
  $('tools-shader').hidden = m !== 'shader';
  $('tools-flows').hidden = m !== 'flows';
  store.set('studio.mode', m);
  requestAnimationFrame(() => { (m === 'shader' ? shaderGraph : flowGraph).redrawWires(); });
  if (m === 'shader') schedule();
}
document.querySelectorAll('.st-tabs button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

// ================================================================ Shader & Bilder
const SS = window.ShaderStudio;
const canvas = $('preview');
const renderer = new SS.Renderer(canvas);
const images = new Map();            // nodeId -> { img, status }
let compiled = null;
let dirty = true;
const fileImages = store.get('studio.images') || {}; // nodeId -> dataURL (Bilder vom PC)

function previewSize() {
  const [a, b] = $('sh-aspect').value.split(':').map(Number);
  const w = a >= b ? 640 : Math.round(640 * a / b);
  return { w, h: Math.round(w * b / a) };
}

function setNodeStatus(id, text, isErr) {
  const n = shaderGraph.nodes.get(id);
  if (!n) return;
  const st = n.el.querySelector('.g-status');
  if (st) { st.textContent = text || ''; st.classList.toggle('err', !!isErr); }
  n.el.classList.toggle('has-error', !!isErr);
}

async function loadUrlImage(node) {
  const url = String(node.data.params.url || '').trim();
  if (!url) { setNodeStatus(node.data.id, 'Bild-Adresse eintragen und „Laden“ drücken'); return; }
  if (!/^https?:\/\//i.test(url) && !/^data:image\//i.test(url)) { setNodeStatus(node.data.id, 'Die Adresse muss mit https:// beginnen', true); return; }
  setNodeStatus(node.data.id, 'Lädt …');
  let res;
  try { res = /^data:/i.test(url) ? { ok: true, dataUrl: url } : await api.invoke('studio.fetchImage', url); }
  catch (e) { res = { ok: false, error: e.message }; }
  if (!res || !res.ok) { setNodeStatus(node.data.id, res && res.error ? res.error : 'Bild konnte nicht geladen werden', true); return; }
  useImage(node.data.id, res.dataUrl);
}

function useImage(id, dataUrl) {
  const img = new Image();
  img.onload = () => {
    images.set(id, { img });
    renderer.setImage(id, img);
    const n = shaderGraph.nodes.get(id);
    if (n) {
      const th = n.el.querySelector('.g-thumb');
      if (th) { th.src = dataUrl; th.hidden = false; }
    }
    setNodeStatus(id, `${img.naturalWidth} × ${img.naturalHeight}`);
    dirty = true; schedule();
  };
  img.onerror = () => setNodeStatus(id, 'Das ist kein gültiges Bild', true);
  img.src = dataUrl;
}

const shaderGraph = window.GraphEditor($('graph-shader'), {
  catalog: SS.CATALOG,
  pinColor: (t) => t === 'img' ? '#5ad1ff' : '#aaa',
  onChange: (json) => { store.set('studio.shader', json); dirty = true; schedule(); cleanupImages(json); },
  renderExtra: (node, body) => {
    const t = node.data.type;
    if (t === 'image_url' || t === 'image_file') {
      const thumb = document.createElement('img');
      thumb.className = 'g-thumb'; thumb.hidden = true; thumb.alt = '';
      const row = document.createElement('div'); row.className = 'g-extra';
      const btn = document.createElement('button'); btn.type = 'button';
      btn.textContent = t === 'image_url' ? 'Laden' : 'Bild auswählen …';
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', async () => {
        if (t === 'image_url') loadUrlImage(node);
        else {
          const f = await pickFile($('file-image'));
          if (!f) return;
          if (f.size > 25 * 1024 * 1024) { setNodeStatus(node.data.id, 'Bild ist zu groß (max. 25 MB)', true); return; }
          const reader = new FileReader();
          reader.onload = () => {
            useImage(node.data.id, reader.result);
            fileImages[node.data.id] = reader.result;
            if (!store.set('studio.images', fileImages)) setNodeStatus(node.data.id, 'Geladen – zu groß zum Merken, nach Neustart neu wählen');
          };
          reader.readAsDataURL(f);
        }
      });
      row.append(btn);
      const st = document.createElement('div'); st.className = 'g-status';
      body.append(thumb, row, st);
      // URL-Feld: Enter lädt sofort
      if (t === 'image_url') {
        const inp = body.querySelector('input[type=text]');
        if (inp) inp.addEventListener('change', () => loadUrlImage(node));
      }
    } else if (t === 'glsl' || t === 'output') {
      const st = document.createElement('div'); st.className = 'g-status';
      body.append(st);
    }
  }
});

function cleanupImages(json) {
  const ids = new Set(json.nodes.map(n => n.id));
  for (const id of [...images.keys()]) if (!ids.has(id)) { images.delete(id); renderer.dropImage(id); }
  let changed = false;
  for (const id of Object.keys(fileImages)) if (!ids.has(id)) { delete fileImages[id]; changed = true; }
  if (changed) store.set('studio.images', fileImages);
}

let frame = 0;
function schedule() { if (!frame) frame = requestAnimationFrame(tick); }
function tick() {
  frame = 0;
  if (mode !== 'shader') return;
  if (dirty) {
    dirty = false;
    const json = shaderGraph.toJSON();
    const c = SS.compile(json);
    for (const n of shaderGraph.nodes.values()) if (n.el.classList.contains('has-error')) setNodeStatus(n.data.id, '', false);
    if (c.error) { showError(c.error); compiled = null; }
    else {
      try { renderer.use(c); compiled = c; showError(''); }
      catch (e) {
        const id = SS.errorNode(c, e.message);
        showError(friendly(e.message));
        if (id) setNodeStatus(id, friendly(e.message), true);
        compiled = null;
      }
    }
  }
  if (compiled) {
    const { w, h } = previewSize();
    renderer.draw(w, h);
    if (compiled.usesTime && $('sh-anim').checked) schedule();
  }
}
function friendly(log) {
  return String(log || '').split('\n').filter(l => /ERROR/.test(l)).slice(0, 3).map(l => l.replace(/^ERROR:\s*\d+:\d+:\s*/, 'Fehler: ')).join('\n') || String(log || '');
}
function showError(text) { $('sh-error').hidden = !text; $('sh-error').textContent = text; }

$('sh-aspect').addEventListener('change', () => { store.set('studio.aspect', $('sh-aspect').value); schedule(); });
$('sh-anim').addEventListener('change', schedule);

function outputSize() {
  const out = shaderGraph.toJSON().nodes.find(n => n.type === 'output');
  const [w, h] = String(out && out.params.size || '1920x1080').split('x').map(Number);
  return { w: w || 1920, h: h || 1080 };
}
function renderFull() {
  if (!compiled) return null;
  const { w, h } = outputSize();
  renderer.draw(w, h);
  return { w, h };
}
$('sh-png').addEventListener('click', () => {
  if (!renderFull()) { showError('Erst ein Bild bauen – es kommt noch nichts bei „Ausgabe“ an.'); return; }
  canvas.toBlob((blob) => { download(blob, `Elektron-Studio ${stamp()}.png`); schedule(); }, 'image/png');
});
$('sh-bg').addEventListener('click', async () => {
  if (!renderFull()) { showError('Erst ein Bild bauen – es kommt noch nichts bei „Ausgabe“ an.'); return; }
  const data = canvas.toDataURL('image/png');
  schedule();
  const ok = await api.invoke('studio.setBackground', data).catch(() => false);
  $('sh-bg').textContent = ok ? 'Hintergrund gesetzt ✓' : 'Hat nicht geklappt';
  setTimeout(() => { $('sh-bg').textContent = 'Als Startseiten-Hintergrund setzen'; }, 2500);
});

function loadShader(json) {
  shaderGraph.load(json);
  for (const n of shaderGraph.nodes.values()) {
    if (n.data.type === 'image_url' && n.data.params.url) loadUrlImage(n);
    if (n.data.type === 'image_file' && fileImages[n.data.id]) useImage(n.data.id, fileImages[n.data.id]);
  }
  if (!json.view) requestAnimationFrame(() => shaderGraph.fit());
  dirty = true; schedule();
}
$('sh-new').addEventListener('click', () => {
  if (!confirm('Alles löschen und neu anfangen?')) return;
  loadShader({ nodes: [{ id: 'out', type: 'output', x: 600, y: 200, params: {} }, { id: 'c', type: 'gradient', x: 240, y: 200, params: {} }],
    links: [{ from: { node: 'c', port: 'out' }, to: { node: 'out', port: 'in' } }] });
  store.set('studio.shader', shaderGraph.toJSON());
});
$('sh-example').addEventListener('click', () => { loadShader(JSON.parse(JSON.stringify(SS.EXAMPLE))); store.set('studio.shader', shaderGraph.toJSON()); });
$('sh-export').addEventListener('click', () => download(new Blob([JSON.stringify({ app: 'Elektron Studio', kind: 'shader', graph: shaderGraph.toJSON() }, null, 2)], { type: 'application/json' }), `Elektron-Shader ${stamp()}.json`));
$('sh-import').addEventListener('click', () => importGraph('shader'));

async function importGraph(kind) {
  const f = await pickFile($('file-import'));
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.kind !== kind || !data.graph) throw new Error(kind === 'shader' ? 'Das ist keine Shader-Datei.' : 'Das ist keine Ablauf-Datei.');
    if (kind === 'shader') { loadShader(data.graph); store.set('studio.shader', shaderGraph.toJSON()); }
    else { flowGraph.load(data.graph); saveFlows(); }
  } catch (e) { alert('Import fehlgeschlagen: ' + e.message); }
}

// ================================================================ Abläufe
const FS = window.FlowStudio;
let flowsEnabled = true;
let saveTimer = null;
const flowGraph = window.GraphEditor($('graph-flows'), {
  catalog: FS.CATALOG,
  pinColor: (t) => t === 'exec' ? '#ffffff' : '#aaa',
  onChange: () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveFlows, 500); $('fl-saved').textContent = '…'; },
  renderExtra: (node, body) => {
    if (!node.data.type.startsWith('on_')) return;
    const row = document.createElement('div'); row.className = 'g-extra';
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = '▶ Jetzt testen';
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', async () => {
      await saveFlows();
      const ok = await api.invoke('flows.test', node.data.id).catch(() => false);
      btn.textContent = ok ? '✓ Ausgeführt' : 'Nicht möglich';
      setTimeout(() => { btn.textContent = '▶ Jetzt testen'; }, 1500);
    });
    row.append(btn);
    body.append(row);
  }
});

async function saveFlows() {
  clearTimeout(saveTimer);
  try {
    await api.invoke('flows.save', flowGraph.toJSON(), flowsEnabled);
    $('fl-saved').textContent = 'Gespeichert ✓';
  } catch { $('fl-saved').textContent = 'Nicht gespeichert'; }
}
$('fl-enabled').addEventListener('change', () => { flowsEnabled = $('fl-enabled').checked; saveFlows(); });
$('fl-example').addEventListener('click', () => {
  if (flowGraph.nodes.size && !confirm('Beispiel laden? Deine aktuellen Abläufe werden ersetzt.')) return;
  flowGraph.load(JSON.parse(JSON.stringify(FS.EXAMPLE)));
  requestAnimationFrame(() => flowGraph.fit());
  saveFlows();
});
$('fl-export').addEventListener('click', () => download(new Blob([JSON.stringify({ app: 'Elektron Studio', kind: 'flows', graph: flowGraph.toJSON() }, null, 2)], { type: 'application/json' }), `Elektron-Ablaeufe ${stamp()}.json`));
$('fl-import').addEventListener('click', () => importGraph('flows'));

// ================================================================ Start
(async function start() {
  const aspect = store.get('studio.aspect');
  if (aspect) $('sh-aspect').value = aspect;
  const saved = store.get('studio.shader');
  loadShader(saved && saved.nodes && saved.nodes.length ? saved : JSON.parse(JSON.stringify(SS.EXAMPLE)));
  try {
    const f = await api.invoke('flows.get');
    flowsEnabled = f.enabled !== false;
    $('fl-enabled').checked = flowsEnabled;
    flowGraph.load(f.graph && f.graph.nodes && f.graph.nodes.length ? f.graph : { nodes: [], links: [] });
    if (!(f.graph && f.graph.view)) requestAnimationFrame(() => flowGraph.fit());
  } catch {}
  const want = new URLSearchParams(location.search).get('mode') || store.get('studio.mode');
  setMode(want === 'flows' ? 'flows' : 'shader');
})();
