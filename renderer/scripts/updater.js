'use strict';

(function () {
  const { bridge, toast, tr: t } = window.launcherUtil;

  let state = 'idle';
  let version = '';
  let percent = 0;

  function paint() {
    const b = document.getElementById('updateButton');
    const l = document.getElementById('updateButtonLabel');
    if (!b || !l) return;
    const show = state === 'available' || state === 'downloading' || state === 'ready';
    b.hidden = !show;
    if (!show) return;
    b.disabled = state === 'downloading';
    if (state === 'available') {
      l.textContent = `${t('update.available', 'Update verfügbar')}${version ? ` · v${version}` : ''}`;
      b.title = t('update.availableTitle', 'Neue Version laden');
    } else if (state === 'downloading') {
      l.textContent = `${Math.round(percent)}% …`;
      b.title = t('update.downloadingTitle', 'Update wird geladen …');
    } else if (state === 'ready') {
      l.textContent = t('update.restart', 'Neustart & installieren');
      b.title = t('update.restartTitle', 'App neustarten und Update installieren');
    }
    if (window.refreshIcons) window.refreshIcons();
  }

  async function onClick() {
    if (state === 'available') {
      state = 'downloading';
      percent = 0;
      paint();
      try {
        await bridge().downloadUpdate();
      } catch (err) {
        state = 'available';
        paint();
        toast(`${t('update.failed', 'Update fehlgeschlagen')}: ${err.message}`, 'error');
      }
    } else if (state === 'ready') {
      try {
        await bridge().installUpdate();
      } catch (err) {
        toast(`${t('update.failed', 'Update fehlgeschlagen')}: ${err.message}`, 'error');
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('updateButton');
    if (b) b.addEventListener('click', onClick);
    try {
      bridge().onUpdateState(msg => {
        if (!msg) return;
        if (msg.state === 'available') {
          state = 'available';
          version = msg.version || '';
          toast(`${t('update.available', 'Update verfügbar')}${version ? `: v${version}` : ''}.`, 'ok');
        } else if (msg.state === 'downloading') {
          state = 'downloading';
          percent = msg.percent || 0;
        } else if (msg.state === 'ready') {
          state = 'ready';
          version = msg.version || version;
          toast(t('update.readyMsg', 'Update geladen — Neustart zum Installieren.'), 'ok');
        } else if (msg.state === 'none') {
          if (state !== 'ready') state = 'idle';
        } else if (msg.state === 'error') {
          const errText =
            msg.code === 'not-configured'
              ? t('update.errNotConfigured', 'No update source configured.')
              : `${t('update.failed', 'Update fehlgeschlagen')}${msg.message ? `: ${msg.message}` : ''}`;
          if (state === 'downloading') {
            state = 'available';
            toast(errText, 'error');
          } else {
            state = 'idle';
          }
        } else if (msg.state === 'checking') {
          return;
        }
        paint();
      });
    } catch {}
    paint();
  });
})();
