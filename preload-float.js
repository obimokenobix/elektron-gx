'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floatApi', {
  cmd: (name, arg) => ipcRenderer.send('float:cmd', name, arg),
  onInfo: (fn) => ipcRenderer.on('info', (_e, info) => fn(info))
});
