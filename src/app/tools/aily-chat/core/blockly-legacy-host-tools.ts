import type { IToolContribution, ToolResultContent } from 'aily-lex/browser';
import type { IExternalHostAPI } from 'aily-lex/host/blockly';

import { AilyHost } from './host';
import { normalizeAgentIdentifiers } from './agent-identifiers';
import { LEGACY_HOST_EXTERNAL_TOOLS } from '../tools/legacy-host-tool-definitions';

const LEGACY_HOST_EXTERNAL_TOOL_NAMES = LEGACY_HOST_EXTERNAL_TOOLS
  .map(tool => tool.name)
  .filter(name => name !== 'save_arch');
const LEGACY_HOST_EXTERNAL_TOOL_NAME_SET = new Set<string>(LEGACY_HOST_EXTERNAL_TOOL_NAMES);
type RuntimeScopedToolContribution = IToolContribution & {
  readonly toolSet?: string;
  readonly runtimeModes?: readonly string[];
  readonly requiredCapabilities?: readonly string[];
};

function text(s: string): ToolResultContent {
  return { content: [{ type: 'text', text: s }] };
}

function error(s: string): ToolResultContent {
  return { content: [{ type: 'text', text: `Error: ${s}` }], isError: true };
}

function makeLegacyContribution(name: string): RuntimeScopedToolContribution | null {
  const legacy = LEGACY_HOST_EXTERNAL_TOOLS.find(tool => tool.name === name);
  if (!legacy) return null;

  return {
    name: legacy.name,
    toolSet: 'blockly-legacy',
    description: legacy.description || name,
    prompt: '',
    inputSchema: legacy.input_schema || { type: 'object', properties: {} },
    annotations: { readOnly: false },
    runtimeModes: ['blockly'],
    requiredCapabilities: ['runtime:blockly'],
    agentScope: legacy.agents?.length ? normalizeAgentIdentifiers(legacy.agents) : undefined,
    deferred: undefined,
  };
}

export function appendLegacyHostContributions(
  contributions: IToolContribution[],
  hostAPI: IExternalHostAPI,
): void {
  if (hostAPI.connectionGraph) {
    for (const name of LEGACY_HOST_EXTERNAL_TOOL_NAMES) {
      const contribution = makeLegacyContribution(name);
      if (contribution) {
        contributions.push(contribution);
      }
    }
  }
}
export function isLegacyHostExternalToolName(toolName: string): boolean {
  return LEGACY_HOST_EXTERNAL_TOOL_NAME_SET.has(toolName);
}

export async function invokeLegacyHostExternalTool(
  toolName: string,
  input: Record<string, unknown>,
  hostAPI: IExternalHostAPI,
  invocationContext?: {
    toolCallId?: string;
    trace?: { turnId?: string };
    host?: { getExtension<T>(id: string): T | undefined };
  },
): Promise<ToolResultContent> {
  const host = AilyHost.get();

  if (!hostAPI.connectionGraph) return error('连线图服务不可用');

  const cg = host.connectionGraph as any | undefined;
  const schematic = hostAPI.connectionGraph as any;

  try {
    let result: any;
    switch (toolName) {
      case 'generate_schematic':
        cg.emitNotice?.({ title: 'AI生成中', text: '正在准备硬件组件引脚信息...', state: 'doing', showProgress: false });
        result = await schematic.generateSchematic?.(input, invocationContext);
        break;
      case 'get_pinmap_summary':
        result = await schematic.getPinmapSummary?.(input, invocationContext);
        break;
      case 'get_component_catalog':
        result = await schematic.getComponentCatalog?.(input, invocationContext);
        break;
      case 'get_project_context':
        cg.emitNotice?.({ title: 'AI生成中', text: '正在分析项目和组件信息...', state: 'doing', showProgress: false });
        result = await schematic.getProjectContext?.(input, invocationContext);
        break;
      case 'validate_schematic':
        cg.emitNotice?.({ title: 'AI生成中', text: '正在验证并保存连线图...', state: 'doing', showProgress: false });
        result = await schematic.validateSchematic?.(input, invocationContext);
        break;
      case 'get_current_schematic':
        result = await schematic.getCurrentSchematic?.(input, invocationContext);
        break;
      case 'generate_pinmap':
        cg.emitNotice?.({ title: 'AI生成中', text: '正在生成引脚配置...', state: 'doing', showProgress: false });
        result = await schematic.generatePinmap?.(input, invocationContext);
        break;
      case 'save_pinmap':
        cg.emitNotice?.({ title: 'AI生成中', text: '正在保存引脚配置...', state: 'doing', showProgress: false });
        result = await schematic.savePinmap?.(input, invocationContext);
        break;
      default:
        return error(`Unknown external tool: ${toolName}`);
    }

    return result?.is_error
      ? error(result.content)
      : text(typeof result?.content === 'string' ? result.content : JSON.stringify(result?.content ?? ''));
  } catch (err) {
    return error(`${toolName} error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
