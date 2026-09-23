'use strict';

(function () {
  function renderIcons() {
    try {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderIcons);
  } else {
    renderIcons();
  }
  // View fragments are inserted async; icons inside them need a second pass.
  document.addEventListener('views:loaded', renderIcons);

  window.refreshIcons = renderIcons;
})();
