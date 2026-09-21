'use strict';

(function () {
  const mount = document.querySelector('main.content');
  let views = null;
  try {
    views = window.mc.loadViews();
  } catch {}
  if (!mount || !views) {
    console.error('View fragments could not be loaded.');
    return;
  }
  const names = Object.keys(views).sort();
  for (const name of names) {
    mount.insertAdjacentHTML('beforeend', views[name]);
  }
  if (!names.length) console.warn('No view fragments found in renderer/views.');
})();
