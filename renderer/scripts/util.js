'use strict';

(function () {
  function formatDownloads(n) {
    const v = Number(n || 0);
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(v);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  window.launcherUtil = window.launcherUtil || {};
  window.launcherUtil.formatDownloads = formatDownloads;
  window.launcherUtil.el = el;
})();
