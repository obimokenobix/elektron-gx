'use strict';
/*
 * Doppelgänger-Warnung: erkennt Adressen, die bekannten Seiten zum Verwechseln ähnlich sehen
 * (paypa1.com statt paypal.com, steamcommunlty.com, Adressen mit kyrillischen Buchstaben …).
 * Läuft komplett auf dem PC – es wird nichts verschickt.
 */
let tldts = null;
try { tldts = require('tldts-experimental'); } catch {}
const { domainToUnicode } = require('url');

// Bekannte Seiten, die oft nachgemacht werden (Name ohne Endung → echte Adresse)
const BRANDS = {
  paypal: 'paypal.com', google: 'google.com', youtube: 'youtube.com', gmail: 'gmail.com', amazon: 'amazon.de',
  microsoft: 'microsoft.com', outlook: 'outlook.com', apple: 'apple.com', icloud: 'icloud.com',
  steampowered: 'steampowered.com', steamcommunity: 'steamcommunity.com', epicgames: 'epicgames.com',
  discord: 'discord.com', twitch: 'twitch.tv', roblox: 'roblox.com', minecraft: 'minecraft.net', battlenet: 'battle.net',
  playstation: 'playstation.com', xbox: 'xbox.com', nintendo: 'nintendo.com', riotgames: 'riotgames.com',
  facebook: 'facebook.com', instagram: 'instagram.com', whatsapp: 'whatsapp.com',
  netflix: 'netflix.com', spotify: 'spotify.com', disneyplus: 'disneyplus.com', tiktok: 'tiktok.com',
  ebay: 'ebay.de', willhaben: 'willhaben.at', github: 'github.com', coinbase: 'coinbase.com',
  sparkasse: 'sparkasse.at', raiffeisen: 'raiffeisen.at', bawag: 'bawag.at', erstebank: 'erstebank.at',
  bankaustria: 'bankaustria.at', volksbank: 'volksbank.at', revolut: 'revolut.com', klarna: 'klarna.com',
  oesterreich: 'oesterreich.gv.at', finanzonline: 'finanzonline.bmf.gv.at', dhl: 'dhl.de', post: 'post.at',
  linkedin: 'linkedin.com', dropbox: 'dropbox.com', anthropic: 'anthropic.com', openai: 'openai.com', chatgpt: 'chatgpt.com'
};
// Echte Zusatz-Adressen derselben Firmen (nie warnen)
const OWN = new Set(['google.de', 'google.at', 'amazon.com', 'amazon.at', 'ebay.com', 'ebay.at', 'paypal.me', 'xbox.com',
  'live.com', 'microsoftonline.com', 'steamstatic.com', 'discord.gg', 'discordapp.com', 'twitch.com', 'netflix.net',
  'battle.net', 'blizzard.com', 'fb.com', 'youtu.be', 'apple.de', 'playstation.net', 'sonyentertainmentnetwork.com',
  'nintendo.de', 'nintendo.at', 'spotify.de', 'roblox.de', 'epicgames.dev', 'whatsapp.net', 'instagram.de', 'tiktokv.com']);

// Zeichen, die man leicht verwechselt → auf den „gemeinten“ Buchstaben abbilden
const CONFUSE = [[/rn/g, 'm'], [/vv/g, 'w'], [/0/g, 'o'], [/1/g, 'l'], [/!/g, 'l'], [/\|/g, 'l'], [/3/g, 'e'], [/5/g, 's'], [/4/g, 'a'], [/7/g, 't'], [/8/g, 'b'], [/9/g, 'g'], [/i/g, 'l'], [/-/g, '']];
// Kyrillisch/Griechisch, die wie lateinische Buchstaben aussehen
const HOMO = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ӏ': 'l', 'ո': 'n', 'ս': 'u', 'ɡ': 'g', 'ο': 'o', 'α': 'a', 'ρ': 'p', 'ν': 'v', 'τ': 't', 'ι': 'i', 'κ': 'k', 'ε': 'e', 'ս': 'u', 'ⅼ': 'l' };

function skeleton(s) {
  let out = '';
  for (const ch of s.normalize('NFKD').replace(/[̀-ͯ]/g, '')) out += HOMO[ch] || ch;
  out = out.toLowerCase();
  for (const [re, to] of CONFUSE) out = out.replace(re, to);
  return out;
}

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
  }
  return dp[a.length][b.length];
}

const SK_BRANDS = Object.keys(BRANDS).map(b => [b, skeleton(b)]);
const REAL = new Set([...Object.values(BRANDS), ...OWN]);

/** Gibt die echte Adresse zurück, wenn `host` ein Doppelgänger ist – sonst null. */
function check(host) {
  host = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!host || !tldts) return null;
  const info = tldts.parse(host, { allowPrivateDomains: false });
  const domain = info.domain;
  if (!domain || REAL.has(domain)) return null;
  for (const real of REAL) if (host === real || host.endsWith('.' + real)) return null;
  let label = info.domainWithoutSuffix || '';
  if (!label) return null;
  if (label.includes('xn--')) { try { label = domainToUnicode(label) || label; } catch {} }
  const plain = /^[a-z0-9-]+$/.test(label);
  if (plain && BRANDS[label]) return null; // gleicher Name, andere Endung (z. B. netflix.at) – nicht automatisch Betrug
  const sk = skeleton(label);
  for (const [brand, skb] of SK_BRANDS) {
    if (label === brand) continue;
    if (sk === skb) return BRANDS[brand];                        // paypa1, steamcommunlty, kyrillisches „аpple“
    if (!plain && skeleton(label) === skb) return BRANDS[brand];
    if (brand.length >= 6 && plain && distance(label, brand) === 1) return BRANDS[brand]; // amazom, discrod
  }
  return null;
}

module.exports = { check, skeleton };
