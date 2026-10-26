'use strict';
process.on('uncaughtException', (e) => { console.error('UNCAUGHT', e && e.stack || e); });
/*
 * Elektron GX – der Gaming-Browser
 * Hauptprozess: Fenster, Tabs, Seitenleiste, GX-Control (RAM-/CPU-/Netzwerk-Limiter),
 * Gaming-Modus, Werbeblocker, Downloads, Berechtigungen.
 */
const {
  app, BaseWindow, WebContentsView, ipcMain, session, Menu, MenuItem, dialog, nativeImage,
  protocol, shell, clipboard, net, webContents: wcModule
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { createStore } = require('./store');
const extmod = require('./extensions');
const protect = require('./protect');
const privacy = require('./privacy');
const extras = require('./extras');

const APP_NAME = 'Elektron GX';
const T0 = Date.now();
const perf = (label) => { if (process.env.ELEKTRON_PERF) console.log(`PERF ${label} ${Date.now() - T0}ms`); };
const PARTITION = 'persist:elektron';
const PRIVATE_PARTITION = 'elektron-private'; // ohne "persist:" = nur im Arbeitsspeicher
const HOME = 'elektron://start/';
const ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// Layout (muss zu ui/style.css passen)
const TAB_H = 40;
const TOOL_H = 46;
const BM_H = 32;
const top = () => TAB_H + TOOL_H + (settings.showBookmarkBar ? BM_H : 0);
// Platzhalter in package.json – solange er drin steht, ist keine Update-Adresse eingestellt
const UPDATE_PLACEHOLDER = 'DEINE-WEBSEITE';
const RAIL_W = 52;
const PANEL_W = 380;

const WEB_PANELS = {
  claude: 'https://claude.ai/new',
  chatgpt: 'https://chatgpt.com/',
  discord: 'https://discord.com/app',
  twitch: 'https://www.twitch.tv/',
  youtube: 'https://www.youtube.com/',
  whatsapp: 'https://web.whatsapp.com/'
};

// ------------------------------------------------------------------ Einstellungen
const DEFAULTS = {
  accent: '#ff2b4e',
  ramLimit: { enabled: false, mb: 3072 },
  cpuLimit: { enabled: false, percent: 25 },
  netLimit: { enabled: false, kbs: 2048 },
  adblock: true,
  ytSkip: true,
  camera: 'block',      // 'block' | 'ask' | 'allow'
  mic: 'ask',
  autoPip: true,
  showBookmarkBar: true,
  welcomeDone: false,
  style: 'gaming',          // 'gaming' | 'normal'
  accentNormal: '#3b82f6',
  background: 'neon',       // neon | schlicht | nebel | galaxie | berge | aurora | wellen | eigenes
  bgVersion: 0,
  preferredAI: 'claude',
  welcomeVersion: 0,
  httpsOnly: true,
  phishingProtect: true,
  scanDownloads: true,
  secureDns: true,
  blockThirdPartyCookies: true,
  fingerprintProtect: true,
  autoUpdate: true,
  updateUrl: '',
  freezeOnMinimize: true,
  clearOnExit: false,
  restoreSession: true,
  highPerfGpu: true,
  unlockFps: false,
  blockedTotal: 0,
  permissions: {},
  lastSession: null
};

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return {
      ...DEFAULTS, ...raw,
      ramLimit: { ...DEFAULTS.ramLimit, ...(raw.ramLimit || {}) },
      cpuLimit: { ...DEFAULTS.cpuLimit, ...(raw.cpuLimit || {}) },
      netLimit: { ...DEFAULTS.netLimit, ...(raw.netLimit || {}) },
      permissions: raw.permissions || {}
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

let settings = loadSettings();
const bootSettings = { highPerfGpu: settings.highPerfGpu, unlockFps: settings.unlockFps };
let saveTimer = null;

function saveSettingsNow() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (e) { console.warn('Einstellungen konnten nicht gespeichert werden:', e.message); }
}
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettingsNow, 400);
}

// ------------------------------------------------------------------ Chromium-Schalter (vor "ready")
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('at.elektron.gx');
if (settings.highPerfGpu) app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
if (settings.unlockFps) {
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}

if (process.env.ELEKTRON_HOSTMAP) app.commandLine.appendSwitch('host-resolver-rules', process.env.ELEKTRON_HOSTMAP);

protocol.registerSchemesAsPrivileged([
  { scheme: 'elektron', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ------------------------------------------------------------------ Zustand
let win = null;
let uiView = null;
let mainSes = null;
let tabs = [];
let activeId = null;
let nextId = 1;
const closedStack = [];
const panelViews = new Map();
let panel = null;              // 'gx' | 'web:discord' | ...
let htmlFullscreen = false;
let userFullscreen = false;
let gamingMode = false;
let blocker = null;
let stats = { ram: 0, cpu: 0 };
let cpuOver = 0;
let quitting = false;
let downloadSeq = 1;
let markWindowReady;
const windowReady = new Promise(r => { markWindowReady = r; });
let split = null;              // { a, b, ratio, geo } – zwei Tabs nebeneinander
let splitDragging = false;
const floatsByBar = new Map(); // webContents-ID der Fensterleiste -> schwebendes Fenster
const store = createStore(app.getPath('userData'));
let privateSes = null;
let suggestView = null;
let suggest = { items: [], selected: -1, query: '', seq: 0, open: false };
const activeDownloads = new Map(); // Download-ID -> DownloadItem
let update = { state: 'idle', version: null, percent: 0, message: '' };

const getTab = (id) => tabs.find(t => t.id === id);
const activeTab = () => getTab(activeId);
const immersive = () => htmlFullscreen || userFullscreen;
const alive = (wc) => wc && !wc.isDestroyed();
const inSplit = (id) => !!split && (split.a === id || split.b === id);
const isShown = (t) => !!t.floating || t.id === activeId || inSplit(t.id);

// ------------------------------------------------------------------ Hilfsfunktionen
function toURL(text) {
  text = (text || '').trim();
  if (!text) return null;
  if (/^(https?|elektron|file):\/\//i.test(text) || /^about:blank$/i.test(text)) return text;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(text)) return 'http://' + text;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(text)) return 'http://' + text;
  if (!/\s/.test(text) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return 'https://' + text;
  return 'https://www.google.com/search?q=' + encodeURIComponent(text);
}

function displayURL(url) {
  if (!url) return '';
  if (/^elektron:\/\/start\/(error|blocked|insecure|reader)\.html/.test(url)) {
    try { return new URL(url).searchParams.get('u') || ''; } catch { return ''; }
  }
  if (url.startsWith('elektron://start')) return '';
  return url;
}

function cleanUserAgent(ua) {
  return ua.replace(/\s+Electron\/\S+/i, '').replace(/\s+elektron-gx\/\S+/i, '').replace(/\s+Elektron GX\/\S+/i, '');
}

let stateQueued = false;
function pushState() {
  if (stateQueued) return;
  stateQueued = true;
  setTimeout(() => {
    stateQueued = false;
    if (uiView && alive(uiView.webContents)) uiView.webContents.send('state', snapshot());
  }, 16);
}

function toast(text, extra = {}) {
  if (uiView && alive(uiView.webContents)) uiView.webContents.send('toast', { text, ...extra });
}

function snapshot() {
  const a = activeTab();
  const wc = a && a.view && alive(a.view.webContents) ? a.view.webContents : null;
  return {
    tabs: tabs.map(t => ({
      id: t.id, title: t.title, url: displayURL(t.url), favicon: t.favicon,
      loading: t.loading, audible: t.audible, muted: t.muted,
      frozen: t.frozen, discarded: t.discarded, crashed: t.crashed,
      floating: !!t.floating, split: inSplit(t.id), private: !!t.private
    })),
    activeId,
    split: split ? { a: split.a, b: split.b, ratio: split.ratio, geo: split.geo || null } : null,
    splitDragging,
    nav: a ? {
      url: displayURL(a.url),
      isStart: a.url.startsWith('elektron://start') && !/^elektron:\/\/start\/(error|blocked|insecure|reader)\.html/.test(a.url),
      warning: /^elektron:\/\/start\/blocked\.html/.test(a.url) ? 'danger' : /^elektron:\/\/start\/insecure\.html/.test(a.url) || /^http:/i.test(a.url) ? 'insecure' : null,
      canGoBack: wc ? wc.navigationHistory.canGoBack() : false,
      canGoForward: wc ? wc.navigationHistory.canGoForward() : false,
      loading: a.loading,
      secure: a.url.startsWith('https:') || a.url.startsWith('elektron:'),
      zoom: wc ? Math.round(Math.pow(1.2, wc.getZoomLevel()) * 100) : 100,
      private: !!a.private,
      wcId: wc ? wc.id : null,
      bookmarked: /^(https?|file):/i.test(a.url) && !!store.findBookmark(a.url),
      canBookmark: /^(https?|file):/i.test(a.url)
    } : null,
    bookmarks: settings.showBookmarkBar ? store.bookmarks().slice(0, 60).map(b => ({ id: b.id, title: b.title, url: b.url })) : [],
    downloads: downloadSummary(),
    protect: { lists: protect.status(), defender: !!protect.defenderPath(), cookiesBlocked, hardened: app.isPackaged },
    update,
    panel,
    gamingMode,
    immersive: immersive(),
    adblockReady: !!blocker,
    settings: {
      accent: accentNow(),
      style: settings.style, background: settings.background, bgVersion: settings.bgVersion,
      hasUserBg: !!userBgFile(), preferredAI: settings.preferredAI,
      ramLimit: settings.ramLimit, cpuLimit: settings.cpuLimit, netLimit: settings.netLimit,
      adblock: settings.adblock, ytSkip: settings.ytSkip,
      camera: settings.camera, mic: settings.mic, autoPip: settings.autoPip,
      showBookmarkBar: settings.showBookmarkBar, autoUpdate: settings.autoUpdate,
      httpsOnly: settings.httpsOnly, phishingProtect: settings.phishingProtect, scanDownloads: settings.scanDownloads,
      secureDns: settings.secureDns, blockThirdPartyCookies: settings.blockThirdPartyCookies, fingerprintProtect: settings.fingerprintProtect,
      updateUrl: effectiveUpdateUrl(),
      freezeOnMinimize: settings.freezeOnMinimize,
      clearOnExit: settings.clearOnExit, restoreSession: settings.restoreSession,
      highPerfGpu: settings.highPerfGpu, unlockFps: settings.unlockFps
    },
    needsRestart: settings.highPerfGpu !== bootSettings.highPerfGpu || settings.unlockFps !== bootSettings.unlockFps,
    versions: { app: app.getVersion(), chrome: process.versions.chrome, electron: process.versions.electron }
  };
}

// ------------------------------------------------------------------ Layout
function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  uiView.setBounds({ x: 0, y: 0, width: w, height: h });
  const imm = immersive();
  const panelOpen = !!panel && !imm;
  const cx = imm ? 0 : RAIL_W + (panelOpen ? PANEL_W : 0);
  const cy = imm ? 0 : top();
  const bounds = { x: cx, y: cy, width: Math.max(1, w - cx), height: Math.max(1, h - cy) };

  // Split-Screen: zwei Tabs nebeneinander
  const sa = split && getTab(split.a), sb = split && getTab(split.b);
  const splitOn = !!(split && !imm && sa && sb && sa.view && sb.view && !sa.floating && !sb.floating);
  if (splitOn) {
    const GAP = 8;
    const avail = bounds.width - GAP;
    const lw = Math.round(avail * split.ratio);
    sa.view.setBounds({ x: bounds.x, y: bounds.y, width: Math.max(1, lw), height: bounds.height });
    sb.view.setBounds({ x: bounds.x + lw + GAP, y: bounds.y, width: Math.max(1, avail - lw), height: bounds.height });
    split.geo = { x: bounds.x, y: bounds.y, w: bounds.width, leftW: lw, gap: GAP };
  } else if (split) {
    split.geo = null;
  }

  for (const t of tabs) {
    if (!t.view || t.floating) continue;
    const inPair = splitOn && inSplit(t.id);
    if (!inPair) t.view.setBounds(bounds);
    t.view.setVisible(splitOn ? inPair : t.id === activeId);
  }
  for (const [name, v] of panelViews) {
    const vis = panel === 'web:' + name && !imm;
    if (vis) v.setBounds({ x: RAIL_W, y: top(), width: PANEL_W, height: Math.max(1, h - top()) });
    v.setVisible(vis);
  }
}

// ------------------------------------------------------------------ DevTools-Protokoll (Einfrieren, Netzwerk-Limiter)
function ensureDebugger(wc) {
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
}

async function setFrozen(tab, frozen, reason) {
  if (!tab || !tab.view) return;
  const wc = tab.view.webContents;
  if (!alive(wc) || tab.frozen === frozen) return;
  try {
    ensureDebugger(wc);
    await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: frozen ? 'frozen' : 'active' });
    tab.frozen = frozen;
    tab.freezeReason = frozen ? reason : null;
    pushState();
  } catch { /* sichtbare Seiten lassen sich nicht einfrieren */ }
}

async function applyNetLimit(wc) {
  if (!alive(wc)) return;
  const on = settings.netLimit.enabled;
  if (!on && !wc.debugger.isAttached()) return;
  try {
    ensureDebugger(wc);
    if (on) {
      const bps = Math.max(1, settings.netLimit.kbs) * 1024;
      await wc.debugger.sendCommand('Network.enable');
      await wc.debugger.sendCommand('Network.emulateNetworkConditions', {
        offline: false, latency: 0, downloadThroughput: bps, uploadThroughput: bps
      });
    } else {
      await wc.debugger.sendCommand('Network.emulateNetworkConditions', {
        offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1
      });
      await wc.debugger.sendCommand('Network.disable');
    }
  } catch { /* ignorieren */ }
}

function allWebContents() {
  const list = [];
  for (const t of tabs) if (t.view && alive(t.view.webContents)) list.push(t.view.webContents);
  for (const v of panelViews.values()) if (alive(v.webContents)) list.push(v.webContents);
  return list;
}

// ------------------------------------------------------------------ Tabs
function newTabView(isPrivate = false) {
  return new WebContentsView({
    webPreferences: {
      partition: isPrivate ? PRIVATE_PARTITION : PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: true,
      spellcheck: true,
      plugins: true // eingebauter PDF-Viewer
    }
  });
}

function spawnView(tab) {
  if (tab.private) ensurePrivateSession();
  const view = newTabView(!!tab.private);
  win.contentView.addChildView(view);
  tab.view = view;
  tab.discarded = false;
  tab.frozen = false;
  tab.crashed = false;
  wireWebContents(view.webContents, tab);
  if (!tab.private) extmod.addTab(view.webContents);
  applyNetLimit(view.webContents);
  return view;
}

function createTab(url = HOME, opts = {}) {
  const { activate = true, lazy = false, title = 'Neuer Tab', index } = opts;
  const isPrivate = !!opts.private;
  if (isPrivate && url === HOME) url = HOME + '?private=1';
  const tab = {
    id: nextId++, url, title, favicon: null, loading: false, audible: false,
    muted: false, frozen: false, freezeReason: null, discarded: false, crashed: false,
    lastActive: Date.now(), view: null, memMB: 0, cpu: 0, floating: null, private: isPrivate
  };
  const cur = tabs.findIndex(t => t.id === activeId);
  const at = typeof index === 'number' ? index : (cur >= 0 ? cur + 1 : tabs.length);
  tabs.splice(Math.min(at, tabs.length), 0, tab);
  if (lazy && !activate) {
    tab.discarded = true;
  } else {
    spawnView(tab);
    tab.view.webContents.loadURL(url);
  }
  if (activate) activateTab(tab.id);
  else { layout(); pushState(); }
  return tab;
}

function activateTab(id) {
  const tab = getTab(id);
  if (!tab) return;
  if (tab.floating) { tab.floating.win.show(); tab.floating.win.focus(); return; }
  const prev = activeTab();
  if (prev && prev !== tab) prev.lastActive = Date.now();
  if (split && !inSplit(id)) split = null;
  if (prev && prev !== tab && prev.view && alive(prev.view.webContents)) {
    try { prev.view.webContents.stopFindInPage('clearSelection'); } catch {}
    if (uiView) uiView.webContents.send('find-close');
  }
  hideSuggest();
  activeId = id;
  // Video beim Tab-Wechsel automatisch ausklappen (Bild-in-Bild)
  if (settings.autoPip && prev && prev !== tab && prev.audible && !prev.floating && !isShown(prev)) {
    pipTab(prev, { silent: true, onlyEnter: true });
  }
  tab.lastActive = Date.now();
  if (tab.discarded || !tab.view) {
    spawnView(tab);
    tab.view.webContents.loadURL(tab.url);
  } else if (tab.crashed) {
    tab.crashed = false;
    tab.view.webContents.reload();
  }
  layout();
  if (tab.frozen) setFrozen(tab, false);
  if (tab.view && !tab.private) extmod.selectTab(tab.view.webContents);
  if (tab.url.startsWith(HOME) && !tab.url.startsWith('elektron://start/error')) focusAddress();
  else if (tab.view) tab.view.webContents.focus();
  pushState();
}

function destroyView(view) {
  try { win.contentView.removeChildView(view); } catch {}
  try { if (alive(view.webContents)) view.webContents.close(); } catch {}
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx < 0) return;
  const tab = tabs[idx];
  if (!tab.url.startsWith(HOME)) closedStack.push({ url: tab.url, title: tab.title, index: idx });
  if (closedStack.length > 25) closedStack.shift();
  tabs.splice(idx, 1);
  if (inSplit(id)) {
    const other = split.a === id ? split.b : split.a;
    split = null;
    if (activeId === id) activeId = other;
  }
  if (tab.floating) {
    const f = tab.floating;
    tab.floating = null;
    try { f.win.contentView.removeChildView(tab.view); } catch {}
    closeFloatWindow(f);
  }
  if (tab.view) destroyView(tab.view);
  if (tab.private && privateSes && !tabs.some(t => t.private)) {
    privateSes.clearStorageData().catch(() => {});
    privateSes.clearCache().catch(() => {});
  }
  if (!tabs.length) { createTab(HOME); return; }
  if (activeId === id || !getTab(activeId)) {
    const candidates = tabs.filter(t => !t.floating);
    const next = candidates[Math.min(idx, candidates.length - 1)];
    if (next) activateTab(next.id); else createTab(HOME);
  } else { layout(); pushState(); }
}

function discardTab(tab) {
  if (!tab.view || isShown(tab)) return;
  destroyView(tab.view);
  tab.view = null;
  tab.discarded = true;
  tab.frozen = false;
  tab.loading = false;
  tab.audible = false;
  pushState();
}

// ------------------------------------------------------------------ Split-Screen
function ensureLoaded(tab) {
  if (tab.discarded || !tab.view) { spawnView(tab); tab.view.webContents.loadURL(tab.url); }
  if (tab.frozen) setFrozen(tab, false);
}

function startSplit(otherId) {
  const cur = activeTab();
  if (!cur) return;
  let other = otherId != null ? getTab(otherId) : null;
  if (!other || other === cur) {
    // zuletzt benutzten anderen Tab nehmen – sonst neuen Tab öffnen
    other = tabs.filter(t => t !== cur && !t.floating).sort((a, b) => b.lastActive - a.lastActive)[0];
    if (!other) other = createTab(HOME, { activate: false });
  }
  if (other.floating) dockTab(other.id, { activate: false });
  ensureLoaded(cur);
  ensureLoaded(other);
  const ci = tabs.indexOf(cur), oi = tabs.indexOf(other);
  split = ci <= oi ? { a: cur.id, b: other.id, ratio: 0.5 } : { a: other.id, b: cur.id, ratio: 0.5 };
  layout();
  pushState();
  toast('Split-Screen an – Trennlinie ziehen zum Anpassen');
}

function toggleSplit(otherId) {
  if (split && otherId == null) { endSplit(); return; }
  startSplit(otherId);
}

function endSplit() {
  if (!split) return;
  split = null;
  layout();
  const t = activeTab();
  if (t && t.view) t.view.webContents.focus();
  pushState();
}

function swapSplit() {
  if (!split) return;
  split = { ...split, a: split.b, b: split.a, ratio: 1 - split.ratio };
  layout();
  pushState();
}

function setSplitRatio(r) {
  if (!split) return;
  const n = Number(r);
  if (!Number.isFinite(n)) return;
  split.ratio = Math.min(0.8, Math.max(0.2, n));
  layout();
  pushState();
}

function setSplitDragging(on) {
  if (splitDragging === on) return;
  splitDragging = on;
  if (on) {
    // Oberfläche kurz nach oben holen, damit sie die Maus beim Ziehen behält
    uiView.setBackgroundColor('#00000000');
    win.contentView.addChildView(uiView);
  } else {
    uiView.setBackgroundColor('#0b0b0f');
    for (const t of tabs) if (t.view && !t.floating) win.contentView.addChildView(t.view);
    for (const v of panelViews.values()) win.contentView.addChildView(v);
  }
  layout();
  pushState();
}

// ------------------------------------------------------------------ Bild-in-Bild (Video ausklappen)
const PIP_JS = `(async (onlyEnter) => {
  try {
    if (document.pictureInPictureElement) {
      if (onlyEnter) return 'ok';
      await document.exitPictureInPicture();
      return 'exit';
    }
    const vids = Array.from(document.querySelectorAll('video')).filter(v => v.readyState > 0);
    if (!vids.length) return 'none';
    vids.sort((a, b) => (Number(!b.paused) - Number(!a.paused)) ||
      (b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight));
    const v = vids[0];
    if (onlyEnter && v.paused) return 'none';
    v.removeAttribute('disablepictureinpicture');
    v.disablePictureInPicture = false;
    await v.requestPictureInPicture();
    return 'ok';
  } catch (e) { return 'err:' + e.message; }
})`;

async function pipTab(tab, { silent = false, onlyEnter = false } = {}) {
  if (!tab || !tab.view || !alive(tab.view.webContents)) return;
  if (tab.frozen) await setFrozen(tab, false);
  const wc = tab.view.webContents;
  let frames;
  try { frames = wc.mainFrame.framesInSubtree; } catch { frames = [wc.mainFrame]; }
  let res = 'none';
  for (const fr of frames) {
    try {
      const r = await fr.executeJavaScript(`${PIP_JS}(${onlyEnter})`, true);
      if (r === 'ok' || r === 'exit') { res = r; break; }
      if (typeof r === 'string' && r.startsWith('err') && res === 'none') res = r;
    } catch { /* Frame nicht erreichbar */ }
  }
  if (silent) return;
  if (res === 'none') toast('Auf dieser Seite läuft kein Video');
  else if (res.startsWith('err')) toast('Dieses Video lässt sich nicht ausklappen');
}

// ------------------------------------------------------------------ Schwebende Fenster
function floatTab(id) {
  const tab = getTab(id);
  if (!tab || tab.floating) return;
  ensureLoaded(tab);
  if (inSplit(id)) split = null;

  const [wx, wy] = win.getPosition();
  const [ww] = win.getSize();
  const fw = new BaseWindow({
    width: 560, height: 350, x: Math.max(0, wx + ww - 600), y: wy + 130,
    minWidth: 260, minHeight: 170, frame: false, alwaysOnTop: true,
    title: tab.title || APP_NAME, icon: ICON, backgroundColor: '#0b0b0f'
  });
  fw.setAlwaysOnTop(true, 'screen-saver');
  fw.setVisibleOnAllWorkspaces?.(true);

  const bar = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload-float.js'), contextIsolation: true, sandbox: true }
  });
  bar.setBackgroundColor('#0b0b0f');
  bar.webContents.loadFile(path.join(__dirname, 'ui', 'float.html'));
  bar.webContents.on('will-navigate', (e) => e.preventDefault());

  try { win.contentView.removeChildView(tab.view); } catch {}
  fw.contentView.addChildView(tab.view);
  fw.contentView.addChildView(bar);
  tab.view.setVisible(true);

  const f = { win: fw, bar, tab, fs: false, pinned: true };
  tab.floating = f;
  floatsByBar.set(bar.webContents.id, f);
  fw.on('resize', () => layoutFloat(f));
  fw.on('closed', () => {
    floatsByBar.delete(f.barId);
    try { if (alive(bar.webContents)) bar.webContents.close(); } catch {}
    if (tab.floating === f) { tab.floating = null; closeTab(tab.id); }
  });
  f.barId = bar.webContents.id;
  bar.webContents.on('did-finish-load', () => sendFloatInfo(f));
  layoutFloat(f);

  if (activeId === id) {
    const next = tabs.filter(t => !t.floating).sort((a, b) => b.lastActive - a.lastActive)[0];
    if (next) activateTab(next.id); else createTab(HOME);
  } else { layout(); pushState(); }
  toast('Tab schwebt jetzt über allen Fenstern');
}

