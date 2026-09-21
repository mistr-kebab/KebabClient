'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { dialog } = require('electron');
const skins = require('../services/skins');

function register(ipcMain, ctx) {
  const getWindow = ctx.getWindow;

  ipcMain.handle('skins:preview', async () => skins.getPreview());
  ipcMain.handle('skins:state', async () => skins.getSkinState());
  ipcMain.handle('skins:capes', async () => skins.getSkinState().then(s => s.capes));
  ipcMain.handle('skins:upload', async (_e, args) => {
    const raw = String(args?.dataBase64 || '');
    if (!raw.length) throw new Error('No skin data received.');
    if (raw.length > 7 * 1024 * 1024) throw new Error('Skin data is too large (max ~5 MB).');
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) throw new Error('No skin data received.');
    if (buf.length > 5 * 1024 * 1024) throw new Error('Skin file is too large (max 5 MB).');
    return skins.uploadSkin(buf, args?.variant || 'classic');
  });
  ipcMain.handle('skins:pickFile', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose skin PNG',
      filters: [{ name: 'PNG image', extensions: ['png'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const buf = fs.readFileSync(res.filePaths[0]);
    const meta = skins.validateSkinPng(buf);
    return {
      canceled: false,
      fileName: path.basename(res.filePaths[0]),
      dataBase64: buf.toString('base64'),
      ...meta,
    };
  });
  ipcMain.handle('skins:equipCape', async (_e, args) => skins.equipCape(args?.capeId));
  ipcMain.handle('skins:history', async () => skins.getHistory());
  ipcMain.handle('skins:applyHistory', async (_e, args) => skins.applyHistory(args?.id));
}

module.exports = { register };
