import { Component, Input, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ToolApprovalAction, ToolApprovalScope } from '../../../helpers/tool-approval-ui';
import { AILY_CONFIRMATION_RESULT_EVENT } from '../../../helpers/interaction-events';
import {
  isTerminalCommandToolName,
  normalizeReadSideToolName,
} from '../../../core/tool-name-normalizer';
import { ChatCommandPreviewComponent } from '../chat-command-preview/chat-command-preview.component';
import { ChatConfirmationActionsComponent, type ChatConfirmationActionOption } from '../chat-confirmation-actions/chat-confirmation-actions.component';
import { ChatPartHeaderShellComponent } from '../chat-part-header-shell.component';

@Component({
  selector: 'x-aily-confirmation-viewer',
  standalone: true,
  imports: [CommonModule, ChatCommandPreviewComponent, ChatConfirmationActionsComponent, ChatPartHeaderShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'class': 'aa-container',
    '[class.aa-done]': 'resolved',
    '[class.aa-embedded]': 'embedded',
  },
  template: `
    @if (!embedded) {
      <aily-chat-part-header-shell
        [title]="title"
        [subtitle]="subtitle"
        [meta]="headerMeta"
        [pill]="headerPill"
        [pillTone]="headerTone"
        [tone]="headerTone"
        [iconClass]="headerIconClass"
        [showChevron]="showBody"
        [clickable]="showBody"
        [expanded]="showBody && !collapsed"
        (toggleRequested)="toggleCollapsed()"></aily-chat-part-header-shell>
    }

    @if (embedded && embeddedStatusText) {
      <div class="aa-embedded-status" [attr.data-tone]="headerTone">
        <i class="aa-embedded-status-icon" [class]="resolvedIconClass || headerIconClass"></i>
        <span class="aa-embedded-status-text">{{ embeddedStatusText }}</span>
      </div>
    }

    @if (showBody && (!collapsed || embedded)) {
      <div class="aa-body" [class.aa-body-embedded]="embedded">
        @if (commandPreview) {
          <aily-chat-command-preview class="aa-command-block" [command]="commandPreview" [meta]="commandMeta || null" />
        }
        @if (showDisplayMessage) {
          <div class="aa-message">{{ displayMessage }}</div>
        }
        @if (!resolved) {
          <div class="aa-actions">
            <aily-chat-confirmation-actions
              [primaryLabel]="primaryButtonLabel"
              [primaryValue]="primaryActionValue"
              [primaryTooltip]="primaryButtonTooltip"
              [primaryDisabled]="primaryActionDisabled"
              [moreActionsTooltip]="moreActionsTooltip"
              [options]="approvalActionOptions"
              (approve)="onApproveFromActions($event)"
              (reject)="onReject()"
            />
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host {
      margin: 0;
      display: block;
      min-width: 0;
    }

    .aa-body {
      display: flex;
      flex-direction: column;
      gap: 5px;
      border-radius: 0;
      padding: 0;
      background: transparent;
      border: none;
      transition: none;
    }

    :host(:not(.aa-embedded)) .aa-body {
      margin-top: 5px;
    }

    .aa-body-embedded {
      margin-top: 0;
      padding: 0;
    }

    .aa-done { opacity: 0.88; }

    .aa-embedded-status {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px;
      font-size: 11px;
      line-height: 1.35;
      color: var(--chat-fg-dim, #8e8e8e);
    }

    .aa-embedded-status[data-tone='success'] {
      color: var(--chat-success, #89d185);
    }

    .aa-embedded-status[data-tone='warning'] {
      color: var(--chat-warn, #cca700);
    }

    .aa-embedded-status-icon {
      font-size: 12px;
      line-height: 1;
    }

    .aa-message {
      margin-top: 0;
      font-size: 11px;
      color: var(--chat-fg-dim, #8e8e8e);
      line-height: 1.35;
      word-break: break-word;
      overflow-wrap: break-word;
      white-space: pre-wrap;
      padding: 5px 5px 0 5px;
    }
    .aa-command-block {
      margin-top: 0;
    }

    .aa-actions {
      margin-top: 0;
      display: block;
    }

  `],
})
export class XAilyConfirmationViewerComponent implements OnChanges {
  @Input() data: any = null;
  @Input() embedded = false;

  partId = '';
  kind: 'approval' | 'confirmation' = 'approval';
  askId = '';
  toolCallId = '';
  toolName = '';
  title = '确认操作';
  subtitle = '';
  message = '';
  args: any = null;
  commandPreview = '';
  commandMeta = '';
  displayMessage = '';
  resolved = false;
  approved = false;
  resolvedText = '';
  approvalActions: readonly ToolApprovalAction[] = [];
  primaryScope: ToolApprovalScope = 'once';
  primaryButtonLabel = '允许';
  primaryActionValue = 'once';
  collapsed = false;

