'use strict';
/*
 * Elektron – Abläufe ausführen (die „Blueprints“ aus dem Elektron Studio).
 * Nur eingebaute Aktionen; Tabs dürfen nur http(s)- und eigene Seiten öffnen.
 * Schutz vor Endlosschleifen: höchstens 60 Schritte pro Lauf und 8 Läufe gleichzeitig.
 */
const TRIGGERS = new Set(['on_start', 'on_page', 'on_time', 'on_interval', 'on_key', 'on_gaming', 'on_download']);
const ALLOWED_TYPES = new Set([...TRIGGERS, 'if_time', 'if_day', 'if_gaming', 'if_page', 'if_chance',
  'open_tab', 'gaming', 'adblock', 'notify', 'mute', 'screenshot', 'reader', 'close_tab', 'panel', 'background', 'style', 'wait', 'once']);

let host = null;
let graph = { nodes: [], links: [] };
let enabled = true;
let running = 0;
let timers = [];
let minuteTimer = null;
const lastFired = new Map();   // Uhrzeit-Auslöser: einmal pro Minute
const onceDone = new Map();    // „Nur einmal pro Tag“
const log = [];

function sanitize(g) {
  const nodes = [];
  for (const n of (g && Array.isArray(g.nodes) ? g.nodes : []).slice(0, 300)) {
    if (!n || typeof n.id !== 'string' || !ALLOWED_TYPES.has(n.type)) continue;
    const params = {};
    for (const [k, v] of Object.entries(n.params || {})) {
      if (typeof v === 'string') params[k] = v.slice(0, 2000);
      else if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
      else if (typeof v === 'boolean') params[k] = v;
    }
    nodes.push({ id: n.id.slice(0, 64), type: n.type, x: Number(n.x) || 0, y: Number(n.y) || 0, params });
  }
  const ids = new Set(nodes.map(n => n.id));
  const links = (g && Array.isArray(g.links) ? g.links : []).slice(0, 1000)
    .filter(l => l && l.from && l.to && ids.has(l.from.node) && ids.has(l.to.node))
    .map(l => ({ from: { node: String(l.from.node), port: String(l.from.port) }, to: { node: String(l.to.node), port: String(l.to.port) } }));
  return { nodes, links, view: g && g.view ? { x: Number(g.view.x) || 0, y: Number(g.view.y) || 0, z: Number(g.view.z) || 1 } : undefined };
}

function init(h) { host = h; }

function setGraph(g, on) {
  graph = sanitize(g);
  enabled = on !== false;
  arm();
  return graph;
}

function arm() {
  for (const t of timers) clearInterval(t);
  timers = [];
  clearInterval(minuteTimer);
  minuteTimer = null;
  if (!enabled) return;
  for (const n of graph.nodes) {
    if (n.type === 'on_interval') {
      const min = Math.min(1440, Math.max(1, Number(n.params.min) || 30));
      timers.push(setInterval(() => fire(n.id), min * 60000));
    }
  }
  if (graph.nodes.some(n => n.type === 'on_time')) {
    minuteTimer = setInterval(checkTimes, 20000);
    checkTimes();
  }
}

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
function dayOk(mode, d = new Date()) {
  const wd = d.getDay();
  if (mode === 'work') return wd >= 1 && wd <= 5;
  if (mode === 'weekend') return wd === 0 || wd === 6;
  return true;
}
function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function checkTimes() {
  const now = new Date();
  const key = now.toDateString() + ' ' + hhmm(now);
  for (const n of graph.nodes) {
    if (n.type !== 'on_time') continue;
    const t = parseTime(n.params.time);
    if (t == null || t !== now.getHours() * 60 + now.getMinutes() || !dayOk(n.params.days, now)) continue;
    if (lastFired.get(n.id) === key) continue;
    lastFired.set(n.id, key);
    fire(n.id);
  }
}

