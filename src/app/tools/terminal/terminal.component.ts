import { Component, ElementRef, Input, ViewChild } from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { ElectronService } from '../../services/electron.service';
import { UiService } from '../../services/ui.service';
import { ProjectService } from '../../services/project.service';
import { NzTabsModule } from 'ng-zorro-antd/tabs';

@Component({
  selector: 'app-terminal',
  imports: [NzTabsModule],
  templateUrl: './terminal.component.html',
  styleUrl: './terminal.component.scss',
})
export class TerminalComponent {
  @Input() tab = 'default';
  selectedTabIndex = 0;

  @ViewChild('terminal') terminalEl: ElementRef;

  terminal;
  fitAddon;
  clipboardAddon;
  terminalPid;

  constructor(
    private electronService: ElectronService,
    private uiService: UiService,
    private projectService: ProjectService
  ) { }

  close() {
    this.uiService.closeTool('terminal');
  }

  trash() { 
    this.terminal.write('\x1bc');
    if (this.electronService.isElectron) {
      window['terminal'].sendInput('clear\r');
    }
  }

  ngAfterViewInit(): void {
    this.terminal = new Terminal({
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      scrollback: 1000,
      cursorBlink: true,
      convertEol: true,
    });
    this.terminal.open(this.terminalEl.nativeElement);

    if (this.electronService.isElectron) {
      this.nodePtyInit();
    } else {
      this.cloudPtyInit();
    }

    this.fitContainer();
    this.listenRightClick();

    this.terminal.onData(data => {
      window['terminal'].sendInput(data);
    });

    window['terminal'].onData((data) => {
      // console.log(data);
      this.terminal.write(data);
    })
  }

  ngOnDestroy(): void {
    this.closeNodePty();
    this.terminalEl.nativeElement.removeEventListener('contextmenu', this.contextMenuListener);
    this.resizeObserver.disconnect();
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
            window['terminal'].resize({ pid: this.terminalPid, cols: dimensions.cols, rows: dimensions.rows });
          }
        }
      }, 100);
    });
    this.resizeObserver.observe(this.terminalEl.nativeElement);
  }

  // 监听右键点击
  contextMenuListener;
  listenRightClick() {
    this.clipboardAddon = new ClipboardAddon();
    this.terminal.loadAddon(this.clipboardAddon);
    this.contextMenuListener = (event) => {
      event.preventDefault();
      navigator.clipboard.readText().then(text => {
        if (text) {
          this.terminal.write(text);
        }
      }).catch(err => {
        console.error('获取剪贴板内容失败:', err);
      });
    };
    this.terminalEl.nativeElement.addEventListener('contextmenu', this.contextMenuListener);
  }

  nodePtyInit() {
    window['ipcRenderer'].on('terminal-created', (event, data) => {
      this.terminalPid = data.pid;
      // console.log('终端已创建，PID:', this.terminalPid);
    });
    // console.log("currentPrj: ", this.projectService.currentProject)
    // 初始化本地工具
    window['terminal'].init({
      cols: 120,
      rows: 200,
      cwd: this.projectService.currentProject
    });
  }

  cloudPtyInit() {
    // 初始化云端工具
  }

  closeNodePty() {
    window['terminal'].close({ pid: this.terminalPid });
  }
}
