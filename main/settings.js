'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, dialog, shell } = require('electron');
const { loadState, saveState } = require('./store');

const ACCENT_KEYS = ['amber', 'crimson', 'azure', 'violet', 'emerald'];
const THEME_MODES = ['oled', 'dark', 'light', 'system'];
const LANGUAGES = ['de', 'en'];
const RAM_OPTIONS = [2, 4, 6, 8, 12, 16];
const THREAD_OPTIONS = [2, 4, 8, 16];

const DEFAULTS = {
  theme: { accent: 'amber' },
  java: { path: '', xmx: 4, extraArgs: '' },
  downloads: { threads: 8 },
  language: 'de',
  telemetry: true
};

function sanitizeLanguage(l) {
  const v = String(l || '').trim().toLowerCase();
  return LANGUAGES.includes(v) ? v : 'de';
}

function sanitizeTelemetry(v) {
  return v !== false;
}

function sanitizeTheme(t) {
  const key = ACCENT_KEYS.includes(t?.accent) ? t.accent : 'amber';
  const mode = THEME_MODES.includes(t?.mode) ? t.mode : 'oled';
  return { accent: key, mode };
}

function sanitizeJava(j) {
  const out = { path: '', xmx: 4, extraArgs: '' };
  const customPath = String(j?.path || '').trim();
  if (customPath) {
    if (!path.isAbsolute(customPath)) throw new Error('Java path must be absolute.');
    out.path = customPath;
  }
  const xmx = Number(j?.xmx);
  out.xmx = RAM_OPTIONS.includes(xmx) ? xmx : 4;
  const rawArgs = String(j?.extraArgs || '').trim().slice(0, 500);
  const kept = [];
  for (const token of rawArgs.split(/\s+/).filter(Boolean)) {
    if (token.includes('\0')) continue;
    if (/javaagent/i.test(token)) continue;
    if (/^(-agentlib|-agentpath|-Xbootclasspath|-Xrunjdwp)/i.test(token)) continue;
    kept.push(token);
  }
  out.extraArgs = kept.join(' ');
  return out;
}

function sanitizeDownloads(d) {
  const threads = Number(d?.threads);
  return { threads: THREAD_OPTIONS.includes(threads) ? threads : 8 };
}

function getSettings() {
  const state = loadState();
  const s = state.settings || {};
  let java;
  try {
    java = sanitizeJava(s.java || {});
  } catch {
    java = { ...DEFAULTS.java };
  }
  return {
    theme: sanitizeTheme(s.theme),
    java,
    downloads: sanitizeDownloads(s.downloads),
    language: sanitizeLanguage(s.language),
    telemetry: sanitizeTelemetry(s.telemetry)
  };
}

function updateSettings(patch) {
  const current = getSettings();
  const next = { ...current };
  if (patch.theme !== undefined) next.theme = sanitizeTheme(patch.theme);
  if (patch.java !== undefined) next.java = sanitizeJava({ ...current.java, ...patch.java });
  if (patch.downloads !== undefined) next.downloads = sanitizeDownloads(patch.downloads);
  if (patch.language !== undefined) next.language = sanitizeLanguage(patch.language);
  if (patch.telemetry !== undefined) next.telemetry = sanitizeTelemetry(patch.telemetry);
  saveState({ settings: next });
  return next;
}

function dotenvPath() {
  try {
    const exeDir = path.join(path.dirname(app.getPath('exe')), '.env');
    return exeDir;
  } catch {
    return null;
  }
}

