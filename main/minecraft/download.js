'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URLS } = require('../config');
const { getInstance, getActiveInstance, setLoaderVersion, describeInstance } = require('../instances');
const loaders = require('../loaders');
const { emit } = require('./events');
const { dirsFor, markerFile } = require('./paths');

let tmpCounter = 0;

function makeTally() {
  const tally = (res) => {
    if (res?.skipped) tally.cached += 1;
    else tally.downloaded += 1;
  };
  tally.cached = 0;
  tally.downloaded = 0;
  return tally;
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}-${(tmpCounter = (tmpCounter + 1) % 100000)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, file);
}

async function fetchJson(url) {
  return retryAsync(async () => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`);
    return res.json();
  }, `fetch ${url}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(err) {
  return /\(429\)|\(5\d\d\)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EBUSY|EPERM|ENOENT|Checksum mismatch|fetch failed|terminated|aborted|socket hang up/i.test(
    String(err?.message || err)
  );
}

async function retryAsync(fn, label, maxAttempts = 6) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (!isRetryable(err) || attempt >= maxAttempts) {
        throw new Error(`${label} failed after ${attempt} attempt(s): ${err.message}`);
      }
      const wait = Math.min(15000, 500 * 2 ** attempt) + Math.random() * 500;
      emit('game:log', { stream: 'system', line: `Retrying ${label} (attempt ${attempt + 1}) after ${Math.round(wait)}ms: ${err.message}` });
      await sleep(wait);
    }
  }
}

async function downloadFileResilient(url, dest, sha1, size, onProgress) {
  return retryAsync(() => downloadFile(url, dest, sha1, size, onProgress), `download ${url.split('/').pop()}`);
}

