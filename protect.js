'use strict';
/*
 * Elektron GX – Schutz
 *  • Phishing- und Malware-Schutz über öffentliche Sperrlisten
 *      - Phishing.Database (aktive Phishing-Domains, MIT-Lizenz)
 *      - URLhaus von abuse.ch (Domains, die Schadsoftware verteilen, CC0)
 *    Die Listen werden alle 6 Stunden aktualisiert und kompakt als Hash-Tabelle gespeichert
 *    (ca. 3 MB statt 30 MB im Arbeitsspeicher).
 *  • HTTPS-Modus: Seiten werden verschlüsselt geladen; nur-unsichere Seiten bekommen eine Warnseite.
 *  • Virenscan für Downloads mit dem in Windows eingebauten Microsoft Defender.
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const LISTS = [
  { kind: 'phishing', url: 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt', format: 'domains' },
  { kind: 'malware', url: 'https://urlhaus.abuse.ch/downloads/hostfile/', format: 'hosts' }
];
const REFRESH_MS = 6 * 3600 * 1000;

// Große, seriöse Anbieter, auf denen Betrüger einzelne Seiten hosten (Google Docs, Sites …).
// Diese Domains werden nie als Ganzes gesperrt – sonst wäre z. B. ganz docs.google.com blockiert.
const NEVER_BLOCK = new Set([
  'google.com', 'google.at', 'google.de', 'youtube.com', 'gstatic.com', 'googleusercontent.com',
  'microsoft.com', 'live.com', 'office.com', 'microsoftonline.com', 'sharepoint.com', 'onedrive.com', 'bing.com',
  'apple.com', 'icloud.com', 'amazon.com', 'amazon.de', 'github.com', 'githubusercontent.com',
  'discord.com', 'discord.gg', 'twitch.tv', 'steampowered.com', 'steamcommunity.com', 'roblox.com',
  'facebook.com', 'instagram.com', 'whatsapp.com', 'reddit.com', 'wikipedia.org', 'claude.ai', 'anthropic.com',
  'openai.com', 'chatgpt.com', 'dropbox.com', 'paypal.com', 'obimokenobix.github.io'
]);

let tldts = null;
try { tldts = require('tldts-experimental'); } catch {}

// ---------------------------------------------------------------- kompakte Hash-Tabelle
function hash53(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return (h1 >>> 0) * 2097152 + ((h2 >>> 0) & 0x1fffff);
}

function buildTable(hosts) {
  const arr = new Float64Array(hosts.length);
  let n = 0;
  for (const h of hosts) arr[n++] = hash53(h);
  const sorted = arr.subarray(0, n).sort();
  return sorted;
}

function has(table, host) {
  if (!table || !table.length) return false;
  const key = hash53(host);
  let lo = 0, hi = table.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = table[mid];
    if (v === key) return true;
    if (v < key) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

// ---------------------------------------------------------------- Listen laden
const tables = {};          // kind -> Float64Array
const info = {};            // kind -> { count, updated }
let refreshTimer = null;

const cacheFile = (kind) => path.join(app.getPath('userData'), `schutz-${kind}.bin`);

function parse(text, format) {
  const out = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (format === 'hosts') {
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      line = parts[1];
    }
    line = line.toLowerCase().replace(/\.$/, '');
    if (line === 'localhost' || !line.includes('.') || line.length > 253) continue;
    out.push(line);
  }
  return out;
}

function loadCache(list) {
  try {
    const buf = fs.readFileSync(cacheFile(list.kind));
    const stat = fs.statSync(cacheFile(list.kind));
    tables[list.kind] = new Float64Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 8));
    info[list.kind] = { count: tables[list.kind].length, updated: stat.mtimeMs };
    return Date.now() - stat.mtimeMs < REFRESH_MS;
  } catch { return false; }
}

async function download(list, fetchImpl) {
  const res = await fetchImpl(list.url, { headers: { 'user-agent': 'ElektronGX-Schutz' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const hosts = parse(await res.text(), list.format);
  if (hosts.length < 50) throw new Error('Liste zu kurz');
  const table = buildTable(hosts);
  tables[list.kind] = table;
  info[list.kind] = { count: table.length, updated: Date.now() };
  try { fs.writeFileSync(cacheFile(list.kind), Buffer.from(table.buffer, table.byteOffset, table.byteLength)); } catch {}
}

async function refresh(fetchImpl, force = false) {
  for (const list of LISTS) {
    const fresh = loadCache(list);
    if (fresh && !force) continue;
    try { await download(list, fetchImpl); }
    catch (e) { console.warn(`Schutzliste ${list.kind}:`, e.message); }
  }
}

function start(fetchImpl) {
  refresh(fetchImpl).catch(() => {});
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => refresh(fetchImpl, true).catch(() => {}), REFRESH_MS);
}

// ---------------------------------------------------------------- Prüfen
function registrable(host) {
  if (!tldts) return host.split('.').slice(-2).join('.');
  return tldts.getDomain(host, { allowPrivateDomains: true }) || host;
}

/** Gibt 'phishing' | 'malware' | null zurück. */
function check(url) {
  let host;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    host = u.hostname.toLowerCase().replace(/\.$/, '');
  } catch { return null; }
  if (!host.includes('.')) return null;
  const base = registrable(host);
  if (NEVER_BLOCK.has(base) || NEVER_BLOCK.has(host)) return null;
  // Host selbst und übergeordnete Domains bis zur eigentlichen Domain prüfen
  const candidates = [];
  let h = host;
  while (true) {
    candidates.push(h);
    if (h === base || !h.includes('.')) break;
    h = h.slice(h.indexOf('.') + 1);
  }
  for (const c of candidates) {
    if (NEVER_BLOCK.has(c)) continue;
    if (has(tables.malware, c)) return 'malware';
    if (has(tables.phishing, c)) return 'phishing';
  }
  return null;
}

