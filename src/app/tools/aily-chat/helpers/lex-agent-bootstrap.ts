/**
 * Blockly compatibility bootstrap for aily-lex.
 *
 * This file is intentionally a concrete host binding for aily-blockly. It wires
 * blockly host services and domain contributions into lex's generic runtime
 * contract, but it is not the canonical integration path for non-blockly hosts.
 */

import type { IChatCoordination, IChatServiceAccess, IProjectContext, ISessionAccess } from '../core/chat-context';
import { AilyHost } from '../core/host';
import { MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE, normalizeAgentIdentifier } from '../core/agent-identifiers';
import { BLOCKLY_MAIN_AGENT_REQUIRED_CONTEXT, BLOCKLY_PROMPT_PROFILE } from '../core/blockly-prompt-profile';
import { getBlocklyContextSnapshotService } from '../core/blockly-context-snapshot-service';
import { BLOCKLY_LEX_DEFERRED_GROUPS, createBlocklyToolProvider } from '../core/blockly-contributed-tools';
import { createBlocklyAgentProvider } from '../core/blockly-agent-provider';
import { createBlocklySlashCommandProvider } from '../core/blockly-slash-command-provider';
import { createBlocklySubagentExtension } from '../core/blockly-subagent-extension';
import { getBundledLexAgentFiles } from '../agents/bundled-lex-agent-files';
import { BlocklySkillProvider } from '../core/blockly-skill-provider';
import { SkillRegistry as BlocklySkillRegistry } from '../core/skill-registry';
import { askUserMany, askUserSingle } from '../core/ask-user';
import { collectDiagnostics } from '../core/diagnostics';
import { getProjectInfoTool } from '../tools/getProjectInfoTool';
import { syncAbsFileHandler } from '../tools/syncAbsFileTool';
import { analyzeLibraryBlocksTool } from '../tools/editBlockTool';
import { searchBoardsLibrariesTool } from '../tools/searchBoardsLibrariesTool';
import { TOOL_SETTINGS_CATALOG } from '../tools/tool-settings-catalog';
import type { PersistedHostResponseData } from '../services/chat-history.service';
import { EditingContentStore } from '../services/editing-content-store.service';
import { EditingTextDiffService } from '../services/editing-text-diff.service';
import { EditingTimelineRepository } from '../services/editing-timeline-repository.service';
import { EditingTimelineRecordingBridge } from '../services/editing-timeline-recording-bridge';
import type { EditingTimelineFileWriteEvent } from '../services/editing-timeline-recording-bridge';
import type { EditingTextLineChange } from '../services/editing-text-diff.types';
import type { NormalizedTextEdit } from '../services/editing-timeline.types';
import { LEGACY_HOST_EXTERNAL_TOOLS } from '../tools/legacy-host-tool-definitions';
import {
  BlocklyHostAdapter,
  createBlocklyHostBinding,
  createEnvironmentProviderFromContext,
  type IExternalHostAPI,
} from 'aily-lex/host/blockly';
import {
  createConversationTurnResponse,
  GitAwareWorkspaceChangeCollector,
  type IHostToolProvider,
  type IToolContribution,
} from 'aily-lex/browser';
import {
  cloneTurnResponseRoundSummaryCarrier,
  cloneTurnResponseRoundSummaryCarriers,
  getTurnResponseResolvedModelName,
  normalizeTurnResponseSummaryPreview,
} from './turn-response-response-model';

export type AilyLexModule = typeof import('aily-lex/browser');
type BlocklyLexAgentInstance = InstanceType<AilyLexModule['AilyLexAgent']>;

export interface LexRuntimeModelConfig {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  presetId?: string;
  contextWindowTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
}

export interface LexRuntimeApiConfig {
  useCustomApiKey: boolean;
  apiKey: string;
  baseUrl: string;
  maxRequests?: number;
}

const DEFAULT_INTERACTION_HARD_ROUND_CAP = 200;

interface ResolvePersistedLexSessionOptions {
  lex: AilyLexModule;
  sessionId: string;
  cwd?: string;
  turnResponses?: readonly import('aily-lex/browser').TurnResponseTurn[];
}

interface BootstrapLexAgentOptions {
  ctx: BootstrapLexAgentContext;
  lex: AilyLexModule;
  sessionId?: string;
  askHandler?: (askContext: any) => Promise<boolean>;
  onSubagentEvent?: (event: any) => void;
}

export type BootstrapLexAgentContext = Pick<IProjectContext, 'prjPath' | 'prjRootPath' | 'currentModel'>
  & Pick<ISessionAccess, 'sessionId'>
  & Pick<IChatServiceAccess, 'ailyChatConfigService' | 'mcpService' | 'editCheckpointService'>
  & Pick<IChatCoordination, 'handleToolApproval'>;

export interface BlocklyCompatibilityHostBinding {
  hostAPI: IExternalHostAPI;
  toolProvider: ReturnType<typeof createBlocklyToolProvider>;
  adapter: BlocklyHostAdapter;
}

interface BlocklyStandardHostBinding {
  hostAPI: IExternalHostAPI;
  toolProvider: ReturnType<typeof createBlocklyToolProvider>;
  adapter: BlocklyHostAdapter;
}

const BLOCKLY_SUBAGENT_REQUIRED_CONTEXT = {
  scopes: [...BLOCKLY_MAIN_AGENT_REQUIRED_CONTEXT.scopes],
  strict: BLOCKLY_MAIN_AGENT_REQUIRED_CONTEXT.strict,
  hydrateBeforeFirstModelCall: BLOCKLY_MAIN_AGENT_REQUIRED_CONTEXT.hydrateBeforeFirstModelCall,
} as const;

// Host/runtime boundary:
// - this set only selects lex-owned core tools for the main agent
// - blockly-specific capabilities must enter through toolProvider / agentProvider / skillProvider
// - if a tool is portable across hosts, it should move into aily-lex core instead of growing this host list
const LEX_CORE_SAFE_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'multi_edit_file',
  'delete_file', 'list_dir', 'create_directory',
  'grep_search', 'glob_search',
  'run_terminal', 'get_terminal_output', 'send_to_terminal', 'kill_terminal', 'agent',
  'get_changed_files',
  'fetch_webpage', 'clone_repository',
  'todo_manage',
  'get_context',
  'ask_user',
  'get_errors',
  'web_search',
  'tool_search',
  'load_skill',
]);

const TOOL_CONFIG_AGENTS = [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] as const;

type ToolConfigAgent = typeof TOOL_CONFIG_AGENTS[number];

type AgentToolConfigAccessor = Pick<IChatServiceAccess, 'ailyChatConfigService'>['ailyChatConfigService'];

type RequestToolSelectionContext = {
  mcpService: Pick<IChatServiceAccess, 'mcpService'>['mcpService'];
} & (
  | { ailyChatConfigService: AgentToolConfigAccessor }
  | AgentToolConfigAccessor
);

type ToolCatalogSource = 'core' | 'contributed' | 'mcp';

export interface RuntimeToolCatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly agents: readonly ToolConfigAgent[];
  readonly source: ToolCatalogSource;
}

export type RequestUserSelectedTools = Readonly<Record<string, boolean>>;

function isToolConfigAgent(value: string): value is ToolConfigAgent {
  return TOOL_CONFIG_AGENTS.includes(value as ToolConfigAgent);
}

function getDefaultToolConfigAgents(): ToolConfigAgent[] {
  return [...TOOL_CONFIG_AGENTS];
}

