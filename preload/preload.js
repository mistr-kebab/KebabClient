'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const sub = (_event, payload) => {
    try { callback(payload); } catch { /* noop */ }
  };
  ipcRenderer.on(channel, sub);
  return () => ipcRenderer.removeListener(channel, sub);
}

contextBridge.exposeInMainWorld('mc', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onMaxState: (cb) => on('window:maxState', cb),
  getBanners: () => ipcRenderer.invoke('assets:banners'),
  login: () => ipcRenderer.invoke('auth:login'),
  refresh: () => ipcRenderer.invoke('auth:refresh'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getProfile: () => ipcRenderer.invoke('auth:profile'),
  onAuthChanged: (cb) => on('auth:changed', cb),
  getClientId: () => ipcRenderer.invoke('settings:getClientId'),
  saveClientId: (clientId, mode) => ipcRenderer.invoke('settings:setClientId', { clientId, mode }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  setDataDir: (dir) => ipcRenderer.invoke('settings:setDataDir', { dir }),
  moveDataDir: (dir) => ipcRenderer.invoke('settings:moveDataDir', { dir }),
  openDataFolder: () => ipcRenderer.invoke('settings:openDataFolder'),
  browseJava: () => ipcRenderer.invoke('settings:browseJava'),

  ensureClient: (instanceId) => ipcRenderer.invoke('game:ensure', { instanceId }),
  launch: (instanceId) => ipcRenderer.invoke('game:launch', { instanceId }),
  stopGame: () => ipcRenderer.invoke('game:stop'),
  gameStatus: () => ipcRenderer.invoke('game:status'),
  openGameFolder: (instanceId) => ipcRenderer.invoke('game:openFolder', { instanceId }),
  onLog: (cb) => on('game:log', cb),
  onGameStatus: (cb) => on('game:status', cb),
  onProgress: (cb) => on('game:progress', cb),

  listInstances: () => ipcRenderer.invoke('instances:list'),
  createInstance: (data) => ipcRenderer.invoke('instances:create', data),
  renameInstance: (id, name) => ipcRenderer.invoke('instances:rename', { id, name }),
  deleteInstance: (id) => ipcRenderer.invoke('instances:delete', { id }),
  setActiveInstance: (id) => ipcRenderer.invoke('instances:setActive', { id }),
  onInstancesChanged: (cb) => on('instances:changed', cb),
  getMcVersions: () => ipcRenderer.invoke('meta:mcVersions'),
  getLoaders: (mc) => ipcRenderer.invoke('meta:loaders', { mc }),

  searchMods: (query, opts) => ipcRenderer.invoke('mods:search', { query, ...(opts || {}) }),
  installMod: (projectId, versionId, instanceId, category) => ipcRenderer.invoke('mods:install', { projectId, versionId, instanceId, category }),
  listInstalledMods: (instanceId) => ipcRenderer.invoke('mods:list', { instanceId }),
  uninstallMod: (file, category, instanceId) => ipcRenderer.invoke('mods:uninstall', { file, category, instanceId }),
  uploadContent: (category) => ipcRenderer.invoke('content:upload', { category }),
  dropFiles: (category, paths) => ipcRenderer.invoke('content:drop', { category, paths }),

  getSkinPreview: () => ipcRenderer.invoke('skins:preview'),
  listCapes: () => ipcRenderer.invoke('skins:capes'),
  pickSkinFile: () => ipcRenderer.invoke('skins:pickFile'),
  uploadSkin: (dataBase64, variant) => ipcRenderer.invoke('skins:upload', { dataBase64, variant }),
  equipCape: (capeId) => ipcRenderer.invoke('skins:equipCape', { capeId }),
  skinsHistory: () => ipcRenderer.invoke('skins:history'),
  applySkinHistory: (id) => ipcRenderer.invoke('skins:applyHistory', { id }),

  listServers: () => ipcRenderer.invoke('servers:list'),
  addServer: (name, ip) => ipcRenderer.invoke('servers:add', { name, ip }),
  updateServer: (id, name, ip) => ipcRenderer.invoke('servers:update', { id, name, ip }),
  removeServer: (id) => ipcRenderer.invoke('servers:remove', { id }),
  moveServer: (id, direction) => ipcRenderer.invoke('servers:move', { id, direction }),

  appVersion: () => ipcRenderer.invoke('update:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (cb) => on('update:state', cb)
});
