import { Component, ViewChild, viewChild } from '@angular/core';
import { Terminal } from '@xterm/xterm';

@Component({
  selector: 'app-terminal',
  imports: [],
  templateUrl: './terminal.component.html',
  styleUrl: './terminal.component.scss'
})
export class TerminalComponent {

@ViewChild('terminal') terminalEl: any;

  term;

  ngAfterViewInit(): void {
    this.term = new Terminal();
    this.term.open(this.terminalEl.nativeElement);
    this.term.write('Hello from \x1B[1;3;31mxterm.js\x1B[0m $ ')
  }
}
