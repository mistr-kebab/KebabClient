'use strict';

(function () {
  const OK_MS = 4200;
  const INFO_MS = 5200;
  const ERR_MS = 6500;
  const MAX_STACKED = 6;
  const { tr: t } = window.launcherUtil;

  const KIND_ICON = { ok: 'check', error: 'alert-triangle' };

  function durationFor(kind) {
    if (kind === 'ok') return OK_MS;
    if (kind === 'error') return ERR_MS;
    return INFO_MS;
  }

  function statesOf(stack) {
    return [...stack.children].map(n => n._toast).filter(Boolean);
  }

  function bindStackHover(stack) {
    if (!stack || stack.dataset.hoverBound) return;
    stack.dataset.hoverBound = '1';
    stack.addEventListener('mouseenter', () => {
      statesOf(stack).forEach(s => s.pause());
    });
    stack.addEventListener('mouseleave', () => {
      statesOf(stack).forEach(s => s.resume());
    });
  }

  function toast(message, kind) {
    const stack = document.getElementById('toastStack');
    if (!stack) return null;
    const text = String(message == null ? '' : message).trim();
    if (!text) return null;
    bindStackHover(stack);

    const key = `${kind || 'info'}::${text}`;
    const dup = [...stack.children].find(n => n._toast && n._toast.key === key);
    if (dup) dup.remove();

    const elToast = document.createElement('div');
    elToast.className = 'toast' + (kind ? ` is-${kind}` : '');
    elToast.setAttribute('role', 'status');

    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', KIND_ICON[kind] || 'info');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    elToast.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'toast-body';
    body.textContent = text;
    elToast.appendChild(body);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', t('toast.close', 'Dismiss'));
    close.textContent = '×';
    elToast.appendChild(close);

    const bar = document.createElement('span');
    bar.className = 'toast-progress';
    elToast.appendChild(bar);

    stack.appendChild(elToast);
    while (stack.children.length > MAX_STACKED) stack.firstChild.remove();
    refreshStack();
    if (window.refreshIcons) window.refreshIcons();

    const total = durationFor(kind);
    const state = {
      key,
      remaining: total,
      total,
      startedAt: Date.now(),
      timer: 0,
      done: false,
    };
    elToast._toast = state;

    function clearTimer() {
      if (state.timer) {
        window.clearTimeout(state.timer);
        state.timer = 0;
      }
    }

    function runTimer() {
      clearTimer();
      state.startedAt = Date.now();
      bar.style.transition = 'none';
      bar.style.transform = `scaleX(${state.remaining / state.total})`;
      void bar.offsetWidth;
      bar.style.transition = `transform ${state.remaining}ms linear`;
      bar.style.transform = 'scaleX(0)';
      state.timer = window.setTimeout(dismiss, state.remaining);
    }

    function pause() {
      if (state.done || !state.timer) return;
      clearTimer();
      state.remaining = Math.max(0, state.remaining - (Date.now() - state.startedAt));
      bar.style.transition = 'none';
      bar.style.transform = `scaleX(${state.remaining / state.total})`;
    }

    function resume() {
      if (state.done) return;
      if (state.remaining <= 0) {
        dismiss();
        return;
      }
      runTimer();
    }

    function dismiss() {
      if (state.done) return;
      state.done = true;
      clearTimer();
      elToast.classList.add('is-leaving');
      window.setTimeout(() => {
        elToast.remove();
        refreshStack();
      }, 260);
    }

    state.pause = pause;
    state.resume = resume;
    state.dismiss = dismiss;

    close.addEventListener('click', dismiss);
    elToast.addEventListener('mouseenter', pause);
    elToast.addEventListener('mouseleave', resume);
    runTimer();
    return { dismiss, element: elToast };
  }

  function refreshStack() {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const kids = [...stack.children];
    kids.forEach((node, idx) => {
      const depth = kids.length - 1 - idx;
      node.style.setProperty('--depth', String(depth));
      node.style.zIndex = String(10 + idx);
    });
  }

  window.launcherUtil = window.launcherUtil || {};
  window.launcherUtil.toast = toast;
})();
