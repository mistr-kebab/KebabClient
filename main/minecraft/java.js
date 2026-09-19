'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { dataDir, temurinDownloadUrl } = require('../config');
const { emit } = require('./events');
const { downloadFileResilient } = require('./download');

function javaSettings() {
  try {
    const { loadState } = require('../store');
    const s = loadState().settings?.java || {};
    let customPath = String(s.path || '').trim();
    if (customPath && (!path.isAbsolute(customPath) || !fs.existsSync(customPath))) {
      customPath = '';
    }
    const rawArgs = String(s.extraArgs || '').trim().slice(0, 500);
    const kept = [];
    for (const token of rawArgs.split(/\s+/).filter(Boolean)) {
      if (token.includes('\0')) continue;
      if (/javaagent/i.test(token)) continue;
      if (/^(-agentlib|-agentpath|-Xbootclasspath|-Xrunjdwp)/i.test(token)) continue;
      kept.push(token);
    }
    return {
      path: customPath,
      xmx: [2, 4, 6, 8, 12, 16].includes(Number(s.xmx)) ? Number(s.xmx) : 4,
      extraArgs: kept.join(' ')
    };
  } catch {
    return { path: '', xmx: 4, extraArgs: '' };
  }
}

function checkJavaRunnable(java) {
  return new Promise((resolve, reject) => {
    let proc = null;
    try {
      proc = require('node:child_process').execFile(java, ['-version'], (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    } catch (err) {
      reject(err);
      return;
    }
    if (proc && typeof proc.on === 'function') {
      proc.on('error', (err) => reject(err));
    }
  });
}

async function assertJavaAvailable(java) {
  try {
    await checkJavaRunnable(java);
    return;
  } catch (err) {
    if (err && (err.code === 'ENOENT' || /ENOENT/i.test(String(err.message || '')))) {
      const e = new Error(
        `Java was not found ("${java}"). Install Java (e.g. Eclipse Temurin from https://adoptium.net) ` +
        'or pick your Java executable in Settings → Java.'
      );
      e.code = 'JAVA_NOT_FOUND';
      throw e;
    }
    throw err;
  }
}

function bundledJavaDir() {
  return path.join(dataDir(), 'java');
}

function normalizeJavaMajor(v, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 8 && n <= 99 ? n : fallback;
}

function requiredJavaMajor(versionJson) {
  return normalizeJavaMajor(versionJson?.javaVersion?.majorVersion, 21);
}

function getJavaMajor(java) {
  return new Promise((resolve) => {
    try {
      require('node:child_process').execFile(java, ['-version'], (err, stdout, stderr) => {
        const text = `${stdout || ''}\n${stderr || ''}`;
        const m = text.match(/version "(\d+)(?:\.(\d+))?/);
        if (!m) return resolve(null);
        if (m[1] === '1' && m[2] !== undefined) return resolve(Number(m[2]));
        resolve(Number(m[1]));
      }).on('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

async function checkJavaForMajor(java, minMajor) {
  await assertJavaAvailable(java);
  if (!minMajor) return null;
  const major = await getJavaMajor(java);
  if (major !== null && major < minMajor) {
    const e = new Error(`Java ${major} is too old ("${java}"). This version needs Java ${minMajor}+.`);
    e.code = 'JAVA_TOO_OLD';
    e.javaMajor = major;
    throw e;
  }
  return major;
}

function listBundledJavas() {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  let entries = [];
  try {
    entries = fs.readdirSync(bundledJavaDir(), { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const cand = path.join(bundledJavaDir(), e.name, 'bin', exe);
    if (!fs.existsSync(cand)) continue;
    const fm = e.name.match(/jdk-(\d+)/i);
    out.push({ dir: e.name, path: cand, folderMajor: fm ? Number(fm[1]) : null });
  }
  out.sort((a, b) => (b.folderMajor || 0) - (a.folderMajor || 0));
  return out;
}

async function findBundledJava(requiredMajor) {
  for (const c of listBundledJavas()) {
    if (c.folderMajor !== null && c.folderMajor < requiredMajor) continue;
    try {
      await assertJavaAvailable(c.path);
    } catch {
      continue;
    }
    if (c.folderMajor !== null) return c.path;
    const major = await getJavaMajor(c.path);
    if (major === null || major >= requiredMajor) return c.path;
  }
  return null;
}

function isBundledJavaPath(p) {
  try {
    const rel = path.relative(bundledJavaDir(), path.resolve(p));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

async function downloadBundledJava(major, onProgress) {
  if (process.platform !== 'win32') {
    throw new Error('Automatic Java install is only supported on Windows. Install Eclipse Temurin manually (https://adoptium.net) or pick java.exe in Settings → Java.');
  }
  let AdmZip;
  try {
    AdmZip = require('adm-zip');
  } catch {
    throw new Error('Missing dependency adm-zip. Run npm install.');
  }
  const target = bundledJavaDir();
  fs.mkdirSync(target, { recursive: true });
  const tmpZip = path.join(target, `.temurin-${major}-jre.zip`);
  await downloadFileResilient(temurinDownloadUrl(major), tmpZip, null, 0, onProgress);
  try {
    new AdmZip(tmpZip).extractAllTo(target, true);
  } finally {
    try { fs.unlinkSync(tmpZip); } catch {}
  }
  const found = await findBundledJava(major);
  if (!found) throw new Error('Java download finished but no runtime was found inside.');
  await assertJavaAvailable(found);
  return found;
}

function persistJavaPath(javaPath) {
  try {
    require('../settings').updateSettings({ java: { path: javaPath } });
  } catch {}
}

let javaSetupInflight = {};

async function ensureJavaRuntime(requiredMajorOrOnProgress, maybeOnProgress) {
  let requiredMajor = 21;
  let onProgress;
  if (typeof requiredMajorOrOnProgress === 'function') {
    onProgress = requiredMajorOrOnProgress;
  } else {
    requiredMajor = normalizeJavaMajor(requiredMajorOrOnProgress, 21);
    onProgress = maybeOnProgress;
  }
  const opts = javaSettings();
  if (opts.path) {
    if (!isBundledJavaPath(opts.path)) {
      try {
        await checkJavaForMajor(opts.path, requiredMajor);
      } catch (err) {
        if (err && err.code === 'JAVA_TOO_OLD') {
          throw new Error(
            `Configured Java is version ${err.javaMajor}, but this Minecraft version needs Java ${requiredMajor}+. ` +
            'Pick a newer executable in Settings → Java or clear the field for automatic setup.'
          );
        }
        throw err;
      }
      return opts.path;
    }
    try {
      await checkJavaForMajor(opts.path, requiredMajor);
      return opts.path;
    } catch (err) {
      if (!err || (err.code !== 'JAVA_TOO_OLD' && err.code !== 'JAVA_NOT_FOUND')) throw err;
      emit('game:log', { stream: 'system', line: `Stored Java is outdated (${err.code === 'JAVA_TOO_OLD' ? `Java ${err.javaMajor}` : 'missing'}). Setting up Java ${requiredMajor}…` });
    }
  }
  const exeName = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [];
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', exeName));
  }
  candidates.push(exeName);
  for (const cand of candidates) {
    try {
      await checkJavaForMajor(cand, requiredMajor);
      return cand;
    } catch (err) {
      if (!err || (err.code !== 'JAVA_NOT_FOUND' && err.code !== 'JAVA_TOO_OLD')) throw err;
    }
  }
  const bundled = await findBundledJava(requiredMajor);
  if (bundled) {
    persistJavaPath(bundled);
    return bundled;
  }
  emit('game:log', { stream: 'system', line: `Java ${requiredMajor} not found. Downloading Eclipse Temurin ${requiredMajor} JRE…` });
  if (!javaSetupInflight[requiredMajor]) {
    javaSetupInflight[requiredMajor] = downloadBundledJava(requiredMajor, (r) => {
      try { onProgress && onProgress(r, `Downloading Java ${requiredMajor} runtime ${Math.round((r || 0) * 100)}%`); } catch {}
    }).finally(() => { javaSetupInflight[requiredMajor] = null; });
  }
  let fresh;
  try {
    fresh = await javaSetupInflight[requiredMajor];
  } catch (err) {
    throw new Error(`Java download failed (${err?.message || err}). Install Eclipse Temurin manually (https://adoptium.net) or pick java.exe in Settings → Java.`);
  }
  persistJavaPath(fresh);
  return fresh;
}

module.exports = {
  javaSettings,
  assertJavaAvailable,
  requiredJavaMajor,
  getJavaMajor,
  ensureJavaRuntime
};
