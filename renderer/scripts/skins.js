'use strict';

(function () {
  const { bridge, toast, el, tr, fmt } = window.launcherUtil;

  let viewer = null;
  let resizeObserver = null;
  let variant = 'classic';
  let currentSkin = null;
  let currentCape = null;
  let capeVisible = true;
  let lastPlayerName = '';
  let pending = null;

  function updateSaveButton() {
    const btn = document.getElementById('saveOutfitButton');
    if (btn) btn.disabled = !pending;
  }

  function viewerModel() {
    return variant === 'slim' ? 'slim' : 'default';
  }

  function stageSize() {
    const stage = document.getElementById('skinStage');
    if (!stage) return 0;
    return Math.max(0, Math.round(stage.getBoundingClientRect().width || 0));
  }

  function fitViewer() {
    if (!viewer) return;
    const size = stageSize();
    if (size < 40) return;
    try {
      if (Math.abs(viewer.width - size) >= 2) viewer.setSize(size, size);
    } catch {}
  }

  function ensureViewer() {
    if (viewer) return viewer;
    if (!window.skinview3d) {
      throw new Error(tr('skins.libFail', '3D viewer library failed to load.'));
    }
    const canvas = document.getElementById('skinCanvas');
    if (!canvas) throw new Error(tr('skins.noCanvas', 'Preview canvas not found.'));
    const startSize = stageSize() || 320;
    viewer = new window.skinview3d.SkinViewer({
      canvas,
      width: startSize,
      height: startSize,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    });
    viewer.controls.enablePan = false;
    viewer.autoRotate = false;
    viewer.autoRotateSpeed = 1.0;
    applyAnimation();
    try {
      const stage = document.getElementById('skinStage');
      if (stage && window.ResizeObserver && !resizeObserver) {
        resizeObserver = new ResizeObserver(() => fitViewer());
        resizeObserver.observe(stage);
      }
    } catch {}
    fitViewer();
    return viewer;
  }

  function applyAnimation() {
    if (!viewer || !window.skinview3d) return;
    const select = document.getElementById('skinAnimSelect');
    const mode = select ? select.value : 'idle';
    const A = window.skinview3d;
    if (mode === 'walk') viewer.animation = new A.WalkingAnimation();
    else if (mode === 'run') viewer.animation = new A.RunningAnimation();
    else if (mode === 'none') viewer.animation = null;
    else viewer.animation = new A.IdleAnimation();
    viewer.animationPaused = false;
  }

  function applySpin() {
    if (!viewer) return;
    const check = document.getElementById('spinCheck');
    viewer.autoRotate = check ? check.checked : true;
  }

  function isElytraMode() {
    const check = document.getElementById('elytraCheck');
    return !!(check && check.checked);
  }

  // skinview3d has no viewer.elytra flag; cape vs. elytra rendering is
  // selected via playerObject.backEquipment ('cape' | 'elytra' | null).
  // loadCape()/resetCape() overwrite it, so re-apply after every load.
  function applyBackEquipment() {
    if (!viewer || !viewer.playerObject) return;
    try {
      if (isElytraMode() && currentCape) viewer.playerObject.backEquipment = 'elytra';
      else if (capeVisible && currentCape) viewer.playerObject.backEquipment = 'cape';
      else viewer.playerObject.backEquipment = null;
      viewer.render();
    } catch {}
  }

  async function showSkin(dataUrl, capeDataUrl) {
    const v = ensureViewer();
    if (dataUrl) currentSkin = dataUrl;
    currentCape = capeDataUrl || null;
    let skinError = null;
    let capeError = null;
    if (dataUrl) {
      try {
        await v.loadSkin(dataUrl, { model: viewerModel() });
      } catch (err) {
        skinError = err?.message || String(err);
      }
    }
    if (capeDataUrl && capeVisible) {
      try {
        await v.loadCape(capeDataUrl);
      } catch (err) {
        capeError = err?.message || String(err);
        try {
          v.resetCape();
        } catch {}
      }
    } else {
      try {
        v.resetCape();
      } catch {}
    }
    applyBackEquipment();
    return { skinOk: !!dataUrl && !skinError, skinError, capeError };
  }

  function modelLabel(value) {
    return value === 'slim' ? tr('skins.slim', 'Slim') : tr('skins.classic', 'Classic');
  }

  function renderCapes(capes, activeId, skinDataUrl, model) {
    const list = document.getElementById('capeList');
    if (!list) return;
    list.textContent = '';
    if (!capes || !capes.length) {
      list.appendChild(el('p', 'content-empty', tr('skins.noCapes', 'No capes on this account.')));
      return;
    }
    for (const cape of capes) {
      const isActive = cape.id === activeId;
      const card = el('article', 'skin-card' + (isActive ? ' is-active' : ''));
      card.dataset.search = cape.alias || '';
      const prev = el('span', 'skin-card-preview');
      const thumbSlot = el('span', 'skin-card-slot');
      if (cape.dataUrl) {
        const img = document.createElement('img');
        img.className = 'skin-card-img';
        img.alt = cape.alias || tr('skins.capesTitle', 'Capes');
        img.src = cape.dataUrl;
        thumbSlot.appendChild(img);
        if (skinDataUrl) void upgradeCapeThumb(thumbSlot, cape, skinDataUrl, model, false);
      }
      prev.appendChild(thumbSlot);
      card.appendChild(prev);
      const foot = el('span', 'skin-card-foot');
      foot.appendChild(el('span', 'skin-card-name', cape.alias || tr('skins.capesTitle', 'Capes')));
      const btn = el(
        'button',
        'btn btn-ghost btn-sm btn-block',
        isActive ? tr('skins.equipped', 'Equipped') : tr('skins.previewBtn', 'Preview')
      );
      btn.type = 'button';
      btn.disabled = isActive;
      btn.addEventListener('click', async () => {
        if (!cape.dataUrl) {
          toast(fmt(tr('skins.capePreviewFail', 'Cape preview failed: {msg}'), { msg: 'missing texture' }), 'error');
          return;
        }
        if (!currentSkin) {
          toast(fmt(tr('skins.previewFail', 'Preview failed: {msg}'), { msg: 'missing skin' }), 'error');
          return;
        }
        btn.disabled = true;
        try {
          if (!capeVisible) {
            capeVisible = true;
            const check = document.getElementById('capeVisibleCheck');
            if (check) check.checked = true;
          }
          await showSkin(currentSkin, cape.dataUrl);
          pending = isActive ? null : { kind: 'cape', capeId: cape.id, alias: cape.alias };
          updateSaveButton();
        } catch (err) {
          toast(fmt(tr('skins.previewFail', 'Preview failed: {msg}'), { msg: err.message }), 'error');
        } finally {
          btn.disabled = isActive;
        }
      });
      foot.appendChild(btn);
      card.appendChild(foot);
      list.appendChild(card);
    }
    if (window.refreshIcons) window.refreshIcons();
    applyGalleryFilter();
  }

  const capeSnapCache = new Map();
  const skinSnapCache = new Map();
  let snapViewer = null;
  let snapCanvas = null;
  let snapQueue = Promise.resolve();

  function withSnapViewer(fn) {
    const run = snapQueue.then(fn, fn);
    snapQueue = run.catch(() => {});
    return run;
  }

  function getSnapViewer() {
    if (snapViewer) return snapViewer;
    if (!window.skinview3d) throw new Error(tr('skins.libFail', '3D viewer library failed to load.'));
    // Render thumbs oversized (256px backing store) so card images stay crisp.
    snapCanvas = document.createElement('canvas');
    snapCanvas.width = 256;
    snapCanvas.height = 256;
    snapViewer = new window.skinview3d.SkinViewer({
      canvas: snapCanvas,
      width: 256,
      height: 256,
      preserveDrawingBuffer: true,
      renderPaused: true,
      enableControls: false,
      pixelRatio: 1,
      zoom: 0.8,
    });
    try {
      snapViewer.playerWrapper.rotation.y = Math.PI;
    } catch {}
    return snapViewer;
  }

  async function snapshotCape(skinDataUrl, model, capeDataUrl) {
    return withSnapViewer(async () => {
      const v = getSnapViewer();
      v.zoom = 0.8;
      try {
        v.resetCameraPose();
      } catch {}
      v.playerWrapper.rotation.y = Math.PI;
      await v.loadSkin(skinDataUrl, { model: model === 'slim' ? 'slim' : 'default' });
      await v.loadCape(capeDataUrl);
      v.render();
      return snapCanvas.toDataURL();
    });
  }

  async function snapshotSkin(skinDataUrl, model) {
    return withSnapViewer(async () => {
      const v = getSnapViewer();
      // Same framing as cape thumbs (0.8): slightly smaller, centered.
      v.zoom = 0.8;
      try {
        v.resetCameraPose();
      } catch {}
      v.playerWrapper.rotation.y = 0;
      await v.loadSkin(skinDataUrl, { model: model === 'slim' ? 'slim' : 'default' });
      try {
        v.resetCape();
      } catch {}
      v.render();
      return snapCanvas.toDataURL();
    });
  }

  async function upgradeHistoryThumb(btn, entry) {
    await Promise.resolve();
    try {
      let shot = skinSnapCache.get(entry.id);
      if (!shot) {
        shot = await snapshotSkin(entry.dataUrl, entry.variant);
        if (!shot || shot.length < 1000) return;
        skinSnapCache.set(entry.id, shot);
      }
      if (!btn.isConnected) return;
      const prev = btn.querySelector('.skin-card-preview');
      if (!prev) return;
      prev.textContent = '';
      const img = document.createElement('img');
      img.className = 'skin-card-img';
      img.alt = '';
      img.src = shot;
      prev.appendChild(img);
    } catch {
      /* head render stays as fallback */
    }
  }

  async function upgradeCapeThumb(slot, cape, skinDataUrl, model, isRetry) {
    await Promise.resolve();
    try {
      if (!skinDataUrl) return;
      const skinKey = `${skinDataUrl.length}:${skinDataUrl.slice(0, 32)}:${skinDataUrl.slice(-32)}`;
      const cacheKey = `${cape.id}|${skinKey}`;
      let shot = capeSnapCache.get(cacheKey);
      if (!shot) {
        shot = await snapshotCape(skinDataUrl, model, cape.dataUrl);
        if (!shot || shot.length < 1000) throw new Error('empty snapshot');
        capeSnapCache.set(cacheKey, shot);
      }
      if (!slot.isConnected) return;
      slot.textContent = '';
      const img = document.createElement('img');
      img.className = 'skin-card-img';
      img.alt = cape.alias || tr('skins.capesTitle', 'Capes');
      img.src = shot;
      slot.appendChild(img);
    } catch {
      if (!isRetry && skinDataUrl && slot.isConnected) {
        setTimeout(() => {
          if (slot.isConnected) void upgradeCapeThumb(slot, cape, skinDataUrl, model, true);
        }, 2500);
      }
    }
  }

  function renderHistory(history) {
    const row = document.getElementById('skinHistory');
    if (!row) return;
    row.textContent = '';
    if (!history || !history.length) {
      row.appendChild(el('p', 'muted small', tr('skins.noHistory', 'No previous skins yet. Upload one above.')));
      return;
    }
    for (const entry of history) {
      const btn = el('button', 'skin-card', '');
      btn.type = 'button';
      const displayName = entry.name || modelLabel(entry.variant);
      btn.title = fmt(tr('skins.wear', 'Wear this skin ({model})'), { model: displayName });
      btn.setAttribute('aria-label', fmt(tr('skins.wear', 'Wear this skin ({model})'), { model: displayName }));
      btn.dataset.search = `${displayName} ${entry.variant || ''} ${entry.addedAt ? new Date(entry.addedAt).toLocaleString() : ''}`;
      const prev = el('span', 'skin-card-preview');
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      prev.appendChild(canvas);
      try {
        if (window.headshot) {
          window.headshot.render(canvas, entry.dataUrl, 64, entry.variant).catch(() => {});
        }
      } catch {}
      btn.appendChild(prev);
      const foot = el('span', 'skin-card-foot');
      const nameSpan = el('span', 'skin-card-name', displayName);
      nameSpan.style.cursor = 'pointer';
      nameSpan.title = tr('skins.renameHint', 'Click to rename');
      nameSpan.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newName = window.prompt(tr('skins.renamePrompt', 'New name for this skin:'), entry.name || '');
        if (newName === null || newName.trim() === '') return;
        try {
          await bridge().renameSkinHistory(entry.id, newName.trim());
          await loadHistory();
        } catch (err) {
          toast(fmt(tr('skins.actionFail', 'Failed: {msg}'), { msg: err.message }), 'error');
        }
      });
      foot.appendChild(nameSpan);
      const actions = el('span', 'skin-card-actions');
      const deleteBtn = el('button', 'icon-btn icon-btn-tiny', '');
      deleteBtn.type = 'button';
      deleteBtn.setAttribute('aria-label', tr('skins.delete', 'Delete'));
      deleteBtn.title = tr('skins.delete', 'Delete');
      const delIcon = document.createElement('i');
      delIcon.setAttribute('data-lucide', 'trash-2');
      deleteBtn.appendChild(delIcon);
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!window.confirm(fmt(tr('skins.deleteConfirm', 'Delete "{name}" from history?'), { name: displayName }))) return;
        try {
          await bridge().deleteSkinHistory(entry.id);
          await loadHistory();
          toast(tr('skins.deleted', 'Deleted.'), 'ok');
        } catch (err) {
          toast(fmt(tr('skins.actionFail', 'Failed: {msg}'), { msg: err.message }), 'error');
        }
      });
      actions.appendChild(deleteBtn);
      foot.appendChild(actions);
      btn.appendChild(foot);
      if (entry.dataUrl) void upgradeHistoryThumb(btn, entry);
      btn.addEventListener('click', async () => {
        try {
          const b64 = (entry.dataUrl || '').split(',')[1] || '';
          if (!b64) throw new Error('empty texture');
          variant = entry.variant === 'slim' ? 'slim' : 'classic';
          syncVariantButtons();
          await showSkin(entry.dataUrl, currentCape);
          pending = { kind: 'skin', base64: b64 };
          updateSaveButton();
        } catch (err) {
          toast(fmt(tr('skins.previewFail', 'Preview failed: {msg}'), { msg: err.message }), 'error');
        }
      });
      row.appendChild(btn);
    }
    applyGalleryFilter();
  }

  async function loadHistory() {
    try {
      renderHistory(await bridge().skinsHistory());
    } catch {}
  }

  let dataLoadedAt = 0;

  function skinsFingerprint(state) {
    try {
      return (state.skins || []).map(s => `${s.id}:${s.state}`).join('|');
    } catch {
      return '';
    }
  }

  function galleryQuery() {
    const input = document.getElementById('outfitSearchInput');
    return input ? input.value.trim().toLowerCase() : '';
  }

  function applyGalleryFilter() {
    const q = galleryQuery();
    const capesEl = document.getElementById('outfitCapes');
    const activeGrid =
      capesEl && !capesEl.hidden ? document.getElementById('capeList') : document.getElementById('skinHistory');
    let visible = 0;
    document.querySelectorAll('#skinHistory .skin-card, #capeList .skin-card').forEach(card => {
      const show = !q || (card.dataset.search || '').toLowerCase().includes(q);
      card.style.display = show ? '' : 'none';
      if (show && activeGrid && activeGrid.contains(card)) visible += 1;
    });
    const note = document.getElementById('galleryEmptyNote');
    if (note) note.hidden = !(q && visible === 0);
  }

  function setSkinStatus(text) {
    const node = document.getElementById('skinStatus');
    if (node) node.textContent = text;
  }

  function paintPlayerLabel() {
    const label = document.getElementById('skinPlayerLabel');
    if (!label) return;
    label.textContent = lastPlayerName
      ? `${tr('skins.preview', 'Preview')} — ${lastPlayerName}`
      : tr('skins.preview', 'Preview');
  }

  async function waitForSkinState(expect, timeoutMs = 12000) {
    const start = Date.now();
    for (;;) {
      try {
        const st = await bridge().getSkinState();
        if (expect.capeId && (st.capes || []).some(c => c.id === expect.capeId && c.state === 'ACTIVE')) return true;
        if (expect.skinFp !== undefined && skinsFingerprint(st) !== expect.skinFp) return true;
      } catch {}
      if (Date.now() - start > timeoutMs) return false;
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  function displayVariant(raw) {
    if (raw === 'SLIM' || raw === 'slim') return tr('skins.slim', 'Slim');
    if (raw === 'CLASSIC' || raw === 'classic') return tr('skins.classic', 'Classic');
    return raw || variant;
  }

  async function reload() {
    const statusEl = document.getElementById('skinStatus');
    try {
      if (statusEl) statusEl.textContent = tr('skins.loading', 'Loading preview…');
      const preview = await bridge().getSkinPreview();
      lastPlayerName = preview?.playerName || '';
      paintPlayerLabel();
      pending = null;
      updateSaveButton();
      if (preview?.skin?.variant === 'SLIM') variant = 'slim';
      else if (preview?.skin?.variant === 'CLASSIC') variant = 'classic';
      syncVariantButtons();
      const shown = await showSkin(preview?.skin?.dataUrl, preview?.cape?.dataUrl);
      renderCapes(preview?.capes || [], preview?.cape?.id, preview?.skin?.dataUrl || currentSkin, variant);
      if (statusEl) {
        if (!preview?.skin) {
          statusEl.textContent = tr('skins.noSkin', 'No skin found on profile.');
        } else if (!preview.skin.dataUrl) {
          statusEl.textContent = fmt(
            tr('skins.texFail', 'Skin texture download failed ({variant}) — check connection, then Reload preview.'),
            { variant: displayVariant(preview.skin.variant) }
          );
        } else if (shown.skinError) {
          statusEl.textContent = fmt(tr('skins.skinErr', 'Skin preview error: {msg}'), { msg: shown.skinError });
        } else {
          statusEl.textContent = fmt(tr('skins.status', 'Skin: {skin} · Cape: {cape}'), {
            skin: displayVariant(preview.skin.variant),
            cape: preview?.cape?.alias || tr('skins.none', 'none'),
          });
        }
        if (shown.capeError)
          statusEl.textContent += fmt(tr('skins.capeErr', ' (cape: {msg})'), { msg: shown.capeError });
      }
      if (preview?.skin && (!preview.skin.dataUrl || shown.skinError)) {
        toast(
          fmt(
            tr('skins.texFail', 'Skin texture download failed ({variant}) — check connection, then Reload preview.'),
            { variant: displayVariant(preview.skin.variant) }
          ),
          'error'
        );
      }
      await loadHistory();
      dataLoadedAt = Date.now();
    } catch (err) {
      if (statusEl)
        statusEl.textContent = fmt(tr('skins.unavailable', 'Preview unavailable: {msg}'), { msg: err.message });
    }
  }

  function onSkinsShown() {
    try {
      ensureViewer();
      fitViewer();
    } catch {}
    if (!dataLoadedAt || Date.now() - dataLoadedAt > 5 * 60 * 1000) reload();
  }

  function syncVariantButtons() {
    document.querySelectorAll('[data-variant]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.variant === variant);
    });
  }

  window.whenViewsReady(() => {
    const animSelect = document.getElementById('skinAnimSelect');
    if (animSelect) animSelect.addEventListener('change', applyAnimation);
    document.querySelectorAll('#outfitTabs .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const showCapes = btn.dataset.outfit === 'capes';
        document.querySelectorAll('#outfitTabs .segment-btn').forEach(x => {
          x.classList.toggle('is-active', x === btn);
        });
        const skinsEl = document.getElementById('outfitSkins');
        const capesEl = document.getElementById('outfitCapes');
        if (skinsEl) skinsEl.hidden = showCapes;
        if (capesEl) capesEl.hidden = !showCapes;
        try {
          const v = ensureViewer();
          if (showCapes) {
            const spinCheck = document.getElementById('spinCheck');
            if (spinCheck) spinCheck.checked = false;
            v.autoRotate = false;
            v.playerWrapper.rotation.y = Math.PI;
          } else {
            v.playerWrapper.rotation.y = 0;
            fitViewer();
          }
        } catch {}
        applyGalleryFilter();
      });
    });
    const searchInput = document.getElementById('outfitSearchInput');
    if (searchInput) searchInput.addEventListener('input', applyGalleryFilter);
    const spinCheck = document.getElementById('spinCheck');
    if (spinCheck) spinCheck.addEventListener('change', applySpin);

    document.querySelectorAll('[data-variant]').forEach(b => {
      b.addEventListener('click', async () => {
        variant = b.dataset.variant;
        syncVariantButtons();
        if (currentSkin) {
          try {
            const v = ensureViewer();
            await v.loadSkin(currentSkin, { model: viewerModel() });
            if (capeVisible && currentCape) await v.loadCape(currentCape);
            applyBackEquipment();
          } catch (err) {
            toast(fmt(tr('skins.previewFail', 'Preview failed: {msg}'), { msg: err.message }), 'error');
          }
        }
      });
    });
    const capeCheck = document.getElementById('capeVisibleCheck');
    if (capeCheck) {
      capeCheck.addEventListener('change', async () => {
        capeVisible = capeCheck.checked;
        if (!viewer) return;
        try {
          if (capeVisible && currentCape) await viewer.loadCape(currentCape);
          else viewer.resetCape();
          applyBackEquipment();
        } catch (err) {
          toast(fmt(tr('skins.capePreviewFail', 'Cape preview failed: {msg}'), { msg: err.message }), 'error');
        }
      });
    }
    const elytraCheck = document.getElementById('elytraCheck');
    const elytraRow = document.getElementById('elytraRow');
    if (elytraCheck && elytraRow) {
      elytraCheck.addEventListener('change', () => {
        if (!viewer) return;
        try {
          applyBackEquipment();
        } catch (err) {
          toast(fmt(tr('skins.previewFail', 'Preview failed: {msg}'), { msg: err.message }), 'error');
        }
      });
      const capeTabBtn = document.querySelector('[data-outfit="capes"]');
      if (capeTabBtn) {
        capeTabBtn.addEventListener('click', () => {
          elytraRow.hidden = false;
        });
      }
      const skinsTabBtn = document.querySelector('[data-outfit="skins"]');
      if (skinsTabBtn) {
        skinsTabBtn.addEventListener('click', () => {
          elytraRow.hidden = true;
          if (elytraCheck.checked) {
            elytraCheck.checked = false;
            try {
              applyBackEquipment();
            } catch {}
          }
        });
      }
    }

    const reloadBtn = document.getElementById('reloadSkinButton');
    if (reloadBtn) reloadBtn.addEventListener('click', reload);
    document.addEventListener('skin:reload', reload);

    const upBtn = document.getElementById('outfitUploadButton');
    if (upBtn) {
      upBtn.addEventListener('click', async () => {
        try {
          const res = await bridge().pickSkinFile();
          if (res?.canceled) return;
          const shown = await showSkin(`data:image/png;base64,${res.dataBase64}`, currentCape);
          pending = { kind: 'skin', base64: res.dataBase64 };
          updateSaveButton();
          if (!shown.skinOk)
            toast(
              fmt(tr('skins.previewFail', 'Preview failed: {msg}'), { msg: shown.skinError || 'invalid texture' }),
              'error'
            );
        } catch (err) {
          toast(fmt(tr('skins.invalidSkin', 'Invalid skin: {msg}'), { msg: err.message }), 'error');
        }
      });
    }
    const saveBtn = document.getElementById('saveOutfitButton');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        if (!pending) {
          toast(tr('skins.nothingPending', 'Nothing to apply — pick a skin or cape first.'));
          return;
        }
        const job = pending;
        saveBtn.disabled = true;
        try {
          if (job.kind === 'skin') {
            const before = await bridge()
              .getSkinState()
              .then(skinsFingerprint, () => '');
            await bridge().uploadSkin(job.base64, variant);
            pending = null;
            setSkinStatus(tr('skins.waiting', 'Saving… waiting for Mojang…'));
            const reflected = await waitForSkinState({ skinFp: before });
            updateSaveButton();
            await reload();
            toast(
              reflected
                ? tr('skins.uploadedOk', 'Skin uploaded.')
                : tr('skins.slowSkin', 'Applied. Mojang is slow — use Reload preview if the skin is missing.')
            );
          } else {
            await bridge().equipCape(job.capeId);
            pending = null;
            setSkinStatus(tr('skins.waiting', 'Saving… waiting for Mojang…'));
            const reflected = await waitForSkinState({ capeId: job.capeId });
            updateSaveButton();
            await reload();
            toast(
              reflected
                ? fmt(tr('skins.equippedOk', 'Equipped {name}.'), {
                    name: job.alias || tr('skins.capesTitle', 'Capes'),
                  })
                : tr('skins.slowCape', 'Equipped. Mojang is slow — use Reload preview if the cape is missing.')
            );
          }
        } catch (err) {
          toast(
            fmt(
              tr(
                job.kind === 'cape' ? 'skins.equipFail' : 'skins.uploadFail',
                job.kind === 'cape' ? 'Equip failed: {msg}' : 'Upload failed: {msg}'
              ),
              { msg: err.message }
            ),
            'error'
          );
          updateSaveButton();
        }
      });
    }
    try {
      ensureViewer();
    } catch (err) {
      const statusEl = document.getElementById('skinStatus');
      if (statusEl) statusEl.textContent = fmt(tr('skins.no3d', '3D preview unavailable: {msg}'), { msg: err.message });
    }
    document.addEventListener('i18n:applied', () => {
      reload().catch(() => {});
    });
    document.addEventListener('view:shown', e => {
      if (e && e.detail && e.detail.view === 'skins') onSkinsShown();
    });
    reload();
  });
})();
