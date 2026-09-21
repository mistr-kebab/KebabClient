'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Local overrides only. `.env` is git-ignored and NEVER bundled into the
// packaged app (see package.json -> build.files whitelist). At runtime the
// launcher only reads an external `.env` placed next to the source (dev) or
// next to the portable `.exe`. Real environment variables always win.
// IMPORTANT: `.env` must NEVER contain secrets (no tokens, passwords or
// client secrets) — only public, non-sensitive IDs/paths (see .env.example).
function loadDotEnv() {
  const candidates = [];
  try {
    candidates.push(path.join(path.dirname(process.execPath), '.env'));
  } catch {}
  candidates.push(path.join(__dirname, '..', '.env'));
  for (const file of candidates) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      let val = match[2].trim();
      if (
        val.length >= 2 &&
        ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      ) {
        val = val.slice(1, -1);
      }
      if (!(match[1] in process.env)) process.env[match[1]] = val;
    }
  }
}

loadDotEnv();

const MC_VERSION = '26.1.2';

const APP_NAME = 'KebabClient';

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
  } catch {}
  return '';
}

function dataDir() {
  const fromEnv = (process.env.KEBAB_DATA_DIR || '').trim();
  if (fromEnv && path.isAbsolute(fromEnv)) {
    const resolved = path.resolve(fromEnv);
    const root = path.parse(resolved).root;
    if (resolved !== root) return resolved;
  }
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
  minecraftResources: 'https://resources.download.minecraft.net',
  modrinthApi: 'https://api.modrinth.com/v2',
  fabricMeta: 'https://meta.fabricmc.net/v2',
  fabricMaven: 'https://maven.fabricmc.net/',
  quiltMeta: 'https://meta.quiltmc.org/v3',
  quiltMaven: 'https://maven.quiltmc.org/repository/release/',
  adoptiumApi: 'https://api.adoptium.net',
  mcServicesBase: 'https://api.minecraftservices.com',
  msAuthorize: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
  msToken: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  liveLegacyRedirect: 'https://login.live.com/oauth20_desktop.srf',
  xboxUserAuth: 'https://user.auth.xboxlive.com/user/authenticate',
  xboxRelyingParty: 'http://auth.xboxlive.com',
  xstsAuthorize: 'https://xsts.auth.xboxlive.com/xsts/authorize',
  mcLoginXbox: 'https://api.minecraftservices.com/authentication/login_with_xbox',
  mcProfile: 'https://api.minecraftservices.com/minecraft/profile',
  mcProfileSkins: 'https://api.minecraftservices.com/minecraft/profile/skins',
  mcProfileCapes: 'https://api.minecraftservices.com/minecraft/profile/capes',
  sessionServerJoin: 'https://sessionserver.mojang.com/session/minecraft/join',
  downloadPage: 'https://kebabdev.de/download/',
  telemetryPing: 'https://kebabdev.de/api/ping',
  latestRelease: 'https://kebabdev.de/api/latest.json',
};

function temurinDownloadUrl(major) {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  return `${URLS.adoptiumApi}/v3/binary/latest/${major}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;
}

const BUILTIN_DISCORD_CLIENT_ID = '1549540973653004320';

function discordClientId() {
  return process.env.DISCORD_CLIENT_ID || BUILTIN_DISCORD_CLIENT_ID;
}

function msRedirectUri() {
  return 'https://login.microsoftonline.com/common/oauth2/nativeclient';
}

function microsoftClientId() {
  return process.env.MC_LAUNCHER_CLIENT_ID || process.env.AZURE_CLIENT_ID || '';
}

module.exports = {
  MC_VERSION,
  APP_NAME,
  OWN_CLIENT_ID,
  BUILTIN_DISCORD_CLIENT_ID,
  discordClientId,
  temurinDownloadUrl,
  microsoftClientId,
  URLS,
  dataDir,
  defaultDataDir,
  bootstrapFile,
  instanceDir,
  instancesRoot,
  sharedLibrariesDir,
  sharedAssetsDir,
  msRedirectUri,
};
