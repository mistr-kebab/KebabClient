'use strict';

(function () {
  const { bridge, toast, el } = window.launcherUtil;
  let wasRunning = false;
  let activeInstance = null;
  let runningId = null;

  const LOADER_LABELS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

  function loaderLabel(loader) {
    return LOADER_LABELS[loader] || loader || 'Vanilla';
  }

  function miniLog() {
    return document.getElementById('miniLog');
  }

  function appendLine(container, stream, line) {
    if (!container) return;
    const div = document.createElement('div');
    div.className = `line-${stream}`;
    div.textContent = line;
    container.appendChild(div);
    while (container.children.length > 2000) container.firstChild.remove();
    container.scrollTop = container.scrollHeight;
  }

  function tr(key, fallback) {
    try {
      if (window.i18n) {
        const v = window.i18n.t(key);
        if (v && v !== key) return v;
      }
    } catch {}
    return fallback;
  }

  function fmt(tpl, map) {
    return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (map && map[k] !== undefined ? map[k] : ''));
  }

  function setRunning(running, pid) {
    const launchBtn = document.getElementById('launchButton');
    const stopBtn = document.getElementById('stopButton');
    const homePlay = document.getElementById('homePlayButton');
    if (launchBtn) launchBtn.disabled = !!running;
    if (stopBtn) stopBtn.disabled = !running;
    if (homePlay) homePlay.disabled = !!running;
    const heroPill = document.getElementById('heroStatusPill');
    const heroText = document.getElementById('heroStatusText');
    try {
      document.documentElement.dataset.gameRunning = running ? '1' : '';
    } catch {}
    if (heroPill) heroPill.classList.toggle('is-running', !!running);
    if (heroText) heroText.textContent = running ? tr('status.running', 'Running') : tr('status.idle', 'Idle');
    const homeState = document.getElementById('homeActiveState');
    if (homeState) homeState.textContent = running ? tr('status.running', 'Running') : tr('status.idle', 'Idle');
    if (running && !wasRunning) toast(fmt(tr('play.running', 'Game running{pid}.'), { pid: pid ? ` (pid ${pid})` : '' }), 'ok');
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

  function paintHeroIcon(instance) {
    const box = document.getElementById('heroIcon');
    if (!box) return;
    box.textContent = '';
    if (instance && instance.iconDataUrl) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = instance.iconDataUrl;
      box.appendChild(img);
    } else {
      const fb = document.createElement('i');
      fb.setAttribute('data-lucide', 'boxes');
      box.appendChild(fb);
      if (window.refreshIcons) window.refreshIcons();
    }
  }

  function setNoActiveInstance() {
    activeInstance = null;
    paintHeroIcon(null);
    const nameEl = document.getElementById('activeName');
    const verEl = document.getElementById('heroVer');
    const homeName = document.getElementById('homeActiveName');
    const homeSub = document.getElementById('homeActiveSub');
    const pathLabel = document.getElementById('instancePathLabel');
    const launchBtn = document.getElementById('launchButton');
    const homePlay = document.getElementById('homePlayButton');
    if (nameEl) nameEl.textContent = 'KebabClient';
    if (verEl) verEl.textContent = tr('play.noInstance', 'No instance yet');
    if (homeName) homeName.textContent = tr('home.noInstance', 'Noch keine Instanz');
    if (homeSub) homeSub.textContent = '—';
    if (pathLabel) pathLabel.textContent = tr('play.getStarted', 'Create an instance to get started.');
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
      runningId = s?.running ? (s?.runningInstanceId || runningId) : null;
      setRunning(!!s?.running, null);
    } catch {}
  }

  async function pickBanner() {
    try {
      const banners = await bridge().getBanners();
      if (!banners || !banners.length) return;
      let last = null;
      try { last = window.localStorage.getItem('kebabLastBanner'); } catch {}
      let pool = banners.filter((b) => b.name !== last);
      if (!pool.length) pool = banners;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const safeUrl = String(pick.dataUrl || '').replace(/"/g, '%22');
      document.documentElement.style.setProperty('--hero-image', `url("${safeUrl}")`);
      try { window.localStorage.setItem('kebabLastBanner', pick.name); } catch {}
    } catch {}
  }

  function applyActiveInstance(instance) {
    activeInstance = instance;
    if (!instance) return;
    paintHeroIcon(instance);
    const nameEl = document.getElementById('activeName');
    const verEl = document.getElementById('heroVer');
    const homeName = document.getElementById('homeActiveName');
    const homeSub = document.getElementById('homeActiveSub');
    const label = `${instance.mc} · ${loaderLabel(instance.loader)}`;
    if (nameEl) nameEl.textContent = instance.name;
    if (verEl) verEl.textContent = `Minecraft ${label}`;
    if (homeName) homeName.textContent = instance.name;
    if (homeSub) homeSub.textContent = label;
  }

  async function ensureActive() {
    const ensureBtn = document.getElementById('ensureButton');
    const playBtn = document.getElementById('launchButton');
    if (ensureBtn) ensureBtn.disabled = true;
    if (playBtn) playBtn.disabled = true;
    setProgress(0, tr('play.starting', 'Starting download…'));
    try {
      const res = await bridge().ensureClient();
      setProgress(1, fmt(tr('play.verified', 'Verified ({c} cached, {d} downloaded).'), { c: res?.cached || 0, d: res?.downloaded || 0 }));
      toast(fmt(tr('play.verifiedToast', 'Verified: {c} cached, {d} downloaded. You can press Play now.'), { c: res?.cached || 0, d: res?.downloaded || 0 }), 'ok');
      const pathLabel = document.getElementById('instancePathLabel');
      if (pathLabel && res?.instanceDir) pathLabel.textContent = res.instanceDir;
      if (res?.instance) applyActiveInstance(res.instance);
      window.setTimeout(() => setProgress(null), 2500);
      return true;
    } catch (err) {
      setProgress(null);
      toast(fmt(tr('play.dlFail', 'Download failed: {msg}'), { msg: err.message }), 'error');
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
      } catch {}
    }
    if (!activeInstance) {
      toast(tr('play.needInstance', 'Create an instance first.'), 'error');
      if (typeof window.showView === 'function') window.showView('instances');
      return;
    }
    const ok = await ensureActive();
    if (!ok) return;
    try {
      const res = await bridge().launch();
      setRunning(true, res?.pid);
    } catch (err) {
      toast(fmt(tr('play.launchFail', 'Launch failed: {msg}'), { msg: err.message }), 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const ensureBtn = document.getElementById('ensureButton');
    const launchBtn = document.getElementById('launchButton');
    const stopBtn = document.getElementById('stopButton');
    const openFolderBtn = document.getElementById('openFolderButton');

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
          toast(fmt(tr('play.stopFail', 'Stop failed: {msg}'), { msg: err.message }), 'error');
        }
      });
    }

    if (openFolderBtn) {
      openFolderBtn.addEventListener('click', async () => {
        try {
          await bridge().openGameFolder();
        } catch (err) {
          toast(fmt(tr('play.folderFail', 'Cannot open folder: {msg}'), { msg: err.message }), 'error');
        }
      });
    }

    try {
      bridge().onLog((msg) => {
        appendLine(miniLog(), msg?.stream || 'stdout', msg?.line || '');
        document.dispatchEvent(new CustomEvent('game:log-line', {
          detail: { stream: msg?.stream || 'stdout', line: msg?.line || '', instanceId: runningId }
        }));
      });
      bridge().onGameStatus((s) => {
        runningId = s?.running ? (s?.instanceId || runningId) : null;
        setRunning(!!s?.running, s?.pid);
      });
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
    } catch {}

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
