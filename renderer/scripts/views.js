'use strict';

(function () {
  // Readiness gate for all view scripts.
  // Since 0.3.2 the fragments are loaded via async IPC, so they are inserted
  // AFTER DOMContentLoaded fires. Scripts must therefore init via
  // window.whenViewsReady(fn) instead of DOMContentLoaded, otherwise every
  // getElementById/querySelector inside a view returns null and no listener
  // is ever attached (dead settings, dead skin controls, ...).
  let viewsLoaded = false;
  const pending = [];

  function run(fn) {
    try {
      fn();
    } catch (err) {
      console.error('[views] init failed:', err);
    }
  }

  function flush() {
    while (pending.length) run(pending.shift());
  }

  window.whenViewsReady = function (fn) {
    if (typeof fn !== 'function') return;
    if (viewsLoaded) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => run(fn), { once: true });
      } else {
        run(fn);
      }
      return;
    }
    pending.push(fn);
  };

  function finish(views, mount) {
    if (mount && views) {
      const names = Object.keys(views).sort();
      for (const name of names) {
        mount.insertAdjacentHTML('beforeend', views[name]);
      }
      if (!names.length) console.warn('No view fragments found in renderer/views.');
    }
    viewsLoaded = true;
    try {
      document.dispatchEvent(new CustomEvent('views:loaded'));
    } catch (err) {
      console.warn('[views] Failed to dispatch views:loaded:', err?.message || err);
    }
    // Late listeners that missed the event above (async i18n) still get
    // translated/applied content.
    try {
      if (window.i18n && typeof window.i18n.apply === 'function') window.i18n.apply();
    } catch (err) {
      console.warn('[views] Failed to re-apply i18n:', err?.message || err);
    }
    try {
      if (window.refreshIcons) window.refreshIcons();
    } catch (err) {
      console.warn('[views] Failed to refresh icons:', err?.message || err);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', flush, { once: true });
    } else {
      flush();
    }
  }

  (async function () {
    const mount = document.querySelector('main.content');
    let views = null;
    try {
      views = await window.mc.loadViews();
    } catch (err) {
      console.error('[views] Failed to load views:', err);
    }
    if (!mount || !views) {
      console.error('View fragments could not be loaded.');
      // Never deadlock the app: run pending inits anyway.
      viewsLoaded = true;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', flush, { once: true });
      } else {
        flush();
      }
      return;
    }
    finish(views, mount);
  })();
})();
