'use strict';

(function () {
  let hideTimer = 0;
  let lastFocus = null;

  function openDrawer() {
    const drawer = document.getElementById('accountDrawer');
    const backdrop = document.getElementById('drawerBackdrop');
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = 0;
    }
    if (drawer && !drawer.hidden) return;
    try { lastFocus = document.activeElement; } catch { lastFocus = null; }
    if (drawer) drawer.hidden = false;
    if (backdrop) backdrop.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (drawer) drawer.classList.add('is-open');
        if (backdrop) backdrop.classList.add('is-open');
      });
    });
    window.setTimeout(() => {
      const closeBtn = document.getElementById('drawerCloseButton');
      if (closeBtn) closeBtn.focus();
    }, 60);
  }

  function closeDrawer() {
    const drawer = document.getElementById('accountDrawer');
    const backdrop = document.getElementById('drawerBackdrop');
    if (!drawer || drawer.hidden) return;
    if (drawer) drawer.classList.remove('is-open');
    if (backdrop) backdrop.classList.remove('is-open');
    if (hideTimer) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (drawer && !drawer.classList.contains('is-open')) drawer.hidden = true;
      if (backdrop && !backdrop.classList.contains('is-open')) backdrop.hidden = true;
      hideTimer = 0;
      try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch {}
      lastFocus = null;
    }, 200);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const chipBtn = document.getElementById('accountChipButton');
    const closeBtn = document.getElementById('drawerCloseButton');
    const backdrop = document.getElementById('drawerBackdrop');
    if (chipBtn) chipBtn.addEventListener('click', openDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });
  });

  window.launcherDrawer = { open: openDrawer, close: closeDrawer };
})();
