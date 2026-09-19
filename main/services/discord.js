'use strict';


const { loadState } = require('../store');
const { URLS } = require('../config');

const RECONNECT_MS = 30000;

let rpc = null;
let connected = false;
let connecting = null;
let retryTimer = null;
let current = null;
let log = () => {};
let notedDown = false;

function setLogger(fn) {
  if (typeof fn === 'function') log = fn;
}

function note(text) {
  try {
    log(`[discord] ${text}`);
  } catch {}
}

function discordClientId() {
  try {
    const cfg = require('../config');
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
  } catch {}
  return true;
}

function appVersion() {
  try {
    return require('electron').app.getVersion();
  } catch {
    return '';
  }
}

function appLanguage() {
  try {
    const forced = String(process.env.KEBAB_LANG || '').trim().toLowerCase();
    if (forced === 'en' || forced === 'de') return forced;
    const s = loadState().settings || {};
    return String(s.language || '').trim().toLowerCase() === 'en' ? 'en' : 'de';
  } catch {
    return 'de';
  }
}

const RPC_STRINGS = {
  de: {
    singleplayer: 'Singleplayer-Welt',
    menu: 'Im Menü',
    playingOn: (server) => `Spielt auf ${server}`,
    download: 'Herunterladen'
  },
  en: {
    singleplayer: 'Singleplayer World',
    menu: 'In Menu',
    playingOn: (server) => `Playing on ${server}`,
    download: 'Download'
  }
};

function buildActivity() {
  if (!current) return null;
  const ver = appVersion();
  const t = RPC_STRINGS[appLanguage()];
  const activity = {
    details: current.instance ? `KebabClient · ${current.instance}` : 'KebabClient',
    largeImageKey: 'logo',
    largeImageText: ver ? `KebabClient v${ver}` : 'KebabClient',
    instance: false
  };
  if (current.server) {
    activity.state = current.server === 'singleplayer' ? t.singleplayer : t.playingOn(current.server);
  } else {
    activity.state = t.menu;
  }
  if (current.startedAt) activity.startTimestamp = current.startedAt;
  activity.buttons = [{ label: t.download, url: URLS.downloadPage }];
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
    } catch {}
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
      if (rpc !== client) return;
      connected = true;
      if (notedDown) {
        notedDown = false;
        note('Rich Presence connected.');
      }
      if (current) apply().catch(() => {});
    });
    client.on('disconnected', () => {
      if (rpc !== client) return;
      connected = false;
      rpc = null;
      if (!notedDown) {
        notedDown = true;
        note('Rich Presence disconnected.');
      }
    });
    try {
      await client.login({ clientId: id });
    } catch (err) {
      if (!notedDown) {
        notedDown = true;
        note(`Connection failed (${err?.message || err}). Retrying in the background.`);
      }
      throw err;
    }
    rpc = client;
    connected = true;
    if (notedDown) notedDown = false;
    note('Rich Presence connected.');
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
    const host = m[1];
    const hasPort = !!m[2];
    const isScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(host);
    const isVoice = /voice/i.test(host) || /voice[\s_-]?chat/i.test(s);
    if (!isScheme && !isVoice && (hasPort || !current.server)) {
      showServer(host);
    }
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
    } catch {}
    rpc = null;
    connected = false;
    return { ok: true, enabled: false, connected: false };
  }
  await apply();
  return { ok: true, enabled: true, connected };
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
      } catch {}
      await rpc.destroy();
    }
  } catch {}
  rpc = null;
  connected = false;
}

module.exports = {
  setLogger,
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
