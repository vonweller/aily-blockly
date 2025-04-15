import { Component, ElementRef, ViewChild } from '@angular/core';
import * as Blockly from 'blockly';
import * as zhHans from 'blockly/msg/zh-hans';
import {
  ContinuousToolbox,
  ContinuousFlyout,
  ContinuousMetrics,
} from './plugins/continuous-toolbox/src/index.js';
import './plugins/toolbox-search/src/index';
import './plugins/block-plus-minus/src/index.js';
import { arduinoGenerator } from './generators/arduino/arduino';
import { BlocklyService } from './blockly.service';
import { DEV_THEME } from './theme.config.js';
// import { NewVarModalComponent } from '../components/new-var-modal/new-var-modal.component';
import './custom-category';
import './custom-field/field-bitmap.js';
import './custom-field/field-image.js';
import './custom-field/field-tone';
import './custom-field/field-multilineinput.js';
import { Multiselect } from '@mit-app-inventor/blockly-plugin-workspace-multiselect';
import { PromptDialogComponent } from './components/prompt-dialog/prompt-dialog.component.js';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NoticeService } from '../services/notice.service.js';

@Component({
  selector: 'blockly-main',
  imports: [
    PromptDialogComponent,
    NzModalModule
  ],
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

  options = {
    toolbox: {
      kind: 'categoryToolbox',
      contents: [],
    },
    // plugins: {
    //   toolbox: ContinuousToolbox,
    //   flyoutsVerticalToolbox: ContinuousFlyout,
    //   metricsManager: ContinuousMetrics,
    // },
    theme: Blockly.Theme.defineTheme('zelos', DEV_THEME),
    // theme: 'zelos',
    renderer: 'thrasos',
    trashcan: true,
    grid: {
      spacing: 20, // 网格间距为20像素
      length: 3, // 网格点的大小
      colour: '#ccc',
      snap: true,
    },
    media: 'blockly/media',
    zoom: {
      controls: false,  // 不显示缩放控制按钮
      wheel: true,      // 启用鼠标滚轮缩放
      startScale: 1,  // 初始缩放比例
      maxScale: 1.5,      // 最大缩放比例
      minScale: 0.5,    // 最小缩放比例
      scaleSpeed: 1.05,  // 缩放速度
    },
    multiselectIcon: {
      hideIcon: true
    },
    multiSelectKeys: ['Shift'],
    multiselectCopyPaste: {
      crossTab: true,
      menu: true,
    },
  }

  constructor(
    private blocklyService: BlocklyService,
    private modal: NzModalService,
    private noticeService: NoticeService,
  ) { }

  ngOnInit(): void {
    this.setPrompt();
  }

  ngAfterViewInit(): void {
    // this.blocklyService.init();
    setTimeout(async () => {
      // 禁用blockly的警告
      console.warn = (function (originalWarn) {
        return function (msg) {
          // 过滤掉块重定义的警告
          if (msg.includes('overwrites previous definition')) {
            return;
          }
          // 保留其他警告
          originalWarn.apply(console, arguments);
        };
      })(console.warn);
      console.error = ((originalError) => {
        return (message, ...args) => {
          // 保留原始错误输出功能
          originalError.apply(console, arguments);

          // 处理特定错误
          let errorMessage = message + '   ' + args.join('\n');
          console.log('Blockly错误：', errorMessage);
          if (/block/i.test(errorMessage)) {
            // 常见错误1：Invalid block definition
            let title = message;
            let text = args.join('\n');
            if (errorMessage.includes('Invalid block definition')) {
              title = '无效的块定义';
            }
            if (text.startsWith("TypeError: ")) {
              text = text.substring("TypeError: ".length);
            }
            this.noticeService.update({
              title,
              text,
              detail: errorMessage,
              state: 'error',
              setTimeout: 99000,
            });
          }
        };
      })(console.error);

      Blockly.setLocale(<any>zhHans);
      this.workspace = Blockly.inject('blocklyDiv', this.options);

      const multiselectPlugin = new Multiselect(this.workspace);
      multiselectPlugin.init(this.options);

      // 监听容器尺寸变化，刷新Blockly工作区
      const resizeObserver = new ResizeObserver(() => {
        Blockly.svgResize(this.workspace);
      });
      resizeObserver.observe(this.blocklyDiv.nativeElement);

      // this.workspace.registerButtonCallback(
      //   'CREATE_NUMBER_VARIABLE',
      //   (button) => {
      //     console.log('CREATE_NUMBER_VARIABLE');
      //     Blockly.Variables.createVariableButtonHandler(
      //       this.workspace,
      //       (name) => {
      //         console.log('变量创建成功');
      //       },
      //       'aily-variable',
      //     );
      //   },
      // );

      // this.workspace.registerButtonCallback('CREATE_OBJECT', (button) => {
      //   console.log('CREATE_OBJECT');
      // });

      // Blockly.Variables.createVariableButtonHandler = (
      //   workspace,
      //   opt_callback,
      //   opt_type,
      // ) => {
      //   let modal = this.modal.create({
      //     nzTitle: '添加变量',
      //     nzWidth: '350px',
      //     nzContent: NewVarModalComponent,
      //     // nzComponentParams: {
      //     //   varType: opt_type
      //     // },
      //     nzOnOk: (e) => {
      //       if (opt_callback) opt_callback(e.varName);
      //     },
      //   });
      //   modal.triggerOk;
      // };
      // this.blocklyDiv.nativeElement.addEventListener(
      //   'mousemove',
      //   (event: any) => {
      //     if (!this.draggingBlock) return;

      //     if (this.draggingBlock?.workspace?.id !== this.workspace.id) {
      //       const xml: any = Blockly.Xml.blockToDom(this.draggingBlock); // .clone()

      //       const newBlock: any = Blockly.Xml.domToBlock(xml, this.workspace);
      //       newBlock.moveBy(
      //         event.clientX - 180 - this.workspace.scrollX - this.offsetX,
      //         event.clientY - 70 - this.workspace.scrollY - this.offsetY,
      //       );
      //       this.draggingBlock = null;
      //     }
      //   },
      // );

      window['Arduino'] = <any>arduinoGenerator;
      (window as any)['Blockly'] = Blockly;
      this.workspace.addChangeListener((event) => {
        try {
          let code = arduinoGenerator.workspaceToCode(this.workspace);
          this.blocklyService.codeSubject.next(code);
        } catch (error) {
          // 仅在开发环境下打印错误，避免用户看到错误
          console.debug('代码生成时出现错误，可能是某些块尚未注册：', error);
          // 错误发生时不更新代码
        }
      });
    }, 50);
  }

  ngOnDestroy(): void {
    this.blocklyService.reset();
  }

  setPrompt() {
    Blockly.dialog.setPrompt((message, defaultValue, callback) => {
      // console.log('对话框初始化，消息:', message, '默认值:', defaultValue);
      this.modal.create({
        nzTitle: null,
        nzFooter: null,
        nzClosable: false,
        nzBodyStyle: {
          padding: '0',
        },
        nzWidth: '300px',
        nzContent: PromptDialogComponent,
        nzOnOk: (e) => {
          callback(e.value);
        },
        nzOnCancel: () => {
          console.log('cancel');
        }
      });
    });
  }

  // closePromptDialog() {
  //   this.showPromptDialog = false;
  // }

  // varNameChange(e) {
  //   console.log('varNameChange', e);
  // }

}