  get hasMoreActions(): boolean {
    return this.approvalActions.length > 0;
  }

  get headerTone(): 'neutral' | 'success' | 'warn' {
    if (!this.resolved) {
      return 'neutral';
    }

    return this.approved ? 'success' : 'warn';
  }

  get headerMeta(): string | undefined {
    if (!this.resolved) {
      return undefined;
    }

    return this.formatScopeMeta(this.data?.scope);
  }

  get headerPill(): string | undefined {
    if (!this.resolved) {
      return undefined;
    }

    if (this.kind === 'confirmation') {
      return this.approved ? '已确认' : '已取消';
    }

    return this.approved ? '已允许' : '已跳过';
  }

  get headerIconClass(): string {
    if (this.resolved) {
      return this.approved ? 'fa-light fa-circle-check' : 'fa-light fa-circle-minus';
    }

    return 'fa-light fa-circle-pause';
  }

  get resolvedIconClass(): string {
    if (!this.resolved) {
      return '';
    }

    return this.approved ? 'fa-light fa-circle-check' : 'fa-light fa-circle-minus';
  }

  get primaryActionDisabled(): boolean {
    return this.primaryScope === 'once'
      ? false
      : !!this.approvalActions.find(action => action.scope === this.primaryScope)?.disabled;
  }

  get primaryButtonTooltip(): string {
    if (this.primaryScope === 'once') {
      return '允许这次执行';
    }

    return this.approvalActions.find(action => action.scope === this.primaryScope)?.tooltip || this.primaryButtonLabel;
  }

  get moreActionsTooltip(): string {
    return '显示更多允许选项';
  }

  get showDisplayMessage(): boolean {
    if (!this.displayMessage) {
      return false;
    }

    if (!this.resolved) {
      return true;
    }

    return !this.isBoilerplateConfirmationMessage(this.displayMessage);
  }

  get approvalActionOptions(): readonly ChatConfirmationActionOption[] {
    return this.approvalActions.map(action => ({
      value: action.id || action.scope,
      label: this.getActionMenuLabel(action),
      tooltip: action.tooltip || action.description || action.label,
      disabled: !!action.disabled,
      isSecondary: !!action.isSecondary,
    }));
  }

  get showBody(): boolean {
    return !!this.commandPreview || this.showDisplayMessage || !this.resolved;
  }

