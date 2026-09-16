'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URLS } = require('./config');
const { dirsFor } = require('./minecraft');
const { getInstance, getActiveInstance } = require('./instances');

const API = URLS.modrinthApi;

function clientUA() {
  try {
    const v = require('electron').app.getVersion();
    return `KebabClient/${v}`;
  } catch {
    return 'KebabClient/unknown';
  }
}

const CATEGORIES = {
  mod: { dir: 'mods', exts: ['.jar'], label: 'mod' },
  resourcepack: { dir: 'resourcepacks', exts: ['.zip'], label: 'resource pack' },
  shader: { dir: 'shaderpacks', exts: ['.zip'], label: 'shader' }
};

function categoryOf(category) {
  const key = String(category || 'mod').toLowerCase();
  if (!CATEGORIES[key]) throw new Error(`Unknown content category: ${category}`);
  return { key, ...CATEGORIES[key] };
}

function resolveInstance(instanceId) {
  const instance = instanceId ? getInstance(instanceId) : getActiveInstance();
  if (!instance) throw new Error('No instance selected. Create one first.');
  return instance;
}

function loaderFilter(instance) {
  if (instance.loader === 'fabric') return ['fabric'];
  if (instance.loader === 'quilt') return ['quilt'];
  return null;
}

function contentDir(instanceId, category) {
  const cat = categoryOf(category);
  const layout = dirsFor(resolveInstance(instanceId));
  const dir = path.join(layout.root, cat.dir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function modsDir(instanceId) {
  return contentDir(instanceId, 'mod');
}

async function apiGet(p, params) {
  const url = new URL(API + p);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': clientUA() }
  });
  if (!res.ok) throw new Error(`Modrinth request failed (${res.status}): ${p}`);
  return res.json();
}

async function searchMods(query, options) {
  const opts = options && typeof options === 'object'
    ? options
    : { limit: options, offset: arguments[2], instanceId: arguments[3] };
  const instance = resolveInstance(opts.instanceId);
  const catKey = String(opts.category || 'mod').toLowerCase();
  const facets = [[`versions:${instance.mc}`]];
  if (catKey !== 'all') {
    const cat = categoryOf(catKey);
    facets.push([`project_type:${cat.key}`]);
  }
  const params = {
    query: query || '',
    facets: JSON.stringify(facets),
    limit: String(opts.limit || 24),
    offset: String(opts.offset || 0)
  };
  if (opts.sort === 'popular') params.index = 'downloads';
  const data = await apiGet('/search', params);
  return {
    total: data.total_hits || 0,
    results: (data.hits || []).map((h) => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      iconUrl: h.icon_url || null,
      downloads: h.downloads || 0,
      author: h.author || '',
      categories: h.categories || [],
      projectType: h.project_type || 'mod',
      versions: h.versions || []
    }))
  };
}

async function getProjectVersions(projectId, loaders, mcVersion, instanceId) {
  const mc = mcVersion || resolveInstance(instanceId).mc;
  const params = { game_versions: `["${mc}"]` };
  if (loaders && loaders.length) params.loaders = JSON.stringify(loaders);
  return apiGet(`/project/${encodeURIComponent(projectId)}/version`, params);
}