function layoutFloat(f) {
  if (!f || f.win.isDestroyed() || !f.tab.view) return;
  const [w, h] = f.win.getContentSize();
  const BAR = 30;
  if (f.fs) {
    f.bar.setVisible(false);
    f.tab.view.setBounds({ x: 0, y: 0, width: w, height: h });
  } else {
    f.bar.setVisible(true);
    f.bar.setBounds({ x: 0, y: 0, width: w, height: BAR });
    f.tab.view.setBounds({ x: 0, y: BAR, width: w, height: Math.max(1, h - BAR) });
  }
}

function sendFloatInfo(f) {
  if (!f || !alive(f.bar.webContents)) return;
  f.bar.webContents.send('info', {
    title: f.tab.title, favicon: f.tab.favicon, accent: accentNow(),
    opacity: Math.round(f.win.getOpacity() * 100), pinned: f.pinned
  });
  try { f.win.setTitle(f.tab.title || APP_NAME); } catch {}
}

function closeFloatWindow(f) {
  floatsByBar.delete(f.barId);
  try { if (alive(f.bar.webContents)) f.bar.webContents.close(); } catch {}
  try { if (!f.win.isDestroyed()) f.win.destroy(); } catch {}
}

function dockTab(id, { activate = true } = {}) {
  const tab = getTab(id);
  if (!tab || !tab.floating) return;
  const f = tab.floating;
  tab.floating = null;
  try { f.win.contentView.removeChildView(tab.view); } catch {}
  win.contentView.addChildView(tab.view);
  closeFloatWindow(f);
  if (activate) activateTab(id); else { layout(); pushState(); }
}

ipcMain.on('float:cmd', (e, name, arg) => {
  const f = floatsByBar.get(e.sender.id);
  if (!f || f.win.isDestroyed()) return;
  switch (name) {
    case 'opacity': f.win.setOpacity(Math.min(1, Math.max(0.2, Number(arg) / 100 || 1))); break;
    case 'pin':
      f.pinned = !f.pinned;
      f.win.setAlwaysOnTop(f.pinned, 'screen-saver');
      sendFloatInfo(f);
      break;
    case 'dock': dockTab(f.tab.id); win.focus(); break;
    case 'close': closeTab(f.tab.id); break;
    case 'pip': pipTab(f.tab); break;
  }
});

function reopenClosed() {
  const last = closedStack.pop();
  if (last) createTab(last.url, { index: last.index });
}

function cycleTab(dir) {
  if (tabs.length < 2) return;
  const idx = tabs.findIndex(t => t.id === activeId);
  activateTab(tabs[(idx + dir + tabs.length) % tabs.length].id);
}

function moveTab(id, toIndex) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx < 0) return;
  const [t] = tabs.splice(idx, 1);
  tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, t);
  pushState();
}

function navigate(text) {
  const url = toURL(text);
  const tab = activeTab();
  if (!url || !tab) return;
  if (!tab.view) spawnView(tab);
  tab.url = url;
  tab.view.webContents.loadURL(url);
  tab.view.webContents.focus();
  pushState();
}

function setZoom(delta) {
  const tab = activeTab();
  if (!tab || !tab.view) return;
  const wc = tab.view.webContents;
  wc.setZoomLevel(delta === 0 ? 0 : Math.max(-5, Math.min(5, wc.getZoomLevel() + delta * 0.5)));
  pushState();
}

function focusAddress() {
  if (!uiView) return;
  uiView.webContents.focus();
  uiView.webContents.send('focus-address');
}

function setUserFullscreen(on) {
  userFullscreen = on;
  win.setFullScreen(on || htmlFullscreen);
  layout();
  pushState();
}

