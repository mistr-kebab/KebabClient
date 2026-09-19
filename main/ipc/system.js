'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const updater = require('../updater');

function register(ipcMain) {
  ipcMain.on('views:load', (event) => {
    const dir = path.join(app.getAppPath(), 'renderer', 'views');
    const out = {};
    try {
      for (const file of fs.readdirSync(dir).sort()) {
        if (!file.toLowerCase().endsWith('.html')) continue;
        out[path.basename(file, '.html')] = fs.readFileSync(path.join(dir, file), 'utf8');
      }
    } catch {}
    event.returnValue = out;
  });

  ipcMain.handle('assets:banners', async () => {
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
      } catch {}
    }
    return out;
  });

  ipcMain.handle('discord:refresh', async () => require('../discord').refresh());

  ipcMain.handle('update:version', async () => ({ version: updater.currentVersion() }));
  ipcMain.handle('update:check', async () => updater.checkNow(true));
  ipcMain.handle('update:download', async () => updater.downloadUpdate());
  ipcMain.handle('update:install', async () => updater.installUpdate());
}

module.exports = { register };
