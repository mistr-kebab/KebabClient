'use strict';

const LOADERS = {
  fabric: {
    label: 'Fabric',
    meta: (mc) => `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`,
    profile: (mc, loaderVersion) =>
      `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loaderVersion)}/profile/json`,
    maven: 'https://maven.fabricmc.net/'
  },
  quilt: {
    label: 'Quilt',
    meta: (mc) => `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}`,
    profile: (mc, loaderVersion) =>
      `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loaderVersion)}/profile/json`,
    maven: 'https://maven.quiltmc.org/repository/release/'
  }
};

function isSupported(loader) {
  return Object.hasOwn(LOADERS, loader);
}

function clientUA() {
  try {
    const v = require('electron').app.getVersion();
    return `KebabClient/${v}`;
  } catch {
    return 'KebabClient/unknown';
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': clientUA() } });
  if (!res.ok) throw new Error(`Loader metadata request failed (${res.status}): ${url}`);
  return res.json();
}

async function listLoaderVersions(mc, loader) {
  const cfg = LOADERS[loader];
  if (!cfg) throw new Error(`Unsupported loader: ${loader}`);
  let data;
  try {
    data = await fetchJson(cfg.meta(mc));
  } catch (err) {
    throw new Error(`No ${cfg.label} builds found for ${mc} (${err.message}).`);
  }
  const versions = (Array.isArray(data) ? data : [])
    .filter((e) => e?.loader?.version)
    .map((e) => ({ version: String(e.loader.version), stable: e.loader.stable !== false }));
  if (!versions.length) throw new Error(`No ${cfg.label} builds found for ${mc}.`);
  return versions;
}

async function resolveLatestLoader(mc, loader) {
  const versions = await listLoaderVersions(mc, loader);
  const stable = versions.find((v) => v.stable);
  return (stable || versions[0]).version;
}

async function fetchProfile(mc, loader, loaderVersion) {
  const cfg = LOADERS[loader];
  if (!cfg) throw new Error(`Unsupported loader: ${loader}`);
  return fetchJson(cfg.profile(mc, loaderVersion));
}

function mavenArtifact(name, baseUrl) {
  const [coord, extPart] = String(name).split('@');
  const ext = extPart || 'jar';
  const parts = coord.split(':');
  if (parts.length < 3) throw new Error(`Unresolvable library coordinate: ${name}`);
  const [group, artifact, version, classifier] = parts;
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  const rel = `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`;
  const base = String(baseUrl || '').replace(/\/?$/, '/');
  return { path: rel, url: base + rel };
}

function normalizeProfileLibrary(lib, mavenBase) {
  const out = { ...lib };
  if (!out.downloads?.artifact && typeof out.name === 'string') {
    const art = mavenArtifact(out.name, lib.url || mavenBase);
    out.downloads = { ...(out.downloads || {}), artifact: { path: art.path, url: art.url } };
    if (lib.sha1 && !out.downloads.artifact.sha1) out.downloads.artifact.sha1 = lib.sha1;
    if (lib.size && !out.downloads.artifact.size) out.downloads.artifact.size = lib.size;
  }
  if (!out.downloads?.artifact?.url) {
    throw new Error(`Loader library has no download URL: ${lib.name || JSON.stringify(lib).slice(0, 120)}`);
  }
  return out;
}

function mergeProfile(vanillaJson, profile, baseMc) {
  const merged = {
    ...vanillaJson,
    id: profile.id,
    mainClass: profile.mainClass || vanillaJson.mainClass,
    kebabBaseMc: baseMc,
    kebabLoader: true,
    arguments: {
      game: [...(vanillaJson.arguments?.game || []), ...(profile.arguments?.game || [])],
      jvm: [...(vanillaJson.arguments?.jvm || []), ...(profile.arguments?.jvm || [])]
    },
    libraries: [...(vanillaJson.libraries || [])]
  };
  const seen = new Set(merged.libraries.map((l) => l.name).filter(Boolean));
  for (const lib of profile.libraries || []) {
    if (lib.name && seen.has(lib.name)) continue;
    merged.libraries.push(lib);
    if (lib.name) seen.add(lib.name);
  }
  return merged;
}

module.exports = {
  LOADERS,
  isSupported,
  listLoaderVersions,
  resolveLatestLoader,
  fetchProfile,
  normalizeProfileLibrary,
  mergeProfile
};