// ------------------------------------------------------------------ WebContents verdrahten (Tabs & Seitenleiste)
function wireWebContents(wc, tab) {
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (isAdPopup(url, wc.getURL())) { countBlocked(); return { action: 'deny' }; }
    if (disposition === 'new-window') {
      // echte Popups (z. B. Login-Fenster) behalten window.opener
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520, height: 720, autoHideMenuBar: true, icon: ICON,
          backgroundColor: '#0b0b0f', title: APP_NAME
        }
      };
    }
    if (/^(https?|elektron|chrome-extension):/i.test(url)) createTab(url, { activate: disposition !== 'background-tab', private: !!(tab && tab.private) });
    return { action: 'deny' };
  });

  try { wc.setWebRTCIPHandlingPolicy('default_public_interface_only'); } catch {}
  wc.on('before-input-event', (e, input) => { if (handleShortcut(input)) e.preventDefault(); });
  wc.on('context-menu', (e, p) => showContextMenu(wc, p, tab));
  wc.on('dom-ready', () => injectYouTubeSkipper(wc));
  // Schneller: Verbindung zum Ziel schon aufbauen, während die Maus auf einem Link liegt
  let lastPre = '';
  wc.on('update-target-url', (e, url) => {
    if (!url || !/^https?:/i.test(url)) return;
    let origin = '';
    try { origin = new URL(url).origin; } catch { return; }
    if (origin === lastPre) return;
    lastPre = origin;
    try { wc.session.preconnect({ url: origin, numSockets: 1 }); } catch {}
  });

  if (!tab) return; // Seitenleisten-Panel

  // Im Split-Screen: angeklickte Seite wird zum aktiven Tab
  wc.on('focus', () => {
    if (inSplit(tab.id) && activeId !== tab.id) { activeId = tab.id; tab.lastActive = Date.now(); pushState(); }
  });
  wc.on('page-title-updated', (e, title) => {
    tab.title = title || tab.title;
    if (!tab.private && title) store.updateTitle(wc.getURL(), title);
    if (tab.floating) sendFloatInfo(tab.floating);
    pushState();
  });
  wc.on('found-in-page', (e, r) => {
    if (tab.id === activeId && uiView) uiView.webContents.send('find-result', { active: r.activeMatchOrdinal, matches: r.matches });
  });
  wc.on('page-favicon-updated', (e, favs) => {
    tab.favicon = favs && favs[0] ? favs[0] : null;
    if (tab.floating) sendFloatInfo(tab.floating);
    pushState();
  });
  wc.on('did-start-loading', () => { tab.loading = true; pushState(); });
  wc.on('did-stop-loading', () => { tab.loading = false; pushState(); });
  wc.on('did-navigate', (e, url) => {
    if (/^https:/i.test(url)) upgraded.delete(wc.id);
    pendingBlock.delete(wc.id);
    tab.url = url;
    tab.favicon = url.startsWith('elektron:') ? null : tab.favicon;
    if (!tab.private) store.addVisit(url, wc.getTitle());
    pushState();
  });
  wc.on('did-navigate-in-page', (e, url, isMain) => {
    if (!isMain) return;
    tab.url = url;
    if (!tab.private) store.addVisit(url, wc.getTitle());
    pushState();
  });
  wc.on('did-finish-load', () => {
    if (!wc.__perfDone) { wc.__perfDone = true; perf('first-page ' + wc.getURL().slice(0, 40)); }
    if (wc.getURL().startsWith('elektron://start')) applyAccentToStart(wc);
  });
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain) return;
    if (handleProtectedFailure(wc, code, url)) return;
    if (code === -3 || url.startsWith('elektron:')) return;
    const err = `elektron://start/error.html?u=${encodeURIComponent(url)}&c=${code}&d=${encodeURIComponent(desc)}`;
    wc.loadURL(err);
  });
  wc.on('audio-state-changed', (e) => { tab.audible = !!e.audible; pushState(); });
  wc.on('render-process-gone', (e, details) => {
    if (details.reason === 'clean-exit') return;
    tab.crashed = true;
    tab.title = 'Tab abgestürzt – klicken zum Neuladen';
    pushState();
  });
  wc.on('enter-html-full-screen', () => {
    if (tab.floating) { tab.floating.fs = true; tab.floating.win.setFullScreen(true); layoutFloat(tab.floating); return; }
    htmlFullscreen = true;
    win.setFullScreen(true);
    layout(); pushState();
  });
  wc.on('leave-html-full-screen', () => {
    if (tab.floating) { tab.floating.fs = false; tab.floating.win.setFullScreen(false); layoutFloat(tab.floating); return; }
    htmlFullscreen = false;
    if (!userFullscreen) win.setFullScreen(false);
    layout(); pushState();
  });
}

const BACKGROUNDS = ['neon', 'schlicht', 'nebel', 'galaxie', 'berge', 'aurora', 'wellen', 'eigenes'];
const accentNow = () => (settings.style === 'normal' ? settings.accentNormal : settings.accent);
function lookInfo() {
  return { accent: accentNow(), style: settings.style, background: settings.background, bgVersion: settings.bgVersion };
}
function applyAccentToStart(wc) {
  if (!alive(wc)) return;
  wc.send('internal:look-changed', lookInfo());
}
function lookChanged() {
  for (const t of tabs) if (t.view && alive(t.view.webContents) && t.url.startsWith('elektron://start')) applyAccentToStart(t.view.webContents);
  for (const f of floatsByBar.values()) sendFloatInfo(f);
  pushState();
}
function userBgFile() {
  try {
    const f = fs.readdirSync(app.getPath('userData')).find(n => /^hintergrund\.(png|jpe?g|webp|gif)$/i.test(n));
    return f ? path.join(app.getPath('userData'), f) : null;
  } catch { return null; }
}
async function chooseBackground() {
  const r = await dialog.showOpenDialog(win, {
    title: 'Eigenes Hintergrundbild wählen',
    filters: [{ name: 'Bilder', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths[0]) return;
  const src = r.filePaths[0];
  if (fs.statSync(src).size > 25 * 1024 * 1024) { toast('Das Bild ist zu groß (max. 25 MB)'); return; }
  const old = userBgFile();
  if (old) try { fs.unlinkSync(old); } catch {}
  fs.copyFileSync(src, path.join(app.getPath('userData'), 'hintergrund' + path.extname(src).toLowerCase()));
  settings.background = 'eigenes';
  settings.bgVersion = Date.now();
  saveSettings();
  lookChanged();
}
function setStyle(style) {
  if (!['gaming', 'normal'].includes(style) || settings.style === style) return;
  settings.style = style;
  if (style === 'normal' && gamingMode) setGamingMode(false);
  if (style === 'normal' && settings.background === 'neon') settings.background = 'schlicht';
  if (style === 'gaming' && settings.background === 'schlicht') settings.background = 'neon';
  saveSettings();
  lookChanged();
  toast(style === 'normal' ? 'Normaler Browser – Gaming-Elemente sind ausgeblendet' : 'Gaming-Browser ist zurück 🎮');
}

function showContextMenu(wc, p, tab) {
  const t = [];
  if (p.misspelledWord) {
    const sugg = (p.dictionarySuggestions || []).slice(0, 5);
    for (const w of sugg) t.push({ label: w, click: () => wc.replaceMisspelling(w) });
    if (!sugg.length) t.push({ label: 'Keine Vorschläge', enabled: false });
    t.push({ label: 'Zum Wörterbuch hinzufügen', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) },
      { type: 'separator' });
  }
  if (p.linkURL) {
    t.push(
      { label: 'Link in neuem Tab öffnen', click: () => createTab(p.linkURL, { activate: false, private: !!(tab && tab.private) }) },
      { label: 'Link in privatem Tab öffnen', click: () => createTab(p.linkURL, { private: true }) },
      { label: 'Link im Split-Screen öffnen', click: () => { const nt = createTab(p.linkURL, { activate: false }); startSplit(nt.id); } },
      { label: 'Link kopieren', click: () => clipboard.writeText(p.linkURL) },
      { type: 'separator' }
    );
  }
  if (p.mediaType === 'image' && p.srcURL) {
    t.push(
      { label: 'Bild in neuem Tab öffnen', click: () => createTab(p.srcURL, { activate: false }) },
      { label: 'Bild kopieren', click: () => wc.copyImageAt(p.x, p.y) },
      { label: 'Bild speichern …', click: () => wc.downloadURL(p.srcURL) },
      { type: 'separator' }
    );
  }
  if (p.isEditable) {
    t.push(
      { label: 'Ausschneiden', enabled: p.editFlags.canCut, click: () => wc.cut() },
      { label: 'Kopieren', enabled: p.editFlags.canCopy, click: () => wc.copy() },
      { label: 'Einfügen', enabled: p.editFlags.canPaste, click: () => wc.paste() },
      { label: 'Alles auswählen', click: () => wc.selectAll() },
      { type: 'separator' }
    );
  } else if (p.selectionText && p.selectionText.trim()) {
    const s = p.selectionText.trim();
    const short = s.length > 28 ? s.slice(0, 28) + '…' : s;
    const aiName = settings.preferredAI === 'chatgpt' ? 'ChatGPT' : 'Claude';
    t.push(
      { label: 'Kopieren', click: () => wc.copy() },
      { label: `Mit Google suchen: „${short}“`, click: () => createTab('https://www.google.com/search?q=' + encodeURIComponent(s)) },
      { label: `Mit ${aiName} erklären`, click: () => openAI('Erkläre mir das bitte einfach und auf Deutsch:\n\n' + s.slice(0, 3000)) },
      { label: 'Übersetzen', click: () => translateText(s) },
      { type: 'separator' }
    );
  }
  if (tab && /^https?:/i.test(wc.getURL()) && !p.isEditable && !p.linkURL && !(p.selectionText && p.selectionText.trim())) {
    const aiName = settings.preferredAI === 'chatgpt' ? 'ChatGPT' : 'Claude';
    t.push(
      { label: `Seite mit ${aiName} zusammenfassen`, click: () => aiAboutPage(tab, 'summary') },
      { label: 'Seite auf Deutsch übersetzen', click: () => translatePage(tab) },
      { label: 'Lesemodus', click: () => readerMode() },
      { label: 'Screenshot', submenu: [
        { label: 'Sichtbarer Bereich', click: () => screenshot(false) },
        { label: 'Ganze Seite', click: () => screenshot(true) }
      ] },
      { type: 'separator' }
    );
  }
  t.push(
    { label: 'Zurück', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: 'Vor', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: 'Neu laden', click: () => wc.reload() },
    { type: 'separator' },
    { label: 'Seite untersuchen', click: () => wc.inspectElement(p.x, p.y) }
  );
  if (!tab) {
    t.push({ type: 'separator' }, { label: 'Panel schließen', click: () => togglePanel(panel) });
  }
  const menu = Menu.buildFromTemplate(t);
  // Einträge von Erweiterungen (z. B. "Mit … übersetzen") oben einfügen
  const extItems = tab && !tab.private ? extmod.contextMenuItems(wc, p) : [];
  if (extItems.length) {
    menu.insert(0, new MenuItem({ type: 'separator' }));
    for (let i = extItems.length - 1; i >= 0; i--) menu.insert(0, extItems[i]);
  }
  menu.popup({ window: win });
}

// ------------------------------------------------------------------ Tastenkürzel
function handleShortcut(input) {
  if (input.type !== 'keyDown') return false;
  const ctrl = input.control || input.meta;
  const k = (input.key || '').length === 1 ? input.key.toLowerCase() : input.key;
  const tab = activeTab();
  const wc = tab && tab.view && alive(tab.view.webContents) ? tab.view.webContents : null;

  if (ctrl && input.shift && k === 't') { reopenClosed(); return true; }
  if (ctrl && input.shift && k === 'g') { if (settings.style === 'gaming') setGamingMode(!gamingMode); return true; }
  if (ctrl && input.shift && k === 's') { toggleSplit(); return true; }
  if (ctrl && input.shift && k === 'p') { pipTab(activeTab()); return true; }
  if (ctrl && input.shift && k === 'f') { if (activeId != null) floatTab(activeId); return true; }
  if (ctrl && input.shift && k === 'n') { createTab(HOME, { private: true }); return true; }
  if (ctrl && input.shift && k === 'x') { screenshot(false); return true; }
  if (k === 'F9') { readerMode(); return true; }
  if (ctrl && input.shift && k === 'b') { setSetting('showBookmarkBar', !settings.showBookmarkBar); return true; }
  if (ctrl && input.shift && k === 'o') { openInternal('bookmarks'); return true; }
  if (ctrl && input.shift && k === 'Delete') { openInternal('history'); return true; }
  if (ctrl && !input.shift && k === 'd') { toggleBookmark(); return true; }
  if (ctrl && !input.shift && k === 'h') { openInternal('history'); return true; }
  if (ctrl && !input.shift && k === 'j') { openInternal('downloads'); return true; }
  if (ctrl && !input.shift && k === 'p') { if (wc) wc.print(); return true; }
  if (ctrl && !input.shift && k === 'f') { openFind(); return true; }
  if (k === 'F3' || (ctrl && k === 'g')) { if (uiView) uiView.webContents.send('find-next', { forward: !input.shift }); return true; }
  if (ctrl && input.shift && k === 'i') { if (wc) wc.toggleDevTools(); return true; }
  if (ctrl && !input.shift && k === 't') { createTab(); return true; }
  if (ctrl && k === 'w') { closeTab(activeId); return true; }
  if (ctrl && k === 'Tab') { cycleTab(input.shift ? -1 : 1); return true; }
  if (ctrl && k === 'PageDown') { cycleTab(1); return true; }
  if (ctrl && k === 'PageUp') { cycleTab(-1); return true; }
  if ((ctrl && k === 'l') || k === 'F6' || (input.alt && k === 'd')) { focusAddress(); return true; }
  if (k === 'F5' || (ctrl && k === 'r')) {
    if (wc) (ctrl || input.shift) ? wc.reloadIgnoringCache() : wc.reload();
    return true;
  }
  if (input.alt && k === 'ArrowLeft') { if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return true; }
  if (input.alt && k === 'ArrowRight') { if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); return true; }
  if (input.alt && k === 'Home') { navigate(HOME); return true; }
  if (k === 'F11') { setUserFullscreen(!userFullscreen); return true; }
  if (k === 'F12') { if (wc) wc.toggleDevTools(); return true; }
  if (ctrl && (k === '+' || k === '=' || input.code === 'NumpadAdd')) { setZoom(1); return true; }
  if (ctrl && (k === '-' || input.code === 'NumpadSubtract')) { setZoom(-1); return true; }
  if (ctrl && (k === '0' || input.code === 'Numpad0')) { setZoom(0); return true; }
  if (ctrl && /^[1-9]$/.test(k)) {
    const n = Number(k);
    const t = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
    if (t) activateTab(t.id);
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ Seitenleiste
function togglePanel(name) {
  panel = panel === name ? null : name;
  if (panel && panel.startsWith('web:')) {
    const key = panel.slice(4);
    if (!panelViews.has(key) && WEB_PANELS[key]) {
      const v = newTabView();
      win.contentView.addChildView(v);
      wireWebContents(v.webContents, null);
      applyNetLimit(v.webContents);
      v.webContents.loadURL(WEB_PANELS[key]);
      panelViews.set(key, v);
    }
  }
  layout();
  pushState();
  if (!panel) { const t = activeTab(); if (t && t.view) t.view.webContents.focus(); }
}

// ------------------------------------------------------------------ Gaming-Modus & Monitor
const lowered = new Set();

function lowerPriority(metrics) {
  const below = os.constants.priority.PRIORITY_BELOW_NORMAL;
  for (const m of metrics) {
    if (lowered.has(m.pid)) continue;
    try { os.setPriority(m.pid, below); lowered.add(m.pid); } catch { lowered.add(m.pid); }
  }
}

function restorePriority() {
  for (const pid of lowered) {
    try { os.setPriority(pid, os.constants.priority.PRIORITY_NORMAL); } catch {}
  }
  lowered.clear();
}

function setGamingMode(on) {
  gamingMode = on;
  if (on) {
    for (const t of tabs) if (!isShown(t) && !t.audible) setFrozen(t, true, 'gaming');
    lowerPriority(app.getAppMetrics());
    toast('Gaming-Modus an – Hintergrund-Tabs eingefroren, Browser-Priorität gesenkt', { kind: 'gaming' });
  } else {
    for (const t of tabs) if (t.frozen && t.freezeReason === 'gaming') setFrozen(t, false);
    restorePriority();
    toast('Gaming-Modus aus');
  }
  pushState();
}

let hwTick = 0;
let lastHw = null;
function tick() {
  if (!win || win.isDestroyed()) return;
  let metrics;
  try { metrics = app.getAppMetrics(); } catch { return; }
  const cores = os.cpus().length || 1;
  const byPid = new Map();
  let ramKB = 0, cpu = 0;
  for (const m of metrics) {
    byPid.set(m.pid, m);
    ramKB += m.memory.workingSetSize || 0;
    cpu += m.cpu.percentCPUUsage || 0;
  }
  cpu = cpu / cores;
  const ramMB = ramKB / 1024;
  stats = { ram: ramMB, cpu };

  for (const t of tabs) {
    if (!t.view || !alive(t.view.webContents)) { t.memMB = 0; t.cpu = 0; continue; }
    const m = byPid.get(t.view.webContents.getOSProcessId());
    t.memMB = m ? m.memory.workingSetSize / 1024 : 0;
    t.cpu = m ? m.cpu.percentCPUUsage / cores : 0;
  }

  const background = tabs.filter(t => !isShown(t) && t.view && !t.audible);

  // RAM-Limiter: am längsten unbenutzten Tab schlafen legen
  if (settings.ramLimit.enabled && ramMB > settings.ramLimit.mb) {
    const victim = background.slice().sort((a, b) => a.lastActive - b.lastActive)[0];
    if (victim) discardTab(victim);
  }

  // CPU-Limiter: hungrigsten Hintergrund-Tab einfrieren
  if (settings.cpuLimit.enabled) {
    cpuOver = cpu > settings.cpuLimit.percent ? cpuOver + 1 : 0;
    if (cpuOver >= 2) {
      const victim = background.filter(t => !t.frozen).sort((a, b) => b.cpu - a.cpu)[0];
      if (victim) setFrozen(victim, true, 'cpu');
      cpuOver = 0;
    }
  }

  if (gamingMode) {
    const now = Date.now();
    for (const t of background) if (!t.frozen && now - t.lastActive > 3000) setFrozen(t, true, 'gaming');
    lowerPriority(metrics);
  }

  if (panel === 'gx' && settings.style === 'gaming' && (++hwTick % 2 === 0)) {
    extras.hardware().then(hw => { lastHw = hw; }).catch(() => {});
  }
  if (uiView && alive(uiView.webContents)) {
    uiView.webContents.send('stats', {
      hw: panel === 'gx' && settings.style === 'gaming' ? lastHw : null,
      ram: ramMB, cpu, cores,
      tabs: tabs.length,
      frozen: tabs.filter(t => t.frozen).length,
      sleeping: tabs.filter(t => t.discarded).length,
      blocked: settings.blockedTotal
    });
  }
}

// ------------------------------------------------------------------ Werbeblocker
async function initAdblock() {
  try {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    // Volle Listen: Werbung, Tracker, Störer (Cookie-Banner, Popups); alle 3 Tage frisch laden
    const cache = path.join(app.getPath('userData'), 'adblock-full.bin');
    try {
      if (Date.now() - fs.statSync(cache).mtimeMs > 3 * 24 * 3600 * 1000) fs.unlinkSync(cache);
    } catch {}
    blocker = await ElectronBlocker.fromPrebuiltFull(fetch, {
      path: cache, read: fs.promises.readFile, write: fs.promises.writeFile
    });
    blocker.on('request-blocked', countBlocked);
    blocker.on('request-redirected', countBlocked);
    if (settings.adblock) enableAdblockAll();
    pushState();
  } catch (e) {
    blocker = null;
    console.warn('Werbeblocker konnte nicht geladen werden:', e.message);
  }
}

function countBlocked() {
  settings.blockedTotal++;
  saveSettings();
}

// Werbe-Popups und Weiterleitungen beim Öffnen neuer Fenster/Tabs abfangen
function isAdPopup(url, sourceUrl) {
  if (!blocker || !settings.adblock || !/^https?:/i.test(url)) return false;
  try {
    const { Request } = require('@ghostery/adblocker-electron');
    const req = Request.fromRawDetails({ url, sourceUrl: sourceUrl || '', type: 'main_frame' });
    const res = blocker.match(req);
    return !!(res && res.match);
  } catch { return false; }
}

// YouTube: Werbung überspringen, stummschalten und Werbeflächen ausblenden
const YT_JS = `(() => {
  if (window.__elektronYT) return;
  window.__elektronYT = true;
  const css = document.createElement('style');
  css.textContent = [
    'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer', 'ytd-promoted-sparkles-web-renderer', 'ytd-display-ad-renderer',
    'ytd-companion-slot-renderer', 'ytd-player-legacy-desktop-watch-ads-renderer', 'ytd-merch-shelf-renderer',
    'ytd-promoted-video-renderer', 'ytd-search-pyv-renderer', '#masthead-ad', '#player-ads',
    '.ytp-ad-overlay-container', '.ytp-ad-overlay-slot', 'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]'
  ].join(',') + '{display:none!important}';
  (document.head || document.documentElement).appendChild(css);
  let mutedByUs = false;
  setInterval(() => {
    const player = document.querySelector('#movie_player, .html5-video-player');
    if (!player) return;
    const v = player.querySelector('video');
    const ad = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
    const skip = player.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button[id^="skip-button"]');
    if (skip) skip.click();
    if (!v) return;
    if (ad) {
      if (!v.muted) { v.muted = true; mutedByUs = true; }
      v.playbackRate = 16;
      if (isFinite(v.duration) && v.duration > 0.5 && v.currentTime < v.duration - 0.3) v.currentTime = v.duration - 0.2;
    } else if (mutedByUs) {
      v.muted = false;
      mutedByUs = false;
      if (v.playbackRate === 16) v.playbackRate = 1;
    }
  }, 250);
})();`;

function injectYouTubeSkipper(wc) {
  if (!settings.ytSkip || !settings.adblock || !alive(wc)) return;
  let host = '';
  try { host = new URL(wc.getURL()).hostname; } catch { return; }
  if (!/(^|\.)youtube\.com$/i.test(host)) return;
  wc.executeJavaScriptInIsolatedWorld(1999, [{ code: YT_JS }]).catch(() => {});
}

// Der Blocker registriert pro Sitzung dieselben IPC-Handler – vorher entfernen, damit
// er in der normalen und in der privaten Sitzung gleichzeitig laufen kann.
const adblockSessions = new Set();
function enableAdblockOn(ses) {
  if (!blocker || !ses || adblockSessions.has(ses)) return;
  ipcMain.removeHandler('@ghostery/adblocker/inject-cosmetic-filters');
  ipcMain.removeHandler('@ghostery/adblocker/is-mutation-observer-enabled');
  try { blocker.enableBlockingInSession(ses); adblockSessions.add(ses); }
  catch (e) { console.warn('Werbeblocker-Sitzung:', e.message); }
  installRequestFilter(ses);
}
function enableAdblockAll() {
  enableAdblockOn(mainSes);
  if (privateSes) enableAdblockOn(privateSes);
}
function disableAdblockAll() {
  for (const ses of adblockSessions) { try { blocker.disableBlockingInSession(ses); } catch {} }
  adblockSessions.clear();
  reinstallRequestFilters();
}

function setAdblock(on) {
  settings.adblock = on;
  if (blocker) { if (on) enableAdblockAll(); else disableAdblockAll(); }
  else if (on) initAdblock();
  reinstallRequestFilters();
}

// ------------------------------------------------------------------ Schutz: Phishing-/Malware-Sperre und HTTPS
// Electron erlaubt nur EINEN onBeforeRequest-Listener pro Sitzung – daher prüft dieser Filter zuerst
// auf gefährliche Seiten und HTTPS und gibt danach an den Werbeblocker weiter.
const pendingBlock = new Map();   // webContents-ID -> { url, kind }
const upgraded = new Map();       // webContents-ID -> ursprüngliche http-Adresse
const allowDanger = new Set();    // Hosts, die der Nutzer trotz Warnung öffnen will (bis zum Neustart)
const allowHttp = new Set();      // Hosts, die nur unverschlüsselt erreichbar sind und erlaubt wurden

function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }

function requestFilter(ses) {
  return (details, cb) => {
    const type = details.resourceType;
    const url = details.url;
    if ((type === 'mainFrame' || type === 'subFrame') && /^https?:/i.test(url)) {
      const host = hostOf(url);
      if (settings.phishingProtect && !allowDanger.has(host)) {
        const kind = protect.check(url);
        if (kind) {
          if (type === 'mainFrame' && details.webContentsId) pendingBlock.set(details.webContentsId, { url, kind });
          countBlocked();
          return cb({ cancel: true });
        }
      }
      if (type === 'mainFrame' && settings.httpsOnly && /^http:/i.test(url) && !protect.isLocalHost(host) && !allowHttp.has(host)) {
        if (details.webContentsId) upgraded.set(details.webContentsId, url);
        return cb({ redirectURL: 'https:' + url.slice(5) });
      }
    }
    if (blocker && adblockSessions.has(ses)) return blocker.onBeforeRequest(details, cb);
    cb({});
  };
}

// ------------------------------------------------------------------ Tracking-Schutz: Fremd-Cookies blockieren
let cookiesBlocked = 0;
function topUrlOf(details) {
  try { const f = details.frame; if (f && f.top && f.top.url) return f.top.url; } catch {}
  try { const wc = details.webContents || (details.webContentsId && wcModule.fromId(details.webContentsId)); if (wc && !wc.isDestroyed()) return wc.getURL(); } catch {}
  return '';
}
function stripThirdParty(details) {
  if (!settings.blockThirdPartyCookies || details.resourceType === 'mainFrame') return false;
  const top = topUrlOf(details);
  return !!top && privacy.isThirdParty(top, details.url);
}
function sendHeadersFilter() {
  return (details, cb) => {
    const h = details.requestHeaders;
    if (stripThirdParty(details)) {
      let changed = false;
      for (const k of Object.keys(h)) if (k.toLowerCase() === 'cookie') { delete h[k]; changed = true; }
      if (changed) { cookiesBlocked++; return cb({ requestHeaders: h }); }
    }
    cb({});
  };
}
function headersFilter(ses) {
  return (details, cb) => {
    let changed = false;
    const h = details.responseHeaders || {};
    if (stripThirdParty(details)) {
      for (const k of Object.keys(h)) if (k.toLowerCase() === 'set-cookie') { delete h[k]; changed = true; }
      if (changed) cookiesBlocked++;
    }
    if (blocker && adblockSessions.has(ses)) {
      return blocker.onHeadersReceived(details, (r) => cb(r && r.responseHeaders ? r : (changed ? { responseHeaders: h } : {})));
    }
    cb(changed ? { responseHeaders: h } : {});
  };
}

// ------------------------------------------------------------------ Sicheres DNS (DNS über HTTPS)
function applyDns() {
  try {
    if (settings.secureDns) app.configureHostResolver({ secureDnsMode: 'automatic', secureDnsServers: privacy.DOH_SERVERS });
    else app.configureHostResolver({ secureDnsMode: 'off' });
  } catch (e) { console.warn('DNS:', e.message); }
}

function installRequestFilter(ses) {
  if (!ses) return;
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, requestFilter(ses));
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, sendHeadersFilter());
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, headersFilter(ses));
}

