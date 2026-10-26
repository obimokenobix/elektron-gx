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