function readDotEnvFile(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function writeDotEnvValue(file, key, value) {
  const lines = readDotEnvFile(file).split(/\r?\n/);
  let found = false;
  const out = [];
  for (const line of lines) {
    if (/^\s*#/.test(line) || !line.trim()) {
      out.push(line);
      continue;
    }
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && m[1] === key) {
      if (!found) out.push(`${key}=${value}`);
      found = true;
    } else {
      out.push(line);
    }
  }
  if (!found) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push(`${key}=${value}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out.join('\n'), 'utf8');
}

function getDataDirInfo() {
  const { dataDir, defaultDataDir, bootstrapFile } = require('./config');
  const fromEnv = (process.env.KEBAB_DATA_DIR || '').trim();
  const current = dataDir();
  let source = 'default';
  let custom = null;
  if (fromEnv) {
    source = 'env';
    custom = fromEnv;
  } else if (path.resolve(current) !== path.resolve(defaultDataDir())) {
    source = 'stored';
    custom = current;
  }
  return { current, custom, source, bootstrapFile: bootstrapFile() };
}

function writeBootstrap(dir) {
  const { bootstrapFile } = require('./config');
  const file = bootstrapFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, dir + '\n', 'utf8');
  return file;
}

function assertUsableDataDir(clean) {
  const resolved = path.resolve(clean);
  const root = path.parse(resolved).root;
  if (resolved === root) throw new Error('Directory must not be a drive root.');
  const lower = resolved.toLowerCase();
  const winDir = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
  if (lower === winDir || lower.startsWith(winDir + path.sep)) {
    throw new Error('System directory cannot be used as data directory.');
  }
  return resolved;
}

function setDataDir(dir) {
  const clean = String(dir || '').trim();
  if (!clean) throw new Error('Directory is required.');
  if (!path.isAbsolute(clean)) throw new Error('Directory must be an absolute path.');
  assertUsableDataDir(clean);
  try {
    fs.mkdirSync(clean, { recursive: true });
  } catch (err) {
    throw new Error(`Cannot use directory (not writable?): ${err.message}`);
  }
  const file = writeBootstrap(clean);
  return { ok: true, dir: clean, bootstrapFile: file, restartRequired: true };
}

function dirSize(dir) {
  let total = 0;
  let files = 0;
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        files += 1;
        try { total += fs.statSync(full).size; } catch {}
      }
    }
  };
  walk(dir);
  return { bytes: total, files };
}

function moveDataDir(dir, onStep) {
  const clean = String(dir || '').trim();
  if (!clean) throw new Error('Directory is required.');
  if (!path.isAbsolute(clean)) throw new Error('Directory must be an absolute path.');
  assertUsableDataDir(clean);
  if (require('./services/minecraft').isRunning()) {
    throw new Error('Stop the game before moving data.');
  }
  const { dataDir } = require('./config');
  const src = dataDir();
  const resolvedSrc = path.resolve(src);
  const resolvedDst = path.resolve(clean);
  if (resolvedSrc === resolvedDst) {
    throw new Error('Source and destination are the same directory.');
  }
  const relSrcToDst = path.relative(resolvedSrc, resolvedDst);
  const relDstToSrc = path.relative(resolvedDst, resolvedSrc);
  if ((relSrcToDst && !relSrcToDst.startsWith('..') && !path.isAbsolute(relSrcToDst)) ||
      (relDstToSrc && !relDstToSrc.startsWith('..') && !path.isAbsolute(relDstToSrc))) {
    throw new Error('Destination must not be inside the source directory (or vice versa).');
  }
  if (!fs.existsSync(src)) {
    fs.mkdirSync(clean, { recursive: true });
    const file = writeBootstrap(clean);
    return { ok: true, movedFiles: 0, movedBytes: 0, dir: clean, bootstrapFile: file, restartRequired: true };
  }
  const before = dirSize(src);
  onStep && onStep({ phase: 'move', label: `Copying ${before.files} files…` });
  fs.mkdirSync(clean, { recursive: true });
  fs.cpSync(src, clean, { recursive: true, force: true });
  const after = dirSize(clean);
  if (after.files < before.files) {
    throw new Error(`Copy incomplete (${after.files}/${before.files} files). Nothing was changed.`);
  }
  const file = writeBootstrap(clean);
  onStep && onStep({ phase: 'move', label: 'Cleaning up old location…' });
  try {
    fs.rmSync(src, { recursive: true, force: true });
  } catch (err) {
    throw new Error(`Copied to ${clean} and switched over, but the old folder could not be removed: ${err.message}`);
  }
  return { ok: true, movedFiles: after.files, movedBytes: after.bytes, dir: clean, restartRequired: true };
}

async function browseJava(parent) {
  const res = await dialog.showOpenDialog(parent, {
    title: 'Select Java executable',
    filters: process.platform === 'win32'
      ? [{ name: 'Java', extensions: ['exe'] }]
      : [{ name: 'Java', extensions: ['*'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  return { canceled: false, path: res.filePaths[0] };
}

async function openDataFolder() {
  const { dataDir } = require('./config');
  fs.mkdirSync(dataDir(), { recursive: true });
  await shell.openPath(dataDir());
  return { ok: true };
}

module.exports = {
  ACCENT_KEYS,
  LANGUAGES,
  RAM_OPTIONS,
  THREAD_OPTIONS,
  DEFAULTS,
  getSettings,
  updateSettings,
  getDataDirInfo,
  setDataDir,
  moveDataDir,
  browseJava,
  openDataFolder
};