function getContributionAgents(contribution: Pick<IToolContribution, 'agentScope'>): ToolConfigAgent[] {
  if (!Array.isArray(contribution.agentScope) || contribution.agentScope.length === 0) {
    return getDefaultToolConfigAgents();
  }

  const normalized = contribution.agentScope
    .map(agent => normalizeAgentIdentifier(agent))
    .filter(isToolConfigAgent);

  return normalized.length > 0 ? normalized : getDefaultToolConfigAgents();
}

function isToolEnabledForAgent(
  configService: AgentToolConfigAccessor,
  agentName: ToolConfigAgent,
  toolName: string,
): boolean {
  const config = configService.getAgentToolsConfig(agentName);
  if (config?.disabledTools?.includes(toolName)) {
    return false;
  }

  return true;
}

function resolveAgentToolConfigAccessor(
  ctx: RequestToolSelectionContext,
): AgentToolConfigAccessor {
  return 'ailyChatConfigService' in ctx ? ctx.ailyChatConfigService : ctx;
}

export function getConfiguredCoreToolFilter(
  configService: AgentToolConfigAccessor,
): ReadonlySet<string> {
  return new Set(
    [...LEX_CORE_SAFE_TOOLS].filter(toolName => isToolEnabledForAgent(configService, MAIN_AGENT_TYPE, toolName)),
  );
}

function cloneContributionWithScopedAgents(
  contribution: IToolContribution,
  agents: readonly ToolConfigAgent[],
): IToolContribution {
  return {
    ...contribution,
    agentScope: [...agents],
  };
}

export function filterContributedToolsByAgentToolConfig(
  contributions: readonly IToolContribution[],
  configService: AgentToolConfigAccessor,
): IToolContribution[] {
  const filtered: IToolContribution[] = [];

  for (const contribution of contributions) {
    const configuredAgents = getContributionAgents(contribution).filter(agentName => {
      return isToolEnabledForAgent(configService, agentName, contribution.name);
    });

    if (configuredAgents.length === 0) {
      continue;
    }

    const originalAgents = getContributionAgents(contribution);
    const sameScope = configuredAgents.length === originalAgents.length
      && configuredAgents.every((agent, index) => agent === originalAgents[index]);

    filtered.push(sameScope ? contribution : cloneContributionWithScopedAgents(contribution, configuredAgents));
  }

  return filtered;
}

function toHostToolShape(contribution: IToolContribution): any {
  return {
    name: contribution.name,
    description: contribution.description || contribution.name,
    input_schema: contribution.inputSchema || { type: 'object', properties: {} },
  };
}

function mergeRuntimeToolCatalogEntries(entries: readonly RuntimeToolCatalogEntry[]): RuntimeToolCatalogEntry[] {
  const merged = new Map<string, RuntimeToolCatalogEntry>();

  for (const entry of entries) {
    const existing = merged.get(entry.name);
    if (!existing) {
      merged.set(entry.name, {
        ...entry,
        agents: [...entry.agents],
      });
      continue;
    }

    const nextAgents = [...new Set([...existing.agents, ...entry.agents])]
      .filter(isToolConfigAgent);

    merged.set(entry.name, {
      name: entry.name,
      description: existing.description || entry.description,
      source: existing.source,
      agents: nextAgents,
    });
  }

  const sourceOrder: Record<ToolCatalogSource, number> = { core: 0, contributed: 1, mcp: 2 };
  return [...merged.values()].sort((left, right) => {
    const sourceDelta = sourceOrder[left.source] - sourceOrder[right.source];
    if (sourceDelta !== 0) {
      return sourceDelta;
    }
    return left.name.localeCompare(right.name);
  });
}

function getCatalogDescription(name: string): string {
  return TOOL_SETTINGS_CATALOG.find(tool => tool.name === name)?.description || name;
}

function getRuntimeCoreToolCatalogEntries(): RuntimeToolCatalogEntry[] {
  return [...LEX_CORE_SAFE_TOOLS].sort((left, right) => left.localeCompare(right)).map(toolName => ({
    name: toolName,
    description: getCatalogDescription(toolName),
    agents: [MAIN_AGENT_TYPE],
    source: 'core' as const,
  }));
}

function getRuntimeContributedToolCatalogEntries(cwd = ''): RuntimeToolCatalogEntry[] {
  const { toolProvider } = createBlocklyStandardHostBinding(cwd);
  return toolProvider.contributeTools().map(contribution => ({
    name: contribution.name,
    description: contribution.description || contribution.name,
    agents: getContributionAgents(contribution),
    source: 'contributed' as const,
  }));
}

function getRuntimeMcpToolCatalogEntries(tools: readonly any[] | undefined): RuntimeToolCatalogEntry[] {
  return (tools || []).map(tool => {
    const normalized = normalizeMcpTool(tool);
    return {
      name: normalized.name,
      description: normalized.description || normalized.name,
      agents: [MAIN_AGENT_TYPE],
      source: 'mcp' as const,
    };
  });
}

export function getRuntimeToolSettingsCatalog(
  ctx: Pick<IChatServiceAccess, 'mcpService'>,
  cwd = '',
): RuntimeToolCatalogEntry[] {
  return mergeRuntimeToolCatalogEntries([
    ...getRuntimeCoreToolCatalogEntries(),
    ...getRuntimeContributedToolCatalogEntries(cwd),
    ...getRuntimeMcpToolCatalogEntries(ctx.mcpService?.tools),
  ]);
}

export function getUserSelectedToolsForRequest(
  ctx: RequestToolSelectionContext,
  requestAgentId?: string,
  cwd = '',
): RequestUserSelectedTools | undefined {
  const normalizedAgentId = typeof requestAgentId === 'string' && requestAgentId.trim().length > 0
    ? normalizeAgentIdentifier(requestAgentId)
    : MAIN_AGENT_TYPE;

  if (!isToolConfigAgent(normalizedAgentId)) {
    return undefined;
  }

  const catalogEntries = getRuntimeToolSettingsCatalog(ctx, cwd)
    .filter(entry => entry.agents.includes(normalizedAgentId));

  if (catalogEntries.length === 0) {
    return undefined;
  }

  const configService = resolveAgentToolConfigAccessor(ctx);
  const userSelectedTools: Record<string, boolean> = {};
  for (const entry of catalogEntries) {
    userSelectedTools[entry.name] = isToolEnabledForAgent(configService, normalizedAgentId, entry.name);
  }

  return userSelectedTools;
}

function registerBlocklySkillOnLexAgent(
  agent: { registerSkill(skill: any): void },
  name: string,
): boolean {
  const skill = BlocklySkillRegistry.get(name);
  if (!skill) {
    return false;
  }

  const content = skill.content || BlocklySkillRegistry.loadSkillContent(name) || '';
  agent.registerSkill({
    name: skill.metadata.name,
    description: skill.metadata.description,
    priority: 80,
    getPromptContent: () => content,
  });
  return true;
}

function syncPersistedActiveSkills(
  agent: {
    getActiveSkillNames?(): readonly string[];
    unregisterSkill?(name: string): boolean;
    registerSkill(skill: any): void;
  },
  activeSkillNames: readonly string[] | undefined,
): void {
  const desired = new Set(activeSkillNames ?? []);

  for (const name of agent.getActiveSkillNames?.() ?? []) {
    if (desired.has(name)) {
      continue;
    }
    BlocklySkillRegistry.deactivateSkill(name);
    agent.unregisterSkill?.(name);
  }

  for (const name of desired) {
    if (!BlocklySkillRegistry.activateSkill(name)) {
      continue;
    }
    registerBlocklySkillOnLexAgent(agent, name);
  }
}

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

