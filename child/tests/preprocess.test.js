const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    collectComponentLibraries,
    collectWorkspaceLibraries,
    collectLibraryPackages,
    normalizeExtractedSourceDirectory,
    processComponentLibraries,
    processLibrariesParallel,
} = require('../scripts/preprocess');
const {
    readPlatformRefFromProjectPackage,
    resolveEffectiveBoardDependencies,
} = require('../scripts/platform-runtime');

function createPackage(packagePath, packageJson) {
    fs.mkdirSync(packagePath, { recursive: true });
    fs.writeFileSync(
        path.join(packagePath, 'package.json'),
        JSON.stringify(packageJson, null, 2)
    );
}

test('collects indirect libraries recursively without duplicates or cycles', t => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aily-preprocess-test-'));
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));

    const miaouiPath = path.join(projectPath, 'node_modules', '@aily-project', 'lib-miaoui');
    const u8g2Path = path.join(projectPath, 'node_modules', '@aily-project', 'lib-u8g2');

    createPackage(miaouiPath, {
        name: '@aily-project/lib-miaoui',
        dependencies: {
            '@aily-project/lib-u8g2': '1.0.10',
        },
    });
    createPackage(u8g2Path, {
        name: '@aily-project/lib-u8g2',
        dependencies: {
            '@aily-project/lib-miaoui': '1.0.0',
        },
    });

    const result = collectLibraryPackages({
        '@aily-project/lib-miaoui': '^1.0.0',
        '@aily-project/lib-core-io': '1.0.0',
    }, projectPath);

    assert.deepEqual(result, [
        '@aily-project/lib-miaoui',
        '@aily-project/lib-u8g2',
    ]);
});

test('copies recursively collected libraries into the compiler libraries directory', async t => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aily-preprocess-test-'));
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));

    const miaouiPath = path.join(projectPath, 'node_modules', '@aily-project', 'lib-miaoui');
    const u8g2Path = path.join(projectPath, 'node_modules', '@aily-project', 'lib-u8g2');
    const librariesPath = path.join(projectPath, '.temp', 'libraries');

    createPackage(miaouiPath, {
        name: '@aily-project/lib-miaoui',
        dependencies: {
            '@aily-project/lib-u8g2': '1.0.10',
        },
    });
    createPackage(u8g2Path, {
        name: '@aily-project/lib-u8g2',
        dependencies: {},
    });
    fs.mkdirSync(path.join(miaouiPath, 'src', 'MiaoUI'), { recursive: true });
    fs.writeFileSync(path.join(miaouiPath, 'src', 'MiaoUI', 'MiaoUI.h'), '#pragma once\n');
    fs.mkdirSync(path.join(u8g2Path, 'src', 'u8g2'), { recursive: true });
    fs.writeFileSync(path.join(u8g2Path, 'src', 'u8g2', 'U8g2lib.h'), '#pragma once\n');
    fs.mkdirSync(librariesPath, { recursive: true });

    const libraries = collectLibraryPackages({
        '@aily-project/lib-miaoui': '^1.0.0',
    }, projectPath);
    const copiedLibraries = await processLibrariesParallel(
        libraries,
        librariesPath,
        projectPath,
        '7za',
        false,
        {}
    );

    assert.deepEqual(copiedLibraries.sort(), ['MiaoUI', 'u8g2']);
    assert.equal(fs.existsSync(path.join(librariesPath, 'MiaoUI', 'MiaoUI.h')), true);
    assert.equal(fs.existsSync(path.join(librariesPath, 'u8g2', 'U8g2lib.h')), true);
});

test('normalizes extracted library archives into src directory', t => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aily-preprocess-test-'));
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));

    const packagePath = path.join(projectPath, 'node_modules', '@aily-project', 'lib-miaoui');
    const sourcePath = path.join(packagePath, 'src');
    const flatExtractPath = path.join(packagePath, '.flat-extract');
    fs.mkdirSync(flatExtractPath, { recursive: true });
    fs.writeFileSync(path.join(flatExtractPath, 'MiaoUI.h'), '#pragma once\n');

    normalizeExtractedSourceDirectory(flatExtractPath, sourcePath);

    assert.equal(fs.existsSync(path.join(sourcePath, 'MiaoUI.h')), true);
    assert.equal(fs.existsSync(flatExtractPath), false);

    const nestedExtractPath = path.join(packagePath, '.nested-extract');
    fs.mkdirSync(path.join(nestedExtractPath, 'src'), { recursive: true });
    fs.writeFileSync(path.join(nestedExtractPath, 'src', 'MiaoUI.cpp'), 'void setup() {}\n');

    normalizeExtractedSourceDirectory(nestedExtractPath, sourcePath);

    assert.equal(fs.existsSync(path.join(sourcePath, 'MiaoUI.cpp')), true);
    assert.equal(fs.existsSync(path.join(sourcePath, 'MiaoUI.h')), false);
    assert.equal(fs.existsSync(path.join(nestedExtractPath, 'src')), false);

    const mixedExtractPath = path.join(packagePath, '.mixed-extract');
    fs.mkdirSync(path.join(mixedExtractPath, 'src'), { recursive: true });
    fs.writeFileSync(path.join(mixedExtractPath, 'src', 'Nested.h'), '#pragma once\n');
    fs.writeFileSync(path.join(mixedExtractPath, 'README.md'), 'library notes\n');

    normalizeExtractedSourceDirectory(mixedExtractPath, sourcePath);

    assert.equal(fs.existsSync(path.join(sourcePath, 'src', 'Nested.h')), true);
    assert.equal(fs.existsSync(path.join(sourcePath, 'README.md')), true);
    assert.equal(fs.existsSync(mixedExtractPath), false);
});

