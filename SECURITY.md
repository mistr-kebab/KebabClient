# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

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
