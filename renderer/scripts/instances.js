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

  const TILE_BANNERS = ['banner.jpg', 'banner_2.jpg', 'banner_3.png', 'banner_4.webp', 'banner_5.webp', 'banner_7.jpg', 'banner_8.jpg', 'banner_9.jpg', 'banner_10.avif', 'banner_11.webp'];

  function tileBanner(instance) {
    const s = String((instance && instance.id) || (instance && instance.name) || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return `./assets/${TILE_BANNERS[h % TILE_BANNERS.length]}`;
  }

  function renderTiles(instances, activeId) {
    const grid = document.getElementById('instanceGrid');
    if (!grid) return;
    grid.textContent = '';
    if (!instances.length) {
      const empty = el('div', 'instance-empty');
      const ic = document.createElement('i');
      ic.setAttribute('data-lucide', 'boxes');
      empty.appendChild(ic);
      empty.appendChild(el('h3', 'empty-title', 'No instances yet'));
      empty.appendChild(el('p', 'muted', 'Create your first one to start playing.'));
      const btn = el('button', 'btn btn-play btn-sm', 'Create instance');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        const panel = document.getElementById('newInstancePanel');
        const newBtn = document.getElementById('newInstanceButton');
        if (panel && panel.hidden && newBtn) newBtn.click();
        if (panel) panel.scrollIntoView({ block: 'nearest' });
      });
      empty.appendChild(btn);
      grid.appendChild(empty);
      if (window.refreshIcons) window.refreshIcons();
      return;
    }
    for (const instance of instances) {
      const tile = el('article', 'instance-tile' + (instance.id === activeId ? ' is-active' : ''));
      tile.tabIndex = 0;
      tile.dataset.instanceId = instance.id;
      tile.setAttribute('role', 'button');
      tile.setAttribute('aria-label', `Select instance ${instance.name}`);
      const banner = el('div', 'tile-banner');
      banner.style.backgroundImage = `url("${tileBanner(instance)}")`;
      banner.setAttribute('aria-hidden', 'true');
      banner.appendChild(badge(instance));
      if (instance.iconDataUrl) {
        const custom = document.createElement('img');
        custom.className = 'tile-customicon';
        custom.alt = '';
        custom.src = instance.iconDataUrl;
        banner.appendChild(custom);
      }
      if (instance.id === activeId) {
        const pill = el('span', 'tile-activepill');
        const check = document.createElement('i');
        check.setAttribute('data-lucide', 'check');
        pill.appendChild(check);
        pill.appendChild(el('span', null, 'Active'));
        banner.appendChild(pill);
      }
      tile.appendChild(banner);
      tile.appendChild(el('span', 'tile-name', instance.name));
      const sub = el('span', 'tile-sub');
      const verBadge = el('span', `ver-badge ver-loader-${instance.loader || 'vanilla'}`);
      verBadge.appendChild(el('span', 'ver-dot'));
      verBadge.appendChild(document.createTextNode(instance.mc || ''));
      sub.appendChild(verBadge);
      const loaderInfo = instance.loaderVersion
        ? `${loaderLabel(instance.loader)} ${instance.loaderVersion}`
        : loaderLabel(instance.loader);
      sub.appendChild(document.createTextNode(` · ${loaderInfo}`));
      tile.appendChild(sub);
      if (instance.lastPlayed || instance.playtimeText) {
        const bits = [];
        if (instance.lastPlayed) {
          bits.push(`Played ${new Date(instance.lastPlayed).toLocaleDateString()}`);
        }
        if (instance.playtimeText) bits.push(`${instance.playtimeText} played`);
        tile.appendChild(el('span', 'tile-played', bits.join(' · ')));
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
  let resultOffset = 0;
  let resultTotal = 0;
  let resultLoading = false;
  let resultQ = '';
  const RESULT_LIMIT = 50;
  let detailCategory = 'mod';
  let searchFilter = 'all';

  const DETAIL_CATS = {
    mod: { label: 'mods', ext: '.jar' },
    resourcepack: { label: 'resource packs', ext: '.zip' },
    shader: { label: 'shaders', ext: '.zip' }
  };

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
      if (found.playtimeText) subEl.appendChild(document.createTextNode(` · ${found.playtimeText} played`));
    }
    const iconBox = document.querySelector('.detail-head .instance-icon');
    if (iconBox) {
      iconBox.textContent = '';
      if (found.iconDataUrl) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = found.iconDataUrl;
        iconBox.appendChild(img);
      } else {
        const fb = document.createElement('i');
        fb.setAttribute('data-lucide', 'boxes');
        iconBox.appendChild(fb);
        if (window.refreshIcons) window.refreshIcons();
      }
    }
    const iconBtn = document.getElementById('detailIconButton');
    if (iconBtn) {
      iconBtn.onclick = async () => {
        try {
          const res = await bridge().setInstanceIcon(detailId);
          if (res && !res.canceled) {
            toast('Icon updated.', 'ok');
            await openDetail(detailId);
            await loadInstances();
          }
        } catch (err) {
          toast(`Icon failed: ${err.message}`, 'error');
        }
      };
    }
    const iconClearBtn = document.getElementById('detailIconClearButton');
    if (iconClearBtn) {
      iconClearBtn.hidden = !found.iconDataUrl;
      iconClearBtn.onclick = async () => {
        try {
          await bridge().clearInstanceIcon(detailId);
          toast('Icon reset.', 'ok');
          await openDetail(detailId);
          await loadInstances();
        } catch (err) {
          toast(`Reset failed: ${err.message}`, 'error');
        }
      };
    }
    const title = document.getElementById('detailSearchTitle');
    if (title) title.textContent = `Add content to ${found.name}`;
    const input = document.getElementById('detailSearchInput');
    if (input) input.value = '';
    detailCategory = 'mod';
    searchFilter = 'all';
    document.querySelectorAll('#detailTabs .segment-btn').forEach((x) => {
      x.classList.toggle('is-active', x.dataset.category === 'all');
    });
    refreshDetailDropText();
    window.showView('instance-detail');
    await loadDetailInstalled();
    void fetchResults(true);
  }

  const installedProjectIds = new Set();

  function contentCard(m, key) {
    const card = el('article', 'content-card' + (m.disabled ? ' is-disabled' : ''));
    const top = el('div', 'card-top');
    if (m.icon) {
      const img = document.createElement('img');
      img.className = 'card-icon';
      img.alt = '';
      img.loading = 'lazy';
      img.src = m.icon;
      top.appendChild(img);
    } else {
      const fb = el('span', 'card-icon card-icon-fallback', '◈');
      fb.setAttribute('aria-hidden', 'true');
      top.appendChild(fb);
    }
    const main = el('div', 'card-main');
    main.appendChild(el('h4', 'card-name', m.name || m.file));
    main.appendChild(el('p', 'card-sub', m.file));
    main.title = m.file;
    top.appendChild(main);
    card.appendChild(top);
    const foot = el('div', 'card-foot');
    const sw = el('label', 'switch');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !m.disabled;
    const switchLabel = (on) => `${on ? 'Disable' : 'Enable'} ${m.name || m.file}`;
    box.title = m.disabled ? 'Enable' : 'Disable';
    box.setAttribute('aria-label', switchLabel(!m.disabled));
    box.addEventListener('change', async () => {
      box.disabled = true;
      try {
        const res = await bridge().toggleContent(m.file, key, detailId);
        m.file = res.file;
        m.disabled = res.disabled;
        card.classList.toggle('is-disabled', res.disabled);
        box.checked = !res.disabled;
        box.title = res.disabled ? 'Enable' : 'Disable';
        box.setAttribute('aria-label', switchLabel(!res.disabled));
        const sub = card.querySelector('.card-sub');
        if (sub) sub.textContent = res.file;
        main.title = res.file;
        toast(res.disabled ? `Disabled ${m.name || res.file}.` : `Enabled ${m.name || res.file}.`, 'ok');
      } catch (err) {
        box.checked = !m.disabled;
        toast(`Toggle failed: ${err.message}`, 'error');
      } finally {
        box.disabled = false;
      }
    });
    const track = el('span', 'track');
    track.setAttribute('aria-hidden', 'true');
    sw.appendChild(box);
    sw.appendChild(track);
    foot.appendChild(sw);
    const del = el('button', 'icon-btn icon-btn-tiny', '');
    del.type = 'button';
    del.title = `Delete ${m.name || m.file}`;
    del.setAttribute('aria-label', `Delete ${m.name || m.file}`);
    const trash = document.createElement('i');
    trash.setAttribute('data-lucide', 'trash-2');
    del.appendChild(trash);
    del.addEventListener('click', async () => {
      if (!window.confirm(`Delete "${m.name || m.file}" from this instance?`)) return;
      try {
        await bridge().uninstallMod(m.file, key, detailId);
        toast(`Removed ${m.name || m.file}.`, 'ok');
        await loadDetailInstalled();
      } catch (err) {
        toast(`Uninstall failed: ${err.message}`, 'error');
      }
    });
    foot.appendChild(del);
    card.appendChild(foot);
    return card;
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
    installedProjectIds.clear();
    const grouped = Array.isArray(data) ? { mod: data } : (data || {});
    for (const [key, listId, label] of DETAIL_GROUPS) {
      const list = document.getElementById(listId);
      if (!list) continue;
      list.textContent = '';
      const items = grouped[key] || [];
      if (!items.length) {
        list.appendChild(el('p', 'content-empty', `No ${label} installed.`));
        continue;
      }
      for (const m of items) {
        if (m && m.projectId) installedProjectIds.add(m.projectId);
        list.appendChild(contentCard(m, key));
      }
    }
    if (window.refreshIcons) window.refreshIcons();
  }

  function resultCardCount() {
    const grid = document.getElementById('detailResults');
    return grid ? grid.querySelectorAll('.mod-card').length : 0;
  }

  function showEmptyResultsMessage() {
    const grid = document.getElementById('detailResults');
    if (!grid || resultCardCount()) return;
    grid.textContent = '';
    grid.appendChild(el('p', 'muted', resultTotal ? 'Everything here is already installed.' : 'No compatible content found.'));
  }

  function pruneInstalledCards() {
    const grid = document.getElementById('detailResults');
    if (!grid) return;
    grid.querySelectorAll('[data-project-id]').forEach((card) => {
      if (installedProjectIds.has(card.dataset.projectId)) card.remove();
    });
    showEmptyResultsMessage();
  }

  function renderDetailResults(results, append) {
    const grid = document.getElementById('detailResults');
    if (!grid) return;
    if (!append) grid.textContent = '';
    const fresh = (results || []).filter((mod) => mod && !installedProjectIds.has(mod.id));
    for (const mod of fresh) {
      const card = el('article', 'mod-card');
      card.dataset.projectId = mod.id;
      const top = el('div', 'mod-top');
      if (mod.iconUrl) {
        const img = document.createElement('img');
        img.className = 'mod-icon';
        img.alt = '';
        img.loading = 'lazy';
        img.src = mod.iconUrl;
        top.appendChild(img);
      } else {
        const fallback = el('span', 'mod-icon mod-icon-fallback', '◈');
        fallback.setAttribute('aria-hidden', 'true');
        top.appendChild(fallback);
      }
      const main = el('div', 'mod-main');
      main.appendChild(el('h4', 'mod-title', mod.title));
      main.appendChild(el('p', 'mod-desc', mod.description || 'No description.'));
      const badges = el('div', 'mod-badges');
      const typeBadge = el('span', 'ver-badge');
      typeBadge.appendChild(el('span', 'ver-dot'));
      typeBadge.appendChild(document.createTextNode(TYPE_LABELS[mod.projectType] || 'Content'));
      badges.appendChild(typeBadge);
      main.appendChild(badges);
      top.appendChild(main);
      card.appendChild(top);
      const foot = el('div', 'mod-foot');
      const meta = el('div', 'mod-meta');
      if (mod.downloads) {
        const dlIcon = document.createElement('i');
        dlIcon.setAttribute('data-lucide', 'download');
        meta.appendChild(dlIcon);
        const dl = document.createElement('span');
        dl.textContent = formatDownloads(mod.downloads);
        meta.appendChild(dl);
      }
      if (mod.author) meta.appendChild(el('span', '', `by ${mod.author}`));
      if (meta.childElementCount) foot.appendChild(meta);
      if (INSTALLABLE.includes(mod.projectType)) {
        const btn = el('button', 'btn btn-primary btn-sm mod-install', 'Install');
        btn.type = 'button';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const res = await bridge().installMod(mod.id, undefined, detailId, mod.projectType, { title: mod.title, icon: mod.iconUrl });
            const extra = res?.dependencies?.length ? ` (+${res.dependencies.length} deps)` : '';
            const missing = res?.depProblems?.length ? ` Missing: ${res.depProblems.join('; ')}` : '';
            toast(`Installed ${res?.file || mod.title}${extra}.${missing}`, res?.depProblems?.length ? 'error' : 'ok');
            await loadDetailInstalled();
            pruneInstalledCards();
          } catch (err) {
            toast(`Install failed: ${err.message}`, 'error');
            btn.disabled = false;
          }
        });
        foot.appendChild(btn);
      }
      if (foot.childElementCount) card.appendChild(foot);
      grid.appendChild(card);
    }
    showEmptyResultsMessage();
    if (window.refreshIcons) window.refreshIcons();
  }

  function resultStatus() {
    const statusEl = document.getElementById('detailSearchStatus');
    if (!statusEl) return;
    const shown = resultCardCount();
    if (resultLoading && !shown) {
      statusEl.textContent = resultQ ? `Searching for “${resultQ}”…` : 'Loading popular content…';
    } else if (resultTotal) {
      statusEl.textContent = `${shown} of ${resultTotal} shown.`;
    } else {
      statusEl.textContent = resultQ ? 'No results.' : 'Popular right now.';
    }
  }

  async function fetchResults(reset) {
    if (!detailId || resultLoading) return;
    const input = document.getElementById('detailSearchInput');
    if (reset) {
      resultOffset = 0;
      resultTotal = 0;
      resultQ = input ? input.value.trim() : '';
    }
    const searching = resultQ.length > 0;
    resultLoading = true;
    resultStatus();
    try {
      const params = { limit: RESULT_LIMIT, offset: resultOffset, instanceId: detailId, category: searchFilter };
      if (!searching) params.sort = 'popular';
      const res = await bridge().searchMods(resultQ, params);
      if (!detailId) return;
      resultTotal = res.total || 0;
      renderDetailResults(res.results || [], !reset);
      resultOffset += (res.results || []).length;
    } catch (err) {
      const statusEl = document.getElementById('detailSearchStatus');
      if (statusEl) statusEl.textContent = searching ? `Search failed: ${err.message}` : `Browse failed: ${err.message}`;
    } finally {
      resultLoading = false;
      resultStatus();
    }
  }

  function loadMoreResults() {
    if (!detailId || resultLoading) return;
    if (resultOffset >= resultTotal) return;
    void fetchResults(false);
  }

  function onDetailSearchInput() {
    if (detailSearchTimer) window.clearTimeout(detailSearchTimer);
    detailSearchTimer = window.setTimeout(() => { void fetchResults(true); }, 400);
  }

  function refreshDetailDropText() {
    const text = document.getElementById('detailDropZoneText');
    const cat = DETAIL_CATS[detailCategory] || DETAIL_CATS.mod;
    if (text) text.textContent = `Drop ${cat.ext} files here to add them to this instance`;
  }

  function summarizeImport(res, kind) {
    const parts = [];
    if (res.added?.length) parts.push(`added ${res.added.join(', ')}`);
    if (res.skipped?.length) parts.push(`already there: ${res.skipped.join(', ')}`);
    if (!parts.length && !(res.failed?.length)) return `${kind}: nothing to do.`;
    let msg = `${kind}: ${parts.join('; ') || 'done'}.`;
    if (res.depProblems?.length) {
      res.failed = [...(res.failed || []), ...res.depProblems.map((d) => ({ file: 'dependency', reason: d }))];
    }
    if (res.installedDeps?.length) {
      msg += ` Dependencies installed: ${res.installedDeps.join(', ')}.`;
    }
    if (res.failed?.length) {
      msg += ` Failed: ${res.failed.map((f) => `${f.file} (${f.reason})`).join('; ')}`;
    }
    return msg;
  }

  async function detailUpload() {
    if (!detailId) return;
    try {
      const res = await bridge().uploadContent(detailCategory, detailId);
      if (res?.canceled) return;
      toast(summarizeImport(res, DETAIL_CATS[detailCategory].label), res?.failed?.length ? 'error' : 'ok');
      await loadDetailInstalled();
    } catch (err) {
      toast(`Upload failed: ${err.message}`, 'error');
    }
  }

  function collectDropPaths(dt) {
    const out = [];
    const push = (p) => {
      if (typeof p === 'string' && p.length > 0 && !out.includes(p)) out.push(p);
    };
    try {
      for (const f of (dt && dt.files) || []) push(f && f.path);
    } catch {}
    try {
      const items = dt && dt.items ? [...dt.items] : [];
      for (const it of items) {
        if (it && it.kind === 'file' && typeof it.getAsFile === 'function') {
          const f = it.getAsFile();
          push(f && f.path);
        }
      }
    } catch {}
    return out;
  }

  function dropErrorHint(dt) {
    let hasFiles = false;
    try {
      const types = [...(dt?.types || [])].map((s) => String(s).toLowerCase());
      hasFiles = types.includes('files');
    } catch {}
    if (hasFiles) {
      return 'Drop was blocked (Windows strips file drops when the app runs as administrator — restart it normally or use the file button).';
    }
    return 'Drop files from Explorer (not browser content).';
  }

  function bindDetailDropzone() {
    const zone = document.getElementById('detailDropZone');
    const view = document.getElementById('view-instance-detail');
    if (view) {
      view.addEventListener('dragover', (e) => e.preventDefault());
      view.addEventListener('drop', (e) => e.preventDefault());
    }
    if (!zone) return;
    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    ['dragenter', 'dragover'].forEach((name) => {
      zone.addEventListener(name, (e) => {
        stop(e);
        try {
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        } catch {}
        zone.classList.add('is-drag');
      });
    });
    ['dragleave', 'drop'].forEach((name) => {
      zone.addEventListener(name, (e) => {
        stop(e);
        zone.classList.remove('is-drag');
      });
    });
    zone.addEventListener('drop', async (e) => {
      if (!detailId) return;
      const files = collectDropPaths(e.dataTransfer);
      if (!files.length) {
        toast(dropErrorHint(e.dataTransfer), 'error');
        return;
      }
      try {
        const res = await bridge().dropFiles(detailCategory, files, detailId);
        toast(summarizeImport(res, DETAIL_CATS[detailCategory].label), res?.failed?.length ? 'error' : 'ok');
        await loadDetailInstalled();
      } catch (err) {
        toast(`Drop failed: ${err.message}`, 'error');
      }
    });
  }

  function bindDetailTabs() {
    document.querySelectorAll('#detailTabs .segment-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.category || 'all';
        searchFilter = cat;
        if (cat !== 'all') detailCategory = cat;
        document.querySelectorAll('#detailTabs .segment-btn').forEach((x) => {
          x.classList.toggle('is-active', x === btn);
        });
        refreshDetailDropText();
        const input = document.getElementById('detailSearchInput');
        if (input) input.value = '';
        void fetchResults(true);
      });
    });
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
    if (detailInput) {
      detailInput.addEventListener('input', onDetailSearchInput);
      detailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void fetchResults(true);
        }
      });
    }
    const detailSearchButton = document.getElementById('detailSearchButton');
    if (detailSearchButton) detailSearchButton.addEventListener('click', () => { void fetchResults(true); });
    const sentinel = document.getElementById('detailSentinel');
    if (sentinel && window.IntersectionObserver) {
      new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreResults();
      }, { rootMargin: '600px' }).observe(sentinel);
    }
    const detailUploadBtn = document.getElementById('detailUploadButton');
    if (detailUploadBtn) detailUploadBtn.addEventListener('click', detailUpload);
    bindDetailTabs();
    bindDetailDropzone();
    refreshDetailDropText();
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
    } catch {}
    try {
      bridge().onProgress(onInstanceProgress);
    } catch {}
    loadInstances();
  });
})();
