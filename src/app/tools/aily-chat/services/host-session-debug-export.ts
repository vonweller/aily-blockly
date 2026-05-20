import { readTurnRequestDebugArtifactsSnapshot } from 'aily-lex/browser';

import type { HostSessionRecord, SessionIndexEntry } from './chat-history.service';
import { buildHostSessionDebugEvents, type HostSessionDebugEvent } from './host-session-debug-events';

export interface HostSessionDebugExportEnvelope {
  readonly kind: 'aily-chat-debug-export';
  readonly version: 1;
  readonly exportedAt: string;
  readonly source: {
    readonly owner: 'chat-history-service';
    readonly storage: 'host-session-record';
  };
  readonly session: {
    readonly sessionId: string;
    readonly title: string;
    readonly projectPath: string | null;
    readonly projectName: string | null;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly mode: string;
    readonly model: string | null;
    readonly messageCount: number;
  };
  readonly hostRecord: HostSessionRecord;
  readonly debug: {
    readonly eventSource: 'derived-host-record';
    readonly events: readonly HostSessionDebugEvent[];
    readonly companionFiles?: Readonly<Record<string, string>>;
  };
}

export function encodeHostSessionDebugExport(
  record: HostSessionRecord,
  entry?: SessionIndexEntry,
  exportedAt = new Date(),
): Uint8Array {
  const envelope = buildHostSessionDebugExportEnvelope(record, entry, exportedAt);
  return new TextEncoder().encode(JSON.stringify(envelope, null, 2));
}

export function decodeHostSessionDebugExport(data: Uint8Array): HostSessionDebugExportEnvelope | null {
  if (!(data instanceof Uint8Array) || data.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as Partial<HostSessionDebugExportEnvelope>;
    if (parsed?.kind !== 'aily-chat-debug-export' || parsed?.version !== 1) {
      return null;
    }
    if (!parsed.hostRecord?.metadata?.sessionId || !parsed.session?.sessionId) {
      return null;
    }
    const cloned = cloneJsonValue(parsed) as HostSessionDebugExportEnvelope;
    return {
      ...cloned,
      debug: {
        eventSource: 'derived-host-record',
        events: Array.isArray(cloned.debug?.events)
          ? cloned.debug.events.map(event => ({ ...event }))
          : buildHostSessionDebugEvents(cloned.hostRecord),
        ...(cloned.debug?.companionFiles && typeof cloned.debug.companionFiles === 'object'
          ? { companionFiles: { ...cloned.debug.companionFiles } }
          : {}),
      },
    };
  } catch {
    return null;
  }
}

function buildHostSessionDebugExportEnvelope(
  record: HostSessionRecord,
  entry: SessionIndexEntry | undefined,
  exportedAt: Date,
): HostSessionDebugExportEnvelope {
  const hostRecord = cloneJsonValue(record);
  const metadata = hostRecord.metadata;
  const companionBundle = buildHostSessionDebugCompanionBundle(hostRecord);
  const debugEvents = attachCompanionFileRefsToDebugEvents(
    buildHostSessionDebugEvents(hostRecord),
    companionBundle.refsByTurnId,
  );

  return {
    kind: 'aily-chat-debug-export',
    version: 1,
    exportedAt: exportedAt.toISOString(),
    source: {
      owner: 'chat-history-service',
      storage: 'host-session-record',
    },
    session: {
      sessionId: metadata.sessionId,
      title: metadata.title || entry?.title || '',
      projectPath: metadata.projectPath ?? entry?.projectPath ?? null,
      projectName: entry?.projectName ?? null,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      mode: metadata.mode,
      model: metadata.model ?? null,
      messageCount: entry?.messageCount ?? countRecordMessages(hostRecord),
    },
    hostRecord,
    debug: {
      eventSource: 'derived-host-record',
      events: debugEvents,
      ...(Object.keys(companionBundle.companionFiles).length > 0
        ? { companionFiles: companionBundle.companionFiles }
        : {}),
    },
  };
}

function attachCompanionFileRefsToDebugEvents(
  events: readonly HostSessionDebugEvent[],
  refsByTurnId: ReadonlyMap<string, { readonly systemPromptFile?: string; readonly toolsFile?: string }>,
): HostSessionDebugEvent[] {
  return events.map(event => {
    if (event.kind !== 'modelTurn') {
      return event;
    }

    const refs = refsByTurnId.get(event.turnId);
    if (!refs?.systemPromptFile && !refs?.toolsFile) {
      return event;
    }

    return {
      ...event,
      ...(refs.systemPromptFile ? { systemPromptFile: refs.systemPromptFile } : {}),
      ...(refs.toolsFile ? { toolsFile: refs.toolsFile } : {}),
    };
  });
}

function buildHostSessionDebugCompanionBundle(
  record: HostSessionRecord,
): {
  readonly companionFiles: Record<string, string>;
  readonly refsByTurnId: ReadonlyMap<string, { readonly systemPromptFile?: string; readonly toolsFile?: string }>;
} {
  const companionFiles: Record<string, string> = {};
  const refsByTurnId = new Map<string, { readonly systemPromptFile?: string; readonly toolsFile?: string }>();
  let currentSystemContent: string | undefined;
  let currentSystemPromptFile: string | undefined;
  let currentToolsContent: string | undefined;
  let currentToolsFile: string | undefined;
  let systemPromptIndex = 0;
  let toolsIndex = 0;

  for (const turn of record.turnResponses ?? []) {
    const artifacts = readTurnRequestDebugArtifactsSnapshot(turn.request?.metadata);
    const systemArtifactContent = artifacts?.find(artifact => artifact.kind === 'system')?.content;
    const toolsArtifactContent = artifacts?.find(artifact => artifact.kind === 'tools')?.content;
    const systemContent = typeof systemArtifactContent === 'string' && systemArtifactContent.length > 0
      ? systemArtifactContent
      : undefined;
    const toolsContent = typeof toolsArtifactContent === 'string' && toolsArtifactContent.length > 0
      ? toolsArtifactContent
      : undefined;
    const refs: { systemPromptFile?: string; toolsFile?: string } = {};

    if (systemContent) {
      if (systemContent !== currentSystemContent || !currentSystemPromptFile) {
        currentSystemContent = systemContent;
        currentSystemPromptFile = `system_prompt_${systemPromptIndex}.json`;
        systemPromptIndex += 1;
        companionFiles[currentSystemPromptFile] = systemContent;
      }
      refs.systemPromptFile = currentSystemPromptFile;
    } else {
      currentSystemContent = undefined;
      currentSystemPromptFile = undefined;
    }

    if (toolsContent) {
      if (toolsContent !== currentToolsContent || !currentToolsFile) {
        currentToolsContent = toolsContent;
        currentToolsFile = `tools_${toolsIndex}.json`;
        toolsIndex += 1;
        companionFiles[currentToolsFile] = toolsContent;
      }
      refs.toolsFile = currentToolsFile;
    } else {
      currentToolsContent = undefined;
      currentToolsFile = undefined;
    }

    if (refs.systemPromptFile || refs.toolsFile) {
      refsByTurnId.set(turn.turnId, refs);
    }
  }

  return {
    companionFiles,
    refsByTurnId,
  };
}

function countRecordMessages(record: HostSessionRecord): number {
  return record.turnResponses?.length ? record.turnResponses.length * 2 : 0;
}

function cloneJsonValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => cloneJsonValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [key, cloneJsonValue(entryValue)]),
    ) as T;
  }

  return value;
}