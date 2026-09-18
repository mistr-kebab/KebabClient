'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const sub = (_event, payload) => {
    try { callback(payload); } catch {}
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
  launch: (instanceId, server) => ipcRenderer.invoke('game:launch', { instanceId, server }),
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
  backupInstance: (id) => ipcRenderer.invoke('instances:backup', { id }),
  setActiveInstance: (id) => ipcRenderer.invoke('instances:setActive', { id }),
  setInstanceIcon: (id) => ipcRenderer.invoke('instances:setIcon', { id }),
  clearInstanceIcon: (id) => ipcRenderer.invoke('instances:clearIcon', { id }),
  onInstancesChanged: (cb) => on('instances:changed', cb),
  getMcVersions: () => ipcRenderer.invoke('meta:mcVersions'),
  getLoaders: (mc) => ipcRenderer.invoke('meta:loaders', { mc }),

  searchMods: (query, opts) => ipcRenderer.invoke('mods:search', { query, ...(opts || {}) }),
  installMod: (projectId, versionId, instanceId, category, meta) => ipcRenderer.invoke('mods:install', { projectId, versionId, instanceId, category, meta }),
  listInstalledMods: (instanceId) => ipcRenderer.invoke('mods:list', { instanceId }),
  uninstallMod: (file, category, instanceId) => ipcRenderer.invoke('mods:uninstall', { file, category, instanceId }),
  toggleContent: (file, category, instanceId) => ipcRenderer.invoke('mods:toggle', { file, category, instanceId }),
  checkContentUpdates: (instanceId, category) => ipcRenderer.invoke('mods:checkUpdates', { instanceId, category }),
  listContentVersions: (projectId, instanceId, category) => ipcRenderer.invoke('mods:versions', { projectId, instanceId, category }),
  switchContentVersion: (file, projectId, versionId, instanceId, category) => ipcRenderer.invoke('mods:switch', { file, projectId, versionId, instanceId, category }),
  uploadContent: (category, instanceId) => ipcRenderer.invoke('content:upload', { category, instanceId }),
  dropFiles: (category, paths, instanceId) => ipcRenderer.invoke('content:drop', { category, paths, instanceId }),

  getSkinPreview: () => ipcRenderer.invoke('skins:preview'),
  getSkinState: () => ipcRenderer.invoke('skins:state'),
  listCapes: () => ipcRenderer.invoke('skins:capes'),
  pickSkinFile: () => ipcRenderer.invoke('skins:pickFile'),
  uploadSkin: (dataBase64, variant) => ipcRenderer.invoke('skins:upload', { dataBase64, variant }),
  equipCape: (capeId) => ipcRenderer.invoke('skins:equipCape', { capeId }),
  skinsHistory: () => ipcRenderer.invoke('skins:history'),
  applySkinHistory: (id) => ipcRenderer.invoke('skins:applyHistory', { id }),

  listServers: () => ipcRenderer.invoke('servers:list'),
  addServer: (name, ip, categoryId, invite) => ipcRenderer.invoke('servers:add', { name, ip, categoryId, invite }),
  updateServer: (id, name, ip, categoryId, invite) => ipcRenderer.invoke('servers:update', { id, name, ip, categoryId, invite }),
  toggleServer: (id, disabled) => ipcRenderer.invoke('servers:toggle', { id, disabled }),
  listCategories: () => ipcRenderer.invoke('servers:categories'),
  addCategory: (name) => ipcRenderer.invoke('servers:addCategory', { name }),
  renameCategory: (id, name) => ipcRenderer.invoke('servers:renameCategory', { id, name }),
  openInvite: (url) => ipcRenderer.invoke('servers:openInvite', { url }),
  deleteCategory: (id) => ipcRenderer.invoke('servers:deleteCategory', { id }),
  removeServer: (id) => ipcRenderer.invoke('servers:remove', { id }),
  moveServer: (id, direction) => ipcRenderer.invoke('servers:move', { id, direction }),
  pingServer: (ip) => ipcRenderer.invoke('servers:ping', { ip }),
  refreshDiscord: () => ipcRenderer.invoke('discord:refresh'),

  appVersion: () => ipcRenderer.invoke('update:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (cb) => on('update:state', cb)
});
