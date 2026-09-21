'use strict';

// Mock Electron's safeStorage BEFORE requiring store
const electron = require('electron');
if (typeof electron === 'string') {
  // Running outside Electron - mock the module
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function(id) {
    if (id === 'electron') {
      return {
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (s) => Buffer.from(s),
          decryptString: (b) => b.toString()
        }
      };
    }
    return originalRequire.apply(this, arguments);
  };
}

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DIR = path.join(__dirname, '..', '.test-data-store');

describe('store', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    process.env.APPDATA = TEST_DIR;
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.APPDATA;
  });

  it('loadState returns empty object for missing file', () => {
    const { loadState } = require('../main/store');
    const state = loadState();
    assert.deepStrictEqual(state, {});
  });

  it('saveState and loadState round-trip', () => {
    const { loadState, saveState } = require('../main/store');
    saveState({ foo: 'bar', count: 42 });
    const state = loadState();
    assert.strictEqual(state.foo, 'bar');
    assert.strictEqual(state.count, 42);
  });

  it('saveState merges with existing state', () => {
    const { loadState, saveState } = require('../main/store');
    saveState({ a: 1 });
    saveState({ b: 2 });
    const state = loadState();
    assert.strictEqual(state.a, 1);
    assert.strictEqual(state.b, 2);
  });

  it('saveSecrets and loadSecrets work with encryption', () => {
    const { saveSecrets, loadSecrets } = require('../main/store');
    const secret = { msRefreshToken: 'test-token', mcAccessToken: 'access-token' };
    saveSecrets(secret);
    const loaded = loadSecrets();
    assert.deepStrictEqual(loaded, secret);
  });

  it('loadSecrets returns null for missing file', () => {
    const { loadSecrets } = require('../main/store');
    const loaded = loadSecrets();
    assert.strictEqual(loaded, null);
  });

  it('clearSecrets removes secrets file', () => {
    const { saveSecrets, loadSecrets, clearSecrets } = require('../main/store');
    saveSecrets({ foo: 'bar' });
    clearSecrets();
    const loaded = loadSecrets();
    assert.strictEqual(loaded, null);
  });

  it('atomic write produces valid JSON', () => {
    const { loadState, saveState } = require('../main/store');
    saveState({ test: 'value' });
    const stateFile = path.join(TEST_DIR, 'KebabClient', 'launcher-state.json');
    assert(fs.existsSync(stateFile));
    const content = fs.readFileSync(stateFile, 'utf8');
    assert.doesNotThrow(() => JSON.parse(content));
  });

  it('secrets file has restrictive permissions on Unix (skipped on Windows)', () => {
    if (process.platform === 'win32') {
      console.log('skipped on Windows');
      return;
    }
    const { saveSecrets } = require('../main/store');
    saveSecrets({ test: 'perm' });
    const secretsFile = path.join(TEST_DIR, 'KebabClient', 'secrets.bin');
    const stats = fs.statSync(secretsFile);
    const mode = stats.mode & 0o777;
    assert.strictEqual(mode, 0o600);
  });
});