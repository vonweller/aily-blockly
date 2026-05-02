import { EditingContentStore } from './editing-content-store.service';
import { EditingTimelineRepository } from './editing-timeline-repository.service';
import type {
  EditingSessionTimelineState,
  NormalizedTextEdit,
  TimelineFileOperation,
  TimelineRequestScope,
} from './editing-timeline.types';

export interface EditingTimelineFileWriteEvent {
  turnId?: string;
  toolCallId?: string;
  filePath: string;
  existedBefore: boolean;
  contentKind?: 'text' | 'binary' | 'notebook';
  beforeContent?: string | null;
  afterContent?: string | null;
  beforeBytes?: Uint8Array | null;
  afterBytes?: Uint8Array;
  edits?: NormalizedTextEdit[];
}

export interface EditingTimelineWriter {
  recordFileWrite(event: EditingTimelineFileWriteEvent): Promise<void> | void;
}

export interface EditingTimelineWorktreeReconcileInput {
  turnId: string;
  filePaths: readonly string[];
  readCurrentText: (filePath: string) => Promise<string | null>;
  computeEdits?: (beforeContent: string, afterContent: string) => Promise<NormalizedTextEdit[] | undefined>;
}

export class EditingTimelineRecordingBridge {
  constructor(
    private readonly repository: EditingTimelineRepository,
    private readonly contentStore: EditingContentStore,
    private readonly workspaceRoot: string,
    private readonly sessionId: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  recordFileWrite(event: EditingTimelineFileWriteEvent): void {
    if (!event.turnId) {
      return;
    }

    const requestId = event.turnId;
    const state = this.repository.load(this.sessionId, this.workspaceRoot)
      ?? this.repository.createEmptyState(this.sessionId, this.workspaceRoot);
    const contentKind = event.contentKind ?? 'text';

    const scope = this.ensureRequestScope(state, requestId, event.turnId);
    const baseline = this.ensureBaseline(state, requestId, event.filePath, event.existedBefore, contentKind, event.beforeContent, event.beforeBytes);
    const nextEpoch = state.epochCounter + 1;
    const operation = this.createWriteOperation(nextEpoch, requestId, event, baseline.contentKind, event.toolCallId);

    state.operations.push(operation);
    scope.lastEpoch = nextEpoch;
    scope.completedAt = this.now();
    scope.status = 'completed';
    if (!scope.touchedUris.includes(event.filePath)) {
      scope.touchedUris.push(event.filePath);
    }
    state.currentPointer = {
      epoch: nextEpoch,
      requestId,
    };
    state.epochCounter = nextEpoch;
    state.updatedAt = this.now();
    this.repository.save(state);
  }

  async reconcileWorktreeChanges(input: EditingTimelineWorktreeReconcileInput): Promise<void> {
    if (!input.turnId) {
      return;
    }

    const state = this.repository.load(this.sessionId, this.workspaceRoot)
      ?? this.repository.createEmptyState(this.sessionId, this.workspaceRoot);
    const scope = state.requestScopes.find(value => value.requestId === input.turnId);
    const candidatePaths = [...new Set([...(scope?.touchedUris ?? []), ...input.filePaths])];
    if (candidatePaths.length === 0) {
      return;
    }

    for (const filePath of candidatePaths) {
      const known = this.readCurrentTextState(state, filePath, state.currentPointer.epoch);
      if (known.contentKind !== 'text') {
        continue;
      }

      const afterContent = await input.readCurrentText(filePath);
      const existsAfter = afterContent !== null;
      if (known.exists === existsAfter && known.content === afterContent) {
        continue;
      }

      const edits = known.content !== null && afterContent !== null && input.computeEdits
        ? await input.computeEdits(known.content, afterContent)
        : undefined;

      this.recordFileWrite({
        turnId: input.turnId,
        filePath,
        existedBefore: known.exists,
        beforeContent: known.content,
        afterContent,
        ...(edits && edits.length > 0 ? { edits } : {}),
      });
    }
  }

  private ensureRequestScope(
    state: EditingSessionTimelineState,
    requestId: string,
    turnId: string,
  ): TimelineRequestScope {
    let scope = state.requestScopes.find(value => value.requestId === requestId);
    if (scope) {
      return scope;
    }

    scope = {
      requestId,
      turnId,
      startedAt: this.now(),
      status: 'open',
      checkpointIds: [],
      touchedUris: [],
    };
    state.requestScopes.push(scope);
    return scope;
  }

  private ensureBaseline(
    state: EditingSessionTimelineState,
    requestId: string,
    filePath: string,
    existedBefore: boolean,
    contentKind: 'text' | 'binary' | 'notebook',
    beforeContent?: string | null,
    beforeBytes?: Uint8Array | null,
  ) {
    let baseline = state.baselines.find(value => value.requestId === requestId && value.uri === filePath);
    if (baseline) {
      return baseline;
    }

    baseline = {
      baselineId: `baseline:${requestId}:${state.baselines.length + 1}`,
      requestId,
      uri: filePath,
      epoch: state.currentPointer.epoch,
      contentRef: this.createContentRef(contentKind, beforeContent, beforeBytes),
      contentKind,
      existed: existedBefore,
      createdAt: this.now(),
    };
    state.baselines.push(baseline);
    return baseline;
  }

  private createWriteOperation(
    epoch: number,
    requestId: string,
    event: EditingTimelineFileWriteEvent,
    contentKind: 'text' | 'binary' | 'notebook',
    toolCallId?: string,
  ): TimelineFileOperation {
    const afterRef = this.createContentRef(contentKind, event.afterContent, event.afterBytes);
    const beforeRef = this.createContentRef(contentKind, event.beforeContent, event.beforeBytes);
    const operationId = toolCallId
      ? `op:${requestId}:${toolCallId}:${epoch}`
      : `op:${requestId}:${epoch}`;

    if (
      contentKind === 'text'
      && Array.isArray(event.edits)
      && event.edits.length > 0
      && beforeRef
      && afterRef
    ) {
      return {
        operationId,
        requestId,
        epoch,
        uri: event.filePath,
        contentKind,
        createdAt: this.now(),
        type: 'text-edit',
        beforeRef,
        afterRef,
        edits: event.edits,
      };
    }

    if (!event.existedBefore) {
      return {
        operationId,
        requestId,
        epoch,
        uri: event.filePath,
        contentKind,
        createdAt: this.now(),
        type: 'create',
        afterRef,
      };
    }

    if (contentKind === 'text' && (event.afterContent === null || event.afterContent === undefined)) {
      return {
        operationId,
        requestId,
        epoch,
        uri: event.filePath,
        contentKind,
        createdAt: this.now(),
        type: 'delete',
        beforeRef,
      };
    }

    return {
      operationId,
      requestId,
      epoch,
      uri: event.filePath,
      contentKind,
      createdAt: this.now(),
      type: 'replace',
      beforeRef,
      afterRef,
    };
  }

  private createContentRef(
    contentKind: 'text' | 'binary' | 'notebook',
    textContent?: string | null,
    binaryContent?: Uint8Array | null,
  ) {
    if (contentKind === 'binary') {
      return binaryContent ? this.contentStore.putBinary(this.workspaceRoot, this.sessionId, binaryContent) : null;
    }

    if (textContent === null || textContent === undefined) {
      return null;
    }

    return this.contentStore.putText(this.workspaceRoot, this.sessionId, textContent);
  }

  private readCurrentTextState(
    state: EditingSessionTimelineState,
    uri: string,
    epoch: number,
  ): { exists: boolean; contentKind: 'text' | 'binary' | 'notebook'; content: string | null } {
    const operation = state.operations
      .filter(value => this.getTouchedUris(value).includes(uri) && value.epoch <= epoch)
      .sort((left, right) => right.epoch - left.epoch)[0];
    if (operation) {
      if (operation.type === 'delete') {
        return { exists: false, contentKind: operation.contentKind, content: null };
      }
      if (operation.type === 'rename') {
        if (uri === operation.fromUri) {
          return { exists: false, contentKind: operation.contentKind, content: null };
        }
        return this.readCurrentTextState(state, operation.fromUri, operation.epoch - 1);
      }
      if (operation.contentKind !== 'text') {
        return { exists: true, contentKind: operation.contentKind, content: null };
      }

      const contentRef = operation.afterRef;
      return {
        exists: true,
        contentKind: 'text',
        content: contentRef ? this.contentStore.getText(this.workspaceRoot, this.sessionId, contentRef) : '',
      };
    }

    const baseline = state.baselines
      .filter(value => value.uri === uri && value.epoch <= epoch)
      .sort((left, right) => right.epoch - left.epoch)[0]
      ?? state.baselines
        .filter(value => value.uri === uri)
        .sort((left, right) => left.epoch - right.epoch)[0];
    if (!baseline) {
      return { exists: false, contentKind: 'text', content: null };
    }
    if (baseline.contentKind !== 'text') {
      return { exists: baseline.existed, contentKind: baseline.contentKind, content: null };
    }

    return {
      exists: baseline.existed,
      contentKind: 'text',
      content: baseline.contentRef ? this.contentStore.getText(this.workspaceRoot, this.sessionId, baseline.contentRef) : null,
    };
  }

  private getTouchedUris(operation: TimelineFileOperation): string[] {
    if (operation.type === 'rename') {
      return [operation.fromUri, operation.toUri];
    }
    return [operation.uri];
  }
}
