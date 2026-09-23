'use strict';

(function () {
  const { bridge, toast } = window.launcherUtil;
  const ctx = window.instancesCtx;
  const { tr, fmt, notifyChanged, LOADER_LABELS } = ctx;

  let loaderMeta = null;

  async function loadMcVersions() {
    const select = document.getElementById('newInstanceMc');
    if (!select) return;
    select.textContent = '';
    try {
      const versions = await bridge().getMcVersions();
      for (const v of versions || []) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
      }
    } catch (err) {
      const opt = document.createElement('option');
      opt.value = '26.1.2';
      opt.textContent = '26.1.2';
      select.appendChild(opt);
      toast(
        fmt(tr('inst.verFallback', 'Version list unavailable, using 26.1.2: {msg}'), { msg: err.message }),
        'error'
      );
    }
  }

  async function refreshLoaderNote() {
    const mcSelect = document.getElementById('newInstanceMc');
    const loaderSelect = document.getElementById('newInstanceLoader');
    const note = document.getElementById('newInstanceNote');
    const mc = mcSelect ? mcSelect.value : '';
    if (!mc || !loaderSelect) return;
    loaderMeta = null;
    if (note) note.textContent = tr('inst.checkingLoaders', 'Checking loader availability…');
    try {
      loaderMeta = await bridge().getLoaders(mc);
    } catch (err) {
      if (note) note.textContent = fmt(tr('inst.loaderCheckFail', 'Loader check failed: {msg}'), { msg: err.message });
      return;
    }
    for (const key of ['fabric', 'quilt']) {
      const opt = loaderSelect.querySelector(`option[value="${key}"]`);
      if (!opt) continue;
      const entry = loaderMeta[key];
      const ok = entry && entry.supported !== false && (entry.versions || []).length > 0;
      opt.disabled = !ok;
      if (ok) {
        opt.textContent = `${LOADER_LABELS[key]} (${entry.versions[0].version})`;
      } else {
        opt.textContent = fmt(tr('inst.noBuildShort', '{name} (no builds for {mc})'), { name: LOADER_LABELS[key], mc });
        if (loaderSelect.value === key) loaderSelect.value = 'vanilla';
      }
    }
    if (note) {
      const parts = [];
      for (const key of ['fabric', 'quilt']) {
        const entry = loaderMeta[key];
        if (entry && (entry.versions || []).length) parts.push(`${LOADER_LABELS[key]} ${entry.versions[0].version}`);
      }
      note.textContent = parts.length
        ? fmt(tr('inst.latestLoaders', 'Latest stable loaders for {mc}: {parts}.'), { mc, parts: parts.join(' · ') })
        : fmt(tr('inst.noBuilds', 'No Fabric/Quilt builds for {mc} — Vanilla works.'), { mc });
    }
  }

  async function create() {
    const nameInput = document.getElementById('newInstanceName');
    const mcSelect = document.getElementById('newInstanceMc');
    const loaderSelect = document.getElementById('newInstanceLoader');
    const status = document.getElementById('newInstanceStatus');
    const btn = document.getElementById('createInstanceButton');
    if (!mcSelect || !loaderSelect) return;
    if (btn) btn.disabled = true;
    if (status) status.textContent = tr('inst.creating', 'Creating…');
    try {
      const created = await bridge().createInstance({
        name: nameInput ? nameInput.value : '',
        mc: mcSelect.value,
        loader: loaderSelect.value,
      });
      if (status) status.textContent = '';
      if (nameInput) nameInput.value = '';
      const panel = document.getElementById('newInstancePanel');
      if (panel) panel.hidden = true;
      toast(fmt(tr('inst.created', 'Created {name}. Downloading files now…'), { name: created.name }), 'ok');
      notifyChanged();
      await ctx.loadInstances();
      window.showView('play');
      if (typeof window.ensureActiveInstance === 'function') {
        await window.ensureActiveInstance();
      }
    } catch (err) {
      if (status) status.textContent = err.message;
      toast(fmt(tr('inst.createFail', 'Create failed: {msg}'), { msg: err.message }), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.whenViewsReady(() => {
    const newBtn = document.getElementById('newInstanceButton');
    const panel = document.getElementById('newInstancePanel');
    const cancelBtn = document.getElementById('cancelInstanceButton');
    const createBtn = document.getElementById('createInstanceButton');
    const mcSelect = document.getElementById('newInstanceMc');
    if (newBtn && panel) {
      newBtn.addEventListener('click', async () => {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
          await loadMcVersions();
          await refreshLoaderNote();
        }
      });
    }
    if (cancelBtn && panel)
      cancelBtn.addEventListener('click', () => {
        panel.hidden = true;
      });
    if (createBtn) createBtn.addEventListener('click', create);
    if (mcSelect) mcSelect.addEventListener('change', refreshLoaderNote);
  });
})();
