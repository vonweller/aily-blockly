import {
  SCHEMATIC_AGENT_DISALLOWED_PROMPT_PATTERNS,
  SCHEMATIC_AGENT_MAX_TURNS,
  SCHEMATIC_AGENT_MESSAGE_INHERITANCE,
  SCHEMATIC_AGENT_MODEL,
  SCHEMATIC_AGENT_NAME,
  SCHEMATIC_AGENT_TOOLS,
  SCHEMATIC_AGENT_TYPE,
  SCHEMATIC_AGENT_WHEN_NOT_TO_USE,
  SCHEMATIC_AGENT_WHEN_TO_USE,
  SCHEMATIC_PROMPT_BODY,
} from '../core/blockly-agent-provider';

function indentFoldedYaml(value: string): string {
  return value
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n');
}

function buildSchematicAgentMarkdown(): string {
  const toolsYaml = SCHEMATIC_AGENT_TOOLS.map(tool => `  - ${tool}`).join('\n');
  const disallowedPromptPatternsYaml = SCHEMATIC_AGENT_DISALLOWED_PROMPT_PATTERNS.map(pattern => `  - ${pattern}`).join('\n');
  return `---
agentType: ${SCHEMATIC_AGENT_TYPE}
name: ${SCHEMATIC_AGENT_NAME}
whenToUse: >
${indentFoldedYaml(SCHEMATIC_AGENT_WHEN_TO_USE)}
whenNotToUse: >
${indentFoldedYaml(SCHEMATIC_AGENT_WHEN_NOT_TO_USE)}
tools:
${toolsYaml}
disallowedPromptPatterns:
${disallowedPromptPatternsYaml}
messageInheritance: ${SCHEMATIC_AGENT_MESSAGE_INHERITANCE}
model: ${SCHEMATIC_AGENT_MODEL}
maxTurns: ${SCHEMATIC_AGENT_MAX_TURNS}
---

${SCHEMATIC_PROMPT_BODY}
`;
}

const BUNDLED_LEX_AGENT_FILES = [
  {
    name: 'schematic.agent.md',
    content: buildSchematicAgentMarkdown(),
  },
] as const;

export function getBundledLexAgentFiles(): readonly { name: string; content: string }[] {
  return BUNDLED_LEX_AGENT_FILES;
}