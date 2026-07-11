#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const blocklyRoot = path.resolve(__dirname, '..');
const builderRoot = path.resolve(process.env.AILY_BUILDER_DEV_PATH || path.join(blocklyRoot, '..', 'aily-builder'));
const localVersion = '9999.0.0-local';
const actions = new Set(['toggle', 'local', 'official', 'status']);

function printHelp() {
  console.log(`Usage:
  npm run builder:switch   # toggle local / official
  npm run builder:local    # build and activate ../aily-builder
  npm run builder:official # restore the saved official package
  npm run builder:status   # show the current mode

Set AILY_BUILDER_DEV_PATH when aily-builder is not next to this repository.
`);
}

function readJson(filePath, label = 'JSON file') {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${filePath}\n${error.message}`);
  }
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

function normalizePath(filePath) {
  const result = path.resolve(filePath).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? result.toLowerCase() : result;
}

function getAppDataRoot() {
  if (process.env.AILY_NPM_PREFIX || process.env.AILY_APPDATA_PATH) {
    return path.resolve(process.env.AILY_NPM_PREFIX || process.env.AILY_APPDATA_PATH);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'aily-project');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'aily-project');
  return path.join(os.homedir(), '.config', 'aily-project');
}

function getChannel(appDataRoot) {
  const configPath = path.join(appDataRoot, 'config.json');
  if (fs.existsSync(configPath)) {
    return readJson(configPath)?.labs?.ailyBuilderNext ? 'next' : 'stable';
  }
  const channel = process.env.AILY_BUILDER_CHANNEL || 'stable';
  if (!['stable', 'next'].includes(channel)) throw new Error(`Invalid aily-builder channel: ${channel}`);
  return channel;
}

function createContext() {
  const appDataRoot = getAppDataRoot();
  const channel = getChannel(appDataRoot);
  const platform = `${process.platform}-${process.arch}`;
  if (!['win32-x64', 'darwin-arm64'].includes(platform)) {
    throw new Error(`Unsupported aily-builder platform: ${platform}`);
  }
  const name = `@aily-project/${channel === 'next' ? 'aily-builder-next' : 'aily-builder'}-${platform}`;
  const channelRoot = path.join(appDataRoot, 'packages', 'aily-builder', 'channels', channel);
  const devPrefix = path.join(channelRoot, 'dev');
  return {
    channel,
    name,
    versionsRoot: path.join(channelRoot, 'versions'),
    devPrefix,
    devPath: path.join(devPrefix, 'node_modules', ...name.split('/')),
    currentFile: path.join(channelRoot, 'current.json'),
    backupFile: path.join(channelRoot, 'current.official.json'),
  };
}

function requiredFiles(packagePath) {
  return [
    path.join(packagePath, 'index.js'),
    path.join(packagePath, 'node_modules', 'tree-sitter', 'build', 'Release', 'tree_sitter_runtime_binding.node'),
    path.join(packagePath, 'node_modules', 'tree-sitter-cpp', 'build', 'Release', 'tree_sitter_cpp_binding.node'),
  ];
}

function assertComplete(packagePath, label) {
  const missing = requiredFiles(packagePath).filter((filePath) => !fs.existsSync(filePath));
  if (missing.length) throw new Error(`${label} is incomplete. Missing:\n${missing.join('\n')}`);
}

function getRealPath(filePath) {
  return fs.existsSync(filePath) ? fs.realpathSync.native(filePath) : null;
}

function getLstat(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function pathsMatch(pathA, pathB) {
  const realA = getRealPath(pathA);
  const realB = getRealPath(pathB);
  return !!realA && !!realB && normalizePath(realA) === normalizePath(realB);
}

function validateCurrent(current, context, label) {
  for (const key of ['channel', 'version', 'packageName', 'prefix', 'path']) {
    if (!current?.[key] || typeof current[key] !== 'string') throw new Error(`${label} is missing "${key}"`);
  }
  if (current.channel !== context.channel || current.packageName !== context.name) {
    throw new Error(`${label} does not match ${context.channel}/${context.name}`);
  }
  const expectedPath = path.join(current.prefix, 'node_modules', ...current.packageName.split('/'));
  if (normalizePath(current.path) !== normalizePath(expectedPath)) {
    throw new Error(`${label} contains an unexpected package path: ${current.path}`);
  }
  if (normalizePath(current.prefix) === normalizePath(context.devPrefix) && current.development === true) {
    return 'local';
  }
  if (normalizePath(path.dirname(current.prefix)) === normalizePath(context.versionsRoot) && current.development !== true) {
    return 'official';
  }
  throw new Error(`${label} points outside the managed ${context.channel} channel`);
}

function loadPointer(filePath, context, label) {
  const value = readJson(filePath, label);
  return { value, mode: validateCurrent(value, context, filePath) };
}

function assertUnchanged(context, expected) {
  const latest = loadPointer(context.currentFile, context, 'current.json').value;
  if (JSON.stringify(latest) !== JSON.stringify(expected)) {
    throw new Error('current.json changed while switching; nothing was activated. Run the command again.');
  }
}

function isRealOfficialPackage(current) {
  const stat = getLstat(current.path);
  return !!stat && !stat.isSymbolicLink() && normalizePath(getRealPath(current.path)) === normalizePath(current.path);
}

function assertOfficial(current) {
  assertComplete(current.path, 'Official aily-builder package');
  if (!isRealOfficialPackage(current)) {
    throw new Error(
      `The official path is itself a link: ${current.path}\n` +
      'Reinstall that registry version once before using this script.'
    );
  }
}

function resolveBundledTools() {
  const childNode = path.join(blocklyRoot, 'child', 'node');
  const nodePath = process.platform === 'win32'
    ? path.join(childNode, 'node.exe')
    : path.join(childNode, 'bin', 'node');
  const npmCli = process.platform === 'win32'
    ? path.join(childNode, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : path.join(childNode, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(nodePath) && fs.existsSync(npmCli)) {
    return { node: nodePath, npmCli };
  }
  throw new Error(
    `Aily Blockly bundled Node/npm was not found under ${childNode}. ` +
    'Run the Aily Blockly development environment once so child/node is prepared.'
  );
}

const bundledTools = resolveBundledTools();

function runBundledNpm(args, cwd, label) {
  console.log(`\n[aily-builder] ${label}`);
  console.log(`[aily-builder] npm: ${bundledTools.node} ${bundledTools.npmCli}`);
  const result = spawnSync(bundledTools.node, [bundledTools.npmCli, ...args], {
    cwd,
    env: process.env,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw new Error(`Unable to start bundled npm: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
}

