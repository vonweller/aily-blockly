import {
  createBlocklyFileCustomizationProvider,
  type BlocklyCustomizationFileSource,
  type BlocklyDiscoveredCustomizationFile,
} from './blockly-file-customization-provider';

import type {
  BlocklyHookCustomizationContribution,
  BlocklyHookCustomizationProvider,
} from './blockly-hook-customization-provider';

export interface BlocklyClaudeHookCustomizationProviderOptions {
  readonly source: BlocklyCustomizationFileSource;
  readonly projectRootPath?: string;
}

const CLAUDE_HOOK_EVENT_IDS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'UserPromptSubmit',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'SessionStart',
  'SessionEnd',
  'Notification',
] as const;

const PROJECT_CLAUDE_SETTINGS_FILE_NAMES = new Set(['settings.json', 'settings.local.json']);
const USER_CLAUDE_SETTINGS_FILE_NAMES = new Set(['settings.json']);

type ClaudeHookConfig = {
  readonly type?: string;
  readonly command?: string;
};

type ClaudeHookMatcherConfig = {
  readonly matcher?: string;
  readonly hooks?: readonly ClaudeHookConfig[];
};

type ClaudeHookSettings = {
  readonly hooks?: Partial<Record<(typeof CLAUDE_HOOK_EVENT_IDS)[number], readonly ClaudeHookMatcherConfig[]>>;
};

export function createBlocklyClaudeHookCustomizationProvider(
  options: BlocklyClaudeHookCustomizationProviderOptions,
): BlocklyHookCustomizationProvider {
  const provider = createBlocklyFileCustomizationProvider({
    source: options.source,
    projectRootPath: options.projectRootPath,
    defaultFolders: ['.claude'],
    shouldIncludeFile: (folderPath, fileName, source) => {
      const normalizedFolderPath = folderPath.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
      if (!normalizedFolderPath.endsWith('/.claude')) {
        return false;
      }

      const normalizedFileName = fileName.trim().toLowerCase();
      return source === 'user'
        ? USER_CLAUDE_SETTINGS_FILE_NAMES.has(normalizedFileName)
        : PROJECT_CLAUDE_SETTINGS_FILE_NAMES.has(normalizedFileName);
    },
  });

  return {
    contributeHooks(): readonly BlocklyHookCustomizationContribution[] {
      return provider.contributeFiles().flatMap((file) => parseClaudeHookCustomizationFile(file, options.source));
    },
    onHooksChanged(listener: () => void) {
      return provider.onFilesChanged?.(listener);
    },
  };
}

function parseClaudeHookCustomizationFile(
  file: BlocklyDiscoveredCustomizationFile,
  source: BlocklyCustomizationFileSource,
): readonly BlocklyHookCustomizationContribution[] {
  try {
    const parsed = JSON.parse(file.content) as ClaudeHookSettings;
    if (!parsed.hooks || typeof parsed.hooks !== 'object') {
      return [];
    }

    const contributions: BlocklyHookCustomizationContribution[] = [];
    for (const eventId of CLAUDE_HOOK_EVENT_IDS) {
      const matchers = parsed.hooks[eventId];
      if (!Array.isArray(matchers) || matchers.length === 0) {
        continue;
      }

      for (const matcher of matchers) {
        if (!matcher || !Array.isArray(matcher.hooks) || matcher.hooks.length === 0) {
          continue;
        }

        const matcherName = typeof matcher.matcher === 'string' ? matcher.matcher.trim() : '';
        const matcherLabel = matcherName && matcherName !== '*' ? ` (${matcherName})` : '';

        for (const hook of matcher.hooks) {
          const command = typeof hook?.command === 'string' ? hook.command.trim() : '';
          if (!command) {
            continue;
          }

          contributions.push({
            uri: file.uri,
            name: `${eventId}${matcherLabel}`,
            description: command,
            source,
          });
        }
      }
    }

    return contributions;
  } catch {
    return [];
  }
}