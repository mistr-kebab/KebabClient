'use strict';

const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

let send = () => {};
let started = false;

function emit(state, data) {
  try {
    send('update:state', { state, ...(data || {}) });
  } catch {}
}

function isSupported() {
  try {
    return app.isPackaged === true;
  } catch {
    return false;
  }
}

async function checkNow(userInitiated) {
  if (!isSupported()) {
    if (userInitiated) {
      emit('error', { code: 'not-configured', message: 'Dev mode or missing update configuration.' });
    }
    return { ok: false, reason: 'not-configured' };
  }
  try {
    const res = await autoUpdater.checkForUpdates();
    if (!res || !res.updateInfo || res.updateInfo.version === app.getVersion()) {
      if (userInitiated) emit('none', { version: app.getVersion() });
    }
    return { ok: true };
  } catch (err) {
    emit('error', { code: 'check-failed', message: String(err?.message || err) });
    return { ok: false, reason: String(err?.message || err) };
  }
}

function initUpdater(broadcast) {
  send = broadcast;
  if (started) return;
  started = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => emit('checking'));
  autoUpdater.on('update-available', (info) => {
    emit('available', { version: info?.version || '', notes: info?.releaseNotes || '' });
  });
  autoUpdater.on('update-not-available', () => emit('none', { version: app.getVersion() }));
  autoUpdater.on('download-progress', (p) => {
    const pct = typeof p?.percent === 'number' ? Math.max(0, Math.min(100, p.percent)) : 0;
    emit('downloading', { percent: pct, transferred: p?.transferred || 0, total: p?.total || 0 });
  });
  autoUpdater.on('update-downloaded', (info) => {
    emit('ready', { version: info?.version || '' });
  });
  autoUpdater.on('error', (err) => {
    emit('error', { message: String(err?.message || err) });
  });

  if (isSupported()) {
    later(checkNow, 15000);
    repeat(checkNow, 6 * 60 * 60 * 1000);
  }
}

function later(fn, ms) {
  return setTimeout(() => {
    try { fn(false); } catch {}
  }, ms);
}

function repeat(fn, ms) {
  return setInterval(() => {
    try { fn(false); } catch {}
  }, ms);
}

async function downloadUpdate() {
  if (!isSupported()) throw new Error('No update source configured.');
  await autoUpdater.downloadUpdate();
  return { ok: true };
}

function installUpdate() {
  try {
    autoUpdater.quitAndInstall(true, true);
  } catch {
    app.relaunch();
    app.quit();
  }
  return { ok: true };
}

module.exports = {
  initUpdater,
  checkNow,
  downloadUpdate,
  installUpdate,
  currentVersion: () => app.getVersion()
};
