# KebabClient

Minimal Electron Minecraft launcher: Microsoft sign-in, multiple instances
(Vanilla / Fabric / Quilt), Modrinth mods, resource packs, shaders, skins,
capes, servers, Discord Rich Presence, and automatic updates.

## Features

- **Play** — downloads and verifies the game via piston-meta, launches it as
  a child process, streams logs into the log view.
- **Instances** — one folder per instance (own version + loader), shared
  libraries/assets. Fabric/Quilt install the latest stable loader via their
  meta APIs.
- **Content** — Modrinth search/install for mods, resource packs, and shaders,
  filtered to the active instance's version and loader.
- **Skins & capes** — 2D layered preview (front/back, classic/slim), PNG
  validation, upload via Mojang API, cape equip.
- **Servers** — list written as `servers.dat` into every instance
  automatically (on change, on start, before launch).
- **Extras** — Discord Rich Presence, daily anonymous install ping (packaged
  builds only, see `main/telemetry.js`), DE/EN interface, OLED black theme.

## Quick start

Prerequisites: Node.js 20+, npm, and Java on `PATH` (or `JAVA_HOME` set).

```powershell
npm install
npm start
```

Dev mode (extra logging, no updater/telemetry):

```powershell
npm run dev
```

## Sign-in

Sign-in uses our own approved Entra app, shipped with the launcher like
other launchers ship theirs. Works immediately — just press Sign in in the
account drawer. No configuration needed.

New App IDs return HTTP 403 from Minecraft Services until Mojang approves
them — request approval at `https://aka.ms/mce-reviewappid`.

## Configuration

Optional `.env` next to the source (dev) or next to the portable `.exe`.
Real environment variables always win. `.env` is git-ignored — never commit it.

| Variable                | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `DISCORD_CLIENT_ID`     | Own Discord application ID for Rich Presence         |
| `KEBAB_DATA_DIR`        | Custom data directory (absolute path)                |

## Build (.exe)

```powershell
npm run dist        # portable .exe
npm run dist:setup  # NSIS installer
```

Output lands in `dist/`. Updates are delivered via `electron-updater`
(generic provider, see `package.json` → `build.publish`).

Data locations:

- App state: `%APPDATA%\KebabClient\` (refresh token encrypted via
  `safeStorage`).
- Shared libraries/assets: `...\libraries\`, `...\assets\`.
- Per instance: `...\instances\<id>\` (versions, mods, saves, `servers.dat`).

## Project structure

```text
main/        # main process: window, IPC, auth, game, instances, Modrinth,
             # skins, servers, loaders, updater, discord, telemetry, store
preload/     # contextBridge only (window.mc)
renderer/    # plain HTML/CSS/JS UI (no framework, no CDN at runtime)
  assets/    # icons, banners, vendored vendor libs
  scripts/   # one module per view (home, play, instances, skins, ...)
  styles/    # theme.css, base.css, layout.css, components.css, views.css
```

Rules for the renderer: no inline `<script>`/`<style>`, no inline event
handlers, no `style=` attributes. CSP is `script-src 'self'`. Icons are
Lucide (`data-lucide`), vendored locally.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities. Short version:
no public issues for security bugs — use private vulnerability reporting.

## Development

KebabClient is built mainly with AI assistance (code, refactoring, releases),
with humans handling direction, review, testing, and releases.

## License

MIT © 2026 KebabDev — see [LICENSE](LICENSE).
