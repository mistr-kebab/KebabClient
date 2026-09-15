'use strict';

(function () {
  const { bridge, toast, el } = window.launcherUtil;

  let viewer = null;
  let variant = 'classic';
  let pickedBase64 = null;
  let currentSkin = null;
  let currentCape = null;
  let capeVisible = true;

  function viewerModel() {
    return variant === 'slim' ? 'slim' : 'default';
  }

  function ensureViewer() {
    if (viewer) return viewer;
    if (!window.skinview3d) {
      throw new Error('3D viewer library failed to load.');
    }
    const canvas = document.getElementById('skinCanvas');
    if (!canvas) throw new Error('Preview canvas not found.');
    const box = canvas.getBoundingClientRect();
    const size = Math.max(240, Math.min(480, Math.round(box.width || 360)));
    viewer = new window.skinview3d.SkinViewer({
      canvas,
      width: size,
      height: size,
      preserveRatio: false
    });
    viewer.controls.enablePan = false;
    viewer.autoRotate = true;
    viewer.autoRotateSpeed = 1.0;
    applyAnimation();
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
    if (dataUrl) {
      await v.loadSkin(dataUrl, { model: viewerModel() });
    }
    if (capeDataUrl && capeVisible) {
      await v.loadCape(capeDataUrl).catch(() => {
        try { v.resetCape(); } catch { /* noop */ }
      });
    } else {
      try { v.resetCape(); } catch { /* noop */ }
    }
  }

  function renderCapes(capes, activeId) {
    const list = document.getElementById('capeList');
    if (!list) return;
    list.textContent = '';
    if (!capes || !capes.length) {
      list.appendChild(el('li', 'muted', 'No capes on this account.'));
      return;
    }
    for (const cape of capes) {
      const li = el('li', 'cape-item' + (cape.id === activeId ? ' is-active' : ''));
      if (cape.dataUrl) {
        const img = document.createElement('img');
        img.className = 'cape-thumb';
        img.alt = cape.alias || 'Cape';
        img.src = cape.dataUrl;
        li.appendChild(img);
      }
      const wrap = el('div', 'cape-meta');
      wrap.appendChild(el('div', 'cape-name', cape.alias || 'Cape'));
      wrap.appendChild(el('div', 'cape-id', cape.id));
      li.appendChild(wrap);
      const btn = el('button', 'btn btn-ghost btn-sm', cape.id === activeId ? 'Equipped' : 'Equip');
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
      li.appendChild(btn);
      list.appendChild(li);
    }
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
      const btn = el('button', 'history-thumb', '');
      btn.type = 'button';
      btn.title = `Wear this skin (${entry.variant || 'classic'})`;
      const img = document.createElement('img');
      img.alt = '';
      img.src = entry.dataUrl;
      btn.appendChild(img);
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
    } catch { /* history is optional */ }
  }

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
      await showSkin(preview?.skin?.dataUrl, preview?.cape?.dataUrl);
      renderCapes(preview?.capes || [], preview?.cape?.id);
      if (statusEl) {
        statusEl.textContent = preview?.skin
          ? `Skin: ${preview.skin.variant || variant} · Cape: ${preview?.cape?.alias || 'none'}`
          : 'No skin found on profile.';
      }
      await loadHistory();
    } catch (err) {
      if (statusEl) statusEl.textContent = `Preview unavailable: ${err.message}`;
    }
  }

  function syncVariantButtons() {
    document.querySelectorAll('[data-variant]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.variant === variant);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const animSelect = document.getElementById('skinAnimSelect');
    if (animSelect) animSelect.addEventListener('change', applyAnimation);
    const spinCheck = document.getElementById('spinCheck');
    if (spinCheck) spinCheck.addEventListener('change', applySpin);

    document.querySelectorAll('[data-variant]').forEach((b) => {
      b.addEventListener('click', async () => {
        variant = b.dataset.variant;
        syncVariantButtons();
        if (currentSkin) {
          try { await ensureViewer().loadSkin(currentSkin, { model: viewerModel() }); }
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
            await showSkin(`data:image/png;base64,${pickedBase64}`, currentCape);
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
    reload();
  });
})();
