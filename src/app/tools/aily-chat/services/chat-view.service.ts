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
import { isDefaultAutoPresetSelected } from '../helpers/model-billing-label';
import {
  AilyChatConfigService,
  type ModelPickerControlOption,
  type ModelPresetOption,
  type ReasoningEffortOption,
} from './aily-chat-config.service';
import { AilyChatLanguageModelsService } from './aily-chat-language-models.service';
import { ChatService } from './chat.service';

interface ModelMenuPresetEntry {
  readonly presetId: string;
  readonly sortName: string;
  readonly enabled: boolean;
  readonly item: IMenuItem;
}

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
  private readonly languageModelsService = inject(AilyChatLanguageModelsService);
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
    const presets = this.ailyChatConfigService.getUserVisibleModelPresets();
    const defaultPresetId = this.ailyChatConfigService.getDefaultModelPresetId();
    const promotedPresetIds = this.getPromotedPresetIds(defaultPresetId);
    const visiblePresetIds = new Set<string>();
    const controlPresetEntries = this.ailyChatConfigService.getModelPickerControlPresets();

    for (const [presetId, controlEntry] of Object.entries(controlPresetEntries)) {
      if (controlEntry.featured && presetId !== defaultPresetId) {
        promotedPresetIds.add(presetId);
      }
    }

    const presetEntries = presets
      .map((preset) => {
        const isDefaultPreset = preset.id === defaultPresetId;
        visiblePresetIds.add(preset.id);
        const model = this.ailyChatConfigService.resolvePresetModel(preset.id);
        if (!model) {
          return null;
        }

        return {
          presetId: preset.id,
          sortName: preset.name,
          enabled: preset.enabled,
          item: this.createModelMenuItem(model, currentModel, {
            description: preset.description,
            preferBillingMeta: true,
            disabled: isDefaultPreset ? false : !preset.enabled,
            disabledReason: isDefaultPreset ? undefined : preset.unavailableReason,
            requiredTier: isDefaultPreset ? undefined : preset.requiredTier,
            minimumClientVersion: isDefaultPreset ? undefined : preset.minimumClientVersion,
          }),
        } satisfies ModelMenuPresetEntry;
      })
      .filter((entry): entry is ModelMenuPresetEntry => entry !== null);

    const syntheticPromotedEntries = this.buildSyntheticPromotedEntries(
      promotedPresetIds,
      visiblePresetIds,
      defaultPresetId,
      currentModel,
    );
    const customModelEntries = this.getCustomModelMenuEntries(currentModel);
    const autoEntry = presetEntries.find(entry => entry.presetId === defaultPresetId)
      ?? this.getDefaultPresetMenuEntry(defaultPresetId, currentModel);
    const promotedEntries = this.sortModelMenuPresetEntries(
      [
        ...presetEntries.filter(entry => entry.presetId !== defaultPresetId && promotedPresetIds.has(entry.presetId)),
        ...syntheticPromotedEntries,
      ],
    );
    const otherEntries = this.sortModelMenuPresetEntries(
      [
        ...presetEntries.filter(entry => entry.presetId !== defaultPresetId && !promotedPresetIds.has(entry.presetId)),
        ...customModelEntries,
      ],
    );

    const menuItems: IMenuItem[] = [];
    if (autoEntry) {
      menuItems.push(autoEntry.item);
    }

    if (promotedEntries.length > 0) {
      if (menuItems.length > 0) {
        menuItems.push({ sep: true });
      }
      menuItems.push(...promotedEntries.map(entry => ({
        ...entry.item,
        extra: {
          ...entry.item.extra,
          section: 'promoted-models',
        },
      })));
    }

    if (otherEntries.length > 0) {
      if (menuItems.length > 0) {
        menuItems.push({ sep: true });
      }
      menuItems.push(this.createModelMenuSectionToggle('其他模型', 'other-models'));
      menuItems.push(...otherEntries.map(entry => ({
        ...entry.item,
        extra: {
          ...entry.item.extra,
          section: 'other-models',
        },
      })));
    }

    return menuItems;
  }

  get currentReasoningEffortLabel(): string {
    return this.ailyChatConfigService.getReasoningEffortLabel(
      this.getConfiguredReasoningEffort(this.chatService.currentModel),
    );
  }

  get currentReasoningEffortDisplayLabel(): string {
    const currentAction = this.getCurrentReasoningEffortAction(this.chatService.currentModel);
    if (currentAction) {
      return this.normalizeConfigurationActionLabel(currentAction.label);
    }

    return this.ailyChatConfigService.getReasoningEffortDisplayLabel(
      this.getConfiguredReasoningEffort(this.chatService.currentModel),
    );
  }

  get hasReasoningEffortOptions(): boolean {
    return this.getReasoningEffortMenuItems(this.chatService.currentModel).length > 0;
  }

  get currentReasoningEffortMenuItems(): IMenuItem[] {
    const currentModel = this.chatService.currentModel;
    if (!currentModel) {
      return [];
    }

    return this.getReasoningEffortMenuItems(currentModel)
      .map((item) => this.createReasoningEffortItem(currentModel, item));
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
      disabled?: boolean;
      disabledReason?: 'upgrade' | 'admin' | 'update';
      requiredTier?: string;
      minimumClientVersion?: string;
    },
  ): IMenuItem {
    const isCurrentModel = currentModel?.model === model.model && currentModel?.presetId === model.presetId;
    const configuredReasoningEffort = this.getConfiguredReasoningEffort(model);
    const displayModel = configuredReasoningEffort
      ? {
          ...model,
          reasoningEffort: configuredReasoningEffort,
        }
      : model;

    return {
      name: model.name,
      text: this.ailyChatConfigService.getModelMenuMeta(displayModel, { preferBilling: options?.preferBillingMeta ?? false }),
      action: 'select-model',
      current: isCurrentModel,
      disabled: options?.disabled,
      tooltip: this.ailyChatConfigService.buildModelTooltip(displayModel, {
        description: this.buildPresetTooltipDescription(options),
      }),
      data: { model },
      hideChildrenArrow: true,
    };
  }

  private getReasoningEffortMenuItems(
    model: NonNullable<ChatService['currentModel']> | null | undefined,
  ) {
    const modelId = this.getModelConfigurationId(model);
    if (!model || !modelId || isDefaultAutoPresetSelected(model)) {
      return [];
    }

    const schemaActions = this.languageModelsService.getModelConfigurationActions(modelId, { group: 'navigation' })
      .filter((group) => group.key === 'reasoningEffort')
      .flatMap((group) => group.actions)
      .filter((action) => typeof action.value === 'string')
      .map((action) => ({
        ...action,
        value: action.value as ReasoningEffortOption,
      }));

    if (schemaActions.length > 0) {
      return schemaActions;
    }

    const configuredReasoningEffort = this.getStoredOrDefaultReasoningEffort(model);
    return this.ailyChatConfigService.getSupportedReasoningEfforts(model)
      .map((value) => ({
        id: `fallback.reasoningEffort.${value}`,
        key: 'reasoningEffort',
        label: this.ailyChatConfigService.getReasoningEffortDisplayLabel(value),
        checked: value === configuredReasoningEffort,
        value,
      }));
  }

  private getModelConfigurationId(
    model: NonNullable<ChatService['currentModel']> | null | undefined,
  ): string {
    return typeof model?.presetId === 'string' && model.presetId.trim()
      ? model.presetId.trim()
      : typeof model?.model === 'string'
        ? model.model.trim()
        : '';
  }

  private getCurrentReasoningEffortAction(
    model: NonNullable<ChatService['currentModel']> | null | undefined,
  ) {
    return this.getReasoningEffortMenuItems(model).find((item) => item.checked);
  }

  private getConfiguredReasoningEffort(
    model: NonNullable<ChatService['currentModel']> | null | undefined,
  ): ReasoningEffortOption | undefined {
    const checkedAction = this.getCurrentReasoningEffortAction(model);
    if (checkedAction) {
      return checkedAction.value;
    }

    return this.getStoredOrDefaultReasoningEffort(model);
  }

  private getStoredOrDefaultReasoningEffort(
    model: NonNullable<ChatService['currentModel']> | null | undefined,
  ): ReasoningEffortOption | undefined {
    const modelId = this.getModelConfigurationId(model);
    const configuredReasoningEffort = modelId
      ? this.languageModelsService.getModelConfiguration(modelId)?.['reasoningEffort']
      : undefined;
    if (typeof configuredReasoningEffort === 'string') {
      return configuredReasoningEffort as ReasoningEffortOption;
    }

    return this.ailyChatConfigService.resolveModelReasoningEffort(model, model?.reasoningEffort);
  }

  private normalizeConfigurationActionLabel(label: string): string {
    return label.replace(/\s*\(default\)$/i, '');
  }

  private buildPresetTooltipDescription(options?: {
    description?: string | null;
    disabledReason?: 'upgrade' | 'admin' | 'update';
    requiredTier?: string;
    minimumClientVersion?: string;
  }): string | undefined {
    const description = typeof options?.description === 'string' && options.description.trim()
      ? options.description.trim()
      : undefined;

    if (options?.disabledReason === 'upgrade') {
      const requiredTier = typeof options.requiredTier === 'string' && options.requiredTier.trim()
        ? options.requiredTier.trim().toUpperCase()
        : 'PAID';
      const upgradeMessage = `升级到 ${requiredTier} 后可用`;
      return description ? `${description}\n\n${upgradeMessage}` : upgradeMessage;
    }

    if (options?.disabledReason === 'update') {
      const minimumClientVersion = typeof options.minimumClientVersion === 'string' && options.minimumClientVersion.trim()
        ? options.minimumClientVersion.trim()
        : undefined;
      const updateMessage = minimumClientVersion
        ? `升级客户端到 ${minimumClientVersion} 或更高版本后可用`
        : '升级客户端后可用';
      return description ? `${description}\n\n${updateMessage}` : updateMessage;
    }

    if (options?.disabledReason === 'admin') {
      const adminMessage = '需要管理员权限后可用';
      return description ? `${description}\n\n${adminMessage}` : adminMessage;
    }

    return description;
  }

  private createReasoningEffortItem(
    model: NonNullable<ChatService['currentModel']>,
    item: {
      key: string;
      label: string;
      tooltip?: string;
      checked: boolean;
      value: ReasoningEffortOption;
    },
  ): IMenuItem {
    return {
      name: item.label,
      action: 'select-model',
      check: item.checked,
      tooltip: item.tooltip,
      data: {
        model: {
          ...model,
          reasoningEffort: item.value,
        },
        modelConfiguration: {
          key: item.key,
          value: item.value,
        },
      },
    };
  }

  private getPromotedPresetIds(defaultPresetId: string): Set<string> {
    const promotedPresetIds = new Set<string>();
    const currentPresetId = typeof this.chatService.currentModel?.presetId === 'string'
      ? this.chatService.currentModel.presetId.trim()
      : '';

    if (currentPresetId && currentPresetId !== defaultPresetId) {
      promotedPresetIds.add(currentPresetId);
    }

    for (const presetId of this.chatService.getRecentModelPresetIds()) {
      if (presetId && presetId !== defaultPresetId) {
        promotedPresetIds.add(presetId);
      }
    }

    return promotedPresetIds;
  }

  private buildSyntheticPromotedEntries(
    promotedPresetIds: ReadonlySet<string>,
    visiblePresetIds: ReadonlySet<string>,
    defaultPresetId: string,
    currentModel: NonNullable<ChatService['currentModel']> | null,
  ): ModelMenuPresetEntry[] {
    const syntheticEntries: ModelMenuPresetEntry[] = [];

    for (const presetId of promotedPresetIds) {
      if (!presetId || presetId === defaultPresetId || visiblePresetIds.has(presetId)) {
        continue;
      }

      const preset = this.ailyChatConfigService.getModelPresetById(presetId);
      const controlEntry = this.ailyChatConfigService.getModelPickerControlPresetById(presetId);
      if (!preset && !controlEntry) {
        continue;
      }

      const resolvedModel = this.ailyChatConfigService.resolvePresetModel(presetId);
      const sortName = controlEntry?.label || preset?.name || presetId;

      if (resolvedModel) {
        const item = this.createModelMenuItem(resolvedModel, currentModel, {
          description: preset?.description,
          preferBillingMeta: true,
          disabled: preset ? !preset.enabled : false,
          disabledReason: preset?.unavailableReason,
          requiredTier: preset?.requiredTier,
          minimumClientVersion: preset?.minimumClientVersion,
        });
        item.name = sortName;
        syntheticEntries.push({
          presetId,
          sortName,
          enabled: preset?.enabled ?? true,
          item,
        });
        continue;
      }

      if (controlEntry) {
        syntheticEntries.push({
          presetId,
          sortName,
          enabled: false,
          item: this.createUnavailableModelMenuItem(controlEntry, {
            description: preset?.description,
            disabledReason: preset?.unavailableReason ?? this.resolveSyntheticUnavailableReason(controlEntry),
            requiredTier: preset?.requiredTier,
            minimumClientVersion: preset?.minimumClientVersion ?? controlEntry.minClientVersion,
          }),
        });
      }
    }

    return syntheticEntries;
  }

  private getCustomModelMenuEntries(
    currentModel: NonNullable<ChatService['currentModel']> | null,
  ): ModelMenuPresetEntry[] {
    return this.ailyChatConfigService.getEnabledModels()
      .filter(model => model.isCustom)
      .map((model) => ({
        presetId: model.model,
        sortName: model.name,
        enabled: model.enabled,
        item: this.createModelMenuItem(model, currentModel, {
          description: model.description,
        }),
      }));
  }

  private getDefaultPresetMenuEntry(
    defaultPresetId: string,
    currentModel: NonNullable<ChatService['currentModel']> | null,
  ): ModelMenuPresetEntry | undefined {
    const defaultPreset = this.ailyChatConfigService.getModelPresetById(defaultPresetId);
    const defaultModel = this.ailyChatConfigService.resolvePresetModel(defaultPresetId);
    if (!defaultModel) {
      return undefined;
    }

    return {
      presetId: defaultPresetId,
      sortName: defaultPreset?.name ?? defaultModel.name,
      enabled: true,
      item: this.createModelMenuItem(defaultModel, currentModel, {
        description: defaultPreset?.description,
        preferBillingMeta: true,
        disabled: false,
      }),
    };
  }

  private createUnavailableModelMenuItem(
    controlEntry: ModelPickerControlOption,
    options?: {
      description?: string;
      disabledReason?: 'upgrade' | 'admin' | 'update';
      requiredTier?: string;
      minimumClientVersion?: string;
    },
  ): IMenuItem {
    return {
      name: controlEntry.label,
      action: 'select-model',
      disabled: true,
      tooltip: this.buildPresetTooltipDescription(options),
      hideChildrenArrow: true,
    };
  }

  private resolveSyntheticUnavailableReason(controlEntry: ModelPickerControlOption): 'upgrade' | 'admin' | 'update' {
    if (controlEntry.minClientVersion) {
      return 'update';
    }

    return 'admin';
  }

  private sortModelMenuPresetEntries(entries: readonly ModelMenuPresetEntry[]): ModelMenuPresetEntry[] {
    return [...entries].sort((left, right) => {
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1;
      }

      return left.sortName.localeCompare(right.sortName);
    });
  }

  private createModelMenuSection(name: string, action: string, sectionId?: string): IMenuItem {
    return {
      name,
      action,
      disabled: true,
      extra: sectionId ? { sectionId } : undefined,
    };
  }

  private createModelMenuSectionToggle(name: string, sectionId: string): IMenuItem {
    return {
      name,
      action: `section-toggle-${sectionId}`,
      extra: {
        sectionId,
        collapsed: true,
      },
    };
  }

  private createModelMenuSectionFilter(name: string, sectionId: string): IMenuItem {
    return {
      name,
      action: `section-filter-${sectionId}`,
      extra: {
        sectionId,
      },
    };
  }
}