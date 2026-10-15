// Executed by the bundled Node, with npm's own config and dependency resolver.
// The request/result travel over pipes; no project draft files are created.
async function run(request) {
  const path = require('node:path');
  const Npm = require(path.join(request.npmRoot, 'lib/npm.js'));
  const Arborist = require(path.join(request.npmRoot, 'node_modules/@npmcli/arborist'));
  const npa = require(path.join(request.npmRoot, 'node_modules/npm-package-arg'));
  // node -e has no script argument. npm config expects argv[0:2] to be
  // executable/script, otherwise it drops the install command.
  process.argv = [process.execPath, 'npm'];
  const npm = new Npm({ argv: ['install', '--no-audit', '--no-fund', '--foreground-scripts'] });
  try {
    await npm.load();
    const additions = new Map((request.add || []).map(spec => [npa(spec).name, spec]));
    for (const spec of request.install || []) additions.set(npa(spec).name, spec);
    const options = { ...npm.flatOptions, ...request.options, path: process.cwd(),
      global: false, workspaces: false, audit: false, fund: false,
      add: [...additions.values()], rm: (request.remove || []).filter(name => !additions.has(name)), save: request.save === true,
      savePrefix: '', packageLockOnly: request.save === true, foregroundScripts: true };
    const arb = new Arborist(options);
    await arb.reify(options);
    const tree = arb.actualTree || arb.idealTree;
    const manifest = JSON.parse(JSON.stringify(tree.package));
    delete manifest._id;
    if (!request.save) for (const name of additions.keys()) {
      // npm accepts a dangling file: link as a successful reify. The library
      // manager must not acknowledge a package that cannot actually be loaded.
      const node = tree.children.get(name);
      const file = node && path.join(node.path, 'package.json');
      if (!file || !require('node:fs').existsSync(file)) throw new Error(`Installed library is missing package.json: ${name}`);
    }
    // Preserve file/link specs, but pin newly resolved registry versions so a
    // later operation/save cannot silently upgrade an unsaved installation.
    for (const name of additions.keys()) {
      const node = tree.children.get(name);
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        const spec = manifest[field]?.[name];
        if (spec && node?.version && npa.resolve(name, spec).registry) manifest[field][name] = node.version;
      }
    }
    return { manifest };
  } finally { npm.unload(); }
}

if (require.main === module || process.env.AILY_LIBRARY_WORKER === '1') {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', value => { input += value; });
  process.stdin.on('end', () => run(JSON.parse(input)).then(
    result => { process.send({ ok: true, ...result }); process.disconnect(); },
    error => { process.send({ ok: false, error: error.message }); process.disconnect(); process.exitCode = 1; },
  ));
}