function reinstallRequestFilters() {
  installRequestFilter(mainSes);
  if (privateSes) installRequestFilter(privateSes);
}

// Wird bei einem fehlgeschlagenen Laden im Hauptrahmen aufgerufen; true = selbst behandelt
function handleProtectedFailure(wc, code, url) {
  const blocked = pendingBlock.get(wc.id);
  if (blocked && code === -20) {
    pendingBlock.delete(wc.id);
    wc.loadURL(`elektron://start/blocked.html?u=${encodeURIComponent(blocked.url)}&k=${blocked.kind}`);
    return true;
  }
  const original = upgraded.get(wc.id);
  if (original && /^https:/i.test(url) && hostOf(url) === hostOf(original) && ![-3, -105, -106, -20].includes(code)) {
    upgraded.delete(wc.id);
    wc.loadURL(`elektron://start/insecure.html?u=${encodeURIComponent(original)}&c=${code}`);
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ Einstellungen aus der UI
function setSetting(key, value) {
  switch (key) {
    case 'accent':
      if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
        if (settings.style === 'normal') settings.accentNormal = value; else settings.accent = value;
        lookChanged();
      }
      break;
    case 'style': setStyle(String(value)); return;
    case 'background':
      if (BACKGROUNDS.includes(value)) {
        if (value === 'eigenes' && !userBgFile()) { chooseBackground(); return; }
        settings.background = value;
        lookChanged();
      }
      break;
    case 'preferredAI': if (['claude', 'chatgpt'].includes(value)) settings.preferredAI = value; break;
    case 'ramLimit.enabled': settings.ramLimit.enabled = !!value; break;
    case 'ramLimit.mb': settings.ramLimit.mb = clamp(value, 512, 32768); break;
    case 'cpuLimit.enabled': settings.cpuLimit.enabled = !!value; cpuOver = 0; break;
    case 'cpuLimit.percent': settings.cpuLimit.percent = clamp(value, 5, 95); break;
    case 'netLimit.enabled': settings.netLimit.enabled = !!value; allWebContents().forEach(applyNetLimit); break;
    case 'netLimit.kbs': settings.netLimit.kbs = clamp(value, 64, 1024 * 1024); if (settings.netLimit.enabled) allWebContents().forEach(applyNetLimit); break;
    case 'adblock': setAdblock(!!value); break;
    case 'ytSkip': settings.ytSkip = !!value; break;
    case 'httpsOnly': settings.httpsOnly = !!value; break;
    case 'phishingProtect': settings.phishingProtect = !!value; break;
    case 'scanDownloads': settings.scanDownloads = !!value; break;
    case 'secureDns': settings.secureDns = !!value; applyDns(); break;
    case 'blockThirdPartyCookies': settings.blockThirdPartyCookies = !!value; break;
    case 'fingerprintProtect': settings.fingerprintProtect = !!value; break;
    case 'showBookmarkBar': settings.showBookmarkBar = !!value; hideSuggest(); layout(); break;
    case 'autoUpdate': settings.autoUpdate = !!value; break;
    case 'updateUrl': {
      const u = String(value || '').trim();
      if (u && !/^https?:\/\/\S+$/i.test(u)) { toast('Bitte eine Adresse mit https:// eingeben'); return; }
      settings.updateUrl = u;
      update = { state: 'idle', version: null, percent: 0, message: '' };
      if (u) setTimeout(() => checkUpdates(true), 200);
      break;
    }
    case 'autoPip': settings.autoPip = !!value; break;
    case 'camera':
    case 'mic':
      if (['block', 'ask', 'allow'].includes(value)) {
        settings[key] = value;
        // gemerkte Einzelentscheidungen für Kamera/Mikrofon verwerfen, die neue Regel gilt
        for (const k of Object.keys(settings.permissions)) if (k.includes('|media')) delete settings.permissions[k];
      }
      break;
    case 'freezeOnMinimize': settings.freezeOnMinimize = !!value; break;
    case 'clearOnExit': settings.clearOnExit = !!value; break;
    case 'restoreSession': settings.restoreSession = !!value; break;
    case 'highPerfGpu': settings.highPerfGpu = !!value; break;
    case 'unlockFps': settings.unlockFps = !!value; break;
    default: return;
  }
  saveSettings();
  pushState();
}

function clamp(v, lo, hi) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo;
}

