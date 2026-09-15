'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { instanceDir } = require('./config');
const { loadState, saveState } = require('./store');
const { buildServersDat } = require('./nbt');

function listServers() {
  const state = loadState();
  return Array.isArray(state.servers) ? state.servers : [];
}

function saveServers(servers) {
  saveState({ servers });
  syncToAllInstances(servers);
  return servers;
}

function syncToInstance(servers, root) {
  const list = servers || listServers();
  const dir = root || instanceDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'servers.dat'), buildServersDat(list));
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
    } catch { /* best effort per instance */ }
  }
  return servers || listServers();
}

function addServer(name, ip) {
  const cleanName = String(name || '').trim();
  const cleanIp = String(ip || '').trim();
  if (!cleanName) throw new Error('Server name is required.');
  if (!cleanIp) throw new Error('Server IP is required.');
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
    entry.name = cleanName;
  }
  if (ip !== undefined) {
    const cleanIp = String(ip).trim();
    if (!cleanIp) throw new Error('Server IP is required.');
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
