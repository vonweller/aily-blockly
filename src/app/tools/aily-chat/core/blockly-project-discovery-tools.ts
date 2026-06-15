import type { IToolContribution } from 'aily-lex/browser';
import type { IExternalHostAPI } from 'aily-lex/host/blockly';

import { AilyHost } from './host';
import { getBlocklyContextSnapshotService } from './blockly-context-snapshot-service';
import { buildProjectTool } from '../tools/buildProjectTool';
import { searchBoardsLibrariesTool } from '../tools/searchBoardsLibrariesTool';
import { getBoardParametersTool } from '../tools/getBoardParametersTool';
import { getHardwareCategoriesTool } from '../tools/getHardwareCategoriesTools';
import { setBoardConfigTool } from '../tools/boardConfigTool';
import { newProjectTool } from '../tools/createProjectTool';
import { reloadProjectTool } from '../tools/reloadProjectTool';
import { switchBoardTool } from '../tools/switchBoardTool';
import type { EditingTimelineWriter } from '../services/editing-timeline-recording-bridge';
import { error, fromToolResult, text, type InvokeHandler } from './blockly-contributed-tool-runtime';

type DeferredFactory = (group: string, reason: string) => { group: string; reason: string };
type RuntimeScopedToolContribution = IToolContribution & {
  readonly toolSet?: string;
  readonly runtimeModes?: readonly string[];
};

