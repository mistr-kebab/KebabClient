'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const updater = require('../updater');
const { URLS } = require('../config');

function register(ipcMain) {
  ipcMain.on('views:load', event => {
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

  ipcMain.on('locales:load', event => {
    const dir = path.join(app.getAppPath(), 'renderer', 'locales');
    const out = {};
    try {
      for (const file of fs.readdirSync(dir).sort()) {
        const m = file.match(/^([a-z]{2}(?:-[A-Za-z]{2})?)\.json$/);
        if (!m) continue;
        try {
          out[m[1].toLowerCase()] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        } catch {}
      }
    } catch {}
    event.returnValue = out;
  });

  ipcMain.handle('assets:banners', async () => {
    const dir = path.join(app.getAppPath(), 'renderer', 'assets');
    const MIME = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.avif': 'image/avif',
    };
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

  ipcMain.handle('discord:refresh', async () => require('../services/discord').refresh());

  ipcMain.handle('about:latest', async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(URLS.latestRelease, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  });

  ipcMain.handle('update:version', async () => ({ version: updater.currentVersion() }));
  ipcMain.handle('update:check', async () => updater.checkNow(true));
  ipcMain.handle('update:download', async () => updater.downloadUpdate());
  ipcMain.handle('update:install', async () => updater.installUpdate());
}

module.exports = { register };
