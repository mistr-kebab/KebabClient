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

  async function render(canvas, dataUrl, size) {
    const S = size || 72;
    const dpr = 1;
    canvas.width = S * dpr;
    canvas.height = S * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

  function renderAll(dataUrl) {
    document.querySelectorAll('canvas[data-headshot]').forEach((canvas) => {
      const size = Number(canvas.getAttribute('data-headshot') || 72) || 72;
      render(canvas, dataUrl, size).catch(() => {});
    });
  }

  window.headshot = { render, renderAll };
})();
