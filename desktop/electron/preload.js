'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mockfastDesktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  retry: () => ipcRenderer.send('mockfast:retry'),
  openLog: () => ipcRenderer.send('mockfast:open-log'),
  quit: () => ipcRenderer.send('mockfast:quit'),
});
