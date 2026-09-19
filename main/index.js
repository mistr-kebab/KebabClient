'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const store = require('./store');
const auth = require('./auth');
const minecraft = require('./minecraft');
const servers = require('./servers');
const updater = require('./updater');
const telemetry = require('./telemetry');

let mainWindow = null;

function getWindow() {
  return mainWindow;
}

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
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
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

try {
  require('./discord').setLogger((text) => broadcast('game:log', { stream: 'system', line: text }));
} catch {}

function registerIpc() {
  const ctx = { broadcast, getWindow };
  require('./ipc/window').register(ipcMain, ctx);
  require('./ipc/auth').register(ipcMain, ctx);
  require('./ipc/settings').register(ipcMain, ctx);
  require('./ipc/game').register(ipcMain, ctx);
  require('./ipc/instances').register(ipcMain, ctx);
  require('./ipc/content').register(ipcMain, ctx);
  require('./ipc/skins').register(ipcMain, ctx);
  require('./ipc/servers').register(ipcMain, ctx);
  require('./ipc/system').register(ipcMain, ctx);
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
    try { require('./discord').showMenu(); } catch {}
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
