'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { instancesRoot } = require('../config');

const RULES_FILE = path.join(__dirname, '..', 'crashRules.json');
const FIX_TYPES = ['increase_ram', 'disable_mod', 'install_dependency', 'switch_version', 'none'];
const REPORT_PREFIX = 'crash-';
const REPORT_SUFFIX = '.txt';
const MAX_REPORT_BYTES = 300 * 1024;
const MAX_LOG_BYTES = 256 * 1024;
const LOG_TAIL_LINES = 120;
const EXCERPT_CHARS = 4000;
const RAM_OPTIONS = [2, 4, 6, 8, 12, 16];
const INSTALL_ID_JAR_RE = /([\p{L}\p{N}_+().-]+\.jar)/giu;
const DEP_ID_RES = [
  /(?:requires?|needs)\s+(?:mod\s+)?[`'"«»“”]?([a-z0-9_-]+)[`'"«»“”]?(?:\s+(api))?\b/i,
  /Mod ID:\s*['"]([^'"]+)['"]/i,
];
const DEP_ID_OK = /^[a-z0-9_-]{1,64}$/i;
const DEP_ID_STOP = [
  'minecraft',
  'java',
  'fabric',
  'forge',
  'neoforge',
  'fabric-loader',
  'fabricloader',
  'quilt-loader',
  'quiltloader',
  'modloader',
  'loader',
  'mod',
  'mods',
  'any',
  'version',
  'versions',
  'later',
  'newer',
  'older',
];
const FIX_ADD_RE = /add:([a-z0-9_-]+)\s+([^\s,\]]+)/gi;
const INSTALL_LINE_RE = /Install\s+([a-z0-9_-]+),\s*version\s+/gi;
const REQUIRES_MISSING_RE =
  /requires\s+(?:any\s+version\s+of\s+|version\s+[^\s,]+\s+(?:or\s+later\s+)?of\s+)?([a-z0-9_-]+),\s*which\s+is\s+missing/gi;
const MOD_ID_LINE_RE = /Mod\s+'[^']+'\s+\(([a-z0-9_-]+)\)/gi;

function loadRules() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
  } catch (err) {
    console.warn('[crashdoctor] Could not load rules:', err?.message || err);
    return [];
  }
  const rules = Array.isArray(raw) ? raw : raw.rules;
  if (!Array.isArray(rules)) return [];
  return rules.filter(
    r =>
      r &&
      typeof r.id === 'string' &&
      Array.isArray(r.patterns) &&
      r.patterns.length > 0 &&
      FIX_TYPES.includes(r.fixType) &&
      r.title &&
      r.body
  );
}

function instanceRoot(instanceId) {
  const { getInstance } = require('./instances');
  const instance = getInstance(instanceId);
  return path.join(instancesRoot(), instance.dir);
}

