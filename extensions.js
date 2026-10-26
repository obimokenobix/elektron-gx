'use strict';
/*
 * Elektron – Erweiterungen (Chrome-Erweiterungen aus dem Chrome Web Store)
 * Nutzt electron-chrome-extensions (chrome.tabs, Popups, Kontextmenüs …)
 * und electron-chrome-web-store (Installieren & automatisch aktualisieren).
 */
const { app, dialog, session, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let ext = null;
let ses = null;
let host = null;           // Rückrufe in den Hauptprozess (Tabs, Fenster, UI)
let webStore = null;

const PERMISSION_TEXT = {
  '<all_urls>': 'Alle Daten auf allen Webseiten lesen und ändern',
  tabs: 'Deinen Browserverlauf und offene Tabs lesen',
  history: 'Deinen Browserverlauf lesen und ändern',
  bookmarks: 'Deine Lesezeichen lesen und ändern',
  downloads: 'Downloads verwalten',
  cookies: 'Cookies lesen und ändern',
  webRequest: 'Netzwerkverkehr beobachten',
  webRequestBlocking: 'Netzwerkverkehr blockieren und ändern',
  declarativeNetRequest: 'Inhalte auf Webseiten blockieren',
  declarativeNetRequestWithHostAccess: 'Inhalte auf Webseiten blockieren',
  clipboardRead: 'Die Zwischenablage lesen',
  clipboardWrite: 'In die Zwischenablage schreiben',
  geolocation: 'Deinen Standort ermitteln',
  notifications: 'Benachrichtigungen anzeigen',
  nativeMessaging: 'Mit Programmen auf deinem PC kommunizieren',
  management: 'Andere Erweiterungen verwalten',
  privacy: 'Datenschutz-Einstellungen ändern',
  proxy: 'Proxy-Einstellungen ändern',
  debugger: 'Webseiten fernsteuern (Debugger)',
  scripting: 'Code in Webseiten ausführen',
  contextMenus: 'Einträge im Rechtsklick-Menü hinzufügen',
  storage: null, alarms: null, activeTab: null, idle: null, offscreen: null, sidePanel: null
};

function describePermissions(manifest) {
  const perms = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])];
  const hosts = [...(manifest.host_permissions || [])];
  for (const cs of manifest.content_scripts || []) hosts.push(...(cs.matches || []));
  const out = new Set();
  const broad = hosts.some(h => h === '<all_urls>' || /^\*:\/\/\*\/|^https?:\/\/\*\//.test(h));
  if (broad || perms.includes('<all_urls>')) out.add(PERMISSION_TEXT['<all_urls>']);
  else if (hosts.length) {
    const sites = [...new Set(hosts.map(h => h.replace(/^\*?:?\/\/|^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')))].slice(0, 4);
    out.add('Daten auf ' + sites.join(', ') + ' lesen und ändern');
  }
  for (const p of perms) {
    if (PERMISSION_TEXT[p]) out.add(PERMISSION_TEXT[p]);
  }
  return [...out];
}

async function confirmInstall(details) {
  const name = details.localizedName || details.manifest.name || details.id;
  const perms = describePermissions(details.manifest || {});
  const r = await dialog.showMessageBox(host.win(), {
    type: 'question',
    buttons: ['Hinzufügen', 'Abbrechen'],
    defaultId: 0, cancelId: 1,
    title: 'Erweiterung hinzufügen',
    message: `„${name}“ zu Elektron hinzufügen?`,
    detail: perms.length ? 'Die Erweiterung kann:\n• ' + perms.join('\n• ') : 'Die Erweiterung braucht keine besonderen Berechtigungen.',
    icon: details.icon && !details.icon.isEmpty() ? details.icon.resize({ width: 64 }) : undefined
  });
  const allow = r.response === 0;
  if (allow) setTimeout(() => { host.toast(`„${name}“ wurde hinzugefügt`); host.changed(); }, 1500);
  return { action: allow ? 'allow' : 'deny' };
}

function userExtensionsFile() { return path.join(app.getPath('userData'), 'unpacked-extensions.json'); }
function readUnpacked() {
  try { const a = JSON.parse(fs.readFileSync(userExtensionsFile(), 'utf8')); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function writeUnpacked(list) {
  try { fs.writeFileSync(userExtensionsFile(), JSON.stringify(list)); } catch {}
}

/**
 * opts: { session, win(), createTab(url, active) -> tab, activateByWc(wc), closeByWc(wc),
 *         tabInfo(wc), toast(text), changed() }
 */
async function init(opts) {
  host = opts;
  ses = opts.session;
  const { ElectronChromeExtensions } = require('electron-chrome-extensions');
  ext = new ElectronChromeExtensions({
    session: ses,
    createTab: async (details) => {
      const t = await host.createTab(details.url, details.active !== false);
      return [t.view.webContents, host.win()];
    },
    selectTab: (wc) => host.activateByWc(wc),
    removeTab: (wc) => host.closeByWc(wc),
    createWindow: async (details) => {
      const urls = [].concat(details.url || []);
      if (!urls.length) urls.push(undefined);
      for (const u of urls) await host.createTab(u, details.focused !== false);
      return host.win();
    },
    removeWindow: () => {},
    assignTabDetails: (details, wc) => {
      const info = host.tabInfo(wc);
      if (info) { details.discarded = !!info.discarded; details.frozen = !!info.frozen; }
    }
  });
  // Symbole der Erweiterungen in der Browser-Oberfläche (Standardsitzung) und auf eigenen Seiten
  ElectronChromeExtensions.handleCRXProtocol(session.defaultSession);

  try {
    webStore = require('electron-chrome-web-store');
    await Promise.race([
      webStore.installChromeWebStore({
        session: ses, autoUpdate: true, loadExtensions: true,
        allowUnpackedExtensions: false, beforeInstall: confirmInstall
      }),
      new Promise(r => setTimeout(r, 2500))
    ]);
  } catch (e) { console.warn('Chrome Web Store:', e.message); }

  // selbst geladene (entpackte) Erweiterungen
  for (const dir of readUnpacked()) {
    try { await ses.extensions.loadExtension(dir, { allowFileAccess: true }); } catch {}
  }
  ses.extensions.on('extension-loaded', () => host.changed());
  ses.extensions.on('extension-unloaded', () => host.changed());
  return ext;
}

const addTab = (wc) => { if (ext && wc && !wc.isDestroyed()) { try { ext.addTab(wc, host.win()); } catch {} } };
const selectTab = (wc) => { if (ext && wc && !wc.isDestroyed()) { try { ext.selectTab(wc); } catch {} } };
const contextMenuItems = (wc, params) => { try { return ext ? ext.getContextMenuItems(wc, params) : []; } catch { return []; } };

function iconFor(e) {
  const icons = (e.manifest && e.manifest.icons) || {};
  const sizes = Object.keys(icons).map(Number).sort((a, b) => b - a);
  for (const s of sizes) {
    try {
      const img = nativeImage.createFromPath(path.join(e.path, icons[s]));
      if (!img.isEmpty()) return img.resize({ width: 48 }).toDataURL();
    } catch {}
  }
  return null;
}

function list() {
  if (!ses) return [];
  const unpacked = readUnpacked();
  return ses.extensions.getAllExtensions().map(e => ({
    id: e.id,
    name: e.name,
    version: e.version,
    description: (e.manifest && e.manifest.description) || '',
    icon: iconFor(e),
    options: e.manifest && (e.manifest.options_page || (e.manifest.options_ui && e.manifest.options_ui.page))
      ? `chrome-extension://${e.id}/${e.manifest.options_page || e.manifest.options_ui.page}` : null,
    unpacked: unpacked.includes(e.path),
    permissions: describePermissions(e.manifest || {})
  }));
}

async function remove(id) {
  const e = ses.extensions.getExtension(id);
  if (!e) return false;
  const unpacked = readUnpacked();
  if (unpacked.includes(e.path)) {
    ses.extensions.removeExtension(id);
    writeUnpacked(unpacked.filter(p => p !== e.path));
  } else if (webStore) {
    await webStore.uninstallExtension(id, { session: ses });
  } else {
    ses.extensions.removeExtension(id);
  }
  host.changed();
  return true;
}

async function loadUnpacked() {
  const r = await dialog.showOpenDialog(host.win(), {
    title: 'Entpackte Erweiterung laden (Ordner mit manifest.json)',
    properties: ['openDirectory']
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) return { error: 'In diesem Ordner liegt keine manifest.json.' };
  try {
    const e = await ses.extensions.loadExtension(dir, { allowFileAccess: true });
    const list = readUnpacked();
    if (!list.includes(dir)) { list.push(dir); writeUnpacked(list); }
    host.changed();
    return { name: e.name };
  } catch (e) { return { error: e.message }; }
}

// Empfohlene Erweiterungen (Willkommensseite) – nur diese IDs dürfen direkt installiert werden
const RECOMMENDED = {
  ihcjicgdanjaechkgeegckofjjedodee: 'Malwarebytes Browser Guard',
  nngceckbapebfimnlniiiahkandclblb: 'Bitwarden',
  gomekmidlodglbbmalcneegieacbdmki: 'Avast Online Security & Privacy'
};

function isInstalled(id) {
  return !!(ses && ses.extensions.getExtension(id));
}

async function installRecommended(id) {
  if (!RECOMMENDED[id]) return { id, ok: false, error: 'nicht erlaubt' };
  if (isInstalled(id)) return { id, ok: true, already: true };
  if (!webStore) return { id, ok: false, error: 'Chrome Web Store nicht verfügbar' };
  try {
    await Promise.race([
      webStore.installExtension(id, { session: ses }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Zeitüberschreitung')), 90000))
    ]);
    host.changed();
    return { id, ok: true };
  } catch (e) {
    return { id, ok: false, error: String(e && e.message || e).split('\n')[0].slice(0, 140) };
  }
}

async function updateAll() {
  if (!webStore) return;
  try { await webStore.updateExtensions(ses); host.toast('Erweiterungen sind aktuell'); } catch { host.toast('Update der Erweiterungen fehlgeschlagen'); }
}

function openStore(query) {
  const url = query ? 'https://chromewebstore.google.com/search/' + encodeURIComponent(query) : 'https://chromewebstore.google.com/category/extensions';
  return host.createTab(url, true);
}

module.exports = { init, addTab, selectTab, contextMenuItems, list, remove, loadUnpacked, updateAll, openStore, isInstalled, installRecommended, RECOMMENDED, shell };
