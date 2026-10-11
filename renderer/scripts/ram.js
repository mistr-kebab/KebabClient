'use strict';

// RAM slider: 100 MB steps with a dot on every full GB.
// Dots are clickable and jump straight to that GB.
// Dragging snaps to a GB when close (60 MB), so 16 GB stays reachable.
// The value can also be typed directly into the GB field.
(function () {
  const SNAP_MB = 60;

  function ramLang() {
    try {
      const l = window.i18n && window.i18n.getLanguage && window.i18n.getLanguage();
      if (l === 'en') return 'en';
    } catch {}
    return 'de';
  }

  function formatRamNumber(mb) {
    const gb = Number(mb) / 1024;
    const s = Number.isInteger(gb) ? String(gb) : gb.toFixed(1);
    return ramLang() === 'de' ? s.replace('.', ',') : s;
  }

  function formatRamGb(mb) {
    return `${formatRamNumber(mb)} GB`;
  }

  function parseGb(text, minMb, maxMb) {
    const n = parseFloat(String(text || '').trim().replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    const mb = Math.round(n * 1024);
    return Math.min(maxMb, Math.max(minMb, mb));
  }

  function nearestGb(mb) {
    return Math.round(Number(mb) / 1024) * 1024;
  }

  function createRamSlider(opts) {
    const o = opts || {};
    const min = Number.isFinite(Number(o.min)) ? Number(o.min) : 1024;
    const max = Number.isFinite(Number(o.max)) ? Number(o.max) : 16384;
    const step = Number.isFinite(Number(o.step)) ? Number(o.step) : 100;
    const start = Number.isFinite(Number(o.value)) ? Math.round(Number(o.value)) : 4096;

    const wrap = document.createElement('div');
    wrap.className = 'ram-slider';
    const top = document.createElement('div');
    top.className = 'ram-top';
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'ram-range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    if (o.id) input.id = o.id;
    const readout = document.createElement('div');
    readout.className = 'ram-readout';
    const num = document.createElement('input');
    num.type = 'text';
    num.className = 'ram-num';
    num.setAttribute('inputmode', 'decimal');
    num.autocomplete = 'off';
    num.spellcheck = false;
    const unit = document.createElement('span');
    unit.className = 'ram-unit';
    unit.textContent = 'GB';
    readout.appendChild(num);
    readout.appendChild(unit);
    top.appendChild(input);
    top.appendChild(readout);
    wrap.appendChild(top);
    const ticks = document.createElement('div');
    ticks.className = 'ram-ticks';
    for (let gb = 1; gb <= 64; gb++) {
      const mb = gb * 1024;
      if (mb < min || mb > max) continue;
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'ram-tick';
      dot.style.left = `${((mb - min) / (max - min)) * 100}%`;
      dot.title = formatRamGb(mb);
      dot.setAttribute('aria-label', formatRamGb(mb));
      dot.dataset.mb = String(mb);
      dot.addEventListener('click', () => {
        api.set(mb);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      ticks.appendChild(dot);
    }
    wrap.appendChild(ticks);

    function sync() {
      let mb = Math.round(Number(input.value));
      if (!Number.isFinite(mb)) mb = min;
      if (document.activeElement !== num) num.value = formatRamNumber(mb);
      const cur = ((mb - min) / (max - min)) * 100;
      input.style.setProperty('--fill', `${cur}%`);
      ticks.querySelectorAll('.ram-tick').forEach(d => {
        d.classList.toggle('is-on', Number(d.dataset.mb) <= mb);
      });
    }
    input.addEventListener('input', sync);
    input.addEventListener('change', () => {
      const mb = Math.round(Number(input.value));
      if (!Number.isFinite(mb)) return;
      const snap = nearestGb(mb);
      if (snap >= min && snap <= max && Math.abs(snap - mb) <= SNAP_MB && snap !== mb) {
        api.set(snap);
      }
    });
    num.addEventListener('change', () => {
      const mb = parseGb(num.value, min, max);
      if (mb === null) {
        sync();
        return;
      }
      api.set(mb);
      num.blur();
    });
    num.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        num.dispatchEvent(new Event('change'));
      } else if (e.key === 'Escape') {
        sync();
        num.blur();
      }
    });
    num.addEventListener('focus', () => {
      try {
        num.select();
      } catch {}
    });
    const api = {
      element: wrap,
      input,
      get() {
        const mb = Math.round(Number(input.value));
        return Number.isFinite(mb) ? mb : min;
      },
      set(mb) {
        input.value = String(mb);
        sync();
      },
      refresh() {
        sync();
      },
    };
    api.set(start);
    return api;
  }

  window.createRamSlider = createRamSlider;
  window.formatRamGb = formatRamGb;
})();
