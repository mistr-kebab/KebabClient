'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function loadDotEnv() {
  const candidates = [];
  try {
    candidates.push(path.join(path.dirname(process.execPath), '.env'));
  } catch { /* noop */ }
  candidates.push(path.join(__dirname, '..', '.env'));
  for (const file of candidates) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch { continue; }
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      let val = match[2].trim();
      if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
        val = val.slice(1, -1);
      }
      if (!(match[1] in process.env)) process.env[match[1]] = val;
    }
  }
}

loadDotEnv();

const MC_VERSION = '26.1.2';

const APP_NAME = 'KebabClient';

// Official, Mojang-allowlisted public client used by the vanilla launcher flow.
// Fallback method, no approval needed. Used when the KebabClient app is deselected.
const BUILTIN_CLIENT_ID = '00000000402B5328';
const BUILTIN_REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf';

// KebabDev's own approved Entra app (public client, no secret).
// Default sign-in method. Shipped in the repo like other launchers ship theirs.
const OWN_CLIENT_ID = 'b0be2e82-378f-4156-a4f5-c43506935142';

function appDataRoot() {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function defaultDataDir() {
  return path.join(appDataRoot(), APP_NAME);
}

function bootstrapFile() {
  return path.join(defaultDataDir(), '.datadir');
}

function readBootstrapDir() {
  try {
    const raw = fs.readFileSync(bootstrapFile(), 'utf8').trim();
    if (raw && path.isAbsolute(raw)) return raw;
  } catch { /* no bootstrap: use default */ }
  return '';
}

function dataDir() {
  const fromEnv = (process.env.KEBAB_DATA_DIR || '').trim();
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  return readBootstrapDir() || defaultDataDir();
}

function instanceDir() {
  return path.join(dataDir(), 'instances', MC_VERSION);
}

function instancesRoot() {
  return path.join(dataDir(), 'instances');
}

function sharedLibrariesDir() {
  return path.join(dataDir(), 'libraries');
}

function sharedAssetsDir() {
  return path.join(dataDir(), 'assets');
}

const URLS = {
  pistonMetaManifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  modrinthApi: 'https://api.modrinth.com/v2',
  msAuthorize: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
  msToken: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  xboxUserAuth: 'https://user.auth.xboxlive.com/user/authenticate',
  xstsAuthorize: 'https://xsts.auth.xboxlive.com/xsts/authorize',
  mcLoginXbox: 'https://api.minecraftservices.com/authentication/login_with_xbox',
  mcProfile: 'https://api.minecraftservices.com/minecraft/profile',
  mcProfileSkins: 'https://api.minecraftservices.com/minecraft/profile/skins',
  mcProfileCapes: 'https://api.minecraftservices.com/minecraft/profile/capes',
  sessionServerJoin: 'https://sessionserver.mojang.com/session/minecraft/join'
};

function microsoftClientId() {
  return process.env.MC_LAUNCHER_CLIENT_ID || process.env.AZURE_CLIENT_ID || '';
}

const BUILTIN_DISCORD_CLIENT_ID = '1549540973653004320';

function discordClientId() {
  return process.env.DISCORD_CLIENT_ID || BUILTIN_DISCORD_CLIENT_ID;
}

function msRedirectUri() {
  return 'https://login.microsoftonline.com/common/oauth2/nativeclient';
}

module.exports = {
  MC_VERSION,
  APP_NAME,
  BUILTIN_CLIENT_ID,
  BUILTIN_REDIRECT_URI,
  OWN_CLIENT_ID,
  BUILTIN_DISCORD_CLIENT_ID,
  discordClientId,
  URLS,
  dataDir,
  defaultDataDir,
  bootstrapFile,
  instanceDir,
  instancesRoot,
  sharedLibrariesDir,
  sharedAssetsDir,
  microsoftClientId,
  msRedirectUri
};
