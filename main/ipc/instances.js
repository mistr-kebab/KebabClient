'use strict';

const { dialog } = require('electron');
const config = require('../config');
const instances = require('../services/instances');
const loaders = require('../services/loaders');

function register(ipcMain, ctx) {
  const { broadcast, getWindow } = ctx;

  ipcMain.handle('instances:list', async () => ({
    instances: instances.listInstances().map((i) => instances.describeInstance(i)),
    activeId: instances.getActiveInstance()?.id || null
  }));
  ipcMain.handle('instances:setIcon', async (_e, args) => {
    const id = String(args?.id || '');
    const picked = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose instance icon',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile']
    });
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
    const entry = instances.setInstanceIcon(id, picked.filePaths[0]);
    broadcast('instances:changed', { instances: instances.listInstances(), activeId: instances.getActiveInstance()?.id || null });
    return { canceled: false, entry: instances.describeInstance(entry) };
  });
  ipcMain.handle('instances:clearIcon', async (_e, args) => {
    const entry = instances.clearInstanceIcon(String(args?.id || ''));
    broadcast('instances:changed', { instances: instances.listInstances(), activeId: instances.getActiveInstance()?.id || null });
    return { ok: true, entry: instances.describeInstance(entry) };
  });
  ipcMain.handle('instances:create', async (_e, args) => {
    const created = instances.createInstance({ name: args?.name, mc: args?.mc, loader: args?.loader });
    broadcast('instances:changed', { instances: instances.listInstances(), activeId: created.id });
    return created;
  });
  ipcMain.handle('instances:rename', async (_e, args) => {
    const renamed = instances.renameInstance(args?.id, args?.name);
    broadcast('instances:changed', { instances: instances.listInstances(), activeId: instances.getActiveInstance()?.id || null });
    return renamed;
  });
  ipcMain.handle('instances:delete', async (_e, args) => {
    const rest = instances.deleteInstance(args?.id);
    broadcast('instances:changed', { instances: rest, activeId: instances.getActiveInstance()?.id || null });
    return rest;
  });
  ipcMain.handle('instances:backup', async (_e, args) => instances.backupInstanceSaves(args?.id));
  ipcMain.handle('instances:setActive', async (_e, args) => {
    const active = instances.setActiveInstance(args?.id);
    broadcast('instances:changed', { instances: instances.listInstances(), activeId: active.id });
    return active;
  });

  ipcMain.handle('meta:mcVersions', async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(config.URLS.pistonMetaManifest, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Version manifest failed (${res.status}).`);
      const manifest = await res.json();
      return (manifest.versions || [])
        .filter((v) => v.type === 'release')
        .slice(0, 40)
        .map((v) => v.id);
    } finally {
      clearTimeout(timer);
    }
  });
  ipcMain.handle('meta:loaders', async (_e, args) => {
    const mc = String(args?.mc || '').trim();
    if (!mc) throw new Error('Missing Minecraft version.');
    const out = {
      fabric: { supported: true, versions: [] },
      quilt: { supported: true, versions: [] },
      forge: { supported: false, note: 'Forge support is coming soon.' },
      neoforge: { supported: false, note: 'NeoForge support is coming soon.' }
    };
    for (const key of ['fabric', 'quilt']) {
      try {
        out[key].versions = await loaders.listLoaderVersions(mc, key);
      } catch (err) {
        out[key].versions = [];
        out[key].note = err.message;
      }
    }
    return out;
  });
}

module.exports = { register };
