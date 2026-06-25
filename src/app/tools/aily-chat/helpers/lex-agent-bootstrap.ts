/**
 * Blockly compatibility bootstrap for aily-lex.
 *
 * This file is intentionally a concrete host binding for aily-blockly. It wires
 * blockly host services and domain contributions into lex's generic runtime
 * contract, but it is not the canonical integration path for non-blockly hosts.
 */

import type { IChatCoordination, IChatServiceAccess, IProjectContext, ISessionAccess } from '../core/chat-context';
import { AilyHost } from '../core/host';
import { isAilyCategoryDebugEnabled } from '../core/chat-debug-flags';
import {
  normalizeChatSessionPermissionMode,
  type ChatSessionPermissionMode,
} from '../core/chat-mode';
import type { ProviderContextManagementSupport } from '../services/aily-chat-config.service';
import { MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE, normalizeAgentIdentifier } from '../core/agent-identifiers';
import { BLOCKLY_MAIN_AGENT_REQUIRED_CONTEXT, BLOCKLY_PROMPT_PROFILE } from '../core/blockly-prompt-profile';
import { CODER_MAIN_AGENT_REQUIRED_CONTEXT, CODER_PROMPT_PROFILE } from '../core/coder-prompt-profile';
import { UNBOUND_ROUTER_PROMPT_PROFILE, UNBOUND_ROUTER_REQUIRED_CONTEXT } from '../core/unbound-router-prompt-profile';
import {
  normalizeChatAgentRuntimeMode,
  type ChatAgentRuntimeMode,
  type ChatAgentRuntimeModeSource,
} from '../core/chat-agent-runtime-mode';
import type { ChatRuntimeOwnerScheduler } from '../core/chat-runtime-owner-scheduler';
import { normalizeGovernanceToolName, toRuntimeGovernanceToolName } from '../core/tool-name-normalizer';
import { getBlocklyContextSnapshotService } from '../core/blockly-context-snapshot-service';
import { BLOCKLY_LEX_DEFERRED_GROUPS, createBlocklyToolProvider } from '../core/blockly-contributed-tools';
import { createBlocklyAgentProvider } from '../core/blockly-agent-provider';
import { createBlocklyAgentFileProvider } from '../core/blockly-agent-file-provider';
import { createBlocklyInstructionFileProvider } from '../core/blockly-instruction-file-provider';
import { createBlocklyHookCustomizationProvider } from '../core/blockly-hook-customization-provider';
import { createBlocklyPluginCustomizationProvider } from '../core/blockly-plugin-customization-provider';
import { createBlocklySkillCustomizationProvider } from '../core/blockly-skill-customization-provider';
import {
  createBlocklySessionCustomizationContentProvider,
  createBlocklySessionCustomizationProviderBinding,
  getBlocklySessionCustomizationContentProviderSchemes,
} from '../core/blockly-session-customization-item-provider';
import { createBlocklySlashCommandProvider } from '../core/blockly-slash-command-provider';
import { createBlocklySubagentExtension } from '../core/blockly-subagent-extension';
import { createElectronAilyServicesTransport } from '../core/aily-services-host-transport';
import { BlocklySkillProvider } from '../core/blockly-skill-provider';
import { SkillRegistry as BlocklySkillRegistry } from '../core/skill-registry';
import { askUserMany, askUserSingle, type AskUserPresentationContext } from '../core/ask-user';
import { collectDiagnostics } from '../core/diagnostics';
import { resolveBlocklyMemoryStorageLayout } from './chat-memory-host';
import { getProjectInfoTool } from '../tools/getProjectInfoTool';
import { searchBoardsLibrariesTool } from '../tools/searchBoardsLibrariesTool';
import {
  syncAbsFileHandler,
  type SyncAbsInvocationContext,
} from '../tools/syncAbsFileTool';
import { analyzeLibraryBlocksTool } from '../tools/editBlockTool';
import { TOOL_SETTINGS_CATALOG } from '../tools/tool-settings-catalog';
import type { HostSessionRecord, PersistedHostResponseData } from '../services/chat-history.service';
import { AilyAgentSessionProviderOptionsSourceService } from '../services/chat-session-provider-options-source.service';
import { EditingTextDiffService } from '../services/editing-text-diff.service';
import type { EditingTimelineFileWriteEvent } from '../services/editing-timeline-recording-bridge';
import type { ChatSessionLexPostTurnResources } from '../services/chat-session-lex-post-turn-resource-factory.service';
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
  type IHostToolProvider,
  type IToolContribution,
  type IMetricsService,
  type ToolResultContent,
  type AgentRequiredContext,
} from 'aily-lex/browser';
import {
  cloneTurnResponseRoundSummaryCarrier,
  cloneTurnResponseRoundSummaryCarriers,
  getTurnResponseResolvedModelName,
  normalizeTurnResponseSummaryPreview,
} from './turn-response-response-model';
import {
  cloneSessionRequestContextSnapshot,
  readTurnRequestPromptContextSnapshot,
} from './turn-request-prompt-context';
import {
  buildHostAuthoritativeLexRestorePlan,
  type LexSessionStoredSnapshotState,
  type ResolvedLexSessionRestorePlan,
} from './host-session-restore-resolver';

function isLexBootstrapTraceEnabled(): boolean {
  return isAilyCategoryDebugEnabled('aily.chat.traceLexBootstrap', [
    '__AILY_CHAT_TRACE_LEX_BOOTSTRAP__',
    'AILY_CHAT_TRACE_LEX_BOOTSTRAP',
  ]);
}

export type AilyLexModule = typeof import('aily-lex/browser');
type BlocklyLexAgentInstance = InstanceType<AilyLexModule['AilyLexAgent']>;

export interface LexRuntimeModelConfig {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  presetId?: string;
  contextWindowTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  providerContextManagementSupport?: ProviderContextManagementSupport;
}

export interface LexRuntimeApiConfig {
  useCustomApiKey: boolean;
  apiKey: string;
  baseUrl: string;
  maxRequests?: number;
}

const DEFAULT_INTERACTION_HARD_ROUND_CAP = 200;
const FAST_SUMMARIZER_PRESET_ID = 'auto-fast';
const PROJECT_CHAT_DIR = '.chat_history';
const GLOBAL_CHAT_DATA_DIR = 'chat_history';
const PROCESS_RECORDS_DIR = 'process';

type BlocklyExternalTerminal = NonNullable<IExternalHostAPI['terminal']>;

const blocklyCommandSessionControllers = new Set<BlocklyExternalTerminal>();
const blocklyCommandSessionOwners = new Map<string, BlocklyExternalTerminal>();
const blocklyCommandSessions = new Map<string, ExternalTerminalSession>();
const blocklyCommandSessionIdsBySession = new Map<string, Set<string>>();
const blocklyCommandSessionListeners = new Set<(sessionId: string, processId: string) => void>();

export type BlocklyCommandSessionSnapshot = Awaited<ReturnType<NonNullable<BlocklyExternalTerminal['getProcessStatus']>>>;
export type BlocklyCommandSessionSummary = ReturnType<typeof createBlocklyCommandSessionSummary>;

function registerBlocklyCommandSessionController(terminal: BlocklyExternalTerminal | undefined): void {
  if (!terminal) {
    return;
  }
  blocklyCommandSessionControllers.add(terminal);
}

function registerBlocklyCommandSessionOwner(processId: string, terminal: BlocklyExternalTerminal): void {
  blocklyCommandSessionOwners.set(processId, terminal);
  registerBlocklyCommandSessionController(terminal);
}

async function runWithBlocklyCommandSessionController<T>(
  processId: string,
  action: (terminal: BlocklyExternalTerminal) => Promise<T | null | undefined>,
): Promise<T | null> {
  const preferred = blocklyCommandSessionOwners.get(processId);
  if (preferred) {
    const result = await action(preferred);
    if (result != null) {
      return result;
    }
    blocklyCommandSessionOwners.delete(processId);
  }

  for (const terminal of blocklyCommandSessionControllers) {
    if (terminal === preferred) {
      continue;
    }
    const result = await action(terminal);
    if (result != null) {
      blocklyCommandSessionOwners.set(processId, terminal);
      return result;
    }
  }

  return null;
}

export async function getBlocklyCommandSessionStatus(processId: string): Promise<BlocklyCommandSessionSnapshot | null> {
  return runWithBlocklyCommandSessionController(processId, async terminal => {
    return typeof terminal.getProcessStatus === 'function'
      ? terminal.getProcessStatus(processId)
      : null;
  });
}

export async function stopBlocklyCommandSession(
  processId: string,
  options?: { yieldTimeMs?: number },
): Promise<BlocklyCommandSessionSnapshot | null> {
  return runWithBlocklyCommandSessionController(processId, async terminal => {
    return typeof terminal.stopProcess === 'function'
      ? terminal.stopProcess(processId, options)
      : null;
  });
}

export async function resizeBlocklyCommandSession(
  processId: string,
  size: { cols: number; rows: number },
): Promise<BlocklyCommandSessionSnapshot | null> {
  return runWithBlocklyCommandSessionController(processId, async terminal => {
    return typeof terminal.resizeProcess === 'function'
      ? terminal.resizeProcess(processId, size)
      : null;
  });
}

export function listBlocklyCommandSessionSnapshots(sessionId: string): BlocklyCommandSessionSummary[] {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalizedSessionId) {
    return [];
  }

  const processIds = blocklyCommandSessionIdsBySession.get(normalizedSessionId);
  if (!processIds || processIds.size === 0) {
    return [];
  }

  return [...processIds]
    .map(processId => blocklyCommandSessions.get(processId))
    .filter((session): session is ExternalTerminalSession => !!session)
    .map(session => createBlocklyCommandSessionSummary(session))
    .sort((left, right) => right.startedAt - left.startedAt);
}

export function subscribeBlocklyCommandSessionUpdates(
  listener: (sessionId: string, processId: string) => void,
): { dispose(): void } {
  blocklyCommandSessionListeners.add(listener);
  return {
    dispose: () => {
      blocklyCommandSessionListeners.delete(listener);
    },
  };
}

export function setBlocklyCommandSessionBackground(
  sessionId: string,
  processId: string,
  background: boolean,
): void {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const normalizedProcessId = typeof processId === 'string' ? processId.trim() : '';
  if (!normalizedSessionId || !normalizedProcessId) {
    return;
  }

  const session = blocklyCommandSessions.get(normalizedProcessId);
  if (!session || session.sessionId !== normalizedSessionId || session.background === background) {
    return;
  }

  session.background = background;
  persistBlocklyCommandSessionRecord(session);
  notifyBlocklyCommandSessionUpdate(normalizedSessionId, normalizedProcessId);
}

