import type { TurnResponseTurn } from 'aily-lex/browser';

import type { ChatEngineService } from '../services/chat-engine.service';
import type { ChatViewService } from '../services/chat-view.service';
import type { RuntimePlanReviewAction, RuntimePlanReviewDecision } from '../services/chat-runtime-interaction-host.service';

interface AilyChatE2eHarnessOptions {
  readonly engine: ChatEngineService;
  readonly viewState: ChatViewService;
  readonly readRenderingDiagnostics?: () => AilyChatE2eRenderingDiagnostics;
}

interface AilyChatE2eSnapshot {
  readonly currentMode: string;
  readonly selectedMode: unknown;
  readonly currentCustomAgentTarget?: string;
  readonly currentResolvedMode: unknown;
  readonly inputValue: string;
  readonly isWaiting: boolean;
  readonly sessionId: string;
  readonly runtimeState: unknown;
  readonly visibleText: string;
  readonly turnResponses: readonly TurnResponseTurn[];
  readonly rendering?: AilyChatE2eRenderingDiagnostics;
}

export interface AilyChatE2eRenderingDiagnostics {
  readonly totalDialogItems: number;
  readonly renderedDialogItems: number;
  readonly mountedDialogElements: number;
  readonly virtualRows: number;
  readonly topSpacerHeight: number;
  readonly bottomSpacerHeight: number;
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly scrollLock: boolean;
  readonly virtualWindowStartIndex: number;
  readonly virtualWindowEndIndex: number;
  readonly measuredRowCount: number;
}

interface AilyChatE2eHarnessApi {
  installDeterministicRuntime(): Promise<AilyChatE2eSnapshot>;
  selectAsk(): Promise<AilyChatE2eSnapshot>;
  selectAgent(): Promise<AilyChatE2eSnapshot>;
  selectPlan(): Promise<AilyChatE2eSnapshot>;
  newSession(): Promise<AilyChatE2eSnapshot>;
  readTurns(sessionId: string): readonly TurnResponseTurn[];
  send(text: string): Promise<AilyChatE2eSnapshot>;
  startImplementation(): Promise<AilyChatE2eSnapshot>;
  sendWhileDetached(text: string): Promise<AilyChatE2eSnapshot>;
  snapshot(): AilyChatE2eSnapshot;
}

declare global {
  interface Window {
    __AILY_CHAT_E2E__?: AilyChatE2eHarnessApi;
  }
}

type DeterministicRun = (llmText: string, displayText?: string) => Promise<void>;

type EnginePrivateAccess = {
  currentMode: string;
  selectedMode: unknown;
  currentResolvedMode: unknown;
  inputValue: string;
  isWaiting: boolean;
  sessionId: string;
  chatService: {
    currentCustomAgentTarget?: string;
  };
  switchToMode: (mode: string) => Promise<void>;
  newChat?: () => Promise<void>;
  ensureSessionReadyForSubmit: () => Promise<string | null>;
  submitUserText: (content: string, options?: { clearInput?: boolean; sessionId?: string | null }) => Promise<void>;
  detachView: () => void;
  chatSessionRuntimeStore?: { read?: (sessionId?: string | null) => unknown };
  readSessionTurnResponses?: (sessionId: string) => readonly TurnResponseTurn[];
  replaceSessionModelTurnResponses?: (
    sessionId: string,
    turnResponses: readonly TurnResponseTurn[],
    ownerPolicy?: { readonly allowForkedTurns?: boolean; readonly source?: string },
  ) => readonly TurnResponseTurn[] | void;
  syncExecutionRuntimeTurnResponses?: (
    sessionId: string,
    turnResponses: readonly TurnResponseTurn[],
  ) => void;
  resolveCurrentViewSessionResource?: () => string;
  resolveActiveRuntimeSessionId?: () => string;
  resolveRuntimeResolvedMode?: (sessionId?: string | null) => unknown;
  applyPlanReviewTransitionBeforeResume?: (
    sessionId: string | null | undefined,
    pendingReview: {
      readonly id: string;
      readonly title: string;
      readonly content: string;
      readonly actions: readonly RuntimePlanReviewAction[];
      readonly canProvideFeedback: boolean;
    },
    result: RuntimePlanReviewDecision,
    currentRequestPermissionLevel?: string,
  ) => Promise<void>;
  startImplementationFromPlanPart?: (sessionId?: string | null) => Promise<void>;
  attachCurrentSessionView?: () => Promise<void>;
  lexStream?: {
    hydrateTurnResponses?: (
      sessionId: string,
      turnResponses: readonly TurnResponseTurn[],
      options?: { readonly visibility?: string },
    ) => void;
    turns?: {
      complete?: (response: string) => void;
    };
    turn?: {
      run?: DeterministicRun;
    };
  };
  triggerSyncDetectChanges?: () => void;
};

