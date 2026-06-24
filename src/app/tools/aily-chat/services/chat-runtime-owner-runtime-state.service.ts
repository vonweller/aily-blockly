import { Inject, Injectable } from '@angular/core';

import {
  type ChatSessionRuntimeCapabilities,
  type ChatSessionRuntimeState,
} from './chat-session-runtime-store.service';
import {
  CHAT_SESSION_RUNTIME_MIRROR_WRITER,
  type ChatSessionRuntimeMirrorWriterPort,
} from './chat-session-runtime-mirror-writer';
import type {
  ChatRuntimeOwnerHandleProjectionMetadata,
  ChatRuntimeOwnerRuntimeControllerPort,
  ChatRuntimeOwnerRuntimeStateReaderPort,
} from './chat-runtime-owner-ports';
import { CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER } from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeOwnerRuntimeStateService implements ChatRuntimeOwnerRuntimeStateReaderPort {
  constructor(
    @Inject(CHAT_SESSION_RUNTIME_MIRROR_WRITER)
    private readonly runtimeMirror: ChatSessionRuntimeMirrorWriterPort,
    @Inject(CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER)
    private readonly runtimeController: ChatRuntimeOwnerRuntimeControllerPort,
  ) {}

  readSessionRuntimeState(sessionId: string | null | undefined): Readonly<ChatSessionRuntimeState> | undefined {
    return this.runtimeMirror.read(sessionId);
  }

  readHandleMetadata(sessionId: string | null | undefined): ChatRuntimeOwnerHandleProjectionMetadata {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    return targetSessionId
      ? this.runtimeController.readHandleProjectionMetadata(targetSessionId)
      : { capabilities: undefined, concurrencyScope: null };
  }
}
