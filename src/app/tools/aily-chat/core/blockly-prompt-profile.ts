/*---------------------------------------------------------------------------------------------
 *  Blockly Prompt Profile — host-specific prompt sections for aily-blockly.
 *
 *  This profile is defined in aily-blockly (not aily-lex) to follow the core
 *  principle: "lex is an agent runtime, not a repository for IDE domain knowledge."
 *
 *  When blockly tools/features change, only this file needs to be updated —
 *  no aily-lex release is required.
 *
 *  Usage:
 *    import { BLOCKLY_PROMPT_PROFILE } from '../core/blockly-prompt-profile';
 *
 *    const agent = new lex.AilyLexAgent({
 *      host: adapter,
 *      endpoint,
 *      model: modelConfig,
 *      promptProfile: BLOCKLY_PROMPT_PROFILE,
 *    });
 *--------------------------------------------------------------------------------------------*/

import type { IPromptProfile, IPromptSection, PromptContext } from 'aily-lex/types/prompt';
import { PromptLayer } from 'aily-lex/types/prompt';
import { SkillRegistry } from './skill-registry';
import { AilyHost } from './host';
import { getBlocklyContextSnapshotService } from './blockly-context-snapshot-service';
import { MAIN_AGENT_TYPE } from './agent-identifiers';

export const BLOCKLY_MAIN_AGENT_REQUIRED_CONTEXT = {
  scopes: ['workspaceIdentity', 'projectInfo', 'boardInfo', 'libraryIndex', 'libraryReadmeRefs', 'workspaceArtifacts'],
  strict: true,
  hydrateBeforeFirstModelCall: true,
} as const;

const BLOCKLY_MAIN_AGENT_SUMMARY_OPTIONS = {
  maxLibraries: 24,
  maxReadmeRefs: 16,
  maxLibrariesWithoutReadme: 16,
} as const;

// ---------------------------------------------------------------------------
// Identity Override — aily-blockly specific
// ---------------------------------------------------------------------------

const BLOCKLY_IDENTITY_SECTION: IPromptSection = {
  id: 'blockly-identity',
  layer: PromptLayer.Identity,
  priority: 200, // higher than built-in identity (100), appears first
  cacheable: true,
  tag: 'agentIdentity',
  getContent: () => BLOCKLY_IDENTITY_PROMPT,
};

const BLOCKLY_IDENTITY_PROMPT = `You are Aily, an intelligent and professional embedded development assistant working inside aily-coder.
aily-coder is a full-featured embedded IDE for real project files, firmware development, build/debug workflows, board-aware engineering, and hardware-oriented problem solving.
You are highly capable at embedded source editing, firmware architecture, compiler/runtime debugging, board and peripheral analysis, library usage, and hardware-aware coding decisions.`;

// ---------------------------------------------------------------------------
// Domain Knowledge — blockly/hardware specific
// ---------------------------------------------------------------------------

const BLOCKLY_DOMAIN_SECTION: IPromptSection = {
  id: 'blockly-domain',
  layer: PromptLayer.HostDomain,
  priority: 100,
  cacheable: true,
  tag: 'domain',
  getContent: () => BLOCKLY_DOMAIN_PROMPT,
};

const BLOCKLY_DOMAIN_PROMPT = `You are working inside aily-coder, an intelligent, professional, full-featured embedded IDE.

Key concepts:
- **aily-coder** works on real workspace files.
- **Main entry**: when no more specific file is known, start from \`{projectPath}/src/main.cpp\`.
- **Project files** usually live under \`src/\`, \`include/\`, \`components/\`, and other normal source folders.
- **Development boards** and installed libraries still matter: recommendations should stay compatible with the selected target, framework, and dependency set.

When helping users:
- Prefer direct code editing and file-first workflows.
- Start from the active file when possible; otherwise use \`src/main.cpp\` as the default anchor.
- Follow control flow into adjacent headers, source files, and only the configuration files that are actually needed for the task.
- Always consider the target board's pin constraints, peripheral availability, and library compatibility.
- If the user explicitly asks for wiring, pin assignment, or schematic generation, use the schematic flow instead of treating it as ordinary code editing.

Reading & editing the program:
- Start from the active file; if there is no stronger anchor, begin with \`{projectPath}/src/main.cpp\`.
- Read and edit workspace files directly; prefer the smallest relevant source file over broad workspace exploration.
- Inspect generated code, build outputs, dependency metadata, or README docs only when they help explain compiler, runtime, or integration behavior.
- Use the injected runtime summary first for project path, board, installed libraries, and readme references; only reach for additional tools when that summary is insufficient.

Tool usage efficiency:
- The environment section above already contains the project path, board, installed library list, and available readme_ai.md paths. Do NOT call any tool just to obtain this basic information.
- Do not re-fetch information you already obtained in a previous turn. Summarize key findings at the end of each response to preserve context across turns.`;

