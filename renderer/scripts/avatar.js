'use strict';

(function () {
  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('head texture failed to load'));
      img.src = dataUrl;
    });
  }

  function drawLayer(ctx, img, sx, sy, a, b, c, d, e, f) {
    ctx.save();
    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(img, sx, sy, 8, 8, 0, 0, 1, 1);
    ctx.restore();
  }

  function shade(ctx, a, b, c, d, e, f, alpha) {
    if (!alpha) return;
    ctx.save();
    ctx.setTransform(a, b, c, d, e, f);
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(0, 0, 1, 1);
    ctx.restore();
  }

  async function render2D(canvas, dataUrl, size) {
    const S = size || 72;
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, S, S);
    if (!dataUrl) return false;
    let img;
    try {
      img = await loadImage(dataUrl);
    } catch {
      return false;
    }
    const f = Math.round(S * 0.6);
    const dx = Math.round(S * 0.2);
    const dy = -Math.round(S * 0.12);
    const x0 = Math.round((S - f - dx) / 2);
    const y0 = Math.round((S - f - dy) / 2) - dy;

    drawLayer(ctx, img, 8, 0, f, 0, dx, dy, x0, y0);
    drawLayer(ctx, img, 40, 0, f, 0, dx, dy, x0, y0);
    shade(ctx, f, 0, dx, dy, x0, y0, 0.06);

    drawLayer(ctx, img, 0, 8, dx, dy, 0, f, x0 + f, y0);
    drawLayer(ctx, img, 32, 8, dx, dy, 0, f, x0 + f, y0);
    shade(ctx, dx, dy, 0, f, x0 + f, y0, 0.24);

    ctx.drawImage(img, 8, 8, 8, 8, x0, y0, f, f);
    ctx.drawImage(img, 40, 8, 8, 8, x0, y0, f, f);
    return true;
  }

  const SNAP = 256;
  const CROP = 192;
  const ROT_Y = -Math.PI / 4;
  let viewer3d = null;
  let snapCanvas = null;
  let lastKey = '';
  let lastCrop = null;
  let queue = Promise.resolve();

  function serialize(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  function ensureViewer3D() {
    if (viewer3d) return viewer3d;
    if (!window.skinview3d) throw new Error('3D viewer library failed to load.');
    snapCanvas = document.createElement('canvas');
    snapCanvas.width = SNAP;
    snapCanvas.height = SNAP;
    viewer3d = new window.skinview3d.SkinViewer({
      canvas: snapCanvas,
      width: SNAP,
      height: SNAP,
      preserveDrawingBuffer: true,
      renderPaused: true,
      enableControls: false,
      pixelRatio: 1,
    });
    viewer3d.autoRotate = false;
    return viewer3d;
  }

  function worldPos(obj) {
    let x = 0;
    let y = 0;
    let z = 0;
    let p = obj;
    while (p) {
      const q = p.position;
      if (q) {
        x += q.x || 0;
        y += q.y || 0;
        z += q.z || 0;
      }
      p = p.parent;
    }
    return { x, y, z };
  }

  function findSkinModel(root) {
    let found = null;
    try {
      if (root && root.traverse) {
        root.traverse(o => {
          if (!found && o && o.head && o.body) found = o;
        });
      }
    } catch {}
    return found;
  }

  function projectPoint(cam, w, x, y, z) {
    const v = cam.matrixWorldInverse.elements;
    const p = cam.projectionMatrix.elements;
    const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
    const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
    const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
    const vw = v[3] * x + v[7] * y + v[11] * z + v[15];
    const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12] * vw;
    const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13] * vw;
    const cw = p[2] * vx + p[6] * vy + p[10] * vz + p[14] * vw;
    if (!cw) throw new Error('projection failed');
    return { x: ((cx / cw) * 0.5 + 0.5) * w, y: (1 - ((cy / cw) * 0.5 + 0.5)) * w };
  }

  function bustRect(v) {
    const cam = v.camera || v._camera;
    if (!cam || !cam.projectionMatrix || !cam.matrixWorldInverse) throw new Error('camera unavailable');
    const po = findSkinModel(v.playerWrapper);
    if (!po || !po.head || !po.body) throw new Error('model unavailable');
    const cos = Math.cos(ROT_Y);
    const sin = Math.sin(ROT_Y);
    const boxes = [];
    const hg = worldPos(po.head);
    boxes.push({ c: { x: hg.x, y: hg.y + 4, z: hg.z }, h: { x: 4.6, y: 4.6, z: 4.6 } });
    const bg = worldPos(po.body);
    boxes.push({ c: { x: bg.x, y: bg.y, z: bg.z }, h: { x: 7.7, y: 6.4, z: 2.4 } });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of boxes) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const ox = sx * b.h.x;
            const oy = sy * b.h.y;
            const oz = sz * b.h.z;
            const pt = projectPoint(cam, SNAP, b.c.x + ox * cos + oz * sin, b.c.y + oy, b.c.z - ox * sin + oz * cos);
            if (pt.x < minX) minX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y > maxY) maxY = pt.y;
          }
        }
      }
    }
    if (!(maxX > minX && maxY > minY)) throw new Error('empty bust');
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let side = Math.max(maxX - minX, maxY - minY) * 1.1;
    side = Math.min(side, SNAP);
    let x = cx - side / 2;
    let y = cy - side / 2;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + side > SNAP) x = SNAP - side;
    if (y + side > SNAP) y = SNAP - side;
    if (side < 8) throw new Error('empty bust');
    return { x, y, side };
  }

  async function bustCrop(dataUrl, model) {
    return serialize(async () => {
      const key = `${model === 'slim' ? 'slim' : 'default'}|${dataUrl.length}:${dataUrl.slice(0, 32)}:${dataUrl.slice(-32)}`;
      if (lastCrop && key === lastKey) return lastCrop;
      const v = ensureViewer3D();
      try {
        v.animation = null;
      } catch {}
      try {
        v.resetCape();
      } catch {}
      try {
        if (v.playerWrapper && v.playerWrapper.rotation) v.playerWrapper.rotation.set(0, ROT_Y, 0);
      } catch {}
      try {
        const po = findSkinModel(v.playerWrapper);
        if (po && po.resetJoints) po.resetJoints();
      } catch {}
      await v.loadSkin(dataUrl, { model: model === 'slim' ? 'slim' : 'default' });
      try {
        v.resetCape();
      } catch {}
      v.render();
      const shot = snapCanvas.toDataURL();
      if (!shot || shot.length < 1000) throw new Error('empty snapshot');
      const img = await loadImage(shot);
      const rect = bustRect(v);
      const out = document.createElement('canvas');
      out.width = CROP;
      out.height = CROP;
      const octx = out.getContext('2d');
      if (!octx) throw new Error('crop failed');
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.clearRect(0, 0, CROP, CROP);
      octx.drawImage(img, rect.x, rect.y, rect.side, rect.side, 0, 0, CROP, CROP);
      lastKey = key;
      lastCrop = out;
      return out;
    });
  }

  function hasContent(ctx, S) {
    try {
      const data = ctx.getImageData(0, 0, S, S).data;
      for (let i = 3; i < data.length; i += 16) {
        if (data[i] > 16) return true;
      }
    } catch {}
    return false;
  }

  async function render(canvas, dataUrl, size, model) {
    const S = size || 72;
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d');
    if (!ctx) return false;
    ctx.clearRect(0, 0, S, S);
    if (!dataUrl) return false;
    try {
      const crop = await bustCrop(dataUrl, model);
      if (!crop) throw new Error('bust failed');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(crop, 0, 0, S, S);
      if (hasContent(ctx, S)) return true;
      throw new Error('blank bust');
    } catch (err) {
      try {
        console.error(`[avatar] 3D bust failed, using 2D fallback: ${err?.message || err}`);
      } catch {}
      return render2D(canvas, dataUrl, S);
    }
  }

  function renderAll(dataUrl, model) {
    const jobs = [];
    document.querySelectorAll('canvas[data-headshot]').forEach(canvas => {
      const size = Number(canvas.getAttribute('data-headshot') || 72) || 72;
      jobs.push(render(canvas, dataUrl, size, model).catch(() => {}));
    });
    return Promise.all(jobs);
  }

  window.headshot = { render, renderAll };
})();
