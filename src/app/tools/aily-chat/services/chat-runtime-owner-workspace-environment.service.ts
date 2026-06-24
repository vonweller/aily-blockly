import { Injectable } from '@angular/core';

import { AilyHost } from '../core/host';
import type { ChatRuntimeOwnerWorkspaceEnvironmentPort } from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeOwnerWorkspaceEnvironmentService implements ChatRuntimeOwnerWorkspaceEnvironmentPort {
  get currentProjectPath(): string {
    return this.normalizePath(AilyHost.get().project?.currentProjectPath);
  }

  get projectRootPath(): string {
    return this.normalizePath(AilyHost.get().project?.projectRootPath);
  }

  get projectPath(): string {
    return this.currentProjectPath || this.projectRootPath;
  }

  private normalizePath(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}
