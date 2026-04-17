/*---------------------------------------------------------------------------------------------
 *  Blockly contributed tools — domain-specific tool definitions for aily-blockly.
 *
 *  Migrated from aily-lex to aily-blockly following the core principle:
 *  "lex is an agent runtime, not a repository for IDE domain knowledge."
 *
 *  These tool definitions (prompt, schema, invoke handlers) are owned by the
 *  aily-blockly team. Changes here do NOT require an aily-lex release.
 *  If a tool can work across hosts (CLI/web/blockly) without blockly-specific
 *  semantics, it belongs in aily-lex core tools instead of this provider.
 *
 *  Usage:
 *    import { createBlocklyToolProvider } from '../core/blockly-contributed-tools';
 *
 *    const hostAPI = this._buildExternalHostAPI();
 *    const toolProvider = createBlocklyToolProvider(hostAPI);
 *    agent.registerContributedTools(toolProvider);
 *--------------------------------------------------------------------------------------------*/

import type { IToolContribution, IHostToolProvider, ToolResultContent, IExternalHostAPI } from 'aily-lex';

// ---- 复用已有工具实现 ----
import { AilyHost } from './host';
import { syncAbsFileHandler } from '../tools/syncAbsFileTool';
import { analyzeLibraryBlocksTool } from '../tools/editBlockTool';
import { buildProjectTool } from '../tools/buildProjectTool';
import { searchBoardsLibrariesTool } from '../tools/searchBoardsLibrariesTool';
import { getBoardParametersTool } from '../tools/getBoardParametersTool';
import { newProjectTool } from '../tools/createProjectTool';
import { reloadProjectTool } from '../tools/reloadProjectTool';
import { switchBoardTool } from '../tools/switchBoardTool';
import { findLegacyToolDefinition, LEGACY_HOST_EXTERNAL_TOOL_NAMES } from './legacy-tool-catalog';

// ---- Schematic / save_arch 工具处理函数：直接调用 handler，不经 blockly 侧 runtime registry ----
import {
  generateConnectionGraphTool as generateSchematicHandler,
  getPinmapSummaryTool as getPinmapSummaryHandler,
  getSensorPinmapCatalogTool as getComponentCatalogHandler,
  getProjectContextTool as getProjectContextHandler,
  validateConnectionGraphTool as validateSchematicHandler,
  generatePinmapTool as generatePinmapHandler,
  savePinmapTool as savePinmapHandler,
  getCurrentSchematicTool as getCurrentSchematicHandler,
} from '../tools/connectionGraphTool';

// ---------------------------------------------------------------------------
// Tool Definitions (schema + prompt)
// ---------------------------------------------------------------------------

function makeSyncAbsContribution(): IToolContribution {
  return {
    name: 'syncAbs',
    description: 'Sync ABS (Aily Block Syntax) between text file and Blockly workspace',
    prompt: `Use this tool to sync ABS code with the Blockly workspace. ABS is the text-based DSL that replaces Blockly XML manipulation.

Actions:
- "export": Export the current Blockly workspace as ABS text. Use this to read the current program.
- "import": Import ABS text into the Blockly workspace. Use this after editing the .abs file with edit_file.
- "status": Check sync status between the ABS file and workspace.

Typical workflow:
1. sync_abs action="export" → saves workspace content to .abs file
2. read_file the .abs file
3. edit_file to modify the .abs content
4. sync_abs action="import" → applies changes back to workspace`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['export', 'import', 'status'], description: 'Action to perform' },
        content: { type: 'string', description: 'ABS content to import (required for import action)' },
      },
      required: ['action'],
    },
    annotations: { readOnly: false },
  };
}

function makeLintContribution(): IToolContribution {
  return {
    name: 'lint',
    description: 'Run syntax check (lint) on the generated Arduino C++ code',
    prompt: `Use this tool to check the generated Arduino C++ code for syntax errors and warnings.
Similar to a compile check, but faster — uses ast-grep based static analysis.
Returns errors, warnings, and notes found in the code.

Use this after editing ABS blocks to verify the generated code is syntactically correct before building.`,
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnly: true },
  };
}

function makeAnalyzeLibraryContribution(): IToolContribution {
  return {
    name: 'analyzeLibrary',
    description: 'Analyze library block definitions and generate ABS format documentation',
    prompt: 'Use this tool to analyze the block definitions of an installed library. Returns ABS-compatible documentation showing available blocks, their inputs, and connection types. Useful when writing ABS code that uses library blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        libraryId: { type: 'string', description: 'Library package ID (e.g., "lib-servo")' },
      },
      required: ['libraryId'],
    },
    annotations: { readOnly: true },
  };
}

