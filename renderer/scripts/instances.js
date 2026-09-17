'use strict';

(function () {
  const { bridge, toast, el, formatDownloads } = window.launcherUtil;
  void formatDownloads;

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
      empty.appendChild(el('h3', 'empty-title', tr('inst.emptyTitle', 'No instances yet')));
      empty.appendChild(el('p', 'muted', tr('inst.emptySub', 'Create your first one to start playing.')));
      const btn = el('button', 'btn btn-play btn-sm', tr('instances.createTitle', 'Create instance'));
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
      tile.setAttribute('aria-label', fmt(tr('inst.selectTile', 'Select instance {name}'), { name: instance.name }));
      const banner = el('div', 'tile-banner');
      banner.style.backgroundImage = `url("${String(tileBanner(instance)).replace(/"/g, '%22')}")`;
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
        pill.appendChild(el('span', null, tr('inst.active', 'Active')));
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
          bits.push(fmt(tr('inst.playedOn', 'Played {date}'), { date: new Date(instance.lastPlayed).toLocaleDateString() }));
        }
        if (instance.playtimeText) bits.push(fmt(tr('inst.playedTime', '{t} played'), { t: instance.playtimeText }));
        tile.appendChild(el('span', 'tile-played', bits.join(' · ')));
      }
      const actions = el('span', 'tile-actions');
      const playBtn = el('button', 'btn btn-play btn-sm-pill', tr('home.play', 'Play'));
      playBtn.type = 'button';
      playBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await bridge().setActiveInstance(instance.id);
        } catch (err) {
          toast(fmt(tr('inst.selectFail', 'Select failed: {msg}'), { msg: err.message }), 'error');
          return;
        }
        notifyChanged();
        window.showView('play');
        if (typeof window.startActiveGame === 'function') window.startActiveGame();
      });
      const delBtn = el('button', 'icon-btn tile-delete', '');
      delBtn.type = 'button';
      delBtn.title = fmt(tr('inst.deleteTitle', 'Delete {name}'), { name: instance.name });
      delBtn.setAttribute('aria-label', fmt(tr('inst.deleteTitle', 'Delete {name}'), { name: instance.name }));
      const trash = document.createElement('i');
      trash.setAttribute('data-lucide', 'trash-2');
      delBtn.appendChild(trash);
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!window.confirm(fmt(tr('inst.deleteConfirm', 'Delete instance “{name}” including its mods and worlds?'), { name: instance.name }))) return;
        try {
          await bridge().deleteInstance(instance.id);
          toast(fmt(tr('inst.deleted', 'Deleted {name}.'), { name: instance.name }), 'ok');
          notifyChanged();
          await loadInstances();
        } catch (err) {
          toast(fmt(tr('inst.deleteFail', 'Delete failed: {msg}'), { msg: err.message }), 'error');
        }
      });
      actions.appendChild(playBtn);
      const infoBtn = el('button', 'icon-btn tile-delete', '');
      infoBtn.type = 'button';
      infoBtn.title = fmt(tr('inst.openDetails', 'Open {name} details'), { name: instance.name });
      infoBtn.setAttribute('aria-label', fmt(tr('inst.openDetails', 'Open {name} details'), { name: instance.name }));
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
          toast(fmt(tr('inst.selectFail', 'Select failed: {msg}'), { msg: err.message }), 'error');
        }
      };
      tile.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('button')) return;
        select();
      });
      tile.addEventListener('keydown', (e) => {
        if (e.target !== tile) return;
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
      toast(fmt(tr('inst.loadFail', 'Could not load instances: {msg}'), { msg: err.message }), 'error');
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
      toast(fmt(tr('inst.verFallback', 'Version list unavailable, using 26.1.2: {msg}'), { msg: err.message }), 'error');
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
        loader: loaderSelect.value
      });
      if (status) status.textContent = '';
      if (nameInput) nameInput.value = '';
      const panel = document.getElementById('newInstancePanel');
      if (panel) panel.hidden = true;
      toast(fmt(tr('inst.created', 'Created {name}. Downloading files now…'), { name: created.name }), 'ok');
      notifyChanged();
      await loadInstances();
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

  let detailId = null;
  let detailName = '';
  let installedTab = 'mod';
  let detailContentData = null;

  const logBuffers = new Map();
  const LOG_BUFFER_MAX = 500;
  const LOG_VIEW_MAX = 1000;

  function detailLogView() {
    return document.getElementById('detailLogView');
  }

  function appendDetailLogLine(stream, line) {
    const view = detailLogView();
    if (!view) return;
    const div = document.createElement('div');
    div.className = `log-line-${stream}`;
    div.textContent = line;
    view.appendChild(div);
    while (view.children.length > LOG_VIEW_MAX) view.firstChild.remove();
    view.scrollTop = view.scrollHeight;
  }

  function renderDetailLog() {
    const view = detailLogView();
    if (!view) return;
    view.textContent = '';
    const buf = (detailId && logBuffers.get(detailId)) || [];
    for (const entry of buf.slice(-LOG_VIEW_MAX)) {
      const div = document.createElement('div');
      div.className = `log-line-${entry.stream}`;
      div.textContent = entry.line;
      view.appendChild(div);
    }
    view.scrollTop = view.scrollHeight;
  }

  function pushInstanceLog(instanceId, stream, line) {
    if (!instanceId) return;
    let buf = logBuffers.get(instanceId);
    if (!buf) {
      buf = [];
      logBuffers.set(instanceId, buf);
    }
    buf.push({ stream, line });
    if (buf.length > LOG_BUFFER_MAX) buf.splice(0, buf.length - LOG_BUFFER_MAX);
    if (instanceId === detailId) appendDetailLogLine(stream, line);
  }

  document.addEventListener('game:log-line', (e) => {
    const d = e && e.detail;
    if (d) pushInstanceLog(d.instanceId, d.stream, d.line);
  });
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

  const INSTALLABLE = ['mod', 'resourcepack', 'shader'];

  function typeLabel(t) {
    switch (t) {
      case 'mod': return tr('inst.typeMod', 'Mod');
      case 'resourcepack': return tr('inst.typeRp', 'Resource Pack');
      case 'shader': return tr('inst.typeShader', 'Shader');
      case 'modpack': return tr('inst.typeModpack', 'Modpack');
      case 'datapack': return tr('inst.typeDatapack', 'Data Pack');
      case 'plugin': return tr('inst.typePlugin', 'Plugin');
      default: return tr('inst.typeContent', 'Content');
    }
  }

  function groupLabel(cat) {
    if (cat === 'resourcepack') return tr('detail.gRp', 'Resource Packs');
    if (cat === 'shader') return tr('detail.gShaders', 'Shaders');
    return tr('detail.gMods', 'Mods');
  }

  const EMPTY_BY_CAT = { mod: 'inst.emptyMods', resourcepack: 'inst.emptyRp', shader: 'inst.emptyShaders' };

  async function openDetail(id) {
    let found = null;
    try {
      const res = await bridge().listInstances();
      found = (res?.instances || []).find((i) => i.id === id) || null;
    } catch (err) {
      toast(fmt(tr('inst.openFail', 'Could not open instance: {msg}'), { msg: err.message }), 'error');
      return;
    }
    if (!found) {
      toast(tr('inst.notFound', 'Instance not found.'), 'error');
      return;
    }
    detailId = id;
    detailName = found.name;
    const nameEl = document.getElementById('detailName');
    const subEl = document.getElementById('detailSub');
    if (nameEl) nameEl.textContent = found.name;
    if (subEl) {
      subEl.textContent = `${loaderLabel(found.loader)}, ${found.mc}`;
      if (found.playtimeText) subEl.appendChild(document.createTextNode(` · ${fmt(tr('inst.playedTime', '{t} played'), { t: found.playtimeText })}`));
    }
    const iconBox = document.querySelector('#detailIconButton .detail-icon-img');
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
            toast(tr('inst.iconOk', 'Icon updated.'), 'ok');
            await openDetail(detailId);
            await loadInstances();
          }
        } catch (err) {
          toast(fmt(tr('inst.iconFail', 'Icon failed: {msg}'), { msg: err.message }), 'error');
        }
      };
    }
    const title = document.getElementById('detailSearchTitle');
    if (title) title.textContent = fmt(tr('detail.addTo', 'Add content to {name}'), { name: found.name });
    const input = document.getElementById('detailSearchInput');
    if (input) input.value = '';
    installedTab = 'mod';
    syncContentTabs();
    detailCategory = 'mod';
    searchFilter = 'all';
    document.querySelectorAll('#detailTabs .segment-btn').forEach((x) => {
      x.classList.toggle('is-active', x.dataset.category === 'all');
    });
    refreshDetailDropText();
    window.showView('instance-detail');
    await loadDetailInstalled();
    renderDetailLog();
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
    const switchLabel = (on) => fmt(tr(on ? 'inst.disable' : 'inst.enable', on ? 'Disable {name}' : 'Enable {name}'), { name: m.name || m.file });
    box.title = m.disabled ? tr('inst.enableShort', 'Enable') : tr('inst.disableShort', 'Disable');
    box.setAttribute('aria-label', switchLabel(!m.disabled));
    box.addEventListener('change', async () => {
      box.disabled = true;
      try {
        const res = await bridge().toggleContent(m.file, key, detailId);
        m.file = res.file;
        m.disabled = res.disabled;
        card.classList.toggle('is-disabled', res.disabled);
        box.checked = !res.disabled;
        box.title = res.disabled ? tr('inst.enableShort', 'Enable') : tr('inst.disableShort', 'Disable');
        box.setAttribute('aria-label', switchLabel(!res.disabled));
        const sub = card.querySelector('.card-sub');
        if (sub) sub.textContent = res.file;
        main.title = res.file;
        toast(fmt(tr(res.disabled ? 'inst.disabledToast' : 'inst.enabledToast', res.disabled ? 'Disabled {name}.' : 'Enabled {name}.'), { name: m.name || res.file }), 'ok');
      } catch (err) {
        box.checked = !m.disabled;
        toast(fmt(tr('inst.toggleFail', 'Toggle failed: {msg}'), { msg: err.message }), 'error');
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
    del.title = fmt(tr('inst.deleteTitle', 'Delete {name}'), { name: m.name || m.file });
    del.setAttribute('aria-label', fmt(tr('inst.deleteTitle', 'Delete {name}'), { name: m.name || m.file }));
    const trash = document.createElement('i');
    trash.setAttribute('data-lucide', 'trash-2');
    del.appendChild(trash);
    del.addEventListener('click', async () => {
      if (!window.confirm(fmt(tr('inst.delContentConfirm', 'Delete “{name}” from this instance?'), { name: m.name || m.file }))) return;
      try {
        await bridge().uninstallMod(m.file, key, detailId);
        toast(fmt(tr('inst.removedToast', 'Removed {name}.'), { name: m.name || m.file }), 'ok');
        await loadDetailInstalled();
      } catch (err) {
        toast(fmt(tr('inst.uninstallFail', 'Uninstall failed: {msg}'), { msg: err.message }), 'error');
      }
    });
    foot.appendChild(del);
    card.appendChild(foot);
    return card;
  }

  function renderDetailGrid() {
    const grid = document.getElementById('detailContentGrid');
    const logPanel = document.getElementById('detailLogPanel');
    const showLog = installedTab === 'logs';
    if (grid) grid.hidden = showLog;
    if (logPanel) logPanel.hidden = !showLog;
    if (showLog) {
      renderDetailLog();
      return;
    }
    if (!grid) return;
    grid.textContent = '';
    const items = (detailContentData && detailContentData[installedTab]) || [];
    if (!items.length) {
      grid.appendChild(el('p', 'content-empty', tr(EMPTY_BY_CAT[installedTab] || 'inst.emptyMods', 'No content installed.')));
    } else {
      for (const m of items) grid.appendChild(contentCard(m, installedTab));
    }
    if (window.refreshIcons) window.refreshIcons();
  }

  function syncContentTabs() {
    document.querySelectorAll('#detailContentTabs .segment-btn').forEach((x) => {
      x.classList.toggle('is-active', x.dataset.contentTab === installedTab);
    });
  }

  async function loadDetailInstalled() {
    if (!detailId) return;
    let data = null;
    try {
      data = await bridge().listInstalledMods(detailId);
    } catch (err) {
      toast(fmt(tr('inst.listFail', 'Could not list content: {msg}'), { msg: err.message }), 'error');
      return;
    }
    installedProjectIds.clear();
    const grouped = Array.isArray(data) ? { mod: data } : (data || {});
    detailContentData = grouped;
    for (const key of ['mod', 'resourcepack', 'shader']) {
      for (const m of grouped[key] || []) {
        if (m && m.projectId) installedProjectIds.add(m.projectId);
      }
    }
    renderDetailGrid();
  }

  function resultCardCount() {
    const grid = document.getElementById('detailResults');
    return grid ? grid.querySelectorAll('.mod-card').length : 0;
  }

  function showEmptyResultsMessage() {
    const grid = document.getElementById('detailResults');
    if (!grid || resultCardCount()) return;
    grid.textContent = '';
    grid.appendChild(el('p', 'muted', resultTotal ? tr('inst.allInstalled', 'Everything here is already installed.') : tr('inst.noContent', 'No compatible content found.')));
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
      main.appendChild(el('p', 'mod-desc', mod.description || tr('inst.noDesc', 'No description.')));
      const badges = el('div', 'mod-badges');
      const typeBadge = el('span', 'ver-badge');
      typeBadge.appendChild(el('span', 'ver-dot'));
      typeBadge.appendChild(document.createTextNode(typeLabel(mod.projectType)));
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
      if (mod.author) meta.appendChild(el('span', '', fmt(tr('inst.by', 'by {a}'), { a: mod.author })));
      if (meta.childElementCount) foot.appendChild(meta);
      if (INSTALLABLE.includes(mod.projectType)) {
        const btn = el('button', 'btn btn-primary btn-sm mod-install', tr('inst.install', 'Install'));
        btn.type = 'button';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const res = await bridge().installMod(mod.id, undefined, detailId, mod.projectType, { title: mod.title, icon: mod.iconUrl });
            const extra = res?.dependencies?.length ? fmt(tr('inst.extraDeps', ' (+{n} deps)'), { n: res.dependencies.length }) : '';
            const missing = res?.depProblems?.length ? fmt(tr('inst.missingDeps', ' Missing: {x}'), { x: res.depProblems.join('; ') }) : '';
            toast(fmt(tr('inst.installed', 'Installed {file}{extra}.{missing}'), { file: res?.file || mod.title, extra, missing }), res?.depProblems?.length ? 'error' : 'ok');
            await loadDetailInstalled();
            pruneInstalledCards();
          } catch (err) {
            toast(fmt(tr('inst.installFail', 'Install failed: {msg}'), { msg: err.message }), 'error');
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
      statusEl.textContent = resultQ ? fmt(tr('inst.searching', 'Searching for “{q}”…'), { q: resultQ }) : tr('inst.loadingPopular', 'Loading popular content…');
    } else if (resultTotal) {
      statusEl.textContent = fmt(tr('inst.shown', '{a} of {b} shown.'), { a: shown, b: resultTotal });
    } else {
      statusEl.textContent = resultQ ? tr('inst.noResults', 'No results.') : tr('inst.popularNow', 'Popular right now.');
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
      if (statusEl) statusEl.textContent = searching
        ? fmt(tr('inst.searchFail', 'Search failed: {msg}'), { msg: err.message })
        : fmt(tr('inst.browseFail', 'Browse failed: {msg}'), { msg: err.message });
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
    if (text) text.textContent = fmt(tr('detail.drop', 'Drop {ext} files here to add them to this instance'), { ext: cat.ext });
  }

  function summarizeImport(res, kind) {
    const parts = [];
    if (res.added?.length) parts.push(fmt(tr('inst.sumAdded', 'added {x}'), { x: res.added.join(', ') }));
    if (res.skipped?.length) parts.push(fmt(tr('inst.sumSkipped', 'already there: {x}'), { x: res.skipped.join(', ') }));
    if (!parts.length && !(res.failed?.length)) return fmt(tr('inst.nothingToDo', '{kind}: nothing to do.'), { kind });
    let msg = `${kind}: ${parts.join('; ') || tr('inst.done', 'done')}.`;
    if (res.depProblems?.length) {
      res.failed = [...(res.failed || []), ...res.depProblems.map((d) => ({ file: 'dependency', reason: d }))];
    }
    if (res.installedDeps?.length) {
      msg += fmt(tr('inst.sumDeps', ' Dependencies installed: {x}.'), { x: res.installedDeps.join(', ') });
    }
    if (res.failed?.length) {
      msg += fmt(tr('inst.sumFailed', ' Failed: {x}'), { x: res.failed.map((f) => `${f.file} (${f.reason})`).join('; ') });
    }
    return msg;
  }

  async function detailUpload() {
    if (!detailId) return;
    try {
      const res = await bridge().uploadContent(detailCategory, detailId);
      if (res?.canceled) return;
      toast(summarizeImport(res, groupLabel(detailCategory)), res?.failed?.length ? 'error' : 'ok');
      await loadDetailInstalled();
    } catch (err) {
      toast(fmt(tr('inst.uploadFail', 'Upload failed: {msg}'), { msg: err.message }), 'error');
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
      return tr('inst.dropAdmin', 'Drop was blocked (Windows strips file drops when the app runs as administrator — restart it normally or use the file button).');
    }
    return tr('inst.dropHint', 'Drop files from Explorer (not browser content).');
  }

  function bindDetailDropzone() {
    const zone = document.getElementById('detailDropZone');
    for (const viewId of ['view-instance-detail', 'view-add-content']) {
      const view = document.getElementById(viewId);
      if (view) {
        view.addEventListener('dragover', (e) => e.preventDefault());
        view.addEventListener('drop', (e) => e.preventDefault());
      }
    }
    const importDropped = async (files, dt) => {
      if (!detailId) return;
      if (!files.length) {
        toast(dropErrorHint(dt), 'error');
        return;
      }
      try {
        const res = await bridge().dropFiles(detailCategory, files, detailId);
        toast(summarizeImport(res, groupLabel(detailCategory)), res?.failed?.length ? 'error' : 'ok');
        await loadDetailInstalled();
      } catch (err) {
        toast(fmt(tr('inst.dropFail', 'Drop failed: {msg}'), { msg: err.message }), 'error');
      }
    };
    for (const viewId of ['view-instance-detail', 'view-add-content']) {
      const view = document.getElementById(viewId);
      if (view) {
        view.addEventListener('drop', async (e) => {
          if (!detailId) return;
          if (e.target && e.target.closest && e.target.closest('#detailDropZone')) return;
          await importDropped(collectDropPaths(e.dataTransfer), e.dataTransfer);
        });
      }
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
      await importDropped(collectDropPaths(e.dataTransfer), e.dataTransfer);
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
    document.querySelectorAll('#detailContentTabs .segment-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        installedTab = btn.dataset.contentTab || 'mod';
        syncContentTabs();
        renderDetailGrid();
      });
    });
    const detailDelete = document.getElementById('detailDeleteButton');
    if (detailDelete) {
      detailDelete.addEventListener('click', async () => {
        if (!detailId) return;
        const name = detailName || 'Instance';
        if (!window.confirm(fmt(tr('inst.deleteConfirm', 'Delete instance “{name}” including its mods and worlds?'), { name }))) return;
        try {
          await bridge().deleteInstance(detailId);
          toast(fmt(tr('inst.deleted', 'Deleted {name}.'), { name }), 'ok');
          detailId = null;
          detailName = '';
          detailContentData = null;
          notifyChanged();
          window.showView('instances');
          await loadInstances();
        } catch (err) {
          toast(fmt(tr('inst.deleteFail', 'Delete failed: {msg}'), { msg: err.message }), 'error');
        }
      });
    }
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
    const detailAddContentButton = document.getElementById('detailAddContentButton');
    if (detailAddContentButton) detailAddContentButton.addEventListener('click', () => {
      if (!detailId) return;
      window.showView('add-content');
      void fetchResults(true);
    });
    const detailAddBackButton = document.getElementById('detailAddBackButton');
    if (detailAddBackButton) detailAddBackButton.addEventListener('click', async () => {
      window.showView('instance-detail');
      await loadDetailInstalled();
    });
    const sentinel = document.getElementById('detailSentinel');
    if (sentinel && window.IntersectionObserver) {
      new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreResults();
      }, { rootMargin: '600px' }).observe(sentinel);
    }
    const detailUploadBtn = document.getElementById('detailUploadButton');
    if (detailUploadBtn) detailUploadBtn.addEventListener('click', detailUpload);
    const detailClearLog = document.getElementById('detailClearLogButton');
    if (detailClearLog) {
      detailClearLog.addEventListener('click', () => {
        if (detailId) logBuffers.delete(detailId);
        const view = detailLogView();
        if (view) view.textContent = '';
      });
    }
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
          toast(fmt(tr('inst.selectFail', 'Select failed: {msg}'), { msg: err.message }), 'error');
          return;
        }
        notifyChanged();
        window.showView('play');
        if (typeof window.startActiveGame === 'function') window.startActiveGame();
      });
    }
    const detailSelect = document.getElementById('detailSelectButton');
    if (detailSelect) {
      detailSelect.addEventListener('click', async () => {
        if (!detailId) return;
        try {
          await bridge().setActiveInstance(detailId);
          notifyChanged();
          await loadInstances();
          toast(fmt(tr('inst.selected', 'Selected {name}.'), { name: detailName || 'Instance' }), 'ok');
        } catch (err) {
          toast(fmt(tr('inst.selectFail', 'Select failed: {msg}'), { msg: err.message }), 'error');
        }
      });
    }
    document.addEventListener('instances:changed', () => {
      if (detailId) loadDetailInstalled();
    });
    document.addEventListener('i18n:applied', () => {
      loadInstances().catch(() => {});
      if (detailId) {
        const title = document.getElementById('detailSearchTitle');
        if (title && detailName) title.textContent = fmt(tr('detail.addTo', 'Add content to {name}'), { name: detailName });
        refreshDetailDropText();
        loadDetailInstalled().catch(() => {});
        renderDetailLog();
      }
      resultStatus();
    });
    try {
      bridge().onInstancesChanged(() => loadInstances());
    } catch {}
    try {
      bridge().onProgress(onInstanceProgress);
    } catch {}
    loadInstances();
  });

  window.showInstanceDetail = async (tab) => {
    try {
      if (!detailId) {
        const res = await bridge().listInstances();
        const id = res?.activeId || (res?.instances && res.instances[0] && res.instances[0].id);
        if (!id) {
          window.showView('instances');
          return;
        }
        await openDetail(id);
      }
      if (tab === 'mod' || tab === 'resourcepack' || tab === 'shader' || tab === 'logs') {
        installedTab = tab;
        syncContentTabs();
      }
      window.showView('instance-detail');
      renderDetailGrid();
    } catch {
      window.showView('instances');
    }
  };
})();