async function clearBrowsingData() {
  await mainSes.clearStorageData();
  await mainSes.clearCache();
  toast('Browserdaten gelöscht');
}

function showMainMenu() {
  const t = activeTab();
  const wc = t && t.view ? t.view.webContents : null;
  Menu.buildFromTemplate([
    { label: 'Neuer Tab', accelerator: 'CmdOrCtrl+T', click: () => createTab() },
    { label: 'Geschlossenen Tab wiederherstellen', accelerator: 'CmdOrCtrl+Shift+T', enabled: closedStack.length > 0, click: reopenClosed },
    { type: 'separator' },
    { label: 'Vergrößern', accelerator: 'CmdOrCtrl+Plus', click: () => setZoom(1) },
    { label: 'Verkleinern', accelerator: 'CmdOrCtrl+-', click: () => setZoom(-1) },
    { label: 'Zoom zurücksetzen', accelerator: 'CmdOrCtrl+0', click: () => setZoom(0) },
    { label: 'Vollbild', accelerator: 'F11', click: () => setUserFullscreen(!userFullscreen) },
    { type: 'separator' },
    ...(settings.style === 'gaming' ? [
      { label: gamingMode ? 'Gaming-Modus ausschalten' : 'Gaming-Modus einschalten', accelerator: 'CmdOrCtrl+Shift+G', click: () => setGamingMode(!gamingMode) }
    ] : []),
    { label: settings.style === 'gaming' ? 'GX Control' : 'Einstellungen', click: () => togglePanel('gx') },
    { label: settings.style === 'gaming' ? 'Zum normalen Browser wechseln' : 'Zum Gaming-Browser wechseln', click: () => setStyle(settings.style === 'gaming' ? 'normal' : 'gaming') },
    { type: 'separator' },
    { label: split ? 'Split-Screen beenden' : 'Split-Screen', accelerator: 'CmdOrCtrl+Shift+S', click: () => toggleSplit() },
    { label: 'Video ausklappen (Bild-in-Bild)', accelerator: 'CmdOrCtrl+Shift+P', enabled: !!wc, click: () => pipTab(t) },
    { label: 'Tab als schwebendes Fenster', accelerator: 'CmdOrCtrl+Shift+F', enabled: !!t, click: () => floatTab(t.id) },
    { type: 'separator' },
    { label: 'Neuer privater Tab', accelerator: 'CmdOrCtrl+Shift+N', click: () => createTab(HOME, { private: true }) },
    { type: 'separator' },
    { label: 'Lesezeichen', accelerator: 'CmdOrCtrl+Shift+O', click: () => openInternal('bookmarks') },
    { label: settings.showBookmarkBar ? 'Lesezeichenleiste ausblenden' : 'Lesezeichenleiste anzeigen', accelerator: 'CmdOrCtrl+Shift+B', click: () => setSetting('showBookmarkBar', !settings.showBookmarkBar) },
    { label: 'Verlauf', accelerator: 'CmdOrCtrl+H', click: () => openInternal('history') },
    { label: 'Downloads', accelerator: 'CmdOrCtrl+J', click: () => openInternal('downloads') },
    { label: 'Erweiterungen', click: () => openInternal('extensions') },
    { label: 'Chrome Web Store', click: () => extmod.openStore('') },
    { label: 'Auf der Seite suchen …', accelerator: 'CmdOrCtrl+F', enabled: !!wc, click: openFind },
    { label: 'Seite drucken …', enabled: !!wc, click: () => wc && wc.print() },
    { label: 'Entwicklertools', accelerator: 'F12', enabled: !!wc, click: () => wc && wc.toggleDevTools() },
    { type: 'separator' },
    { label: 'Screenshot (sichtbarer Bereich)', accelerator: 'CmdOrCtrl+Shift+X', enabled: !!wc, click: () => screenshot(false) },
    { label: 'Screenshot (ganze Seite)', enabled: !!wc, click: () => screenshot(true) },
    { label: 'Lesemodus', enabled: !!wc, click: () => readerMode() },
    { type: 'separator' },
    { label: 'Lesezeichen & Einstellungen sichern …', click: backupData },
    { label: 'Sicherung wiederherstellen …', click: restoreData },
    { type: 'separator' },
    { label: 'Elektron GX weiterempfehlen', click: () => {
      clipboard.writeText('https://obimokenobix.github.io/elektron-gx/');
      toast('Link kopiert – schick ihn an deine Freunde!');
    } },
    { label: 'Browserdaten löschen', click: clearBrowsingData },
    { label: 'Nach Updates suchen', click: () => { if (panel !== 'gx') togglePanel('gx'); checkUpdates(true); } },
    ...(process.platform === 'win32' ? [{ label: 'Als Standardbrowser festlegen …', click: () => shell.openExternal('ms-settings:defaultapps?registeredAppUser=Elektron%20GX') }] : []),
    { label: `Über ${APP_NAME}`, click: () => dialog.showMessageBox(win, {
      type: 'info', title: APP_NAME, message: `${APP_NAME} ${app.getVersion()}`,
      detail: `Der Gaming-Browser.\nChromium ${process.versions.chrome} · Electron ${process.versions.electron}`
    }) },
    { label: 'Beenden', click: () => app.quit() }
  ]).popup({ window: win });
}

function showTabMenu(id) {
  const t = getTab(id);
  if (!t) return;
  const wc = t.view && alive(t.view.webContents) ? t.view.webContents : null;
  Menu.buildFromTemplate([
    { label: 'Neu laden', click: () => { if (wc) wc.reload(); else activateTab(id); } },
    { label: 'Duplizieren', click: () => createTab(t.url) },
    { label: t.muted ? 'Ton einschalten' : 'Tab stummschalten', enabled: !!wc, click: () => toggleMute(id) },
    { type: 'separator' },
    inSplit(id)
      ? { label: 'Split-Screen beenden', click: endSplit }
      : { label: 'Im Split-Screen neben aktuellem Tab', enabled: id !== activeId && !t.floating, click: () => startSplit(id) },
    t.floating
      ? { label: 'Zurück in den Browser holen', click: () => dockTab(id) }
      : { label: 'Als schwebendes Fenster öffnen', click: () => floatTab(id) },
    { label: 'Video ausklappen (Bild-in-Bild)', enabled: !!wc, click: () => pipTab(t) },
    { type: 'separator' },
    { label: 'Einfrieren', enabled: !!wc && !t.frozen && !isShown(t), click: () => setFrozen(t, true, 'manual') },
    { label: 'Schlafen legen (RAM freigeben)', enabled: !!wc && !isShown(t), click: () => discardTab(t) },
    { type: 'separator' },
    { label: 'Tab schließen', click: () => closeTab(id) },
    { label: 'Andere Tabs schließen', enabled: tabs.length > 1, click: () => tabs.filter(x => x.id !== id).forEach(x => closeTab(x.id)) },
    { label: 'Tabs rechts schließen', click: () => { const i = tabs.findIndex(x => x.id === id); tabs.slice(i + 1).forEach(x => closeTab(x.id)); } }
  ]).popup({ window: win });
}

function toggleMute(id) {
  const t = getTab(id);
  if (!t || !t.view) return;
  t.muted = !t.muted;
  t.view.webContents.setAudioMuted(t.muted);
  pushState();
}

// ------------------------------------------------------------------ IPC von der Oberfläche
function fromUI(e) { return uiView && e.sender === uiView.webContents; }

ipcMain.on('ui:cmd', (e, name, ...args) => {
  if (!fromUI(e)) return;
  const t = activeTab();
  const wc = t && t.view && alive(t.view.webContents) ? t.view.webContents : null;
  switch (name) {
    case 'newTab': createTab(); break;
    case 'closeTab': closeTab(args[0]); break;
    case 'activateTab': activateTab(args[0]); break;
    case 'moveTab': moveTab(args[0], args[1]); break;
    case 'tabMenu': showTabMenu(args[0]); break;
    case 'toggleMute': toggleMute(args[0]); break;
    case 'navigate': navigate(args[0]); break;
    case 'back': if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
    case 'forward': if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
    case 'reload': if (wc) wc.reload(); else if (t) activateTab(t.id); break;
    case 'stop': if (wc) wc.stop(); break;
    case 'home': navigate(HOME); break;
    case 'zoomReset': setZoom(0); break;
    case 'focusPage': if (wc) wc.focus(); break;
    case 'togglePanel': togglePanel(args[0]); break;
    case 'gamingMode': setGamingMode(!gamingMode); break;
    case 'setSetting': setSetting(args[0], args[1]); break;
    case 'menu': showMainMenu(); break;
    case 'clearData': clearBrowsingData(); break;
    case 'restart': app.relaunch(); app.quit(); break;
    case 'openDownload': {
      const d = findDownload(String(args[0]));
      if (d) shell.showItemInFolder(d.path);
      break;
    }
    case 'openInternal': if (['bookmarks', 'history', 'downloads', 'extensions', 'welcome'].includes(args[0])) openInternal(args[0]); break;
    case 'chooseBg': chooseBackground(); break;
    case 'screenshot': screenshot(!!args[0]); break;
    case 'reader': readerMode(); break;
    case 'showFile': if (typeof args[0] === 'string' && fs.existsSync(args[0])) shell.showItemInFolder(args[0]); break;
    case 'backup': backupData(); break;
    case 'restore': restoreData(); break;
    case 'privateTab': createTab(HOME, { private: true }); break;
    case 'bmToggle': toggleBookmark(); break;
    case 'bmOpen': openBookmark(String(args[0]), args[1]); break;
    case 'bmMenu': showBookmarkMenu(String(args[0])); break;
    case 'bmOverflow': showBookmarkOverflow(args[0]); break;
    case 'find': findInPage(args[0], args[1] || {}); break;
    case 'findStop': stopFind(); break;
    case 'suggest': updateSuggest(args[0], args[1]); break;
    case 'suggestMove': moveSuggest(Number(args[0]) || 0); break;
    case 'suggestClose': hideSuggest(); break;
    case 'enter': acceptSuggest(args[0]); break;
    case 'updateCheck': checkUpdates(true); break;
    case 'updateInstall': installUpdate(); break;
    case 'shortcut': handleShortcut(args[0]); break;
    case 'split': toggleSplit(args[0]); break;
    case 'splitSwap': swapSplit(); break;
    case 'splitEnd': endSplit(); break;
    case 'splitRatio': setSplitRatio(args[0]); break;
    case 'splitDrag': setSplitDragging(!!args[0]); break;
    case 'pip': pipTab(t); break;
    case 'float': if (args[0] != null) floatTab(args[0]); else if (t) floatTab(t.id); break;
    case 'dock': dockTab(args[0]); break;
  }
});

// ------------------------------------------------------------------ Sitzung
function sessionTabs() {
  return tabs
    .filter(t => !t.url.startsWith('elektron://start') && !t.private)
    .map(t => ({ url: t.url, title: t.title, active: t.id === activeId }));
}

function saveSession() {
  settings.lastSession = settings.restoreSession ? sessionTabs() : null;
  saveSettingsNow();
}

// ------------------------------------------------------------------ Sitzungen (normal & privat)
const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write']);
const ASK = {
  media: 'Kamera/Mikrofon', notifications: 'Benachrichtigungen', geolocation: 'deinen Standort',
  'clipboard-read': 'die Zwischenablage', midi: 'MIDI-Geräte', midiSysex: 'MIDI-Geräte',
  'display-capture': 'deinen Bildschirm'
};

async function handlePermission(wc, permission, callback, details) {
  if (AUTO_ALLOW.has(permission)) return callback(true);
  if (!ASK[permission]) return callback(false);
  let host = '?', origin = '?';
  try { const u = new URL(details.requestingUrl); host = u.host; origin = u.origin; } catch {}
  const types = (details.mediaTypes || []).slice().sort().join('+');
  const key = `${origin}|${permission}${types ? '|' + types : ''}`;
  if (permission === 'media') {
    // Kamera/Mikrofon nach der Regel aus GX Control: blockieren, fragen oder erlauben
    const mt = details.mediaTypes || [];
    const rules = [];
    if (mt.includes('video')) rules.push(settings.camera);
    if (mt.includes('audio') || !mt.length) rules.push(settings.mic);
    if (rules.includes('block')) return callback(false);
    if (rules.every(r => r === 'allow')) return callback(true);
  }
  if (key in settings.permissions) return callback(settings.permissions[key]);
  let what = ASK[permission];
  if (permission === 'media') {
    what = types === 'audio' ? 'dein Mikrofon' : types === 'video' ? 'deine Kamera' : 'Kamera und Mikrofon';
  }
  const r = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Erlauben', 'Blockieren'], defaultId: 0, cancelId: 1,
    title: 'Berechtigung', message: `${host} möchte auf ${what} zugreifen.`,
    checkboxLabel: 'Entscheidung merken', checkboxChecked: true
  });
  const allow = r.response === 0;
  if (r.checkboxChecked) { settings.permissions[key] = allow; saveSettings(); }
  callback(allow);
}

function configureSession(ses) {
  ses.setUserAgent(app.userAgentFallback);
  const startDir = path.join(__dirname, 'start');
  ses.protocol.handle('elektron', (req) => {
    const u = new URL(req.url);
    if (u.hostname !== 'start') return new Response('Nicht gefunden', { status: 404 });
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/user-bg') {
      const f = userBgFile();
      return f ? net.fetch(pathToFileURL(f).toString()) : new Response('', { status: 404 });
    }
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(startDir, rel));
    if (!file.startsWith(startDir + path.sep)) return new Response('Verboten', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Schnittstelle für die eigenen Seiten (Lesezeichen, Verlauf, Downloads)
  ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'preload-internal.js') });
  try { ses.setSpellCheckerLanguages(['de-DE', 'en-US']); } catch {}
  ses.setPermissionRequestHandler(handlePermission);
  ses.on('will-download', onWillDownload);
  installRequestFilter(ses);
}

function setupSession() {
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
  mainSes = session.fromPartition(PARTITION);
  configureSession(mainSes);
}

function ensurePrivateSession() {
  if (privateSes) return;
  privateSes = session.fromPartition(PRIVATE_PARTITION);
  configureSession(privateSes);
  if (blocker && settings.adblock) enableAdblockOn(privateSes);
}

// ------------------------------------------------------------------ Downloads
let dlBroadcastTimer = null;

