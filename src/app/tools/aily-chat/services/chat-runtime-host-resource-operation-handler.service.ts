import { Injectable, OnDestroy } from '@angular/core';

import type {
  ChatRuntimeHostResourceOperationPayload,
  ChatRuntimeHostResourceOperationRequest,
  ChatRuntimeHostSyncAbsPayload,
} from '../core/chat-runtime-host-contract';
import {
  registerElectronChatRuntimeResourceOperationHandler,
  type ElectronChatRuntimeResourceOperationHandlerRegistration,
} from '../core/electron-chat-runtime-host-transport';
import { ElectronService } from '../../../services/electron.service';
import { ProjectService } from '../../../services/project.service';
import {
  runSyncAbsFileConcreteHandler,
  type SyncAbsArgs,
} from '../tools/syncAbsFileTool';
import { AbsAutoSyncService } from './abs-auto-sync.service';
import { ChatHistoryService, type LiveHostSessionRecord } from './chat-history.service';
import { EditCheckpointService } from './edit-checkpoint.service';

type HostResourceOperationPayload = {
  readonly adapter?: unknown;
  readonly action?: unknown;
  readonly record?: unknown;
  readonly hostRecord?: unknown;
  readonly liveHostSessionRecord?: unknown;
  readonly projectPath?: unknown;
  readonly args?: unknown;
};

class HostResourceOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

@Injectable()
export class ChatRuntimeHostResourceOperationHandlerService implements OnDestroy {
  private registration: ElectronChatRuntimeResourceOperationHandlerRegistration | null = null;
  private registrationPromise: Promise<void> | null = null;

  constructor(
    private readonly chatHistoryService: ChatHistoryService,
    private readonly absAutoSyncService: AbsAutoSyncService,
    private readonly editCheckpointService: EditCheckpointService,
    private readonly projectService: ProjectService,
    private readonly electronService: ElectronService,
  ) {}

  start(): Promise<void> {
    if (this.registration) {
      return Promise.resolve();
    }
    if (this.registrationPromise) {
      return this.registrationPromise;
    }

    this.registrationPromise = registerElectronChatRuntimeResourceOperationHandler(request =>
      this.handleResourceOperation(request),
    )
      .then(registration => {
        this.registration = registration;
      })
      .finally(() => {
        this.registrationPromise = null;
      });

    return this.registrationPromise;
  }

  ngOnDestroy(): void {
    const registration = this.registration;
    this.registration = null;
    this.registrationPromise = null;
    if (registration) {
      void registration.dispose();
    }
  }

  private handleResourceOperation(request: ChatRuntimeHostResourceOperationRequest): unknown {
    switch (request.kind) {
      case 'abs-session-start-export':
        return this.scheduleSessionStartAbsExport(request);
      case 'checkpoint-commit':
        return this.commitWorkspaceCheckpoint(request);
      case 'checkpoint-settle':
        return this.waitForWorkspaceCheckpointMetadata(request);
      case 'file-read':
      case 'file-write':
      case 'workspace-mutation':
        return this.runSyncAbsResourceOperation(request);
      case 'save-current-session':
      case 'history-persistence':
        return this.persistHostSessionRecord(request);
      default:
        throw new HostResourceOperationError(
          `[AilyChat][RuntimeHost] Unsupported host resource operation: ${request.kind}.`,
          'resource_operation_unsupported',
          false,
        );
    }
  }

  private scheduleSessionStartAbsExport(request: ChatRuntimeHostResourceOperationRequest): {
    readonly scheduled: true;
    readonly sessionId: string;
    readonly kind: ChatRuntimeHostResourceOperationRequest['kind'];
    readonly projectPath: string | null;
  } {
    const sessionId = this.requireSessionId(request, 'ABS session-start export');
    this.requireAbsSessionStartExportPayload(request.payload);
    const projectPath = this.readProjectPath(request.payload) || this.normalizeSessionId(request.resource?.['projectPath']);
    if (projectPath) {
      this.absAutoSyncService.initialize(projectPath);
    }
    this.absAutoSyncService.scheduleSessionStartExport();
    return {
      scheduled: true,
      sessionId,
      kind: request.kind,
      projectPath: projectPath || null,
    };
  }

