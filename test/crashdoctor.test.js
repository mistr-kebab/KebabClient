'use strict';

const electron = require('electron');
if (typeof electron === 'string') {
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === 'electron') {
      return {
        app: { getVersion: () => '0.3.4', getPath: () => '' },
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

const TEST_DIR = path.join(__dirname, '..', '.test-data-crashdoctor');
const crashDoctor = require('../main/services/crashDoctor');
const { saveState } = require('../main/store');

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function seedInstance(id) {
  saveState({
    instances: [{ id, name: id, mc: '1.21.1', loader: 'fabric', dir: id }],
    activeInstanceId: id,
    settings: { java: { path: '', xmx: 4, extraArgs: '' } },
  });
  return path.join(TEST_DIR, 'KebabClient', 'instances', id);
}

describe('crashdoctor', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    process.env.APPDATA = TEST_DIR;
    delete process.env.KEBAB_DATA_DIR;
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.APPDATA;
  });

  it('loads 5-8 valid rules', () => {
    const rules = crashDoctor.loadRules();
    assert.ok(rules.length >= 5 && rules.length <= 8);
    for (const r of rules) {
      assert.ok(r.id && r.patterns.length > 0);
      assert.ok(['increase_ram', 'disable_mod', 'install_dependency', 'switch_version', 'none'].includes(r.fixType));
      assert.ok(r.title.de && r.title.en && r.body.de && r.body.en);
    }
  });

  it('finds the newest report and respects sinceMs', () => {
    const root = seedInstance('inst-1');
    const dir = path.join(root, 'crash-reports');
    writeFile(path.join(dir, 'crash-2026-01-01_00.00.00-client.txt'), 'old');
    fs.utimesSync(path.join(dir, 'crash-2026-01-01_00.00.00-client.txt'), new Date('2026-01-01'), new Date('2026-01-01'));
    writeFile(path.join(dir, 'crash-2026-09-24_12.00.00-client.txt'), 'new');
    const all = crashDoctor.listReports(root);
    assert.strictEqual(all.length, 2);
    assert.strictEqual(all[0].file, 'crash-2026-09-24_12.00.00-client.txt');
    assert.strictEqual(crashDoctor.newestReport(root, 0).file, 'crash-2026-09-24_12.00.00-client.txt');
    assert.strictEqual(crashDoctor.newestReport(root, Date.now() + 60000), null);
  });

  it('scanAfterExit ignores reports older than launch', () => {
    const root = seedInstance('inst-2');
    writeFile(path.join(root, 'crash-reports', 'crash-old.txt'), 'old');
    fs.utimesSync(
      path.join(root, 'crash-reports', 'crash-old.txt'),
      new Date('2026-01-01'),
      new Date('2026-01-01')
    );
    assert.strictEqual(crashDoctor.scanAfterExit('inst-2', Date.now()), null);
    writeFile(path.join(root, 'crash-reports', 'crash-fresh.txt'), 'fresh');
    assert.strictEqual(crashDoctor.scanAfterExit('inst-2', Date.now() - 60000), 'crash-fresh.txt');
  });

  it('reads the last N lines of a log', () => {
    const file = path.join(TEST_DIR, 'latest.log');
    writeFile(file, Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n'));
    const tail = crashDoctor.readLastLines(file, 120, 256 * 1024).split('\n');
    assert.strictEqual(tail.length, 120);
    assert.strictEqual(tail[0], 'line 80');
    assert.strictEqual(tail[119], 'line 199');
    assert.strictEqual(crashDoctor.readLastLines(path.join(TEST_DIR, 'missing.log'), 120, 1024), '');
  });

  it('extracts jar mentions deduplicated', () => {
    const jars = crashDoctor.jarMentions('caused by foo-bar_1.2.jar and FOO-bar_1.2.jar plus kubejs-fabric-1.0.jar');
    assert.deepStrictEqual(jars, ['foo-bar_1.2.jar', 'kubejs-fabric-1.0.jar']);
  });

  it('extracts dependency mod ids', () => {
    assert.deepStrictEqual(crashDoctor.buildDepPayload("requires fabric API version 0.102"), {
      mods: [{ modId: 'fabric-api' }],
    });
    assert.deepStrictEqual(crashDoctor.buildDepPayload("Mod ID: 'jei', requested by whatever"), {
      mods: [{ modId: 'jei' }],
    });
    assert.strictEqual(crashDoctor.buildDepPayload('requires minecraft 1.21'), null);
    assert.strictEqual(crashDoctor.buildDepPayload('nothing relevant here'), null);
  });

  it('parses modern loader errors without garbage ids', () => {
    const text = [
      '[main/INFO]: Immediate reason: [HARD_DEP_NO_CANDIDATE betterf3 17.0.0 {depends fabric @ [*]}]',
      '[main/INFO]: Fix: add [add:fabric 1 ([(-∞,∞)]), add:fabric-api 0.140.0+1.21.11 ([[0.140.0,∞)])], remove [], replace []',
      '[main/ERROR]: Incompatible mods found!',
      " - Mod 'BetterF3' (betterf3) 17.0.0 requires any version of fabric, which is missing!",
      " - Mod 'Continuity' (continuity) 3.0.1 requires version 0.140.0 or later of fabric-api, which is missing!",
      ' - Install fabric-api, version 0.140.0 or later.',
    ].join('\n');
    assert.deepStrictEqual(crashDoctor.buildDepPayload(text), { mods: [{ modId: 'fabric-api' }] });
  });

  it('maps mod ids from loader errors to installed files', () => {
    const root = seedInstance('inst-8');
    writeFile(path.join(root, 'mods', 'continuity-3.0.1.jar'), 'fake');
    writeFile(path.join(root, 'mods', 'sodium-1.0.jar'), 'fake');
    const text = " - Mod 'Continuity' (continuity) 3.0.1 requires version 0.140.0 or later of fabric-api, which is missing!";
    assert.deepStrictEqual(crashDoctor.buildSwitchPayload(text, 'inst-8'), {
      file: 'continuity-3.0.1.jar',
      category: 'mod',
    });
  });

  it('snaps ram targets to known options', () => {
    assert.strictEqual(crashDoctor.snapRam(5), 6);
    assert.strictEqual(crashDoctor.snapRam(6), 6);
    assert.strictEqual(crashDoctor.snapRam(7), 8);
    assert.strictEqual(crashDoctor.snapRam(20), 16);
  });

  it('analyzes an OOM crash with ram fix', () => {
    const root = seedInstance('inst-3');
    writeFile(
      path.join(root, 'crash-reports', 'crash-oom.txt'),
      '---- Minecraft Crash Report ----\njava.lang.OutOfMemoryError: Java heap space\n\tat net.minecraft.Foo.bar(Foo.java:1)'
    );
    writeFile(path.join(root, 'logs', 'latest.log'), '[Render thread/INFO]: hello\n');
    const res = crashDoctor.analyze('inst-3');
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.ruleId, 'oom');
    assert.strictEqual(res.fixType, 'increase_ram');
    assert.deepStrictEqual(res.fixPayload, { fromGb: 4, toGb: 6 });
    assert.ok(res.rawExcerpt.includes('OutOfMemoryError'));
    assert.ok(res.title.de && res.title.en && res.body.de && res.body.en);
  });

  it('returns none when nothing matches', () => {
    const root = seedInstance('inst-4');
    writeFile(path.join(root, 'logs', 'latest.log'), 'all good\nnothing to see\n');
    const res = crashDoctor.analyze('inst-4');
    assert.strictEqual(res.matched, false);
    assert.strictEqual(res.fixType, 'none');
    assert.ok(res.rawExcerpt.includes('all good'));
  });

  it('applies the ram fix through settings', async () => {
    seedInstance('inst-5');
    const res = await crashDoctor.applyFix('inst-5', 'increase_ram', { toGb: 6 });
    assert.deepStrictEqual(res, { ok: true, xmx: 6 });
    const { loadState } = require('../main/store');
    assert.strictEqual(loadState().settings.java.xmx, 6);
  });

  it('disables a conflicting mod file', async () => {
    const root = seedInstance('inst-6');
    writeFile(path.join(root, 'mods', 'optifine-1.21.jar'), 'fake');
    const res = await crashDoctor.applyFix('inst-6', 'disable_mod', { file: 'optifine-1.21.jar' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.disabled, true);
    assert.ok(fs.existsSync(path.join(root, 'mods', 'optifine-1.21.jar.disabled')));
  });

  it('rejects unknown fix types', async () => {
    seedInstance('inst-7');
    await assert.rejects(crashDoctor.applyFix('inst-7', 'teleport', {}), /Unknown fix type/);
    await assert.rejects(crashDoctor.applyFix('inst-7', 'switch_version', {}), /handled in the UI/);
  });
});