function makeProjectContribution(): IToolContribution {
  return {
    name: 'project',
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
  };
}

function makeBuildProjectContribution(): IToolContribution {
  return {
    name: 'buildProject',
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
  };
}

function makeBoardSearchContribution(): IToolContribution {
  return {
    name: 'boardSearch',
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
    agentScope: ['main', 'SchematicAgent'],
  };
}

// makeSchematicContribution removed — schematic tools are now individual external tools
// with per-tool agentScope (from tools.ts 'agents' field), managed by lex runtime resolution.

// ---------------------------------------------------------------------------
// Schematic / External Tools — Phase 1.3: unified into contributed provider
// ---------------------------------------------------------------------------

/**
 * names of the 9 domain tools that were previously registered as external tools
 * via _buildExternalTools() + wrapExternalTools(). Now contributed via IHostToolProvider.
 */
/**
 * Lookup a legacy host tool schema from the extracted compatibility catalog.
 * Returns an IToolContribution or null if not found.
 */
function makeLegacyContribution(name: string): IToolContribution | null {
  const legacy = findLegacyToolDefinition(name);
  if (!legacy) return null;
  return {
    name: legacy.name,
    description: legacy.description || name,
    prompt: '', // legacy tools embed prompt in description
    inputSchema: legacy.input_schema || { type: 'object', properties: {} },
    annotations: { readOnly: false },
    agentScope: legacy.agents?.length ? [...legacy.agents] : undefined,
  };
}

function makeSimulatorContribution(): IToolContribution {
  return {
    name: 'simulator',
    description: 'Control the circuit simulator. Run simulations, get circuit data, and manage components.',
    prompt: `Use this tool to interact with the circuit simulator. Actions:

- **get_circuit**: Get the current circuit configuration.
- **run_simulation**: Run a simulation with specified parameters.
- **get_components**: List available components.
- **add_component**: Add a component to the circuit.
- **remove_component**: Remove a component.
- **connect_components**: Connect two component pins.

This tool requires the simulator to be active.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get_circuit', 'run_simulation', 'get_components', 'add_component', 'remove_component', 'connect_components'],
          description: 'The action to perform.',
        },
        config: { type: 'object', description: 'Simulation configuration for run_simulation.' },
        componentType: { type: 'string', description: 'Component type for add_component.' },
        componentId: { type: 'string', description: 'Component ID for remove_component.' },
        sourcePin: { type: 'string', description: 'Source pin for connect_components.' },
        targetPin: { type: 'string', description: 'Target pin for connect_components.' },
      },
      required: ['action'],
    },
    annotations: { readOnly: false },
  };
}

function makeHardwareContribution(): IToolContribution {
  return {
    name: 'hardware',
    description: 'Interact with hardware: list serial ports, upload firmware, and open serial monitor.',
    prompt: `Use this tool for hardware operations. Actions:

- **list_ports**: List available serial ports.
- **upload**: Upload firmware to a board. Requires port and firmware path.
- **serial_monitor**: Open serial monitor on a port. Returns streaming output.

This tool requires a hardware connection (USB/serial).`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list_ports', 'upload', 'serial_monitor'],
          description: 'The action to perform.',
        },
        port: { type: 'string', description: 'Serial port name (e.g., "COM3", "/dev/ttyUSB0").' },
        firmwarePath: { type: 'string', description: 'Path to firmware binary for upload.' },
        baudRate: { type: 'number', description: 'Baud rate for serial monitor (default: 115200).' },
        duration: { type: 'number', description: 'Monitoring duration in ms (default: 5000).' },
      },
      required: ['action'],
    },
    annotations: { readOnly: false },
  };
}

function makeCodeEditorContribution(): IToolContribution {
  return {
    name: 'codeEditor',
    description: 'Interact with the IDE code editor. Read/edit active file, navigate to positions, and get diagnostics.',
    prompt: `Use this tool for IDE code editor operations. Actions:

- **get_active_file**: Get the currently active file's content and path.
- **open_file**: Open a file in the editor, optionally at a specific line.
- **apply_edit**: Apply a content edit to a file via the editor API.
- **get_symbols**: Get workspace symbols matching a query.

This tool requires a code editor (VS Code, etc.) to be active.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get_active_file', 'open_file', 'apply_edit', 'get_symbols'],
          description: 'The action to perform.',
        },
        filePath: { type: 'string', description: 'File path for open_file or apply_edit.' },
        line: { type: 'number', description: 'Line number for open_file.' },
        content: { type: 'string', description: 'New content for apply_edit.' },
        query: { type: 'string', description: 'Symbol query for get_symbols.' },
      },
      required: ['action'],
    },
    annotations: { readOnly: false },
  };
}

