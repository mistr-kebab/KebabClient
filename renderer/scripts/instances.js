'use strict';

(function () {
  const { bridge, toast, el, formatDownloads } = window.launcherUtil;
  void formatDownloads;

  const LOADER_LABELS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
  let loaderMeta = null;
  const progressById = new Map();
  const progressTimers = new Map();

  function loaderLabel(loader) {
    return LOADER_LABELS[loader] || loader || 'Vanilla';
  }

  function notifyChanged() {
    document.dispatchEvent(new CustomEvent('instances:changed'));
  }

  function paintTileProgress(tile, ratio, label) {
    const prog = tile.querySelector('.tile-progress');
    const fill = tile.querySelector('.tile-progress .progress-bar');
    const lab = tile.querySelector('.tile-progress-label');
    if (!prog || !fill || !lab) return;
    if (ratio === null || ratio === undefined) {
      prog.hidden = true;
      fill.style.width = '0%';
      lab.textContent = '';
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    prog.hidden = false;
    fill.style.width = `${pct}%`;
    lab.textContent = label ? `${pct}% — ${label}` : `${pct}%`;
  }

  function onInstanceProgress(p) {
    if (!p || !p.instanceId || typeof p.ratio !== 'number') return;
    if (p.phase === 'mods' || p.phase === 'settings') return;
    const label = `${p.phase || ''} — ${p.label || ''}`.replace(/^ — | — $/g, '').trim();
    const done = p.ratio >= 1;
    if (progressTimers.has(p.instanceId)) {
      window.clearTimeout(progressTimers.get(p.instanceId));
      progressTimers.delete(p.instanceId);
    }
    if (done) {
      progressById.set(p.instanceId, { ratio: 1, label });
      const timer = window.setTimeout(() => {
        progressById.delete(p.instanceId);
        progressTimers.delete(p.instanceId);
        const tile = document.querySelector(`.instance-tile[data-instance-id="${CSS.escape(p.instanceId)}"]`);
        if (tile) paintTileProgress(tile, null);
      }, 3000);
      progressTimers.set(p.instanceId, timer);
    } else {
      progressById.set(p.instanceId, { ratio: p.ratio, label });
    }
    const tile = document.querySelector(`.instance-tile[data-instance-id="${CSS.escape(p.instanceId)}"]`);
    if (tile) {
      const state = progressById.get(p.instanceId);
      paintTileProgress(tile, state.ratio, state.label);
    }
  }

  function badge(instance) {
    const span = el('span', `loader-badge loader-${instance.loader}`, loaderLabel(instance.loader));
    return span;
  }

  function renderTiles(instances, activeId) {
    const grid = document.getElementById('instanceGrid');
    if (!grid) return;
    grid.textContent = '';
    if (!instances.length) {
      grid.appendChild(el('p', 'muted', 'No instances yet. Create one above.'));
      return;
    }
    for (const instance of instances) {
      const tile = el('article', 'instance-tile' + (instance.id === activeId ? ' is-active' : ''));
      tile.tabIndex = 0;
      tile.dataset.instanceId = instance.id;
      tile.setAttribute('role', 'button');
      tile.setAttribute('aria-label', `Select instance ${instance.name}`);
      const icon = el('span', 'tile-icon');
      const glyph = document.createElement('i');
      glyph.setAttribute('data-lucide', instance.loader === 'vanilla' ? 'boxes' : 'package');
      icon.appendChild(glyph);
      tile.appendChild(icon);
      tile.appendChild(el('span', 'tile-name', instance.name));
      const sub = el('span', 'tile-sub', `${instance.mc} · `);
      sub.appendChild(badge(instance));
      tile.appendChild(sub);
      if (instance.lastPlayed) {
        const date = new Date(instance.lastPlayed);
        tile.appendChild(el('span', 'tile-played', `Played ${date.toLocaleDateString()}`));
      }
      const actions = el('span', 'tile-actions');
      const playBtn = el('button', 'btn btn-play btn-sm-pill', 'Play');
      playBtn.type = 'button';
      playBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await bridge().setActiveInstance(instance.id);
        } catch (err) {
          toast(`Select failed: ${err.message}`, 'error');
          return;
        }
        notifyChanged();
        window.showView('play');
        if (typeof window.startActiveGame === 'function') window.startActiveGame();
      });
      const delBtn = el('button', 'icon-btn tile-delete', '');
      delBtn.type = 'button';
      delBtn.title = `Delete ${instance.name}`;
      const trash = document.createElement('i');
      trash.setAttribute('data-lucide', 'trash-2');
      delBtn.appendChild(trash);
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!window.confirm(`Delete instance "${instance.name}" including its mods and worlds?`)) return;
        try {
          await bridge().deleteInstance(instance.id);
          toast(`Deleted ${instance.name}.`, 'ok');
          notifyChanged();
          await loadInstances();
        } catch (err) {
          toast(`Delete failed: ${err.message}`, 'error');
        }
      });
      actions.appendChild(playBtn);
      const infoBtn = el('button', 'icon-btn tile-delete', '');
      infoBtn.type = 'button';
      infoBtn.title = `Open ${instance.name} details`;
      const infoIcon = document.createElement('i');
      infoIcon.setAttribute('data-lucide', 'info');
      infoBtn.appendChild(infoIcon);
      infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDetail(instance.id);
      });
      actions.appendChild(infoBtn);
      actions.appendChild(delBtn);
      tile.appendChild(actions);
      const prog = el('span', 'tile-progress');
      prog.hidden = true;
      const track = el('span', 'progress tile-progress-track');
      track.appendChild(el('span', 'progress-bar'));
      prog.appendChild(track);
      prog.appendChild(el('span', 'tile-progress-label', ''));
      tile.appendChild(prog);
      const stored = progressById.get(instance.id);
      if (stored) paintTileProgress(tile, stored.ratio, stored.label);
      const select = async () => {
        try {
          await bridge().setActiveInstance(instance.id);
          notifyChanged();
          await loadInstances();
        } catch (err) {
          toast(`Select failed: ${err.message}`, 'error');
        }
      };
      tile.addEventListener('click', select);
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select();
        }
      });
      grid.appendChild(tile);
    }
    if (window.refreshIcons) window.refreshIcons();
  }

  async function loadInstances() {
    try {
      const res = await bridge().listInstances();
      renderTiles(res?.instances || [], res?.activeId);
    } catch (err) {
      toast(`Could not load instances: ${err.message}`, 'error');
    }
  }

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
      toast(`Version list unavailable, using 26.1.2: ${err.message}`, 'error');
    }
  }

  async function refreshLoaderNote() {
    const mcSelect = document.getElementById('newInstanceMc');
    const loaderSelect = document.getElementById('newInstanceLoader');
    const note = document.getElementById('newInstanceNote');
    const mc = mcSelect ? mcSelect.value : '';
    if (!mc || !loaderSelect) return;
    loaderMeta = null;
    if (note) note.textContent = 'Checking loader availability…';
    try {
      loaderMeta = await bridge().getLoaders(mc);
    } catch (err) {
      if (note) note.textContent = `Loader check failed: ${err.message}`;
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
        opt.textContent = `${LOADER_LABELS[key]} (no builds for ${mc})`;
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
        ? `Latest stable loaders for ${mc}: ${parts.join(' · ')}.`
        : `No Fabric/Quilt builds for ${mc} — Vanilla works.`;
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
    if (status) status.textContent = 'Creating…';
    try {
      const created = await bridge().createInstance({
        name: nameInput ? nameInput.value : '',
        mc: mcSelect.value,
        loader: loaderSelect.value
      });
      if (status) status.textContent = '';
      if (nameInput) nameInput.value = '';
      const panel = document.getElementById('newInstancePanel');
      if (panel) panel.hidden = true;
      toast(`Created ${created.name}. Downloading files now…`, 'ok');
      notifyChanged();
      await loadInstances();
      window.showView('play');
      if (typeof window.ensureActiveInstance === 'function') {
        await window.ensureActiveInstance();
      }
    } catch (err) {
      if (status) status.textContent = err.message;
      toast(`Create failed: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  let detailId = null;
  let detailSearchTimer = null;
  let detailSearching = false;

  const DETAIL_GROUPS = [
    ['mod', 'detail-mod', 'mods'],
    ['resourcepack', 'detail-resourcepack', 'resource packs'],
    ['shader', 'detail-shader', 'shaders']
  ];

  const TYPE_LABELS = { mod: 'Mod', resourcepack: 'Resource Pack', shader: 'Shader', modpack: 'Modpack', datapack: 'Data Pack', plugin: 'Plugin' };
  const INSTALLABLE = ['mod', 'resourcepack', 'shader'];

  async function openDetail(id) {
    let found = null;
    try {
      const res = await bridge().listInstances();
      found = (res?.instances || []).find((i) => i.id === id) || null;
    } catch (err) {
      toast(`Could not open instance: ${err.message}`, 'error');
      return;
    }
    if (!found) {
      toast('Instance not found.', 'error');
      return;
    }
    detailId = id;
    const nameEl = document.getElementById('detailName');
    const subEl = document.getElementById('detailSub');
    if (nameEl) nameEl.textContent = found.name;
    if (subEl) {
      subEl.textContent = `${found.mc} · `;
      subEl.appendChild(badge(found));
    }
    const title = document.getElementById('detailSearchTitle');
    if (title) title.textContent = `Add content to ${found.name}`;
    const input = document.getElementById('detailSearchInput');
    if (input) input.value = '';
    const results = document.getElementById('detailResults');
    if (results) results.textContent = '';
    const st = document.getElementById('detailSearchStatus');
    if (st) st.textContent = 'Type to search Modrinth for this instance.';
    window.showView('instance-detail');
    await loadDetailInstalled();
  }

  async function loadDetailInstalled() {
    if (!detailId) return;
    let data = null;
    try {
      data = await bridge().listInstalledMods(detailId);
    } catch (err) {
      toast(`Could not list content: ${err.message}`, 'error');
      return;
    }
    const grouped = Array.isArray(data) ? { mod: data } : (data || {});
    for (const [key, listId, label] of DETAIL_GROUPS) {
      const list = document.getElementById(listId);
      if (!list) continue;
      list.textContent = '';
      const items = grouped[key] || [];
      if (!items.length) {
        list.appendChild(el('li', 'installed-empty', `No ${label} installed.`));
        continue;
      }
      for (const m of items) {
        const li = el('li', 'installed-item');
        li.appendChild(el('span', '', m.file));
        const btn = el('button', 'btn btn-ghost btn-sm', 'Uninstall');
        btn.type = 'button';
        btn.addEventListener('click', async () => {
          try {
            await bridge().uninstallMod(m.file, key, detailId);
            toast(`Removed ${m.file}.`, 'ok');
            await loadDetailInstalled();
          } catch (err) {
            toast(`Uninstall failed: ${err.message}`, 'error');
          }
        });
        li.appendChild(btn);
        list.appendChild(li);
      }
    }
  }

  function renderDetailResults(results) {
    const grid = document.getElementById('detailResults');
    if (!grid) return;
    grid.textContent = '';
    if (!results.length) {
      grid.appendChild(el('p', 'muted', 'No compatible content found.'));
      return;
    }
    for (const mod of results) {
      const card = el('article', 'mod-card');
      if (mod.iconUrl) {
        const img = document.createElement('img');
        img.className = 'mod-icon';
        img.alt = '';
        img.loading = 'lazy';
        img.src = mod.iconUrl;
        card.appendChild(img);
      } else {
        const fallback = el('span', 'mod-icon mod-icon-fallback', '◈');
        fallback.setAttribute('aria-hidden', 'true');
        card.appendChild(fallback);
      }
      const main = el('div', 'mod-main');
      main.appendChild(el('h4', 'mod-title', mod.title));
      main.appendChild(el('p', 'mod-desc', `${TYPE_LABELS[mod.projectType] || 'Content'} · ${mod.description || 'No description.'}`));
      const meta = el('div', 'mod-meta');
      if (mod.downloads) {
        const dl = document.createElement('span');
        dl.textContent = `⇩ ${formatDownloads(mod.downloads)}`;
        meta.appendChild(dl);
      }
      if (mod.author) meta.appendChild(el('span', '', `by ${mod.author}`));
      main.appendChild(meta);
      if (INSTALLABLE.includes(mod.projectType)) {
        const btn = el('button', 'btn btn-primary btn-sm mod-install', 'Install');
        btn.type = 'button';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const res = await bridge().installMod(mod.id, undefined, detailId, mod.projectType);
            const extra = res?.dependencies?.length ? ` (+${res.dependencies.length} deps)` : '';
            const missing = res?.depProblems?.length ? ` Missing: ${res.depProblems.join('; ')}` : '';
            toast(`Installed ${res?.file || mod.title}${extra}.${missing}`, res?.depProblems?.length ? 'error' : 'ok');
            await loadDetailInstalled();
          } catch (err) {
            toast(`Install failed: ${err.message}`, 'error');
          } finally {
            btn.disabled = false;
          }
        });
        main.appendChild(btn);
      }
      card.appendChild(main);
      grid.appendChild(card);
    }
    if (window.refreshIcons) window.refreshIcons();
  }

  async function detailSearch() {
    if (!detailId || detailSearching) return;
    const input = document.getElementById('detailSearchInput');
    const statusEl = document.getElementById('detailSearchStatus');
    const grid = document.getElementById('detailResults');
    const q = input ? input.value.trim() : '';
    if (!q) {
      if (grid) grid.textContent = '';
      if (statusEl) statusEl.textContent = 'Type to search Modrinth for this instance.';
      return;
    }
    detailSearching = true;
    if (statusEl) statusEl.textContent = `Searching for “${q}”…`;
    try {
      const res = await bridge().searchMods(q, { limit: 12, offset: 0, instanceId: detailId, category: 'all' });
      if (!detailId) return;
      if (statusEl) statusEl.textContent = `${res.total} result(s).`;
      renderDetailResults(res.results || []);
    } catch (err) {
      if (statusEl) statusEl.textContent = `Search failed: ${err.message}`;
    } finally {
      detailSearching = false;
    }
  }

  function onDetailSearchInput() {
    if (detailSearchTimer) window.clearTimeout(detailSearchTimer);
    detailSearchTimer = window.setTimeout(detailSearch, 400);
  }

  document.addEventListener('DOMContentLoaded', () => {
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
    if (cancelBtn && panel) cancelBtn.addEventListener('click', () => { panel.hidden = true; });
    if (createBtn) createBtn.addEventListener('click', create);
    if (mcSelect) mcSelect.addEventListener('change', refreshLoaderNote);
    const backBtn = document.getElementById('detailBackButton');
    if (backBtn) backBtn.addEventListener('click', () => window.showView('instances'));
    const detailReload = document.getElementById('detailReloadButton');
    if (detailReload) detailReload.addEventListener('click', loadDetailInstalled);
    const detailInput = document.getElementById('detailSearchInput');
    if (detailInput) detailInput.addEventListener('input', onDetailSearchInput);
    const detailPlay = document.getElementById('detailPlayButton');
    if (detailPlay) {
      detailPlay.addEventListener('click', async () => {
        if (!detailId) return;
        try {
          await bridge().setActiveInstance(detailId);
        } catch (err) {
          toast(`Select failed: ${err.message}`, 'error');
          return;
        }
        notifyChanged();
        window.showView('play');
        if (typeof window.startActiveGame === 'function') window.startActiveGame();
      });
    }
    document.addEventListener('instances:changed', () => {
      if (detailId) loadDetailInstalled();
    });
    try {
      bridge().onInstancesChanged(() => loadInstances());
    } catch { /* noop */ }
    try {
      bridge().onProgress(onInstanceProgress);
    } catch { /* noop */ }
    loadInstances();
  });
})();
