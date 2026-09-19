'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { instanceDir, dataDir, instancesRoot, sharedLibrariesDir, sharedAssetsDir } = require('../config');
const { getActiveInstance } = require('../instances');

function dirsFor(instance) {
  const root = path.join(instancesRoot(), instance.dir);
  const variant = instance.variantId || instance.mc;
  const versionsBase = path.join(root, 'versions');
  const versions = path.join(versionsBase, variant);
  const libraries = sharedLibrariesDir();
  const assets = sharedAssetsDir();
  const natives = path.join(versions, `${variant}-natives`);
  const mods = path.join(root, 'mods');
  for (const d of [root, versions, libraries, assets, natives, mods]) {
    fs.mkdirSync(d, { recursive: true });
  }
  return { root, versionsBase, versions, libraries, assets, natives, mods, variant };
}

function dirs() {
  const active = getActiveInstance();
  if (!active) throw new Error('No instance selected. Create one first.');
  return dirsFor(active);
}

function markerFile(root, variant) {
  return path.join(root, `.verified-${variant}.json`);
}

function gameDataDir() {
  return dataDir();
}

module.exports = { dirsFor, dirs, markerFile, gameDataDir, instanceDir };
