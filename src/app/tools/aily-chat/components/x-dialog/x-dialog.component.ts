import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  EventEmitter,
  signal,
  SimpleChanges,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { XMarkdownComponent } from 'ngx-x-markdown';
import type { StreamingOption, ComponentMap } from 'ngx-x-markdown';
import { AilyChatCodeComponent } from './aily-chat-code.component';
import { ChatAPI } from '../../core/api-endpoints';
import { AilyHost } from '../../core/host';
import { EditCheckpointService } from '../../services/edit-checkpoint.service';
import { ResourceItem } from '../../core/chat-types';
import { ChatPartStore } from '../../core/chat-part-store';
import { ChatMessagePartsComponent } from './chat-message-parts.component';
import {
  extractHistoricalDialogCopyText,
  preprocessHistoricalDialogContent,
} from './x-dialog-compat-content';


@Component({
  selector: 'aily-x-dialog',
  templateUrl: './x-dialog.component.html',
  styleUrls: ['./x-dialog.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, NzToolTipModule, XMarkdownComponent, ChatMessagePartsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class XDialogComponent implements OnChanges, AfterViewChecked, OnDestroy {
  @Input() role = 'user';
  @Input() content = '';
  @Input() doing = false;
  /** 消息来源：mainAgent 为主Agent，其他值为子Agent名称 */
  @Input() source: string = 'mainAgent';
  /** ★ Phase 1：Part 存储引用（由父组件传入） */
  @Input() partStore: ChatPartStore | null = null;
  /** 是否为最后一条 aily 消息（显示操作按钮） */
  @Input() isLastAily = false;
  /** 当前会话 ID */
  @Input() sessionId = '';
  @Input() msgIndex = -1;
  @Input() currentMode = 'agent';
  @Input() currentModelName = '';
  /** 该消息创建时使用的模型名称 */
  @Input() turnModelName = '';
  @Input() isWaiting = false;

  /** 本组件 dialog-box 是否被 hover */
  dialogBoxHovered = false;

  @Output() editAndResend = new EventEmitter<{ msgIndex: number; newText: string; resources: ResourceItem[] }>();
  @Output() editModeToggle = new EventEmitter<{ event: MouseEvent; type: 'mode' }>();
  @Output() editModelToggle = new EventEmitter<{ event: MouseEvent; type: 'model' }>();
  @Output() editAddFile = new EventEmitter<void>();
  @Output() editAddFolder = new EventEmitter<void>();

  @ViewChild('editTextarea') editTextareaRef?: ElementRef<HTMLTextAreaElement>;

  streamContent = signal('');
  streamingConfig = signal<StreamingOption>({ hasNextChunk: false, enableAnimation: false });
  readonly componentMap: ComponentMap = { code: AilyChatCodeComponent };

  /** 是否显示操作栏 */
  showActions = false;
  /** 反馈状态 */
  feedbackState: 'helpful' | 'unhelpful' | null = null;

  // ===== 编辑模式 =====
  isEditing = false;
  editText = '';
  editResources: ResourceItem[] = [];
  showEditAddList = false;

  constructor(
    private editCheckpointService: EditCheckpointService,
    private cdr: ChangeDetectorRef,
  ) {}

  /** 是否可显示操作栏（非 doing 的最后一条 aily 消息） */
  get canShowActions(): boolean {
    return this.isLastAily && !this.doing && this.role === 'aily';
  }

  get canShowLimitActions(): boolean {
    return this.role !== 'user' && !this.doing && this.msgIndex > 0;
  }

  get canShowCheckpointAction(): boolean {
    return !this.doing && this.msgIndex > 0;
  }

  get canRenderCheckpointAnchor(): boolean {
    return this.role === 'user' && this.msgIndex >= 0;
  }

  get showCheckpointAnchor(): boolean {
    return this.canRenderCheckpointAnchor && this.dialogBoxHovered;
  }

  /** 是否可编辑用户消息（非 doing 的 user 消息） */
  get canEditUserMessage(): boolean {
    return this.role === 'user' && !this.doing && !this.isWaiting;
  }

  onDialogMouseEnter(): void {
    this.showActions = true;
    this.dialogBoxHovered = true;
  }

  onDialogMouseLeave(): void {
    this.showActions = false;
    this.dialogBoxHovered = false;
  }

  onRegenerate(): void {
    document.dispatchEvent(new CustomEvent('aily-task-action', {
      bubbles: true, detail: { action: 'regenerate' }
    }));
  }

  onRestoreCheckpoint(): void {
    if (this.msgIndex < 0) return;
    document.dispatchEvent(new CustomEvent('aily-task-action', {
      bubbles: true, detail: { action: 'restoreCheckpoint', listIndex: this.msgIndex }
    }));
  }

  onCopyContent(): void {
    const text = extractHistoricalDialogCopyText(this.content || '');
    navigator.clipboard.writeText(text).catch(() => {});
  }

  onFeedback(feedback: 'helpful' | 'unhelpful'): void {
    if (this.feedbackState === feedback || !this.sessionId) return;
    this.feedbackState = feedback;
    AilyHost.get().auth.getToken!().then(token => {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      fetch(`${ChatAPI.conversationFeedback}/${this.sessionId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ feedback }),
      }).catch(() => {});
    }).catch(() => {});
  }

  // ===== 编辑模式操作 =====

  /** 点击用户消息进入编辑模式 */
  onUserMessageClick(): void {
    if (!this.canEditUserMessage || this.isEditing) return;
    const { text, resources } = this.parseUserContent(this.content || '');
    this.editText = text;
    this.editResources = resources;
    this.showEditAddList = false;
    this.isEditing = true;
    // 下一帧再 focus，确保 @if (isEditing) 已渲染出 textarea
    setTimeout(() => this.editTextareaRef?.nativeElement?.focus(), 0);
  }

  onCancelEdit(): void {
    this.isEditing = false;
    this.editText = '';
    this.editResources = [];
    this.showEditAddList = false;
  }

  onSubmitEdit(): void {
    const trimmed = this.editText.trim();
    if (!trimmed) return;
    this.isEditing = false;
    this.editAndResend.emit({
      msgIndex: this.msgIndex,
      newText: trimmed,
      resources: [...this.editResources],
    });
    this.editText = '';
    this.editResources = [];
    this.showEditAddList = false;
  }

  onEditKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onCancelEdit();
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      this.onSubmitEdit();
    } else if (event.key === 'Enter' && event.ctrlKey) {
      // Ctrl+Enter 换行
      const textarea = event.target as HTMLTextAreaElement;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      this.editText = this.editText.substring(0, start) + '\n' + this.editText.substring(end);
      setTimeout(() => { textarea.selectionStart = textarea.selectionEnd = start + 1; }, 0);
      event.preventDefault();
    }
  }

  onEditRemoveResource(index: number): void {
    if (index >= 0 && index < this.editResources.length) {
      this.editResources.splice(index, 1);
    }
  }

  onEditToggleAddList(): void {
    this.showEditAddList = !this.showEditAddList;
  }

  /** 从父组件接收添加的文件资源 */
  addEditResource(item: ResourceItem): void {
    const exists = this.editResources.some(r =>
      r.type === item.type && (r.path === item.path || r.url === item.url)
    );
    if (!exists) {
      this.editResources.push(item);
      this.cdr.markForCheck();
    }
  }

  /** 从消息 content 中解析出纯文本和 resources */
  private parseUserContent(content: string): { text: string; resources: ResourceItem[] } {
    const resources: ResourceItem[] = [];
    let text = content;

    const attachMatch = content.match(/<(?:attachments|context)>\n?([\s\S]*?)\n?<\/(?:attachments|context)>/);
    if (attachMatch) {
      const inner = attachMatch[1].trim();
      text = content.replace(attachMatch[0], '').trim();

      // 解析参考文件
      const fileSection = inner.match(/参考文件:\n((?:- .+\n?)+)/);
      if (fileSection) {
        const lines = fileSection[1].trim().split('\n');
        for (const line of lines) {
          const path = line.replace(/^- /, '').trim();
          if (path) {
            const name = path.split(/[/\\]/).pop() || path;
            resources.push({ type: 'file', path, name });
          }
        }
      }

      // 解析参考文件夹
      const folderSection = inner.match(/参考文件夹:\n((?:- .+\n?)+)/);
      if (folderSection) {
        const lines = folderSection[1].trim().split('\n');
        for (const line of lines) {
          const path = line.replace(/^- /, '').trim();
          if (path) {
            const name = path.split(/[/\\]/).pop() || path;
            resources.push({ type: 'folder', path, name });
          }
        }
      }

      // 解析参考URL
      const urlSection = inner.match(/参考URL:\n((?:- .+\n?)+)/);
      if (urlSection) {
        const lines = urlSection[1].trim().split('\n');
        for (const line of lines) {
          const url = line.replace(/^- /, '').trim();
          if (url) {
            try {
              const urlObj = new URL(url);
              resources.push({ type: 'url', url, name: urlObj.hostname + urlObj.pathname });
            } catch { /* skip invalid */ }
          }
        }
      }
    }

    return { text, resources };
  }

  private lastRaw = '';

  ngOnChanges(changes: SimpleChanges) {
    if (changes['doing'] || changes['content']) {
      // ★ Phase 2: aily 消息统一走 Part-based 渲染
      if (this.role === 'aily' && this.partStore) {
        this.streamingConfig.set({ hasNextChunk: this.doing, enableAnimation: this.doing });
        return;
      }

      // User 消息 & fallback：预处理后由 x-markdown 渲染
      const content = this.content || '';
      this.streamingConfig.set({ hasNextChunk: this.doing });
      const processed = preprocessHistoricalDialogContent(content);
      if (processed !== this.lastRaw) {
        this.lastRaw = processed;
        this.streamContent.set(processed);
      }
    }
  }

  ngAfterViewChecked(): void { }

  ngOnDestroy(): void { }
}
