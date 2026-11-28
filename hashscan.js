'use strict';
/*
 * Volt – zweiter Virenscanner: Abgleich mit der Malware Hash Registry (Team Cymru).
 *
 * Die Registry kennt Millionen Schadprogramme und fasst die Ergebnisse von über 30
 * Antivirus-Programmen zusammen. Volt berechnet einen Fingerabdruck (SHA-1) der fertig
 * heruntergeladenen Datei und fragt per DNS nach, ob dieser Fingerabdruck als Schadsoftware
 * bekannt ist. Die Datei selbst verlässt den PC nie – nur die 40 Zeichen des Fingerabdrucks.
 *
 * DNS-Antworten:
 *   TXT-Eintrag vorhanden  → als Schadsoftware bekannt: "<Zeitstempel> <Erkennungsrate in %>"
 *   NXDOMAIN               → nicht als Schadsoftware bekannt
 * SHA-256 passt nicht in einen DNS-Namensteil (max. 63 Zeichen), deshalb SHA-1.
 */
const crypto = require('crypto');
const fs = require('fs');
const dnsDefault = require('dns').promises;

const ZONE = 'hash.cymru.com';
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // größere Dateien werden nicht abgeglichen
const TIMEOUT_MS = 6000;

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    s.on('error', reject);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('Zeitüberschreitung'), { code: 'ETIMEOUT' })), ms); })])
    .finally(() => clearTimeout(t));
}

const NOT_LISTED = new Set(['ENOTFOUND', 'ENODATA']);

/**
 * Fragt einen SHA-1-Fingerabdruck ab.
 * Ergebnis: { result: 'clean' } | { result: 'threat', percent, seen } | { result: 'unavailable', reason }
 */
async function lookup(sha1, dns = dnsDefault) {
  if (!/^[0-9a-f]{40}$/.test(sha1)) return { result: 'unavailable', reason: 'ungültiger Fingerabdruck' };
  // Kontrollabfrage: Ist der Dienst überhaupt erreichbar? Sonst wäre „nicht gefunden“ bei
  // fehlendem Internet fälschlich ein „sauber“.
  const control = withTimeout(dns.resolveNs('cymru.com'), TIMEOUT_MS).then(() => true, () => false);
  let records = null, err = null;
  try { records = await withTimeout(dns.resolveTxt(`${sha1}.${ZONE}`), TIMEOUT_MS); }
  catch (e) { err = e; }
  if (records && records.length) {
    const txt = records.map(r => r.join('')).join(' ').trim();
    const m = txt.match(/^(\d+)\s+(\d+)/);
    return { result: 'threat', percent: m ? Number(m[2]) : null, seen: m ? Number(m[1]) * 1000 : null };
  }
  if (err && !NOT_LISTED.has(err.code)) return { result: 'unavailable', reason: err.code || err.message };
  if (!(await control)) return { result: 'unavailable', reason: 'Dienst nicht erreichbar' };
  return { result: 'clean' };
}

/** Prüft eine Datei. Ergebnis wie lookup(), zusätzlich sha1. */
async function scanFile(file, dns = dnsDefault) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return { result: 'unavailable', reason: 'Datei fehlt' }; }
  if (!size) return { result: 'clean' };
  if (size > MAX_BYTES) return { result: 'unavailable', reason: 'Datei zu groß' };
  let sha1;
  try { sha1 = await sha1File(file); } catch (e) { return { result: 'unavailable', reason: e.code || e.message }; }
  return { ...(await lookup(sha1, dns)), sha1 };
}

module.exports = { scanFile, lookup, sha1File, ZONE };
