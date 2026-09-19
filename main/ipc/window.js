'use strict';

const { app } = require('electron');

function register(ipcMain, ctx) {
  const getWindow = ctx.getWindow;

  ipcMain.handle('window:minimize', async () => {
    const mainWindow = getWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    return { ok: true };
  });
  ipcMain.handle('window:toggleMaximize', async () => {
    const mainWindow = getWindow();
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
}

module.exports = { register };
