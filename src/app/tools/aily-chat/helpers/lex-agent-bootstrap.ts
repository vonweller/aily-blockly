/**
 * Blockly compatibility bootstrap for aily-lex.
 *
 * This file is intentionally a concrete host binding for aily-blockly. It wires
 * blockly host services and domain contributions into lex's generic runtime
 * contract, but it is not the canonical integration path for non-blockly hosts.
 */

import type { IChatContext } from '../core/chat-context';
import { AilyHost } from '../core/host';
import { getMainAgentLegacyHostTools } from '../core/legacy-tool-catalog';
import { DEFERRED_TOOL_GROUPS } from '../tools/tool-discovery';
import { BLOCKLY_PROMPT_PROFILE } from '../core/blockly-prompt-profile';
import { createBlocklyToolProvider } from '../core/blockly-contributed-tools';
import { createBlocklyAgentProvider } from '../core/blockly-agent-provider';
import { createBlocklySubagentExtension } from '../core/blockly-subagent-extension';
import { BlocklySkillProvider } from '../core/blockly-skill-provider';
import { SkillRegistry as BlocklySkillRegistry } from '../core/skill-registry';
import { askUserSingle } from '../core/ask-user';
import { collectDiagnostics } from '../core/diagnostics';
import { syncAbsFileHandler } from '../tools/syncAbsFileTool';
import { analyzeLibraryBlocksTool } from '../tools/editBlockTool';
import { searchBoardsLibrariesTool } from '../tools/searchBoardsLibrariesTool';
import { BlocklyHostAdapter, type IExternalHostAPI } from 'aily-lex/host/blockly';

export type AilyLexModule = typeof import('aily-lex/browser');

export interface LexRuntimeModelConfig {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface LexRuntimeApiConfig {
  useCustomApiKey: boolean;
  apiKey: string;
  baseUrl: string;
}

interface ResolvePersistedLexSessionOptions {
  lex: AilyLexModule;
  sessionId: string;
  cwd?: string;
  legacyTurns?: unknown;
}

interface BootstrapLexAgentOptions {
  ctx: IChatContext;
  lex: AilyLexModule;
  sessionId?: string;
  askHandler?: (askContext: any) => Promise<boolean>;
  onSubagentEvent?: (event: any) => void;
}

export interface BlocklyCompatibilityHostBinding {
  hostAPI: IExternalHostAPI;
  toolProvider: ReturnType<typeof createBlocklyToolProvider>;
  adapter: BlocklyHostAdapter;
}

// Host/runtime boundary:
// - this set only selects lex-owned core tools for the main agent
// - blockly-specific capabilities must enter through toolProvider / agentProvider / skillProvider
// - if a tool is portable across hosts, it should move into aily-lex core instead of growing this host list
const LEX_CORE_SAFE_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'multi_edit_file',
  'delete_file',
  'grep_search', 'glob_search',
  'run_terminal', 'agent',
  'get_changed_files',
  'web_fetch', 'clone_repository',
  'todo_manage',
  'get_context',
  'think',
  'ask_user',
  'get_errors',
  'web_search',
  'tool_search',
  'load_skill',
]);

function resolvePlatformType(type?: string, isWindows?: boolean, isMacOS?: boolean): 'win32' | 'darwin' | 'linux' {
  if (type === 'win32' || type === 'darwin' || type === 'linux') {
    return type;
  }
  if (isWindows) {
    return 'win32';
  }
  if (isMacOS) {
    return 'darwin';
  }
  return 'linux';
}

function toDirectoryNames(entries: unknown): string[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map(entry => typeof entry === 'string' ? entry : String((entry as { name?: unknown })?.name ?? ''));
}