function status() {
  return {
    phishing: info.phishing || null,
    malware: info.malware || null
  };
}

// ---------------------------------------------------------------- HTTPS
function isLocalHost(host) {
  host = host.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home') || host.endsWith('.internal')) return true;
  if (/^\[.*\]$/.test(host)) return true; // IPv6
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || a === 0;
  }
  return false;
}

// ---------------------------------------------------------------- Virenscan (Microsoft Defender)
function defenderPath() {
  if (process.platform !== 'win32') return null;
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe')
  ];
  // neuere Versionen liegen unter ProgramData\Microsoft\Windows Defender\Platform\<Version>\
  try {
    const plat = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows Defender', 'Platform');
    const vers = fs.readdirSync(plat).sort().reverse();
    for (const v of vers) candidates.unshift(path.join(plat, v, 'MpCmdRun.exe'));
  } catch {}
  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

/**
 * Prüft eine Datei. Ergebnis: 'clean' | 'threat' | 'unavailable'.
 * Bei 'threat' hat Defender die Datei bereits in Quarantäne verschoben.
 */
function scanFile(file) {
  return new Promise((resolve) => {
    const exe = defenderPath();
    if (!exe || !fs.existsSync(file)) return resolve('unavailable');
    execFile(exe, ['-Scan', '-ScanType', '3', '-File', file], { windowsHide: true, timeout: 5 * 60 * 1000 }, (err, stdout) => {
      const code = err && typeof err.code === 'number' ? err.code : (err ? -1 : 0);
      const out = String(stdout || '');
      if (code === 2 || /found \d+ threats?/i.test(out) && !/found no threats/i.test(out)) return resolve('threat');
      if (code === 0) return resolve('clean');
      resolve('unavailable');
    });
  });
}

// nur für automatische Tests
function addTestHost(kind, host) {
  const old = tables[kind] ? Array.from(tables[kind]) : [];
  old.push(hash53(host));
  tables[kind] = Float64Array.from(old).sort();
}

module.exports = { start, refresh, check, status, isLocalHost, scanFile, defenderPath, addTestHost, registrable };
