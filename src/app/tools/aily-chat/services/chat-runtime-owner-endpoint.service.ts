import { DestroyRef, Injectable, inject } from '@angular/core';

import {
  registerElectronChatRuntimeOwner,
  type ElectronChatRuntimeOwnerRegistration,
} from '../core/electron-chat-runtime-host-transport';
import {
  CHAT_RUNTIME_OWNER_HOST,
  CHAT_RUNTIME_OWNER_HOST_ADAPTER,
  type ChatRuntimeOwnerHostAdapterPort,
  type ChatRuntimeOwnerHostPort,
} from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeOwnerEndpointService {
  private readonly runtimeOwner = inject<ChatRuntimeOwnerHostPort>(CHAT_RUNTIME_OWNER_HOST);
  private readonly runtimeOwnerHostAdapter = inject<ChatRuntimeOwnerHostAdapterPort>(CHAT_RUNTIME_OWNER_HOST_ADAPTER);
  private readonly destroyRef = inject(DestroyRef);
  private electronHostOwnerRegistration: ElectronChatRuntimeOwnerRegistration | null = null;
  private electronHostOwnerRegistrationPromise: Promise<void> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      const registration = this.electronHostOwnerRegistration;
      this.electronHostOwnerRegistration = null;
      if (registration) {
        void registration.dispose().catch((error) => {
          console.error('[AilyChat][RuntimeOwnerEndpoint] Failed to unregister Electron host runtime owner:', error);
        });
      }
    });
  }

  async startElectronHostOwner(ownerId = 'aily-chat-main-runtime-owner'): Promise<void> {
    const owner = this.runtimeOwnerHostAdapter.ensureBound();
    const moduleLoaded = await owner.agent.loadModule();
    if (!moduleLoaded) {
      throw new Error('[AilyChat][RuntimeHost] aily-lex module failed to load in host runtime owner.');
    }
    await this.registerElectronHostOwner(ownerId);
  }

  private async registerElectronHostOwner(ownerId: string): Promise<void> {
    if (this.electronHostOwnerRegistration) {
      return;
    }
    if (this.electronHostOwnerRegistrationPromise) {
      return this.electronHostOwnerRegistrationPromise;
    }

    this.electronHostOwnerRegistrationPromise = registerElectronChatRuntimeOwner(this.runtimeOwner, ownerId)
      .then((registration) => {
        this.electronHostOwnerRegistration = registration;
      })
      .finally(() => {
        this.electronHostOwnerRegistrationPromise = null;
      });
    return this.electronHostOwnerRegistrationPromise;
  }
}