export function buildExternalHostAPI(): IExternalHostAPI {
  const host = AilyHost.get();
  const prjPath = () => host.project?.currentProjectPath || host.project?.projectRootPath || '';
  const absFilePath = () => host.path.join(prjPath(), 'project.abs');
  const abiFilePath = () => host.path.join(prjPath(), 'project.abi');
  const hasBuilder = typeof host.builder?.build === 'function';
  const hasBlocklyBridge = !!(host.editor || host.absSync);
  const hasBoardSearch = !!(
    host.config?.getHardwareCategories
    || host.config?.getBoardsList
    || host.config?.boardIndex
    || host.config?.boardList
  );

  return {
    fs: {
      readFile: (path: string, encoding?: string) =>
        Promise.resolve(host.fs.readFileSync(path, encoding || 'utf-8')),
      writeFile: (path: string, content: string) =>
        Promise.resolve(host.fs.writeFileSync(path, content)),
      exists: (path: string) =>
        Promise.resolve(host.fs.existsSync(path)),
      readDir: (dirPath: string) =>
        Promise.resolve(toDirectoryNames(host.fs.readdirSync?.(dirPath) ?? host.fs.readDirSync?.(dirPath))),
      stat: (path: string) => {
        const s = host.fs.statSync(path);
        return Promise.resolve({
          isFile: () => typeof s?.isFile === 'function' ? s.isFile() : !!s?.isFile,
          isDirectory: () => typeof s?.isDirectory === 'function' ? s.isDirectory() : !!s?.isDirectory,
          size: s?.size ?? 0,
        });
      },
      mkdir: (dirPath: string, opts?: { recursive?: boolean }) =>
        Promise.resolve(host.fs.mkdirSync(dirPath, opts)),
      delete: (path: string) =>
        Promise.resolve(host.fs.unlinkSync(path)),
    },
    terminal: host.terminal ? {
      exec: (command: string, opts?: { cwd?: string; timeout?: number }) =>
        new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
          let stdout = '';
          let stderr = '';
          let settled = false;
          const streamId = `lex_${Date.now()}_${Math.random().toString(36).slice(2)}`;

          const settle = (exitCode: number) => {
            if (settled) return;
            settled = true;
            removeListener?.();
            if (timer != null) clearTimeout(timer);
            resolve({ stdout, stderr, exitCode });
          };

          const removeListener = host.terminal.onData?.(streamId, (data: any) => {
            switch (data.type) {
              case 'stdout': stdout += data.data ?? ''; break;
              case 'stderr': stderr += data.data ?? ''; break;
              case 'close': settle(data.code ?? 0); break;
              case 'error': stderr += data.error ?? ''; settle(1); break;
            }
          });

          const timeout = opts?.timeout || 30_000;
          const timer = setTimeout(() => settle(124), timeout);

          host.terminal.run?.({ command, cwd: opts?.cwd, streamId })
            .then((r: any) => { if (!r?.success) settle(1); })
            .catch(() => settle(1));
        }),
    } : undefined,
    platform: {
        type: resolvePlatformType(host.platform?.type, host.platform?.isWindows, host.platform?.isMacOS),
      cwd: () => prjPath(),
        homedir: () => host.platform?.homedir?.() ?? host.path.getUserHome(),
      env: (key: string) => host.env?.get?.(key),
    },
    project: host.project ? {
        getProjectInfo: async () => host.project.getProjectInfo?.() ?? {
          name: host.project.projectName,
          path: prjPath(),
          board: host.project.currentBoard,
        },
      getProjectPath: () => host.project.currentProjectPath,
      getBoard: () => host.project.currentBoard,
        createProject: host.project.createProject
          ? (name: string, board: string, path?: string) => host.project.createProject!(name, board, path ?? prjPath())
          : undefined,
        reloadProject: host.project.reloadProject
          ? () => host.project.reloadProject!()
          : undefined,
        getBoardConfig: host.project.getBoardJson
          ? async () => host.project.getBoardJson!()
          : undefined,
        setBoardConfig: typeof (host.project as any)?.setBoardConfig === 'function'
          ? async (config: Record<string, unknown>) => (host.project as any).setBoardConfig(config)
          : undefined,
    } : undefined,
      builder: hasBuilder ? {
        build: async () => {
          const result = await host.builder.build(prjPath());
          return {
            success: !!result?.success,
            output: result?.output ?? '',
            errors: result?.success ? [] : [result?.output ?? 'Build failed'],
          };
        },
      } : undefined,
      blockly: hasBlocklyBridge ? {
        exportAbs: async () => {
          const result = await syncAbsFileHandler(
            { operation: 'export' },
            host.project as any,
            host.electron as any,
            host.absSync as any,
          );
          if (result.is_error) {
            throw new Error(result.content);
          }
          return host.fs.readFileSync(absFilePath(), 'utf-8');
        },
        importAbs: async (content: string) => {
          host.fs.writeFileSync(absFilePath(), content, 'utf-8');
          const result = await syncAbsFileHandler(
            { operation: 'import' },
            host.project as any,
            host.electron as any,
            host.absSync as any,
          );
          return result.is_error
            ? { success: false, errors: [result.content] }
            : { success: true };
        },
        getAbsStatus: async () => {
          const result = await syncAbsFileHandler(
            { operation: 'status' },
            host.project as any,
            host.electron as any,
            host.absSync as any,
          );
          return {
            inSync: !result.is_error && host.fs.existsSync(absFilePath()) && host.fs.existsSync(abiFilePath()),
            absPath: absFilePath(),
            lastSync: Date.now(),
          };
        },
        getWorkspaceOverview: async () => ({
          structure: '',
          generatedCode: host.editor?.getGeneratedCode?.() ?? '',
          blockCount: host.editor?.getBlockDefinitions?.()?.length ?? 0,
          complexity: 'unknown',
        }),
        analyzeBlocks: async (libraryId: string) => {
          const result = await analyzeLibraryBlocksTool(host.project as any, { libraryNames: [libraryId] });
          if (result.is_error) {
            throw new Error(result.content);
          }
          return result.content;
        },
    } : undefined,
      boardSearch: hasBoardSearch ? {
        search: async (query: string, type?: string) => {
          try {
            const result = await searchBoardsLibrariesTool.handler(
              { query, type: (type as 'boards' | 'libraries' | 'both') || 'both' },
              host.config as any,
            );
            if (result.is_error) return [];
            try { return JSON.parse(result.content); }
            catch { return result.content; }
          } catch { return []; }
        },
        getCategories: async () => {
          const categories = await host.config?.getHardwareCategories?.();
          if (!Array.isArray(categories)) {
            return [];
          }
          return categories.map(category => typeof category === 'string'
            ? category
            : String((category as { name?: unknown; id?: unknown })?.name ?? (category as { id?: unknown })?.id ?? ''));
        },
        getBoardParameters: async () => ({}),
      } : undefined,
    connectionGraph: host.connectionGraph,
    config: host.config,
      auth: host.auth ? {
        getToken: async () => host.auth.getToken?.() ?? host.auth.token,
      isLoggedIn: () => host.auth.isLoggedIn,
    } : undefined,
  };
}

