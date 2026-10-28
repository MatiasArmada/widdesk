'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Subscribes to a main-process channel; returns an unsubscribe function. */
function subscribe(channel, cb) {
  if (typeof cb !== 'function') return () => {};
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('widget', {
  onMediaState: (cb) => subscribe('media:state', cb),
  onMediaArt: (cb) => subscribe('media:art', cb),
  onMediaError: (cb) => subscribe('media:error', cb),
  onPinChanged: (cb) => subscribe('window:pinned', cb),
  sendCommand: (name, arg) => {
    ipcRenderer.send('media:command', { name: String(name), arg: typeof arg === 'number' ? arg : undefined });
  },
  close: () => ipcRenderer.send('window:close'),
  minimize: () => ipcRenderer.send('window:minimize'),
  togglePin: () => ipcRenderer.invoke('window:togglePin'),
  getPinned: () => ipcRenderer.invoke('window:getPinned'),
  listSkins: () => ipcRenderer.invoke('skins:list'),
  getSkin: () => ipcRenderer.invoke('skins:get'),
  setSkin: (key) => ipcRenderer.invoke('skins:set', String(key)),
  reloadSkins: () => ipcRenderer.invoke('skins:reload'),
  openSkinsFolder: () => ipcRenderer.send('skins:openFolder'),
});
