import type { RenderEvent, TurnResponsePart } from 'aily-lex/browser';

import type { ChatPart } from './chat-parts';
import {
  ChatPartStore,
  type ChatPartStoreChangeTracker,
} from './chat-part-store';
import type { ChatMessageHandle, OpaqueChatMessageHandle } from '../helpers/chat-message-handle';
import { RenderEventPartAdapter, type RenderEventPartStoreAccess } from './render-event-part-adapter';
import { chatPartToTurnResponsePart, turnResponsePartToChatPart } from './turn-response-part-mapper';

export type DetachedRuntimeProjectionTargetHandle<TMessage extends object = object> =
  | ChatMessageHandle<TMessage & { content: string }>
  | OpaqueChatMessageHandle<TMessage & { content: string }>;

type DetachedProjectionChangeTracker = Pick<
  ChatPartStoreChangeTracker,
  'drainPartIndexChangesForHandle' | 'clear' | 'dispose'
>;

type DetachedHostStreamChangeTracker = Pick<
  ChatPartStoreChangeTracker,
  'drainChangesForHandle' | 'clear' | 'dispose'
>;

type DetachedRuntimeStore = RenderEventPartStoreAccess & Pick<
  ChatPartStore,
  | 'createDetachedHandle'
  | 'addPartToHandle'
  | 'createChangeTracker'
  | 'clearMessageHandle'
  | 'destroy'
  | 'finalizeRunningPartsForHandle'
  | 'getPartsForHandle'
  | 'projectPartChangesFromHandle'
>;

type DetachedRuntimeProjectionTargetStore = Pick<
  ChatPartStore,
  'projectPartChangesFromHandle'
>;

/**
 * Encapsulates the detached ChatPartStore + synthetic handle compatibility
 * boundary used by live streaming and replay-only turn projection.
 */
export class DetachedChatPartRuntime {
  private readonly store: DetachedRuntimeStore = new ChatPartStore();
  private readonly adapter = new RenderEventPartAdapter(this.store);
  private readonly detachedHandle = this.store.createDetachedHandle();
  private readonly changeTracker: DetachedProjectionChangeTracker = this.store.createChangeTracker();
  private readonly hostStreamChangeTracker: DetachedHostStreamChangeTracker = this.store.createChangeTracker();

  drainTurnResponsePartChanges(): Array<{
    partIndex: number;
    kind: 'add' | 'update' | 'append';
    part: TurnResponsePart;
  }> {
    const detachedParts = this.getDetachedParts();
    return this.hostStreamChangeTracker.drainChangesForHandle(this.detachedHandle)
      .map(change => {
        const part = detachedParts[change.partIndex];
        if (!part) {
          return null;
        }

        return {
          partIndex: change.partIndex,
          kind: change.kind,
          part: chatPartToTurnResponsePart(part),
        };
      })
      .filter((change): change is {
        partIndex: number;
        kind: 'add' | 'update' | 'append';
        part: TurnResponsePart;
      } => !!change);
  }

  process(event: RenderEvent): boolean {
    return this.adapter.process(event, this.detachedHandle);
  }

  finalizeRunningParts(): void {
    this.store.finalizeRunningPartsForHandle(this.detachedHandle);
  }

  collectTurnResponseParts(): TurnResponsePart[] {
    return this.getDetachedParts().map(chatPartToTurnResponsePart);
  }

  hydrateTurnResponseParts(parts: readonly TurnResponsePart[]): void {
    this.reset();

    for (const part of parts) {
      this.store.addPartToHandle(this.detachedHandle, turnResponsePartToChatPart(part));
    }

    // Hydration is a baseline restore, not a live delta.
    this.changeTracker.clear();
    this.hostStreamChangeTracker.clear();
  }

  projectPendingPartsTo(
    targetStore: DetachedRuntimeProjectionTargetStore,
    targetHandle: DetachedRuntimeProjectionTargetHandle | null,
  ): boolean {
    const changes = this.changeTracker.drainPartIndexChangesForHandle(this.detachedHandle);
    if (changes.length === 0) {
      return false;
    }

    return targetStore.projectPartChangesFromHandle(
      this.store,
      this.detachedHandle,
      changes,
      targetHandle,
      cloneChatPart,
    );
  }

  clear(): void {
    this.store.clearMessageHandle(this.detachedHandle);
    this.changeTracker.clear();
    this.hostStreamChangeTracker.clear();
  }

  reset(): void {
    this.clear();
    this.adapter.reset();
  }

  destroy(): void {
    this.adapter.dispose();
    this.changeTracker.dispose();
    this.hostStreamChangeTracker.dispose();
    this.store.destroy();
  }

  private getDetachedParts(): ChatPart[] {
    return this.store.getPartsForHandle(this.detachedHandle);
  }
}

function cloneChatPart(part: ChatPart, existing?: ChatPart): ChatPart {
  return turnResponsePartToChatPart(chatPartToTurnResponsePart(part), existing);
}