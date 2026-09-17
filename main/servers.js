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

function saveServers(servers) {
  saveState({ servers });
  syncToAllInstances(servers);
  return servers;
}

function mergeServers(managed, existing) {
  const key = (s) => String((s && s.ip) || '').trim().toLowerCase();
  const managedKeys = new Set((managed || []).map(key));
  const extras = (existing || []).filter((s) => s && s.ip && !managedKeys.has(key(s)));
  const clean = (s) => ({ name: String(s.name || ''), ip: String(s.ip || '') });
  return [...(managed || []).map(clean), ...extras.map(clean)];
}

function syncToInstance(servers, root) {
  const list = servers || listServers();
  const dir = root || instanceDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'servers.dat');
  let existing = [];
  try {
    if (fs.existsSync(file)) existing = parseServersDat(fs.readFileSync(file));
  } catch {}
  fs.writeFileSync(file, buildServersDat(mergeServers(list, existing)));
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

function addServer(name, ip) {
  const cleanName = String(name || '').trim();
  const cleanIp = String(ip || '').trim();
  assertServerFields(cleanName, cleanIp);
  const servers = listServers();
  servers.push({ id: crypto.randomUUID(), name: cleanName, ip: cleanIp });
  return saveServers(servers);
}

function updateServer(id, name, ip) {
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
  addServer,
  updateServer,
  removeServer,
  moveServer,
  syncToInstance,
  syncToAllInstances
};
