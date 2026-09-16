'use strict';

(function () {
  const STRINGS = {
    de: {
      'nav.home': 'Home',
      'nav.play': 'Spielen',
      'nav.instances': 'Instanzen',
      'nav.skins': 'Skins',
      'nav.servers': 'Server',
      'nav.logs': 'Logs',
      'nav.settings': 'Settings',
      'crumb.home': 'Home',
      'crumb.play': 'Spielen',
      'crumb.instances': 'Instanzen',
      'crumb.instance-detail': 'Instanz',
      'crumb.skins': 'Skins',
      'crumb.servers': 'Server',
      'crumb.logs': 'Logs',
      'crumb.settings': 'Settings',
      'topbar.running': 'Instanz läuft',
      'topbar.idle': 'Keine Instanz aktiv',
      'topbar.signin': 'Nicht angemeldet',
      'home.eyebrow': 'Übersicht',
      'home.title': 'Bereit zum Spielen?',
      'home.sub': 'Wähle eine Instanz und drück auf Spielen. Mods verwaltest du direkt in der Instanz.',
      'home.play': 'Spielen',
      'home.openFolder': 'Ordner öffnen',
      'home.newInstance': 'Neue Instanz',
      'home.gotoInstances': 'Zu den Instanzen',
      'home.cardInstance': 'Aktive Instanz',
      'home.cardAccount': 'Account',
      'home.cardSetup': 'Setup',
      'home.noInstance': 'Noch keine Instanz',
      'home.tip': 'Tipp: Fabric / Quilt gibt es pro Instanz über die Detailansicht, inkl. Modrinth-Suche.',
      'play.latest': 'Letzte Ausgabe',
      'play.openLog': 'Vollständiges Log öffnen',
      'play.openFolder': 'Ordner öffnen',
      'play.refresh': 'Session aktualisieren',
      'play.download': 'Client laden / prüfen',
      'play.stop': 'Spiel stoppen',
      'instances.title': 'Instanzen',
      'instances.sub': 'Jede Instanz hat eigene Version, Loader und Mods. Kachel anklicken zum Auswählen.',
      'instances.new': 'Neue Instanz',
      'skins.title': 'Skin & Cape',
      'servers.title': 'Server',
      'settings.title': 'Settings',
      'settings.language': 'Sprache',
      'update.available': 'Update verfügbar',
      'update.availableTitle': 'Neue Version laden',
      'update.downloadingTitle': 'Update wird geladen …',
      'update.restart': 'Neustart & installieren',
      'update.restartTitle': 'App neustarten und Update installieren',
      'update.readyMsg': 'Update geladen — Neustart zum Installieren.',
      'update.failed': 'Update fehlgeschlagen',
      'update.errNotConfigured': 'Keine Update-Quelle konfiguriert (Dev-Modus oder fehlende Update-Konfiguration).',
      'about.title': 'KebabClient',
      'about.installed': 'Installierte Version',
      'about.latest': 'Neueste Version',
      'about.users': 'Aktive Nutzer',
      'about.check': 'Nach Updates suchen',
      'about.checking': 'Suche läuft …',
      'about.uptodate': 'Du bist aktuell.',
      'about.failed': 'Versionsabfrage fehlgeschlagen',
      'toast.close': 'Schließen'
    },
    en: {
      'nav.home': 'Home',
      'nav.play': 'Play',
      'nav.instances': 'Instances',
      'nav.skins': 'Skins',
      'nav.servers': 'Servers',
      'nav.logs': 'Logs',
      'nav.settings': 'Settings',
      'crumb.home': 'Home',
      'crumb.play': 'Play',
      'crumb.instances': 'Instances',
      'crumb.instance-detail': 'Instance',
      'crumb.skins': 'Skins',
      'crumb.servers': 'Servers',
      'crumb.logs': 'Logs',
      'crumb.settings': 'Settings',
      'topbar.running': 'Instance running',
      'topbar.idle': 'No instances running',
      'topbar.signin': 'Not signed in',
      'home.eyebrow': 'Overview',
      'home.title': 'Ready to play?',
      'home.sub': 'Pick an instance and hit Play. Mods are managed inside each instance.',
      'home.play': 'Play',
      'home.openFolder': 'Open folder',
      'home.newInstance': 'New instance',
      'home.gotoInstances': 'Go to instances',
      'home.cardInstance': 'Active instance',
      'home.cardAccount': 'Account',
      'home.cardSetup': 'Setup',
      'home.noInstance': 'No instance yet',
      'home.tip': 'Tip: Fabric / Quilt per instance via the detail view, incl. Modrinth search.',
      'play.latest': 'Latest output',
      'play.openLog': 'Open full log',
      'play.openFolder': 'Open folder',
      'play.refresh': 'Refresh session',
      'play.download': 'Download / verify client',
      'play.stop': 'Stop game',
      'instances.title': 'Instances',
      'instances.sub': 'Each instance has its own Minecraft version, loader and mods. Click a tile to select it.',
      'instances.new': 'New instance',
      'skins.title': 'Skin & cape',
      'servers.title': 'Servers',
      'settings.title': 'Settings',
      'settings.language': 'Language',
      'update.available': 'Update available',
      'update.availableTitle': 'Download new version',
      'update.downloadingTitle': 'Downloading update …',
      'update.restart': 'Restart & install',
      'update.restartTitle': 'Restart app and install update',
      'update.readyMsg': 'Update downloaded — restart to install.',
      'update.failed': 'Update failed',
      'update.errNotConfigured': 'No update source configured (dev mode or missing update configuration).',
      'about.title': 'KebabClient',
      'about.installed': 'Installed version',
      'about.latest': 'Latest version',
      'about.users': 'Active users',
      'about.check': 'Check for updates',
      'about.checking': 'Checking …',
      'about.uptodate': 'You are up to date.',
      'about.failed': 'Version check failed',
      'toast.close': 'Dismiss'
    }
  };

  let lang = 'de';

  function detect() {
    try {
      const nav = String(navigator.language || '').toLowerCase();
      if (nav.startsWith('de')) return 'de';
    } catch {}
    return 'de';
  }

  function t(key) {
    const table = STRINGS[lang] || STRINGS.de;
    if (table[key] !== undefined) return table[key];
    if ((STRINGS.en || {})[key] !== undefined) return STRINGS.en[key];
    return key;
  }

  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      const key = node.getAttribute('data-i18n');
      if (key) node.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((node) => {
      const key = node.getAttribute('data-i18n-ph');
      if (key) node.setAttribute('placeholder', t(key));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((node) => {
      const key = node.getAttribute('data-i18n-aria');
      if (key) node.setAttribute('aria-label', t(key));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((node) => {
      const key = node.getAttribute('data-i18n-title');
      if (key) node.setAttribute('title', t(key));
    });
    document.dispatchEvent(new CustomEvent('i18n:applied', { detail: { lang } }));
  }

  function setLanguage(next, persist) {
    const v = next === 'en' ? 'en' : 'de';
    lang = v;
    apply();
    if (persist !== false) {
      try {
        const b = window.launcherUtil && window.launcherUtil.bridge ? window.launcherUtil.bridge() : null;
        if (b && b.updateSettings) b.updateSettings({ language: v }).catch(() => {});
      } catch {}
    }
    try { window.localStorage.setItem('kebabLang', v); } catch {}
    return v;
  }

  function getLanguage() {
    return lang;
  }

  function initLanguage(stored) {
    if (stored === 'en' || stored === 'de') lang = stored;
    else {
      try {
        const cached = window.localStorage.getItem('kebabLang');
        if (cached === 'en' || cached === 'de') lang = cached;
        else lang = detect();
      } catch { lang = detect(); }
    }
    apply();
    return lang;
  }

  window.i18n = { t, setLanguage, getLanguage, initLanguage, apply };
})();