interface ResolvePersistedLexSessionOptions {
  lex: AilyLexModule;
  sessionId: string;
  cwd?: string;
  turnResponses?: readonly import('aily-lex/browser').TurnResponseTurn[];
  hostRecord?: HostSessionRecord | null;
}

interface BootstrapLexAgentOptions {
  ctx: BootstrapLexAgentContext;
  lex: AilyLexModule;
  sessionId?: string;
  askHandler?: (askContext: any) => Promise<boolean>;
  metrics?: IMetricsService;
}

export type BootstrapLexAgentContext = Pick<IProjectContext, 'prjPath' | 'prjRootPath' | 'currentModel' | 'currentAgentRuntimeMode' | 'currentAgentRuntimeModeSource'>
  & Pick<ISessionAccess, 'sessionId'>
  & Pick<IChatServiceAccess, 'ailyChatConfigService' | 'mcpService' | 'editCheckpointService'>
  & Pick<IChatCoordination, 'handleToolApproval' | 'syncSessionCustomizationContentProvider' | 'syncSessionCustomizationProvider' | 'syncSessionCustomizationProviders' | 'syncSessionProviderOptionsSource' | 'syncSessionProviderOptionsSources'>
  & {
    readonly currentSessionPath?: string | null;
    readonly currentSessionPermissionMode?: ChatSessionPermissionMode;
    readonly currentSessionApprovalsReviewer?: 'user' | 'auto_review';
    readonly currentSessionApprovalPolicy?: 'on_request' | 'never';
    readonly ownerScheduler?: Pick<ChatRuntimeOwnerScheduler, 'runOutsideOwner'>;
    getOrCreateLexPostTurnResources?(
      sessionId: string | null | undefined,
      cwd: string | null | undefined,
    ): ChatSessionLexPostTurnResources | undefined;
    scheduleLexRequestCompleted?(input: {
      sessionId: string;
      turnId: string;
      reason: string;
      runWorkspaceFinalize: () => Promise<void>;
      runSessionEndHooks: () => Promise<void>;
    }): void;
    selectAgentRuntimeMode?(
      mode: Exclude<ChatAgentRuntimeMode, 'unbound'>,
      source: ChatAgentRuntimeModeSource,
      reason?: string,
    ): void | Promise<void>;
  };

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

function createSubagentRequiredContext(requiredContext: AgentRequiredContext) {
  return {
    scopes: [...requiredContext.scopes],
    strict: requiredContext.strict,
    hydrateBeforeFirstModelCall: requiredContext.hydrateBeforeFirstModelCall,
  } as const;
}

export function resolveRuntimePromptProfile(runtimeMode: ChatAgentRuntimeMode) {
  switch (runtimeMode) {
    case 'coder':
      return CODER_PROMPT_PROFILE;
    case 'blockly':
      return BLOCKLY_PROMPT_PROFILE;
    case 'unbound':
    default:
      return UNBOUND_ROUTER_PROMPT_PROFILE;
  }
}

export function resolveRuntimeRequiredContext(runtimeMode: ChatAgentRuntimeMode): AgentRequiredContext {
  switch (runtimeMode) {
    case 'coder':
      return CODER_MAIN_AGENT_REQUIRED_CONTEXT;
    case 'blockly':
      return BLOCKLY_MAIN_AGENT_REQUIRED_CONTEXT;
    case 'unbound':
    default:
      return UNBOUND_ROUTER_REQUIRED_CONTEXT;
  }
}

function resolveDeferredGroupsForRuntime(runtimeMode: ChatAgentRuntimeMode) {
  if (runtimeMode !== 'blockly') {
    return BLOCKLY_LEX_DEFERRED_GROUPS.filter(group =>
      group.id === 'blockly-library-discovery'
      || group.id === 'blockly-project-management',
    );
  }

  return BLOCKLY_LEX_DEFERRED_GROUPS;
}

// Host/runtime boundary:
// - this set only selects lex-owned core tools for the main agent
// - blockly-specific capabilities must enter through toolProvider / agentProvider / skillProvider
// - if a tool is portable across hosts, it should move into aily-lex core instead of growing this host list
const LEX_CORE_SAFE_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'multi_edit_file',
  'delete_file', 'list_dir', 'create_directory',
  'grep_search', 'glob_search',
  'command_exec', 'command_write_stdin', 'command_status', 'command_resize', 'command_stop',
  'command_read', 'command_tail', 'command_search',
  'run_terminal', 'get_terminal_output', 'send_to_terminal', 'kill_terminal', 'agent',
  'get_changed_files',
  'fetch_webpage', 'clone_repository',
  'todo_manage',
  'memory', 'resolve_memory_file_uri',
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
  readonly runtimeName?: string;
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
  const config = typeof configService.getAgentToolsConfig === 'function'
    ? configService.getAgentToolsConfig(agentName)
    : {
      enabledTools: agentName === MAIN_AGENT_TYPE && Array.isArray(configService.enabledTools)
        ? configService.enabledTools
        : [],
      disabledTools: agentName === MAIN_AGENT_TYPE && Array.isArray(configService.disabledTools)
        ? configService.disabledTools
        : [],
    };
  const normalizedToolName = normalizeGovernanceToolName(toolName);
  if (config?.disabledTools?.includes(normalizedToolName)) {
    return false;
  }

  return true;
}

