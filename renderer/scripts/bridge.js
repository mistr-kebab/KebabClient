'use strict';

(function () {
  function bridge() {
    if (!window.mc) throw new Error('Preload bridge (window.mc) is unavailable.');
    return window.mc;
  }

  window.launcherUtil = window.launcherUtil || {};
  window.launcherUtil.bridge = bridge;
})();
