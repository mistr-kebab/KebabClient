'use strict';

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
  const data = await apiGet('/search', {
    query: query || '',
    facets: JSON.stringify(facets),
    limit: String(opts.limit || 24),
    offset: String(opts.offset || 0)
  });
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

function sanitizeContentFilename(filename, exts) {
  const base = path.basename(String(filename || ''));
  if (!base || base === '.' || base === '..') throw new Error('Invalid content filename.');
  if (base.includes('\0')) throw new Error('Invalid content filename.');
  const lower = base.toLowerCase();
  const ok = (exts || []).some((e) => lower.endsWith(e.toLowerCase()));
  if (!ok) throw new Error(`Unexpected file extension: ${base}`);
  return base;
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
    try { out.close(); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
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
  const safeName = sanitizeContentFilename(primary.filename, cat.exts);
  const dest = path.join(dir, safeName);
  onStep && onStep({ phase: 'download', label: `Downloading ${safeName}` });
  await downloadToFile(primary.url, dest);

  async function fetchPinnedVersion(projectId, versionId) {
    try {
      const v = await apiGet(`/version/${encodeURIComponent(versionId)}`);
      if (v && v.project_id === projectId && (v.files || []).length) return v;
    } catch {}
    return null;
  }

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
      const depSafe = sanitizeContentFilename(depFile.filename, cat.exts);
      const depDest = path.join(dir, depSafe);
      if (!fs.existsSync(depDest)) {
        onStep && onStep({ phase: 'dependency', label: `Installing dependency ${depSafe}` });
        await downloadToFile(depFile.url, depDest);
        installedDeps.push(depSafe);
      }
    } catch (err) {
      depProblems.push(`${dep.project_id}: ${err.message}`);
    }
  }

  return { file: safeName, version: version.version_number, dependencies: installedDeps, depProblems };
}

function listDir(dir, exts) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of entries) {
    if (!exts.some((e) => f.toLowerCase().endsWith(e))) continue;
    const full = path.join(dir, f);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      out.push({ file: f, size: stat.size, mtime: stat.mtimeMs });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
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

function importContent(category, sourcePaths, instanceId) {
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
  return { added, skipped, failed };
}

module.exports = {
  CATEGORIES,
  searchMods,
  getProjectVersions,
  installMod,
  listInstalled,
  uninstallMod,
  importContent,
  modsDir,
  contentDir
};
