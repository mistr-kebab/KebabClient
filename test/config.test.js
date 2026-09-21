'use strict';

const path = require('node:path');
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const TEST_DIR = path.join(__dirname, '..', '.test-data-config');

function loadConfig() {
  const { dataDir, defaultDataDir, bootstrapFile, instanceDir, instancesRoot, sharedLibrariesDir, sharedAssetsDir, microsoftClientId, msRedirectUri, URLS, MC_VERSION, APP_NAME, OWN_CLIENT_ID, discordClientId } = require('../main/config');
  return { dataDir, defaultDataDir, bootstrapFile, instanceDir, instancesRoot, sharedLibrariesDir, sharedAssetsDir, microsoftClientId, msRedirectUri, URLS, MC_VERSION, APP_NAME, OWN_CLIENT_ID, discordClientId };
}

describe('config', () => {
  beforeEach(() => {
    if (require('fs').existsSync(TEST_DIR)) require('fs').rmSync(TEST_DIR, { recursive: true, force: true });
    require('fs').mkdirSync(TEST_DIR, { recursive: true });
    process.env.APPDATA = TEST_DIR;
    process.env.KEBAB_DATA_DIR = '';
    process.env.MC_LAUNCHER_CLIENT_ID = '';
  });

  afterEach(() => {
    if (require('fs').existsSync(TEST_DIR)) require('fs').rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.APPDATA;
    delete process.env.KEBAB_DATA_DIR;
    delete process.env.MC_LAUNCHER_CLIENT_ID;
  });

  it('MC_VERSION is 26.1.2', () => {
    const { MC_VERSION } = loadConfig();
    assert.strictEqual(MC_VERSION, '26.1.2');
  });

  it('APP_NAME is KebabClient', () => {
    const { APP_NAME } = loadConfig();
    assert.strictEqual(APP_NAME, 'KebabClient');
  });

  it('OWN_CLIENT_ID matches .env value', () => {
    const { OWN_CLIENT_ID } = loadConfig();
    assert.strictEqual(OWN_CLIENT_ID, 'b0be2e82-378f-4156-a4f5-c43506935142');
  });

  it('dataDir uses APPDATA by default', () => {
    const { dataDir, defaultDataDir } = loadConfig();
    const expected = path.join(TEST_DIR, 'KebabClient');
    assert.strictEqual(dataDir(), expected);
    assert.strictEqual(defaultDataDir(), expected);
  });

  it('KEBAB_DATA_DIR overrides dataDir', () => {
    process.env.KEBAB_DATA_DIR = path.join(TEST_DIR, 'custom');
    const { dataDir } = loadConfig();
    assert.strictEqual(dataDir(), path.join(TEST_DIR, 'custom'));
  });

  it('instanceDir includes MC_VERSION', () => {
    const { instanceDir } = loadConfig();
    assert.ok(instanceDir().includes('26.1.2'));
  });

  it('instancesRoot is parent of instanceDir', () => {
    const { instanceDir, instancesRoot } = loadConfig();
    assert.strictEqual(path.dirname(instanceDir()), instancesRoot());
  });

  it('sharedLibrariesDir and sharedAssetsDir are under dataDir', () => {
    const { sharedLibrariesDir, sharedAssetsDir, dataDir } = loadConfig();
    assert.strictEqual(sharedLibrariesDir(), path.join(dataDir(), 'libraries'));
    assert.strictEqual(sharedAssetsDir(), path.join(dataDir(), 'assets'));
  });

  it('microsoftClientId reads from env', () => {
    process.env.MC_LAUNCHER_CLIENT_ID = 'test-client-id';
    const { microsoftClientId } = loadConfig();
    assert.strictEqual(typeof microsoftClientId, 'function');
    assert.strictEqual(microsoftClientId(), 'test-client-id');
  });

  it('msRedirectUri is correct', () => {
    const { msRedirectUri } = loadConfig();
    assert.strictEqual(msRedirectUri(), 'https://login.microsoftonline.com/common/oauth2/nativeclient');
  });

  it('URLS contains required endpoints', () => {
    const { URLS } = loadConfig();
    assert.ok(URLS.pistonMetaManifest.startsWith('https://'));
    assert.ok(URLS.modrinthApi.startsWith('https://'));
    assert.ok(URLS.msAuthorize.startsWith('https://'));
    assert.ok(URLS.msToken.startsWith('https://'));
    assert.ok(URLS.xboxUserAuth.startsWith('https://'));
    assert.ok(URLS.xstsAuthorize.startsWith('https://'));
    assert.ok(URLS.mcLoginXbox.startsWith('https://'));
    assert.ok(URLS.mcProfile.startsWith('https://'));
    assert.ok(URLS.sessionServerJoin.startsWith('https://'));
  });

  it('discordClientId falls back to built-in', () => {
    const { discordClientId } = loadConfig();
    assert.strictEqual(discordClientId(), '1549540973653004320');
  });

  it('discordClientId reads from env', () => {
    process.env.DISCORD_CLIENT_ID = 'custom-discord-id';
    const { discordClientId } = loadConfig();
    assert.strictEqual(discordClientId(), 'custom-discord-id');
  });

  it('temurinDownloadUrl returns valid URL', () => {
    const { temurinDownloadUrl } = require('../main/config');
    const url = temurinDownloadUrl(21);
    assert.ok(url.startsWith('https://api.adoptium.net/v3/binary/latest/21/ga/'));
    assert.ok(url.includes('/jre/hotspot/normal/eclipse'));
  });

  it('bootstrapFile returns .datadir path', () => {
    const { bootstrapFile } = loadConfig();
    assert.ok(bootstrapFile().endsWith('.datadir'));
  });

  it('instanceDir includes MC_VERSION', () => {
    const { instanceDir } = loadConfig();
    const dir = instanceDir();
    assert.ok(dir.includes('26.1.2'));
  });
});