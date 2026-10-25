'use strict';
/* global suggestApi */
const list = document.getElementById('list');
const ICON = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
  go: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>'
};

function host(u) { try { return new URL(u).hostname; } catch { return ''; } }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function highlight(target, text, q) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) { target.textContent = text; return; }
  target.append(text.slice(0, i), el('b', null, text.slice(i, i + q.length)), text.slice(i + q.length));
}

suggestApi.onItems(({ items, selected, query, accent }) => {
  if (accent) document.documentElement.style.setProperty('--accent', accent);
  list.replaceChildren();
  items.forEach((it, i) => {
    const li = el('li', i === selected ? 'sel' : '');
    const ic = el('span', 'ic' + (it.kind === 'bookmark' ? ' star' : ''));
    if (it.kind === 'search' || it.kind === 'suggestion') ic.innerHTML = ICON.search;
    else if (it.kind === 'go') ic.innerHTML = ICON.go;
    else if (it.kind === 'bookmark') ic.innerHTML = ICON.star;
    else {
      const img = new Image();
      img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host(it.url))}&sz=32`;
      img.onerror = () => { ic.innerHTML = ICON.history; };
      ic.appendChild(img);
    }
    const main = el('span', 'main');
    const t = el('span', 't');
    highlight(t, it.title || it.url, query);
    main.append(t);
    if (it.kind === 'history' || it.kind === 'bookmark') main.append(el('span', 'u', (it.url || '').replace(/^https?:\/\/(www\.)?/, '')));
    li.append(ic, main);
    li.addEventListener('mousedown', (e) => { e.preventDefault(); suggestApi.pick(i); });
    li.addEventListener('mouseenter', () => suggestApi.hover(i));
    list.appendChild(li);
  });
});