const EDITING_TIMELINE_DIFF_OPTIONS = {
  ignoreTrimWhitespace: false,
  maxComputationTimeMs: 5_000,
  computeMoves: false,
  extendToSubwords: true,
} as const;

async function computeNormalizedTextEdits(beforeContent: string, afterContent: string): Promise<NormalizedTextEdit[] | undefined> {
  if (beforeContent === afterContent) {
    return undefined;
  }

  const diffService = new EditingTextDiffService({ preferWorker: false });
  const diff = await diffService.computeDiff(beforeContent, afterContent, EDITING_TIMELINE_DIFF_OPTIONS);
  const edits = diff.changes.flatMap(change => toNormalizedTextEdits(change, afterContent));
  return edits.length > 0 ? edits : undefined;
}

function toNormalizedTextEdits(change: EditingTextLineChange, modifiedContent: string): NormalizedTextEdit[] {
  if (Array.isArray(change.charChanges) && change.charChanges.length > 0) {
    return change.charChanges.map(charChange => ({
      startLine: charChange.originalStartLineNumber,
      startColumn: charChange.originalStartColumn,
      endLine: charChange.originalEndLineNumber,
      endColumn: charChange.originalEndColumn,
      newText: sliceTextByPosition(
        modifiedContent,
        charChange.modifiedStartLineNumber,
        charChange.modifiedStartColumn,
        charChange.modifiedEndLineNumber,
        charChange.modifiedEndColumn,
      ),
    }));
  }

  return [{
    startLine: change.originalStartLineNumber,
    startColumn: 1,
    endLine: change.originalEndLineNumberExclusive,
    endColumn: 1,
    newText: sliceTextByPosition(
      modifiedContent,
      change.modifiedStartLineNumber,
      1,
      change.modifiedEndLineNumberExclusive,
      1,
    ),
  }];
}

function sliceTextByPosition(
  content: string,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): string {
  const lineStarts = computeLineStarts(content);
  const startOffset = positionToOffset(lineStarts, content.length, startLine, startColumn);
  const endOffset = positionToOffset(lineStarts, content.length, endLine, endColumn);
  return content.slice(startOffset, endOffset);
}

function computeLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function positionToOffset(lineStarts: readonly number[], contentLength: number, line: number, column: number): number {
  const safeLine = Math.max(1, line);
  const lineIndex = Math.min(safeLine - 1, lineStarts.length - 1);
  const lineStart = lineStarts[lineIndex] ?? contentLength;
  return Math.min(contentLength, lineStart + Math.max(0, column - 1));
}

export function buildExternalHostAPI(): IExternalHostAPI {
  const host = AilyHost.get();
  const contextSnapshotService = getBlocklyContextSnapshotService();
  (window as { path?: typeof host.path }).path = host.path;
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
  const terminal = createExternalTerminal(host, prjPath);

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
    terminal,
    platform: {
        type: resolvePlatformType(host.platform?.type, host.platform?.isWindows, host.platform?.isMacOS),
      cwd: () => prjPath(),
        homedir: () => host.platform?.homedir?.() ?? host.path.getUserHome(),
      env: (key: string) => host.env?.get?.(key),
    },
    project: host.project ? {
        getProjectInfo: async () => {
          if (typeof host.project.getProjectInfo === 'function') {
            return host.project.getProjectInfo();
          }

          try {
            const legacyResult = await getProjectInfoTool(host.project as any, { include_readme: true });
            if (!legacyResult.is_error) {
              return JSON.parse(legacyResult.content);
            }
          } catch {
            // Fall back to the minimal project shape below when legacy discovery is unavailable.
          }

          return {
            name: host.project.projectName,
            path: prjPath(),
            board: host.project.currentBoard,
          };
        },
      getProjectPath: () => host.project.currentProjectPath,
      getBoard: () => host.project.currentBoard,
        createProject: host.project.createProject
          ? async (name: string, board: string, path?: string) => {
              const result = await host.project.createProject!(name, board, path ?? prjPath());
              contextSnapshotService.invalidate([
                'workspaceIdentity',
                'projectInfo',
                'boardInfo',
                'libraryIndex',
                'libraryReadmeRefs',
                'workspaceArtifacts',
                'workspaceState',
              ], 'project create');
              return result;
            }
          : undefined,
        reloadProject: host.project.reloadProject
          ? async () => {
              const result = await host.project.reloadProject!();
              contextSnapshotService.invalidate([
                'projectInfo',
                'boardInfo',
                'libraryIndex',
                'libraryReadmeRefs',
                'workspaceArtifacts',
                'workspaceState',
              ], 'project reload');
              return result;
            }
          : undefined,
        switchBoard: typeof (host.project as any)?.switchBoard === 'function'
          ? async (board: string) => {
              const result = await (host.project as any).switchBoard(board);
              contextSnapshotService.invalidate([
                'boardInfo',
                'libraryIndex',
                'libraryReadmeRefs',
                'workspaceArtifacts',
                'workspaceState',
              ], 'switch board');
              return result;
            }
          : undefined,
        getBoardConfig: host.project.getBoardJson
          ? async () => host.project.getBoardJson!()
          : undefined,
        setBoardConfig: typeof (host.project as any)?.setBoardConfig === 'function'
          ? async (config: Record<string, unknown>) => {
              const result = await (host.project as any).setBoardConfig(config);
              contextSnapshotService.invalidate([
                'boardInfo',
                'workspaceArtifacts',
                'workspaceState',
              ], 'set board config');
              return result;
            }
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
      authChanged$: host.auth.authChanged$,
      getSnapshot: () => host.auth.getSnapshot?.() ?? null,
    } : undefined,
  };
}

export function createBlocklySearchCompatibilityHostBinding(cwd = ''): BlocklyCompatibilityHostBinding {
  const binding = createBlocklyStandardHostBinding(cwd);
  attachBlocklyCompatibilityExtensions(binding.adapter);
  return binding;
}

export function createBlocklyCompatibilityHostBinding(cwd = ''): BlocklyCompatibilityHostBinding {
  return createBlocklySearchCompatibilityHostBinding(cwd);
}

export function createBlocklyStandardHostBinding(cwd = ''): BlocklyStandardHostBinding {
  const hostAPI = buildExternalHostAPI();
  const toolProvider = createBlocklyToolProvider(hostAPI);
  const binding = createBlocklyHostBinding({ hostAPI, cwd, toolProvider });
  return {
    hostAPI,
    toolProvider,
    adapter: binding.adapter,
  };
}

function attachBlocklyCompatibilityExtensions(adapter: BlocklyHostAdapter): void {
  const searchExtension = createBlocklySearchExtension();
  if (searchExtension) {
    adapter.registerExtension('search', searchExtension);
  }
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
  const { adapter } = createBlocklyStandardHostBinding(cwd);
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
  const { lex, sessionId, cwd = '', turnResponses } = options;

  try {
    const storedSnapshot = await loadStoredLexSessionSnapshot(lex, sessionId, cwd);
    if (storedSnapshot) {
      return storedSnapshot as import('aily-lex/browser').SessionSnapshot;
    }
  } catch (err) {
    console.warn('[LexBootstrap] 读取标准 snapshot 失败:', err);
  }

  const turnResponseSnapshot = buildTurnResponseLexSessionSnapshot(turnResponses, sessionId);
  if (turnResponseSnapshot) {
    return turnResponseSnapshot;
  }

  return null;
}

