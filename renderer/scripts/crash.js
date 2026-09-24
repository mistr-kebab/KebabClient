'use strict';

(function () {
  const { bridge, toast, el, tr, fmt } = window.launcherUtil;

  const FIX_ICONS = {
    increase_ram: 'memory-stick',
    disable_mod: 'puzzle',
    install_dependency: 'download',
    switch_version: 'arrow-up-down',
    none: 'file-text',
  };

  let banner = null;
  let overlay = null;

  function lang() {
    return document.documentElement.lang === 'de' ? 'de' : 'en';
  }

  function ruleText(localized, fallback) {
    if (localized && typeof localized === 'object') {
      const v = localized[lang()] || localized.en || localized.de;
      if (v) return String(v);
    }
    return fallback;
  }

  function iconNode(name, className) {
    const ico = document.createElement('i');
    ico.setAttribute('data-lucide', name);
    if (className) ico.className = className;
    ico.setAttribute('aria-hidden', 'true');
    return ico;
  }

  function dismissBanner() {
    if (banner && banner.isConnected) banner.remove();
    banner = null;
  }

  function closeModal() {
    if (overlay && overlay.isConnected) overlay.remove();
    overlay = null;
  }

  function showBanner(instanceId) {
    dismissBanner();
    const mount = document.querySelector('main.content');
    if (!mount) return;
    banner = el('div', 'crash-banner');
    banner.setAttribute('role', 'status');
    const iconWrap = el('span', 'crash-banner-icon');
    iconWrap.appendChild(iconNode('triangle-alert'));
    banner.appendChild(iconWrap);
    banner.appendChild(el('span', 'crash-banner-text', tr('crash.detected', 'Crash detected — diagnosis available.')));
    const actions = el('span', 'crash-banner-actions');
    const goBtn = el('button', 'btn btn-primary btn-sm', tr('crash.analyze', 'Analyze'));
    goBtn.type = 'button';
    goBtn.addEventListener('click', async () => {
      goBtn.disabled = true;
      const label = goBtn.textContent;
      goBtn.textContent = tr('crash.analyzing', 'Analyzing…');
      try {
        await openDiagnosis(instanceId);
        dismissBanner();
      } catch (err) {
        toast(fmt(tr('crash.analyzeFail', 'Analysis failed: {msg}'), { msg: err.message }), 'error');
        goBtn.disabled = false;
        goBtn.textContent = label;
      }
    });
    actions.appendChild(goBtn);
    const xBtn = el('button', 'icon-btn', '');
    xBtn.type = 'button';
    xBtn.setAttribute('aria-label', tr('crash.dismiss', 'Dismiss'));
    xBtn.appendChild(iconNode('x'));
    xBtn.addEventListener('click', dismissBanner);
    actions.appendChild(xBtn);
    banner.appendChild(actions);
    mount.prepend(banner);
    if (window.refreshIcons) window.refreshIcons();
  }

  function fixDetailLine(fixType, fixPayload) {
    if (fixType === 'increase_ram' && fixPayload && fixPayload.fromGb != null && fixPayload.toGb != null) {
      return fmt(tr('crash.ramDetail', 'RAM: {from} GB → {to} GB.'), {
        from: fixPayload.fromGb,
        to: fixPayload.toGb,
      });
    }
    if (fixType === 'disable_mod' && fixPayload && fixPayload.file) {
      return fmt(tr('crash.modDetail', 'Will be disabled: {file}.'), { file: fixPayload.file });
    }
    if (fixType === 'install_dependency' && fixPayload) {
      const mods = Array.isArray(fixPayload.mods) ? fixPayload.mods : fixPayload.modId ? [fixPayload] : [];
      const names = mods.map(m => m && m.modId).filter(Boolean);
      if (names.length) return fmt(tr('crash.depDetail', 'Will be installed: {mod}.'), { mod: names.join(', ') });
    }
    if (fixType === 'switch_version' && fixPayload && fixPayload.file) {
      return fmt(tr('crash.switchDetail', 'Opens the version picker for: {file}.'), { file: fixPayload.file });
    }
    return '';
  }

  function showModal(instanceId, res) {
    closeModal();
    const fixType = res && res.fixType ? res.fixType : 'none';
    const hasFix = fixType !== 'none' && res && res.matched;
    const title = ruleText(res && res.title, tr('crash.noRuleTitle', 'Unknown crash cause'));
    const body = ruleText(res && res.body, '');

    overlay = el('div', 'modal-backdrop');
    const modal = el('div', 'modal version-modal crash-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', title);
    overlay.appendChild(modal);

    const head = el('div', 'modal-head');
    const fb = el('span', 'modal-icon modal-icon-fallback', '');
    fb.appendChild(iconNode(FIX_ICONS[fixType] || 'wrench'));
    head.appendChild(fb);
    head.appendChild(el('h3', 'modal-title', title));
    const xBtn = el('button', 'icon-btn modal-close', '');
    xBtn.type = 'button';
    xBtn.setAttribute('aria-label', tr('crash.close', 'Close'));
    xBtn.appendChild(iconNode('x'));
    xBtn.addEventListener('click', closeModal);
    head.appendChild(xBtn);
    modal.appendChild(head);

    const content = el('div', 'modal-detail');
    if (body) content.appendChild(el('p', 'crash-diag', body));
    const detailLine = fixDetailLine(fixType, res && res.fixPayload);
    if (detailLine) content.appendChild(el('p', 'muted', detailLine));
    if (!hasFix) content.appendChild(el('p', 'muted', tr('crash.noFixHint', 'No automatic fix known — please check the log manually.')));

    const raw = res && res.rawExcerpt ? String(res.rawExcerpt) : '';
    if (raw) {
      const details = document.createElement('details');
      details.className = 'crash-raw-wrap';
      const summary = document.createElement('summary');
      summary.textContent = tr('crash.rawTitle', 'Log excerpt');
      details.appendChild(summary);
      const pre = el('div', 'crash-raw', raw);
      details.appendChild(pre);
      content.appendChild(details);
    }
    modal.appendChild(content);

    const foot = el('div', 'modal-foot');
    const statusLine = el('p', 'warn-line');
    statusLine.hidden = true;
    foot.appendChild(statusLine);
    if (hasFix) {
      const fixBtn = el('button', 'btn btn-play', tr('crash.applyFix', 'Apply fix'));
      fixBtn.type = 'button';
      fixBtn.addEventListener('click', async () => {
        fixBtn.disabled = true;
        try {
          if (fixType === 'switch_version') {
            await openSwitchFlow(instanceId, res.fixPayload);
            closeModal();
            return;
          }
          await bridge().applyCrashFix(instanceId, fixType, res.fixPayload);
          toast(tr('crash.success', 'Fix applied.'), 'ok');
          foot.textContent = '';
          const relaunchBtn = el('button', 'btn btn-play', tr('crash.relaunch', 'Launch again'));
          relaunchBtn.type = 'button';
          relaunchBtn.addEventListener('click', () => {
            closeModal();
            if (typeof window.startActiveGame === 'function') window.startActiveGame();
          });
          foot.appendChild(relaunchBtn);
          const doneBtn = el('button', 'btn btn-ghost', tr('crash.close', 'Close'));
          doneBtn.type = 'button';
          doneBtn.addEventListener('click', closeModal);
          foot.appendChild(doneBtn);
        } catch (err) {
          toast(fmt(tr('crash.failed', 'Fix failed: {msg}'), { msg: err.message }), 'error');
          fixBtn.disabled = false;
        }
      });
      foot.appendChild(fixBtn);
    }
    const ignoreBtn = el('button', 'btn btn-ghost', tr('crash.ignore', 'Ignore'));
    ignoreBtn.type = 'button';
    ignoreBtn.addEventListener('click', closeModal);
    foot.appendChild(ignoreBtn);
    modal.appendChild(foot);

    document.body.appendChild(overlay);
    if (window.refreshIcons) window.refreshIcons();
  }

  async function openSwitchFlow(instanceId, fixPayload) {
    const file = fixPayload && fixPayload.file ? String(fixPayload.file) : '';
    if (!file) throw new Error(tr('crash.switchNoFile', 'No mod file found for version switch.'));
    const listed = await bridge().listInstalledContent(instanceId);
    const mods = (listed && listed.mod) || [];
    const item = mods.find(i => String(i.file || '') === file) || null;
    if (!item || !item.projectId) throw new Error(tr('crash.switchNoProject', 'No switchable version for this file.'));
    const versions = await bridge().listContentVersions(item.projectId, instanceId, 'mod');
    const target = (versions || []).find(v => v.compatible !== false) || versions[0] || null;
    await window.instancesCtx.openDetail(instanceId);
    await window.openContentVersionModal(instanceId, item.file, 'mod', target ? target.id : null);
  }

  window.whenViewsReady(() => {
    try {
      bridge().onCrashDetected(payload => {
        if (payload && payload.instanceId) showBanner(payload.instanceId);
      });
    } catch {}
  });

  async function openDiagnosis(instanceId) {
    const res = await bridge().analyzeCrash(instanceId);
    showModal(instanceId, res);
    return res;
  }

  window.openCrashDiagnosis = openDiagnosis;
})();
