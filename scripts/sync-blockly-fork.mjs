#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceArg = process.argv[2];
if (!sourceArg || sourceArg === '--help') {
  console.log('Usage: npm run blockly:sync -- /absolute/path/to/aily-npm-blockly');
  process.exit(sourceArg === '--help' ? 0 : 1);
}
const source = path.resolve(sourceArg);
const dist = path.join(source, 'packages/blockly/dist');
if (!existsSync(path.join(source, 'AILY_FORK.md'))) {
  throw new Error('Expected the Aily v13 fork, not an arbitrary Blockly checkout.');
}
// npm.cmd cannot be executed with execFile on Windows. npm run supplies the
// JS entry point, which also avoids shell quoting for source paths with spaces.
const npmCli = process.env.npm_execpath;
const runNpm = (args, options) => {
  if (npmCli && /npm-cli\.js$/i.test(npmCli)) {
    return execFileSync(process.execPath, [npmCli, ...args], options);
  }
  if (process.platform === 'win32') {
    throw new Error('On Windows, invoke this script with npm run blockly:sync.');
  }
  return execFileSync('npm', args, options);
};
runNpm(['run', 'package'], {cwd: source, stdio: 'inherit'});
const manifest = JSON.parse(readFileSync(path.join(dist, 'package.json'), 'utf8'));
if (manifest.name !== 'aily-project-blockly' || manifest.version !== '13.3.0') {
  throw new Error('Expected aily-project-blockly@13.3.0; review upgrade contracts before changing versions.');
}
const vendor = path.join(root, 'vendor');
mkdirSync(vendor, {recursive: true});
const packed = JSON.parse(runNpm(['pack', dist, '--pack-destination', vendor, '--json'], {
  cwd: root, encoding: 'utf8',
}));
const originalFilename = path.basename(packed[0].filename);
const digest = createHash('sha256').update(readFileSync(path.join(vendor, originalFilename))).digest('hex').slice(0, 12);
// A changed core with the same version must not resolve to a cached tarball.
const filename = originalFilename.replace('.tgz', `-aily.${digest}.tgz`);
renameSync(path.join(vendor, originalFilename), path.join(vendor, filename));
const workspaceFile = path.join(root, 'pnpm-workspace.yaml');
if (existsSync(workspaceFile)) {
  const workspace = readFileSync(workspaceFile, 'utf8');
  if (!/^  blockly:.*$/m.test(workspace)) throw new Error('Missing pnpm Blockly override; update it before syncing.');
  writeFileSync(workspaceFile, workspace.replace(/^  blockly:.*$/m, `  blockly: 'file:vendor/${filename}'`));
}
const usingPnpm = process.env.npm_config_user_agent?.startsWith('pnpm/');
// Keep both lockfiles usable without replacing a pnpm node_modules layout.
runNpm(['install', ...(usingPnpm ? ['--package-lock-only'] : []), '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `blockly@file:vendor/${filename}`], {
  cwd: root, stdio: 'inherit',
});
if (usingPnpm) {
  execFileSync(process.execPath, [npmCli, 'add', '--ignore-scripts', '--save-exact', `blockly@file:vendor/${filename}`], {
    cwd: root, stdio: 'inherit',
  });
}
console.log(`Installed ${manifest.name}@${manifest.version}; integrity: ${packed[0].integrity}`);
console.log('Next: npm run test:unit:ci, then the isolated Electron regression suite.');
