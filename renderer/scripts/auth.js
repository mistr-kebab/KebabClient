'use strict';

(function () {
  const { bridge, toast } = window.launcherUtil;

  function t(key, fallback) {
    try {
      if (window.i18n) {
        const v = window.i18n.t(key);
        if (v && v !== key) return v;
      }
    } catch { /* noop */ }
    return fallback || key;
  }

  let headDataUrl = null;
  let headRequested = false;

  function paintHeads() {
    try {
      if (window.headshot) window.headshot.renderAll(headDataUrl);
    } catch { /* decorative */ }
    document.querySelectorAll('[data-head-fallback]').forEach((node) => {
      node.hidden = !!headDataUrl;
    });
  }

  async function refreshHeadshot() {
    if (headRequested) return;
    headRequested = true;
    try {
      const preview = await bridge().getSkinPreview();
      headDataUrl = preview && preview.skin && preview.skin.dataUrl ? preview.skin.dataUrl : null;
    } catch {
      headDataUrl = null;
    } finally {
      headRequested = false;
    }
    paintHeads();
  }

  function setAccount(profile) {
    const nameEl = document.getElementById('accountName');
    const stateEl = document.getElementById('accountState');
    const chipNameEl = document.getElementById('accountChipName');
    const avatarEls = [
      document.getElementById('accountAvatarLarge'),
      document.getElementById('accountAvatar')
    ].filter(Boolean);
    const btn = document.getElementById('authButton');
    const btnLabel = btn ? btn.querySelector('span:last-child') : null;
    if (!nameEl || !stateEl || !btn) return;
    const initial = profile && profile.name ? profile.name.slice(0, 1).toUpperCase() : '?';
    avatarEls.forEach((avatarEl) => { avatarEl.textContent = initial; });
    if (profile && profile.name) {
      nameEl.textContent = profile.name;
      stateEl.textContent = 'Microsoft connected';
      if (chipNameEl) chipNameEl.textContent = profile.name;
      if (btnLabel) btnLabel.textContent = 'Sign out';
      refreshHeadshot();
    } else {
      nameEl.textContent = t('topbar.signin', 'Not signed in');
      stateEl.textContent = 'Microsoft only';
      if (chipNameEl) chipNameEl.textContent = t('topbar.signin', 'Not signed in');
      if (btnLabel) btnLabel.textContent = 'Sign in';
      headDataUrl = null;
      paintHeads();
    }
    if (window.refreshIcons) window.refreshIcons();
  }

  async function loadProfile() {
    try {
      const res = await bridge().getProfile();
      setAccount(res && res.profile ? res.profile : null);
    } catch (err) {
      toast(`Profile check failed: ${err.message}`, 'error');
    }
  }

  async function onAuthButton() {
    const btn = document.getElementById('authButton');
    const label = btn ? btn.querySelector('span:last-child') : null;
    const signedIn = label && label.textContent === 'Sign out';
    if (btn) btn.disabled = true;
    try {
      if (signedIn) {
        await bridge().logout();
        setAccount(null);
        toast('Signed out.', 'ok');
      } else {
        toast('Opening Microsoft sign-in…');
        const res = await bridge().login();
        setAccount(res && res.profile ? res.profile : null);
        toast(`Signed in as ${(res && res.profile && res.profile.name) || 'player'}.`, 'ok');
        document.dispatchEvent(new CustomEvent('skin:reload'));
      }
    } catch (err) {
      toast(`Sign-in failed: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    paintHeads();
    const btn = document.getElementById('authButton');
    if (btn) btn.addEventListener('click', onAuthButton);
    const refreshBtn = document.getElementById('refreshSessionButton');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        try {
          const res = await bridge().refresh();
          setAccount(res && res.profile ? res.profile : null);
          toast('Session refreshed.', 'ok');
        } catch (err) {
          toast(`Refresh failed: ${err.message}`, 'error');
        }
      });
    }
    const homeRefresh = document.getElementById('homeRefreshButton');
    if (homeRefresh) {
      homeRefresh.addEventListener('click', async () => {
        try {
          const res = await bridge().refresh();
          setAccount(res && res.profile ? res.profile : null);
          toast('Session refreshed.', 'ok');
        } catch (err) {
          toast(`Refresh failed: ${err.message}`, 'error');
        }
      });
    }
    document.addEventListener('skin:reload', () => {
      headRequested = false;
      const chip = document.getElementById('accountChipName');
      const name = chip && chip.textContent && chip.textContent !== t('topbar.signin', 'Not signed in')
        ? { name: chip.textContent }
        : null;
      if (name) refreshHeadshot();
    });
    try {
      bridge().onAuthChanged((payload) => {
        setAccount(payload && payload.profile ? payload.profile : null);
        if (payload && payload.refreshError) toast(`Auto-refresh failed: ${payload.refreshError}`, 'error');
      });
    } catch { /* noop */ }
    loadProfile();
  });

  window.accountHeadshot = {
    refresh: () => { headRequested = false; return refreshHeadshot(); }
  };
})();
