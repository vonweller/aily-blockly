import {
  Component,
  ElementRef,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';
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
import { Toolbox } from 'blockly';

@Component({
  selector: 'blockly-arduino',
  imports: [],
  templateUrl: './blockly.component.html',
  styleUrl: './blockly.component.scss',
})
export class BlocklyComponent {
  @ViewChild('blocklyDiv', { static: true }) blocklyDiv!: ElementRef;
  @ViewChild('blocklyDiv2', { static: true }) blocklyDiv2!: ElementRef;
  @ViewChild('aiToolbox', { static: true }) aiToolbox!: ElementRef;
  @ViewChild('dynamicContent', { static: true }) dynamicContent!: ElementRef;

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
  tempNewBlock = null;
  svgGroup = Blockly.utils.dom.createSvgElement('svg', {
    class: 'blocklyFlyout',
  });

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
        // console.log('change', event);
        // if (event.type === Blockly.Events.BLOCK_DRAG && event.isStart) {
        //   this.draggingBlock = this.workspace.getBlockById(event.blockId);
        // }
        // let code = arduinoGenerator.workspaceToCode(this.workspace);
      });

      this.workspace2 = Blockly.inject('blocklyDiv2', {
        toolbox: {
          kind: 'flyoutToolbox',
          contents: [
            {
              kind: 'block',
              type: 'controls_if',
            },
          ],
        },
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

      const toolboxJson = {
        kind: 'flyoutToolbox',
        contents: [
          {
            kind: 'block',
            type: 'controls_if',
          },
          {
            kind: 'block',
            type: 'controls_whileUntil',
          },
        ],
      };

      this.workspace2.addChangeListener((event: any) => {
        console.log('change2', event);
        // if (event.type === Blockly.Events.BLOCK_DRAG && event.isStart) {
        //   this.draggingBlock = this.workspace2.getBlockById(event.blockId);
        // }
        if (event.type === 'click' && event.targetType === 'block') {
          this.draggingBlock = this.workspace2.getBlockById(event.blockId);
        }
        // let code = arduinoGenerator.workspaceToCode(this.workspace2);
      });

      // const toolbox = new Toolbox(this.workspace2);
      // toolbox.HtmlDiv = toolboxJson;
      // toolbox.render(toolboxJson);
      this.workspace2.updateToolbox(toolboxJson);

      // // 获取要移动的节点
      // let elementToMove: any = document.getElementsByClassName(
      //   'blocklyBlockDragSurface',
      // );
      //
      // console.log(1111, elementToMove);
      // console.log(2222, this.blocklyDiv.nativeElement.parentElement);
      // elementToMove[0].style.top = '70px';
      // elementToMove[1].style.top = 'calc(40% - 72px)';
      //
      // this.dynamicContent.nativeElement.append(...elementToMove);

      this.blocklyDiv2.nativeElement.addEventListener('mousemove', (event) => {
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

        console.log(this.draggingBlock.id);
        // const block = this.workspace2.getBlockById(this.draggingBlock.id);

        const block = this.draggingBlock;
        block.select();
        block.setDragging(true);
        block.startDrag();
        block.moveDuringDrag(
          new Blockly.utils.Coordinate(
            event.clientX - 200,
            event.clientY - 450,
          ),
        );

        // if (this.draggingBlock?.workspace?.id !== this.workspace.id) {
        //   const xml: any = Blockly.Xml.blockToDom(this.draggingBlock);
        //   this.draggingBlock.dispose(false);
        //   const newBlock = Blockly.Xml.domToBlock(xml, this.workspace);
        //   newBlock.moveBy(
        //     event.clientX - 180 - this.workspace.scrollX,
        //     event.clientY - 70 - this.workspace.scrollY,
        //   );
        //   this.draggingBlock = newBlock;
        //   console.log(1111);
        //   // TODO 拖拽时不触发mousemove事件导致无法实时更新block位置
        // }

        // console.log(3333, this.tempNewBlock?.workspace?.id);
        // if (this.tempNewBlock?.workspace?.id === this.workspace.id) {
        //   // console.log(2222, this.tempNewBlock);
        //   // TODO 拖拽时不触发mousemove事件导致无法实时更新block位置
        // }
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
