'use strict';

(function () {
  // Defined synchronously so view scripts can use window.i18n during init.
  // The locale tables arrive via async IPC and are applied once loaded
  // (and again when the async view fragments are inserted, whichever
  // happens last).
  let STRINGS = { de: {}, en: {} };
  let lang = 'en';

  function detect() {
    try {
      const nav = String(navigator.language || '').toLowerCase();
      if (nav.startsWith('de')) return 'de';
    } catch (err) {
      console.warn('[i18n] Language detection failed:', err?.message || err);
    }
    return 'en';
  }

  // Must never throw: a missing table (e.g. unparsable locale file)
  // previously aborted whole view inits on the first apply().
  function t(key) {
    const table = STRINGS[lang] || STRINGS.en || {};
    if (table[key] !== undefined) return table[key];
    const enTable = STRINGS.en || {};
    if (enTable[key] !== undefined) return enTable[key];
    return key;
  }

  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(node => {
      const key = node.getAttribute('data-i18n');
      if (key) node.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(node => {
      const key = node.getAttribute('data-i18n-ph');
      if (key) node.setAttribute('placeholder', t(key));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(node => {
      const key = node.getAttribute('data-i18n-aria');
      if (key) node.setAttribute('aria-label', t(key));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(node => {
      const key = node.getAttribute('data-i18n-title');
      if (key) node.setAttribute('title', t(key));
    });
    document.dispatchEvent(new CustomEvent('i18n:applied', { detail: { lang } }));
  }

  function setLanguage(next, persist) {
    const v = next === 'en' ? 'en' : 'de';
    lang = v;
    apply();
    if (persist !== false) {
      try {
        const b = window.launcherUtil && window.launcherUtil.bridge ? window.launcherUtil.bridge() : null;
        if (b && b.updateSettings) b.updateSettings({ language: v }).catch(() => {});
      } catch {}
    }
    try {
      window.localStorage.setItem('kebabLang', v);
    } catch {}
    return v;
  }

  function getLanguage() {
    return lang;
  }

  function initLanguage(stored) {
    if (stored === 'en' || stored === 'de') lang = stored;
    else {
      try {
        const cached = window.localStorage.getItem('kebabLang');
        if (cached === 'en' || cached === 'de') lang = cached;
        else lang = detect();
      } catch {
        lang = detect();
      }
    }
    apply();
    return lang;
  }

  window.i18n = { t, setLanguage, getLanguage, initLanguage, apply };

  // Views are inserted async and may arrive after the locales (or before);
  // re-apply in both cases so data-i18n nodes inside fragments translate.
  document.addEventListener('views:loaded', apply);

  (async function () {
    try {
      const loaded = await window.mc.loadLocales();
      if (loaded && loaded.de) STRINGS = loaded;
      else console.warn('Locales could not be loaded from renderer/locales.');
    } catch (err) {
      console.error('[i18n] Failed to load locales:', err);
    }
    apply();
  })();
})();