export function createBlocklyCompatibilityHostBinding(cwd = ''): BlocklyCompatibilityHostBinding {
  const hostAPI = buildExternalHostAPI();
  const toolProvider = createBlocklyToolProvider(hostAPI);
  const adapter = BlocklyHostAdapter.create(hostAPI, cwd, toolProvider);
  return { hostAPI, toolProvider, adapter };
}

export function createLexSessionStorage(
  lex: AilyLexModule,
  fs: import('aily-lex/browser').IToolFileSystem,
): import('aily-lex/browser').ISessionStorage {
  // Blockly binds lex snapshot persistence directly to FileSessionStorage.
  // Host-side UI history / index persistence is a separate concern handled by
  // ChatHistoryService + HostSessionRecordStore, not by a custom ElectronSessionStorage class.
  return new lex.FileSessionStorage({
    fs,
    rootDir: getLexSessionStorageRoot(),
    separator: AilyHost.get().platform?.pathSeparator || '\\',
  });
}

export async function loadStoredLexSessionSnapshot(
  lex: AilyLexModule,
  sessionId: string,
  cwd = '',
): Promise<import('aily-lex/browser').SessionSnapshot | null> {
  const { adapter } = createBlocklyCompatibilityHostBinding(cwd);
  const storage = createLexSessionStorage(lex, adapter.fs);
  return await storage.load(sessionId) as import('aily-lex/browser').SessionSnapshot | null;
}

export function getLexRuntimeLLMConfig(
  currentModel?: LexRuntimeModelConfig | null,
  apiConfig?: LexRuntimeApiConfig | null,
): { apiKey: string; baseUrl: string } | null {
  return getLLMConfig(currentModel, apiConfig);
}

