import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import createJiti from 'jiti'

const jiti = createJiti(import.meta.url)
const {
  applyCoderProjectPackageConfig,
  copyCoderArduinoTemplate,
  isCoderProjectPackage,
  resolveCoderTemplatePath
} = jiti('../src/app/services/coder-project-template.ts')

const pathApi = {
  join: path.join,
  isExists: fs.existsSync
}

const fsApi = {
  copySync: (source, destination) => fs.cpSync(source, destination, { recursive: true }),
  mkdirSync: (directory) => fs.mkdirSync(directory, { recursive: true })
}

test('copies template_arduino package.json and project.aci source to sketch/src/main.cpp', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aily-coder-template-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const boardPackagePath = path.join(root, 'board-package')
  const templatePath = path.join(boardPackagePath, 'template_arduino')
  const projectPath = path.join(root, 'project')
  const source = '#include <Arduino.h>\n\nvoid setup() {}\nvoid loop() {}\n'
  fs.mkdirSync(templatePath, { recursive: true })
  fs.mkdirSync(projectPath, { recursive: true })
  fs.writeFileSync(path.join(templatePath, 'package.json'), '{"name":"project_"}')
  fs.writeFileSync(path.join(templatePath, 'project.aci'), source)

  const resolvedTemplate = resolveCoderTemplatePath(boardPackagePath, pathApi)
  copyCoderArduinoTemplate(resolvedTemplate, projectPath, pathApi, fsApi)

  assert.equal(resolvedTemplate, templatePath)
  assert.equal(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'), '{"name":"project_"}')
  assert.equal(fs.readFileSync(path.join(projectPath, 'sketch', 'src', 'main.cpp'), 'utf8'), source)
  assert.equal(fs.existsSync(path.join(projectPath, 'sketch', 'libraries')), true)
  assert.equal(fs.existsSync(path.join(projectPath, 'project.aci')), false)
})

test('keeps all Coder project configuration in package.json', () => {
  const manifest = {
    name: 'project_',
    dependencies: { '@aily-project/lib-core-io': '1.0.0' }
  }

  applyCoderProjectPackageConfig(
    manifest,
    '@aily-project/board-arduino_uno',
    '^1.8.6'
  )

  assert.equal(isCoderProjectPackage(manifest), true)
  assert.equal(manifest.type, 'coder')
  assert.equal(manifest.entry, 'src/main.cpp')
  assert.equal(manifest.framework, 'arduino')
  assert.equal(manifest.devmode, 'arduino')
  assert.deepEqual(manifest.sourceRoots, ['src', 'libraries'])
  assert.equal(manifest.dependencies['@aily-project/lib-core-io'], '1.0.0')
  assert.equal(manifest.dependencies['@aily-project/board-arduino_uno'], '^1.8.6')
  assert.equal(manifest.boardDependencies['@aily-project/board-arduino_uno'], '^1.8.6')
})

test('accepts board packages published with the legacy template_arrduino typo', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aily-coder-template-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const legacyPath = path.join(root, 'template_arrduino')
  fs.mkdirSync(legacyPath)

  assert.equal(resolveCoderTemplatePath(root, pathApi), legacyPath)
})
