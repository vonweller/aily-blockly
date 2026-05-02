import type { Tool } from './chat-types';
import type { AilyChatConfigService } from '../services/aily-chat-config.service';
import { MAIN_AGENT_TYPE, normalizeAgentIdentifier } from './agent-identifiers';
import { LEGACY_HOST_EXTERNAL_TOOLS } from '../tools/legacy-host-tool-definitions';

export const LEGACY_HOST_EXTERNAL_TOOL_NAMES = LEGACY_HOST_EXTERNAL_TOOLS.map(tool => tool.name);

const LEGACY_HOST_EXTERNAL_TOOL_SET = new Set<string>(LEGACY_HOST_EXTERNAL_TOOL_NAMES);

export function findLegacyToolDefinition(name: string): Tool | undefined {
  return LEGACY_HOST_EXTERNAL_TOOLS.find(tool => tool.name === name);
}

export function getMainAgentLegacyHostTools(
  configService: Pick<AilyChatConfigService, 'getAgentToolsConfig'>,
): Tool[] {
  let tools = LEGACY_HOST_EXTERNAL_TOOLS.filter(tool => {
    return LEGACY_HOST_EXTERNAL_TOOL_SET.has(tool.name)
      && (!tool.agents || tool.agents.some(agent => normalizeAgentIdentifier(agent) === MAIN_AGENT_TYPE));
  });

  const mainAgentConfig = configService.getAgentToolsConfig(MAIN_AGENT_TYPE);
  const enabledToolNames = mainAgentConfig?.enabledTools || [];
  const disabledToolNames = new Set(mainAgentConfig?.disabledTools || []);

  if (enabledToolNames.length > 0) {
    const enabledSet = new Set(enabledToolNames);
    tools = tools.filter(tool => enabledSet.has(tool.name) || !disabledToolNames.has(tool.name));
  } else if (disabledToolNames.size > 0) {
    tools = tools.filter(tool => !disabledToolNames.has(tool.name));
  }

  return tools;
}