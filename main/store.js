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
  } catch (err) {
    console.warn(`[store] Failed to read JSON from ${file}:`, err?.message || err);
    return fallback;
  }
}

function writeAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  fs.writeFileSync(tmp, data);
  try {
    fs.chmodSync(tmp, 0o600);
  } catch (err) {
    console.warn('[store] chmod failed:', err?.message || err);
  }
  fs.renameSync(tmp, file);
}

function writeJson(file, obj) {
  writeAtomic(file, JSON.stringify(obj, null, 2));
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
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is unavailable on this system. Sign-in is disabled to protect your refresh token.');
  }
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  const payload = safeStorage.encryptString(raw.toString('utf8'));
  writeAtomic(secretsFile(), payload);
}

function loadSecrets() {
  try {
    const buf = fs.readFileSync(secretsFile());
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return JSON.parse(safeStorage.decryptString(buf));
      } catch (err) {
        console.warn('[store] Failed to decrypt secrets:', err?.message || err);
        try {
          const legacy = JSON.parse(buf.toString('utf8'));
          if (legacy && typeof legacy === 'object') {
            console.warn('[store] Found legacy plaintext secrets, removing.');
            try {
              fs.unlinkSync(secretsFile());
            } catch (err) {
              console.warn('[store] Could not remove legacy secrets file:', err?.message || err);
            }
          }
        } catch (err) {
          console.warn('[store] Legacy secrets parse failed:', err?.message || err);
        }
        return null;
      }
    }
    return null;
  } catch (err) {
    console.warn('[store] Could not read secrets file:', err?.message || err);
    return null;
  }
}

function clearSecrets() {
  try {
    fs.unlinkSync(secretsFile());
  } catch (err) {
    console.warn('[store] Could not clear secrets:', err?.message || err);
  }
}

module.exports = {
  loadState,
  saveState,
  saveSecrets,
  loadSecrets,
  clearSecrets,
};
