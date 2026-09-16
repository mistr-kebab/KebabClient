'use strict';

(function () {
  const { bridge, toast, el } = window.launcherUtil;

  let viewer = null;
  let resizeObserver = null;
  let variant = 'classic';
  let pickedBase64 = null;
  let currentSkin = null;
  let currentCape = null;
  let capeVisible = true;

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
      throw new Error('3D viewer library failed to load.');
    }
    const canvas = document.getElementById('skinCanvas');
    if (!canvas) throw new Error('Preview canvas not found.');
    const startSize = stageSize() || 320;
    viewer = new window.skinview3d.SkinViewer({
      canvas,
      width: startSize,
      height: startSize
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

  async function showSkin(dataUrl, capeDataUrl) {
    const v = ensureViewer();
    currentSkin = dataUrl || null;
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
        try { v.resetCape(); } catch {}
      }
    } else {
      try { v.resetCape(); } catch {}
    }
    return { skinOk: !!dataUrl && !skinError, skinError, capeError };
  }

  function renderCapes(capes, activeId, skinDataUrl, model) {
    const list = document.getElementById('capeList');
    if (!list) return;
    list.textContent = '';
    if (!capes || !capes.length) {
      list.appendChild(el('p', 'content-empty', 'No capes on this account.'));
      return;
    }
    for (const cape of capes) {
      const card = el('article', 'skin-card' + (cape.id === activeId ? ' is-active' : ''));
      const prev = el('span', 'skin-card-preview');
      const thumbSlot = el('span', 'skin-card-slot');
      if (cape.dataUrl) {
        const img = document.createElement('img');
        img.className = 'skin-card-img';
        img.alt = cape.alias || 'Cape';
        img.src = cape.dataUrl;
        thumbSlot.appendChild(img);
        if (skinDataUrl) void upgradeCapeThumb(thumbSlot, cape, skinDataUrl, model);
      }
      prev.appendChild(thumbSlot);
      card.appendChild(prev);
      const foot = el('span', 'skin-card-foot');
      foot.appendChild(el('span', 'skin-card-name', cape.alias || 'Cape'));
      const btn = el('button', 'btn btn-ghost btn-sm btn-block', cape.id === activeId ? 'Equipped' : 'Equip');
      btn.type = 'button';
      btn.disabled = cape.id === activeId;
      btn.addEventListener('click', async () => {
        try {
          await bridge().equipCape(cape.id);
          toast(`Equipped ${cape.alias || 'cape'}.`, 'ok');
          await reload();
        } catch (err) {
          toast(`Equip failed: ${err.message}`, 'error');
        }
      });
      foot.appendChild(btn);
      card.appendChild(foot);
      list.appendChild(card);
    }
    if (window.refreshIcons) window.refreshIcons();
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
    if (!window.skinview3d) throw new Error('3D viewer library failed to load.');
    snapCanvas = document.createElement('canvas');
    snapCanvas.width = 96;
    snapCanvas.height = 96;
    snapViewer = new window.skinview3d.SkinViewer({
      canvas: snapCanvas,
      width: 96,
      height: 96,
      preserveDrawingBuffer: true,
      renderPaused: true,
      enableControls: false,
      pixelRatio: 1,
      zoom: 0.8
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
      try { v.resetCameraPose(); } catch {}
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
      v.zoom = 1.0;
      try { v.resetCameraPose(); } catch {}
      v.playerWrapper.rotation.y = 0;
      await v.loadSkin(skinDataUrl, { model: model === 'slim' ? 'slim' : 'default' });
      try { v.resetCape(); } catch {}
      v.render();
      return snapCanvas.toDataURL();
    });
  }

  async function upgradeHistoryThumb(btn, entry) {
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
    } catch { /* head render stays as fallback */ }
  }

  async function upgradeCapeThumb(slot, cape, skinDataUrl, model) {
    try {
      const skinKey = skinDataUrl ? `${skinDataUrl.length}:${skinDataUrl.slice(0, 32)}:${skinDataUrl.slice(-32)}` : 'noskin';
      const cacheKey = `${cape.id}|${skinKey}`;
      let shot = capeSnapCache.get(cacheKey);
      if (!shot) {
        shot = await snapshotCape(skinDataUrl, model, cape.dataUrl);
        if (!shot || shot.length < 1000) return;
        capeSnapCache.set(cacheKey, shot);
      }
      if (!slot.isConnected) return;
      slot.textContent = '';
      const img = document.createElement('img');
      img.className = 'skin-card-img';
      img.alt = cape.alias || 'Cape';
      img.src = shot;
      slot.appendChild(img);
    } catch {}
  }

  function renderHistory(history) {
    const row = document.getElementById('skinHistory');
    if (!row) return;
    row.textContent = '';
    if (!history || !history.length) {
      row.appendChild(el('p', 'muted small', 'No previous skins yet. Upload one above.'));
      return;
    }
    for (const entry of history) {
      const btn = el('button', 'skin-card', '');
      btn.type = 'button';
      const modelLabel = entry.variant === 'slim' ? 'Slim' : 'Classic';
      btn.title = `Wear this skin (${modelLabel})`;
      btn.setAttribute('aria-label', `Wear this skin (${modelLabel})`);
      const prev = el('span', 'skin-card-preview');
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      prev.appendChild(canvas);
      try {
        if (window.headshot) {
          window.headshot.render(canvas, entry.dataUrl, 64).catch(() => {});
        }
      } catch {}
      btn.appendChild(prev);
      const foot = el('span', 'skin-card-foot');
      foot.appendChild(el('span', 'skin-card-name', modelLabel));
      btn.appendChild(foot);
      if (entry.dataUrl) void upgradeHistoryThumb(btn, entry);
      btn.addEventListener('click', async () => {
        try {
          await bridge().applySkinHistory(entry.id);
          toast('Skin applied from history.', 'ok');
          await reload();
        } catch (err) {
          toast(`Apply failed: ${err.message}`, 'error');
        }
      });
      row.appendChild(btn);
    }
  }

  async function loadHistory() {
    try {
      renderHistory(await bridge().skinsHistory());
    } catch {}
  }

  let dataLoadedAt = 0;

  async function reload() {
    const statusEl = document.getElementById('skinStatus');
    const label = document.getElementById('skinPlayerLabel');
    try {
      if (statusEl) statusEl.textContent = 'Loading preview…';
      const preview = await bridge().getSkinPreview();
      if (label) label.textContent = preview?.playerName ? `Preview — ${preview.playerName}` : 'Preview';
      if (preview?.skin?.variant === 'SLIM') variant = 'slim';
      else if (preview?.skin?.variant === 'CLASSIC') variant = 'classic';
      syncVariantButtons();
      const shown = await showSkin(preview?.skin?.dataUrl, preview?.cape?.dataUrl);
      renderCapes(preview?.capes || [], preview?.cape?.id, preview?.skin?.dataUrl, variant);
      if (statusEl) {
        if (!preview?.skin) {
          statusEl.textContent = 'No skin found on profile.';
        } else if (!preview.skin.dataUrl) {
          statusEl.textContent = `Skin texture download failed (${preview.skin.variant || variant}) — check connection, then Reload preview.`;
        } else if (shown.skinError) {
          statusEl.textContent = `Skin preview error: ${shown.skinError}`;
        } else {
          statusEl.textContent = `Skin: ${preview.skin.variant || variant} · Cape: ${preview?.cape?.alias || 'none'}`;
        }
        if (shown.capeError) statusEl.textContent += ` (cape: ${shown.capeError})`;
      }
      if (preview?.skin && (!preview.skin.dataUrl || shown.skinError)) {
        toast('Skin texture failed to load — check connection, then Reload preview.', 'error');
      }
      await loadHistory();
      dataLoadedAt = Date.now();
    } catch (err) {
      if (statusEl) statusEl.textContent = `Preview unavailable: ${err.message}`;
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
    document.querySelectorAll('[data-variant]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.variant === variant);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const animSelect = document.getElementById('skinAnimSelect');
    if (animSelect) animSelect.addEventListener('change', applyAnimation);
    document.querySelectorAll('#outfitTabs .segment-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const showCapes = btn.dataset.outfit === 'capes';
        document.querySelectorAll('#outfitTabs .segment-btn').forEach((x) => {
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
      });
    });
    const spinCheck = document.getElementById('spinCheck');
    if (spinCheck) spinCheck.addEventListener('change', applySpin);

    document.querySelectorAll('[data-variant]').forEach((b) => {
      b.addEventListener('click', async () => {
        variant = b.dataset.variant;
        syncVariantButtons();
        if (currentSkin) {
          try {
            const v = ensureViewer();
            await v.loadSkin(currentSkin, { model: viewerModel() });
            if (capeVisible && currentCape) await v.loadCape(currentCape);
          }
          catch (err) { toast(`Preview failed: ${err.message}`, 'error'); }
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
        } catch (err) { toast(`Cape preview failed: ${err.message}`, 'error'); }
      });
    }

    const reloadBtn = document.getElementById('reloadSkinButton');
    if (reloadBtn) reloadBtn.addEventListener('click', reload);
    document.addEventListener('skin:reload', reload);

    const pickBtn = document.getElementById('pickSkinButton');
    const uploadBtn = document.getElementById('uploadSkinButton');
    const pickedLabel = document.getElementById('skinPickedLabel');
    if (pickBtn) {
      pickBtn.addEventListener('click', async () => {
        try {
          const res = await bridge().pickSkinFile();
          if (res?.canceled) return;
          pickedBase64 = res.dataBase64;
          if (pickedLabel) pickedLabel.textContent = `${res.fileName} (${res.width}x${res.height})`;
          if (uploadBtn) uploadBtn.disabled = false;
          try {
            const shown = await showSkin(`data:image/png;base64,${pickedBase64}`, currentCape);
            if (!shown.skinOk) toast(`Preview failed: ${shown.skinError || 'invalid texture'}`, 'error');
          } catch (err) { toast(`Preview failed: ${err.message}`, 'error'); }
        } catch (err) {
          toast(`Invalid skin: ${err.message}`, 'error');
        }
      });
    }
    if (uploadBtn) {
      uploadBtn.addEventListener('click', async () => {
        if (!pickedBase64) return;
        uploadBtn.disabled = true;
        try {
          await bridge().uploadSkin(pickedBase64, variant);
          toast('Skin uploaded.', 'ok');
          pickedBase64 = null;
          if (pickedLabel) pickedLabel.textContent = 'No file selected.';
          await reload();
        } catch (err) {
          toast(`Upload failed: ${err.message}`, 'error');
        } finally {
          uploadBtn.disabled = !pickedBase64;
        }
      });
    }
    try {
      ensureViewer();
    } catch (err) {
      const statusEl = document.getElementById('skinStatus');
      if (statusEl) statusEl.textContent = `3D preview unavailable: ${err.message}`;
    }
    document.addEventListener('view:shown', (e) => {
      if (e && e.detail && e.detail.view === 'skins') onSkinsShown();
    });
    reload();
  });
})();
