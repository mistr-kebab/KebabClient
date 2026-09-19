'use strict';

const { dialog } = require('electron');
const content = require('../content');

function register(ipcMain, ctx) {
  const { broadcast, getWindow } = ctx;

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
  ipcMain.handle('mods:checkUpdates', async (_e, args) => content.checkContentUpdates(args?.instanceId, args?.category));
  ipcMain.handle('mods:versions', async (_e, args) => content.listContentVersions(args?.projectId, args?.instanceId, args?.category));
  ipcMain.handle('mods:switch', async (_e, args) => content.switchContentVersion(args?.file, args?.projectId, args?.versionId, args?.instanceId, args?.category, (s) =>
    broadcast('game:progress', { phase: 'mods', ...s })
  ));

  ipcMain.handle('content:drop', async (_e, args) =>
    content.importContent(args?.category, args?.paths, args?.instanceId)
  );
  ipcMain.handle('content:upload', async (_e, args) => {
    const key = String(args?.category || 'mod').toLowerCase();
    const filter = key === 'mod'
      ? { name: 'Minecraft mods', extensions: ['jar'] }
      : { name: `${key} packs`, extensions: ['zip'] };
    const res = await dialog.showOpenDialog(getWindow(), {
      title: `Add ${key} files`,
      filters: [filter],
      properties: ['openFile', 'multiSelections']
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    return { canceled: false, ...content.importContent(key, res.filePaths, args?.instanceId) };
  });
}

module.exports = { register };
