/**
 * ChatTerminalPartComponent — 终端命令输出渲染器
 *
 * 使用与 confirmation widget 接近的紧凑卡片样式：
 *   - 标题行 + 运行状态
 *   - 命令预览块
 *   - 可折叠输出区
 */
import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ElementRef,
  ViewChild,
  AfterViewChecked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatCommandPreviewComponent } from '../chat-command-preview/chat-command-preview.component';
import { ChatPartHeaderShellComponent } from '../chat-part-header-shell.component';

@Component({
  selector: 'aily-chat-terminal-part',
  standalone: true,
  imports: [CommonModule, ChatCommandPreviewComponent, ChatPartHeaderShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="term-container" [class.thinking]="isRunning">
      <aily-chat-part-header-shell
        [title]="headerTitle"
        [meta]="headerMeta"
        [pill]="headerPill"
        [tone]="statusTone"
        [iconClass]="statusIconClass"
        [iconSpin]="isRunning"
        [showChevron]="hasDetailContent"
        [clickable]="hasDetailContent"
        [expanded]="hasDetailContent && !collapsed"
        (toggleRequested)="toggleCollapse()"></aily-chat-part-header-shell>

      @if (hasDetailContent && !collapsed) {
        <div class="term-body">
          @if (command) {
            <aily-chat-command-preview class="term-command-block" [command]="command" />
          }

          @if (hasOutput) {
            <div class="term-output-block">
              @if (output) {
                <pre class="term-output" #outputEl><code>{{ output }}</code></pre>
              }
              @if (stderr) {
                <pre class="term-output term-stderr"><code>{{ stderr }}</code></pre>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    /*
     * \u7ec8\u7aef\u5bb9\u5668\u2014\u2014\u5bf9\u9f50 think-viewer / subagent \u65e0\u9762\u677f\u98ce\u683c
     * \u5916\u5c42\u65e0\u80cc\u666f\u8272\uff0c header \u53ef\u70b9\u51fb\u5e26 hover\uff0c\u5185\u5bb9\u533a\u5e26\u5de6\u4fa7\u8fde\u63a5\u7ebf
     */
    .term-container {
      position: relative;
      padding: 2px 0;
      color: var(--chat-fg, #cccccc);
      min-width: 0;
    }

    .term-body {
      position: relative;
      padding: 4px 0 6px 20px;
      margin-top: 2px;
      min-width: 0;
    }

    .term-body::before {
      content: '';
      position: absolute;
      left: 9px;
      top: 0;
      bottom: 0;
      width: 1px;
      background-color: var(--chat-border, rgba(255,255,255,0.10));
      mask-image: linear-gradient(to bottom,
        transparent 0px, #000 8px, #000 calc(100% - 8px), transparent 100%);
      -webkit-mask-image: linear-gradient(to bottom,
        transparent 0px, #000 8px, #000 calc(100% - 8px), transparent 100%);
    }

    .term-command-block {
      margin-top: 0;
    }

    .term-output-block {
      margin-top: 6px;
    }

    .term-output {
      margin: 0;
      padding: 4px 0;
      font-size: 12px;
      line-height: 1.6;
      color: var(--chat-fg-dim, #8e8e8e);
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: break-word;
      border: 0;
      background: transparent;
      font-family: Consolas, 'Courier New', monospace;
    }
    .term-output::-webkit-scrollbar { width: 6px; }
    .term-output::-webkit-scrollbar-track { background: transparent; }
    .term-output::-webkit-scrollbar-thumb { background: var(--chat-border, rgba(255,255,255,0.10)); border-radius: 3px; }
    .term-stderr {
      margin-top: 4px;
      color: var(--chat-error, #f14c4c);
    }

    @keyframes term-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `],
})
export class ChatTerminalPartComponent implements OnChanges, AfterViewChecked {
  @Input() command = '';
  @Input() output = '';
  @Input() stderr = '';
  @Input() exitCode: number | undefined;
  @Input() isRunning = false;

  @ViewChild('outputEl') outputEl?: ElementRef<HTMLPreElement>;

  collapsed = false;
  hasError = false;
  hasOutput = false;

  private _shouldAutoScroll = true;

  get headerTitle(): string {
    return '运行终端命令';
  }

  get headerMeta(): string | undefined {
    if (this.hasError) {
      return `退出码 ${this.exitCode}`;
    }

    return undefined;
  }

  get headerPill(): string | undefined {
    if (this.isRunning) {
      return '进行中';
    }

    if (this.hasError) {
      return '失败';
    }

    return undefined;
  }

  get statusTone(): 'info' | 'success' | 'error' {
    if (this.isRunning) {
      return 'info';
    }

    return this.hasError ? 'error' : 'success';
  }

  get hasDetailContent(): boolean {
    return !!this.command || this.hasOutput;
  }

  get statusIconClass(): string {
    if (this.isRunning) return 'fa-light fa-spinner-third';
    return this.hasError ? 'fa-light fa-circle-xmark' : 'fa-light fa-circle-check';
  }

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    this.hasError = this.exitCode != null && this.exitCode !== 0;
    this.hasOutput = !!(this.output || this.stderr);

    // 运行中时自动展开
    if (changes['isRunning'] && this.isRunning) {
      this.collapsed = false;
    }
  }

  ngAfterViewChecked(): void {
    if (this.outputEl && this._shouldAutoScroll) {
      const el = this.outputEl.nativeElement;
      if (this.isRunning) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }

  toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    this.cdr.markForCheck();
  }
}