export function getMainAgentHostTools(
  ctx: Pick<IChatServiceAccess, 'ailyChatConfigService' | 'mcpService'>,
): any[] {
  const tools = getConfiguredMainAgentHostTools(ctx.ailyChatConfigService);

  const mcpTools = (ctx.mcpService.tools || []).map(tool => normalizeMcpTool(tool));
  return mcpTools.length > 0 ? tools.concat(mcpTools) : tools;
}

function getConfiguredMainAgentHostTools(
  configService: Pick<IChatServiceAccess, 'ailyChatConfigService'>['ailyChatConfigService'],
): any[] {
  const { toolProvider } = createBlocklyStandardHostBinding('');
  return filterContributedToolsByAgentToolConfig(toolProvider.contributeTools(), configService)
    .filter(tool => getContributionAgents(tool).includes(MAIN_AGENT_TYPE))
    .map(tool => toHostToolShape(tool));
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
    authStateFingerprintProvider: () => {
      const auth = AilyHost.get().auth;
      return {
        isLoggedIn: auth?.isLoggedIn ?? false,
        token: auth?.token || '',
        userId: auth?.userInfo?.id ?? null,
        snapshot: auth?.getSnapshot?.() ?? null,
      };
    },
    interactionBudget: buildInteractionBudgetConfig(apiConfig),
  });
}

function buildInteractionBudgetConfig(apiConfig?: LexRuntimeApiConfig | null): Partial<Record<string, number>> {
  const softRoundLimit = normalizeSoftRoundLimit(apiConfig?.maxRequests);

  return {
    softRoundLimit,
  };
}

function normalizeSoftRoundLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_INTERACTION_HARD_ROUND_CAP;
  }

  return Math.max(1, Math.min(DEFAULT_INTERACTION_HARD_ROUND_CAP, Math.trunc(value)));
}

export function buildLexModelConfig(
  currentModel?: LexRuntimeModelConfig | null,
  maxOutputTokens = 8192,
): any {
  return {
    modelId: currentModel?.model || 'default',
    presetId: currentModel?.presetId,
    contextWindowTokens: currentModel?.contextWindowTokens,
    reasoningEffort: currentModel?.reasoningEffort,
    maxOutputTokens,
  };
}

export function bootstrapBlocklyLexAgent(
  options: BootstrapLexAgentOptions,
): BlocklyLexAgentInstance {
  const { ctx, lex, sessionId, askHandler, onSubagentEvent } = options;
  const cwd = ctx.prjPath || ctx.prjRootPath || '';
  const { hostAPI, toolProvider, adapter } = createBlocklyStandardHostBinding(cwd);
  attachBlocklyCompatibilityExtensions(adapter);
  const contextSnapshotService = getBlocklyContextSnapshotService();
  const sessionStorage = createLexSessionStorage(lex, adapter.fs);

  const runtimeExtensions: Record<string, unknown> = {
    environment: createEnvironmentProviderFromContext(
      contextSnapshotService,
      BLOCKLY_SUBAGENT_REQUIRED_CONTEXT,
      'subagent-environment',
    ),
    contextSnapshot: contextSnapshotService,
    askUser: {
      ask: async (opts: { question: string; options?: { label: string; description?: string; recommended?: boolean }[]; multiSelect: boolean; allowFreeform?: boolean; signal?: AbortSignal }) => {
        return askUserSingle(opts.question, opts.options, opts.multiSelect, opts.allowFreeform ?? true);
      },
      askMany: async (opts: { questions: { question: string; options?: { label: string; description?: string; recommended?: boolean }[]; allow_freeform?: boolean; multi_select?: boolean }[]; signal?: AbortSignal }) => {
        return askUserMany(opts.questions);
      },
    },
    diagnostics: {
      getErrors: async (filePaths?: string[]) => collectDiagnostics(filePaths),
    },
  };
  if (cwd && (sessionId || ctx.sessionId)) {
    const editingTimelineRepository = new EditingTimelineRepository({
      joinPath: (...parts) => AilyHost.get().path.join(...parts),
    });
    const editingContentStore = new EditingContentStore({
      joinPath: (...parts) => AilyHost.get().path.join(...parts),
    });
    const editingTimelineRecorder = new EditingTimelineRecordingBridge(
      editingTimelineRepository,
      editingContentStore,
      cwd,
      sessionId || ctx.sessionId,
    );
    runtimeExtensions['editingTimeline'] = {
      recordFileWrite: async (event: EditingTimelineFileWriteEvent) => {
        const edits = event.contentKind !== 'binary'
          && event.beforeContent !== null
          && event.beforeContent !== undefined
          && event.afterContent !== null
          && event.afterContent !== undefined
          ? await computeNormalizedTextEdits(event.beforeContent, event.afterContent)
          : undefined;
        editingTimelineRecorder.recordFileWrite({
          ...event,
          ...(edits ? { edits } : {}),
        });
      },
      reconcileWorktreeChanges: async (input: {
        turnId: string;
        filePaths: readonly string[];
        repositoryRoots?: readonly string[];
        changes?: readonly ({
          filePath: string;
          kind: 'create' | 'modify' | 'delete';
          contentKind: 'text' | 'binary' | 'notebook';
        } | {
          filePath: string;
          previousFilePath: string;
          kind: 'rename';
          contentKind: 'text' | 'binary' | 'notebook';
        })[];
      }) => {
        ctx.editCheckpointService?.recordAdditionalRepositoryRoots?.(input.repositoryRoots);
        await editingTimelineRecorder.reconcileWorktreeChanges({
          ...input,
          readCurrentText: async (filePath: string) => {
            try {
              return AilyHost.get().fs.readFileSync(filePath, 'utf-8');
            } catch {
              return null;
            }
          },
          readCurrentBytes: async (filePath: string) => {
            try {
              return normalizeHostBytes((AilyHost.get().fs.readFileSync as any)(filePath));
            } catch {
              return null;
            }
          },
          computeEdits: computeNormalizedTextEdits,
        });
      },
    };
    runtimeExtensions['workspaceChangeCollector'] = new GitAwareWorkspaceChangeCollector();
  }

  let pendingNpmCommand: { command: string; isInstall: boolean; isUninstall: boolean } | null = null;

  // Blockly only contributes host adapters and domain capabilities here.
  // createAgent() remains the runtime owner for core tool registration,
  // prompt/skill assembly, and AgentExecutor/subagent execution.
  const terminalPolicy = ctx.ailyChatConfigService.getLexTerminalPolicy?.();
  const permissionPolicy = ctx.ailyChatConfigService.getLexPermissionPolicy?.(ctx.prjPath || ctx.prjRootPath || '');
  const agent = lex.createAgent({
    host: adapter,
    endpoint: buildLexEndpoint(lex, ctx.currentModel, ctx.ailyChatConfigService),
    model: buildLexModelConfig(ctx.currentModel),
    sessionId: sessionId || ctx.sessionId,
    sessionStorage,
    capabilities: adapter.capabilities,
    cwd: cwd || undefined,
    maxToolCallIterations: ctx.ailyChatConfigService.maxRequests,
    promptProfile: BLOCKLY_PROMPT_PROFILE,
    extensions: runtimeExtensions,
    userInstructionFolders: ctx.ailyChatConfigService.userInstructionFolders.map(path => ({ path })),
    projectInstructionFolders: ctx.ailyChatConfigService.projectInstructionFolders.map(path => ({ path })),
    projectAgentFiles: getBundledLexAgentFiles(),
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
        if (npmCmd.isInstall) {
          await loadNpmLibraries(npmCmd.command);
          contextSnapshotService.invalidate(['libraryIndex', 'libraryReadmeRefs'], 'npm install');
        }
        if (npmCmd.isUninstall) {
          contextSnapshotService.invalidate(['libraryIndex', 'libraryReadmeRefs'], 'npm uninstall');
        }
        return { action: 'continue' as const };
      },
    },
    coreToolFilter: LEX_CORE_SAFE_TOOLS,
    additionalDeferredGroups: BLOCKLY_LEX_DEFERRED_GROUPS.map(g => ({
      id: g.id, label: g.label, description: g.description,
    })),
    toolProvider,
    skillProvider: new BlocklySkillProvider(),
    agentProvider: createBlocklyAgentProvider(),
    slashCommandProvider: createBlocklySlashCommandProvider(),
    approvalHandler: async request => ctx.handleToolApproval({
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      title: request.title || '',
      subtitle: request.subtitle,
      message: request.message || '',
      source: request.source,
      actions: request.actions,
      primaryScope: request.primaryScope,
      allowAutoConfirm: request.allowAutoConfirm,
      approveCombination: request.approveCombination,
      args: request.input,
    }),
    permissionPolicy,
    permissionMode: 'default',
    terminalPolicy,
  });

  attachBlocklyPostCreateExtensions(agent, adapter, onSubagentEvent);

  return agent;
}