function onWillDownload(e, item) {
  const danger = settings.phishingProtect ? protect.check(item.getURL()) : null;
  if (danger && !allowDanger.has(hostOf(item.getURL()))) {
    item.cancel();
    countBlocked();
    toast(`Download blockiert: ${hostOf(item.getURL())} verteilt bekannte Schadsoftware`);
    return;
  }
  const dir = app.getPath('downloads');
  const name = item.getFilename() || 'download';
  const ext = path.extname(name);
  let target = path.join(dir, name);
  for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${path.basename(name, ext)} (${i})${ext}`);
  item.setSavePath(target);
  const id = 'd' + (downloadSeq++) + Date.now().toString(36);
  activeDownloads.set(id, item);
  const rec = store.addDownload({
    id, name: path.basename(target), path: target, url: item.getURL(), state: 'progressing',
    received: 0, total: item.getTotalBytes(), started: Date.now(), speed: 0
  });
  toast(`Download gestartet: ${rec.name}`, { action: 'Downloads', cmd: 'openInternal', arg: 'downloads' });
  let lastBytes = 0, lastT = Date.now(), speed = 0;
  item.on('updated', () => {
    const now = Date.now();
    const rcv = item.getReceivedBytes();
    const dt = (now - lastT) / 1000;
    if (dt >= 0.5) { speed = Math.max(0, (rcv - lastBytes) / dt); lastBytes = rcv; lastT = now; }
    store.updateDownload(id, { received: rcv, total: item.getTotalBytes(), speed });
    scheduleDownloadBroadcast();
  });
  item.once('done', (ev, state) => {
    activeDownloads.delete(id);
    const st = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'failed';
    store.updateDownload(id, {
      state: st, received: item.getReceivedBytes(),
      total: item.getTotalBytes() || item.getReceivedBytes(), speed: 0
    }, true);
    if (st === 'completed') {
      if (settings.scanDownloads && protect.defenderPath()) scanDownload(id, rec.name, item.getSavePath());
      else toast(`Download fertig: ${rec.name}`, { action: 'Im Ordner zeigen', cmd: 'openDownload', arg: id });
    } else if (st === 'failed') toast(`Download fehlgeschlagen: ${rec.name}`);
    broadcastDownloads();
  });
  broadcastDownloads();
}

async function scanDownload(id, name, file) {
  store.updateDownload(id, { scan: 'scanning' }, true);
  broadcastDownloads();
  const result = await protect.scanFile(file);
  if (result === 'threat') {
    store.updateDownload(id, { scan: 'threat', state: 'virus' }, true);
    toast(`Virus gefunden in ${name} – Windows Defender hat die Datei entfernt`);
  } else {
    store.updateDownload(id, { scan: result }, true);
    toast(result === 'clean' ? `${name} ist fertig – kein Virus gefunden` : `Download fertig: ${name}`,
      { action: 'Im Ordner zeigen', cmd: 'openDownload', arg: id });
  }
  broadcastDownloads();
}

function downloadSummary() {
  let rcv = 0, tot = 0, unknown = false;
  for (const item of activeDownloads.values()) {
    rcv += item.getReceivedBytes();
    const t = item.getTotalBytes();
    if (t) tot += t; else unknown = true;
  }
  return {
    active: activeDownloads.size,
    progress: activeDownloads.size && tot && !unknown ? rcv / tot : null,
    any: store.downloads().length > 0
  };
}

function internalPages(prefix) {
  return tabs.filter(t => t.view && alive(t.view.webContents) && t.view.webContents.getURL().startsWith(prefix))
    .map(t => t.view.webContents);
}

function scheduleDownloadBroadcast() {
  if (dlBroadcastTimer) return;
  dlBroadcastTimer = setTimeout(() => { dlBroadcastTimer = null; broadcastDownloads(); }, 400);
}

function broadcastDownloads() {
  pushState();
  const data = store.downloads();
  for (const wc of internalPages('elektron://start/downloads')) wc.send('internal:downloads-changed', data);
}

function findDownload(id) { return store.downloads().find(d => d.id === id); }

// ------------------------------------------------------------------ Lesezeichen
function bookmarksChanged() {
  pushState();
  for (const wc of internalPages('elektron://start/bookmarks')) wc.send('internal:bookmarks-changed');
}

function toggleBookmark() {
  const t = activeTab();
  if (!t || !/^(https?|file):/i.test(t.url)) return;
  const ex = store.findBookmark(t.url);
  if (ex) { store.removeBookmark(ex.id); toast('Lesezeichen entfernt'); }
  else {
    store.addBookmark(t.url, t.title);
    toast('Lesezeichen gespeichert', { action: 'Verwalten', cmd: 'openInternal', arg: 'bookmarks' });
  }
  bookmarksChanged();
}

function openBookmark(id, mode) {
  const b = store.bookmarks().find(x => x.id === id);
  if (!b) return;
  if (mode === 'tab') createTab(b.url, { activate: false });
  else if (mode === 'private') createTab(b.url, { private: true });
  else navigate(b.url);
}

function showBookmarkMenu(id) {
  const b = store.bookmarks().find(x => x.id === id);
  if (!b) return;
  Menu.buildFromTemplate([
    { label: 'Öffnen', click: () => openBookmark(id, 'same') },
    { label: 'In neuem Tab öffnen', click: () => openBookmark(id, 'tab') },
    { label: 'In privatem Tab öffnen', click: () => openBookmark(id, 'private') },
    { type: 'separator' },
    { label: 'Bearbeiten …', click: () => openInternal('bookmarks') },
    { label: 'Löschen', click: () => { store.removeBookmark(id); bookmarksChanged(); } },
    { type: 'separator' },
    { label: 'Lesezeichenleiste ausblenden', click: () => setSetting('showBookmarkBar', false) }
  ]).popup({ window: win });
}

function showBookmarkOverflow(ids) {
  const all = store.bookmarks();
  const items = (ids || []).map(id => all.find(b => b.id === id)).filter(Boolean);
  if (!items.length) return;
  Menu.buildFromTemplate([
    ...items.map(b => ({ label: (b.title || b.url).slice(0, 60), click: () => openBookmark(b.id, 'same') })),
    { type: 'separator' },
    { label: 'Alle Lesezeichen verwalten …', click: () => openInternal('bookmarks') }
  ]).popup({ window: win });
}

function importBookmarks(src) {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const candidates = {
    edge: [path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default', 'Bookmarks')],
    chrome: [path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks')],
    operagx: [
      path.join(roaming, 'Opera Software', 'Opera GX Stable', 'Default', 'Bookmarks'),
      path.join(roaming, 'Opera Software', 'Opera GX Stable', 'Bookmarks')
    ]
  }[src] || [];
  const file = candidates.find(f => { try { return fs.existsSync(f); } catch { return false; } });
  if (!file) return { error: 'keine Lesezeichen gefunden – ist der Browser auf diesem PC installiert?' };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = [];
    const walk = (n) => {
      if (!n) return;
      if (n.type === 'url' && n.url) list.push({ url: n.url, title: n.name });
      (n.children || []).forEach(walk);
    };
    Object.values(data.roots || {}).forEach(walk);
    const added = store.importBookmarks(list);
    bookmarksChanged();
    return { added };
  } catch {
    return { error: 'die Lesezeichen-Datei konnte nicht gelesen werden.' };
  }
}

// ------------------------------------------------------------------ Erweiterungen
function extensionsChanged() {
  pushState();
  for (const wc of internalPages('elektron://start/extensions')) wc.send('internal:extensions-changed');
}

// ------------------------------------------------------------------ Screenshot
async function screenshot(full) {
  const t = activeTab();
  if (!t || !t.view) return;
  const wc = t.view.webContents;
  let img;
  try {
    if (full) {
      ensureDebugger(wc);
      const m = await wc.debugger.sendCommand('Page.getLayoutMetrics');
      const size = m.cssContentSize || m.contentSize;
      const h = Math.min(Math.ceil(size.height), 16000);
      const r = await wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: Math.ceil(size.width), height: h, scale: 1 }
      });
      img = nativeImage.createFromBuffer(Buffer.from(r.data, 'base64'));
    } else {
      img = await wc.capturePage();
    }
  } catch (e) {
    toast('Screenshot hat nicht geklappt');
    return;
  }
  const dir = path.join(app.getPath('pictures'), 'Elektron GX');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
  const file = path.join(dir, `Screenshot ${stamp}.png`);
  fs.writeFileSync(file, img.toPNG());
  try { if (typeof clipboard.writeImage === 'function') clipboard.writeImage(img); else clipboard.write({ image: img }); } catch {}
  toast('Screenshot kopiert – mit Strg+V in Discord einfügen', { action: 'Im Ordner zeigen', cmd: 'showFile', arg: file });
}

// ------------------------------------------------------------------ KI (Claude / ChatGPT in der Seitenleiste)
function openAI(prompt) {
  const ai = settings.preferredAI === 'chatgpt' ? 'chatgpt' : 'claude';
  const url = ai === 'chatgpt'
    ? 'https://chatgpt.com/?q=' + encodeURIComponent(prompt)
    : 'https://claude.ai/new?q=' + encodeURIComponent(prompt);
  if (panel !== 'web:' + ai) togglePanel('web:' + ai);
  const v = panelViews.get(ai);
  if (v && alive(v.webContents)) v.webContents.loadURL(url);
}

async function aiAboutPage(tab, mode) {
  if (!tab || !tab.view) return;
  const wc = tab.view.webContents;
  let text = '';
  try {
    text = await wc.executeJavaScriptInIsolatedWorld(998, [{ code: `(() => {
      const el = document.querySelector('article, main, [role=main]') || document.body;
      return (el ? el.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 1800);
    })()` }]);
  } catch {}
  const head = mode === 'explain'
    ? 'Erkläre mir einfach und auf Deutsch, worum es auf dieser Webseite geht.'
    : 'Fasse diese Webseite kurz und auf Deutsch zusammen – die wichtigsten Punkte als Liste.';
  openAI(`${head}\nTitel: ${wc.getTitle()}\nAdresse: ${wc.getURL()}\n\nText (Auszug):\n${text}`);
}

// ------------------------------------------------------------------ Übersetzen
function translatePage(tab) {
  if (!tab || !/^https?:/i.test(tab.url)) return;
  navigate('https://translate.google.com/translate?sl=auto&tl=de&u=' + encodeURIComponent(tab.url));
}
function translateText(text) {
  createTab('https://translate.google.com/?sl=auto&tl=de&op=translate&text=' + encodeURIComponent(text.slice(0, 4000)));
}

// ------------------------------------------------------------------ Lesemodus
const readerArticles = new Map();
let readerSeq = 1;
let readabilitySrc = null;
async function readerMode() {
  const t = activeTab();
  if (!t || !t.view || !/^https?:/i.test(t.url)) return;
  const wc = t.view.webContents;
  try {
    if (!readabilitySrc) readabilitySrc = fs.readFileSync(require.resolve('@mozilla/readability/Readability.js'), 'utf8');
    const art = await wc.executeJavaScriptInIsolatedWorld(997, [{ code: readabilitySrc + `
      ;(() => { try { const r = new Readability(document.cloneNode(true)).parse();
        return r && r.content && r.length > 400 ? { title: r.title, byline: r.byline, site: r.siteName, content: r.content } : null;
      } catch (e) { return null; } })()` }]);
    if (!art) { toast('Für diese Seite gibt es keinen Lesemodus'); return; }
    const id = 'r' + (readerSeq++);
    readerArticles.set(id, { ...art, url: wc.getURL() });
    if (readerArticles.size > 30) readerArticles.delete(readerArticles.keys().next().value);
    wc.loadURL(`elektron://start/reader.html?id=${id}&u=${encodeURIComponent(wc.getURL())}`);
  } catch (e) {
    toast('Für diese Seite gibt es keinen Lesemodus');
  }
}

// ------------------------------------------------------------------ Sichern & Wiederherstellen
const BACKUP_KEYS = ['accent', 'accentNormal', 'style', 'background', 'preferredAI', 'ramLimit', 'cpuLimit', 'netLimit',
  'adblock', 'ytSkip', 'camera', 'mic', 'autoPip', 'showBookmarkBar', 'freezeOnMinimize', 'restoreSession',
  'httpsOnly', 'phishingProtect', 'scanDownloads', 'secureDns', 'blockThirdPartyCookies', 'fingerprintProtect'];
