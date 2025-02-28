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
  command: string = '';
  commandPrefix: string = '';
  lastData: string = '';
  dataBuffer: string = '';
  dataTimeout: any;

  constructor(
    private electronService: ElectronService,
    private uiService: UiService,
    private projectService: ProjectService
  ) { }

  close() {
    this.uiService.closeTool('terminal');
    this.closeNodePty('test');
  }

  trash() { }

  ngAfterViewInit(): void {
    this.terminal = new Terminal({
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      scrollback: 1000,
    });
    this.fitAddon = new FitAddon();
    this.terminal.open(this.terminalEl.nativeElement);
    this.clipboardAddon = new ClipboardAddon();
    this.terminal.loadAddon(this.clipboardAddon);
    this.terminal.loadAddon(this.fitAddon);

    this.terminal.write('> ');
    this.terminal.onData((data) => {
      switch (data) {
        case '\r': // Enter
          // this.terminal.write('\r\n');
          this.sendCommand(this.command);
          this.terminal.write('\r\n')
          this.command = '';
          break;
        case '\u007F': // Backspace (DEL)
          if (this.command.length > 0) {
            this.command = this.command.slice(0, -1);
            this.terminal.write('\b \b');
          }
          break;
        default: // Other characters
          this.command += data;
          this.terminal.write(data);
      }
    });

    if (this.electronService.isElectron) {
      this.nodePtyInit();
    } else {
      this.cloudPtyInit();
    }

    window['terminal'].onData((data) => {
      // 判断是否是命令行中的路径前缀
      console.log("newData: ", data);
      this.terminal.write(data);
    })

    this.fitContainer();
  }

  ngOnDestroy(): void {
    this.resizeObserver.disconnect();
  }

  // 用于监听窗口大小变化
  resizeObserver;
  resizeTimeout;
  fitContainer() {
    // 添加窗口resize事件监听，监听terminal元素的大小变化
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }
      this.resizeTimeout = setTimeout(() => {
        this.fitAddon.fit();
        // // 同步更新PTY大小，resize没实现，以后再考虑
        // if (this.electronService.isElectron) {
        //   const dimensions = this.fitAddon.proposeDimensions();
        //   if (dimensions && dimensions.cols && dimensions.rows) {
        //     window['terminal'].resize(dimensions.cols, dimensions.rows);
        //   }
        // }
      }, 50);
    });
    this.resizeObserver.observe(this.terminalEl.nativeElement);
  }

  sendCommand(command: string): void {
    console.log("send command: ", command);
    window['terminal'].sendInput(command);
  }

  nodePtyInit() {
    console.log("currentPrj: ", this.projectService.currentProject)
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

  closeNodePty(pid) {
    window['terminal'].close(pid);
  }
}
