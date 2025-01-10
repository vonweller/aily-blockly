import { Component } from '@angular/core';
import * as Blockly from 'blockly';
import * as zhHans from 'blockly/msg/zh-hans';
import {
  ContinuousToolbox,
  ContinuousFlyout,
  ContinuousMetrics,
} from './plugins/continuous-toolbox/src/index.js';
import './plugins/toolbox-search/src/index.js';
import { arduinoGenerator, DEFAULT_DATA } from './generators/arduino/arduino';
import { BlocklyService } from './blockly.service';
import { DEV_THEME } from './theme.config.js';
import { javascriptGenerator } from 'blockly/javascript';

@Component({
  selector: 'blockly-main',
  imports: [],
  templateUrl: './blockly.component.html',
  styleUrl: './blockly.component.scss',
})
export class BlocklyComponent {
  get workspace() {
    return this.blocklyService.workspace;
  }

  set workspace(workspace) {
    this.blocklyService.workspace = workspace;
  }

  get toolbox() {
    return this.blocklyService.toolbox;
  }

  set toolbox(toolbox) {
    this.blocklyService.toolbox = toolbox;
  }

  constructor(private blocklyService: BlocklyService) {}

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    setTimeout(async () => {
      Blockly.setLocale(<any>zhHans);
      this.workspace = Blockly.inject('blocklyDiv', {
        toolbox: this.toolbox,
        // plugins: {
        //   toolbox: ContinuousToolbox,
        //   flyoutsVerticalToolbox: ContinuousFlyout,
        //   metricsManager: ContinuousMetrics,
        // },
        renderer: 'thrasos',
        theme: Blockly.Theme.defineTheme('modest', DEV_THEME),
        trashcan: true,
        grid: {
          spacing: 20, // 网格间距为20像素
          length: 3, // 网格点的大小
          colour: '#ccc',
          snap: true,
        },
      });
      this.workspace.addChangeListener((event) => {
        let code = arduinoGenerator.workspaceToCode(this.workspace);
        // let code = javascriptGenerator.workspaceToCode(this.workspace);
        this.blocklyService.codeSubject.next(code);
      });
      window['Arduino'] = <any>arduinoGenerator;
      window['Blockly'] = Blockly;
      this.blocklyService.init();
      await this.loadLibraries();
      this.loadDefaultData();
    }, 50);
  }

  // 加载库
  async loadLibraries() {
    let libs = await this.blocklyService.loadLibraries();
  }

  loadDefaultData() {
    let tempJson = JSON.parse(DEFAULT_DATA);
    this.loadJson(tempJson);
  }

  loadJson(json) {
    Blockly.serialization.workspaces.load(json, this.workspace);
  }
}