// ---------------------------------------------------------------------------
// Invoke Handlers
// ---------------------------------------------------------------------------

type InvokeHandler = (input: Record<string, unknown>, hostAPI: IExternalHostAPI) => Promise<ToolResultContent>;

function text(s: string): ToolResultContent {
  return { content: [{ type: 'text', text: s }] };
}

function error(s: string): ToolResultContent {
  return { content: [{ type: 'text', text: `Error: ${s}` }], isError: true };
}

/** 将已有工具的 ToolUseResult → ToolResultContent */
function fromToolResult(result: { is_error: boolean; content: string }): ToolResultContent {
  return result.is_error ? error(result.content) : text(result.content);
}

const handlers: Record<string, InvokeHandler> = {
  // ---- syncAbs → syncAbsFileHandler ----
  syncAbs: async (input, _hostAPI) => {
    const host = AilyHost.get();
    if (!host.absSync && !host.editor) return error('ABS editor is not available in this environment.');
    const result = await syncAbsFileHandler(
      { operation: input['action'] as 'export' | 'import' | 'status' },
      host.project as any,
      host.electron as any,
      host.absSync as any,
    );
    return fromToolResult(result);
  },

  // ---- lint → Arduino C++ syntax check ----
  lint: async (_input, _hostAPI) => {
    try {
      const arduinoLintService = (window as any)['arduinoLintService'];
      if (!arduinoLintService) return error('Arduino lint service is not available.');

      // Get generated C++ code from the workspace
      const host = AilyHost.get();
      const generatedCode = host.editor?.getGeneratedCode?.() || '';
      if (!generatedCode.trim()) return text('No generated code to lint (workspace is empty).');

      const startTime = Date.now();
      const result = await arduinoLintService.checkSyntax(generatedCode, {
        mode: 'ast-grep',
        format: 'json',
      });
      const duration = Date.now() - startTime;

      const lintResult: Record<string, unknown> = {
        isValid: result.success && (result.errors?.length ?? 0) === 0,
        errors: result.errors || [],
        warnings: result.warnings || [],
        notes: result.notes || [],
        duration,
      };
      return text(JSON.stringify(lintResult, null, 2));
    } catch (err) {
      return error(`Lint failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  // ---- analyzeLibrary → analyzeLibraryBlocksTool ----
  analyzeLibrary: async (input, _hostAPI) => {
    const host = AilyHost.get();
    const result = await analyzeLibraryBlocksTool(
      host.project as any,
      { libraryNames: [input['libraryId'] as string] },
    );
    return fromToolResult(result);
  },

  // ---- project → getProjectInfoTool / newProjectTool / reloadProjectTool / switchBoardTool / getBoardParametersTool ----
  project: async (input, _hostAPI) => {
    const host = AilyHost.get();
    if (!host.project) return error('Project management is not available.');

    const action = input['action'] as string;
    switch (action) {
      case 'create': {
        const name = input['name'] as string | undefined;
        const board = input['board'] as string | undefined;
        if (!name || !board) return error('name and board are required for create.');
        const prjRoot = (host.project as any).projectRootPath || '';
        return fromToolResult(await newProjectTool(prjRoot, { name, board, path: input['path'] }, host.project as any, host.config as any));
      }
      case 'reload':
        return fromToolResult(await reloadProjectTool(host.project as any, input));
      case 'switch_board': {
        const board = input['board'] as string | undefined;
        if (!board) return error('board is required for switch_board.');
        return fromToolResult(await switchBoardTool(host.project as any, { board_name: board }));
      }
      case 'get_board_config':
        return fromToolResult(await getBoardParametersTool.handler(host.project as any, { parameters: input['parameters'] as any }));
      case 'set_board_config': {
        const config = input['config'] as Record<string, unknown> | undefined;
        if (!config) return error('config is required for set_board_config.');
        await (host.project as any).setBoardConfig?.(config);
        return text('Board configuration updated.');
      }
      default: return error(`Unknown action: ${action}`);
    }
  },

  // ---- buildProject → buildProjectTool ----
  buildProject: async (input, _hostAPI) => {
    const host = AilyHost.get();
    if (!host.builder) return error('Build system is not available.');
    const result = await buildProjectTool(
      host.builder as any,
      { preprocess_only: false, clear_cache: false },
      (host.project as any)?.currentProjectPath,
    );
    return fromToolResult(result);
  },

  // ---- boardSearch → searchBoardsLibrariesTool / getBoardParametersTool ----
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
        // searchBoardsLibrariesTool 不直接支持 get_categories；走 config fallback
        try {
          const cats = await (host.config as any).getHardwareCategories?.();
          return text(Array.isArray(cats) ? cats.join('\n') : JSON.stringify(cats ?? []));
        } catch { return text('[]'); }
      }
      case 'get_board_parameters': {
        const boardId = input['boardId'] as string | undefined;
        if (!boardId) return error('boardId is required.');
        return fromToolResult(await getBoardParametersTool.handler(host.project as any, { parameters: boardId }));
      }
      default: return error(`Unknown action: ${action}`);
    }
  },

  // ---- simulator (仍需外部集成) ----
  simulator: async (input, _hostAPI) => {
    return error(`Simulator action "${input['action']}" requires direct external tool integration.`);
  },

  // ---- hardware (仍需外部集成) ----
  hardware: async (input, _hostAPI) => {
    return error(`Hardware action "${input['action']}" requires direct external tool integration.`);
  },

  // ---- codeEditor (仍需外部集成) ----
  codeEditor: async (input, _hostAPI) => {
    return error(`Code editor action "${input['action']}" requires direct external tool integration.`);
  },
};

// ---------------------------------------------------------------------------
// External Tool Handlers (direct handler calls, no blockly-side runtime registry)
// ---------------------------------------------------------------------------

/**
 * Invoke a schematic/save_arch tool directly via its handler function.
 * Replaces the old Phase 1.3 bridge through the blockly runtime registry.
 */
async function invokeExternalTool(toolName: string, input: Record<string, unknown>): Promise<ToolResultContent> {
  const host = AilyHost.get();

  // save_arch — uses fs/path/project, NOT connectionGraph
  if (toolName === 'save_arch') {
    return invokeSaveArch(input, host);
  }

  // All other external tools are schematic tools — require connectionGraph + project
  if (!host.connectionGraph) return error('连线图服务不可用');
  if (!host.project) return error('项目服务不可用');
  const cg = host.connectionGraph as any;
  const prj = host.project as any;

  try {
    let result: any;
    switch (toolName) {
      case 'generate_schematic':
        cg.emitNotice?.({ title: 'AI生成中', text: '正在准备硬件组件引脚信息...', state: 'doing', showProgress: false });
        result = await generateSchematicHandler(cg, prj, input);
        break;
      case 'get_pinmap_summary':
        result = await getPinmapSummaryHandler(cg, prj, input);
        break;
      case 'get_component_catalog':
        result = await getComponentCatalogHandler(cg, prj, input);
        break;
      case 'get_project_context':
        cg.emitNotice?.({ title: 'AI生成中', text: '正在分析项目和组件信息...', state: 'doing', showProgress: false });
        result = await getProjectContextHandler(cg, prj, input || {});
        break;
      case 'validate_schematic':
        cg.emitNotice?.({ title: 'AI生成中', text: '正在验证并保存连线图...', state: 'doing', showProgress: false });
        result = await validateSchematicHandler(cg, prj, input);
        break;
      case 'get_current_schematic':
        result = await getCurrentSchematicHandler(cg, prj, input || {});
        break;
      case 'generate_pinmap':
        cg.emitNotice?.({ title: 'AI生成中', text: '正在生成引脚配置...', state: 'doing', showProgress: false });
        result = await generatePinmapHandler(cg, prj, input as any);
        break;
      case 'save_pinmap':
        cg.emitNotice?.({ title: 'AI生成中', text: '正在保存引脚配置...', state: 'doing', showProgress: false });
        result = await savePinmapHandler(cg, prj, input as any);
        break;
      default:
        return error(`Unknown external tool: ${toolName}`);
    }
    return result?.is_error ? error(result.content) : text(typeof result?.content === 'string' ? result.content : JSON.stringify(result?.content ?? ''));
  } catch (err) {
    return error(`${toolName} error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** save_arch — inline implementation (from registered/project-tools.ts SaveArchTool) */
async function invokeSaveArch(args: Record<string, unknown>, host: any): Promise<ToolResultContent> {
  if (!host?.fs || !host?.platform) return error('文件系统服务不可用');

  const code = String(args?.['code'] || '').trim();
  if (!code) return error('参数 code 不能为空');

  const content = `\`\`\`mermaid\n${code}\n\`\`\`\n`;
  const projectPath = host.project?.currentProjectPath || host.project?.projectRootPath;
  const rootPath = host.project?.projectRootPath;
  const isOrphan = !projectPath || (rootPath && projectPath === rootPath);
  const separator = host.platform.pathSeparator || '/';

  try {
    if (projectPath && !isOrphan) {
      const archPath = projectPath + separator + 'arch.md';
      host.fs.writeFileSync(archPath, content);
      return text(`框架图已保存到 ${archPath}（已在对话中渲染，无需再次输出）`);
    } else if (isOrphan && rootPath) {
      const chatHistoryDir = rootPath + separator + '.chat_history';
      if (!host.fs.existsSync(chatHistoryDir)) {
        host.fs.mkdirSync(chatHistoryDir, { recursive: true });
      }
      const archPath = chatHistoryDir + separator + 'arch.md';
      host.fs.writeFileSync(archPath, content);
      return text(`框架图已保存到 ${archPath}（已在对话中渲染，无需再次输出）`);
    } else {
      return error('无法确定保存路径：当前未打开项目');
    }
  } catch (err: any) {
    return error(`保存框架图失败: ${err.message || err}`);
  }
}

// ---------------------------------------------------------------------------
// Provider Factory
// ---------------------------------------------------------------------------

/**
 * Create an IHostToolProvider for aily-blockly based on its external host API.
 *
 * Detects available capabilities and only contributes applicable tools.
 */
export function createBlocklyToolProvider(hostAPI: IExternalHostAPI): IHostToolProvider {
  const contributions: IToolContribution[] = [];

  // ABS / Workspace tools (require blockly editor)
  if (hostAPI.blockly?.exportAbs) {
    contributions.push(makeSyncAbsContribution());
  }
  // Lint tool — always available when blockly editor is present
  if (hostAPI.blockly?.exportAbs) {
    contributions.push(makeLintContribution());
  }
  if (hostAPI.blockly?.analyzeBlocks) {
    contributions.push(makeAnalyzeLibraryContribution());
  }

  // Project management
  if (hostAPI.project) {
    contributions.push(makeProjectContribution());
  }

  // Build
  if (hostAPI.builder?.build) {
    contributions.push(makeBuildProjectContribution());
  }

  // Board search
  if (hostAPI.boardSearch?.search) {
    contributions.push(makeBoardSearchContribution());
  }

  // Schematic — 不再由 contributed tool 统一包装，
  // 各个 schematic 子工具由 tools.ts 原生定义 + agentScope 控制可见性，
  // 以保证 SchematicAgent 的 systemPrompt 可直接引用 generate_schematic / get_project_context 等。

  // ---- Phase 1.3: merge external tools (schematic + save_arch) ----
  // Schematic tools — contribute when connectionGraph is available
  if (hostAPI.connectionGraph) {
    for (const name of LEGACY_HOST_EXTERNAL_TOOL_NAMES) {
      if (name === 'save_arch') continue; // save_arch doesn't need connectionGraph
      const contrib = makeLegacyContribution(name);
      if (contrib) contributions.push(contrib);
    }
  }
  // save_arch — always available (uses fs/project, not connectionGraph)
  {
    const contrib = makeLegacyContribution('save_arch');
    if (contrib) contributions.push(contrib);
  }

  return {
    contributeTools(): IToolContribution[] {
      return contributions;
    },

    async invoke(toolName: string, input: unknown, signal?: AbortSignal): Promise<ToolResultContent> {
      // External tools call handlers directly; no blockly-side runtime registry remains here.
      if (LEGACY_HOST_EXTERNAL_TOOL_NAMES.includes(toolName as any)) {
        return invokeExternalTool(toolName, input as Record<string, unknown>);
      }

      const handler = handlers[toolName];
      if (!handler) {
        return error(`Unknown contributed tool: ${toolName}`);
      }
      try {
        return await handler(input as Record<string, unknown>, hostAPI);
      } catch (err) {
        return error(`${toolName} error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
