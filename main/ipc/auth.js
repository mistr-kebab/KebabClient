'use strict';

const auth = require('../services/auth');
const ban = require('../services/ban');
const store = require('../store');

function register(ipcMain, ctx) {
  const getWindow = ctx.getWindow;
  const broadcast = ctx.broadcast;

  ipcMain.handle('auth:login', async () => {
    const res = await auth.fullLoginFlow(getWindow());
    // Fire-and-forget hello now that UUID/username are known.
    ban.afterAuth(broadcast, 'login').catch(() => {});
    return res;
  });
  ipcMain.handle('auth:refresh', async () => {
    const res = await auth.refreshSession();
    ban.afterAuth(broadcast, 'refresh').catch(() => {});
    return res;
  });
  ipcMain.handle('auth:logout', async () => {
    auth.logout();
    return { ok: true };
  });
  ipcMain.handle('auth:profile', async () => ({ profile: auth.getStoredProfile() }));
  ipcMain.handle('settings:getClientId', async () => auth.getClientIdInfo());
  ipcMain.handle('settings:setClientId', async (_e, args) => {
    const mode = args?.mode === 'custom' ? 'custom' : args?.mode === 'builtin' ? 'builtin' : 'own';
    if (mode === 'custom') {
      const value = String(args?.clientId || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        throw new Error(
          'Invalid client ID format. Expected the Application (client) ID GUID from Entra, e.g. b0be2e82-…-953142.'
        );
      }
      store.saveState({ clientId: value, authMode: 'custom' });
    } else {
      store.saveState({ authMode: mode });
    }
    return { ok: true, mode };
  });
}

module.exports = { register };
