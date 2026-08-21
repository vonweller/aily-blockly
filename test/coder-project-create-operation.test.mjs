import assert from 'node:assert/strict'
import test from 'node:test'
import createJiti from 'jiti'

const jiti = createJiti(import.meta.url)
const { executeCoderProjectCreateOperation } = jiti('../src/app/services/coder-project-create-operation.ts')
const { searchBoardsLibrariesTool } = jiti('../src/app/tools/aily-chat/tools/searchBoardsLibrariesTool.ts')

const board = {
  name: '@aily-project/board-arduino_uno',
  nickname: 'Arduino UNO R3',
  version: '1.0.0',
  boardId: 'uno'
}

test('project_create uses the shared board package and template_arduino contract', async () => {
  const calls = []
  const projectPath = '/Users/test/Documents/aily-project/project_coder_20260820a'
  const result = await executeCoderProjectCreateOperation(
    { boardName: '@aily-project/board-arduino_uno', boardNickname: 'Arduino UNO R3' },
    createDependencies({ calls, boards: [board], projectPath })
  )

  assert.deepEqual(calls, [
    {
      action: 'create',
      data: {
        name: 'project_coder_20260820a',
        path: '/Users/test/Documents/aily-project',
        board: {
          name: '@aily-project/board-arduino_uno',
          nickname: 'Arduino UNO R3',
          version: '1.0.0'
        },
        devmode: undefined
      }
    },
    { action: 'open', projectPath },
    { action: 'record-board', boardName: '@aily-project/board-arduino_uno' }
  ])
  assert.equal(result.ok, true)
  assert.equal(result.board.name, '@aily-project/board-arduino_uno')
  assert.equal(result.board.template, 'template_arduino')
  assert.equal(result.board.platform, undefined)
})

test('unknown boards fail without creating or opening a project', async () => {
  const calls = []
  const result = await executeCoderProjectCreateOperation(
    { boardName: '@aily-project/board-unsupported' },
    createDependencies({ calls, boards: [], projectPath: '' })
  )

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'coder_board_not_found')
  assert.deepEqual(calls, [{ action: 'load-boards' }])
})

test('shared board search returns the exact package accepted by Coder creation', async () => {
  const result = await searchBoardsLibrariesTool.handler(
    { query: 'Arduino Uno R3', type: 'boards' },
    {
      boardIndex: [{
        name: '@aily-project/board-arduino_uno',
        displayName: 'Arduino UNO R3',
        description: 'Arduino UNO R3 board',
        type: 'board',
        core: 'arduino:avr:uno',
        architecture: 'avr',
        keywords: ['Arduino', 'Uno', 'R3'],
        tags: ['arduino'],
        connectivity: [],
        interfaces: ['gpio'],
        flash: 32,
        sram: 2,
        psram: 0,
        frequency: 16,
        frequencyUnit: 'MHz'
      }],
      boardList: [board],
      libraryIndex: [],
      libraryList: []
    }
  )

  assert.equal(result.is_error, false)
  assert.equal(result.metadata.results[0].packageName, '@aily-project/board-arduino_uno')
  assert.match(result.content, /packageName: @aily-project\/board-arduino_uno/)
})

function createDependencies({ calls, boards, projectPath }) {
  return {
    normalizeBoardName(value) {
      const normalized = String(value || '').trim()
      if (!normalized || normalized.startsWith('@aily-project/')) return normalized
      return normalized.startsWith('board-')
        ? `@aily-project/${normalized}`
        : `@aily-project/board-${normalized}`
    },
    getBoards: () => boards,
    async loadBoards() {
      calls.push({ action: 'load-boards' })
      return boards
    },
    async defaultParentPath() {
      return '/Users/test/Documents/aily-project'
    },
    generateUniqueName: () => 'project_coder_20260820a',
    async createProject(data) {
      calls.push({ action: 'create', data })
      return { ok: true, projectPath }
    },
    async openProject(openedProjectPath) {
      calls.push({ action: 'open', projectPath: openedProjectPath })
      return true
    },
    recordBoardUsage(boardName) {
      calls.push({ action: 'record-board', boardName })
    }
  }
}