function listReports(root) {
  const dir = path.join(root, 'crash-reports');
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.startsWith(REPORT_PREFIX) || !f.endsWith(REPORT_SUFFIX)) continue;
    try {
      const stat = fs.statSync(path.join(dir, f));
      if (stat.isFile()) out.push({ file: f, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function newestReport(root, sinceMs) {
  const reports = listReports(root);
  if (!reports.length) return null;
  if (sinceMs && reports[0].mtimeMs < sinceMs) return null;
  return reports[0];
}

function readTextCapped(file, maxBytes) {
  const stat = fs.statSync(file);
  if (stat.size <= maxBytes) return fs.readFileSync(file, 'utf8');
  const fd = fs.openSync(file, 'r');
  try {
    const start = Math.max(0, stat.size - maxBytes);
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
  }
}

function readLastLines(file, maxLines, maxBytes) {
  let text = '';
  try {
    text = readTextCapped(file, maxBytes);
  } catch {
    return '';
  }
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

function excerptAround(text, index, radius) {
  const lines = text.split(/\r?\n/);
  let used = 0;
  let lineNo = 0;
  for (let i = 0; i < lines.length; i++) {
    if (index < used + lines[i].length + 1) {
      lineNo = i;
      break;
    }
    used += lines[i].length + 1;
    lineNo = i;
  }
  return lines.slice(Math.max(0, lineNo - radius), lineNo + radius + 1).join('\n');
}

function firstMatchIndex(lower, patterns) {
  let best = -1;
  for (const p of patterns) {
    const i = lower.indexOf(String(p).toLowerCase());
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

function jarMentions(text, limit) {
  const out = [];
  const seen = new Set();
  for (const m of String(text).matchAll(INSTALL_ID_JAR_RE)) {
    const name = m[1];
    if (name.length > 128 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= (limit || 50)) break;
  }
  return out;
}

function stripDisabledSuffix(file) {
  return String(file).endsWith('.disabled') ? String(file).slice(0, -'.disabled'.length) : String(file);
}

function installedMods(instanceId) {
  const content = require('./content');
  const items = content.listInstalled(instanceId, 'mod');
  return (Array.isArray(items) ? items : []).map(i => ({
    file: String(i.file || ''),
    base: stripDisabledSuffix(String(i.file || '')),
    disabled: String(i.file || '').endsWith('.disabled') || !!i.disabled,
    name: String(i.name || i.file || ''),
  }));
}

function findInstalledFile(files, token) {
  const t = String(token).toLowerCase();
  return files.find(f => f.base.toLowerCase() === t) || files.find(f => f.base.toLowerCase().includes(t)) || null;
}

function fileMatchesId(file, id) {
  return file.base.toLowerCase().includes(String(id).toLowerCase());
}

function buildDisablePayload(text, instanceId, rule) {
  const files = installedMods(instanceId).filter(f => !f.disabled);
  const conflicts = (rule.payload && rule.payload.conflicts) || [];
  for (const pair of conflicts) {
    if (!pair || !pair.keep || !pair.remove) continue;
    const keepFile = files.find(f => fileMatchesId(f, pair.keep));
    const removeFile = files.find(f => fileMatchesId(f, pair.remove));
    if (keepFile && removeFile) {
      return { file: removeFile.file, other: keepFile.file, keep: pair.keep, remove: pair.remove };
    }
  }
  for (const jar of jarMentions(text)) {
    const hit = findInstalledFile(files, jar);
    if (hit) return { file: hit.file };
  }
  return null;
}

function pushDepId(found, seen, raw) {
  const id = String(raw || '').toLowerCase();
  if (!DEP_ID_OK.test(id) || DEP_ID_STOP.includes(id) || seen.has(id)) return;
  seen.add(id);
  found.push(id);
}

function buildDepPayload(text) {
  const src = String(text);
  const found = [];
  const seen = new Set();
  for (const m of src.matchAll(FIX_ADD_RE)) pushDepId(found, seen, m[1]);
  for (const m of src.matchAll(INSTALL_LINE_RE)) pushDepId(found, seen, m[1]);
  for (const m of src.matchAll(REQUIRES_MISSING_RE)) pushDepId(found, seen, m[1]);
  for (const re of DEP_ID_RES) {
    const m = src.match(re);
    if (!m) continue;
    let id = (m[1] || '').toLowerCase();
    if (m[2] && m[2].toLowerCase() === 'api') id = `${id}-api`;
    pushDepId(found, seen, id);
  }
  if (!found.length) return null;
  return { mods: found.map(modId => ({ modId })) };
}

function modIdsNear(text, linePattern) {
  const ids = [];
  const seen = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    if (!linePattern.test(line)) continue;
    for (const m of line.matchAll(MOD_ID_LINE_RE)) {
      const id = m[1].toLowerCase();
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

function buildSwitchPayload(text, instanceId) {
  const files = installedMods(instanceId);
  if (!files.length) return null;
  for (const id of modIdsNear(text, /incompat|requires|error/i)) {
    const hit = files.find(f => fileMatchesId(f, id));
    if (hit) return { file: hit.file, category: 'mod' };
  }
  const interesting = jarMentions(
    String(text)
      .split(/\r?\n/)
      .filter(l => /incompat|requires|error|caused|exception/i.test(l))
      .join('\n')
  );
  const pool = interesting.length ? interesting : jarMentions(text);
  for (const jar of pool) {
    const hit = findInstalledFile(files, jar);
    if (hit) return { file: hit.file, category: 'mod' };
  }
  return null;
}

function snapRam(gb) {
  for (const opt of RAM_OPTIONS) {
    if (opt >= gb) return opt;
  }
  return RAM_OPTIONS[RAM_OPTIONS.length - 1];
}

function buildFixPayload(rule, text, instanceId) {
  if (rule.fixType === 'increase_ram') {
    const settings = require('../settings');
    const current = settings.getSettings().java.xmx;
    const minGb = Number(rule.payload && rule.payload.minGb) || 6;
    const to = snapRam(Math.max(minGb, current + 2));
    if (to <= current) return null;
    return { fromGb: current, toGb: to };
  }
  if (rule.fixType === 'disable_mod') return buildDisablePayload(text, instanceId, rule);
  if (rule.fixType === 'install_dependency') return buildDepPayload(text);
  if (rule.fixType === 'switch_version') return buildSwitchPayload(text, instanceId);
  return {};
}

function ruleText(rule, lang) {
  const l = lang === 'de' ? 'de' : 'en';
  const pick = v => (v && (v[l] || v.en || v.de)) || '';
  return { title: String(pick(rule.title)), body: String(pick(rule.body)) };
}

function analyze(instanceId) {
  const root = instanceRoot(instanceId);
  const report = newestReport(root, 0);
  let reportText = '';
  if (report) {
    try {
      reportText = readTextCapped(path.join(root, 'crash-reports', report.file), MAX_REPORT_BYTES);
    } catch (err) {
      console.warn('[crashdoctor] Could not read crash report:', err?.message || err);
    }
  }
  const logTail = readLastLines(path.join(root, 'logs', 'latest.log'), LOG_TAIL_LINES, MAX_LOG_BYTES);
  const combined = `${reportText}\n${logTail}`;
  const lower = combined.toLowerCase();
  const rules = loadRules();
  for (const rule of rules) {
    const at = firstMatchIndex(lower, rule.patterns);
    if (at === -1) continue;
    let fixPayload = null;
    try {
      fixPayload = buildFixPayload(rule, combined, instanceId);
    } catch (err) {
      console.warn('[crashdoctor] Payload build failed:', err?.message || err);
      continue;
    }
    if (rule.fixType !== 'none' && !fixPayload) continue;
    const titleDe = ruleText(rule, 'de').title;
    const titleEn = ruleText(rule, 'en').title;
    const bodyDe = ruleText(rule, 'de').body;
    const bodyEn = ruleText(rule, 'en').body;
    return {
      matched: true,
      ruleId: rule.id,
      title: { de: titleDe, en: titleEn },
      body: { de: bodyDe, en: bodyEn },
      fixType: rule.fixType,
      fixPayload: fixPayload || {},
      rawExcerpt: excerptAround(combined, at, 8).slice(0, EXCERPT_CHARS),
      crashFile: report ? report.file : null,
    };
  }
  const fallback = reportText ? reportText.split(/\r?\n/).slice(0, 25).join('\n') : logTail.split(/\r?\n/).slice(-25).join('\n');
  return {
    matched: false,
    ruleId: null,
    title: null,
    body: null,
    fixType: 'none',
    fixPayload: {},
    rawExcerpt: fallback.slice(0, EXCERPT_CHARS),
    crashFile: report ? report.file : null,
  };
}

function scanAfterExit(instanceId, sinceMs) {
  let root;
  try {
    root = instanceRoot(instanceId);
  } catch {
    return null;
  }
  const hit = newestReport(root, (sinceMs || 0) - 2000);
  return hit ? hit.file : null;
}

async function applyFix(instanceId, fixType, fixPayload) {
  const payload = fixPayload && typeof fixPayload === 'object' ? fixPayload : {};
  if (fixType === 'increase_ram') {
    const to = Number(payload.toGb);
    if (!RAM_OPTIONS.includes(to)) throw new Error('Invalid RAM target.');
    const settings = require('../settings');
    settings.updateSettings({ java: { xmx: to } });
    return { ok: true, xmx: to };
  }
  if (fixType === 'disable_mod') {
    const file = path.basename(String(payload.file || ''));
    if (!file) throw new Error('Missing mod file.');
    const content = require('./content');
    const items = content.listInstalled(instanceId, 'mod');
    const current = (Array.isArray(items) ? items : []).find(i => stripDisabledSuffix(String(i.file)) === file);
    if (current && String(current.file).endsWith('.disabled')) return { ok: true, file: current.file, alreadyDisabled: true };
    const res = content.toggleContent(file, instanceId, 'mod');
    return { ok: true, file: res.file, disabled: true };
  }
  if (fixType === 'install_dependency') {
    const mods = Array.isArray(payload.mods)
      ? payload.mods
      : payload.modId
        ? [{ modId: payload.modId }]
        : [];
    const ids = mods.map(m => String((m && m.modId) || '').toLowerCase()).filter(id => DEP_ID_OK.test(id));
    if (!ids.length) throw new Error('Invalid mod id.');
    const content = require('./content');
    const installed = [];
    const warnings = [];
    for (const modId of ids) {
      try {
        const found = await content.searchContent(modId, { instanceId, category: 'mod', limit: 5 });
        const hits = (found && found.results) || [];
        const best =
          hits.find(h => String(h.slug || '').toLowerCase() === modId) ||
          hits.find(h => String(h.id || '').toLowerCase() === modId) ||
          hits[0];
        if (!best) throw new Error(`No Modrinth project found for "${modId}".`);
        const res = await content.installContent(best.id, null, instanceId, null, 'mod', { title: best.title });
        installed.push({ file: res.file, version: res.version, projectId: best.id });
      } catch (err) {
        warnings.push(`${modId}: ${err?.message || err}`);
      }
    }
    if (!installed.length) throw new Error(warnings[0] || 'Dependency install failed.');
    return { ok: true, installed, warnings };
  }
  if (fixType === 'switch_version') throw new Error('Version switch is handled in the UI.');
  throw new Error(`Unknown fix type: ${fixType}`);
}

module.exports = {
  loadRules,
  listReports,
  newestReport,
  readLastLines,
  excerptAround,
  jarMentions,
  buildDepPayload,
  buildSwitchPayload,
  snapRam,
  analyze,
  scanAfterExit,
  applyFix,
};
