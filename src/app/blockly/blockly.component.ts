import { Component } from '@angular/core';
import * as Blockly from 'blockly';
import {
  ContinuousToolbox,
  ContinuousFlyout,
  ContinuousMetrics,
} from './plugins/continuous-toolbox/src/index.js';
import './plugins/toolbox-search/src/index.js';
import { arduinoGenerator } from './generators/arduino/arduino';
import { BlocklyService } from './blockly.service';

@Component({
  selector: 'blockly-arduino',
  imports: [],
  templateUrl: './blockly.component.html',
  styleUrl: './blockly.component.scss'
})
export class BlocklyComponent {

  get workspace() {
    return this.blocklyService.workspace
  }

  set workspace(workspace) {
    this.blocklyService.workspace = workspace
  }

  get toolbox() {
    return this.blocklyService.toolbox
  }

  set toolbox(toolbox) {
    this.blocklyService.toolbox = toolbox
  }

  constructor(
    private blocklyService: BlocklyService
  ) {

  }

  ngOnInit(): void {
    //Called after the constructor, initializing input properties, and the first call to ngOnChanges.
    //Add 'implements OnInit' to the class.
    this.loadLibraries();
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.workspace = Blockly.inject('blocklyDiv', {
        toolbox: this.toolbox,
        plugins: {
          toolbox: ContinuousToolbox,
          flyoutsVerticalToolbox: ContinuousFlyout,
          metricsManager: ContinuousMetrics,
        },
        theme: 'zelos',
      });

      this.workspace.addChangeListener(() => {
        let code = arduinoGenerator.workspaceToCode(this.workspace);
      });
    }, 50);
  }

  // 加载库
  async loadLibraries() {
    let libs = await this.blocklyService.loadLibraries();
    // console.log(libs);
  }
}
