import { Component, ViewChild } from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClipboardAddon } from '@xterm/addon-clipboard';

@Component({
  selector: 'app-terminal',
  imports: [],
  templateUrl: './terminal.component.html',
  styleUrl: './terminal.component.scss'
})
export class TerminalComponent {

  @ViewChild('terminal') terminalEl: any;

  terminal;
  fitAddon;
  clipboardAddon;
  command: string = '';

  ngAfterViewInit(): void {
    this.terminal = new Terminal();
    // 
    this.fitAddon = new FitAddon();
    this.terminal.open(this.terminalEl.nativeElement);
    setTimeout(() => {
      this.fitAddon.fit();
    }, 50);
    // 
    this.clipboardAddon = new ClipboardAddon();
    this.terminal.loadAddon(this.clipboardAddon);
    this.terminal.loadAddon(this.fitAddon);
    // 

    this.terminal.write('> ');
    this.terminal.onData((data) => {
      switch (data) {
        case '\r': // Enter
          this.terminal.write('\r\n');
          this.sendCommand(this.command);
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
  }

  sendCommand(command: string): void {
    console.log(command);

    // this.http.post('/api/execute', { command }).subscribe((response: any) => {
    //   this.term.write(response.output + '\r\n');
    //   this.term.write('Hello from \x1B[1;3;31mxterm.js\x1B[0m $ ');
    // });
  }
}
