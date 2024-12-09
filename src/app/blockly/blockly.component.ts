import { Component } from '@angular/core';
import * as Blockly from 'blockly';
import * as zhHans from 'blockly/msg/zh-hans';
import {
  ContinuousToolbox,
  ContinuousFlyout,
  ContinuousMetrics,
} from './plugins/continuous-toolbox/src/index.js';
import './plugins/toolbox-search/src/index.js';
import { arduinoGenerator } from './generators/arduino/arduino';
import { BlocklyService } from './blockly.service';
import { DEV_THEME } from './theme.config.js';

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
    this.blocklyService.init();
    this.loadLibraries();
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      // console.log(zhHans);
      
      Blockly.setLocale(<any>zhHans);
      this.workspace = Blockly.inject('blocklyDiv', {
        toolbox: this.toolbox,
        // plugins: {
        //   toolbox: ContinuousToolbox,
        //   flyoutsVerticalToolbox: ContinuousFlyout,
        //   metricsManager: ContinuousMetrics,
        // },
        media: 'blockly/media/',
        renderer: 'thrasos',
        trashcan: true,
        theme: Blockly.Theme.defineTheme('modest',DEV_THEME)
      });

      this.workspace.addChangeListener(() => {
        let code = arduinoGenerator.workspaceToCode(this.workspace);
      });
      window['Arduino'] = <any>arduinoGenerator
    }, 50);
  }

  // 加载库
  async loadLibraries() {
    let libs = await this.blocklyService.loadLibraries();
  }
}
