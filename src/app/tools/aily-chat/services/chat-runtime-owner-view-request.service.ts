import { Injectable } from '@angular/core';

import type {
  ChatRuntimeHostNotificationSeverity,
  ChatRuntimeHostSessionId,
  ChatRuntimeHostTodoItem,
  ChatRuntimeHostViewRequest,
  ChatRuntimeHostViewRequestKind,
} from '../core/chat-runtime-host-contract';
import type { ChatModeId } from '../core/chat-mode';
import type {
  ChatRuntimeOwnerViewRequestPort,
  ChatRuntimeOwnerViewRequestSubscription,
} from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeOwnerViewRequestService implements ChatRuntimeOwnerViewRequestPort {
  private requestSeed = 0;
  private readonly listeners = new Set<(request: ChatRuntimeHostViewRequest) => void>();

  onRequest(listener: (request: ChatRuntimeHostViewRequest) => void): ChatRuntimeOwnerViewRequestSubscription {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  notify(
    sessionId: ChatRuntimeHostSessionId | null | undefined,
    severity: ChatRuntimeHostNotificationSeverity,
    message: unknown,
  ): void {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const normalizedMessage = typeof message === 'string' ? message.trim() : '';
    if (!normalizedSessionId || !normalizedMessage) {
      return;
    }

    this.requestSeed += 1;
    this.emit({
      id: this.nextRequestId('notification'),
      sessionId: normalizedSessionId,
      kind: 'notification',
      notification: {
        severity,
        message: normalizedMessage,
      },
    });
  }

  syncTodoState(
    sessionId: ChatRuntimeHostSessionId | null | undefined,
    items: readonly ChatRuntimeHostTodoItem[],
  ): void {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId) {
      return;
    }

    this.emit({
      id: this.nextRequestId('todo-state'),
      sessionId: normalizedSessionId,
      kind: 'todo-state',
      todoState: {
        items: items.map(item => ({ ...item })),
      },
    });
  }

  requestHandoff(input: {
    readonly sessionId: ChatRuntimeHostSessionId | null | undefined;
    readonly targetAgent?: string;
    readonly targetModeId?: ChatModeId;
    readonly message: string;
    readonly suggestedInput?: string;
  }): void {
    const normalizedSessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
    const normalizedMessage = typeof input.message === 'string' ? input.message.trim() : '';
    if (!normalizedSessionId || !normalizedMessage) {
      return;
    }

    this.emit({
      id: this.nextRequestId('handoff'),
      sessionId: normalizedSessionId,
      kind: 'handoff',
      handoff: {
        ...(input.targetAgent ? { targetAgent: input.targetAgent } : {}),
        ...(input.targetModeId ? { targetModeId: input.targetModeId } : {}),
        message: normalizedMessage,
        ...(input.suggestedInput ? { suggestedInput: input.suggestedInput } : {}),
      },
    });
  }

  private nextRequestId(kind: ChatRuntimeHostViewRequestKind): string {
    this.requestSeed += 1;
    return `view_request_${kind}_${Date.now().toString(36)}_${this.requestSeed.toString(36)}`;
  }

  private emit(request: ChatRuntimeHostViewRequest): void {
    for (const listener of [...this.listeners]) {
      listener(request);
    }
  }
}
