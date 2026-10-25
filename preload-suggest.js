'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('suggestApi', {
  onItems: (fn) => ipcRenderer.on('items', (_e, data) => fn(data)),
  pick: (index) => ipcRenderer.send('suggest:pick', index),
  hover: (index) => ipcRenderer.send('suggest:hover', index)
});
