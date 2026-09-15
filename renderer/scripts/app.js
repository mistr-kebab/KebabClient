'use strict';

(function () {
  const { bridge } = window.launcherUtil;

  function tr(key, fallback) {
    try {
      if (window.i18n) {
        const v = window.i18n.t(key);
        if (v && v !== key) return v;
      }
    } catch { /* noop */ }
    return fallback || key;
  }

  function crumbName(view) {
    const map = {
      home: tr('crumb.home', 'Home'),
      play: tr('crumb.play', 'Play'),
      instances: tr('crumb.instances', 'Instances'),
      'instance-detail': tr('crumb.instance-detail', 'Instance'),
      skins: tr('crumb.skins', 'Skins'),
      servers: tr('crumb.servers', 'Servers'),
      logs: tr('crumb.logs', 'Logs'),
      settings: tr('crumb.settings', 'Settings')
    };
    return map[view] || view;
  }

  let currentView = 'home';

  function setView(name) {
    const known = ['home', 'play', 'instances', 'instance-detail', 'skins', 'servers', 'logs', 'settings'];
    const view = known.includes(name) ? name : 'home';
    currentView = view;
    const navKey = view === 'instance-detail' ? 'instances' : view;
    document.querySelectorAll('#mainNav .nav-item, #settingsNav .nav-item').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.view === navKey);
    });
    document.querySelectorAll('.view').forEach((section) => {
      section.classList.toggle('is-active', section.id === `view-${view}`);
    });
    const crumb = document.getElementById('crumbView');
    if (crumb) crumb.textContent = crumbName(view);
  }

  function bindNav() {
    document.querySelectorAll('#mainNav .nav-item, #settingsNav .nav-item').forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.view));
    });
    const gotoLogs = document.getElementById('gotoLogsButton');
    if (gotoLogs) gotoLogs.addEventListener('click', () => setView('logs'));
    const gotoInstances = document.getElementById('homeGotoInstances');
    if (gotoInstances) gotoInstances.addEventListener('click', () => setView('instances'));
    const homePlay = document.getElementById('homePlayButton');
    if (homePlay) {
      homePlay.addEventListener('click', () => {
        setView('play');
        if (typeof window.startActiveGame === 'function') window.startActiveGame();
      });
    }
    const homeFolder = document.getElementById('homeFolderButton');
    if (homeFolder) {
      homeFolder.addEventListener('click', async () => {
        try { await bridge().openGameFolder(); }
        catch (err) {
          if (window.launcherUtil) window.launcherUtil.toast(`Cannot open folder: ${err.message}`, 'error');
        }
      });
    }
    const homeNew = document.getElementById('homeNewInstanceButton');
    if (homeNew) {
      homeNew.addEventListener('click', () => {
        setView('instances');
        window.setTimeout(() => {
          const panel = document.getElementById('newInstancePanel');
          const btn = document.getElementById('newInstanceButton');
          if (panel && panel.hidden && btn) btn.click();
        }, 60);
      });
    }
    document.addEventListener('i18n:applied', () => {
      const crumb = document.getElementById('crumbView');
      if (crumb) crumb.textContent = crumbName(currentView);
      const pill = document.getElementById('runPillText');
      if (pill) {
        const running = document.getElementById('runPill')?.classList.contains('is-running');
        pill.textContent = running ? tr('topbar.running', 'Instance running') : tr('topbar.idle', 'No instances running');
      }
    });
  }

  function hideSplash() {
    const splash = document.getElementById('splash');
    if (!splash || splash.classList.contains('is-done')) return;
    splash.classList.add('is-done');
    window.setTimeout(() => splash.remove(), 650);
  }

  function setMaxIcon(maximized) {
    const btn = document.getElementById('maxButton');
    if (!btn) return;
    btn.textContent = '';
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', maximized ? 'copy' : 'square');
    btn.appendChild(icon);
    if (window.refreshIcons) window.refreshIcons();
  }

  function bindWindowControls() {
    const minBtn = document.getElementById('minButton');
    const maxBtn = document.getElementById('maxButton');
    const closeBtn = document.getElementById('closeButton');
    if (minBtn) minBtn.addEventListener('click', () => {
      try { bridge().minimizeWindow(); } catch { /* noop */ }
    });
    if (maxBtn) maxBtn.addEventListener('click', () => {
      try { bridge().toggleMaximize(); } catch { /* noop */ }
    });
    if (closeBtn) closeBtn.addEventListener('click', () => {
      try { bridge().closeWindow(); } catch { /* noop */ }
    });
    try {
      bridge().onMaxState((s) => setMaxIcon(!!(s && s.maximized)));
    } catch { /* noop */ }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindNav();
    bindWindowControls();
    setView('home');
    const status = document.getElementById('splashStatus');
    const steps = ['Loading settings…', 'Checking account…', 'Loading instances…', 'Almost there…'];
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      if (status && steps[i]) status.textContent = steps[i];
    }, 350);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearInterval(timer);
      window.setTimeout(hideSplash, 450);
    };
    window.addEventListener('load', finish);
    window.setTimeout(finish, 4000);
  });

  window.showView = setView;
})();
