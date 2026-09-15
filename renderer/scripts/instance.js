'use strict';

(function () {
  const { bridge, toast, el } = window.launcherUtil;
  let follow = true;
  let userScrolledUp = false;
  let wasRunning = false;
  let activeInstance = null;

  const LOADER_LABELS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

  function loaderLabel(loader) {
    return LOADER_LABELS[loader] || loader || 'Vanilla';
  }

  function logView() {
    return document.getElementById('logView');
  }

  function miniLog() {
    return document.getElementById('miniLog');
  }

  function appendLine(container, stream, line, fullClass) {
    if (!container) return;
    const div = document.createElement('div');
    div.className = fullClass ? `log-line-${stream}` : `line-${stream}`;
    div.textContent = line;
    container.appendChild(div);
    while (container.children.length > 2000) container.firstChild.remove();
    const shouldStick = fullClass ? (follow && !userScrolledUp) : true;
    if (shouldStick) container.scrollTop = container.scrollHeight;
  }

  function tr(key, fallback) {
    try {
      if (window.i18n) {
        const v = window.i18n.t(key);
        if (v && v !== key) return v;
      }
    } catch { /* noop */ }
    return fallback;
  }

  function setRunning(running, pid) {
    const launchBtn = document.getElementById('launchButton');
    const stopBtn = document.getElementById('stopButton');
    const homePlay = document.getElementById('homePlayButton');
    if (launchBtn) launchBtn.disabled = !!running;
    if (stopBtn) stopBtn.disabled = !running;
    if (homePlay) homePlay.disabled = !!running;
    const pill = document.getElementById('runPill');
    const pillText = document.getElementById('runPillText');
    const sideStatus = document.getElementById('sideStatus');
    const heroPill = document.getElementById('heroStatusPill');
    const heroText = document.getElementById('heroStatusText');
    if (pill) pill.classList.toggle('is-running', !!running);
    if (pillText) pillText.textContent = running ? tr('topbar.running', 'Instance running') : tr('topbar.idle', 'No instances running');
    if (sideStatus) sideStatus.textContent = running ? 'Running' : 'Idle';
    if (heroPill) heroPill.classList.toggle('is-running', !!running);
    if (heroText) heroText.textContent = running ? 'Running' : 'Idle';
    const homeState = document.getElementById('homeActiveState');
    if (homeState) homeState.textContent = running ? 'Running' : 'Idle';
    if (running && !wasRunning) toast(`Game running${pid ? ` (pid ${pid})` : ''}.`, 'ok');
    wasRunning = !!running;
  }

  function setProgress(ratio, label) {
    const wrap = document.getElementById('dlProgressWrap');
    const bar = document.getElementById('dlProgressBar');
    const text = document.getElementById('dlProgressLabel');
    if (!wrap || !bar || !text) return;
    if (ratio === null) {
      wrap.hidden = true;
      bar.style.width = '0%';
      text.textContent = '';
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    wrap.hidden = false;
    bar.style.width = `${pct}%`;
    text.textContent = label ? `${pct}% — ${label}` : `${pct}%`;
  }

  function setNoActiveInstance() {
    activeInstance = null;
    const nameEl = document.getElementById('activeName');
    const verEl = document.getElementById('heroVer');
    const sideEl = document.getElementById('sideInstance');
    const railVer = document.getElementById('versionLabel');
    const homeName = document.getElementById('homeActiveName');
    const homeSub = document.getElementById('homeActiveSub');
    const pathLabel = document.getElementById('instancePathLabel');
    const launchBtn = document.getElementById('launchButton');
    const homePlay = document.getElementById('homePlayButton');
    if (nameEl) nameEl.textContent = 'KebabClient';
    if (verEl) verEl.textContent = 'No instance yet';
    if (sideEl) sideEl.textContent = '—';
    if (railVer) railVer.textContent = '—';
    if (homeName) homeName.textContent = tr('home.noInstance', 'Noch keine Instanz');
    if (homeSub) homeSub.textContent = '—';
    if (pathLabel) pathLabel.textContent = 'Create an instance to get started.';
    if (launchBtn) launchBtn.disabled = true;
    if (homePlay) homePlay.disabled = true;
  }

  async function refreshStatus() {
    try {
      const s = await bridge().gameStatus();
      if (s?.instance) applyActiveInstance(s.instance);
      else setNoActiveInstance();
      const pathLabel = document.getElementById('instancePathLabel');
      if (pathLabel && s?.instanceDir) pathLabel.textContent = s.instanceDir;
      setRunning(!!s?.running, null);
    } catch { /* show on demand */ }
  }

  async function pickBanner() {
    try {
      const banners = await bridge().getBanners();
      if (!banners || !banners.length) return;
      let last = null;
      try { last = window.localStorage.getItem('kebabLastBanner'); } catch { /* noop */ }
      let pool = banners.filter((b) => b.name !== last);
      if (!pool.length) pool = banners;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      document.documentElement.style.setProperty('--hero-image', `url("${pick.dataUrl}")`);
      try { window.localStorage.setItem('kebabLastBanner', pick.name); } catch { /* noop */ }
    } catch { /* keep default banner */ }
  }

  function applyActiveInstance(instance) {
    activeInstance = instance;
    if (!instance) return;
    const nameEl = document.getElementById('activeName');
    const verEl = document.getElementById('heroVer');
    const sideEl = document.getElementById('sideInstance');
    const railVer = document.getElementById('versionLabel');
    const homeName = document.getElementById('homeActiveName');
    const homeSub = document.getElementById('homeActiveSub');
    const label = `${instance.mc} · ${loaderLabel(instance.loader)}`;
    if (nameEl) nameEl.textContent = instance.name;
    if (verEl) verEl.textContent = `Minecraft ${label}`;
    if (sideEl) sideEl.textContent = label;
    if (railVer) railVer.textContent = instance.mc;
    if (homeName) homeName.textContent = instance.name;
    if (homeSub) homeSub.textContent = label;
  }

  async function ensureActive() {
    const ensureBtn = document.getElementById('ensureButton');
    const playBtn = document.getElementById('launchButton');
    if (ensureBtn) ensureBtn.disabled = true;
    if (playBtn) playBtn.disabled = true;
    setProgress(0, 'Starting download…');
    try {
      const res = await bridge().ensureClient();
      setProgress(1, `Verified (${res?.cached || 0} cached, ${res?.downloaded || 0} downloaded).`);
      toast(`Verified: ${res?.cached || 0} cached, ${res?.downloaded || 0} downloaded. You can press Play now.`, 'ok');
      const pathLabel = document.getElementById('instancePathLabel');
      if (pathLabel && res?.instanceDir) pathLabel.textContent = res.instanceDir;
      if (res?.instance) applyActiveInstance(res.instance);
      window.setTimeout(() => setProgress(null), 2500);
      return true;
    } catch (err) {
      setProgress(null);
      toast(`Download failed: ${err.message}`, 'error');
      return false;
    } finally {
      if (ensureBtn) ensureBtn.disabled = false;
      refreshStatus();
    }
  }

  async function startActiveGame() {
    if (!activeInstance) {
      try {
        const s = await bridge().gameStatus();
        if (s?.instance) applyActiveInstance(s.instance);
      } catch { /* fall through to hint */ }
    }
    if (!activeInstance) {
      toast('Create an instance first.', 'error');
      if (typeof window.showView === 'function') window.showView('instances');
      return;
    }
    const ok = await ensureActive();
    if (!ok) return;
    try {
      const res = await bridge().launch();
      setRunning(true, res?.pid);
    } catch (err) {
      toast(`Launch failed: ${err.message}`, 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const ensureBtn = document.getElementById('ensureButton');
    const launchBtn = document.getElementById('launchButton');
    const stopBtn = document.getElementById('stopButton');
    const openFolderBtn = document.getElementById('openFolderButton');
    const clearBtn = document.getElementById('clearLogButton');
    const followCheck = document.getElementById('followCheck');
    const view = logView();

    if (view) {
      view.addEventListener('scroll', () => {
        const distance = view.scrollHeight - view.scrollTop - view.clientHeight;
        userScrolledUp = distance > 120;
      });
    }
    if (followCheck) {
      followCheck.addEventListener('change', () => {
        follow = followCheck.checked;
        if (follow && view) view.scrollTop = view.scrollHeight;
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (view) view.textContent = '';
        const mini = miniLog();
        if (mini) mini.textContent = '';
      });
    }

    if (ensureBtn) {
      ensureBtn.addEventListener('click', ensureActive);
    }

    if (launchBtn) {
      launchBtn.addEventListener('click', startActiveGame);
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', async () => {
        try {
          await bridge().stopGame();
        } catch (err) {
          toast(`Stop failed: ${err.message}`, 'error');
        }
      });
    }

    if (openFolderBtn) {
      openFolderBtn.addEventListener('click', async () => {
        try {
          await bridge().openGameFolder();
        } catch (err) {
          toast(`Cannot open folder: ${err.message}`, 'error');
        }
      });
    }

    try {
      bridge().onLog((msg) => {
        appendLine(logView(), msg?.stream || 'stdout', msg?.line || '', true);
        appendLine(miniLog(), msg?.stream || 'stdout', msg?.line || '', false);
      });
      bridge().onGameStatus((s) => setRunning(!!s?.running, s?.pid));
      bridge().onProgress((p) => {
        if (!p) return;
        if (p.phase === 'mods' || p.phase === 'settings') {
          setProgress(null);
          return;
        }
        const ratio = typeof p.ratio === 'number' ? p.ratio : 0;
        setProgress(ratio, `${p.phase || ''} — ${p.label || ''}`.trim());
        if (ratio >= 1) window.setTimeout(() => setProgress(null), 2500);
      });
    } catch { /* bridge unavailable in static preview */ }

    document.addEventListener('instances:changed', () => {
      refreshStatus();
    });

    refreshStatus();
    pickBanner();
    void el;
  });

  window.startActiveGame = startActiveGame;
  window.ensureActiveInstance = ensureActive;
})();
