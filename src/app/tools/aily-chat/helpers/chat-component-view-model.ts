import type { ChatPartStore } from '../core/chat-part-store';
import type { ChatMessage } from '../core/chat-types';
import type { ModelConfig } from '../services/chat.service';
import type { ContextBudgetSnapshot } from '../services/context-budget-snapshot';
import type { IMenuItem } from '../../../configs/menu.config';

interface ChatEngineViewLike {
  readonly list: ChatMessage[];
  readonly partStore: ChatPartStore;
  readonly isWaiting: boolean;
  readonly isCompleted: boolean;
  readonly isLoggedIn: boolean;
  readonly inputValue: string;
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly currentMode: string;
  readonly currentModel: ModelConfig;
  readonly currentModelName: string | undefined;
  readonly contextBudget$: unknown;
  readonly contextBudgetSnapshot: ContextBudgetSnapshot | null;
  readonly debug: boolean;
  readonly prjPath: string;
  readonly prjRootPath: string;
}

interface ChatViewStateLike {
  readonly isStandaloneWindow: boolean;
  readonly bottomHeight: number;
  readonly senderMinHeight: number;
  readonly senderMaxHeight: number;
  readonly showSettings: boolean;
  readonly showAgentSuggestions: boolean;
  readonly agentSuggestions: readonly string[];
  readonly modeMenuItems: IMenuItem[];
  readonly modelMenuItems: IMenuItem[];
}

/**
 * Read-only adapter for the chat component template.
 *
 * Keeps `AilyChatComponent` from re-declaring a long list of passthrough
 * getters while preserving the existing engine/view-state ownership split.
 */
export class ChatComponentViewModel {
  constructor(
    private readonly deps: {
      engine: ChatEngineViewLike;
      viewState: ChatViewStateLike;
    },
  ) {}

  get list(): ChatMessage[] {
    return this.deps.engine.list;
  }

  get partStore(): ChatPartStore {
    return this.deps.engine.partStore;
  }

  get isWaiting(): boolean {
    return this.deps.engine.isWaiting;
  }

  get isCompleted(): boolean {
    return this.deps.engine.isCompleted;
  }

  get isLoggedIn(): boolean {
    return this.deps.engine.isLoggedIn;
  }

  get inputValue(): string {
    return this.deps.engine.inputValue;
  }

  get sessionId(): string {
    return this.deps.engine.sessionId;
  }

  get sessionTitle(): string {
    return this.deps.engine.sessionTitle;
  }

  get currentMode(): string {
    return this.deps.engine.currentMode;
  }

  get currentModel(): ModelConfig {
    return this.deps.engine.currentModel;
  }

  get currentModelName(): string | undefined {
    return this.deps.engine.currentModelName;
  }

  get contextBudget$(): unknown {
    return this.deps.engine.contextBudget$;
  }

  get contextBudgetSnapshot(): ContextBudgetSnapshot | null {
    return this.deps.engine.contextBudgetSnapshot;
  }

  get debug(): boolean {
    return this.deps.engine.debug;
  }

  get prjPath(): string {
    return this.deps.engine.prjPath;
  }

  get prjRootPath(): string {
    return this.deps.engine.prjRootPath;
  }

  get isStandaloneWindow(): boolean {
    return this.deps.viewState.isStandaloneWindow;
  }

  get bottomHeight(): number {
    return this.deps.viewState.bottomHeight;
  }

  get senderMinHeight(): number {
    return this.deps.viewState.senderMinHeight;
  }

  get senderMaxHeight(): number {
    return this.deps.viewState.senderMaxHeight;
  }

  get showSettings(): boolean {
    return this.deps.viewState.showSettings;
  }

  get showAgentSuggestions(): boolean {
    return this.deps.viewState.showAgentSuggestions;
  }

  get agentSuggestions(): readonly string[] {
    return this.deps.viewState.agentSuggestions;
  }

  get modeMenuItems(): IMenuItem[] {
    return this.deps.viewState.modeMenuItems;
  }

  get modelMenuItems(): IMenuItem[] {
    return this.deps.viewState.modelMenuItems;
  }
}