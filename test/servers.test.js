'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DIR = path.join(__dirname, '..', '.test-data-servers');
const servers = require('../main/services/servers');
const { buildServersDat } = require('../main/nbt');
const { saveState } = require('../main/store');

function seedServers(list) {
  saveState({
    servers: list.map((s, i) => ({
      id: s.id || `id-${i}`,
      name: s.name,
      ip: s.ip,
      categoryId: s.categoryId || null,
      invite: s.invite || null,
      disabled: !!s.disabled,
    })),
  });
}

function writeDat(root, entries, mtime) {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'servers.dat');
  fs.writeFileSync(file, buildServersDat(entries));
  if (mtime) fs.utimesSync(file, mtime, mtime);
  return file;
}

describe('servers reconcile', () => {
  let root;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    process.env.APPDATA = TEST_DIR;
    delete process.env.KEBAB_DATA_DIR;
    root = path.join(TEST_DIR, 'instance-root');
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.APPDATA;
  });

  it('adopts the in-game order', () => {
    seedServers([
      { name: 'A', ip: 'a.example' },
      { name: 'B', ip: 'b.example' },
      { name: 'C', ip: 'c.example' },
    ]);
    writeDat(
      root,
      [
        { name: 'C', ip: 'c.example' },
        { name: 'A', ip: 'a.example' },
        { name: 'B', ip: 'b.example' },
      ],
      new Date()
    );
    const res = servers.reconcileFromInstance(root, Date.now() - 60000);
    assert.strictEqual(res.changed, true);
    assert.deepStrictEqual(
      res.servers.map(s => s.ip),
      ['c.example', 'a.example', 'b.example']
    );
    assert.deepStrictEqual(
      res.servers.map(s => s.id),
      ['id-2', 'id-0', 'id-1']
    );
  });

  it('imports servers added in-game', () => {
    seedServers([{ name: 'A', ip: 'a.example' }]);
    writeDat(root, [
      { name: 'A', ip: 'a.example' },
      { name: 'New', ip: 'new.example' },
    ], new Date());
    const res = servers.reconcileFromInstance(root, Date.now() - 60000);
    assert.strictEqual(res.changed, true);
    assert.strictEqual(res.servers.length, 2);
    const added = res.servers[1];
    assert.strictEqual(added.ip, 'new.example');
    assert.strictEqual(added.name, 'New');
    assert.strictEqual(added.categoryId, null);
    assert.strictEqual(added.disabled, false);
    assert.ok(added.id && added.id !== 'id-0');
  });

  it('adopts in-game renames', () => {
    seedServers([{ name: 'Old', ip: 'a.example' }]);
    writeDat(root, [{ name: 'New Name', ip: 'a.example' }], new Date());
    const res = servers.reconcileFromInstance(root, Date.now() - 60000);
    assert.strictEqual(res.changed, true);
    assert.strictEqual(res.servers[0].name, 'New Name');
    assert.strictEqual(res.servers[0].id, 'id-0');
  });

  it('keeps disabled servers that are never in servers.dat', () => {
    seedServers([
      { name: 'A', ip: 'a.example' },
      { name: 'X', ip: 'x.example', disabled: true },
    ]);
    writeDat(root, [{ name: 'A', ip: 'a.example' }], new Date());
    const res = servers.reconcileFromInstance(root, Date.now() - 60000);
    assert.strictEqual(res.changed, false);
    assert.deepStrictEqual(
      res.servers.map(s => s.ip),
      ['a.example', 'x.example']
    );
  });

  it('drops servers deleted in-game', () => {
    seedServers([
      { name: 'A', ip: 'a.example' },
      { name: 'Gone', ip: 'gone.example' },
    ]);
    writeDat(root, [{ name: 'A', ip: 'a.example' }], new Date());
    const res = servers.reconcileFromInstance(root, Date.now() - 60000);
    assert.strictEqual(res.changed, true);
    assert.deepStrictEqual(
      res.servers.map(s => s.ip),
      ['a.example']
    );
  });

  it('skips stale servers.dat from before launch', () => {
    seedServers([
      { name: 'A', ip: 'a.example' },
      { name: 'B', ip: 'b.example' },
    ]);
    writeDat(
      root,
      [
        { name: 'B', ip: 'b.example' },
        { name: 'A', ip: 'a.example' },
      ],
      new Date('2026-01-01')
    );
    const res = servers.reconcileFromInstance(root, Date.now());
    assert.strictEqual(res.changed, false);
    assert.deepStrictEqual(
      res.servers.map(s => s.ip),
      ['a.example', 'b.example']
    );
  });

  it('skips missing or corrupt servers.dat', () => {
    seedServers([{ name: 'A', ip: 'a.example' }]);
    const missing = servers.reconcileFromInstance(root, 0);
    assert.strictEqual(missing.changed, false);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'servers.dat'), Buffer.from([0x00, 0x01, 0x02]));
    const corrupt = servers.reconcileFromInstance(path.join(root), 0);
    assert.strictEqual(corrupt.changed, false);
    assert.deepStrictEqual(
      corrupt.servers.map(s => s.ip),
      ['a.example']
    );
  });

  it('dedupes repeated ips in servers.dat', () => {
    seedServers([{ name: 'A', ip: 'a.example' }]);
    writeDat(
      root,
      [
        { name: 'A', ip: 'a.example' },
        { name: 'A copy', ip: 'A.EXAMPLE' },
      ],
      new Date()
    );
    const res = servers.reconcileFromInstance(root, Date.now() - 60000);
    assert.strictEqual(res.changed, false);
    assert.strictEqual(res.servers.length, 1);
  });
});
