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

import type { IToolContribution, IHostToolProvider, ToolResultContent } from 'aily-lex/browser';
import type { IExternalHostAPI } from 'aily-lex/host/blockly';

// ---- 复用已有工具实现 ----
import { appendLegacyHostContributions, invokeLegacyHostExternalTool, isLegacyHostExternalToolName } from './blockly-legacy-host-tools';
import {
  appendBlocklyWorkspaceContributions,
  createBlocklyWorkspaceHandlers,
  type BlocklyWorkspaceToolOverrides,
} from './blockly-workspace-tools';
import {
  appendBlocklyDiscoveryContributions,
  appendBlocklyProjectContributions,
  createBlocklyProjectDiscoveryHandlers,
} from './blockly-project-discovery-tools';
import {
  error,
  type InvokeHandler,
} from './blockly-contributed-tool-runtime';
import { createBlocklyPlaceholderHandlers } from './blockly-placeholder-host-tools';

export const BLOCKLY_LEX_DEFERRED_GROUPS = [
  { id: 'blockly-library-discovery', label: '硬件/库工具', description: '开发板、库搜索与库定义分析' },
  { id: 'blockly-project-management', label: '项目管理', description: '项目创建、切板、构建与配置' },
  { id: 'blockly-architecture', label: '架构文档', description: '低频架构图持久化工具' },
] as const;

function createDeferred(group: typeof BLOCKLY_LEX_DEFERRED_GROUPS[number]['id'], reason: string) {
  return { group, reason };
}

// makeSchematicContribution removed — schematic tools are now individual external tools
// with per-tool agentScope (from tools.ts 'agents' field), managed by lex runtime resolution.

// ---------------------------------------------------------------------------
// Schematic / External Tools — Phase 1.3: unified into contributed provider
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Invoke Handlers
// ---------------------------------------------------------------------------

type BlocklyToolProviderOverrides = BlocklyWorkspaceToolOverrides;

function createHandlers(overrides?: BlocklyToolProviderOverrides): Record<string, InvokeHandler> {
  return {
    ...createBlocklyWorkspaceHandlers(overrides),
    ...createBlocklyProjectDiscoveryHandlers(),
    ...createBlocklyPlaceholderHandlers(),
  };
}

function appendWorkspaceContributions(contributions: IToolContribution[], hostAPI: IExternalHostAPI): void {
  appendBlocklyWorkspaceContributions(contributions, hostAPI, createDeferred);
}

function appendProjectContributions(contributions: IToolContribution[], hostAPI: IExternalHostAPI): void {
  appendBlocklyProjectContributions(contributions, hostAPI, createDeferred);
}

function appendDiscoveryContributions(contributions: IToolContribution[], hostAPI: IExternalHostAPI): void {
  appendBlocklyDiscoveryContributions(contributions, hostAPI, createDeferred);
}

function collectBlocklyContributions(hostAPI: IExternalHostAPI): IToolContribution[] {
  const contributions: IToolContribution[] = [];

  appendWorkspaceContributions(contributions, hostAPI);
  appendProjectContributions(contributions, hostAPI);
  appendDiscoveryContributions(contributions, hostAPI);
  appendLegacyHostContributions(contributions, hostAPI);

  return contributions;
}

// ---------------------------------------------------------------------------
// Provider Factory
// ---------------------------------------------------------------------------

/**
 * Create an IHostToolProvider for aily-blockly based on its external host API.
 *
 * Detects available capabilities and only contributes applicable tools.
 */
export function createBlocklyToolProvider(hostAPI: IExternalHostAPI, overrides?: BlocklyToolProviderOverrides): IHostToolProvider {
  const contributions = collectBlocklyContributions(hostAPI);
  const handlers = createHandlers(overrides);

  return {
    contributeTools(): IToolContribution[] {
      return contributions;
    },

    async invoke(toolName: string, input: unknown, signal?: AbortSignal, invocationContext?: {
      toolCallId?: string;
      trace?: { turnId?: string };
      host?: { getExtension<T>(id: string): T | undefined };
    }): Promise<ToolResultContent> {
      // External tools call handlers directly; no blockly-side runtime registry remains here.
      if (isLegacyHostExternalToolName(toolName)) {
        return invokeLegacyHostExternalTool(toolName, input as Record<string, unknown>, invocationContext);
      }

      const handler = handlers[toolName];
      if (!handler) {
        return error(`Unknown contributed tool: ${toolName}`);
      }
      try {
        return await handler(input as Record<string, unknown>, hostAPI, invocationContext);
      } catch (err) {
        return error(`${toolName} error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
