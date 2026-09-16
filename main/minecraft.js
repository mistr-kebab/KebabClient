'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { MC_VERSION, URLS, instanceDir, dataDir, instancesRoot, sharedLibrariesDir, sharedAssetsDir } = require('./config');
const { getStoredProfile, getValidMcAccessToken } = require('./auth');
const { getInstance, getActiveInstance, setLoaderVersion, touchLastPlayed } = require('./instances');
const loaders = require('./loaders');

let child = null;
let emit = () => {};
let tmpCounter = 0;

function setEmitter(fn) {
  emit = fn;
}

function appVersion() {
  try {
    return require('electron').app.getVersion();
  } catch {
    return '0.0.0';
  }
}

function isRunning() {
  return child !== null;
}

function dirsFor(instance) {
  const root = path.join(instancesRoot(), instance.dir);
  const variant = instance.variantId || instance.mc;
  const versionsBase = path.join(root, 'versions');
  const versions = path.join(versionsBase, variant);
  const libraries = sharedLibrariesDir();
  const assets = sharedAssetsDir();
  const natives = path.join(versions, `${variant}-natives`);
  const mods = path.join(root, 'mods');
  for (const d of [root, versions, libraries, assets, natives, mods]) {
    fs.mkdirSync(d, { recursive: true });
  }
  return { root, versionsBase, versions, libraries, assets, natives, mods, variant };
}

function dirs() {
  const active = getActiveInstance();
  if (!active) throw new Error('No instance selected. Create one first.');
  return dirsFor(active);
}

function markerFile(root, variant) {
  return path.join(root, `.verified-${variant}.json`);
}

function makeTally() {
  const tally = (res) => {
    if (res?.skipped) tally.cached += 1;
    else tally.downloaded += 1;
  };
  tally.cached = 0;
  tally.downloaded = 0;
  return tally;
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
      } catch { /* hash failed: re-download */ }
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
    try { out.close(); } catch { /* noop */ }
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
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

// MVP: no demo mode, no custom resolution, no quick-play. All feature-gated
// arguments (demo, quickPlay*, resolution) stay excluded.
function launchFeatures() {
  return {
    is_demo_user: false,
    has_custom_resolution: false,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false
  };
}

