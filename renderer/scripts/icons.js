'use strict';

(function () {
  function renderIcons() {
    try {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    } catch { /* icons are decorative */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderIcons);
  } else {
    renderIcons();
  }

  window.refreshIcons = renderIcons;
})();
