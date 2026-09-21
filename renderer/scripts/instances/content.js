'use strict';

(function () {
  const { bridge, toast, el, formatDownloads } = window.launcherUtil;
  const ctx = window.instancesCtx;
  const { tr, fmt } = ctx;

  let detailSearchTimer = null;
  let resultOffset = 0;
  let resultTotal = 0;
  let resultLoading = false;
  let resultQ = '';
  const RESULT_LIMIT = 50;

  const DETAIL_CATS = {
    mod: { label: 'mods', ext: '.jar' },
    resourcepack: { label: 'resource packs', ext: '.zip' },
    shader: { label: 'shaders', ext: '.zip' },
  };

  const INSTALLABLE = ['mod', 'resourcepack', 'shader'];

  function typeLabel(t) {
    switch (t) {
      case 'mod':
        return tr('inst.typeMod', 'Mod');
      case 'resourcepack':
        return tr('inst.typeRp', 'Resource Pack');
      case 'shader':
        return tr('inst.typeShader', 'Shader');
      case 'modpack':
        return tr('inst.typeModpack', 'Modpack');
      case 'datapack':
        return tr('inst.typeDatapack', 'Data Pack');
      case 'plugin':
        return tr('inst.typePlugin', 'Plugin');
      default:
        return tr('inst.typeContent', 'Content');
    }
  }

  function groupLabel(cat) {
    if (cat === 'resourcepack') return tr('detail.gRp', 'Resource Packs');
    if (cat === 'shader') return tr('detail.gShaders', 'Shaders');
    return tr('detail.gMods', 'Mods');
  }

  function resultCardCount() {
    const grid = document.getElementById('detailResults');
    return grid ? grid.querySelectorAll('.mod-card').length : 0;
  }

  function showEmptyResultsMessage() {
    const grid = document.getElementById('detailResults');
    if (!grid || resultCardCount()) return;
    grid.textContent = '';
    grid.appendChild(
      el(
        'p',
        'muted',
        resultTotal
          ? tr('inst.allInstalled', 'Everything here is already installed.')
          : tr('inst.noContent', 'No compatible content found.')
      )
    );
  }

  function pruneInstalledCards() {
    const grid = document.getElementById('detailResults');
    if (!grid) return;
    grid.querySelectorAll('[data-project-id]').forEach(card => {
      if (ctx.installedProjectIds.has(card.dataset.projectId)) card.remove();
    });
    showEmptyResultsMessage();
  }

  function renderDetailResults(results, append) {
    const grid = document.getElementById('detailResults');
    if (!grid) return;
    if (!append) grid.textContent = '';
    const fresh = (results || []).filter(mod => mod && !ctx.installedProjectIds.has(mod.id));
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
            const res = await bridge().installContent(mod.id, undefined, ctx.detailId, mod.projectType, {
              title: mod.title,
              icon: mod.iconUrl,
            });
            const extra = res?.dependencies?.length
              ? fmt(tr('inst.extraDeps', ' (+{n} deps)'), { n: res.dependencies.length })
              : '';
            const missing = res?.depProblems?.length
              ? fmt(tr('inst.missingDeps', ' Missing: {x}'), { x: res.depProblems.join('; ') })
              : '';
            toast(
              fmt(tr('inst.installed', 'Installed {file}{extra}.{missing}'), {
                file: res?.file || mod.title,
                extra,
                missing,
              }),
              res?.depProblems?.length ? 'error' : 'ok'
            );
            await ctx.loadDetailInstalled();
            void ctx.checkForUpdates(true);
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
      statusEl.textContent = resultQ
        ? fmt(tr('inst.searching', 'Searching for “{q}”…'), { q: resultQ })
        : tr('inst.loadingPopular', 'Loading popular content…');
    } else if (resultTotal) {
      statusEl.textContent = fmt(tr('inst.shown', '{a} of {b} shown.'), { a: shown, b: resultTotal });
    } else {
      statusEl.textContent = resultQ
        ? tr('inst.noResults', 'No results.')
        : tr('inst.popularNow', 'Popular right now.');
    }
  }
  ctx.resultStatus = resultStatus;

  async function fetchResults(reset) {
    if (!ctx.detailId || resultLoading) return;
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
      const params = {
        limit: RESULT_LIMIT,
        offset: resultOffset,
        instanceId: ctx.detailId,
        category: ctx.searchFilter,
      };
      if (!searching) params.sort = 'popular';
      const res = await bridge().searchContent(resultQ, params);
      if (!ctx.detailId) return;
      resultTotal = res.total || 0;
      renderDetailResults(res.results || [], !reset);
      resultOffset += (res.results || []).length;
    } catch (err) {
      const statusEl = document.getElementById('detailSearchStatus');
      if (statusEl)
        statusEl.textContent = searching
          ? fmt(tr('inst.searchFail', 'Search failed: {msg}'), { msg: err.message })
          : fmt(tr('inst.browseFail', 'Browse failed: {msg}'), { msg: err.message });
    } finally {
      resultLoading = false;
      resultStatus();
    }
  }

  function loadMoreResults() {
    if (!ctx.detailId || resultLoading) return;
    if (resultOffset >= resultTotal) return;
    void fetchResults(false);
  }

  function onDetailSearchInput() {
    if (detailSearchTimer) window.clearTimeout(detailSearchTimer);
    detailSearchTimer = window.setTimeout(() => {
      void fetchResults(true);
    }, 400);
  }

  function refreshDetailDropText() {
    const text = document.getElementById('detailDropZoneText');
    const cat = DETAIL_CATS[ctx.detailCategory] || DETAIL_CATS.mod;
    if (text)
      text.textContent = fmt(tr('detail.drop', 'Drop {ext} files here to add them to this instance'), { ext: cat.ext });
  }
  ctx.refreshDetailDropText = refreshDetailDropText;

  function resetContentSearch() {
    ctx.detailCategory = 'mod';
    ctx.searchFilter = 'all';
    document.querySelectorAll('#detailTabs .segment-btn').forEach(x => {
      x.classList.toggle('is-active', x.dataset.category === 'all');
    });
  }
  ctx.resetContentSearch = resetContentSearch;

  function summarizeImport(res, kind) {
    const parts = [];
    if (res.added?.length) parts.push(fmt(tr('inst.sumAdded', 'added {x}'), { x: res.added.join(', ') }));
    if (res.skipped?.length)
      parts.push(fmt(tr('inst.sumSkipped', 'already there: {x}'), { x: res.skipped.join(', ') }));
    if (!parts.length && !res.failed?.length) return fmt(tr('inst.nothingToDo', '{kind}: nothing to do.'), { kind });
    let msg = `${kind}: ${parts.join('; ') || tr('inst.done', 'done')}.`;
    if (res.depProblems?.length) {
      res.failed = [...(res.failed || []), ...res.depProblems.map(d => ({ file: 'dependency', reason: d }))];
    }
    if (res.installedDeps?.length) {
      msg += fmt(tr('inst.sumDeps', ' Dependencies installed: {x}.'), { x: res.installedDeps.join(', ') });
    }
    if (res.failed?.length) {
      msg += fmt(tr('inst.sumFailed', ' Failed: {x}'), {
        x: res.failed.map(f => `${f.file} (${f.reason})`).join('; '),
      });
    }
    return msg;
  }

  async function detailUpload() {
    if (!ctx.detailId) return;
    try {
      const res = await bridge().uploadContent(ctx.detailCategory, ctx.detailId);
      if (res?.canceled) return;
      toast(summarizeImport(res, groupLabel(ctx.detailCategory)), res?.failed?.length ? 'error' : 'ok');
      await ctx.loadDetailInstalled();
    } catch (err) {
      toast(fmt(tr('inst.uploadFail', 'Upload failed: {msg}'), { msg: err.message }), 'error');
    }
  }

  async function updateAllContent() {
    const jobs = [...ctx.updateMap.values()].filter(u => u.updateAvailable && u.latestId && u.projectId);
    if (!ctx.detailId || !jobs.length) return;
    const btn = document.getElementById('detailUpdateAllButton');
    if (btn) btn.disabled = true;
    toast(fmt(tr('inst.updatingAll', 'Updating {n}…'), { n: jobs.length }));
    let ok = 0;
    let failed = 0;
    for (const u of jobs) {
      if (!ctx.detailId) break;
      try {
        await bridge().switchContentVersion(u.file, u.projectId, u.latestId, ctx.detailId, u.category);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    await ctx.loadDetailInstalled();
    await ctx.checkForUpdates(true);
    if (btn) btn.disabled = false;
    toast(
      fmt(tr('inst.updatedAll', '{ok} updated{failed}.'), {
        ok,
        failed: failed ? fmt(tr('inst.updateAllFailed', ' ({f} failed)'), { f: failed }) : '',
      }),
      failed ? 'error' : 'ok'
    );
  }

  function collectDropPaths(dt) {
    const out = [];
    const push = p => {
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
      const types = [...(dt?.types || [])].map(s => String(s).toLowerCase());
      hasFiles = types.includes('files');
    } catch {}
    if (hasFiles) {
      return tr(
        'inst.dropAdmin',
        'Drop was blocked (Windows strips file drops when the app runs as administrator — restart it normally or use the file button).'
      );
    }
    return tr('inst.dropHint', 'Drop files from Explorer (not browser content).');
  }

  function bindDetailDropzone() {
    const zone = document.getElementById('detailDropZone');
    for (const viewId of ['view-instance-detail', 'view-add-content']) {
      const view = document.getElementById(viewId);
      if (view) {
        view.addEventListener('dragover', e => e.preventDefault());
        view.addEventListener('drop', e => e.preventDefault());
      }
    }
    const importDropped = async (files, dt) => {
      if (!ctx.detailId) return;
      if (!files.length) {
        toast(dropErrorHint(dt), 'error');
        return;
      }
      try {
        const res = await bridge().dropFiles(ctx.detailCategory, files, ctx.detailId);
        toast(summarizeImport(res, groupLabel(ctx.detailCategory)), res?.failed?.length ? 'error' : 'ok');
        await ctx.loadDetailInstalled();
      } catch (err) {
        toast(fmt(tr('inst.dropFail', 'Drop failed: {msg}'), { msg: err.message }), 'error');
      }
    };
    for (const viewId of ['view-instance-detail', 'view-add-content']) {
      const view = document.getElementById(viewId);
      if (view) {
        view.addEventListener('drop', async e => {
          if (!ctx.detailId) return;
          if (e.target && e.target.closest && e.target.closest('#detailDropZone')) return;
          await importDropped(collectDropPaths(e.dataTransfer), e.dataTransfer);
        });
      }
    }
    if (!zone) return;
    const stop = e => {
      e.preventDefault();
      e.stopPropagation();
    };
    ['dragenter', 'dragover'].forEach(name => {
      zone.addEventListener(name, e => {
        stop(e);
        try {
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        } catch {}
        zone.classList.add('is-drag');
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      zone.addEventListener(name, e => {
        stop(e);
        zone.classList.remove('is-drag');
      });
    });
    zone.addEventListener('drop', async e => {
      if (!ctx.detailId) return;
      await importDropped(collectDropPaths(e.dataTransfer), e.dataTransfer);
    });
  }

  function bindDetailTabs() {
    document.querySelectorAll('#detailTabs .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.category || 'all';
        ctx.searchFilter = cat;
        if (cat !== 'all') ctx.detailCategory = cat;
        document.querySelectorAll('#detailTabs .segment-btn').forEach(x => {
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
    const detailUpdateAll = document.getElementById('detailUpdateAllButton');
    if (detailUpdateAll) detailUpdateAll.addEventListener('click', updateAllContent);
    const detailInput = document.getElementById('detailSearchInput');
    if (detailInput) {
      detailInput.addEventListener('input', onDetailSearchInput);
      detailInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void fetchResults(true);
        }
      });
    }
    const detailAddContentButton = document.getElementById('detailAddContentButton');
    if (detailAddContentButton)
      detailAddContentButton.addEventListener('click', () => {
        if (!ctx.detailId) return;
        window.showView('add-content');
        void fetchResults(true);
      });
    const detailAddBackButton = document.getElementById('detailAddBackButton');
    if (detailAddBackButton)
      detailAddBackButton.addEventListener('click', async () => {
        window.showView('instance-detail');
        await ctx.loadDetailInstalled();
      });
    const sentinel = document.getElementById('detailSentinel');
    if (sentinel && window.IntersectionObserver) {
      new IntersectionObserver(
        entries => {
          if (entries.some(e => e.isIntersecting)) loadMoreResults();
        },
        { rootMargin: '600px' }
      ).observe(sentinel);
    }
    const detailUploadBtn = document.getElementById('detailUploadButton');
    if (detailUploadBtn) detailUploadBtn.addEventListener('click', detailUpload);
    bindDetailTabs();
    bindDetailDropzone();
    refreshDetailDropText();
  });
})();
