'use strict';

// Mock Electron BEFORE requiring the ban service (same pattern as store.test.js)
const electron = require('electron');
if (typeof electron === 'string') {
  // Running outside Electron - mock the module
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === 'electron') {
      return {
        app: { getVersion: () => '0.3.3' },
        BrowserWindow: function () {},
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

const TEST_DIR = path.join(__dirname, '..', '.test-data-ban');
const ban = require('../main/services/ban');
const { saveState } = require('../main/store');

function jsonResponse(status, body, retryAfter) {
  return {
    status,
    json: async () => body,
    headers: { get: name => (String(name).toLowerCase() === 'retry-after' ? retryAfter ?? null : null) },
  };
}

describe('ban', () => {
  let realFetch;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    process.env.APPDATA = TEST_DIR;
    delete process.env.KEBAB_DATA_DIR;
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.APPDATA;
  });

  describe('config', () => {
    it('discord invite URL is a valid discord invite link', () => {
      const { URLS } = require('../main/config');
      assert.ok(/^https:\/\/(discord\.gg|discord\.com\/invite)\//.test(URLS.discordInvite));
    });
  });

  describe('normalizeUuid', () => {
    it('lowercases and strips dashes', () => {
      assert.strictEqual(ban.normalizeUuid('A1B2C3D4-E5F6-4789-ABCD-EF0123456789'), 'a1b2c3d4e5f64789abcdef0123456789');
    });

    it('passes through dashless uuids and empties', () => {
      assert.strictEqual(ban.normalizeUuid('a1b2c3d4e5f64789abcdef0123456789'), 'a1b2c3d4e5f64789abcdef0123456789');
      assert.strictEqual(ban.normalizeUuid(''), '');
      assert.strictEqual(ban.normalizeUuid(null), '');
      assert.strictEqual(ban.normalizeUuid(undefined), '');
    });
  });

  describe('validatePayload', () => {
    const valid = {
      installId: 'test-id_09AZ',
      uuid: 'a1b2c3d4e5f64789abcdef0123456789',
      username: 'Steve_99',
      version: '0.3.3',
    };

    it('accepts a full valid payload', () => {
      assert.strictEqual(ban.validatePayload(valid), null);
    });

    it('accepts pre-login payload with empty uuid/username', () => {
      assert.strictEqual(ban.validatePayload({ ...valid, uuid: '', username: '' }), null);
    });

    it('rejects bad installId', () => {
      assert.ok(ban.validatePayload({ ...valid, installId: 'ab' }));
      assert.ok(ban.validatePayload({ ...valid, installId: 'has space!' }));
      assert.ok(ban.validatePayload({ ...valid, installId: 'x'.repeat(65) }));
    });

    it('rejects bad uuid', () => {
      assert.ok(ban.validatePayload({ ...valid, uuid: 'A1B2C3D4-E5F6-4789-ABCD-EF0123456789' }));
      assert.ok(ban.validatePayload({ ...valid, uuid: 'not-a-uuid' }));
      assert.ok(ban.validatePayload({ ...valid, uuid: 'a1b2' }));
    });

    it('rejects bad username', () => {
      assert.ok(ban.validatePayload({ ...valid, username: 'ab' }));
      assert.ok(ban.validatePayload({ ...valid, username: 'x'.repeat(17) }));
      assert.ok(ban.validatePayload({ ...valid, username: 'evil!name' }));
    });

    it('rejects bad version', () => {
      assert.ok(ban.validatePayload({ ...valid, version: '' }));
      assert.ok(ban.validatePayload({ ...valid, version: 'x'.repeat(33) }));
    });
  });

  describe('checkNow', () => {
    it('returns banned with reason on banned=true', async () => {
      globalThis.fetch = async () => jsonResponse(200, { banned: true, reason: 'Cheating' });
      const res = await ban.checkNow({ timeoutMs: 2000 });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.banned, true);
      assert.strictEqual(res.reason, 'Cheating');
    });

    it('sends normalized uuid and stored username', async () => {
      saveState({ profile: { id: 'A1B2C3D4-E5F6-4789-ABCD-EF0123456789', name: 'Steve_99' } });
      saveState({ installId: 'test-id-1' });
      let sentBody = null;
      let sentHeaders = null;
      globalThis.fetch = async (_url, opts) => {
        sentBody = JSON.parse(opts.body);
        sentHeaders = opts.headers;
        return jsonResponse(200, { banned: false, reason: null });
      };
      const res = await ban.checkNow({ timeoutMs: 2000 });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.banned, false);
      assert.strictEqual(res.reason, null);
      assert.strictEqual(sentBody.uuid, 'a1b2c3d4e5f64789abcdef0123456789');
      assert.strictEqual(sentBody.username, 'Steve_99');
      assert.strictEqual(sentBody.installId, 'test-id-1');
      assert.strictEqual(sentBody.version, '0.3.3');
      assert.strictEqual(sentHeaders['Content-Type'], 'application/json');
    });

    it('fails open on network error', async () => {
      globalThis.fetch = async () => {
        throw new Error('DNS down');
      };
      const res = await ban.checkNow({ timeoutMs: 2000 });
      assert.strictEqual(res.ok, false);
      assert.notStrictEqual(res.banned, true);
    });

    it('fails open on timeout', async () => {
      globalThis.fetch = (_url, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      const res = await ban.checkNow({ timeoutMs: 50 });
      assert.strictEqual(res.ok, false);
    });

    it('fails open on 400', async () => {
      globalThis.fetch = async () => jsonResponse(400, { error: 'bad' });
      const res = await ban.checkNow({ timeoutMs: 2000 });
      assert.strictEqual(res.ok, false);
    });

    it('fails open on server error', async () => {
      globalThis.fetch = async () => jsonResponse(500, {});
      const res = await ban.checkNow({ timeoutMs: 2000 });
      assert.strictEqual(res.ok, false);
    });

    it('gives up fail-open when rate-limited with maxAttempts 1', async () => {
      globalThis.fetch = async () => jsonResponse(429, {}, '0');
      const res = await ban.checkNow({ timeoutMs: 2000, maxAttempts: 1 });
      assert.strictEqual(res.ok, false);
      assert.strictEqual(res.error, 'rate-limited');
    });

    it('retries 429 then succeeds', async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) return jsonResponse(429, {}, '0');
        return jsonResponse(200, { banned: true, reason: 'Spam' });
      };
      const res = await ban.checkNow({ timeoutMs: 2000 });
      assert.strictEqual(calls, 2);
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.banned, true);
    });

    it('treats non-boolean banned as inconclusive (never blocks)', async () => {
      globalThis.fetch = async () => jsonResponse(200, { banned: 1, reason: 'x' });
      const res = await ban.checkNow({ timeoutMs: 2000 });
      assert.strictEqual(res.ok, false);
      assert.notStrictEqual(res.banned, true);
    });

    it('truncates overlong reasons', async () => {
      globalThis.fetch = async () => jsonResponse(200, { banned: true, reason: 'x'.repeat(600) });
      const res = await ban.checkNow({ timeoutMs: 2000 });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.reason.length, 500);
    });
  });
});
