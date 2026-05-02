import type { RenderEvent, TurnResponseStatus, TurnResponseTurn } from 'aily-lex/browser';

import {
  type ChatPartStore,
} from './chat-part-store';
import {
  DetachedChatPartRuntime,
  type DetachedRuntimeProjectionTargetHandle,
} from './detached-chat-part-runtime';
import { buildTurnResponseTurn } from './turn-response-stream-contract';

type IncrementalTurnResponseProjectionTargetStore = Pick<
  ChatPartStore,
  'projectPartChangesFromHandle'
>;

type IncrementalTurnResponseRuntime = Pick<
  DetachedChatPartRuntime,
  | 'finalizeRunningParts'
  | 'reset'
  | 'process'
  | 'collectTurnResponseParts'
  | 'projectPendingPartsTo'
  | 'drainTurnResponsePartChanges'
  | 'destroy'
>;

interface TurnResponseIncrementalProjection {
  readonly turnId: string;
  readonly sourceTurnId: string;
  readonly request: TurnResponseTurn['request'];
  readonly rounds: TurnResponseTurn['rounds'];
  readonly usage?: TurnResponseTurn['usage'];
  readonly participant?: string;
  readonly command?: TurnResponseTurn['response']['command'];
  readonly usedContext?: TurnResponseTurn['response']['usedContext'];
  readonly contentReferences?: readonly NonNullable<TurnResponseTurn['response']['contentReferences']>[number][];
  readonly codeCitations?: readonly NonNullable<TurnResponseTurn['response']['codeCitations']>[number][];
  readonly progressMessages?: readonly NonNullable<TurnResponseTurn['response']['progressMessages']>[number][];
  readonly createdAt: number;
}

export interface TurnResponseIncrementalBeginOptions {
  readonly turnId: string;
  readonly request: TurnResponseTurn['request'];
  readonly participant?: string;
  readonly command?: TurnResponseTurn['response']['command'];
  readonly timestamp: number;
}

export interface TurnResponseIncrementalRetargetOptions {
  readonly turnId: string;
  readonly request: TurnResponseTurn['request'];
  readonly participant?: string;
  readonly command?: TurnResponseTurn['response']['command'];
  readonly timestamp: number;
}

export interface TurnResponseIncrementalMaterializeOptions {
  readonly updatedAt: number;
  readonly status: TurnResponseStatus;
  readonly terminationReason?: TurnResponseTurn['response']['terminationReason'];
  readonly usage?: TurnResponseTurn['usage'];
  readonly participant?: string;
  readonly snapshot?: {
    readonly request?: TurnResponseTurn['request'];
    readonly rounds?: TurnResponseTurn['rounds'];
    readonly usage?: TurnResponseTurn['usage'];
    readonly createdAt?: number;
    readonly terminationReason?: TurnResponseTurn['response']['terminationReason'];
  };
}

/**
 * Shared incremental RenderEvent -> TurnResponseTurn builder used by both
 * live host sync and replay restore paths.
 */
export class TurnResponseIncrementalBuilder {
  private readonly runtime: IncrementalTurnResponseRuntime = new DetachedChatPartRuntime();
  private currentProjection: TurnResponseIncrementalProjection | null = null;

  get currentTurnId(): string | null {
    return this.currentProjection?.turnId ?? null;
  }

  get currentSourceTurnId(): string | null {
    return this.currentProjection?.sourceTurnId ?? null;
  }

  beginTurn(options: TurnResponseIncrementalBeginOptions): TurnResponseTurn {
    this.runtime.reset();
    this.currentProjection = {
      turnId: options.turnId,
      sourceTurnId: options.turnId,
      request: options.request,
      rounds: [],
      participant: options.participant,
      command: options.command,
      createdAt: options.timestamp,
    };

    return this.materialize({
      updatedAt: options.timestamp,
      status: 'streaming',
      participant: options.participant,
    })!;
  }

  retargetCurrentTurn(options: TurnResponseIncrementalRetargetOptions): TurnResponseTurn | null {
    if (!this.currentProjection) {
      return null;
    }

    this.currentProjection = {
      ...this.currentProjection,
      sourceTurnId: options.turnId,
      request: options.request,
      participant: options.participant ?? this.currentProjection.participant,
      command: options.command ?? this.currentProjection.command,
    };

    return this.materialize({
      updatedAt: options.timestamp,
      status: 'streaming',
      participant: options.participant,
    });
  }

