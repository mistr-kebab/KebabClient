# KebabClient (MVP)

Custom Minecraft client as an Electron desktop app. Location in this workspace:
`D:\Minecraft\Clients\mc-launcher`.

- Only Minecraft **26.1.2** is supported (hardcoded in `main/config.js`, no version picker).
- Microsoft login only. No offline/cracked login.
- Main process owns filesystem, game download/launch, OAuth, Modrinth, and Mojang skin/cape calls.
- Renderer is plain HTML/CSS/JS and only talks through `window.mc` (preload `contextBridge`).
- OLED theme: true black `#000000`, one accent color as CSS variables in `renderer/styles/theme.css`.

## Folder structure

```text
mc-launcher/
  main/
    index.js      # BrowserWindow, IPC handlers, auto-refresh
    config.js     # MC_VERSION=26.1.2, URLs, paths, client ID env
    store.js      # JSON state + safeStorage-encrypted secrets
    auth.js       # MS OAuth PKCE -> Xbox Live -> XSTS -> Minecraft Services
    minecraft.js  # piston-meta download/verify, launch, log streaming
    modrinth.js   # Modrinth search/install/list/uninstall for 26.1.2
    skins.js      # Mojang skin/cape fetch, PNG validation, upload, equip
    servers.js    # Name/IP server list, persisted + synced to the instance
    nbt.js        # Minimal big-endian NBT writer used for servers.dat
  preload/
    preload.js    # window.mc bridge only
  renderer/
    index.html
    assets/vendor/lucide.min.js  # vendored locally, no CDN at runtime
    styles/       # theme.css, base.css, layout.css, components.css, views.css
    scripts/      # api.js, icons.js, app.js, drawer.js, auth.js, instance.js, mods.js, skins.js, servers.js
```

No inline `<style>` / `<script>` tags, no inline event handlers, no `style=` attributes
in the renderer. Icons are Lucide (`data-lucide`), vendored locally under
`renderer/assets/vendor/` and initialized from `scripts/icons.js`. CSP is
`script-src 'self'; style-src 'self'`, no external origins needed at runtime.

## Prerequisites

- Node.js 20+ and npm.
- Java installed and on `PATH` (or `JAVA_HOME` set). The launcher spawns `java`.
- A Microsoft Entra app registration (Azure portal).

## Sign-in methods

- **Built-in sign-in (default, works immediately):** uses the official,
  Mojang-allowlisted public client ID. Nothing to configure — just press
  Sign in. Select it in the app under Playing as → Microsoft app.
- **Own App ID (optional):** register your own app (see below), then select
  Own App ID in the app and paste the ID — or provide it via `.env`
  (`MC_LAUNCHER_CLIENT_ID`), which is also bundled into the packaged .exe.
  Note: new App IDs return HTTP 403 from Minecraft Services until Mojang
  approves them (request via `https://aka.ms/mce-reviewappid`).

## Microsoft app registration (client ID, only for Own App ID)

1. Go to Azure portal -> Microsoft Entra ID -> App registrations -> New registration.
2. Name it e.g. `KebabClient`, account type: **personal Microsoft accounts only**
   (equivalently the `consumers` endpoint used by this app).
3. Redirect URI: **Public client / native (mobile & desktop)**, value:
   `https://login.microsoftonline.com/common/oauth2/nativeclient`.
4. No client secret is needed (public client + PKCE).
5. Copy the **Application (client) ID** and expose it as an env var:

```powershell
$env:MC_LAUNCHER_CLIENT_ID = "your-client-id-here"
```

`AZURE_CLIENT_ID` also works as a fallback. Without it, login shows an explicit error.

OAuth flow used: authorization code + PKCE in an Electron `BrowserWindow`
(`auth.js`), then `user.auth.xboxlive.com` -> `xsts.auth.xboxlive.com` ->
`api.minecraftservices.com/authentication/login_with_xbox` -> profile fetch.
Refresh token is stored encrypted with `safeStorage` (`store.js`), auto-refresh
runs once at startup.

## Run

```powershell
cd D:\Minecraft\Clients\mc-launcher
npm install
$env:MC_LAUNCHER_CLIENT_ID = "your-client-id-here"
npm start
```

Dev (same, with `--dev` flag passthrough):

```powershell
npm run dev
```

## Build (.exe)

Single portable executable, no installer (unsigned build):

```powershell
cd D:\Minecraft\Clients\mc-launcher
npm run dist
```

Output: `dist\KebabClient-0.1.0-portable.exe` (~70 MB, Electron bundled).
`MC_LAUNCHER_CLIENT_ID` is read at runtime from the environment, so the same
.exe works on any machine once the env var is set there.

Data locations:

- App state/secrets: `%APPDATA%\KebabClient\` (Windows).
- Shared libraries/assets: `%APPDATA%\KebabClient\libraries\`, `...\assets\`.
- Per instance (versions, mods, saves, servers.dat): `%APPDATA%\KebabClient\instances\<id>\`
  (the original 26.1.2 instance keeps its folder and is migrated automatically).

## Features (MVP scope)

1. **Play**: Download/verify 26.1.2 client via piston-meta, launch as child process,
   stream stdout/stderr to the log view (follow mode pauses when scrolled up).
2. **Mods**: Modrinth search filtered to 26.1.2, icon/name/description/downloads,
   install jars to `mods/`, best-effort required-dependency install, list/uninstall.
3. **Skins**: 2D layered canvas preview (front/back, classic/slim, cape overlay),
   PNG picker with 64x64 / 64x32 validation, upload via Mojang API, cape list + equip.
4. **Servers**: add servers by name + IP, reorder, edit, remove. The list is written
   as `servers.dat` (uncompressed NBT, `main/nbt.js`) into every instance folder
   automatically on every add/edit/remove, on app start, and again right before
   the game launches — no manual copying into the instance needed.
5. **Instances**: multiple instances, each with its own Minecraft version and
   loader (Vanilla, Fabric, Quilt — Forge/NeoForge show as coming soon).
   Libraries and assets are shared across instances; versions, mods and saves
   are per instance. Fabric/Quilt install the latest stable loader for the
   chosen version via their meta APIs (`main/loaders.js`). The Play view always
   launches the active instance; Mods search/install filter to its version and
   loader.

## Design

Layout follows the rail-nav + big hero-play-button pattern common to PvP
launchers like Feather/Lunar/Badlion: icon-only left rail, a large hero panel
for Play with a glowing gradient backdrop, and account/instance settings
tucked into a slide-in drawer (opened from the rail avatar or the top-right
account chip) instead of a permanently docked sidebar. Color scheme is
untouched OLED black with a single amber accent (`renderer/styles/theme.css`).

## Fixes in this pass

- `preload.js`: `equipCape()` never forwarded the `capeId` to the main
  process, so equipping a cape silently equipped nothing. Now passes it
  through.
- Lucide icons were loaded from `unpkg.com` at runtime. Vendored locally
  instead so the app works fully offline and the CSP no longer needs an
  external script origin.