  get embeddedStatusText(): string {
    if (!this.resolved) {
      return '';
    }

    return [this.headerPill, this.headerMeta].filter(Boolean).join('，');
  }

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data'] && this.data) {
      this.partId = this.data.partId || '';
      this.kind = this.data.kind === 'confirmation' ? 'confirmation' : 'approval';
      this.askId = this.data.askId || '';
      this.toolCallId = this.data.toolCallId || '';
      this.toolName = normalizeReadSideToolName(this.data.toolName || '');
      this.title = this.data.title || '确认操作';
      this.subtitle = this.data.subtitle || '';
      this.message = this.data.message || '';
      this.args = this.data.args;
      this.commandPreview = this.getCommandPreview(this.toolName, this.args);
      this.commandMeta = this.getCommandMeta(this.toolName, this.args);
      this.displayMessage = this.getDisplayMessage(this.toolName, this.message, this.commandPreview);
      this.resolved = !!this.data.resolved;
      this.approved = !!this.data.approved;
      this.approvalActions = Array.isArray(this.data.actions) ? this.data.actions : [];
      this.primaryScope = this.data.primaryScope || 'once';
      this.primaryButtonLabel = this.getPrimaryButtonLabel(this.primaryScope);
      this.primaryActionValue = this.getPrimaryActionValue(this.primaryScope);
      this.resolvedText = this.resolved ? this.formatResolvedText(this.approved, this.data.scope) : '';
      this.collapsed = false;
    }
  }

  toggleCollapsed(): void {
    if (this.embedded || !this.showBody) {
      return;
    }

    this.collapsed = !this.collapsed;
    this.cdr.markForCheck();
  }

  private getCommandPreview(toolName: string, args: any): string {
    if (!args || typeof args !== 'object') {
      return '';
    }

    if (typeof args.command === 'string' && args.command.trim()) {
      return args.command.trim();
    }

    if ((normalizeReadSideToolName(toolName) === 'send_to_terminal') && typeof args.command === 'string') {
      return args.command;
    }

    return '';
  }

  private getCommandMeta(toolName: string, args: any): string {
    if (!args || typeof args !== 'object') {
      return '';
    }

    if (isTerminalCommandToolName(toolName) && typeof args.goal === 'string' && args.goal.trim()) {
      return `目标：${args.goal.trim()}`;
    }

    if (normalizeReadSideToolName(toolName) === 'execute_command' && typeof args.cwd === 'string' && args.cwd.trim()) {
      return `工作目录：${args.cwd.trim()}`;
    }

    return '';
  }

  private getDisplayMessage(toolName: string, message: string, commandPreview: string): string {
    if (!message) {
      return '';
    }

    if (!commandPreview) {
      return message;
    }

    const normalizedToolName = normalizeReadSideToolName(toolName);

    if (isTerminalCommandToolName(normalizedToolName)) {
      return '执行前请确认此终端命令。';
    }

    if (normalizedToolName === 'execute_command') {
      return '执行前请确认此命令。';
    }

    return message;
  }

  private isBoilerplateConfirmationMessage(message: string): boolean {
    return message === '执行前请确认此终端命令。'
      || message === '执行前请确认此命令。';
  }

  getActionMenuLabel(action: ToolApprovalAction): string {
    switch (action.scope) {
      case 'session':
        return '本对话总是允许';
      case 'workspace':
        return '工作区总是允许';
      case 'session-all-terminal':
        return '本对话允许全部终端命令';
      case 'session-safe':
        return '本对话允许安全终端命令';
      default:
        return action.label;
    }
  }

  private getPrimaryButtonLabel(scope: ToolApprovalScope): string {
    if (this.kind === 'confirmation') {
      return '确认';
    }

    switch (scope) {
      case 'session':
        return '本对话总是允许';
      case 'workspace':
        return '工作区总是允许';
      case 'session-all-terminal':
        return '本对话允许全部终端命令';
      case 'session-safe':
        return '本对话允许安全终端命令';
      default:
        return '允许';
    }
  }

  private formatResolvedText(approved: boolean, scope: ToolApprovalScope | undefined): string {
    if (this.kind === 'confirmation') {
      return approved ? '已确认' : '已取消';
    }

    if (!approved) {
      return '已跳过';
    }

    const normalizedScope = scope === 'session-safe' ? 'session-all-terminal' : scope;
    let scopeLabel = '已允许';
    if (normalizedScope === 'workspace') {
      scopeLabel = '已允许，工作区自动执行';
    } else if (normalizedScope === 'session-all-terminal') {
      scopeLabel = '已允许，本对话自动执行终端命令';
    } else if (normalizedScope === 'session') {
      scopeLabel = '已允许，本对话自动执行';
    }

    return scopeLabel;
  }

  private formatScopeMeta(scope: ToolApprovalScope | undefined): string | undefined {
    switch (scope) {
      case 'once':
        return '仅本次执行';
      case 'session':
        return '本对话自动执行';
      case 'workspace':
        return '工作区自动执行';
      case 'session-all-terminal':
        return '本对话自动执行终端命令';
      case 'session-safe':
        return '本对话自动执行终端命令';
      default:
        return undefined;
    }
  }

  onApproveFromActions(value: string): void {
    const action = this.approvalActions.find(candidate => (candidate.id || candidate.scope) === value);
    this.onApprove((action?.scope || value) as ToolApprovalScope, action?.id);
  }

  onApprove(scope: ToolApprovalScope, actionId?: string): void {
    this.resolved = true;
    this.approved = true;
    this.resolvedText = this.formatResolvedText(true, scope);
    this.cdr.markForCheck();
    document.dispatchEvent(new CustomEvent(AILY_CONFIRMATION_RESULT_EVENT, {
      detail: this.toolCallId
        ? { toolCallId: this.toolCallId, approved: true, scope, actionId }
        : { askId: this.askId, partId: this.partId, approved: true, scope, actionId }
    }));
  }

  private getPrimaryActionValue(scope: ToolApprovalScope): string {
    if (scope === 'once') {
      return 'once';
    }

    return this.approvalActions.find(action => action.scope === scope)?.id || scope;
  }

  onReject(): void {
    this.resolved = true;
    this.approved = false;
    this.resolvedText = this.formatResolvedText(false, undefined);
    this.cdr.markForCheck();
    document.dispatchEvent(new CustomEvent(AILY_CONFIRMATION_RESULT_EVENT, {
      detail: this.toolCallId
        ? { toolCallId: this.toolCallId, approved: false, reason: '用户拒绝执行' }
        : { askId: this.askId, partId: this.partId, approved: false, reason: '用户拒绝执行' }
    }));
  }
}