function runSystemNpm(args, cwd, label) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log(`\n[aily-builder] ${label}`);
  console.log(`[aily-builder] npm: ${npmCommand} (system PATH)`);
  const result = spawnSync(npmCommand, args, {
    cwd,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.error) throw new Error(`Unable to start system npm: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
}

function buildBundleWithSystemNpm() {
  if (!fs.existsSync(path.join(builderRoot, 'node_modules'))) {
    runSystemNpm(
      ['install', '--package-lock=false', '--no-audit', '--no-fund'],
      builderRoot,
      'Installing local aily-builder dependencies with system npm...'
    );
  }
  runSystemNpm(['run', 'bundle:native:minify'], builderRoot, 'Building local bundle with system npm...');
}

function installBundleWithBundledNpm(context, bundlePath) {
  runBundledNpm([
    'install',
    bundlePath,
    '--prefix', context.devPrefix,
    '--install-links=false',
    '--bin-links=false',
    '--no-save',
    '--package-lock=false',
    '--no-audit',
    '--no-fund',
  ], blocklyRoot, 'Installing local bundle into Aily Blockly with bundled npm...');
}

function smokeTest(context) {
  const result = spawnSync(bundledTools.node, [path.join(context.devPath, 'index.js'), '--help'], {
    cwd: blocklyRoot,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw new Error(`Unable to start local aily-builder: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`Local aily-builder smoke test failed${detail ? `:\n${detail}` : ''}`);
  }
}

