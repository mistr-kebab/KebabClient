'use strict';

(function () {
  function tr(key, fallback) {
    try {
      if (window.i18n) {
        const v = window.i18n.t(key);
        if (v && v !== key) return v;
      }
    } catch {}
    return fallback || key;
  }

  function fmt(tpl, map) {
    return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (map && map[k] !== undefined ? map[k] : ''));
  }

  function formatDownloads(n) {
    const v = Number(n || 0);
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(v);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function lang() {
    try {
      const l = window.i18n && window.i18n.getLanguage && window.i18n.getLanguage();
      if (l === 'en') return 'en';
    } catch {}
    return 'de';
  }

  const HUMAN_ERRORS = [
    {
      re: /no compatible files found/i,
      de: 'Dafür gibt es keine passende Version für deine Instanz.',
      en: 'There is no matching version for your instance.',
    },
    {
      re: /selected version is not available for this instance/i,
      de: 'Diese Version passt nicht zu deiner Instanz.',
      en: "This version doesn't fit your instance.",
    },
    {
      re: /no downloadable file/i,
      de: 'Diese Version hat leider keine Datei zum Laden.',
      en: 'This version has no file to download, sorry.',
    },
    {
      re: /download was interrupted/i,
      de: 'Download abgebrochen – einfach nochmal versuchen.',
      en: 'Download got interrupted – just try again.',
    },
    {
      re: /could not reach modrinth/i,
      de: 'Modrinth antwortet nicht – Internet prüfen und gleich nochmal.',
      en: "Can't reach Modrinth – check your connection and retry.",
    },
    {
      re: /could not reach the download server/i,
      de: 'Der Download-Server antwortet nicht – gleich nochmal versuchen.',
      en: 'Download server is not answering – try again in a moment.',
    },
    {
      re: /rate limited|busy right now|server is busy/i,
      de: 'Modrinth ist gerade überlastet – kurz warten, dann nochmal.',
      en: 'Modrinth is overloaded right now – wait a moment, then retry.',
    },
    {
      re: /currently unavailable/i,
      de: 'Modrinth hat gerade Probleme – später nochmal versuchen.',
      en: 'Modrinth is having issues – try again later.',
    },
    {
      re: /could not reach mojang/i,
      de: 'Mojang antwortet nicht, Internet prüfen und gleich nochmal.',
      en: "Can't reach Mojang, check your connection and retry.",
    },
    {
      re: /checksum mismatch/i,
      de: 'Datei kam beschädigt an, nochmal versuchen.',
      en: 'File arrived corrupted, please try again.',
    },
  ];

  function cleanError(err) {
    let msg = '';
    if (err && typeof err.message === 'string' && err.message) msg = err.message;
    else if (typeof err === 'string') msg = err;
    else if (err != null) msg = String(err);
    const wrapped = msg.match(/Error invoking remote method '[^']+':\s*Error:\s*([\s\S]*)$/);
    if (wrapped) msg = wrapped[1];
    if (msg.startsWith('Error: ')) msg = msg.slice('Error: '.length);
    msg = msg.trim();
    const l = lang();
    for (const h of HUMAN_ERRORS) {
      if (h.re.test(msg)) return l === 'en' ? h.en : h.de;
    }
    const code = msg.match(/\((\d{3})\)/);
    if (/mojang api request failed/i.test(msg)) {
      if (code && code[1] === '429') {
        return l === 'en'
          ? 'Mojang is overloaded right now, wait a moment, then retry.'
          : 'Mojang ist gerade überlastet, kurz warten, dann nochmal.';
      }
      return l === 'en'
        ? `Mojang error${code ? ` ${code[1]}` : ''}, try again in a moment.`
        : `Mojang-Fehler${code ? ` ${code[1]}` : ''}, gleich nochmal versuchen.`;
    }
    if (/modrinth request failed/i.test(msg)) {
      return l === 'en'
        ? `Modrinth error${code ? ` ${code[1]}` : ''} – try again in a moment.`
        : `Modrinth-Fehler${code ? ` ${code[1]}` : ''} – gleich nochmal versuchen.`;
    }
    if (/^download failed/i.test(msg)) {
      return l === 'en' ? 'Download failed – just try again.' : 'Download gescheitert – einfach nochmal versuchen.';
    }
    msg = msg
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (msg.length > 140) msg = `${msg.slice(0, 137).trimEnd()}…`;
    return msg || (l === 'en' ? 'Something went wrong.' : 'Da ging was schief.');
  }

  function confirmDialog(opts) {
    const o = opts || {};
    return new Promise(resolve => {
      const overlay = el('div', 'modal-backdrop');
      const modal = el('div', 'modal version-modal confirm-modal');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', String(o.title || 'Confirm'));
      const head = el('div', 'modal-head');
      const iconBox = el('span', 'confirm-icon' + (o.danger === false ? '' : ' is-danger'));
      iconBox.setAttribute('aria-hidden', 'true');
      const ico = document.createElement('i');
      ico.setAttribute('data-lucide', o.danger === false ? 'info' : 'alert-triangle');
      iconBox.appendChild(ico);
      head.appendChild(iconBox);
      head.appendChild(el('h3', 'modal-title', String(o.title || '')));
      const xBtn = el('button', 'icon-btn modal-close', '');
      xBtn.type = 'button';
      xBtn.setAttribute('aria-label', tr('actions.close', 'Close'));
      const xIco = document.createElement('i');
      xIco.setAttribute('data-lucide', 'x');
      xBtn.appendChild(xIco);
      head.appendChild(xBtn);
      modal.appendChild(head);
      const body = el('div', 'confirm-body');
      body.appendChild(el('p', 'confirm-text', String(o.message || '')));
      modal.appendChild(body);
      const foot = el('div', 'modal-foot');
      const cancelBtn = el('button', 'btn btn-ghost', tr('inst.cancelBtn', 'Cancel'));
      cancelBtn.type = 'button';
      const goBtn = el('button', 'btn ' + (o.danger === false ? 'btn-play' : 'btn-danger'), String(o.confirmLabel || tr('actions.confirm', 'Confirm')));
      goBtn.type = 'button';
      foot.appendChild(cancelBtn);
      foot.appendChild(goBtn);
      modal.appendChild(foot);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      if (window.refreshIcons) window.refreshIcons();

      let settled = false;
      function done(v) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey);
        try {
          overlay.remove();
        } catch {}
        resolve(v);
      }
      function onKey(e) {
        if (e && e.key === 'Escape') done(false);
      }
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('mousedown', e => {
        if (e.target === overlay) done(false);
      });
      xBtn.addEventListener('click', () => done(false));
      cancelBtn.addEventListener('click', () => done(false));
      goBtn.addEventListener('click', () => done(true));
      try {
        goBtn.focus();
      } catch {}
    });
  }

  function paintSkeletons(container, kind, n) {
    if (!container) return;
    container.textContent = '';
    const count = Math.max(1, Math.min(12, Number(n) || 6));
    for (let i = 0; i < count; i++) {
      if (kind === 'tile') {
        const tile = el('div', 'skel-tile');
        tile.appendChild(el('div', 'skel skel-tile-banner'));
        const body = el('div', 'skel-tile-body');
        const l1 = el('div', 'skel skel-line');
        l1.style.width = '55%';
        const l2 = el('div', 'skel skel-line');
        l2.style.width = '80%';
        body.appendChild(l1);
        body.appendChild(l2);
        tile.appendChild(body);
        container.appendChild(tile);
      } else if (kind === 'row') {
        container.appendChild(el('div', 'skel skel-row'));
      } else {
        const card = el('div', 'skel-card');
        card.appendChild(el('div', 'skel skel-ic'));
        const lines = el('div', 'skel-lines');
        const l1 = el('div', 'skel skel-line');
        l1.style.width = '40%';
        const l2 = el('div', 'skel skel-line');
        l2.style.width = '90%';
        lines.appendChild(l1);
        lines.appendChild(l2);
        card.appendChild(lines);
        container.appendChild(card);
      }
    }
  }

  function promptDialog(opts) {
    const o = opts || {};
    return new Promise(resolve => {
      const overlay = el('div', 'modal-backdrop');
      const modal = el('div', 'modal version-modal confirm-modal');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', String(o.title || 'Input'));
      const head = el('div', 'modal-head');
      const iconBox = el('span', 'confirm-icon');
      iconBox.setAttribute('aria-hidden', 'true');
      const ico = document.createElement('i');
      ico.setAttribute('data-lucide', 'pencil');
      iconBox.appendChild(ico);
      head.appendChild(iconBox);
      head.appendChild(el('h3', 'modal-title', String(o.title || '')));
      const xBtn = el('button', 'icon-btn modal-close', '');
      xBtn.type = 'button';
      xBtn.setAttribute('aria-label', tr('actions.close', 'Close'));
      const xIco = document.createElement('i');
      xIco.setAttribute('data-lucide', 'x');
      xBtn.appendChild(xIco);
      head.appendChild(xBtn);
      modal.appendChild(head);
      const body = el('div', 'confirm-body');
      if (o.message) body.appendChild(el('p', 'confirm-text', String(o.message)));
      const fieldInput = document.createElement('input');
      fieldInput.className = 'input';
      fieldInput.type = 'text';
      fieldInput.value = o.initialValue != null ? String(o.initialValue) : '';
      if (o.placeholder) fieldInput.placeholder = String(o.placeholder);
      if (Number.isFinite(Number(o.maxLength))) fieldInput.maxLength = Number(o.maxLength);
      fieldInput.autocomplete = 'off';
      fieldInput.spellcheck = false;
      body.appendChild(fieldInput);
      modal.appendChild(body);
      const foot = el('div', 'modal-foot');
      const cancelBtn = el('button', 'btn btn-ghost', tr('inst.cancelBtn', 'Cancel'));
      cancelBtn.type = 'button';
      const goBtn = el('button', 'btn btn-play', String(o.confirmLabel || tr('actions.confirm', 'Confirm')));
      goBtn.type = 'button';
      foot.appendChild(cancelBtn);
      foot.appendChild(goBtn);
      modal.appendChild(foot);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      if (window.refreshIcons) window.refreshIcons();

      let settled = false;
      function done(v) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey);
        try {
          overlay.remove();
        } catch {}
        resolve(v);
      }
      function onKey(e) {
        if (!e) return;
        if (e.key === 'Escape') done(null);
        else if (e.key === 'Enter' && document.activeElement === fieldInput) done(fieldInput.value.trim());
      }
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('mousedown', e => {
        if (e.target === overlay) done(null);
      });
      xBtn.addEventListener('click', () => done(null));
      cancelBtn.addEventListener('click', () => done(null));
      goBtn.addEventListener('click', () => done(fieldInput.value.trim()));
      try {
        fieldInput.focus();
        fieldInput.select();
      } catch {}
    });
  }

  window.launcherUtil = window.launcherUtil || {};
  window.launcherUtil.tr = tr;
  window.launcherUtil.fmt = fmt;
  window.launcherUtil.formatDownloads = formatDownloads;
  window.launcherUtil.el = el;
  window.launcherUtil.cleanError = cleanError;
  window.launcherUtil.confirmDialog = confirmDialog;
  window.launcherUtil.promptDialog = promptDialog;
  window.launcherUtil.paintSkeletons = paintSkeletons;
})();
