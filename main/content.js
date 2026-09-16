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

// Disabled-Suffix: Dateien mit .disabled werden vom Spiel ignoriert
// (Funktioniert fuer Mods, Resource Packs und Shader).
const DISABLED_SUFFIX = '.disabled';
const META_FILE = '.kebab-meta.json';
const META_VERSION = 2;
const MAX_ICON_BYTES = 512 * 1024;

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

async function installMod(projectId, versionId, instanceId, onStep, category, meta) {
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

  try {
    const dirMeta = loadMeta(dir);
    dirMeta[primary.filename] = {
      v: META_VERSION,
      title: (meta && meta.title) || prettifyFilename(primary.filename),
      icon: (meta && meta.icon) || null,
      projectId,
      version: version.version_number || null
    };
    saveMeta(dir, dirMeta);
  } catch { /* metadata is optional */ }

  const depResult = await installRequiredDeps(version, loaders, mc, dir, onStep);
  const installedDeps = depResult.installedDeps;
  const depProblems = depResult.depProblems;

  return { file: primary.filename, version: version.version_number, projectId, dependencies: installedDeps, depProblems };
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

function stripDisabled(filename) {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith(DISABLED_SUFFIX)) {
    return { base: String(filename).slice(0, -DISABLED_SUFFIX.length), disabled: true };
  }
  return { base: String(filename), disabled: false };
}

function matchesExt(filename, exts) {
  const lower = String(filename || '').toLowerCase();
  return exts.some((e) => lower.endsWith(e) || lower.endsWith(`${e}${DISABLED_SUFFIX}`));
}

function baseMatchesExt(filename, exts) {
  const lower = String(filename || '').toLowerCase();
  return exts.some((e) => lower.endsWith(e));
}

function loadMeta(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, META_FILE), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveMeta(dir, meta) {
  try {
    const pruned = {};
    for (const [file, entry] of Object.entries(meta || {})) {
      if (!entry || typeof entry !== 'object') continue;
      try {
        if (!fs.existsSync(path.join(dir, path.basename(String(file))))) continue;
      } catch {
        continue;
      }
      pruned[path.basename(String(file))] = entry;
    }
    fs.writeFileSync(path.join(dir, META_FILE), JSON.stringify(pruned), 'utf8');
  } catch { /* metadata is optional */ }
}

