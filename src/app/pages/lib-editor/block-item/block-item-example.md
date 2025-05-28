// 使用示例：如何使用 BlockItemComponent

// 1. 在父组件的模板中使用：
/*
<app-block-item 
  [blockDefinition]="blockDef"
  [readOnly]="true"
  [theme]="'zelos'"
  [renderer]="'zelos'"
  (blockClicked)="onBlockClicked($event)">
</app-block-item>
*/

// 2. 在父组件的 TypeScript 文件中定义 block 定义：
export const exampleBlockDefinitions = {
  // 简单的文本 block
  textBlock: {
    "type": "text",
    "message0": "文本 %1",
    "args0": [
      {
        "type": "field_input",
        "name": "TEXT",
        "text": "hello"
      }
    ],
    "output": "String",
    "colour": 160,
    "tooltip": "返回一个文本字符串",
    "helpUrl": ""
  },

  // 数学运算 block
  mathBlock: {
    "type": "math_arithmetic",
    "message0": "%1 %2 %3",
    "args0": [
      {
        "type": "input_value",
        "name": "A",
        "check": "Number"
      },
      {
        "type": "field_dropdown",
        "name": "OP",
        "options": [
          ["+", "ADD"],
          ["-", "MINUS"],
          ["×", "MULTIPLY"],
          ["÷", "DIVIDE"],
          ["^", "POWER"]
        ]
      },
      {
        "type": "input_value",
        "name": "B",
        "check": "Number"
      }
    ],
    "inputsInline": true,
    "output": "Number",
    "colour": 230,
    "tooltip": "数学运算",
    "helpUrl": ""
  },

  // 控制结构 block
  ifBlock: {
    "type": "controls_if",
    "message0": "如果 %1",
    "args0": [
      {
        "type": "input_value",
        "name": "IF0",
        "check": "Boolean"
      }
    ],
    "message1": "执行 %1",
    "args1": [
      {
        "type": "input_statement",
        "name": "DO0"
      }
    ],
    "previousStatement": null,
    "nextStatement": null,
    "colour": 210,
    "tooltip": "如果条件为真，则执行语句",
    "helpUrl": ""
  },

  // 函数定义 block
  functionBlock: {
    "type": "procedures_defnoreturn",
    "message0": "定义函数 %1 %2",
    "args0": [
      {
        "type": "field_input",
        "name": "NAME",
        "text": "函数名"
      },
      {
        "type": "input_dummy"
      }
    ],
    "message1": "执行 %1",
    "args1": [
      {
        "type": "input_statement",
        "name": "STACK"
      }
    ],
    "colour": 290,
    "tooltip": "定义一个没有返回值的函数",
    "helpUrl": ""
  }
};

// 3. 在父组件中的使用示例：
/*
import { Component } from '@angular/core';
import { exampleBlockDefinitions } from './block-item-example';

@Component({
  selector: 'app-example',
  template: `
    <div class="block-gallery">
      <h3>Block 预览画廊</h3>
      <div class="block-grid">
        <div class="block-item" *ngFor="let block of blocks">
          <h4>{{ block.name }}</h4>
          <app-block-item 
            [blockDefinition]="block.definition"
            [readOnly]="true"
            (blockClicked)="onBlockClicked(block)">
          </app-block-item>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .block-gallery {
      padding: 20px;
    }
    .block-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
    }
    .block-item {
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      background: white;
    }
    .block-item h4 {
      margin: 0 0 8px 0;
      font-size: 14px;
      color: #333;
    }
  `]
})
export class ExampleComponent {
  blocks = [
    { name: '文本块', definition: exampleBlockDefinitions.textBlock },
    { name: '数学运算', definition: exampleBlockDefinitions.mathBlock },
    { name: '条件判断', definition: exampleBlockDefinitions.ifBlock },
    { name: '函数定义', definition: exampleBlockDefinitions.functionBlock }
  ];

  onBlockClicked(block: any) {
    console.log('点击了 block:', block);
  }
}
*/
