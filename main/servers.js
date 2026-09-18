'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { instanceDir } = require('./config');
const { loadState, saveState } = require('./store');
const { buildServersDat, parseServersDat } = require('./nbt');

function listServers() {
  const state = loadState();
  return Array.isArray(state.servers) ? state.servers : [];
}

function listCategories() {
  const state = loadState();
  const cats = Array.isArray(state.serverCategories) ? state.serverCategories : [];
  return cats.filter((c) => c && c.id && c.name);
}

function saveCategories(categories) {
  saveState({ serverCategories: categories });
  return categories;
}

function normalizeInvite(value) {
  if (value === undefined || value === null) return undefined;
  const clean = String(value).trim();
  if (!clean) return null;
  if (clean.length > 256) throw new Error('Invite link is too long (max 256).');
  let url = clean;
  if (/^discord\.gg\//i.test(url)) url = `https://${url}`;
  if (!/^https?:\/\//i.test(url)) throw new Error('Invite must be a link (https://… or discord.gg/…).');
  return url;
}

function findCategory(id) {
  return listCategories().find((c) => c.id === id) || null;
}

function addCategory(name) {
  const clean = String(name || '').trim().slice(0, 48);
  if (!clean) throw new Error('Category name is required.');
  const categories = listCategories();
  if (categories.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error('Category already exists.');
  }
  categories.push({ id: crypto.randomUUID(), name: clean });
  return saveCategories(categories);
}

function renameCategory(id, name) {
  const clean = String(name || '').trim().slice(0, 48);
  if (!clean) throw new Error('Category name is required.');
  const categories = listCategories();
  const entry = categories.find((c) => c.id === id);
  if (!entry) throw new Error('Category not found.');
  if (categories.some((c) => c.id !== id && c.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error('Category already exists.');
  }
  entry.name = clean;
  return saveCategories(categories);
}

function deleteCategory(id) {
  const categories = listCategories().filter((c) => c.id !== id);
  saveCategories(categories);
  const servers = listServers();
  let changed = false;
  for (const s of servers) {
    if (s && s.categoryId === id) {
      s.categoryId = null;
      changed = true;
    }
  }
  if (changed) return saveServers(servers);
  syncToAllInstances(servers);
  return servers;
}

function saveServers(servers) {
  saveState({ servers });
  syncToAllInstances(servers);
  return servers;
}

function mergeServers(managed, existing, removedKeys) {
  const key = (s) => String((s && s.ip) || '').trim().toLowerCase();
  const managedKeys = new Set((managed || []).map(key));
  const removed = removedKeys instanceof Set ? removedKeys : new Set(removedKeys || []);
  const extras = (existing || []).filter((s) => s && s.ip && !managedKeys.has(key(s)) && !removed.has(key(s)));
  const clean = (s) => ({ name: String(s.name || ''), ip: String(s.ip || '') });
  return [...(managed || []).map(clean), ...extras.map(clean)];
}

function activeServers(servers) {
  return (servers || listServers()).filter((s) => s && !s.disabled);
}

function removedServerKeys(servers) {
  const keys = new Set();
  for (const s of servers || listServers()) {
    if (s && s.disabled && s.ip) keys.add(String(s.ip).trim().toLowerCase());
  }
  return keys;
}

function syncToInstance(servers, root) {
  const full = servers || listServers();
  const list = activeServers(full);
  const removed = removedServerKeys(full);
  const dir = root || instanceDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'servers.dat');
  let existing = [];
  try {
    if (fs.existsSync(file)) existing = parseServersDat(fs.readFileSync(file));
  } catch {}
  fs.writeFileSync(file, buildServersDat(mergeServers(list, existing, removed)));
  return list;
}

function syncToAllInstances(servers) {
  let instances = [];
  try {
    instances = require('./instances').listInstances();
  } catch { return servers || listServers(); }
  const { dirsFor } = require('./minecraft');
  for (const instance of instances) {
    try {
      syncToInstance(servers, dirsFor(instance).root);
    } catch {}
  }
  return servers || listServers();
}

const MAX_NAME_LEN = 128;
const MAX_IP_LEN = 256;

function assertServerFields(name, ip) {
  if (!name) throw new Error('Server name is required.');
  if (!ip) throw new Error('Server IP is required.');
  if (name.length > MAX_NAME_LEN) throw new Error(`Server name is too long (max ${MAX_NAME_LEN}).`);
  if (ip.length > MAX_IP_LEN) throw new Error(`Server IP is too long (max ${MAX_IP_LEN}).`);
  if (Buffer.byteLength(name, 'utf8') > 2000) throw new Error('Server name is too long (UTF-8).');
  if (Buffer.byteLength(ip, 'utf8') > 2000) throw new Error('Server IP is too long (UTF-8).');
}

function addServer(name, ip, categoryId, invite) {
  const cleanName = String(name || '').trim();
  const cleanIp = String(ip || '').trim();
  assertServerFields(cleanName, cleanIp);
  let cat = null;
  if (categoryId) {
    cat = findCategory(String(categoryId));
    if (!cat) throw new Error('Category not found.');
  }
  const cleanInvite = normalizeInvite(invite);
  const servers = listServers();
  servers.push({
    id: crypto.randomUUID(),
    name: cleanName,
    ip: cleanIp,
    categoryId: cat ? cat.id : null,
    invite: cleanInvite === undefined ? null : cleanInvite,
    disabled: false
  });
  return saveServers(servers);
}

function updateServer(id, name, ip, extra) {
  const servers = listServers();
  const entry = servers.find((s) => s.id === id);
  if (!entry) throw new Error('Server not found.');
  if (name !== undefined) {
    const cleanName = String(name).trim();
    if (!cleanName) throw new Error('Server name is required.');
    if (cleanName.length > MAX_NAME_LEN) throw new Error(`Server name is too long (max ${MAX_NAME_LEN}).`);
    entry.name = cleanName;
  }
  if (ip !== undefined) {
    const cleanIp = String(ip).trim();
    if (!cleanIp) throw new Error('Server IP is required.');
    if (cleanIp.length > MAX_IP_LEN) throw new Error(`Server IP is too long (max ${MAX_IP_LEN}).`);
    entry.ip = cleanIp;
  }
  if (extra && typeof extra === 'object') {
    if ('categoryId' in extra) {
      const cat = extra.categoryId ? findCategory(String(extra.categoryId)) : null;
      if (extra.categoryId && !cat) throw new Error('Category not found.');
      entry.categoryId = cat ? cat.id : null;
    }
    if ('invite' in extra) entry.invite = normalizeInvite(extra.invite);
    if ('disabled' in extra) entry.disabled = !!extra.disabled;
  }
  return saveServers(servers);
}

function setServerDisabled(id, disabled) {
  const servers = listServers();
  const entry = servers.find((s) => s.id === id);
  if (!entry) throw new Error('Server not found.');
  entry.disabled = !!disabled;
  return saveServers(servers);
}

function removeServer(id) {
  const servers = listServers().filter((s) => s.id !== id);
  return saveServers(servers);
}

function moveServer(id, direction) {
  const servers = listServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) throw new Error('Server not found.');
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= servers.length) return servers;
  [servers[idx], servers[target]] = [servers[target], servers[idx]];
  return saveServers(servers);
}

module.exports = {
  listServers,
  listCategories,
  addCategory,
  renameCategory,
  deleteCategory,
  addServer,
  updateServer,
  setServerDisabled,
  removeServer,
  moveServer,
  syncToInstance,
  syncToAllInstances
};
