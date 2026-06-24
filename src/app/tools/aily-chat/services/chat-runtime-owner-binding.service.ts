import { Injectable, inject } from '@angular/core';

import { LexOwnerFacade } from '../helpers/lex-stream.helper';
import type { ChatRuntimeOwnerContextAdapter } from './chat-runtime-owner-context.service';
import {
  CHAT_RUNTIME_OWNER_CONTEXT_BINDER,
  CHAT_RUNTIME_OWNER_CONTEXT_MATERIALIZER,
  type ChatRuntimeOwnerContextBinderPort,
  type ChatRuntimeOwnerContextMaterializerPort,
} from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeOwnerBindingService {
  private readonly runtimeOwner = inject<ChatRuntimeOwnerContextBinderPort>(CHAT_RUNTIME_OWNER_CONTEXT_BINDER);
  private readonly runtimeOwnerContext = inject<ChatRuntimeOwnerContextMaterializerPort>(
    CHAT_RUNTIME_OWNER_CONTEXT_MATERIALIZER,
  );

  bindAdapter(adapter: ChatRuntimeOwnerContextAdapter): LexOwnerFacade {
    const context = this.runtimeOwnerContext.bindAdapter(adapter);
    return this.runtimeOwner.bindContext(context);
  }
}
