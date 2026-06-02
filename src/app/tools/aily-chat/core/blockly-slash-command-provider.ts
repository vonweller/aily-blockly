import type { IHostSlashCommandProvider, ISlashCommandContribution } from 'aily-lex/browser';
import { SkillRegistry } from './skill-registry';

const BLOCKLY_SLASH_COMMANDS: readonly ISlashCommandContribution[] = [
  {
    name: 'fix',
    description: 'Ask the main agent to diagnose a problem and propose or apply a fix.',
    sampleRequest: '/fix explain why this test is failing',
    when: 'Use for debugging, remediation, and follow-up fix requests.',
  },
  {
    name: 'explain',
    description: 'Ask for an explanation of code, behavior, or implementation details.',
    sampleRequest: '/explain how request routing is resolved',
    when: 'Use when the goal is understanding rather than changing code.',
  },
  {
    name: 'search',
    description: 'Search the current workspace for relevant code, files, or nearby implementation context.',
    sampleRequest: '/search find where slash command metadata is produced',
    when: 'Use for project-wide discovery before deeper reading or editing.',
  },
  {
    name: 'edit',
    description: 'Ask the main agent to make a targeted code change in the current workspace.',
    sampleRequest: '/edit rename this helper to match the new contract',
    when: 'Use when the request is an explicit code modification task.',
  },
];

export function createBlocklySlashCommandProvider(): IHostSlashCommandProvider {
  return {
    contributeSlashCommands(): ISlashCommandContribution[] {
      const skillCommands = SkillRegistry.getAll()
        .filter(skill => skill.origin?.type !== 'url' && skill.metadata.userInvocable !== false)
        .map<ISlashCommandContribution>(skill => ({
          name: skill.metadata.name,
          description: skill.metadata.description || `Invoke the ${skill.metadata.displayName || skill.metadata.name} skill.`,
          sampleRequest: `/${skill.metadata.name} ${skill.metadata.context === 'fork' ? 'run this skill for the current task' : 'apply this skill to the current task'}`,
          when: skill.metadata.context === 'fork'
            ? `Use to run the ${skill.metadata.displayName || skill.metadata.name} skill as a forked subagent for the current task.`
            : `Use to load the ${skill.metadata.displayName || skill.metadata.name} skill before handling the current task.`,
        }));

      return [...BLOCKLY_SLASH_COMMANDS, ...skillCommands];
    },
    onSlashCommandsChanged(listener) {
      return SkillRegistry.onDidChange(listener);
    },
  };
}