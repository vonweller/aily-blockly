import { yieldToBrowserFrame } from './browserTaskScheduler';
import type { EditorOperationEvent, EditorOperationEventSink, EditorOperationPhase } from './editorOperationEvents';
import { ChatPerformanceTracer } from '../services/chat-perf-tracer';

export type BlocklyEditorOperationPhase = EditorOperationPhase;
export type BlocklyEditorOperationProgress = EditorOperationEvent;
export type BlocklyEditorOperationProgressSink = EditorOperationEventSink;

export interface BlocklyEditorOperationProgressUpdate {
  readonly summary?: string;
  readonly detail?: string;
  readonly progress?: number;
}

export type BlocklyEditorOperationProgressReporter = (
  update: BlocklyEditorOperationProgressUpdate,
) => Promise<void>;

export interface BlocklyEditorOperationContext {
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly toolCallId?: string;
  readonly signal?: AbortSignal;
  readonly isStale?: () => boolean;
  readonly progressSink?: EditorOperationEventSink;
  readonly runOutsideAngular?: <T>(operation: () => Promise<T> | T) => Promise<T> | T;
}

let nextOperationSeq = 1;

function createOperationId(): string {
  return `blockly-editor-op-${Date.now().toString(36)}-${nextOperationSeq++}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancellationError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'AbortError' || /cancelled|canceled|aborted/i.test(error.message);
}

function createCancellationError(): Error {
  const error = new Error('Editor operation cancelled');
  error.name = 'AbortError';
  return error;
}

function isOperationStale(context?: BlocklyEditorOperationContext): boolean {
  try {
    return context?.isStale?.() === true;
  } catch {
    return true;
  }
}

function throwIfOperationCancelled(context?: BlocklyEditorOperationContext): void {
  if (context?.signal?.aborted || isOperationStale(context)) {
    throw createCancellationError();
  }
}

export class BlocklyEditorOperationQueue {
  private tail: Promise<void> = Promise.resolve();
  private pendingCount = 0;

  enqueue<T>(
    kind: string,
    label: string,
    run: (reportProgress: BlocklyEditorOperationProgressReporter) => Promise<T> | T,
    context?: BlocklyEditorOperationContext,
  ): Promise<T> {
    const operationId = createOperationId();
    const queuedAt = Date.now();
    this.pendingCount += 1;
    void this.emit({
      type: 'editor_operation_progress',
      operationId,
      operationKind: kind,
      label,
      phase: 'queued',
      sessionId: context?.sessionId,
      turnId: context?.turnId,
      toolCallId: context?.toolCallId,
      timestamp: queuedAt,
      queueSize: Math.max(0, this.pendingCount - 1),
    }, context);

    const task = this.tail.then(async () => {
      const startedAt = Date.now();
      await yieldToBrowserFrame();

      try {
        throwIfOperationCancelled(context);

        await this.emit({
          type: 'editor_operation_progress',
          operationId,
          operationKind: kind,
          label,
          phase: 'started',
          sessionId: context?.sessionId,
          turnId: context?.turnId,
          toolCallId: context?.toolCallId,
          timestamp: startedAt,
          queueSize: Math.max(0, this.pendingCount - 1),
        }, context);

        const reportProgress: BlocklyEditorOperationProgressReporter = update => {
          throwIfOperationCancelled(context);
          return this.emit({
            type: 'editor_operation_progress',
            operationId,
            operationKind: kind,
            label,
            phase: 'progress',
            sessionId: context?.sessionId,
            turnId: context?.turnId,
            toolCallId: context?.toolCallId,
            summary: update.summary,
            detail: update.detail,
            progress: update.progress,
            timestamp: Date.now(),
            queueSize: Math.max(0, this.pendingCount - 1),
          }, context);
        };

        const executeOperation = () => ChatPerformanceTracer.runWithSurface(
          'editor_operation',
          () => run(reportProgress),
          `${kind}:${label}`,
        );
        const result = await (context?.runOutsideAngular
          ? context.runOutsideAngular(executeOperation)
          : executeOperation());
        throwIfOperationCancelled(context);
        const completedAt = Date.now();
        await this.emit({
          type: 'editor_operation_progress',
          operationId,
          operationKind: kind,
          label,
          phase: 'completed',
          sessionId: context?.sessionId,
          turnId: context?.turnId,
          toolCallId: context?.toolCallId,
          timestamp: completedAt,
          durationMs: completedAt - startedAt,
          queueSize: Math.max(0, this.pendingCount - 1),
        }, context);
        return result;
      } catch (error) {
        const completedAt = Date.now();
        const cancelled = isCancellationError(error, context?.signal);
        await this.emit({
          type: 'editor_operation_progress',
          operationId,
          operationKind: kind,
          label,
          phase: cancelled ? 'cancelled' : 'failed',
          sessionId: context?.sessionId,
          turnId: context?.turnId,
          toolCallId: context?.toolCallId,
          detail: describeError(error),
          timestamp: completedAt,
          durationMs: completedAt - startedAt,
          queueSize: Math.max(0, this.pendingCount - 1),
        }, context);
        throw error;
      } finally {
        this.pendingCount = Math.max(0, this.pendingCount - 1);
      }
    });

    this.tail = task.then(() => undefined, () => undefined);
    return task;
  }

  private async emit(
    progress: EditorOperationEvent,
    context?: BlocklyEditorOperationContext,
  ): Promise<void> {
    try {
      await context?.progressSink?.reportEditorOperationEvent?.(progress);
    } catch (error) {
      console.warn('[BlocklyEditorOperationQueue] progress sink failed:', error);
    }
  }
}

const sharedBlocklyEditorOperationQueue = new BlocklyEditorOperationQueue();

export function getSharedBlocklyEditorOperationQueue(): BlocklyEditorOperationQueue {
  return sharedBlocklyEditorOperationQueue;
}
