'use strict';

const { app } = require('electron');
const { randomUUID } = require('node:crypto');
const { loadState, saveState } = require('./store');
const { URLS } = require('./config');

const PING_URL = URLS.telemetryPing;
const DAY = 24 * 60 * 60 * 1000;

function userAgent() {
  try {
    return `KebabClient/${app.getVersion()}`;
  } catch {
    return 'KebabClient/unknown';
  }
}

function installId() {
  try {
    const s = loadState() || {};
    if (s && s.installId) return s.installId;
    const id = randomUUID();
    try {
      saveState({ installId: id });
    } catch {}
    return id;
  } catch {
    return 'unknown';
  }
}

async function pingOnce() {
  try {
    const url =
      `${PING_URL}?app=kebabclient` +
      `&v=${encodeURIComponent(app.getVersion())}` +
      `&id=${encodeURIComponent(installId())}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: '*/*', 'User-Agent': userAgent() },
      });
    } finally {
      clearTimeout(timer);
    }
    return true;
  } catch {
    return false;
  }
}

function telemetryEnabled() {
  try {
    return loadState().settings?.telemetry !== false;
  } catch {
    return true;
  }
}

let started = false;

function startTelemetry() {
  if (started) return;
  started = true;
  if (!app.isPackaged) return;
  setTimeout(async () => {
    if (!telemetryEnabled()) return;
    if (await pingOnce()) {
      try {
        saveState({ lastPing: Date.now() });
      } catch {}
    }
  }, 20000);
  setInterval(async () => {
    if (!telemetryEnabled()) return;
    if (await pingOnce()) {
      try {
        saveState({ lastPing: Date.now() });
      } catch {}
    }
  }, DAY);
}

module.exports = { startTelemetry, pingOnce };
