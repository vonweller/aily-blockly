import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { filter } from 'rxjs';

import { IMenuItem } from '../../../configs/menu.config';
import {
  insertComposerLineBreak,
  resolveComposerKeyAction as _resolveComposerKeyAction,
  resolveAgentSuggestionKeyAction,
  type AgentSuggestionKeyAction,
  type ComposerKeyAction,
  type ComposerLineBreakEdit,
} from '../helpers/chat-composer-view';
import { AilyChatConfigService, type ReasoningEffortOption } from './aily-chat-config.service';
import { ChatService } from './chat.service';

/**
 * ChatViewService
 *
 * 收拢 aily-chat 组件中的纯视图状态，避免 host shell 继续堆积
 * 与 agent/runtime 无关的 UI 字段与派生逻辑。
 */
@Injectable()
export class ChatViewService {
  readonly senderMinHeight = 180;
  readonly senderMaxHeight = 600;

  currentUrl = '';
  bottomHeight = this.senderMinHeight;
  showSettings = false;
  showAgentSuggestions = false;
  agentSuggestions: string[] = [];

  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly ailyChatConfigService = inject(AilyChatConfigService);
  private readonly chatService = inject(ChatService);
  private readonly destroyRef = inject(DestroyRef);

  private allAgents: string[] = [];

