'use strict';

(function () {
  const { bridge, toast, el } = window.launcherUtil;

  function t(key, fallback) {
    try {
      if (window.i18n) {
        const v = window.i18n.t(key);
        if (v && v !== key) return v;
      }
    } catch {}
    return fallback || key;
  }

  async function refreshStats() {
    try {
      const res = await bridge().listInstances();
      const instances = (res && res.instances) || [];
      const n = document.getElementById('homeStatsInstances');
      if (n) n.textContent = String(instances.length);
      renderRecent(instances);
    } catch {}
    try {
      const servers = await bridge().listServers();
      const n = document.getElementById('homeStatsServers');
      if (n) n.textContent = String((servers || []).length);
    } catch {}
    try {
      const res = await bridge().getProfile();
      const name = document.getElementById('homeAccountName');
      const state = document.getElementById('homeAccountState');
      if (name) name.textContent = (res && res.profile && res.profile.name) || t('topbar.signin', 'Not signed in');
      if (state) state.textContent = (res && res.profile) ? t('account.connected', 'Microsoft connected') : t('account.only', 'Microsoft only');
    } catch {}
  }

  function renderRecent(instances) {
    const list = document.getElementById('homeRecentList');
    if (!list) return;
    list.textContent = '';
    const played = (instances || []).filter((i) => i.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 5);
    if (!played.length) {
      list.appendChild(el('p', 'muted small', t('home.emptyRecent', 'Nothing played yet.')));
      return;
    }
    for (const instance of played) {
      const row = el('div', 'recent-row');
      const meta = el('div', 'recent-meta');
      meta.appendChild(el('span', 'recent-name', instance.name));
      meta.appendChild(el('span', 'recent-sub', new Date(instance.lastPlayed).toLocaleDateString()));
      row.appendChild(meta);
      const btn = el('button', 'btn btn-play btn-sm', t('home.play', 'Play'));
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        try {
          await bridge().setActiveInstance(instance.id);
        } catch (err) {
          toast(err.message, 'error');
          return;
        }
        document.dispatchEvent(new CustomEvent('instances:changed'));
        if (typeof window.showView === 'function') window.showView('play');
        if (typeof window.startActiveGame === 'function') window.startActiveGame();
      });
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    refreshStats();
    document.addEventListener('instances:changed', refreshStats);
    document.addEventListener('servers:changed', refreshStats);
    document.addEventListener('i18n:applied', refreshStats);
    try {
      bridge().onInstancesChanged(refreshStats);
    } catch {}
    try {
      bridge().onAuthChanged(refreshStats);
    } catch {}
  });
})();
