'use strict';
/*
 * Tracking-Schutz: Cookies von fremden Seiten (Drittanbieter-Cookies) werden weder
 * mitgeschickt noch gespeichert. Damit können Werbefirmen dich nicht über mehrere
 * Webseiten hinweg verfolgen.
 *
 * Ausnahmen:
 *  - Seiten derselben Firma (z. B. youtube.com auf google.com), sonst bricht das Anmelden
 *  - Anmelde-, Captcha- und Bezahldienste, die als eingebettetes Fenster laufen müssen
 */
const { registrable } = require('./protect');

// Domains, die zur selben Firma gehören, gelten nicht als „fremd“ zueinander
const FAMILIES = [
  ['google.com', 'google.de', 'google.at', 'youtube.com', 'googleusercontent.com', 'gstatic.com', 'googlevideo.com', 'ytimg.com', 'withgoogle.com', 'blogger.com'],
  ['microsoft.com', 'live.com', 'microsoftonline.com', 'office.com', 'office365.com', 'bing.com', 'xbox.com', 'skype.com', 'msn.com', 'outlook.com', 'sharepoint.com', 'onedrive.com', 'msauth.net', 'msftauth.net'],
  ['amazon.com', 'amazon.de', 'amazon.at', 'primevideo.com', 'media-amazon.com', 'amazon.co.uk', 'twitch.tv', 'ttvnw.net', 'jtvnw.net', 'twitchcdn.net', 'twitchsvc.net'],
  ['facebook.com', 'instagram.com', 'whatsapp.com', 'messenger.com', 'fbcdn.net', 'whatsapp.net', 'meta.com'],
  ['steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steamgames.com', 'steam-chat.com'],
  ['epicgames.com', 'unrealengine.com', 'fortnite.com'],
  ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media'],
  ['apple.com', 'icloud.com', 'apple-cloudkit.com'],
  ['ea.com', 'origin.com'],
  ['ubisoft.com', 'ubi.com'],
  ['battle.net', 'blizzard.com'],
  ['riotgames.com', 'leagueoflegends.com', 'playvalorant.com'],
  ['roblox.com', 'rbxcdn.com'],
  ['nvidia.com', 'geforcenow.com', 'nvidiagrid.net'],
  ['reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com'],
  ['x.com', 'twitter.com', 'twimg.com'],
  ['spotify.com', 'scdn.co'],
  ['netflix.com', 'nflxext.com', 'nflxvideo.net'],
  ['disneyplus.com', 'disney-plus.net', 'bamgrid.com', 'disney.com'],
  ['claude.ai', 'anthropic.com'],
  ['openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com'],
  ['github.com', 'githubusercontent.com', 'github.io', 'githubassets.com']
];
const familyOf = new Map();
FAMILIES.forEach((list, i) => list.forEach(d => familyOf.set(d, i)));

// Dienste, die überall eingebettet funktionieren müssen (Anmelden, Captcha, Bezahlen)
const ALWAYS_ALLOWED = new Set([
  'google.com', 'recaptcha.net', 'hcaptcha.com', 'cloudflare.com', 'arkoselabs.com', 'funcaptcha.com',
  'paypal.com', 'paypalobjects.com', 'stripe.com', 'stripe.network', 'klarna.com', 'adyen.com',
  'mastercard.com', 'visa.com', 'cardinalcommerce.com', 'braintreegateway.com', 'sofort.com',
  'microsoftonline.com', 'live.com', 'apple.com', 'okta.com', 'auth0.com', 'onelogin.com',
  'disqus.com'
]);

function siteOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:' && u.protocol !== 'wss:' && u.protocol !== 'ws:') return null;
    return registrable(u.hostname.toLowerCase());
  } catch { return null; }
}

/** true, wenn die Anfrage an eine fremde Seite geht und deren Cookies blockiert werden sollen. */
function isThirdParty(topUrl, reqUrl) {
  const top = siteOf(topUrl);
  const req = siteOf(reqUrl);
  if (!top || !req || top === req) return false;
  if (ALWAYS_ALLOWED.has(req)) return false;
  const a = familyOf.get(top), b = familyOf.get(req);
  if (a !== undefined && a === b) return false;
  return true;
}

// ---------------------------------------------------------------- Links säubern
// Tracking-Anhänge, an denen Werbefirmen erkennen, woher du kommst
const STRIP_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'mc_eid', 'igshid', 'igsh', 'yclid',
  '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking', 'mkt_tok', 'oly_anon_id', 'oly_enc_id',
  'vero_id', 'vero_conv', 'ttclid', 'twclid', 'li_fat_id', 'rb_clickid', '_openstat', 'srsltid', 'epik',
  'ga_source', 'ga_medium', 'ga_campaign', 'ga_content', 'ga_term', 'wickedid', 'irclickid', 'ncid', 'sc_cid'
]);
const STRIP_PREFIX = ['utm_', 'pk_campaign', 'mtm_'];
// Nur auf bestimmten Seiten: Teilen-Kennungen
const STRIP_BY_SITE = { 'youtube.com': ['si', 'pp'], 'youtu.be': ['si'], 'spotify.com': ['si'], 'instagram.com': ['igsh', 'igshid'] };

// Umleitungs-Tracker: Der eigentliche Link steckt im Parameter – direkt dorthin springen
function bounceTarget(u) {
  const h = u.hostname.toLowerCase();
  const q = (k) => u.searchParams.get(k);
  let t = null;
  if (/(^|\.)google\.[a-z.]+$/.test(h) && u.pathname === '/url') t = q('q') || q('url');
  else if ((h === 'l.facebook.com' || h === 'lm.facebook.com') && u.pathname === '/l.php') t = q('u');
  else if (h === 'l.instagram.com') t = q('u');
  else if (/(^|\.)youtube\.com$/.test(h) && u.pathname === '/redirect') t = q('q');
  else if (h === 'out.reddit.com') t = q('url');
  else if (h === 'away.vk.com' && u.pathname === '/away.php') t = q('to');
  else if (h === 't.umblr.com' && u.pathname === '/redirect') t = q('z');
  else if (h === 'href.li') t = u.search.slice(1);
  // AMP-Seiten über Google → Originalseite
  else if (/(^|\.)google\.[a-z.]+$/.test(h) && u.pathname.startsWith('/amp/s/')) t = 'https://' + u.pathname.slice(7) + u.search;
  if (!t) return null;
  try { const n = new URL(t); return /^https?:$/.test(n.protocol) ? n : null; } catch { return null; }
}

/** Gibt die gesäuberte Adresse zurück oder null, wenn nichts zu ändern ist. */
function cleanUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  let changed = false;
  for (let i = 0; i < 3; i++) {
    const n = bounceTarget(u);
    if (!n) break;
    u = n; changed = true;
  }
  if (u.search) {
    const site = registrable(u.hostname.toLowerCase());
    const extra = STRIP_BY_SITE[site] || [];
    for (const k of [...u.searchParams.keys()]) {
      const kl = k.toLowerCase();
      if (STRIP_PARAMS.has(kl) || STRIP_PREFIX.some(p => kl.startsWith(p)) || extra.includes(kl)) { u.searchParams.delete(k); changed = true; }
    }
  }
  if (!changed) return null;
  let out = u.toString();
  if (out.endsWith('?')) out = out.slice(0, -1);
  return out === url ? null : out;
}

// Sicheres DNS: Quad9 (Schweiz) – verschlüsselt DNS-Anfragen und sperrt bekannte Schadsoftware-Domains
const DOH_SERVERS = ['https://dns.quad9.net/dns-query'];

module.exports = { isThirdParty, siteOf, cleanUrl, DOH_SERVERS };
