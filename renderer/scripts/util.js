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
      re: /checksum mismatch/i,
      de: 'Datei kam beschädigt an – nochmal versuchen.',
      en: 'File arrived corrupted – please try again.',
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

  window.launcherUtil = window.launcherUtil || {};
  window.launcherUtil.tr = tr;
  window.launcherUtil.fmt = fmt;
  window.launcherUtil.formatDownloads = formatDownloads;
  window.launcherUtil.el = el;
  window.launcherUtil.cleanError = cleanError;
})();
