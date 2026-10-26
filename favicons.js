'use strict';
/*
 * Website-Symbole (Favicons) direkt von der jeweiligen Seite laden – ohne Umweg über
 * einen Google-Dienst. So erfährt niemand außer der Seite selbst, welche Lesezeichen
 * und Seiten du gespeichert hast. Symbole werden auf dem PC zwischengespeichert.
 */
const fs = require('fs');
const path = require('path');

let dir = null;
let fetchFn = null;
let isLocalHost = () => false;
const mem = new Map();      // host -> { buf, type } | { fail: Zeitpunkt }
const pageIcons = new Map(); // host -> Symbol-Adresse, die eine geöffnete Seite gemeldet hat
const pending = new Map();
const OK_DAYS = 14;
const MAX_BYTES = 256 * 1024;

function init(opts) {
  dir = opts.dir;
  fetchFn = opts.fetch;
  if (opts.isLocalHost) isLocalHost = opts.isLocalHost;
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function validHost(h) {
  h = String(h || '').toLowerCase().replace(/^www\./, '');
  if (!/^[a-z0-9.-]{1,253}$/.test(h) || !h.includes('.') || isLocalHost(h)) return null;
  return h;
}

function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  const head = buf.slice(0, 300).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

async function get(url, timeout = 5000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetchFn(url, { signal: ctl.signal, credentials: 'omit', redirect: 'follow' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length <= MAX_BYTES * 4 ? buf : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

async function tryIcon(url) {
  if (!/^https?:\/\//i.test(url)) return null;
  const buf = await get(url);
  if (!buf || buf.length > MAX_BYTES) return null;
  const type = sniff(buf);
  return type ? { buf, type } : null;
}

async function load(host) {
  const tries = [];
  if (pageIcons.has(host)) tries.push(pageIcons.get(host));
  tries.push(`https://${host}/favicon.ico`, `https://www.${host}/favicon.ico`);
  for (const u of tries) { const r = await tryIcon(u); if (r) return r; }
  // Startseite lesen und <link rel="icon"> suchen
  const html = await get(`https://${host}/`);
  if (html) {
    const text = html.slice(0, 300000).toString('utf8');
    const links = [...text.matchAll(/<link\b[^>]*>/gi)].map(m => m[0])
      .filter(t => /rel\s*=\s*["']?[^"'>]*\bicon\b/i.test(t));
    for (const t of links) {
      const m = t.match(/href\s*=\s*["']([^"']+)["']/i);
      if (!m) continue;
      let abs;
      try { abs = new URL(m[1].replace(/&amp;/g, '&'), `https://${host}/`).href; } catch { continue; }
      const r = await tryIcon(abs);
      if (r) return r;
    }
  }
  return null;
}

function diskPath(host) { return path.join(dir, host.replace(/[^a-z0-9.-]/g, '_') + '.ico'); }

async function favicon(rawHost) {
  const host = validHost(rawHost);
  if (!host || !dir) return null;
  const m = mem.get(host);
  if (m && m.buf) return m;
  if (m && m.fail && Date.now() - m.fail < 6 * 3600 * 1000) return null;
  try {
    const p = diskPath(host);
    const st = fs.statSync(p);
    if (Date.now() - st.mtimeMs < OK_DAYS * 86400000) {
      const buf = fs.readFileSync(p);
      const type = sniff(buf);
      if (type) { const r = { buf, type }; mem.set(host, r); return r; }
    }
  } catch {}
  if (pending.has(host)) return pending.get(host);
  const job = load(host).then((r) => {
    pending.delete(host);
    if (r) { mem.set(host, r); try { fs.writeFileSync(diskPath(host), r.buf); } catch {} }
    else mem.set(host, { fail: Date.now() });
    return r;
  });
  pending.set(host, job);
  return job;
}

/** Antwort für elektron://start/favicon?host=… und elektron-ui://app/favicon?host=… */
async function response(reqUrl) {
  let host = '';
  try { host = new URL(reqUrl).searchParams.get('host') || ''; } catch {}
  const r = await favicon(host);
  if (!r) return new Response('', { status: 404 });
  return new Response(r.buf, { headers: { 'content-type': r.type, 'cache-control': 'max-age=86400' } });
}

/** Eine geöffnete Seite hat ihr Symbol gemeldet – merken für später */
function remember(pageUrl, iconUrl) {
  try {
    const host = validHost(new URL(pageUrl).hostname);
    if (host && /^https:\/\//i.test(iconUrl)) {
      const known = pageIcons.get(host);
      pageIcons.set(host, iconUrl);
      if (known !== iconUrl && mem.get(host) && mem.get(host).fail) mem.delete(host);
    }
  } catch {}
}

module.exports = { init, response, remember, favicon };
