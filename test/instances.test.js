'use strict';

const electron = require('electron');
if (typeof electron === 'string') {
  // Running outside Electron - mock the module
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === 'electron') {
      return {
        app: { getVersion: () => '0.3.7', getPath: () => '' },
        BrowserWindow: function () {},
        dialog: {},
        shell: {},
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: s => Buffer.from(s),
          decryptString: b => b.toString(),
        },
      };
    }
    return originalRequire.apply(this, arguments);
  };
}

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DIR = path.join(__dirname, '..', '.test-data-instances');
const instances = require('../main/services/instances');
const { saveState, loadState } = require('../main/store');

function todayKey() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('instances playDays', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    process.env.APPDATA = TEST_DIR;
    delete process.env.KEBAB_DATA_DIR;
    saveState({ instances: [{ id: 'a', name: 'A', mc: '26.1.2', loader: 'vanilla', dir: 'a', totalPlayMs: 0 }] });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.APPDATA;
  });

  it('buckets playtime into today and keeps the instance total', () => {
    instances.addPlaytime('a', 90000);
    instances.addPlaytime('a', 30000);
    const list = instances.listInstances();
    assert.strictEqual(list.find(i => i.id === 'a').totalPlayMs, 120000);
    assert.strictEqual(instances.getPlayDays()[todayKey()], 120000);
  });

  it('ignores unknown instances and non-positive durations', () => {
    instances.addPlaytime('nope', 60000);
    instances.addPlaytime('a', 0);
    instances.addPlaytime('a', -5);
    assert.deepStrictEqual(instances.getPlayDays(), {});
    assert.strictEqual(loadState().playDays, undefined);
  });

  it('prunes buckets older than 31 days', () => {
    saveState({
      playDays: { '2000-01-01': 5000, [todayKey()]: 1000 },
    });
    instances.addPlaytime('a', 60000);
    const days = instances.getPlayDays();
    assert.strictEqual(days['2000-01-01'], undefined);
    assert.strictEqual(days[todayKey()], 61000);
  });
});
