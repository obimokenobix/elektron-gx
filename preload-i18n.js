'use strict';
/*
 * Übersetzt die eigenen Seiten von Elektron (Oberfläche, Startseite, Einstellungen, Studio …)
 * direkt beim Anzeigen: Texte, Tooltips und Platzhalter. Fremde Webseiten werden nie angefasst.
 */
const { ipcRenderer, contextBridge } = require('electron');

(function () {
  const proto = location.protocol;
  if (proto !== 'elektron:' && proto !== 'elektron-ui:') return;
  let dict = null;
  try { dict = ipcRenderer.sendSync('i18n-dict'); } catch {}
  if (!dict) return;

  const apply = () => {
    const html = document.documentElement;
    if (html) { html.lang = dict.code; html.dir = dict.dir || 'ltr'; }
  };
  if (!dict.keys || !dict.keys.length) { apply(); return; } // Deutsch = Originaltexte

  // ---------------------------------------------------------------- Übersetzer
  const exact = new Map();
  const patterns = [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  dict.keys.forEach((k, i) => {
    const v = dict.values[i];
    if (typeof v !== 'string' || !v || v === k) return;
    if (/\{\d+\}/.test(k)) {
      const order = [];
      const src = esc(k).replace(/\\\{(\d+)\\\}/g, (_, n) => { order.push(Number(n)); return '([\\s\\S]+?)'; });
      patterns.push({ re: new RegExp('^' + src + '$'), order, out: v, len: k.length });
    } else exact.set(k, v);
  });
  patterns.sort((a, b) => b.len - a.len);
  const done = new Set(dict.values); // schon übersetzte Texte nicht nochmal anfassen

  function t(text, depth = 0) {
    const n = text.replace(/\s+/g, ' ').trim();
    if (!n || done.has(n)) return null;
    const hit = exact.get(n);
    if (hit !== undefined) return hit;
    if (depth > 2) return null;
    for (const p of patterns) {
      const m = p.re.exec(n);
      if (!m) continue;
      const vals = {};
      p.order.forEach((idx, i) => { vals[idx] = m[i + 1]; });
      return p.out.replace(/\{(\d+)\}/g, (_, k) => { const v = vals[k] || ''; return t(v, depth + 1) || v; });
    }
    return null;
  }
  const keepSpace = (orig, tr) => {
    const lead = orig.match(/^\s*/)[0], trail = orig.match(/\s*$/)[0];
    return lead + tr + trail;
  };

  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'label'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);

  function textNode(node) {
    const p = node.parentElement;
    if (!p || SKIP.has(p.tagName) || p.closest('[data-no-i18n],[contenteditable=""],[contenteditable="true"]')) return;
    const v = node.nodeValue;
    if (!v || !/[A-Za-zÄÖÜäöüß]/.test(v)) return;
    const tr = t(v);
    if (tr != null && tr !== v.trim()) node.nodeValue = keepSpace(v, tr);
  }
  function element(el) {
    if (el.closest && el.closest('[data-no-i18n]')) return;
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) { const tr = t(v); if (tr != null) el.setAttribute(a, tr); }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (SKIP.has(root.tagName) && root.tagName !== 'TEXTAREA') return; element(root); }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) { if (n.nodeType === 3) textNode(n); else element(n); }
  }

  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') textNode(m.target);
      else if (m.type === 'attributes') { if (ATTRS.includes(m.attributeName)) element(m.target); }
      else for (const n of m.addedNodes) walk(n);
    }
  });
  const start = () => {
    apply();
    walk(document);
    obs.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });
  document.addEventListener('DOMContentLoaded', () => { apply(); walk(document); });

  // Abfragen (confirm/alert/prompt) der Seite ebenfalls übersetzen
  try {
    const pairs = [];
    exact.forEach((v, k) => { if (k.length > 12) pairs.push([k, v]); });
    contextBridge.executeInMainWorld({
      func: (pairs) => {
        const m = new Map(pairs);
        const tr = (s) => { const n = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return m.has(n) ? m.get(n) : s; };
        for (const name of ['alert', 'confirm', 'prompt']) {
          const orig = window[name];
          if (typeof orig !== 'function') continue;
          window[name] = function (msg, ...rest) { return orig.call(window, tr(msg), ...rest); };
        }
      },
      args: [pairs]
    });
  } catch {}
})();
