// Keep the linked package available while Blockly's `gulp pack` clears dist.
// Usage: node scripts/watch-blockly-source.cjs /path/to/aily-npm-blockly [--watch]
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const args = process.argv.slice(2);
const sourceArg = args.find((arg) => !arg.startsWith('--'));
if (
  !sourceArg ||
  args.some((arg) => arg.startsWith('--') && arg !== '--watch')
) {
  console.error(
    'Usage: node scripts/watch-blockly-source.cjs SOURCE_REPO [--watch]',
  );
  process.exit(1);
}
const source = fs.realpathSync(sourceArg);
const packageRoot = path.join(source, 'packages/blockly');
const dist = path.join(packageRoot, 'dist');
const stable = path.join(source, 'node_modules/.cache/aily-live-blockly');
const gulp = path.join(source, 'node_modules/gulp/bin/gulp.js');
if (
  JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'))).name !==
  'blockly'
) {
  throw new Error('SOURCE_REPO must contain packages/blockly.');
}
const watching = args.includes('--watch');
let child;
let running = false;
let pending = false;
let closing = false;
let timer;
const watchers = [];

function publish() {
  for (const required of [
    'package.json',
    'index.js',
    'blockly_compressed.js',
  ]) {
    if (!fs.statSync(path.join(dist, required)).isFile())
      throw new Error(`Missing ${required}`);
  }
  const files = fs
    .readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(dist, path.join(entry.parentPath, entry.name)),
    )
    .sort(
      (a, b) => Number(a === 'package.json') - Number(b === 'package.json'),
    );
  let changed = 0;
  for (const file of files) {
    const target = path.join(stable, file);
    const contents = fs.readFileSync(path.join(dist, file));
    if (fs.existsSync(target) && fs.readFileSync(target).equals(contents))
      continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.publish-${process.pid}`;
    fs.writeFileSync(temporary, contents);
    fs.renameSync(temporary, target);
    changed++;
  }
  // Do not remove this directory: Angular and plugin peers resolve it once.
  // Obsolete files are harmless for local development; new exports come last.
  console.log(
    `[blockly-source] Published ${changed} changed files to ${stable}`,
  );
}

async function rebuild() {
  if (closing) return;
  if (running) {
    pending = true;
    return;
  }
  running = true;
  pending = false;
  try {
    console.log('[blockly-source] Building source package...');
    // Same pack task as npm run package, with npm's local binary search paths.
    child = spawn(process.execPath, [gulp, 'pack', '--cwd', packageRoot], {
      cwd: source,
      stdio: 'inherit',
      env: {
        ...process.env,
        PATH: [
          path.join(packageRoot, 'node_modules/.bin'),
          path.join(source, 'node_modules/.bin'),
          path.dirname(process.execPath),
          process.env.PATH || '',
        ].join(path.delimiter),
      },
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code !== 0) throw new Error(`Blockly pack exited with ${code}`);
    if (!closing) publish();
  } catch (error) {
    console.error(
      '[blockly-source] Build failed; linked package retains the last successful build.',
      error,
    );
    if (!watching) process.exitCode = 1;
  } finally {
    child = undefined;
    running = false;
    if (pending && !closing) void rebuild();
  }
}

if (watching) {
  for (const folder of ['core', 'blocks', 'generators', 'msg']) {
    const directory = path.join(packageRoot, folder);
    if (!fs.existsSync(directory)) continue;
    watchers.push(
      fs.watch(directory, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => void rebuild(), 250);
      }),
    );
  }
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      closing = true;
      clearTimeout(timer);
      watchers.forEach((watcher) => watcher.close());
      child?.kill('SIGTERM');
    });
}
void rebuild();
