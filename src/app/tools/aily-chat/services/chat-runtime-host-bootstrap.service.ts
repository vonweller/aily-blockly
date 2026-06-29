import { Injectable, inject } from '@angular/core';

import { AilyChatHostInitializerService } from './aily-chat-host-initializer.service';
import { CHAT_RUNTIME_OWNER_ENDPOINT } from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeHostBootstrapService {
  private readonly hostInitializer = inject(AilyChatHostInitializerService);
  private readonly runtimeOwnerEndpoint = inject(CHAT_RUNTIME_OWNER_ENDPOINT);
  private registrationPromise: Promise<void> | null = null;

  async startHostRuntimeOwner(): Promise<void> {
    if (this.registrationPromise) {
      return this.registrationPromise;
    }

    this.hostInitializer.ensureInitialized();

    this.registrationPromise = this.runtimeOwnerEndpoint.startElectronHostRuntimeOwner()
      .finally(() => {
        this.registrationPromise = null;
      });
    return this.registrationPromise;
  }
}