function attachBlocklyPostCreateExtensions(
  agent: BlocklyLexAgentInstance,
  adapter: BlocklyHostAdapter,
  onSubagentEvent?: (event: any) => void,
): void {
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
        registerBlocklySkillOnLexAgent(agent, name);
      }
      return ok;
    },
    unload: (name: string) => {
      const ok = BlocklySkillRegistry.deactivateSkill(name);
      if (ok) {
        agent.unregisterSkill(name);
      }
      return ok;
    },
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
  const origRestoreSession = agent.restoreSession.bind(agent);
  (agent as any).restoreSession = (snapshot: import('aily-lex/browser').SessionSnapshot) => {
    origRestoreSession(snapshot);
    syncPersistedActiveSkills(agent, snapshot.activeSkillNames);
  };
  adapter.registerExtension('agentExecutor', agentExecutor);
}

function createBlocklySearchExtension(): {
  searchFiles?(input: {
    pattern: string;
    cwd: string;
    maxResults: number;
    signal?: AbortSignal;
  }): Promise<string[]>;
  searchText?(input: {
    query: string;
    isRegexp: boolean;
    includePattern?: string;
    maxResults: number;
    cwd: string;
  }): Promise<Array<{ file: string; line: number; content: string }>>;
} | null {
  const ripgrep = (window as any)?.electronAPI?.ripgrep;
  const hasSearchContent = typeof ripgrep?.searchContent === 'function';
  const hasListAllContentFiles = typeof ripgrep?.listAllContentFiles === 'function';
  if (!hasSearchContent && !hasListAllContentFiles) {
    return null;
  }

  const searchExtension: {
    searchFiles?: (input: {
      pattern: string;
      cwd: string;
      maxResults: number;
      signal?: AbortSignal;
    }) => Promise<string[]>;
    searchText?: (input: {
      query: string;
      isRegexp: boolean;
      includePattern?: string;
      maxResults: number;
      cwd: string;
    }) => Promise<Array<{ file: string; line: number; content: string }>>;
  } = {};

  if (hasListAllContentFiles) {
    searchExtension.searchFiles = async (input) => {
      const matchesEverything = input.pattern === '**/*' || input.pattern === '**' || input.pattern === '*';
      const regex = matchesEverything ? null : globToRegex(input.pattern);
      const seen = new Set<string>();
      const matches: string[] = [];
      let scanLimit = Math.max(input.maxResults * 50, 2000);
      let lastBatchSize = 0;

      while (true) {
        const result = await ripgrep.listAllContentFiles(input.cwd, scanLimit);
        if (!result?.success) {
          throw new Error(result?.error || 'Blockly ripgrep file listing failed');
        }

        const files = Array.isArray(result.files) ? result.files : [];
        lastBatchSize = files.length;
        appendSearchFileMatches(files, input.cwd, regex, seen, matches, input.maxResults);

        if (matches.length >= input.maxResults || files.length < scanLimit || scanLimit >= 32000) {
          break;
        }

        scanLimit = Math.min(scanLimit * 2, 32000);
      }

      if (matches.length < input.maxResults) {
        appendSearchFileMatchesFromHostFs(input.cwd, regex, seen, matches, input.maxResults);
      }

      if (matches.length === 0 && lastBatchSize === 0) {
        return [];
      }

      return matches.slice(0, input.maxResults);
    };
  }

  if (hasSearchContent) {
    searchExtension.searchText = async (input) => {
      const result = await ripgrep.searchContent({
        pattern: input.query,
        path: input.cwd,
        include: input.includePattern,
        isRegex: input.isRegexp,
        maxResults: input.maxResults,
        ignoreCase: true,
        maxLineLength: 500,
      });

      if (!result?.success) {
        throw new Error(result?.error || 'Blockly ripgrep search failed');
      }

      if (!Array.isArray(result.matches)) {
        return [];
      }

      return result.matches
        .filter((match: any) => !!match?.file)
        .map((match: any) => ({
          file: String(match.file),
          line: Number(match.line || 0),
          content: String(match.content || ''),
        }));
    };
  }

  return searchExtension;
}

function appendSearchFileMatches(
  files: readonly unknown[],
  cwd: string,
  regex: RegExp | null,
  seen: Set<string>,
  matches: string[],
  maxResults: number,
): void {
  for (const file of files) {
    const normalized = normalizePath(String(file));
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    const relative = relativizePath(normalized, cwd);
    if (!relative || (regex && !regex.test(relative))) {
      continue;
    }

    seen.add(normalized);
    matches.push(normalized);
    if (matches.length >= maxResults) {
      return;
    }
  }
}

function appendSearchFileMatchesFromHostFs(
  cwd: string,
  regex: RegExp | null,
  seen: Set<string>,
  matches: string[],
  maxResults: number,
): void {
  const host = AilyHost.get();
  const pending = [cwd];

  while (pending.length > 0 && matches.length < maxResults) {
    const current = pending.pop()!;
    const entries = readSearchDirectoryNames(host, current);
    for (const entry of entries) {
      const absolutePath = host.path.join(current, entry);
      const stat = safeSearchStat(host, absolutePath);
      if (!stat) {
        continue;
      }

      const relative = relativizePath(absolutePath, cwd);
      if (stat.isDirectory) {
        if (relative && !isIgnoredSearchPath(relative)) {
          pending.push(absolutePath);
        }
        continue;
      }

      if (!stat.isFile || !relative) {
        continue;
      }

      const normalizedAbsolutePath = normalizePath(absolutePath);
      if (seen.has(normalizedAbsolutePath) || (regex && !regex.test(relative))) {
        continue;
      }

      seen.add(normalizedAbsolutePath);
      matches.push(normalizedAbsolutePath);
      if (matches.length >= maxResults) {
        return;
      }
    }
  }
}

