'use strict';
/*
 * Läuft in jedem Frame, gibt die Browser-Schnittstelle aber nur für
 * die eigenen Seiten (elektron://…) frei – fremde Webseiten sehen nichts.
 */
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'elektron:') {
  contextBridge.exposeInMainWorld('elektron', {
    invoke: (name, ...args) => ipcRenderer.invoke('internal', name, ...args),
    on: (channel, fn) => {
      if (!['downloads-changed', 'bookmarks-changed', 'history-changed', 'extensions-changed', 'look-changed'].includes(channel)) return;
      ipcRenderer.on('internal:' + channel, (_e, data) => fn(data));
    }
  });
}

/*
 * Schutz vor Fingerprinting – auf normalen Webseiten.
 * Webseiten können dich ohne Cookies wiedererkennen, indem sie z. B. ein unsichtbares
 * Bild zeichnen (Canvas) oder den Namen deiner Grafikkarte abfragen. Elektron GX
 * verändert das Canvas-Ergebnis minimal (pro Seite und Browser-Start anders, für das
 * Auge unsichtbar), meldet einen allgemeinen Grafikkarten-Namen und Standardwerte für
 * CPU-Kerne und Arbeitsspeicher.
 */
function fpShield(seed) {
  'use strict';
  const host = location.hostname;
  let h = seed >>> 0;
  for (let i = 0; i < host.length; i++) h = Math.imul(h ^ host.charCodeAt(i), 2654435761) >>> 0;
  const rand = (n) => {
    let x = (h ^ Math.imul(n + 1, 0x9E3779B1)) >>> 0;
    x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0; x ^= x >>> 16;
    return x >>> 0;
  };

  // Ersetzte Funktionen sollen wie eingebaute aussehen
  const originals = new WeakMap();
  const fnToString = Function.prototype.toString;
  const wrapFn = (orig, apply) => { const p = new Proxy(orig, { apply }); originals.set(p, orig); return p; };
  const tsProxy = wrapFn(fnToString, (target, self, args) => Reflect.apply(target, originals.get(self) || self, args));
  try { Object.defineProperty(Function.prototype, 'toString', { value: tsProxy, writable: true, configurable: true, enumerable: false }); } catch {}

  const patchMethod = (proto, name, makeApply) => {
    if (!proto) return;
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== 'function') return;
    try { Object.defineProperty(proto, name, { ...d, value: wrapFn(d.value, makeApply(d.value)) }); } catch {}
  };
  const patchGetter = (proto, name, value) => {
    if (!proto) return;
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.get !== 'function') return;
    try { Object.defineProperty(proto, name, { ...d, get: wrapFn(d.get, () => value) }); } catch {}
  };

  // --- Canvas: welche Kontexte gibt es?
  const ctxType = new WeakMap();
  patchMethod(window.HTMLCanvasElement && HTMLCanvasElement.prototype, 'getContext', (orig) => (target, self, args) => {
    const ctx = Reflect.apply(target, self, args);
    if (ctx && !ctxType.has(self)) ctxType.set(self, String(args[0]));
    return ctx;
  });

  const noisify = (data) => {
    const len = data.length >> 2;
    if (!len) return;
    for (let k = 0; k < 12; k++) {
      const r = rand(k);
      let px = r % len;
      for (let step = 0; step < 64; step++, px = (px + 1) % len) {
        if (data[px * 4 + 3] !== 0) { const i = px * 4 + ((r >>> 9) % 3); data[i] = data[i] ^ 1; break; }
      }
    }
  };

  const C2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  const origGetImageData = C2D && C2D.getImageData;
  const origGetContext = window.HTMLCanvasElement && HTMLCanvasElement.prototype.getContext;
  if (C2D && origGetImageData) {
    patchMethod(C2D, 'getImageData', () => (target, self, args) => {
      const img = Reflect.apply(target, self, args);
      try { noisify(img.data); } catch {}
      return img;
    });
    // Kopie mit leichtem Rauschen erzeugen – die echte Zeichenfläche der Seite bleibt unverändert
    const noisyCopy = (canvas) => {
      if (ctxType.get(canvas) !== '2d') return null;
      const w = canvas.width, hh = canvas.height;
      if (!w || !hh || w * hh > 4000000) return null;
      try {
        const src = Reflect.apply(origGetContext, canvas, ['2d']);
        const img = Reflect.apply(origGetImageData, src, [0, 0, w, hh]);
        noisify(img.data);
        const copy = document.createElement('canvas');
        copy.width = w; copy.height = hh;
        Reflect.apply(origGetContext, copy, ['2d']).putImageData(img, 0, 0);
        return copy;
      } catch { return null; }
    };
    for (const name of ['toDataURL', 'toBlob']) {
      patchMethod(HTMLCanvasElement.prototype, name, () => (target, self, args) => {
        const copy = noisyCopy(self);
        return Reflect.apply(target, copy || self, args);
      });
    }
  }

  // --- WebGL: allgemeiner Grafikkarten-Name
  const glParam = () => (target, self, args) => {
    if (args[0] === 0x9245) return 'Google Inc.';
    if (args[0] === 0x9246) return 'ANGLE (Generic GPU)';
    return Reflect.apply(target, self, args);
  };
  patchMethod(window.WebGLRenderingContext && WebGLRenderingContext.prototype, 'getParameter', glParam);
  patchMethod(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, 'getParameter', glParam);

  // --- Audio: winziges, unhörbares Rauschen bei der Analyse (gegen Audio-Fingerprinting)
  const AB = window.AudioBuffer && AudioBuffer.prototype;
  const touched = new WeakSet();
  patchMethod(AB, 'getChannelData', () => (target, self, args) => {
    const data = Reflect.apply(target, self, args);
    if (!touched.has(data) && self.length < 200000) { // nur kurze Puffer, wie sie Fingerprinter nutzen
      touched.add(data);
      for (let k = 0; k < 24; k++) { const i = rand(100 + k) % data.length; data[i] += ((rand(200 + k) & 1) ? 1 : -1) * 1e-7; }
    }
    return data;
  });
  const AN = window.AnalyserNode && AnalyserNode.prototype;
  patchMethod(AN, 'getFloatFrequencyData', () => (target, self, args) => {
    const r = Reflect.apply(target, self, args);
    const arr = args[0];
    if (arr && arr.length) for (let k = 0; k < 8; k++) { const i = rand(300 + k) % arr.length; arr[i] += ((rand(400 + k) & 1) ? 1 : -1) * 1e-4; }
    return r;
  });

  // --- Detaillierte Browser-/Geräte-Angaben (User-Agent Client Hints) kürzen
  const UAD = window.NavigatorUAData && NavigatorUAData.prototype;
  patchMethod(UAD, 'getHighEntropyValues', () => (target, self, args) => {
    return Reflect.apply(target, self, args).then((v) => {
      const out = { ...v };
      const major = (b) => ({ brand: b.brand, version: String(b.version).split('.')[0] + '.0.0.0' });
      if ('platformVersion' in out) out.platformVersion = '10.0.0';
      if ('architecture' in out) out.architecture = 'x86';
      if ('bitness' in out) out.bitness = '64';
      if ('model' in out) out.model = '';
      if ('wow64' in out) out.wow64 = false;
      if ('uaFullVersion' in out) out.uaFullVersion = String(out.uaFullVersion).split('.')[0] + '.0.0.0';
      if (Array.isArray(out.fullVersionList)) out.fullVersionList = out.fullVersionList.map(major);
      if ('formFactors' in out) out.formFactors = ['Desktop'];
      return out;
    });
  });

  // --- Hardware-Werte vereinheitlichen
  const NP = window.Navigator && Navigator.prototype;
  patchGetter(NP, 'hardwareConcurrency', 8);
  patchGetter(NP, 'deviceMemory', 8);
}

