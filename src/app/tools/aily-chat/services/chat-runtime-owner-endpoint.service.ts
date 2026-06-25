import { DestroyRef, Injectable, inject } from '@angular/core';

import {
  registerElectronChatRuntimeExecutionWorker,
  type ElectronChatRuntimeExecutionWorkerRegistration,
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
  private electronHostExecutionWorkerRegistration: ElectronChatRuntimeExecutionWorkerRegistration | null = null;
  private electronHostExecutionWorkerRegistrationPromise: Promise<void> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      const registration = this.electronHostExecutionWorkerRegistration;
      this.electronHostExecutionWorkerRegistration = null;
      if (registration) {
        void registration.dispose().catch((error) => {
          console.error('[AilyChat][RuntimeOwnerEndpoint] Failed to unregister Electron host execution worker:', error);
        });
      }
    });
  }

  async startElectronHostExecutionWorker(executionWorkerId = 'aily-chat-host-execution-worker'): Promise<void> {
    const runtimeOwner = this.runtimeOwnerHostAdapter.ensureBound();
    const moduleLoaded = await runtimeOwner.agent.loadModule();
    if (!moduleLoaded) {
      throw new Error('[AilyChat][RuntimeHost] aily-lex module failed to load in host execution worker.');
    }
    await this.registerElectronHostExecutionWorker(executionWorkerId);
  }

  private async registerElectronHostExecutionWorker(executionWorkerId: string): Promise<void> {
    if (this.electronHostExecutionWorkerRegistration) {
      return;
    }
    if (this.electronHostExecutionWorkerRegistrationPromise) {
      return this.electronHostExecutionWorkerRegistrationPromise;
    }

    this.electronHostExecutionWorkerRegistrationPromise = registerElectronChatRuntimeExecutionWorker(
      this.runtimeOwner,
      executionWorkerId,
    )
      .then((registration) => {
        this.electronHostExecutionWorkerRegistration = registration;
      })
      .finally(() => {
        this.electronHostExecutionWorkerRegistrationPromise = null;
      });
    return this.electronHostExecutionWorkerRegistrationPromise;
  }
}



