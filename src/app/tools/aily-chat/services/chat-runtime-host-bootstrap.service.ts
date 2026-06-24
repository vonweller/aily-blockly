import { Injectable, inject } from '@angular/core';
import { UiService } from '../../../services/ui.service';
import { CHAT_RUNTIME_OWNER_ENDPOINT } from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeHostBootstrapService {
  private readonly uiService = inject(UiService);
  private readonly runtimeOwnerEndpoint = inject(CHAT_RUNTIME_OWNER_ENDPOINT);
  private registrationPromise: Promise<void> | null = null;

  async startMainWindowRuntimeOwner(): Promise<void> {
    if (this.uiService.isMainWindow !== true) {
      throw new Error('[AilyChat][RuntimeHost] Main-window runtime owner bootstrap was requested outside the main window.');
    }
    if (this.registrationPromise) {
      return this.registrationPromise;
    }

    this.registrationPromise = this.startHostOwner()
      .finally(() => {
        this.registrationPromise = null;
      });
    return this.registrationPromise;
  }

  private async startHostOwner(): Promise<void> {
    await this.runtimeOwnerEndpoint.startElectronHostOwner();
  }
}
