'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set(['state', 'stats', 'toast', 'focus-address', 'find-open', 'find-close', 'find-next', 'find-result', 'suggest-selected', 'suggest-closed']);

contextBridge.exposeInMainWorld('gx', {
  cmd: (name, ...args) => ipcRenderer.send('ui:cmd', name, ...args),
  on: (channel, fn) => {
    if (!CHANNELS.has(channel)) return;
    ipcRenderer.on(channel, (_e, ...args) => fn(...args));
  },
  platform: process.platform
});

// Leiste mit den Symbolen der installierten Erweiterungen (<browser-action-list>)
try {
  require('electron-chrome-extensions/browser-action').injectBrowserAction();
} catch (e) {
  console.warn('Erweiterungs-Leiste nicht verfügbar:', e.message);
}