if (location.protocol === 'https:' || location.protocol === 'http:') {
  let cfg = null;
  try { cfg = ipcRenderer.sendSync('fp-config'); } catch {}
  if (cfg && cfg.on && typeof contextBridge.executeInMainWorld === 'function') {
    try { contextBridge.executeInMainWorld({ func: fpShield, args: [cfg.seed] }); } catch (e) { console.warn('fp', e && e.message); }
  }
  // Global Privacy Control: Webseiten sehen „nicht verkaufen / weitergeben“
  if (cfg && cfg.gpc && typeof contextBridge.executeInMainWorld === 'function') {
    try {
      contextBridge.executeInMainWorld({ func: () => {
        try { Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true, enumerable: true }); } catch {}
      } });
    } catch {}
  }
  // AMP-Seiten: zur Originalseite wechseln (nur im Hauptfenster der Seite)
  if (cfg && cfg.deamp && window.top === window) {
    document.addEventListener('DOMContentLoaded', () => {
      const html = document.documentElement;
      if (!html || !(html.hasAttribute('amp') || html.hasAttribute('\u26A1'))) return;
      const link = document.querySelector('link[rel="canonical"]');
      const href = link && link.href;
      if (href && /^https?:/.test(href) && href !== location.href) ipcRenderer.send('deamp', href);
    });
  }
}
