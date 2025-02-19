import { Component, ElementRef, Input, ViewChild } from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { ElectronService } from '../../services/electron.service';
import { UiService } from '../../services/ui.service';
import { ProjectService } from '../../services/project.service';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { copyFileSync } from 'fs';

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

  trash() {}

  ngAfterViewInit(): void {
    this.terminal = new Terminal();
    this.fitAddon = new FitAddon();
    this.terminal.open(this.terminalEl.nativeElement);
    setTimeout(() => {
      this.fitAddon.fit();
    }, 50);
    //
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
  }

  sendCommand(command: string): void {
    console.log("send command: ", command);
    window['terminal'].sendInput(command);
  }

  nodePtyInit() {
    console.log("currentPrj: ", this.projectService.currentProject)
    // 初始化本地工具
    window['terminal'].init({
      cols: 90,
      rows: 100,
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