  constructor() {
    this.currentUrl = this.router.url;
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.currentUrl = event.urlAfterRedirects;
      });
  }

  get isStandaloneWindow(): boolean {
    return this.currentUrl === '/aily-chat';
  }

  get modeMenuItems(): IMenuItem[] {
    return [
      {
        name: this.translate.instant('AILY_CHAT.MODE_AGENT_FULL'),
        action: 'agent-mode',
        icon: 'fa-light fa-user-astronaut',
        data: { mode: 'agent' },
      },
      {
        name: this.translate.instant('AILY_CHAT.MODE_QA_FULL'),
        action: 'qa-mode',
        icon: 'fa-light fa-comment-smile',
        data: { mode: 'qa' },
      },
    ];
  }

  get modelMenuItems(): IMenuItem[] {
    const currentModel = this.chatService.currentModel;
    const presets = this.ailyChatConfigService.getModelPresets();
    const models = [...this.ailyChatConfigService.getEnabledModels()].sort((left, right) => {
      const leftCurrent = currentModel?.model === left.model && !currentModel?.presetId;
      const rightCurrent = currentModel?.model === right.model && !currentModel?.presetId;
      if (leftCurrent !== rightCurrent) {
        return leftCurrent ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

    const presetItems = presets
      .map((preset) => {
        const model = this.ailyChatConfigService.resolvePresetModel(preset.id);
        if (!model) {
          return null;
        }

        return this.createModelMenuItem(model, currentModel, {
          description: preset.description,
          preferBillingMeta: true,
        });
      })
      .filter((item): item is IMenuItem => item !== null);

    const concreteModelItems = models.map((model) => this.createModelMenuItem(model, currentModel));

    return [...presetItems, ...concreteModelItems];
  }

  get currentReasoningEffortLabel(): string {
    return this.ailyChatConfigService.getReasoningEffortLabel(this.chatService.currentModel?.reasoningEffort);
  }

  get currentReasoningEffortDisplayLabel(): string {
    return this.ailyChatConfigService.getReasoningEffortDisplayLabel(
      this.ailyChatConfigService.resolveModelReasoningEffort(
        this.chatService.currentModel,
        this.chatService.currentModel?.reasoningEffort,
      ),
    );
  }

  get hasReasoningEffortOptions(): boolean {
    return this.ailyChatConfigService.getSupportedReasoningEfforts(this.chatService.currentModel).length > 0;
  }

  get firstAgentSuggestion(): string | undefined {
    return this.agentSuggestions[0];
  }

  resolveSuggestionKeyAction(key: string): AgentSuggestionKeyAction {
    return resolveAgentSuggestionKeyAction(key, this.agentSuggestions);
  }

  applyComposerLineBreak(value: string, selectionStart: number, selectionEnd: number): ComposerLineBreakEdit {
    return insertComposerLineBreak(value, selectionStart, selectionEnd);
  }

  resolveComposerKeyAction(input: {
    key: string;
    ctrlKey: boolean;
    inputValue: string;
    selectionStart: number;
    selectionEnd: number;
    isWaiting: boolean;
  }): ComposerKeyAction {
    return _resolveComposerKeyAction({
      ...input,
      suggestions: this.agentSuggestions,
    });
  }

  setCurrentUrl(url: string): void {
    this.currentUrl = url;
  }

  setBottomHeight(height: number): void {
    if (typeof height === 'number' && !Number.isNaN(height)) {
      this.bottomHeight = Math.min(this.senderMaxHeight, Math.max(this.senderMinHeight, height));
    }
  }

  setSettingsVisible(visible: boolean): void {
    this.showSettings = visible;
  }

  openSettings(): void {
    this.setSettingsVisible(true);
  }

  toggleSettings(): void {
    this.setSettingsVisible(!this.showSettings);
  }

  closeSettings(): void {
    this.setSettingsVisible(false);
  }

  setAvailableAgents(agentNames: readonly string[]): void {
    this.allAgents = [...new Set(
      agentNames
        .filter((agentName): agentName is string => typeof agentName === 'string')
        .map(agentName => agentName.trim())
        .filter(agentName => agentName.length > 0),
    )].sort((left, right) => left.localeCompare(right));
  }

  updateAgentSuggestions(inputValue: string): void {
    if (!inputValue.startsWith('@')) {
      this.hideAgentSuggestions();
      return;
    }

    const query = inputValue.slice(1).split(/\s/)[0].toLowerCase();
    this.agentSuggestions = this.allAgents.filter((agent) => agent.toLowerCase().startsWith(query));
    this.showAgentSuggestions = this.agentSuggestions.length > 0 && !inputValue.includes(' ');
  }

  hideAgentSuggestions(): void {
    this.showAgentSuggestions = false;
    this.agentSuggestions = [];
  }

  applyAgentSelection(agentName: string): string {
    this.hideAgentSuggestions();
    return `@${agentName} `;
  }

  private createModelMenuItem(
    model: NonNullable<ChatService['currentModel']>,
    currentModel: NonNullable<ChatService['currentModel']> | null,
    options?: {
      description?: string | null;
      preferBillingMeta?: boolean;
    },
  ): IMenuItem {
    const reasoningEfforts = this.ailyChatConfigService.getSupportedReasoningEfforts(model);
    const isCurrentModel = currentModel?.model === model.model && currentModel?.presetId === model.presetId;
    const currentReasoningEffort = isCurrentModel
      ? this.ailyChatConfigService.resolveModelReasoningEffort(model, currentModel?.reasoningEffort)
      : undefined;
    const displayModel = isCurrentModel
      ? {
          ...model,
          reasoningEffort: currentReasoningEffort,
        }
      : model;

    return {
      name: model.name,
      text: this.ailyChatConfigService.getModelMenuMeta(displayModel, { preferBilling: options?.preferBillingMeta ?? false }),
      action: 'select-model',
      current: isCurrentModel,
      tooltip: this.ailyChatConfigService.buildModelTooltip(displayModel, {
        description: options?.description,
      }),
      data: { model },
      hideChildrenArrow: true,
      children: reasoningEfforts.length > 0
        ? reasoningEfforts.map((effort) => this.createReasoningEffortItem(model, effort, currentReasoningEffort))
        : undefined,
    };
  }

  private createReasoningEffortItem(
    model: NonNullable<ChatService['currentModel']>,
    effort: ReasoningEffortOption,
    currentReasoningEffort: ReasoningEffortOption | undefined,
  ): IMenuItem {
    return {
      name: this.ailyChatConfigService.getReasoningEffortDisplayLabel(effort),
      action: 'select-model',
      check: currentReasoningEffort === effort,
      data: {
        model: {
          ...model,
          reasoningEffort: effort,
        },
      },
    };
  }
}