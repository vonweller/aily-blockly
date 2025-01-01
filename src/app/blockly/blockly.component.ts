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
import { browserEvents, Toolbox } from 'blockly';

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

  get draggingBlock() {
    return this.blocklyService.draggingBlock;
  }

  set draggingBlock(draggingBlock: any) {
    this.blocklyService.draggingBlock = draggingBlock;
  }

  get offsetX() {
    return this.blocklyService.offsetX;
  }

  get offsetY() {
    return this.blocklyService.offsetY;
  }

  constructor(
    private blocklyService: BlocklyService,
    private blocklyService2: BlocklyService2,
  ) {}

  ngOnInit(): void {}

  tempNewBlock = null;

  block;
  manager;

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
      this.blocklyDiv.nativeElement.addEventListener(
        'mousemove',
        (event: any) => {
          if (!this.draggingBlock) return;

          if (this.draggingBlock?.workspace?.id !== this.workspace.id) {
            const xml: any = Blockly.Xml.blockToDom(this.draggingBlock); // .clone()

            const newBlock: any = Blockly.Xml.domToBlock(xml, this.workspace);
            newBlock.moveBy(
              event.clientX - 180 - this.workspace.scrollX - this.offsetX,
              event.clientY - 70 - this.workspace.scrollY - this.offsetY,
            );
            this.draggingBlock = null;
          }
        },
      );

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
      this.workspace2.updateToolbox(toolboxJson);

      this.workspace2.addChangeListener((event: any) => {
        if (event.type === Blockly.Events.BLOCK_DRAG && event.isStart) {
          this.draggingBlock = this.workspace2.getBlockById(event.blockId);
        }
        // if (event.type === 'click' && event.targetType === 'block') {
        //   this.draggingBlock = this.workspace2.getBlockById(event.blockId);
        // }
        // let code = arduinoGenerator.workspaceToCode(this.workspace2);
      });

      // Blockly.serialization.workspaces.load(
      //   {
      //     blocks: {
      //       languageVersion: 0,
      //       blocks: [
      //         {
      //           type: 'controls_if',
      //           id: 'j.:oqr+^)OI8SG+$@%XV',
      //           x: 63,
      //           y: 238,
      //         },
      //         {
      //           type: 'lists_create_with',
      //           id: 'jnB5|zH|2VEn~Gz@I2o!',
      //           x: 38,
      //           y: 138,
      //           extraState: {
      //             itemCount: 3,
      //           },
      //         },
      //         {
      //           type: 'text_append',
      //           id: 'dF@=$k`$x:=|x/X9$Yf0',
      //           x: 38,
      //           y: 88,
      //           fields: {
      //             VAR: {
      //               id: 'NkZFMkM#e!G)24F,My^S',
      //             },
      //           },
      //           inputs: {
      //             TEXT: {
      //               shadow: {
      //                 type: 'text',
      //                 id: 'G,PV-2E*OTO=)EVPJ6xO',
      //                 fields: {
      //                   TEXT: '',
      //                 },
      //               },
      //             },
      //           },
      //         },
      //       ],
      //     },
      //     variables: [
      //       {
      //         name: 'item',
      //         id: 'NkZFMkM#e!G)24F,My^S',
      //       },
      //     ],
      //   },
      //   this.workspace,
      // );

      // Blockly.serialization.workspaces.load(
      //   {
      //     blocks: {
      //       blocks: [
      //         {
      //           type: 'controls_if',
      //           id: 'first',
      //           x: 0,
      //           y: 0,
      //         },
      //         {
      //           type: 'controls_if',
      //           id: 'other',
      //           x: 200,
      //           y: 200,
      //         },
      //       ],
      //     },
      //   },
      //   this.workspace,
      // );
      // this.block = this.workspace.getBlockById('first');
      // this.block.setDragging(true);
      // this.manager = new Blockly.InsertionMarkerManager(this.block);
      //
      // this.manager.update(new Blockly.utils.Coordinate(190, 200), null);
      // const markers = this.manager.getInsertionMarkers();
      // const marker = markers[0];

      // const workspace = this.workspace;
      // workspace.cleanUp();
      // const blockCanvas = workspace.getCanvas();
      // const clone: any = blockCanvas.cloneNode(true);
      // clone.removeAttribute('transform');
      // const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      // svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      // svg.appendChild(clone);
      // svg.setAttribute('width', '100%');
      // svg.setAttribute('height', '100%');
      // svg.setAttribute(
      //   'class',
      //   'blocklySvg ' +
      //     (workspace.options.renderer || 'geras') +
      //     '-renderer ' +
      //     (workspace.getTheme ? workspace.getTheme().name + '-theme' : ''),
      // );
      // svg.style.backgroundColor = 'transparent';
      // browserEvents.conditionalBind(svg, 'pointerdown', this, (point) => {
      //   let parent = point.target;
      //   let blocklyDraggable = null;
      //   while (parent) {
      //     if (parent.nodeName.includes('svg')) {
      //       break;
      //     }
      //     if (
      //       parent.className?.baseVal?.includes('blocklyDraggable') &&
      //       parent.parentNode?.className?.baseVal?.includes(
      //         'blocklyBlockCanvas',
      //       )
      //     ) {
      //       blocklyDraggable = parent;
      //       break;
      //     }
      //     parent = parent.parentNode;
      //   }
      //   if (blocklyDraggable?.dataset?.id) {
      //     const block = this.workspace.getBlockById(
      //       blocklyDraggable?.dataset?.id,
      //     );
      //   }
      // });
      // this.aiToolbox.nativeElement.appendChild(svg);

      // // 获取要移动的节点
      // let elementToMove: any = document.getElementsByClassName(
      //   'blocklyBlockDragSurface',
      // );
      //
      // elementToMove[0].style.top = '70px';
      // elementToMove[1].style.top = 'calc(40% - 72px)';
      //
      // this.dynamicContent.nativeElement.append(...elementToMove);

      // browserEvents.conditionalBind(
      //   this.blocklyDiv.nativeElement,
      //   'pointermove',
      //   this,
      //   (event) => {
      //     if (this.tempNewBlock) {
      //       this.tempNewBlock.select();
      //       this.tempNewBlock.setDragging(true);
      //       this.tempNewBlock.startDrag();
      //       this.tempNewBlock.moveDuringDrag(
      //         new Blockly.utils.Coordinate(
      //           event.clientX - 180 - this.workspace.scrollX,
      //           event.clientY - 70 - this.workspace.scrollY,
      //         ),
      //       );
      //       return;
      //     }
      //
      //     if (!this.draggingBlock) return;
      //     if (this.draggingBlock?.workspace?.id !== this.workspace.id) {
      //       const xml: any = Blockly.Xml.blockToDom(this.draggingBlock);
      //       this.draggingBlock.dispose(false);
      //       this.tempNewBlock = Blockly.Xml.domToBlock(xml, this.workspace);
      //     }
      //   },
      // );

      // this.blocklyDiv2.nativeElement.addEventListener('mousemove', (event) => {
      //   if (!this.draggingBlock) return;
      //
      //   // const block = this.draggingBlock;
      //   // block.select();
      //   // block.setDragging(true);
      //   // block.startDrag();
      //   // const gesture = this.workspace2.getGesture(event);
      //   // if (gesture) {
      //   //   gesture.handleBlockStart(event, block);
      //   // }
      //   // block.moveDuringDrag(
      //   //   new Blockly.utils.Coordinate(
      //   //     event.clientX - 200,
      //   //     event.clientY - 450,
      //   //   ),
      //   // );
      //
      //   // if (this.draggingBlock?.workspace?.id !== this.workspace.id) {
      //   //   const xml: any = Blockly.Xml.blockToDom(this.draggingBlock);
      //   //   this.draggingBlock.dispose(false);
      //   //   const newBlock: any = Blockly.Xml.domToBlock(xml, this.workspace);
      //   //   newBlock.moveTo(
      //   //     event.clientX - 180 - this.workspace.scrollX,
      //   //     event.clientY - 70 - this.workspace.scrollY,
      //   //   );
      //   // }
      // });

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