export async function resolvePersistedLexSessionSnapshot(
  options: ResolvePersistedLexSessionOptions,
): Promise<import('aily-lex/browser').SessionSnapshot | null> {
  const { lex, sessionId, cwd = '', legacyTurns } = options;

  try {
    const storedSnapshot = await loadStoredLexSessionSnapshot(lex, sessionId, cwd);
    if (storedSnapshot) {
      return storedSnapshot as import('aily-lex/browser').SessionSnapshot;
    }
  } catch (err) {
    console.warn('[LexBootstrap] 读取标准 snapshot 失败，回退 legacy turns:', err);
  }

  return buildLegacyLexSessionSnapshot(legacyTurns, sessionId);
}

export function getMainAgentHostTools(
  ctx: Pick<IChatContext, 'ailyChatConfigService' | 'mcpService'>,
): any[] {
  const tools = getMainAgentLegacyHostTools(ctx.ailyChatConfigService);

  const mcpTools = (ctx.mcpService.tools || []).map(tool => normalizeMcpTool(tool));
  return mcpTools.length > 0 ? tools.concat(mcpTools) : tools;
}

export function buildLexEndpoint(
  lex: AilyLexModule,
  currentModel?: LexRuntimeModelConfig | null,
  apiConfig?: LexRuntimeApiConfig | null,
): any {
  const llmConfig = getLLMConfig(currentModel, apiConfig);

  if (llmConfig?.apiKey && llmConfig?.baseUrl) {
    return new lex.OpenAIEndpoint({
      baseUrl: llmConfig.baseUrl,
      apiKey: llmConfig.apiKey,
      modelFamily: 'openai',
    });
  }

  const apiEndpoint = AilyHost.get().config?.apiEndpoint || '';
  return new lex.AilyServicesEndpoint({
    baseUrl: apiEndpoint,
    authTokenProvider: () => {
      const auth = AilyHost.get().auth;
      if (auth?.getToken) {
        return auth.getToken();
      }
      return auth?.token || '';
    },
  });
}

export function buildLexModelConfig(
  currentModel?: LexRuntimeModelConfig | null,
  maxOutputTokens = 8192,
): any {
  return {
    modelId: currentModel?.model || 'default',
    maxOutputTokens,
  };
}

