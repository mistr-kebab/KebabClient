'use strict';

(function () {
  const { bridge, toast, el } = window.launcherUtil;
  const ctx = window.instancesCtx;
  const { tr, fmt, loaderLabel, localeDate, notifyChanged, updateKey } = ctx;

  async function openDetail(id) {
    let found = null;
    try {
      const res = await bridge().listInstances();
      found = (res?.instances || []).find(i => i.id === id) || null;
    } catch (err) {
      toast(fmt(tr('inst.openFail', 'Could not open instance: {msg}'), { msg: err.message }), 'error');
      return;
    }
    if (!found) {
      toast(tr('inst.notFound', 'Instance not found.'), 'error');
      return;
    }
    ctx.detailId = id;
    ctx.detailName = found.name;
    if (ctx.lastCheckId !== id) {
      ctx.updateMap = new Map();
      ctx.lastCheckId = null;
      ctx.paintUpdateAll();
    }
    const nameEl = document.getElementById('detailName');
    const subEl = document.getElementById('detailSub');
    if (nameEl) nameEl.textContent = found.name;
    if (subEl) {
      subEl.textContent = `${loaderLabel(found.loader)}, ${found.mc}`;
      if (found.playtimeText)
        subEl.appendChild(
          document.createTextNode(` · ${fmt(tr('inst.playedTime', '{t} played'), { t: found.playtimeText })}`)
        );
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
          const res = await bridge().setInstanceIcon(ctx.detailId);
          if (res && !res.canceled) {
            toast(tr('inst.iconOk', 'Icon updated.'), 'ok');
            await openDetail(ctx.detailId);
            await ctx.loadInstances();
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
    ctx.installedTab = 'mod';
    ctx.syncContentTabs();
    ctx.resetContentSearch();
    ctx.refreshDetailDropText();
    window.showView('instance-detail');
    await ctx.loadDetailInstalled();
    ctx.renderDetailLog();
  }
  ctx.openDetail = openDetail;

  let versionModal = null;

  function closeVersionModal() {
    if (versionModal) {
      try {
        versionModal.remove();
      } catch {}
      versionModal = null;
    }
    document.removeEventListener('keydown', onVersionModalKey);
  }

  function onVersionModalKey(e) {
    if (e && e.key === 'Escape') closeVersionModal();
  }

  function capType(t) {
    if (t === 'beta') return 'Beta';
    if (t === 'alpha') return 'Alpha';
    return 'Release';
  }

  function openVersionModal(m, key, projectId, info) {
    closeVersionModal();
    const modalDetailId = ctx.detailId;
    const overlay = el('div', 'modal-backdrop');
    const modal = el('div', 'modal version-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', tr('inst.switchVersion', 'Switch version'));
    overlay.appendChild(modal);
    const head = el('div', 'modal-head');
    if (m.icon) {
      const img = document.createElement('img');
      img.className = 'modal-icon';
      img.alt = '';
      img.src = m.icon;
      head.appendChild(img);
    } else {
      const fb = el('span', 'modal-icon modal-icon-fallback', '◈');
      fb.setAttribute('aria-hidden', 'true');
      head.appendChild(fb);
    }
    head.appendChild(el('h3', 'modal-title', tr('inst.switchVersion', 'Switch version')));
    const xBtn = el('button', 'icon-btn modal-close', '');
    xBtn.type = 'button';
    xBtn.setAttribute('aria-label', tr('actions.close', 'Close'));
    const xIco = document.createElement('i');
    xIco.setAttribute('data-lucide', 'x');
    xBtn.appendChild(xIco);
    xBtn.addEventListener('click', closeVersionModal);
    head.appendChild(xBtn);
    modal.appendChild(head);
    const body = el('div', 'modal-body');
    const left = el('div', 'modal-list-col');
    const sbox = el('div', 'search-box');
    const sIco = document.createElement('i');
    sIco.setAttribute('data-lucide', 'search');
    sIco.className = 'search-icon';
    sbox.appendChild(sIco);
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'input';
    search.placeholder = tr('inst.versionSearch', 'Search version…');
    search.autocomplete = 'off';
    search.spellcheck = false;
    sbox.appendChild(search);
    left.appendChild(sbox);
    const list = el('div', 'version-list');
    left.appendChild(list);
    const pied = el('div', 'row');
    const sw = el('label', 'switch');
    const showBox = document.createElement('input');
    showBox.type = 'checkbox';
    showBox.setAttribute('aria-label', tr('inst.showIncompatible', 'Show incompatible'));
    const track = el('span', 'track');
    track.setAttribute('aria-hidden', 'true');
    sw.appendChild(showBox);
    sw.appendChild(track);
    pied.appendChild(sw);
    pied.appendChild(el('span', 'muted small', tr('inst.showIncompatible', 'Show incompatible')));
    left.appendChild(pied);
    body.appendChild(left);
    const detail = el('div', 'modal-detail');
    body.appendChild(detail);
    modal.appendChild(body);
    const foot = el('div', 'modal-foot');
    const warn = el(
      'p',
      'warn-line',
      tr('inst.switchWarn', 'Updating can break your instance. Review version changelogs and back up first.')
    );
    foot.appendChild(warn);
    const cancelBtn = el('button', 'btn btn-ghost', tr('inst.cancelBtn', 'Cancel'));
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', closeVersionModal);
    foot.appendChild(cancelBtn);
    const goBtn = el('button', 'btn btn-play', '');
    goBtn.type = 'button';
    foot.appendChild(goBtn);
    modal.appendChild(foot);
    document.body.appendChild(overlay);
    versionModal = overlay;
    document.addEventListener('keydown', onVersionModalKey);
    overlay.addEventListener('mousedown', e => {
      if (e.target === overlay) closeVersionModal();
    });
    if (window.refreshIcons) window.refreshIcons();

    let versions = [];
    let selectedId = (info && info.installedId) || null;
    let showAll = false;

    function isCurrent(v) {
      if (!v) return false;
      if (info && info.installedId) return v.id === info.installedId;
      return !!(info && info.installedVersion && v.version_number === info.installedVersion);
    }

    function visibleVersions() {
      const q = search.value.trim().toLowerCase();
      return versions.filter(
        v =>
          (showAll || v.compatible !== false) &&
          (!q || (v.version_number || '').toLowerCase().includes(q) || (v.name || '').toLowerCase().includes(q))
      );
    }

    function paintGo() {
      const v = versions.find(x => x.id === selectedId) || null;
      goBtn.disabled = !v || isCurrent(v);
      goBtn.textContent = '';
      const dl = document.createElement('i');
      dl.setAttribute('data-lucide', 'download');
      dl.className = 'btn-icon';
      goBtn.appendChild(dl);
      goBtn.appendChild(el('span', '', fmt(tr('inst.switchTo', 'Switch to {v}'), { v: v ? v.version_number : '…' })));
      if (window.refreshIcons) window.refreshIcons();
    }

    function paintDetail() {
      detail.textContent = '';
      const v =
        versions.find(x => x.id === selectedId) || versions.find(x => x.compatible !== false) || versions[0] || null;
      if (!v) {
        detail.appendChild(el('p', 'muted', tr('inst.noContent', 'No compatible content found.')));
      } else {
        selectedId = v.id;
        const top = el('div', 'ver-detail-top');
        top.appendChild(el('span', 'ver-detail-ver', v.version_number));
        top.appendChild(el('span', `vtype-pill vtype-${v.type || 'release'}`, capType(v.type)));
        if (v.date) top.appendChild(el('span', 'ver-detail-date', localeDate(v.date)));
        detail.appendChild(top);
        const sub = el('div', 'ver-detail-sub');
        sub.appendChild(el('span', '', tr('inst.changelog', 'Changelog')));
        const games = (v.gameVersions || []).join(', ');
        if (games) sub.appendChild(el('span', 'muted', ` · ${games}`));
        detail.appendChild(sub);
        detail.appendChild(
          el('div', 'ver-changelog', (v.changelog || '').trim() || tr('inst.noChangelog', 'No changelog provided.'))
        );
      }
      paintGo();
    }

    function paintList() {
      list.textContent = '';
      const vis = visibleVersions();
      if (!vis.length) {
        list.appendChild(el('p', 'muted small', tr('inst.noResults', 'No results.')));
        return;
      }
      for (const v of vis) {
        const row = el(
          'button',
          'ver-row' + (v.id === selectedId ? ' is-active' : '') + (v.compatible === false ? ' is-dim' : '')
        );
        row.type = 'button';
        row.appendChild(
          el('span', `vtype vtype-${v.type || 'release'}`, (v.type || 'release').charAt(0).toUpperCase())
        );
        row.appendChild(el('span', 'ver-num', v.version_number));
        if (isCurrent(v)) row.appendChild(el('span', 'current-pill', tr('inst.currentTag', 'Current')));
        row.addEventListener('click', () => {
          selectedId = v.id;
          paintList();
          paintDetail();
        });
        list.appendChild(row);
      }
    }

    search.addEventListener('input', paintList);
    showBox.addEventListener('change', () => {
      showAll = showBox.checked;
      paintList();
    });
    goBtn.addEventListener('click', async () => {
      const v = versions.find(x => x.id === selectedId);
      if (!v || !modalDetailId) return;
      goBtn.disabled = true;
      try {
        const res = await bridge().switchContentVersion(m.file, projectId, v.id, modalDetailId, key);
        closeVersionModal();
        toast(
          fmt(tr('inst.switchedTo', 'Installed {file} ({v}).'), {
            file: res?.file || m.file,
            v: res?.version || v.version_number,
          }),
          'ok'
        );
        if (res?.depProblems?.length) toast(res.depProblems.join('; '), 'error');
        await ctx.loadDetailInstalled();
        await ctx.checkForUpdates(true);
      } catch (err) {
        closeVersionModal();
        toast(fmt(tr('inst.switchFail', 'Switch failed: {msg}'), { msg: err.message }), 'error');
      }
    });

    list.appendChild(el('p', 'muted small', tr('inst.loadingPopular', 'Loading popular content…')));
    void (async () => {
      try {
        const cacheKey = `${projectId}|${modalDetailId}|${key}`;
        let cached = ctx.versionCache.get(cacheKey);
        if (!cached) {
          cached = await bridge().listContentVersions(projectId, modalDetailId, key);
          ctx.versionCache.set(cacheKey, cached);
        }
        versions = cached || [];
        if (!versions.some(x => x.id === selectedId)) {
          const cur = versions.find(isCurrent) || versions.find(x => x.compatible !== false) || versions[0];
          selectedId = cur ? cur.id : null;
        }
      } catch (err) {
        toast(fmt(tr('inst.versionFail', 'Versions failed: {msg}'), { msg: err.message }), 'error');
      }
      if (!overlay.isConnected) return;
      paintList();
      paintDetail();
    })();
    try {
      search.focus();
    } catch {}
  }

  function appendVersionButton(card, m, key, projectId, info) {
    const btn = el(
      'button',
      'btn btn-ghost btn-sm btn-block version-open',
      (info && info.installedVersion) || tr('inst.versionPick', 'Version…')
    );
    btn.type = 'button';
    btn.title = tr('inst.switchVersion', 'Switch version');
    const ico = document.createElement('i');
    ico.setAttribute('data-lucide', 'arrow-up-down');
    ico.className = 'btn-icon';
    btn.prepend(ico);
    btn.addEventListener('click', () => openVersionModal(m, key, projectId, info));
    card.appendChild(btn);
    if (window.refreshIcons) window.refreshIcons();
  }

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
    const info = ctx.updateMap.get(updateKey(key, m.file));
    const projectId = (info && info.projectId) || m.projectId || null;
    if (projectId) appendVersionButton(card, m, key, projectId, info);
    const foot = el('div', 'card-foot');
    if (info && info.updateAvailable && info.latestId) {
      const up = el(
        'button',
        'btn btn-primary btn-sm content-update',
        fmt(tr('inst.updateOne', 'Update{latest}'), { latest: info.latestVersion ? ` ${info.latestVersion}` : '' })
      );
      up.type = 'button';
      up.addEventListener('click', async () => {
        up.disabled = true;
        try {
          const res = await bridge().switchContentVersion(m.file, projectId, info.latestId, ctx.detailId, key);
          toast(
            fmt(tr('inst.switchedTo', 'Installed {file} ({v}).'), {
              file: res?.file || m.file,
              v: res?.version || info.latestVersion || '',
            }),
            'ok'
          );
          if (res?.depProblems?.length) toast(res.depProblems.join('; '), 'error');
          await ctx.loadDetailInstalled();
          void ctx.checkForUpdates(true);
        } catch (err) {
          toast(fmt(tr('inst.switchFail', 'Switch failed: {msg}'), { msg: err.message }), 'error');
          up.disabled = false;
        }
      });
      foot.appendChild(up);
    }
    const sw = el('label', 'switch');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !m.disabled;
    const switchLabel = on =>
      fmt(tr(on ? 'inst.disable' : 'inst.enable', on ? 'Disable {name}' : 'Enable {name}'), { name: m.name || m.file });
    box.title = m.disabled ? tr('inst.enableShort', 'Enable') : tr('inst.disableShort', 'Disable');
    box.setAttribute('aria-label', switchLabel(!m.disabled));
    box.addEventListener('change', async () => {
      box.disabled = true;
      try {
        const res = await bridge().toggleContent(m.file, key, ctx.detailId);
        m.file = res.file;
        m.disabled = res.disabled;
        card.classList.toggle('is-disabled', res.disabled);
        box.checked = !res.disabled;
        box.title = res.disabled ? tr('inst.enableShort', 'Enable') : tr('inst.disableShort', 'Disable');
        box.setAttribute('aria-label', switchLabel(!res.disabled));
        const sub = card.querySelector('.card-sub');
        if (sub) sub.textContent = res.file;
        main.title = res.file;
        toast(
          fmt(
            tr(
              res.disabled ? 'inst.disabledToast' : 'inst.enabledToast',
              res.disabled ? 'Disabled {name}.' : 'Enabled {name}.'
            ),
            { name: m.name || res.file }
          ),
          'ok'
        );
        void ctx.checkForUpdates(true);
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
      if (
        !window.confirm(
          fmt(tr('inst.delContentConfirm', 'Delete “{name}” from this instance?'), { name: m.name || m.file })
        )
      )
        return;
      try {
        await bridge().uninstallContent(m.file, key, ctx.detailId);
        toast(fmt(tr('inst.removedToast', 'Removed {name}.'), { name: m.name || m.file }), 'ok');
        await ctx.loadDetailInstalled();
        void ctx.checkForUpdates(true);
      } catch (err) {
        toast(fmt(tr('inst.uninstallFail', 'Uninstall failed: {msg}'), { msg: err.message }), 'error');
      }
    });
    foot.appendChild(del);
    card.appendChild(foot);
    return card;
  }
  ctx.contentCard = contentCard;

  document.addEventListener('DOMContentLoaded', () => {
    const backBtn = document.getElementById('detailBackButton');
    if (backBtn) backBtn.addEventListener('click', () => window.showView('instances'));
    const detailReload = document.getElementById('detailReloadButton');
    if (detailReload) detailReload.addEventListener('click', () => ctx.loadDetailInstalled());
    document.querySelectorAll('#detailContentTabs .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        ctx.installedTab = btn.dataset.contentTab || 'mod';
        ctx.syncContentTabs();
        ctx.renderDetailGrid();
      });
    });
    const detailDelete = document.getElementById('detailDeleteButton');
    if (detailDelete) {
      detailDelete.addEventListener('click', async () => {
        if (!ctx.detailId) return;
        const name = ctx.detailName || 'Instance';
        if (
          !window.confirm(
            fmt(tr('inst.deleteConfirm', 'Delete instance “{name}” including its mods and worlds?'), { name })
          )
        )
          return;
        try {
          await bridge().deleteInstance(ctx.detailId);
          toast(fmt(tr('inst.deleted', 'Deleted {name}.'), { name }), 'ok');
          ctx.detailId = null;
          ctx.detailName = '';
          ctx.detailContentData = null;
          notifyChanged();
          window.showView('instances');
          await ctx.loadInstances();
        } catch (err) {
          toast(fmt(tr('inst.deleteFail', 'Delete failed: {msg}'), { msg: err.message }), 'error');
        }
      });
    }
    const detailBackupBtn = document.getElementById('detailBackupButton');
    if (detailBackupBtn) {
      detailBackupBtn.addEventListener('click', async () => {
        if (!ctx.detailId) return;
        detailBackupBtn.disabled = true;
        try {
          const res = await bridge().backupInstance(ctx.detailId);
          const mb = res && res.bytes ? ` (${Math.round(res.bytes / 1048576)} MB)` : '';
          toast(fmt(tr('inst.backedUp', 'Backup saved: {file}{mb}.'), { file: res?.file || '', mb }), 'ok');
        } catch (err) {
          toast(fmt(tr('inst.backupFail', 'Backup failed: {msg}'), { msg: err.message }), 'error');
        } finally {
          detailBackupBtn.disabled = false;
        }
      });
    }
    const detailClearLog = document.getElementById('detailClearLogButton');
    if (detailClearLog) {
      detailClearLog.addEventListener('click', () => {
        if (ctx.detailId) ctx.logBuffers.delete(ctx.detailId);
        const view = ctx.detailLogView();
        if (view) view.textContent = '';
      });
    }
    const detailPlay = document.getElementById('detailPlayButton');
    if (detailPlay) {
      detailPlay.addEventListener('click', async () => {
        if (!ctx.detailId) return;
        try {
          await bridge().setActiveInstance(ctx.detailId);
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
        if (!ctx.detailId) return;
        try {
          await bridge().setActiveInstance(ctx.detailId);
          notifyChanged();
          await ctx.loadInstances();
          toast(fmt(tr('inst.selected', 'Selected {name}.'), { name: ctx.detailName || 'Instance' }), 'ok');
        } catch (err) {
          toast(fmt(tr('inst.selectFail', 'Select failed: {msg}'), { msg: err.message }), 'error');
        }
      });
    }
  });
})();
