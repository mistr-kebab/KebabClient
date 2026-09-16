'use strict';

(function () {
  const { bridge, toast, el } = window.launcherUtil;

  const ACCENTS = {
    amber: { label: 'Amber', accent: '#e8a020', strong: '#f5b93c', rgb: '232, 160, 32', ink: '#1a1204' },
    crimson: { label: 'Crimson', accent: '#e5484d', strong: '#f2555a', rgb: '229, 72, 77', ink: '#1c0607' },
    azure: { label: 'Azure', accent: '#4aa8ff', strong: '#6db9ff', rgb: '74, 168, 255', ink: '#06121f' },
    violet: { label: 'Violet', accent: '#9b8cff', strong: '#b3a6ff', rgb: '155, 140, 255', ink: '#100c22' },
    emerald: { label: 'Emerald', accent: '#3ecf6e', strong: '#5be386', rgb: '62, 207, 110', ink: '#04140a' }
  };

  const THEME_MODES = ['oled', 'dark', 'light', 'system'];
  let currentAccent = 'amber';
  let currentMode = 'oled';
  let currentLanguage = 'de';
  let systemQuery = null;
  const onSystemChange = () => applyTheme(currentAccent, 'system');

  function resolveMode(mode) {
    if (mode === 'system' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    if (mode === 'dark' || mode === 'light') return mode;
    return 'oled';
  }

  function applyTheme(key, mode) {
    const p = ACCENTS[key] || ACCENTS.amber;
    currentAccent = ACCENTS[key] ? key : 'amber';
    currentMode = THEME_MODES.includes(mode) ? mode : currentMode;
    const root = document.documentElement;
    root.style.setProperty('--accent', p.accent);
    root.style.setProperty('--accent-rgb', p.rgb);
    root.style.setProperty('--accent-strong', p.strong);
    root.style.setProperty('--accent-dim', `rgba(${p.rgb}, 0.14)`);
    root.style.setProperty('--accent-ink', p.ink);
    const effective = resolveMode(currentMode);
    if (effective === 'oled') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', effective);
    document.querySelectorAll('#accentSwatches .swatch').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.accent === currentAccent);
    });
    document.querySelectorAll('#themeModeSegment .segment-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.themeMode === currentMode);
    });
    document.querySelectorAll('#langSegment .segment-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.lang === currentLanguage);
    });
    if (window.matchMedia) {
      if (!systemQuery) systemQuery = window.matchMedia('(prefers-color-scheme: light)');
      try { systemQuery.removeEventListener('change', onSystemChange); } catch {}
      if (currentMode === 'system') {
        try { systemQuery.addEventListener('change', onSystemChange); } catch {}
      }
    }
  }

  window.applyTheme = applyTheme;

  function fillSelect(id, values, current, suffix) {
    const select = document.getElementById(id);
    if (!select) return;
    select.textContent = '';
    for (const v of values) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = `${v}${suffix || ''}`;
      if (Number(v) === Number(current)) opt.selected = true;
      select.appendChild(opt);
    }
  }

  function renderSwatches(active) {
    const row = document.getElementById('accentSwatches');
    if (!row) return;
    row.textContent = '';
    for (const [key, p] of Object.entries(ACCENTS)) {
      const btn = el('button', 'swatch' + (key === active ? ' is-active' : ''));
      btn.type = 'button';
      btn.dataset.accent = key;
      btn.title = p.label;
      btn.setAttribute('aria-label', `${p.label} accent`);
      btn.style.background = p.accent;
      btn.addEventListener('click', async () => {
        try {
          await bridge().updateSettings({ theme: { accent: key, mode: currentMode } });
          applyTheme(key, currentMode);
          toast(`Theme: ${p.label}.`, 'ok');
        } catch (err) {
          toast(`Theme failed: ${err.message}`, 'error');
        }
      });
      row.appendChild(btn);
    }
  }

  async function load() {
    let data = null;
    try {
      data = await bridge().getSettings();
    } catch (err) {
      toast(`Could not load settings: ${err.message}`, 'error');
      return;
    }
    const s = data.settings;
    currentLanguage = s.language === 'en' ? 'en' : 'de';
    if (window.i18n) window.i18n.initLanguage(currentLanguage);
    applyTheme(s.theme.accent, s.theme.mode);
    renderSwatches(s.theme.accent);
    fillSelect('javaRamSelect', data.ramOptions || [2, 4, 6, 8, 12, 16], s.java.xmx, ' GB');
    fillSelect('threadSelect', data.threadOptions || [2, 4, 8, 16], s.downloads.threads, '');
    const javaPath = document.getElementById('javaPathInput');
    const javaArgs = document.getElementById('javaArgsInput');
    if (javaPath) javaPath.value = s.java.path || '';
    if (javaArgs) javaArgs.value = s.java.extraArgs || '';
    const dirLabel = document.getElementById('dataDirLabel');
    if (dirLabel) {
      const suffix = data.dataDir.source === 'env'
        ? ' (from environment)'
        : data.dataDir.custom ? ' (custom)' : ' (default)';
      dirLabel.textContent = data.dataDir.current + suffix;
    }
    const dirInput = document.getElementById('dataDirInput');
    if (dirInput && data.dataDir.custom) dirInput.value = data.dataDir.custom;
  }

  function setStatus(id, text) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.i18n) window.i18n.initLanguage(null);
    document.querySelectorAll('#themeModeSegment .segment-btn').forEach((b) => {
      b.addEventListener('click', async () => {
        const mode = b.dataset.themeMode;
        try {
          await bridge().updateSettings({ theme: { accent: currentAccent, mode } });
          applyTheme(currentAccent, mode);
          toast(`Appearance: ${mode}.`, 'ok');
        } catch (err) {
          toast(`Theme failed: ${err.message}`, 'error');
        }
      });
    });
    document.querySelectorAll('#langSegment .segment-btn').forEach((b) => {
      b.addEventListener('click', async () => {
        const next = b.dataset.lang === 'en' ? 'en' : 'de';
        currentLanguage = next;
        if (window.i18n) window.i18n.setLanguage(next, false);
        applyTheme(currentAccent, currentMode);
        try {
          await bridge().updateSettings({ language: next });
          toast(next === 'de' ? 'Sprache: Deutsch.' : 'Language: English.', 'ok');
        } catch (err) {
          toast(`Language failed: ${err.message}`, 'error');
        }
      });
    });
    const saveJava = document.getElementById('saveJavaButton');
    if (saveJava) {
      saveJava.addEventListener('click', async () => {
        const pathInput = document.getElementById('javaPathInput');
        const ramSelect = document.getElementById('javaRamSelect');
        const argsInput = document.getElementById('javaArgsInput');
        try {
          await bridge().updateSettings({
            java: {
              path: pathInput ? pathInput.value : '',
              xmx: ramSelect ? Number(ramSelect.value) : 4,
              extraArgs: argsInput ? argsInput.value : ''
            }
          });
          setStatus('javaStatus', 'Saved. Applies to the next launch.');
          toast('Java settings saved.', 'ok');
        } catch (err) {
          setStatus('javaStatus', err.message);
          toast(`Save failed: ${err.message}`, 'error');
        }
      });
    }
    const browseJava = document.getElementById('browseJavaButton');
    if (browseJava) {
      browseJava.addEventListener('click', async () => {
        try {
          const res = await bridge().browseJava();
          if (res?.canceled) return;
          const pathInput = document.getElementById('javaPathInput');
          if (pathInput) pathInput.value = res.path;
        } catch (err) {
          toast(`Browse failed: ${err.message}`, 'error');
        }
      });
    }
    const saveDl = document.getElementById('saveDownloadsButton');
    if (saveDl) {
      saveDl.addEventListener('click', async () => {
        const threadSelect = document.getElementById('threadSelect');
        try {
          await bridge().updateSettings({
            downloads: { threads: threadSelect ? Number(threadSelect.value) : 8 }
          });
          setStatus('downloadsStatus', 'Saved. Applies to the next download.');
          toast('Download settings saved.', 'ok');
        } catch (err) {
          setStatus('downloadsStatus', err.message);
          toast(`Save failed: ${err.message}`, 'error');
        }
      });
    }
    const saveDir = document.getElementById('saveDataDirButton');
    if (saveDir) {
      saveDir.addEventListener('click', async () => {
        const dirInput = document.getElementById('dataDirInput');
        try {
          const res = await bridge().setDataDir(dirInput ? dirInput.value : '');
          setStatus('dataDirStatus', `Saved (${res.bootstrapFile}). Restart the app to use it. Nothing is moved automatically — use “Move everything here” to move now.`);
          toast('Data directory saved. Restart to apply.', 'ok');
        } catch (err) {
          setStatus('dataDirStatus', err.message);
          toast(`Save failed: ${err.message}`, 'error');
        }
      });
    }
    const openDir = document.getElementById('openDataFolderButton');
    if (openDir) {
      openDir.addEventListener('click', async () => {
        try {
          await bridge().openDataFolder();
        } catch (err) {
          toast(`Cannot open folder: ${err.message}`, 'error');
        }
      });
    }
    const moveDir = document.getElementById('moveDataDirButton');
    if (moveDir) {
      moveDir.addEventListener('click', async () => {
        const dirInput = document.getElementById('dataDirInput');
        const target = dirInput ? dirInput.value.trim() : '';
        if (!target) {
          setStatus('dataDirStatus', 'Enter a destination path first.');
          return;
        }
        if (!window.confirm(`Move ALL launcher data to\n${target}\nand switch over? The app must be restarted afterwards. Do not start the game during the move.`)) {
          return;
        }
        moveDir.disabled = true;
        setStatus('dataDirStatus', 'Moving data… do not close the app.');
        try {
          const res = await bridge().moveDataDir(target);
          const mb = Math.round((res.movedBytes || 0) / 1048576);
          setStatus('dataDirStatus', `Moved ${res.movedFiles} files (${mb} MB) to ${res.dir}. Restart the app to use it.`);
          toast(`Moved ${res.movedFiles} files. Restart to apply.`, 'ok');
          load();
        } catch (err) {
          setStatus('dataDirStatus', err.message);
          toast(`Move failed: ${err.message}`, 'error');
        } finally {
          moveDir.disabled = false;
        }
      });
    }
    load();
  });
})();