function readElectronEnv(key: string): Promise<string | undefined> {
  const electronApi = (window as unknown as {
    electronAPI?: { env?: { get?: (name: string) => Promise<string | undefined> } };
  }).electronAPI;
  return electronApi?.env?.get?.(key) ?? Promise.resolve(undefined);
}

function getCurrentSessionId(engine: EnginePrivateAccess): string {
  const viewSessionId = engine.resolveCurrentViewSessionResource?.();
  if (typeof viewSessionId === 'string' && viewSessionId.trim().length > 0) {
    return viewSessionId.trim();
  }

  const runtimeSessionId = engine.resolveActiveRuntimeSessionId?.();
  if (typeof runtimeSessionId === 'string' && runtimeSessionId.trim().length > 0) {
    return runtimeSessionId.trim();
  }

  return typeof engine.sessionId === 'string' ? engine.sessionId.trim() : '';
}

function cloneTurnResponseTurn(turn: TurnResponseTurn): TurnResponseTurn {
  return {
    ...turn,
    request: {
      ...turn.request,
      metadata: turn.request.metadata ? { ...turn.request.metadata } : undefined,
    },
    rounds: [...turn.rounds],
    response: {
      ...turn.response,
      parts: turn.response.parts.map((part) => ({ ...part })),
      continuation: turn.response.continuation
        ? {
            ...turn.response.continuation,
            pendingState: turn.response.continuation.pendingState
              ? { ...turn.response.continuation.pendingState }
              : undefined,
            budgets: turn.response.continuation.budgets
              ? { ...turn.response.continuation.budgets }
              : undefined,
            diagnostics: turn.response.continuation.diagnostics
              ? { ...turn.response.continuation.diagnostics }
              : undefined,
          }
        : undefined,
    },
    responseModel: turn.responseModel
      ? { ...turn.responseModel }
      : undefined,
  };
}

function buildDeterministicResponse(engine: EnginePrivateAccess, prompt: string): {
  readonly text: string;
  readonly parts?: NonNullable<TurnResponseTurn['response']['parts']>;
  readonly continuation?: TurnResponseTurn['response']['continuation'];
} {
  const selectedMode = engine.selectedMode as { readonly modeId?: string; readonly customAgentTarget?: string } | null | undefined;
  const normalizedPrompt = prompt.trim();
  const selectedModeId = typeof selectedMode?.modeId === 'string'
    ? selectedMode.modeId.trim().toLowerCase()
    : '';

  if (engine.currentMode === 'plan' || selectedModeId === 'plan') {
    const text = [
      'Deterministic plan:',
      '1. Inspect the requested change.',
      '2. Identify affected files.',
      '3. Hand off implementation to Agent when approved.',
    ].join('\n');
    return {
      text,
      parts: [{
        type: 'plan',
        partId: 'plan:e2e-proposed',
        status: 'completed',
        text,
        source: 'proposed_plan',
      } as any],
    };
  }

  if (engine.currentMode === 'ask' && /write|edit|modify|create|delete|实现|修改|写入/.test(normalizedPrompt)) {
    return {
      text: 'Ask mode is read-only. Switch to Agent before making workspace changes.',
    };
  }

  if (/^@Explore\b/i.test(normalizedPrompt)) {
    return {
      text: 'Explore completed as an explicit invocation without changing the selected chat mode.',
    };
  }

  return {
    text: `Deterministic ${engine.currentMode} response: ${normalizedPrompt}`,
  };
}

function completeLatestTurn(engine: EnginePrivateAccess, sessionId: string, prompt: string): void {
  const turns = engine.readSessionTurnResponses?.(sessionId) ?? [];
  if (!turns.length) {
    return;
  }

  const now = Date.now();
  const response = buildDeterministicResponse(engine, prompt);
  engine.lexStream?.turns?.complete?.(response.text);
  const nextTurns = turns.map((turn, index) => {
    if (index !== turns.length - 1) {
      return cloneTurnResponseTurn(turn);
    }

    return {
      ...cloneTurnResponseTurn(turn),
      response: {
        ...turn.response,
        status: 'completed',
        parts: response.parts ?? [{ type: 'markdown', content: response.text }],
        resultText: response.text,
        updatedAt: now,
        ...(response.continuation ? { continuation: response.continuation } : {}),
      },
      updatedAt: now,
    } satisfies TurnResponseTurn;
  });

  const committed = engine.replaceSessionModelTurnResponses?.(sessionId, nextTurns);
  const committedTurns = Array.isArray(committed) ? committed : nextTurns;
  engine.syncExecutionRuntimeTurnResponses?.(sessionId, committedTurns);
  engine.lexStream?.hydrateTurnResponses?.(sessionId, committedTurns, { visibility: 'visibleAttach' });
  engine.triggerSyncDetectChanges?.();
}