/** Ein Ereignis aus dem Browser: 'start' | 'page' | 'key' | 'gaming' | 'download' */
function event(type, data = {}) {
  if (!enabled || !host) return;
  for (const n of graph.nodes) {
    const p = n.params;
    let ok = false;
    if (type === 'start' && n.type === 'on_start') ok = true;
    else if (type === 'page' && n.type === 'on_page') ok = !!p.match && String(data.url || '').toLowerCase().includes(String(p.match).toLowerCase());
    else if (type === 'key' && n.type === 'on_key') ok = String(p.key) === String(data.key);
    else if (type === 'gaming' && n.type === 'on_gaming') ok = (p.state === 'on') === !!data.on;
    else if (type === 'download' && n.type === 'on_download') ok = !p.ext || String(data.name || '').toLowerCase().endsWith(String(p.ext).toLowerCase().trim());
    if (ok) fire(n.id);
  }
}

function next(nodeId, port) {
  return graph.links.filter(l => l.from.node === nodeId && l.from.port === port).map(l => l.to.node);
}

async function fire(triggerId) {
  if (running >= 8) return;
  running++;
  const steps = { n: 0 };
  try {
    for (const id of next(triggerId, 'then')) await run(id, steps);
  } catch (e) {
    note('Fehler: ' + (e && e.message || e));
  } finally { running--; }
}

function note(text) { log.push({ t: Date.now(), text }); if (log.length > 50) log.shift(); }

async function run(id, steps) {
  if (++steps.n > 60) return;
  const n = graph.nodes.find(x => x.id === id);
  if (!n) return;
  const p = n.params;
  let port = 'then';
  switch (n.type) {
    case 'if_time': {
      const now = new Date(); const m = now.getHours() * 60 + now.getMinutes();
      const a = parseTime(p.from), b = parseTime(p.to);
      const inside = a == null || b == null ? false : a <= b ? (m >= a && m < b) : (m >= a || m < b);
      port = inside ? 'yes' : 'no'; break;
    }
    case 'if_day': port = dayOk(p.days) ? 'yes' : 'no'; break;
    case 'if_gaming': port = host.isGaming() ? 'yes' : 'no'; break;
    case 'if_page': port = p.match && String(host.activeUrl() || '').toLowerCase().includes(String(p.match).toLowerCase()) ? 'yes' : 'no'; break;
    case 'if_chance': port = Math.random() * 100 < (Number(p.pct) || 0) ? 'yes' : 'no'; break;
    case 'open_tab': {
      const url = String(p.url || '').trim();
      if (/^https?:\/\/\S+$/i.test(url) || /^elektron:\/\/start\/[\w./?=&-]*$/i.test(url)) host.openTab(url, !p.bg);
      break;
    }
    case 'gaming': host.setGaming(p.state === 'toggle' ? !host.isGaming() : p.state === 'on'); break;
    case 'adblock': host.setAdblock(p.state === 'on'); break;
    case 'notify': host.toast(String(p.text || '').slice(0, 200)); break;
    case 'mute': host.muteAll(p.state === 'mute'); break;
    case 'screenshot': host.screenshot(!!p.full); break;
    case 'reader': host.reader(); break;
    case 'close_tab': host.closeActive(); break;
    case 'panel': host.openPanel(String(p.which || '')); break;
    case 'background': host.setBackground(String(p.bg || '')); break;
    case 'style': host.setStyle(p.style === 'normal' ? 'normal' : 'gaming'); break;
    case 'wait': await new Promise(r => setTimeout(r, Math.min(3600, Math.max(1, Number(p.sec) || 1)) * 1000)); break;
    case 'once': {
      const today = new Date().toDateString();
      if (onceDone.get(id) === today) return;
      onceDone.set(id, today);
      break;
    }
    default: return;
  }
  for (const nid of next(id, port)) await run(nid, steps);
}

/** Zum Testen aus dem Studio: einen Auslöser sofort ausführen */
function test(triggerId) {
  const n = graph.nodes.find(x => x.id === triggerId);
  if (!n || !TRIGGERS.has(n.type)) return false;
  const was = enabled;
  enabled = true;
  fire(triggerId).finally(() => { enabled = was; });
  return true;
}

module.exports = { init, setGraph, event, test, sanitize, getLog: () => log.slice() };
