# Vendor bundles

Bundled third-party libraries for the renderer. Kept local (no CDN at runtime).
Update by replacing the file and updating this list.

| File | Package | Version | Source |
| ---- | ------- | ------- | ------ |
| `lucide.min.js` | lucide (icons) | v1.46.0 (ISC, see file header) | https://unpkg.com/lucide@1.46.0/dist/umd/lucide.min.js |
| `skinview3d.bundle.js` | skinview3d (3D skin preview) | **unknown** — the minified bundle embeds no version string | https://cdn.jsdelivr.net/npm/skinview3d/dist/skinview3d.bundle.js |

Notes:

- `skinview3d.bundle.js` also bundles three.js internally (srgb/display-p3 color
  space support ⇒ three r152+). Vendored in the initial commit (2026-09-15).
  To pin a version: re-download from the URL above, keep the bundle name, and
  record the version here.
- Both files must be listed in `renderer/index.html` and are packaged via
  `build.files` (`renderer/**/*`).
