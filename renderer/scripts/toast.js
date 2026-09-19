'use strict';

(function () {
  const DURATION = 5200;
  const MAX_VISIBLE = 5;
  const { tr: t } = window.launcherUtil;

  function toast(message, kind) {
    const stack = document.getElementById('toastStack');
    if (!stack) return null;
    const text = String(message == null ? '' : message);
    if (!text) return null;

    const elToast = document.createElement('div');
    elToast.className = 'toast' + (kind ? ` is-${kind}` : '');
    elToast.setAttribute('role', 'status');

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
    while (stack.children.length > MAX_VISIBLE) stack.firstChild.remove();
    refreshStack();
    if (window.refreshIcons) window.refreshIcons();

    const state = { remaining: DURATION, startedAt: Date.now(), timer: 0, done: false };

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
      bar.style.transform = `scaleX(${state.remaining / DURATION})`;
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
      bar.style.transform = `scaleX(${state.remaining / DURATION})`;
    }

    function resume() {
      if (state.done) return;
      if (state.remaining <= 0) { dismiss(); return; }
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
      const fromEnd = kids.length - 1 - idx;
      node.classList.toggle('is-stacked', fromEnd >= 3);
      node.style.setProperty('--stack-depth', String(Math.min(fromEnd, 4)));
      node.style.zIndex = String(10 + idx);
    });
    stack.classList.toggle('has-many', kids.length > 3);
  }

  window.launcherUtil = window.launcherUtil || {};
  window.launcherUtil.toast = toast;
})();