async function backupData() {
  const r = await dialog.showSaveDialog(win, {
    title: 'Lesezeichen und Einstellungen sichern',
    defaultPath: path.join(app.getPath('documents'), `Elektron-GX-Sicherung-${new Date().toISOString().slice(0, 10)}.json`),
    filters: [{ name: 'Elektron-GX-Sicherung', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return;
  const data = { app: 'Elektron GX', version: 1, created: new Date().toISOString(),
    bookmarks: store.bookmarks().map(b => ({ url: b.url, title: b.title })),
    settings: Object.fromEntries(BACKUP_KEYS.map(k => [k, settings[k]])) };
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2));
  toast('Sicherung gespeichert', { action: 'Im Ordner zeigen', cmd: 'showFile', arg: r.filePath });
}
async function restoreData() {
  const r = await dialog.showOpenDialog(win, {
    title: 'Sicherung wiederherstellen', properties: ['openFile'],
    filters: [{ name: 'Elektron-GX-Sicherung', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePaths[0]) return;
  try {
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (data.app !== 'Elektron GX') throw new Error('keine Elektron-GX-Sicherung');
    const added = store.importBookmarks(Array.isArray(data.bookmarks) ? data.bookmarks : []);
    for (const k of BACKUP_KEYS) if (data.settings && k in data.settings && typeof data.settings[k] === typeof DEFAULTS[k]) settings[k] = data.settings[k];
    saveSettings();
    bookmarksChanged();
    lookChanged();
    toast(`Wiederhergestellt: ${added} neue Lesezeichen und deine Einstellungen`);
  } catch (e) {
    toast('Diese Datei konnte nicht gelesen werden');
  }
}

// ------------------------------------------------------------------ Eigene Seiten
function openInternal(page) {
  const url = `elektron://start/${page}.html`;
  const ex = tabs.find(t => t.url.startsWith(url) && !t.private);
  if (ex) activateTab(ex.id);
  else createTab(url);
}

// Fingerprint-Schutz: Einstellungen für das Seiten-Skript (preload-internal.js)
const FP_SEED = Math.floor(Math.random() * 0x7fffffff);
ipcMain.on('fp-config', (e) => { e.returnValue = { on: !!settings.fingerprintProtect, seed: FP_SEED }; });

ipcMain.handle('internal', async (e, name, ...args) => {
  const from = e.senderFrame ? e.senderFrame.url : '';
  if (!from.startsWith('elektron://start/')) throw new Error('nicht erlaubt');
  switch (name) {
    case 'bookmarks.list': return store.bookmarks();
    case 'bookmarks.update': store.updateBookmark(String(args[0]), args[1] || {}); bookmarksChanged(); return true;
    case 'bookmarks.remove': store.removeBookmark(String(args[0])); bookmarksChanged(); return true;
    case 'bookmarks.move': store.moveBookmark(String(args[0]), Number(args[1])); bookmarksChanged(); return true;
    case 'bookmarks.import': return importBookmarks(String(args[0]));
    case 'history.search': return store.searchHistory(String(args[0] || ''), 600);
    case 'history.remove': store.removeVisit(String(args[0])); return true;
    case 'history.clear': store.clearHistory(Number(args[0]) || 0); return true;
    case 'downloads.list': return store.downloads();
    case 'downloads.open': {
      const d = findDownload(String(args[0]));
      if (!d) return false;
      if (!fs.existsSync(d.path)) { store.updateDownload(d.id, { state: 'missing' }, true); broadcastDownloads(); return false; }
      shell.openPath(d.path);
      return true;
    }
    case 'downloads.show': {
      const d = findDownload(String(args[0]));
      if (d) shell.showItemInFolder(d.path);
      return true;
    }
    case 'downloads.cancel': { const it = activeDownloads.get(String(args[0])); if (it) it.cancel(); return true; }
    case 'downloads.retry': { const d = findDownload(String(args[0])); if (d && /^https?:/i.test(d.url)) mainSes.downloadURL(d.url); return true; }
    case 'downloads.remove': store.removeDownload(String(args[0])); broadcastDownloads(); return true;
    case 'downloads.clear': store.clearDownloads(); broadcastDownloads(); return true;
    case 'downloads.folder': shell.openPath(app.getPath('downloads')); return true;
    case 'protect.allow': {
      const h = hostOf(String(args[0]));
      if (h) allowDanger.add(h);
      return true;
    }
    case 'protect.allowHttp': {
      const h = hostOf(String(args[0]));
      if (h) allowHttp.add(h);
      return true;
    }
    case 'look': return lookInfo();
    case 'steam.games': return extras.steamGames();
    case 'steam.play': {
      const id = String(args[0]);
      if (/^\d{1,10}$/.test(id)) shell.openExternal('steam://rungameid/' + id);
      return true;
    }
    case 'reader.get': return readerArticles.get(String(args[0])) || null;
    case 'look.chooseBg': chooseBackground(); return true;
    case 'ext.list': return extmod.list();
    case 'welcome.state': return Object.keys(extmod.RECOMMENDED).map(id => ({ id, installed: extmod.isInstalled(id) }));
    case 'welcome.install': return extmod.installRecommended(String(args[0]));
    case 'welcome.done': settings.welcomeDone = true; settings.welcomeVersion = 2; saveSettings(); return true;
    case 'welcome.store': extmod.openStore(String(args[0] || '')); return true;
    case 'ext.remove': return extmod.remove(String(args[0]));
    case 'ext.loadUnpacked': return extmod.loadUnpacked();
    case 'ext.update': await extmod.updateAll(); return true;
    case 'ext.store': extmod.openStore(args[0] ? String(args[0]) : ''); return true;
    case 'ext.options': if (/^chrome-extension:\/\//.test(String(args[0]))) createTab(String(args[0])); return true;
  }
  throw new Error('unbekannt: ' + name);
});

// ------------------------------------------------------------------ Suchen auf der Seite
function openFind() {
  if (!uiView) return;
  uiView.webContents.focus();
  uiView.webContents.send('find-open');
}

function findInPage(text, opts = {}) {
  const t = activeTab();
  if (!t || !t.view) return;
  const wc = t.view.webContents;
  if (!text) { wc.stopFindInPage('clearSelection'); uiView.webContents.send('find-result', { active: 0, matches: 0 }); return; }
  wc.findInPage(String(text), { forward: opts.forward !== false, findNext: !!opts.findNext, matchCase: false });
}

function stopFind() {
  const t = activeTab();
  if (t && t.view && alive(t.view.webContents)) t.view.webContents.stopFindInPage('keepSelection');
}

// ------------------------------------------------------------------ Vorschläge unter der Adressleiste
function ensureSuggestView() {
  if (suggestView) return;
  suggestView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload-suggest.js'), contextIsolation: true, sandbox: true }
  });
  suggestView.setBackgroundColor('#00000000');
  suggestView.webContents.loadFile(path.join(__dirname, 'ui', 'suggest.html'));
  suggestView.webContents.on('did-finish-load', () => { if (suggest.open) showSuggest(); });
  suggestView.setVisible(false);
  win.contentView.addChildView(suggestView);
}

function googleSearch(q) { return 'https://www.google.com/search?q=' + encodeURIComponent(q); }

function baseSuggestItems(q) {
  const target = toURL(q);
  const isSearch = target === googleSearch(q.trim());
  const first = isSearch ? { kind: 'search', title: q.trim(), url: target } : { kind: 'go', title: target, url: target };
  const local = store.suggest(q, 5).filter(x => x.url !== target).map(x => ({ kind: x.kind, title: x.title, url: x.url }));
  return [first, ...local];
}

async function updateSuggest(query, rect) {
  ensureSuggestView();
  const seq = ++suggest.seq;
  const q = String(query || '');
  suggest.query = q.trim();
  if (rect) suggest.rect = rect;
  if (!q.trim()) { hideSuggest(); return; }
  suggest.items = baseSuggestItems(q);
  suggest.selected = 0;
  showSuggest();
  const t = activeTab();
  if (t && t.private) return; // private Tabs: keine Eingaben an Google schicken
  try {
    const res = await mainSes.fetch('https://suggestqueries.google.com/complete/search?client=firefox&hl=de&q=' + encodeURIComponent(q.trim()));
    const data = await res.json();
    if (seq !== suggest.seq || !suggest.open) return;
    const lower = q.trim().toLowerCase();
    const extra = (Array.isArray(data[1]) ? data[1] : [])
      .filter(x => typeof x === 'string' && x.toLowerCase() !== lower)
      .slice(0, 4)
      .map(x => ({ kind: 'suggestion', title: x, url: googleSearch(x) }));
    suggest.items = [...baseSuggestItems(q), ...extra].slice(0, 9);
    showSuggest();
  } catch { /* offline – nur lokale Vorschläge */ }
}

function showSuggest() {
  if (!suggestView || !suggest.rect || !suggest.items.length) { hideSuggest(); return; }
  const r = suggest.rect;
  const h = suggest.items.length * 34 + 10;
  suggestView.setBounds({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: h });
  if (!suggest.open) { win.contentView.addChildView(suggestView); suggest.open = true; }
  suggestView.setVisible(true);
  suggestView.webContents.send('items', {
    items: suggest.items, selected: suggest.selected, query: suggest.query, accent: accentNow()
  });
}

function hideSuggest() {
  suggest.open = false;
  suggest.items = [];
  suggest.selected = 0;
  suggest.seq++;
  if (suggestView) suggestView.setVisible(false);
}

function moveSuggest(d) {
  if (!suggest.open || !suggest.items.length) return;
  const n = suggest.items.length;
  suggest.selected = (suggest.selected + d + n) % n;
  showSuggest();
  const it = suggest.items[suggest.selected];
  uiView.webContents.send('suggest-selected', { text: it.kind === 'search' || it.kind === 'suggestion' ? it.title : it.url });
}

function acceptSuggest(text) {
  const it = suggest.open ? suggest.items[suggest.selected] : null;
  hideSuggest();
  navigate(it ? it.url : text);
}

ipcMain.on('suggest:pick', (e, i) => {
  if (!suggestView || e.sender !== suggestView.webContents) return;
  const it = suggest.items[i];
  hideSuggest();
  uiView.webContents.send('suggest-closed');
  if (it) navigate(it.url);
});
ipcMain.on('suggest:hover', (e, i) => {
  if (!suggestView || e.sender !== suggestView.webContents || !suggest.items[i]) return;
  suggest.selected = i;
  showSuggest();
});

// ------------------------------------------------------------------ Automatische Updates
let autoUpdater = null;

function fileUpdateUrl() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'update.json'), 'utf8'));
    return cfg.url && !cfg.url.includes(UPDATE_PLACEHOLDER) ? cfg.url : '';
  } catch { return ''; }
}

function effectiveUpdateUrl() {
  let u = (settings.updateUrl || fileUpdateUrl() || '').trim();
  if (u && !u.endsWith('/')) u += '/';
  return u;
}

function setUpdate(patch) {
  update = { ...update, ...patch };
  pushState();
}

function setupUpdater() {
  if (process.windowsStore) { setUpdate({ state: 'store' }); return; } // Updates kommen über den Microsoft Store
  if (!app.isPackaged || process.platform !== 'win32') { setUpdate({ state: 'dev' }); return; }
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) { setUpdate({ state: 'error', message: 'Update-Modul fehlt' }); return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdate({ state: 'checking', message: '' }));
  autoUpdater.on('update-not-available', () => setUpdate({ state: 'current', checked: Date.now() }));
  autoUpdater.on('update-available', (info) => {
    setUpdate({ state: 'downloading', version: info.version, percent: 0 });
    toast(`Update ${info.version} wird im Hintergrund geladen …`);
  });
  autoUpdater.on('download-progress', (p) => setUpdate({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    setUpdate({ state: 'ready', version: info.version, percent: 100 });
    toast(`Update ${info.version} ist bereit`, { action: 'Jetzt neu starten', cmd: 'updateInstall' });
  });
  autoUpdater.on('error', (err) => setUpdate({ state: 'error', message: String(err && err.message || err).split('\n')[0].slice(0, 160) }));
  setTimeout(() => { if (settings.autoUpdate) checkUpdates(false); }, 15000);
  setInterval(() => { if (settings.autoUpdate) checkUpdates(false); }, 4 * 3600 * 1000);
}

function checkUpdates(manual) {
  const url = effectiveUpdateUrl();
  if (!url) {
    setUpdate({ state: 'nourl' });
    if (manual) toast('Noch keine Update-Adresse eingetragen (GX Control → Updates)');
    return;
  }
  if (!autoUpdater) {
    if (manual) toast('Updates funktionieren in der installierten Version');
    return;
  }
  if (update.state === 'downloading' || update.state === 'ready') return;
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url });
    autoUpdater.checkForUpdates().catch((e) => setUpdate({ state: 'error', message: String(e.message || e).split('\n')[0] }));
  } catch (e) { setUpdate({ state: 'error', message: e.message }); }
}

function installUpdate() {
  if (autoUpdater && update.state === 'ready') {
    saveSession();
    store.flushAll();
    autoUpdater.quitAndInstall(false, true);
  }
}

// ------------------------------------------------------------------ Start-Argumente (Links, HTML-/PDF-Dateien)
function parseLaunchArg(argv) {
  for (const a of argv.slice(1)) {
    if (/^https?:\/\//i.test(a)) return a;
    if (/\.(html?|xhtml|pdf|svg)$/i.test(a)) {
      try { if (fs.existsSync(a)) return pathToFileURL(path.resolve(a)).toString(); } catch {}
    }
  }
  return null;
}

// ------------------------------------------------------------------ Start

function createWindow() {
  win = new BaseWindow({
    width: 1400, height: 900, minWidth: 820, minHeight: 520,
    title: APP_NAME, icon: ICON, backgroundColor: '#0b0b0f', show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0b0f', symbolColor: '#d6d6e0', height: TAB_H }
  });

  uiView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-ui.js'),
      // eigene, lokale Oberfläche: ohne Sandbox, damit die Erweiterungs-Leiste geladen werden kann
      contextIsolation: true, sandbox: false, nodeIntegration: false
    }
  });
  uiView.setBackgroundColor('#0b0b0f');
  win.contentView.addChildView(uiView);
  uiView.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  if (process.env.ELEKTRON_DEBUG) uiView.webContents.on('console-message', (e) => console.log('[ui]', e.level, e.message, e.lineNumber));
  uiView.webContents.on('before-input-event', (e, input) => { if (handleShortcut(input)) e.preventDefault(); });
  uiView.webContents.on('will-navigate', (e) => e.preventDefault());
  uiView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  uiView.webContents.once('dom-ready', () => {
    perf('ui-shown');
    win.show();
    ensureSuggestView();
    pushState();
  });

  win.on('resize', () => { hideSuggest(); layout(); });
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', () => { htmlFullscreen = false; userFullscreen = false; layout(); pushState(); });
  win.on('minimize', () => {
    const a = activeTab();
    if (settings.autoPip && a && a.audible && !a.floating) pipTab(a, { silent: true, onlyEnter: true });
    if (!settings.freezeOnMinimize) return;
    for (const t of tabs) if (t.view && !t.audible && !t.frozen && !t.floating) setFrozen(t, true, 'minimize');
  });
  win.on('restore', () => {
    for (const t of tabs) if (t.frozen && t.freezeReason === 'minimize') setFrozen(t, false);
  });
  win.on('focus', () => {
    const t = activeTab();
    if (t && t.frozen) setFrozen(t, false);
  });
  win.on('close', saveSession);
  win.on('closed', () => { win = null; });

  // Tabs öffnen: Kommandozeile > letzte Sitzung > Startseite
  const argUrl = parseLaunchArg(process.argv);
  const last = settings.restoreSession && Array.isArray(settings.lastSession) ? settings.lastSession : [];
  if (last.length) {
    let activeEntry = last.find(x => x.active) || last[last.length - 1];
    for (const entry of last) {
      if (entry === activeEntry) createTab(entry.url, { activate: false, title: entry.title });
      else createTab(entry.url, { activate: false, lazy: true, title: entry.title });
    }
    const idx = last.indexOf(activeEntry);
    if (!argUrl) activateTab(tabs[idx].id);
  }
  if (argUrl) createTab(argUrl);
  else if (!tabs.length) createTab(HOME);
  layout();
}

app.on('second-instance', (e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  createTab(parseLaunchArg(argv) || HOME);
});

