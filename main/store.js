'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { safeStorage } = require('electron');
const { dataDir } = require('./config');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function stateFile() {
  const dir = dataDir();
  ensureDir(dir);
  return path.join(dir, 'launcher-state.json');
}

function secretsFile() {
  const dir = dataDir();
  ensureDir(dir);
  return path.join(dir, 'secrets.bin');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function loadState() {
  return readJson(stateFile(), {});
}

function saveState(patch) {
  const current = loadState();
  const next = { ...current, ...patch };
  writeJson(stateFile(), next);
  return next;
}

function saveSecrets(obj) {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(raw.toString('utf8'))
    : raw;
  ensureDir(path.dirname(secretsFile()));
  fs.writeFileSync(secretsFile(), payload);
}

function loadSecrets() {
  try {
    const buf = fs.readFileSync(secretsFile());
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return JSON.parse(safeStorage.decryptString(buf));
      } catch {
        return null;
      }
    }
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

function clearSecrets() {
  try {
    fs.unlinkSync(secretsFile());
  } catch { /* noop */ }
}

module.exports = {
  loadState,
  saveState,
  saveSecrets,
  loadSecrets,
  clearSecrets
};
