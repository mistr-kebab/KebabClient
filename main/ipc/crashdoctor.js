'use strict';

const crashDoctor = require('../services/crashDoctor');

function register(ipcMain) {
  ipcMain.handle('crashdoctor:analyze', async (_e, args) => {
    const instanceId = String(args?.instanceId || '');
    if (!instanceId) throw new Error('Missing instance id.');
    return crashDoctor.analyze(instanceId);
  });

  ipcMain.handle('crashdoctor:applyFix', async (_e, args) => {
    const instanceId = String(args?.instanceId || '');
    const fixType = String(args?.fixType || '');
    if (!instanceId) throw new Error('Missing instance id.');
    if (!fixType || fixType === 'none') throw new Error('Nothing to apply.');
    return crashDoctor.applyFix(instanceId, fixType, args?.fixPayload);
  });
}

module.exports = { register };
