'use strict';

const appSettings = require('../settings');

function register(ipcMain, ctx) {
  const { broadcast, getWindow } = ctx;

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
  ipcMain.handle('settings:browseJava', async () => appSettings.browseJava(getWindow()));
}

module.exports = { register };