function isCoreToolEnabledByHostConfig(
  configService: AgentToolConfigAccessor,
  toolName: string,
): boolean {
  const memoryToolEnabled = configService.memoryToolEnabled !== false;
  const repositoryMemoryEnabled = configService.repositoryMemoryEnabled === true;
  if (toolName === 'memory') {
    return memoryToolEnabled || repositoryMemoryEnabled;
  }
  if (toolName === 'resolve_memory_file_uri') {
    return memoryToolEnabled;
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
    [...LEX_CORE_SAFE_TOOLS].filter(toolName => {
      return isCoreToolEnabledByHostConfig(configService, toolName)
        && isToolEnabledForAgent(configService, MAIN_AGENT_TYPE, toolName);
    }),
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
      runtimeName: existing.runtimeName ?? entry.runtimeName,
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
  const normalizedName = normalizeGovernanceToolName(name);
  return TOOL_SETTINGS_CATALOG.find(tool => normalizeGovernanceToolName(tool.name) === normalizedName)?.description || name;
}

function getRuntimeCoreToolCatalogEntries(configService: AgentToolConfigAccessor): RuntimeToolCatalogEntry[] {
  return [...LEX_CORE_SAFE_TOOLS]
    .filter(toolName => isCoreToolEnabledByHostConfig(configService, toolName))
    .sort((left, right) => left.localeCompare(right))
    .map(toolName => ({
    name: normalizeGovernanceToolName(toolName),
    runtimeName: toolName,
    description: getCatalogDescription(toolName),
    agents: [MAIN_AGENT_TYPE],
    source: 'core' as const,
  }));
}

function getRuntimeContributedToolCatalogEntries(cwd = ''): RuntimeToolCatalogEntry[] {
  const { toolProvider } = createBlocklyStandardHostBinding(cwd);
  return toolProvider.contributeTools().map(contribution => ({
    name: normalizeGovernanceToolName(contribution.name),
    runtimeName: contribution.name,
    description: contribution.description || getCatalogDescription(contribution.name),
    agents: getContributionAgents(contribution),
    source: 'contributed' as const,
  }));
}

function getRuntimeMcpToolCatalogEntries(tools: readonly any[] | undefined): RuntimeToolCatalogEntry[] {
  return (tools || []).map(tool => {
    const normalized = normalizeMcpTool(tool);
    return {
      name: normalizeGovernanceToolName(normalized.name),
      runtimeName: normalized.name,
      description: normalized.description || normalized.name,
      agents: [MAIN_AGENT_TYPE],
      source: 'mcp' as const,
    };
  });
}

export function getRuntimeToolSettingsCatalog(
  ctx: RequestToolSelectionContext,
  cwd = '',
): RuntimeToolCatalogEntry[] {
  const configService = resolveAgentToolConfigAccessor(ctx);
  return mergeRuntimeToolCatalogEntries([
    ...getRuntimeCoreToolCatalogEntries(configService),
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
    const runtimeToolName = entry.runtimeName || toRuntimeGovernanceToolName(entry.name) || entry.name;
    userSelectedTools[runtimeToolName] = isToolEnabledForAgent(configService, normalizedAgentId, entry.name);
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
): readonly string[] {
  const desired = new Set(activeSkillNames ?? []);
  const missingSkills: string[] = [];

  for (const name of agent.getActiveSkillNames?.() ?? []) {
    if (desired.has(name)) {
      continue;
    }
    BlocklySkillRegistry.deactivateSkill(name);
    agent.unregisterSkill?.(name);
  }

  for (const name of desired) {
    if (!BlocklySkillRegistry.activateSkill(name)) {
      missingSkills.push(name);
      continue;
    }
    if (!registerBlocklySkillOnLexAgent(agent, name)) {
      BlocklySkillRegistry.deactivateSkill(name);
      missingSkills.push(name);
    }
  }

  if (missingSkills.length > 0) {
    console.warn(`[LexBootstrap] restore degraded: missing persisted skills: ${missingSkills.join(', ')}`);
  }

  return missingSkills;
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

interface BlocklyExternalHostApiOptions {
  readonly createSyncAbsInvocationContext?: () => SyncAbsInvocationContext | undefined;
  readonly sessionId?: string;
}

const BLOCKLY_WORKSPACE_OVERVIEW_CODE_PREVIEW_LIMIT = 4096;

function createBoundedGeneratedCodeOverview(host: ReturnType<typeof AilyHost.get>): {
  generatedCode?: string;
  generatedCodePath?: string;
  generatedCodeLength: number;
  generatedCodeTruncated: boolean;
} {
  const generatedCode = host.editor?.getGeneratedCode?.() || '';
  const generatedCodePath = host.project?.currentProjectPath && host.path
    ? host.path.join(host.project.currentProjectPath, '.temp', 'sketch', 'sketch.ino')
    : undefined;
  const generatedCodeTruncated = generatedCode.length > BLOCKLY_WORKSPACE_OVERVIEW_CODE_PREVIEW_LIMIT;
  return {
    generatedCode: generatedCodeTruncated
      ? generatedCode.slice(0, BLOCKLY_WORKSPACE_OVERVIEW_CODE_PREVIEW_LIMIT)
      : generatedCode,
    generatedCodePath,
    generatedCodeLength: generatedCode.length,
    generatedCodeTruncated,
  };
}

export function buildExternalHostAPI(
  options: BlocklyExternalHostApiOptions = {},
): IExternalHostAPI {
  const host = AilyHost.get();
  const contextSnapshotService = getBlocklyContextSnapshotService();
  const createSyncAbsInvocationContext = options.createSyncAbsInvocationContext;
  (window as { path?: typeof host.path }).path = host.path;
  const prjPath = () => host.project?.currentProjectPath || host.project?.projectRootPath || '';
  const hasBuilder = typeof host.builder?.build === 'function';
  const hasBoardSearch = !!(
    host.config?.getHardwareCategories
    || host.config?.getBoardsList
    || host.config?.boardIndex
    || host.config?.boardList
  );
  const hasBlocklyWorkspace = !!(host.absSync || host.editor || prjPath());
  const hasLibraryAnalysis = !!(host.project && host.fs && prjPath());
  const terminal = createExternalTerminal(host, prjPath, options.sessionId);

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
    path: host.path,
    fsp: (window as any)?.electronAPI?.fsp,
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
    blockly: hasBlocklyWorkspace || hasLibraryAnalysis ? {
      exportAbs: async () => {
        const result = await syncAbsFileHandler(
          { operation: 'export' },
          host.project as any,
          host.electron as any,
          host.absSync as any,
          createSyncAbsInvocationContext?.(),
        );
        if (result.is_error) {
          throw new Error(result.content);
        }
        return result.metadata?.absPreview ?? result.content;
      },
      importAbs: async (content: string) => {
        const result = await syncAbsFileHandler(
          {
            operation: 'import',
            pendingAbsContent: typeof content === 'string' ? content : undefined,
          },
          host.project as any,
          host.electron as any,
          host.absSync as any,
          createSyncAbsInvocationContext?.(),
        );
        return {
          success: !result.is_error,
          ...(result.is_error ? { errors: [result.content] } : {}),
        };
      },
      getAbsStatus: async () => {
        const result = await syncAbsFileHandler(
          { operation: 'status' },
          host.project as any,
          host.electron as any,
          host.absSync as any,
          createSyncAbsInvocationContext?.(),
        );
        return {
          inSync: !result.is_error,
          ...(host.project?.currentProjectPath
            ? { absPath: host.path.join(host.project.currentProjectPath, 'project.abs') }
            : {}),
        };
      },
      getWorkspaceOverview: async () => {
        const generatedCodeOverview = createBoundedGeneratedCodeOverview(host);
        return {
          structure: generatedCodeOverview.generatedCodeLength > 0
            ? 'generated-code-available'
            : 'workspace-structure-unavailable',
          ...generatedCodeOverview,
          blockCount: Array.isArray(host.editor?.getBlockDefinitions?.()) ? host.editor.getBlockDefinitions().length : 0,
          complexity: generatedCodeOverview.generatedCode?.trim() ? 'unknown' : 'empty',
        };
      },
      analyzeBlocks: async (libraryId: string) => {
        const result = await analyzeLibraryBlocksTool(
          host.project as any,
          {
            libraryNames: [libraryId],
            mode: 'analysis',
          },
        );
        if (result.is_error) {
          throw new Error(result.content);
        }
        return result.content;
      },
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

export function createBlocklyStandardHostBinding(
  cwd = '',
  options: {
    readonly runtimeMode?: ChatAgentRuntimeMode;
    readonly sessionId?: string;
    readonly onRuntimeModeSelected?: (
      mode: Exclude<ChatAgentRuntimeMode, 'unbound'>,
      source: ChatAgentRuntimeModeSource,
      reason?: string,
    ) => void | Promise<void>;
    readonly createSyncAbsInvocationContext?: () => SyncAbsInvocationContext | undefined;
  } = {},
): BlocklyStandardHostBinding {
  const hostAPI = buildExternalHostAPI({
    createSyncAbsInvocationContext: options.createSyncAbsInvocationContext,
    sessionId: options.sessionId,
  });
  const toolProvider = createBlocklyToolProvider(hostAPI, {
    runtimeMode: normalizeChatAgentRuntimeMode(options.runtimeMode, 'blockly'),
    onRuntimeModeSelected: options.onRuntimeModeSelected,
  });
  // Debug log kept for future skill/tool registration verification.
  // console.info('[LexBootstrap][ToolDebug] contributed tool definitions', toolProvider.contributeTools().map(tool => ({
  //   name: tool.name,
  //   runtimeModes: (tool as any).runtimeModes ?? null,
  //   requiredCapabilities: (tool as any).requiredCapabilities ?? null,
  //   agentScope: (tool as any).agentScope ?? null,
  //   deferred: (tool as any).deferred ?? null,
  // })));
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

  const webFetchBridgeExtension = createBlocklyWebFetchBridgeExtension();
  if (webFetchBridgeExtension) {
    adapter.registerExtension('webFetchBridge', webFetchBridgeExtension);
  }

  const webSearchBridgeExtension = createBlocklyWebSearchBridgeExtension();
  if (webSearchBridgeExtension) {
    adapter.registerExtension('webSearchBridge', webSearchBridgeExtension);
  }
}

function createBlocklyWebFetchBridgeExtension(): {
  fetchPage(options: {
    url: string;
    signal?: AbortSignal;
  }): Promise<{ text: string; status: number; contentType?: string }>;
} | null {
  const webviewBridge = (window as any)?.electronAPI?.webviewBridge;
  if (typeof webviewBridge?.fetchPage !== 'function') {
    return null;
  }

  return {
    fetchPage: async (options) => {
      const fallback = await webviewBridge.fetchPage({
        url: options.url,
        timeoutMs: 20000,
      });

      if (!fallback?.ok) {
        throw new Error(fallback?.error || `webview bridge fetch failed for ${options.url}`);
      }

      return {
        text: String(fallback.html || fallback.text || ''),
        status: Number.isFinite(fallback.status) ? Number(fallback.status) : 200,
        contentType: typeof fallback.contentType === 'string' ? fallback.contentType : 'text/html; charset=utf-8',
      };
    },
  };
}

function createBlocklyWebSearchBridgeExtension(): {
  searchPage(options: {
    url: string;
    signal?: AbortSignal;
  }): Promise<{ html: string; url?: string; title?: string }>;
} | null {
  const webviewBridge = (window as any)?.electronAPI?.webviewBridge;
  if (typeof webviewBridge?.searchWeb !== 'function') {
    return null;
  }

  return {
    searchPage: async (options) => {
      const result = await webviewBridge.searchWeb({
        url: options.url,
        timeoutMs: 20000,
      });

      if (!result?.ok) {
        throw new Error(result?.error || `webview bridge search failed for ${options.url}`);
      }

      return {
        html: String(result.html || ''),
        url: typeof result.url === 'string' ? result.url : undefined,
        title: typeof result.title === 'string' ? result.title : undefined,
      };
    },
  };
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
  const restorePlan = await resolvePersistedLexSessionRestorePlan(options);
  return restorePlan.snapshot;
}

export async function resolvePersistedLexSessionRestorePlan(
  options: ResolvePersistedLexSessionOptions,
): Promise<ResolvedLexSessionRestorePlan> {
  const { lex, sessionId, cwd = '', turnResponses, hostRecord } = options;

  let storedSnapshot: import('aily-lex/browser').SessionSnapshot | null = null;
  let storedSnapshotState: LexSessionStoredSnapshotState = 'missing';
  let storedSnapshotError: string | undefined;

  try {
    storedSnapshot = await loadStoredLexSessionSnapshot(lex, sessionId, cwd);
    storedSnapshotState = storedSnapshot ? 'loaded' : 'missing';
  } catch (err) {
    storedSnapshotState = 'load-failed';
    storedSnapshotError = err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'unknown error';
    console.warn('[LexBootstrap] 读取标准 snapshot 失败:', err);
  }

  return buildHostAuthoritativeLexRestorePlan({
    sessionId,
    turnResponses,
    hostRecord: hostRecord ?? null,
    storedSnapshot,
    storedSnapshotState,
    ...(storedSnapshotError ? { storedSnapshotError } : {}),
    buildTurnResponseSnapshot: buildTurnResponseLexSessionSnapshot,
  });
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
  const providerContextManagementSupport = currentModel?.providerContextManagementSupport;
  const hostTransport = createElectronAilyServicesTransport();
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
    ...(hostTransport ? { transport: hostTransport } : {}),
    ...(providerContextManagementSupport ? { providerContextManagementSupport } : {}),
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

export function buildLexSummarizerModelConfig(
  currentModel?: LexRuntimeModelConfig | null,
  chatConfigService?: { resolvePresetModel?: (presetId: string | null | undefined) => LexRuntimeModelConfig | null } | null,
  maxOutputTokens = 8192,
): any {
  const summarizerRuntimeModel = typeof chatConfigService?.resolvePresetModel === 'function'
    ? chatConfigService.resolvePresetModel(FAST_SUMMARIZER_PRESET_ID) ?? currentModel
    : currentModel;
  return buildLexModelConfig(summarizerRuntimeModel, maxOutputTokens);
}

export function bootstrapBlocklyLexAgent(
  options: BootstrapLexAgentOptions,
): BlocklyLexAgentInstance {
  const { ctx, lex, sessionId, askHandler, metrics } = options;
  const cwd = resolveLexRuntimeCwd(ctx);
  const agentRuntimeMode = normalizeChatAgentRuntimeMode(ctx.currentAgentRuntimeMode, cwd ? 'coder' : 'unbound');
  const promptProfile = resolveRuntimePromptProfile(agentRuntimeMode);
  const requiredContext = resolveRuntimeRequiredContext(agentRuntimeMode);
  const subagentRequiredContext = createSubagentRequiredContext(requiredContext);
  const runtimeSessionId = (sessionId || ctx.sessionId || '').trim();
  const isRuntimeSessionStale = () => {
    const currentSessionId = (ctx.sessionId || '').trim();
    return runtimeSessionId.length > 0
      && currentSessionId.length > 0
      && currentSessionId !== runtimeSessionId;
  };
  const createSyncAbsInvocationContext = (): SyncAbsInvocationContext => ({
    sessionId: runtimeSessionId || undefined,
    isStale: isRuntimeSessionStale,
    runOutsideAngular: ctx.ownerScheduler?.runOutsideOwner
      ? <T>(operation: () => Promise<T> | T): Promise<T> | T => ctx.ownerScheduler!.runOutsideOwner(operation)
      : undefined,
  });
  const { hostAPI, toolProvider, adapter } = createBlocklyStandardHostBinding(cwd, {
    runtimeMode: agentRuntimeMode,
    sessionId: runtimeSessionId,
    onRuntimeModeSelected: ctx.selectAgentRuntimeMode,
    createSyncAbsInvocationContext,
  });
  attachBlocklyCompatibilityExtensions(adapter);
  const contextSnapshotService = getBlocklyContextSnapshotService();
  const sessionStorage = createLexSessionStorage(lex, adapter.fs);
  if (isLexBootstrapTraceEnabled()) {
    console.info('[LexBootstrap] agent runtime mode', {
      runtimeMode: agentRuntimeMode,
      promptHostId: promptProfile.hostId,
      cwd: cwd || null,
    });
  }

  const askUserPresentationContext = (opts: {
    readonly toolCallId?: string;
    readonly trace?: {
      readonly toolCallId?: string;
      readonly parentToolCallId?: string;
    };
  }): AskUserPresentationContext | undefined => {
    const parentToolCallId = opts.trace?.parentToolCallId?.trim();
    if (!parentToolCallId) {
      return opts.toolCallId || opts.trace?.toolCallId
        ? { toolCallId: opts.toolCallId ?? opts.trace?.toolCallId }
        : undefined;
    }

    return {
      toolCallId: opts.toolCallId ?? opts.trace?.toolCallId,
      sourceAgentRole: 'subagent',
      subAgentInvocationId: parentToolCallId,
      parentToolCallId,
    };
  };

  const runtimeExtensions: Record<string, unknown> = {
    environment: createEnvironmentProviderFromContext(
      contextSnapshotService,
      subagentRequiredContext,
      'subagent-environment',
    ),
    contextSnapshot: contextSnapshotService,
    askUser: {
      ask: async (opts: { question: string; options?: { label: string; description?: string; recommended?: boolean }[]; multiSelect: boolean; allowFreeform?: boolean; signal?: AbortSignal; toolCallId?: string; trace?: { toolCallId?: string; parentToolCallId?: string } }) => {
        return askUserSingle(opts.question, opts.options, opts.multiSelect, opts.allowFreeform ?? true, askUserPresentationContext(opts));
      },
      askMany: async (opts: { questions: { question: string; options?: { label: string; description?: string; recommended?: boolean }[]; allow_freeform?: boolean; multi_select?: boolean }[]; signal?: AbortSignal; toolCallId?: string; trace?: { toolCallId?: string; parentToolCallId?: string } }) => {
        return askUserMany(opts.questions, askUserPresentationContext(opts));
      },
    },
    diagnostics: {
      getErrors: async (filePaths?: string[]) => collectDiagnostics(filePaths),
    },
    memoryStorage: createBlocklyMemoryStorageExtension(cwd),
    memoryFeatureConfig: createBlocklyMemoryFeatureConfigExtension(ctx.ailyChatConfigService),
  };
  if (ctx.ownerScheduler?.runOutsideOwner) {
    runtimeExtensions['hostExecutionBoundary'] = {
      runOutsideAngular: <T>(operation: () => Promise<T> | T): Promise<T> | T => {
        return ctx.ownerScheduler!.runOutsideOwner(operation);
      },
    };
  }
  if (cwd && (sessionId || ctx.sessionId)) {
    const lexPostTurnResources = ctx.getOrCreateLexPostTurnResources?.(
      sessionId || ctx.sessionId,
      cwd,
    );
    if (lexPostTurnResources) {
      const editingTimelineRecorder = lexPostTurnResources.editingTimelineRecorder;
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
      runtimeExtensions['workspaceChangeCollector'] = lexPostTurnResources.workspaceChangeCollector;
    }
    if (ctx.scheduleLexRequestCompleted) {
      runtimeExtensions['sessionCompletionCoordinator'] = {
        scheduleRequestCompleted: (input: {
          sessionId: string;
          turnId: string;
          reason: string;
          runWorkspaceFinalize: () => Promise<void>;
          runSessionEndHooks: () => Promise<void>;
        }) => {
          ctx.scheduleLexRequestCompleted?.(input);
        },
      };
    }
  }

  let pendingNpmCommand: { command: string; isInstall: boolean; isUninstall: boolean } | null = null;

  // Blockly only contributes host adapters and domain capabilities here.
  // createAgent() remains the runtime owner for core tool registration,
  // prompt/skill assembly, and AgentExecutor/subagent execution.
  const terminalPolicy = ctx.ailyChatConfigService.getLexTerminalPolicy?.();
  const permissionPolicy = ctx.ailyChatConfigService.getLexPermissionPolicy?.(cwd || ctx.prjRootPath || ctx.prjPath || '');
  const approvalsReviewer = ctx.currentSessionApprovalsReviewer
    ?? ctx.ailyChatConfigService.getLexApprovalsReviewer?.();
  const approvalPolicy = ctx.currentSessionApprovalPolicy
    ?? ctx.ailyChatConfigService.getLexApprovalPolicy?.();
  const agentFolderProjectRoot = cwd || ctx.prjRootPath || ctx.prjPath;
  const projectAgentFileProvider = createBlocklyAgentFileProvider({
    source: 'project',
    projectRootPath: agentFolderProjectRoot,
    configSource: ctx.ailyChatConfigService,
  });
  const userAgentFileProvider = createBlocklyAgentFileProvider({
    source: 'user',
    projectRootPath: agentFolderProjectRoot,
    configSource: ctx.ailyChatConfigService,
  });
  const projectInstructionFileProvider = createBlocklyInstructionFileProvider({
    source: 'project',
    projectRootPath: agentFolderProjectRoot,
    configSource: ctx.ailyChatConfigService,
  });
  const userInstructionFileProvider = createBlocklyInstructionFileProvider({
    source: 'user',
    projectRootPath: agentFolderProjectRoot,
    configSource: ctx.ailyChatConfigService,
  });
  let agent: BlocklyLexAgentInstance | undefined;
  const skillCustomizationProvider = createBlocklySkillCustomizationProvider();
  const hookCustomizationProvider = createBlocklyHookCustomizationProvider({
    getAgent: () => agent,
  });
  const pluginCustomizationProvider = createBlocklyPluginCustomizationProvider({
    getAgent: () => agent,
  });
  const runtimeAgentProvider = createBlocklyAgentProvider(ctx.ailyChatConfigService);
  const sessionCustomizationProviderBindings = [
    createBlocklySessionCustomizationProviderBinding([
      { source: 'project', provider: projectAgentFileProvider },
      { source: 'user', provider: userAgentFileProvider },
    ], [
      { source: 'host', provider: runtimeAgentProvider },
    ], [
      { source: 'project', provider: projectInstructionFileProvider },
      { source: 'user', provider: userInstructionFileProvider },
    ], [
      { provider: skillCustomizationProvider },
    ], [
      { provider: hookCustomizationProvider },
    ], [
      { provider: pluginCustomizationProvider },
    ], 'local'),
    createBlocklySessionCustomizationProviderBinding([
      { source: 'project', provider: projectAgentFileProvider },
      { source: 'user', provider: userAgentFileProvider },
    ], [
      { source: 'host', provider: runtimeAgentProvider },
    ], [
      { source: 'project', provider: projectInstructionFileProvider },
      { source: 'user', provider: userInstructionFileProvider },
    ], [
      { provider: skillCustomizationProvider },
    ], [
      { provider: hookCustomizationProvider },
    ], [
      { provider: pluginCustomizationProvider },
    ], 'aily-agent'),
  ] as const;
  const sessionCustomizationContentProvider = createBlocklySessionCustomizationContentProvider([
    { source: 'host', provider: runtimeAgentProvider },
  ], [
    { provider: hookCustomizationProvider },
  ], [
    { provider: pluginCustomizationProvider },
  ]);
  const sessionCustomizationContentOwner = {
    provideChatSessionCustomizationContent(uri: string) {
      return sessionCustomizationContentProvider.provideTextDocumentContent(uri);
    },
  };
  const sessionProviderOptionsSourceBindings = [
    {
      sessionType: 'aily-agent',
      source: new AilyAgentSessionProviderOptionsSourceService(),
    },
  ] as const;

  for (const scheme of getBlocklySessionCustomizationContentProviderSchemes()) {
    AilyHost.get().editor?.registerTextDocumentContentProvider?.(scheme, sessionCustomizationContentProvider);
  }

  agent = lex.createAgent({
    host: adapter,
    endpoint: buildLexEndpoint(lex, ctx.currentModel, ctx.ailyChatConfigService),
    model: buildLexModelConfig(ctx.currentModel),
    summarizerModel: buildLexSummarizerModelConfig(ctx.currentModel, ctx.ailyChatConfigService),
    contextCompactionArchitecture: 'provider',
    inlineSummarization: true,
    sessionId: sessionId || ctx.sessionId,
    sessionStorage,
    capabilities: new Set([...adapter.capabilities, `runtime:${agentRuntimeMode}`]),
    cwd: cwd || undefined,
    maxToolCallIterations: ctx.ailyChatConfigService.maxRequests,
    promptProfile,
    extensions: runtimeExtensions,
    userInstructionFolders: ctx.ailyChatConfigService.userInstructionFolders.map(path => ({ path })),
    projectInstructionFolders: ctx.ailyChatConfigService.projectInstructionFolders.map(path => ({ path })),
    hooks: {
      askHandler: askHandler ?? (async () => false),
      onBeforeToolExecution: async (toolName: string, input: Record<string, unknown>) => {
        if (toolName !== 'run_in_terminal') return { action: 'allow' as const };
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
        if (toolName !== 'run_in_terminal' || !pendingNpmCommand) return { action: 'continue' as const };
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
    coreToolFilter: getConfiguredCoreToolFilter(ctx.ailyChatConfigService),
    additionalDeferredGroups: resolveDeferredGroupsForRuntime(agentRuntimeMode).map(g => ({
      id: g.id, label: g.label, description: g.description,
    })),
    toolProvider,
    skillProvider: new BlocklySkillProvider(),
    agentProvider: runtimeAgentProvider,
    slashCommandProvider: createBlocklySlashCommandProvider(sessionId),
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
    permissionMode: normalizeChatSessionPermissionMode(ctx.currentSessionPermissionMode),
    terminalPolicy,
    approvalsReviewer,
    approvalPolicy,
    strictAutoReview: approvalsReviewer === 'auto_review',
    metrics,
  });

  agent.registerContributedAgentFiles?.(
    projectAgentFileProvider,
    {
      source: 'project',
      ownerId: 'blockly:project:agentFolders',
    },
  );
  agent.registerContributedAgentFiles?.(
    userAgentFileProvider,
    {
      source: 'user',
      ownerId: 'blockly:user:agentFolders',
    },
  );
  ctx.syncSessionCustomizationContentProvider?.(sessionCustomizationContentOwner);
  if (ctx.syncSessionCustomizationProviders) {
    ctx.syncSessionCustomizationProviders(sessionCustomizationProviderBindings);
  } else {
    ctx.syncSessionCustomizationProvider?.(sessionCustomizationProviderBindings[0] ?? null);
  }
  if (ctx.syncSessionProviderOptionsSources) {
    ctx.syncSessionProviderOptionsSources(sessionProviderOptionsSourceBindings);
  } else {
    ctx.syncSessionProviderOptionsSource?.(sessionProviderOptionsSourceBindings[0] ?? null);
  }

  attachBlocklyPostCreateExtensions(agent, adapter);

  return agent;
}

function resolveLexRuntimeCwd(ctx: Pick<BootstrapLexAgentContext, 'currentSessionPath' | 'prjPath' | 'prjRootPath'>): string {
  const sessionPath = typeof ctx.currentSessionPath === 'string'
    ? ctx.currentSessionPath.trim()
    : '';
  if (sessionPath) {
    return sessionPath;
  }

  return ctx.prjPath || ctx.prjRootPath || '';
}

function attachBlocklyPostCreateExtensions(
  agent: BlocklyLexAgentInstance,
  adapter: BlocklyHostAdapter,
): void {
  const agentExecutor = createBlocklySubagentExtension(agent);

  adapter.registerExtension('skillManager', {
    search: (query: string) => {
      const results = BlocklySkillRegistry.searchSkills(query);
      const activated = new Set(BlocklySkillRegistry.getActivatedSkillNames());
      return results.map((r: any) => ({
        name: r.skill.metadata.name,
        displayName: r.skill.metadata.displayName,
        description: r.skill.metadata.description,
        loaded: activated.has(r.skill.metadata.name),
        userInvocable: r.skill.metadata.userInvocable !== false,
        modelInvocable: r.skill.metadata.disableModelInvocation !== true && !!r.skill.metadata.description,
        mode: r.skill.metadata.context || 'inline',
        skillMdPath: r.skill.skillMdPath,
      }));
    },
    listAvailable: () => {
      const activated = new Set(BlocklySkillRegistry.getActivatedSkillNames());
      return BlocklySkillRegistry.getAll().filter(skill => skill.origin?.type !== 'url').map(skill => ({
        name: skill.metadata.name,
        displayName: skill.metadata.displayName,
        description: skill.metadata.description,
        loaded: activated.has(skill.metadata.name),
        userInvocable: skill.metadata.userInvocable !== false,
        modelInvocable: skill.metadata.disableModelInvocation !== true && !!skill.metadata.description,
        mode: skill.metadata.context || 'inline',
        skillMdPath: skill.skillMdPath,
      }));
    },
    getContext: (name: string) => BlocklySkillRegistry.getSkillContext(name),
    load: (name: string) => {
      const skillContext = BlocklySkillRegistry.getSkillContext(name);
      if (!skillContext) {
        return null;
      }

      return skillContext;
    },
    unload: (name: string) => {
      const ok = BlocklySkillRegistry.deactivateSkill(name);
      if (ok) {
        agent.unregisterSkill(name);
      }
      return ok;
    },
    listLoaded: () => BlocklySkillRegistry.getLoadedSkillSummaries(),
    runFork: async (name: string, task: string, context: {
      toolCallId?: string;
      trace?: any;
      signal?: AbortSignal;
      emitEvent?: (event: any) => void;
    }): Promise<ToolResultContent> => {
      const skillContext = BlocklySkillRegistry.getSkillContext(name);
      if (!skillContext) {
        return {
          content: [{ type: 'text', text: `Skill "${name}" not found.` }],
          isError: true,
        };
      }

      const result = await agentExecutor.runSync({
        prompt: buildForkSkillPrompt(skillContext, task),
        description: `Run ${skillContext.name} skill`,
        toolCallId: context.toolCallId,
        trace: context.trace,
        signal: context.signal,
        inheritMessages: 'parent',
        inheritDiscoveredTools: true,
        onEvent: context.emitEvent,
      });

      return buildForkSkillResult(skillContext, task, result.text);
    },
  });

  adapter.registerExtension('workspaceReadAccess', {
    getAdditionalReadRoots: () => {
      const seen = new Set<string>();
      const roots: string[] = [];

      for (const skill of BlocklySkillRegistry.getAll()) {
        if (skill.origin?.type === 'url') {
          continue;
        }

        const baseDir = typeof skill.baseDir === 'string' ? skill.baseDir.trim() : '';
        if (!baseDir || seen.has(baseDir)) {
          continue;
        }

        seen.add(baseDir);
        roots.push(baseDir);
      }

      return roots;
    },
  });

  // Re-expose the lex-owned AgentExecutor back to the host as an extension bridge.
  // The live subagent UI path is owned by the canonical RenderEvent stream.
  // Do not forward raw subagent AgentEvents directly into Blockly UI metadata;
  // doing so reintroduces the legacy childItems path and duplicates scoped parts.
  const origRunSync = agentExecutor.runSync.bind(agentExecutor);
  (agentExecutor as any).runSync = (subagentOptions: any) => {
    return origRunSync({
      ...subagentOptions,
      onEvent: subagentOptions.onEvent,
    });
  };
  const origRestoreSession = agent.restoreSession.bind(agent);
  (agent as any).restoreSession = (snapshot: import('aily-lex/browser').SessionSnapshot) => {
    origRestoreSession(snapshot);
    syncPersistedActiveSkills(agent, snapshot.activeSkillNames);
  };
  adapter.registerExtension('agentExecutor', agentExecutor);
}

function buildForkSkillPrompt(
  skillContext: {
    name: string;
    displayName: string;
    description: string;
    body: string;
    skillMdPath: string;
    relatedFiles: readonly { path: string; category?: string }[];
  },
  task: string,
): string {
  const relatedFiles = skillContext.relatedFiles.length > 0
    ? [
        'Related files available inside the skill directory:',
        ...skillContext.relatedFiles.map(file => `- ${file.path}${file.category ? ` (${file.category})` : ''}`),
      ].join('\n')
    : 'Related files: none listed.';

  return [
    `You are running the \"${skillContext.displayName || skillContext.name}\" skill as a forked subagent.`,
    'Use the parent conversation as context, follow the skill instructions below, and complete the task directly.',
    `<skill_instructions name="${skillContext.name}" uri="${skillContext.skillMdPath}">`,
    skillContext.body,
    '</skill_instructions>',
    relatedFiles,
    `Task:\n${task}`,
  ].join('\n\n');
}

function buildForkSkillResult(
  skillContext: {
    name: string;
    displayName: string;
    description: string;
    skillMdPath: string;
    baseDir?: string;
    relatedFiles: readonly { path: string; uri: string; category?: string }[];
  },
  task: string,
  text: string,
): ToolResultContent {
  return {
    content: [
      {
        type: 'text',
        text: `Result from the \"${skillContext.displayName || skillContext.name}\" skill for task \"${task}\":\n\n${text}`,
      },
      {
        type: 'resource',
        uri: skillContext.skillMdPath,
        mimeType: 'text/markdown',
        text: skillContext.displayName || skillContext.name,
      },
      ...skillContext.relatedFiles.slice(0, 40).map(file => ({
        type: 'resource' as const,
        uri: file.uri,
        text: file.path,
      })),
    ],
    metadata: {
      kind: 'skill',
      invocation: {
        mode: 'fork',
        scope: 'request',
        task,
      },
      skill: {
        name: skillContext.name,
        displayName: skillContext.displayName,
        description: skillContext.description,
        skillMdPath: skillContext.skillMdPath,
        baseDir: skillContext.baseDir,
        scope: 'request',
      },
      relatedFiles: skillContext.relatedFiles.map(file => ({
        path: file.path,
        uri: file.uri,
        category: file.category,
      })),
    },
  };
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

function createBlocklyMemoryStorageExtension(cwd: string): {
  getLayout(input: { cwd: string; sessionId: string }): {
    userDir: string;
    sessionRootDir: string;
    sessionDir: string;
    repoDir: string;
  } | undefined;
} {
  return {
    getLayout(input) {
      return resolveBlocklyMemoryStorageLayout(AilyHost.get(), cwd || input.cwd, input.sessionId);
    },
  };
}

function createBlocklyMemoryFeatureConfigExtension(
  configService: AgentToolConfigAccessor,
): {
  getMemoryFeatureFlags(): {
    memoryToolEnabled: boolean;
    repositoryMemoryEnabled: boolean;
  };
} {
  return {
    getMemoryFeatureFlags() {
      return {
        memoryToolEnabled: configService.memoryToolEnabled !== false,
        repositoryMemoryEnabled: configService.repositoryMemoryEnabled === true,
      };
    },
  };
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
  hostRecord?: HostSessionRecord | null,
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
  const latestRequestSnapshot = findLatestTurnRequestPromptContextSnapshot(turnResponses);

  const interactionContinuation = shouldPersistInteractionContinuation(latestContinuation)
    ? clonePersistableInteractionContinuation(latestContinuation)
    : undefined;
  const requestContext = cloneSessionRequestContextSnapshot(
    hostRecord?.metadata?.requestContext
    ?? latestRequestSnapshot?.requestContext,
  );
  const activeSkillNames = normalizeActiveSkillNames(
    hostRecord?.metadata?.activeSkillNames,
  );
  const normalizedRequestContext = interactionContinuation
    ? {
        ...(requestContext ?? {}),
        interactionContinuation,
      }
    : requestContext;

  return {
    sessionId,
    turns: normalizedLexTurns,
    ...(normalizedRequestContext ? { requestContext: normalizedRequestContext } : {}),
    ...(activeSkillNames.length > 0 ? { activeSkillNames } : {}),
    revision: 0,
    createdAt: lexTurns[0]?.createdAt ?? Date.now(),
    updatedAt: turnResponses[turnResponses.length - 1]?.updatedAt ?? Date.now(),
  };
}

function findLatestTurnRequestPromptContextSnapshot(
  turnResponses: readonly import('aily-lex/browser').TurnResponseTurn[],
): ReturnType<typeof readTurnRequestPromptContextSnapshot> {
  for (let index = turnResponses.length - 1; index >= 0; index -= 1) {
    const snapshot = readTurnRequestPromptContextSnapshot(turnResponses[index]?.request?.metadata);
    if (snapshot) {
      return snapshot;
    }
  }

  return undefined;
}

function normalizeActiveSkillNames(value: readonly string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map(entry => entry.trim()),
  )).sort((left, right) => left.localeCompare(right));
}

interface PersistedRoundSummaryCarrier {
  readonly anchorRoundId: string;
  readonly summary: string;
  readonly anchorTurnId?: string;
  readonly turnIndex?: number;
  readonly roundIndex?: number;
}

function getLatestStructuredRoundSummaryForTurn(
  turn: import('aily-lex/browser').TurnResponseTurn,
): PersistedRoundSummaryCarrier | undefined {
  const turnSummary = turn.responseModel?.summaries?.at(-1) ?? turn.responseModel?.summary;
  const rawSummary = (turnSummary ?? {}) as Record<string, unknown>;
  const toolCallRoundId = typeof turnSummary?.toolCallRoundId === 'string' && turnSummary.toolCallRoundId.trim()
    ? turnSummary.toolCallRoundId.trim()
    : undefined;
  const anchorRoundId = typeof rawSummary['anchorRoundId'] === 'string' && rawSummary['anchorRoundId'].trim()
    ? rawSummary['anchorRoundId'].trim()
    : toolCallRoundId;
  const anchorTurnId = typeof rawSummary['anchorTurnId'] === 'string' && rawSummary['anchorTurnId'].trim()
    ? rawSummary['anchorTurnId'].trim()
    : undefined;
  const turnIndex = typeof rawSummary['turnIndex'] === 'number' && Number.isInteger(rawSummary['turnIndex']) && rawSummary['turnIndex'] >= 0
    ? rawSummary['turnIndex']
    : undefined;
  const roundIndex = typeof rawSummary['roundIndex'] === 'number' && Number.isInteger(rawSummary['roundIndex']) && rawSummary['roundIndex'] >= -1
    ? rawSummary['roundIndex']
    : undefined;
  const summary = normalizeTurnResponseSummaryPreview(turnSummary?.text);

  if (!anchorRoundId || !summary) {
    return undefined;
  }

  return {
    anchorRoundId,
    summary,
    ...(anchorTurnId ? { anchorTurnId } : {}),
    ...(turnIndex !== undefined ? { turnIndex } : {}),
    ...(roundIndex !== undefined ? { roundIndex } : {}),
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

  if (carrier.anchorTurnId && carrier.roundIndex !== undefined && carrier.roundIndex >= 0) {
    for (let turnIndex = maxTurnIndex; turnIndex >= 0; turnIndex -= 1) {
      const turn = turns[turnIndex];
      if (turn.id !== carrier.anchorTurnId) {
        continue;
      }

      return carrier.roundIndex < turn.rounds.length
        ? { turnIndex, roundIndex: carrier.roundIndex }
        : undefined;
    }
  }

  if (carrier.turnIndex !== undefined && carrier.roundIndex !== undefined && carrier.roundIndex >= 0) {
    const turn = turns[carrier.turnIndex];
    return carrier.turnIndex <= maxTurnIndex && turn && carrier.roundIndex < turn.rounds.length
      ? { turnIndex: carrier.turnIndex, roundIndex: carrier.roundIndex }
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
  if (!continuation
    || typeof continuation.interactionId !== 'string'
    || continuation.interactionId.trim().length === 0
    || !Number.isFinite(continuation.stepIndex)
    || continuation.stepIndex < 0
    || typeof continuation.lease !== 'string'
    || continuation.lease.trim().length === 0) {
    return false;
  }

  const pendingKind = continuation.pendingState && typeof continuation.pendingState === 'object'
    ? (continuation.pendingState as Record<string, unknown>)['kind']
    : undefined;
  if (typeof pendingKind === 'string' && pendingKind !== 'none') {
    return true;
  }

  if (continuation.hardStopReason?.startsWith('interaction_')) {
    return false;
  }

  if (continuation.stopReason === 'COMPLETED') {
    return false;
  }

  return continuation.status !== 'completed'
    && continuation.status !== 'complete';
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
      if (isLexBootstrapTraceEnabled()) {
        console.log('[LexStream] npm 库加载成功:', libPackageName);
      }
    } catch (e: any) {
      console.warn('[LexStream] npm 库加载失败:', libPackageName, e);
    }
  }
}

function createBlocklyCommandSessionSummary(session: ExternalTerminalSession) {
  const completedAt = typeof session.completedAt === 'number' ? session.completedAt : undefined;
  const lastOutputAt = typeof session.lastOutputAt === 'number' ? session.lastOutputAt : undefined;
  const exitCode = typeof session.exitCode === 'number' ? session.exitCode : undefined;
  const pid = typeof session.pid === 'number' ? session.pid : undefined;
  const outputFilePath = typeof session.outputFilePath === 'string' && session.outputFilePath.trim().length > 0
    ? session.outputFilePath
    : undefined;
  const lastTimestamp = completedAt ?? Date.now();
  return {
    processId: session.id,
    sessionId: session.sessionId,
    outputSessionId: session.outputSessionId,
    command: session.command,
    cwd: session.cwd,
    status: session.status,
    running: session.running,
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(pid !== undefined ? { pid } : {}),
    startedAt: session.startedAt,
    ...(lastOutputAt !== undefined ? { lastOutputAt } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
    elapsedMs: Math.max(0, lastTimestamp - session.startedAt),
    bytesTotal: byteLength(session.stdout) + byteLength(session.stderr),
    background: session.background === true,
    ...(outputFilePath ? { outputFilePath } : {}),
  };
}

function notifyBlocklyCommandSessionUpdate(sessionId: string, processId: string): void {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const normalizedProcessId = typeof processId === 'string' ? processId.trim() : '';
  if (!normalizedSessionId || !normalizedProcessId) {
    return;
  }
  for (const listener of [...blocklyCommandSessionListeners]) {
    listener(normalizedSessionId, normalizedProcessId);
  }
}

function attachBlocklyCommandSession(session: ExternalTerminalSession): void {
  const previous = blocklyCommandSessions.get(session.id);
  if (previous && previous.sessionId && previous.sessionId !== session.sessionId) {
    const previousIds = blocklyCommandSessionIdsBySession.get(previous.sessionId);
    previousIds?.delete(session.id);
    if (previousIds && previousIds.size === 0) {
      blocklyCommandSessionIdsBySession.delete(previous.sessionId);
    }
  }

  blocklyCommandSessions.set(session.id, session);
  if (session.sessionId) {
    let processIds = blocklyCommandSessionIdsBySession.get(session.sessionId);
    if (!processIds) {
      processIds = new Set<string>();
      blocklyCommandSessionIdsBySession.set(session.sessionId, processIds);
    }
    processIds.add(session.id);
    notifyBlocklyCommandSessionUpdate(session.sessionId, session.id);
  }
}

function sanitizeBlocklyCommandSessionFileName(processId: string): string {
  return processId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function appendBlocklyCommandSessionFile(
  host: any,
  filePath: string,
  content: string,
): void {
  if (!filePath || !content) {
    return;
  }

  try {
    if (typeof host.fs.appendFileSync === 'function') {
      host.fs.appendFileSync(filePath, content, 'utf-8');
      return;
    }
  } catch {
    // Fall back to read + write below.
  }

  const previous = host.fs.existsSync(filePath)
    ? host.fs.readFileSync(filePath, 'utf-8')
    : '';
  host.fs.writeFileSync(filePath, `${previous}${content}`, 'utf-8');
}

function resolveBlocklyCommandSessionStoragePaths(
  host: any,
  cwd: string,
  sessionId: string,
  processId: string,
): { outputFilePath: string; metadataFilePath: string } | null {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalizedSessionId) {
    return null;
  }

  const projectPath = cwd || host.project?.currentProjectPath || host.project?.projectRootPath || '';
  const appDataPath = host.path?.getAppDataPath?.();
  if (!projectPath && !appDataPath) {
    return null;
  }
  const rootDir = projectPath
    ? host.path.join(projectPath, PROJECT_CHAT_DIR, normalizedSessionId)
    : host.path.join(appDataPath, GLOBAL_CHAT_DATA_DIR, normalizedSessionId);
  const processDir = host.path.join(rootDir, PROCESS_RECORDS_DIR);
  host.fs.mkdirSync(processDir, { recursive: true });
  const safeName = sanitizeBlocklyCommandSessionFileName(processId);
  return {
    outputFilePath: host.path.join(processDir, `${safeName}.log`),
    metadataFilePath: host.path.join(processDir, `${safeName}.json`),
  };
}

function persistBlocklyCommandSessionRecord(session: ExternalTerminalSession): void {
  if (!session.metadataFilePath) {
    return;
  }

  const payload = {
    version: 1,
    processId: session.id,
    sessionId: session.sessionId,
    outputSessionId: session.outputSessionId,
    command: session.command,
    cwd: session.cwd,
    status: session.status,
    running: session.running,
    exitCode: typeof session.exitCode === 'number' ? session.exitCode : null,
    pid: typeof session.pid === 'number' ? session.pid : null,
    ptyPid: typeof session.ptyPid === 'number' ? session.ptyPid : null,
    startedAt: session.startedAt,
    lastOutputAt: session.lastOutputAt,
    completedAt: typeof session.completedAt === 'number' ? session.completedAt : null,
    bytesTotal: byteLength(session.stdout) + byteLength(session.stderr),
    stdoutBytes: byteLength(session.stdout),
    stderrBytes: byteLength(session.stderr),
    outputFilePath: session.outputFilePath ?? null,
    background: session.background === true,
    executionKind: session.executionKind,
  };
  try {
    AilyHost.get().fs.writeFileSync(session.metadataFilePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch {
    // Keep runtime flow resilient if persistence fails.
  }
}

function persistBlocklyCommandSessionOutput(
  host: any,
  session: ExternalTerminalSession,
  text: string,
): void {
  if (!text || !session.outputFilePath) {
    return;
  }

  appendBlocklyCommandSessionFile(host, session.outputFilePath, text);
}

function createExternalTerminal(host: any, prjPath: () => string, runtimeSessionId?: string): IExternalHostAPI['terminal'] {
  const hasRawTerminal = !!(host.terminal?.run && host.terminal?.onData);
  const hasCmdService = !!(host.cmd?.spawn && host.cmd?.kill && host.cmd?.sendInput);
  const hasPtyTerminal = !!(
    host.terminal?.spawnCommand
    && host.terminal?.sendInput
    && host.terminal?.onPidData
    && host.terminal?.onPidExit
    && host.terminal?.resize
  );

  if (!hasRawTerminal && !hasCmdService && !hasPtyTerminal) {
    return undefined;
  }
  let terminalApi: BlocklyExternalTerminal;

  const createSnapshot = (session: ExternalTerminalSession) => ({
    id: session.id,
    processId: session.id,
    sessionId: session.sessionId,
    command: session.command,
    cwd: session.cwd,
    stdout: session.stdout,
    stderr: session.stderr,
    running: session.running,
    status: session.status,
    exitCode: session.exitCode,
    pid: session.pid,
    outputSessionId: session.outputSessionId,
    ...(session.outputFilePath ? { outputFilePath: session.outputFilePath } : {}),
    bytesTotal: byteLength(session.stdout) + byteLength(session.stderr),
    startedAt: session.startedAt,
    lastOutputAt: session.lastOutputAt,
    completedAt: session.completedAt,
    background: session.background,
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
    session.status = session.status === 'running'
      ? (exitCode === 0 ? 'completed' : 'failed')
      : session.status;
    session.completedAt = Date.now();
    settleReady(session);
    if (!session.finishedResolved) {
      session.finishedResolved = true;
      session.resolveFinished();
    }
    session.removeListener?.();
    session.removeListener = undefined;
    session.subscription?.unsubscribe?.();
    session.subscription = undefined;
    session.abortCleanup?.();
    session.abortCleanup = undefined;
    persistBlocklyCommandSessionRecord(session);
    if (session.sessionId) {
      notifyBlocklyCommandSessionUpdate(session.sessionId, session.id);
    }
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
            session.lastOutputAt = Date.now();
            persistBlocklyCommandSessionOutput(host, session, data.data ?? '');
            persistBlocklyCommandSessionRecord(session);
            emitExternalTerminalOutput(session, 'stdout', data.data ?? '');
            settleReady(session);
            break;
          case 'stderr':
            session.stderr += data.data ?? '';
            session.lastOutputAt = Date.now();
            persistBlocklyCommandSessionOutput(host, session, data.data ?? '');
            persistBlocklyCommandSessionRecord(session);
            emitExternalTerminalOutput(session, 'stderr', data.data ?? '');
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
            session.lastOutputAt = Date.now();
            emitExternalTerminalOutput(session, 'stderr', data.error ?? '');
            session.status = 'failed';
            finalize(session, 1);
            break;
        }
      },
      error: (err: unknown) => {
        session.stderr += err instanceof Error ? err.message : String(err);
        session.lastOutputAt = Date.now();
        emitExternalTerminalOutput(session, 'stderr', err instanceof Error ? err.message : String(err));
        session.status = 'failed';
        finalize(session, 1);
      },
    });
  };

  const attachRawTerminalSession = (session: ExternalTerminalSession) => {
    session.removeListener = host.terminal.onData(session.id, (data: any) => {
      switch (data.type) {
        case 'stdout':
          session.stdout += data.data ?? '';
          session.lastOutputAt = Date.now();
          persistBlocklyCommandSessionOutput(host, session, data.data ?? '');
          persistBlocklyCommandSessionRecord(session);
          emitExternalTerminalOutput(session, 'stdout', data.data ?? '');
          settleReady(session);
          break;
        case 'stderr':
          session.stderr += data.data ?? '';
          session.lastOutputAt = Date.now();
          persistBlocklyCommandSessionOutput(host, session, data.data ?? '');
          persistBlocklyCommandSessionRecord(session);
          emitExternalTerminalOutput(session, 'stderr', data.data ?? '');
          settleReady(session);
          break;
        case 'close':
          finalize(session, data.code ?? 0);
          break;
        case 'error':
          session.stderr += data.error ?? '';
          session.lastOutputAt = Date.now();
          emitExternalTerminalOutput(session, 'stderr', data.error ?? '');
          session.status = 'failed';
          finalize(session, 1);
          break;
      }
    });
  };

  const attachPtyTerminalSession = (session: ExternalTerminalSession) => {
    const removeData = host.terminal.onPidData(session.id, (payload: any) => {
      const text = typeof payload === 'string' ? payload : payload?.data ?? '';
      if (!text) {
        return;
      }
      session.stdout += text;
      session.lastOutputAt = Date.now();
      persistBlocklyCommandSessionOutput(host, session, text);
      persistBlocklyCommandSessionRecord(session);
      emitExternalTerminalOutput(session, 'stdout', text);
      settleReady(session);
    });
    const removeExit = host.terminal.onPidExit(session.id, (payload: any) => {
      finalize(session, typeof payload?.exitCode === 'number' ? payload.exitCode : 0);
    });
    session.removeListener = () => {
      removeData?.();
      removeExit?.();
    };
  };

  const start = async (command: string, opts?: {
    processId?: string;
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
    tty?: boolean;
    streamStdin?: boolean;
    streamStdoutStderr?: boolean;
    size?: { rows: number; cols: number };
    onOutput?: ExternalTerminalSession['outputListener'];
  }) => {
    const id = opts?.processId?.trim() || `terminal_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const cwd = opts?.cwd ?? prjPath();
    const sessionId = typeof runtimeSessionId === 'string' ? runtimeSessionId.trim() : '';
    let resolveReady!: () => void;
    let resolveFinished!: () => void;
    const storagePaths = resolveBlocklyCommandSessionStoragePaths(host, cwd, sessionId, id);
    const session: ExternalTerminalSession = {
      id,
      sessionId,
      outputSessionId: id,
      command,
      cwd,
      stdout: '',
      stderr: '',
      running: true,
      status: 'running',
      startedAt: Date.now(),
      lastOutputAt: Date.now(),
      ...(storagePaths ? {
        outputFilePath: storagePaths.outputFilePath,
        metadataFilePath: storagePaths.metadataFilePath,
      } : {}),
      readyResolved: false,
      finishedResolved: false,
      ready: new Promise<void>((resolve) => { resolveReady = resolve; }),
      finished: new Promise<void>((resolve) => { resolveFinished = resolve; }),
      resolveReady,
      resolveFinished,
      outputListener: opts?.onOutput,
      executionKind: opts?.tty ? 'pty' : 'buffered',
      background: false,
    };

    if (opts?.tty) {
      if (hasPtyTerminal) {
        attachPtyTerminalSession(session);
      }
    } else if (hasCmdService) {
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
      session.lastOutputAt = Date.now();
      session.status = 'timeout';
      emitExternalTerminalOutput(session, 'stderr', '[Process killed: timeout exceeded]');
      const stopped = await stopExternalSession(session, host);
      if (stopped && session.running) {
        finalize(session, session.exitCode ?? 124);
      }
    }, timeout);

    attachBlocklyCommandSession(session);
    persistBlocklyCommandSessionRecord(session);
    registerBlocklyCommandSessionOwner(id, terminalApi);

    try {
      if (opts?.tty) {
        if (!hasPtyTerminal) {
          session.stderr += 'PTY command execution is not supported by the current host.';
          session.status = 'failed';
          finalize(session, 1);
        } else {
          const result = await host.terminal.spawnCommand({
            processId: id,
            command,
            cwd,
            env: opts?.env,
            cols: opts?.size?.cols,
            rows: opts?.size?.rows,
          });
          session.pid = result?.pid;
          session.ptyPid = result?.pid;
          persistBlocklyCommandSessionRecord(session);
          if (!result?.success) {
            session.stderr += result?.error ?? 'PTY command start failed';
            session.status = 'failed';
            finalize(session, 1);
          } else {
            settleReady(session);
          }
        }
      } else if (hasRawTerminal) {
        const result = await host.terminal.run({ command, cwd, streamId: id, env: opts?.env });
        session.pid = result?.pid;
        persistBlocklyCommandSessionRecord(session);
        if (!result?.success) {
          session.stderr += result?.error ?? 'Terminal start failed';
          session.status = 'failed';
          finalize(session, 1);
        }
      } else if (!hasCmdService) {
        session.stderr += 'Terminal start failed';
        session.status = 'failed';
        finalize(session, 1);
      }
    } catch (err) {
      session.stderr += err instanceof Error ? err.message : String(err);
      session.status = 'failed';
      finalize(session, 1);
    }

    await Promise.race([session.ready, delay(150)]);
    return createSnapshot(session);
  };

  terminalApi = {
    exec: async (command: string, opts?: { cwd?: string; timeout?: number; env?: Record<string, string> }) => {
      const snapshot = await start(command, opts);
      const session = blocklyCommandSessions.get(snapshot.id);
      if (session?.running) {
        await session.finished;
      }
      const finalSnapshot = blocklyCommandSessions.get(snapshot.id)
        ? createSnapshot(blocklyCommandSessions.get(snapshot.id)!)
        : snapshot;
      return {
        stdout: finalSnapshot.stdout,
        stderr: finalSnapshot.stderr,
        exitCode: finalSnapshot.exitCode ?? 1,
      };
    },
    start,
    getOutput: async (id: string) => {
      const session = blocklyCommandSessions.get(id);
      return session ? createSnapshot(session) : null;
    },
    execCommand: async (command: string, opts?: { processId?: string; cwd?: string; timeoutMs?: number; timeout?: number; yieldTimeMs?: number; signal?: AbortSignal; env?: Record<string, string>; tty?: boolean; streamStdin?: boolean; streamStdoutStderr?: boolean; size?: { rows: number; cols: number }; onOutput?: (event: any) => void }) => {
      const snapshot = await start(command, {
        processId: opts?.processId,
        cwd: opts?.cwd,
        timeout: opts?.timeoutMs ?? opts?.timeout,
        env: opts?.env,
        tty: opts?.tty,
        streamStdin: opts?.streamStdin,
        streamStdoutStderr: opts?.streamStdoutStderr,
        size: opts?.size,
        onOutput: opts?.onOutput,
      });
      const session = blocklyCommandSessions.get(snapshot.id);
      if (!session) {
        return snapshot;
      }
      session.outputListener = opts?.onOutput;
      bindAbortToExternalSession(session, opts?.signal, async () => {
        session.status = 'cancelled';
        const stopped = await stopExternalSession(session, host);
        if (stopped && session.running) {
          finalize(session, session.exitCode ?? 130);
        }
      });
      return waitForExternalSession(session, opts?.yieldTimeMs, opts?.signal);
    },
    writeStdin: async (id: string, input: string, opts?: { yieldTimeMs?: number; signal?: AbortSignal; onOutput?: (event: any) => void }) => {
      const session = blocklyCommandSessions.get(id);
      if (!session) {
        return null;
      }
      session.outputListener = opts?.onOutput;
      if (input.length > 0) {
        const ok = await sendExternalInput(session, host, input);
        if (!ok && session.running) {
          session.stderr += `${session.stderr ? '\n' : ''}[stdin unavailable]`;
          session.lastOutputAt = Date.now();
          emitExternalTerminalOutput(session, 'stderr', '[stdin unavailable]');
        }
      }
      bindAbortToExternalSession(session, opts?.signal, async () => {
        session.status = 'cancelled';
        const stopped = await stopExternalSession(session, host);
        if (stopped && session.running) {
          finalize(session, session.exitCode ?? 130);
        }
      });
      return waitForExternalSession(session, opts?.yieldTimeMs, opts?.signal);
    },
    resizeProcess: async (id: string, size: { cols: number; rows: number }) => {
      const session = blocklyCommandSessions.get(id);
      if (!session) {
        return null;
      }

      const cols = Math.floor(size.cols);
      const rows = Math.floor(size.rows);
      if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
        session.stderr += `${session.stderr ? '\n' : ''}[terminal resize failed: rows and cols must be greater than 0]`;
        session.lastOutputAt = Date.now();
        emitExternalTerminalOutput(session, 'stderr', '[terminal resize failed: rows and cols must be greater than 0]');
        return createSnapshot(session);
      }

      if (session.executionKind !== 'pty' || typeof host.terminal?.resize !== 'function') {
        return createSnapshot(session);
      }

      host.terminal.resize({ pid: session.id, cols, rows });
      return createSnapshot(session);
    },
    getProcessStatus: async (id: string) => {
      const session = blocklyCommandSessions.get(id);
      return session ? createSnapshot(session) : null;
    },
    stopProcess: async (id: string, opts?: { yieldTimeMs?: number }) => {
      const session = blocklyCommandSessions.get(id);
      if (!session) {
        return null;
      }
      session.status = 'killed';
      session.stderr += `${session.stderr ? '\n' : ''}[Process stopped by user]`;
      session.lastOutputAt = Date.now();
      emitExternalTerminalOutput(session, 'stderr', '[Process stopped by user]', {
        status: 'killed',
        running: false,
      });
      const stopped = await stopExternalSession(session, host);
      if (stopped && session.running) {
        finalize(session, session.exitCode ?? 130);
      }
      return waitForExternalSession(session, opts?.yieldTimeMs ?? 250);
    },
    readOutput: async (id: string, opts?: { offset?: number; maxBytes?: number }) => {
      const session = blocklyCommandSessions.get(id);
      return session ? readExternalOutput(session, opts?.offset, opts?.maxBytes) : null;
    },
    tailOutput: async (id: string, maxBytes?: number) => {
      const session = blocklyCommandSessions.get(id);
      return session ? tailExternalOutput(session, maxBytes) : null;
    },
    searchOutput: async (id: string, opts: { query?: string; regex?: string; beforeLines?: number; afterLines?: number; maxMatches?: number }) => {
      const session = blocklyCommandSessions.get(id);
      return session ? searchExternalOutput(session, opts) : null;
    },
    sendInput: async (id: string, input: string) => {
      const session = blocklyCommandSessions.get(id);
      if (!session) {
        return false;
      }
      return sendExternalInput(session, host, input);
    },
    kill: async (id: string) => {
      const session = blocklyCommandSessions.get(id);
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
  registerBlocklyCommandSessionController(terminalApi);
  return terminalApi;
}

interface ExternalTerminalSession {
  id: string;
  sessionId: string;
  outputSessionId: string;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  running: boolean;
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'killed' | 'cancelled';
  exitCode?: number;
  pid?: number;
  ptyPid?: number;
  startedAt: number;
  lastOutputAt: number;
  completedAt?: number;
  outputFilePath?: string;
  metadataFilePath?: string;
  readyResolved: boolean;
  finishedResolved: boolean;
  ready: Promise<void>;
  finished: Promise<void>;
  resolveReady(): void;
  resolveFinished(): void;
  removeListener?: () => void;
  subscription?: { unsubscribe(): void };
  timer?: ReturnType<typeof setTimeout>;
  outputListener?: (event: {
    processId: string;
    sessionId: string;
    outputSessionId: string;
    command: string;
    cwd: string;
    stream: 'stdout' | 'stderr';
    text: string;
    status?: ExternalTerminalSession['status'];
    running?: boolean;
    bytesTotal: number;
    timestamp: number;
    outputFilePath?: string;
  }) => void;
  abortCleanup?: () => void;
  executionKind: 'buffered' | 'pty';
  background: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForExternalSession(
  session: ExternalTerminalSession,
  yieldTimeMs = 1_000,
  signal?: AbortSignal,
) {
  if (signal?.aborted && session.running) {
    session.status = 'cancelled';
  }

  if (session.running && (yieldTimeMs ?? 0) > 0) {
    let removeAbortListener: (() => void) | undefined;
    const abortPromise = signal
      ? new Promise<void>((resolve) => {
          const onAbort = () => resolve();
          signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () => signal.removeEventListener('abort', onAbort);
        })
      : undefined;
    await Promise.race([
      session.finished,
      delay(Math.max(0, Math.min(30_000, yieldTimeMs))),
      ...(abortPromise ? [abortPromise] : []),
    ]);
    removeAbortListener?.();
  }

  return {
    id: session.id,
    processId: session.id,
    sessionId: session.sessionId,
    command: session.command,
    cwd: session.cwd,
    stdout: session.stdout,
    stderr: session.stderr,
    running: session.running,
    status: session.status,
    exitCode: session.exitCode,
    pid: session.pid,
    outputSessionId: session.outputSessionId,
    ...(session.outputFilePath ? { outputFilePath: session.outputFilePath } : {}),
    bytesTotal: byteLength(session.stdout) + byteLength(session.stderr),
    startedAt: session.startedAt,
    lastOutputAt: session.lastOutputAt,
    completedAt: session.completedAt,
    background: session.background,
  };
}

function bindAbortToExternalSession(
  session: ExternalTerminalSession,
  signal: AbortSignal | undefined,
  onAbort: () => void | Promise<void>,
): void {
  if (!signal || session.abortCleanup) {
    return;
  }
  const handleAbort = () => {
    void onAbort();
  };
  signal.addEventListener('abort', handleAbort, { once: true });
  session.abortCleanup = () => signal.removeEventListener('abort', handleAbort);
  if (signal.aborted) {
    handleAbort();
  }
}

function emitExternalTerminalOutput(
  session: ExternalTerminalSession,
  stream: 'stdout' | 'stderr',
  text: string,
  options: { status?: ExternalTerminalSession['status']; running?: boolean } = {},
): void {
  if (!session.outputListener || !text) {
    return;
  }
  const now = Date.now();
  session.outputListener({
    processId: session.id,
    sessionId: session.sessionId,
    outputSessionId: session.outputSessionId,
    command: session.command,
    cwd: session.cwd,
    stream,
    text,
    status: options.status ?? session.status,
    running: options.running ?? session.running,
    bytesTotal: byteLength(session.stdout) + byteLength(session.stderr),
    timestamp: now,
    ...(session.outputFilePath ? { outputFilePath: session.outputFilePath } : {}),
  });
}

async function sendExternalInput(session: ExternalTerminalSession, host: any, input: string): Promise<boolean> {
  if (session.executionKind === 'pty') {
    if (!session.running || typeof host.terminal?.sendInput !== 'function') {
      return false;
    }
    host.terminal.sendInput({ pid: session.id, input });
    return true;
  }
  const sendInput = host.cmd?.sendInput ?? host.terminal?.input;
  if (!session.running || typeof sendInput !== 'function') {
    return false;
  }
  const result = await sendInput.call(host.cmd ?? host.terminal, session.id, input);
  return result?.success !== false;
}

async function stopExternalSession(session: ExternalTerminalSession, host: any): Promise<boolean> {
  if (session.executionKind === 'pty') {
    if (typeof host.terminal?.close !== 'function') {
      return false;
    }
    host.terminal.close({ pid: session.id });
    return true;
  }
  const kill = host.cmd?.kill ?? host.terminal?.kill;
  if (typeof kill !== 'function') {
    return false;
  }
  const result = await kill.call(host.cmd ?? host.terminal, session.id);
  return result?.success !== false;
}

function readExternalOutput(session: ExternalTerminalSession, offset = 0, maxBytes = 64 * 1024) {
  const content = combinedExternalOutput(session);
  const normalizedOffset = Math.max(0, Math.min(content.length, Math.floor(offset)));
  const normalizedMaxBytes = Math.max(0, Math.floor(maxBytes));
  const slice = content.slice(normalizedOffset, normalizedOffset + normalizedMaxBytes);
  return {
    content: slice,
    offset: normalizedOffset,
    nextOffset: normalizedOffset + slice.length,
    bytesTotal: byteLength(content),
    truncatedByBytes: normalizedOffset + slice.length < content.length,
  };
}

function tailExternalOutput(session: ExternalTerminalSession, maxBytes = 32 * 1024) {
  const content = combinedExternalOutput(session);
  const normalizedMaxBytes = Math.max(0, Math.floor(maxBytes));
  const offset = Math.max(0, content.length - normalizedMaxBytes);
  return {
    content: content.slice(offset),
    offset,
    bytesTotal: byteLength(content),
    omittedPrefixBytes: byteLength(content.slice(0, offset)),
  };
}

function searchExternalOutput(
  session: ExternalTerminalSession,
  options: { query?: string; regex?: string; beforeLines?: number; afterLines?: number; maxMatches?: number },
) {
  const content = combinedExternalOutput(session);
  const lines = content.split(/\r?\n/);
  const beforeLines = Math.max(0, Math.floor(options.beforeLines ?? 0));
  const afterLines = Math.max(0, Math.floor(options.afterLines ?? 0));
  const maxMatches = Math.max(1, Math.floor(options.maxMatches ?? 20));
  const matcher = options.regex
    ? new RegExp(options.regex)
    : null;
  const query = options.query ?? '';
  const matches: Array<{ lineNumber: number; line: string; before: string[]; after: string[] }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const hit = matcher ? matcher.test(line) : (query ? line.includes(query) : false);
    if (!hit) {
      continue;
    }
    matches.push({
      lineNumber: index + 1,
      line,
      before: lines.slice(Math.max(0, index - beforeLines), index),
      after: lines.slice(index + 1, index + 1 + afterLines),
    });
    if (matches.length >= maxMatches) {
      break;
    }
  }
  return {
    matches,
    bytesTotal: byteLength(content),
    truncatedByMatches: matches.length >= maxMatches,
  };
}

function combinedExternalOutput(session: ExternalTerminalSession): string {
  return [
    session.stdout,
    session.stderr ? `${session.stdout ? '\n' : ''}${session.stderr}` : '',
  ].join('');
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
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