test('collects only immediate project component library roots', t => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aily-preprocess-components-'));
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));

    fs.mkdirSync(path.join(projectPath, 'components', 'BlinkPattern', 'src'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'components', 'WireCompat', 'src'), { recursive: true });
    fs.writeFileSync(path.join(projectPath, 'components', 'README.md'), 'not a library root\n');
    fs.mkdirSync(path.join(projectPath, 'components', '.cache'), { recursive: true });

    const result = collectComponentLibraries(projectPath);

    assert.deepEqual(result.map(item => item.name), ['BlinkPattern', 'WireCompat']);
    assert.deepEqual(
        result.map(item => item.sourcePath),
        [
            path.join(projectPath, 'components', 'BlinkPattern'),
            path.join(projectPath, 'components', 'WireCompat'),
        ]
    );
});

test('materializes Arduino-layout components as compiler libraries', async t => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aily-preprocess-components-'));
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));

    const componentRoot = path.join(projectPath, 'components', 'BlinkPattern');
    const librariesPath = path.join(projectPath, '.temp', 'libraries');
    fs.mkdirSync(path.join(componentRoot, 'src'), { recursive: true });
    fs.mkdirSync(librariesPath, { recursive: true });
    fs.writeFileSync(
        path.join(componentRoot, 'library.properties'),
        'name=BlinkPattern\nversion=1.0.0\narchitectures=*\n'
    );
    fs.writeFileSync(path.join(componentRoot, 'src', 'BlinkPattern.h'), '#pragma once\n');
    fs.writeFileSync(path.join(componentRoot, 'src', 'BlinkPattern.cpp'), '#include "BlinkPattern.h"\n');

    const copied = await processComponentLibraries(
        collectComponentLibraries(projectPath),
        librariesPath
    );

    assert.deepEqual(copied, ['BlinkPattern']);
    assert.equal(
        fs.readFileSync(path.join(librariesPath, 'BlinkPattern', 'library.properties'), 'utf8'),
        'name=BlinkPattern\nversion=1.0.0\narchitectures=*\n'
    );
    assert.equal(
        fs.existsSync(path.join(librariesPath, 'BlinkPattern', 'src', 'BlinkPattern.cpp')),
        true
    );
});

test('uses Coder sketch/libraries directories directly as compiler inputs', t => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aily-coder-sketch-libraries-'));
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));

    const librariesPath = path.join(projectPath, 'sketch', 'libraries');
    fs.mkdirSync(path.join(librariesPath, 'Servo', 'src'), { recursive: true });
    fs.mkdirSync(path.join(librariesPath, '.cache'), { recursive: true });
    fs.writeFileSync(path.join(librariesPath, 'README.md'), 'not a library root\n');

    const result = collectWorkspaceLibraries(librariesPath);
    assert.deepEqual(result.map(item => item.name), ['Servo']);
    assert.equal(result[0].sourcePath, path.join(librariesPath, 'Servo'));
});

test('resolves Coder compiler and SDK dependencies from the platform manifest', t => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aily-preprocess-platform-'));
    const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aily-appdata-platform-'));
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
    t.after(() => fs.rmSync(appDataPath, { recursive: true, force: true }));

    const platformName = '@aily-project/platform-avr-arduino';
    fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({
        type: 'coder',
        platform: platformName,
    }));
    const platformPath = path.join(appDataPath, 'node_modules', platformName);
    fs.mkdirSync(platformPath, { recursive: true });
    fs.writeFileSync(path.join(platformPath, 'platform.json'), JSON.stringify({
        runtimeDependencies: [
            { package: '@aily-project/compiler-avr-gcc', version: '7.3.0' },
            { package: '@aily-project/sdk-arduino-avr', version: '1.8.6' },
        ],
    }));

    const platformRef = readPlatformRefFromProjectPackage(projectPath);
    const result = resolveEffectiveBoardDependencies(
        { '@aily-project/tool-avrdude': '6.3.0' },
        appDataPath,
        platformRef.packageName
    );

    assert.deepEqual(result, {
        '@aily-project/tool-avrdude': '6.3.0',
        '@aily-project/compiler-avr-gcc': '7.3.0',
        '@aily-project/sdk-arduino-avr': '1.8.6',
    });
});

test('does not apply Coder platform configuration to Blockly projects', t => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aily-blockly-platform-'));
    t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));

    fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({
        name: 'blockly-project',
        devmode: 'arduino',
        platform: '@aily-project/platform-avr-arduino',
    }));

    assert.equal(readPlatformRefFromProjectPackage(projectPath), null);
});