function readSearchDirectoryNames(host: any, path: string): string[] {
  try {
    return toDirectoryNames(host.fs.readdirSync?.(path) ?? host.fs.readDirSync?.(path));
  } catch {
    return [];
  }
}

function safeSearchStat(
  host: any,
  path: string,
): { isFile: boolean; isDirectory: boolean } | null {
  try {
    const stat = host.fs.statSync(path);
    return {
      isFile: typeof stat?.isFile === 'function' ? stat.isFile() : !!stat?.isFile,
      isDirectory: typeof stat?.isDirectory === 'function' ? stat.isDirectory() : !!stat?.isDirectory,
    };
  } catch {
    return null;
  }
}

function isIgnoredSearchPath(path: string): boolean {
  return normalizePath(path)
    .split('/')
    .some(segment => segment === '.git' || segment === '.svn' || segment === '.hg' || segment === 'node_modules' || segment === '__pycache__' || segment === '.aily' || segment === '.aily_checkpoints' || segment === '.cache');
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
}

function relativizePath(path: string, cwd: string): string {
  const normalizedPath = normalizePath(path);
  const normalizedCwd = normalizePath(cwd).replace(/\/$/, '');
  if (!normalizedCwd) {
    return normalizedPath;
  }

  const lowerPath = normalizedPath.toLocaleLowerCase();
  const lowerCwd = normalizedCwd.toLocaleLowerCase();
  if (lowerPath === lowerCwd) {
    return '';
  }
  if (lowerPath.startsWith(`${lowerCwd}/`)) {
    return normalizedPath.slice(normalizedCwd.length + 1);
  }
  return normalizedPath;
}