  private async commitWorkspaceCheckpoint(request: ChatRuntimeHostResourceOperationRequest): Promise<{
    readonly committed: boolean;
    readonly skipped: boolean;
    readonly sessionId: string;
    readonly kind: ChatRuntimeHostResourceOperationRequest['kind'];
  }> {
    const sessionId = this.requireSessionId(request, 'checkpoint commit');
    this.requireEditCheckpointPayload(request.payload, 'commitCurrentTurn', 'checkpoint commit');
    if (this.editCheckpointService.getTotalEditCount() === 0) {
      await this.editCheckpointService.waitForCheckpointMetadataSettled();
      return {
        committed: false,
        skipped: true,
        sessionId,
        kind: request.kind,
      };
    }

    await this.editCheckpointService.commitCurrentTurn();
    return {
      committed: true,
      skipped: false,
      sessionId,
      kind: request.kind,
    };
  }

  private async waitForWorkspaceCheckpointMetadata(request: ChatRuntimeHostResourceOperationRequest): Promise<{
    readonly settled: true;
    readonly sessionId: string;
    readonly kind: ChatRuntimeHostResourceOperationRequest['kind'];
  }> {
    const sessionId = this.requireSessionId(request, 'checkpoint settle');
    this.requireEditCheckpointPayload(request.payload, 'settleMetadata', 'checkpoint settle');
    await this.editCheckpointService.waitForCheckpointMetadataSettled();
    return {
      settled: true,
      sessionId,
      kind: request.kind,
    };
  }

  private async runSyncAbsResourceOperation(request: ChatRuntimeHostResourceOperationRequest) {
    this.requireSessionId(request, 'syncAbs resource operation');
    const args = this.readSyncAbsArgs(request);
    this.assertSyncAbsKindMatchesRequest(request, args.operation);
    const result = await runSyncAbsFileConcreteHandler(
      args,
      this.projectService,
      this.electronService,
      this.absAutoSyncService,
      {
        sessionId: request.sessionId,
      },
    );
    if (result.is_error) {
      throw new HostResourceOperationError(
        result.content || '[AilyChat][RuntimeHost] syncAbs resource operation failed.',
        'syncabs_operation_failed',
        false,
      );
    }
    return result;
  }

  private persistHostSessionRecord(request: ChatRuntimeHostResourceOperationRequest): {
    readonly saved: true;
    readonly sessionId: string;
    readonly kind: ChatRuntimeHostResourceOperationRequest['kind'];
    readonly metadataOnly?: true;
  } {
    const record = this.readLiveHostSessionRecord(request.payload);
    const sessionId = this.normalizeSessionId(record?.sessionId || request.sessionId);
    if (!record || !sessionId) {
      throw new HostResourceOperationError(
        `[AilyChat][RuntimeHost] ${request.kind} requires a live host session record payload.`,
        'resource_operation_payload_missing',
        false,
      );
    }

    const normalizedRecord = {
      ...record,
      sessionId,
      metadata: {
        ...record.metadata,
        sessionId,
      },
    };

    if (request.kind === 'history-persistence') {
      this.chatHistoryService.saveHostRecordMetadataOnly(normalizedRecord);
      return {
        saved: true,
        sessionId,
        kind: request.kind,
        metadataOnly: true,
      };
    }

    this.chatHistoryService.saveHostRecord(normalizedRecord);

    return {
      saved: true,
      sessionId,
      kind: request.kind,
    };
  }

  private readLiveHostSessionRecord(payload: unknown): LiveHostSessionRecord | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const payloadObject = payload as HostResourceOperationPayload;
    if (payloadObject.adapter !== 'chatHistory') {
      return null;
    }
    const candidate = payloadObject.record ?? payloadObject.hostRecord ?? payloadObject.liveHostSessionRecord;
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const record = candidate as Partial<LiveHostSessionRecord>;
    const sessionId = this.normalizeSessionId(record.sessionId);
    const metadataSessionId = this.normalizeSessionId(record.metadata?.sessionId);
    if (!sessionId && !metadataSessionId) {
      return null;
    }

