'use strict';

(function () {
  const { bridge, toast, el, tr, fmt } = window.launcherUtil;

  const ctx = {};

  ctx.detailId = null;
  ctx.detailName = '';
  ctx.installedTab = 'mod';
  ctx.detailContentData = null;
  ctx.detailCategory = 'mod';
  ctx.searchFilter = 'all';
  ctx.installedProjectIds = new Set();
  ctx.updateMap = new Map();
  ctx.updateCheckRun = 0;
  ctx.lastCheckAt = 0;
  ctx.lastCheckId = null;
  ctx.versionCache = new Map();
  ctx.logBuffers = new Map();

  const LOG_BUFFER_MAX = 500;
  const LOG_VIEW_MAX = 1000;

  ctx.LOADER_LABELS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
  ctx.EMPTY_BY_CAT = { mod: 'inst.emptyMods', resourcepack: 'inst.emptyRp', shader: 'inst.emptyShaders' };

  ctx.tr = tr;
  ctx.fmt = fmt;

  function localeDate(iso) {
    if (!iso) return '';
    try {
      const lang = (window.i18n && window.i18n.getLanguage && window.i18n.getLanguage()) || 'de';
      return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-US' : 'de-DE');
    } catch {
      return String(iso).slice(0, 10);
    }
  }
  ctx.localeDate = localeDate;

  function loaderLabel(loader) {
    return ctx.LOADER_LABELS[loader] || loader || 'Vanilla';
  }
  ctx.loaderLabel = loaderLabel;

  function notifyChanged() {
    document.dispatchEvent(new CustomEvent('instances:changed'));
  }
  ctx.notifyChanged = notifyChanged;

  function updateKey(cat, file) {
    return `${cat}::${file}`;
  }
  ctx.updateKey = updateKey;

  function detailLogView() {
    return document.getElementById('detailLogView');
  }
  ctx.detailLogView = detailLogView;

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
    const buf = (ctx.detailId && ctx.logBuffers.get(ctx.detailId)) || [];
    for (const entry of buf.slice(-LOG_VIEW_MAX)) {
      const div = document.createElement('div');
      div.className = `log-line-${entry.stream}`;
      div.textContent = entry.line;
      view.appendChild(div);
    }
    view.scrollTop = view.scrollHeight;
  }
  ctx.renderDetailLog = renderDetailLog;

  function pushInstanceLog(instanceId, stream, line) {
    if (!instanceId) return;
    let buf = ctx.logBuffers.get(instanceId);
    if (!buf) {
      buf = [];
      ctx.logBuffers.set(instanceId, buf);
    }
    buf.push({ stream, line });
    if (buf.length > LOG_BUFFER_MAX) buf.splice(0, buf.length - LOG_BUFFER_MAX);
    if (instanceId === ctx.detailId) appendDetailLogLine(stream, line);
  }
  ctx.pushInstanceLog = pushInstanceLog;

  document.addEventListener('game:log-line', (e) => {
    const d = e && e.detail;
    if (d) pushInstanceLog(d.instanceId, d.stream, d.line);
  });

  function syncContentTabs() {
    document.querySelectorAll('#detailContentTabs .segment-btn').forEach((x) => {
      x.classList.toggle('is-active', x.dataset.contentTab === ctx.installedTab);
    });
  }
  ctx.syncContentTabs = syncContentTabs;

  function paintUpdateAll() {
    const btn = document.getElementById('detailUpdateAllButton');
    if (!btn) return;
    let n = 0;
    for (const u of ctx.updateMap.values()) {
      if (u.updateAvailable && u.latestId && u.projectId) n += 1;
    }
    const label = btn.querySelector('span');
    if (label) label.textContent = fmt(tr('inst.updateAll', 'Update all ({n})'), { n });
    btn.hidden = n === 0;
  }
  ctx.paintUpdateAll = paintUpdateAll;

  async function checkForUpdates(force) {
    if (!ctx.detailId) return;
    const now = Date.now();
    if (!force && ctx.lastCheckId === ctx.detailId && now - ctx.lastCheckAt < 60000) {
      paintUpdateAll();
      return;
    }
    const run = ++ctx.updateCheckRun;
    try {
      const list = await bridge().checkContentUpdates(ctx.detailId);
      if (run !== ctx.updateCheckRun || !ctx.detailId) return;
      ctx.updateMap = new Map((list || []).map((u) => [updateKey(u.category, u.file), u]));
      ctx.lastCheckAt = Date.now();
      ctx.lastCheckId = ctx.detailId;
    } catch {
      if (run !== ctx.updateCheckRun || !ctx.detailId) return;
    }
    paintUpdateAll();
    const grid = document.getElementById('detailContentGrid');
    const selActive = grid && grid.contains(document.activeElement) && document.activeElement.tagName === 'SELECT';
    if (!selActive) renderDetailGrid();
  }
  ctx.checkForUpdates = checkForUpdates;

  function renderDetailGrid() {
    const grid = document.getElementById('detailContentGrid');
    const logPanel = document.getElementById('detailLogPanel');
    const showLog = ctx.installedTab === 'logs';
    if (grid) grid.hidden = showLog;
    if (logPanel) logPanel.hidden = !showLog;
    if (showLog) {
      renderDetailLog();
      return;
    }
    if (!grid) return;
    grid.textContent = '';
    const items = (ctx.detailContentData && ctx.detailContentData[ctx.installedTab]) || [];
    if (!items.length) {
      grid.appendChild(el('p', 'content-empty', tr(ctx.EMPTY_BY_CAT[ctx.installedTab] || 'inst.emptyMods', 'No content installed.')));
    } else {
      for (const m of items) grid.appendChild(ctx.contentCard(m, ctx.installedTab));
    }
    if (window.refreshIcons) window.refreshIcons();
  }
  ctx.renderDetailGrid = renderDetailGrid;

  async function loadDetailInstalled() {
    if (!ctx.detailId) return;
    let data = null;
    try {
      data = await bridge().listInstalledMods(ctx.detailId);
    } catch (err) {
      toast(fmt(tr('inst.listFail', 'Could not list content: {msg}'), { msg: err.message }), 'error');
      return;
    }
    ctx.installedProjectIds.clear();
    const grouped = Array.isArray(data) ? { mod: data } : (data || {});
    ctx.detailContentData = grouped;
    for (const key of ['mod', 'resourcepack', 'shader']) {
      for (const m of grouped[key] || []) {
        if (m && m.projectId) ctx.installedProjectIds.add(m.projectId);
      }
    }
    renderDetailGrid();
    void checkForUpdates(false);
  }
  ctx.loadDetailInstalled = loadDetailInstalled;

  window.instancesCtx = ctx;
})();