function globToRegex(pattern: string): RegExp {
  let p = pattern.replace(/^\.\//, '').replace(/^\//, '');
  let regex = '';
  let index = 0;
  while (index < p.length) {
    const ch = p[index];
    if (ch === '*' && p[index + 1] === '*') {
      regex += '.*';
      index += 2;
      if (p[index] === '/') index++;
    } else if (ch === '*') {
      regex += '[^/]*';
      index++;
    } else if (ch === '?') {
      regex += '[^/]';
      index++;
    } else if (ch === '{') {
      const close = p.indexOf('}', index);
      if (close > index) {
        const inner = p.slice(index + 1, close).split(',')
          .map((segment: string) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|');
        regex += `(${inner})`;
        index = close + 1;
      } else {
        regex += '\\{';
        index++;
      }
    } else if ('.+^$|()[]\\'.includes(ch)) {
      regex += `\\${ch}`;
      index++;
    } else {
      regex += ch;
      index++;
    }
  }
  return new RegExp(`^${regex}$`, 'i');
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

function buildTurnResponseLexSessionSnapshot(
  turnResponses: readonly import('aily-lex/browser').TurnResponseTurn[] | undefined,
  sessionId: string,
): import('aily-lex/browser').SessionSnapshot | null {
  if (!turnResponses?.length) {
    return null;
  }

  const lexTurns: import('aily-lex/browser').ConversationTurn[] = turnResponses.map((turn, index) => {
    const persistedResponse = (turn.response ?? {}) as typeof turn.response & PersistedHostResponseData;
    const slashCommand = turn.responseModel?.slashCommand ?? persistedResponse.slashCommand;
    const followups = turn.responseModel?.followups ?? persistedResponse.followups;
    const summary = cloneTurnResponseRoundSummaryCarrier(turn.responseModel?.summary);
    const summaries = cloneTurnResponseRoundSummaryCarriers(turn.responseModel?.summaries);
    const summaryPreview = normalizeTurnResponseSummaryPreview(turn.responseModel?.summaryPreview);
    const modelName = getTurnResponseResolvedModelName(turn);
    const modelBillingLabel = typeof turn.responseModel?.modelBillingLabel === 'string' && turn.responseModel.modelBillingLabel.trim()
      ? turn.responseModel.modelBillingLabel.trim()
      : undefined;

    return ({
    id: turn.turnId || `turn-${index}`,
    index,
    request: {
      content: turn.request?.content || turn.request?.displayContent || '',
      ...(typeof turn.request?.displayContent === 'string' ? { displayContent: turn.request.displayContent } : {}),
      ...(turn.request?.metadata ? { metadata: turn.request.metadata } : {}),
      ...(turn.request?.attachments ? { attachments: turn.request.attachments } : {}),
    },
    rounds: (turn.rounds ?? []).map((round: any, roundIndex: number) => ({
      id: round?.id || `round-${index}-${roundIndex}`,
      assistantText: round?.assistantText || '',
      toolCalls: (round?.toolCalls ?? []).map((toolCall: any) => ({
        id: toolCall?.id,
        toolName: toolCall?.toolName,
        input: toolCall?.input,
        output: toolCall?.output,
        error: toolCall?.error,
      })),
      timestamp: round?.timestamp,
      ...(normalizeTurnResponseSummaryPreview(round?.summary)
        ? { summary: normalizeTurnResponseSummaryPreview(round?.summary) }
        : {}),
    })),
    response: createConversationTurnResponse({
      participant: turn.response?.participant || 'assistant',
      ...(turn.response?.usedContext ? { usedContext: turn.response.usedContext } : {}),
      ...(turn.response?.contentReferences ? { contentReferences: turn.response.contentReferences } : {}),
      ...(turn.response?.codeCitations ? { codeCitations: turn.response.codeCitations } : {}),
      ...(turn.response?.progressMessages ? { progressMessages: turn.response.progressMessages } : {}),
      parts: turn.response?.parts ?? [],
      resultText: turn.response?.resultText || '',
      createdAt: turn.response?.createdAt ?? turn.createdAt ?? Date.now(),
      updatedAt: turn.response?.updatedAt ?? turn.updatedAt ?? turn.createdAt ?? Date.now(),
    }),
    ...((slashCommand || followups || summary || summaries || summaryPreview || modelName || modelBillingLabel)
      ? {
        responseModel: {
          ...(slashCommand ? { slashCommand } : {}),
          ...(followups ? { followups: followups.map(followup => ({ ...followup })) } : {}),
          ...(summary ? { summary } : {}),
          ...(summaries ? { summaries } : {}),
          ...(summaryPreview ? { summaryPreview } : {}),
          ...(modelName ? { modelName } : {}),
          ...(modelBillingLabel ? { modelBillingLabel } : {}),
        },
      }
      : {}),
    status: toLexConversationTurnStatus(turn.response?.status),
    createdAt: turn.createdAt ?? turn.response?.createdAt,
    });
  });

  const normalizedLexTurns = applyPersistedRoundSummariesOnTurns(lexTurns, turnResponses);
  const latestContinuation = turnResponses[turnResponses.length - 1]?.response?.continuation;

  const interactionContinuation = shouldPersistInteractionContinuation(latestContinuation)
    ? clonePersistableInteractionContinuation(latestContinuation)
    : undefined;

  return {
    sessionId,
    turns: normalizedLexTurns,
    ...(interactionContinuation ? {
      requestContext: {
        directToolReferences: [],
        interactionContinuation,
      },
    } : {}),
    revision: 0,
    createdAt: lexTurns[0]?.createdAt ?? Date.now(),
    updatedAt: turnResponses[turnResponses.length - 1]?.updatedAt ?? Date.now(),
  };
}

interface PersistedRoundSummaryCarrier {
  readonly anchorRoundId: string;
  readonly summary: string;
  readonly anchorTurnId?: string;
  readonly roundIndex?: number;
}

function getLatestStructuredRoundSummaryForTurn(
  turn: import('aily-lex/browser').TurnResponseTurn,
): PersistedRoundSummaryCarrier | undefined {
  const turnSummary = turn.responseModel?.summaries?.at(-1) ?? turn.responseModel?.summary;
  const anchorRoundId = typeof turnSummary?.toolCallRoundId === 'string' && turnSummary.toolCallRoundId.trim()
    ? turnSummary.toolCallRoundId.trim()
    : undefined;
  const summary = normalizeTurnResponseSummaryPreview(turnSummary?.text);

  if (!anchorRoundId || !summary) {
    return undefined;
  }

  return {
    anchorRoundId,
    summary,
  };
}

function collectDirectSummaryRoundIds(
  turns: readonly import('aily-lex/browser').ConversationTurn[],
): Set<string> {
  const directSummaryRoundIds = new Set<string>();

  for (const turn of turns) {
    for (const round of turn.rounds) {
      if (normalizeTurnResponseSummaryPreview(round.summary)) {
        directSummaryRoundIds.add(round.id);
      }
    }
  }

  return directSummaryRoundIds;
}

function findPersistedRoundSummaryTarget(
  turns: readonly import('aily-lex/browser').ConversationTurn[],
  sourceTurnIndex: number,
  carrier: PersistedRoundSummaryCarrier,
): { turnIndex: number; roundIndex: number } | undefined {
  const maxTurnIndex = Math.min(sourceTurnIndex, turns.length - 1);
  if (maxTurnIndex < 0) {
    return undefined;
  }

  for (let turnIndex = maxTurnIndex; turnIndex >= 0; turnIndex -= 1) {
    const roundIndex = turns[turnIndex].rounds.findIndex(round => round.id === carrier.anchorRoundId);
    if (roundIndex >= 0) {
      return { turnIndex, roundIndex };
    }
  }

  if (!carrier.anchorTurnId || carrier.roundIndex === undefined || carrier.roundIndex < 0) {
    return undefined;
  }

  for (let turnIndex = maxTurnIndex; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (turn.id !== carrier.anchorTurnId) {
      continue;
    }

    return carrier.roundIndex < turn.rounds.length
      ? { turnIndex, roundIndex: carrier.roundIndex }
      : undefined;
  }

  return undefined;
}

function applyPersistedRoundSummariesOnTurns(
  turns: readonly import('aily-lex/browser').ConversationTurn[],
  turnResponses: readonly import('aily-lex/browser').TurnResponseTurn[],
): import('aily-lex/browser').ConversationTurn[] {
  if (!turns.length || !turnResponses.length) {
    return [...turns];
  }

  const turnsWithNormalizedSummaries = [...turns];
  const directSummaryRoundIds = collectDirectSummaryRoundIds(turns);

  for (let sourceTurnIndex = 0; sourceTurnIndex < turnResponses.length; sourceTurnIndex += 1) {
    const carrier = getLatestStructuredRoundSummaryForTurn(turnResponses[sourceTurnIndex]);
    if (!carrier) {
      continue;
    }

    const target = findPersistedRoundSummaryTarget(turnsWithNormalizedSummaries, sourceTurnIndex, carrier);
    if (!target) {
      continue;
    }

    const targetTurn = turnsWithNormalizedSummaries[target.turnIndex];
    const targetRound = targetTurn.rounds[target.roundIndex];
    if (directSummaryRoundIds.has(targetRound.id)) {
      continue;
    }

    const updatedRounds = [...targetTurn.rounds];
    updatedRounds[target.roundIndex] = {
      ...targetRound,
      summary: carrier.summary,
    };

    turnsWithNormalizedSummaries[target.turnIndex] = {
      ...targetTurn,
      rounds: updatedRounds,
    };
  }

  return turnsWithNormalizedSummaries;
}

function clonePersistableInteractionContinuation(
  continuation: NonNullable<import('aily-lex/browser').TurnResponseTurn['response']['continuation']>,
) {
  const budgets = continuation.budgets;
  const diagnostics = continuation.diagnostics;

  const pendingState = continuation.pendingState
    ? { ...continuation.pendingState }
    : ({ kind: 'none' } as Record<string, unknown>);

  const clonedDiagnostics = clonePersistableInteractionDiagnostics(diagnostics as unknown as Record<string, unknown>);

  return {
    interactionId: continuation.interactionId,
    stepIndex: continuation.stepIndex,
    lease: continuation.lease,
    ...(continuation.status !== undefined ? { status: continuation.status } : {}),
    ...(continuation.stopReason !== undefined ? { stopReason: continuation.stopReason } : {}),
    ...(continuation.hardStopReason !== undefined ? { hardStopReason: continuation.hardStopReason } : {}),
    ...(budgets && typeof budgets === 'object' ? { budgets: { ...budgets } } : {}),
    ...(clonedDiagnostics
      ? {
        diagnostics: clonedDiagnostics as NonNullable<
          NonNullable<import('aily-lex/browser').TurnResponseTurn['response']['continuation']>['diagnostics']
        >,
      }
      : {}),
    pendingState,
  };
}

function clonePersistableInteractionDiagnostics(
  diagnostics: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!isRecord(diagnostics)) {
    return undefined;
  }

  const identity = isRecord(diagnostics['identity']) ? { ...diagnostics['identity'] } : undefined;
  const trace = isRecord(diagnostics['trace']) ? { ...diagnostics['trace'] } : undefined;
  const usage = isRecord(diagnostics['usage']) ? { ...diagnostics['usage'] } : undefined;
  const runtime = isRecord(diagnostics['runtime']) ? { ...diagnostics['runtime'] } : undefined;
  const budget = isRecord(diagnostics['budget']) ? { ...diagnostics['budget'] } : undefined;
  const outcome = isRecord(diagnostics['outcome']) ? { ...diagnostics['outcome'] } : undefined;
  const behavior = isRecord(diagnostics['behavior']) ? { ...diagnostics['behavior'] } : undefined;

  return {
    ...(identity ? { identity } : {}),
    ...(trace ? { trace } : {}),
    ...(usage ? { usage } : {}),
    ...(runtime ? { runtime } : {}),
    ...(budget ? { budget } : {}),
    ...(outcome ? { outcome } : {}),
    ...(behavior ? { behavior } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function shouldPersistInteractionContinuation(
  continuation: import('aily-lex/browser').TurnResponseTurn['response']['continuation'] | undefined,
): continuation is NonNullable<import('aily-lex/browser').TurnResponseTurn['response']['continuation']> {
  if (!continuation) {
    return false;
  }

  return typeof continuation.interactionId === 'string'
    && continuation.interactionId.trim().length > 0
    && Number.isFinite(continuation.stepIndex)
    && continuation.stepIndex >= 0
    && typeof continuation.lease === 'string'
    && continuation.lease.trim().length > 0;
}

function toLexConversationTurnStatus(
  status: import('aily-lex/browser').TurnResponseStatus | undefined,
): import('aily-lex/browser').TurnStatus {
  switch (status) {
    case 'streaming':
      return 'active';
    case 'completed':
    case 'cancelled':
    case 'error':
      return status;
    default:
      return 'completed';
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

function createExternalTerminal(host: any, prjPath: () => string): IExternalHostAPI['terminal'] {
  const hasRawTerminal = !!(host.terminal?.run && host.terminal?.onData);
  const hasCmdService = !!(host.cmd?.spawn && host.cmd?.kill && host.cmd?.sendInput);

  if (!hasRawTerminal && !hasCmdService) {
    return undefined;
  }

  const sessions = new Map<string, ExternalTerminalSession>();

  const createSnapshot = (session: ExternalTerminalSession) => ({
    id: session.id,
    command: session.command,
    cwd: session.cwd,
    stdout: session.stdout,
    stderr: session.stderr,
    running: session.running,
    exitCode: session.exitCode,
    pid: session.pid,
  });

  const settleReady = (session: ExternalTerminalSession) => {
    if (session.readyResolved) {
      return;
    }
    session.readyResolved = true;
    session.resolveReady();
  };

  const finalize = (session: ExternalTerminalSession, exitCode: number) => {
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = undefined;
    }
    session.running = false;
    session.exitCode = exitCode;
    settleReady(session);
    if (!session.finishedResolved) {
      session.finishedResolved = true;
      session.resolveFinished();
    }
    session.removeListener?.();
    session.removeListener = undefined;
    session.subscription?.unsubscribe?.();
    session.subscription = undefined;
  };

  const attachCmdServiceSession = (
    session: ExternalTerminalSession,
    command: string,
    cwd: string,
    env?: Record<string, string>,
  ) => {
    const parts = parseShellCommand(command);
    const executable = parts.shift() ?? command;
    const spawnOptions = env ? { cwd, streamId: session.id, env } : { cwd, streamId: session.id };

    session.subscription = host.cmd.spawn(executable, parts, spawnOptions, true).subscribe({
      next: (data: any) => {
        switch (data?.type) {
          case 'stdout':
            session.stdout += data.data ?? '';
            settleReady(session);
            break;
          case 'stderr':
            session.stderr += data.data ?? '';
            settleReady(session);
            break;
          case 'close': {
            if (!session.stdout && typeof data.stdout === 'string') {
              session.stdout = data.stdout;
            }
            if (!session.stderr && typeof data.stderr === 'string') {
              session.stderr = data.stderr;
            }
            finalize(session, data.code ?? 0);
            break;
          }
          case 'error':
            session.stderr += data.error ?? '';
            finalize(session, 1);
            break;
        }
      },
      error: (err: unknown) => {
        session.stderr += err instanceof Error ? err.message : String(err);
        finalize(session, 1);
      },
    });
  };

  const attachRawTerminalSession = (session: ExternalTerminalSession) => {
    session.removeListener = host.terminal.onData(session.id, (data: any) => {
      switch (data.type) {
        case 'stdout':
          session.stdout += data.data ?? '';
          settleReady(session);
          break;
        case 'stderr':
          session.stderr += data.data ?? '';
          settleReady(session);
          break;
        case 'close':
          finalize(session, data.code ?? 0);
          break;
        case 'error':
          session.stderr += data.error ?? '';
          finalize(session, 1);
          break;
      }
    });
  };

  const start = async (command: string, opts?: { cwd?: string; timeout?: number; env?: Record<string, string> }) => {
    const id = `terminal_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const cwd = opts?.cwd ?? prjPath();
    let resolveReady!: () => void;
    let resolveFinished!: () => void;
    const session: ExternalTerminalSession = {
      id,
      command,
      cwd,
      stdout: '',
      stderr: '',
      running: true,
      readyResolved: false,
      finishedResolved: false,
      ready: new Promise<void>((resolve) => { resolveReady = resolve; }),
      finished: new Promise<void>((resolve) => { resolveFinished = resolve; }),
      resolveReady,
      resolveFinished,
    };

    if (hasCmdService) {
      attachCmdServiceSession(session, command, cwd, opts?.env);
    } else if (hasRawTerminal) {
      attachRawTerminalSession(session);
    }

    const timeout = opts?.timeout ?? 30_000;
    session.timer = setTimeout(async () => {
      if (!session.running) {
        return;
      }
      session.stderr += `${session.stderr ? '\n' : ''}[Process killed: timeout exceeded]`;
      if (typeof host.terminal.kill === 'function') {
        await host.terminal.kill(id);
      }
      finalize(session, 124);
    }, timeout);

    sessions.set(id, session);

    try {
      if (hasRawTerminal) {
        const result = await host.terminal.run({ command, cwd, streamId: id, env: opts?.env });
        session.pid = result?.pid;
        if (!result?.success) {
          session.stderr += result?.error ?? 'Terminal start failed';
          finalize(session, 1);
        }
      } else if (!hasCmdService) {
        session.stderr += 'Terminal start failed';
        finalize(session, 1);
      }
    } catch (err) {
      session.stderr += err instanceof Error ? err.message : String(err);
      finalize(session, 1);
    }

    await Promise.race([session.ready, delay(150)]);
    return createSnapshot(session);
  };

  return {
    exec: async (command: string, opts?: { cwd?: string; timeout?: number; env?: Record<string, string> }) => {
      const snapshot = await start(command, opts);
      const session = sessions.get(snapshot.id);
      if (session?.running) {
        await session.finished;
      }
      const finalSnapshot = sessions.get(snapshot.id) ? createSnapshot(sessions.get(snapshot.id)!) : snapshot;
      sessions.delete(snapshot.id);
      return {
        stdout: finalSnapshot.stdout,
        stderr: finalSnapshot.stderr,
        exitCode: finalSnapshot.exitCode ?? 1,
      };
    },
    start,
    getOutput: async (id: string) => {
      const session = sessions.get(id);
      return session ? createSnapshot(session) : null;
    },
    sendInput: async (id: string, input: string) => {
      const sendInput = host.cmd?.sendInput ?? host.terminal?.input;
      if (!sessions.has(id) || typeof sendInput !== 'function') {
        return false;
      }
      const result = await sendInput.call(host.cmd ?? host.terminal, id, input);
      return result?.success !== false;
    },
    kill: async (id: string) => {
      const session = sessions.get(id);
      const kill = host.cmd?.kill ?? host.terminal?.kill;
      if (!session || typeof kill !== 'function') {
        return false;
      }
      const result = await kill.call(host.cmd ?? host.terminal, id);
      if (result?.success !== false && session.running) {
        finalize(session, session.exitCode ?? 130);
      }
      return result?.success !== false;
    },
  };
}

interface ExternalTerminalSession {
  id: string;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  running: boolean;
  exitCode?: number;
  pid?: number;
  readyResolved: boolean;
  finishedResolved: boolean;
  ready: Promise<void>;
  finished: Promise<void>;
  resolveReady(): void;
  resolveFinished(): void;
  removeListener?: () => void;
  subscription?: { unsubscribe(): void };
  timer?: ReturnType<typeof setTimeout>;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseShellCommand(command: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];

    if ((char === '"' || char === '\'') && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
      current += char;
      continue;
    }

    if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
      current += char;
      continue;
    }

    if (char === ' ' && !inQuotes) {
      if (current.length > 0) {
        result.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}

function normalizeHostBytes(content: unknown): Uint8Array {
  if (content instanceof Uint8Array) {
    return content;
  }
  if (Array.isArray(content)) {
    return new Uint8Array(content);
  }
  if (content && typeof content === 'object' && 'buffer' in (content as any)) {
    const view = content as { buffer: ArrayBufferLike; byteOffset?: number; byteLength?: number };
    const byteLength = view.byteLength ?? ((view.buffer as ArrayBufferLike).byteLength - (view.byteOffset ?? 0));
    return new Uint8Array(view.buffer, view.byteOffset ?? 0, byteLength);
  }
  return new Uint8Array();
}