// ---------------------------------------------------------------------------
// Hardware Safety — blockly-specific safety rules
// ---------------------------------------------------------------------------

const BLOCKLY_HARDWARE_SAFETY_SECTION: IPromptSection = {
  id: 'blockly-hardware-safety',
  layer: PromptLayer.HostDomain,
  priority: 90,
  cacheable: true,
  tag: 'hardwareSafety',
  getContent: () => BLOCKLY_HARDWARE_SAFETY_PROMPT,
};

const BLOCKLY_HARDWARE_SAFETY_PROMPT = `When working with embedded hardware:
- Always confirm before flashing firmware to a connected board.
- Warn users about potential pin/peripheral conflicts (e.g., I2C/SPI/UART/PWM/ADC/GPIO overlap).
- Verify voltage, power-supply, and external-component requirements before recommending hardware changes.
- Be cautious with motor drivers, relays, high-power components, and battery circuits — incorrect code or wiring can damage hardware.
- When editing code that controls actuators, default to safe initial states (e.g., motors off, relay off, bounded PWM) unless the user asks otherwise.`;

// ---------------------------------------------------------------------------
// Skills Listing — dynamic section listing available on-demand skills
// ---------------------------------------------------------------------------

const BLOCKLY_SKILLS_LISTING_SECTION: IPromptSection = {
  id: 'blockly-skills-listing',
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

const BLOCKLY_SKILL_COMMAND_SECTION: IPromptSection = {
  id: 'blockly-skill-command',
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

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const BLOCKLY_PROMPT_PROFILE: IPromptProfile = {
  hostId: 'blockly',
  requiredContext: BLOCKLY_MAIN_AGENT_REQUIRED_CONTEXT,
  sections: [
    BLOCKLY_IDENTITY_SECTION,
    BLOCKLY_DOMAIN_SECTION,
    BLOCKLY_HARDWARE_SAFETY_SECTION,
    BLOCKLY_SKILL_COMMAND_SECTION,
    BLOCKLY_SKILLS_LISTING_SECTION,
  ],
  cacheBreakpoint: PromptLayer.HostDomain,
  getContext: async () => {
    const host = AilyHost.get();
    const contextSnapshotService = getBlocklyContextSnapshotService();
    const envExtra = [...await contextSnapshotService.getSummary({
      scopes: BLOCKLY_MAIN_AGENT_REQUIRED_CONTEXT.scopes,
      reason: 'main-agent-prompt',
      summaryOptions: BLOCKLY_MAIN_AGENT_SUMMARY_OPTIONS,
    })];
    const fileContext = collectPromptFileContext(host);

    // Shell hint — platform-specific
    const platformType = host.platform?.type || 'unknown';
    if (platformType === 'win32' || (host.platform as any)?.isWindows) {
      envExtra.push(`Shell: PowerShell — use semicolons (;) to chain commands, NOT && or ||`);
    }

    // Locale
    const config = host.config;
    if (config?.locale) {
      envExtra.push(`Locale: ${config.locale}`);
    }

    if (fileContext.activeFilePath) {
      envExtra.push(`Active file: ${fileContext.activeFilePath}`);
    }

    return {
      platform: platformType,
      sessionDate: new Date().toLocaleDateString(),
      envExtra,
      activeFilePath: fileContext.activeFilePath,
      filePaths: fileContext.filePaths,
    };
  },
};

function collectPromptFileContext(host: ReturnType<typeof AilyHost.get>): Pick<PromptContext, 'activeFilePath' | 'filePaths'> {
  const filePaths: string[] = [];
  const activeFilePath = normalizePromptFilePath(host.editor?.getCurrentFilePath?.());
  if (activeFilePath) {
    filePaths.push(activeFilePath);
  }

  const projectPath = host.project?.currentProjectPath;
  if (projectPath) {
    filePaths.push(normalizePromptFilePath(host.path.join(projectPath, 'src', 'main.cpp')));
  }

  const normalizedFilePaths = [...new Set(filePaths.filter((path): path is string => Boolean(path)))];
  return {
    activeFilePath,
    filePaths: normalizedFilePaths.length > 0 ? normalizedFilePaths : undefined,
  };
}

function normalizePromptFilePath(path: string | undefined): string | undefined {
  const normalized = path?.trim().replace(/\\/g, '/');
  return normalized ? normalized : undefined;
}
