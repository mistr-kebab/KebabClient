# Changelog

All notable changes to KebabClient are documented here.

## [0.3.2] – 2026-09-22

- **Async IPC**: Replaced synchronous `ipcRenderer.sendSync` calls with asynchronous `ipcRenderer.invoke`/`ipcMain.handle` for view and locale loading. This removes main-thread blocking during startup and improves UI responsiveness.
- **Error handling**: Eliminated silent `catch {}` blocks across main process, preload, and renderer. Errors are now logged with context (console.warn with component prefix) so issues are visible during development and debugging. User-facing errors still surface via toast notifications where appropriate.

## [0.3.1] – 2026-09-21

- **English by default**: fresh installs start in English (app, Discord
  Rich Presence, installer default). German remains fully available via
  Settings → Sprache. Note: an already-saved language preference always
  wins over the default – switch it in Settings if needed.

## [0.3.0] – 2026-09-21

Major internal restructuring release. No user-facing breaking changes; the
launcher behaves the same, but the codebase is now clean, scalable, and
maintainable.

### Architektur

- **Main-Process aufgeteilt**: IPC-Handler ausgelagert nach `main/ipc/`;
  Domain-Logik (Auth, Minecraft, Instanzen, Content, Skins, Server, Loader,
  Discord) liegt neu unter `main/services/`. Reine Infrastruktur
  (Config, Store, Settings, Telemetry, Updater, Ping, NBT) bleibt in `main/`.
- **minecraft.js entzerrt**: 945-Zeilen-Monolith aufgeteilt in
  `services/minecraft/` mit `paths.js` (Pfade/Layout),
  `download.js` (Verify & Downloads), `java.js` (Java-Runtime-Management)
  und `launch.js` (Spielstart).
- **Renderer aufgebrochen**: `index.html` (711 Zeilen) in 10 View-Fragmente
  unter `renderer/views/` aufgeteilt, die zur Laufzeit geladen werden.
- **instances.js gesplittet**: 1452-Zeilen-Datei in
  `renderer/scripts/instances/` mit
  `shared`/`list`/`create`/`detail`/`content` plus schlankem Orchestrator.
- **api.js getrennt**: Bridge-Zugriff (`bridge.js`), Toast-UI (`toast.js`)
  und DOM/Format-Utilities (`util.js`).
- **i18n zentralisiert**: Übersetzungs-Helper (`tr`/`fmt`) in `util.js`
  konsolidiert (11 Duplikate entfernt); Strings nach
  `renderer/locales/de.json` und `en.json` ausgelagert (je 383 Keys).
  Gemischte de/en-Werte in der deutschen Sektion konsequent übersetzt
  (z. B. Home→Start, Settings→Einstellungen, Logs→Protokolle).
- **URLs konsolidiert**: Alle API-Endpunkte zentral in `config.js`
  (13 neue `URLS`-Einträge). Loader-, Adoptium-, Modrinth- und
  Mojang-URLs waren zuvor über 6 Dateien verteilt.
- **IPC-Namen vereinheitlicht**: `mods:*`-Channels heißen jetzt
  `content:*` (passt zu ResourcePacks/Shaders und der UI
  „Inhalte hinzufügen"); Preload-API entsprechend umbenannt.
- **Entra-Client-ID**: Doppelte Konfiguration aufgelöst – `OWN_CLIENT_ID`
  in `config.js` ist die einzige Quelle; tote Env-Overrides und
  veraltete Exporte entfernt.

### Datenschutz & Security

- **Telemetry Opt-out**: Settings → Datenschutz → *Anonyme
  Nutzungsstatistik senden*. Wirkt sofort, ohne Neustart. Sammelt nur
  App-Version + zufällige Install-ID (keine personenbezogenen Daten);
  in `SECURITY.md` dokumentiert.
- **CSP verschärft**: `connect-src 'none'` – der Renderer führt keinerlei
  Netzwerk-Requests mehr aus (alle Calls laufen über IPC im
  Main-Process). CSP-Regeln in `SECURITY.md` dokumentiert.
- **Fehlerhafter `.env`-Kommentar korrigiert** (behauptete fälschlich,
  die Datei werde ins Paket gebundelt).

### Developer Experience

- **ESLint + Prettier + EditorConfig** eingeführt und auf die gesamte
  Codebase angewendet (`npm run lint`, `npm run format`).
- **Test-Suite**: `npm test` mit 24 Tests für `store.js` und `config.js`
  (Electron-Mock für `safeStorage`).
- **Vendor-Doku**: `renderer/assets/vendor/README.md` mit Versionen und
  Quellen (lucide v1.46.0; skinview3d als „unknown" markiert, da das
  Bundle keine Versionsnummer enthält).
- **Assets bereinigt**: Banner einheitlich nach `banner-01…10.webp`
  benannt (zuvor gemischte Formate/Lücken); verwaistes `404.jpg`
  entfernt. Lokale `dist/`-Altlasten (3,8 GB) aufgeräumt.

## [0.2.x] – früher

Siehe Git-Historie für Details zu den 0.2.x-Releases.
