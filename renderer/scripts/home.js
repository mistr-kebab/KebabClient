'use strict';

(function () {
  const { bridge, toast, el, tr: t } = window.launcherUtil;

  function fmtDur(ms) {
    const totalMin = Math.floor((Number(ms) || 0) / 60000);
    if (totalMin <= 0) return '';
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h <= 0) return `${m} min`;
    return `${h}h ${m}m`;
  }

  function normVer(v) {
    return String(v || '').trim().replace(/^v/i, '');
  }

  function isNewer(a, b) {
    const pa = normVer(a).split('.').map(Number);
    const pb = normVer(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x > y;
    }
    return false;
  }

  function dayLocale() {
    try {
      if (window.i18n && window.i18n.getLanguage && window.i18n.getLanguage() === 'en') return 'en-US';
    } catch {}
    return 'de-DE';
  }

  function renderPlayDays(map) {
    const box = document.getElementById('homePlayDays');
    if (!box) return;
    box.textContent = '';
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ date: d, ms: Number((map || {})[key]) || 0, today: i === 0 });
    }
    if (days.every(d => !d.ms)) {
      box.appendChild(el('p', 'muted small', t('home.emptyRecent', 'Nothing played yet.')));
      return;
    }
    const locale = dayLocale();
    const max = Math.max(1, ...days.map(d => d.ms));
    const chart = el('div', 'playchart');
    for (const d of days) {
      const bar = el('div', 'playchart-bar');
      const fill = el('div', 'playchart-fill' + (d.today ? ' is-today' : ''));
      fill.style.height = d.ms ? `${Math.max(5, Math.round((d.ms / max) * 100))}%` : '0%';
      fill.title = `${d.date.toLocaleDateString(locale)}: ${fmtDur(d.ms) || '0 min'}`;
      bar.appendChild(fill);
      bar.appendChild(el('span', 'playchart-day', d.date.toLocaleDateString(locale, { weekday: 'short' })));
      chart.appendChild(bar);
    }
    box.appendChild(chart);
  }

  async function refreshStats() {
    try {
      const res = await bridge().listInstances();
      const instances = (res && res.instances) || [];
      const n = document.getElementById('homeStatsInstances');
      if (n) n.textContent = String(instances.length);
      const play = document.getElementById('homeStatsPlaytime');
      if (play) {
        let total = 0;
        for (const i of instances) total += Number(i.totalPlayMs) || 0;
        play.textContent = fmtDur(total) || '–';
      }
      renderRecent(instances);
      renderPlayDays(res && res.playDays);
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
      if (state)
        state.textContent =
          res && res.profile ? t('account.connected', 'Microsoft connected') : t('account.only', 'Microsoft only');
    } catch {}
    try {
      const [app, latest] = await Promise.all([bridge().appVersion(), bridge().getLatestRelease()]);
      const cur = normVer(app && app.version);
      const lat = normVer(latest && latest.version);
      const vEl = document.getElementById('homeStatsVersion');
      const lEl = document.getElementById('homeStatsLatest');
      if (vEl) vEl.textContent = cur ? `v${cur}` : '–';
      if (lEl) {
        if (!lat) lEl.textContent = '–';
        else if (cur && isNewer(lat, cur)) lEl.textContent = `v${lat} (${t('update.available', 'Update available')})`;
        else lEl.textContent = `v${lat}`;
      }
    } catch {}
  }

  function renderRecent(instances) {
    const list = document.getElementById('homeRecentList');
    if (!list) return;
    list.textContent = '';
    const played = (instances || [])
      .filter(i => i.lastPlayed)
      .sort((a, b) => b.lastPlayed - a.lastPlayed)
      .slice(0, 5);
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

  window.whenViewsReady(() => {
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