function libraryArtifactPath(lib, librariesDir) {
  const art = lib?.downloads?.artifact;
  if (!art || !art.path) return null;
  return path.join(librariesDir, art.path.replace(/\//g, path.sep));
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
        const target = path.join(nativesDir, zipEntry.entryName);
        if (target !== nativesDir && !target.startsWith(nativesDir + path.sep)) continue;
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
  fs.writeFileSync(versionFile, JSON.stringify(versionJson), 'utf8');
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
  // Profil-Libs VOR dem Merge normalisieren (downloads.artifact aufloesen),
  // damit sie im gemergten JSON stehen. Sonst fehlen sie im Classpath und der
  // Start stirbt mit ClassNotFoundException (z.B. KnotClient).
  const normalizedProfileLibs = [];
  for (const rawLib of profile.libraries || []) {
    if (!rulesAllow(rawLib.rules)) continue;
    normalizedProfileLibs.push(loaders.normalizeProfileLibrary(rawLib, mavenBase));
  }
  const merged = loaders.mergeProfile(vanillaJson, { ...profile, libraries: normalizedProfileLibs }, instance.mc);
  const variantDir = path.join(layout.versionsBase, variantId);
  fs.mkdirSync(variantDir, { recursive: true });
  const versionFile = path.join(variantDir, `${variantId}.json`);
  fs.writeFileSync(versionFile, JSON.stringify(merged), 'utf8');

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

const ensuring = new Set();

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
    try { onProgress && onProgress(payload); } catch { /* noop */ }
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
  fs.writeFileSync(markerFile(layout.root, variant), JSON.stringify({
    variant,
    mc: instance.mc,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
    cached: tally.cached,
    downloaded: tally.downloaded,
    verifiedAt: Date.now()
  }));

  return { instanceDir: layout.root, versionFile, cached: tally.cached, downloaded: tally.downloaded, instance, variant };
}

function javaSettings() {
  try {
    const { loadState } = require('./store');
    const s = loadState().settings?.java || {};
    return {
      path: String(s.path || '').trim(),
      xmx: Number(s.xmx) || 4,
      extraArgs: String(s.extraArgs || '').trim()
    };
  } catch {
    return { path: '', xmx: 4, extraArgs: '' };
  }
}

function downloadThreads() {
  try {
    const { loadState } = require('./store');
    const t = Number(loadState().settings?.downloads?.threads);
    return [2, 4, 8, 16].includes(t) ? t : 8;
  } catch {
    return 8;
  }
}

function findJava() {
  const custom = javaSettings().path;
  if (custom && fs.existsSync(custom)) return custom;
  if (process.env.JAVA_HOME) {
    const cand = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(cand)) return cand;
  }
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

function buildClasspath(versionJson, librariesDir, clientJarPath) {
  const cp = [clientJarPath];
  for (const lib of versionJson.libraries || []) {
    if (!rulesAllow(lib.rules)) continue;
    const p = libraryArtifactPath(lib, librariesDir);
    if (p && !cp.includes(p)) cp.push(p);
  }
  return cp.join(process.platform === 'win32' ? ';' : ':');
}

function interpolateArg(arg, vars) {
  return String(arg).replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

function buildLaunchArgs(versionJson, vars) {
  const features = launchFeatures();
  const jvmArgs = [];
  for (const a of versionJson.arguments?.jvm || []) {
    if (typeof a === 'string') jvmArgs.push(interpolateArg(a, vars));
    else if (rulesAllow(a.rules, features)) {
      const v = Array.isArray(a.value) ? a.value : [a.value];
      for (const s of v) jvmArgs.push(interpolateArg(s, vars));
    }
  }
  const gameArgs = [];
  for (const a of versionJson.arguments?.game || []) {
    if (typeof a === 'string') gameArgs.push(interpolateArg(a, vars));
    else if (rulesAllow(a.rules, features)) {
      const v = Array.isArray(a.value) ? a.value : [a.value];
      for (const s of v) gameArgs.push(interpolateArg(s, vars));
    }
  }
  return { jvmArgs, gameArgs };
}

async function launchGame(instanceId) {
  if (child) throw new Error('Game is already running.');
  const instance = instanceId ? getInstance(instanceId) : getActiveInstance();
  if (!instance) throw new Error('No instance selected. Create one first.');
  const layout = dirsFor(instance);
  const inst = layout.root;
  const { versionsBase, libraries, assets } = layout;
  const variant = instance.variantId || instance.mc;
  const natives = path.join(versionsBase, variant, `${variant}-natives`);
  const versionFile = path.join(versionsBase, variant, `${variant}.json`);
  if (!fs.existsSync(versionFile)) {
    throw new Error(`Instance "${instance.name}" is not downloaded yet. Press Download / verify first.`);
  }
  let marker = null;
  try { marker = JSON.parse(fs.readFileSync(markerFile(inst, variant), 'utf8')); }
  catch { marker = null; }
  if (!marker || marker.variant !== variant) {
    throw new Error(`Instance "${instance.name}" is not fully verified yet. Press Download / verify, wait until it finishes, then press Play.`);
  }
  const versionJson = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
  const profile = getStoredProfile();
  if (!profile) throw new Error('Not signed in. Sign in with Microsoft first.');
  const accessToken = await getValidMcAccessToken();

  const baseMc = versionJson.kebabBaseMc || instance.mc;
  const clientJar = path.join(versionsBase, baseMc, `${baseMc}.jar`);
  if (!fs.existsSync(clientJar)) {
    throw new Error(`Client jar for ${baseMc} is missing. Press Download / verify first.`);
  }
  const classpath = buildClasspath(versionJson, libraries, clientJar);
  const vars = {
    auth_player_name: profile.name,
    version_name: variant,
    game_directory: inst,
    assets_root: assets,
    assets_index_name: versionJson.assetIndex?.id || versionJson.assets || instance.mc,
    auth_uuid: profile.id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'),
    auth_access_token: accessToken,
    clientid: 'kebabclient-mvp',
    auth_xuid: '0',
    user_type: 'msa',
    version_type: versionJson.type || 'release',
    natives_directory: natives,
    launcher_name: 'KebabClient',
    launcher_version: appVersion(),
    classpath
  };

  const { jvmArgs, gameArgs } = buildLaunchArgs(versionJson, vars);
  if (!jvmArgs.some((a) => a.startsWith('-Djava.library.path='))) {
    jvmArgs.push('-Djava.library.path=' + natives);
  }
  if (!jvmArgs.includes('-cp')) {
    jvmArgs.push('-cp', classpath);
  }
  const javaOpts = javaSettings();
  if (javaOpts.xmx > 0 && !jvmArgs.some((a) => /^-Xmx/i.test(a))) {
    jvmArgs.unshift(`-Xmx${javaOpts.xmx}G`);
  }
  const extra = javaOpts.extraArgs.split(/\s+/).filter(Boolean);
  if (extra.length) jvmArgs.push(...extra);

  const mainClass = versionJson.mainClass;
  const java = findJava();
  const args = [...jvmArgs, mainClass, ...gameArgs];

  emit('game:status', { running: true, pid: null });
  emit('game:log', { stream: 'system', line: `Launching ${instance.name} (${variant}) as ${profile.name} [java: ${java}, Xmx: ${javaOpts.xmx}G]` });

  child = spawn(java, args, { cwd: inst, env: { ...process.env } });
  touchLastPlayed(instance.id);
  const playStart = Date.now();
  const playId = instance.id;
  try { require('./discord').showGame(instance.name); } catch { /* noop */ }
  emit('game:status', { running: true, pid: child.pid || null });

  const pump = (stream) => (chunk) => {
    const text = chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue;
      try { require('./discord').handleGameLine(line); } catch { /* noop */ }
      emit('game:log', { stream, line: line.slice(0, 4000) });
    }
  };
  child.stdout.on('data', pump('stdout'));
  child.stderr.on('data', pump('stderr'));
  child.on('error', (err) => {
    emit('game:log', { stream: 'system', line: `Failed to start Java: ${err.message}` });
    emit('game:status', { running: false, pid: null, error: err.message });
    child = null;
  });
  child.on('exit', (code, signal) => {
    try {
      require('./instances').addPlaytime(playId, Date.now() - playStart);
    } catch { /* non-critical */ }
    try { require('./discord').clearGame(); } catch { /* noop */ }
    emit('game:log', { stream: 'system', line: `Game exited (code=${code} signal=${signal || '-'})` });
    emit('game:status', { running: false, pid: null, code });
    child = null;
  });
  return { pid: child.pid || null };
}

function stopGame() {
  if (!child) return { stopped: false };
  try {
    if (process.platform === 'win32') child.kill();
    else child.kill('SIGTERM');
  } catch { /* noop */ }
  return { stopped: true };
}

function gameDataDir() {
  return dataDir();
}

module.exports = {
  setEmitter,
  isRunning,
  ensureClient,
  launchGame,
  stopGame,
  instanceDir,
  dirsFor,
  gameDataDir,
  buildLaunchArgs,
  rulesAllow,
  MC_VERSION: MC_VERSION,
  platformInfo: () => ({ platform: process.platform, arch: os.arch() })
};
