'use strict';

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
    return;
  }
  const names = Object.keys(views).sort();
  for (const name of names) {
    mount.insertAdjacentHTML('beforeend', views[name]);
  }
  if (!names.length) console.warn('No view fragments found in renderer/views.');
})();