function printStatus(context, current, mode) {
  const displayMode = mode === 'official' && !isRealOfficialPackage(current) ? 'official-linked-invalid' : mode;
  console.log(`
[aily-builder] mode:     ${displayMode}
[aily-builder] channel:  ${context.channel}
[aily-builder] package:  ${current.packageName}@${current.version}
[aily-builder] path:     ${current.path}
[aily-builder] resolved: ${getRealPath(current.path) || '(missing)'}
[aily-builder] backup:   ${fs.existsSync(context.backupFile) ? context.backupFile : '(missing)'}
`);
}

function switchToLocal(context, current, mode) {
  const official = mode === 'official'
    ? current
    : loadPointer(context.backupFile, context, 'official backup').value;
  if (validateCurrent(official, context, context.backupFile) !== 'official') {
    throw new Error('The saved official pointer is invalid');
  }
  assertOfficial(official);

  let expected = current;
  if (mode === 'local') {
    assertUnchanged(context, current);
    writeJsonAtomic(context.currentFile, official);
    expected = official;
    console.log('[aily-builder] Official pointer restored while rebuilding; a failed build will stay official.');
  }

  if (!fs.existsSync(path.join(builderRoot, 'package.json'))) {
    throw new Error(`Local aily-builder repository was not found: ${builderRoot}`);
  }
  console.log('[aily-builder] Ensure Aily Blockly is not compiling, linting or uploading.');
  buildBundleWithSystemNpm();

  const bundlePath = path.join(builderRoot, 'dist', 'bundle-min');
  const bundlePackage = readJson(path.join(bundlePath, 'package.json'), 'local bundle package.json');
  if (bundlePackage.name !== context.name) {
    throw new Error(`Bundle package mismatch: ${bundlePackage.name}; expected ${context.name}`);
  }
  assertComplete(bundlePath, 'Local aily-builder bundle');
  installBundleWithBundledNpm(context, bundlePath);
  assertComplete(context.devPath, 'Managed local aily-builder package');
  if (!pathsMatch(context.devPath, bundlePath)) throw new Error('Unable to link the local bundle');
  smokeTest(context);

  assertUnchanged(context, expected);
  if (mode === 'official') writeJsonAtomic(context.backupFile, official);
  const local = {
    channel: context.channel,
    version: localVersion,
    localVersion: bundlePackage.version,
    officialVersion: official.version,
    packageName: context.name,
    prefix: context.devPrefix,
    path: context.devPath,
    development: true,
    bundlePath,
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(context.currentFile, local);
  printStatus(context, local, 'local');
  console.log('[aily-builder] Switched to local. Restart Aily Blockly.');
}

function switchToOfficial(context, current, mode) {
  if (mode === 'official') {
    assertOfficial(current);
    printStatus(context, current, mode);
    console.log('[aily-builder] Official is already active.');
    return;
  }
  const backup = loadPointer(context.backupFile, context, 'official backup');
  if (backup.mode !== 'official') throw new Error('The saved official pointer is invalid');
  assertOfficial(backup.value);
  assertUnchanged(context, current);
  writeJsonAtomic(context.currentFile, backup.value);
  printStatus(context, backup.value, 'official');
  console.log('[aily-builder] Switched to official. Restart Aily Blockly.');
}

function main() {
  const action = process.argv[2] || 'toggle';
  if (action === '--help' || action === '-h') return printHelp();
  if (!actions.has(action) || process.argv.length > 3) throw new Error(`Unknown command: ${process.argv.slice(2).join(' ')}`);

  const context = createContext();
  const current = loadPointer(context.currentFile, context, 'current.json');
  if (action === 'status') return printStatus(context, current.value, current.mode);
  const target = action === 'toggle' ? (current.mode === 'local' ? 'official' : 'local') : action;
  if (target === 'local') return switchToLocal(context, current.value, current.mode);
  return switchToOfficial(context, current.value, current.mode);
}

try {
  main();
} catch (error) {
  console.error(`\n[aily-builder] ${error.message}`);
  process.exitCode = 1;
}