function makeProjectContribution(createDeferred: DeferredFactory): RuntimeScopedToolContribution {
  return {
    name: 'project',
    toolSet: 'blockly-project',
    description: 'Manage the current project (create, reload, switch board, configure)',
    prompt: `Use this tool to manage the current project. Actions:
- "create": Create a new project (requires name and board)
- "reload": Reload the current project
- "switch_board": Switch the development board
- "get_board_config": Get board compile/upload configuration
- "set_board_config": Modify board compile/upload configuration

Note: Basic project info (path, board, libraries) is already in the environment section. No need to call this tool for read-only info.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'reload', 'switch_board', 'get_board_config', 'set_board_config'],
          description: 'Action to perform',
        },
        name: { type: 'string', description: 'Project name (for create)' },
        board: { type: 'string', description: 'Board identifier (for create/switch_board)' },
        path: { type: 'string', description: 'Project path (for create, optional)' },
        config: { type: 'object', description: 'Board config key-value pairs (for set_board_config)' },
      },
      required: ['action'],
    },
    annotations: { readOnly: false },
    runtimeModes: ['unbound', 'coder', 'blockly'],
    agentScope: ['main'],
    deferred: createDeferred('blockly-project-management', '项目创建、切板与配置通常按需使用'),
  };
}

function makeBuildProjectContribution(createDeferred: DeferredFactory): RuntimeScopedToolContribution {
  return {
    name: 'buildProject',
    toolSet: 'blockly-project',
    description: 'Build/compile the current project',
    prompt: `Use this tool to compile the current project. Returns the build output including any errors.
Set verbose to true for detailed compiler output.`,
    inputSchema: {
      type: 'object',
      properties: {
        verbose: { type: 'boolean', description: 'Show detailed compiler output', default: false },
      },
    },
    annotations: { readOnly: false },
    runtimeModes: ['unbound', 'coder', 'blockly'],
    agentScope: ['main'],
    deferred: createDeferred('blockly-project-management', '构建属于按需执行的低频宿主能力'),
  };
}

function makeBoardSearchContribution(createDeferred: DeferredFactory): RuntimeScopedToolContribution {
  return {
    name: 'boardSearch',
    toolSet: 'blockly-discovery',
    description: 'Search for development boards and libraries',
    prompt: `Use this tool to find development boards and libraries by keyword or filter.
- Search by name, description, or tags
- Filter by type: "boards", "libraries", or "both"
- Get board parameters for a specific board
- Get hardware categories for browsing`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'get_categories', 'get_board_parameters'] },
        query: { type: 'string', description: 'Search keyword' },
        type: { type: 'string', enum: ['boards', 'libraries', 'both'], default: 'both', description: 'Search scope: boards, libraries, or both' },
        boardId: { type: 'string', description: 'Board ID for get_board_parameters' },
      },
      required: ['action'],
    },
    annotations: { readOnly: true },
    runtimeModes: ['unbound', 'coder', 'blockly'],
    agentScope: ['main', 'SchematicAgent'],
    deferred: createDeferred('blockly-library-discovery', '开发板与库搜索只在特定查询场景下需要'),
  };
}

function makeSearchBoardsLibrariesContribution(): RuntimeScopedToolContribution {
  return {
    name: 'search_boards_libraries',
    toolSet: 'blockly-discovery',
    description: 'Search Aily development boards and libraries by text query or structured filters',
    prompt: searchBoardsLibrariesTool.description,
    inputSchema: searchBoardsLibrariesTool.parameters,
    annotations: { readOnly: true },
    runtimeModes: ['unbound', 'coder', 'blockly'],
    agentScope: ['main', 'Plan', 'Explore', 'SchematicAgent'],
  };
}

function makeGetHardwareCategoriesContribution(): RuntimeScopedToolContribution {
  return {
    name: 'get_hardware_categories',
    toolSet: 'blockly-discovery',
    description: 'Get board or library category facets for guided hardware selection',
    prompt: getHardwareCategoriesTool.description,
    inputSchema: getHardwareCategoriesTool.parameters,
    annotations: { readOnly: true },
    runtimeModes: ['unbound', 'coder', 'blockly'],
    agentScope: ['main', 'Plan', 'Explore', 'SchematicAgent'],
  };
}

function makeGetBoardParametersContribution(): RuntimeScopedToolContribution {
  return {
    name: 'get_board_parameters',
    toolSet: 'blockly-discovery',
    description: 'Read detailed parameters from the current project board configuration',
    prompt: 'Use this read-only tool when you need the current board pins, serial/I2C/SPI configuration, PWM pins, builtin LEDs, or other board.json parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        parameters: {
          oneOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } },
          ],
          description: 'Optional parameter name or list. Omit to return all board parameters.',
        },
      },
    },
    annotations: { readOnly: true },
    runtimeModes: ['unbound', 'coder', 'blockly'],
    agentScope: ['main', 'Plan', 'Explore', 'SchematicAgent'],
  };
}

export function appendBlocklyProjectContributions(
  contributions: IToolContribution[],
  hostAPI: IExternalHostAPI,
  createDeferred: DeferredFactory,
): void {
  if (hostAPI.project) {
    contributions.push(makeProjectContribution(createDeferred));
  }

  if (hostAPI.builder?.build) {
    contributions.push(makeBuildProjectContribution(createDeferred));
  }
}

export function appendBlocklyDiscoveryContributions(
  contributions: IToolContribution[],
  hostAPI: IExternalHostAPI,
  createDeferred: DeferredFactory,
): void {
  if (hostAPI.boardSearch?.search) {
    contributions.push(makeSearchBoardsLibrariesContribution());
    contributions.push(makeGetHardwareCategoriesContribution());
    if (hostAPI.project) {
      contributions.push(makeGetBoardParametersContribution());
    }
    contributions.push(makeBoardSearchContribution(createDeferred));
  }
}

export function createBlocklyProjectDiscoveryHandlers(): Record<string, InvokeHandler> {
  return {
    project: async (input, _hostAPI, invocationContext) => {
      const host = AilyHost.get();
      if (!host.project) return error('Project management is not available.');
      const contextSnapshotService = getBlocklyContextSnapshotService();
      const editingTimeline = invocationContext?.host?.getExtension<EditingTimelineWriter>('editingTimeline');

      const action = input['action'] as string;
      switch (action) {
        case 'create': {
          const name = input['name'] as string | undefined;
          const board = input['board'] as string | undefined;
          if (!name || !board) return error('name and board are required for create.');
          const prjRoot = (host.project as any).projectRootPath || '';
          const result = await newProjectTool(prjRoot, { name, board, path: input['path'] }, host.project as any, host.config as any);
          if (!result.is_error) {
            contextSnapshotService.invalidate([
              'workspaceIdentity',
              'projectInfo',
              'boardInfo',
              'libraryIndex',
              'libraryReadmeRefs',
              'workspaceArtifacts',
              'workspaceState',
            ], 'project create');
          }
          return fromToolResult(result);
        }
        case 'reload': {
          const result = await reloadProjectTool(host.project as any, input);
          if (!result.is_error) {
            contextSnapshotService.invalidate([
              'projectInfo',
              'boardInfo',
              'libraryIndex',
              'libraryReadmeRefs',
              'workspaceArtifacts',
              'workspaceState',
            ], 'project reload');
          }
          return fromToolResult(result);
        }
        case 'switch_board': {
          const board = input['board'] as string | undefined;
          if (!board) return error('board is required for switch_board.');
          const result = await switchBoardTool(host.project as any, { board_name: board }, {
            turnId: invocationContext?.trace?.turnId,
            toolCallId: invocationContext?.toolCallId,
            timelineWriter: editingTimeline,
          });
          if (!result.is_error) {
            contextSnapshotService.invalidate([
              'boardInfo',
              'libraryIndex',
              'libraryReadmeRefs',
              'workspaceArtifacts',
              'workspaceState',
            ], 'switch board');
          }
          return fromToolResult(result);
        }
        case 'get_board_config':
          return fromToolResult(await getBoardParametersTool.handler(host.project as any, { parameters: input['parameters'] as any }));
        case 'set_board_config': {
          const config = input['config'] as Record<string, unknown> | undefined;
          const directConfigKey = input['config_key'] as string | undefined;
          const directConfigValue = input['config_value'] as string | undefined;

          let configKey = directConfigKey;
          let configValue = directConfigValue;

          if (!configKey && config && Object.keys(config).length === 1) {
            const [entryKey, entryValue] = Object.entries(config)[0];
            configKey = entryKey;
            configValue = entryValue === undefined || entryValue === null ? '' : String(entryValue);
          }

          if (!configKey || configValue === undefined) {
            return error('set_board_config requires config_key/config_value, or a single-entry config object.');
          }

          const result = await setBoardConfigTool(host.project as any, host.builder as any, {
            config_key: configKey,
            config_value: configValue,
          }, {
            turnId: invocationContext?.trace?.turnId,
            toolCallId: invocationContext?.toolCallId,
            timelineWriter: editingTimeline,
          });
          if (!result.is_error) {
            contextSnapshotService.invalidate([
              'boardInfo',
              'workspaceArtifacts',
              'workspaceState',
            ], 'set board config');
          }
          return fromToolResult(result);
        }
        default:
          return error(`Unknown action: ${action}`);
      }
    },

    buildProject: async (_input, _hostAPI) => {
      const host = AilyHost.get();
      if (!host.builder) return error('Build system is not available.');
      const result = await buildProjectTool(
        host.builder as any,
        { preprocess_only: false, clear_cache: false },
        (host.project as any)?.currentProjectPath,
      );
      return fromToolResult(result);
    },

    boardSearch: async (input, _hostAPI) => {
      const host = AilyHost.get();
      if (!host.config) return error('Board search is not available.');

      const action = input['action'] as string;
      switch (action) {
        case 'search': {
          const query = input['query'] as string | undefined;
          if (!query) return error('query is required for search.');
          const typeMap: Record<string, 'boards' | 'libraries' | 'both'> = {
            board: 'boards', library: 'libraries', all: 'both',
            boards: 'boards', libraries: 'libraries', both: 'both',
          };
          const rawType = (input['type'] as string) || 'both';
          const result = await searchBoardsLibrariesTool.handler(
            { query, type: typeMap[rawType] ?? 'both' },
            host.config as any,
          );
          return fromToolResult(result);
        }
        case 'get_categories': {
          try {
            const cats = await (host.config as any).getHardwareCategories?.();
            return text(Array.isArray(cats) ? cats.join('\n') : JSON.stringify(cats ?? []));
          } catch {
            return text('[]');
          }
        }
        case 'get_board_parameters': {
          const boardId = input['boardId'] as string | undefined;
          if (!boardId) return error('boardId is required.');
          return fromToolResult(await getBoardParametersTool.handler(host.project as any, { parameters: boardId }));
        }
        default:
          return error(`Unknown action: ${action}`);
      }
    },

    search_boards_libraries: async (input, _hostAPI) => {
      const host = AilyHost.get();
      if (!host.config) return error('Board/library search is not available.');
      const result = await searchBoardsLibrariesTool.handler(input as any, host.config as any);
      return fromToolResult(result);
    },

    get_hardware_categories: async (input, _hostAPI) => {
      const host = AilyHost.get();
      if (!host.config) return error('Hardware category search is not available.');
      const result = await getHardwareCategoriesTool.handler(input as any, host.config as any);
      return fromToolResult(result);
    },

    get_board_parameters: async (input, _hostAPI) => {
      const host = AilyHost.get();
      if (!host.project) return error('Board parameters are not available.');
      return fromToolResult(await getBoardParametersTool.handler(host.project as any, {
        parameters: input['parameters'] as any,
      }));
    },
  };
}
