const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    resolveCompileWorkspacePath,
    resolveCompileSourcePath,
    resolveLibrariesPath,
    resolvePreprocessResultPath,
} = require('../scripts/aily-code-project');

test('resolves every Coder compile input under the persistent sketch workspace', t => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aily-coder-workspace-'));
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
    fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({
        type: 'coder',
        entry: 'src/firmware.cpp',
    }));

    assert.equal(resolveCompileWorkspacePath(projectPath), path.join(projectPath, 'sketch'));
    assert.equal(resolveCompileSourcePath(projectPath), path.join(projectPath, 'sketch', 'src', 'firmware.cpp'));
    assert.equal(resolveLibrariesPath(projectPath), path.join(projectPath, 'sketch', 'libraries'));
    assert.equal(resolvePreprocessResultPath(projectPath), path.join(projectPath, 'sketch', 'preprocess.json'));
});

test('rejects a package.json entry that escapes the sketch workspace', t => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aily-coder-workspace-'));
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
    fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({
        type: 'coder',
        entry: '../outside.cpp',
    }));

    assert.throws(
        () => resolveCompileSourcePath(projectPath),
        /escapes the sketch workspace/
    );
});
