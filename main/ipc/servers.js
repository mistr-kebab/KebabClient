'use strict';

const { shell } = require('electron');
const servers = require('../services/servers');

function register(ipcMain) {
  ipcMain.handle('servers:list', async () => servers.listServers());
  ipcMain.handle('servers:add', async (_e, args) =>
    servers.addServer(args?.name, args?.ip, args?.categoryId, args?.invite)
  );
  ipcMain.handle('servers:update', async (_e, args) => {
    const extra = {};
    if (args && args.categoryId !== undefined) extra.categoryId = args.categoryId;
    if (args && args.invite !== undefined) extra.invite = args.invite;
    return servers.updateServer(args?.id, args?.name, args?.ip, extra);
  });
  ipcMain.handle('servers:toggle', async (_e, args) => servers.setServerDisabled(args?.id, args?.disabled));
  ipcMain.handle('servers:categories', async () => servers.listCategories());
  ipcMain.handle('servers:addCategory', async (_e, args) => servers.addCategory(args?.name));
  ipcMain.handle('servers:renameCategory', async (_e, args) => servers.renameCategory(args?.id, args?.name));
  ipcMain.handle('servers:deleteCategory', async (_e, args) => servers.deleteCategory(args?.id));
  ipcMain.handle('servers:openInvite', async (_e, args) => {
    let url = String(args?.url || '').trim();
    if (!url) throw new Error('No invite link.');
    if (/^discord\.gg\//i.test(url)) url = `https://${url}`;
    if (!/^https?:\/\//i.test(url)) throw new Error('Invite must be an http(s) link.');
    await shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('servers:remove', async (_e, args) => servers.removeServer(args?.id));
  ipcMain.handle('servers:move', async (_e, args) => servers.moveServer(args?.id, args?.direction));
  ipcMain.handle('servers:ping', async (_e, args) => require('../ping').pingServer(args?.ip));
}

module.exports = { register };