async function mapPool(items, concurrency, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(file);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

async function downloadFile(url, dest, expectedSha1, expectedSize, onProgress) {
  if (fs.existsSync(dest)) {
    let sizeOk = true;
    if (expectedSize) {
      try { sizeOk = fs.statSync(dest).size === expectedSize; }
      catch { sizeOk = false; }
    }
    if (sizeOk && expectedSha1) {
      try {
        const actual = await sha1File(dest);
        if (actual.toLowerCase() === String(expectedSha1).toLowerCase()) return { skipped: true };
      } catch {}
    } else if (sizeOk && !expectedSha1) {
      return { skipped: true };
    }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length') || expectedSize || 0);
  const tmp = `${dest}.tmp-${process.pid}-${Date.now().toString(36)}-${(tmpCounter = (tmpCounter + 1) % 100000)}`;
  const out = fs.createWriteStream(tmp);
  let done = 0;
  try {
    for await (const chunk of res.body) {
      out.write(chunk);
      done += chunk.length;
      if (onProgress && total) onProgress(done / total);
    }
  } catch (e) {
    try { out.close(); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
  await new Promise((resolve, reject) => {
    out.end((err) => (err ? reject(err) : resolve()));
  });
  if (expectedSha1) {
    const actual = await sha1File(tmp);
    if (actual.toLowerCase() !== String(expectedSha1).toLowerCase()) {
      fs.unlinkSync(tmp);
      throw new Error(`Checksum mismatch for ${path.basename(dest)}`);
    }
  }
  fs.renameSync(tmp, dest);
  return { skipped: false };
}

function rulesAllow(rules, features) {
  if (!rules || rules.length === 0) return true;
  const feat = features || {};
  let allowed = false;
  for (const r of rules) {
    const osName = r?.os?.name;
    const osMatches = !osName ||
      (osName === 'windows' && process.platform === 'win32') ||
      (osName === 'osx' && process.platform === 'darwin') ||
      (osName === 'linux' && process.platform === 'linux');
    if (!osMatches) continue;
    const required = r?.features || {};
    let featMatches = true;
    for (const [name, want] of Object.entries(required)) {
      if (!!feat[name] !== !!want) { featMatches = false; break; }
    }
    if (!featMatches) continue;
    if (r.action === 'allow') allowed = true;
    else if (r.action === 'disallow') allowed = false;
  }
  return allowed;
}

function libraryArtifactPath(lib, librariesDir) {
  const art = lib?.downloads?.artifact;
  if (!art || !art.path) return null;
  return path.join(librariesDir, art.path.replace(/\//g, path.sep));
}

function safeNativesTarget(nativesDir, entryName) {
  const name = String(entryName || '').replace(/\\/g, '/');
  if (!name || name.startsWith('/')) return null;
  const norm = path.posix.normalize(name);
  if (norm === '.' || norm.startsWith('..') || path.posix.isAbsolute(norm)) return null;
  if (/^[a-zA-Z]:(\/|$)/.test(norm)) return null;
  const target = path.join(nativesDir, norm);
  if (target !== nativesDir && !target.startsWith(nativesDir + path.sep)) return null;
  return target;
}

function extractNatives(versionJson, librariesDir, nativesDir) {
  let AdmZip;
  try { AdmZip = require('adm-zip'); }
  catch { throw new Error('Missing dependency adm-zip. Run npm install.'); }
  const key = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  for (const lib of versionJson.libraries || []) {
    if (!rulesAllow(lib.rules)) continue;
    const classifier = lib?.natives?.[key];
    const entry = classifier && lib?.downloads?.classifiers?.[classifier];
    if (!entry?.path) continue;
    const jar = path.join(librariesDir, entry.path.replace(/\//g, path.sep));
    if (!fs.existsSync(jar)) continue;
    try {
      const zip = new AdmZip(jar);
      for (const zipEntry of zip.getEntries()) {
        if (zipEntry.isDirectory || zipEntry.entryName.startsWith('META-INF')) continue;
        const target = safeNativesTarget(nativesDir, zipEntry.entryName);
        if (!target) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, zipEntry.getData());
      }
    } catch (err) {
      emit('game:log', { stream: 'system', line: `Natives extract skipped for ${path.basename(jar)}: ${err.message}` });
    }
  }
}

async function ensureVanilla(mc, layout, manifest, progress, tally) {
  const entry = (manifest.versions || []).find((v) => v.id === mc);
  if (!entry) throw new Error(`Minecraft version ${mc} not found in piston-meta manifest.`);
  progress('version-json', 0, `Fetching version details for ${mc}`);
  const versionJson = await fetchJson(entry.url);
  const versionDir = path.join(layout.versionsBase, mc);
  fs.mkdirSync(versionDir, { recursive: true });
  const versionFile = path.join(versionDir, `${mc}.json`);
  writeJsonAtomic(versionFile, versionJson);
  progress('version-json', 1, 'Version details saved');

  const client = versionJson.downloads?.client;
  if (!client?.url) throw new Error('Version JSON has no client download.');
  progress('client', 0, 'Checking client jar');
  tally(await downloadFileResilient(client.url, path.join(versionDir, `${mc}.jar`), client.sha1, client.size, (r) =>
    progress('client', r, `Downloading client jar ${Math.round(r * 100)}%`)
  ));
  progress('client', 1, 'Client jar checked');

  await ensureLibraries(versionJson, layout.libraries, progress, tally);
  await ensureAssets(versionJson, layout.assets, progress, tally);
  return { versionJson, versionFile };
}

async function ensureLibraries(versionJson, libraries, progress, tally) {
  const libs = versionJson.libraries || [];
  let doneLibs = 0;
  for (const lib of libs) {
    if (!rulesAllow(lib.rules)) { doneLibs += 1; continue; }
    const dest = libraryArtifactPath(lib, libraries);
    const art = lib?.downloads?.artifact;
    if (dest && art?.url) {
      tally(await downloadFileResilient(art.url, dest, art.sha1, art.size));
    }
    const nativesKey = lib?.natives?.[process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'];
    if (nativesKey && lib?.downloads?.classifiers?.[nativesKey]) {
      const nat = lib.downloads.classifiers[nativesKey];
      const natDest = path.join(libraries, nat.path.replace(/\//g, path.sep));
      tally(await downloadFileResilient(nat.url, natDest, nat.sha1, nat.size));
    }
    doneLibs += 1;
    if (doneLibs % 5 === 0 || doneLibs === libs.length) {
      progress('libraries', doneLibs / libs.length, `Checking libraries ${doneLibs}/${libs.length} (${tally.downloaded} downloaded)`);
    }
  }
  progress('libraries', 1, `Libraries verified (${tally.downloaded} downloaded so far)`);
}

async function ensureAssets(versionJson, assets, progress, tally) {
  progress('assets', 0, 'Syncing assets');
  const assetIndex = versionJson.assetIndex;
  if (!assetIndex?.url) {
    progress('assets', 1, 'No asset index');
    return;
  }
  const indexesDir = path.join(assets, 'indexes');
  fs.mkdirSync(indexesDir, { recursive: true });
  const indexDest = path.join(indexesDir, `${assetIndex.id}.json`);
  tally(await downloadFileResilient(assetIndex.url, indexDest, assetIndex.sha1, assetIndex.size));
  const index = JSON.parse(fs.readFileSync(indexDest, 'utf8'));
  const entries = Object.entries(index.objects || {});
  let done = 0;
  await mapPool(entries, downloadThreads(), async ([, obj]) => {
    const hash = obj.hash;
    const sub = path.join('objects', hash.slice(0, 2), hash);
    tally(await downloadFileResilient(
      `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`,
      path.join(assets, sub),
      hash,
      obj.size
    ));
    done += 1;
    if (done % 100 === 0 || done === entries.length) {
      progress('assets', done / entries.length, `Checking assets ${done}/${entries.length} (${tally.downloaded} downloaded)`);
    }
  });
  progress('assets', 1, `Assets verified (${tally.downloaded} downloaded so far)`);
}

async function ensureLoaderFiles(instance, layout, vanillaJson, progress, tally) {
  const loader = instance.loader;
  const label = loaders.LOADERS[loader].label;
  let loaderVersion = instance.loaderVersion;
  if (!loaderVersion) {
    progress('loader', 0, `Resolving ${label} version for ${instance.mc}`);
    loaderVersion = await loaders.resolveLatestLoader(instance.mc, loader);
  }
  progress('loader', 0.2, `Fetching ${label} ${loaderVersion} profile`);
  const profile = await loaders.fetchProfile(instance.mc, loader, loaderVersion);
  const variantId = profile.id || `${loader}-loader-${loaderVersion}-${instance.mc}`;
  if (variantId !== instance.variantId || loaderVersion !== instance.loaderVersion) {
    setLoaderVersion(instance.id, loaderVersion, variantId);
    instance = getInstance(instance.id);
  }
  const mavenBase = loaders.LOADERS[loader].maven;
  const normalizedProfileLibs = [];
  for (const rawLib of profile.libraries || []) {
    if (!rulesAllow(rawLib.rules)) continue;
    normalizedProfileLibs.push(loaders.normalizeProfileLibrary(rawLib, mavenBase));
  }
  const merged = loaders.mergeProfile(vanillaJson, { ...profile, libraries: normalizedProfileLibs }, instance.mc);
  const variantDir = path.join(layout.versionsBase, variantId);
  fs.mkdirSync(variantDir, { recursive: true });
  const versionFile = path.join(variantDir, `${variantId}.json`);
  writeJsonAtomic(versionFile, merged);

  progress('loader', 0.5, `Downloading ${label} libraries`);
  for (const lib of normalizedProfileLibs) {
    const dest = libraryArtifactPath(lib, layout.libraries);
    const art = lib.downloads.artifact;
    if (dest && art?.url) {
      tally(await downloadFileResilient(art.url, dest, art.sha1, art.size));
    }
  }
  progress('loader', 1, `${label} libraries ready`);
  const variantNatives = path.join(variantDir, `${variantId}-natives`);
  fs.mkdirSync(variantNatives, { recursive: true });
  extractNatives(merged, layout.libraries, variantNatives);
  return { versionJson: merged, versionFile, variantId, nativesDir: variantNatives };
}

function downloadThreads() {
  try {
    const { loadState } = require('../store');
    const t = Number(loadState().settings?.downloads?.threads);
    return [2, 4, 8, 16].includes(t) ? t : 8;
  } catch {
    return 8;
  }
}

const ensuring = new Set();

function isEnsuring(id) {
  return ensuring.has(id);
}

async function ensureClient(instanceOrId, onProgress) {
  if (typeof instanceOrId === 'function') {
    onProgress = instanceOrId;
    instanceOrId = undefined;
  }
  const instance = typeof instanceOrId === 'string'
    ? getInstance(instanceOrId)
    : (instanceOrId || getActiveInstance());
  if (!instance) throw new Error('No instance selected. Create one first.');
  if (ensuring.has(instance.id)) {
    throw new Error(`Verify is already running for "${instance.name}".`);
  }
  ensuring.add(instance.id);
  try {
    return await ensureClientInner(instance, onProgress);
  } finally {
    ensuring.delete(instance.id);
  }
}

async function ensureClientInner(instance, onProgress) {
  const layout = dirsFor(instance);
  const progress = (phase, ratio, label) => {
    const payload = { phase, ratio, label, instanceId: instance.id, instanceName: instance.name };
    try { onProgress && onProgress(payload); } catch {}
    emit('game:progress', payload);
  };
  const tally = makeTally();

  progress('manifest', 0, 'Fetching version manifest');
  const manifest = await fetchJson(URLS.pistonMetaManifest);
  progress('manifest', 1, 'Manifest resolved');

  const { versionJson: vanillaJson } = await ensureVanilla(instance.mc, layout, manifest, progress, tally);

  let versionJson = vanillaJson;
  let versionFile = path.join(layout.versionsBase, instance.mc, `${instance.mc}.json`);
  let variant = instance.mc;
  let nativesDir = path.join(layout.versionsBase, instance.mc, `${instance.mc}-natives`);
  if (instance.loader !== 'vanilla') {
    const res = await ensureLoaderFiles(instance, layout, vanillaJson, progress, tally);
    versionJson = res.versionJson;
    versionFile = res.versionFile;
    variant = res.variantId;
    nativesDir = res.nativesDir;
    instance = getInstance(instance.id);
  } else {
    progress('natives', 0, 'Extracting natives');
    fs.mkdirSync(nativesDir, { recursive: true });
    extractNatives(versionJson, layout.libraries, nativesDir);
    progress('natives', 1, 'Natives extracted');
  }

  emit('game:log', { stream: 'system', line: `Verify complete: ${tally.cached} file(s) cached, ${tally.downloaded} downloaded.` });
  progress('done', 1, `Verified (${tally.cached} cached, ${tally.downloaded} downloaded)`);
  writeJsonAtomic(markerFile(layout.root, variant), {
    variant,
    mc: instance.mc,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
    cached: tally.cached,
    downloaded: tally.downloaded,
    verifiedAt: Date.now()
  });

  return { instanceDir: layout.root, versionFile, cached: tally.cached, downloaded: tally.downloaded, instance: describeInstance(instance), variant };
}

module.exports = {
  makeTally,
  writeJsonAtomic,
  fetchJson,
  retryAsync,
  downloadFileResilient,
  downloadFile,
  rulesAllow,
  libraryArtifactPath,
  extractNatives,
  ensureClient,
  isEnsuring
};
