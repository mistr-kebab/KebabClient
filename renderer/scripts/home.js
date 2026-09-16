'use strict';

(function () {
  const { bridge } = window.launcherUtil;

  async function refreshStats() {
    try {
      const res = await bridge().listInstances();
      const n = document.getElementById('homeStatsInstances');
      if (n) n.textContent = String((res && res.instances ? res.instances.length : 0));
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
      if (name) name.textContent = (res && res.profile && res.profile.name) || 'Not signed in';
      if (state) state.textContent = (res && res.profile) ? 'Microsoft connected' : 'Microsoft only';
    } catch {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    refreshStats();
    document.addEventListener('instances:changed', refreshStats);
    document.addEventListener('servers:changed', refreshStats);
    try {
      bridge().onInstancesChanged(refreshStats);
    } catch {}
    try {
      bridge().onAuthChanged(refreshStats);
    } catch {}
  });
})();
