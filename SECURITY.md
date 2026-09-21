# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |

## Reporting a Vulnerability

Please do **not** open a public issue for security vulnerabilities.

- Preferred: use **private vulnerability reporting** on GitHub
  (Security tab of this repository).
- Alternative: mail to `kitzelig_kebab@proton.me`.

Include a description, affected version, and steps to reproduce if possible.
We will confirm receipt and keep you updated on the fix.

## Handling of Secrets

- Never commit `.env` files, tokens, or client secrets. `.env` is git-ignored.
- Optional local values (e.g. `DISCORD_CLIENT_ID`) stay in your untracked
  `.env` only.
- OAuth refresh tokens are stored encrypted via Electron `safeStorage`.

## Content Security Policy

The renderer ships a strict CSP via `<meta>` in `renderer/index.html`:

- `script-src 'self'` / `style-src 'self'` — only packaged files, no inline
  code, no CDN at runtime.
- `img-src 'self' data: https:` — external images are limited to what the
  views genuinely display (Modrinth thumbnails, Minecraft skin/cape
  textures, avatar services).
- `connect-src 'none'` — the renderer performs **no** network requests at
  all. Every network call (auth, Modrinth, downloads, telemetry, update
  checks) runs in the main process and is reached via the preload bridge
  (`window.mc`). If you add a `fetch()` to renderer code, it will fail by
  design — move the call to `main/` and expose it via IPC instead.
- `frame-ancestors` is deliberately not set: it is ignored when delivered
  via `<meta>` and the app is not served over HTTP. Framing is instead
  prevented by `setWindowOpenHandler` (deny) and the `will-navigate` guard
  in `main/index.js`.

## Telemetry

- The packaged app sends a minimal, anonymous usage ping to
  `https://kebabdev.de/api/ping` roughly once a day (plus once shortly
  after start).
- Payload: app version and a random install ID (`randomUUID`, generated
  locally on first ping). No personal data, no profile data, no Minecraft
  account names, no file paths.
- Dev builds (`electron .` unpackaged) never send anything.
- **Opt-out:** Settings → Privacy → *Send anonymous usage statistics*.
  Takes effect immediately (the next scheduled ping is skipped), no
  restart required.
