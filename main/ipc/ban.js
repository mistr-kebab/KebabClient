'use strict';

const { shell } = require('electron');
const { URLS } = require('../config');
const ban = require('../services/ban');

function register(ipcMain) {
  // Fail-open by contract: banned=false unless the server definitively says
  // otherwise. Never throws for network/server issues.
  ipcMain.handle('ban:check', async () => {
    try {
      const res = await ban.checkNow();
      return {
        banned: res.ok === true && res.banned === true,
        reason: res.ok ? res.reason ?? null : null,
        username: res.username || '',
      };
    } catch (err) {
      console.warn('[ban] Check failed (fail-open):', err?.message || err);
      return { banned: false, reason: null, username: '' };
    }
  });

  // Fixed invite URL from config (never renderer-controlled).
  ipcMain.handle('ban:appeal', async () => {
    const url = URLS.discordInvite;
    if (!/^https:\/\/(discord\.gg|discord\.com\/invite)\//i.test(url)) {
      throw new Error('No Discord invite configured.');
    }
    await shell.openExternal(url);
    return { ok: true };
  });
}

module.exports = { register };
