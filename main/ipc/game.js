'use strict';

const { shell } = require('electron');
const auth = require('../auth');
const minecraft = require('../minecraft');
const servers = require('../servers');
const instances = require('../instances');

function register(ipcMain, ctx) {
  const { broadcast } = ctx;

  ipcMain.handle('game:ensure', async (_e, args) => {
    const res = await minecraft.ensureClient(args?.instanceId, (p) => broadcast('game:progress', p));
    servers.syncToAllInstances();
    return { ok: true, ...res };
  });
  ipcMain.handle('game:launch', async (_e, args) => {
    servers.syncToAllInstances();
    return minecraft.launchGame(args?.instanceId, args?.server);
  });
  ipcMain.handle('game:stop', async () => minecraft.stopGame());
  ipcMain.handle('game:status', async () => {
    const active = instances.getActiveInstance();
    return {
      running: minecraft.isRunning(),
      runningInstanceId: minecraft.runningInstanceId(),
      instance: active ? instances.describeInstance(active) : null,
      instanceDir: active ? minecraft.dirsFor(active).root : null,
      profile: auth.getStoredProfile()
    };
  });
  ipcMain.handle('game:openFolder', async (_e, args) => {
    const inst = args?.instanceId ? instances.getInstance(args.instanceId) : instances.getActiveInstance();
    if (!inst) throw new Error('No instance selected. Create one first.');
    await shell.openPath(minecraft.dirsFor(inst).root);
    return { ok: true };
  });
}

module.exports = { register };