function pickVersion(versions, preferredLoaders) {
  const ranked = [...(versions || [])].sort((a, b) => {
    const rank = (v) => (v.version_type === 'release' ? 0 : v.version_type === 'beta' ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return new Date(b.date_published) - new Date(a.date_published);
  });
  if (!preferredLoaders || !preferredLoaders.length) return ranked[0] || null;
  const matches = (v) => (v.files || []).some((f) =>
    (f.loaders || []).some((l) => preferredLoaders.includes(l))
  );
  return ranked.find(matches) || ranked[0] || null;
}

async function downloadToFile(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': clientUA() } });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const tmp = `${dest}.tmp-${process.pid}`;
  const out = fs.createWriteStream(tmp);
  try {
    for await (const chunk of res.body) out.write(chunk);
  } catch (e) {
    try { out.close(); } catch { /* noop */ }
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
    throw e;
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  fs.renameSync(tmp, dest);
}

async function installMod(projectId, versionId, instanceId, onStep, category) {
  const cat = categoryOf(category);
  const instance = resolveInstance(instanceId);
  const mc = instance.mc;
  const loaders = cat.key === 'mod' ? loaderFilter(instance) : null;
  const versions = await getProjectVersions(projectId, loaders, mc);
  let version = null;
  if (versionId) version = versions.find((v) => v.id === versionId) || null;
  if (!version) version = pickVersion(versions, loaders);
  if (!version) throw new Error(`No ${mc}-compatible files found for this ${cat.label}.`);
  const primary = (version.files || []).find((f) => f.primary) || version.files[0];
  if (!primary?.url) throw new Error(`Selected ${cat.label} version has no downloadable file.`);

  const dir = contentDir(instance.id, cat.key);
  const dest = path.join(dir, primary.filename);
  onStep && onStep({ phase: 'download', label: `Downloading ${primary.filename}` });
  await downloadToFile(primary.url, dest);

  const depResult = await installRequiredDeps(version, loaders, mc, dir, onStep);
  const installedDeps = depResult.installedDeps;
  const depProblems = depResult.depProblems;

  return { file: primary.filename, version: version.version_number, dependencies: installedDeps, depProblems };
}

function sha512File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    const s = fs.createReadStream(file);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

async function fetchPinnedVersion(projectId, versionId) {
  try {
    const v = await apiGet(`/version/${encodeURIComponent(versionId)}`);
    if (v && v.project_id === projectId && (v.files || []).length) return v;
  } catch { /* fall through */ }
  return null;
}

// Modrinth-Version einer lokalen Datei anhand ihres sha512-Hash bestimmen.
// Gibt null zurueck, wenn die Datei nicht auf Modrinth liegt (Custom-Mod).
async function identifyVersionByHash(filePath) {
  let hash;
  try {
    hash = await sha512File(filePath);
  } catch {
    return null;
  }
  try {
    return await apiGet(`/version_file/${hash}`, { algorithm: 'sha512' });
  } catch (err) {
    if (/\(404\)/.test(String(err && err.message)) || /\(400\)/.test(String(err && err.message))) return null;
    throw err;
  }
}

async function installRequiredDeps(version, loaders, mc, dir, onStep) {
  const installedDeps = [];
  const depProblems = [];
  for (const dep of version.dependencies || []) {
    if (dep.dependency_type !== 'required' || !dep.project_id) continue;
    try {
      const depVersions = await getProjectVersions(dep.project_id, loaders, mc);
      let depVersion = null;
      if (dep.version_id) depVersion = depVersions.find((v) => v.id === dep.version_id);
      if (!depVersion && dep.version_id) {
        depVersion = await fetchPinnedVersion(dep.project_id, dep.version_id);
      }
      if (!depVersion) depVersion = pickVersion(depVersions, loaders);
      if (!depVersion) {
        depProblems.push(`${dep.project_id}: no compatible file`);
        continue;
      }
      const depFile = (depVersion.files || []).find((f) => f.primary) || depVersion.files[0];
      if (!depFile?.url) {
        depProblems.push(`${dep.project_id}: no downloadable file`);
        continue;
      }
      const depDest = path.join(dir, depFile.filename);
      if (!fs.existsSync(depDest)) {
        onStep && onStep({ phase: 'dependency', label: `Installing dependency ${depFile.filename}` });
        await downloadToFile(depFile.url, depDest);
        installedDeps.push(depFile.filename);
      }
    } catch (err) {
      depProblems.push(`${dep.project_id}: ${err.message}`);
    }
  }
  return { installedDeps, depProblems };
}

// Holt fehlende Pflicht-Abhaengigkeiten fuer bereits im Ordner liegende
// Dateien (Drop/Upload) anhand ihres Modrinth-Hash nach.
async function ensureDependenciesForFiles(filenames, instanceId, category, onStep) {
  const cat = categoryOf(category);
  const instance = resolveInstance(instanceId);
  const mc = instance.mc;
  const loaders = cat.key === 'mod' ? loaderFilter(instance) : null;
  const dir = contentDir(instance.id, cat.key);
  const installedDeps = [];
  const depProblems = [];
  const unknownFiles = [];
  for (const file of filenames || []) {
    const full = path.join(dir, path.basename(String(file)));
    let version = null;
    try {
      version = await identifyVersionByHash(full);
    } catch (err) {
      depProblems.push(`${file}: dependency check failed (${err.message})`);
      continue;
    }
    if (!version) {
      unknownFiles.push(file);
      continue;
    }
    const r = await installRequiredDeps(version, loaders, mc, dir, onStep);
    installedDeps.push(...r.installedDeps);
    depProblems.push(...r.depProblems);
  }
  return { installedDeps, depProblems, unknownFiles };
}

function listDir(dir, exts) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { file: f, size: stat.size, mtime: stat.mtimeMs };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

function listInstalled(instanceId, category) {
  if (category) {
    const cat = categoryOf(category);
    return listDir(contentDir(instanceId, cat.key), cat.exts);
  }
  return {
    mod: listDir(contentDir(instanceId, 'mod'), CATEGORIES.mod.exts),
    resourcepack: listDir(contentDir(instanceId, 'resourcepack'), CATEGORIES.resourcepack.exts),
    shader: listDir(contentDir(instanceId, 'shader'), CATEGORIES.shader.exts)
  };
}

function uninstallMod(filename, instanceId, category) {
  const cat = categoryOf(category);
  const safe = path.basename(filename);
  if (!cat.exts.some((e) => safe.toLowerCase().endsWith(e))) {
    throw new Error(`Only ${cat.exts.join(', ')} files can be removed here.`);
  }
  const full = path.join(contentDir(instanceId, cat.key), safe);
  if (!fs.existsSync(full)) throw new Error(`${cat.label} not found: ${safe}`);
  fs.unlinkSync(full);
  return { removed: safe };
}

async function importContent(category, sourcePaths, instanceId) {
  const cat = categoryOf(category);
  const dir = contentDir(instanceId, cat.key);
  const added = [];
  const skipped = [];
  const failed = [];
  for (const src of sourcePaths || []) {
    const safe = path.basename(String(src || ''));
    if (!safe || !cat.exts.some((e) => safe.toLowerCase().endsWith(e))) {
      failed.push({ file: safe || String(src), reason: `Expected ${cat.exts.join(' or ')} for ${cat.label}s.` });
      continue;
    }
    try {
      const dest = path.join(dir, safe);
      if (fs.existsSync(dest)) {
        skipped.push(safe);
        continue;
      }
      fs.copyFileSync(String(src), dest);
      added.push(safe);
    } catch (err) {
      failed.push({ file: safe, reason: err.message });
    }
  }
  // Pflicht-Abhaengigkeiten fuer frisch hinzugefuegte Dateien nachholen
  // (Hash-Lookup auf Modrinth; Custom-Mods werden uebersprungen).
  let installedDeps = [];
  let depProblems = [];
  if (added.length) {
    try {
      const r = await ensureDependenciesForFiles(added, instanceId, cat.key, null);
      installedDeps = r.installedDeps;
      depProblems = r.depProblems;
    } catch (err) {
      depProblems.push(`dependency check failed: ${err.message}`);
    }
  }
  return { added, skipped, failed, installedDeps, depProblems };
}

module.exports = {
  CATEGORIES,
  searchMods,
  getProjectVersions,
  installMod,
  listInstalled,
  uninstallMod,
  importContent,
  ensureDependenciesForFiles,
  installRequiredDeps,
  modsDir,
  contentDir
};
