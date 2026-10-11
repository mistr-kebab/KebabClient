'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const store = require('./store');
const auth = require('./services/auth');
const minecraft = require('./services/minecraft');
const servers = require('./services/servers');
const updater = require('./updater');
const telemetry = require('./telemetry');
const ban = require('./services/ban');

let mainWindow = null;

function getWindow() {
  return mainWindow;
}

function loadWindowState() {
  try {
    const w = store.loadState().window;
    if (!w || typeof w !== 'object') return null;
    const maximized = w.maximized === true;
    let bounds = null;
    const b = w.bounds;
    if (
      b &&
      [b.x, b.y, b.width, b.height].every(Number.isFinite) &&
      b.width >= 400 &&
      b.height >= 300
    ) {
      const area = screen.getDisplayMatching({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      }).workArea;
      if (
        b.x + 100 > area.x &&
        b.x + 100 < area.x + area.width &&
        b.y + 50 > area.y &&
        b.y + 50 < area.y + area.height
      ) {
        bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
      }
    }
    return { bounds, maximized };
  } catch {
    return null;
  }
}

function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const prev = store.loadState().window;
    store.saveState({
      window: {
        maximized,
        bounds: maximized ? (prev && prev.bounds) || null : win.getBounds(),
      },
    });
  } catch {}
}

function createWindow() {
  const saved = loadWindowState();
  mainWindow = new BrowserWindow({
    width: (saved && saved.bounds && saved.bounds.width) || 1180,
    height: (saved && saved.bounds && saved.bounds.height) || 760,
    x: saved && saved.bounds ? saved.bounds.x : undefined,
    y: saved && saved.bounds ? saved.bounds.y : undefined,
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
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (saved && saved.maximized) {
    try {
      mainWindow.maximize();
    } catch {}
  }
  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
  require('./services/discord').setLogger(text => broadcast('game:log', { stream: 'system', line: text }));
} catch (err) {
  console.warn('[main] Discord logger setup failed:', err?.message || err);
}

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
  require('./ipc/ban').register(ipcMain, ctx);
  require('./ipc/crashdoctor').register(ipcMain, ctx);
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
    ban.startBanWatcher(broadcast);
    // Pre-login hello (no uuid/username yet) is allowed; the ban check only
    // takes effect once a UUID is known. Best-effort, never blocks startup.
    setTimeout(() => {
      ban.checkNow({ background: true, trigger: 'startup' }).catch(() => {});
    }, 10000);
    try {
      require('./services/discord').showMenu();
    } catch (err) {
      console.warn('[main] Discord showMenu failed:', err?.message || err);
    }
    autoRefresh();
    try {
      servers.syncToAllInstances();
    } catch (err) {
      console.error('Could not sync servers.dat:', err);
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
