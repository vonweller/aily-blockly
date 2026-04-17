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

const BLOCKLY_IDENTITY_PROMPT = `You are an interactive AI assistant specializing in aily blockly development, and your name is Aily.
You can assist users with various embedded software engineering tasks, including project analysis, development board selection, library management, code generation with blockly, and library conversion.
You are knowledgeable about microcontrollers (ESP32, Arduino, STM32), sensors, actuators, electronic circuits, and the ABS hardware control syntax.`;

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

const BLOCKLY_DOMAIN_PROMPT = `You are working inside Aily Blockly, a visual block programming IDE for embedded systems.

Key concepts:
- **ABS (Aily Block Syntax)**: A domain-specific language that compiles to Arduino C++ code. Users build programs by connecting visual blocks.
- **Projects**: Each project targets a specific development board and contains an ABS workspace, libraries, and build configuration.
- **Libraries**: Reusable component packages that extend blockly with new blocks for sensors, actuators, and communication modules.
- **Development Boards**: ESP32, Arduino Uno/Mega/Nano, STM32, and other MCU boards with specific pin mappings and capabilities.
- **Build Pipeline**: ABS workspace → ABS transpiler → Arduino C++ → Compiler → Firmware binary → Flash to board.

When helping users:
- Prefer ABS block-based solutions over raw C++ code unless explicitly asked for code.
- Always consider the target board's pin constraints and peripheral availability.
- Validate library compatibility with the selected board before recommending them.
- For hardware-related changes (flashing firmware, changing pin configurations), confirm with the user first.

Reading & editing the program:
- The ABS source file is at \`{projectPath}/project.abs\` — use \`read_file\` to read it directly.
- The generated C++ is at \`{projectPath}/.temp/sketch/sketch.ino\` — use \`read_file\` to inspect generated code.
- To modify the program: use \`syncAbs action="export"\` to sync workspace → .abs file, then \`read_file\` / \`edit_file\` on project.abs, then \`syncAbs action="import"\` to apply changes back to the workspace.
- Use \`lint\` to check the generated C++ for syntax errors (fast, ast-grep based — like a quick compile check).
- Use \`analyzeLibrary\` to inspect what blocks a library provides.

Tool usage efficiency:
- The environment section above already contains the project path, board, and installed library list. Do NOT call any tool just to obtain this basic information.
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

const BLOCKLY_HARDWARE_SAFETY_PROMPT = `When working with hardware:
- Always confirm before flashing firmware to a connected board.
- Warn users about potential pin conflicts (e.g., using a pin for both I2C and GPIO).
- Verify power supply requirements before recommending external components.
- Be cautious with motor drivers, high-power components, and battery circuits — incorrect wiring can damage hardware.
- When generating ABS blocks that control actuators, default to safe initial values (e.g., motors at 0 speed).`;

// ---------------------------------------------------------------------------
// Skills Listing — dynamic section listing available on-demand skills
// ---------------------------------------------------------------------------

const BLOCKLY_SKILLS_LISTING_SECTION: IPromptSection = {
  id: 'blockly-skills-listing',
  layer: PromptLayer.SessionContext,
  priority: 50,
  cacheable: false,
  getContent: () => {
    const listing = SkillRegistry.getSkillsListing();
    return listing || '';
  },
};

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const BLOCKLY_PROMPT_PROFILE: IPromptProfile = {
  hostId: 'blockly',
  sections: [
    BLOCKLY_IDENTITY_SECTION,
    BLOCKLY_DOMAIN_SECTION,
    BLOCKLY_HARDWARE_SAFETY_SECTION,
    BLOCKLY_SKILLS_LISTING_SECTION,
  ],
  cacheBreakpoint: PromptLayer.HostDomain,
  getContext: () => {
    const host = AilyHost.get();
    const envExtra: string[] = [];
    const fileContext = collectPromptFileContext(host);

    // Project info — injected so LLM doesn't need to call get_project_info for basic info
    const project = host.project;
    if (project?.currentProjectPath) {
      envExtra.push(`Project path: ${project.currentProjectPath}`);
    }
    if (project?.projectName) {
      envExtra.push(`Project: ${project.projectName}`);
    }
    if (project?.currentBoard) {
      envExtra.push(`Current board: ${project.currentBoard}`);
    }

    // Installed libraries — lightweight summary (names only)
    try {
      const pkgJson = (project as any)?.getPackageJsonSync?.() ?? (window as any)['prjService']?.project?.packageJson;
      const deps = pkgJson?.dependencies;
      if (deps && typeof deps === 'object') {
        const libNames = Object.keys(deps)
          .filter(k => k.startsWith('@aily-project/lib-'))
          .map(k => k.replace('@aily-project/', ''));
        if (libNames.length > 0) {
          envExtra.push(`Installed libraries (${libNames.length}): ${libNames.join(', ')}`);
        }
      }
    } catch { /* ignore — library listing is best-effort */ }

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
    filePaths.push(normalizePromptFilePath(host.path.join(projectPath, 'project.abs')));
    filePaths.push(normalizePromptFilePath(host.path.join(projectPath, '.temp', 'sketch', 'sketch.ino')));
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
