import type { IChatViewAccess } from '../core/chat-context';
import {
  TurnResponseHostProjectionBuilder,
  type IncrementalTurnResponsePartSource,
  type TurnResponseProjectionHandle,
} from '../core/turn-response-host-projection-builder';
import type { TurnResponseTurn } from 'aily-lex/browser';

import { findChatMessageHandleByTurnId } from './chat-message-handle';

type LexRenderProjectionSyncContext = Pick<
  IChatViewAccess,
  'partStore' | 'list' | 'invalidateHostRequestGraph' | 'triggerSyncDetectChanges'
>;

type RenderProjectionLifecycleAccess = {
  readonly currentMessageHandle: TurnResponseProjectionHandle | null;
};

type RenderProjectionVisibilityAccess = {
  readProjectionSessionResource?(): string | null | undefined;
  readCurrentViewSessionResource?(): string | null | undefined;
};

export class LexRenderProjectionSync {
  private readonly _hostProjectionBuilder: TurnResponseHostProjectionBuilder;

  constructor(
    private readonly ctx: LexRenderProjectionSyncContext,
    private readonly messageLifecycleBridge: RenderProjectionLifecycleAccess,
    private readonly visibility: RenderProjectionVisibilityAccess = {},
  ) {
    this._hostProjectionBuilder = new TurnResponseHostProjectionBuilder(ctx.partStore);
  }

  projectPendingChanges(
    currentTurn: Pick<TurnResponseTurn, 'turnId' | 'response'> | null,
    source: IncrementalTurnResponsePartSource,
  ): void {
    if (!this.canProjectToVisible()) {
      return;
    }

    const handle = this.resolveProjectedMessageHandle(currentTurn);
    if (!handle || !currentTurn) {
      return;
    }

    const partsChanged = this._hostProjectionBuilder.projectIncrementalParts(handle, source, {
      syncContent: true,
    });
    const metaChanged = this._hostProjectionBuilder.syncMessageMeta(handle, currentTurn);

    if (partsChanged || metaChanged) {
      this.ctx.invalidateHostRequestGraph();
      this.ctx.triggerSyncDetectChanges();
    }
  }

  clearProjectedMessage(currentTurn: Pick<TurnResponseTurn, 'turnId'> | null): void {
    if (!this.canProjectToVisible()) {
      return;
    }

    this._hostProjectionBuilder.clearHandle(this.resolveProjectedMessageHandle(currentTurn));
  }

  syncProjectedMessageMeta(currentTurn: Pick<TurnResponseTurn, 'turnId' | 'response'> | null): void {
    if (!this.canProjectToVisible()) {
      return;
    }

    const handle = this.resolveProjectedMessageHandle(currentTurn);
    if (!handle || !currentTurn) {
      return;
    }

    this.syncMessageMetaIfNeeded(handle, currentTurn);
  }

  private syncMessageMetaIfNeeded(
    handle: TurnResponseProjectionHandle,
    currentTurn: Pick<TurnResponseTurn, 'turnId' | 'response'>,
  ): void {
    if (this._hostProjectionBuilder.syncMessageMeta(handle, currentTurn)) {
      this.ctx.invalidateHostRequestGraph();
      this.ctx.triggerSyncDetectChanges();
    }
  }

  private resolveProjectedMessageHandle(
    currentTurn: Pick<TurnResponseTurn, 'turnId'> | null,
  ): TurnResponseProjectionHandle | null {
    if (currentTurn) {
      const byTurnId = findChatMessageHandleByTurnId(this.ctx.list, currentTurn.turnId, { role: 'aily' });
      if (byTurnId) {
        return byTurnId;
      }
    }

    return this.messageLifecycleBridge.currentMessageHandle;
  }

  private canProjectToVisible(): boolean {
    const readCurrentViewSessionResource = this.visibility.readCurrentViewSessionResource;
    if (typeof readCurrentViewSessionResource !== 'function') {
      return true;
    }

    const currentViewSessionResource = normalizeSessionResource(readCurrentViewSessionResource());
    if (!currentViewSessionResource) {
      return false;
    }

    const projectionSessionResource = normalizeSessionResource(
      this.visibility.readProjectionSessionResource?.(),
    );
    return !!projectionSessionResource && projectionSessionResource === currentViewSessionResource;
  }
}

function normalizeSessionResource(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}
