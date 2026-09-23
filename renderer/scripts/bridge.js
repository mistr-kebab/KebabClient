'use strict';

(function () {
  function bridge() {
    if (!window.mc) throw new Error('Preload bridge (window.mc) is unavailable.');
    return window.mc;
  }

  window.launcherUtil = window.launcherUtil || {};
  window.launcherUtil.bridge = bridge;

  // Fallback in case views.js failed to parse: run on DOM ready.
  // views.js replaces this with the real gate that also waits for the
  // async view fragments.
  if (typeof window.whenViewsReady !== 'function') {
    window.whenViewsReady = function (fn) {
      if (typeof fn !== 'function') return;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn, { once: true });
      } else {
        try {
          fn();
        } catch (err) {
          console.error('[views] init failed:', err);
        }
      }
    };
  }
})();
