'use strict';

/* Telemetrie-Ping (First-Party, datensparsam):
   Meldet 1x am Tag "Installation aktiv" an kebabdev.de, damit die Website
   unter /api/stats.json "Aktive Nutzer" anzeigen kann. Uebertragen werden nur:
   App-Name, App-Version und eine zufaellige Installations-ID (keine Personendaten,
   kein Tracking ueber Dritte). Server-seitig wird nur gezaehlt (Nginx-Log).
   Laeuft nur in paketierten Builds, nie im Dev-Modus. Fehler sind still. */

const { app } = require('electron');
const { randomUUID } = require('node:crypto');
const { loadState, saveState } = require('./store');

const PING_URL = 'https://kebabdev.de/api/ping';
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
    } catch { /* ignore */ }
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

let started = false;

function startTelemetry() {
  if (started) return;
  started = true;
  if (!app.isPackaged) return;
  setTimeout(async () => {
    if (await pingOnce()) {
      try {
        saveState({ lastPing: Date.now() });
      } catch { /* ignore */ }
    }
  }, 20000);
  setInterval(async () => {
    if (await pingOnce()) {
      try {
        saveState({ lastPing: Date.now() });
      } catch { /* ignore */ }
    }
  }, DAY);
}

module.exports = { startTelemetry, pingOnce };
