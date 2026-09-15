const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** Copy installed build inputs, not user caches/history or links to mutable SDKs. */
function prepareBuildProfile(appData, source, project) {
  const started = Date.now();
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
  const board = Object.keys(manifest.dependencies).find(name => name.startsWith('@aily-project/board-'));
  assert.ok(board, 'An installed board is required');
  const dependencies = JSON.parse(fs.readFileSync(path.join(project, 'node_modules', board, 'package.json'), 'utf8')).boardDependencies;
  const copied = [];
  const copy = relative => {
    const from = path.join(source, relative), to = path.join(appData, relative);
    assert.ok(fs.existsSync(from), 'Missing installed build input: ' + relative);
    assert.ok(!fs.existsSync(to), 'Build fixture must not overwrite: ' + relative);
    console.log('BUILD_INPUT=' + relative);
    fs.cpSync(from, to, { recursive: true, dereference: true }); copied.push(relative);
  };
  for (const [name, version] of Object.entries(dependencies)) {
    assert.match(version, /^\d[\w.-]*$/, 'Build fixture needs exact installed versions');
    const match = /^@aily-project\/(compiler|sdk|tool)-([\w-]+)$/.exec(name);
    assert.ok(match, 'Unsupported platform package: ' + name);
    const [, kind, short] = match;
    const directory = kind === 'sdk' ? `sdk/${short}_${version}` : kind === 'compiler'
      ? `compiler/${short}@${version}` : `tools/${short.startsWith('idf_') ? 'esp32-arduino-libs' : short}@${version}`;
    if (!copied.includes(directory)) copy(directory);
  }
  // Keep managed CLI installation isolated too; exclude the user's subapp junction/profile.
  copy('npm-global/node_modules');
  for (const name of fs.readdirSync(path.join(source, 'npm-global'))) {
    if (/^aily-(?:builder|connector|linter)(?:\.(?:cmd|ps1|exe))?$/.test(name)) copy('npm-global/' + name);
  }
  return { board, dependencies, copied, durationMs: Date.now() - started };
}

module.exports = { prepareBuildProfile };
