'use strict';

// Regression test for 0.3.2: a single invalid line in en.json made the whole
// locale unloadable, which threw in i18n.t() and killed the settings init.
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert');

const LOCALES_DIR = path.join(__dirname, '..', 'renderer', 'locales');

function loadLocale(file) {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8');
  return JSON.parse(raw);
}

describe('locales', () => {
  it('de.json parses as JSON', () => {
    const de = loadLocale('de.json');
    assert.ok(de && typeof de === 'object');
    assert.ok(Object.keys(de).length > 300);
  });

  it('en.json parses as JSON', () => {
    const en = loadLocale('en.json');
    assert.ok(en && typeof en === 'object');
    assert.ok(Object.keys(en).length > 300);
  });

  it('de and en have the same keys', () => {
    const deKeys = new Set(Object.keys(loadLocale('de.json')));
    const enKeys = new Set(Object.keys(loadLocale('en.json')));
    assert.deepStrictEqual(
      [...deKeys].filter(k => !enKeys.has(k)),
      [],
      'keys missing from en.json'
    );
    assert.deepStrictEqual(
      [...enKeys].filter(k => !deKeys.has(k)),
      [],
      'keys missing from de.json'
    );
  });

  it('no single-quoted (invalid JSON) string values', () => {
    for (const file of ['de.json', 'en.json']) {
      const raw = fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8');
      for (const line of raw.split('\n')) {
        assert.ok(!/:\s*'/.test(line), `${file} has single-quoted value: ${line.trim().slice(0, 80)}`);
      }
    }
  });
});
