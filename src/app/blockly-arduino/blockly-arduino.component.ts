import { Component } from '@angular/core';
import * as Blockly from 'blockly';
import {
  ContinuousToolbox,
  ContinuousFlyout,
  ContinuousMetrics,
} from './plugins/continuous-toolbox/src/index.js';
import './plugins/toolbox-search/src/index.js';

@Component({
  selector: 'blockly-arduino',
  imports: [],
  templateUrl: './blockly-arduino.component.html',
  styleUrl: './blockly-arduino.component.scss'
})
export class BlocklyArduinoComponent {

  toolbox = {
    "kind": "categoryToolbox",
    "contents": [
      {
        'kind': 'search',
        'name': 'Search',
        'contents': [],
      },
      {
        "kind": "category",
        "name": "Control",
        "contents": [
          {
            "kind": "block",
            "type": "controls_if"
          },
          {
            "kind": "block",
            "type": "controls_whileUntil"
          },
          {
            "kind": "block",
            "type": "controls_for"
          }
        ]
      },
      {
        "kind": "category",
        "name": "Logic",
        "contents": [
          {
            "kind": "block",
            "type": "logic_compare"
          },
          {
            "kind": "block",
            "type": "logic_operation"
          },
          {
            "kind": "block",
            "type": "logic_boolean"
          }
        ]
      }
    ]
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      const workspace = Blockly.inject('blocklyDiv', {
        toolbox: this.toolbox,
        plugins: {
          toolbox: ContinuousToolbox,
          flyoutsVerticalToolbox: ContinuousFlyout,
          metricsManager: ContinuousMetrics,
        },
        theme: 'zelos',
      });
    }, 50);

  }
}
