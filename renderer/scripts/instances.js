'use strict';

(function () {
  const ctx = window.instancesCtx;
  const { bridge } = window.launcherUtil;

  document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('instances:changed', () => {
      if (ctx.detailId) ctx.loadDetailInstalled();
    });
    document.addEventListener('i18n:applied', () => {
      ctx.loadInstances().catch(() => {});
      if (ctx.detailId) {
        const title = document.getElementById('detailSearchTitle');
        if (title && ctx.detailName)
          title.textContent = ctx.fmt(ctx.tr('detail.addTo', 'Add content to {name}'), { name: ctx.detailName });
        ctx.refreshDetailDropText();
        ctx.loadDetailInstalled().catch(() => {});
        ctx.renderDetailLog();
      }
      ctx.resultStatus();
    });
    try {
      bridge().onInstancesChanged(() => ctx.loadInstances());
    } catch {}
    try {
      bridge().onProgress(ctx.onInstanceProgress);
    } catch {}
    ctx.loadInstances();
  });

  window.showInstanceDetail = async tab => {
    try {
      if (!ctx.detailId) {
        const res = await bridge().listInstances();
        const id = res?.activeId || (res?.instances && res.instances[0] && res.instances[0].id);
        if (!id) {
          window.showView('instances');
          return;
        }
        await ctx.openDetail(id);
      }
      if (tab === 'mod' || tab === 'resourcepack' || tab === 'shader' || tab === 'logs') {
        ctx.installedTab = tab;
        ctx.syncContentTabs();
      }
      window.showView('instance-detail');
      ctx.renderDetailGrid();
    } catch {
      window.showView('instances');
    }
  };
})();
