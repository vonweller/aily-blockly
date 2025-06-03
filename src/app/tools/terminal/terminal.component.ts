import { Component, ElementRef, Input, SimpleChanges, ViewChild } from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { ElectronService } from '../../services/electron.service';
import { UiService } from '../../services/ui.service';
import { ProjectService } from '../../services/project.service';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { TerminalService } from './terminal.service';
import { CommonModule } from '@angular/common';
import { LogService } from '../../services/log.service';
import { SimplebarAngularComponent, SimplebarAngularModule } from 'simplebar-angular';
import { AnsiPipe } from './ansi.pipe';

@Component({
  selector: 'app-terminal',
  imports: [CommonModule, NzTabsModule, SimplebarAngularModule, AnsiPipe],
  templateUrl: './terminal.component.html',
  styleUrl: './terminal.component.scss',
})
export class TerminalComponent {
  @Input() tab = 'default'; //error,info,log
  selectedTabIndex = 0;

  @ViewChild('terminal') terminalEl: ElementRef;
  @ViewChild(SimplebarAngularComponent) simplebar: SimplebarAngularComponent;

  terminal;
  fitAddon;
  clipboardAddon;

  get logList() {
    return this.logService.list;
  }

  options = {
    autoHide: true,
    clickOnTrack: true,
    scrollbarMinSize: 50,
  };


  constructor(
    private electronService: ElectronService,
    private uiService: UiService,
    private projectService: ProjectService,
    private terminalService: TerminalService,
    private logService: LogService
  ) { }

  close() {
    this.uiService.closeTool('terminal');
  }

  trash() {
    if (this.selectedTabIndex == 1) {
      this.logService.clear();
      return
    }
    this.terminal.write('\x1bc');
    if (this.electronService.isElectron) {
      this.terminalService.send('clear\r');
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tab']) {
      switch (this.tab) {
        case 'default':
          this.selectedTabIndex = 0;
          break;
        case 'error':
          this.selectedTabIndex = 1;
          break;
        default:
          break;
      }
    }
  }

  async ngAfterViewInit() {
    this.terminal = new Terminal({
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      scrollback: 1000,
      cursorBlink: true,
      convertEol: true,
    });
    this.terminal.open(this.terminalEl.nativeElement);

    if (this.electronService.isElectron) {
      await this.nodePtyInit();
    } else {
      await this.cloudPtyInit();
    }

    this.fitContainer();
    this.listenRightClick();

    this.terminal.onData(input => {
      this.terminalService.send(input);
    });

    window['terminal'].onData((data) => {
      this.terminal.write(data);
    })

    setTimeout(() => this.scrollToBottom(), 100);
    this.logService.stateSubject.subscribe((opts) => {
      console.log('logService stateSubject', opts);
      
      console.log(opts.timestamp);
      
      setTimeout(() => this.scrollToBottom(), 100);
    })
  }

  ngOnDestroy(): void {
    this.closeNodePty();
    this.terminalEl.nativeElement.removeEventListener('contextmenu', this.contextMenuListener);
    this.resizeObserver.disconnect();
    this.terminal.dispose();
  }

  // 用于监听容器大小变化，改变terminal大小
  resizeObserver;
  resizeTimeout;
  fitContainer() {
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }
      this.resizeTimeout = setTimeout(() => {
        this.fitAddon.fit();
        if (this.electronService.isElectron) {
          const dimensions = this.fitAddon.proposeDimensions();
          if (dimensions && dimensions.cols && dimensions.rows) {
            this.terminalService.resize({ cols: dimensions.cols, rows: dimensions.rows });
          }
        }
      }, 100);
    });
    this.resizeObserver.observe(this.terminalEl.nativeElement);
  }

  // 监听右键点击, 咱贴文本
  contextMenuListener;
  listenRightClick() {
    this.clipboardAddon = new ClipboardAddon();
    this.terminal.loadAddon(this.clipboardAddon);
    this.contextMenuListener = (event) => {
      event.preventDefault();
      navigator.clipboard.readText().then(text => {
        if (text) {
          this.terminalService.send(text);
        }
      }).catch(err => {
        console.error('获取剪贴板内容失败:', err);
      });
    };
    this.terminalEl.nativeElement.addEventListener('contextmenu', this.contextMenuListener);

    // 添加复制功能
    this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      // Ctrl+Shift+C 用于复制
      if (event.type === 'keydown' && event.ctrlKey && event.key === 'c') {
        if (this.terminal.hasSelection()) {
          this.clipboardAddon.copy();
          return false; // 阻止事件继续传播
        }
      }
      // 也可以添加 Ctrl+Shift+V 用于粘贴
      if (event.type === 'keydown' && event.ctrlKey && event.key === 'v') {
        navigator.clipboard.readText().then(text => {
          if (text) {
            this.terminalService.send(text);
          }
        });
        return false;
      }
      return true; // 允许其他键盘事件正常处理
    });
  }

  async nodePtyInit() {
    await this.terminalService.create({
      cols: 120,
      rows: 200,
      cwd: this.projectService.currentProjectPath
    });
  }

  async cloudPtyInit() {
    // 初始化云端工具
  }

  closeNodePty() {
    this.terminalService.close();
  }

  view(item) {

  }

  private scrollToBottom(): void {
    if (this.simplebar.SimpleBar) {
      this.simplebar.SimpleBar.getScrollElement().scrollTop = this.simplebar.SimpleBar.getScrollElement().scrollHeight;
    }
  }
}
