'use strict';

/* Discord Rich Presence: zeigt im Discord-Profil, dass KebabClient laeuft –
   ob man im Menue ist, auf welchem Server man spielt und seit wann.
   Spricht nur lokal per IPC mit dem laufenden Discord-Client (kein Tracking,
   keine zusaetzlichen Datenabfluesse). Ohne Discord-Client oder ohne
   konfigurierte Application ID bleibt es still deaktiviert.
   Application ID: Discord Developer Portal -> .env DISCORD_CLIENT_ID=... */

const { loadState } = require('./store');

const RECONNECT_MS = 30000;

let rpc = null;
let connected = false;
let connecting = null;
let retryTimer = null;
let current = null;

function discordClientId() {
  try {
    const cfg = require('./config');
    const v = typeof cfg.discordClientId === 'function' ? cfg.discordClientId() : '';
    const s = String(v || '').trim();
    if (!s || /DEIN-|HIER-|XXXX|0000/.test(s)) return '';
    return s;
  } catch {
    return '';
  }
}

function settingsOn() {
  try {
    const s = loadState().settings || {};
    if (s.discord && typeof s.discord.rpc === 'boolean') return s.discord.rpc;
  } catch { /* noop */ }
  return true;
}

function appVersion() {
  try {
    return require('electron').app.getVersion();
  } catch {
    return '';
  }
}

function buildActivity() {
  if (!current) return null;
  const ver = appVersion();
  const activity = {
    details: current.instance ? `KebabClient · ${current.instance}` : 'KebabClient',
    largeImageKey: 'logo',
    largeImageText: ver ? `KebabClient v${ver}` : 'KebabClient',
    instance: false
  };
  if (current.server) {
    activity.state = current.server === 'singleplayer' ? 'Singleplayer World' : `Playing on ${current.server}`;
  } else {
    activity.state = 'In Menu';
  }
  if (current.startedAt) activity.startTimestamp = current.startedAt;
  activity.buttons = [{ label: 'Download', url: 'https://kebabdev.de/download/' }];
  return activity;
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (current) apply().catch(() => {});
  }, RECONNECT_MS);
  if (retryTimer.unref) retryTimer.unref();
}

async function apply() {
  if (!current) return;
  try {
    if (!(await ensureConnected())) return;
    await rpc.setActivity(buildActivity());
  } catch {
    connected = false;
    rpc = null;
    scheduleRetry();
  }
}

async function ensureConnected() {
  if (connected && rpc) return true;
  if (connecting) {
    try {
      await connecting;
    } catch { /* noop */ }
    return connected && !!rpc;
  }
  const id = discordClientId();
  if (!id || !settingsOn()) return false;
  let Client = null;
  try {
    Client = require('discord-rpc').Client;
  } catch {
    return false;
  }
  if (!Client) return false;
  connecting = (async () => {
    const client = new Client({ transport: 'ipc' });
    client.on('ready', () => {
      // Nur reagieren, wenn dieser Client auch der aktive ist (kein Sturm
      // durch ready-Events, die noch waehrend login() feuern).
      if (rpc !== client) return;
      connected = true;
      if (current) apply().catch(() => {});
    });
    client.on('disconnected', () => {
      if (rpc !== client) return;
      connected = false;
      rpc = null;
    });
    await client.login({ clientId: id });
    rpc = client;
    connected = true;
  })();
  try {
    await connecting;
  } catch {
    rpc = null;
    connected = false;
    scheduleRetry();
  } finally {
    connecting = null;
  }
  return connected && !!rpc;
}

function showMenu() {
  current = { instance: null, server: null, startedAt: Date.now() };
  apply().catch(() => {});
}

function showGame(instanceName) {
  current = { instance: String(instanceName || 'Minecraft'), server: null, startedAt: Date.now() };
  apply().catch(() => {});
}

function showServer(host) {
  if (!current || !current.startedAt) {
    current = { instance: null, server: null, startedAt: Date.now() };
  }
  const h = String(host || '').trim();
  current.server = h || null;
  apply().catch(() => {});
}

function clearGame() {
  showMenu();
}

function handleGameLine(line) {
  if (!current || !current.startedAt) return;
  const s = String(line || '');
  const m = s.match(/Connecting to ([^,\s]+)(?:,\s*(\d+))?/);
  if (m) {
    showServer(m[1]);
    return;
  }
  if (/Starting integrated server/i.test(s)) {
    showServer('singleplayer');
    return;
  }
  if (/Stopping server|Disconnecting from server|Left the game/i.test(s)) {
    current.server = null;
    apply().catch(() => {});
  }
}

async function refresh() {
  if (!settingsOn()) {
    current = null;
    try {
      if (rpc) await rpc.destroy();
    } catch { /* noop */ }
    rpc = null;
    connected = false;
    return { ok: true, enabled: false };
  }
  await apply();
  return { ok: true, enabled: true };
}

async function shutdown() {
  current = null;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  try {
    if (rpc) {
      try {
        await rpc.clearActivity();
      } catch { /* noop */ }
      await rpc.destroy();
    }
  } catch { /* noop */ }
  rpc = null;
  connected = false;
}

module.exports = {
  showMenu,
  showGame,
  showServer,
  clearGame,
  handleGameLine,
  refresh,
  shutdown,
  _buildActivity: buildActivity,
  _state: () => current
};