function createHarness(options: AilyChatE2eHarnessOptions): AilyChatE2eHarnessApi {
  const engine = options.engine as unknown as EnginePrivateAccess;
  let installed = false;
  let originalRun: DeterministicRun | undefined;

  const snapshot = (): AilyChatE2eSnapshot => {
    const sessionId = getCurrentSessionId(engine);
    const turnResponses = sessionId
      ? (engine.readSessionTurnResponses?.(sessionId) ?? []).map(cloneTurnResponseTurn)
      : [];
    const runtimeState = engine.chatSessionRuntimeStore?.read?.(sessionId) ?? null;
    const visibleText = document.querySelector('app-aily-chat')?.textContent ?? '';
    const rendering = options.readRenderingDiagnostics?.();

    return {
      currentMode: engine.currentMode,
      selectedMode: engine.selectedMode,
      currentCustomAgentTarget: engine.chatService.currentCustomAgentTarget,
      currentResolvedMode: engine.currentResolvedMode,
      inputValue: engine.inputValue,
      isWaiting: engine.isWaiting,
      sessionId,
      runtimeState,
      visibleText,
      turnResponses,
      ...(rendering ? { rendering } : {}),
    };
  };

  const installDeterministicRuntime = async (): Promise<AilyChatE2eSnapshot> => {
    if (!installed && engine.lexStream?.turn?.run) {
      originalRun = engine.lexStream.turn.run.bind(engine.lexStream.turn);
      engine.lexStream.turn.run = async (llmText: string, displayText?: string): Promise<void> => {
        const sessionId = getCurrentSessionId(engine);
        completeLatestTurn(engine, sessionId, displayText || llmText);
      };
      installed = true;
    }

    return snapshot();
  };

  const api: AilyChatE2eHarnessApi = {
    installDeterministicRuntime,
    async selectAsk() {
      await installDeterministicRuntime();
      await engine.switchToMode('ask');
      return snapshot();
    },
    async selectAgent() {
      await installDeterministicRuntime();
      await engine.switchToMode('agent');
      return snapshot();
    },
    async selectPlan() {
      await installDeterministicRuntime();
      await engine.switchToMode('plan');
      return snapshot();
    },
    async newSession() {
      await installDeterministicRuntime();
      await engine.newChat?.();
      return snapshot();
    },
    readTurns(sessionId: string) {
      const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
      return targetSessionId
        ? (engine.readSessionTurnResponses?.(targetSessionId) ?? []).map(cloneTurnResponseTurn)
        : [];
    },
    async send(text: string) {
      await installDeterministicRuntime();
      const sessionId = await engine.ensureSessionReadyForSubmit();
      await engine.submitUserText(text, { clearInput: true, sessionId });
      return snapshot();
    },
    async startImplementation() {
      await installDeterministicRuntime();
      const sessionId = getCurrentSessionId(engine);
      if (typeof engine.startImplementationFromPlanPart === 'function') {
        await engine.startImplementationFromPlanPart(sessionId);
        return snapshot();
      }

      await engine.applyPlanReviewTransitionBeforeResume?.(
        sessionId,
        {
          id: 'e2e-plan-review',
          title: 'Review Plan',
          content: 'Deterministic plan review',
          canProvideFeedback: true,
          actions: [
            { id: 'start_implementation', label: 'Start Implementation', permissionLevel: 'autopilot' },
            { id: 'exit', label: 'Exit Plan Mode' },
          ],
        },
        { approved: true, actionId: 'start_implementation' },
      );
      return snapshot();
    },
    async sendWhileDetached(text: string) {
      await installDeterministicRuntime();
      const sessionId = await engine.ensureSessionReadyForSubmit() ?? getCurrentSessionId(engine);
      const run = engine.lexStream?.turn?.run;
      let resolveRun: (() => void) | undefined;
      if (run) {
        engine.lexStream!.turn!.run = async (llmText: string, displayText?: string): Promise<void> => {
          await new Promise<void>((resolve) => {
            resolveRun = resolve;
            window.setTimeout(resolve, 50);
          });
          completeLatestTurn(engine, sessionId, displayText || llmText);
        };
      }
      const sendPromise = engine.submitUserText(text, { clearInput: true, sessionId });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      engine.detachView();
      resolveRun?.();
      await sendPromise;
      await engine.attachCurrentSessionView?.();
      if (run) {
        engine.lexStream!.turn!.run = run;
      }
      return snapshot();
    },
    snapshot,
  };

  Object.defineProperty(api, 'originalRun', {
    value: originalRun,
    enumerable: false,
  });

  return api;
}

export function exposeAilyChatE2eHarness(options: AilyChatE2eHarnessOptions): void {
  void readElectronEnv('AILY_E2E').then((value) => {
    if (value !== '1') {
      return;
    }

    window.__AILY_CHAT_E2E__ = createHarness(options);
  });
}
