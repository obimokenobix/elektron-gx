'use strict';
const api = window.elektron;
const q = new URLSearchParams(location.search);
const url = q.get('u') || '';
const $ = (id) => document.getElementById(id);

const ALLOWED = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'A', 'IMG', 'FIGURE', 'FIGCAPTION', 'BLOCKQUOTE',
  'PRE', 'CODE', 'EM', 'STRONG', 'B', 'I', 'U', 'BR', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SPAN', 'DIV', 'SECTION',
  'ARTICLE', 'SUP', 'SUB', 'SMALL', 'MARK', 'PICTURE', 'SOURCE', 'DL', 'DT', 'DD', 'CAPTION', 'TIME', 'ABBR', 'S', 'DEL', 'INS']);
const KEEP_ATTR = { A: ['href', 'title'], IMG: ['src', 'alt', 'title', 'width', 'height'], SOURCE: ['srcset', 'type', 'media'], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'] };

// Inhalt nur mit erlaubten Elementen und Attributen übernehmen
function clean(html, base) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node) => {
    for (const el of [...node.children]) {
      if (!ALLOWED.has(el.tagName)) { el.remove(); continue; }
      const keep = KEEP_ATTR[el.tagName] || [];
      for (const a of [...el.attributes]) if (!keep.includes(a.name)) el.removeAttribute(a.name);
      if (el.tagName === 'A') {
        try {
          const u = new URL(el.getAttribute('href') || '', base);
          if (!/^https?:$/.test(u.protocol)) el.removeAttribute('href'); else el.setAttribute('href', u.href);
        } catch { el.removeAttribute('href'); }
      }
      if (el.tagName === 'IMG') {
        try {
          const u = new URL(el.getAttribute('src') || '', base);
          if (!/^https?:$/.test(u.protocol)) el.remove(); else el.setAttribute('src', u.href);
        } catch { el.remove(); }
        el.setAttribute('loading', 'lazy');
      }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.childNodes;
}

async function load() {
  const art = await api.invoke('reader.get', q.get('id'));
  $('orig').href = url;
  if (!art) { location.href = url; return; }
  document.title = art.title || 'Lesemodus';
  $('site').textContent = art.site || (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  $('title').textContent = art.title || '';
  $('by').textContent = art.byline || '';
  $('content').replaceChildren(...clean(art.content, url));
}

let size = 19;
try { size = Number(localStorage.getItem('reader.size')) || 19; if (localStorage.getItem('reader.light') === '1') document.body.classList.add('light'); } catch {}
const applySize = () => { document.body.style.setProperty('--rs', size + 'px'); try { localStorage.setItem('reader.size', size); } catch {} };
applySize();
$('smaller').addEventListener('click', () => { size = Math.max(14, size - 1); applySize(); });
$('bigger').addEventListener('click', () => { size = Math.min(28, size + 1); applySize(); });
$('theme').addEventListener('click', () => {
  const on = document.body.classList.toggle('light');
  try { localStorage.setItem('reader.light', on ? '1' : '0'); } catch {}
});
api.on('look-changed', (l) => document.documentElement.style.setProperty('--accent', l.accent));
api.invoke('look').then(l => document.documentElement.style.setProperty('--accent', l.accent)).catch(() => {});
load();
