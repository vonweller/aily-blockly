import { Injectable } from '@angular/core';

import type {
  ChatRuntimeHostAttachViewOptions,
  ChatRuntimeHostSessionId,
  ChatRuntimeHostViewId,
} from '../core/chat-runtime-host-contract';
import type { ChatRuntimeOwnerViewAttachmentPort } from './chat-runtime-owner-ports';

interface RuntimeOwnerViewAttachment {
  readonly sessionId: ChatRuntimeHostSessionId;
  readonly visibleAttachmentGeneration: number | null;
}

@Injectable()
export class ChatRuntimeOwnerViewAttachmentService implements ChatRuntimeOwnerViewAttachmentPort {
  private readonly viewAttachments = new Map<ChatRuntimeHostViewId, RuntimeOwnerViewAttachment>();

  attachView(
    viewId: ChatRuntimeHostViewId,
    sessionId: ChatRuntimeHostSessionId,
    options: ChatRuntimeHostAttachViewOptions | null | undefined,
  ): void {
    for (const [attachedViewId, attachment] of [...this.viewAttachments]) {
      if (attachedViewId !== viewId && attachment.sessionId === sessionId) {
        this.viewAttachments.delete(attachedViewId);
      }
    }

    this.viewAttachments.set(viewId, {
      sessionId,
      visibleAttachmentGeneration: this.normalizeVisibleAttachmentGeneration(options?.visibleAttachmentGeneration),
    });
  }

  detachView(viewId: ChatRuntimeHostViewId): ChatRuntimeHostSessionId | null {
    const attachment = this.viewAttachments.get(viewId) ?? null;
    this.viewAttachments.delete(viewId);
    return attachment?.sessionId ?? null;
  }

  detachSession(sessionId: ChatRuntimeHostSessionId): void {
    for (const [viewId, attachment] of [...this.viewAttachments]) {
      if (attachment.sessionId === sessionId) {
        this.viewAttachments.delete(viewId);
      }
    }
  }

  readSessionForView(viewId: ChatRuntimeHostViewId): ChatRuntimeHostSessionId | null {
    return this.viewAttachments.get(viewId)?.sessionId ?? null;
  }

  readAttachedViewIds(sessionId: ChatRuntimeHostSessionId): readonly ChatRuntimeHostViewId[] {
    const result: ChatRuntimeHostViewId[] = [];
    for (const [viewId, attachment] of this.viewAttachments) {
      if (attachment.sessionId === sessionId) {
        result.push(viewId);
      }
    }
    return result;
  }

  hasAttachedView(sessionId: ChatRuntimeHostSessionId | null | undefined): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return false;
    }

    for (const attachment of this.viewAttachments.values()) {
      if (attachment.sessionId === normalizedSessionId) {
        return true;
      }
    }
    return false;
  }

  readVisibleAttachmentGeneration(sessionId: ChatRuntimeHostSessionId | null | undefined): number | null {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return null;
    }

    let generation: number | null = null;
    for (const attachment of this.viewAttachments.values()) {
      if (attachment.sessionId !== normalizedSessionId || attachment.visibleAttachmentGeneration === null) {
        continue;
      }
      generation = generation === null
        ? attachment.visibleAttachmentGeneration
        : Math.max(generation, attachment.visibleAttachmentGeneration);
    }
    return generation;
  }

  isVisibleAttachmentCurrent(
    sessionId: ChatRuntimeHostSessionId | null | undefined,
    generation: number | null | undefined,
  ): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const normalizedGeneration = this.normalizeVisibleAttachmentGeneration(generation);
    if (!normalizedSessionId || normalizedGeneration === null) {
      return false;
    }

    for (const attachment of this.viewAttachments.values()) {
      if (attachment.sessionId === normalizedSessionId
        && attachment.visibleAttachmentGeneration === normalizedGeneration) {
        return true;
      }
    }
    return false;
  }

  private normalizeSessionId(sessionId: ChatRuntimeHostSessionId | null | undefined): ChatRuntimeHostSessionId {
    return typeof sessionId === 'string' ? sessionId.trim() : '';
  }

  private normalizeVisibleAttachmentGeneration(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }
}
