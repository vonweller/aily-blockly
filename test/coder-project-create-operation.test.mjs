import assert from 'node:assert/strict'
import test from 'node:test'
import createJiti from 'jiti'

const jiti = createJiti(import.meta.url)
const { executeCoderProjectCreateOperation } = jiti('../src/app/services/coder-project-create-operation.ts')
const { buildCoderBoardSearchCatalog, resolveCoderBoard } = jiti('../src/app/services/coder-board-resolution.ts')
const { searchBoardsLibrariesTool } = jiti('../src/app/tools/aily-chat/tools/searchBoardsLibrariesTool.ts')

const board = {
  name: '@aily-project/coder-arduino_uno',
  nickname: 'Arduino UNO R3',
  version: '1.0.0',
  boardId: 'uno',
  defaultFramework: 'arduino',
  defaultPlatform: '@aily-project/platform-arduino-avr',
  frameworkPlatforms: [
    {
      framework: 'arduino',
      platform: '@aily-project/platform-arduino-avr',
      boardId: 'uno'
    }
  ]
}

test('external project_create directly creates and opens a Coder project', async () => {
  const calls = []
  const projectPath = '/Users/test/Documents/aily-code-project/aily_code_20260814a'

  const result = await executeCoderProjectCreateOperation(
    {
      boardName: '@aily-project/coder-arduino_uno',
      boardNickname: 'Arduino UNO R3'
    },
    createDependencies({
      calls,
      boards: [board],
      projectPath
    })
  )

  assert.deepEqual(calls, [
    {
      action: 'create',
      data: {
        name: 'aily_code_20260814a',
        path: '/Users/test/Documents/aily-code-project',
        wizardTarget: {
          boardPkgName: '@aily-project/coder-arduino_uno',
          targetBoardId: 'uno',
          boardNickname: 'Arduino UNO R3',
          boardPkgVersion: '1.0.0',
          framework: 'arduino',
          platform: '@aily-project/platform-arduino-avr'
        }
      }
    },
    { action: 'open', projectPath },
    { action: 'record-board', boardName: '@aily-project/coder-arduino_uno' }
  ])
  assert.deepEqual(result, {
    ok: true,
    operation: 'project_create',
    developmentMode: 'coder',
    projectType: 'coder',
    project: projectPath,
    message: `Coder 项目已创建并打开: ${projectPath}`,
    name: 'aily_code_20260814a',
    path: '/Users/test/Documents/aily-code-project',
    board: {
      name: '@aily-project/coder-arduino_uno',
      nickname: 'Arduino UNO R3',
      version: '1.0.0',
      requestedName: '@aily-project/coder-arduino_uno',
      framework: 'arduino',
      platform: '@aily-project/platform-arduino-avr',
      targetBoardId: 'uno'
    }
  })
})

test('unsupported Coder boards fail without creating or opening a project', async () => {
  const calls = []
  const result = await executeCoderProjectCreateOperation(
    { boardName: '@aily-project/board-unsupported' },
    createDependencies({ calls, boards: [], projectPath: '' })
  )

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'coder_board_not_found')
  assert.deepEqual(calls, [{ action: 'load-boards' }])
})

test('Blockly board package aliases resolve to the supported Coder package without retrying', async () => {
  const calls = []
  const projectPath = '/Users/test/Documents/aily-code-project/uno-led'
  const result = await executeCoderProjectCreateOperation(
    {
      boardName: '@aily-project/board-arduino_uno',
      boardNickname: 'Arduino UNO R3',
      name: 'uno-led'
    },
    createDependencies({ calls, boards: [board], projectPath })
  )

  assert.equal(result.ok, true)
  assert.equal(result.board.name, '@aily-project/coder-arduino_uno')
  assert.equal(result.board.requestedName, '@aily-project/board-arduino_uno')
  assert.equal(calls[0].data.wizardTarget.boardPkgName, '@aily-project/coder-arduino_uno')
  assert.deepEqual(calls.map(call => call.action), ['create', 'open', 'record-board'])
})

test('Coder board search exposes actual Coder packages and excludes unsupported boards', () => {
  const catalog = buildCoderBoardSearchCatalog(
    [board],
    [
      {
        name: 'board-arduino_uno',
        displayName: 'Arduino UNO R3',
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
      },
      {
        name: 'board-unsupported',
        displayName: 'Unsupported Board',
        type: 'board',
        core: 'unsupported:core',
        keywords: ['unsupported'],
        tags: []
      }
    ],
    [
      {
        name: '@aily-project/board-arduino_uno',
        nickname: 'Arduino UNO R3',
        description: 'Arduino UNO R3 board'
      }
    ]
  )

  assert.equal(catalog.boardIndex.length, 1)
  assert.equal(catalog.boardList.length, 1)
  assert.equal(catalog.boardIndex[0].name, '@aily-project/coder-arduino_uno')
  assert.equal(catalog.boardIndex[0].displayName, 'Arduino UNO R3')
  assert.equal(catalog.boardIndex[0].core, 'arduino:avr:uno')
  assert.equal(catalog.boardList[0].name, '@aily-project/coder-arduino_uno')
  assert.equal(resolveCoderBoard([board], '@aily-project/board-arduino_uno'), board)
})

test('search_boards_libraries returns a Coder package that project_create accepts directly', async () => {
  const catalog = buildCoderBoardSearchCatalog(
    [board],
    [
      {
        name: 'board-arduino_uno',
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
      }
    ],
    []
  )

  const result = await searchBoardsLibrariesTool.handler(
    { query: 'Arduino Uno R3', type: 'boards' },
    {
      boardIndex: catalog.boardIndex,
      boardList: catalog.boardList,
      libraryIndex: [],
      libraryList: []
    }
  )

  assert.equal(result.is_error, false)
  assert.equal(result.metadata.results.length, 1)
  assert.equal(result.metadata.results[0].name, '@aily-project/coder-arduino_uno')
  assert.equal(result.metadata.results[0].packageName, '@aily-project/coder-arduino_uno')
  assert.match(result.content, /packageName: @aily-project\/coder-arduino_uno/)
  assert.doesNotMatch(result.content, /packageName: @aily-project\/board-arduino_uno/)
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
    getCoderBoards: () => boards,
    async loadCoderBoards() {
      calls.push({ action: 'load-boards' })
      return boards
    },
    resolveDefaultFramework: currentBoard => currentBoard.defaultFramework,
    resolveFrameworkOption(currentBoard, framework) {
      return currentBoard.frameworkPlatforms.find(item => item.framework === framework)
    },
    defaultParentPath: () => '/Users/test/Documents/aily-code-project',
    generateUniqueName: () => 'aily_code_20260814a',
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
