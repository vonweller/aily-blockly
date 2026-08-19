import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild } from '@angular/core';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { PythonRuntimeClient } from '../../../../../services/python-runtime/python-runtime-client';

@Component({
  selector: 'app-python-terminal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './python-terminal.component.html',
  styleUrl: './python-terminal.component.scss',
})
export class PythonTerminalComponent implements AfterViewInit, OnDestroy {
  @ViewChild('terminal', { static: true }) terminalElement!: ElementRef<HTMLElement>;
  @Input({ required: true }) runtime!: PythonRuntimeClient;
  @Input() inputEnabled = false;
  @Input() resizeEnabled = false;
  @Input() resizeDisabledReason = '';

  private terminal?: Terminal;
  private fitAddon?: FitAddon;
  private resizeObserver?: ResizeObserver;
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private disposables: Array<() => void> = [];
  private destroyed = false;

  ngAfterViewInit(): void {
    this.terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      fontSize: 12,
      scrollback: 3000,
      theme: this.readTheme(),
    });
    this.terminal.open(this.terminalElement.nativeElement);
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    const inputDisposable = this.terminal.onData(input => {
      if (!this.inputEnabled) return;
      void this.runtime.sendTerminalInput(input).catch(error => this.terminal?.write(`\r\n[error] ${this.errorText(error)}\r\n`));
    });
    const outputSubscription = this.runtime.terminalOutput$.subscribe(text => this.terminal?.write(text));
    const stderrSubscription = this.runtime.backendStderr$.subscribe(text => this.terminal?.write(`\r\n[backend] ${text}`));
    this.disposables.push(() => inputDisposable.dispose());
    this.disposables.push(() => outputSubscription.unsubscribe());
    this.disposables.push(() => stderrSubscription.unsubscribe());
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(this.terminalElement.nativeElement);
    this.fit();
  }

  clear(): void {
    this.terminal?.clear();
  }

  focus(): void {
    this.terminal?.focus();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeObserver?.disconnect();
    this.disposables.forEach(dispose => dispose());
    this.terminal?.dispose();
  }

  private fit(): void {
    if (this.destroyed || !this.fitAddon) return;
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      if (this.destroyed || !this.fitAddon) return;
      this.fitAddon.fit();
      const dimensions = this.fitAddon.proposeDimensions();
      if (dimensions?.cols && dimensions.rows && this.resizeEnabled) {
        void this.runtime.resizeTerminal(dimensions.cols, dimensions.rows).catch(() => undefined);
      }
    }, 80);
  }

  private readTheme(): ITheme {
    const styles = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    return {
      background: color('--aily-editor-bg', '#262626'),
      foreground: color('--aily-text-primary', '#ffffff'),
      cursor: color('--aily-color-accent', '#61afef'),
      selectionBackground: color('--aily-terminal-selection-bg', 'rgba(38, 121, 218, .45)'),
    };
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
