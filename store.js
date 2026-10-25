'use strict';
/*
 * Elektron GX – Datenablage für Lesezeichen, Verlauf und Downloads.
 * Alles liegt als JSON im Benutzerordner (%APPDATA%\Elektron GX).
 */
const fs = require('fs');
const path = require('path');

class JsonFile {
  constructor(file, fallback) {
    this.file = file;
    this.timer = null;
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { this.data = fallback; }
  }
  save(delay = 600) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }
  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.warn('Speichern fehlgeschlagen:', this.file, e.message); }
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = (u) => String(u || '').replace(/#.*$/, '').replace(/\/$/, '');

function createStore(dir) {
  const bm = new JsonFile(path.join(dir, 'bookmarks.json'), { items: [] });
  const hist = new JsonFile(path.join(dir, 'history.json'), { items: [] });
  const dl = new JsonFile(path.join(dir, 'downloads.json'), { items: [] });
  if (!Array.isArray(bm.data.items)) bm.data = { items: [] };
  if (!Array.isArray(hist.data.items)) hist.data = { items: [] };
  if (!Array.isArray(dl.data.items)) dl.data = { items: [] };

  const MAX_HISTORY = 20000;

  const store = {
    // ---------------------------------------------------------- Lesezeichen
    bookmarks: () => bm.data.items,
    findBookmark: (url) => bm.data.items.find(b => norm(b.url) === norm(url)),
    addBookmark(url, title) {
      const ex = store.findBookmark(url);
      if (ex) return ex;
      const b = { id: uid(), url, title: title || url, created: Date.now() };
      bm.data.items.push(b);
      bm.save();
      return b;
    },
    updateBookmark(id, patch) {
      const b = bm.data.items.find(x => x.id === id);
      if (!b) return null;
      if (typeof patch.title === 'string') b.title = patch.title.slice(0, 200);
      if (typeof patch.url === 'string' && /^(https?|elektron|file):/i.test(patch.url)) b.url = patch.url;
      bm.save();
      return b;
    },
    removeBookmark(id) {
      bm.data.items = bm.data.items.filter(b => b.id !== id);
      bm.save();
    },
    moveBookmark(id, toIndex) {
      const i = bm.data.items.findIndex(b => b.id === id);
      if (i < 0) return;
      const [b] = bm.data.items.splice(i, 1);
      bm.data.items.splice(Math.max(0, Math.min(toIndex, bm.data.items.length)), 0, b);
      bm.save();
    },
    importBookmarks(list) {
      let added = 0;
      for (const { url, title } of list) {
        if (!/^https?:/i.test(url) || store.findBookmark(url)) continue;
        bm.data.items.push({ id: uid(), url, title: title || url, created: Date.now() });
        added++;
      }
      bm.save();
      return added;
    },

    // ---------------------------------------------------------- Verlauf
    history: () => hist.data.items,
    addVisit(url, title) {
      if (!/^https?:/i.test(url)) return;
      const items = hist.data.items;
      const last = items[items.length - 1];
      if (last && norm(last.url) === norm(url) && Date.now() - last.time < 30000) {
        if (title) last.title = title;
        last.time = Date.now();
      } else {
        items.push({ id: uid(), url, title: title || url, time: Date.now() });
        if (items.length > MAX_HISTORY) items.splice(0, items.length - MAX_HISTORY);
      }
      hist.save(2000);
    },
    updateTitle(url, title) {
      const items = hist.data.items;
      for (let i = items.length - 1; i >= Math.max(0, items.length - 20); i--) {
        if (norm(items[i].url) === norm(url)) { items[i].title = title; hist.save(2000); return; }
      }
    },
    searchHistory(q, limit = 300) {
      const s = String(q || '').toLowerCase().trim();
      const out = [];
      for (let i = hist.data.items.length - 1; i >= 0 && out.length < limit; i--) {
        const h = hist.data.items[i];
        if (!s || h.url.toLowerCase().includes(s) || (h.title || '').toLowerCase().includes(s)) out.push(h);
      }
      return out;
    },
    removeVisit(id) {
      hist.data.items = hist.data.items.filter(h => h.id !== id);
      hist.save(300);
    },
    clearHistory(sinceMs) {
      if (sinceMs) {
        const cut = Date.now() - sinceMs;
        hist.data.items = hist.data.items.filter(h => h.time < cut);
      } else {
        hist.data.items = [];
      }
      hist.save(100);
    },

    // ---------------------------------------------------------- Vorschläge
    suggest(q, limit = 6) {
      const s = String(q || '').toLowerCase().trim();
      if (!s) return [];
      const map = new Map();
      const add = (url, title, score, kind) => {
        const k = norm(url);
        const cur = map.get(k);
        if (cur) { cur.score += score; if (kind === 'bookmark') cur.kind = 'bookmark'; }
        else map.set(k, { url, title, score, kind });
      };
      const match = (url, title) => {
        const u = url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
        const t = (title || '').toLowerCase();
        if (u.startsWith(s)) return 3;
        if (t.startsWith(s)) return 2;
        if (u.includes(s) || t.includes(s)) return 1;
        return 0;
      };
      for (const b of bm.data.items) {
        const m = match(b.url, b.title);
        if (m) add(b.url, b.title, 6 + m * 2, 'bookmark');
      }
      const now = Date.now();
      const items = hist.data.items;
      for (let i = items.length - 1; i >= Math.max(0, items.length - 6000); i--) {
        const h = items[i];
        const m = match(h.url, h.title);
        if (!m) continue;
        const ageDays = (now - h.time) / 86400000;
        add(h.url, h.title, m + 1 / (1 + ageDays), 'history');
      }
      return [...map.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    },

    // ---------------------------------------------------------- Downloads
    downloads: () => dl.data.items,
    addDownload(d) {
      dl.data.items.unshift(d);
      if (dl.data.items.length > 300) dl.data.items.length = 300;
      dl.save();
      return d;
    },
    updateDownload(id, patch, saveNow = false) {
      const d = dl.data.items.find(x => x.id === id);
      if (!d) return null;
      Object.assign(d, patch);
      dl.save(saveNow ? 50 : 1500);
      return d;
    },
    removeDownload(id) {
      dl.data.items = dl.data.items.filter(d => d.id !== id);
      dl.save();
    },
    clearDownloads() {
      dl.data.items = dl.data.items.filter(d => d.state === 'progressing');
      dl.save();
    },

    flushAll() { bm.flush(); hist.flush(); dl.flush(); }
  };
  // abgebrochene Downloads vom letzten Mal markieren
  for (const d of dl.data.items) if (d.state === 'progressing') d.state = 'interrupted';
  return store;
}

module.exports = { createStore, uid };
