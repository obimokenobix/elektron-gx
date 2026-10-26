'use strict';
/* Gemeinsame Hilfen für die Browser-Seiten (Lesezeichen, Verlauf, Downloads) */
window.ui = (() => {
  const api = window.elektron;
  const ICONS = {
    del: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    retry: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>'
  };
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function favicon(url) {
    const box = el('span', 'ico');
    const h = host(url);
    const img = new Image();
    img.alt = '';
    img.src = `favicon?host=${encodeURIComponent(h)}`;
    img.onerror = () => { box.textContent = (h[0] || '?').toUpperCase(); };
    box.appendChild(img);
    return box;
  }
  function iconBtn(name, title, fn) {
    const b = el('button', 'icon-btn');
    b.type = 'button';
    b.title = title;
    b.innerHTML = ICONS[name];
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    return b;
  }
  function dayLabel(ts) {
    const d = new Date(ts), now = new Date();
    const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((start(now) - start(d)) / 86400000);
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Gestern';
    return d.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: diff > 300 ? 'numeric' : undefined });
  }
  const time = (ts) => new Date(ts).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
  function bytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i > 1 ? 1 : 0).replace('.', ',') + ' ' + u[i];
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  return { api, el, favicon, iconBtn, host, dayLabel, time, bytes, debounce };
})();