export function bootstrapBlocklyLexAgent(
  options: BootstrapLexAgentOptions,
): InstanceType<AilyLexModule['AilyLexAgent']> {
  const { ctx, lex, sessionId, askHandler, onSubagentEvent } = options;
  const cwd = ctx.prjPath || ctx.prjRootPath || '';
  const { hostAPI, toolProvider, adapter } = createBlocklyCompatibilityHostBinding(cwd);
  const sessionStorage = createLexSessionStorage(lex, adapter.fs);

  adapter.registerExtension('environment', {
    getEnvironmentSection: () => buildHostEnvironmentSection(),
  });
  adapter.registerExtension('askUser', {
    ask: async (opts: { question: string; options?: { label: string; description?: string }[]; multiSelect: boolean; signal?: AbortSignal }) => {
      return askUserSingle(opts.question, opts.options, opts.multiSelect);
    },
  });
  adapter.registerExtension('diagnostics', {
    getErrors: async (filePaths?: string[]) => collectDiagnostics(filePaths),
  });

  let pendingNpmCommand: { command: string; isInstall: boolean; isUninstall: boolean } | null = null;

  // Blockly only contributes host adapters and domain capabilities here.
  // createAgent() remains the runtime owner for core tool registration,
  // prompt/skill assembly, and AgentExecutor/subagent execution.
  const agent = lex.createAgent({
    host: adapter,
    endpoint: buildLexEndpoint(lex, ctx.currentModel, ctx.ailyChatConfigService),
    model: buildLexModelConfig(ctx.currentModel),
    sessionId: sessionId || ctx.sessionId,
    sessionStorage,
    capabilities: adapter.capabilities,
    cwd: cwd || undefined,
    maxIterations: ctx.ailyChatConfigService.maxCount,
    promptProfile: BLOCKLY_PROMPT_PROFILE,
    userInstructionFolders: ctx.ailyChatConfigService.userInstructionFolders.map(path => ({ path })),
    projectInstructionFolders: ctx.ailyChatConfigService.projectInstructionFolders.map(path => ({ path })),
    hooks: {
      askHandler: askHandler ?? (async () => false),
      onBeforeToolExecution: async (toolName: string, input: Record<string, unknown>) => {
        if (toolName !== 'run_terminal') return { action: 'allow' as const };
        const cmd = String(input['command'] || '');
        const isInstall = /\bnpm\s+(install|i|ci)\b/.test(cmd);
        const isUninstall = /\bnpm\s+uninstall\b/.test(cmd);
        if (!isInstall && !isUninstall) return { action: 'allow' as const };
        pendingNpmCommand = { command: cmd, isInstall, isUninstall };
        if (isUninstall) {
          const blockReason = checkNpmUninstallSafety(cmd);
          if (blockReason) {
            pendingNpmCommand = null;
            return { action: 'block' as const, reason: blockReason };
          }
        }
        return { action: 'allow' as const };
      },
      onAfterToolExecution: async (toolName: string, result: unknown) => {
        if (toolName !== 'run_terminal' || !pendingNpmCommand) return { action: 'continue' as const };
        const npmCmd = pendingNpmCommand;
        pendingNpmCommand = null;
        const isError = (result as any)?.isError ?? false;
        if (isError) return { action: 'continue' as const };
        if (npmCmd.isInstall) await loadNpmLibraries(npmCmd.command);
        return { action: 'continue' as const };
      },
    },
    coreToolFilter: LEX_CORE_SAFE_TOOLS,
    additionalDeferredGroups: DEFERRED_TOOL_GROUPS.map(g => ({
      id: g.name, label: g.name, description: g.brief,
    })),
    toolProvider,
    skillProvider: new BlocklySkillProvider(),
    agentProvider: createBlocklyAgentProvider(),
    approvalHandler: async (request) => {
      const { toolName, input, reason } = request;
      return ctx.handleToolApproval(toolName, input, reason);
    },
    permissionMode: 'default',
  });

  adapter.registerExtension('skillManager', {
    search: (query: string) => {
      const results = BlocklySkillRegistry.searchSkills(query);
      const activated = new Set(BlocklySkillRegistry.getActivatedSkillNames());
      return results.map((r: any) => ({
        name: r.skill.metadata.name,
        description: r.skill.metadata.description,
        loaded: activated.has(r.skill.metadata.name),
      }));
    },
    load: (name: string) => {
      const ok = BlocklySkillRegistry.activateSkill(name);
      if (ok) {
        const skill = BlocklySkillRegistry.get(name);
        if (skill) {
          const content = skill.content || BlocklySkillRegistry.loadSkillContent(name) || '';
          agent.registerSkill({
            name: skill.metadata.name,
            description: skill.metadata.description,
            priority: 80,
            getPromptContent: () => content,
          });
        }
      }
      return ok;
    },
    unload: (name: string) => BlocklySkillRegistry.deactivateSkill(name),
    listLoaded: () => {
      const names = BlocklySkillRegistry.getActivatedSkillNames();
      return names.map((name: string) => {
        const skill = BlocklySkillRegistry.get(name);
        return { name, description: skill?.metadata?.description || '' };
      });
    },
  });

  // Re-expose the lex-owned AgentExecutor back to the host as an extension bridge.
  // This is UI/event wiring only, not a second subagent runtime inside blockly.
  const agentExecutor = createBlocklySubagentExtension(agent);
  const origRunSync = agentExecutor.runSync.bind(agentExecutor);
  (agentExecutor as any).runSync = (subagentOptions: any) => {
    return origRunSync({
      ...subagentOptions,
      onEvent: (event: any) => {
        onSubagentEvent?.(event);
        subagentOptions.onEvent?.(event);
      },
    });
  };
  adapter.registerExtension('agentExecutor', agentExecutor);

  return agent;
}

function getLexSessionStorageRoot(): string {
  const host = AilyHost.get();
  const projectPath = host.project?.currentProjectPath || host.project?.projectRootPath || '';
  if (projectPath) {
    return host.path.join(projectPath, '.chat_history', 'lex-sessions');
  }
  return host.path.join(host.path.getUserHome(), '.aily', 'chat_history', 'lex-sessions');
}

