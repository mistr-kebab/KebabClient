'use strict';

const os = require('node:os');
const { MC_VERSION, instanceDir } = require('../config');
const { setEmitter } = require('./minecraft/events');
const paths = require('./minecraft/paths');
const download = require('./minecraft/download');
const launch = require('./minecraft/launch');
const java = require('./minecraft/java');

module.exports = {
  setEmitter,
  isRunning: launch.isRunning,
  runningInstanceId: launch.runningInstanceId,
  ensureClient: download.ensureClient,
  launchGame: launch.launchGame,
  stopGame: launch.stopGame,
  instanceDir,
  dirsFor: paths.dirsFor,
  gameDataDir: paths.gameDataDir,
  buildLaunchArgs: launch.buildLaunchArgs,
  rulesAllow: download.rulesAllow,
  parseServerAddress: launch.parseServerAddress,
  supportsQuickPlay: launch.supportsQuickPlay,
  assertJavaAvailable: java.assertJavaAvailable,
  ensureJavaRuntime: java.ensureJavaRuntime,
  requiredJavaMajor: java.requiredJavaMajor,
  getJavaMajor: java.getJavaMajor,
  MC_VERSION,
  platformInfo: () => ({ platform: process.platform, arch: os.arch() })
};
