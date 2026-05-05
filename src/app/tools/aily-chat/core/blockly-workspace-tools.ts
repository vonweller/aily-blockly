import type { IToolContribution } from 'aily-lex/browser';
import type { IExternalHostAPI } from 'aily-lex/host/blockly';

import { AilyHost } from './host';
import { analyzeLibraryBlocksTool } from '../tools/editBlockTool';
import { syncAbsFileHandler } from '../tools/syncAbsFileTool';
import type { EditingTimelineWriter } from '../services/editing-timeline-recording-bridge';
import { error, fromToolResult, text, type InvokeHandler } from './blockly-contributed-tool-runtime';

type DeferredFactory = (group: string, reason: string) => { group: string; reason: string };

function createLintCodeFingerprint(code: string): string {
  let hash = 2166136261;
  for (let index = 0; index < code.length; index += 1) {
    hash ^= code.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function getLintSketchFileDebugInfo(host: ReturnType<typeof AilyHost.get>): {
  sketchFilePath?: string;
  exists: boolean;
  modifiedAt?: string;
} {
  const projectPath = host.project?.currentProjectPath;
  if (!projectPath || !host.path || !host.fs) {
    return { exists: false };
  }

  try {
    const sketchFilePath = host.path.join(projectPath, '.temp', 'sketch', 'sketch.ino');
    if (!host.fs.existsSync(sketchFilePath)) {
      return { sketchFilePath, exists: false };
    }

    const stat = host.fs.statSync?.(sketchFilePath);
    return {
      sketchFilePath,
      exists: true,
      modifiedAt: stat?.mtime instanceof Date ? stat.mtime.toISOString() : undefined,
    };
  } catch {
    return { exists: false };
  }
}

function resolveLintSourceCode(host: ReturnType<typeof AilyHost.get>): string {
  const inMemoryCode = host.editor?.getGeneratedCode?.() || '';
  if (inMemoryCode.trim()) {
    return inMemoryCode;
  }

  const projectPath = host.project?.currentProjectPath;
  if (!projectPath || !host.fs || !host.path) {
    return '';
  }

  try {
    const sketchFilePath = host.path.join(projectPath, '.temp', 'sketch', 'sketch.ino');
    if (!host.fs.existsSync(sketchFilePath)) {
      return '';
    }

    const sketchCode = host.fs.readFileSync(sketchFilePath, 'utf-8');
    return typeof sketchCode === 'string' ? sketchCode : '';
  } catch {
    return '';
  }
}

export interface BlocklyWorkspaceToolOverrides {
  syncAbsHandler?: typeof syncAbsFileHandler;
}

function makeSyncAbsContribution(): IToolContribution {
  return {
    name: 'syncAbs',
    description: 'Sync ABS (Aily Block Syntax) between text file and Blockly workspace',
    prompt: `Use this tool to sync ABS code with the Blockly workspace. ABS is the text-based DSL that replaces Blockly XML manipulation.

Actions:
- "export": Export the current Blockly workspace as ABS text. Use this to read the current program.
- "import": Import ABS text into the Blockly workspace. Use this after editing the .abs file with edit_file.
- "status": Check sync status between the ABS file and workspace.

Typical workflow:
1. syncAbs action="export" → saves workspace content to .abs file
2. read_file the .abs file
3. edit_file to modify the .abs content
4. syncAbs action="import" → applies changes back to workspace`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['export', 'import', 'status'], description: 'Action to perform' },
        content: { type: 'string', description: 'ABS content to import (required for import action)' },
      },
      required: ['action'],
    },
    annotations: { readOnly: false },
  };
}

function makeLintContribution(): IToolContribution {
  return {
    name: 'lint',
    description: 'Run syntax check (lint) on the generated Arduino C++ code',
    prompt: `Use this tool to check the generated Arduino C++ code for syntax errors and warnings.
Similar to a compile check, but faster — uses ast-grep based static analysis.
Returns errors, warnings, and notes found in the code.

Use this after editing ABS blocks to verify the generated code is syntactically correct before building.`,
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnly: true },
  };
}