app.whenReady().then(async () => {
  perf('ready');
  applyDns();
  Menu.setApplicationMenu(null);
  setupSession();
  // Fenster sofort zeigen – Erweiterungen laden parallel im Hintergrund (schnellerer Start)
  createWindow();
  markWindowReady();
  const extReady = (async () => { try {
    await extmod.init({
      session: mainSes,
      win: () => win,
      createTab: async (url, active) => { await windowReady; return createTab(url || HOME, { activate: active }); },
      activateByWc: (wc) => { const t = tabs.find(x => x.view && x.view.webContents === wc); if (t) activateTab(t.id); },
      closeByWc: (wc) => { const t = tabs.find(x => x.view && x.view.webContents === wc); if (t) closeTab(t.id); },
      tabInfo: (wc) => tabs.find(x => x.view && x.view.webContents === wc) || null,
      toast: (text) => toast(text),
      changed: () => extensionsChanged()
    });
  } catch (e) { console.warn('Erweiterungen:', e.message); }
    // Tabs, die schon vor den Erweiterungen offen waren, nachträglich anmelden
    for (const t of tabs) if (t.view && !t.private && alive(t.view.webContents)) extmod.addTab(t.view.webContents);
    const at = activeTab();
    if (at && at.view && !at.private) extmod.selectTab(at.view.webContents);
    perf('extensions-ready');
  })();
  await Promise.race([extReady, new Promise(r => setTimeout(r, 1500))]);
  // Starttest für die automatische Veröffentlichung: läuft der Browser wirklich?
  if (process.env.ELEKTRON_SMOKE) {
    setTimeout(async () => {
      const t = activeTab();
      // Wurde die Oberfläche wirklich gezeichnet? (Tabs vorhanden und sichtbar)
      let uiOk = false;
      try { uiOk = await uiView.webContents.executeJavaScript("(() => { const e = document.querySelector('#tabs .tab'); return !!e && e.getBoundingClientRect().width > 20 && getComputedStyle(document.body).display !== 'none'; })()"); } catch {}
      const res = {
        ok: !!(uiOk && win && t && t.view), uiOk,
        tab: t && t.view ? t.view.webContents.getURL() : null,
        chrome: process.versions.chrome, app: app.getVersion(), packaged: app.isPackaged
      };
      try { fs.writeFileSync(process.env.ELEKTRON_SMOKE, JSON.stringify(res)); } catch {}
      app.exit(res.ok ? 0 : 3);
    }, 10000);
  }
  // Willkommensseite: beim ersten Start und einmal nach Updates mit neuen Empfehlungen (Version 2: Malwarebytes)
  if (!process.env.ELEKTRON_TEST && (!settings.welcomeDone || ((settings.welcomeVersion || 0) < 2 && !extmod.isInstalled('ihcjicgdanjaechkgeegckofjjedodee')))) {
    openInternal('welcome');
  }
  initAdblock();
  protect.start((url, opts) => net.fetch(url, opts));
  setupUpdater();
  setInterval(tick, 1000);
  if (process.env.ELEKTRON_TEST) {
    // Testhilfe: ein paar Tabs öffnen und GX Control zeigen
    setTimeout(() => {
      createTab('elektron://start/error.html?u=https%3A%2F%2Fexample.com&c=-106&d=ERR_INTERNET_DISCONNECTED', { activate: false });
      createTab(HOME, { activate: false });
      const t = createTab(HOME, { activate: false });
      t.title = 'GeForce NOW'; t.discarded = true; destroyView(t.view); t.view = null;
      if (process.env.ELEKTRON_TEST === 'gx') togglePanel('gx');
      if (process.env.ELEKTRON_TEST === 'gaming') { togglePanel('gx'); setGamingMode(true); }
      if (process.env.ELEKTRON_TEST === 'split') { startSplit(tabs[tabs.length - 2].id); setSplitRatio(0.55); }
      if (process.env.ELEKTRON_TEST === 'float') { startSplit(tabs[tabs.length - 2].id); const ft = createTab(HOME, { activate: false }); setTimeout(() => floatTab(ft.id), 800); }
      if (process.env.ELEKTRON_TEST === 'v2' || process.env.ELEKTRON_TEST === 'v2b') {
        for (const [u, t] of [['https://store.steampowered.com/', 'Steam'], ['https://www.twitch.tv/', 'Twitch'],
          ['https://www.youtube.com/', 'YouTube'], ['https://play.geforcenow.com/', 'GeForce NOW'],
          ['https://www.roblox.com/', 'Roblox'], ['https://www.reddit.com/r/gaming/', 'r/gaming']]) {
          store.addBookmark(u, t);
          store.addVisit(u, t);
        }
        store.addVisit('https://store.steampowered.com/app/1091500/Cyberpunk_2077/', 'Cyberpunk 2077 bei Steam');
        store.addVisit('https://www.speedtest.net/', 'Speedtest by Ookla');
        bookmarksChanged();
        createTab(HOME, { private: true, activate: false });
        if (process.env.ELEKTRON_TEST === 'v2') openInternal('bookmarks');
        else {
          openInternal('history');
          setTimeout(() => uiView.webContents.executeJavaScript(
            "const a=document.getElementById('address');a.focus();a.value='st';a.dispatchEvent(new Event('input'))"), 1500);
        }
      }
      if (process.env.ELEKTRON_TEST === 'v2c') {
        openInternal('bookmarks');
        togglePanel('gx');
        setTimeout(() => {
          openFind();
          uiView.webContents.executeJavaScript("const f=document.getElementById('find-input');f.value='Steam';f.dispatchEvent(new Event('input'));document.getElementById('updates-anchor').scrollIntoView()");
        }, 2000);
      }
      if (process.env.ELEKTRON_TEST === 'v2d') {
        store.addDownload({ id: 'x1', name: 'SteamSetup.exe', path: '/tmp/SteamSetup.exe', url: 'https://cdn.steamstatic.com/client/installer/SteamSetup.exe', state: 'completed', received: 2400000, total: 2400000, started: Date.now() - 3600e3, speed: 0 });
        store.addDownload({ id: 'x2', name: 'Elektron-GX-Setup-2.0.0.exe', path: '/tmp/x.exe', url: 'https://example.com/x.exe', state: 'progressing', received: 61e6, total: 112e6, started: Date.now(), speed: 8.4e6 });
        store.addDownload({ id: 'x3', name: 'mod-pack.zip', path: '/tmp/m.zip', url: 'https://example.com/m.zip', state: 'failed', received: 1e6, total: 9e6, started: Date.now() - 86400e3, speed: 0 });
        openInternal('downloads');
      }
      if (process.env.ELEKTRON_TEST === 'v2e') {
        const f = path.join(os.tmpdir(), 'elektron-test.bin');
        fs.writeFileSync(f, Buffer.alloc(3 * 1024 * 1024, 7));
        mainSes.downloadURL(pathToFileURL(f).toString());
        setTimeout(() => { console.log('DLTEST', JSON.stringify(store.downloads().slice(0, 1))); openInternal('downloads'); }, 2500);
      }
      if (process.env.ELEKTRON_TEST === 'ext') {
        mainSes.extensions.loadExtension(process.env.ELEKTRON_TESTEXT).then(async (e) => {
          console.log('EXT loaded', e.id, e.name);
          openInternal('extensions');
          setTimeout(async () => {
            const srv = require('http').createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end('<!doctype html><title>Testseite</title><body style="font:20px sans-serif;padding:40px">Testseite für Erweiterungen</body>'); }).listen(0, '127.0.0.1');
            await new Promise(r => srv.once('listening', r));
            const t = createTab('http://127.0.0.1:' + srv.address().port + '/', { activate: true });
            setTimeout(async () => {
              const v = await t.view.webContents.executeJavaScript("document.documentElement.getAttribute('data-test-ext')").catch(e => 'ERR ' + e.message);
              console.log('CONTENT-SCRIPT', v);
              const r = await uiView.webContents.executeJavaScript("(() => { const l = document.getElementById('ext-actions'); const b = l && l.shadowRoot && l.shadowRoot.querySelector('.action'); return JSON.stringify({ list: !!l, actions: l && l.shadowRoot ? l.shadowRoot.querySelectorAll('.action').length : -1 }); })()");
              console.log('ACTIONS', r);
              await uiView.webContents.executeJavaScript("document.getElementById('ext-actions').shadowRoot.querySelector('.action').click()");
              setTimeout(() => showContextMenu(t.view.webContents, { x: 300, y: 300, editFlags: {}, mediaType: 'none', selectionText: '', linkURL: '', isEditable: false, pageURL: t.url, frameURL: '' }, t), 2500);
            }, 2000);
          }, 1500);
        }).catch(e => console.log('EXT error', e.message));
      }
      if (process.env.ELEKTRON_TEST === 'extpage') {
        mainSes.extensions.loadExtension(process.env.ELEKTRON_TESTEXT).catch(() => {}).finally(() => openInternal('extensions'));
      }
      if (process.env.ELEKTRON_TEST === 'welcome' || process.env.ELEKTRON_TEST === 'welcome2') {
        openInternal('welcome');
        if (process.env.ELEKTRON_TEST === 'welcome2') setTimeout(() => {
          const t = activeTab();
          t.view.webContents.executeJavaScript("document.getElementById('go').click()");
        }, 1500);
      }
      if (process.env.ELEKTRON_TEST === 'phish') {
        protect.addTestHost('phishing', 'evil-login.example');
        navigate('https://evil-login.example/konto/login');
        setTimeout(() => console.log('PHISH-URL', activeTab().view.webContents.getURL()), 3000);
      }
      if (process.env.ELEKTRON_TEST === 'http' || process.env.ELEKTRON_TEST === 'http2') {
        require('http').createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end('<!doctype html><title>Alte Seite</title><body style="font:22px sans-serif;padding:40px">Unverschlüsselte Testseite</body>'); }).listen(8765, '127.0.0.1');
        navigate('http://insecure.test:8765/');
        setTimeout(async () => {
          const wc = activeTab().view.webContents;
          console.log('HTTP-STEP1', wc.getURL());
          if (process.env.ELEKTRON_TEST === 'http2') {
            await wc.executeJavaScript("document.getElementById('proceed').click()");
            setTimeout(() => console.log('HTTP-STEP2', wc.getURL(), activeTab().title), 2500);
          }
        }, 7000);
      }
      if (process.env.ELEKTRON_TEST === 'adtest') {
        let hits = [];
        require('http').createServer((q, r) => { hits.push(q.headers.host + q.url); r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>Ad-Test</title><script src="http://ads.doubleclick.net:8766/tag/js/gpt.js"></script><img src="http://tracker-friendly.example:8766/ok.png">'); }).listen(8766, '127.0.0.1');
        setTimeout(() => navigate('http://127.0.0.1:8766/'), 6000);
        setTimeout(() => console.log('ADTEST adblock=' + !!blocker, JSON.stringify(hits)), 10000);
      }
      if (process.env.ELEKTRON_TEST === 'look') {
        settings.style = 'gaming'; settings.background = 'berge'; lookChanged();
        togglePanel('gx');
        setTimeout(() => uiView.webContents.executeJavaScript("document.getElementById('hwcards').scrollIntoView(); "), 3000);
      }
      if (process.env.ELEKTRON_TEST === 'look2') {
        settings.style = 'gaming'; settings.background = 'aurora'; lookChanged();
        togglePanel('gx');
        setTimeout(() => uiView.webContents.executeJavaScript("document.querySelector('[data-setting=style]').scrollIntoView()"), 1500);
      }
      if (process.env.ELEKTRON_TEST === 'startbg') {
        settings.style = 'gaming'; settings.background = process.env.BG || 'berge'; lookChanged();
        createTab();
      }
      if (process.env.ELEKTRON_TEST === 'shot') {
        createTab(); setTimeout(() => screenshot(true).then(() => console.log('SHOT OK')).catch(e => console.log('SHOT ERR', e)), 4000);
      }
      if (process.env.ELEKTRON_TEST === 'privacy2') {
        const http = require('http');
        http.createServer((q, r) => {
          console.log('3P-REQ', q.url, 'cookie=' + (q.headers.cookie || '-'));
          if (q.url.startsWith('/set')) { r.setHeader('set-cookie', 'tracker=123; SameSite=None; Secure; Path=/'); r.setHeader('content-type', 'image/gif'); return r.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64')); }
          r.setHeader('content-type', 'text/html'); r.end('<body style="color:#fff;background:#222;font:16px sans-serif">Cookie bei Drittanbieter: <b>' + (q.headers.cookie || 'keins') + '</b></body>');
        }).listen(8771, '127.0.0.1');
        http.createServer((q, r) => {
          r.setHeader('content-type', 'text/html; charset=utf-8');
          r.end(`<!doctype html><body style="font:16px sans-serif;background:#111;color:#eee;padding:20px"><h2>Sicherheits-Test</h2>
<img src="http://localhost:8771/set" width=1 height=1>
<div id=o></div><iframe id=f style="width:600px;height:60px;border:1px solid #555"></iframe>
<script>
function hash(s){let h=0;for(let i=0;i<s.length;i++)h=Math.imul(31,h)+s.charCodeAt(i)|0;return (h>>>0).toString(16)}
function canvasFp(){const c=document.createElement('canvas');c.width=200;c.height=50;const x=c.getContext('2d');x.textBaseline='top';x.font='16px Arial';x.fillStyle='#f60';x.fillRect(10,10,100,30);x.fillStyle='#069';x.fillText('Elektron GX 😀',2,15);return hash(c.toDataURL())}
const gl=document.createElement('canvas').getContext('webgl');const ext=gl&&gl.getExtension('WEBGL_debug_renderer_info');
const rows=[['CPU-Kerne',navigator.hardwareConcurrency],['RAM (GB)',navigator.deviceMemory],['Grafikkarte',ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'-'],['Canvas 1',canvasFp()],['Canvas 2',canvasFp()],['toString',HTMLCanvasElement.prototype.toDataURL.toString()]];
document.getElementById('o').innerHTML=rows.map(r=>'<p>'+r[0]+': <b>'+r[1]+'</b></p>').join('');
console.log('FP', JSON.stringify(rows));
setTimeout(()=>{document.getElementById('f').src='http://localhost:8771/check'},1500);
</script>`);
        }).listen(8770, '127.0.0.1');
        settings.blockThirdPartyCookies = process.env.TPC !== '0';
        settings.fingerprintProtect = process.env.FP !== '0';
        createTab('http://127.0.0.1:8770/');
      }
      if (process.env.ELEKTRON_TEST === 'sec') {
        togglePanel('gx');
        setTimeout(() => uiView.webContents.executeJavaScript("document.querySelector('.seccheck').scrollIntoView()"), 2500);
      }
      if (process.env.ELEKTRON_TEST === 'normal') {
        settings.style = 'gaming'; setStyle('normal'); createTab();
      }
      if (process.env.ELEKTRON_TEST === 'reader') {
        const para = 'Elektron GX ist ein kostenloser Browser für Gamer. Er friert Hintergrund-Tabs ein, blockiert Werbung und schützt vor Betrugsseiten. ';
        require('http').createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(`<!doctype html><title>Testartikel</title><body><nav>Menü · Start · Kontakt · Werbung</nav><div class="ad">WERBUNG!!!</div><article><h1>So spielt man schneller</h1><p class="byline">Von Max Muster</p>${'<p>' + para.repeat(4) + '</p>'.repeat(1)}<h2>Zweiter Abschnitt</h2><p>${para.repeat(5)}</p><p>${para.repeat(3)}</p></article><aside>Seitenleiste mit Links</aside></body>`); }).listen(8767, '127.0.0.1');
        navigate('http://127.0.0.1:8767/artikel');
        setTimeout(() => readerMode(), 3000);
      }
      if (process.env.ELEKTRON_TEST === 'privacy') {
        togglePanel('gx');
        setTimeout(() => uiView.webContents.executeJavaScript("document.querySelector('.panel-body').scrollTop = 980"), 600);
      }
    }, 1500);
  }
  setInterval(() => { if (win) { settings.lastSession = settings.restoreSession ? sessionTabs() : null; saveSettings(); } }, 30000);
});

app.on('web-contents-created', (e, wc) => {
  // Popup-Fenster: Shortcuts ebenfalls abfangen, keine weiteren Popups als Fenster
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
});

app.on('before-quit', (e) => {
  if (gamingMode) restorePriority();
  store.flushAll();
  if (settings.clearOnExit && !quitting && mainSes) {
    e.preventDefault();
    quitting = true;
    settings.lastSession = null;
    saveSettingsNow();
    Promise.all([mainSes.clearStorageData(), mainSes.clearCache()]).finally(() => app.quit());
    return;
  }
  saveSettingsNow();
});

app.on('window-all-closed', () => app.quit());
