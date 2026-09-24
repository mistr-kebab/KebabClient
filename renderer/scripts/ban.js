'use strict';

// Ban screen: blocks game start when the server reports banned=true.
// All server-controlled strings are rendered via textContent (XSS-safe).

(function () {
  const { bridge, toast, el, tr, fmt } = window.launcherUtil;

  let overlay = null;
  let lastPayload = null;

  function closeBanScreen() {
    if (overlay && overlay.isConnected) overlay.remove();
    overlay = null;
    lastPayload = null;
  }

  function field(label, value) {
    const wrap = el('div', 'ban-field');
    wrap.appendChild(el('span', 'ban-field-label', label));
    // textContent only: reason/username come from the server.
    wrap.appendChild(el('span', 'ban-field-value', value || '—'));
    return wrap;
  }

  function discordIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('btn-icon');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      'M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.319 13.58.099 18.058a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 00-.042-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.3 12.3 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.029 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z'
    );
    svg.appendChild(path);
    return svg;
  }

  function showBanScreen(payload) {
    lastPayload = {
      reason: payload && typeof payload.reason === 'string' ? payload.reason : '',
      username: payload && typeof payload.username === 'string' ? payload.username : '',
    };
    if (overlay && overlay.isConnected) overlay.remove();

    overlay = el('div', 'modal-backdrop');
    const modal = el('div', 'modal version-modal ban-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', tr('ban.title', 'Account banned'));
    overlay.appendChild(modal);

    const head = el('div', 'modal-head ban-head');
    const banIco = document.createElement('i');
    banIco.setAttribute('data-lucide', 'shield-x');
    banIco.className = 'ban-icon';
    banIco.setAttribute('aria-hidden', 'true');
    head.appendChild(banIco);
    const titles = el('div', 'ban-titles');
    titles.appendChild(el('h3', 'modal-title', tr('ban.title', 'Account banned')));
    titles.appendChild(
      el('p', 'ban-sub', tr('ban.subtitle', 'This account cannot start the game right now.'))
    );
    head.appendChild(titles);
    const xBtn = el('button', 'icon-btn modal-close', '');
    xBtn.type = 'button';
    xBtn.setAttribute('aria-label', tr('ban.close', 'Close'));
    const xIco = document.createElement('i');
    xIco.setAttribute('data-lucide', 'x');
    xBtn.appendChild(xIco);
    xBtn.addEventListener('click', closeBanScreen);
    head.appendChild(xBtn);
    modal.appendChild(head);

    const body = el('div', 'modal-body');
    const detail = el('div', 'modal-detail');
    detail.appendChild(el('p', 'muted', tr('ban.lead', 'Game launch was blocked for this account.')));
    const card = el('div', 'ban-card');
    card.appendChild(field(tr('ban.user', 'Account'), lastPayload.username));
    card.appendChild(
      field(tr('ban.reason', 'Reason'), lastPayload.reason || tr('ban.noReason', 'No reason given.'))
    );
    detail.appendChild(card);
    body.appendChild(detail);
    modal.appendChild(body);

    const foot = el('div', 'modal-foot');
    const appealBtn = el('button', 'btn btn-play');
    appealBtn.type = 'button';
    appealBtn.appendChild(discordIcon());
    appealBtn.appendChild(document.createTextNode(tr('ban.appealBtn', 'Appeal ban')));
    appealBtn.addEventListener('click', async () => {
      try {
        await bridge().appealBan();
      } catch (err) {
        toast(fmt(tr('ban.appealFail', 'Could not open invite: {msg}'), { msg: err.message }), 'error');
      }
    });
    foot.appendChild(appealBtn);
    const recheckBtn = el('button', 'btn btn-ghost', tr('ban.recheck', 'Check again'));
    recheckBtn.type = 'button';
    recheckBtn.addEventListener('click', async () => {
      recheckBtn.disabled = true;
      try {
        const res = await bridge().checkBan();
        if (res && res.banned) {
          showBanScreen(res);
        } else {
          closeBanScreen();
          toast(tr('ban.cleared', 'Ban lifted — have fun!'), 'ok');
        }
      } catch (err) {
        toast(fmt(tr('ban.checkFail', 'Check failed: {msg}'), { msg: err.message }), 'error');
      } finally {
        if (recheckBtn.isConnected) recheckBtn.disabled = false;
      }
    });
    foot.appendChild(recheckBtn);
    const closeBtn = el('button', 'btn btn-ghost', tr('ban.close', 'Close'));
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', closeBanScreen);
    foot.appendChild(closeBtn);
    modal.appendChild(foot);

    document.body.appendChild(overlay);
    if (window.refreshIcons) window.refreshIcons();
  }

  window.showBanScreen = showBanScreen;
  window.hideBanScreen = closeBanScreen;

  function onBanStatus(payload) {
    if (!payload) return;
    if (payload.banned) showBanScreen(payload);
    else closeBanScreen();
  }

  window.whenViewsReady(() => {
    try {
      bridge().onBanStatus(onBanStatus);
    } catch {}
    // Re-render texts on language change while the screen is open.
    document.addEventListener('i18n:applied', () => {
      if (overlay && overlay.isConnected && lastPayload) showBanScreen(lastPayload);
    });
  });
})();
