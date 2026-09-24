'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { getStoredProfile, getValidMcAccessToken } = require('../auth');
const { getInstance, getActiveInstance, touchLastPlayed } = require('../instances');
const { emit } = require('./events');
const { dirsFor, markerFile } = require('./paths');
const { rulesAllow, libraryArtifactPath, isEnsuring } = require('./download');
const { javaSettings, ensureJavaRuntime, requiredJavaMajor, getJavaMajor } = require('./java');

let child = null;
let runningInstanceId = null;
let stopRequested = false;

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

function parseServerAddress(addr) {
  const s = String(addr || '').trim();
  if (!s) return null;
  const idx = s.lastIndexOf(':');
  if (idx > 0 && /^[0-9]+$/.test(s.slice(idx + 1))) {
    return { host: s.slice(0, idx), port: Number(s.slice(idx + 1)) };
  }
  return { host: s, port: 25565 };
}

function supportsQuickPlay(mc) {
  const s = String(mc || '').trim();
  let m = s.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (m) {
    if (Number(m[1]) !== 1) return true;
    const minor = Number(m[2]);
    const patch = m[3] === undefined ? 0 : Number(m[3]);
    return minor > 20 || (minor === 20 && patch >= 2);
  }
  m = s.match(/^(\d+)w(\d+)[a-z]$/i);
  if (m) {
    const yy = Number(m[1]);
    const ww = Number(m[2]);
    return yy > 23 || (yy === 23 && ww >= 31);
  }
  return false;
}

function launchFeatures() {
  return {
    is_demo_user: false,
    has_custom_resolution: false,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false,
  };
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

async function launchGame(instanceId, serverAddr) {
  if (child) throw new Error('Game is already running.');
  const instance = instanceId ? getInstance(instanceId) : getActiveInstance();
  if (!instance) throw new Error('No instance selected. Create one first.');
  if (isEnsuring(instance.id)) {
    throw new Error(`Verify is still running for "${instance.name}". Wait until it finishes, then press Play.`);
  }
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
  try {
    marker = JSON.parse(fs.readFileSync(markerFile(inst, variant), 'utf8'));
  } catch {
    marker = null;
  }
  if (!marker || marker.variant !== variant) {
    throw new Error(
      `Instance "${instance.name}" is not fully verified yet. Press Download / verify, wait until it finishes, then press Play.`
    );
  }
  let versionJson;
  try {
    versionJson = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
  } catch {
    throw new Error(
      `Instance "${instance.name}" has a corrupt or incomplete version file. Press Download / verify again.`
    );
  }
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
    classpath,
  };

  const { jvmArgs, gameArgs } = buildLaunchArgs(versionJson, vars);
  const joinTarget = parseServerAddress(serverAddr);
  if (joinTarget) {
    if (supportsQuickPlay(instance.mc)) {
      gameArgs.push('--quickPlayMultiplayer', `${joinTarget.host}:${joinTarget.port}`);
    } else {
      gameArgs.push('--server', joinTarget.host, '--port', String(joinTarget.port));
    }
  }
  if (!jvmArgs.some(a => a.startsWith('-Djava.library.path='))) {
    jvmArgs.push('-Djava.library.path=' + natives);
  }
  if (!jvmArgs.includes('-cp')) {
    jvmArgs.push('-cp', classpath);
  }
  const javaOpts = javaSettings();
  if (javaOpts.xmx > 0 && !jvmArgs.some(a => /^-Xmx/i.test(a))) {
    jvmArgs.unshift(`-Xmx${javaOpts.xmx}G`);
  }
  const extra = javaOpts.extraArgs.split(/\s+/).filter(Boolean);
  if (extra.length) jvmArgs.push(...extra);

  const mainClass = versionJson.mainClass;
  const requiredMajor = requiredJavaMajor(versionJson);
  const java = await ensureJavaRuntime(requiredMajor, (ratio, label) => {
    emit('game:progress', { phase: 'java', ratio, label, instanceId: instance.id, instanceName: instance.name });
  });
  let launchJvmArgs = jvmArgs;
  const javaMajor = await getJavaMajor(java).catch(() => null);
  if (
    javaMajor !== null &&
    javaMajor < 23 &&
    jvmArgs.some(a => String(a).startsWith('--sun-misc-unsafe-memory-access'))
  ) {
    launchJvmArgs = jvmArgs.filter(a => !String(a).startsWith('--sun-misc-unsafe-memory-access'));
    emit('game:log', {
      stream: 'system',
      line: `Ignoring --sun-misc-unsafe-memory-access (needs Java 23+, running Java ${javaMajor}).`,
    });
  }
  const args = [...launchJvmArgs, mainClass, ...gameArgs];

  emit('game:status', { running: true, pid: null, instanceId: instance.id });
  emit('game:log', {
    stream: 'system',
    line: `Launching ${instance.name} (${variant}) as ${profile.name} [java: ${java}, needs Java ${requiredMajor}+, Xmx: ${javaOpts.xmx}G]`,
  });

  child = spawn(java, args, { cwd: inst, env: { ...process.env } });
  touchLastPlayed(instance.id);
  runningInstanceId = instance.id;
  const playStart = Date.now();
  const playId = instance.id;
  try {
    require('../discord').showGame(instance.name);
  } catch {}
  emit('game:status', { running: true, pid: child.pid || null, instanceId: playId });

  const pump = stream => chunk => {
    const text = chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue;
      try {
        require('../discord').handleGameLine(line);
      } catch {}
      emit('game:log', { stream, line: line.slice(0, 4000) });
    }
  };
  child.stdout.on('data', pump('stdout'));
  child.stderr.on('data', pump('stderr'));
  child.on('error', err => {
    emit('game:log', { stream: 'system', line: `Failed to start Java: ${err.message}` });
    emit('game:status', { running: false, pid: null, error: err.message, instanceId: playId });
    child = null;
    runningInstanceId = null;
  });
  child.on('exit', (code, signal) => {
    try {
      require('../instances').addPlaytime(playId, Date.now() - playStart);
    } catch {}
    try {
      require('../discord').clearGame();
    } catch {}
    emit('game:log', { stream: 'system', line: `Game exited (code=${code} signal=${signal || '-'})` });
    emit('game:status', { running: false, pid: null, code, instanceId: playId });
    const wasStopped = stopRequested;
    stopRequested = false;
    child = null;
    runningInstanceId = null;
    if (code !== 0 && !wasStopped) {
      try {
        const file = require('../crashDoctor').scanAfterExit(playId, playStart);
        emit('crash:detected', { instanceId: playId, crash: !!file, file: file || null });
      } catch (err) {
        console.warn('[launch] Crash scan failed:', err?.message || err);
      }
    }
  });
  return { pid: child.pid || null };
}

function stopGame() {
  if (!child) return { stopped: false };
  stopRequested = true;
  try {
    if (process.platform === 'win32') child.kill();
    else child.kill('SIGTERM');
  } catch {}
  return { stopped: true };
}

module.exports = {
  isRunning,
  runningInstanceId: () => runningInstanceId,
  launchGame,
  stopGame,
  buildLaunchArgs,
  parseServerAddress,
  supportsQuickPlay,
};
