'use strict';
const api = window.elektron;
const recs = [...document.querySelectorAll('.rec')];
const go = document.getElementById('go');
const skip = document.getElementById('skip');
const err = document.getElementById('error');
let busy = false;

function setStatus(rec, text, cls) {
  const s = rec.querySelector('.status');
  s.textContent = text;
  s.className = 'status' + (cls ? ' ' + cls : '');
}

function updateButton() {
  const any = recs.some(r => r.querySelector('input').checked && !r.classList.contains('done'));
  go.textContent = any ? 'Installieren & loslegen' : 'Loslegen';
}

async function finish() {
  await api.invoke('welcome.done');
  location.href = 'elektron://start/';
}

async function init() {
  const st = await api.invoke('welcome.state');
  for (const { id, installed } of st) {
    const rec = recs.find(r => r.dataset.id === id);
    if (rec && installed) {
      rec.classList.add('done');
      rec.querySelector('input').checked = true;
      rec.querySelector('input').disabled = true;
      setStatus(rec, 'Installiert', 'ok');
    }
  }
  updateButton();
}

recs.forEach(r => r.querySelector('input').addEventListener('change', updateButton));
document.querySelectorAll('.rec .ico img').forEach(img => img.addEventListener('error', () => { img.replaceWith(document.createTextNode(img.closest('.rec').querySelector('b').textContent[0])); }));

go.addEventListener('click', async () => {
  if (busy) return;
  const todo = recs.filter(r => r.querySelector('input').checked && !r.classList.contains('done'));
  if (!todo.length) return finish();
  busy = true;
  go.disabled = skip.disabled = true;
  err.hidden = true;
  let failed = [];
  for (const rec of todo) {
    rec.querySelector('input').disabled = true;
    setStatus(rec, 'Wird installiert …', 'busy');
    const r = await api.invoke('welcome.install', rec.dataset.id);
    if (r.ok) {
      rec.classList.add('done');
      setStatus(rec, 'Installiert', 'ok');
    } else {
      rec.querySelector('input').disabled = false;
      setStatus(rec, 'Fehlgeschlagen', 'err');
      failed.push(rec.querySelector('b').firstChild.textContent.trim());
    }
  }
  busy = false;
  go.disabled = skip.disabled = false;
  if (failed.length) {
    err.hidden = false;
    err.textContent = `${failed.join(' und ')} konnte nicht installiert werden. Prüf deine Internetverbindung und versuch es nochmal – oder installiere es später über Menü → Chrome Web Store.`;
    updateButton();
    return;
  }
  go.textContent = 'Fertig!';
  setTimeout(finish, 900);
});

skip.addEventListener('click', finish);
init();
