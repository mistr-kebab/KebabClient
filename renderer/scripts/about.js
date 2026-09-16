'use strict';

(function () {
  const { bridge } = window.launcherUtil;

  function t(key, fallback) {
    try {
      if (window.i18n && typeof window.i18n.t === 'function') {
        const v = window.i18n.t(key);
        if (v && v !== key) return v;
      }
    } catch {}
    return fallback;
  }

  function uiLang() {
    try {
      const l = document.documentElement.lang;
      if (l === 'de' || l === 'en') return l;
    } catch {}
    return 'de';
  }

  function fmt(n) {
    try {
      return Number(n).toLocaleString(uiLang() === 'en' ? 'en-US' : 'de-DE');
    } catch {
      return String(n);
    }
  }

  function set(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  async function load() {
    try {
      const v = await bridge().appVersion();
      if (v && v.version) set('aboutVersion', 'v' + String(v.version).replace(/^v/, ''));
    } catch {}
    try {
      const res = await fetch('https://kebabdev.de/api/latest.json', {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.version) set('aboutLatest', 'v' + String(d.version).replace(/^v/, ''));
        const notes = d && d.changelog && (d.changelog[uiLang()] || d.changelog.de);
        const box = document.getElementById('aboutChangelog');
        if (box && notes) {
          box.textContent = String(notes);
          box.hidden = false;
        }
      }
    } catch {}
    try {
      const res = await fetch('https://kebabdev.de/api/stats.json', {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.activeUsers !== null && d.activeUsers !== undefined) {
          set('aboutUsers', fmt(d.activeUsers));
        }
      }
    } catch {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    const btn = document.getElementById('aboutCheckButton');
    if (btn) {
      btn.addEventListener('click', async () => {
        set('aboutStatus', t('about.checking', 'Suche läuft …'));
        try {
          await bridge().checkForUpdates();
        } catch (err) {
          set(
            'aboutStatus',
            `${t('about.failed', 'Versionsabfrage fehlgeschlagen')}: ${
              err && err.message ? err.message : ''
            }`
          );
        }
      });
    }
    try {
      bridge().onUpdateState((msg) => {
        if (!msg) return;
        if (msg.state === 'none') set('aboutStatus', t('about.uptodate', 'Du bist aktuell.'));
        else if (msg.state === 'error') {
          if (msg.code === 'not-configured') {
            set('aboutStatus', t('update.errNotConfigured', 'No update source configured.'));
          } else {
            set('aboutStatus', `${t('about.failed', 'Versionsabfrage fehlgeschlagen')}${msg.message ? `: ${msg.message}` : ''}`);
          }
        } else if (msg.state === 'available' || msg.state === 'ready') {
          set('aboutStatus', '');
        }
      });
    } catch {}
  });
})();
