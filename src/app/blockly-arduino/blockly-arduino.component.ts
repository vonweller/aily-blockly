import { Component } from '@angular/core';
import * as Blockly from 'blockly';

@Component({
  selector: 'blockly-arduino',
  imports: [],
  templateUrl: './blockly-arduino.component.html',
  styleUrl: './blockly-arduino.component.scss'
})
export class BlocklyArduinoComponent {

  toolbox = {
    "kind": "flyoutToolbox",
    "contents": [
      {
        "kind": "block",
        "type": "controls_if"
      },
      {
        "kind": "block",
        "type": "controls_repeat_ext"
      },
      {
        "kind": "block",
        "type": "logic_compare"
      },
      {
        "kind": "block",
        "type": "math_number"
      },
      {
        "kind": "block",
        "type": "math_arithmetic"
      },
      {
        "kind": "block",
        "type": "text"
      },
      {
        "kind": "block",
        "type": "text_print"
      },
    ]
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      const workspace = Blockly.inject('blocklyDiv', {
        toolbox: this.toolbox,
        theme: 'zelos',
      });
    }, 50);

  }
}