function getLLMConfig(
  currentModel?: LexRuntimeModelConfig | null,
  apiConfig?: LexRuntimeApiConfig | null,
): { apiKey: string; baseUrl: string } | null {
  if (currentModel?.baseUrl && currentModel?.apiKey) {
    return { apiKey: currentModel.apiKey, baseUrl: currentModel.baseUrl };
  }
  if (apiConfig?.useCustomApiKey) {
    return {
      apiKey: apiConfig.apiKey,
      baseUrl: apiConfig.baseUrl,
    };
  }
  return null;
}

function normalizeMcpTool(tool: any): any {
  if (!tool?.name || tool.name.startsWith('mcp_')) {
    return tool;
  }

  return {
    ...tool,
    name: `mcp_${tool.name}`,
  };
}

function buildLegacyLexSessionSnapshot(
  legacyTurns: unknown,
  sessionId: string,
): import('aily-lex/browser').SessionSnapshot | null {
  const rawTurns = extractLegacyTurns(legacyTurns);
  if (rawTurns.length === 0) {
    return null;
  }

  const lexTurns: import('aily-lex/browser').ConversationTurn[] = rawTurns.map((turn: any, index) => ({
    id: turn?.id || `turn-${index}`,
    index,
    request: { content: turn?.request?.content || '' },
    rounds: (turn?.response?.toolCallRounds ?? []).map((round: any, roundIndex: number) => ({
      id: round?.id || `round-${index}-${roundIndex}`,
      assistantText: round?.assistantContent || '',
      toolCalls: (round?.toolCalls ?? []).map((toolCall: any) => ({
        id: toolCall?.id,
        toolName: toolCall?.name,
        input: safeParseJSON(toolCall?.arguments),
        output: round?.results?.[toolCall?.id]?.content,
        error: round?.results?.[toolCall?.id]?.isError ? round.results[toolCall.id].content : undefined,
      })),
      timestamp: turn?.request?.timestamp,
    })),
    response: turn?.response?.content || '',
    status: turn?.response ? 'completed' as const : 'cancelled' as const,
    createdAt: turn?.request?.timestamp,
  }));

  return {
    sessionId,
    turns: lexTurns,
    revision: 0,
    createdAt: lexTurns[0]?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
}

function extractLegacyTurns(legacyTurns: unknown): readonly any[] {
  if (typeof legacyTurns === 'undefined' || legacyTurns === null) {
    return [];
  }

  if (Array.isArray((legacyTurns as any)?.turns)) {
    return (legacyTurns as any).turns;
  }

  return Array.isArray(legacyTurns) ? legacyTurns : [];
}

function safeParseJSON(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== 'string') {
    return { _raw: value as any };
  }

  try {
    return JSON.parse(value);
  } catch {
    return { _raw: value };
  }
}

function checkNpmUninstallSafety(command: string): string | null {
  const npmRegex = /@aily-project\/[a-zA-Z0-9-_]+/g;
  const matches = command.match(npmRegex);
  if (!matches || matches.length === 0) return null;

  const host = AilyHost.get();
  if (!host.blockly || !host.platform) return null;

  const uniqueLibs = [...new Set(matches)];
  const separator = host.platform.pathSeparator || '/';
  const projectPath = host.project?.currentProjectPath || '';
  if (!projectPath) return null;

  const libsInUse: string[] = [];
  for (const libPackageName of uniqueLibs) {
    try {
      const libBlockPath = projectPath + separator + 'node_modules' + separator
        + libPackageName + separator + 'block.json';
      if (host.fs.existsSync(libBlockPath)) {
        const blocksData = JSON.parse(host.fs.readFileSync(libBlockPath, 'utf-8'));
        const abiJson = JSON.stringify(host.blockly.getWorkspaceJson());
        for (const element of blocksData) {
          if (abiJson.includes(element.type)) {
            libsInUse.push(libPackageName);
            break;
          }
        }
      }
    } catch (e) {
      console.warn('[LexStream] npm uninstall 安全检查失败:', libPackageName, e);
    }
  }

  if (libsInUse.length > 0) {
    return `无法卸载以下库，因为项目代码正在使用它们：${libsInUse.join(', ')}。请先删除相关代码块后再尝试卸载。`;
  }

  for (const libPackageName of uniqueLibs) {
    try {
      host.blockly.unloadLibrary(libPackageName, projectPath);
    } catch (e: any) {
      console.warn('[LexStream] 库卸载失败:', libPackageName, e);
    }
  }
  return null;
}

