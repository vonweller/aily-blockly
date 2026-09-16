#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
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
const filename = path.basename(packed[0].filename);
runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `blockly@file:vendor/${filename}`], {
  cwd: root, stdio: 'inherit',
});
console.log(`Installed ${manifest.name}@${manifest.version}; integrity: ${packed[0].integrity}`);
console.log('Next: npm run test:unit:ci, then the isolated Electron regression suite.');
