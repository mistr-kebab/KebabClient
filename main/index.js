'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const config = require('./config');
const store = require('./store');
const auth = require('./auth');
const minecraft = require('./minecraft');
const content = require('./content');
const skins = require('./skins');
const servers = require('./servers');
const instances = require('./instances');
const loaders = require('./loaders');
const appSettings = require('./settings');
const updater = require('./updater');
const telemetry = require('./telemetry');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    frame: false,
    title: 'KebabClient',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.js')
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('maximize', () => broadcast('window:maxState', { maximized: true }));
  mainWindow.on('unmaximize', () => broadcast('window:maxState', { maximized: false }));
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

minecraft.setEmitter((channel, payload) => broadcast(channel, payload));

function registerIpc() {
  ipcMain.handle('window:minimize', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    return { ok: true };
  });
  ipcMain.handle('window:toggleMaximize', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
    return { ok: true };
  });
  ipcMain.handle('window:close', async () => {
    app.quit();
    return { ok: true };
  });
  ipcMain.handle('auth:login', async () => auth.fullLoginFlow(mainWindow));
  ipcMain.handle('auth:refresh', async () => auth.refreshSession());
  ipcMain.handle('auth:logout', async () => { auth.logout(); return { ok: true }; });
  ipcMain.handle('auth:profile', async () => ({ profile: auth.getStoredProfile() }));
  ipcMain.handle('settings:getClientId', async () => auth.getClientIdInfo());
  ipcMain.handle('settings:setClientId', async (_e, args) => {
    const mode = args?.mode === 'custom' ? 'custom' : args?.mode === 'builtin' ? 'builtin' : 'own';
    if (mode === 'custom') {
      const value = String(args?.clientId || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        throw new Error('Invalid client ID format. Expected the Application (client) ID GUID from Entra, e.g. b0be2e82-…-953142.');
      }
      store.saveState({ clientId: value, authMode: 'custom' });
    } else {
      store.saveState({ authMode: mode });
    }
    return { ok: true, mode };
  });

  ipcMain.handle('settings:get', async () => ({
    settings: appSettings.getSettings(),
    dataDir: appSettings.getDataDirInfo(),
    ramOptions: appSettings.RAM_OPTIONS,
    threadOptions: appSettings.THREAD_OPTIONS
  }));
  ipcMain.handle('settings:update', async (_e, args) => ({
    settings: appSettings.updateSettings(args || {})
  }));
  ipcMain.handle('settings:setDataDir', async (_e, args) => appSettings.setDataDir(args?.dir));
  ipcMain.handle('settings:moveDataDir', async (_e, args) => appSettings.moveDataDir(args?.dir, (s) =>
    broadcast('game:progress', { phase: 'settings', ...s })
  ));
  ipcMain.handle('settings:openDataFolder', async () => appSettings.openDataFolder());
  ipcMain.handle('settings:browseJava', async () => appSettings.browseJava(mainWindow));

  ipcMain.handle('game:ensure', async (_e, args) => {
    const res = await minecraft.ensureClient(args?.instanceId, (p) => broadcast('game:progress', p));
    servers.syncToAllInstances();
    return { ok: true, ...res };
  });
  ipcMain.handle('game:launch', async (_e, args) => {
    servers.syncToAllInstances();
    return minecraft.launchGame(args?.instanceId);
  });
  ipcMain.handle('game:stop', async () => minecraft.stopGame());
  ipcMain.handle('game:status', async () => {
    const active = instances.getActiveInstance();
    return {
      running: minecraft.isRunning(),
      instance: active || null,
      instanceDir: active ? minecraft.dirsFor(active).root : null,
      profile: auth.getStoredProfile()
    };
  });
  ipcMain.handle('game:openFolder', async (_e, args) => {
    const inst = args?.instanceId ? instances.getInstance(args.instanceId) : instances.getActiveInstance();
    if (!inst) throw new Error('No instance selected. Create one first.');
    await shell.openPath(minecraft.dirsFor(inst).root);
    return { ok: true };
  });

  ipcMain.handle('instances:list', async () => ({
    instances: instances.listInstances().map((i) => instances.describeInstance(i)),
    activeId: instances.getActiveInstance()?.id || null
  }));
  ipcMain.handle('instances:setIcon', async (_e, args) => {
    const id = String(args?.id || '');
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose instance icon',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile']
    });
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
    const entry = instances.setInstanceIcon(id, picked.filePaths[0]);
    broadcast('instances:changed', { instances: instances.listInstances(), activeId: instances.getActiveInstance()?.id || null });
    return { canceled: false, entry: instances.describeInstance(entry) };
  });
  ipcMain.handle('instances:clearIcon', async (_e, args) => {
    const entry = instances.clearInstanceIcon(String(args?.id || ''));
    broadcast('instances:changed', { instances: instances.listInstances(), activeId: instances.getActiveInstance()?.id || null });
    return { ok: true, entry: instances.describeInstance(entry) };
  });
  ipcMain.handle('instances:create', async (_e, args) => {
    const created = instances.createInstance({ name: args?.name, mc: args?.mc, loader: args?.loader });
    broadcast('instances:changed', { instances: instances.listInstances(), activeId: created.id });
    return created;
  });
  ipcMain.handle('instances:rename', async (_e, args) => {
    const renamed = instances.renameInstance(args?.id, args?.name);
    broadcast('instances:changed', { instances: instances.listInstances(), activeId: instances.getActiveInstance()?.id || null });
    return renamed;
  });
  ipcMain.handle('instances:delete', async (_e, args) => {
    const rest = instances.deleteInstance(args?.id);
    broadcast('instances:changed', { instances: rest, activeId: instances.getActiveInstance()?.id || null });
    return rest;
  });
  ipcMain.handle('instances:setActive', async (_e, args) => {
    const active = instances.setActiveInstance(args?.id);
    broadcast('instances:changed', { instances: instances.listInstances(), activeId: active.id });
    return active;
  });

  ipcMain.handle('meta:mcVersions', async () => {
    const manifest = await (await fetch(config.URLS.pistonMetaManifest)).json();
    return (manifest.versions || [])
      .filter((v) => v.type === 'release')
      .slice(0, 40)
      .map((v) => v.id);
  });
  ipcMain.handle('meta:loaders', async (_e, args) => {
    const mc = String(args?.mc || '').trim();
    if (!mc) throw new Error('Missing Minecraft version.');
    const out = {
      fabric: { supported: true, versions: [] },
      quilt: { supported: true, versions: [] },
      forge: { supported: false, note: 'Forge support is coming soon.' },
      neoforge: { supported: false, note: 'NeoForge support is coming soon.' }
    };
    for (const key of ['fabric', 'quilt']) {
      try {
        out[key].versions = await loaders.listLoaderVersions(mc, key);
      } catch (err) {
        out[key].versions = [];
        out[key].note = err.message;
      }
    }
    return out;
  });

  ipcMain.handle('mods:search', async (_e, args) =>
    content.searchMods(args?.query || '', {
      limit: args?.limit || 24,
      offset: args?.offset || 0,
      instanceId: args?.instanceId,
      category: args?.category,
      sort: args?.sort
    })
  );
  ipcMain.handle('mods:install', async (_e, args) => {
    const res = await content.installMod(args?.projectId, args?.versionId, args?.instanceId, (s) =>
      broadcast('game:progress', { phase: 'mods', ...s }), args?.category, args?.meta);
    return res;
  });
  ipcMain.handle('mods:list', async (_e, args) => content.listInstalled(args?.instanceId, args?.category));
  ipcMain.handle('mods:uninstall', async (_e, args) => content.uninstallMod(args?.file, args?.instanceId, args?.category));
  ipcMain.handle('mods:toggle', async (_e, args) => content.toggleContent(args?.file, args?.instanceId, args?.category));

  ipcMain.handle('content:drop', async (_e, args) =>
    content.importContent(args?.category, args?.paths, args?.instanceId)
  );
  ipcMain.handle('content:upload', async (_e, args) => {
    const key = String(args?.category || 'mod').toLowerCase();
    const filter = key === 'mod'
      ? { name: 'Minecraft mods', extensions: ['jar'] }
      : { name: `${key} packs`, extensions: ['zip'] };
    const res = await dialog.showOpenDialog(mainWindow, {
      title: `Add ${key} files`,
      filters: [filter],
      properties: ['openFile', 'multiSelections']
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    return { canceled: false, ...content.importContent(key, res.filePaths, args?.instanceId) };
  });

  ipcMain.handle('skins:preview', async () => skins.getPreview());
  ipcMain.handle('skins:capes', async () => skins.getSkinState().then((s) => s.capes));
  ipcMain.handle('skins:upload', async (_e, args) => {
    const buf = Buffer.from(args?.dataBase64 || '', 'base64');
    if (!buf.length) throw new Error('No skin data received.');
    return skins.uploadSkin(buf, args?.variant || 'classic');
  });
  ipcMain.handle('skins:pickFile', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose skin PNG',
      filters: [{ name: 'PNG image', extensions: ['png'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const fs = require('node:fs');
    const buf = fs.readFileSync(res.filePaths[0]);
    const meta = skins.validateSkinPng(buf);
    return {
      canceled: false,
      fileName: path.basename(res.filePaths[0]),
      dataBase64: buf.toString('base64'),
      ...meta
    };
  });
  ipcMain.handle('skins:equipCape', async (_e, args) => skins.equipCape(args?.capeId));
  ipcMain.handle('skins:history', async () => skins.getHistory());
  ipcMain.handle('skins:applyHistory', async (_e, args) => skins.applyHistory(args?.id));

  ipcMain.handle('assets:banners', async () => {
    const fs = require('node:fs');
    const dir = path.join(app.getAppPath(), 'renderer', 'assets');
    const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif' };
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out = [];
    for (const file of files.sort()) {
      if (!/^banner/i.test(file)) continue;
      const ext = path.extname(file).toLowerCase();
      if (!MIME[ext]) continue;
      const full = path.join(dir, file);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
        out.push({ name: file, dataUrl: `data:${MIME[ext]};base64,${fs.readFileSync(full).toString('base64')}` });
      } catch { /* skip unreadable */ }
    }
    return out;
  });

  ipcMain.handle('servers:list', async () => servers.listServers());
  ipcMain.handle('servers:add', async (_e, args) => servers.addServer(args?.name, args?.ip));
  ipcMain.handle('servers:update', async (_e, args) => servers.updateServer(args?.id, args?.name, args?.ip));
  ipcMain.handle('servers:remove', async (_e, args) => servers.removeServer(args?.id));
  ipcMain.handle('servers:move', async (_e, args) => servers.moveServer(args?.id, args?.direction));
  ipcMain.handle('servers:ping', async (_e, args) => require('./ping').pingServer(args?.ip));

  ipcMain.handle('update:version', async () => ({ version: updater.currentVersion() }));
  ipcMain.handle('update:check', async () => updater.checkNow(true));
  ipcMain.handle('update:download', async () => updater.downloadUpdate());
  ipcMain.handle('update:install', async () => updater.installUpdate());
}

async function autoRefresh() {
  try {
    const secrets = store.loadSecrets();
    if (secrets?.msRefreshToken) {
      await auth.refreshSession();
      broadcast('auth:changed', { profile: auth.getStoredProfile() });
    }
  } catch (err) {
    broadcast('auth:changed', { profile: auth.getStoredProfile(), refreshError: String(err?.message || err) });
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    updater.initUpdater(broadcast);
    telemetry.startTelemetry();
    try { require('./discord').showMenu(); } catch { /* noop */ }
    autoRefresh();
    try { servers.syncToAllInstances(); } catch (err) { console.error('Could not sync servers.dat:', err); }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
