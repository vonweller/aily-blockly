/**
 * ChatTerminalPartComponent — 终端命令输出渲染器
 *
 * VS Code 风格终端输出视图：
 *   - Header: 终端图标 + 命令 + 运行状态
 *   - Output: <pre><code> 滚动输出区域（max-height 200px）
 *   - 顶部/底部渐变遮罩
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

@Component({
  selector: 'aily-chat-terminal-part',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="term-container" [class.term-running]="isRunning" [class.term-error]="hasError">
      <!-- Header -->
      <div class="term-header" (click)="toggleCollapse()">
        <i class="fa-solid fa-terminal term-icon"></i>
        <code class="term-cmd">{{ command }}</code>
        <span class="term-status">
          @if (isRunning) {
            <span class="term-spinner"></span>
            <span>运行中…</span>
          } @else if (hasError) {
            <i class="fa-solid fa-circle-xmark term-status-icon term-status-error"></i>
            <span>退出码 {{ exitCode }}</span>
          } @else {
            <i class="fa-solid fa-circle-check term-status-icon term-status-ok"></i>
            <span>完成</span>
          }
        </span>
        <i class="fa-solid" [class.fa-chevron-down]="!collapsed" [class.fa-chevron-right]="collapsed"
           style="font-size: 10px; color: #666; margin-left: auto;"></i>
      </div>

      <!-- Output body -->
      @if (!collapsed && hasOutput) {
        <div class="term-body">
          <div class="term-fade-top"></div>
          <pre class="term-output" #outputEl><code>{{ output }}</code></pre>
          @if (showFadeBottom) {
            <div class="term-fade-bottom"></div>
          }
        </div>
      }

      <!-- Stderr -->
      @if (!collapsed && stderr) {
        <div class="term-body term-stderr-body">
          <pre class="term-output term-stderr"><code>{{ stderr }}</code></pre>
        </div>
      }
    </div>
  `,
  styles: [`
    .term-container {
      border-radius: 8px;
      background: var(--terminal-bg, #1a1a1a);
      border: 1px solid #2a2a2a;
      overflow: hidden;
      font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
      transition: border-color 0.2s;
    }
    .term-container:hover { border-color: #3a3a3a; }
    .term-running { border-color: rgba(24, 144, 255, 0.3); }
    .term-error { border-color: rgba(255, 77, 79, 0.25); }

    .term-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }
    .term-header:hover { background: rgba(255, 255, 255, 0.03); }

    .term-icon {
      font-size: 12px;
      color: #888;
      flex-shrink: 0;
    }
    .term-cmd {
      font-size: 12px;
      color: #ccc;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }

    .term-status {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: #888;
      flex-shrink: 0;
    }
    .term-status-icon { font-size: 12px; }
    .term-status-ok { color: #52c41a; }
    .term-status-error { color: #ff4d4f; }

    /* Spinner */
    .term-spinner {
      width: 12px;
      height: 12px;
      border: 2px solid rgba(24, 144, 255, 0.2);
      border-top-color: #1890ff;
      border-radius: 50%;
      animation: term-spin 0.8s linear infinite;
    }
    @keyframes term-spin {
      to { transform: rotate(360deg); }
    }

    /* Output body */
    .term-body {
      position: relative;
      border-top: 1px solid #2a2a2a;
    }
    .term-output {
      margin: 0;
      padding: 8px 12px;
      font-size: 12px;
      line-height: 1.5;
      color: #b5b5b5;
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .term-output::-webkit-scrollbar { width: 6px; }
    .term-output::-webkit-scrollbar-track { background: transparent; }
    .term-output::-webkit-scrollbar-thumb { background: #3a3a3a; border-radius: 3px; }

    /* Stderr */
    .term-stderr-body { border-top: 1px dashed #3a3a3a; }
    .term-stderr { color: #ff8080; }

    /* Fade gradients */
    .term-fade-top {
      position: absolute;
      top: 0;
      left: 0;
      right: 6px;
      height: 12px;
      background: linear-gradient(to bottom, var(--terminal-bg, #1a1a1a), transparent);
      pointer-events: none;
      z-index: 1;
    }
    .term-fade-bottom {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 6px;
      height: 16px;
      background: linear-gradient(to top, var(--terminal-bg, #1a1a1a), transparent);
      pointer-events: none;
      z-index: 1;
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
  showFadeBottom = false;
  hasError = false;
  hasOutput = false;

  private _shouldAutoScroll = true;

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
      const isScrollable = el.scrollHeight > el.clientHeight;
      this.showFadeBottom = isScrollable && !this._isScrolledToBottom(el);

      // 运行中时自动滚到底部
      if (this.isRunning) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }

  toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    this.cdr.markForCheck();
  }

  private _isScrolledToBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 4;
  }
}
