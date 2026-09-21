'use strict';

(function () {
  const { bridge, toast, tr: t, fmt } = window.launcherUtil;

  let headDataUrl = null;
  let headRequested = false;
  let headModel = 'default';
  let signedIn = false;

  function paintHeads() {
    try {
      if (window.headshot) window.headshot.renderAll(headDataUrl, headModel);
    } catch {}
    document.querySelectorAll('[data-head-fallback]').forEach(node => {
      node.hidden = !!headDataUrl;
    });
  }

  async function refreshHeadshot() {
    if (headRequested) return;
    headRequested = true;
    try {
      const preview = await bridge().getSkinPreview();
      headDataUrl = preview && preview.skin && preview.skin.dataUrl ? preview.skin.dataUrl : null;
      headModel = preview && preview.skin && preview.skin.variant === 'SLIM' ? 'slim' : 'default';
    } catch {
      headDataUrl = null;
    } finally {
      headRequested = false;
    }
    paintHeads();
  }

  function setAccount(profile) {
    const nameEl = document.getElementById('profileName');
    const stateEl = document.getElementById('profileState');
    const avatarEls = [document.getElementById('profileAvatar'), document.getElementById('accountAvatarLarge')].filter(
      Boolean
    );
    const btn = document.getElementById('authButton');
    const btnLabel = btn ? btn.querySelector('span:last-child') : null;
    if (!nameEl || !stateEl || !btn) return;
    const initial = profile && profile.name ? profile.name.slice(0, 1).toUpperCase() : '?';
    avatarEls.forEach(avatarEl => {
      avatarEl.textContent = initial;
    });
    if (profile && profile.name) {
      signedIn = true;
      if (btn) btn.classList.add('is-danger');
      nameEl.textContent = profile.name;
      stateEl.textContent = t('account.connected', 'Microsoft connected');
      if (btnLabel) btnLabel.textContent = t('auth.signOut', 'Sign out');
      refreshHeadshot();
    } else {
      signedIn = false;
      if (btn) btn.classList.remove('is-danger');
      nameEl.textContent = t('topbar.signin', 'Not signed in');
      stateEl.textContent = t('account.only', 'Microsoft only');
      if (btnLabel) btnLabel.textContent = t('auth.signIn', 'Sign in');
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
      toast(fmt(t('auth.profileFail', 'Profile check failed: {msg}'), { msg: err.message }), 'error');
    }
  }

  async function onAuthButton() {
    const btn = document.getElementById('authButton');
    if (btn) btn.disabled = true;
    try {
      if (signedIn) {
        await bridge().logout();
        setAccount(null);
        toast(t('auth.signedOut', 'Signed out.'), 'ok');
      } else {
        toast(t('auth.signingIn', 'Opening Microsoft sign-in…'));
        const res = await bridge().login();
        setAccount(res && res.profile ? res.profile : null);
        toast(
          fmt(t('auth.signedInAs', 'Signed in as {name}.'), {
            name: (res && res.profile && res.profile.name) || 'player',
          }),
          'ok'
        );
        document.dispatchEvent(new CustomEvent('skin:reload'));
      }
    } catch (err) {
      toast(fmt(t('auth.loginFail', 'Sign-in failed: {msg}'), { msg: err.message }), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    paintHeads();
    const btn = document.getElementById('authButton');
    if (btn) btn.addEventListener('click', onAuthButton);
    const railBtn = document.getElementById('railProfileButton');
    if (railBtn)
      railBtn.addEventListener('click', () => {
        if (typeof window.showView === 'function') window.showView('profile');
      });
    const profileRefresh = document.getElementById('profileRefreshButton');
    if (profileRefresh) {
      profileRefresh.addEventListener('click', async () => {
        try {
          const res = await bridge().refresh();
          setAccount(res && res.profile ? res.profile : null);
          toast(t('auth.refreshed', 'Session refreshed.'), 'ok');
        } catch (err) {
          toast(fmt(t('auth.refreshFail', 'Refresh failed: {msg}'), { msg: err.message }), 'error');
        }
      });
    }
    const profileOutfit = document.getElementById('profileOutfitButton');
    if (profileOutfit)
      profileOutfit.addEventListener('click', () => {
        if (typeof window.showView === 'function') window.showView('skins');
      });
    const refreshBtn = document.getElementById('refreshSessionButton');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        try {
          const res = await bridge().refresh();
          setAccount(res && res.profile ? res.profile : null);
          toast(t('auth.refreshed', 'Session refreshed.'), 'ok');
        } catch (err) {
          toast(fmt(t('auth.refreshFail', 'Refresh failed: {msg}'), { msg: err.message }), 'error');
        }
      });
    }
    const homeRefresh = document.getElementById('homeRefreshButton');
    if (homeRefresh) {
      homeRefresh.addEventListener('click', async () => {
        try {
          const res = await bridge().refresh();
          setAccount(res && res.profile ? res.profile : null);
          toast(t('auth.refreshed', 'Session refreshed.'), 'ok');
        } catch (err) {
          toast(fmt(t('auth.refreshFail', 'Refresh failed: {msg}'), { msg: err.message }), 'error');
        }
      });
    }
    document.addEventListener('skin:reload', () => {
      headRequested = false;
      if (signedIn) refreshHeadshot();
    });
    try {
      bridge().onAuthChanged(payload => {
        setAccount(payload && payload.profile ? payload.profile : null);
        if (payload && payload.refreshError)
          toast(fmt(t('auth.refreshFail', 'Refresh failed: {msg}'), { msg: payload.refreshError }), 'error');
      });
    } catch {}
    document.addEventListener('i18n:applied', () => loadProfile());
    loadProfile();
  });

  window.accountHeadshot = {
    refresh: () => {
      headRequested = false;
      return refreshHeadshot();
    },
  };
})();