async function loadNpmLibraries(command: string): Promise<void> {
  const host = AilyHost.get();
  if (!host.blockly || !host.platform) return;

  const projectPath = host.project?.currentProjectPath || '';
  if (!projectPath) return;

  const separator = host.platform.pathSeparator || '/';
  const libsToLoad: string[] = [];

  const npmRegex = /@aily-project\/[a-zA-Z0-9-_]+/g;
  const scopedMatches = command.match(npmRegex);
  if (scopedMatches) libsToLoad.push(...scopedMatches);

  const npmInstallArgMatch = command.match(/npm\s+(?:install|i|ci)\b(.*?)(?:&&|$)/);
  const npmInstallArgs = npmInstallArgMatch ? npmInstallArgMatch[1] : '';
  const tokens = npmInstallArgs.trim().split(/\s+/).map(t => t.replace(/^["']|["']$/g, ''));
  const skipTokens = new Set(['--save', '--save-dev', '-D', '-S', '-g', '--global', '--legacy-peer-deps', '--force']);
  for (const token of tokens) {
    if (!token || skipTokens.has(token) || token.startsWith('-')) continue;
    const isLocalPath = token.startsWith('./') || token.startsWith('../')
      || token.startsWith('/') || /^[A-Za-z]:[/\\]/.test(token)
      || token.startsWith('.\\') || token.startsWith('..\\');
    if (isLocalPath) {
      try {
        let fullPath = token;
        if (!(/^[A-Za-z]:[/\\]/.test(token) || token.startsWith('/'))) {
          fullPath = projectPath + separator + token.replace(/[/\\]/g, separator);
        }
        const pkgJsonPath = fullPath.replace(/[/\\]+$/, '') + separator + 'package.json';
        const pkgJson = JSON.parse(host.fs.readFileSync(pkgJsonPath, 'utf-8'));
        if (pkgJson?.name) libsToLoad.push(pkgJson.name);
      } catch (e) {
        console.warn('[LexStream] 读取本地包 package.json 失败:', token, e);
      }
    }
  }

  const uniqueLibs = [...new Set(libsToLoad)];
  for (const libPackageName of uniqueLibs) {
    try {
      await host.blockly.loadLibrary(libPackageName, projectPath);
      console.log('[LexStream] npm 库加载成功:', libPackageName);
    } catch (e: any) {
      console.warn('[LexStream] npm 库加载失败:', libPackageName, e);
    }
  }
}

function buildHostEnvironmentSection(): string {
  const host = AilyHost.get();
  const lines: string[] = [];

  const project = host.project;
  if (project?.currentProjectPath) {
    lines.push(`Project path: ${project.currentProjectPath}`);
  }
  if (project?.projectName) {
    lines.push(`Project: ${project.projectName}`);
  }
  if (project?.currentBoard) {
    lines.push(`Current board: ${project.currentBoard}`);
  }

  try {
    const pkgJson = (project as any)?.getPackageJsonSync?.()
      ?? (window as any)['prjService']?.project?.packageJson;
    const deps = pkgJson?.dependencies;
    if (deps && typeof deps === 'object') {
      const libNames = Object.keys(deps)
        .filter(k => k.startsWith('@aily-project/lib-'))
        .map(k => k.replace('@aily-project/', ''));
      if (libNames.length > 0) {
        lines.push(`Installed libraries (${libNames.length}): ${libNames.join(', ')}`);
      }
    }
  } catch { }

  if (project?.currentProjectPath) {
    const path = project.currentProjectPath;
    lines.push(`ABS source: ${path}/project.abs`);
    lines.push(`Generated C++: ${path}/.temp/sketch/sketch.ino`);
  }

  return lines.length > 0 ? lines.join('\n') : 'No project opened.';
}