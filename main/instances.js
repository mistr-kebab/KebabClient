'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MC_VERSION, dataDir, instancesRoot } = require('./config');
const { loadState, saveState } = require('./store');

const LOADERS = ['vanilla', 'fabric', 'quilt'];
const LOADER_NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt' };

function loaderDisplayName(loader) {
  return LOADER_NAMES[loader] || String(loader || 'Vanilla');
}

function defaultInstanceName(instances, mc, loader) {
  const base = `${loaderDisplayName(loader)} ${mc}`;
  if (!instances.some((i) => i.name === base)) return base;
  let n = 2;
  while (instances.some((i) => i.name === `${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

function sanitizeDirName(name) {
  let s = String(name || '').trim().replace(/[<>:\"/\\|?*\x00-\x1f]/g, '_');
  s = s.replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  if (!s) s = 'instance';
  return s.slice(0, 80);
}

function isGameRunning() {
  try {
    return require('./minecraft').isRunning();
  } catch {
    return false;
  }
}

function migrateInstanceDirs(state) {
  const list = state.instances || [];
  if (!list.length) return state;
  if (isGameRunning()) return state;
  let changed = false;
  for (const entry of list) {
    const base = sanitizeDirName(entry.name);
    if (entry.dir === base) continue;
    const taken = new Set(
      list.filter((i) => i.id !== entry.id).map((i) => String(i.dir || '').toLowerCase())
    );
    let candidate = base;
    let n = 2;
    const oldLower = String(entry.dir || '').toLowerCase();
    while (
      taken.has(candidate.toLowerCase()) ||
      (candidate.toLowerCase() !== oldLower && fs.existsSync(path.join(instancesRoot(), candidate)))
    ) {
      candidate = `${base} ${n}`;
      n += 1;
    }
    if (candidate.toLowerCase() === oldLower) {
      entry.dir = candidate;
      changed = true;
      continue;
    }
    const oldPath = path.join(instancesRoot(), entry.dir);
    if (fs.existsSync(oldPath)) {
      try {
        fs.renameSync(oldPath, path.join(instancesRoot(), candidate));
      } catch {
        continue;
      }
    }
    entry.dir = candidate;
    changed = true;
  }
  if (changed) saveState({ instances: list });
  return state;
}

function uniqueDirName(instances, base, selfId) {
  const taken = new Set(
    instances.filter((i) => i.id !== selfId).map((i) => String(i.dir || '').toLowerCase())
  );
  let candidate = base;
  let n = 2;
  while (
    taken.has(candidate.toLowerCase()) ||
    fs.existsSync(path.join(instancesRoot(), candidate))
  ) {
    candidate = `${base} ${n}`;
    n += 1;
  }
  return candidate;
}

function ensureSeeded() {
  const state = loadState();
  if (!Array.isArray(state.instances)) {
    migrateLegacy();
    const seed = {
      id: 'default',
      name: `Minecraft ${MC_VERSION}`,
      mc: MC_VERSION,
      loader: 'vanilla',
      loaderVersion: null,
      variantId: MC_VERSION,
      dir: MC_VERSION,
      createdAt: Date.now(),
      lastPlayed: 0
    };
    saveState({ instances: [seed], activeInstanceId: 'default' });
  }
  return migrateInstanceDirs(loadState());
}

function migrateLegacy() {
  try {
    const legacyRoot = path.join(instancesRoot(), MC_VERSION);
    const sharedLib = path.join(dataDir(), 'libraries');
    const sharedAssets = path.join(dataDir(), 'assets');
    fs.mkdirSync(dataDir(), { recursive: true });
    if (fs.existsSync(path.join(legacyRoot, 'libraries')) && !fs.existsSync(sharedLib)) {
      fs.renameSync(path.join(legacyRoot, 'libraries'), sharedLib);
    }
    if (fs.existsSync(path.join(legacyRoot, 'assets')) && !fs.existsSync(sharedAssets)) {
      fs.renameSync(path.join(legacyRoot, 'assets'), sharedAssets);
    }
    const oldMarker = path.join(legacyRoot, '.verified.json');
    const newMarker = path.join(legacyRoot, `.verified-${MC_VERSION}.json`);
    if (fs.existsSync(oldMarker) && !fs.existsSync(newMarker)) {
      fs.renameSync(oldMarker, newMarker);
    }
  } catch {}
}

function listInstances() {
  return ensureSeeded().instances;
}

function getInstance(id) {
  const found = listInstances().find((i) => i.id === id);
  if (!found) throw new Error(`Instance not found: ${id}`);
  return found;
}

function getActiveInstance() {
  const state = ensureSeeded();
  const list = state.instances || [];
  if (!list.length) return null;
  return list.find((i) => i.id === state.activeInstanceId) || list[0];
}

function setActiveInstance(id) {
  getInstance(id);
  saveState({ activeInstanceId: id });
  return getActiveInstance();
}

function persistInstances(instances, activeId) {
  const patch = { instances };
  if (activeId !== undefined) patch.activeInstanceId = activeId;
  saveState(patch);
  return listInstances();
}

function provisionalVariantId(mc, loader, loaderVersion) {
  if (loader === 'vanilla') return mc;
  return `${loader}-loader-${loaderVersion}-${mc}`;
}

function createInstance({ name, mc, loader }) {
  const cleanMc = String(mc || '').trim();
  if (!/^[0-9a-z._-]+$/i.test(cleanMc)) throw new Error('Invalid Minecraft version.');
  if (!LOADERS.includes(loader)) throw new Error(`Unsupported loader: ${loader}.`);
  const instances = listInstances();
  const cleanName = String(name || '').trim().slice(0, 48) || defaultInstanceName(instances, cleanMc, loader);
  const instance = {
    id: 'i' + crypto.randomBytes(4).toString('hex'),
    name: cleanName,
    mc: cleanMc,
    loader,
    loaderVersion: null,
    variantId: provisionalVariantId(cleanMc, loader, 'latest'),
    dir: uniqueDirName(instances, sanitizeDirName(cleanName)),
    createdAt: Date.now(),
    lastPlayed: 0
  };
  if (loader !== 'vanilla') {
    instance.variantId = provisionalVariantId(cleanMc, loader, 'pending');
  }
  instances.push(instance);
  persistInstances(instances, instance.id);
  return instance;
}

function setLoaderVersion(id, loaderVersion, variantId) {
  const instances = listInstances();
  const entry = instances.find((i) => i.id === id);
  if (!entry) throw new Error('Instance not found.');
  entry.loaderVersion = loaderVersion;
  if (variantId) entry.variantId = variantId;
  persistInstances(instances);
  return entry;
}

function renameInstance(id, name) {
  const instances = listInstances();
  const entry = instances.find((i) => i.id === id);
  if (!entry) throw new Error('Instance not found.');
  const cleanName = String(name || '').trim().slice(0, 48)
    || defaultInstanceName(instances.filter((i) => i.id !== id), entry.mc, entry.loader);
  const newDir = uniqueDirName(instances, sanitizeDirName(cleanName), entry.id);
  if (newDir !== entry.dir) {
    if (isGameRunning()) throw new Error('Stop the game before renaming the instance.');
    const oldPath = path.join(instancesRoot(), entry.dir);
    if (fs.existsSync(oldPath)) {
      try {
        fs.renameSync(oldPath, path.join(instancesRoot(), newDir));
      } catch (err) {
        throw new Error(`Could not rename folder: ${err.message}`);
      }
    }
    entry.dir = newDir;
  }
  entry.name = cleanName;
  persistInstances(instances);
  return entry;
}

function deleteInstance(id) {
  const instances = listInstances();
  const entry = instances.find((i) => i.id === id);
  if (!entry) throw new Error('Instance not found.');
  const rest = instances.filter((i) => i.id !== id);
  const state = loadState();
  const nextActive = state.activeInstanceId === id
    ? (rest.length ? rest[0].id : null)
    : (state.activeInstanceId || null);
  persistInstances(rest, nextActive);
  try {
    fs.rmSync(path.join(instancesRoot(), entry.dir), { recursive: true, force: true });
  } catch {}
  return rest;
}

function touchLastPlayed(id) {
  try {
    const instances = listInstances();
    const entry = instances.find((i) => i.id === id);
    if (entry) {
      entry.lastPlayed = Date.now();
      persistInstances(instances);
    }
  } catch {}
}

const ICON_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const ICON_MAX_BYTES = 2 * 1024 * 1024;

function instanceDir(entry) {
  return path.join(instancesRoot(), entry.dir);
}

function iconPathFor(entry) {
  if (!entry || !entry.icon) return null;
  return path.join(instanceDir(entry), path.basename(String(entry.icon)));
}

function setInstanceIcon(id, srcPath) {
  const instances = listInstances();
  const entry = instances.find((i) => i.id === id);
  if (!entry) throw new Error('Instance not found.');
  const src = String(srcPath || '');
  if (!src || !fs.existsSync(src)) throw new Error('Image file not found.');
  const ext = path.extname(src).toLowerCase();
  if (!ICON_EXTS.includes(ext)) throw new Error('Icon must be PNG, JPG or WebP.');
  if (fs.statSync(src).size > ICON_MAX_BYTES) throw new Error('Icon must be smaller than 2 MB.');
  const destName = `icon${ext}`;
  fs.mkdirSync(instanceDir(entry), { recursive: true });
  try {
    const old = iconPathFor(entry);
    if (old && path.resolve(old) !== path.resolve(path.join(instanceDir(entry), destName)) && fs.existsSync(old)) {
      fs.unlinkSync(old);
    }
  } catch {}
  fs.copyFileSync(src, path.join(instanceDir(entry), destName));
  entry.icon = destName;
  persistInstances(instances);
  return entry;
}

function clearInstanceIcon(id) {
  const instances = listInstances();
  const entry = instances.find((i) => i.id === id);
  if (!entry) throw new Error('Instance not found.');
  try {
    const old = iconPathFor(entry);
    if (old && fs.existsSync(old)) fs.unlinkSync(old);
  } catch {}
  entry.icon = null;
  persistInstances(instances);
  return entry;
}

function iconDataUrl(entry) {
  try {
    const full = iconPathFor(entry);
    if (!full || !fs.existsSync(full)) return null;
    const ext = path.extname(full).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
  } catch {
    return null;
  }
}

function fmtPlaytime(ms) {
  const totalMin = Math.floor((Number(ms) || 0) / 60000);
  if (totalMin <= 0) return '';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} min`;
  return `${h}h ${m}m`;
}

function describeInstance(entry) {
  if (!entry) return entry;
  return { ...entry, iconDataUrl: iconDataUrl(entry), playtimeText: fmtPlaytime(entry.totalPlayMs) };
}

function addPlaytime(id, ms) {
  try {
    const instances = listInstances();
    const entry = instances.find((i) => i.id === id);
    if (!entry || !(ms > 0)) return;
    entry.totalPlayMs = (Number(entry.totalPlayMs) || 0) + Math.round(ms);
    persistInstances(instances);
  } catch {}
}

module.exports = {
  LOADERS,
  listInstances,
  getInstance,
  getActiveInstance,
  setActiveInstance,
  createInstance,
  setLoaderVersion,
  renameInstance,
  deleteInstance,
  touchLastPlayed,
  setInstanceIcon,
  clearInstanceIcon,
  addPlaytime,
  describeInstance,
  provisionalVariantId,
  ensureSeeded
};
