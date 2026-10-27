'use strict';
/*
 * Elektron – Übersetzungen.
 * Quelltexte sind Deutsch. locales/_keys.json enthält alle deutschen Texte, locales/<sprache>.json
 * die Übersetzungen in derselben Reihenfolge. Platzhalter {0}, {1} … stehen für Zahlen, Namen usw.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'locales');
const LANGUAGES = JSON.parse(fs.readFileSync(path.join(DIR, 'languages.json'), 'utf8'));
const SOURCE = 'de';

let current = { code: SOURCE, dir: 'ltr', keys: [], values: [] };
let exact = new Map();
let patterns = [];

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(keys, values) {
  exact = new Map();
  patterns = [];
  keys.forEach((k, i) => {
    const v = values[i];
    if (typeof v !== 'string' || !v || v === k) return;
    if (/\{\d+\}/.test(k)) {
      const order = [];
      const src = esc(k).replace(/\\\{(\d+)\\\}/g, (_, n) => { order.push(Number(n)); return '([\\s\\S]+?)'; });
      patterns.push({ re: new RegExp('^' + src + '$'), order, out: v, len: k.length });
    } else exact.set(k, v);
  });
  patterns.sort((a, b) => b.len - a.len); // genauere (längere) Muster zuerst
}

/** Passende Sprache zu einem Code wie "de-AT", "pt-BR", "zh-Hant-TW" finden */
function match(code) {
  if (!code) return null;
  const c = String(code).replace('_', '-');
  const lower = c.toLowerCase();
  if (/^zh/.test(lower)) return /(tw|hk|mo|hant)/.test(lower) ? 'zh-TW' : 'zh-CN';
  if (/^(nb|nn|no)\b/.test(lower)) return 'nb';
  if (/^(tl|fil)\b/.test(lower)) return 'fil';
  const exactHit = LANGUAGES.find(l => l.code.toLowerCase() === lower);
  if (exactHit) return exactHit.code;
  const base = lower.split('-')[0];
  const hit = LANGUAGES.find(l => l.code.toLowerCase() === base);
  return hit ? hit.code : null;
}

function available(code) {
  return code === SOURCE || fs.existsSync(path.join(DIR, code + '.json'));
}

function load(code) {
  const lang = LANGUAGES.find(l => l.code === code) || LANGUAGES[0];
  let keys = [], values = [];
  if (lang.code !== SOURCE) {
    try {
      keys = JSON.parse(fs.readFileSync(path.join(DIR, '_keys.json'), 'utf8'));
      values = JSON.parse(fs.readFileSync(path.join(DIR, lang.code + '.json'), 'utf8'));
    } catch { keys = []; values = []; }
  }
  current = { code: lang.code, dir: lang.dir || 'ltr', keys, values };
  compile(keys, values);
  return current;
}

/** Text übersetzen (exakt oder über ein Muster mit Platzhaltern) */
function t(text) {
  if (current.code === SOURCE || text == null) return text;
  const s = String(text);
  const n = norm(s);
  if (!n) return s;
  const hit = exact.get(n);
  if (hit !== undefined) return hit;
  for (const p of patterns) {
    const m = p.re.exec(n);
    if (m) {
      const vals = {};
      p.order.forEach((idx, i) => { vals[idx] = m[i + 1]; });
      return p.out.replace(/\{(\d+)\}/g, (_, k) => {
        const v = vals[k];
        return v === undefined ? '' : t(v); // Platzhalter wie „Gaming-Modus“ ggf. auch übersetzen
      });
    }
  }
  return s;
}

/** Menü-Vorlagen (Electron) rekursiv übersetzen */
function menu(template) {
  if (current.code === SOURCE) return template;
  return template.map(item => {
    if (!item || typeof item !== 'object') return item;
    const out = { ...item };
    if (typeof out.label === 'string') out.label = t(out.label);
    if (typeof out.sublabel === 'string') out.sublabel = t(out.sublabel);
    if (typeof out.toolTip === 'string') out.toolTip = t(out.toolTip);
    if (Array.isArray(out.submenu)) out.submenu = menu(out.submenu);
    return out;
  });
}

function info() {
  const l = LANGUAGES.find(x => x.code === current.code) || LANGUAGES[0];
  return { code: current.code, dir: current.dir, name: l.name, flags: l.flags };
}

module.exports = { LANGUAGES, SOURCE, match, available, load, t, menu, info, current: () => current };