  processEvent(event: RenderEvent): boolean {
    if (this.applyResponseMetadataEvent(event)) {
      return true;
    }

    return this.runtime.process(event);
  }

  materialize(options: TurnResponseIncrementalMaterializeOptions): TurnResponseTurn | null {
    if (!this.currentProjection) {
      return null;
    }

    if (options.status !== 'streaming') {
      this.runtime.finalizeRunningParts();
    }

    const request = options.snapshot?.request ?? this.currentProjection.request;
    const rounds = options.snapshot?.rounds ?? this.currentProjection.rounds;
    const usage = options.usage ?? options.snapshot?.usage ?? this.currentProjection.usage;
    const participant = options.participant ?? this.currentProjection.participant;
    const createdAt = options.snapshot?.createdAt
      ?? this.currentProjection.createdAt
      ?? options.updatedAt;

    this.currentProjection = {
      turnId: this.currentProjection.turnId,
      sourceTurnId: this.currentProjection.sourceTurnId,
      request,
      rounds,
      usage,
      participant,
      command: this.currentProjection.command,
      usedContext: this.currentProjection.usedContext,
      contentReferences: this.currentProjection.contentReferences
        ? [...this.currentProjection.contentReferences]
        : undefined,
      codeCitations: this.currentProjection.codeCitations
        ? [...this.currentProjection.codeCitations]
        : undefined,
      progressMessages: this.currentProjection.progressMessages
        ? [...this.currentProjection.progressMessages]
        : undefined,
      createdAt,
    };

    return buildTurnResponseTurn({
      turnId: this.currentProjection.turnId,
      request,
      rounds,
      usage,
      participant,
      command: this.currentProjection.command,
      usedContext: this.currentProjection.usedContext,
      contentReferences: this.currentProjection.contentReferences,
      codeCitations: this.currentProjection.codeCitations,
      progressMessages: this.currentProjection.progressMessages,
      status: options.status,
      terminationReason: options.terminationReason ?? options.snapshot?.terminationReason,
      parts: this.runtime.collectTurnResponseParts(),
      createdAt,
      updatedAt: options.updatedAt,
    });
  }

  projectPendingPartsTo(
    targetStore: IncrementalTurnResponseProjectionTargetStore,
    targetHandle: DetachedRuntimeProjectionTargetHandle | null,
  ): boolean {
    return this.runtime.projectPendingPartsTo(targetStore, targetHandle);
  }

  drainTurnResponsePartChanges(): Array<{
    partIndex: number;
    kind: 'add' | 'update' | 'append';
    part: TurnResponseTurn['response']['parts'][number];
  }> {
    return this.runtime.drainTurnResponsePartChanges();
  }

  reset(): void {
    this.currentProjection = null;
    this.runtime.reset();
  }

  destroy(): void {
    this.runtime.destroy();
  }

  private applyResponseMetadataEvent(event: RenderEvent): boolean {
    if (!this.currentProjection) {
      return false;
    }

    switch (event.type) {
      case 'response_command':
        this.currentProjection = {
          ...this.currentProjection,
          command: event.value,
        };
        return true;
      case 'response_reference':
        if (event.value.kind === 'usedContext') {
          this.currentProjection = {
            ...this.currentProjection,
            usedContext: event.value,
          };
          return true;
        }

        this.currentProjection = {
          ...this.currentProjection,
          contentReferences: [...(this.currentProjection.contentReferences ?? []), event.value],
        };
        return true;
      case 'response_code_citation':
        this.currentProjection = {
          ...this.currentProjection,
          codeCitations: [...(this.currentProjection.codeCitations ?? []), event.value],
        };
        return true;
      case 'response_progress_message':
        this.currentProjection = {
          ...this.currentProjection,
          progressMessages: [...(this.currentProjection.progressMessages ?? []), event.value],
        };
        return true;
      case 'response_followups':
        return true;
      default:
        return false;
    }
  }
}