import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

type StateTone = 'info' | 'success' | 'warn' | 'error' | 'neutral';

interface StateBadge {
  label: string;
  value: string;
  tone?: StateTone;
}

interface StateDetailRow {
  id: string;
  title: string;
  subtitle?: string;
  note?: string;
  trailing?: string;
  tone?: StateTone;
}

interface StateDetailSection {
  title: string;
  rows: StateDetailRow[];
}

type InstructionDiagnosticFilter = 'all' | 'active' | 'inactive' | 'overridden' | 'empty' | 'not_found';

interface StateFilterChip {
  id: InstructionDiagnosticFilter;
  label: string;
  count: number;
  tone?: StateTone;
  active: boolean;
}

interface StateViewerData {
  state?: string;
  text?: string;
  progress?: number;
  id?: string;
  kind?: string;
  metadata?: Record<string, unknown> | null;
}

@Component({
  selector: 'x-aily-state-viewer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="ac-state"
      [attr.data-state]="data?.state"
      [attr.data-kind]="data?.kind || null"
      [class.ac-state-has-details]="hasDetails"
      [class.ac-state-expanded]="expanded">
      @if (data?.state === 'doing') {
        <div class="ac-state-progress-bg" [style.animation-duration]="data?.progress != null ? '0s' : '2s'">
          @if (data?.progress != null) {
            <div class="ac-state-progress-fill" [style.width.%]="data.progress"></div>
          }
        </div>
      }
      <div class="ac-state-header">
        <i [class]="stateIconClass"></i>
        <span class="ac-state-text">{{ data?.text }}</span>
        @if (data?.progress != null) {
          <span class="ac-state-pct">{{ data.progress }}%</span>
        }
      </div>

      @if (hasDetails) {
        <div class="ac-state-summary">
          @if (summaryBadges.length > 0) {
            <div class="ac-state-badges">
              @for (badge of summaryBadges; track badge.label + ':' + badge.value) {
                <span class="ac-state-badge" [attr.data-tone]="badge.tone || 'neutral'">
                  <span class="ac-state-badge-label">{{ badge.label }}</span>
                  <span class="ac-state-badge-value">{{ badge.value }}</span>
                </span>
              }
            </div>
          }

          @if (hasExpandableDetails) {
            <button
              type="button"
              class="ac-state-toggle"
              [attr.aria-expanded]="expanded"
              [attr.aria-label]="expanded ? '收起状态详情' : '展开状态详情'"
              (click)="toggleExpanded()">
              <span class="ac-state-toggle-label">{{ expanded ? '收起详情' : '展开详情' }}</span>
              <i class="fa-light fa-chevron-down ac-state-toggle-icon"></i>
            </button>
          }
        </div>

        @if (instructionFilterChips.length > 0) {
          <div class="ac-state-filters">
            @for (chip of instructionFilterChips; track chip.id) {
              <button
                type="button"
                class="ac-state-filter"
                [class.ac-state-filter-active]="chip.active"
                [attr.data-tone]="chip.tone || 'neutral'"
                [attr.aria-pressed]="chip.active"
                (click)="selectInstructionFilter(chip.id)">
                <span class="ac-state-filter-label">{{ chip.label }}</span>
                <span class="ac-state-filter-count">{{ chip.count }}</span>
              </button>
            }
          </div>
        }

        @if (expanded && sections.length > 0) {
          <div class="ac-state-detail">
          @for (section of sections; track section.title) {
            <div class="ac-state-section">
              <div class="ac-state-section-title">{{ section.title }}</div>
              <div class="ac-state-list">
                @for (row of section.rows; track row.id) {
                  <div class="ac-state-list-item" [attr.data-tone]="row.tone || 'neutral'">
                    <div class="ac-state-list-head">
                      <span class="ac-state-list-title">{{ row.title }}</span>
                      @if (row.trailing) {
                        <span class="ac-state-list-pill" [attr.data-tone]="row.tone || 'neutral'">{{ row.trailing }}</span>
                      }
                    </div>
                    @if (row.subtitle) {
                      <div class="ac-state-list-subtitle">{{ row.subtitle }}</div>
                    }
                    @if (row.note) {
                      <div class="ac-state-list-note">{{ row.note }}</div>
                    }
                  </div>
                }
              </div>
            </div>
          }
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      /* ===== Semantic CSS Variables ===== */
      :host {
        display: block;
        width: 100%;
        min-width: 0;
        --ac-state-bg: #3a3a3a;
        --ac-state-fg: #ccc;
        --ac-state-accent: #1890ff;
        --ac-state-success: #52c41a;
        --ac-state-warning: #faad14;
        --ac-state-error: #ff4d4f;
        --ac-state-progress-bg: rgba(24, 144, 255, 0.08);
        --ac-state-progress-fill: rgba(24, 144, 255, 0.15);
      }

      .ac-state {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 5px;
        font-size: 13px;
        margin: 0;
        background-color: var(--ac-state-bg);
        color: var(--ac-state-fg);
        overflow: hidden;
      }

      .ac-state-header {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 5px;
        width: 100%;
        min-width: 0;
      }

      /* ===== Subtle progress background (VS Code style) ===== */
      .ac-state-progress-bg {
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg,
          var(--ac-state-progress-fill) 0%,
          transparent 50%,
          var(--ac-state-progress-fill) 100%);
        background-size: 200% 100%;
        animation: ac-state-sweep 2s ease-in-out infinite;
        pointer-events: none;
      }
      .ac-state-progress-fill {
        position: absolute;
        inset: 0;
        background: var(--ac-state-progress-fill);
        transition: width 0.3s ease-out;
      }
      @keyframes ac-state-sweep {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      .ac-state[data-state='doing'] i { color: var(--ac-state-accent); }
      .ac-state[data-state='done'] i { color: var(--ac-state-success); }
      .ac-state[data-state='warn'] i { color: var(--ac-state-warning); }
      .ac-state[data-state='error'] i { color: var(--ac-state-error); }
      .ac-state[data-state='info'] i { color: var(--ac-state-accent); }
      .ac-state i { position: relative; flex-shrink: 0; font-size: 14px; margin-right: 5px; }
      .ac-state-text {
        position: relative;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ac-state-pct {
        position: relative;
        font-size: 11px;
        color: #a5a5a5;
        min-width: 32px;
        text-align: right;
      }

      .ac-state-summary {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        min-width: 0;
      }

      .ac-state-detail {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        padding-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
      }

      .ac-state-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        flex: 1;
        min-width: 0;
      }

      .ac-state-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 11px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }

      .ac-state-badge-label {
        color: #8e8e8e;
      }

      .ac-state-badge-value {
        color: #dedede;
      }

      .ac-state-badge[data-tone='info'],
      .ac-state-list-pill[data-tone='info'] {
        color: #91caff;
      }

      .ac-state-badge[data-tone='success'],
      .ac-state-list-pill[data-tone='success'] {
        color: #b7eb8f;
      }

      .ac-state-badge[data-tone='warn'],
      .ac-state-list-pill[data-tone='warn'] {
        color: #ffd666;
      }

      .ac-state-badge[data-tone='error'],
      .ac-state-list-pill[data-tone='error'] {
        color: #ff9c9c;
      }

      .ac-state-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        padding: 4px 8px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        color: #bdbdbd;
        cursor: pointer;
        transition: background 0.2s ease, color 0.2s ease;
      }

      .ac-state-toggle:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #ededed;
      }

      .ac-state-toggle-label {
        font-size: 11px;
        line-height: 1;
      }

      .ac-state-toggle-icon {
        font-size: 10px;
        transition: transform 0.2s ease;
      }

      .ac-state-filters {
        position: relative;
        z-index: 1;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        width: 100%;
      }

      .ac-state-filter {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
        color: #bdbdbd;
        cursor: pointer;
        transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
      }

      .ac-state-filter:hover {
        background: rgba(255, 255, 255, 0.06);
        color: #ededed;
      }

      .ac-state-filter.ac-state-filter-active {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.18);
        color: #ffffff;
      }

      .ac-state-filter-label,
      .ac-state-filter-count {
        font-size: 11px;
        line-height: 1;
      }

      .ac-state-filter-count {
        padding: 1px 5px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
      }

      .ac-state-filter[data-tone='success'] {
        color: #b7eb8f;
      }

      .ac-state-filter[data-tone='warn'] {
        color: #ffd666;
      }

      .ac-state-filter[data-tone='error'] {
        color: #ff9c9c;
      }

      .ac-state-filter[data-tone='info'] {
        color: #91caff;
      }

      .ac-state.ac-state-expanded .ac-state-toggle-icon {
        transform: rotate(180deg);
      }

      .ac-state-section {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ac-state-section-title {
        font-size: 11px;
        font-weight: 600;
        color: #8e8e8e;
        letter-spacing: 0.02em;
      }

      .ac-state-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .ac-state-list-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 7px 8px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.035);
        border: 1px solid rgba(255, 255, 255, 0.04);
      }

      .ac-state-list-item[data-tone='info'] {
        border-left: 2px solid rgba(145, 202, 255, 0.55);
      }

      .ac-state-list-item[data-tone='success'] {
        border-left: 2px solid rgba(183, 235, 143, 0.6);
      }

      .ac-state-list-item[data-tone='warn'] {
        border-left: 2px solid rgba(255, 214, 102, 0.65);
      }

      .ac-state-list-item[data-tone='error'] {
        border-left: 2px solid rgba(255, 156, 156, 0.7);
      }

      .ac-state-list-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .ac-state-list-title {
        color: #ededed;
        font-weight: 500;
      }

      .ac-state-list-pill {
        flex-shrink: 0;
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }

      .ac-state-list-subtitle {
        font-size: 11px;
        color: #a5a5a5;
      }

      .ac-state-list-note {
        font-size: 12px;
        color: #d0d0d0;
        line-height: 1.45;
        white-space: normal;
        word-break: break-word;
      }

      @keyframes ac-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .ac-spin {
        animation: ac-spin 0.8s linear infinite;
        display: inline-block;
      }
    `,
  ],
})
export class XAilyStateViewerComponent implements OnChanges {
  private static readonly expansionStateById = new Map<string, boolean>();

  @Input() data: StateViewerData | null = null;

  summaryBadges: StateBadge[] = [];
  instructionFilterChips: StateFilterChip[] = [];
  sections: StateDetailSection[] = [];
  hasDetails = false;
  hasExpandableDetails = false;
  expanded = false;
  selectedInstructionFilter: InstructionDiagnosticFilter = 'all';

  private expansionIdentity = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data']) {
      this.rebuildDetails();
    }
  }

  get stateIconClass(): string {
    const map: Record<string, string> = {
      doing: 'fa-light fa-spinner-third ac-spin',
      done: 'fa-light fa-circle-check',
      warn: 'fa-light fa-triangle-exclamation',
      error: 'fa-light fa-circle-xmark',
      info: 'fa-light fa-circle-info',
    };
    return map[this.data?.state || ''] || 'fa-light fa-circle-info';
  }

  private rebuildDetails(): void {
    const hadExpandableDetails = this.hasExpandableDetails;

    this.summaryBadges = [];
    this.instructionFilterChips = [];
    this.sections = [];

    const nextExpansionIdentity = this.getExpansionIdentity();
    const expansionStateKey = this.getExpansionStateKey();
    const rememberedExpanded = expansionStateKey
      ? XAilyStateViewerComponent.expansionStateById.get(expansionStateKey)
      : undefined;

    const metadata = this.asRecord(this.data?.metadata);
    if (!this.data?.kind || !metadata) {
      this.hasDetails = false;
      this.hasExpandableDetails = false;
      this.expanded = false;
      this.expansionIdentity = nextExpansionIdentity;
      return;
    }

    switch (this.data.kind) {
      case 'tool_call':
        this.buildToolCallDetails(metadata);
        break;
      case 'instructions':
        this.buildInstructionDetails(metadata);
        break;
      case 'task_graph':
        this.buildTaskGraphDetails(metadata);
        break;
      case 'background_task':
        this.buildBackgroundTaskDetails(metadata);
        break;
      case 'agent_team':
        this.buildAgentTeamDetails(metadata);
        break;
      case 'task_scheduler':
        this.buildTaskSchedulerDetails(metadata);
        break;
      case 'task_autonomy':
        this.buildTaskAutonomyDetails(metadata);
        break;
      default:
        break;
    }

    this.hasDetails = this.summaryBadges.length > 0 || this.sections.length > 0;
    this.hasExpandableDetails = this.sections.length > 0;

    if (!this.hasExpandableDetails) {
      this.expanded = false;
      this.expansionIdentity = nextExpansionIdentity;
      return;
    }

    if (typeof rememberedExpanded === 'boolean') {
      this.expanded = rememberedExpanded;
    } else if (this.expansionIdentity !== nextExpansionIdentity || !hadExpandableDetails) {
      this.expanded = this.shouldDefaultExpand();
    }

    this.expansionIdentity = nextExpansionIdentity;
  }

  private buildToolCallDetails(metadata: Record<string, unknown>): void {
    const toolName = this.asString(metadata['toolName']);
    const phase = this.asString(metadata['phase']);
    const argsSummary = this.asString(metadata['argsSummary']);
    const progress = this.asNumber(metadata['progress']);
    const timeline = this.asRecordArray(metadata['timeline']);

    this.pushBadge('工具', toolName, 'info');
    this.pushBadge('阶段', this.formatNarrativePhase(phase), this.toneFromNarrativePhase(phase));
    if (typeof progress === 'number') {
      this.pushBadge('进度', `${Math.round(progress)}%`, this.toneFromNarrativePhase(phase));
    }

    if (argsSummary) {
      this.sections.push({
        title: '调用参数',
        rows: [{
          id: `${this.asString(metadata['recordId']) || this.data?.id || 'tool'}:args`,
          title: toolName || '工具调用',
          note: argsSummary,
          tone: 'neutral',
        }],
      });
    }

    const rows = timeline.length > 0
      ? timeline.map((entry, index) => this.toToolCallTimelineRow(entry, index))
      : [this.toToolCallTimelineRow(metadata, 0)];

    if (rows.length > 0) {
      this.sections.push({
        title: rows.length > 1 ? '历史时间线' : '当前记录',
        rows,
      });
    }
  }

  toggleExpanded(): void {
    if (!this.hasExpandableDetails) {
      return;
    }
    this.expanded = !this.expanded;

    const expansionStateKey = this.getExpansionStateKey();
    if (expansionStateKey) {
      XAilyStateViewerComponent.expansionStateById.set(expansionStateKey, this.expanded);
    }
  }

  selectInstructionFilter(filterId: InstructionDiagnosticFilter): void {
    if (this.selectedInstructionFilter === filterId) {
      return;
    }

    this.selectedInstructionFilter = filterId;
    this.rebuildDetails();
  }

  private buildTaskGraphDetails(metadata: Record<string, unknown>): void {
    const graphId = this.asString(metadata['graphId']);
    const status = this.asString(metadata['status']);
    const totalNodes = this.asNumber(metadata['totalNodes']);
    const completedNodes = this.asNumber(metadata['completedNodes']);
    const failedNodes = this.asNumber(metadata['failedNodes']);
    const runningNodes = this.asNumber(metadata['runningNodes']);
    const blockedNodes = this.asNumber(metadata['blockedNodes']);

    this.pushBadge('图', graphId, 'info');
    this.pushBadge('状态', this.formatTaskGraphStatus(status), this.toneFromTaskGraphStatus(status));
    if (typeof totalNodes === 'number' && totalNodes > 0) {
      this.pushBadge(
        '进度',
        `${completedNodes || 0}/${totalNodes}`,
        failedNodes ? 'warn' : completedNodes === totalNodes ? 'success' : 'info',
      );
    }
    if (runningNodes) this.pushBadge('运行中', String(runningNodes), 'info');
    if (failedNodes) this.pushBadge('失败', String(failedNodes), 'error');
    if (blockedNodes) this.pushBadge('阻塞', String(blockedNodes), 'warn');

    const rows: StateDetailRow[] = [];
    const seen = new Set<string>();
    const currentNode = this.asRecord(metadata['currentNode']);
    if (currentNode) {
      const row = this.toTaskGraphRow(currentNode, true);
      rows.push(row);
      seen.add(row.id);
    }

    for (const value of this.asArray(metadata['nodeHighlights'])) {
      const node = this.asRecord(value);
      if (!node) continue;
      const row = this.toTaskGraphRow(node, false);
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }

    if (rows.length > 0) {
      this.sections.push({
        title: currentNode ? '当前节点与关键节点' : '关键节点',
        rows,
      });
    }
  }

  private buildBackgroundTaskDetails(metadata: Record<string, unknown>): void {
    const taskId = this.asString(metadata['taskId']);
    const status = this.asString(metadata['status']);
    const agentName = this.asString(metadata['agentName']);
    const description = this.asString(metadata['description']);
    const summary = this.asString(metadata['summary']);
    const progress = this.asNumber(metadata['progress']);
    const startedAt = this.asNumber(metadata['startedAt']);
    const completedAt = this.asNumber(metadata['completedAt']);
    const output = this.asString(metadata['output']);
    const error = this.asString(metadata['error']);
    const activity = this.asRecord(metadata['activity']);

    this.pushBadge('任务', taskId, 'info');
    this.pushBadge('状态', this.formatBackgroundTaskStatus(status), this.toneFromBackgroundTaskStatus(status));
    this.pushBadge('代理', agentName, 'neutral');
    if (typeof progress === 'number') {
      this.pushBadge('进度', `${Math.round(progress)}%`, status === 'running' ? 'info' : 'neutral');
    }
    this.pushBadge('开始', this.formatClock(startedAt), 'neutral');
    this.pushBadge('结束', this.formatClock(completedAt), this.toneFromBackgroundTaskStatus(status));

    const note = error || output || summary;
    if (!note && !activity) {
      return;
    }

    const rows: StateDetailRow[] = [];
    if (note) {
      rows.push({
        id: taskId || 'background-task',
        title: description || taskId || '后台任务',
        subtitle: [
          agentName ? `代理 ${agentName}` : '',
          startedAt != null ? `开始 ${this.formatClock(startedAt)}` : '',
          completedAt != null ? `结束 ${this.formatClock(completedAt)}` : '',
        ].filter(Boolean).join(' · '),
        note,
        trailing: status === 'running' && typeof progress === 'number'
          ? `${Math.round(progress)}%`
          : this.formatBackgroundTaskStatus(status),
        tone: this.toneFromBackgroundTaskStatus(status),
      });
    }

    if (activity) {
      rows.push(this.toBackgroundTaskActivityRow(activity, taskId || 'background-task'));
    }

    this.sections.push({
      title: output || error ? '结果摘要' : activity ? '进度与活动' : '进度摘要',
      rows,
    });
  }

  private buildAgentTeamDetails(metadata: Record<string, unknown>): void {
    const teamId = this.asString(metadata['teamId']);
    const status = this.asString(metadata['status']);
    const roleCount = this.asNumber(metadata['roleCount']);
    const messageCount = this.asNumber(metadata['messageCount']);
    const graphId = this.asString(metadata['graphId']);

    this.pushBadge('团队', teamId, 'info');
    this.pushBadge('状态', this.formatAgentTeamStatus(status), this.toneFromAgentTeamStatus(status));
    if (typeof roleCount === 'number') this.pushBadge('角色', String(roleCount), 'neutral');
    if (typeof messageCount === 'number') this.pushBadge('消息', String(messageCount), 'neutral');
    this.pushBadge('任务图', graphId, 'neutral');

    const roleRows: StateDetailRow[] = [];
    for (const value of this.asArray(metadata['roles'])) {
      const role = this.asRecord(value);
      if (!role) continue;
      roleRows.push(this.toAgentTeamRoleRow(role));
    }
    if (roleRows.length > 0) {
      this.sections.push({ title: '角色分工', rows: roleRows });
    }

    const messageRows: StateDetailRow[] = [];
    for (const value of this.asArray(metadata['recentMessages'])) {
      const message = this.asRecord(value);
      if (!message) continue;
      messageRows.push(this.toAgentTeamMessageRow(message));
    }
    if (messageRows.length > 0) {
      this.sections.push({ title: '最近消息', rows: messageRows });
    }
  }

  private buildTaskSchedulerDetails(metadata: Record<string, unknown>): void {
    const scheduleId = this.asString(metadata['scheduleId']);
    const phase = this.asString(metadata['phase']);
    const schedulerStatus = this.asString(metadata['schedulerStatus']);
    const launchKind = this.asString(metadata['launchKind']);
    const launchMode = this.asString(metadata['launchMode']);
    const scheduleCount = this.asNumber(metadata['scheduleCount']);

    this.pushBadge('调度', scheduleId, 'info');
    this.pushBadge('阶段', this.formatTaskSchedulerPhase(phase), this.toneFromTaskSchedulerPhase(phase));
    this.pushBadge('服务', this.formatTaskSchedulerStatus(schedulerStatus), schedulerStatus === 'running' ? 'info' : 'neutral');
    if (launchKind || launchMode) {
      const value = [this.formatLaunchKind(launchKind), this.formatLaunchMode(launchMode)].filter(Boolean).join(' · ');
      this.pushBadge('触发', value, launchMode === 'async' ? 'info' : 'neutral');
    }
    if (typeof scheduleCount === 'number' && scheduleCount > 0) {
      this.pushBadge('计划数', String(scheduleCount), 'neutral');
    }
  }

  private buildTaskAutonomyDetails(metadata: Record<string, unknown>): void {
    const status = this.asString(metadata['status']);
    const phase = this.asString(metadata['phase']);
    const reason = this.asString(metadata['reason']);
    const consecutiveFailures = this.asNumber(metadata['consecutiveFailures']);
    const maxConsecutiveFailures = this.asNumber(metadata['maxConsecutiveFailures']);

    this.pushBadge('状态', this.formatTaskAutonomyStatus(status), this.toneFromTaskAutonomyStatus(status));
    this.pushBadge('事件', this.formatTaskAutonomyPhase(phase), this.toneFromTaskAutonomyPhase(phase));
    if (typeof consecutiveFailures === 'number' && typeof maxConsecutiveFailures === 'number') {
      this.pushBadge('连续失败', `${consecutiveFailures}/${maxConsecutiveFailures}`, consecutiveFailures > 0 ? 'warn' : 'success');
    }
    this.pushBadge('原因', this.formatTaskAutonomyReason(reason), reason && reason !== 'manual_stop' ? 'warn' : 'neutral');
  }

  private buildInstructionDetails(metadata: Record<string, unknown>): void {
    const hostId = this.asString(metadata['hostId']);
    const modelFamily = this.asString(metadata['modelFamily']);
    const activeCount = this.asNumber(metadata['activeCount']) || 0;
    const inactiveCount = this.asNumber(metadata['inactiveCount']) || 0;
    const overriddenCount = this.asNumber(metadata['overriddenCount']) || 0;
    const emptyCount = this.asNumber(metadata['emptyCount']) || 0;
    const notFoundCount = this.asNumber(metadata['notFoundCount']) || 0;
    const capabilities = this.asArray(metadata['capabilities'])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    const diagnostics = this.asRecordArray(metadata['diagnostics']);
    const filterCounts = this.collectInstructionDiagnosticCounts(diagnostics);

    this.selectedInstructionFilter = this.resolveInstructionFilter(this.selectedInstructionFilter, filterCounts);
    this.instructionFilterChips = this.buildInstructionFilterChips(filterCounts, this.selectedInstructionFilter);

    this.pushBadge('Host', hostId, 'info');
    this.pushBadge('模型族', modelFamily, 'neutral');
    this.pushBadge('生效', String(activeCount), activeCount > 0 ? 'success' : 'neutral');
    if (inactiveCount > 0) this.pushBadge('条件跳过', String(inactiveCount), 'warn');
    if (overriddenCount > 0) this.pushBadge('被覆盖', String(overriddenCount), 'warn');
    if (emptyCount > 0) this.pushBadge('空文件', String(emptyCount), 'warn');
    if (notFoundCount > 0) this.pushBadge('未发现', String(notFoundCount), 'neutral');
    if (capabilities.length > 0) this.pushBadge('能力', String(capabilities.length), 'info');

    if (hostId || modelFamily || capabilities.length > 0) {
      this.sections.push({
        title: '运行上下文',
        rows: [{
          id: `${this.data?.id || 'instructions'}:context`,
          title: hostId || 'Instruction context',
          subtitle: [modelFamily ? `模型 ${modelFamily}` : '', capabilities.length > 0 ? `能力 ${capabilities.join(', ')}` : '']
            .filter(Boolean)
            .join(' · '),
          trailing: this.asString(metadata['summary']),
          tone: 'info',
        }],
      });
    }

    if (this.selectedInstructionFilter === 'all') {
      const activeRows: StateDetailRow[] = [];
      const skippedRows: StateDetailRow[] = [];
      for (const diagnostic of diagnostics) {
        const row = this.toInstructionDiagnosticRow(diagnostic);
        if (this.asBoolean(diagnostic['active'])) {
          activeRows.push(row);
        } else {
          skippedRows.push(row);
        }
      }

      if (activeRows.length > 0) {
        this.sections.push({ title: '已生效规则', rows: activeRows });
      }
      if (skippedRows.length > 0) {
        this.sections.push({ title: '跳过与覆盖', rows: skippedRows });
      }
      return;
    }

    const filteredRows = diagnostics
      .filter(diagnostic => this.matchesInstructionDiagnosticFilter(diagnostic, this.selectedInstructionFilter))
      .map(diagnostic => this.toInstructionDiagnosticRow(diagnostic));

    if (filteredRows.length > 0) {
      this.sections.push({
        title: this.formatInstructionFilterTitle(this.selectedInstructionFilter),
        rows: filteredRows,
      });
    }
  }

  private collectInstructionDiagnosticCounts(diagnostics: readonly Record<string, unknown>[]): Record<InstructionDiagnosticFilter, number> {
    const counts: Record<InstructionDiagnosticFilter, number> = {
      all: diagnostics.length,
      active: 0,
      inactive: 0,
      overridden: 0,
      empty: 0,
      not_found: 0,
    };

    for (const diagnostic of diagnostics) {
      if (this.asBoolean(diagnostic['active'])) {
        counts.active += 1;
        continue;
      }

      switch (this.asString(diagnostic['skipReason'])) {
        case 'inactive':
          counts.inactive += 1;
          break;
        case 'overridden':
          counts.overridden += 1;
          break;
        case 'empty':
          counts.empty += 1;
          break;
        case 'not_found':
          counts.not_found += 1;
          break;
        default:
          break;
      }
    }

    return counts;
  }

  private resolveInstructionFilter(
    current: InstructionDiagnosticFilter,
    counts: Record<InstructionDiagnosticFilter, number>,
  ): InstructionDiagnosticFilter {
    if (current === 'all' || counts[current] > 0) {
      return current;
    }

    return 'all';
  }

  private buildInstructionFilterChips(
    counts: Record<InstructionDiagnosticFilter, number>,
    selected: InstructionDiagnosticFilter,
  ): StateFilterChip[] {
    if (counts.all === 0) {
      return [];
    }

    const options: Array<{ id: InstructionDiagnosticFilter; label: string; tone: StateTone }> = [
      { id: 'all', label: '全部', tone: 'neutral' },
      { id: 'active', label: '已生效', tone: 'success' },
      { id: 'inactive', label: '条件跳过', tone: 'warn' },
      { id: 'overridden', label: '被覆盖', tone: 'warn' },
      { id: 'empty', label: '空文件', tone: 'warn' },
      { id: 'not_found', label: '未发现', tone: 'neutral' },
    ];

    return options
      .filter(option => option.id === 'all' || counts[option.id] > 0)
      .map(option => ({
        id: option.id,
        label: option.label,
        count: counts[option.id],
        tone: option.tone,
        active: option.id === selected,
      }));
  }

  private matchesInstructionDiagnosticFilter(
    diagnostic: Record<string, unknown>,
    filter: InstructionDiagnosticFilter,
  ): boolean {
    if (filter === 'all') {
      return true;
    }

    if (filter === 'active') {
      return this.asBoolean(diagnostic['active']);
    }

    return this.asString(diagnostic['skipReason']) === filter;
  }

  private formatInstructionFilterTitle(filter: InstructionDiagnosticFilter): string {
    const map: Record<InstructionDiagnosticFilter, string> = {
      all: '规则明细',
      active: '已生效规则',
      inactive: '条件跳过',
      overridden: '被覆盖规则',
      empty: '空文件',
      not_found: '未发现文件',
    };

    return map[filter];
  }

  private toTaskGraphRow(node: Record<string, unknown>, isCurrent: boolean): StateDetailRow {
    const nodeId = this.asString(node['nodeId']) || 'node';
    const description = this.asString(node['description']);
    const taskId = this.asString(node['taskId']);
    const status = this.asString(node['status']);
    const attempts = this.asNumber(node['attempts']);
    const executionMode = this.asString(node['executionMode']);
    const note = this.asString(node['note']);
    const subtitleParts = [
      description && description !== nodeId ? `节点 ${nodeId}` : '',
      taskId ? `任务 ${taskId}` : '',
      typeof attempts === 'number' && attempts > 0 ? `尝试 ${attempts}` : '',
      this.formatExecutionMode(executionMode),
      isCurrent ? '当前事件' : '',
    ].filter(Boolean);

    return {
      id: nodeId,
      title: description || taskId || nodeId,
      subtitle: subtitleParts.join(' · '),
      note,
      trailing: this.formatTaskGraphNodeStatus(status),
      tone: this.toneFromTaskGraphNodeStatus(status),
    };
  }

  private toAgentTeamRoleRow(role: Record<string, unknown>): StateDetailRow {
    const roleId = this.asString(role['roleId']) || 'role';
    const description = this.asString(role['description']);
    const agentType = this.asString(role['agentType']);
    const status = this.asString(role['status']);
    const assignedCount = this.asNumber(role['assignedCount']) || 0;
    const runningCount = this.asNumber(role['runningCount']) || 0;
    const completedCount = this.asNumber(role['completedCount']) || 0;
    const failedCount = this.asNumber(role['failedCount']) || 0;

    return {
      id: roleId,
      title: description || roleId,
      subtitle: [description && description !== roleId ? `角色 ${roleId}` : '', agentType].filter(Boolean).join(' · '),
      note: [
        assignedCount ? `分配 ${assignedCount}` : '',
        runningCount ? `运行 ${runningCount}` : '',
        completedCount ? `完成 ${completedCount}` : '',
        failedCount ? `失败 ${failedCount}` : '',
      ].filter(Boolean).join(' · '),
      trailing: this.formatAgentTeamRoleStatus(status),
      tone: this.toneFromAgentTeamRoleStatus(status),
    };
  }

  private toAgentTeamMessageRow(message: Record<string, unknown>): StateDetailRow {
    const messageId = this.asString(message['messageId']) || 'message';
    const fromRoleId = this.asString(message['fromRoleId']) || 'unknown';
    const toRoleId = this.asString(message['toRoleId']) || 'unknown';
    const trigger = this.asString(message['trigger']);
    const nodeId = this.asString(message['nodeId']);
    const content = this.asString(message['content']);

    return {
      id: messageId,
      title: `${fromRoleId} -> ${toRoleId}`,
      subtitle: [this.formatAgentTeamTrigger(trigger), nodeId ? `节点 ${nodeId}` : ''].filter(Boolean).join(' · '),
      note: content,
      trailing: this.formatAgentTeamTrigger(trigger),
      tone: 'info',
    };
  }

  private pushBadge(label: string, value: string | undefined, tone: StateTone = 'neutral'): void {
    if (!value) return;
    this.summaryBadges.push({ label, value, tone });
  }

  private toToolCallTimelineRow(entry: Record<string, unknown>, index: number): StateDetailRow {
    const recordId = this.asString(entry['recordId']) || `tool-row-${index}`;
    const phase = this.asString(entry['phase']);
    const timestamp = this.asNumber(entry['timestamp']);
    const summary = this.asString(entry['summary']);
    const progress = this.asNumber(entry['progress']);
    const progressDetails = this.asRecord(entry['progressDetails']);
    const resultText = this.asString(entry['resultText']);

    return {
      id: recordId,
      title: this.formatNarrativePhase(phase),
      subtitle: [this.formatClock(timestamp), recordId].filter(Boolean).join(' · '),
      note: this.buildToolCallNote(summary, progressDetails, resultText),
      trailing: typeof progress === 'number' ? `${Math.round(progress)}%` : this.formatNarrativePhase(phase),
      tone: this.toneFromNarrativePhase(phase),
    };
  }

  private buildToolCallNote(
    summary: string | undefined,
    progressDetails: Record<string, unknown> | undefined,
    resultText: string | undefined,
  ): string | undefined {
    const notes: string[] = [];
    const pushNote = (value: string | undefined): void => {
      if (!value || notes.includes(value)) {
        return;
      }
      notes.push(value);
    };

    pushNote(summary);
    if (progressDetails) {
      pushNote(this.asString(progressDetails['message']));
      const detail = this.asString(progressDetails['detail']);
      if (detail) {
        pushNote(`详情: ${detail}`);
      }
      const step = this.asString(progressDetails['step']);
      if (step) {
        pushNote(`步骤: ${step}`);
      }
      const statusText = this.asString(progressDetails['statusText']);
      if (statusText) {
        pushNote(`状态: ${statusText}`);
      }
    }
    pushNote(resultText);

    return notes.length > 0 ? notes.join('\n') : undefined;
  }

  private toBackgroundTaskActivityRow(activity: Record<string, unknown>, taskId: string): StateDetailRow {
    const kind = this.asString(activity['kind']);
    const toolName = this.asString(activity['toolName']);
    const agentName = this.asString(activity['agentName']);
    const description = this.asString(activity['description']);
    const summary = this.asString(activity['summary']);
    const detail = this.asString(activity['detail']);
    const step = this.asString(activity['step']);
    const statusText = this.asString(activity['statusText']);
    const resultText = this.asString(activity['resultText']);
    const progress = this.asNumber(activity['progress']);

    const notes = [summary, detail, step ? `步骤: ${step}` : undefined, statusText ? `状态: ${statusText}` : undefined, resultText]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join('\n');

    return {
      id: `${taskId}:activity`,
      title: this.formatBackgroundTaskActivityKind(kind),
      subtitle: [toolName, agentName, description].filter(Boolean).join(' · '),
      note: notes || undefined,
      trailing: typeof progress === 'number' ? `${Math.round(progress)}%` : undefined,
      tone: this.toneFromBackgroundTaskActivityKind(kind),
    };
  }

  private toInstructionDiagnosticRow(diagnostic: Record<string, unknown>): StateDetailRow {
    const id = this.asString(diagnostic['id']) || `${this.data?.id || 'instructions'}:diagnostic`;
    const name = this.asString(diagnostic['logicalName']) || this.asString(diagnostic['name']) || id;
    const source = this.asString(diagnostic['source']);
    const reference = this.asString(diagnostic['reference']);
    const ownerId = this.asString(diagnostic['ownerId']);
    const priority = this.asNumber(diagnostic['priority']);
    const active = this.asBoolean(diagnostic['active']);
    const skipReason = this.asString(diagnostic['skipReason']);
    const overriddenById = this.asString(diagnostic['overriddenById']);
    const activation = this.asRecord(diagnostic['activation']);

    return {
      id,
      title: name,
      subtitle: [this.formatInstructionSource(source), ownerId ? `来源 ${ownerId}` : '', typeof priority === 'number' ? `优先级 ${priority}` : '']
        .filter(Boolean)
        .join(' · '),
      note: this.buildInstructionDiagnosticNote(reference, activation, overriddenById, active, skipReason),
      trailing: active ? '已生效' : this.formatInstructionSkipReason(skipReason),
      tone: this.toneFromInstructionDiagnostic(active, skipReason),
    };
  }

  private buildInstructionDiagnosticNote(
    reference: string | undefined,
    activation: Record<string, unknown> | undefined,
    overriddenById: string | undefined,
    active: boolean,
    skipReason: string | undefined,
  ): string | undefined {
    const notes: string[] = [];
    const explanation = this.describeInstructionDiagnostic(active, skipReason, overriddenById);
    if (explanation) {
      notes.push(explanation);
    }
    if (reference) {
      notes.push(`位置: ${reference}`);
    }
    const activationSummary = this.summarizeInstructionActivation(activation);
    if (activationSummary) {
      notes.push(`条件: ${activationSummary}`);
    }
    return notes.length > 0 ? notes.join('\n') : undefined;
  }

  private describeInstructionDiagnostic(
    active: boolean,
    skipReason: string | undefined,
    overriddenById: string | undefined,
  ): string | undefined {
    if (active) {
      return '当前规则优先级最高，已注入最终 prompt。';
    }

    switch (skipReason) {
      case 'inactive':
        return '当前规则存在激活条件，但未命中当前运行上下文，因此未注入最终 prompt。';
      case 'overridden':
        return overriddenById
          ? `同名规则已被更高优先级条目 ${overriddenById} 覆盖。`
          : '同名规则已被更高优先级条目覆盖。';
      case 'empty':
        return '文件为空，或去除 frontmatter 后没有可注入内容。';
      case 'not_found':
        return '扫描候选路径后未找到该指令文件。';
      default:
        return undefined;
    }
  }

  private summarizeInstructionActivation(activation: Record<string, unknown> | undefined): string | undefined {
    if (!activation) {
      return undefined;
    }

    const enabled = typeof activation['enabled'] === 'boolean' ? activation['enabled'] : undefined;
    const applyTo = this.stringifyStringArray(activation['applyTo']);
    const hostIds = this.stringifyStringArray(activation['hostIds']);
    const modelFamilies = this.stringifyStringArray(activation['modelFamilies']);
    const requiredCapabilities = this.stringifyStringArray(activation['requiredCapabilities']);
    const summary = [
      typeof enabled === 'boolean' ? `enabled=${enabled}` : '',
      applyTo ? `applyTo=${applyTo}` : '',
      hostIds ? `hosts=${hostIds}` : '',
      modelFamilies ? `models=${modelFamilies}` : '',
      requiredCapabilities ? `capabilities=${requiredCapabilities}` : '',
    ].filter(Boolean).join(' · ');

    return summary || undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  }

  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private asRecordArray(value: unknown): Record<string, unknown>[] {
    return this.asArray(value)
      .map(item => this.asRecord(item))
      .filter((item): item is Record<string, unknown> => !!item);
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private asBoolean(value: unknown): boolean {
    return value === true;
  }

  private asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private stringifyStringArray(value: unknown): string | undefined {
    const items = this.asArray(value)
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim());
    return items.length > 0 ? items.join(', ') : undefined;
  }

  private getExpansionIdentity(): string {
    return `${this.data?.kind || ''}:${this.data?.id || ''}`;
  }

  private getExpansionStateKey(): string | undefined {
    return this.asString(this.data?.id);
  }

  private shouldDefaultExpand(): boolean {
    return this.data?.state === 'doing' || this.data?.state === 'warn' || this.data?.state === 'error';
  }

  private formatTaskGraphStatus(status?: string): string {
    const map: Record<string, string> = {
      running: '运行中',
      completed: '已完成',
      failed: '失败',
    };
    return map[status || ''] || (status || '状态未知');
  }

  private formatBackgroundTaskStatus(status?: string): string {
    const map: Record<string, string> = {
      running: '运行中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
    };
    return map[status || ''] || (status || '状态未知');
  }

  private formatNarrativePhase(phase?: string): string {
    const map: Record<string, string> = {
      started: '开始',
      progress: '进度',
      completed: '完成',
      failed: '失败',
      cancelled: '取消',
    };
    return map[phase || ''] || (phase || '事件');
  }

  private formatBackgroundTaskActivityKind(kind?: string): string {
    const map: Record<string, string> = {
      tool_started: '子工具启动',
      tool_progress: '子工具进度',
      tool_completed: '子工具完成',
      tool_failed: '子工具失败',
      subagent_started: '子代理启动',
      subagent_completed: '子代理完成',
      subagent_failed: '子代理失败',
    };
    return map[kind || ''] || '最近活动';
  }

  private formatTaskGraphNodeStatus(status?: string): string {
    const map: Record<string, string> = {
      pending: '等待中',
      ready: '就绪',
      running: '运行中',
      completed: '已完成',
      failed: '失败',
      blocked: '已阻塞',
    };
    return map[status || ''] || (status || '状态未知');
  }

  private formatTaskSchedulerPhase(phase?: string): string {
    const map: Record<string, string> = {
      started: '已启动',
      stopped: '已停止',
      triggered: '已触发',
      trigger_failed: '触发失败',
      skipped: '已跳过',
    };
    return map[phase || ''] || (phase || '阶段未知');
  }

  private formatTaskSchedulerStatus(status?: string): string {
    const map: Record<string, string> = {
      running: '运行中',
      stopped: '已停止',
    };
    return map[status || ''] || (status || '状态未知');
  }

  private formatTaskAutonomyStatus(status?: string): string {
    const map: Record<string, string> = {
      disabled: '已禁用',
      enabled: '已启用',
      stopped: '已停止',
    };
    return map[status || ''] || (status || '状态未知');
  }

  private formatTaskAutonomyPhase(phase?: string): string {
    const map: Record<string, string> = {
      enabled: '已启用',
      stopped: '已停止',
      failure_recorded: '记录失败',
      success_recorded: '记录成功',
    };
    return map[phase || ''] || (phase || '事件');
  }

  private formatTaskAutonomyReason(reason?: string): string {
    const map: Record<string, string> = {
      manual_stop: '手动停止',
      schedule_failure: '调度失败',
      background_task_failure: '后台任务失败',
      graph_failure: '任务图失败',
      max_consecutive_failures: '连续失败超限',
    };
    return map[reason || ''] || reason || '';
  }

  private formatInstructionSource(source?: string): string {
    const map: Record<string, string> = {
      user: '用户',
      project: '项目',
      repo: '仓库',
      host: '宿主',
      plugin: '插件',
    };
    return map[source || ''] || source || '指令';
  }

  private formatInstructionSkipReason(reason?: string): string {
    const map: Record<string, string> = {
      inactive: '条件未命中',
      overridden: '已被覆盖',
      empty: '空文件',
      not_found: '未发现',
    };
    return map[reason || ''] || reason || '已跳过';
  }

  private formatLaunchKind(kind?: string): string {
    const map: Record<string, string> = {
      graph: '任务图',
      task: '任务',
    };
    return map[kind || ''] || (kind || '');
  }

  private formatLaunchMode(mode?: string): string {
    const map: Record<string, string> = {
      async: '异步',
      sync: '同步',
    };
    return map[mode || ''] || (mode || '');
  }

  private formatExecutionMode(mode?: string): string {
    const map: Record<string, string> = {
      async: '异步',
      sync: '同步',
    };
    return map[mode || ''] || '';
  }

  private formatAgentTeamStatus(status?: string): string {
    const map: Record<string, string> = {
      running: '运行中',
      completed: '已完成',
      failed: '失败',
    };
    return map[status || ''] || (status || '状态未知');
  }

  private formatAgentTeamRoleStatus(status?: string): string {
    const map: Record<string, string> = {
      idle: '空闲',
      running: '运行中',
      completed: '已完成',
      failed: '失败',
    };
    return map[status || ''] || (status || '状态未知');
  }

  private formatAgentTeamTrigger(trigger?: string): string {
    const map: Record<string, string> = {
      team_started: '团队启动',
      node_completed: '节点完成',
      node_failed: '节点失败',
    };
    return map[trigger || ''] || (trigger || '协议消息');
  }

  private toneFromTaskGraphStatus(status?: string): StateTone {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'running':
        return 'info';
      default:
        return 'neutral';
    }
  }

  private toneFromTaskGraphNodeStatus(status?: string): StateTone {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'blocked':
        return 'warn';
      case 'running':
      case 'ready':
      case 'pending':
        return 'info';
      default:
        return 'neutral';
    }
  }

  private toneFromBackgroundTaskStatus(status?: string): StateTone {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'cancelled':
        return 'warn';
      case 'running':
        return 'info';
      default:
        return 'neutral';
    }
  }

  private toneFromNarrativePhase(phase?: string): StateTone {
    switch (phase) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'cancelled':
        return 'warn';
      case 'started':
      case 'progress':
        return 'info';
      default:
        return 'neutral';
    }
  }

  private toneFromBackgroundTaskActivityKind(kind?: string): StateTone {
    switch (kind) {
      case 'tool_failed':
      case 'subagent_failed':
        return 'error';
      case 'tool_completed':
      case 'subagent_completed':
        return 'success';
      case 'tool_started':
      case 'tool_progress':
      case 'subagent_started':
        return 'info';
      default:
        return 'neutral';
    }
  }

  private toneFromTaskSchedulerPhase(phase?: string): StateTone {
    switch (phase) {
      case 'trigger_failed':
        return 'error';
      case 'skipped':
        return 'warn';
      case 'triggered':
        return 'info';
      default:
        return 'neutral';
    }
  }

  private toneFromTaskAutonomyStatus(status?: string): StateTone {
    switch (status) {
      case 'enabled':
        return 'success';
      case 'stopped':
        return 'warn';
      default:
        return 'neutral';
    }
  }

  private toneFromTaskAutonomyPhase(phase?: string): StateTone {
    switch (phase) {
      case 'failure_recorded':
      case 'stopped':
        return 'warn';
      case 'success_recorded':
      case 'enabled':
        return 'success';
      default:
        return 'neutral';
    }
  }

  private toneFromInstructionDiagnostic(active: boolean, skipReason?: string): StateTone {
    if (active) {
      return 'success';
    }
    switch (skipReason) {
      case 'inactive':
      case 'overridden':
      case 'empty':
        return 'warn';
      case 'not_found':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  private toneFromAgentTeamStatus(status?: string): StateTone {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'running':
        return 'info';
      default:
        return 'neutral';
    }
  }

  private toneFromAgentTeamRoleStatus(status?: string): StateTone {
    switch (status) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'running':
        return 'info';
      default:
        return 'neutral';
    }
  }

  private formatClock(timestamp?: number): string | undefined {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
      return undefined;
    }

    const date = new Date(timestamp);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
}
