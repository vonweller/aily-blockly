import { Component, ElementRef, ViewChild } from '@angular/core';
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
import { BlocklyService2 } from './blockly.service2';

@Component({
  selector: 'blockly-arduino',
  imports: [],
  templateUrl: './blockly.component.html',
  styleUrl: './blockly.component.scss',
})
export class BlocklyComponent {
  @ViewChild('blocklyDiv', { static: true }) blocklyDiv!: ElementRef;

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

  get workspace2() {
    return this.blocklyService2.workspace;
  }

  set workspace2(workspace) {
    this.blocklyService2.workspace = workspace;
  }

  get toolbox2() {
    return this.blocklyService2.toolbox;
  }

  set toolbox2(toolbox) {
    this.blocklyService2.toolbox = toolbox;
  }

  constructor(
    private blocklyService: BlocklyService,
    private blocklyService2: BlocklyService2,
  ) {}

  ngOnInit(): void {}

  draggingBlock = null;

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
        theme: Blockly.Theme.defineTheme('modest', DEV_THEME),
      });

      this.workspace.addChangeListener((event: any) => {
        console.log('change', event);
        if (event.type === Blockly.Events.BLOCK_DRAG && event.isStart) {
          this.draggingBlock = this.workspace.getBlockById(event.blockId);
        }
        // let code = arduinoGenerator.workspaceToCode(this.workspace);
      });

      this.workspace2 = Blockly.inject('blocklyDiv2', {
        toolbox: this.toolbox2,
        // plugins: {
        //   toolbox: ContinuousToolbox,
        //   flyoutsVerticalToolbox: ContinuousFlyout,
        //   metricsManager: ContinuousMetrics,
        // },
        media: 'blockly/media/',
        renderer: 'thrasos',
        trashcan: true,
        theme: Blockly.Theme.defineTheme('modest', DEV_THEME),
      });

      this.workspace2.addChangeListener((event: any) => {
        console.log('change2', event);
        if (event.type === Blockly.Events.BLOCK_DRAG && event.isStart) {
          this.draggingBlock = this.workspace2.getBlockById(event.blockId);
        }
        // let code = arduinoGenerator.workspaceToCode(this.workspace2);
      });

      this.blocklyDiv.nativeElement.addEventListener('dragover', (event) => {
        console.log(22222);
        // event.preventDefault();
      });

      this.blocklyDiv.nativeElement.addEventListener('mousemove', (event) => {
        const width = this.blocklyDiv.nativeElement.offsetWidth;
        const height = this.blocklyDiv.nativeElement.offsetHeight;

        console.log(
          'Mouse moved:',
          event.clientX,
          event.clientY,
          width,
          height,
        );

        if (!this.draggingBlock) return;

        if (this.draggingBlock?.workspace?.id !== this.workspace.id) {
          const xml: any = Blockly.Xml.blockToDom(this.draggingBlock);
          // this.draggingBlock.dispose(false);
          const newBlock = Blockly.Xml.domToBlock(xml, this.workspace);
          newBlock.moveBy(
            event.clientX - 180 - this.workspace.scrollX,
            event.clientY - 70 - this.workspace.scrollY,
          );
          this.draggingBlock = newBlock;
          console.log(1111);
          // TODO 拖拽时不触发mousemove事件导致无法实时更新block位置
        }
      });

      window['Arduino'] = <any>arduinoGenerator;
      window['workspace1'] = this.workspace;
      window['workspace2'] = this.workspace2;
      // this.blocklyService.init();
      // this.blocklyService2.init();
      this.loadLibraries();
    }, 50);
  }

  // 加载库
  async loadLibraries() {
    let libs = await this.blocklyService.loadLibraries();
    let libs2 = await this.blocklyService2.loadLibraries();
  }
}