function makeAnalyzeLibraryContribution(createDeferred: DeferredFactory): IToolContribution {
  return {
    name: 'analyzeLibrary',
    description: 'Analyze library block definitions and generate ABS format documentation',
    prompt: 'Use this tool to inspect an installed library. mode="auto" prefers readme_ai.md references when available and falls back to block analysis only for libraries without readme_ai.md. mode="readme_ref" returns only readme_ai.md references. mode="analysis" always returns block analysis. The metadata also reports whether the library has readme_ai.md and, when available, the readme path.',
    inputSchema: {
      type: 'object',
      properties: {
        libraryId: { type: 'string', description: 'Library package ID (e.g., "lib-servo")' },
        mode: {
          type: 'string',
          enum: ['auto', 'readme_ref', 'analysis'],
          default: 'auto',
          description: 'auto prefers readme references, readme_ref returns only readme paths, analysis forces block analysis',
        },
      },
      required: ['libraryId'],
    },
    annotations: { readOnly: true },
    agentScope: ['main'],
    deferred: createDeferred('blockly-library-discovery', '库定义分析属于低频查询能力'),
  };
}

export function appendBlocklyWorkspaceContributions(
  contributions: IToolContribution[],
  hostAPI: IExternalHostAPI,
  createDeferred: DeferredFactory,
): void {
  if (hostAPI.blockly?.exportAbs) {
    contributions.push(makeSyncAbsContribution());
    contributions.push(makeLintContribution());
  }

  if (hostAPI.blockly?.analyzeBlocks) {
    contributions.push(makeAnalyzeLibraryContribution(createDeferred));
  }
}

export function createBlocklyWorkspaceHandlers(
  overrides?: BlocklyWorkspaceToolOverrides,
): Record<string, InvokeHandler> {
  const syncAbsHandler = overrides?.syncAbsHandler ?? syncAbsFileHandler;

  return {
    syncAbs: async (input, _hostAPI, invocationContext) => {
      const host = AilyHost.get();
      if (!host.absSync && !host.editor) return error('ABS editor is not available in this environment.');
      const editingTimeline = invocationContext?.host?.getExtension<EditingTimelineWriter>('editingTimeline');
      const result = await syncAbsHandler(
        { operation: input['action'] as 'export' | 'import' | 'status' },
        host.project as any,
        host.electron as any,
        host.absSync as any,
        {
          turnId: invocationContext?.trace?.turnId,
          toolCallId: invocationContext?.toolCallId,
          timelineWriter: editingTimeline,
        },
      );
      return fromToolResult(result);
    },

    lint: async (_input, _hostAPI) => {
      try {
        const globalScope = typeof window !== 'undefined'
          ? (window as any)
          : (globalThis as typeof globalThis & Record<string, unknown>);
        const arduinoLintService = globalScope['arduinoLintService'];
        if (!arduinoLintService) return error('Arduino lint service is not available.');

        const host = AilyHost.get();
        const sketchDebugInfo = getLintSketchFileDebugInfo(host);
        const inMemoryCode = host.editor?.getGeneratedCode?.() || '';
        const generatedCode = resolveLintSourceCode(host);
        const source = inMemoryCode.trim() ? 'editor-memory' : (sketchDebugInfo.exists ? 'project-sketch-file' : 'none');
        console.info('[BlocklyLintTool] lint source resolved', {
          source,
          length: generatedCode.length,
          fingerprint: createLintCodeFingerprint(generatedCode),
          inMemoryLength: inMemoryCode.length,
          inMemoryFingerprint: inMemoryCode ? createLintCodeFingerprint(inMemoryCode) : undefined,
          sketchFilePath: sketchDebugInfo.sketchFilePath,
          sketchFileExists: sketchDebugInfo.exists,
          sketchFileModifiedAt: sketchDebugInfo.modifiedAt,
        });
        if (!generatedCode.trim()) return text('No generated code to lint (workspace is empty).');

        const startTime = Date.now();
        const result = await arduinoLintService.checkSyntax(generatedCode, {
          mode: 'ast-grep',
          format: 'json',
        });
        const duration = Date.now() - startTime;

        const lintResult: Record<string, unknown> = {
          isValid: result.success && (result.errors?.length ?? 0) === 0,
          errors: result.errors || [],
          warnings: result.warnings || [],
          notes: result.notes || [],
          duration,
        };
        return text(JSON.stringify(lintResult, null, 2));
      } catch (err) {
        return error(`Lint failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    analyzeLibrary: async (input, _hostAPI) => {
      const host = AilyHost.get();
      const result = await analyzeLibraryBlocksTool(
        host.project as any,
        {
          libraryNames: [input['libraryId'] as string],
          mode: (input['mode'] as 'auto' | 'readme_ref' | 'analysis' | undefined) ?? 'auto',
        },
      );
      return fromToolResult(result);
    },
  };
}