    return {
      ...(record as LiveHostSessionRecord),
      sessionId: sessionId || metadataSessionId,
      metadata: {
        ...record.metadata,
        sessionId: sessionId || metadataSessionId,
      },
    };
  }

  private normalizeSessionId(sessionId: unknown): string {
    return typeof sessionId === 'string' ? sessionId.trim() : '';
  }

  private readProjectPath(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
      return '';
    }
    return this.normalizeSessionId((payload as HostResourceOperationPayload).projectPath);
  }

  private requireAbsSessionStartExportPayload(payload: ChatRuntimeHostResourceOperationPayload | undefined): void {
    if (!payload || typeof payload !== 'object') {
      throw new HostResourceOperationError(
        '[AilyChat][RuntimeHost] ABS session-start export requires a typed payload.',
        'resource_operation_payload_missing',
        false,
      );
    }
    const payloadObject = payload as HostResourceOperationPayload;
    if (payloadObject.adapter !== 'absAutoSync' || payloadObject.action !== 'scheduleSessionStartExport') {
      throw new HostResourceOperationError(
        '[AilyChat][RuntimeHost] ABS session-start export payload must use absAutoSync.scheduleSessionStartExport.',
        'resource_operation_payload_invalid',
        false,
      );
    }
  }

  private requireEditCheckpointPayload(
    payload: ChatRuntimeHostResourceOperationPayload | undefined,
    action: 'commitCurrentTurn' | 'settleMetadata',
    operation: string,
  ): void {
    if (!payload || typeof payload !== 'object') {
      throw new HostResourceOperationError(
        `[AilyChat][RuntimeHost] ${operation} requires a typed payload.`,
        'resource_operation_payload_missing',
        false,
      );
    }
    const payloadObject = payload as HostResourceOperationPayload;
    if (payloadObject.adapter !== 'editCheckpoint' || payloadObject.action !== action) {
      throw new HostResourceOperationError(
        `[AilyChat][RuntimeHost] ${operation} payload must use editCheckpoint.${action}.`,
        'resource_operation_payload_invalid',
        false,
      );
    }
  }

  private readSyncAbsArgs(request: ChatRuntimeHostResourceOperationRequest): SyncAbsArgs {
    const payload = request.payload;
    if (!payload || typeof payload !== 'object') {
      throw new HostResourceOperationError(
        '[AilyChat][RuntimeHost] syncAbs resource operation requires a payload.',
        'resource_operation_payload_missing',
        false,
      );
    }
    const payloadObject = payload as ChatRuntimeHostSyncAbsPayload;
    if (payloadObject.adapter !== 'syncAbs') {
      throw new HostResourceOperationError(
        '[AilyChat][RuntimeHost] File/workspace resource operation payload is not syncAbs.',
        'resource_operation_unsupported',
        false,
      );
    }
    const args = payloadObject.args;
    if (!args || typeof args !== 'object') {
      throw new HostResourceOperationError(
        '[AilyChat][RuntimeHost] syncAbs resource operation requires args.',
        'resource_operation_payload_missing',
        false,
      );
    }
    const argsObject = args as Partial<SyncAbsArgs>;
    if (argsObject.operation !== 'export'
      && argsObject.operation !== 'import'
      && argsObject.operation !== 'status') {
      throw new HostResourceOperationError(
        '[AilyChat][RuntimeHost] syncAbs resource operation has an unsupported action.',
        'resource_operation_payload_invalid',
        false,
      );
    }
    return {
      operation: argsObject.operation,
      ...(typeof argsObject.includeHeader === 'boolean' ? { includeHeader: argsObject.includeHeader } : {}),
      ...(typeof argsObject.pendingAbsContent === 'string' ? { pendingAbsContent: argsObject.pendingAbsContent } : {}),
    };
  }

  private assertSyncAbsKindMatchesRequest(
    request: ChatRuntimeHostResourceOperationRequest,
    operation: SyncAbsArgs['operation'],
  ): void {
    const expectedKind = operation === 'import'
      ? 'workspace-mutation'
      : operation === 'export'
        ? 'file-write'
        : 'file-read';
    if (request.kind !== expectedKind) {
      throw new HostResourceOperationError(
        `[AilyChat][RuntimeHost] syncAbs ${operation} must use ${expectedKind}, got ${request.kind}.`,
        'resource_operation_kind_mismatch',
        false,
      );
    }
  }

  private requireSessionId(request: ChatRuntimeHostResourceOperationRequest, operation: string): string {
    const sessionId = this.normalizeSessionId(request.sessionId);
    if (!sessionId) {
      throw new HostResourceOperationError(
        `[AilyChat][RuntimeHost] ${operation} requires a host session id.`,
        'resource_operation_session_missing',
        false,
      );
    }
    return sessionId;
  }
}
