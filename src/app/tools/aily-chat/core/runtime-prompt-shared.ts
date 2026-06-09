import type { IPromptSection, PromptContext } from 'aily-lex/types/prompt';
import { PromptLayer } from 'aily-lex/types/prompt';
import { MAIN_AGENT_TYPE } from './agent-identifiers';
import { AilyHost } from './host';
import { SkillRegistry } from './skill-registry';

export type PromptHost = ReturnType<typeof AilyHost.get>;

export function createHardwareSafetySection(
  id: string,
  content: string,
): IPromptSection {
  return {
    id,
    layer: PromptLayer.HostDomain,
    priority: 90,
    cacheable: true,
    tag: 'hardwareSafety',
    getContent: () => content,
  };
}

export function createSkillsListingSection(id: string): IPromptSection {
  return {
    id,
    layer: PromptLayer.SessionContext,
    priority: 50,
    cacheable: false,
    getContent: (ctx) => {
      const toolAwareCtx = ctx as PromptContext & { availableToolNames?: ReadonlySet<string> };
      const listing = SkillRegistry.getSkillsListing(MAIN_AGENT_TYPE, {
        availableToolNames: toolAwareCtx.availableToolNames,
      });
      return listing || '';
    },
  };
}

export function createSkillCommandSection(id: string): IPromptSection {
  return {
    id,
    layer: PromptLayer.ToolInstructions,
    priority: 55,
    cacheable: false,
    getContent: (ctx) => {
      const commandName = ctx.command?.name?.trim();
      if (!commandName) {
        return '';
      }

      const skillContext = SkillRegistry.getSkillContext(commandName);
      if (!skillContext || skillContext.userInvocable === false) {
        return '';
      }

      return [
        `The current request explicitly selected the /${skillContext.name} skill command.`,
        skillContext.mode === 'fork'
          ? `Call load_skill with action=\"load\", name=\"${skillContext.name}\", and task set to the current user request so the skill runs as a forked subagent.`
          : `Call load_skill with action=\"load\" and name=\"${skillContext.name}\" before continuing so the skill context is loaded for this turn.`,
        `Skill file: ${skillContext.skillMdPath}`,
      ].join('\n');
    },
  };
}

export function collectRuntimePromptFileContext(
  host: PromptHost,
  defaultProjectPaths: readonly string[],
): Pick<PromptContext, 'activeFilePath' | 'filePaths'> {
  const filePaths: string[] = [];
  const activeFilePath = normalizePromptFilePath(host.editor?.getCurrentFilePath?.());
  if (activeFilePath) {
    filePaths.push(activeFilePath);
  }

  const projectPath = host.project?.currentProjectPath;
  if (projectPath) {
    for (const relativePath of defaultProjectPaths) {
      filePaths.push(normalizePromptFilePath(host.path.join(projectPath, ...relativePath.split('/'))));
    }
  }

  const normalizedFilePaths = [...new Set(filePaths.filter((path): path is string => Boolean(path)))];
  return {
    activeFilePath,
    filePaths: normalizedFilePaths.length > 0 ? normalizedFilePaths : undefined,
  };
}

export function appendStandardPromptEnv(
  envExtra: string[],
  host: PromptHost,
  fileContext: Pick<PromptContext, 'activeFilePath'>,
): string {
  const platformType = host.platform?.type || 'unknown';
  if (platformType === 'win32' || (host.platform as any)?.isWindows) {
    envExtra.push('Shell: PowerShell - use semicolons (;) to chain commands, NOT && or ||');
  }

  const locale = host.config?.locale;
  if (locale) {
    envExtra.push(`Locale: ${locale}`);
  }

  if (fileContext.activeFilePath) {
    envExtra.push(`Active file: ${fileContext.activeFilePath}`);
  }

  return platformType;
}

export function normalizePromptFilePath(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().replace(/\\/g, '/')
    : undefined;
}