// "cloth-config-26.2.155.jar" -> "Cloth Config". Fallback, wenn weder
// Sidecar noch Jar-Metadaten einen Titel liefern.
const PRETTIFY_ACRONYMS = new Set(['api', 'gui', 'hud', 'mc', 'fps', 'jei', 'rei', 'emi', 'rpg', 'ui', 'pvp', 'pve']);
function prettifyFilename(filename) {
  const { base } = stripDisabled(filename);
  const name = base.replace(/\u00a7./g, '').replace(/\.[^.]+$/, '');
  const tokens = name.split(/[-_.+]+/).filter(Boolean);
  const kept = [];
  for (const tok of tokens) {
    if (/^v?\d/.test(tok)) continue;
    if (/^mc\d/i.test(tok)) continue;
    kept.push(tok);
  }
  if (!kept.length) return base;
  return kept.map((w) => {
    if (PRETTIFY_ACRONYMS.has(w.toLowerCase())) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

function iconDataUrl(buf, filename) {
  if (!buf || !buf.length || buf.length > MAX_ICON_BYTES) return null;
  const ext = String(filename || '').toLowerCase();
  const mime = ext.endsWith('.jpg') || ext.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function readZipEntry(zip, entryName) {
  try {
    const entry = zip.getEntry(entryName);
    if (!entry || entry.isDirectory) return null;
    return entry.getData();
  } catch {
    return null;
  }
}

// Titel + Icon aus dem Jar selbst (fabric.mod.json). Gilt auch fuer
// deaktivierte Dateien (Endung ist beim Lesen egal).
function parseJarMeta(full) {
  let AdmZip;
  try { AdmZip = require('adm-zip'); }
  catch { return null; }
  let zip;
  try { zip = new AdmZip(full); }
  catch { return null; }
  let modJson = null;
  for (const cand of ['fabric.mod.json', 'quilt.mod.json']) {
    const buf = readZipEntry(zip, cand);
    if (buf) {
      try { modJson = JSON.parse(buf.toString('utf8')); }
      catch { modJson = null; }
      if (modJson) break;
    }
  }
  if (!modJson) return null;
  const out = {};
  if (modJson.name) out.title = String(modJson.name);
  let iconPath = null;
  if (typeof modJson.icon === 'string') iconPath = modJson.icon;
  else if (modJson.icon && typeof modJson.icon === 'object') {
    iconPath = modJson.icon['256'] || modJson.icon['128'] || modJson.icon['64'] || modJson.icon['32'];
  }
  if (iconPath) {
    const buf = readZipEntry(zip, String(iconPath).replace(/^\.\//, ''));
    const url = buf && iconDataUrl(buf, iconPath);
    if (url) out.icon = url;
  }
  return Object.keys(out).length ? out : null;
}

// Titel + Icon aus Resource-Pack-Zips (pack.png). Die pack.mcmeta-
// Beschreibung ist kein Titel (Versions-Fluff), Dateiname wird prettified.
function parsePackMeta(full) {
  let AdmZip;
  try { AdmZip = require('adm-zip'); }
  catch { return null; }
  let zip;
  try { zip = new AdmZip(full); }
  catch { return null; }
  const out = {};
  const iconBuf = readZipEntry(zip, 'pack.png');
  const url = iconBuf && iconDataUrl(iconBuf, 'pack.png');
  if (url) out.icon = url;
  return Object.keys(out).length ? out : null;
}

function resolveFileMeta(dir, file, catKey, meta) {
  const safe = path.basename(String(file));
  const full = path.join(dir, safe);
  const { disabled } = stripDisabled(safe);
  let stat = null;
  try { stat = fs.statSync(full); }
  catch { return null; }
  const cached = meta && meta[safe];
  if (cached && cached.v === META_VERSION && cached.mtime === stat.mtimeMs && (cached.title || cached.icon)) {
    return { file: safe, name: cached.title || prettifyFilename(safe), icon: cached.icon || null, disabled, projectId: cached.projectId || null, size: stat.size };
  }
  let found = null;
  if (catKey === 'mod') found = parseJarMeta(full);
  else found = parsePackMeta(full);
  const name = (found && found.title) || (cached && cached.v === META_VERSION && cached.title) || prettifyFilename(safe);
  const icon = (found && found.icon) || (cached && cached.icon) || null;
  const projectId = (cached && cached.projectId) || null;
  if (meta && (name !== prettifyFilename(safe) || icon || projectId)) {
    meta[safe] = { v: META_VERSION, title: name, icon, projectId, mtime: stat.mtimeMs };
  }
  return { file: safe, name, icon, disabled, projectId, size: stat.size };
}

function listDir(dir, exts) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f !== META_FILE && matchesExt(f, exts))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { file: f, size: stat.size, mtime: stat.mtimeMs };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

function listInstalled(instanceId, category) {
  const enrich = (instanceIdArg, catKey) => {
    const cat = CATEGORIES[catKey];
    const dir = contentDir(instanceIdArg, catKey);
    const meta = loadMeta(dir);
    const items = [];
    for (const entry of listDir(dir, cat.exts)) {
      const rich = resolveFileMeta(dir, entry.file, catKey, meta);
      if (rich) items.push(rich);
    }
    saveMeta(dir, meta);
    return items;
  };
  if (category) {
    return enrich(instanceId, categoryOf(category).key);
  }
  return {
    mod: enrich(instanceId, 'mod'),
    resourcepack: enrich(instanceId, 'resourcepack'),
    shader: enrich(instanceId, 'shader')
  };
}

function uninstallMod(filename, instanceId, category) {
  const cat = categoryOf(category);
  const safe = path.basename(String(filename || ''));
  const { base } = stripDisabled(safe);
  if (!baseMatchesExt(base, cat.exts)) {
    throw new Error(`Only ${cat.exts.join(', ')} files can be removed here.`);
  }
  const dir = contentDir(instanceId, cat.key);
  const full = path.join(dir, safe);
  if (!fs.existsSync(full)) throw new Error(`${cat.label} not found: ${safe}`);
  fs.unlinkSync(full);
  const meta = loadMeta(dir);
  if (meta[safe]) {
    delete meta[safe];
    saveMeta(dir, meta);
  }
  return { removed: safe };
}

function toggleContent(filename, instanceId, category) {
  const cat = categoryOf(category);
  const safe = path.basename(String(filename || ''));
  const { base, disabled } = stripDisabled(safe);
  if (!baseMatchesExt(base, cat.exts)) {
    throw new Error(`Only ${cat.exts.join(', ')} files can be toggled here.`);
  }
  const dir = contentDir(instanceId, cat.key);
  const from = path.join(dir, safe);
  if (!fs.existsSync(from)) throw new Error(`${cat.label} not found: ${safe}`);
  const to = disabled ? path.join(dir, base) : path.join(dir, `${safe}${DISABLED_SUFFIX}`);
  if (fs.existsSync(to)) throw new Error(`Cannot toggle: ${path.basename(to)} already exists.`);
  fs.renameSync(from, to);
  const meta = loadMeta(dir);
  if (meta[safe]) {
    meta[path.basename(to)] = meta[safe];
    delete meta[safe];
    saveMeta(dir, meta);
  }
  return { file: path.basename(to), disabled: !disabled };
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
  toggleContent,
  prettifyFilename,
  importContent,
  ensureDependenciesForFiles,
  installRequiredDeps,
  modsDir,
  contentDir
};
