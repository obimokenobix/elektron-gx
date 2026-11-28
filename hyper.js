'use strict';
/*
 * HyperSearch X – Bausteine für die Adressleiste und die Suchseite (start/search.html):
 *  • Rechner: „(12+8)*3“, „2^10“, „20 % * 50“ werden sofort ausgerechnet
 *  • Abkürzungen (Bangs): „!yt minecraft“ sucht direkt auf YouTube
 *  • Wikipedia-Sprache passend zur Browser-Sprache
 */

const BANGS = {
  yt: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
  w: { name: 'Wikipedia', url: (lang) => `https://${lang}.wikipedia.org/w/index.php?search=` },
  gh: { name: 'GitHub', url: 'https://github.com/search?q=' },
  map: { name: 'Karte', url: 'https://www.openstreetmap.org/search?query=' },
  d: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  b: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
  sp: { name: 'Startpage', url: 'https://www.startpage.com/sp/search?query=' },
  g: { name: 'Google', url: 'https://www.google.com/search?q=' },
  r: { name: 'Reddit', url: 'https://www.reddit.com/search/?q=' },
  tw: { name: 'Twitch', url: 'https://www.twitch.tv/search?term=' },
  st: { name: 'Steam', url: 'https://store.steampowered.com/search/?term=' }
};

/** „!yt minecraft“ → Such-Adresse, sonst null */
function bang(text, lang = 'de') {
  const m = String(text || '').match(/(^|\s)!([a-z]+)(?=\s|$)/i);
  if (!m) return null;
  const b = BANGS[m[2].toLowerCase()];
  if (!b) return null;
  const q = (String(text).slice(0, m.index) + ' ' + String(text).slice(m.index + m[0].length)).trim();
  const base = typeof b.url === 'function' ? b.url(lang) : b.url;
  if (!q) { try { return new URL(base).origin + '/'; } catch { return null; } }
  return base + encodeURIComponent(q);
}

/** Sicherer Rechner (ohne eval) – nur Ziffern, + - * / ( ) % ^ und Komma/Punkt; sonst null */
function calc(text) {
  let s = String(text || '').replace(/\s+/g, '').replace(/,/g, '.').replace(/[x×]/g, '*').replace(/÷/g, '/').replace(/=$/, '');
  if (s.length > 120) return null;
  if (!/^[\d.+\-*/()%^]+$/.test(s) || !/\d/.test(s) || !/[+\-*/%^]/.test(s.replace(/^-/, ''))) return null;
  if (/^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$/.test(s)) return null; // Datum, keine Rechnung
  if ((s.match(/\(/g) || []).length > 20) return null;
  try {
    const v = evalMath(s);
    if (typeof v !== 'number' || !isFinite(v)) return null;
    return Number(v.toPrecision(12));
  } catch { return null; }
}

// Kleiner Rechen-Parser (ohne eval): + - * / ^ %, Klammern, Vorzeichen
function evalMath(src) {
  let i = 0;
  const peek = () => src[i];
  const num = () => {
    const m = /^\d+(?:\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (!m) throw new Error('Zahl erwartet');
    i += m[0].length;
    let v = Number(m[0]);
    if (peek() === '%') { i++; v /= 100; }
    return v;
  };
  const atom = () => {
    if (peek() === '-') { i++; return -atom(); }
    if (peek() === '+') { i++; return atom(); }
    if (peek() === '(') { i++; const v = sum(); if (peek() !== ')') throw new Error(') erwartet'); i++; return v; }
    return num();
  };
  const pow = () => { const b = atom(); if (peek() === '^') { i++; return Math.pow(b, pow()); } return b; };
  const prod = () => {
    let v = pow();
    while (peek() === '*' || peek() === '/') { const op = src[i++]; const r = pow(); v = op === '*' ? v * r : v / r; }
    return v;
  };
  const sum = () => {
    let v = prod();
    while (peek() === '+' || peek() === '-') { const op = src[i++]; const r = prod(); v = op === '+' ? v + r : v - r; }
    return v;
  };
  const v = sum();
  if (i !== src.length) throw new Error('unerwartetes Zeichen');
  return v;
}

/** Wikipedia-Sprachcode passend zur Oberflächensprache */
function wikiLang(code) {
  const base = String(code || 'de').toLowerCase().split('-')[0];
  return ({ nb: 'no', fil: 'tl', 'zh': 'zh' })[base] || base || 'de';
}

module.exports = { BANGS, bang, calc, wikiLang };
