'use strict';

(function () {
  const { bridge, tr: t } = window.launcherUtil;

  function uiLang() {
    try {
      const l = document.documentElement.lang;
      if (l === 'de' || l === 'en') return l;
    } catch {}
    return 'de';
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
    let latest = null;
    try {
      latest = await bridge().getLatestRelease();
    } catch {}
    if (latest && latest.version) {
      set('aboutLatest', 'v' + String(latest.version).replace(/^v/, ''));
      const notes = latest.changelog && (latest.changelog[uiLang()] || latest.changelog.de);
      const box = document.getElementById('aboutChangelog');
      if (box && notes) {
        box.textContent = String(notes);
        box.hidden = false;
      }
    } else {
      set('aboutLatest', t('about.failed', 'Versionsabfrage fehlgeschlagen'));
    }
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
            `${t('about.failed', 'Versionsabfrage fehlgeschlagen')}: ${err && err.message ? err.message : ''}`
          );
        }
      });
    }
    try {
      bridge().onUpdateState(msg => {
        if (!msg) return;
        if (msg.state === 'none') set('aboutStatus', t('about.uptodate', 'Du bist aktuell.'));
        else if (msg.state === 'error') {
          if (msg.code === 'not-configured') {
            set('aboutStatus', t('update.errNotConfigured', 'No update source configured.'));
          } else {
            set(
              'aboutStatus',
              `${t('about.failed', 'Versionsabfrage fehlgeschlagen')}${msg.message ? `: ${msg.message}` : ''}`
            );
          }
        } else if (msg.state === 'available' || msg.state === 'ready') {
          set('aboutStatus', '');
        }
      });
    } catch {}
  });
})();
